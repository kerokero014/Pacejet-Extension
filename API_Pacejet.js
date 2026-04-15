/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @description RDT Pacejet Rates Suitelet (v5) - Multi-Origin + Vendor Aware + dropship support
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

  function getVendorFacilityMap() {
    return safeJsonParse(readParam("custscript_rdt_pj_vendor_map", "{}"), {});
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
  var VENDOR_FACILITY_MAP = getVendorFacilityMap();

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

  function mapVendorToPacejetFacility(vendorId, mapping) {
    var key = String(vendorId || "");

    if (mapping && mapping[key]) {
      return String(mapping[key]);
    }

    return "";
  }

  // ---------- origin resolution (vendor-aware) ----------

  var ITEM_ORIGIN_CACHE = {};
  var VENDOR_ORIGIN_CACHE = {};
  var LOCATION_ORIGIN_CACHE = {};
  var ITEM_LOCATION_CACHE = {};
  var ITEM_RECORD_CACHE = {};
  var ITEM_AVAILABILITY_CACHE = {};

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

  function loadItemRecordSafe(itemId, recType) {
    if (!itemId || !recType) {
      return null;
    }

    var cacheKey = String(recType) + "|" + String(itemId);
    if (ITEM_RECORD_CACHE.hasOwnProperty(cacheKey)) {
      return ITEM_RECORD_CACHE[cacheKey];
    }

    try {
      ITEM_RECORD_CACHE[cacheKey] = record.load({
        type: recType,
        id: itemId,
        isDynamic: false
      });
    } catch (e) {
      try {
        log.error({
          title:
            "loadItemRecordSafe failed (item " +
            itemId +
            ", type " +
            recType +
            ")",
          details: e
        });
      } catch (_eLoadLog) {}

      ITEM_RECORD_CACHE[cacheKey] = null;
    }

    return ITEM_RECORD_CACHE[cacheKey];
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

      var addressSubrecord = null;

      try {
        addressSubrecord = locationRec.getSubrecord({
          fieldId: "mainaddress"
        });
      } catch (_addrErr) {
        addressSubrecord = null;
      }

      origin.CompanyName =
        locationRec.getValue({ fieldId: "name" }) || DEFAULT_ORIGIN.CompanyName;

      if (addressSubrecord) {
        origin.Address1 =
          addressSubrecord.getValue({ fieldId: "addr1" }) ||
          DEFAULT_ORIGIN.Address1;
        origin.City =
          addressSubrecord.getValue({ fieldId: "city" }) || DEFAULT_ORIGIN.City;
        origin.StateOrProvinceCode =
          addressSubrecord.getValue({ fieldId: "state" }) ||
          addressSubrecord.getValue({ fieldId: "dropdownstate" }) ||
          DEFAULT_ORIGIN.StateOrProvinceCode;
        origin.PostalCode =
          addressSubrecord.getValue({ fieldId: "zip" }) ||
          DEFAULT_ORIGIN.PostalCode;
        origin.CountryCode =
          addressSubrecord.getValue({ fieldId: "country" }) ||
          DEFAULT_ORIGIN.CountryCode;
      } else {
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
      }

      try {
        log.audit({
          title: "buildOriginFromLocation resolved",
          details: {
            locationId: key,
            facilityCode: facilityCode,
            companyName: origin.CompanyName,
            address1: origin.Address1,
            city: origin.City,
            state: origin.StateOrProvinceCode,
            postalCode: origin.PostalCode,
            countryCode: origin.CountryCode,
            usedMainAddressSubrecord: !!addressSubrecord,
            mainaddressText:
              locationRec.getValue({ fieldId: "mainaddress_text" }) || ""
          }
        });
      } catch (_logErr) {}
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

      var mappedFacilityCode = mapVendorToPacejetFacility(
        vendorId,
        VENDOR_FACILITY_MAP
      );

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

      // If vendor is mapped, make it a Pacejet facility-style origin
      if (mappedFacilityCode) {
        origin.LocationType = "Facility";
        origin.LocationSite = "MAIN";
        origin.LocationCode = mappedFacilityCode;
      }

      try {
        log.audit({
          title: "buildOriginFromVendor resolved",
          details: {
            vendorId: key,
            mappedFacilityCode: mappedFacilityCode || "",
            companyName: origin.CompanyName,
            address1: origin.Address1,
            city: origin.City,
            state: origin.StateOrProvinceCode,
            postalCode: origin.PostalCode,
            countryCode: origin.CountryCode,
            locationType: origin.LocationType || "",
            locationSite: origin.LocationSite || "",
            locationCode: origin.LocationCode || ""
          }
        });
      } catch (_vendorAuditErr) {}

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
        itemRec = loadItemRecordSafe(cartItem.internalid, recType);
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

      if (!itemRec) {
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

            if (
              cartItem.isDropShip === true ||
              parentOrigin !== DEFAULT_ORIGIN
            ) {
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

  // ---------- order-level 3PL origin planning ----------

  var ORIGIN_RULES = {
    FL_GEORGIA: "FL_GEORGIA",
    FL_DELAWARE: "FL_DELAWARE",
    MIXED_TO_SPRINGVILLE: "MIXED_TO_SPRINGVILLE",
    OVER_DRUM_THRESHOLD: "OVER_DRUM_THRESHOLD",
    OVER_PAIL_THRESHOLD: "OVER_PAIL_THRESHOLD",
    NEAREST_3PL: "NEAREST_3PL",
    DEFAULT: "DEFAULT"
  };

  var LOCATION_IDS = {
    SPRINGVILLE: "62",
    ILLINOIS: "61",
    DELAWARE: "63",
    GEORGIA: "64"
  };

  var DEST_STATE_TO_3PL_PRIORITY = {
    IL: [LOCATION_IDS.ILLINOIS, LOCATION_IDS.DELAWARE, LOCATION_IDS.GEORGIA],
    WI: [LOCATION_IDS.ILLINOIS, LOCATION_IDS.DELAWARE, LOCATION_IDS.GEORGIA],
    IN: [LOCATION_IDS.ILLINOIS, LOCATION_IDS.DELAWARE, LOCATION_IDS.GEORGIA],
    MI: [LOCATION_IDS.ILLINOIS, LOCATION_IDS.DELAWARE, LOCATION_IDS.GEORGIA],
    FL: [LOCATION_IDS.GEORGIA, LOCATION_IDS.DELAWARE, LOCATION_IDS.ILLINOIS],
    GA: [LOCATION_IDS.GEORGIA, LOCATION_IDS.DELAWARE, LOCATION_IDS.ILLINOIS],
    SC: [LOCATION_IDS.GEORGIA, LOCATION_IDS.DELAWARE, LOCATION_IDS.ILLINOIS],
    NC: [LOCATION_IDS.GEORGIA, LOCATION_IDS.DELAWARE, LOCATION_IDS.ILLINOIS],
    AL: [LOCATION_IDS.GEORGIA, LOCATION_IDS.DELAWARE, LOCATION_IDS.ILLINOIS],
    TN: [LOCATION_IDS.GEORGIA, LOCATION_IDS.DELAWARE, LOCATION_IDS.ILLINOIS],
    DE: [LOCATION_IDS.DELAWARE, LOCATION_IDS.ILLINOIS, LOCATION_IDS.GEORGIA],
    NJ: [LOCATION_IDS.DELAWARE, LOCATION_IDS.ILLINOIS, LOCATION_IDS.GEORGIA],
    PA: [LOCATION_IDS.DELAWARE, LOCATION_IDS.ILLINOIS, LOCATION_IDS.GEORGIA],
    MD: [LOCATION_IDS.DELAWARE, LOCATION_IDS.ILLINOIS, LOCATION_IDS.GEORGIA]
  };

  function safeUpper(value) {
    return String(value || "")
      .toUpperCase()
      .trim();
  }

  function num(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function isTrueLike(value) {
    if (value === true || value === "T") return true;

    return (
      String(value || "")
        .toLowerCase()
        .trim() === "true"
    );
  }

  function ensureArray(value) {
    return Array.isArray(value) ? value : value == null ? [] : [value];
  }

  function normalizeLocationId(value) {
    return value === null || value === undefined || value === ""
      ? ""
      : String(value);
  }

  function normalizeLocationIdArray(value) {
    var seen = {};
    return ensureArray(value)
      .map(function (v) {
        return normalizeLocationId(v);
      })
      .filter(function (v) {
        if (!v || seen[v]) return false;
        seen[v] = true;
        return true;
      });
  }

  function objectHasKeys(value) {
    return (
      !!value && typeof value === "object" && Object.keys(value).length > 0
    );
  }

  function getSublistValueFromCandidates(rec, sublistId, fieldIds, line) {
    for (var i = 0; i < fieldIds.length; i += 1) {
      try {
        var value = rec.getSublistValue({
          sublistId: sublistId,
          fieldId: fieldIds[i],
          line: line
        });

        if (value !== null && value !== undefined && value !== "") {
          return value;
        }
      } catch (_e) {}
    }

    return "";
  }

  function buildAvailabilityFlags(locationIds) {
    var ids = normalizeLocationIdArray(locationIds);

    return {
      availableInSpringville: ids.indexOf(LOCATION_IDS.SPRINGVILLE) !== -1,
      availableInGeorgia: ids.indexOf(LOCATION_IDS.GEORGIA) !== -1,
      availableInDelaware: ids.indexOf(LOCATION_IDS.DELAWARE) !== -1
    };
  }

  function getCartItems(body) {
    return (body && body.cartSnapshot && body.cartSnapshot.items) || [];
  }

  function getDestinationState(body) {
    return safeUpper(
      body &&
        body.Destination &&
        (body.Destination.StateOrProvinceCode ||
          body.Destination.state ||
          body.Destination.stateCode)
    );
  }

  function normalizePackagingType(item) {
    var raw = safeUpper(
      item &&
        (item.packagingType ||
          item.packageType ||
          item.packageTypeLabel ||
          item.containerType ||
          item.unitType ||
          item.saleUnit ||
          item.description ||
          item.displayname ||
          item.name ||
          item.sku ||
          item.custcol5 ||
          "")
    );

    if (raw.indexOf("DRUM") !== -1) return "DRUM";
    if (raw.indexOf("PAIL") !== -1) return "PAIL";
    return "";
  }

  function countPackaging(items) {
    var drums = 0;
    var pails = 0;

    (items || []).forEach(function (item) {
      var qty = num(item && item.quantity) || 1;
      var packaging = normalizePackagingType(item);

      if (packaging === "DRUM") drums += qty;
      if (packaging === "PAIL") pails += qty;
    });

    return {
      drums: drums,
      pails: pails
    };
  }

  /**
   * Reads explicit availability hints from the payload.
   * Conservative by design: if the item does not provide any of these
   * fields, the planner will not force a business-rule origin.
   */
  function getAvailableLocationIdsForItem(item) {
    var ids = [];

    if (!item || typeof item !== "object") {
      return ids;
    }

    ids = ids.concat(normalizeLocationIdArray(item.availableLocationIds));
    ids = ids.concat(normalizeLocationIdArray(item.fulfillableLocationIds));
    ids = ids.concat(normalizeLocationIdArray(item.eligible3plLocationIds));

    if (
      item.warehouseAvailability &&
      typeof item.warehouseAvailability === "object"
    ) {
      Object.keys(item.warehouseAvailability).forEach(function (locId) {
        var value = item.warehouseAvailability[locId];
        if (
          value === true ||
          value === "T" ||
          String(value).toLowerCase() === "true"
        ) {
          ids.push(String(locId));
        }
      });
    }

    if (
      item.availableInSpringville === true ||
      item.availableInSpringville === "T"
    ) {
      ids.push(LOCATION_IDS.SPRINGVILLE);
    }
    if (item.availableInGeorgia === true || item.availableInGeorgia === "T") {
      ids.push(LOCATION_IDS.GEORGIA);
    }
    if (item.availableInDelaware === true || item.availableInDelaware === "T") {
      ids.push(LOCATION_IDS.DELAWARE);
    }

    return normalizeLocationIdArray(ids);
  }

  function hasExplicitAvailabilityData(item) {
    return getAvailableLocationIdsForItem(item).length > 0;
  }

  function mergeAvailabilityDataIntoItem(item, data, source) {
    if (!item || !data) {
      return item;
    }

    item.availableLocationIds = normalizeLocationIdArray(
      ensureArray(item.availableLocationIds).concat(data.availableLocationIds)
    );
    item.fulfillableLocationIds = normalizeLocationIdArray(
      ensureArray(item.fulfillableLocationIds).concat(
        data.fulfillableLocationIds
      )
    );
    item.eligible3plLocationIds = normalizeLocationIdArray(
      ensureArray(item.eligible3plLocationIds).concat(
        data.eligible3plLocationIds
      )
    );

    item.warehouseAvailability = item.warehouseAvailability || {};
    Object.keys(data.warehouseAvailability || {}).forEach(function (locId) {
      if (item.warehouseAvailability[locId] === undefined) {
        item.warehouseAvailability[locId] = data.warehouseAvailability[locId];
      } else if (data.warehouseAvailability[locId] === true) {
        item.warehouseAvailability[locId] = true;
      }
    });

    var flags = buildAvailabilityFlags(item.availableLocationIds);

    if (item.availableInSpringville === undefined) {
      item.availableInSpringville = flags.availableInSpringville;
    } else if (flags.availableInSpringville) {
      item.availableInSpringville = true;
    }

    if (item.availableInGeorgia === undefined) {
      item.availableInGeorgia = flags.availableInGeorgia;
    } else if (flags.availableInGeorgia) {
      item.availableInGeorgia = true;
    }

    if (item.availableInDelaware === undefined) {
      item.availableInDelaware = flags.availableInDelaware;
    } else if (flags.availableInDelaware) {
      item.availableInDelaware = true;
    }

    if (!item.availabilitySource && source) {
      item.availabilitySource = source;
    }

    return item;
  }

  function getAvailabilityDataFromItemRecord(cartItem) {
    if (!cartItem || !cartItem.internalid) {
      return null;
    }

    var recType = mapItemType(cartItem.type || cartItem.itemtype);
    var qty = num(cartItem.quantity) || 1;
    var cacheKey = [String(cartItem.internalid), String(recType), qty].join(
      "|"
    );

    if (ITEM_AVAILABILITY_CACHE.hasOwnProperty(cacheKey)) {
      return ITEM_AVAILABILITY_CACHE[cacheKey];
    }

    var itemRec = loadItemRecordSafe(cartItem.internalid, recType);
    if (!itemRec) {
      ITEM_AVAILABILITY_CACHE[cacheKey] = null;
      return null;
    }

    var sublistCandidates = ["locations", "location"];
    var sublistId = "";
    var lineCount = 0;

    for (var i = 0; i < sublistCandidates.length; i += 1) {
      try {
        lineCount =
          itemRec.getLineCount({ sublistId: sublistCandidates[i] }) || 0;
        if (lineCount > 0) {
          sublistId = sublistCandidates[i];
          break;
        }
      } catch (_eSublist) {}
    }

    if (!sublistId || !lineCount) {
      ITEM_AVAILABILITY_CACHE[cacheKey] = null;
      return null;
    }

    var warehouseAvailability = {};
    var availableLocationIds = [];

    for (var line = 0; line < lineCount; line += 1) {
      var locationId = normalizeLocationId(
        getSublistValueFromCandidates(
          itemRec,
          sublistId,
          ["location", "locationid", "internalid"],
          line
        )
      );
      var quantityAvailable = num(
        getSublistValueFromCandidates(
          itemRec,
          sublistId,
          [
            "quantityavailable",
            "locationquantityavailable",
            "quantityonhand",
            "quantity"
          ],
          line
        )
      );
      var fulfillableFlag = getSublistValueFromCandidates(
        itemRec,
        sublistId,
        ["isfulfillable", "fulfillable", "available"],
        line
      );
      var isAvailable =
        !!locationId &&
        ((quantityAvailable > 0 && quantityAvailable >= qty) ||
          isTrueLike(fulfillableFlag));

      if (!locationId) {
        continue;
      }

      warehouseAvailability[locationId] = isAvailable;

      if (isAvailable) {
        availableLocationIds.push(locationId);
      }
    }

    availableLocationIds = normalizeLocationIdArray(availableLocationIds);

    if (!availableLocationIds.length && !objectHasKeys(warehouseAvailability)) {
      ITEM_AVAILABILITY_CACHE[cacheKey] = null;
      return null;
    }

    ITEM_AVAILABILITY_CACHE[cacheKey] = {
      availableLocationIds: availableLocationIds,
      fulfillableLocationIds: availableLocationIds.slice(),
      eligible3plLocationIds: availableLocationIds.filter(
        function (locationId) {
          return locationId !== LOCATION_IDS.SPRINGVILLE;
        }
      ),
      warehouseAvailability: warehouseAvailability,
      availabilitySource: "suitelet-item-record"
    };

    return ITEM_AVAILABILITY_CACHE[cacheKey];
  }

  function getDropShipDataFromItemRecord(cartItem) {
    if (!cartItem || !cartItem.internalid) {
      return null;
    }

    var recType = mapItemType(cartItem.type || cartItem.itemtype);
    var cacheKey = [
      "dropship",
      String(cartItem.internalid),
      String(recType)
    ].join("|");

    if (ITEM_AVAILABILITY_CACHE.hasOwnProperty(cacheKey)) {
      return ITEM_AVAILABILITY_CACHE[cacheKey];
    }

    var itemRec = loadItemRecordSafe(cartItem.internalid, recType);
    if (!itemRec) {
      ITEM_AVAILABILITY_CACHE[cacheKey] = null;
      return null;
    }

    var flag = itemRec.getValue({ fieldId: "isdropshipitem" });
    var isDrop =
      flag === true || flag === "T" || String(flag).toLowerCase() === "true";

    var vendorId = getPreferredVendorFromItem(itemRec) || null;
    var parentId = itemRec.getValue({ fieldId: "parent" }) || null;

    // Optional fallback: if child is not marked dropship, check parent too
    if (!isDrop && parentId) {
      try {
        var parentRec = record.load({
          type: recType,
          id: parentId,
          isDynamic: false
        });

        var parentFlag = parentRec.getValue({ fieldId: "isdropshipitem" });
        var parentIsDrop =
          parentFlag === true ||
          parentFlag === "T" ||
          String(parentFlag).toLowerCase() === "true";

        if (parentIsDrop) {
          isDrop = true;
          vendorId = getPreferredVendorFromItem(parentRec) || vendorId || null;
        }
      } catch (eParent) {
        try {
          log.error({
            title:
              "getDropShipDataFromItemRecord parent load error (parent " +
              parentId +
              ")",
            details: eParent
          });
        } catch (_eParentLog) {}
      }
    }

    ITEM_AVAILABILITY_CACHE[cacheKey] = {
      isDropShip: isDrop,
      preferredVendorId: vendorId
    };

    return ITEM_AVAILABILITY_CACHE[cacheKey];
  }

  function enrichCartItemsForDropShipPlanning(body) {
    var items = getCartItems(body);
    var summary = {
      itemsCount: items.length,
      detectedDropShipItems: 0,
      enrichedItems: 0,
      missingItems: 0
    };

    items.forEach(function (item) {
      if (!item || !item.internalid) {
        summary.missingItems += 1;
        return;
      }

      // Respect explicit payload flags first
      if (
        item.isDropShip === true ||
        item.dropShip === true ||
        item.isDropShip === "T" ||
        item.dropShip === "T"
      ) {
        item.isDropShip = true;
        summary.detectedDropShipItems += 1;
        return;
      }

      var derived = getDropShipDataFromItemRecord(item);
      if (!derived) {
        summary.missingItems += 1;
        return;
      }

      item.isDropShip = !!derived.isDropShip;

      if (derived.preferredVendorId && !item.preferredVendorId) {
        item.preferredVendorId = String(derived.preferredVendorId);
      }

      summary.enrichedItems += 1;

      if (item.isDropShip) {
        summary.detectedDropShipItems += 1;
      }
    });

    return summary;
  }

  function enrichCartItemsForOriginPlanning(body) {
    var items = getCartItems(body);
    var summary = {
      itemsCount: items.length,
      explicitItems: 0,
      enrichedItems: 0,
      missingItems: 0
    };

    items.forEach(function (item) {
      if (
        !item ||
        item.isDropShip === true ||
        item.dropShip === true ||
        item.isDropShip === "T" ||
        item.dropShip === "T"
      ) {
        summary.missingItems += 1;
        return;
      }

      if (hasExplicitAvailabilityData(item)) {
        summary.explicitItems += 1;
        return;
      }

      var derived = getAvailabilityDataFromItemRecord(item);
      if (derived) {
        mergeAvailabilityDataIntoItem(
          item,
          derived,
          derived.availabilitySource
        );
      }

      if (hasExplicitAvailabilityData(item)) {
        summary.explicitItems += 1;
        summary.enrichedItems += derived ? 1 : 0;
      } else {
        summary.missingItems += 1;
      }
    });

    return summary;
  }

  function itemAvailableAt(item, locationId) {
    return (
      getAvailableLocationIdsForItem(item).indexOf(String(locationId)) !== -1
    );
  }

  function itemHasSpringville(item) {
    return itemAvailableAt(item, LOCATION_IDS.SPRINGVILLE);
  }

  function get3plCandidateLocationIds(item) {
    return getAvailableLocationIdsForItem(item).filter(function (locId) {
      return locId !== LOCATION_IDS.SPRINGVILLE;
    });
  }

  function itemHasAny3pl(item) {
    return get3plCandidateLocationIds(item).length > 0;
  }

  function allItemsHaveExplicitAvailability(items) {
    if (!items || !items.length) return false;

    for (var i = 0; i < items.length; i += 1) {
      if (!hasExplicitAvailabilityData(items[i])) {
        return false;
      }
    }

    return true;
  }

  function allItemsAvailableAt(items, locationId) {
    if (!items || !items.length) return false;

    for (var i = 0; i < items.length; i += 1) {
      if (!itemAvailableAt(items[i], locationId)) {
        return false;
      }
    }

    return true;
  }

  function allItemsHaveAny3pl(items) {
    if (!items || !items.length) return false;

    for (var i = 0; i < items.length; i += 1) {
      if (!itemHasAny3pl(items[i])) {
        return false;
      }
    }

    return true;
  }

  function getEligible3plsForWholeOrder(items) {
    var intersection = null;

    (items || []).forEach(function (item) {
      var candidates = get3plCandidateLocationIds(item);
      var lookup = {};
      var next = [];

      candidates.forEach(function (id) {
        lookup[String(id)] = true;
      });

      if (intersection === null) {
        intersection = candidates.slice();
        return;
      }

      intersection.forEach(function (id) {
        if (lookup[String(id)]) {
          next.push(String(id));
        }
      });

      intersection = next;
    });

    return intersection || [];
  }

  /**
   * "Mixed" means:
   * - at least one item has Springville availability
   * - at least one item has 3PL availability
   * - but there is no single common 3PL that can fulfill the whole order
   */
  function detectMixedSpringvilleAnd3pl(items) {
    var hasSpringville = false;
    var has3pl = false;
    var eligible3pls = getEligible3plsForWholeOrder(items);

    (items || []).forEach(function (item) {
      if (itemHasSpringville(item)) {
        hasSpringville = true;
      }
      if (itemHasAny3pl(item)) {
        has3pl = true;
      }
    });

    return hasSpringville && has3pl && !eligible3pls.length;
  }

  function chooseNearest3pl(destinationState, eligibleLocationIds) {
    var candidates = normalizeLocationIdArray(eligibleLocationIds);
    var preferred = DEST_STATE_TO_3PL_PRIORITY[destinationState] || [];

    for (var i = 0; i < preferred.length; i += 1) {
      if (candidates.indexOf(preferred[i]) !== -1) {
        return preferred[i];
      }
    }

    return candidates.length ? candidates[0] : "";
  }

  function buildDefaultOriginPlan(debug) {
    return {
      mode: "per-item-origin",
      ruleApplied: ORIGIN_RULES.DEFAULT,
      forcedLocationId: "",
      forcedOrigin: null,
      debug: debug || {}
    };
  }

  function buildForcedSingleOriginPlan(locationId, ruleApplied, debug) {
    var origin = buildOriginFromLocation(locationId);

    if (!origin) {
      return buildDefaultOriginPlan(debug);
    }

    return {
      mode: "forced-single-origin",
      ruleApplied: ruleApplied || ORIGIN_RULES.DEFAULT,
      forcedLocationId: String(locationId || ""),
      forcedOrigin: origin,
      debug: debug || {}
    };
  }

  function buildOriginPlan(body) {
    var items = getCartItems(body);
    var destinationState = getDestinationState(body);
    var packaging = countPackaging(items);
    var hasDropShipItems = (items || []).some(function (item) {
      return !!(
        item &&
        (item.isDropShip === true ||
          item.dropShip === true ||
          item.isDropShip === "T" ||
          item.dropShip === "T")
      );
    });
    var explicitAvailability = allItemsHaveExplicitAvailability(items);
    var eligible3pls = explicitAvailability
      ? getEligible3plsForWholeOrder(items)
      : [];
    var mixedSpringville3pl = explicitAvailability
      ? detectMixedSpringvilleAnd3pl(items)
      : false;

    var debug = {
      destinationState: destinationState,
      itemsCount: items.length,
      explicitAvailability: explicitAvailability,
      hasDropShipItems: hasDropShipItems,
      drums: packaging.drums,
      pails: packaging.pails,
      eligible3pls: eligible3pls,
      mixedSpringville3pl: mixedSpringville3pl
    };

    if (!items.length) {
      return buildDefaultOriginPlan(debug);
    }

    if (hasDropShipItems) {
      return buildDefaultOriginPlan(debug);
    }

    // No explicit warehouse availability for all items:
    // do NOT force a rule; fall back to your current origin logic.
    if (!explicitAvailability) {
      return buildDefaultOriginPlan(debug);
    }

    // 1) Florida rule
    if (destinationState === "FL") {
      if (allItemsAvailableAt(items, LOCATION_IDS.GEORGIA)) {
        return buildForcedSingleOriginPlan(
          LOCATION_IDS.GEORGIA,
          ORIGIN_RULES.FL_GEORGIA,
          debug
        );
      }

      if (
        !allItemsAvailableAt(items, LOCATION_IDS.GEORGIA) &&
        allItemsAvailableAt(items, LOCATION_IDS.DELAWARE)
      ) {
        return buildForcedSingleOriginPlan(
          LOCATION_IDS.DELAWARE,
          ORIGIN_RULES.FL_DELAWARE,
          debug
        );
      }
    }

    // 2) Mixed 3PL + Springville => Springville
    if (mixedSpringville3pl) {
      return buildForcedSingleOriginPlan(
        LOCATION_IDS.SPRINGVILLE,
        ORIGIN_RULES.MIXED_TO_SPRINGVILLE,
        debug
      );
    }

    // 3) All items in 3PL but over drum threshold => Springville
    if (allItemsHaveAny3pl(items) && packaging.drums > 20) {
      return buildForcedSingleOriginPlan(
        LOCATION_IDS.SPRINGVILLE,
        ORIGIN_RULES.OVER_DRUM_THRESHOLD,
        debug
      );
    }

    // 4) All items in 3PL but over pail threshold => Springville
    if (allItemsHaveAny3pl(items) && packaging.pails > 32) {
      return buildForcedSingleOriginPlan(
        LOCATION_IDS.SPRINGVILLE,
        ORIGIN_RULES.OVER_PAIL_THRESHOLD,
        debug
      );
    }

    // 5) All items available from one common 3PL => nearest eligible 3PL
    if (eligible3pls.length) {
      var chosen3pl = chooseNearest3pl(destinationState, eligible3pls);
      if (chosen3pl) {
        return buildForcedSingleOriginPlan(
          chosen3pl,
          ORIGIN_RULES.NEAREST_3PL,
          debug
        );
      }
    }

    return buildDefaultOriginPlan(debug);
  }

  function groupPackagesByPlan(body, plan) {
    if (!plan || plan.mode !== "forced-single-origin" || !plan.forcedOrigin) {
      return groupPackagesByOrigin(body);
    }

    var list = body.PackageDetailsList || [];
    var buckets = {};
    var key = getOriginGroupKey(plan.forcedOrigin);

    buckets[key] = {
      Origin: plan.forcedOrigin,
      Packages: [],
      dropShip: false
    };

    for (var i = 0; i < list.length; i++) {
      var pkg = list[i];
      var item = (body.cartSnapshot && body.cartSnapshot.items[i]) || {};

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
        service: "RDT Pacejet Rates Suitelet (v5)"
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

    var dropShipSummary = enrichCartItemsForDropShipPlanning(body);

    try {
      log.audit({
        title: "Pacejet dropship enrichment",
        details: dropShipSummary
      });
    } catch (_eDropShipLog) {}

    var enrichmentSummary = enrichCartItemsForOriginPlanning(body);

    try {
      log.audit({
        title: "Pacejet origin availability enrichment",
        details: enrichmentSummary
      });
    } catch (_eAvailabilityLog) {}

    var originPlan = buildOriginPlan(body);

    try {
      log.audit({
        title: "Pacejet origin plan",
        details: {
          mode: originPlan.mode,
          ruleApplied: originPlan.ruleApplied,
          forcedLocationId: originPlan.forcedLocationId || "",
          debug: originPlan.debug || {}
        }
      });
    } catch (_eOriginPlanLog) {}

    var groups = groupPackagesByPlan(body, originPlan);
    var results = {
      ok: true,
      origins: {},
      originPlan: {
        mode: originPlan.mode,
        ruleApplied: originPlan.ruleApplied,
        forcedLocationId: originPlan.forcedLocationId || ""
      }
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
