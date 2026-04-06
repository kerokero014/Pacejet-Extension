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
  var NONE_ACCESSORIAL_ID = "none_additional_fees_may_app";
  var HAZMAT_PARCEL_ID = "hazmat_parcel";
  var DANGEROUS_GOODS_ID = "dangerous_goods";
  var ACCESSORIAL_MAP = {
    driver_call: "DRIVER_CALL",
    job_site: "JOB_SITE",
    lift_gate: "LIFT_GATE",
    residential: "RESIDENTIAL",
    schedule_appt: "APPOINTMENT",
    self_storage: "SELF_STORAGE",
    school: "SCHOOL",
    inside_delivery: "INSIDE_DELIVERY",
    hazmat_parcel: "HAZMAT_PARCEL",
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
    return accessorials &&
      typeof accessorials === "object" &&
      !Array.isArray(accessorials)
      ? accessorials
      : {};
  }

  function cloneSelection(selection) {
    return jQuery.extend({}, normalizeAccessorialSelection(selection));
  }

  function buildSafeLiveOrderPayload(data) {
    var payload = data || {};

    return {
      shipmethod:
        payload.shipmethod === null || payload.shipmethod === undefined
          ? ""
          : String(payload.shipmethod),
      pacejetAmount: Number(payload.pacejetAmount || payload.amount || 0) || 0,
      carrier: payload.carrier ? String(payload.carrier) : "",
      service: payload.service ? String(payload.service) : "",
      transitDays:
        payload.transitDays === null || payload.transitDays === undefined
          ? ""
          : String(payload.transitDays),
      quoteJson: payload.quoteJson ? String(payload.quoteJson) : "",
      customfields: Array.isArray(payload.customfields)
        ? payload.customfields
        : []
    };
  }

  function buildApplyRatePayload(payload) {
    payload = payload || {};

    return buildSafeLiveOrderPayload({
      shipmethod: payload.shipmethod,
      pacejetAmount: payload.pacejetAmount,
      amount: payload.amount,
      carrier: payload.carrier,
      service: payload.service,
      transitDays: payload.transitDays,
      quoteJson: payload.quoteJson,
      customfields: payload.customfields || payload.customFields
    });
  }

  function buildRawRateRequest(payloads, cartSnapshot) {
    var firstEntry =
      Array.isArray(payloads) && payloads.length ? payloads[0] || {} : {};
    var rawPayload = jQuery.extend(true, {}, firstEntry.payload || firstEntry);

    delete rawPayload.Origin; // origins are sent in the "origins" array, so we need to remove any top-level origin data to avoid confusion

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
      if (k === NONE_ACCESSORIAL_ID) {
        return false;
      }

      return accessorials[k] === true;
    });
  }

  function removeForcedAccessorials(accessorials) {
    var selected = cloneSelection(accessorials);
    var forced = cloneSelection(
      state && state.selection && state.selection.forcedAccessorials
    );

    Object.keys(forced).forEach(function (key) {
      if (forced[key]) {
        delete selected[key];
      }
    });

    return selected;
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

  function normalizeCarrierLabel(name, serviceName) {
    name = String(name || "").toUpperCase();
    serviceName = String(serviceName || "").toUpperCase();

    if (
      (name.includes("FEDEX") && name.includes("FREIGHT")) ||
      (name.includes("FEDEX") &&
        (serviceName.includes("FREIGHT PRIORITY") ||
          serviceName.includes("FREIGHT ECONOMY") ||
          serviceName.includes("FEDEX FREIGHT")))
    )
      return "FEDEX_FREIGHT";

    if (name.includes("FEDEX")) return "FEDEX";
    if (name.includes("UPS")) return "UPS";
    if (name.includes("SAIA")) return "SAIA";
    if (name.includes("XPO")) return "XPO";
    if (name.includes("ESTES")) return "ESTES";
    if (name.includes("AAA") || name.includes("COOPER")) return "AAA_COOPER";
    if (name.includes("OLD DOMINION") || name.includes("ODFL")) return "ODFL";
    if (name.includes("R&L") || name.includes("RL")) return "RL_CARRIERS";

    return name
      .replace(/[^A-Z ]/g, "")
      .trim()
      .replace(/\s+/g, "_");
  }

  function getMaxDimension(item) {
    return Math.max(
      num(item && item.length),
      num(item && item.width),
      num(item && item.height)
    );
  }

  function isPalletPackageType(packageType) {
    return /PALLET/i.test(String(packageType || ""));
  }

  function isLtlStyleItem(item) {
    return (
      isPalletPackageType(item && item.packageType) ||
      num(item && item.weight) >= 150 ||
      getMaxDimension(item) >= 48
    );
  }

  function deriveForcedAccessorials(items) {
    var forced = {};

    (items || []).forEach(function (item) {
      if (!item || !item.isHazmat) {
        return;
      }

      if (isLtlStyleItem(item)) {
        forced[DANGEROUS_GOODS_ID] = true;
      } else {
        forced[HAZMAT_PARCEL_ID] = true;
      }
    });

    return forced;
  }

  function syncForcedAccessorialsFromOrder(order) {
    var items = buildItemsSnapshot(order);

    if (PacejetState && PacejetState.setForcedAccessorials) {
      PacejetState.setForcedAccessorials(deriveForcedAccessorials(items));
    }

    return items;
  }

  function extractCarrierSet(rate) {
    var set = {};
    var defaultCarrier = rate.carrierName || rate.carrier || "";
    var defaultService = rate.serviceName || rate.service || "";

    (rate.origins || []).forEach(function (o) {
      var c = normalizeCarrierLabel(
        o.carrier || defaultCarrier,
        o.service || defaultService
      );
      if (c) set[c] = true;
    });

    if (rate._modeBreakdown) {
      if (rate._modeBreakdown.parcel) {
        set[
          normalizeCarrierLabel(
            rate._modeBreakdown.parcel.carrierName ||
              rate._modeBreakdown.parcel.carrier,
            rate._modeBreakdown.parcel.serviceName ||
              rate._modeBreakdown.parcel.service
          )
        ] = true;
      }
      if (rate._modeBreakdown.ltl) {
        set[
          normalizeCarrierLabel(
            rate._modeBreakdown.ltl.carrierName ||
              rate._modeBreakdown.ltl.carrier,
            rate._modeBreakdown.ltl.serviceName ||
              rate._modeBreakdown.ltl.service
          )
        ] = true;
      }
    }

    if (!Object.keys(set).length) {
      var primary = normalizeCarrierLabel(defaultCarrier, defaultService);
      if (primary) set[primary] = true;
    }

    return Object.keys(set);
  }

  function filterRatesBySelectedAccessorials(
    rates,
    accessorialSelection,
    source
  ) {
    if (!Array.isArray(rates) || !rates.length) return rates;

    var selected = cloneSelection(
      accessorialSelection ||
        (state && state.selection && state.selection.accessorials)
    );
    var filterableSelection = removeForcedAccessorials(selected);
    var filterSource = source || "live";

    if (!hasAnyAccessorials(filterableSelection)) {
      console.log("[Pacejet] No accessorial filtering applied");
      return rates;
    }

    var matrix = AccessorialMatrix && AccessorialMatrix.carriers;
    if (!matrix) return rates;

    var filtered = rates.filter(function (rate) {
      var carrierSet = extractCarrierSet(rate);
      var acc;
      var idx;

      console.log(
        "[Pacejet] checking rate carriers",
        rate.carrierName || rate.carrier || "",
        "=>",
        carrierSet
      );

      if (!carrierSet.length) {
        console.warn(
          "[Pacejet] No normalized carrier match for rate:",
          rate.carrierName || rate.carrier || "",
          "=> suppressing"
        );
        return false;
      }

      for (idx = 0; idx < carrierSet.length; idx += 1) {
        var carrierKey = carrierSet[idx];
        var rules = matrix[carrierKey];

        console.log(
          "[Pacejet] carrier normalization",
          rate.carrierName || rate.carrier || "",
          "/",
          rate.serviceName || rate.service || "",
          "=>",
          carrierKey,
          rules ? "matched" : "unmapped"
        );

        if (!rules) {
          console.warn(
            "[Pacejet] No matrix rules for carrier:",
            carrierKey,
            "=> suppressing"
          );
          return false;
        }

        for (acc in filterableSelection) {
          if (!Object.prototype.hasOwnProperty.call(filterableSelection, acc))
            continue;
          if (acc === NONE_ACCESSORIAL_ID) continue;
          if (!filterableSelection[acc]) continue;

          if (rules[acc] !== true) {
            console.log(
              "[Pacejet] Removing rate:",
              carrierKey,
              "=> does not support",
              acc
            );
            return false;
          }
        }
      }

      return true;
    });

    console.log(
      "[Pacejet] Accessorial filter result",
      rates.map(function (r) {
        return r.carrierName || r.carrier;
      }),
      "=>",
      filtered.map(function (r) {
        return r.carrierName || r.carrier;
      })
    );

    return filtered;
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
      // If NOT pure dropShip → always keep
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

  function applyFreightMarkup(rate, rules) {
    var baseCost = num(
      rate.customerFreight ||
        rate.cost ||
        rate.shipperFreight ||
        rate.baseFreight ||
        0
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

  function toArray(value) {
    if (Array.isArray(value)) return value;
    if (value === null || value === void 0 || value === "") return [];
    return [value];
  }

  function uniqueIds(ids) {
    var seen = {};

    return toArray(ids)
      .filter(function (id) {
        var key = extractId(id);
        if (!key || seen[key]) {
          return false;
        }

        seen[key] = true;
        return true;
      })
      .map(extractId);
  }

  function getRawModel(model) {
    if (!model) return {};

    return (model.toJSON && model.toJSON()) || model.attributes || model || {};
  }

  function getLocationEntries(rawItem) {
    var candidates = [
      rawItem &&
        rawItem.quantityavailable_detail &&
        rawItem.quantityavailable_detail.locations,
      rawItem &&
        rawItem.quantityavailable_detail &&
        rawItem.quantityavailable_detail.items,
      rawItem && rawItem.locations,
      rawItem && rawItem.location_detail,
      rawItem && rawItem.inventorydetail && rawItem.inventorydetail.locations,
      rawItem && rawItem.itemlocations_detail,
      rawItem && rawItem.itemlocations
    ];

    for (var i = 0; i < candidates.length; i++) {
      if (Array.isArray(candidates[i]) && candidates[i].length) {
        return candidates[i];
      }
    }

    return [];
  }

  function getLocationIdFromEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return "";
    }

    return extractId(
      entry.internalid ||
        entry.location ||
        entry.locationId ||
        entry.id ||
        entry.value ||
        entry.locationinternalid
    );
  }

  function getQuantityAvailableFromLocation(entry) {
    if (!entry || typeof entry !== "object") {
      return 0;
    }

    var candidates = [
      entry.quantityavailable,
      entry.quantityAvailable,
      entry.available,
      entry.qtyavailable,
      entry.qtyAvailable,
      entry.locationquantityavailable,
      entry.quantityonhand,
      entry.quantity
    ];

    for (var i = 0; i < candidates.length; i++) {
      var value = Number(candidates[i]);
      if (isFinite(value)) {
        return value;
      }
    }

    return 0;
  }

  function buildAvailabilitySnapshot(item, qty) {
    var rawItem = getRawModel(item);
    var locations = getLocationEntries(rawItem);
    var requestedQty = Number(qty) || 1;
    var availableLocationIds = [];
    var fulfillableLocationIds = [];
    var warehouseAvailability = {};

    locations.forEach(function (entry) {
      var locationId = getLocationIdFromEntry(entry);
      var quantityAvailable = getQuantityAvailableFromLocation(entry);

      // More tolerant than before:
      // mark as available if there is any stock, not only full requested qty.
      var isAvailable = !!locationId && quantityAvailable > 0;
      var isFulfillable = !!locationId && quantityAvailable >= requestedQty;

      if (!locationId) {
        return;
      }

      warehouseAvailability[locationId] = isAvailable;

      if (isAvailable) {
        availableLocationIds.push(locationId);
      }

      if (isFulfillable) {
        fulfillableLocationIds.push(locationId);
      }
    });

    availableLocationIds = uniqueIds(availableLocationIds);
    fulfillableLocationIds = uniqueIds(fulfillableLocationIds);

    return {
      availableLocationIds: availableLocationIds,
      fulfillableLocationIds: fulfillableLocationIds,

      eligible3plLocationIds: fulfillableLocationIds.filter(
        function (locationId) {
          return locationId !== "62";
        }
      ),
      warehouseAvailability: warehouseAvailability,
      availableInSpringville: fulfillableLocationIds.indexOf("62") !== -1,
      availableInDelaware: fulfillableLocationIds.indexOf("63") !== -1,
      availableInGeorgia: fulfillableLocationIds.indexOf("64") !== -1,
      availabilitySource: locations.length ? "line-location-detail" : ""
    };
  }

  function inferPackagingType(item, line, packageType) {
    var rawItem = getRawModel(item);
    var rawLine = getRawModel(line);
    var raw = [
      packageType,
      getAnyFieldValue(item, [
        "custitem_package_type",
        "custitem_packaging_type",
        "packagetype",
        "container"
      ]),
      rawItem.displayname,
      rawItem.storedisplayname2,
      rawItem.storedisplayname,
      rawItem.salesdescription,
      rawItem.description,
      rawLine.description,
      rawItem.itemid
    ]
      .join(" ")
      .toUpperCase();

    if (raw.indexOf("DRUM") !== -1) {
      return "DRUM";
    }

    if (raw.indexOf("PAIL") !== -1 || raw.indexOf(" PAILS") !== -1) {
      return "PAIL";
    }

    return "";
  }

  function summarizeOriginPlanningItems(items) {
    var summary = {
      itemsCount: Array.isArray(items) ? items.length : 0,
      itemsWithAvailability: 0,
      itemsMissingAvailability: 0,
      drums: 0,
      pails: 0
    };

    (items || []).forEach(function (item) {
      var availableLocationIds = uniqueIds(item && item.availableLocationIds);
      var packagingType = String(
        (item && (item.packagingType || item.packageType)) || ""
      ).toUpperCase();
      var qty = Number(item && item.quantity) || 1;

      if (availableLocationIds.length) {
        summary.itemsWithAvailability += 1;
      } else {
        summary.itemsMissingAvailability += 1;
      }

      if (packagingType === "DRUM") {
        summary.drums += qty;
      }

      if (packagingType === "PAIL") {
        summary.pails += qty;
      }
    });

    return summary;
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
      var packageType = String(
        (item.get && item.get("custitem_package_type")) || ""
      ).trim();
      var packagingType = inferPackagingType(item, line, packageType);
      var isHazmat = asBool(item.get && item.get("custitem13"));

      var rawItem = getRawModel(item);
      var availability = buildAvailabilitySnapshot(item, qty);

      console.log("[Pacejet] Availability snapshot", {
        sku: item.get && item.get("itemid"),
        internalid: item.get && item.get("internalid"),
        qty: qty,
        packageType: packageType,
        packagingType: packagingType,
        availability: availability,
        rawLocations:
          rawItem &&
          rawItem.quantityavailable_detail &&
          rawItem.quantityavailable_detail.locations
      });

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
        packageType: packageType,
        packagingType: packagingType || packageType || "",
        isHazmat: isHazmat,

        dropShip: dropShip,
        itemtype: (item.get && item.get("itemtype")) || null,
        description:
          getAnyFieldValue(item, ["displayname", "storedisplayname2"]) || "",
        availableLocationIds: availability.availableLocationIds,
        fulfillableLocationIds: availability.fulfillableLocationIds,
        eligible3plLocationIds: availability.eligible3plLocationIds,
        warehouseAvailability: availability.warehouseAvailability,
        availableInSpringville: availability.availableInSpringville,
        availableInGeorgia: availability.availableInGeorgia,
        availableInDelaware: availability.availableInDelaware,
        availabilitySource: availability.availabilitySource
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

    var items = syncForcedAccessorialsFromOrder(order);
    if (!items.length) {
      return jQuery.Deferred().reject(new Error("Cart is empty")).promise();
    }

    var selectedAccessorials = cloneSelection(
      state.selection && state.selection.accessorials
    );
    var opts = buildOptionsSnapshot(order);
    opts.accessorials = cloneSelection(selectedAccessorials);

    console.log(
      "[Pacejet] fetchRates using accessorials",
      JSON.stringify(selectedAccessorials)
    );

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
          packageType: it.packageType || "",
          packagingType: it.packagingType || "",
          description: it.description || "",
          isHazmat: !!it.isHazmat,
          isDropShip: !!it.dropShip,
          dropShip: !!it.dropShip,
          originKey: it.originKey || "",
          locationId: it.locationId || "",
          availableLocationIds: uniqueIds(it.availableLocationIds),
          fulfillableLocationIds: uniqueIds(it.fulfillableLocationIds),
          eligible3plLocationIds: uniqueIds(it.eligible3plLocationIds),
          warehouseAvailability: jQuery.extend(
            {},
            it.warehouseAvailability || {}
          ),
          availableInSpringville: !!it.availableInSpringville,
          availableInGeorgia: !!it.availableInGeorgia,
          availableInDelaware: !!it.availableInDelaware,
          availabilitySource: it.availabilitySource || ""
        };
      })
    };

    console.log(
      "[Pacejet] origin planning snapshot",
      summarizeOriginPlanningItems(cartSnapshot.items),
      cartSnapshot.items
    );

    state.cache.lastSnapshot = {
      shipping: shipping,
      items: items,
      opts: opts
    };
    state.cache.lastRequestedAccessorials =
      cloneSelection(selectedAccessorials);

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
      console.log("[Pacejet] Returning cached rates for hash match");
      return jQuery
        .Deferred()
        .resolve(
          filterRatesBySelectedAccessorials(
            state.cache.lastRates,
            selectedAccessorials,
            "full-hash-cache"
          )
        )
        .promise();
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

    return requestRates(outboundPayload).then(function (serviceResponse) {
      if (state.cache._activeRequestId !== thisRequestId) {
        console.warn(
          "[Pacejet] Ignoring stale rate response. Using filtered cache."
        );
        return filterRatesBySelectedAccessorials(
          state.cache.lastRates || [],
          selectedAccessorials,
          "stale-response-cache"
        );
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

      // TODO: We will reactivate once we fix the rates and the tax issues being worked on right now.

      // var merged = mergeModeRates(modeResults);
      var merged = modeResults.reduce(function (acc, mr) {
        return acc.concat(mr.rates || []);
      }, []);

      merged = applyCarrierLimits(merged);
      merged = applyShipmentSuppression(merged);
      merged = RateMapping.decorateRates(merged);

      merged = filterRatesBySelectedAccessorials(
        merged,
        selectedAccessorials,
        "merged-final"
      );

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

      var markupEnabled = !!(Config && Config.enableFreightMarkup);

      merged.forEach(function (rate) {
        applyFreightMarkup(rate, FreightMarkup);

        // Preserve raw Pacejet cost by default and only expose marked-up cost
        // when an environment explicitly enables freight markup.
        if (markupEnabled && rate.finalCost && rate.finalCost > 0) {
          rate.cost = rate.finalCost;
        }
      });

      applyAccessorialDelta(merged);

      // TODO: We will reactivate once we fix the rates and the tax issues being worked on right now.
      // merged = curateConsolidatedOptions(merged);

      merged.forEach(function (rate) {
        var smartTag = buildSmartCarrierTag(rate);
        var recTag = String(rate._recommendationTag || "").trim();

        if (recTag && smartTag) rate.tag = recTag + " | " + smartTag;
        else rate.tag = recTag || smartTag;
      });

      if (!merged || !merged.length) {
        console.warn(
          "[Pacejet] Final merged empty after filtering",
          JSON.stringify(selectedAccessorials)
        );
        state.cache.lastFullHash = fullHash;
        state.cache.lastRates = [];
        return [];
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
    syncForcedAccessorialsFromOrder: syncForcedAccessorialsFromOrder,
    getAllowedAccessorialsForCarrier: getAllowedAccessorialsForCarrier,
    filterRatesBySelectedAccessorials: filterRatesBySelectedAccessorials,

    applyCarrierLimits: applyCarrierLimits,
    applyDropShipSuppression: applyDropShipSuppression,
    applyShipmentSuppression: applyShipmentSuppression
  };
});
