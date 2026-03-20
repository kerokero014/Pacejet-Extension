/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @description RDT Pacejet Rates Suitelet (v3.7) - Multi-Origin + Vendor Aware + dropship support
 */
define(["N/runtime", "N/https", "N/record", "N/log", "N/search"], function (
  runtime,
  https,
  record,
  log,
  search
) {
  "use strict";

  // ---------- utils: params ----------

  function readParam(id, dflt) {
    try {
      var v = runtime.getCurrentScript().getParameter({ name: id });
      return v !== null && v !== undefined && v !== "" ? v : dflt;
    } catch (_e) {
      return dflt;
    }
  }

  function safeJsonParse(str, dflt) {
    try {
      return JSON.parse(str);
    } catch (_e) {
      return dflt;
    }
  }

  function getLocationFacilityMap() {
    return safeJsonParse(readParam("custscript_rdt_pj_location_map", "{}"), {});
  }

  function mapNsLocationToPacejetFacility(nsLocationId, mapping) {
    var key = String(nsLocationId || "");

    if (mapping && mapping[key]) {
      return String(mapping[key]);
    }

    return key;
  }

  // ---------- utils: HTTP retry ----------

  function isTransient(code) {
    return (
      code === 429 ||
      code === 500 ||
      code === 502 ||
      code === 503 ||
      code === 504
    );
  }

  function postWithRetry(options, attempts) {
    var i = 0;
    var lastErr = null;

    while (i < attempts) {
      i += 1;
      try {
        var resp = https.post(options);

        // 2xx = success
        if (resp.code >= 200 && resp.code < 300) {
          return resp;
        }

        // Non-transient error → don't bother retrying
        if (!isTransient(resp.code)) {
          throw new Error("HTTP " + resp.code + ": " + resp.body);
        }
      } catch (e) {
        lastErr = e;
      }

      // small backoff between retries
      try {
        runtime.sleep(i * 250);
      } catch (_e2) {}
    }

    throw lastErr || new Error("Pacejet request failed");
  }

  // ---------- utils: response writers ----------

  function writeJson(res, obj) {
    res.setHeader({ name: "Content-Type", value: "application/json" });
    res.write(JSON.stringify(obj));
  }

  function writeError(res, msg, extra) {
    var out = {
      ok: false,
      error: msg || "Error"
    };
    if (extra) {
      out.hint = ("" + extra).slice(0, 500);
    }
    writeJson(res, out);
  }

  // ---------- normalize inbound body to Pacejet 3.5 schema ----------

  function normalizeRequest(b) {
    b = b || {};

    return {
      Origin: b.Origin || {},
      Destination: b.Destination || {},
      PackageDetailsList: b.PackageDetailsList || b.Packages || [],

      // parcel vs LTL hints
      ShipmentType: b.ShipmentType || b.shipmentType,
      shipMode: b.shipMode,
      rateSystem: b.rateSystem,

      // options if you ever send them
      ShipmentOptions: b.ShipmentOptions || {},
      LTLOptions: b.LTLOptions || {},

      // keep any billing / carrier hints
      billingDetails: b.billingDetails,
      carrierDetails: b.carrierDetails
    };
  }

  // ---------- default origin (Curecrete) ----------

  var DEFAULT_ORIGIN = {
    CompanyName: "Curecrete",
    Address1: "1203 Spring Creek Place",
    City: "Springville",
    StateOrProvinceCode: "UT",
    PostalCode: "84663",
    CountryCode: "US"
  };

  var LOCATION_FACILITY_MAP = getLocationFacilityMap();

  // ---------- type mapper (cart → record.Type) ----------

  function mapItemType(code) {
    if (!code) return record.Type.INVENTORY_ITEM;

    switch (String(code).toLowerCase()) {
      case "invtpart":
      case "inventoryitem":
        return record.Type.INVENTORY_ITEM;
      case "noninvtpart":
      case "noninventoryitem":
        return record.Type.NON_INVENTORY_ITEM;
      case "kit":
      case "kititem":
        return record.Type.KIT_ITEM;
      case "assembly":
      case "assemblyitem":
        return record.Type.ASSEMBLY_ITEM;
      default:
        return record.Type.INVENTORY_ITEM;
    }
  }

  // ---------- origin resolution (vendor-aware) ----------

  var ITEM_ORIGIN_CACHE = {};
  var VENDOR_ORIGIN_CACHE = {};
  var LOCATION_ORIGIN_CACHE = {};
  var ITEM_LOCATION_CACHE = {};

  function extractLocationId(cartItem) {
    if (!cartItem) return "";

    if (cartItem.locationId) {
      return String(cartItem.locationId);
    }

    var originKey = String(cartItem.originKey || "");
    if (originKey.indexOf("LOC_") === 0) {
      var parsed = originKey.substring(4);
      return parsed && parsed !== "DEFAULT" ? parsed : "";
    }

    return "";
  }

  function getLocationIdFromItemRec(itemRec) {
    if (!itemRec) return "";

    try {
      return String(itemRec.getValue({ fieldId: "location" }) || "");
    } catch (_e) {
      return "";
    }
  }

  function getLocationIdFromLookup(itemId) {
    if (!itemId) return "";

    var key = String(itemId);
    if (ITEM_LOCATION_CACHE.hasOwnProperty(key)) {
      return ITEM_LOCATION_CACHE[key];
    }

    var locationId = "";

    try {
      var lookup = search.lookupFields({
        type: search.Type.ITEM,
        id: key,
        columns: ["location"]
      });

      if (lookup && lookup.location && lookup.location.length) {
        locationId = String(lookup.location[0].value || "");
      }
    } catch (e) {
      try {
        log.error({
          title: "getLocationIdFromLookup error (item " + key + ")",
          details: e
        });
      } catch (_e2) {}
    }

    ITEM_LOCATION_CACHE[key] = locationId;
    return locationId;
  }

  function resolveWarehouseLocationId(cartItem, itemRec) {
    var locationId = extractLocationId(cartItem);
    if (locationId) {
      return locationId;
    }

    locationId = getLocationIdFromLookup(cartItem && cartItem.internalid);
    if (locationId) {
      return locationId;
    }

    locationId = getLocationIdFromItemRec(itemRec);
    if (locationId) {
      return locationId;
    }

    return "";
  }

  function buildOriginFromLocation(locationId) {
    if (!locationId) return null;

    var key = String(locationId);
    if (LOCATION_ORIGIN_CACHE[key]) {
      return LOCATION_ORIGIN_CACHE[key];
    }

    var facilityCode = mapNsLocationToPacejetFacility(
      key,
      LOCATION_FACILITY_MAP
    );

    var origin = {
      LocationType: "Facility",
      LocationSite: "MAIN",
      LocationCode: facilityCode
    };

    try {
      var locationRec = record.load({
        type: record.Type.LOCATION,
        id: key,
        isDynamic: false
      });

      origin.CompanyName =
        locationRec.getValue({ fieldId: "name" }) || DEFAULT_ORIGIN.CompanyName;
      origin.Address1 =
        locationRec.getValue({ fieldId: "addr1" }) || DEFAULT_ORIGIN.Address1;
      origin.City =
        locationRec.getValue({ fieldId: "city" }) || DEFAULT_ORIGIN.City;
      origin.StateOrProvinceCode =
        locationRec.getValue({ fieldId: "state" }) ||
        DEFAULT_ORIGIN.StateOrProvinceCode;
      origin.PostalCode =
        locationRec.getValue({ fieldId: "zip" }) || DEFAULT_ORIGIN.PostalCode;
      origin.CountryCode =
        locationRec.getValue({ fieldId: "country" }) ||
        DEFAULT_ORIGIN.CountryCode;
    } catch (e) {
      try {
        log.error({
          title: "buildOriginFromLocation error (location " + key + ")",
          details: e
        });
      } catch (_e2) {}

      origin.CompanyName = DEFAULT_ORIGIN.CompanyName;
      origin.Address1 = DEFAULT_ORIGIN.Address1;
      origin.City = DEFAULT_ORIGIN.City;
      origin.StateOrProvinceCode = DEFAULT_ORIGIN.StateOrProvinceCode;
      origin.PostalCode = DEFAULT_ORIGIN.PostalCode;
      origin.CountryCode = DEFAULT_ORIGIN.CountryCode;
    }

    LOCATION_ORIGIN_CACHE[key] = origin;
    return origin;
  }

  function buildOriginFromVendor(vendorId) {
    if (!vendorId) return null;
    var key = String(vendorId);

    if (VENDOR_ORIGIN_CACHE[key]) {
      return VENDOR_ORIGIN_CACHE[key];
    }

    try {
      var vendorRec = record.load({
        type: record.Type.VENDOR,
        id: vendorId,
        isDynamic: false
      });

      var addrCount = vendorRec.getLineCount({ sublistId: "addressbook" });
      var addr = null;

      for (var i = 0; i < addrCount; i++) {
        var isDefaultShip = vendorRec.getSublistValue({
          sublistId: "addressbook",
          fieldId: "defaultshipping",
          line: i
        });

        if (isDefaultShip === true || String(isDefaultShip) === "T") {
          addr = vendorRec.getSublistSubrecord({
            sublistId: "addressbook",
            fieldId: "addressbookaddress",
            line: i
          });
          break;
        }
      }

      if (!addr && addrCount > 0) {
        addr = vendorRec.getSublistSubrecord({
          sublistId: "addressbook",
          fieldId: "addressbookaddress",
          line: 0
        });
      }

      if (!addr) {
        VENDOR_ORIGIN_CACHE[key] = DEFAULT_ORIGIN;
        return DEFAULT_ORIGIN;
      }

      var companyName =
        vendorRec.getValue({ fieldId: "companyname" }) ||
        vendorRec.getValue({ fieldId: "entityid" }) ||
        "Vendor";

      var origin = {
        CompanyName: companyName,
        Address1: addr.getValue({ fieldId: "addr1" }) || "",
        City: addr.getValue({ fieldId: "city" }) || "",
        StateOrProvinceCode:
          addr.getValue({ fieldId: "state" }) ||
          addr.getValue({ fieldId: "dropdownstate" }) ||
          "",
        PostalCode: addr.getValue({ fieldId: "zip" }) || "",
        CountryCode: addr.getValue({ fieldId: "country" }) || "US"
      };

      VENDOR_ORIGIN_CACHE[key] = origin;
      return origin;
    } catch (e) {
      try {
        log.error({
          title: "buildOriginFromVendor error (vendor " + vendorId + ")",
          details: e
        });
      } catch (_e2) {}
      VENDOR_ORIGIN_CACHE[key] = DEFAULT_ORIGIN;
      return DEFAULT_ORIGIN;
    }
  }

  function getPreferredVendorFromItem(itemRec) {
    if (!itemRec) return null;

    // 1) Try the body field first
    var vendorId = itemRec.getValue({ fieldId: "preferredvendor" });
    if (vendorId) {
      return vendorId;
    }

    // 2) Fall back to the vendors sublist (itemvendor)
    var count = 0;
    try {
      count = itemRec.getLineCount({ sublistId: "itemvendor" }) || 0;
    } catch (e) {
      // some item types may not have this sublist
      return null;
    }

    var foundVendor = null;

    // 2a) Look for a "preferred" vendor on the sublist
    for (var i = 0; i < count; i++) {
      var isPref = itemRec.getSublistValue({
        sublistId: "itemvendor",
        fieldId: "preferredvendor", // standard flag
        line: i
      });

      if (
        isPref === true ||
        isPref === "T" ||
        String(isPref).toLowerCase() === "true"
      ) {
        foundVendor = itemRec.getSublistValue({
          sublistId: "itemvendor",
          fieldId: "vendor",
          line: i
        });
        break;
      }
    }

    // 2b) If nothing flagged preferred, just use the first vendor line
    if (!foundVendor && count > 0) {
      foundVendor = itemRec.getSublistValue({
        sublistId: "itemvendor",
        fieldId: "vendor",
        line: 0
      });
    }

    return foundVendor || null;
  }

  function deriveOriginFromCartItem(cartItem) {
    if (!cartItem) {
      return DEFAULT_ORIGIN;
    }

    var locationId = extractLocationId(cartItem);
    if (!cartItem.internalid) {
      return locationId ? buildOriginFromLocation(locationId) : DEFAULT_ORIGIN;
    }

    var key = [
      String(cartItem.internalid),
      locationId || "",
      cartItem.originKey || ""
    ].join("|");
    if (ITEM_ORIGIN_CACHE[key]) {
      return ITEM_ORIGIN_CACHE[key];
    }

    var origin = DEFAULT_ORIGIN;

    function resolveFromItemRec(itemRec, contextLabel) {
      if (!itemRec) return null;

      var flag = itemRec.getValue({ fieldId: "isdropshipitem" });
      var isDrop =
        flag === true || flag === "T" || String(flag).toLowerCase() === "true";

      cartItem.isDropShip = isDrop;

      var vendorId = getPreferredVendorFromItem(itemRec) || null;

      try {
        log.audit({
          title: "Pacejet deriveOriginFromCartItem [" + contextLabel + "]",
          details: {
            itemId:
              itemRec.id || itemRec.getValue({ fieldId: "internalid" }) || null,
            isDrop: isDrop,
            vendorId: vendorId
          }
        });
      } catch (_eLog) {}

      if (isDrop && vendorId) {
        var vendorOrigin = buildOriginFromVendor(vendorId) || DEFAULT_ORIGIN;

        try {
          log.audit({
            title:
              "Pacejet deriveOriginFromCartItem [" + contextLabel + "] origin",
            details: vendorOrigin
          });
        } catch (_eLog2) {}

        return vendorOrigin;
      }

      var resolvedLocationId = resolveWarehouseLocationId(cartItem, itemRec);
      if (resolvedLocationId) {
        cartItem.locationId = resolvedLocationId;
        return buildOriginFromLocation(resolvedLocationId) || DEFAULT_ORIGIN;
      }

      return null;
    }

    try {
      var recType = mapItemType(cartItem.type || cartItem.itemtype);

      var itemRec = null;

      try {
        itemRec = record.load({
          type: recType,
          id: cartItem.internalid,
          isDynamic: false
        });
      } catch (eLoad) {
        try {
          log.error({
            title:
              "deriveOriginFromCartItem item load failed (item " +
              cartItem.internalid +
              ", type " +
              recType +
              ")",
            details: eLoad
          });
        } catch (_eLog3) {}

        ITEM_ORIGIN_CACHE[key] = DEFAULT_ORIGIN;
        return DEFAULT_ORIGIN;
      }

      // 1️⃣ Try the item itself
      origin = resolveFromItemRec(itemRec, "item") || origin;

      // 2️⃣ Fallback to matrix parent if still default
      if (cartItem.isDropShip !== true) {
        var parentId = itemRec.getValue({ fieldId: "parent" }) || null;
        if (parentId) {
          try {
            var parentRec = record.load({
              type: recType,
              id: parentId,
              isDynamic: false
            });

            if (!cartItem.locationId) {
              cartItem.locationId =
                getLocationIdFromLookup(parentId) ||
                getLocationIdFromItemRec(parentRec) ||
                "";
            }

            var parentOrigin =
              resolveFromItemRec(parentRec, "parent") || DEFAULT_ORIGIN;

            if (cartItem.isDropShip === true || parentOrigin !== DEFAULT_ORIGIN) {
              origin = parentOrigin;
            }
          } catch (eParent) {
            try {
              log.error({
                title:
                  "deriveOriginFromCartItem parent load error (parent " +
                  parentId +
                  ")",
                details: eParent
              });
            } catch (_e2) {}
          }
        }
      }
    } catch (eOuter) {
      try {
        log.error({
          title:
            "deriveOriginFromCartItem outer error (item " +
            cartItem.internalid +
            ")",
          details: eOuter
        });
      } catch (_e3) {}
      origin = DEFAULT_ORIGIN;
    }

    ITEM_ORIGIN_CACHE[key] = origin;
    return origin;
  }

  function resolveOriginForItem(cartItem) {
    try {
      if (cartItem && cartItem.originHint) {
        return cartItem.originHint;
      }
    } catch (_e) {}

    return deriveOriginFromCartItem(cartItem);
  }

  function getOriginGroupKey(origin) {
    if (!origin) return "DEFAULT";

    if (origin.LocationType && origin.LocationCode) {
      return [
        String(origin.LocationType || "").toUpperCase(),
        String(origin.LocationSite || "").toUpperCase(),
        String(origin.LocationCode || "")
      ].join("|");
    }

    return [
      origin.PostalCode,
      origin.City,
      origin.StateOrProvinceCode,
      origin.CountryCode
    ].join("|");
  }

  // ---------- origin grouping (multi-origin) ----------

  function groupPackagesByOrigin(body) {
    var list = body.PackageDetailsList || [];
    var buckets = {};

    for (var i = 0; i < list.length; i++) {
      var pkg = list[i];

      var item = (body.cartSnapshot && body.cartSnapshot.items[i]) || {};
      var origin = resolveOriginForItem(item);

      var key = getOriginGroupKey(origin);

      if (!buckets[key]) {
        buckets[key] = {
          Origin: origin,
          Packages: [],
          dropShip: false
        };
      }

      if (
        item &&
        (item.isDropShip === true ||
          item.dropShip === true ||
          item.isDropShip === "T" ||
          item.dropShip === "T")
      ) {
        buckets[key].dropShip = true;
      }

      buckets[key].Packages.push(pkg);
    }

    return buckets;
  }

  // ---------- main ----------

  function onRequest(ctx) {
    var req = ctx.request;
    var res = ctx.response;

    if (req.method === "GET") {
      return writeJson(res, {
        ok: true,
        version: "Phase3 Multi-Origin + Vendor",
        service: "RDT Pacejet Rates Suitelet (v3.7)"
      });
    }

    if (req.method !== "POST") {
      return writeError(res, "POST only");
    }

    // var apiUrl = String(
    //   readParam("custscript_rdt_pj_api_url", "https://shipapi.pacejet.cc/"),
    // ).replace(/\/+$/, "");

    // TEMP HARD CODE FOR DEBUG
    var apiUrl = "https://shipapi.pacejet.cc";

    var location = "Curecrete";
    var apiKey = readParam("custscript_rdt_pj_api_key", "");
    var ratesId = readParam("custscript_rdt_pj_rates_licenseid", "");
    var upsRatesId = readParam("custscript_rdt_pj_ups_rates_licenseid", "");
    var debugEcho = String(readParam("custscript_rdt_pj_debug", "F")) === "T";

    if (!apiKey || !location || !ratesId || !upsRatesId) {
      return writeError(res, "Pacejet is not configured.");
    }

    var body = {};
    try {
      body = JSON.parse(req.body || "{}");
    } catch (e) {
      body = {};
    }

    try {
      if (body.cartSnapshot) {
        log.audit("Pacejet cartSnapshot", {
          itemsCount: (body.cartSnapshot.items || []).length,
          shipZip: body.cartSnapshot.shipping && body.cartSnapshot.shipping.zip
        });
      }
    } catch (_e2) {}

    var groups = groupPackagesByOrigin(body);
    var results = {
      ok: true,
      origins: {}
    };

    var originKeys = Object.keys(groups);

    for (var g = 0; g < originKeys.length; g++) {
      var key = originKeys[g];
      var group = groups[key];

      var basePayload = {
        Origin: group.Origin,

        Destination: body.Destination,
        PackageDetailsList: group.Packages,

        ShipmentType: body.ShipmentType || body.shipmentType,
        shipMode: body.shipMode,
        rateSystem: body.rateSystem,

        ShipmentOptions: body.ShipmentOptions || {},
        LTLOptions: body.LTLOptions || {},

        billingDetails: body.billingDetails,
        carrierDetails: body.carrierDetails
      };

      var normalized = normalizeRequest(basePayload);

      normalized.Location = location;
      normalized.LicenseID = ratesId;
      normalized.UpsLicenseID = upsRatesId;

      var options = {
        url: apiUrl + "/Rates?api-version=3.5",
        headers: {
          "Content-Type": "application/json",
          PacejetLocation: location,
          PacejetLicenseKey: apiKey
        },
        body: JSON.stringify(normalized)
      };

      try {
        var pj = postWithRetry(options, 3);

        try {
          log.audit("Pacejet Rates upstream (" + key + ")", {
            code: pj.code,
            body: (pj.body || "").substring(0, 800)
          });
        } catch (_e3) {}

        // 🔹 NEW: always include Origin, and wrap Pacejet payload as `raw`
        if (pj.code >= 200 && pj.code < 300) {
          var parsed = {};
          try {
            parsed = JSON.parse(pj.body || "{}");
          } catch (_e4) {
            parsed = { raw: pj.body || "" };
          }

          results.origins[key] = {
            Origin: group.Origin,
            dropShip: !!group.dropShip,
            raw: parsed
          };
        } else {
          results.origins[key] = {
            Origin: group.Origin,
            ok: false,
            error: "HTTP " + pj.code,
            debug: debugEcho ? pj.body || "" : undefined
          };
        }
      } catch (eCall) {
        try {
          log.error("Pacejet Rates Error (" + key + ")", eCall);
        } catch (_e5) {}
        results.origins[key] = {
          Origin: group.Origin,
          ok: false,
          error: "Exception calling Pacejet",
          detail: String(eCall)
        };
      }
    }

    writeJson(res, results);
  }

  return {
    onRequest: onRequest
  };
});
