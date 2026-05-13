/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @description Pacejet checkout preview summary totals using temp Sales Order save/reload/delete
 */
define(["N/record", "N/log", "N/runtime"], function (record, log, runtime) {
  "use strict";

  var SURCHARGE_ITEM_ID = 7768;
  var SUBTOTAL_ITEM_ID = -2;
  var SURCHARGE_RATE = 0.02;

  function writeJson(response, status, payload) {
    response.statusCode = status;
    response.setHeader({
      name: "Content-Type",
      value: "application/json; charset=utf-8"
    });
    response.write(JSON.stringify(payload));
  }

  function asNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback || 0;
  }

  function round2(value) {
    return Math.round((asNumber(value, 0) + Number.EPSILON) * 100) / 100;
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

  function resolveEntityId(data) {
    var raw = asString(data.customerId || data.entity || data.entityId).trim();
    var currentUserId = "";

    if (/^\d+$/.test(raw)) {
      return raw;
    }

    try {
      currentUserId = asString(runtime.getCurrentUser().id).trim();
    } catch (_e) {}

    if (/^\d+$/.test(currentUserId) && currentUserId !== "-4") {
      return currentUserId;
    }

    return "";
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

  function resolveLocationId(data, quoteJson) {
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

  function normalizeLines(lines) {
    if (!Array.isArray(lines)) return [];

    return lines
      .map(function (line) {
        return {
          itemId: asString(
            line.itemId || line.internalid || line.item || ""
          ).trim(),
          quantity: asNumber(line.quantity, 0)
        };
      })
      .filter(function (line) {
        return /^\d+$/.test(line.itemId) && line.quantity > 0;
      });
  }

  function setIfPresent(rec, fieldId, value) {
    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      value !== false
    ) {
      rec.setValue({
        fieldId: fieldId,
        value: value
      });
    }
  }

  function getValueSafe(rec, fieldId) {
    try {
      return rec.getValue({ fieldId: fieldId });
    } catch (_e) {
      return "UNAVAILABLE";
    }
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

  function getTaxDetailsSnapshot(rec) {
    var lines = [];
    var count = 0;
    var i;

    try {
      count = rec.getLineCount({ sublistId: "taxdetails" });

      if (count === -1 || count == null) {
        throw new Error("Invalid taxdetails count returned");
      }
    } catch (e) {
      return {
        available: false,
        error: e.message || String(e),
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
      rec.executeMacro({ id: "calculateTax" });
      result.success = true;
      result.message = "calculateTax macro executed successfully.";
    } catch (e) {
      result.message = e.message || String(e);
    }

    return result;
  }

  function applyShippingAddress(so, address) {
    if (!address || typeof address !== "object") {
      return;
    }

    try {
      so.setValue({
        fieldId: "shipaddresslist",
        value: null
      });
    } catch (_e) {}

    var subrec = so.getSubrecord({ fieldId: "shippingaddress" });

    if (!subrec) {
      throw new Error("shippingaddress subrecord was not available");
    }

    if (address.country) {
      subrec.setValue({
        fieldId: "country",
        value: asString(address.country).toUpperCase()
      });
    }

    setIfPresent(subrec, "addressee", asString(address.addressee));
    setIfPresent(
      subrec,
      "attention",
      asString(address.attention) || asString(address.addressee)
    );
    setIfPresent(
      subrec,
      "addrphone",
      asString(address.addrphone || address.phone)
    );
    setIfPresent(subrec, "addr1", asString(address.addr1));
    setIfPresent(subrec, "addr2", asString(address.addr2));
    setIfPresent(subrec, "city", asString(address.city));
    setIfPresent(subrec, "state", asString(address.state));
    setIfPresent(subrec, "zip", asString(address.zip));
  }

  function applyAccessorialBodyFields(so, data) {
    var fieldMap = {
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

    Object.keys(fieldMap).forEach(function (key) {
      if (data[key] !== undefined) {
        try {
          so.setValue({
            fieldId: fieldMap[key],
            value: asBoolean(data[key])
          });
        } catch (_e) {}
      }
    });
  }

  function addLines(so, lines, locationId) {
    lines.forEach(function (line) {
      so.selectNewLine({ sublistId: "item" });

      so.setCurrentSublistValue({
        sublistId: "item",
        fieldId: "item",
        value: Number(line.itemId)
      });

      so.setCurrentSublistValue({
        sublistId: "item",
        fieldId: "quantity",
        value: line.quantity
      });

      if (locationId) {
        try {
          so.setCurrentSublistValue({
            sublistId: "item",
            fieldId: "location",
            value: Number(locationId)
          });
        } catch (_e) {}
      }

      so.commitLine({ sublistId: "item" });
    });
  }

  function appendSubtotalLine(so) {
    so.selectNewLine({ sublistId: "item" });
    so.setCurrentSublistValue({
      sublistId: "item",
      fieldId: "item",
      value: SUBTOTAL_ITEM_ID
    });
    so.commitLine({ sublistId: "item" });
  }

  function appendSurchargeLine(so, surchargeAmount) {
    var normalizedAmount = round2(surchargeAmount);

    if (normalizedAmount <= 0) {
      return 0;
    }

    so.selectNewLine({ sublistId: "item" });

    so.setCurrentSublistValue({
      sublistId: "item",
      fieldId: "item",
      value: SURCHARGE_ITEM_ID
    });

    try {
      so.setCurrentSublistValue({
        sublistId: "item",
        fieldId: "quantity",
        value: 1
      });
    } catch (_e_quantity) {}

    try {
      so.setCurrentSublistValue({
        sublistId: "item",
        fieldId: "price",
        value: -1
      });
    } catch (_e_price) {}

    try {
      so.setCurrentSublistValue({
        sublistId: "item",
        fieldId: "rate",
        value: normalizedAmount
      });
    } catch (_e_rate) {}

    try {
      so.setCurrentSublistValue({
        sublistId: "item",
        fieldId: "amount",
        value: normalizedAmount
      });
    } catch (_e_amount) {}

    so.commitLine({ sublistId: "item" });

    return normalizedAmount;
  }

  function addSurchargeLines(so, data) {
    var requestedTotals =
      data && data.totals && typeof data.totals === "object" ? data.totals : {};

    var baseSubtotal = asNumber(requestedTotals.subtotal, 0);

    if (baseSubtotal <= 0) {
      try {
        baseSubtotal = asNumber(so.getValue({ fieldId: "subtotal" }), 0);
      } catch (_e_subtotal) {
        baseSubtotal = 0;
      }
    }

    var surchargeAmount = round2(baseSubtotal * SURCHARGE_RATE);

    if (surchargeAmount <= 0) {
      return {
        baseSubtotal: round2(baseSubtotal),
        surcharge: 0,
        adjustedSubtotal: round2(baseSubtotal)
      };
    }

    appendSubtotalLine(so);
    appendSurchargeLine(so, surchargeAmount);

    return {
      baseSubtotal: round2(baseSubtotal),
      surcharge: surchargeAmount,
      adjustedSubtotal: round2(baseSubtotal + surchargeAmount)
    };
  }

  function buildPreviewSalesOrder(data) {
    var shipmethod = asString(data.shipmethod).trim();
    var amount = asNumber(data.pacejetAmount, 0);
    var quoteJson = asString(data.quoteJson);
    var locationId = resolveLocationId(data, quoteJson);
    var lines = normalizeLines(data.lines);
    var address = data.shippingAddress || {};
    var entityId = resolveEntityId(data);
    var so;

    if (!/^\d+$/.test(entityId)) {
      throw new Error("customerId is required for preview tax calculation");
    }

    if (!shipmethod) {
      throw new Error("shipmethod is required");
    }

    if (amount <= 0) {
      throw new Error("pacejetAmount must be > 0");
    }

    if (!lines.length) {
      throw new Error("At least one preview line is required");
    }

    if (!address || !asString(address.country) || !asString(address.zip)) {
      throw new Error(
        "shippingAddress.country and shippingAddress.zip are required"
      );
    }

    so = record.create({
      type: record.Type.SALES_ORDER,
      isDynamic: true
    });

    setIfPresent(so, "entity", Number(entityId));

    applyShippingAddress(so, address);

    if (locationId) {
      try {
        so.setValue({
          fieldId: "location",
          value: Number(locationId)
        });
      } catch (_e) {}
    }

    so.setValue({
      fieldId: "shipmethod",
      value: Number(shipmethod)
    });

    addLines(so, lines, locationId);

    var surchargeSummary = addSurchargeLines(so, data);

    so.setValue({
      fieldId: "shippingcost",
      value: amount
    });

    applyAccessorialBodyFields(so, data);

    try {
      so.setValue({ fieldId: "taxdetailsoverride", value: false });
    } catch (_e) {}

    try {
      so.setValue({ fieldId: "taxamountoverride", value: 0 });
    } catch (_e) {}

    try {
      so.setValue({ fieldId: "taxtotaloverride", value: 0 });
    } catch (_e) {}

    so.setValue({
      fieldId: "memo",
      value: "preview-temp-" + Date.now()
    });

    return {
      record: so,
      resolvedLocationId: locationId,
      surchargeSummary: surchargeSummary
    };
  }

  function saveAndReload(so) {
    var savedId = so.save({
      enableSourcing: true,
      ignoreMandatoryFields: true
    });

    var reloaded = record.load({
      type: record.Type.SALES_ORDER,
      id: savedId,
      isDynamic: false
    });

    return { savedId: savedId, reloaded: reloaded };
  }

  function buildBaselineSalesOrder(data, surchargeSummary) {
    // Identical to buildPreviewSalesOrder but with $0 shipping
    // Re-uses all the same field/line setup, just skips shippingcost
    var shipmethod = asString(data.shipmethod).trim();
    var quoteJson = asString(data.quoteJson);
    var locationId = resolveLocationId(data, quoteJson);
    var lines = normalizeLines(data.lines);
    var address = data.shippingAddress || {};
    var entityId = resolveEntityId(data);

    var so = record.create({
      type: record.Type.SALES_ORDER,
      isDynamic: true
    });

    setIfPresent(so, "entity", Number(entityId));
    applyShippingAddress(so, address);

    if (locationId) {
      try {
        so.setValue({ fieldId: "location", value: Number(locationId) });
      } catch (_e) {}
    }

    so.setValue({ fieldId: "shipmethod", value: Number(shipmethod) });

    addLines(so, lines, locationId);

    // Re-add surcharge lines using the already-computed summary
    if (surchargeSummary.surcharge > 0) {
      appendSubtotalLine(so);
      appendSurchargeLine(so, surchargeSummary.surcharge);
    }

    // $0 shipping — we only want the product tax rate
    so.setValue({ fieldId: "shippingcost", value: 0 });

    applyAccessorialBodyFields(so, data);

    try {
      so.setValue({ fieldId: "taxdetailsoverride", value: false });
    } catch (_e) {}
    try {
      so.setValue({ fieldId: "taxamountoverride", value: 0 });
    } catch (_e) {}
    try {
      so.setValue({ fieldId: "taxtotaloverride", value: 0 });
    } catch (_e) {}

    so.setValue({
      fieldId: "memo",
      value: "preview-temp-baseline-" + Date.now()
    });

    return so;
  }

  function finalizePreviewViaSave(data) {
    var requestedTotals =
      data && data.totals && typeof data.totals === "object" ? data.totals : {};
    var requestedSubtotal = asNumber(requestedTotals.subtotal, 0);
    var requestedShipping = asNumber(requestedTotals.shipping, 0);

    var preview = buildPreviewSalesOrder(data);
    var so = preview.record;
    var calculateTaxBeforeSave = tryCalculateTax(so);

    var savedIdFull = null;
    var savedIdBaseline = null;
    var cleanupResult = {
      full: { attempted: false, success: null, error: null },
      baseline: { attempted: false, success: null, error: null }
    };

    try {
      // Pass 1: Save full order (with shipping) to get NetSuite's total
      var fullPass = saveAndReload(so);
      savedIdFull = fullPass.savedId;
      var reloadedFull = fullPass.reloaded;

      var adjustedSubtotal = asNumber(
        getValueSafe(reloadedFull, "subtotal"),
        requestedSubtotal
      );
      var surcharge = asNumber(
        preview.surchargeSummary.surcharge,
        round2(requestedSubtotal * SURCHARGE_RATE)
      );
      var subtotal =
        surcharge > 0 && adjustedSubtotal >= surcharge
          ? round2(adjustedSubtotal - surcharge)
          : adjustedSubtotal;
      var shipping = asNumber(
        getValueSafe(reloadedFull, "shippingcost"),
        requestedShipping
      );
      var taxFromFull = asNumber(getValueSafe(reloadedFull, "taxtotal"), 0);
      var total = asNumber(getValueSafe(reloadedFull, "total"), 0);

      // Pass 2: Save baseline order (with $0 shipping) to get the true product-only tax
      var baselineSo = buildBaselineSalesOrder(data, preview.surchargeSummary);
      var baselinePass = saveAndReload(baselineSo);
      savedIdBaseline = baselinePass.savedId;
      var reloadedBaseline = baselinePass.reloaded;

      var baselineTax = asNumber(getValueSafe(reloadedBaseline, "taxtotal"), 0);
      var baselineSubtotal = asNumber(
        getValueSafe(reloadedBaseline, "subtotal"),
        adjustedSubtotal
      );

      // baselineTax === 0 is valid for tax-exempt customers — trust AvaTax, do not throw.
      // productTaxRate will be 0 for exempt customers, which is correct.
      var productTaxRate =
        baselineTax > 0 && baselineSubtotal > 0
          ? baselineTax / baselineSubtotal
          : 0;

      // Determine shipping taxability by comparing baseline tax to full-order tax
      var shippingTaxAmount = round2(taxFromFull - baselineTax);
      var shippingAppearsTaxed = shippingTaxAmount > 0.01;

      // Use AvaTax's full-pass result directly. AvaTax determines freight taxability
      // via the tax code (FR020500 is non-taxable in CA); do not override that with a
      // manually computed product-rate-on-shipping figure.
      var tax = taxFromFull;

      // Recompute total from components so it's always self-consistent
      var computedTotal = round2(adjustedSubtotal + shipping + tax);
      var taxBasis = round2(adjustedSubtotal + shipping);
      var effectiveTaxRate =
        taxBasis > 0 ? Math.round((tax / taxBasis) * 1000000) / 1000000 : 0;

      return {
        subtotal: Number(subtotal.toFixed(2)),
        baseSubtotal: Number(subtotal.toFixed(2)),
        adjustedSubtotal: Number(adjustedSubtotal.toFixed(2)),
        surcharge: Number(surcharge.toFixed(2)),
        shipping: Number(shipping.toFixed(2)),
        tax: Number(tax.toFixed(2)),
        total: Number(computedTotal.toFixed(2)),
        effectiveTaxRate: Math.round(effectiveTaxRate * 1000000) / 1000000,
        taxIncludesAll: true,
        resolvedLocationId: preview.resolvedLocationId,
        diagnostics: {
          source: "preview-temp-so-two-pass",
          calculateTaxBeforeSave: calculateTaxBeforeSave,
          twoPassAnalysis: {
            baselineTax: baselineTax,
            baselineSubtotal: baselineSubtotal,
            productTaxRate: Math.round(productTaxRate * 10000) / 100,
            taxFromFullPass: taxFromFull,
            shippingTaxAmount: shippingTaxAmount,
            shippingAppearsTaxed: shippingAppearsTaxed,
            shippingTaxApplied: shippingTaxAmount
          },
          taxOverrideActive:
            asNumber(getValueSafe(reloadedFull, "taxamountoverride"), 0) ===
            taxFromFull,
          taxFieldSnapshotAfterSave: buildTaxFieldSnapshot(reloadedFull),
          taxDetailsAfterSave: getTaxDetailsSnapshot(reloadedFull),
          temporarySalesOrderIds: {
            full: savedIdFull,
            baseline: savedIdBaseline
          },
          cleanupResult: cleanupResult
        }
      };
    } finally {
      if (savedIdFull) {
        cleanupResult.full.attempted = true;
        try {
          record.delete({ type: record.Type.SALES_ORDER, id: savedIdFull });
          cleanupResult.full.success = true;
        } catch (e) {
          cleanupResult.full.success = false;
          cleanupResult.full.error = e.message || String(e);
          log.error("Preview full SO cleanup failed", {
            id: savedIdFull,
            error: cleanupResult.full.error
          });
        }
      }

      if (savedIdBaseline) {
        cleanupResult.baseline.attempted = true;
        try {
          record.delete({ type: record.Type.SALES_ORDER, id: savedIdBaseline });
          cleanupResult.baseline.success = true;
        } catch (e) {
          cleanupResult.baseline.success = false;
          cleanupResult.baseline.error = e.message || String(e);
          log.error("Preview baseline SO cleanup failed", {
            id: savedIdBaseline,
            error: cleanupResult.baseline.error
          });
        }
      }
    }
  }

  function onRequest(context) {
    var req = context.request;
    var res = context.response;

    if (req.method === "GET") {
      return writeJson(res, 200, {
        ok: true,
        message: "Pacejet preview summary suitelet is reachable"
      });
    }

    if (req.method !== "POST") {
      return writeJson(res, 405, {
        ok: false,
        error: "POST required"
      });
    }

    var data;

    try {
      data = JSON.parse(req.body || "{}");
    } catch (_e) {
      return writeJson(res, 400, {
        ok: false,
        error: "Invalid JSON"
      });
    }

    try {
      var totals = finalizePreviewViaSave(data);

      return writeJson(res, 200, {
        ok: true,
        resolvedLocationId: totals.resolvedLocationId,
        totals: totals
      });
    } catch (e) {
      log.error("Pacejet preview summary failed", e);

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
