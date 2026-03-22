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
  var SELECTION_APPLY_TOKEN = 0;
  var SUMMARY_FETCH_IN_FLIGHT = false;

  var state = PacejetState.get();

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

  function asNumber(value, fallback) {
    var num = Number(value);
    return isFinite(num) ? num : fallback || 0;
  }

  function asString(value) {
    if (value === null || value === undefined) {
      return "";
    }

    return String(value);
  }

  function asCheckboxValue(value) {
    if (
      value === true ||
      value === "T" ||
      value === "true" ||
      value === 1 ||
      value === "1"
    ) {
      return "T";
    }

    return "F";
  }

  function normalizeOrigins(origins) {
    return Array.isArray(origins) ? origins : [];
  }

  function normalizeAccessorialSelection(accessorials) {
    return accessorials && typeof accessorials === "object" && !Array.isArray(accessorials)
      ? accessorials
      : {};
  }

  function normalizeAccessorialArray(accessorials) {
    return Array.isArray(accessorials) ? accessorials : [];
  }

  function normalizeCustomFields(customFields) {
    return Array.isArray(customFields) ? customFields : [];
  }

  function cloneCustomField(field) {
    return {
      id: field && (field.id || field.name || field.fieldid || field.fieldId),
      value: field ? field.value : ""
    };
  }

  function getOrderCustomFields(order) {
    var list =
      (order &&
        order.get &&
        (order.get("customFields") || order.get("customfields"))) ||
      [];

    if (!Array.isArray(list)) {
      return [];
    }

    return list
      .map(cloneCustomField)
      .filter(function (field) {
        return !!field.id;
      });
  }

  function getCustomFieldMap(order) {
    var fields = getOrderCustomFields(order);
    var fieldMap = {};

    fields.forEach(function (field) {
      fieldMap[field.id] = field;
    });

    return fieldMap;
  }

  function setCustomField(fieldMap, fieldId, value) {
    if (!fieldId) return;

    fieldMap[fieldId] = {
      id: fieldId,
      value: value
    };
  }

  function buildEtaDate(transitDays) {
    var days = asNumber(transitDays, NaN);
    if (!isFinite(days) || days <= 0) {
      return "";
    }

    var eta = new Date();
    eta.setDate(eta.getDate() + days);

    return eta.toISOString().split("T")[0];
  }

  function buildOriginSummary(origins) {
    if (!Array.isArray(origins) || !origins.length) {
      return "";
    }

    return origins
      .map(function (origin) {
        var label =
          origin.city ||
          origin.zip ||
          origin.originKey ||
          origin.LocationCode ||
          "Origin";

        return label + ": $" + asNumber(origin.cost, 0).toFixed(2);
      })
      .join("\n");
  }

  function truncateQuoteJson(value) {
    var json = asString(value);
    return json.length > 3800 ? json.slice(0, 3800) : json;
  }

  function buildPacejetCustomFields(order, payload) {
    var fieldMap = getCustomFieldMap(order);
    var origins = normalizeOrigins(payload && payload.origins);
    var transitDays = payload.transitDays;
    var etaDate = buildEtaDate(transitDays);
    var originCount = origins.length;
    var originKey = (origins[0] && origins[0].originKey) || "";
    var originSummary = buildOriginSummary(origins);
    var accessorials = normalizeAccessorialSelection(
      payload && (payload.accessorialSelection || payload.accessorials)
    );
    var quoteJson = truncateQuoteJson(JSON.stringify(payload));

    setCustomField(
      fieldMap,
      "custbody_rdt_pacejet_amount",
      asNumber(payload.cost, 0)
    );
    setCustomField(
      fieldMap,
      "custbody_rdt_pj_carrier_name",
      asString(payload.carrier || "")
    );
    setCustomField(
      fieldMap,
      "custbody_rdt_pj_service_name",
      asString(payload.service || "")
    );
    setCustomField(
      fieldMap,
      "custbody_rdt_pj_accessorial_total",
      asNumber(payload.accessorialDelta, 0)
    );
    setCustomField(fieldMap, "custbody_rdt_pj_quote_json", quoteJson);

    if (transitDays !== null && transitDays !== undefined && transitDays !== "") {
      setCustomField(
        fieldMap,
        "custbody_rdt_pj_transit_days",
        asNumber(transitDays, 0)
      );
    }

    if (etaDate) {
      setCustomField(fieldMap, "custbody_rdt_pj_est_arrival_date", etaDate);
    }

    if (originCount) {
      setCustomField(fieldMap, "custbody_rdt_pj_origin_count", originCount);
    }

    if (originKey) {
      setCustomField(fieldMap, "custbody_rdt_pj_origin_key", originKey);
    }

    if (originSummary) {
      setCustomField(fieldMap, "custbody_rdt_pj_origin_summary", originSummary);
    }

    Object.keys(ACCESSORIAL_FIELD_MAP).forEach(function (key) {
      setCustomField(
        fieldMap,
        ACCESSORIAL_FIELD_MAP[key],
        asCheckboxValue(accessorials[key])
      );
    });

    return Object.keys(fieldMap).map(function (fieldId) {
      return fieldMap[fieldId];
    });
  }

  function fetchOrderSummary(order) {
    if (!order || !order.fetch) {
      return jQuery.Deferred().resolve(order).promise();
    }

    if (SUMMARY_FETCH_IN_FLIGHT) {
      return jQuery.Deferred().resolve(order).promise();
    }

    SUMMARY_FETCH_IN_FLIGHT = true;

    logSummarySnapshot(order, "before-followup-fetch");

    return order
      .fetch({
        reset: true,
        data: {
          t: Date.now(),
          fullsummary: true
        }
      })
      .then(function (resp) {
        logSummarySnapshot(order, "after-followup-fetch", {
          responseKeys: resp ? Object.keys(resp) : []
        });
        return resp;
      })
      .always(function () {
        SUMMARY_FETCH_IN_FLIGHT = false;
      });
  }

  function applyServiceResponseToOrder(order, response) {
    if (!order || !order.set || !response) return;

    var updates = {};
    var customFields = response.customFields || response.customfields;

    if (response.shipmethod) {
      updates.shipmethod = response.shipmethod;
    }

    if (response.summary) {
      updates.summary = response.summary;
    }

    if (Array.isArray(customFields)) {
      updates.customFields = customFields;
      updates.customfields = customFields;
    }

    order.set(updates);
  }

  function applyPacejetSelectionToCart(order, payload) {
    if (!order) {
      return jQuery
        .Deferred()
        .reject(new Error("LiveOrder model is unavailable"))
        .promise();
    }

    var normalizedOrigins = normalizeOrigins(payload && payload.origins);
    var normalizedAccessorialSelection = normalizeAccessorialSelection(
      payload && payload.accessorialSelection
    );
    var customFields = normalizeCustomFields(
      buildPacejetCustomFields(order, {
        shipCode: payload && payload.shipCode,
        cost: payload && payload.cost,
        carrier: payload && payload.carrier,
        service: payload && payload.service,
        transitDays: payload && payload.transitDays,
        origins: normalizedOrigins,
        accessorialSelection: normalizedAccessorialSelection
      })
    );

    logSummarySnapshot(order, "before-liveorder-save", {
      servicePayload: {
        shipmethod: getShipmethodId(payload && payload.shipCode),
        accessorials: [],
        customFields: customFields
      }
    });

    return PacejetService
      .applyRateToCart({
        shipmethod: getShipmethodId(payload && payload.shipCode),
        accessorials: normalizeAccessorialArray(payload && payload.accessorials),
        accessorialSelection: normalizedAccessorialSelection,
        customFields: customFields
      })
      .then(function (resp) {
        applyServiceResponseToOrder(order, resp || {});

        logSummarySnapshot(order, "after-liveorder-save", {
          responseKeys: resp ? Object.keys(resp) : [],
          selectedShipCode: getShipmethodId(payload && payload.shipCode)
        });

        return fetchOrderSummary(order).then(function () {
          return order;
        });
      });
  }

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
    state.selection.origins = normalizeOrigins(payload.origins);

    var applyToken = ++SELECTION_APPLY_TOKEN;

    state.flags.suppressRefresh = true;
    state.flags.ratesVisible = true;

    logSummarySnapshot(order, "before-apply", {
      selectedShipCode: payload.shipCode,
      selectedCost: payload.cost
    });

    if (window.ShippingAppliedFlag !== undefined) {
      window.ShippingAppliedFlag = false;
    }

    applyPacejetSelectionToCart(order, {
      shipCode: payload.shipCode,
      cost: payload.cost || 0,
      carrier: payload.carrier || "",
      service: payload.service || "",
      transitDays: payload.transitDays,
      origins: normalizeOrigins(payload.origins),
      accessorials: normalizeAccessorialArray(payload.accessorials),
      accessorialSelection: normalizeAccessorialSelection(
        state.selection.accessorials
      )
    })
      .then(function () {
        if (applyToken !== SELECTION_APPLY_TOKEN) return;

        console.log("[Pacejet] LiveOrder applied successfully");

        syncSelectionFromOrder(order);

        PacejetSummary.enforcePacejetSummary(order);
        PacejetSummary.renderSummaryUI(order);
        paintSummaryWhenReady(order, "after-liveorder-save");
        order.trigger("change:summary", order, order.get("summary"));

        waitForHostThenRefresh(order);
      })
      .fail(function (err) {
        if (applyToken !== SELECTION_APPLY_TOKEN) return;
        console.error(
          "[Pacejet] LiveOrder save failed",
          err && err.responseText ? err.responseText : err
        );
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
      order
        .fetch({
          reset: true,
          data: {
            t: Date.now(),
            fullsummary: true
          }
        })
        .always(function () {
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
