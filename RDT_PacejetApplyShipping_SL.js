/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @description Applies Pacejet shipping quote to Sales Order
 */
define(["N/record", "N/runtime", "N/log", "N/search"], (
  record,
  runtime,
  log,
  search
) => {
  const BODY_AMOUNT = "custbody_rdt_pacejet_amount";
  const BODY_CARRIER = "custbody_rdt_pj_carrier_name";
  const BODY_SERVICE = "custbody_rdt_pj_service_name";
  const BODY_QUOTE = "custbody_rdt_pj_quote_json";

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function json(res, code, payload) {
    res.statusCode = code;
    res.setHeader({ name: "Content-Type", value: "application/json" });
    res.write(JSON.stringify(payload));
  }

  function isNumericId(v) {
    return /^\d+$/.test(String(v || "").trim());
  }

  function getFirstNumericValue(values) {
    for (let i = 0; i < values.length; i++) {
      const value = String(values[i] || "").trim();
      if (isNumericId(value)) return value;
    }
    return "";
  }

  function safeJson(value) {
    try {
      return JSON.stringify(value);
    } catch (_e) {
      return String(value);
    }
  }

  function buildUserSnapshot() {
    const user = runtime.getCurrentUser();
    if (!user) return {};

    return {
      id: user.id || "",
      name: user.name || "",
      role: user.role || "",
      roleCenter: user.roleCenter || "",
      department: user.department || "",
      email: user.email || "",
      subsidiary: user.subsidiary || "",
      location: user.location || "",
      contact: user.contact || ""
    };
  }

  function logLookupDiagnostics(userId, attempts) {
    log.audit("Pacejet cart lookup context", {
      userId,
      currentUser: buildUserSnapshot(),
      attempts: (attempts || []).map((attempt) => ({
        label: attempt.label,
        filters: safeJson(attempt.filters)
      }))
    });
  }

  function logRecentSalesOrders(userId) {
    try {
      const recentSearch = search.create({
        type: search.Type.SALES_ORDER,
        filters: [["mainline", "is", "T"]],
        columns: [
          search.createColumn({ name: "datecreated", sort: search.Sort.DESC }),
          search.createColumn({ name: "internalid", sort: search.Sort.DESC }),
          "tranid",
          "entity",
          "createdby",
          "status"
        ]
      });

      const rows = recentSearch.run().getRange({ start: 0, end: 10 }) || [];

      log.audit("Pacejet recent SO diagnostics", {
        userId,
        currentUser: buildUserSnapshot(),
        rows: rows.map((row) => ({
          internalid: row.getValue({ name: "internalid" }),
          tranid: row.getValue({ name: "tranid" }),
          entity: row.getValue({ name: "entity" }),
          createdby: row.getValue({ name: "createdby" }),
          status:
            row.getText({ name: "status" }) || row.getValue({ name: "status" })
        }))
      });
    } catch (e) {
      log.error("Pacejet recent SO diagnostics failed", {
        userId,
        error: e
      });
    }
  }

  function runSalesOrderLookup(filters, label, userId) {
    const soSearch = search.create({
      type: search.Type.SALES_ORDER,
      filters: filters,
      columns: [
        search.createColumn({ name: "datecreated", sort: search.Sort.DESC }),
        search.createColumn({ name: "internalid", sort: search.Sort.DESC }),
        "tranid",
        "entity",
        "createdby",
        "status",
        "mainline"
      ]
    });

    const results = soSearch.run().getRange({ start: 0, end: 5 }) || [];

    log.audit("Pacejet cart lookup attempt", {
      label,
      userId,
      hits: results.map((row) => ({
        internalid: row.getValue({ name: "internalid" }),
        tranid: row.getValue({ name: "tranid" }),
        entity: row.getValue({ name: "entity" }),
        createdby: row.getValue({ name: "createdby" }),
        status:
          row.getText({ name: "status" }) || row.getValue({ name: "status" })
      }))
    });

    return results.length
      ? String(results[0].getValue({ name: "internalid" }) || "").trim()
      : "";
  }

  function findCurrentCartSalesOrderId() {
    const user = runtime.getCurrentUser();
    const userId = String(user.id || "");

    if (!isNumericId(userId)) {
      log.error("Invalid user id", { userId });
      return null;
    }

    const attempts = [
      {
        label: "entity-or-createdby-open",
        filters: [
          ["mainline", "is", "T"],
          "AND",
          [["entity", "anyof", userId], "OR", ["createdby", "anyof", userId]],
          "AND",
          ["status", "noneof", "SalesOrd:C"]
        ]
      },
      {
        label: "entity-only-open",
        filters: [
          ["mainline", "is", "T"],
          "AND",
          ["entity", "anyof", userId],
          "AND",
          ["status", "noneof", "SalesOrd:C"]
        ]
      },
      {
        label: "createdby-only-open",
        filters: [
          ["mainline", "is", "T"],
          "AND",
          ["createdby", "anyof", userId],
          "AND",
          ["status", "noneof", "SalesOrd:C"]
        ]
      },
      {
        label: "entity-or-createdby-any-status",
        filters: [
          ["mainline", "is", "T"],
          "AND",
          [["entity", "anyof", userId], "OR", ["createdby", "anyof", userId]]
        ]
      }
    ];

    logLookupDiagnostics(userId, attempts);

    for (let i = 0; i < attempts.length; i++) {
      const soId = runSalesOrderLookup(
        attempts[i].filters,
        attempts[i].label,
        userId
      );

      if (isNumericId(soId)) {
        log.audit("Cart resolved (FIXED)", {
          userId,
          soId,
          strategy: attempts[i].label
        });

        return soId;
      }
    }

    logRecentSalesOrders(userId);
    log.error("Still no cart found", {
      userId,
      currentUser: buildUserSnapshot()
    });
    return null;
  }

  function buildOrderSnapshot(so) {
    if (!so) return {};

    return {
      internalid: so.id || "",
      tranid: so.getValue({ fieldId: "tranid" }) || "",
      entity: so.getValue({ fieldId: "entity" }) || "",
      shipmethod: so.getValue({ fieldId: "shipmethod" }) || "",
      subtotal: so.getValue({ fieldId: "subtotal" }) || 0,
      shippingcost: so.getValue({ fieldId: "shippingcost" }) || 0,
      taxtotal: so.getValue({ fieldId: "taxtotal" }) || 0,
      total: so.getValue({ fieldId: "total" }) || 0,
      itemcount: so.getLineCount({ sublistId: "item" }) || 0,
      pacejetAmount: so.getValue({ fieldId: BODY_AMOUNT }) || 0,
      carrier: so.getValue({ fieldId: BODY_CARRIER }) || "",
      service: so.getValue({ fieldId: BODY_SERVICE }) || ""
    };
  }

  function onRequest(ctx) {
    const req = ctx.request;
    const res = ctx.response;

    if (req.method !== "POST") {
      return json(res, 405, { ok: false, error: "POST required" });
    }

    let data;
    try {
      data = JSON.parse(req.body || "{}");
    } catch (e) {
      return json(res, 400, { ok: false, error: "Invalid JSON" });
    }

    let orderId = getFirstNumericValue([
      data.orderId,
      data.orderInternalId,
      data.internalid,
      data.internalId,
      data.salesOrderId
    ]);
    const shipmethod = String(data.shipmethod || "").trim();
    const amount = num(data.pacejetAmount);

    if (!shipmethod || amount <= 0) {
      return json(res, 400, {
        ok: false,
        error: "Missing or invalid shipmethod / amount"
      });
    }

    // If orderId isn't numeric (ex: "cart"), resolve it server-side
    if (!isNumericId(orderId)) {
      orderId = findCurrentCartSalesOrderId() || "";
    }

    log.audit("Pacejet apply request", {
      incomingOrderId: data.orderId,
      resolvedOrderId: orderId,
      userId: runtime.getCurrentUser().id,
      shipmethod: shipmethod,
      amount: amount,
      carrier: data.carrier || "",
      service: data.service || "",
      currentUser: runtime.getCurrentUser() && runtime.getCurrentUser().id
    });

    if (!isNumericId(orderId)) {
      log.error("Pacejet: could not resolve cart SO", {
        user: runtime.getCurrentUser() && runtime.getCurrentUser().id,
        incomingOrderId: data.orderId,
        userId: runtime.getCurrentUser().id,
        currentUser: buildUserSnapshot(),
        requestBody: {
          shipmethod,
          amount,
          carrier: data.carrier || "",
          service: data.service || ""
        }
      });

      return json(res, 409, {
        ok: false,
        retry: true,
        error: "Cart Sales Order not found yet"
      });
    }

    let so;
    try {
      so = record.load({
        type: record.Type.SALES_ORDER,
        id: orderId,
        isDynamic: true
      });
      log.audit("Pacejet loaded order", buildOrderSnapshot(so));
    } catch (e) {
      log.error("Pacejet load failed", { orderId, error: e });
      return json(res, 409, {
        ok: false,
        retry: true,
        error: "Order not ready yet"
      });
    }

    try {
      // set shipmethod FIRST so sourcing runs
      so.setValue({
        fieldId: "shipmethod",
        value: shipmethod,
        ignoreFieldChange: false
      });

      // then set shipping cost
      so.setValue({
        fieldId: "shippingcost",
        value: amount,
        ignoreFieldChange: false
      });

      so.setValue({ fieldId: BODY_AMOUNT, value: amount });

      if (data.carrier)
        so.setValue({ fieldId: BODY_CARRIER, value: String(data.carrier) });
      if (data.service)
        so.setValue({ fieldId: BODY_SERVICE, value: String(data.service) });

      if (data.quoteJson) {
        let q = String(data.quoteJson);
        if (q.length > 3800) q = q.slice(0, 3800);
        so.setValue({ fieldId: BODY_QUOTE, value: q });
      }

      so.setValue({
        fieldId: "taxdetailsoverride",
        value: false
      });

      // First save (apply shipmethod + shipping cost)
      const savedId = so.save({
        enableSourcing: true,
        ignoreMandatoryFields: true
      });

      // Reload and save again to force SuiteTax / AvaTax recalculation
      var so2 = record.load({
        type: record.Type.SALES_ORDER,
        id: savedId,
        isDynamic: true
      });

      so2.setValue({
        fieldId: "taxdetailsoverride",
        value: false
      });

      const savedId2 = so2.save({
        enableSourcing: true,
        ignoreMandatoryFields: true
      });

      // Load final order so we can return correct totals
      var soFinal = record.load({
        type: record.Type.SALES_ORDER,
        id: savedId2,
        isDynamic: false
      });

      const finalTotals = {
        subtotal: Number(soFinal.getValue({ fieldId: "subtotal" }) || 0),
        shipping: Number(soFinal.getValue({ fieldId: "shippingcost" }) || 0),
        tax: Number(soFinal.getValue({ fieldId: "taxtotal" }) || 0),
        total: Number(soFinal.getValue({ fieldId: "total" }) || 0)
      };

      log.audit("Pacejet final order snapshot", {
        order: buildOrderSnapshot(soFinal),
        responseTotals: finalTotals
      });

      return json(res, 200, {
        ok: true,
        orderId: savedId2,
        totals: finalTotals,
        debug: {
          resolvedOrderId: orderId,
          loadedOrder: buildOrderSnapshot(so),
          finalOrder: buildOrderSnapshot(soFinal)
        }
      });
    } catch (e) {
      log.error("Pacejet save failed", e);
      return json(res, 500, { ok: false, error: e.message || String(e) });
    }
  }

  return { onRequest };
});
