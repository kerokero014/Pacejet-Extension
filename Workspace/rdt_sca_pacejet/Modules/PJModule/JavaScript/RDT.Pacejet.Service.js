/// <amd-module name="RDT.Pacejet.Service"/>

define("RDT.Pacejet.Service", [
  "jQuery",
  "Utils",
  "RDT.Pacejet.State",
  "RDT.Pacejet.Config",
  "RDT.Pacejet.Pacejet.Payload",
  "RDT.Pacejet.Pacejet.Mapper",
  "RDT.Pacejet.FreightMarkup",
  "RDT.Pacejet.AccessorialMatrix",
  "RDT.Pacejet.Mapping"
], function (
  jQuery,
  Utils,
  PacejetState,
  Config,
  Payload,
  Mapper,
  FreightMarkup,
  AccessorialMatrix,
  RateMapping
) {
  "use strict";

  var state = PacejetState.get();
  var requestCounter = 0;
  var ACCESSORIAL_MAP = {
    driver_call: "DRIVER_CALL",
    job_site: "JOB_SITE",
    lift_gate: "LIFT_GATE",
    residential: "RESIDENTIAL",
    schedule_appt: "APPOINTMENT",
    self_storage: "SELF_STORAGE",
    school: "SCHOOL",
    inside_delivery: "INSIDE_DELIVERY",
    hazmat_parcel: "HAZMAT",
    dangerous_goods: "DANGEROUS_GOODS"
  };

  function getServiceUrl() {
    return Utils.getAbsoluteUrl(
      getExtensionAssetsPath("services/PJModule.Service.ss")
    );
  }

  function getRatesUrl() {
    var baseUrl =
      String((Config && Config.getRatesUrl) || "").trim() ||
      "/app/site/hosting/scriptlet.nl?script=3954&deploy=1";
    var separator = baseUrl.indexOf("?") === -1 ? "?" : "&";

    return baseUrl + separator + "t=" + Date.now();
  }

  function requestService(method, payload) {
    return jQuery.ajax({
      url: getServiceUrl(),
      type: method || "POST",
      contentType: "application/json",
      dataType: "json",
      data: payload ? JSON.stringify(payload) : null
    });
  }

  function requestRates(payload) {
    return jQuery.ajax({
      url: getRatesUrl(),
      type: "POST",
      contentType: "application/json",
      dataType: "json",
      data: payload ? JSON.stringify(payload) : null
    });
  }

  function normalizeAccessorialArray(accessorials) {
    return Array.isArray(accessorials) ? accessorials : [];
  }

  function normalizeAccessorialSelection(accessorials) {
    return accessorials && typeof accessorials === "object" && !Array.isArray(accessorials)
      ? accessorials
      : {};
  }

  function normalizeCustomFields(customFields) {
    return Array.isArray(customFields) ? customFields : [];
  }

  function buildApplyRatePayload(payload) {
    payload = payload || {};

    return {
      action: "applyRateToCart",
      shipmethod:
        payload.shipmethod === null || payload.shipmethod === undefined
          ? ""
          : String(payload.shipmethod),
      accessorials: normalizeAccessorialArray(payload.accessorials),
      accessorialSelection: normalizeAccessorialSelection(
        payload.accessorialSelection
      ),
      customFields: normalizeCustomFields(payload.customFields),
      customfields: normalizeCustomFields(payload.customFields)
    };
  }

  function buildRawRateRequest(payloads, cartSnapshot) {
    var firstEntry =
      Array.isArray(payloads) && payloads.length ? payloads[0] || {} : {};
    var rawPayload = jQuery.extend(true, {}, firstEntry.payload || firstEntry);

    rawPayload.cartSnapshot = cartSnapshot;

    return rawPayload;
  }

  function normalizeModeResponses(serviceResponse, payloads) {
    if (
      serviceResponse &&
      Array.isArray(serviceResponse.modeResults) &&
      serviceResponse.modeResults.length
    ) {
      return serviceResponse.modeResults;
    }

    if (serviceResponse && serviceResponse.origins) {
      return [
        {
          mode: (payloads && payloads[0] && payloads[0].mode) || "Single",
          resp: serviceResponse
        }
      ];
    }

    return [];
  }

  function num(t) {
    return Number(String(t || "").replace(/[^0-9.\-]/g, "")) || 0;
  }

  // -------------------------------
  // Snapshot helpers (for markup)
  // -------------------------------
  function getLastSnapshot() {
    return (state && state.cache && state.cache.lastSnapshot) || null;
  }

  function filterRatesPerOrigin(originKey, originObj) {
    var isDropShip = !!originObj.dropShip;
    var rates = originObj._mappedRates || [];

    var filtered = rates.filter(function (rate) {
      if (!rate || rate.cost == null) return false;

      var carrierUpper = String(
        rate.carrierName || rate.carrier || ""
      ).toUpperCase();

      var modeUpper = String(rate.mode || "").toUpperCase();

      // Remove poison $0 LTL carriers
      if (modeUpper === "LTL" && rate.cost <= 0) {
        return false;
      }

      // DropShip origin rules
      if (isDropShip) {
        var isFedEx = carrierUpper.indexOf("FEDEX") !== -1;
        var isUPS = carrierUpper.indexOf("UPS") !== -1;

        // Allow only FedEx + UPS family
        if (isFedEx || isUPS) {
          return true;
        }

        return false;
      }

      // 🏬 Warehouse origin rules
      return true;
    });

    console.log(
      "FILTERED ORIGIN:",
      originKey,
      "dropShip =",
      isDropShip,
      "→",
      filtered.length,
      "rates"
    );

    originObj._filteredRates = filtered;

    return filtered;
  }

  function applyAccessorialDelta(rates) {
    var baseRates = state.cache.baseRates || [];
    if (!baseRates.length) return;

    rates.forEach(function (rate) {
      var base = baseRates.find(function (b) {
        return String(b.shipCode) === String(rate.shipCode);
      });

      if (!base) return;

      var delta = Number(rate.cost || 0) - Number(base.cost || 0);

      rate.accessorialDelta = delta > 0.01 ? +delta.toFixed(2) : 0;
    });
  }

  function hasAnyAccessorials(accessorials) {
    if (!accessorials) return false;

    return Object.keys(accessorials).some(function (k) {
      return accessorials[k] === true;
    });
  }

  function normalizeCarrierKey(rate) {
    return String(rate.carrierCode || rate.carrier || rate.carrierName || "")
      .toUpperCase()
      .replace(/\s+/g, "_")
      .replace(/[^A-Z0-9_]/g, "");
  }

  function getAllowedAccessorialsForCarrier(rate, matrix) {
    if (!rate || !matrix || !matrix.carriers) return null;

    var carrierKey = String(
      rate.carrierCode || rate.carrier || rate.carrierName || ""
    )
      .toUpperCase()
      .replace(/\s+/g, "_");

    var rules = matrix.carriers[carrierKey];

    if (!rules) {
      console.warn(
        "[Pacejet] No accessorial matrix for carrier:",
        carrierKey,
        "→ allowing all accessorials"
      );
      return null; // ← means "no restrictions"
    }

    return rules;
  }

  function deriveAccessorialAvailabilityByCarrier(rates) {
    if (!Array.isArray(rates) || !rates.length) return null;

    var matrix = AccessorialMatrix && AccessorialMatrix.carriers;
    if (!matrix) return null;

    var finalAllowed = null;
    var hasAnyRule = false;

    rates.forEach(function (rate) {
      var carriers = extractCarrierSet(rate);

      carriers.forEach(function (carrierLabel) {
        var key = String(carrierLabel || "")
          .toUpperCase()
          .replace(/\s+/g, "_")
          .replace(/[^A-Z0-9_]/g, "");

        var carrierRules = matrix[key];

        if (!carrierRules) return;

        hasAnyRule = true;

        if (finalAllowed === null) {
          finalAllowed = Object.assign({}, carrierRules);
        } else {
          Object.keys(finalAllowed).forEach(function (acc) {
            if (!carrierRules[acc]) {
              finalAllowed[acc] = false;
            }
          });
        }
      });
    });

    if (!hasAnyRule) {
      console.warn(
        "[Pacejet] No carriers have accessorial rules → allowing all"
      );
      return null; // ← means NO restrictions
    }

    return finalAllowed;
  }

  function getTotalShipmentWeight(snapshot) {
    var s = snapshot || getLastSnapshot() || {};
    var items = s.items || [];
    var total = 0;

    for (var i = 0; i < items.length; i += 1) {
      var it = items[i] || {};
      var w = num(it.weight);
      var q = num(it.quantity) || 1;
      total += w * q;
    }

    return total;
  }

  function normalizeCarrierFamily(rate) {
    var carrier = String(
      rate.carrierCode || rate.carrier || rate.carrierName || ""
    ).toUpperCase();

    var service = String(rate.serviceName || rate.service || "").toUpperCase();

    // FedEx Freight detection (carrier name or service name)
    if (
      (carrier.indexOf("FEDEX") !== -1 && carrier.indexOf("FREIGHT") !== -1) ||
      (carrier.indexOf("FEDEX") !== -1 &&
        (service.indexOf("FREIGHT PRIORITY") !== -1 ||
          service.indexOf("FREIGHT ECONOMY") !== -1 ||
          service.indexOf("FEDEX FREIGHT") !== -1))
    ) {
      return "FEDEX_FREIGHT";
    }

    if (carrier.indexOf("FEDEX") !== -1) return "FEDEX";
    if (carrier.indexOf("UPS") !== -1) return "UPS";

    // fallback: cleaned carrier key
    return String(carrier)
      .replace(/\s+/g, "_")
      .replace(/[^A-Z0-9_]/g, "");
  }

  function normalizeCarrierLabel(name) {
    name = String(name || "").toUpperCase();

    if (name.includes("FEDEX") && name.includes("FREIGHT"))
      return "FedEx Freight";
    if (name.includes("FEDEX")) return "FedEx";
    if (name.includes("UPS")) return "UPS";
    if (name.includes("SAIA")) return "SAIA";
    if (name.includes("XPO")) return "XPO";

    return name
      .replace(/[^A-Z ]/g, "")
      .trim()
      .split(" ")[0];
  }

  function extractCarrierSet(rate) {
    var set = {};

    (rate.origins || []).forEach(function (o) {
      var c = normalizeCarrierLabel(
        o.carrier || rate.carrierName || rate.carrier
      );
      if (c) set[c] = true;
    });

    if (rate._modeBreakdown) {
      if (rate._modeBreakdown.parcel) {
        set[
          normalizeCarrierLabel(
            rate._modeBreakdown.parcel.carrierName ||
              rate._modeBreakdown.parcel.carrier
          )
        ] = true;
      }
      if (rate._modeBreakdown.ltl) {
        set[
          normalizeCarrierLabel(
            rate._modeBreakdown.ltl.carrierName ||
              rate._modeBreakdown.ltl.carrier
          )
        ] = true;
      }
    }

    return Object.keys(set);
  }

  function buildSmartCarrierTag(rate) {
    var carriers = extractCarrierSet(rate);
    var origins = rate.origins || [];

    if (!carriers.length) return "";

    var carrierLabel = carriers.join(" + ");

    // Multi-carrier + multi-origin
    if (carriers.length > 1 && origins.length > 1) {
      return carrierLabel + " • Consolidated shipment";
    }

    // Multi-carrier only
    if (carriers.length > 1) {
      return carrierLabel + " • Multi-carrier";
    }

    // Single carrier + multi-origin
    if (origins.length > 1) {
      return carrierLabel + " • Ships from " + origins.length + " locations";
    }

    return carrierLabel + " • Single shipment";
  }

  function applyDropShipSuppression(rates) {
    if (!Array.isArray(rates) || !rates.length) return rates;

    state.flags.dropShipEnforced = false;

    var matrix = AccessorialMatrix || {};
    var rule = matrix.dropShipRules || {};

    var allowed = Array.isArray(rule.allowedCarriers)
      ? rule.allowedCarriers
      : ["UPS", "FEDEX", "FEDEX_FREIGHT"];

    function isDropShipOnly(rate) {
      var origins = rate.origins || [];
      if (!origins.length) return false;

      return origins.every(function (o) {
        return o && o.dropShip === true;
      });
    }

    // Only enforce if at least one dropShip-only shipment exists
    var hasDropShipOnly = rates.some(isDropShipOnly);

    if (!hasDropShipOnly) {
      return rates;
    }

    var allowedSet = {};
    allowed.forEach(function (k) {
      allowedSet[String(k || "").toUpperCase()] = true;
    });

    var kept = [];
    var suppressed = [];

    rates.forEach(function (rate) {
      // 🚨 If NOT pure dropShip → always keep
      if (!isDropShipOnly(rate)) {
        kept.push(rate);
        return;
      }

      var fam = normalizeCarrierFamily(rate);

      if (allowedSet[fam]) {
        kept.push(rate);
      } else {
        suppressed.push({
          carrier: rate.carrierName || rate.carrier,
          service: rate.serviceName || rate.service,
          family: fam,
          shipCode: rate.shipCode,
          origins: (rate.origins || []).map(function (o) {
            return (o.dropShip ? "DS" : "LOC") + ":" + o.originKey;
          })
        });

        console.warn(
          "[Pacejet][Dropship] Suppressed carrier:",
          fam,
          rate.carrierName || rate.carrier,
          "|",
          rate.serviceName || rate.service
        );
      }
    });

    if (!kept.length) {
      console.error(
        "[Pacejet][Dropship] All carriers suppressed — refusing fallback",
        suppressed
      );
      return [];
    }

    state.flags.dropShipEnforced = true;

    return kept;
  }

  function applyShipmentSuppression(rates) {
    if (!Array.isArray(rates) || !rates.length) return rates;

    var matrix = AccessorialMatrix || {};
    var rules = matrix.suppressionRules || [];

    if (!rules.length) return rates;

    return rates.filter(function (rate) {
      var carrierKey = normalizeCarrierKey(rate);
      var origins = rate.origins || [];

      for (var i = 0; i < origins.length; i++) {
        var origin = origins[i];
        var originState = origin.state || origin.originState;

        if (!originState) continue;

        for (var r = 0; r < rules.length; r++) {
          var rule = rules[r];

          if (
            rule.originState === originState &&
            Array.isArray(rule.suppressCarriers) &&
            rule.suppressCarriers.indexOf(carrierKey) !== -1
          ) {
            console.warn(
              "[Pacejet] Carrier suppressed",
              carrierKey,
              "from",
              originState
            );
            return false;
          }
        }
      }

      return true;
    });
  }

  // function applyFreightMarkup(rate, rules) {
  //   if (!rate || !Array.isArray(rate.origins)) return rate;

  //   var baseFreight = 0;
  //   var totalFuel = 0;
  //   var totalFees = 0;
  //   var shipmentMode = String(rate.mode || rate.shipMode || "")
  //     .toUpperCase()
  //     .trim();

  //   rate.origins.forEach(function (origin) {
  //     var raw = origin && origin.raw ? origin.raw : {};

  //     var fuel = num(
  //       origin.fuelSurcharge ||
  //         origin.fuel ||
  //         raw.fuelSurcharge ||
  //         raw.fuel ||
  //         0
  //     );

  //     var fees = num(
  //       origin.totalServiceFees ||
  //         origin.serviceFees ||
  //         raw.totalServiceFees ||
  //         raw.serviceFees ||
  //         0
  //     );

  //     var freight = num(
  //       origin.baseFreight ||
  //         origin.consignorFreight ||
  //         origin.freight ||
  //         raw.consignorFreight ||
  //         raw.totalFreight ||
  //         raw.listFreight ||
  //         0
  //     );

  //     if (!freight) {
  //       var originTotal = num(origin.cost || raw.totalCost || 0);
  //       if (originTotal > 0) {
  //         freight = Math.max(originTotal - fuel - fees, 0);
  //       }
  //     }

  //     baseFreight += freight;
  //     totalFuel += fuel;
  //     totalFees += fees;
  //   });

  //   if (
  //     !shipmentMode ||
  //     (shipmentMode !== "LTL" && shipmentMode !== "PARCEL")
  //   ) {
  //     shipmentMode =
  //       String(rate.serviceName || rate.service || "")
  //         .toUpperCase()
  //         .indexOf("FREIGHT") !== -1
  //         ? "LTL"
  //         : "PARCEL";
  //   }

  //   var pacejetTotal = num(rate.cost || 0);

  //   rate.baseCost = +pacejetTotal.toFixed(2);
  //   rate.baseFreight = +baseFreight.toFixed(2);
  //   rate.totalFuel = +totalFuel.toFixed(2);
  //   rate.totalFees = +totalFees.toFixed(2);

  //   rate.markupPercent = 0;
  //   rate.markupMode = shipmentMode;
  //   rate.markupAmount = 0;

  //   // final customer price
  //   rate.finalCost = +pacejetTotal.toFixed(2);

  //   return rate;
  // }

  function applyFreightMarkup(rate, rules) {
    var baseCost = num(
      rate.shipperFreight || rate.baseFreight || rate.cost || 0
    );
    var originWithRawMode = (rate.origins || []).find(function (origin) {
      return (
        origin && origin.raw && (origin.raw.shipMode || origin.raw.rateSystem)
      );
    });
    var originRaw = originWithRawMode && originWithRawMode.raw;
    var rawMode = String(
      (rate.raw && (rate.raw.shipMode || rate.raw.rateSystem)) ||
        (originRaw && (originRaw.shipMode || originRaw.rateSystem)) ||
        rate.mode ||
        rate.shipMode ||
        ""
    )
      .toUpperCase()
      .trim();
    var shipmentMode = rawMode;
    var rateOrigins = rate.origins || [];
    var originState = "";
    var isDropShip = false;
    var markupPercent = 0;
    var matchedRule = null;

    if (
      !shipmentMode ||
      (shipmentMode !== "LTL" && shipmentMode !== "PARCEL")
    ) {
      shipmentMode =
        String(rate.serviceName || rate.service || "")
          .toUpperCase()
          .indexOf("FREIGHT") !== -1
          ? "LTL"
          : "PARCEL";
    }

    if (rateOrigins.length) {
      originState = String(
        rateOrigins[0].state ||
          (rateOrigins[0].Origin &&
            rateOrigins[0].Origin.StateOrProvinceCode) ||
          ""
      )
        .toUpperCase()
        .trim();

      isDropShip = rateOrigins.some(function (origin) {
        return origin && origin.dropShip === true;
      });
    }

    if (!originState) {
      originState = String(
        (Config && Config.origin && Config.origin.state) || ""
      )
        .toUpperCase()
        .trim();
    }

    if (!isDropShip) {
      var snapshot = getLastSnapshot() || {};
      isDropShip = (snapshot.items || []).some(function (item) {
        return item && item.dropShip === true;
      });
    }

    (rules || []).some(function (rule) {
      if (!rule) return false;
      if (rule.mode && String(rule.mode).toUpperCase() !== shipmentMode) {
        return false;
      }
      if (rule.dropShip) {
        if (!isDropShip) return false;
      } else if (
        String(rule.state || "")
          .toUpperCase()
          .trim() !== originState
      ) {
        return false;
      }
      if (rule.heavyOnly || rule.lightOnly) {
        return false;
      }

      matchedRule = rule;
      return true;
    });

    markupPercent = num(matchedRule && matchedRule.percent);

    rate.baseCost = +baseCost.toFixed(2);
    rate.finalCost = +(baseCost * (1 + markupPercent / 100)).toFixed(2);
    rate.markupPercent = markupPercent;
    rate.markupAmount = +(rate.finalCost - rate.baseCost).toFixed(2);
    rate.markupMode = matchedRule
      ? matchedRule.dropShip
        ? "DROP_SHIP"
        : shipmentMode
      : shipmentMode || "PACEJET";

    return rate;
  }

  // ---------- builds shipping snapshot from LiveOrder ----------
  function buildShippingSnapshot(order) {
    if (!order) return null;

    try {
      var shipId = order.get("shipaddress");
      var addressesColl = order.get("addresses");

      var addrModel =
        addressesColl && addressesColl.get && shipId
          ? addressesColl.get(shipId)
          : null;

      var addr = addrModel && addrModel.toJSON ? addrModel.toJSON() : addrModel;

      if (!addr) {
        return null;
      }

      var name =
        (addr.addressee || "").trim() ||
        ((addr.firstname || "") + " " + (addr.lastname || "")).trim();

      return {
        address: {
          company: addr.company || "",
          name: name || "",
          phone: addr.phone || "",
          email: addr.email || "",
          addr1: addr.addr1 || addr.address1 || "",
          addr2: addr.addr2 || addr.address2 || "",
          city: addr.city || "",
          state: addr.state || addr.statecode || "",
          postal: addr.zip || addr.postalcode || "",
          country: addr.country || "US"
        }
      };
    } catch (_e) {
      return null;
    }
  }

  // builds: items: [{weight, length, width, height, quantity, commodityName, packageType, ...}]
  function asBool(v) {
    if (v === true) return true;
    if (v === false) return false;
    if (v === "T") return true;
    if (v === "F") return false;
    var s = String(v || "")
      .toLowerCase()
      .trim();
    return s === "true" || s === "yes" || s === "1";
  }

  function extractId(v) {
    if (v == null) return "";
    if (typeof v === "object") {
      if (v.internalid != null) return String(v.internalid).trim();
      if (v.id != null) return String(v.id).trim();
      if (v.value != null) return String(v.value).trim();
    }
    return String(v).trim();
  }

  function getModelFieldValue(model, fieldIds) {
    if (!model || !model.get || !fieldIds || !fieldIds.length) return void 0;

    for (var i = 0; i < fieldIds.length; i++) {
      var value = model.get(fieldIds[i]);
      if (value !== void 0 && value !== null && value !== "") {
        return value;
      }
    }

    return void 0;
  }

  function getCustomFieldValue(raw, fieldIds) {
    if (!raw || !fieldIds || !fieldIds.length) return void 0;

    var lists = [
      raw.customfields,
      raw.customFields,
      raw.itemoptions_detail && raw.itemoptions_detail.fields,
      raw.itemoptions && raw.itemoptions.fields
    ];

    for (var l = 0; l < lists.length; l++) {
      var list = lists[l];
      if (!Array.isArray(list)) continue;

      for (var i = 0; i < list.length; i++) {
        var field = list[i] || {};
        var fieldId = field.id || field.name || field.fieldid || field.fieldId;
        if (!fieldId) continue;

        for (var j = 0; j < fieldIds.length; j++) {
          if (String(fieldId) === String(fieldIds[j])) {
            return field.value;
          }
        }
      }
    }

    return void 0;
  }

  function findFieldValueInObject(raw, fieldIds, depth, seen) {
    if (!raw || !fieldIds || !fieldIds.length) return void 0;
    if (depth > 4) return void 0;

    seen = seen || [];
    if (seen.indexOf(raw) !== -1) return void 0;
    seen.push(raw);

    var direct = getCustomFieldValue(raw, fieldIds);
    if (direct !== void 0 && direct !== null && direct !== "") {
      return direct;
    }

    for (var i = 0; i < fieldIds.length; i++) {
      var key = fieldIds[i];
      if (
        Object.prototype.hasOwnProperty.call(raw, key) &&
        raw[key] !== void 0 &&
        raw[key] !== null &&
        raw[key] !== ""
      ) {
        return raw[key];
      }
    }

    var keys = Object.keys(raw);
    for (var k = 0; k < keys.length; k++) {
      var child = raw[keys[k]];
      if (!child || typeof child !== "object") continue;

      var nested = findFieldValueInObject(child, fieldIds, depth + 1, seen);
      if (nested !== void 0 && nested !== null && nested !== "") {
        return nested;
      }
    }

    return void 0;
  }

  function getAnyFieldValue(model, fieldIds) {
    var direct = getModelFieldValue(model, fieldIds);
    if (direct !== void 0 && direct !== null && direct !== "") {
      return direct;
    }

    if (!model) return void 0;

    var raw = (model.toJSON && model.toJSON()) || model.attributes || model;

    return findFieldValueInObject(raw, fieldIds, 0, []);
  }

  // builds: items: [{weight, length, width, height, quantity, originKey, dropShip, ...}]
  function buildItemsSnapshot(order) {
    if (!order || !order.get) return [];

    var out = [];
    var lines = order.get("lines");
    if (!lines || !lines.each) return out;

    lines.each(function (line) {
      var item = line.get("item");
      if (!item) return;

      var qty = Number(line.get("quantity")) || 1;
      var weight = Number(item.get && item.get("weight")) || 0;

      var length =
        Number(item.get && item.get("custitem_pacejet_item_length")) || 0;
      var width =
        Number(item.get && item.get("custitem_pacejet_item_width")) || 0;
      var height =
        Number(item.get && item.get("custitem_pacejet_item_height")) || 0;

      // Dropship detection (try multiple sources)
      var dsRaw =
        getAnyFieldValue(item, [
          "isdropshipitem",
          "isdropship",
          "dropShip",
          "dropship",
          "dropshipitem",
          "isDropShip",
          "isdropship",
          "custitem_dropship",
          "custitem_isdropship"
        ]) ||
        getAnyFieldValue(line, [
          "isdropshipitem",
          "isdropship",
          "dropShip",
          "dropship",
          "dropshipitem",
          "isDropShip",
          "isdropship",
          "custcol_dropship",
          "custcol_isdropship"
        ]);

      var dropShip = asBool(dsRaw);

      // Location/vendor extraction (SuiteCommerce sometimes hides location on item)
      var locationId = extractId(
        (line.get && line.get("location")) ||
          (line.get && line.get("inventorylocation")) ||
          (item.get && item.get("location")) ||
          (item.get && item.get("inventorylocation"))
      );

      // Safety fallback so we never send empty location
      if (!locationId) {
        locationId =
          Config &&
          Config.locationMap &&
          Config.defaultLocationId &&
          Config.locationMap[Config.defaultLocationId]
            ? String(Config.defaultLocationId)
            : "";
      }
      console.log(
        "Extracted locationId:",
        locationId,
        "for item",
        item.get("itemid")
      );

      //vendor extraction (try multiple sources)
      var vendorId = extractId(item.get && item.get("vendor"));

      var originKey = "";

      if (dropShip && vendorId) {
        // vendor dropship
        originKey = "DS_" + vendorId;
      } else if (dropShip) {
        originKey = "DS_UNKNOWN";
      } else if (
        locationId &&
        Config.locationMap &&
        Config.locationMap[locationId]
      ) {
        // valid warehouse location
        originKey = "LOC_" + locationId;
      } else {
        // fallback to configured warehouse
        locationId = Config.defaultLocationId;
        originKey = "LOC_" + locationId;
      }

      out.push({
        sku: item.get && item.get("itemid"),
        internalid: item.get && item.get("internalid"),
        originKey: originKey,
        locationId: locationId,

        quantity: qty,
        weight: weight,

        length: length,
        width: width,
        height: height,

        dropShip: dropShip,
        itemtype: (item.get && item.get("itemtype")) || null
      });
    });

    return out;
  }

  // opts: { residential, autoPack, liftGate, insideDelivery, saturdayDelivery }
  function buildOptionsSnapshot(order) {
    var residential = false;

    try {
      var shipId = order.get("shipaddress");
      var addressesColl = order.get("addresses");
      var addrModel =
        addressesColl && addressesColl.get && shipId
          ? addressesColl.get(shipId)
          : null;
      var shipAddr =
        addrModel && addrModel.toJSON ? addrModel.toJSON() : addrModel;

      residential = !!(shipAddr && shipAddr.isresidential === "T");
    } catch (_e) {}

    var state = PacejetState.get();

    var selectedAccessorials =
      (state.selection && state.selection.accessorials) || {};

    var selectedRate = state.selection || {};

    var carrierKey = String(
      selectedRate.carrierCode ||
        selectedRate.carrier ||
        selectedRate.carrierName ||
        ""
    )
      .toUpperCase()
      .replace(/\s+/g, "_")
      .replace(/[^A-Z0-9_]/g, "");

    var matrix = AccessorialMatrix && AccessorialMatrix.carriers;
    var allowed = matrix ? matrix[carrierKey] : null;

    if (!allowed) {
      console.warn(
        "[Pacejet] No accessorial matrix for carrier:",
        carrierKey,
        "→ allowing all accessorials"
      );
    }

    var shipmentServices = [];

    Object.keys(selectedAccessorials).forEach(function (key) {
      if (!selectedAccessorials[key]) return;

      if (allowed && !allowed[key]) {
        console.warn("[Pacejet] Accessorial blocked:", key);
        return;
      }

      if (ACCESSORIAL_MAP[key]) {
        shipmentServices.push(ACCESSORIAL_MAP[key]);
      }
    });

    return {
      residential: residential,

      autoPack: true,

      // legacy flags (still useful for parcel)
      liftGate: !!selectedAccessorials.lift_gate,
      insideDelivery: !!selectedAccessorials.inside_delivery,

      shipmentServices: shipmentServices
    };
  }

  function hashCartSnapshot(shipping, items, opts) {
    try {
      return JSON.stringify({
        ship: shipping,
        items: items,
        opts: opts
      });
    } catch (_e) {
      return String(Date.now());
    }
  }

  // ---------- multi-mode merge helper (Parcel + LTL) ----------
  function mergeModeRates(modeResults) {
    if (!Array.isArray(modeResults) || !modeResults.length) {
      return [];
    }

    // If only one mode exists, return it directly.
    if (modeResults.length === 1) {
      return modeResults[0].rates || [];
    }

    var parcel = null;
    var ltl = null;

    modeResults.forEach(function (mr) {
      var m = String(mr.mode || "").toLowerCase();
      if (m === "parcel") parcel = mr;
      if (m === "ltl") ltl = mr;
    });

    // If both exist → combine
    if (parcel && ltl) {
      var parcelRates = parcel.rates || [];
      var ltlRates = ltl.rates || [];

      if (!parcelRates.length) return ltlRates;
      if (!ltlRates.length) return parcelRates;

      parcelRates.sort(function (a, b) {
        return (a.cost || 0) - (b.cost || 0);
      });

      var cheapestParcel = parcelRates[0];
      var parcelCost = Number(cheapestParcel.cost || 0);

      return ltlRates.map(function (r) {
        var copy = jQuery.extend(true, {}, r);
        copy.cost = Number(r.cost || 0) + parcelCost;
        return copy;
      });
    }

    // Fallback safety
    return modeResults.reduce(function (acc, mr) {
      return acc.concat(mr.rates || []);
    }, []);
  }

  // Applies:
  // Parcel: totalWeight <= 325 lbs AND dimensions <= carrier-specific max
  // LTL: totalWeight <= 19999 lbs AND maxDim <= 240 in (20 ft)
  // FTL: exceeds LTL limits (we don't return FTL, so we suppress LTL and log)
  function applyCarrierLimits(rates) {
    if (!Array.isArray(rates) || !rates.length) return rates;

    var limits = (Config && Config.carrierLimits) || {};
    var parcelLimits = limits.PARCEL || {};
    var ltlLimits = limits.LTL || {};
    var fallbackToOriginal = limits.fallbackToOriginalIfEmpty !== false;

    var snapshot = getLastSnapshot() || {};
    var items = snapshot.items || [];

    // Reset flag at start
    try {
      PacejetState.get().flags.truckloadRequired = false;
    } catch (e) {}

    var totalLinearInches = 0;
    var shipmentMaxDim = 0;

    items.forEach(function (it) {
      var qty = Number(it.quantity || 1);
      var length = Number(it.length || 0);

      totalLinearInches += length * qty;

      shipmentMaxDim = Math.max(
        shipmentMaxDim,
        Number(it.length || 0),
        Number(it.width || 0),
        Number(it.height || 0)
      );
    });

    var totalLinearFeet = totalLinearInches / 12;
    var shipmentWeight = getTotalShipmentWeight(snapshot);

    var exceedsTruckloadThreshold =
      shipmentWeight > 20000 || totalLinearFeet > 20;

    function detectMode(rate) {
      var mode = String(rate.mode || rate.shipMode || "").toUpperCase();
      if (mode === "PARCEL" || mode === "LTL") return mode;

      return "LTL";
    }

    var kept = [];
    var suppressed = [];

    rates.forEach(function (rate) {
      var mode = detectMode(rate);
      var carrier = normalizeCarrierKey(rate);
      var reason = null;

      if (mode === "PARCEL") {
        if (shipmentWeight > parcelLimits.maxWeight) {
          reason = "PARCEL_OVERWEIGHT";
        } else if (shipmentMaxDim > parcelLimits.maxDim) {
          reason = "PARCEL_OVERSIZE";
        }
      }

      if (mode === "LTL") {
        if (
          shipmentWeight > ltlLimits.maxWeight ||
          shipmentMaxDim > ltlLimits.maxDim
        ) {
          reason = "LTL_EXCEEDS_LIMITS";
        }
      }

      if (reason) {
        suppressed.push({ carrier, mode, reason });
        return;
      }

      rate._carrierMode = mode;
      rate.totalWeight = shipmentWeight;
      rate.maxDim = shipmentMaxDim;
      kept.push(rate);
    });

    if (!kept.length && exceedsTruckloadThreshold) {
      PacejetState.get().flags.truckloadRequired = true;
    }

    if (!kept.length) {
      return kept; // no fallback ever
    }

    return kept;
  }

  function normalizeBackendOriginKey(k) {
    // "32412-5008|Panama City|FL|US" -> "32412|PANAMA_CITY|FL|US"
    var parts = String(k || "").split("|");
    var zip = (parts[0] || "").split("-")[0].trim();
    var city = String(parts[1] || "")
      .toUpperCase()
      .replace(/\s+/g, "_")
      .trim();
    var st = String(parts[2] || "")
      .toUpperCase()
      .trim();
    var c = String(parts[3] || "")
      .toUpperCase()
      .trim();
    return [zip, city, st, c].join("|");
  }

  function normalizeOriginFromRate(o) {
    var zip = String(o.postal || o.zip || o.postalCode || "")
      .split("-")[0]
      .trim();

    var city = String(o.city || "")
      .toUpperCase()
      .replace(/\s+/g, "_")
      .trim();

    var st = String(o.state || o.originState || "")
      .toUpperCase()
      .trim();
    var c = String(o.country || o.countryCode || "US")
      .toUpperCase()
      .trim();

    return [zip, city, st, c].join("|");
  }

  function curateConsolidatedOptions(rates) {
    if (!Array.isArray(rates) || !rates.length) return rates;

    var groups = {};

    // Group by carrier combo
    rates.forEach(function (r) {
      var key = extractCarrierSet(r).sort().join("+");

      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    var curated = [];

    Object.keys(groups).forEach(function (key) {
      var group = groups[key];

      if (!group.length) return;

      // Sort by cost ascending
      group.sort(function (a, b) {
        return (a.cost || 0) - (b.cost || 0);
      });

      var cheapest = group[0];

      // Sort by transit ascending
      group.sort(function (a, b) {
        return (a.transitDays || 999) - (b.transitDays || 999);
      });

      var fastest = group[0];

      // Best value = lowest (cost / transitDays)
      var bestValue = group.reduce(function (best, r) {
        var score =
          r.transitDays && r.transitDays > 0
            ? r.cost / r.transitDays
            : Infinity;

        if (!best) return r;

        var bestScore =
          best.transitDays && best.transitDays > 0
            ? best.cost / best.transitDays
            : Infinity;

        return score < bestScore ? r : best;
      }, null);

      // Add unique picks
      var unique = {};
      [cheapest, fastest, bestValue].forEach(function (r) {
        if (!r) return;
        if (!unique[r.id]) {
          unique[r.id] = true;
          curated.push(r);
        }
      });
    });

    // Final sort by price
    curated.sort(function (a, b) {
      return (a.cost || 0) - (b.cost || 0);
    });

    return curated;
  }

  function fetchRates(order) {
    requestCounter += 1;
    var thisRequestId = requestCounter;
    state.cache._activeRequestId = thisRequestId;
    var shipping = buildShippingSnapshot(order);

    if (
      !shipping ||
      !shipping.address ||
      !shipping.address.addr1 ||
      !shipping.address.city ||
      !shipping.address.state
    ) {
      console.warn("Shipping address incomplete — skipping rate request");
      return jQuery.Deferred().resolve([]).promise();
    }

    var items = buildItemsSnapshot(order);
    if (!items.length) {
      return jQuery.Deferred().reject(new Error("Cart is empty")).promise();
    }

    var opts = buildOptionsSnapshot(order);
    opts.accessorials = (state.selection && state.selection.accessorials) || {};

    var cartSnapshot = {
      shipping: shipping.address || shipping,
      items: items.map(function (it) {
        return {
          internalid: it.internalid,
          sku: it.sku,
          itemtype: it.itemtype,
          quantity: it.quantity,
          weight: it.weight,
          length: it.length,
          width: it.width,
          height: it.height,
          isDropShip: !!it.dropShip,
          dropShip: !!it.dropShip,
          originKey: it.originKey || "",
          locationId: it.locationId || ""
        };
      })
    };

    state.cache.lastSnapshot = {
      shipping: shipping,
      items: items,
      opts: opts
    };

    var fullHash = hashCartSnapshot(shipping, items, opts);
    var baseHash = hashCartSnapshot(shipping, items, {
      residential: opts.residential,
      autoPack: opts.autoPack
    });

    if (
      state.cache.lastFullHash === fullHash &&
      Array.isArray(state.cache.lastRates) &&
      state.cache.lastRates.length
    ) {
      return jQuery.Deferred().resolve(state.cache.lastRates).promise();
    }

    if (state.cache.baseHash && state.cache.baseHash !== baseHash) {
      state.cache.baseRates = null;
    }

    var payloadOrPayloads = Payload.fromCart(order, shipping, opts);

    var payloads = Array.isArray(payloadOrPayloads)
      ? payloadOrPayloads
      : [{ mode: "Single", payload: payloadOrPayloads }];

    payloads = payloads.map(function (p) {
      if (p && p.payload) return p;
      return { mode: "Single", payload: p };
    });

    var outboundPayload = buildRawRateRequest(payloads, cartSnapshot);

    console.log("[Pacejet] Outbound rate payload:", outboundPayload);

    return requestRates(outboundPayload).then(function (serviceResponse) {
      if (state.cache._activeRequestId !== thisRequestId) {
        console.warn("[Pacejet] Ignoring stale rate response.");
        return state.cache.lastRates || [];
      }

      var args = normalizeModeResponses(serviceResponse, payloads);

      var modeResults = [];

      for (var i = 0; i < args.length; i++) {
        var rr = args[i] || {};
        var mode = rr.mode || (payloads[i] && payloads[i].mode) || "Single";
        var resp = rr.resp || rr;
        Object.keys(resp.origins || {}).forEach(function (k) {
          var originBlock = resp.origins[k];

          // Map raw → UI rates
          var mapped = Mapper.mapRates(originBlock);

          // Decorate
          mapped = RateMapping.decorateRates(mapped);

          originBlock._mappedRates = mapped;

          // Phase 1 Filtering (per origin)
          var filtered = filterRatesPerOrigin(k, originBlock);

          originBlock._filteredRates = filtered;
        });

        var rates = Mapper.aggregateMultiOriginRates(resp);

        if (resp && resp.origins) {
          var suiteletDropshipByKey = {};

          Object.keys(resp.origins).forEach(function (k) {
            var nk = normalizeBackendOriginKey(k);
            suiteletDropshipByKey[nk] = !!(
              resp.origins[k] && resp.origins[k].dropShip
            );
          });

          rates.forEach(function (rate) {
            rate.origins = rate.origins || [];

            rate.origins.forEach(function (o) {
              var direct = resp.origins[o.originKey];
              if (direct && direct.dropShip === true) {
                o.dropShip = true;
                return;
              }

              var rk = normalizeOriginFromRate(o);
              if (suiteletDropshipByKey[rk] === true) {
                o.dropShip = true;
              }
            });
          });
        }

        rates = applyDropShipSuppression(rates);
        rates = applyCarrierLimits(rates);
        rates = applyShipmentSuppression(rates);

        state.cache.lastRawRates = rates.slice();

        modeResults.push({ mode: mode, rates: rates });
      }

      // var merged = mergeModeRates(modeResults);
      var merged = modeResults.reduce(function (acc, mr) {
        return acc.concat(mr.rates || []);
      }, []);

      merged = applyCarrierLimits(merged);
      merged = applyShipmentSuppression(merged);
      merged = RateMapping.decorateRates(merged);
      console.log("AFTER DECORATE:", merged);

      var selectedAccessorials =
        (state.selection && state.selection.accessorials) || {};

      if (!hasAnyAccessorials(selectedAccessorials)) {
        state.cache.baseHash = baseHash;
        state.cache.baseRates = merged.map(function (r) {
          return {
            shipCode: String(r.shipCode),
            cost: Number(r.cost || 0)
          };
        });
      }

      state.allowedAccessorials =
        deriveAccessorialAvailabilityByCarrier(merged);

      merged.forEach(function (rate) {
        applyFreightMarkup(rate, FreightMarkup);

        // IMPORTANT: the cost used everywhere must be the marked-up cost
        if (rate.finalCost && rate.finalCost > 0) {
          rate.cost = rate.finalCost;
        }
      });

      if (console && typeof console.table === "function") {
        console.table(
          merged.map(function (rate) {
            return {
              shipCode: String(rate.shipCode || ""),
              carrier: rate.carrierName || rate.carrier || "",
              service: rate.serviceName || rate.service || "",
              baseCost: Number(rate.baseCost || 0),
              markupAmount: Number(rate.markupAmount || 0),
              finalCost: Number(rate.finalCost || rate.cost || 0)
            };
          })
        );
      }

      applyAccessorialDelta(merged);

      // TODO: We will reactivate once we fix the rates and the tax issues being worked on right now.
      //merged = curateConsolidatedOptions(merged);

      merged.forEach(function (rate) {
        var smartTag = buildSmartCarrierTag(rate);
        var recTag = String(rate._recommendationTag || "").trim();

        if (recTag && smartTag) rate.tag = recTag + " | " + smartTag;
        else rate.tag = recTag || smartTag;
      });

      if (!merged || !merged.length) {
        console.warn(
          "[Pacejet] Final merged empty — preserving previous rates."
        );
        return state.cache.lastRates || [];
      }

      state.cache.lastFullHash = fullHash;
      state.cache.lastRates = merged;

      return merged;
    });
  }

  function applyRateToCart(payload) {
    return requestService("POST", buildApplyRatePayload(payload));
  }

  return {
    fetchRates: fetchRates,
    applyRateToCart: applyRateToCart,
    getAllowedAccessorialsForCarrier: getAllowedAccessorialsForCarrier,

    applyCarrierLimits: applyCarrierLimits,
    applyDropShipSuppression: applyDropShipSuppression,
    applyShipmentSuppression: applyShipmentSuppression
  };
});
