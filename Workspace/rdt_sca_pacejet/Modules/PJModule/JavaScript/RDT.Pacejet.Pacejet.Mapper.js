/// <amd-module name="RDT.Pacejet.Pacejet.Mapper"/>

define("RDT.Pacejet.Pacejet.Mapper", [
  "underscore",
  "RDT.Pacejet.CarrierMap"
], function (_, CarrierMap) {
  "use strict";

  function num(t) {
    return Number(String(t || "").replace(/[^0-9.\-]/g, "")) || 0;
  }

  function resolveRateCost(rr) {
    var shipperFreight = num(rr && rr.consignorFreight);
    var customerFreight = num(
      rr && (rr.consigneeFreight || rr.totalFreightWithSurcharges)
    );

    return {
      shipperFreight: shipperFreight,
      customerFreight: customerFreight || shipperFreight,
      allInCost:
        num(rr && rr.totalFreightWithSurcharges) ||
        customerFreight ||
        shipperFreight +
          num(rr && rr.totalServiceFees) +
          num(rr && rr.fuelSurcharge)
    };
  }

  function mapRates(resp) {
    if (!resp) return [];

    var raw = resp.raw || resp || {};
    var ratingResults = raw.ratingResultsList || raw.results || [];
    var recommendations = raw.serviceRecommendationList || null;

    var allResults = [];
    var seenShipCodes = {};

    function pushIfUnique(rr) {
      if (!rr) return;

      var code = rr.shipCodeXRef || rr.shipCode || rr.methodCode;
      if (!code) return;

      var key = String(code);
      if (seenShipCodes[key]) return;

      seenShipCodes[key] = true;
      allResults.push(rr);
    }

    (ratingResults || []).forEach(function (rr) {
      if (!rr || rr.exclude === true) return;
      pushIfUnique(rr);
    });

    if (!allResults.length) return [];

    var out = [];

    allResults.forEach(function (rr) {
      if (!rr || rr.exclude === true) return;

      var shipCode = rr.shipCodeXRef || rr.shipCode || rr.methodCode || rr.id;
      if (!shipCode) return;

      var pricing = resolveRateCost(rr);
      var serviceFees = num(rr.totalServiceFees || 0);
      var fuel = num(rr.fuelSurcharge || 0);
      // var totalCost = pricing.shipperFreight || pricing.customerFreight;
      var totalCost = pricing.customerFreight || pricing.shipperFreight;

      if (totalCost <= 0.01) return;

      var carrierNumber = rr.carrierNumber || rr.carrier || "";
      var serviceCode = rr.carrierClassOfServiceCode || rr.serviceCode || "";

      var carrierUpper = String(carrierNumber).toUpperCase();
      var serviceUpper = String(
        rr.carrierClassOfServiceCodeDescription || ""
      ).toUpperCase();

      // Remove placeholders
      if (
        carrierUpper === "MME" ||
        carrierUpper === "NORTHPARK" ||
        carrierUpper === "WILLCALL" ||
        carrierUpper === "OTHER"
      ) {
        return;
      }

      if (
        serviceUpper.indexOf("USE CUSTOMER FREIGHT") !== -1 ||
        serviceUpper.indexOf("SPECIAL CONSIDERATIONS") !== -1
      ) {
        return;
      }

      var resolvedMode = String(
        rr.shipMode || rr.rateSystem || ""
      ).toUpperCase();

      // Force FedEx Freight into LTL
      if (carrierUpper === "FEDEX" && serviceUpper.indexOf("FREIGHT") !== -1) {
        resolvedMode = "LTL";
      }

      if (!resolvedMode) resolvedMode = "LTL";

      out.push({
        id: String(shipCode),
        shipCode: String(shipCode),

        carrier: carrierNumber,
        carrierName: carrierNumber,

        service: rr.carrierClassOfServiceCodeDescription || serviceCode || "",
        serviceName:
          rr.carrierClassOfServiceCodeDescription || serviceCode || "",

        mode: resolvedMode,
        shipMode: resolvedMode,

        cost: +totalCost.toFixed(2),
        customerFreight: +pricing.customerFreight.toFixed(2),
        shipperFreight: +pricing.shipperFreight.toFixed(2),
        allInCost: +pricing.allInCost.toFixed(2),

        baseFreight: +pricing.shipperFreight.toFixed(2),
        serviceFees: serviceFees,
        fuel: fuel,

        transitDays: typeof rr.transitTime === "number" ? rr.transitTime : null,
        estDelivery: rr.arrivalDateText || "",
        totalWeight: num(rr.totalWeight || rr.shipmentWeight || rr.weight || 0),

        raw: rr
      });
    });

    out.sort(function (a, b) {
      return (a.cost || 0) - (b.cost || 0);
    });

    function addRecommendation(kind, prefix) {
      if (!recommendations) return;

      var shipCode = recommendations[prefix + "ShipCodeXRef"];
      var carrierNumber = recommendations[prefix + "CarrierNumber"];
      var serviceDescription =
        recommendations[prefix + "CarrierClassOfServiceCodeDescription"] ||
        recommendations[prefix + "CarrierClassOfServiceCode"] ||
        "";

      var shipperFreight =
        num(recommendations[prefix + "ConsignorFreight"]) ||
        num(recommendations[prefix + "ListFreight"]) ||
        0;

      var customerFreight =
        num(recommendations[prefix + "ConsigneeFreight"]) || shipperFreight;

      var serviceFees = num(recommendations[prefix + "TotalServiceFees"] || 0);
      var fuel = num(recommendations[prefix + "FuelSurcharge"] || 0);
      var totalCost = customerFreight || shipperFreight;

      if (!carrierNumber || !serviceDescription || totalCost <= 0.01) return;

      var transitDays = recommendations[prefix + "TransitTime"];
      var estDelivery = recommendations[prefix + "ArrivalDateText"] || "";
      var tagLabel =
        kind === "fastest"
          ? "Recommended: Fastest"
          : "Recommended: Lowest Cost";

      var existing = out.find(function (r) {
        if (shipCode && r.shipCode && String(r.shipCode) === String(shipCode)) {
          return true;
        }

        return (
          String(r.carrierName || r.carrier || "").toUpperCase() ===
            String(carrierNumber).toUpperCase() &&
          String(r.serviceName || r.service || "").toUpperCase() ===
            String(serviceDescription).toUpperCase()
        );
      });

      if (existing) {
        if (!existing._recommendationTag)
          existing._recommendationTag = tagLabel;
        else if (existing._recommendationTag.indexOf(tagLabel) === -1)
          existing._recommendationTag =
            existing._recommendationTag + " | " + tagLabel;
        return;
      }

      out.push({
        id:
          "REC_" +
          String(kind || "").toUpperCase() +
          "_" +
          String(shipCode || serviceDescription),
        shipCode: String(shipCode || ""),

        carrier: carrierNumber,
        carrierName: carrierNumber,

        service: serviceDescription,
        serviceName: serviceDescription,

        mode: /FREIGHT|LTL/i.test(serviceDescription) ? "LTL" : "PARCEL",
        shipMode: /FREIGHT|LTL/i.test(serviceDescription) ? "LTL" : "PARCEL",

        cost: +totalCost.toFixed(2),
        customerFreight: +customerFreight.toFixed(2),
        shipperFreight: +shipperFreight.toFixed(2),
        allInCost: +(customerFreight || shipperFreight).toFixed(2),

        baseFreight: +shipperFreight.toFixed(2),
        serviceFees: serviceFees,
        fuel: fuel,

        transitDays:
          typeof transitDays === "number" ? transitDays : num(transitDays || 0),
        estDelivery: estDelivery,
        _recommendationTag: tagLabel,

        raw: recommendations
      });
    }
    addRecommendation("lowestCost", "lowestCost");
    addRecommendation("fastest", "fastest");

    out.sort(function (a, b) {
      return (a.cost || 0) - (b.cost || 0);
    });

    return out;
  }

  function aggregateMultiOriginRates(resp) {
    if (!resp || !resp.origins) return [];

    var originKeys = Object.keys(resp.origins || {});
    if (originKeys.length === 0) return [];

    // If only one origin → just return its filtered/mapped rates as-is
    if (originKeys.length === 1) {
      var key = originKeys[0];
      var originBlock = resp.origins[key] || {};
      var list = (
        originBlock._filteredRates ||
        originBlock._mappedRates ||
        []
      ).slice();

      var O = originBlock.Origin || originBlock.origin || {};

      list.forEach(function (rate) {
        rate.origins = [
          {
            originKey: key,
            dropShip: !!originBlock.dropShip,

            state:
              O.StateOrProvinceCode || O.stateOrProvinceCode || O.state || "",

            city: O.City || O.city || "",
            postal: O.PostalCode || O.postalCode || "",
            country: O.CountryCode || O.countryCode || "US",

            carrier: rate.carrierName || rate.carrier,
            service: rate.serviceName || rate.service,
            cost: Number(rate.cost || 0),

            raw: rate.raw || null
          }
        ];
      });

      return list;
    }

    // ---------------------------
    // Helpers
    // ---------------------------
    function num(t) {
      return Number(String(t || "").replace(/[^0-9.\-]/g, "")) || 0;
    }

    function upper(s) {
      return String(s || "").toUpperCase();
    }

    function normalizeToken(s) {
      return upper(s)
        .replace(/\s+/g, "_")
        .replace(/[^A-Z0-9_]/g, "");
    }

    function detectMode(rate) {
      var m = upper(rate && (rate.mode || rate.shipMode || ""));
      if (m === "PARCEL" || m === "LTL") return m;

      // fallback: infer from service name
      var svc = upper(rate && (rate.serviceName || rate.service || ""));
      if (svc.indexOf("FREIGHT") !== -1) return "LTL";
      return "PARCEL";
    }

    // Handles: "MON - 2/16/2026", "MON - 2/16/2026 11:30:00 AM", "NA"
    function parseArrivalDateText(txt) {
      txt = String(txt || "").trim();
      if (!txt || txt.toUpperCase() === "NA") return null;

      // find M/D/YYYY or MM/DD/YYYY
      var m = txt.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (!m) return null;

      var month = parseInt(m[1], 10);
      var day = parseInt(m[2], 10);
      var year = parseInt(m[3], 10);

      if (!month || !day || !year) return null;

      // Create a Date in local time (fine for comparing)
      return new Date(year, month - 1, day);
    }

    function formatYMD(d) {
      if (!d || !(d instanceof Date)) return "NA";
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, "0");
      var day = String(d.getDate()).padStart(2, "0");
      return y + "-" + m + "-" + day;
    }

    function buildComboRate(comboLegs) {
      var total = 0;
      var maxTransit = null;

      var latestArrival = null;

      var carrierParts = [];
      var serviceParts = [];
      var modeSet = {};

      var originsOut = [];

      for (var i = 0; i < comboLegs.length; i++) {
        var leg = comboLegs[i];
        if (!leg) continue;

        total += num(leg.cost);

        var t = leg.transitDays;
        if (typeof t === "number") {
          if (maxTransit == null) maxTransit = t;
          else maxTransit = Math.max(maxTransit, t);
        }

        var arr = parseArrivalDateText(leg.estDelivery || leg.arrivalDateText);
        if (arr) {
          if (!latestArrival || arr > latestArrival) latestArrival = arr;
        }

        var legMode = detectMode(leg);
        modeSet[legMode] = true;

        carrierParts.push(String(leg.carrierName || leg.carrier || ""));
        serviceParts.push(String(leg.serviceName || leg.service || ""));

        originsOut.push({
          originKey: leg._originKey || "",
          dropShip: !!leg._dropShip,

          Origin: leg._Origin || null,

          state:
            (leg._Origin &&
              (leg._Origin.StateOrProvinceCode ||
                leg._Origin.state ||
                leg._Origin.stateCode)) ||
            "",

          carrier: leg.carrierName || leg.carrier,
          carrierName: leg.carrierName || leg.carrier,

          service: leg.serviceName || leg.service,
          serviceName: leg.serviceName || leg.service,

          cost: num(leg.cost),

          baseFreight: num(leg.baseFreight || 0),
          serviceFees: num(leg.serviceFees || 0),
          fuel: num(leg.fuel || 0),

          raw: leg.raw || null
        });
      }

      var modes = Object.keys(modeSet);
      var resolvedMode = modes.length > 1 ? "MIXED" : modes[0] || "LTL";

      // Build a stable-ish id so UI + selection don’t collapse weirdly
      var id =
        "AGG_" +
        normalizeToken(carrierParts.join("+")) +
        "__" +
        normalizeToken(serviceParts.join("+")) +
        "__" +
        formatYMD(latestArrival);

      return {
        id: id,
        shipCode: "",

        carrier: carrierParts.join(" + "),
        carrierName: carrierParts.join(" + "),

        service: serviceParts.join(" + "),
        serviceName: serviceParts.join(" + "),

        mode: resolvedMode,
        shipMode: resolvedMode,

        cost: +total.toFixed(2),
        transitDays: maxTransit,

        estDelivery: latestArrival ? formatYMD(latestArrival) : "",

        origins: originsOut,

        // helps debug
        _modeBreakdown: { modes: modes }
      };
    }

    // ---------------------------
    // Build per-origin candidate legs
    // ---------------------------
    var PER_ORIGIN_MAX = 10; // cap to control explosion
    var PARCEL_TOP = 6;
    var LTL_TOP = 8;

    var perOrigin = [];

    for (var o = 0; o < originKeys.length; o++) {
      var key = originKeys[o];
      var originBlock = resp.origins[key] || {};
      var list = (
        originBlock._filteredRates ||
        originBlock._mappedRates ||
        []
      ).slice();

      // annotate legs with origin metadata so we can rebuild origins array
      for (var r = 0; r < list.length; r++) {
        list[r]._originKey = key;
        list[r]._dropShip = !!originBlock.dropShip;
        list[r]._Origin = originBlock.Origin || originBlock.origin || null;

        var O = originBlock.Origin || {};
        list[r]._originState =
          O.StateOrProvinceCode || O.stateOrProvinceCode || "";
        list[r]._originCity = O.City || O.city || "";
        list[r]._originPostal = O.PostalCode || O.postalCode || "";
      }

      // split by mode, keep top N of each
      var parcel = [];
      var ltl = [];

      list.forEach(function (rate) {
        var m = detectMode(rate);
        if (m === "PARCEL") parcel.push(rate);
        else ltl.push(rate);
      });

      parcel.sort(function (a, b) {
        return num(a.cost) - num(b.cost);
      });
      ltl.sort(function (a, b) {
        return num(a.cost) - num(b.cost);
      });

      parcel = parcel.slice(0, PARCEL_TOP);
      ltl = ltl.slice(0, LTL_TOP);

      var combined = parcel.concat(ltl);
      combined.sort(function (a, b) {
        return num(a.cost) - num(b.cost);
      });

      perOrigin.push({
        originKey: key,
        dropShip: !!originBlock.dropShip,
        legs: combined.slice(0, PER_ORIGIN_MAX)
      });
    }

    // If any origin has no legs, we cannot consolidate
    for (var z = 0; z < perOrigin.length; z++) {
      if (!perOrigin[z].legs || !perOrigin[z].legs.length) {
        return [];
      }
    }

    // ---------------------------
    // Generate combos (cartesian product with pruning)
    // ---------------------------
    var MAX_COMBOS_TO_BUILD = 1200;
    var rawCombos = [];

    function buildCombos(idx, picked) {
      if (rawCombos.length >= MAX_COMBOS_TO_BUILD) return;

      if (idx >= perOrigin.length) {
        rawCombos.push(buildComboRate(picked));
        return;
      }

      var legs = perOrigin[idx].legs || [];
      for (var i = 0; i < legs.length; i++) {
        picked.push(legs[i]);
        buildCombos(idx + 1, picked);
        picked.pop();

        if (rawCombos.length >= MAX_COMBOS_TO_BUILD) return;
      }
    }

    buildCombos(0, []);

    if (!rawCombos.length) return [];

    // ---------------------------
    // Dedup + keep multiple options
    // ---------------------------
    // We dedupe by: carrier combo + service combo + delivery bucket + mode bucket
    // but keep the cheapest for that “signature”
    var bestBySig = {};

    rawCombos.forEach(function (r) {
      var sig =
        normalizeToken(r.carrierName) +
        "|" +
        normalizeToken(r.serviceName) +
        "|" +
        normalizeToken(r.shipMode) +
        "|" +
        (r.estDelivery || "NA");

      if (!bestBySig[sig] || num(r.cost) < num(bestBySig[sig].cost)) {
        bestBySig[sig] = r;
      }
    });

    var out = Object.keys(bestBySig).map(function (k) {
      return bestBySig[k];
    });

    out.sort(function (a, b) {
      return num(a.cost) - num(b.cost);
    });

    // return top N best options to UI
    return out.slice(0, 30);
  }

  function mapAggregatedRates(suiteletResponse) {
    var aggregated = aggregateMultiOriginRates(suiteletResponse);
    var mapped = [];

    console.log(
      "[Mapper] Aggregating origins:",
      Object.keys((suiteletResponse && suiteletResponse.origins) || {})
    );

    aggregated.forEach(function (agg) {
      // Build one display rate (we already have carrier/service/mode/shipCode)
      var rate = {
        id: String(agg.shipCode || agg.aggKey),
        shipCode: String(agg.shipCode || ""),

        carrier: agg.carrier,
        carrierName: agg.carrier,

        service: agg.service,
        serviceName: agg.service,

        mode: agg.mode,
        shipMode: agg.mode,

        cost: agg.cost,
        transitDays: agg.transitTime,

        origins: agg.originsBreakdown,

        aggKey: agg.aggKey,
        tag: "Split shipment (" + agg.originsBreakdown.length + " origins)"
      };

      mapped.push(rate);
    });

    return mapped.sort(function (a, b) {
      return (a.cost || 0) - (b.cost || 0);
    });
  }

  return {
    mapRates: mapRates,
    aggregateMultiOriginRates: aggregateMultiOriginRates,
    mapAggregatedRates: mapAggregatedRates
  };
});
