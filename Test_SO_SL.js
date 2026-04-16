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

      log.audit("Pacejet test apply - after", {
        snapshot: finalSnapshot,
        resolvedLocationId: resolvedLocationId,
        locationDiagnostics: locationDiagnostics,
        responseTotals: responseTotals,
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
