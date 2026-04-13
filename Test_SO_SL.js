/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/record", "N/log"], function (record, log) {
  "use strict";

  var BODY_FIELDS = {
    amount: "custbody_rdt_pacejet_amount",
    carrier: "custbody_rdt_pj_carrier_name",
    service: "custbody_rdt_pj_service_name",
    originKey: "custbody_rdt_pj_origin_key",
    transitDays: "custbody_rdt_pj_transit_days",
    estimatedArrivalDate: "custbody_rdt_pj_est_arrival_date",
    quoteJson: "custbody_rdt_pj_quote_json",

    // Accessorials
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

    if (!totals) {
      return null;
    }

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
      return {
        available: false,
        count: 0,
        lines: []
      };
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

    return {
      available: true,
      count: count,
      lines: lines
    };
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

  function tryCalculateTax(rec) {
    var result = {
      attempted: false,
      success: false,
      message: ""
    };

    if (!rec || typeof rec.executeMacro !== "function") {
      result.message = "executeMacro is not available on this record object.";
      return result;
    }

    result.attempted = true;

    try {
      rec.executeMacro({
        id: "calculateTax"
      });
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

    if (!Array.isArray(origins)) {
      return ids;
    }

    origins.forEach(function (origin) {
      var locationId = "";

      if (!origin || origin.dropShip) {
        return;
      }

      locationId = extractLocationIdFromOriginKey(origin.originKey);

      if (
        !locationId &&
        origin.Origin &&
        asString(origin.Origin.LocationType).toUpperCase() === "FACILITY"
      ) {
        locationId = asString(origin.Origin.LocationCode).trim();
      }

      if (locationId && ids.indexOf(locationId) === -1) {
        ids.push(locationId);
      }
    });

    return ids;
  }

  function resolveSalesOrderLocationId(data, quoteJson) {
    var parsedQuote = safeJsonParse(quoteJson || "{}", {});
    var originIds = collectWarehouseLocationIds(parsedQuote.origins);
    var directLocationId = asString(data.locationId).trim();
    var fallbackLocationId = extractLocationIdFromOriginKey(data.originKey);

    if (/^\d+$/.test(directLocationId)) {
      return directLocationId;
    }

    if (originIds.length === 1) {
      return originIds[0];
    }

    if (originIds.length > 1) {
      return "";
    }

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
          return origin &&
            origin.Origin &&
            origin.Origin.LocationCode !== undefined &&
            origin.Origin.LocationCode !== null
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

  function isRetryableSaveError(e) {
    var msg = (e && (e.message || e.details || String(e))) || "";
    var name = (e && e.name) || "";

    return (
      name === "RCRD_HAS_BEEN_CHANGED" ||
      /RCRD_HAS_BEEN_CHANGED/i.test(msg) ||
      /Record has been changed/i.test(msg) ||
      name ===
        "THE_SALES_ORDER_CANNOT_BE_SAVED_BECAUSE_SOMEONE_MIGHT_BE_SAVING_AN_ASSOCIATED_RECORD_RIGHT_NOW" ||
      /someone might be saving an associated record right now/i.test(msg)
    );
  }

  function waitMs(ms) {
    var start = new Date().getTime();
    while (new Date().getTime() - start < ms) {
      // intentional short busy wait for retry backoff
    }
  }
  function valuesEqual(left, right) {
    if (left === right) {
      return true;
    }

    var leftNum = Number(left);
    var rightNum = Number(right);

    if (isFinite(leftNum) && isFinite(rightNum)) {
      return Math.abs(leftNum - rightNum) < 0.00001;
    }

    return (
      String(left == null ? "" : left) === String(right == null ? "" : right)
    );
  }

  function setValueIfChanged(rec, fieldId, value, results) {
    var currentValue;

    try {
      currentValue = rec.getValue({ fieldId: fieldId });
    } catch (e) {
      if (results) {
        results[fieldId] = "READ_FAILED: " + (e.message || String(e));
      }
      return false;
    }

    if (valuesEqual(currentValue, value)) {
      if (results) {
        results[fieldId] = "UNCHANGED";
      }
      return false;
    }

    try {
      rec.setValue({
        fieldId: fieldId,
        value: value
      });

      if (results) {
        results[fieldId] = {
          from: currentValue,
          to: value
        };
      }

      return true;
    } catch (e2) {
      if (results) {
        results[fieldId] = "FAILED: " + (e2.message || String(e2));
      }
      return false;
    }
  }

  function setBooleanIfChanged(rec, fieldId, value, results) {
    return setValueIfChanged(rec, fieldId, asBoolean(value), results);
  }

  function setTextIfPresentAndChanged(rec, fieldId, value, results) {
    var textValue = asString(value);

    if (!textValue) {
      if (results) {
        results[fieldId] = "SKIPPED_EMPTY";
      }
      return false;
    }

    return setValueIfChanged(rec, fieldId, textValue, results);
  }

  function setSelectIfPresentAndChanged(rec, fieldId, value, results) {
    var textValue = asString(value).trim();

    if (!textValue) {
      if (results) {
        results[fieldId] = "SKIPPED_EMPTY";
      }
      return false;
    }

    try {
      return setValueIfChanged(rec, fieldId, Number(textValue), results);
    } catch (e) {
      if (results) {
        results[fieldId] = "FAILED: " + (e.message || String(e));
      }
      return false;
    }
  }

  function applyOriginalTaxBehavior(so, requestedTotals, changeResults) {
    var taxOverrideResults = {};
    var calculateTaxResult = null;
    var taxDetailsBeforeSave = null;

    try {
      setValueIfChanged(so, "taxdetailsoverride", false, changeResults);
    } catch (_ignore) {}

    if (requestedTotals) {
      setValueIfChanged(so, "taxdetailsoverride", true, changeResults);

      setValueIfChanged(
        so,
        "taxtotaloverride",
        requestedTotals.tax,
        taxOverrideResults
      );

      setValueIfChanged(
        so,
        "taxamountoverride",
        requestedTotals.tax,
        taxOverrideResults
      );
    }

    calculateTaxResult = tryCalculateTax(so);
    taxDetailsBeforeSave = getTaxDetailsSnapshot(so);

    return {
      taxOverrideResults: taxOverrideResults,
      calculateTaxResult: calculateTaxResult,
      taxDetailsBeforeSave: taxDetailsBeforeSave
    };
  }

  function applySalesOrderChanges(so, data) {
    var changeResults = {};
    var amount = asNumber(data.pacejetAmount);
    var quoteJson = asString(data.quoteJson);
    var resolvedLocationId = resolveSalesOrderLocationId(data, quoteJson);

    if (quoteJson.length > 3900) {
      quoteJson = quoteJson.slice(0, 3900);
    }

    setValueIfChanged(
      so,
      "shipmethod",
      asString(data.shipmethod).trim(),
      changeResults
    );
    setValueIfChanged(so, "shippingcost", amount, changeResults);

    setValueIfChanged(so, BODY_FIELDS.amount, amount, changeResults);
    setTextIfPresentAndChanged(
      so,
      BODY_FIELDS.carrier,
      data.carrier,
      changeResults
    );
    setTextIfPresentAndChanged(
      so,
      BODY_FIELDS.service,
      data.service,
      changeResults
    );
    setTextIfPresentAndChanged(
      so,
      BODY_FIELDS.originKey,
      data.originKey,
      changeResults
    );
    setTextIfPresentAndChanged(
      so,
      BODY_FIELDS.transitDays,
      data.transitDays,
      changeResults
    );
    setTextIfPresentAndChanged(
      so,
      BODY_FIELDS.estimatedArrivalDate,
      data.estimatedArrivalDate,
      changeResults
    );
    setTextIfPresentAndChanged(
      so,
      BODY_FIELDS.quoteJson,
      quoteJson,
      changeResults
    );

    setBooleanIfChanged(
      so,
      BODY_FIELDS.callPriorTruck,
      data.callPriorTruck,
      changeResults
    );
    setBooleanIfChanged(so, BODY_FIELDS.jobsite, data.jobsite, changeResults);
    setBooleanIfChanged(
      so,
      BODY_FIELDS.liftgateTruck,
      data.liftgateTruck,
      changeResults
    );
    setBooleanIfChanged(
      so,
      BODY_FIELDS.residential,
      data.residential,
      changeResults
    );
    setBooleanIfChanged(
      so,
      BODY_FIELDS.appointmentTruck,
      data.appointmentTruck,
      changeResults
    );
    setBooleanIfChanged(
      so,
      BODY_FIELDS.selfStorage,
      data.selfStorage,
      changeResults
    );
    setBooleanIfChanged(
      so,
      BODY_FIELDS.schoolDelivery,
      data.schoolDelivery,
      changeResults
    );
    setBooleanIfChanged(
      so,
      BODY_FIELDS.insideDelivery,
      data.insideDelivery,
      changeResults
    );
    setBooleanIfChanged(
      so,
      BODY_FIELDS.accessHazmatParcel,
      data.accessHazmatParcel,
      changeResults
    );
    setBooleanIfChanged(
      so,
      BODY_FIELDS.dangerousGoods,
      data.dangerousGoods,
      changeResults
    );
    setBooleanIfChanged(
      so,
      BODY_FIELDS.noneAdditionalFeesMayApply,
      data.noneAdditionalFeesMayApply,
      changeResults
    );

    setSelectIfPresentAndChanged(
      so,
      "location",
      resolvedLocationId,
      changeResults
    );

    return {
      changeResults: changeResults,
      resolvedLocationId: resolvedLocationId,
      quoteJson: quoteJson
    };
  }

  function saveSalesOrderWithRetry(orderId, data, requestedTotals) {
    var maxAttempts = 5;
    var attempt = 0;
    var lastError = null;

    while (attempt < maxAttempts) {
      attempt += 1;

      var started = new Date().getTime();
      var taxOverrideResults = {};
      var calculateTaxResult = null;
      var taxDetailsBeforeSave = null;
      var taxDetailsAfterSave = null;
      var taxFieldSnapshot = null;

      try {
        var so = record.load({
          type: record.Type.SALES_ORDER,
          id: orderId,
          isDynamic: true
        });

        log.audit("Pacejet apply attempt - loaded", {
          orderId: orderId,
          attempt: attempt,
          snapshotBefore: buildSnapshot(so)
        });

        var applied = applySalesOrderChanges(so, data);

        var taxApplied = applyOriginalTaxBehavior(
          so,
          requestedTotals,
          applied.changeResults
        );

        taxOverrideResults = taxApplied.taxOverrideResults;
        calculateTaxResult = taxApplied.calculateTaxResult;
        taxDetailsBeforeSave = taxApplied.taxDetailsBeforeSave;

        var savedId = so.save({
          enableSourcing: true,
          ignoreMandatoryFields: true
        });

        var reloaded = record.load({
          type: record.Type.SALES_ORDER,
          id: savedId,
          isDynamic: false
        });

        var finalSnapshot = buildSnapshot(reloaded);
        var responseTotals = chooseResponseTotals(
          finalSnapshot,
          requestedTotals,
          asNumber(data.pacejetAmount)
        );

        taxFieldSnapshot = buildTaxFieldSnapshot(reloaded);
        taxDetailsAfterSave = getTaxDetailsSnapshot(reloaded);

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
          applied.quoteJson,
          applied.resolvedLocationId,
          applied.changeResults
        );

        var result = {
          ok: true,
          savedId: savedId,
          attempt: attempt,
          elapsedMs: new Date().getTime() - started,
          resolvedLocationId: applied.resolvedLocationId,
          locationDiagnostics: locationDiagnostics,
          responseTotals: responseTotals,
          snapshot: finalSnapshot,
          taxDiagnostics: taxDiagnostics,
          changeResults: applied.changeResults
        };

        log.audit("Pacejet apply attempt - saved", result);

        return result;
      } catch (e) {
        lastError = e;

        log.error("Pacejet apply attempt failed", {
          orderId: orderId,
          attempt: attempt,
          retryable: isRetryableSaveError(e),
          name: e && e.name,
          message: e && (e.message || String(e)),
          stack: e && e.stack
        });

        if (!isRetryableSaveError(e) || attempt >= maxAttempts) {
          throw e;
        }

        waitMs(attempt * 250);
      }
    }

    throw lastError;
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
      return writeJson(res, 405, {
        ok: false,
        error: "POST required"
      });
    }

    var data = {};
    try {
      data = JSON.parse(req.body || "{}");
    } catch (e) {
      return writeJson(res, 400, {
        ok: false,
        error: "Invalid JSON"
      });
    }

    var orderId = asString(data.orderId).trim();
    var shipmethod = asString(data.shipmethod).trim();
    var amount = asNumber(data.pacejetAmount);
    var requestedTotals = normalizeTotals(data.totals);

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
      var result = saveSalesOrderWithRetry(orderId, data, requestedTotals);

      return writeJson(res, 200, {
        ok: true,
        orderId: result.savedId,
        resolvedLocationId: result.resolvedLocationId,
        locationDiagnostics: result.locationDiagnostics,
        totals: result.responseTotals,
        snapshot: result.snapshot,
        taxDiagnostics: result.taxDiagnostics,
        saveAttempt: result.attempt,
        elapsedMs: result.elapsedMs,
        changeResults: result.changeResults
      });
    } catch (e) {
      log.error("Pacejet test apply failed", {
        name: e && e.name,
        message: e && (e.message || String(e)),
        stack: e && e.stack,
        orderId: orderId
      });

      return writeJson(res, 500, {
        ok: false,
        error: e.message || String(e),
        errorName: e.name || "",
        orderId: orderId
      });
    }
  }

  return {
    onRequest: onRequest
  };
});
