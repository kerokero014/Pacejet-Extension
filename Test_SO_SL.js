/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/record", "N/log", "N/runtime", "N/https"], function (
  record,
  log,
  runtime,
  https
) {
  "use strict";

  var BODY_FIELDS = {
    amount: "custbody_rdt_pacejet_amount",
    carrier: "custbody_rdt_pj_carrier_name",
    service: "custbody_rdt_pj_service_name",
    originKey: "custbody_rdt_pj_origin_key",
    transitDays: "custbody_rdt_pj_transit_days",
    estimatedArrivalDate: "custbody_rdt_pj_est_arrival_date",
    quoteJson: "custbody_rdt_pj_quote_json",

    //Accessorials
    callPriorTruck: "custbody_callpriortruck",
    jobsite: "custbody_jobsite",
    liftgateTruck: "custbody_liftgatetruck",
    residential: "custbody_residential",
    appointmentTruck: "custbody_appointmenttruck",
    selfStorage: "custbody_selfstorage",
    schoolDelivery: "custbody_school_delivery",
    insideDelivery: "custbody_inside_delivery",
    accessHazmatParcel: "custbody_access_hazmat_parcel",
    dangerousGoods: "custbody_dangerous_goods",
    noneAdditionalFeesMayApply: "custbody_none_additional_fees_may_app"
  };
  var ACCESSORIAL_SERVICE_CODES = {
    callPriorTruck: "CALL_PRIOR",
    jobsite: "JOB_SITE",
    liftgateTruck: "LIFT_GATE",
    residential: "RESIDENTIAL",
    appointmentTruck: "APPOINTMENT",
    selfStorage: "SELF_STORAGE",
    schoolDelivery: "SCHOOL",
    insideDelivery: "INSIDE_DELIVERY",
    accessHazmatParcel: "HAZMAT_PARCEL",
    dangerousGoods: "DANGEROUS_GOODS"
  };
  var DEFAULT_PACEJET_API_URL = "https://shipapi.pacejet.cc";
  var DEFAULT_PACEJET_LOCATION = "Curecrete";
  var DEFAULT_PACEJET_API_KEY = "66f5540a-9a81-ebea-c232-da7c4c18d229";
  var LOCATION_ORIGIN_CACHE = {};
  var ITEM_DETAIL_CACHE = {};

  // ─── DIAGNOSTIC: tracks what modified the record between load and save ───
  var diagnosticLog = [];

  function diagLog(stage, detail) {
    diagnosticLog.push({ stage: stage, detail: detail });
    log.debug("DIAG [" + stage + "]", detail);
  }

  function writeJson(response, status, payload) {
    response.statusCode = status;
    response.setHeader({
      name: "Content-Type",
      value: "application/json; charset=utf-8"
    });
    response.write(JSON.stringify(payload));
  }

  function asNumber(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function asString(value) {
    return value == null ? "" : String(value);
  }

  function asBoolean(value) {
    return (
      value === true ||
      value === "T" ||
      value === "true" ||
      value === "on" ||
      value === 1 ||
      value === "1"
    );
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (_e) {
      return fallback;
    }
  }

  function normalizeTotals(value) {
    var totals = value && typeof value === "object" ? value : null;
    if (!totals) return null;
    return {
      subtotal: asNumber(totals.subtotal),
      shipping: asNumber(totals.shipping),
      tax: asNumber(totals.tax),
      total: asNumber(totals.total)
    };
  }

  function buildTotalsFromSnapshot(snapshot) {
    var data = snapshot && typeof snapshot === "object" ? snapshot : {};
    return {
      subtotal: asNumber(data.subtotal),
      shipping: asNumber(data.shippingcost),
      tax: asNumber(data.taxtotal),
      total: asNumber(data.total)
    };
  }

  function almostEqual(left, right) {
    return Math.abs(asNumber(left) - asNumber(right)) < 0.01;
  }

  function chooseResponseTotals(finalSnapshot, requestedTotals, amount) {
    var snapshotTotals = buildTotalsFromSnapshot(finalSnapshot);
    if (
      requestedTotals &&
      almostEqual(snapshotTotals.subtotal, requestedTotals.subtotal) &&
      almostEqual(snapshotTotals.shipping, amount) &&
      almostEqual(requestedTotals.shipping, amount) &&
      almostEqual(snapshotTotals.tax, requestedTotals.tax) &&
      almostEqual(snapshotTotals.total, requestedTotals.total)
    ) {
      return {
        subtotal: requestedTotals.subtotal,
        shipping: requestedTotals.shipping,
        tax: requestedTotals.tax,
        total: requestedTotals.total
      };
    }
    return snapshotTotals;
  }

  function readParam(id, dflt) {
    try {
      var value = runtime.getCurrentScript().getParameter({ name: id });
      return value !== null && value !== undefined && value !== ""
        ? value
        : dflt;
    } catch (_e) {
      return dflt;
    }
  }

  function safeJsonStringify(value) {
    try {
      return JSON.stringify(value);
    } catch (_e) {
      return "";
    }
  }

  function getWorkbenchConfig() {
    return {
      enabled: asBoolean(readParam("custscript_rdt_pj_enable_ship_export", "T")),
      apiUrl: String(
        readParam("custscript_rdt_pj_api_url", DEFAULT_PACEJET_API_URL)
      ).replace(/\/+$/, ""),
      apiVersion: String(readParam("custscript_rdt_pj_ship_api_version", "3.5")),
      location: String(
        readParam("custscript_rdt_pj_location", DEFAULT_PACEJET_LOCATION)
      ),
      apiKey: String(
        readParam("custscript_rdt_pj_api_key", DEFAULT_PACEJET_API_KEY)
      ),
      locationMap: safeJsonParse(
        readParam("custscript_rdt_pj_location_map", "{}"),
        {}
      )
    };
  }

  function mapNsLocationToPacejetFacility(nsLocationId, mapping) {
    var key = asString(nsLocationId).trim();
    if (mapping && mapping[key]) {
      return String(mapping[key]);
    }
    return key;
  }

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
    var lastError = null;
    var attempt = 0;

    while (attempt < attempts) {
      attempt += 1;
      try {
        var response = https.post(options);
        if (response.code >= 200 && response.code < 300) {
          return response;
        }
        if (!isTransient(response.code)) {
          throw new Error("HTTP " + response.code + ": " + (response.body || ""));
        }
      } catch (e) {
        lastError = e;
      }

      try {
        runtime.sleep(attempt * 250);
      } catch (_sleepErr) {}
    }

    throw lastError || new Error("Pacejet shipment export failed");
  }

  function getRecordTextSafe(rec, fieldId) {
    try {
      return rec.getText({ fieldId: fieldId });
    } catch (_e) {
      return "";
    }
  }

  function getSubrecordValueSafe(subrecord, fieldId) {
    try {
      return subrecord.getValue({ fieldId: fieldId });
    } catch (_e) {
      return "";
    }
  }

  function getSublistTextSafe(rec, sublistId, fieldId, line) {
    try {
      return rec.getSublistText({
        sublistId: sublistId,
        fieldId: fieldId,
        line: line
      });
    } catch (_e) {
      return "";
    }
  }

  function sanitizeIdPart(value) {
    return asString(value)
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60);
  }

  function buildDestinationFromSalesOrder(so) {
    var destination = {
      CompanyName: asString(so.getValue({ fieldId: "shipcompany" })) || "",
      Address1: "",
      Address2: "",
      City: "",
      StateOrProvinceCode: "",
      PostalCode: "",
      CountryCode: "",
      ContactName: "",
      Email: asString(so.getValue({ fieldId: "email" })) || "",
      Phone: ""
    };

    try {
      var shipAddress = so.getSubrecord({ fieldId: "shippingaddress" });
      destination.Address1 = asString(getSubrecordValueSafe(shipAddress, "addr1"));
      destination.Address2 = asString(getSubrecordValueSafe(shipAddress, "addr2"));
      destination.City = asString(getSubrecordValueSafe(shipAddress, "city"));
      destination.StateOrProvinceCode = asString(
        getSubrecordValueSafe(shipAddress, "state") ||
          getSubrecordValueSafe(shipAddress, "dropdownstate")
      );
      destination.PostalCode = asString(
        getSubrecordValueSafe(shipAddress, "zip") ||
          getSubrecordValueSafe(shipAddress, "postalcode")
      );
      destination.CountryCode = asString(
        getSubrecordValueSafe(shipAddress, "country")
      );
      destination.Phone = asString(
        getSubrecordValueSafe(shipAddress, "addrphone")
      );
      destination.ContactName = asString(
        getSubrecordValueSafe(shipAddress, "addressee") ||
          getSubrecordValueSafe(shipAddress, "attention")
      );
      if (!destination.CompanyName) {
        destination.CompanyName = destination.ContactName;
      }
    } catch (_e) {}

    if (!destination.ContactName) {
      destination.ContactName =
        asString(so.getValue({ fieldId: "shipattention" })) ||
        destination.CompanyName ||
        "Ship To";
    }

    if (!destination.CompanyName) {
      destination.CompanyName = destination.ContactName || "Ship To";
    }

    return destination;
  }

  function buildOriginFromLocation(locationId, config) {
    var key = asString(locationId).trim();

    if (!key) {
      return null;
    }

    if (LOCATION_ORIGIN_CACHE[key]) {
      return Object.assign({}, LOCATION_ORIGIN_CACHE[key]);
    }

    var facilityCode = mapNsLocationToPacejetFacility(key, config.locationMap);
    var origin = {
      LocationType: "Facility",
      LocationSite: "MAIN",
      LocationCode: facilityCode
    };

    var locationRec = record.load({
      type: record.Type.LOCATION,
      id: key,
      isDynamic: false
    });
    var mainAddress = null;

    try {
      mainAddress = locationRec.getSubrecord({ fieldId: "mainaddress" });
    } catch (_addressErr) {
      mainAddress = null;
    }

    origin.CompanyName = asString(locationRec.getValue({ fieldId: "name" }));

    if (mainAddress) {
      origin.Address1 = asString(getSubrecordValueSafe(mainAddress, "addr1"));
      origin.Address2 = asString(getSubrecordValueSafe(mainAddress, "addr2"));
      origin.City = asString(getSubrecordValueSafe(mainAddress, "city"));
      origin.StateOrProvinceCode = asString(
        getSubrecordValueSafe(mainAddress, "state") ||
          getSubrecordValueSafe(mainAddress, "dropdownstate")
      );
      origin.PostalCode = asString(getSubrecordValueSafe(mainAddress, "zip"));
      origin.CountryCode = asString(getSubrecordValueSafe(mainAddress, "country"));
      origin.Phone = asString(getSubrecordValueSafe(mainAddress, "addrphone"));
    }

    LOCATION_ORIGIN_CACHE[key] = origin;
    return Object.assign({}, origin);
  }

  function normalizeOriginFromQuote(origin, fallbackLocationId, config) {
    var quoteOrigin = origin && origin.Origin ? origin.Origin : {};
    var locationCode = asString(
      quoteOrigin.LocationCode || fallbackLocationId
    ).trim();
    var normalized = buildOriginFromLocation(locationCode, config) || {};

    Object.keys(quoteOrigin || {}).forEach(function (key) {
      if (
        quoteOrigin[key] !== null &&
        quoteOrigin[key] !== undefined &&
        quoteOrigin[key] !== ""
      ) {
        normalized[key] = quoteOrigin[key];
      }
    });

    if (!normalized.LocationCode && locationCode) {
      normalized.LocationCode = mapNsLocationToPacejetFacility(
        locationCode,
        config.locationMap
      );
    }

    return normalized;
  }

  function buildShipmentServicesCodesFromSalesOrder(so) {
    var codes = [];

    Object.keys(ACCESSORIAL_SERVICE_CODES).forEach(function (key) {
      var fieldId = BODY_FIELDS[key];
      if (fieldId && asBoolean(so.getValue({ fieldId: fieldId }))) {
        codes.push({ Code: ACCESSORIAL_SERVICE_CODES[key] });
      }
    });

    return codes;
  }

  function mapItemType(code) {
    switch (String(code || "").toLowerCase()) {
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

  function loadItemExportDetails(itemId, itemType) {
    var key = String(itemType || "") + ":" + String(itemId || "");
    if (ITEM_DETAIL_CACHE[key]) {
      return ITEM_DETAIL_CACHE[key];
    }

    var details = {
      sku: String(itemId || ""),
      length: 0,
      width: 0,
      height: 0,
      weight: 0
    };

    try {
      var itemRec = record.load({
        type: mapItemType(itemType),
        id: itemId,
        isDynamic: false
      });

      details.sku =
        asString(itemRec.getValue({ fieldId: "itemid" })) || details.sku;
      details.length = asNumber(
        itemRec.getValue({ fieldId: "custitem_pacejet_item_length" })
      );
      details.width = asNumber(
        itemRec.getValue({ fieldId: "custitem_pacejet_item_width" })
      );
      details.height = asNumber(
        itemRec.getValue({ fieldId: "custitem_pacejet_item_height" })
      );
      details.weight = asNumber(itemRec.getValue({ fieldId: "weight" }));
    } catch (e) {
      log.error("Workbench item detail load failed", {
        itemId: itemId,
        itemType: itemType,
        message: e.message || String(e)
      });
    }

    ITEM_DETAIL_CACHE[key] = details;
    return details;
  }

  function addDimensions(target, length, width, height) {
    if (length > 0 && width > 0 && height > 0) {
      target.Dimensions = {
        Length: String(length),
        Width: String(width),
        Height: String(height),
        Units: "IN"
      };
    }
  }

  function getPositiveLineNumber(so, line, fieldIds) {
    var i;
    var value;

    for (i = 0; i < fieldIds.length; i += 1) {
      value = asNumber(
        getSublistValueSafe(so, "item", fieldIds[i], line)
      );
      if (value > 0) {
        return value;
      }
    }

    return 0;
  }

  function buildPackageDetailsFromSalesOrder(so) {
    var packages = [];
    var skipped = [];
    var count = Number(so.getLineCount({ sublistId: "item" }) || 0);
    var line;

    for (line = 0; line < count; line += 1) {
      var itemId = so.getSublistValue({
        sublistId: "item",
        fieldId: "item",
        line: line
      });
      var quantity = asNumber(
        so.getSublistValue({
          sublistId: "item",
          fieldId: "quantity",
          line: line
        })
      );

      if (!itemId || quantity <= 0) {
        continue;
      }

      var itemType =
        so.getSublistValue({
          sublistId: "item",
          fieldId: "itemtype",
          line: line
        }) || "";
      var lineDescription =
        asString(
          so.getSublistValue({
            sublistId: "item",
            fieldId: "description",
            line: line
          })
        ) ||
        asString(getSublistTextSafe(so, "item", "item", line)) ||
        "Item " + String(itemId);
      var rate = asNumber(
        so.getSublistValue({
          sublistId: "item",
          fieldId: "rate",
          line: line
        })
      );
      var details = loadItemExportDetails(itemId, itemType);
      var unitWeight =
        getPositiveLineNumber(so, line, [
          "custcol_item_weight",
          "custcol_weight",
          "itemweight",
          "weight"
        ]) || details.weight;
      var packageWeight = unitWeight > 0 ? unitWeight * quantity : 0;
      var hasDimensions =
        details.length > 0 && details.width > 0 && details.height > 0;
      var hasWeight = packageWeight > 0;

      if (!hasDimensions && !hasWeight) {
        skipped.push({
          line: line,
          itemId: itemId,
          reason: "Missing package dimensions and weight"
        });
        continue;
      }

      var packageDetail = {
        PackageNumber: String(packages.length + 1),
        ProductDetailsList: [
          {
            Number: details.sku || String(itemId),
            Description: lineDescription,
            ExternalID: String(itemId),
            AutoPack: "true",
            Quantity: {
              Units: "EA",
              Value: String(quantity)
            }
          }
        ]
      };

      if (hasWeight) {
        packageDetail.Weight = String(packageWeight);
        packageDetail.ProductDetailsList[0].Weight = String(unitWeight);
      }

      if (rate > 0) {
        packageDetail.ProductDetailsList[0].Price = {
          Currency: "USD",
          Amount: rate
        };
      }

      addDimensions(
        packageDetail,
        details.length,
        details.width,
        details.height
      );
      addDimensions(
        packageDetail.ProductDetailsList[0],
        details.length,
        details.width,
        details.height
      );

      packages.push(packageDetail);
    }

    return {
      packages: packages,
      skippedLines: skipped
    };
  }

  function getSelectedOriginExports(so, quoteJson, resolvedLocationId, config) {
    var parsedQuote = safeJsonParse(quoteJson || "{}", {});
    var quoteOrigins = Array.isArray(parsedQuote.origins) ? parsedQuote.origins : [];
    var activeOrigins = quoteOrigins.filter(function (origin) {
      return !!origin;
    });
    var uniqueOriginKeys = {};
    var normalizedOrigins = [];
    var salesOrderLocationId = asString(
      resolvedLocationId || so.getValue({ fieldId: "location" })
    ).trim();

    if (!salesOrderLocationId) {
      return {
        ok: false,
        skipped: true,
        reason: "Sales Order location is required for Workbench export"
      };
    }

    if (!activeOrigins.length) {
      normalizedOrigins.push({
        originKey: asString(so.getValue({ fieldId: BODY_FIELDS.originKey })) || "",
        origin: buildOriginFromLocation(salesOrderLocationId, config),
        sourceOrigin: null
      });
      return {
        ok: true,
        origins: normalizedOrigins,
        source: "sales-order"
      };
    }

    activeOrigins.forEach(function (origin) {
      var key = asString(
        origin.originKey || (origin.Origin && origin.Origin.LocationCode)
      );
      if (!key) {
        key = "LOC_" + salesOrderLocationId;
      }
      if (!uniqueOriginKeys[key]) {
        uniqueOriginKeys[key] = true;
        normalizedOrigins.push({
          originKey: key,
          origin: normalizeOriginFromQuote(origin, salesOrderLocationId, config),
          sourceOrigin: origin
        });
      }
    });

    if (normalizedOrigins.length > 1) {
      return {
        ok: false,
        skipped: true,
        reason: "Multi-origin orders are not exported yet",
        origins: normalizedOrigins
      };
    }

    return {
      ok: true,
      origins: normalizedOrigins,
      source: "quote-json"
    };
  }

  function buildWorkbenchPayload(so, savedId, exportOrigin, packageResult, config) {
    var tranId = asString(so.getValue({ fieldId: "tranid" })) || String(savedId);
    var sourceOrigin = exportOrigin && exportOrigin.sourceOrigin;
    var rawRate = sourceOrigin && sourceOrigin.raw ? sourceOrigin.raw : null;
    var carrier = asString(
      (rawRate && (rawRate.carrierNumber || rawRate.carrier)) ||
        so.getValue({ fieldId: BODY_FIELDS.carrier })
    );
    var service = asString(
      (rawRate &&
        (rawRate.carrierClassOfServiceCode || rawRate.serviceCode)) ||
        so.getValue({ fieldId: BODY_FIELDS.service })
    );
    var estimatedArrivalDate = asString(
      so.getValue({ fieldId: BODY_FIELDS.estimatedArrivalDate })
    );
    var transactionId =
      sanitizeIdPart(tranId).slice(0, 15) ||
      sanitizeIdPart("SO" + String(savedId)).slice(0, 15);
    var payload = {
      Location: config.location,
      TransactionID: transactionId,
      ExternalTransactionID: String(savedId),
      ContextKey: tranId,
      Origin: exportOrigin.origin,
      Destination: buildDestinationFromSalesOrder(so),
      PackageDetailsList: packageResult.packages,
      ShipmentDetail: {
        WeightUOM: "LB"
      },
      CustomFields: [
        { Name: "SalesOrderInternalId", Value: String(savedId) },
        { Name: "SalesOrderNumber", Value: tranId },
        {
          Name: "PacejetAmount",
          Value: asString(so.getValue({ fieldId: BODY_FIELDS.amount }))
        },
        {
          Name: "OriginKey",
          Value: asString(exportOrigin.originKey || "")
        }
      ]
    };

    if (carrier || service || tranId) {
      payload.CarrierDetails = {
        Carrier: carrier,
        ClassOfService: service,
        ShipXRef: tranId
      };
    }

    if (estimatedArrivalDate) {
      payload.CustomFields.push({
        Name: "EstimatedArrivalDate",
        Value: estimatedArrivalDate
      });
    }

    var shipmentServices = buildShipmentServicesCodesFromSalesOrder(so);
    if (shipmentServices.length) {
      payload.ShipmentServicesCodes = shipmentServices;
    }

    return payload;
  }

  function getPacejetHeaders(config) {
    return {
      "Content-Type": "application/json",
      PacejetLocation: config.location,
      PacejetLicenseKey: config.apiKey
    };
  }

  function shipmentAlreadyExists(transactionId, config) {
    try {
      var response = https.get({
        url:
          config.apiUrl +
          "/Shipments/" +
          encodeURIComponent(transactionId) +
          "?api-version=" +
          encodeURIComponent(config.apiVersion),
        headers: getPacejetHeaders(config)
      });

      return {
        exists: response.code >= 200 && response.code < 300,
        code: response.code,
        body: response.body || ""
      };
    } catch (e) {
      return {
        exists: false,
        code: 0,
        error: e.message || String(e)
      };
    }
  }

  function exportSalesOrderToWorkbench(so, savedId, resolvedLocationId, quoteJson) {
    var config = getWorkbenchConfig();
    var originInfo;
    var packageResult;
    var payload;
    var existing;
    var response;

    if (!config.enabled) {
      return {
        attempted: false,
        skipped: true,
        reason: "Workbench export disabled"
      };
    }

    originInfo = getSelectedOriginExports(
      so,
      quoteJson,
      resolvedLocationId,
      config
    );
    if (!originInfo.ok) {
      return Object.assign(
        {
          attempted: false
        },
        originInfo
      );
    }

    packageResult = buildPackageDetailsFromSalesOrder(so);
    if (!packageResult.packages.length) {
      return {
        attempted: false,
        skipped: true,
        reason: "No exportable packages found on Sales Order",
        skippedLines: packageResult.skippedLines
      };
    }

    payload = buildWorkbenchPayload(
      so,
      savedId,
      originInfo.origins[0],
      packageResult,
      config
    );
    existing = shipmentAlreadyExists(payload.TransactionID, config);

    if (existing.exists) {
      return {
        attempted: true,
        skipped: true,
        reason: "Shipment already exists in Pacejet",
        transactionId: payload.TransactionID,
        responseCode: existing.code,
        skippedLines: packageResult.skippedLines
      };
    }

    response = postWithRetry(
      {
        url:
          config.apiUrl +
          "/Shipments?api-version=" +
          encodeURIComponent(config.apiVersion),
        headers: getPacejetHeaders(config),
        body: safeJsonStringify(payload)
      },
      3
    );

    return {
      attempted: true,
      ok: response.code >= 200 && response.code < 300,
      transactionId: payload.TransactionID,
      responseCode: response.code,
      source: originInfo.source,
      packageCount: packageResult.packages.length,
      skippedLines: packageResult.skippedLines,
      responseBodyPreview: asString(response.body).slice(0, 800)
    };
  }

  function logWorkbenchExportResult(savedId, tranId, result) {
    var payload = {
      salesOrderId: savedId,
      salesOrderNumber: tranId,
      result: result || null
    };

    if (!result) {
      log.error("Pacejet Workbench export unknown", payload);
      return;
    }

    if (result.ok) {
      log.audit("Pacejet Workbench export sent", payload);
      return;
    }

    if (result.skipped) {
      log.audit("Pacejet Workbench export skipped", payload);
      return;
    }

    log.error("Pacejet Workbench export failed", payload);
  }

  function getSublistValueSafe(rec, sublistId, fieldId, line) {
    try {
      return rec.getSublistValue({
        sublistId: sublistId,
        fieldId: fieldId,
        line: line
      });
    } catch (_e) {
      return null;
    }
  }

  function getValueSafe(rec, fieldId) {
    try {
      return rec.getValue({ fieldId: fieldId });
    } catch (_e) {
      return "UNAVAILABLE";
    }
  }

  function getTaxDetailsSnapshot(rec) {
    var lines = [];
    var count = 0;
    var i;
    try {
      count = rec.getLineCount({ sublistId: "taxdetails" }) || 0;
    } catch (_e) {
      return { available: false, count: 0, lines: [] };
    }
    for (i = 0; i < count; i += 1) {
      lines.push({
        line: i,
        taxdetailsreference: getSublistValueSafe(
          rec,
          "taxdetails",
          "taxdetailsreference",
          i
        ),
        linetype: getSublistValueSafe(rec, "taxdetails", "linetype", i),
        linename: getSublistValueSafe(rec, "taxdetails", "linename", i),
        netamount: getSublistValueSafe(rec, "taxdetails", "netamount", i),
        grossamount: getSublistValueSafe(rec, "taxdetails", "grossamount", i),
        taxtype: getSublistValueSafe(rec, "taxdetails", "taxtype", i),
        taxcode: getSublistValueSafe(rec, "taxdetails", "taxcode", i),
        taxbasis: getSublistValueSafe(rec, "taxdetails", "taxbasis", i),
        taxrate: getSublistValueSafe(rec, "taxdetails", "taxrate", i),
        taxamount: getSublistValueSafe(rec, "taxdetails", "taxamount", i)
      });
    }
    return { available: true, count: count, lines: lines };
  }

  function buildTaxFieldSnapshot(rec) {
    return {
      taxitem: getValueSafe(rec, "taxitem"),
      taxamount: getValueSafe(rec, "taxamount"),
      taxtotal: getValueSafe(rec, "taxtotal"),
      taxtotaloverride: getValueSafe(rec, "taxtotaloverride"),
      taxamountoverride: getValueSafe(rec, "taxamountoverride"),
      taxdetailsoverride: getValueSafe(rec, "taxdetailsoverride"),
      shippingtaxcode: getValueSafe(rec, "shippingtaxcode"),
      shippingtaxitem: getValueSafe(rec, "shippingtaxitem"),
      nexus: getValueSafe(rec, "nexus"),
      istaxable: getValueSafe(rec, "istaxable"),
      shipaddress: getValueSafe(rec, "shipaddress"),
      shipmethod: getValueSafe(rec, "shipmethod"),
      shippingcost: getValueSafe(rec, "shippingcost"),
      subtotal: getValueSafe(rec, "subtotal"),
      total: getValueSafe(rec, "total")
    };
  }

  // ─── DIAGNOSTIC: reads the record's last-modified timestamp directly ───
  function getRecordTimestamp(orderId) {
    try {
      var probe = record.load({
        type: record.Type.SALES_ORDER,
        id: orderId,
        isDynamic: false
      });
      return {
        lastmodifieddate:
          probe.getValue({ fieldId: "lastmodifieddate" }) || "N/A",
        lastmodifiedby: probe.getValue({ fieldId: "lastmodifiedby" }) || "N/A"
      };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  }

  // ─── DIAGNOSTIC: compare timestamps before and after a risky step ───
  function checkTimestampDrift(orderId, stage, baselineTimestamp) {
    var current = getRecordTimestamp(orderId);
    var drifted =
      current.lastmodifieddate !== baselineTimestamp.lastmodifieddate;

    diagLog("TIMESTAMP_CHECK [" + stage + "]", {
      baseline: baselineTimestamp,
      current: current,
      drifted: drifted
    });

    if (drifted) {
      log.error(
        "RCRD_CHANGED_DETECTED at [" + stage + "]",
        "Record was modified externally. Baseline: " +
          JSON.stringify(baselineTimestamp) +
          " | Current: " +
          JSON.stringify(current)
      );
    }

    return { current: current, drifted: drifted };
  }

  function tryCalculateTax(rec) {
    var result = { attempted: false, success: false, message: "" };
    if (!rec || typeof rec.executeMacro !== "function") {
      result.message = "executeMacro is not available on this record object.";
      return result;
    }
    result.attempted = true;
    try {
      rec.executeMacro({ id: "calculateTax" });
      result.success = true;
      result.message = "calculateTax macro executed successfully.";
    } catch (e) {
      result.message = e.message || String(e);
    }
    return result;
  }

  function buildTaxDiagnostics(
    finalSnapshot,
    requestedTotals,
    taxOverrideResults,
    calculateTaxResult,
    taxDetailsBeforeSave,
    taxDetailsAfterSave,
    taxFieldSnapshot
  ) {
    var snapshotTotals = buildTotalsFromSnapshot(finalSnapshot);
    var requested = requestedTotals || null;
    var mismatch =
      !!requested &&
      (Math.abs(snapshotTotals.tax - requested.tax) >= 0.01 ||
        Math.abs(snapshotTotals.total - requested.total) >= 0.01);

    return {
      requestedTotals: requested,
      snapshotTotals: snapshotTotals,
      overrideAttempts: taxOverrideResults || {},
      calculateTax: calculateTaxResult || null,
      taxDetailsBeforeSave: taxDetailsBeforeSave || null,
      taxDetailsAfterSave: taxDetailsAfterSave || null,
      taxFieldSnapshot: taxFieldSnapshot || null,
      mismatch: mismatch,
      message: mismatch
        ? "Sales Order tax/total did not persist to the requested values after save."
        : "Sales Order tax/total matches requested values after save."
    };
  }

  function setBoolean(rec, fieldId, value) {
    rec.setValue({ fieldId: fieldId, value: asBoolean(value) });
  }

  function maybeSet(rec, fieldId, value) {
    if (value === "" || value == null) return;
    rec.setValue({ fieldId: fieldId, value: value });
  }

  function maybeSetSelect(rec, fieldId, value, results) {
    var textValue = asString(value).trim();
    if (!textValue) return false;
    try {
      rec.setValue({ fieldId: fieldId, value: Number(textValue) });
      if (results) results[fieldId] = textValue;
      return true;
    } catch (e) {
      if (results) results[fieldId] = "FAILED: " + (e.message || String(e));
      return false;
    }
  }

  function extractLocationIdFromOriginKey(originKey) {
    var value = asString(originKey).trim();
    var locMatch = value.match(/^LOC_(\d+)$/i);
    var mainMatch = value.match(/^MAIN\|(\d+)$/i);
    var facilityMatch = value.match(/^FACILITY\|MAIN\|(\d+)$/i);
    var trailingIdMatch = value.match(/\|(\d+)$/);
    if (locMatch) return locMatch[1];
    if (mainMatch) return mainMatch[1];
    if (facilityMatch) return facilityMatch[1];
    if (trailingIdMatch) return trailingIdMatch[1];
    return "";
  }

  function collectWarehouseLocationIds(origins) {
    var ids = [];
    if (!Array.isArray(origins)) return ids;
    origins.forEach(function (origin) {
      var locationId = "";
      if (!origin || origin.dropShip) return;
      locationId = extractLocationIdFromOriginKey(origin.originKey);
      if (
        !locationId &&
        origin.Origin &&
        asString(origin.Origin.LocationType).toUpperCase() === "FACILITY"
      ) {
        locationId = asString(origin.Origin.LocationCode).trim();
      }
      if (locationId && ids.indexOf(locationId) === -1) ids.push(locationId);
    });
    return ids;
  }

  function resolveSalesOrderLocationId(data, quoteJson) {
    var parsedQuote = safeJsonParse(quoteJson || "{}", {});
    var originIds = collectWarehouseLocationIds(parsedQuote.origins);
    var directLocationId = asString(data.locationId).trim();
    var fallbackLocationId = extractLocationIdFromOriginKey(data.originKey);
    if (/^\d+$/.test(directLocationId)) return directLocationId;
    if (originIds.length === 1) return originIds[0];
    if (originIds.length > 1) return "";
    return fallbackLocationId;
  }

  function buildLocationDiagnostics(
    data,
    quoteJson,
    resolvedLocationId,
    setResult
  ) {
    var parsedQuote = safeJsonParse(quoteJson || "{}", {});
    var quoteOrigins = Array.isArray(parsedQuote.origins)
      ? parsedQuote.origins
      : [];
    return {
      requestLocationId: asString(data.locationId).trim(),
      requestOriginKey: asString(data.originKey).trim(),
      quoteOriginCount: quoteOrigins.length,
      quoteOriginKeys: quoteOrigins.map(function (origin) {
        return origin && origin.originKey ? String(origin.originKey) : "";
      }),
      quoteLocationCodes: quoteOrigins
        .map(function (origin) {
          return origin && origin.Origin && origin.Origin.LocationCode != null
            ? String(origin.Origin.LocationCode)
            : "";
        })
        .filter(function (value) {
          return !!value;
        }),
      resolvedLocationId: asString(resolvedLocationId).trim(),
      setResult: setResult || {}
    };
  }

  function buildSnapshot(so) {
    return {
      id: so.id || "",
      tranid: so.getValue({ fieldId: "tranid" }) || "",
      location: so.getValue({ fieldId: "location" }) || "",
      shipmethod: so.getValue({ fieldId: "shipmethod" }) || "",
      subtotal: Number(so.getValue({ fieldId: "subtotal" }) || 0),
      shippingcost: Number(so.getValue({ fieldId: "shippingcost" }) || 0),
      taxtotal: Number(so.getValue({ fieldId: "taxtotal" }) || 0),
      total: Number(so.getValue({ fieldId: "total" }) || 0),
      pacejetAmount: so.getValue({ fieldId: BODY_FIELDS.amount }) || "",
      carrier: so.getValue({ fieldId: BODY_FIELDS.carrier }) || "",
      service: so.getValue({ fieldId: BODY_FIELDS.service }) || "",
      callPriorTruck:
        so.getValue({ fieldId: BODY_FIELDS.callPriorTruck }) || false,
      jobsite: so.getValue({ fieldId: BODY_FIELDS.jobsite }) || false,
      liftgateTruck:
        so.getValue({ fieldId: BODY_FIELDS.liftgateTruck }) || false,
      residential: so.getValue({ fieldId: BODY_FIELDS.residential }) || false,
      appointmentTruck:
        so.getValue({ fieldId: BODY_FIELDS.appointmentTruck }) || false,
      selfStorage: so.getValue({ fieldId: BODY_FIELDS.selfStorage }) || false,
      schoolDelivery:
        so.getValue({ fieldId: BODY_FIELDS.schoolDelivery }) || false,
      insideDelivery:
        so.getValue({ fieldId: BODY_FIELDS.insideDelivery }) || false,
      accessHazmatParcel:
        so.getValue({ fieldId: BODY_FIELDS.accessHazmatParcel }) || false,
      dangerousGoods:
        so.getValue({ fieldId: BODY_FIELDS.dangerousGoods }) || false,
      noneAdditionalFeesMayApply:
        so.getValue({ fieldId: BODY_FIELDS.noneAdditionalFeesMayApply }) ||
        false
    };
  }

  function trySetValue(rec, fieldId, value, results) {
    try {
      rec.setValue({ fieldId: fieldId, value: value });
      if (results) results[fieldId] = value;
      return true;
    } catch (e) {
      if (results) results[fieldId] = "FAILED: " + (e.message || String(e));
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // applyFieldsToRecord
  // Extracted so the same field-setting logic can be reused on retry without
  // duplicating code. Every setValue that touches the Sales Order lives here.
  // ─────────────────────────────────────────────────────────────────────────
  function applyFieldsToRecord(
    so,
    data,
    shipmethod,
    amount,
    quoteJson,
    resolvedLocationId,
    requestedTotals,
    taxOverrideResults
  ) {
    so.setValue({ fieldId: "shipmethod", value: shipmethod });
    so.setValue({ fieldId: "shippingcost", value: amount });

    maybeSet(so, BODY_FIELDS.amount, amount);
    maybeSet(so, BODY_FIELDS.carrier, asString(data.carrier));
    maybeSet(so, BODY_FIELDS.service, asString(data.service));
    maybeSet(so, BODY_FIELDS.originKey, asString(data.originKey));
    maybeSet(so, BODY_FIELDS.transitDays, asString(data.transitDays));
    maybeSet(
      so,
      BODY_FIELDS.estimatedArrivalDate,
      asString(data.estimatedArrivalDate)
    );

    setBoolean(so, BODY_FIELDS.callPriorTruck, data.callPriorTruck);
    setBoolean(so, BODY_FIELDS.jobsite, data.jobsite);
    setBoolean(so, BODY_FIELDS.liftgateTruck, data.liftgateTruck);
    setBoolean(so, BODY_FIELDS.residential, data.residential);
    setBoolean(so, BODY_FIELDS.appointmentTruck, data.appointmentTruck);
    setBoolean(so, BODY_FIELDS.selfStorage, data.selfStorage);
    setBoolean(so, BODY_FIELDS.schoolDelivery, data.schoolDelivery);
    setBoolean(so, BODY_FIELDS.insideDelivery, data.insideDelivery);
    setBoolean(so, BODY_FIELDS.accessHazmatParcel, data.accessHazmatParcel);
    setBoolean(so, BODY_FIELDS.dangerousGoods, data.dangerousGoods);
    setBoolean(
      so,
      BODY_FIELDS.noneAdditionalFeesMayApply,
      data.noneAdditionalFeesMayApply
    );

    if (quoteJson.length > 3900) quoteJson = quoteJson.slice(0, 3900);
    maybeSet(so, BODY_FIELDS.quoteJson, quoteJson);
    maybeSetSelect(so, "location", resolvedLocationId, {});

    // Reset tax override first, then apply if needed
    try {
      so.setValue({ fieldId: "taxdetailsoverride", value: false });
    } catch (_ignore) {}

    if (requestedTotals) {
      trySetValue(so, "taxdetailsoverride", true, taxOverrideResults);
      trySetValue(
        so,
        "taxtotaloverride",
        requestedTotals.tax,
        taxOverrideResults
      );
      trySetValue(
        so,
        "taxamountoverride",
        requestedTotals.tax,
        taxOverrideResults
      );
    }
  }

  function onRequest(context) {
    var req = context.request;
    var res = context.response;

    if (req.method === "GET") {
      return writeJson(res, 200, {
        ok: true,
        message: "Pacejet test apply suitelet is reachable"
      });
    }

    if (req.method !== "POST") {
      return writeJson(res, 405, { ok: false, error: "POST required" });
    }

    var data = {};
    try {
      data = JSON.parse(req.body || "{}");
    } catch (e) {
      return writeJson(res, 400, { ok: false, error: "Invalid JSON" });
    }

    var orderId = asString(data.orderId).trim();
    var shipmethod = asString(data.shipmethod).trim();
    var amount = asNumber(data.pacejetAmount);
    var requestedTotals = normalizeTotals(data.totals);
    var taxOverrideResults = {};
    var calculateTaxResult = null;
    var taxDetailsBeforeSave = null;
    var taxDetailsAfterSave = null;
    var taxFieldSnapshot = null;
    var locationSetResults = {};

    if (!/^\d+$/.test(orderId)) {
      return writeJson(res, 400, {
        ok: false,
        error: "Valid numeric orderId is required"
      });
    }
    if (!shipmethod) {
      return writeJson(res, 400, {
        ok: false,
        error: "shipmethod is required"
      });
    }
    if (amount <= 0) {
      return writeJson(res, 400, {
        ok: false,
        error: "pacejetAmount must be > 0"
      });
    }

    try {
      var quoteJson = asString(data.quoteJson);
      var resolvedLocationId = resolveSalesOrderLocationId(data, quoteJson);

      // ── DIAGNOSTIC STEP 1: Capture baseline timestamp right after load ──
      var so = record.load({
        type: record.Type.SALES_ORDER,
        id: orderId,
        isDynamic: true
      });

      var baselineTimestamp = getRecordTimestamp(orderId);
      diagLog("LOAD", {
        orderId: orderId,
        timestamp: baselineTimestamp
      });

      log.audit("Pacejet test apply - before", buildSnapshot(so));

      // ── Apply all field changes ──
      applyFieldsToRecord(
        so,
        data,
        shipmethod,
        amount,
        quoteJson,
        resolvedLocationId,
        requestedTotals,
        taxOverrideResults
      );

      // ── DIAGNOSTIC STEP 2: Check if fields alone caused a drift ──
      checkTimestampDrift(orderId, "AFTER_SETVALUE", baselineTimestamp);

      // ── DIAGNOSTIC STEP 3: calculateTax — most likely culprit ──
      // Check timestamp before and after to confirm if THIS is what triggers
      // the record change that causes RCRD_HAS_BEEN_CHANGED on save.
      diagLog("PRE_CALCULATE_TAX", { requestedTotals: requestedTotals });
      calculateTaxResult = tryCalculateTax(so);
      diagLog("POST_CALCULATE_TAX", { result: calculateTaxResult });

      var afterTaxTimestamp = checkTimestampDrift(
        orderId,
        "AFTER_CALCULATE_TAX",
        baselineTimestamp
      );

      // ── DIAGNOSTIC STEP 4: If calculateTax drifted the record, skip it on retry ──
      var calculateTaxCausedDrift = afterTaxTimestamp.drifted;

      taxDetailsBeforeSave = getTaxDetailsSnapshot(so);

      // ─────────────────────────────────────────────────────────────────
      // SAVE WITH RETRY
      // On retry: reload the record fresh, re-apply fields, and skip
      // calculateTax if it was identified as the cause of the drift.
      // ─────────────────────────────────────────────────────────────────
      var MAX_RETRIES = 3;
      var attempt = 0;
      var savedId = null;
      var lastError = null;

      while (attempt < MAX_RETRIES) {
        try {
          if (attempt > 0) {
            log.audit("Pacejet RETRY attempt #" + attempt, {
              orderId: orderId,
              calculateTaxCausedDrift: calculateTaxCausedDrift
            });

            // Reload fresh — this is the key step on retry
            so = record.load({
              type: record.Type.SALES_ORDER,
              id: orderId,
              isDynamic: true
            });

            // Re-apply all field changes on the freshly loaded record
            applyFieldsToRecord(
              so,
              data,
              shipmethod,
              amount,
              quoteJson,
              resolvedLocationId,
              requestedTotals,
              taxOverrideResults
            );

            // ── DIAGNOSTIC: Only re-run calculateTax if it was NOT the cause ──
            // If calculateTax caused the drift, skip it entirely on retries.
            if (!calculateTaxCausedDrift) {
              diagLog("RETRY_CALCULATE_TAX", { attempt: attempt });
              calculateTaxResult = tryCalculateTax(so);
            } else {
              diagLog("RETRY_SKIPPED_CALCULATE_TAX", {
                reason: "calculateTax caused timestamp drift on first attempt",
                attempt: attempt
              });
              calculateTaxResult = {
                attempted: false,
                success: false,
                message: "Skipped on retry — identified as drift cause"
              };
            }
          }

          savedId = so.save({
            enableSourcing: true,
            ignoreMandatoryFields: true
          });

          diagLog("SAVE_SUCCESS", { attempt: attempt, savedId: savedId });
          break; // ── success, exit retry loop ──
        } catch (e) {
          lastError = e;
          diagLog("SAVE_FAILED", {
            attempt: attempt,
            errorName: e.name,
            errorMessage: e.message || String(e)
          });

          log.error("Pacejet save attempt #" + attempt + " failed", {
            name: e.name,
            message: e.message || String(e)
          });

          if (e.name === "RCRD_HAS_BEEN_CHANGED" && attempt < MAX_RETRIES - 1) {
            // ── Check who changed the record between our load and save ──
            var driftCheck = checkTimestampDrift(
              orderId,
              "AFTER_SAVE_FAIL_attempt_" + attempt,
              baselineTimestamp
            );
            diagLog("DRIFT_ON_FAIL", {
              attempt: attempt,
              drift: driftCheck
            });
            attempt++;
          } else {
            // Not a record-changed error, or we've exhausted retries — give up
            throw e;
          }
        }
      }

      // ── If all retries exhausted without saving ──
      if (savedId === null) {
        throw (
          lastError ||
          new Error("Failed to save after " + MAX_RETRIES + " attempts")
        );
      }

      // ── Post-save: reload to confirm final state ──
      var reloaded = record.load({
        type: record.Type.SALES_ORDER,
        id: savedId,
        isDynamic: false
      });

      var finalSnapshot = buildSnapshot(reloaded);
      taxFieldSnapshot = buildTaxFieldSnapshot(reloaded);
      taxDetailsAfterSave = getTaxDetailsSnapshot(reloaded);
      var responseTotals = chooseResponseTotals(
        finalSnapshot,
        requestedTotals,
        amount
      );
      var workbenchExport = null;
      var salesOrderTranId = asString(
        reloaded.getValue({ fieldId: "tranid" }) || savedId
      );
      var taxDiagnostics = buildTaxDiagnostics(
        finalSnapshot,
        requestedTotals,
        taxOverrideResults,
        calculateTaxResult,
        taxDetailsBeforeSave,
        taxDetailsAfterSave,
        taxFieldSnapshot
      );
      var locationDiagnostics = buildLocationDiagnostics(
        data,
        quoteJson,
        resolvedLocationId,
        locationSetResults
      );

      try {
        workbenchExport = exportSalesOrderToWorkbench(
          reloaded,
          savedId,
          resolvedLocationId,
          quoteJson
        );
      } catch (workbenchError) {
        workbenchExport = {
          attempted: true,
          ok: false,
          error: workbenchError.message || String(workbenchError)
        };
      }

      logWorkbenchExportResult(savedId, salesOrderTranId, workbenchExport);

      log.audit("Pacejet test apply - after", {
        snapshot: finalSnapshot,
        resolvedLocationId: resolvedLocationId,
        locationDiagnostics: locationDiagnostics,
        responseTotals: responseTotals,
        workbenchExport: workbenchExport,
        requestedTotals: requestedTotals,
        taxOverrideResults: taxOverrideResults,
        taxDiagnostics: taxDiagnostics,
        retriesUsed: attempt,
        calculateTaxCausedDrift: calculateTaxCausedDrift,
        diagnosticLog: diagnosticLog
      });

      return writeJson(res, 200, {
        ok: true,
        orderId: savedId,
        resolvedLocationId: resolvedLocationId,
        locationDiagnostics: locationDiagnostics,
        totals: responseTotals,
        snapshot: finalSnapshot,
        workbenchExport: workbenchExport,
        taxDiagnostics: taxDiagnostics,
        // ── Included in response so you can see retry/drift info live ──
        _debug: {
          retriesUsed: attempt,
          calculateTaxCausedDrift: calculateTaxCausedDrift,
          diagnosticLog: diagnosticLog
        }
      });
    } catch (e) {
      log.error("Pacejet test apply failed", {
        name: e.name,
        message: e.message || String(e),
        diagnosticLog: diagnosticLog
      });

      return writeJson(res, 500, {
        ok: false,
        error: e.message || String(e),
        _debug: { diagnosticLog: diagnosticLog }
      });
    }
  }

  return {
    onRequest: onRequest
  };
});
