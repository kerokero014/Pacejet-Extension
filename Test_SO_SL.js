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
      almostEqual(snapshotTotals.shipping, amount) &&
      almostEqual(requestedTotals.shipping, amount)
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

  function setBoolean(rec, fieldId, value) {
    rec.setValue({
      fieldId: fieldId,
      value: asBoolean(value)
    });
  }

  function maybeSet(rec, fieldId, value) {
    if (value === "" || value == null) return;

    rec.setValue({
      fieldId: fieldId,
      value: value
    });
  }

  function buildSnapshot(so) {
    return {
      id: so.id || "",
      tranid: so.getValue({ fieldId: "tranid" }) || "",
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
      rec.setValue({
        fieldId: fieldId,
        value: value
      });
      if (results) {
        results[fieldId] = value;
      }
      return true;
    } catch (e) {
      if (results) {
        results[fieldId] = "FAILED: " + (e.message || String(e));
      }
      return false;
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
    var taxOverrideResults = {};
    var calculateTaxResult = null;
    var taxDetailsBeforeSave = null;
    var taxDetailsAfterSave = null;
    var taxFieldSnapshot = null;

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
      var so = record.load({
        type: record.Type.SALES_ORDER,
        id: orderId,
        isDynamic: true
      });

      log.audit("Pacejet test apply - before", buildSnapshot(so));

      so.setValue({
        fieldId: "shipmethod",
        value: shipmethod
      });

      so.setValue({
        fieldId: "shippingcost",
        value: amount
      });

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

      var quoteJson = asString(data.quoteJson);
      if (quoteJson.length > 3900) {
        quoteJson = quoteJson.slice(0, 3900);
      }
      maybeSet(so, BODY_FIELDS.quoteJson, quoteJson);

      // Useful when tax engines need recalculation
      try {
        so.setValue({
          fieldId: "taxdetailsoverride",
          value: false
        });
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

      calculateTaxResult = tryCalculateTax(so);
      taxDetailsBeforeSave = getTaxDetailsSnapshot(so);

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

      log.audit("Pacejet test apply - after", {
        snapshot: finalSnapshot,
        responseTotals: responseTotals,
        requestedTotals: requestedTotals,
        taxOverrideResults: taxOverrideResults,
        taxDiagnostics: taxDiagnostics
      });

      return writeJson(res, 200, {
        ok: true,
        orderId: savedId,
        totals: responseTotals,
        snapshot: finalSnapshot,
        taxDiagnostics: taxDiagnostics
      });
    } catch (e) {
      log.error("Pacejet test apply failed", e);
      return writeJson(res, 500, {
        ok: false,
        error: e.message || String(e)
      });
    }
  }

  return {
    onRequest: onRequest
  };
});
