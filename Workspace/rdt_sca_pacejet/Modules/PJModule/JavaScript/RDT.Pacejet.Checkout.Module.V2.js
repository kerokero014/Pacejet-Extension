/// <amd-module name="RDT.Pacejet.Checkout.Module.V2"/>

define("RDT.Pacejet.Checkout.Module.V2", [
  "LiveOrder.Model",
  "jQuery",
  "RDT.Pacejet.Config",
  "RDT.Pacejet.State",
  "RDT.Pacejet.Service",
  "RDT.Pacejet.UI",
  "RDT.Pacejet.AccessorialMatrix",
  "RDT.Pacejet.Summary"
], function (
  LiveOrderModel,
  jQuery,
  PacejetConfig,
  PacejetState,
  PacejetService,
  PacejetUI,
  AccessorialMatrix,
  PacejetSummary
) {
  "use strict";

  var $ = jQuery;

  var MODEL_WIRED = false;
  var INITIAL_FETCH_DONE = false;
  var REFRESH_TIMER = null;
  var ACCESSORIAL_RERATE_TIMER = null;
  var SELECTION_APPLY_TOKEN = 0;

  var ACCESSORIAL_FIELD_MAP = {
    driver_call: "custbody_callpriortruck",
    lift_gate: "custbody_pj_ssliftgate",
    job_site: "custbody_jobsite",
    residential: "custbody_residential",
    schedule_appt: "custbody_appointmenttruck",
    self_storage: "custbody_selfstorage",
    school: "custbody_school_delivery",
    inside_delivery: "custbody_inside_delivery",
    dangerous_goods: "custbody_dangerous_goods",
    hazmat_parcel: "custbody_access_hazmat_parcel"
  };

  var state = PacejetState.get();

  function applyCarrierAccessorialRules(payload) {
    if (!payload) return;

    var carrier =
      payload.carrierCode || payload.carrier || payload.carrierName || "";

    var key = String(carrier).toUpperCase().replace(/\s+/g, "_");

    var allowed = AccessorialMatrix.carriers && AccessorialMatrix.carriers[key];

    if (allowed) {
      state.allowedAccessorials = allowed;

      if (PacejetUI && PacejetUI.updateAccessorials) {
        PacejetUI.updateAccessorials(allowed);
      }
    } else {
      console.warn("[Pacejet] No accessorial matrix match for key:", key);
    }

    return { key: key, allowed: allowed };
  }

  function getOrderModel() {
    try {
      return LiveOrderModel && LiveOrderModel.getInstance
        ? LiveOrderModel.getInstance()
        : null;
    } catch (_e) {
      return null;
    }
  }

  function getCustomFieldValue(order, id) {
    var cfs = (order && order.get && order.get("customFields")) || [];
    for (var i = 0; i < cfs.length; i++) {
      if (cfs[i] && cfs[i].id === id) return cfs[i].value;
    }
    return null;
  }

  function getOrderInternalId(order) {
    if (!order || !order.get) return "";

    var candidates = [
      order.get("internalid"),
      order.get("internalId"),
      order.get("id")
    ];

    var confirmation = order.get("confirmation") || {};
    candidates.push(
      confirmation.internalid,
      confirmation.internalId,
      confirmation.id
    );

    for (var i = 0; i < candidates.length; i++) {
      var value = String(candidates[i] || "").trim();
      if (/^\d+$/.test(value)) return value;
    }

    return "";
  }

  function logSummarySnapshot(order, stage, extra) {
    if (!order || !order.get) return;

    var summary = order.get("summary") || {};
    var snapshot = {
      stage: stage,
      shipmethod: order.get("shipmethod"),
      shippingCost:
        summary.shippingcost ||
        summary.shippingCost ||
        summary.estimatedshipping,
      taxtotal: summary.taxtotal,
      taxTotal: summary.taxTotal,
      tax: summary.tax,
      taxamount: summary.taxamount,
      total: summary.total || summary.totalAmount || summary.totalamount,
      subtotal: summary.subtotal,
      custbody_rdt_pacejet_amount: getCustomFieldValue(
        order,
        "custbody_rdt_pacejet_amount"
      ),
      timestamp: new Date().toISOString()
    };

    if (extra) snapshot.extra = extra;

    console.log("[Pacejet][TaxDebug] summary snapshot", snapshot);
  }

  function getSummaryShipping(summary) {
    summary = summary || {};
    return Number(
      summary.shippingcost ||
        summary.shippingCost ||
        summary.estimatedshipping ||
        0
    );
  }

  function getSummaryTax(summary) {
    summary = summary || {};
    return Number(
      summary.taxtotal ||
        summary.taxTotal ||
        summary.tax ||
        summary.taxamount ||
        summary.taxAmount ||
        0
    );
  }

  function captureBaseCartTotals(order) {
    if (!order || !order.get) return;

    state.cache = state.cache || {};

    var summary = order.get("summary") || {};
    var shipping = getSummaryShipping(summary);

    // Keep the pre-shipping cart subtotal/tax as the baseline.
    // Refresh it whenever checkout is still in the zero-shipping state.
    if (!state.cache.baseCartTotals || shipping <= 0.009) {
      state.cache.baseCartTotals = {
        subtotal: Number(summary.subtotal || 0),
        tax: getSummaryTax(summary),
        capturedAt: Date.now()
      };
    }
  }

  function normalizeServerTotalsForDisplay(order, totals) {
    totals = totals || {};

    var summary = (order && order.get && order.get("summary")) || {};
    var base = (state.cache && state.cache.baseCartTotals) || {};
    var subtotal = Number(
      base.subtotal || summary.subtotal || totals.subtotal || 0
    );
    var shipping = Number(totals.shipping || 0);
    var tax = Number(totals.tax || getSummaryTax(summary) || 0);

    return {
      subtotal: subtotal,
      shipping: shipping,
      tax: tax,
      total: Number(subtotal + shipping + tax)
    };
  }

  function requestServerAppliedTotals(order, selection, attempt) {
    attempt = attempt || 0;

    if (!selection || !selection.shipCode) {
      return jQuery.Deferred().reject().promise();
    }

    var orderId = getOrderInternalId(order);

    if (!orderId) {
      console.warn("[Pacejet] No SO yet (checkout) — skipping Suitelet");
      return jQuery.Deferred().reject().promise();
    }

    return $.ajax({
      url: "/app/site/hosting/scriptlet.nl?script=3956&deploy=1",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({
        orderId: orderId,
        shipmethod: selection.shipCode,
        pacejetAmount: selection.cost || 0,
        carrier: selection.carrier || "",
        service: selection.service || "",
        quoteJson: JSON.stringify(selection)
      })
    }).then(function (resp) {
      if (resp && resp.retry && attempt < 5) {
        return jQuery
          .Deferred(function (defer) {
            setTimeout(function () {
              requestServerAppliedTotals(order, selection, attempt + 1).then(
                defer.resolve,
                defer.reject
              );
            }, 500);
          })
          .promise();
      }

      if (!resp || !resp.ok || !resp.totals) {
        return jQuery
          .Deferred()
          .reject(new Error("Pacejet totals apply failed"))
          .promise();
      }

      return resp;
    });
  }

  function applyServerTotalsToOrder(order, resp, stage) {
    if (!order || !order.get || !order.set || !resp || !resp.totals) return;

    var totals = normalizeServerTotalsForDisplay(order, resp.totals || {});
    var summary = order.get("summary") || {};

    state.cache = state.cache || {};
    state.cache.lastServerTotals = {
      subtotal: Number(totals.subtotal || 0),
      shipping: Number(totals.shipping || 0),
      tax: Number(totals.tax || 0),
      total: Number(totals.total || 0)
    };

    var subtotal = Number(totals.subtotal || summary.subtotal || 0);
    var shipping = Number(totals.shipping || 0);
    var tax = Number(totals.tax || 0);
    var total = Number(totals.total || subtotal + shipping + tax);

    summary.subtotal = subtotal;
    summary.shippingcost = shipping;
    summary.shippingCost = shipping;
    summary.estimatedshipping = shipping;
    summary.taxtotal = tax;
    summary.taxTotal = tax;
    summary.tax = tax;
    summary.taxamount = tax;
    summary.taxAmount = tax;
    summary.total = total;
    summary.totalamount = total;
    summary.totalAmount = total;

    order.set("summary", summary);
    order.trigger("change");
    order.trigger("change:summary");
    order.trigger("sync");

    console.log("[Pacejet][TaxDebug] applied suitelet totals", {
      stage: stage || "unknown",
      totals: totals
    });
  }

  function applyLocalSelectionToSummary(order, selection, stage) {
    if (!order || !order.get || !order.set || !selection) return;

    var summary = order.get("summary") || {};
    var subtotal = Number(summary.subtotal || 0);
    var tax = getSummaryTax(summary);
    var shipping = Number(selection.cost || 0);
    var total = Number(subtotal + shipping + tax);

    summary.shippingcost = shipping;
    summary.shippingCost = shipping;
    summary.estimatedshipping = shipping;
    summary.total = total;
    summary.totalamount = total;
    summary.totalAmount = total;

    order.set("summary", summary);
    order.trigger("change");
    order.trigger("change:summary");

    console.log("[Pacejet][TaxDebug] applied local selected shipping", {
      stage: stage || "unknown",
      shipping: shipping,
      tax: tax,
      total: total
    });
  }

  function paintSummaryWhenReady(order, reason) {
    if (!order) return;

    var tries = 0;
    var max = 25;

    (function tick() {
      tries++;

      if (
        $(".order-wizard-cart-summary-container, .order-wizard-cart-summary")
          .length
      ) {
        PacejetSummary.enforcePacejetSummary(order);
        PacejetSummary.renderSummaryUI(order);
        return;
      }

      if (tries < max) {
        setTimeout(tick, 100);
      } else {
        console.warn("[Pacejet] Summary paint timeout:", reason);
      }
    })();
  }

  function clearSelectedRate() {
    state.selection.shipCode = null;
    state.selection.cost = null;
    state.selection.carrier = null;
    state.selection.service = null;
    state.selection.transitDays = null;
    state.selection.origins = [];
  }

  function getShipmethodId(shipmethod) {
    if (shipmethod === undefined || shipmethod === null || shipmethod === "") {
      return "";
    }

    if (typeof shipmethod === "object") {
      return String(
        shipmethod.internalid ||
          shipmethod.internalId ||
          shipmethod.id ||
          shipmethod.shipmethod ||
          shipmethod.value ||
          ""
      );
    }

    return String(shipmethod);
  }

  function syncSelectionFromOrder(order) {
    if (!order || !order.get) return;

    var shipmethodId = getShipmethodId(order.get("shipmethod"));
    if (!shipmethodId) {
      return;
    }

    state.selection.shipCode = shipmethodId;

    var pacejetAmount = Number(
      getCustomFieldValue(order, "custbody_rdt_pacejet_amount") || 0
    );
    if (pacejetAmount > 0) {
      state.selection.cost = pacejetAmount;
    }

    var carrier = getCustomFieldValue(order, "custbody_rdt_pj_carrier_name");
    var service = getCustomFieldValue(order, "custbody_rdt_pj_service_name");
    var transitDays = getCustomFieldValue(
      order,
      "custbody_rdt_pj_transit_days"
    );

    if (carrier) state.selection.carrier = carrier;
    if (service) state.selection.service = service;
    if (
      transitDays !== null &&
      transitDays !== undefined &&
      transitDays !== ""
    ) {
      state.selection.transitDays = transitDays;
    }
  }

  function persistPacejetSelection(selection) {
    var order = getOrderModel();
    if (!order || !selection) {
      return jQuery.Deferred().resolve().promise();
    }

    var customFields = order.get("customFields") || [];

    function setField(id, value) {
      if (value === undefined || value === null || value === "") return;

      for (var i = 0; i < customFields.length; i++) {
        if (customFields[i].id === id) {
          customFields[i].value = value;
          return;
        }
      }

      customFields.push({ id: id, value: value });
    }

    /* ===============================
     * CORE RATE FIELDS
     * =============================== */

    setField("custbody_rdt_pacejet_amount", selection.cost || 0);
    setField("custbody_rdt_pj_carrier_name", selection.carrier || "");
    setField("custbody_rdt_pj_service_name", selection.service || "");

    setField(
      "custbody_rdt_pj_accessorial_total",
      selection.accessorialDelta || 0
    );

    /* ===============================
     * TRANSIT DAYS + ARRIVAL DATE
     * =============================== */

    var t = Number(selection.transitDays);
    if (!isNaN(t) && t > 0) {
      setField("custbody_rdt_pj_transit_days", t);

      var d = new Date();
      d.setDate(d.getDate() + t);

      setField(
        "custbody_rdt_pj_est_arrival_date",
        d.toISOString().split("T")[0]
      );
    }

    /* ===============================
     * ORIGIN DETAILS
     * =============================== */

    if (selection.origins && selection.origins.length) {
      setField("custbody_rdt_pj_origin_count", selection.origins.length);

      var first = selection.origins[0] || {};
      setField(
        "custbody_rdt_pj_origin_key",
        first.originKey || first.zip || first.city || ""
      );

      var summary = selection.origins
        .map(function (o) {
          return (
            (o.city || o.zip || o.originKey || "Origin") +
            ": $" +
            Number(o.cost || 0).toFixed(2)
          );
        })
        .join("\n");

      setField("custbody_rdt_pj_origin_summary", summary);
    }

    /* ===============================
     * ACCESSORIAL CHECKBOXES
     * =============================== */

    if (selection.accessorials) {
      Object.keys(ACCESSORIAL_FIELD_MAP).forEach(function (key) {
        var fieldId = ACCESSORIAL_FIELD_MAP[key];
        var checked = !!selection.accessorials[key];

        // NetSuite checkbox fields require "T" / "F"
        setField(fieldId, checked ? "T" : "F");
      });
    }

    /* ===============================
     * RAW QUOTE JSON (DEBUG / AUDIT)
     * =============================== */

    try {
      var json = JSON.stringify(selection);
      if (json.length > 3800) json = json.slice(0, 3800);
      setField("custbody_rdt_pj_quote_json", json);
    } catch (_e) {}

    order.set("customFields", customFields);
    return order.save();
  }

  function applyShipmethodToOrder(order, shipCode) {
    if (!order || !shipCode) {
      return jQuery.Deferred().reject().promise();
    }

    order.set("shipmethod", String(shipCode));

    return order.save();
  }

  PacejetUI.onSelect(function (payload) {
    if (!payload) return;

    var order = getOrderModel();
    if (!order) return;

    /* ===============================
     * ACCESSORIAL EDIT (NO RERATE)
     * =============================== */
    if (payload.accessorials) {
      state.selection.accessorials = payload.accessorials;
      state.flags.accessorialsDirty = true;
      clearSelectedRate();
      PacejetUI.setContinueButtonState(false);
      return;
    }

    /* ===============================
     * SHOW / UPDATE RATES
     * =============================== */
    if (payload.showRates === true) {
      state.flags.ratesVisible = true;
      state.flags.accessorialsDirty = false;
      refreshFromOrder(order, { mode: "hard", forceShowRates: true });
      return;
    }

    /* ===============================
     * RATE SELECTION
     * =============================== */
    if (!payload.shipCode) return;

    applyCarrierAccessorialRules(payload);

    state.selection.shipCode = payload.shipCode;
    state.selection.cost = payload.cost;
    state.selection.carrier = payload.carrier;
    state.selection.service = payload.service;
    state.selection.transitDays = payload.transitDays;
    state.selection.origins = payload.origins || [];

    var applyToken = ++SELECTION_APPLY_TOKEN;

    state.flags.suppressRefresh = true;
    state.flags.ratesVisible = true;

    captureBaseCartTotals(order);

    logSummarySnapshot(order, "before-apply", {
      selectedShipCode: payload.shipCode,
      selectedCost: payload.cost
    });

    if (window.ShippingAppliedFlag !== undefined) {
      window.ShippingAppliedFlag = false;
    }

    applyShipmethodToOrder(order, payload.shipCode)
      .then(function () {
        if (applyToken !== SELECTION_APPLY_TOKEN) return;

        return persistPacejetSelection(state.selection);
      })
      .then(function () {
        if (applyToken !== SELECTION_APPLY_TOKEN) return;

        applyLocalSelectionToSummary(order, state.selection, "after-selection");
        PacejetSummary.enforcePacejetSummary(order);
        PacejetSummary.renderSummaryUI(order);
        paintSummaryWhenReady(order, "after-selection");

        return requestServerAppliedTotals(order, state.selection).then(
          function (resp) {
            if (applyToken !== SELECTION_APPLY_TOKEN) return;

            applyServerTotalsToOrder(order, resp, "after-suitelet-apply");
          },
          function (err) {
            console.warn(
              "[Pacejet] Unable to refresh suitelet totals during checkout",
              err
            );
            return null;
          }
        );
      })
      .then(function () {
        if (applyToken !== SELECTION_APPLY_TOKEN) return;

        return order.fetch({
          reset: true,
          data: {
            t: Date.now(),
            fullsummary: "T"
          }
        });
      })
      .then(function () {
        if (applyToken !== SELECTION_APPLY_TOKEN) return;

        logSummarySnapshot(order, "after-shipmethod-set");
        PacejetSummary.enforcePacejetSummary(order);
        PacejetSummary.renderSummaryUI(order);
        paintSummaryWhenReady(order, "after-shipmethod-set");

        // The checkout step can re-render after shipmethod save/fetch.
        // Reattach the Pacejet UI so the selected rates table stays visible.
        waitForHostThenRefresh(order);
      })
      .fail(function (err) {
        if (applyToken !== SELECTION_APPLY_TOKEN) return;
        console.error("[Pacejet] Failed to apply shipmethod", err);
      })
      .always(function () {
        if (applyToken !== SELECTION_APPLY_TOKEN) return;
        state.flags.suppressRefresh = false;
      });
  });

  function refreshFromOrder(order, opts) {
    opts = opts || {};
    var softRefresh = opts.mode === "soft";
    var forceShowRates = opts.forceShowRates === true;

    var $host = $(".order-wizard-shipmethod-module").first();
    if (!$host.length) return;

    if (forceShowRates) {
      state.flags.ratesVisible = true;
    }

    if (!state.flags.ratesVisible) {
      PacejetUI.render($host, state.cache.lastRates || [], state, {
        deferClear: softRefresh,
        showRates: false,
        loading: false
      });
      PacejetUI.setContinueButtonState(!!state.selection.shipCode);
      $host.css("min-height", "");
      return;
    }

    state.flags.ratesLoading = true;
    PacejetUI.setContinueButtonState(!!state.selection.shipCode);

    var hostHeight = 0;
    if (softRefresh) {
      hostHeight = Number($host.outerHeight()) || 0;
      if (hostHeight > 0) {
        $host.css("min-height", hostHeight + "px");
      }
    } else {
      if (state.flags.ratesVisible) {
        document.body.classList.add("rdt-pj-prehide");
        PacejetUI.clear($host);
        PacejetUI.showLoading($host);
      } else {
        PacejetUI.render($host, state.cache.lastRates || [], state, {
          showRates: false,
          loading: true
        });
      }
    }

    PacejetService.fetchRates(order)
      .then(function (rates) {
        state.flags.ratesLoading = false;
        syncSelectionFromOrder(order);
        PacejetUI.render($host, rates, state, {
          deferClear: softRefresh,
          showRates: !!state.flags.ratesVisible
        });

        if (state.allowedAccessorials) {
          PacejetUI.updateAccessorials(state.allowedAccessorials);
        }

        if (!softRefresh) {
          document.body.classList.remove("rdt-pj-prehide");
        }

        $host.css("min-height", "");

        PacejetSummary.enforcePacejetSummary(order);
        PacejetSummary.renderSummaryUI(order);
      })
      .fail(function () {
        state.flags.ratesLoading = false;
        if (!softRefresh) {
          document.body.classList.remove("rdt-pj-prehide");
        }

        $host.css("min-height", "");

        $(".order-wizard-shipmethod-module-option-select")
          .removeClass("rdt-pj-native-hidden")
          .attr("aria-hidden", "false");
      });
  }

  function scheduleRefresh(order, mode) {
    if (REFRESH_TIMER) clearTimeout(REFRESH_TIMER);

    REFRESH_TIMER = setTimeout(function () {
      refreshFromOrder(order, { mode: mode || "soft" });
    }, 400);
  }

  function onOrderContextChanged() {
    var order = getOrderModel();
    if (!order) return;

    if (state.flags.suppressRefresh) return;

    clearSelectedRate();
    PacejetUI.setContinueButtonState(false);
    scheduleRefresh(order, "soft");
  }

  function onShipmethodChanged() {
    var order = getOrderModel();
    if (!order) return;

    syncSelectionFromOrder(order);
    PacejetUI.setContinueButtonState(!!state.selection.shipCode);

    if (state.flags.suppressRefresh) return;

    scheduleRefresh(order, "soft");
  }

  function waitForHostThenRefresh(order) {
    var tries = 0;
    var maxTries = 30;

    var timer = setInterval(function () {
      var $host = $(".order-wizard-shipmethod-module").first();

      if ($host.length) {
        clearInterval(timer);
        syncSelectionFromOrder(order);
        if (state.flags.ratesVisible) {
          refreshFromOrder(order, { mode: "hard" });
        } else {
          PacejetUI.render($host, state.cache.lastRates || [], state, {
            showRates: false,
            loading: false
          });
          PacejetUI.setContinueButtonState(!!state.selection.shipCode);
        }
        return;
      }

      tries++;
      if (tries >= maxTries) clearInterval(timer);
    }, 150);
  }

  function runOnShippingStep() {
    var order = getOrderModel();
    if (!order) return;

    syncSelectionFromOrder(order);
    PacejetUI.setContinueButtonState(!!state.selection.shipCode);

    if (!MODEL_WIRED) {
      MODEL_WIRED = true;
      order.on("change:shipaddress change:lines", onOrderContextChanged);
      order.on("change:shipmethod", onShipmethodChanged);
    }

    if (!INITIAL_FETCH_DONE) {
      INITIAL_FETCH_DONE = true;
      order.fetch().always(function () {
        waitForHostThenRefresh(order);
      });
    } else {
      waitForHostThenRefresh(order);
    }
  }

  return {
    run: runOnShippingStep
  };
});
