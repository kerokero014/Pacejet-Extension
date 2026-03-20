/// <amd-module name="RDT.Pacejet.Mapping"/>

define("RDT.Pacejet.Mapping", [
  "RDT.Pacejet.Config",
  "RDT.Pacejet.CarrierMap",
  "RDT.Pacejet.State"
], function (Config, CarrierMap, PacejetState) {
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

    if (key.indexOf("UPS") !== -1)
      return byCarrier.UPS || CarrierMap.UPS_GROUND;
    if (key.indexOf("FEDEX") !== -1)
      return byCarrier.FEDEX || CarrierMap.FEDEX_GROUND;
    if (key.indexOf("SAIA") !== -1)
      return byCarrier.SAIA || CarrierMap.SAIA_LTL;
    if (key.indexOf("ESTES") !== -1)
      return byCarrier.ESTES || CarrierMap.ESTES_LTL;
    if (key.indexOf("ODFL") !== -1) return byCarrier.ODFL || "";

    if (
      service.indexOf("pickup") !== -1 ||
      service.indexOf("will call") !== -1
    ) {
      return CarrierMap.WILL_CALL;
    }

    return "";
  }

  function decorateRates(rates) {
    if (!rates || !rates.length) return rates || [];

    for (var i = 0; i < rates.length; i++) {
      var rate = rates[i];
      var apiShipCode = String((rate && rate.shipCode) || "").trim();

      // Trust Pacejet-provided ship codes when present.
      // Mapping rules are only used to backfill missing ship codes.
      if (apiShipCode) {
        rate.shipCode = apiShipCode;
        rate._mapping = {
          type: "api",
          rule: null
        };
        continue;
      }

      // --- Explicit config mapping ---
      var explicit = mapViaConfig(rate);
      if (explicit && explicit.shipCode) {
        rate.shipCode = explicit.shipCode;
        rate._mapping = {
          type: "explicit",
          rule: explicit.rule
        };
        continue;
      }

      // --- Fallback mapping ---
      var fallbackCode = mapViaFallback(rate);
      if (fallbackCode) {
        rate.shipCode = fallbackCode;
        rate._mapping = {
          type: "fallback",
          rule: null
        };

        PacejetState.recordFallback({
          carrier: rate.carrierName || rate.carrier,
          service: rate.serviceName || rate.service,
          shipCode: fallbackCode
        });

        continue;
      }

      // --- Unmapped ---
      rate.shipCode = "";
      rate._mapping = {
        type: "unmapped",
        rule: null
      };

      PacejetState.recordUnmapped({
        carrier: rate.carrierName || rate.carrier,
        service: rate.serviceName || rate.service,
        raw: rate.raw || null
      });
    }

    return rates;
  }

  return {
    decorateRates: decorateRates
  };
});
