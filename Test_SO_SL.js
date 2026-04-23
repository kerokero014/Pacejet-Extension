/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/record", "N/log", "N/runtime"], function (record, log, runtime) {
  "use strict";

  const SCRIPT_PARAMETER_IDS = {
    surchargeItemId: "custscript_rdt_pj_surcharge_item_id",
    subtotalItemId: "custscript_rdt_pj_subtotal_item_id",
    surchargeRate: "custscript_rdt_pj_surcharge_rate",
    avataxNonTaxableCode: "custscript_rdt_pj_avatax_nt_code"
  };

  const DEFAULT_SCRIPT_PARAMETERS = {
    surchargeItemId: 7768,
    subtotalItemId: -2,
    surchargeRate: 0.02,
    avataxNonTaxableCode: "NT"
  };

  const BODY_FIELDS = {
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
    const n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function readScriptParameter(parameterId, fallback) {
    try {
      const value = runtime.getCurrentScript().getParameter({ name: parameterId });
      return value !== null && value !== undefined && value !== "" ? value : fallback;
    } catch (_e) {
      return fallback;
    }
  }

  function readNumberScriptParameter(parameterId, fallback) {
    const value = readScriptParameter(parameterId, fallback);
    const parsedValue = Number(value);
    return isFinite(parsedValue) ? parsedValue : fallback;
  }

  function readStringScriptParameter(parameterId, fallback) {
    return String(readScriptParameter(parameterId, fallback));
  }

  const SCRIPT_PARAMETERS = {
    surchargeItemId: readNumberScriptParameter(
      SCRIPT_PARAMETER_IDS.surchargeItemId,
      DEFAULT_SCRIPT_PARAMETERS.surchargeItemId
    ),
    subtotalItemId: readNumberScriptParameter(
      SCRIPT_PARAMETER_IDS.subtotalItemId,
      DEFAULT_SCRIPT_PARAMETERS.subtotalItemId
    ),
    surchargeRate: readNumberScriptParameter(
      SCRIPT_PARAMETER_IDS.surchargeRate,
      DEFAULT_SCRIPT_PARAMETERS.surchargeRate
    ),
    avataxNonTaxableCode: readStringScriptParameter(
      SCRIPT_PARAMETER_IDS.avataxNonTaxableCode,
      DEFAULT_SCRIPT_PARAMETERS.avataxNonTaxableCode
    )
  };

  function round2(value) {
    return Math.round((asNumber(value) + Number.EPSILON) * 100) / 100;
  }

  function asString(value) {
    return value == null ? "" : String(value);
  }

  function getSurchargePercentLabel() {
    const percent = round2(SCRIPT_PARAMETERS.surchargeRate * 100);
    return percent + "%";
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
    const totals = value && typeof value === "object" ? value : null;
    if (!totals) return null;
    return {
      subtotal: asNumber(totals.subtotal),
      shipping: asNumber(totals.shipping),
      tax: asNumber(totals.tax),
      total: asNumber(totals.total)
    };
  }

  function buildTotalsFromSnapshot(snapshot) {
    const data = snapshot && typeof snapshot === "object" ? snapshot : {};
    const adjustedSubtotal = asNumber(data.subtotal);
    const surcharge = asNumber(data.surcharge);
    const baseSubtotal =
      surcharge > 0 && adjustedSubtotal >= surcharge
        ? round2(adjustedSubtotal - surcharge)
        : adjustedSubtotal;

    return {
      subtotal: baseSubtotal,
      baseSubtotal: baseSubtotal,
      adjustedSubtotal: adjustedSubtotal,
      surcharge: surcharge,
      shipping: asNumber(data.shippingcost),
      tax: asNumber(data.taxtotal),
      total: asNumber(data.total)
    };
  }

  function almostEqual(left, right) {
    return Math.abs(asNumber(left) - asNumber(right)) < 0.01;
  }

  function chooseResponseTotals(finalSnapshot, requestedTotals, amount) {
    const snapshotTotals = buildTotalsFromSnapshot(finalSnapshot);
    let surcharge = round2(snapshotTotals.surcharge);
    if (
      requestedTotals &&
      almostEqual(snapshotTotals.subtotal, requestedTotals.subtotal) &&
      almostEqual(snapshotTotals.shipping, amount) &&
      almostEqual(requestedTotals.shipping, amount) &&
      almostEqual(snapshotTotals.tax, requestedTotals.tax) &&
      almostEqual(snapshotTotals.total, requestedTotals.total)
    ) {
      surcharge = round2(requestedTotals.subtotal * SCRIPT_PARAMETERS.surchargeRate);
      return {
        baseSubtotal: requestedTotals.subtotal,
        subtotal: requestedTotals.subtotal,
        adjustedSubtotal: round2(requestedTotals.subtotal + surcharge),
        surcharge: surcharge,
        shipping: requestedTotals.shipping,
        tax: requestedTotals.tax,
        total: requestedTotals.total
      };
    }
    return snapshotTotals;
  }

  function sanitizeRequestedTotals(requestedTotals, merchandiseSubtotal, amount) {
    if (!requestedTotals) return null;
    if (requestedTotals.subtotal <= 0 || requestedTotals.tax <= 0 || requestedTotals.total <= 0) return null;
    if (Math.abs(requestedTotals.subtotal - merchandiseSubtotal) >= 0.01) return null;
    if (Math.abs(requestedTotals.shipping - amount) >= 0.01) return null;
    return requestedTotals;
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
    const lines = [];
    let count = 0;
    try {
      count = rec.getLineCount({ sublistId: "taxdetails" }) || 0;
    } catch (_e) {
      return { available: false, count: 0, lines: [] };
    }
    for (let i = 0; i < count; i += 1) {
      lines.push({
        line: i,
        taxdetailsreference: getSublistValueSafe(rec, "taxdetails", "taxdetailsreference", i),
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

  function getSurchargeLineTaxSnapshot(rec) {
    const count = getItemLineCount(rec);
    const lines = [];

    for (let i = 0; i < count; i += 1) {
      if (!isSurchargeItemLine(rec, i)) continue;

      lines.push({
        line: i,
        item: getItemSublistValue(rec, "item", i),
        amount: getItemSublistValue(rec, "amount", i),
        grossamt: getItemSublistValue(rec, "grossamt", i),
        price: getItemSublistValue(rec, "price", i),
        rate: getItemSublistValue(rec, "rate", i),
        description: getItemSublistValue(rec, "description", i),
        taxcode: getItemSublistValue(rec, "taxcode", i),
        istaxable: getItemSublistValue(rec, "istaxable", i),
        taxable: getItemSublistValue(rec, "taxable", i),
        taxrate1: getItemSublistValue(rec, "taxrate1", i),
        tax1amt: getItemSublistValue(rec, "tax1amt", i),
        avaTaxCodeMapping: getItemSublistValue(rec, "custcol_ava_taxcodemapping", i),
        avaTaxAmount: getItemSublistValue(rec, "custcol_ava_taxamount", i)
      });
    }

    return lines;
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
      total: getValueSafe(rec, "total"),
      surchargeLines: getSurchargeLineTaxSnapshot(rec)
    };
  }

  function buildTaxDiagnostics(
    finalSnapshot,
    requestedTotals,
    taxOverrideResults,
    taxDetailsAfterSave,
    taxFieldSnapshot
  ) {
    const snapshotTotals = buildTotalsFromSnapshot(finalSnapshot);
    const requested = requestedTotals || null;
    const mismatch =
      !!requested &&
      (Math.abs(snapshotTotals.tax - requested.tax) >= 0.01 ||
        Math.abs(snapshotTotals.total - requested.total) >= 0.01);

    return {
      requestedTotals: requested,
      snapshotTotals: snapshotTotals,
      overrideAttempts: taxOverrideResults || {},
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
    const textValue = asString(value).trim();
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
    const value = asString(originKey).trim();
    const locMatch = value.match(/^LOC_(\d+)$/i);
    const mainMatch = value.match(/^MAIN\|(\d+)$/i);
    const facilityMatch = value.match(/^FACILITY\|MAIN\|(\d+)$/i);
    const trailingIdMatch = value.match(/\|(\d+)$/);
    if (locMatch) return locMatch[1];
    if (mainMatch) return mainMatch[1];
    if (facilityMatch) return facilityMatch[1];
    if (trailingIdMatch) return trailingIdMatch[1];
    return "";
  }

  function collectWarehouseLocationIds(origins) {
    const ids = [];
    if (!Array.isArray(origins)) return ids;
    origins.forEach(function (origin) {
      let locationId = "";
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
    const parsedQuote = safeJsonParse(quoteJson || "{}", {});
    const originIds = collectWarehouseLocationIds(parsedQuote.origins);
    const directLocationId = asString(data.locationId).trim();
    const fallbackLocationId = extractLocationIdFromOriginKey(data.originKey);
    if (/^\d+$/.test(directLocationId)) return directLocationId;
    if (originIds.length === 1) return originIds[0];
    if (originIds.length > 1) return "";
    return fallbackLocationId;
  }

  function buildLocationDiagnostics(data, quoteJson, resolvedLocationId, setResult) {
    const parsedQuote = safeJsonParse(quoteJson || "{}", {});
    const quoteOrigins = Array.isArray(parsedQuote.origins) ? parsedQuote.origins : [];
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
      surcharge: getSurchargeLineAmount(so),
      shippingcost: Number(so.getValue({ fieldId: "shippingcost" }) || 0),
      taxtotal: Number(so.getValue({ fieldId: "taxtotal" }) || 0),
      total: Number(so.getValue({ fieldId: "total" }) || 0),
      pacejetAmount: so.getValue({ fieldId: BODY_FIELDS.amount }) || "",
      carrier: so.getValue({ fieldId: BODY_FIELDS.carrier }) || "",
      service: so.getValue({ fieldId: BODY_FIELDS.service }) || "",
      callPriorTruck: so.getValue({ fieldId: BODY_FIELDS.callPriorTruck }) || false,
      jobsite: so.getValue({ fieldId: BODY_FIELDS.jobsite }) || false,
      liftgateTruck: so.getValue({ fieldId: BODY_FIELDS.liftgateTruck }) || false,
      residential: so.getValue({ fieldId: BODY_FIELDS.residential }) || false,
      appointmentTruck: so.getValue({ fieldId: BODY_FIELDS.appointmentTruck }) || false,
      selfStorage: so.getValue({ fieldId: BODY_FIELDS.selfStorage }) || false,
      schoolDelivery: so.getValue({ fieldId: BODY_FIELDS.schoolDelivery }) || false,
      insideDelivery: so.getValue({ fieldId: BODY_FIELDS.insideDelivery }) || false,
      accessHazmatParcel: so.getValue({ fieldId: BODY_FIELDS.accessHazmatParcel }) || false,
      dangerousGoods: so.getValue({ fieldId: BODY_FIELDS.dangerousGoods }) || false,
      noneAdditionalFeesMayApply:
        so.getValue({ fieldId: BODY_FIELDS.noneAdditionalFeesMayApply }) || false,
      surchargeLines: getSurchargeLineTaxSnapshot(so)
    };
  }

  function getItemLineCount(rec) {
    try {
      return rec.getLineCount({ sublistId: "item" }) || 0;
    } catch (_e) {
      return 0;
    }
  }

  function getItemSublistValue(rec, fieldId, line) {
    return getSublistValueSafe(rec, "item", fieldId, line);
  }

  function isSurchargeItemLine(rec, line) {
    return (
      String(getItemSublistValue(rec, "item", line) || "") === String(SCRIPT_PARAMETERS.surchargeItemId)
    );
  }

  function isSubtotalItemLine(rec, line) {
    return (
      String(getItemSublistValue(rec, "item", line) || "") === String(SCRIPT_PARAMETERS.subtotalItemId)
    );
  }

  function isManagedSurchargeLine(rec, line) {
    return isSurchargeItemLine(rec, line) || isSubtotalItemLine(rec, line);
  }

  function getMerchandiseSubtotal(rec) {
    const count = getItemLineCount(rec);
    let total = 0;
    for (let i = 0; i < count; i += 1) {
      if (isManagedSurchargeLine(rec, i)) continue;
      total += asNumber(getItemSublistValue(rec, "amount", i) || 0);
    }
    return round2(total);
  }

  function getSurchargeLineAmount(rec) {
    const count = getItemLineCount(rec);
    let total = 0;
    for (let i = 0; i < count; i += 1) {
      if (!isSurchargeItemLine(rec, i)) continue;
      total += asNumber(
        getItemSublistValue(rec, "amount", i) ||
          getItemSublistValue(rec, "grossamt", i) ||
          0
      );
    }
    return round2(total);
  }

  function markCurrentLineNonTaxable(so) {
    const nonTaxLineFields = [
      { fieldId: "istaxable", value: false },
      { fieldId: "taxable", value: false },
      { fieldId: "taxrate1", value: 0 },
      { fieldId: "tax1amt", value: 0 },
      { fieldId: "custcol_ava_taxcodemapping", value: SCRIPT_PARAMETERS.avataxNonTaxableCode },
      { fieldId: "custcol_ava_taxamount", value: 0 }
    ];

    for (let i = 0; i < nonTaxLineFields.length; i += 1) {
      try {
        so.setCurrentSublistValue({
          sublistId: "item",
          fieldId: nonTaxLineFields[i].fieldId,
          value: nonTaxLineFields[i].value
        });
      } catch (_e_line_tax) {}
    }

    try {
      so.setCurrentSublistValue({
        sublistId: "item",
        fieldId: "taxcode",
        value: -7
      });
    } catch (_e_taxcode) {}
  }

  function removeManagedSurchargeLines(so) {
    const lineCount = getItemLineCount(so);
    const removeLines = {};

    for (let i = 0; i < lineCount; i += 1) {
      if (!isSurchargeItemLine(so, i)) continue;
      removeLines[i] = true;
      if (i > 0 && isSubtotalItemLine(so, i - 1)) removeLines[i - 1] = true;
    }

    for (let i = lineCount - 1; i >= 0; i -= 1) {
      if (!removeLines[i]) continue;
      so.removeLine({ sublistId: "item", line: i, ignoreRecalc: false });
    }
  }

  function appendSurchargeLine(so, surchargeAmount) {
    const normalizedAmount = round2(surchargeAmount);

    so.selectNewLine({ sublistId: "item" });
    so.setCurrentSublistValue({
      sublistId: "item",
      fieldId: "item",
      value: SCRIPT_PARAMETERS.surchargeItemId
    });

    try {
      so.setCurrentSublistValue({ sublistId: "item", fieldId: "quantity", value: 1 });
    } catch (_e) {}

    try {
      so.setCurrentSublistValue({ sublistId: "item", fieldId: "price", value: -1 });
    } catch (_e_price) {}

    try {
      so.setCurrentSublistValue({ sublistId: "item", fieldId: "rate", value: normalizedAmount });
    } catch (_e_rate) {}

    try {
      so.setCurrentSublistValue({ sublistId: "item", fieldId: "amount", value: normalizedAmount });
    } catch (_e_amount) {}

    try {
      so.setCurrentSublistValue({
        sublistId: "item",
        fieldId: "description",
        value: "Surcharge " + getSurchargePercentLabel()
      });
    } catch (_e_description) {}

    try {
      so.setCurrentSublistValue({
        sublistId: "item",
        fieldId: "custcol_rdt_surcharge_rate",
        value: getSurchargePercentLabel()
      });
    } catch (_e_custom_rate) {}

    // Keep the surcharge outside the tax basis even if account-level taxcode
    // behavior varies.
    markCurrentLineNonTaxable(so);

    so.commitLine({ sublistId: "item" });

    return normalizedAmount;
  }

  function appendSubtotalLine(so) {
    so.selectNewLine({ sublistId: "item" });
    so.setCurrentSublistValue({
      sublistId: "item",
      fieldId: "item",
      value: SCRIPT_PARAMETERS.subtotalItemId
    });
    so.commitLine({ sublistId: "item" });
  }

  function ensureSubtotalAndSurchargeLines(so, surchargeAmount) {
    removeManagedSurchargeLines(so);
    appendSubtotalLine(so);
    return appendSurchargeLine(so, surchargeAmount);
  }

  function enforceCommittedSurchargeLinesNonTaxable(so) {
    const count = getItemLineCount(so);
    const fields = [
      { fieldId: "taxcode", value: -7 },
      { fieldId: "istaxable", value: false },
      { fieldId: "taxable", value: false },
      { fieldId: "taxrate1", value: 0 },
      { fieldId: "tax1amt", value: 0 },
      { fieldId: "custcol_ava_taxcodemapping", value: SCRIPT_PARAMETERS.avataxNonTaxableCode },
      { fieldId: "custcol_ava_taxamount", value: 0 }
    ];

    for (let i = 0; i < count; i += 1) {
      if (!isSurchargeItemLine(so, i)) continue;

      try {
        so.selectLine({ sublistId: "item", line: i });
      } catch (_selectErr) {
        continue;
      }

      for (let j = 0; j < fields.length; j += 1) {
        try {
          so.setCurrentSublistValue({
            sublistId: "item",
            fieldId: fields[j].fieldId,
            value: fields[j].value
          });
        } catch (_fieldErr) {}
      }

      try {
        so.commitLine({ sublistId: "item" });
      } catch (_commitErr) {}
    }
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

  function applyTaxOverride(rec, requestedTotals, results) {
    if (!requestedTotals) return false;
    trySetValue(rec, "taxdetailsoverride", true, results);
    trySetValue(rec, "taxtotaloverride", requestedTotals.tax, results);
    trySetValue(rec, "taxamountoverride", requestedTotals.tax, results);
    return true;
  }

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
    const merchandiseSubtotal = getMerchandiseSubtotal(so);
    const surchargeAmount = round2(merchandiseSubtotal * SCRIPT_PARAMETERS.surchargeRate);

    ensureSubtotalAndSurchargeLines(so, surchargeAmount);
    enforceCommittedSurchargeLinesNonTaxable(so);

    so.setValue({ fieldId: "shipmethod", value: shipmethod });
    so.setValue({ fieldId: "shippingcost", value: amount });

    maybeSet(so, BODY_FIELDS.amount, amount);
    maybeSet(so, BODY_FIELDS.carrier, asString(data.carrier));
    maybeSet(so, BODY_FIELDS.service, asString(data.service));
    maybeSet(so, BODY_FIELDS.originKey, asString(data.originKey));
    maybeSet(so, BODY_FIELDS.transitDays, asString(data.transitDays));
    maybeSet(so, BODY_FIELDS.estimatedArrivalDate, asString(data.estimatedArrivalDate));

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
    setBoolean(so, BODY_FIELDS.noneAdditionalFeesMayApply, data.noneAdditionalFeesMayApply);

    const truncatedQuoteJson = quoteJson.length > 3900 ? quoteJson.slice(0, 3900) : quoteJson;
    maybeSet(so, BODY_FIELDS.quoteJson, truncatedQuoteJson);
    maybeSetSelect(so, "location", resolvedLocationId, {});

    // Reset tax override first, then apply if needed
    try {
      so.setValue({ fieldId: "taxdetailsoverride", value: false });
    } catch (_ignore) {}

    applyTaxOverride(so, requestedTotals, taxOverrideResults);
  }

  function onRequest(context) {
    const req = context.request;
    const res = context.response;

    if (req.method === "GET") {
      return writeJson(res, 200, {
        ok: true,
        message: "Pacejet test apply suitelet is reachable"
      });
    }

    if (req.method !== "POST") {
      return writeJson(res, 405, { ok: false, error: "POST required" });
    }

    let data = {};
    try {
      data = JSON.parse(req.body || "{}");
    } catch (e) {
      return writeJson(res, 400, { ok: false, error: "Invalid JSON" });
    }

    const orderId = asString(data.orderId).trim();
    const shipmethod = asString(data.shipmethod).trim();
    const amount = asNumber(data.pacejetAmount);
    let requestedTotals = normalizeTotals(data.totals);
    const taxOverrideResults = {};
    let taxDetailsAfterSave = null;
    let taxFieldSnapshot = null;

    if (!/^\d+$/.test(orderId)) {
      return writeJson(res, 400, {
        ok: false,
        error: "Valid numeric orderId is required"
      });
    }
    if (!shipmethod) {
      return writeJson(res, 400, { ok: false, error: "shipmethod is required" });
    }
    if (amount <= 0) {
      return writeJson(res, 400, { ok: false, error: "pacejetAmount must be > 0" });
    }

    try {
      const quoteJson = asString(data.quoteJson);
      const resolvedLocationId = resolveSalesOrderLocationId(data, quoteJson);

      let so = record.load({
        type: record.Type.SALES_ORDER,
        id: orderId,
        isDynamic: true
      });
      const initialMerchandiseSubtotal = getMerchandiseSubtotal(so);
      requestedTotals = sanitizeRequestedTotals(
        requestedTotals,
        initialMerchandiseSubtotal,
        amount
      );

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

      const MAX_RETRIES = 3;
      let attempt = 0;
      let savedId = null;
      let lastError = null;

      while (attempt < MAX_RETRIES) {
        try {
          if (attempt > 0) {
            log.audit("Pacejet RETRY attempt #" + attempt, { orderId: orderId });

            so = record.load({
              type: record.Type.SALES_ORDER,
              id: orderId,
              isDynamic: true
            });

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
          }

          savedId = so.save({
            enableSourcing: true,
            ignoreMandatoryFields: true
          });

          break;
        } catch (e) {
          lastError = e;
          log.error("Pacejet save attempt #" + attempt + " failed", {
            name: e.name,
            message: e.message || String(e)
          });

          if (e.name === "RCRD_HAS_BEEN_CHANGED" && attempt < MAX_RETRIES - 1) {
            attempt++;
          } else {
            throw e;
          }
        }
      }

      if (savedId === null) {
        throw lastError || new Error("Failed to save after " + MAX_RETRIES + " attempts");
      }

      if (requestedTotals) {
        try {
          record.submitFields({
            type: record.Type.SALES_ORDER,
            id: savedId,
            values: {
              taxdetailsoverride: true,
              taxtotaloverride: requestedTotals.tax,
              taxamountoverride: requestedTotals.tax
            },
            options: {
              enableSourcing: false,
              ignoreMandatoryFields: true
            }
          });
          taxOverrideResults.postSaveSubmitFields = requestedTotals.tax;
        } catch (submitFieldsError) {
          try {
            const overrideReload = record.load({
              type: record.Type.SALES_ORDER,
              id: savedId,
              isDynamic: true
            });
            applyTaxOverride(overrideReload, requestedTotals, taxOverrideResults);
            savedId = overrideReload.save({
              enableSourcing: false,
              ignoreMandatoryFields: true
            });
          } catch (overrideError) {
            log.error("Pacejet post-save tax override failed", {
              name: overrideError.name,
              message: overrideError.message || String(overrideError)
            });
          }
        }
      }

      const reloaded = record.load({
        type: record.Type.SALES_ORDER,
        id: savedId,
        isDynamic: false
      });

      const finalSnapshot = buildSnapshot(reloaded);
      taxFieldSnapshot = buildTaxFieldSnapshot(reloaded);
      taxDetailsAfterSave = getTaxDetailsSnapshot(reloaded);
      const responseTotals = chooseResponseTotals(finalSnapshot, requestedTotals, amount);

      const taxDiagnostics = buildTaxDiagnostics(
        finalSnapshot,
        requestedTotals,
        taxOverrideResults,
        taxDetailsAfterSave,
        taxFieldSnapshot
      );
      const locationDiagnostics = buildLocationDiagnostics(
        data,
        quoteJson,
        resolvedLocationId,
        {}
      );

      log.audit("Pacejet apply - after", {
        orderId: savedId,
        resolvedLocationId: resolvedLocationId,
        subtotal: finalSnapshot.subtotal,
        surcharge: finalSnapshot.surcharge,
        shipping: finalSnapshot.shippingcost,
        tax: finalSnapshot.taxtotal,
        total: finalSnapshot.total,
        taxMismatch: taxDiagnostics.mismatch,
        retriesUsed: attempt
      });

      return writeJson(res, 200, {
        ok: true,
        orderId: savedId,
        resolvedLocationId: resolvedLocationId,
        locationDiagnostics: locationDiagnostics,
        totals: responseTotals,
        snapshot: finalSnapshot,
        taxDiagnostics: taxDiagnostics
      });
    } catch (e) {
      log.error("Pacejet apply failed", {
        name: e.name,
        message: e.message || String(e)
      });

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
