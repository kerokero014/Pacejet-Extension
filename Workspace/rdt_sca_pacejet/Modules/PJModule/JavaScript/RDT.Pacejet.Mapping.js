/// <amd-module name="RDT.Pacejet.Mapping"/>

define("RDT.Pacejet.Mapping", [
  "RDT.Pacejet.Config",
  "RDT.Pacejet.CarrierMap",
  "RDT.Pacejet.State",
  "LiveOrder.Model"
], function (Config, CarrierMap, PacejetState, LiveOrderModel) {
  "use strict";

  function carrierKey(c) {
    return String(c || "")
      .toUpperCase()
      .replace(/\s+/g, "_")
      .replace(/[^A-Z0-9_]/g, "");
  }

  function norm(t) {
    return String(t || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function getConfigMap() {
    var m = (Config && Config.shipmethodMap) || [];
    return Array.isArray(m) ? m : [];
  }

  function matchRule(rule, carrier, service, tag) {
    if (!rule) return false;

    if (rule.carrier && carrier.indexOf(norm(rule.carrier)) === -1) {
      return false;
    }

    if (rule.service && norm(rule.service) !== service) {
      return false;
    }

    if (
      rule.serviceIncludes &&
      service.indexOf(norm(rule.serviceIncludes)) === -1
    ) {
      return false;
    }

    if (rule.tagIncludes && tag.indexOf(norm(rule.tagIncludes)) === -1) {
      return false;
    }

    return true;
  }

  function mapViaConfig(rate) {
    var rules = getConfigMap();
    if (!rules.length) return null;

    var carrier = norm(rate.carrierName || rate.carrier);
    var service = norm(rate.serviceName || rate.service);
    var tag = norm(rate.tag || "");

    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (matchRule(rule, carrier, service, tag)) {
        return {
          shipCode: String(rule.shipCode || ""),
          rule: rule
        };
      }
    }

    return null;
  }

  function mapViaFallback(rate) {
    var byCarrier = Config.fallbackShipmethodByCarrier || {};
    var key = carrierKey(rate.carrierName || rate.carrier);
    var service = norm(rate.serviceName || rate.service);

    if (key.indexOf("UPS") !== -1) {
      return String(byCarrier.UPS || CarrierMap.UPS_GROUND || "");
    }

    if (key.indexOf("FEDEX") !== -1) {
      return String(byCarrier.FEDEX || CarrierMap.FEDEX_GROUND || "");
    }

    if (key.indexOf("SAIA") !== -1) {
      return String(byCarrier.SAIA || CarrierMap.SAIA_LTL || "");
    }

    if (key.indexOf("ESTES") !== -1) {
      return String(byCarrier.ESTES || CarrierMap.ESTES_LTL || "");
    }

    if (key.indexOf("ODFL") !== -1) {
      return String(byCarrier.ODFL || "");
    }

    if (key.indexOf("XPO") !== -1) {
      return String(byCarrier.XPO || "");
    }

    if (key.indexOf("RL") !== -1 || key.indexOf("RL_CARRIERS") !== -1) {
      return String(byCarrier.RL_CARRIERS || byCarrier.RL || "");
    }

    if (
      service.indexOf("pickup") !== -1 ||
      service.indexOf("will call") !== -1
    ) {
      return String(CarrierMap.WILL_CALL || "");
    }

    return "";
  }

  function getLiveOrderShipmethodMap() {
    var map = {};
    var order = null;
    var methods = [];
    var i;
    var method;
    var id;

    try {
      order =
        LiveOrderModel && typeof LiveOrderModel.getInstance === "function"
          ? LiveOrderModel.getInstance()
          : null;
    } catch (_e) {
      order = null;
    }

    methods = (order && order.get && order.get("shipmethods")) || [];

    for (i = 0; i < methods.length; i++) {
      method = methods[i] || {};
      id = String(method.internalid || "").trim();

      if (id) {
        map[id] = method;
      }
    }

    return map;
  }

  function isValidShipmethodId(shipCode, validShipmethods) {
    var id = String(shipCode || "").trim();
    return !!(id && validShipmethods && validShipmethods[id]);
  }

  function hasLoadedShipmethods(validShipmethods) {
    return !!(
      validShipmethods &&
      typeof validShipmethods === "object" &&
      Object.keys(validShipmethods).length
    );
  }

  function recordFallback(rate, shipCode) {
    if (PacejetState && typeof PacejetState.recordFallback === "function") {
      PacejetState.recordFallback({
        carrier: rate.carrierName || rate.carrier,
        service: rate.serviceName || rate.service,
        shipCode: String(shipCode || "")
      });
    }
  }

  function recordUnmapped(rate) {
    if (PacejetState && typeof PacejetState.recordUnmapped === "function") {
      PacejetState.recordUnmapped({
        carrier: rate.carrierName || rate.carrier,
        service: rate.serviceName || rate.service,
        raw: rate.raw || null
      });
    }
  }

  function decorateRates(rates) {
    var validShipmethods = getLiveOrderShipmethodMap();
    var hasShipmethods = hasLoadedShipmethods(validShipmethods);
    var i;
    var rate;
    var apiShipCode;
    var explicit;
    var fallbackCode;

    if (!rates || !rates.length) {
      return rates || [];
    }

    for (i = 0; i < rates.length; i++) {
      rate = rates[i] || {};
      apiShipCode = String(rate.shipCode || "").trim();

      // 1) Trust API shipCode only if:
      //    - shipmethods are not loaded yet, OR
      //    - the API code is valid in current LiveOrder
      if (
        apiShipCode &&
        (!hasShipmethods || isValidShipmethodId(apiShipCode, validShipmethods))
      ) {
        rate.shipCode = apiShipCode;
        rate._mapping = {
          type: "api",
          rule: null
        };
        continue;
      }

      // 2) Explicit config mapping
      explicit = mapViaConfig(rate);
      if (
        explicit &&
        explicit.shipCode &&
        (!hasShipmethods ||
          isValidShipmethodId(explicit.shipCode, validShipmethods))
      ) {
        rate.shipCode = String(explicit.shipCode);
        rate._mapping = {
          type: "explicit",
          rule: explicit.rule
        };
        continue;
      }

      // 3) Fallback mapping
      fallbackCode = mapViaFallback(rate);
      if (
        fallbackCode &&
        (!hasShipmethods || isValidShipmethodId(fallbackCode, validShipmethods))
      ) {
        rate.shipCode = String(fallbackCode);
        rate._mapping = {
          type: "fallback",
          rule: null
        };
        recordFallback(rate, fallbackCode);
        continue;
      }

      // 4) Unmapped / unusable
      rate.shipCode = "";
      rate._mapping = {
        type: "unmapped",
        rule: null
      };

      recordUnmapped(rate);
    }

    return rates;
  }

  return {
    decorateRates: decorateRates
  };
});
