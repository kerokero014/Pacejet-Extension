/// <amd-module name="RDT.Pacejet.Checkout.Module.V2"/>

define("RDT.Pacejet.Checkout.Module.V2", [
  "LiveOrder.Model",
  "jQuery",
  "underscore",
  "RDT.Pacejet.Config",
  "RDT.Pacejet.State",
  "RDT.Pacejet.Service",
  "RDT.Pacejet.Summary",
  "RDT.Pacejet.UI",
  "RDT.Pacejet.AccessorialMatrix"
], function (
  LiveOrderModel,
  jQuery,
  _,
  PacejetConfig,
  PacejetState,
  PacejetService,
  PacejetSummary,
  PacejetUI,
  AccessorialMatrix
) {
  "use strict";

  var $ = jQuery;

  var MODEL_WIRED = false;
  var INITIAL_FETCH_DONE = false;
  var REFRESH_TIMER = null;
  var SELECTION_APPLY_TOKEN = 0;
  var SUMMARY_FETCH_IN_FLIGHT = false;
  var NONE_ACCESSORIAL_ID = "none_additional_fees_may_app";
  var NONE_ACCESSORIAL_FIELD_ID = "custbody_none_additional_fees_may_app";

  var PACEJET_BODY_FIELDS = {
    amount: "custbody_rdt_pacejet_amount",
    carrier: "custbody_rdt_pj_carrier_name",
    service: "custbody_rdt_pj_service_name",
    originKey: "custbody_rdt_pj_origin_key",
    transitDays: "custbody_rdt_pj_transit_days",
    estimatedArrivalDate: "custbody_rdt_pj_est_arrival_date",
    quoteJson: "custbody_rdt_pj_quote_json"
  };

  var state = PacejetState.get();

  function asNumber(value, fallback) {
    var num = Number(value);
    return isFinite(num) ? num : fallback || 0;
  }

  function normalizeOrigins(origins) {
    return Array.isArray(origins) ? origins : [];
  }

  function ensureArray(value) {
    return _.isArray(value) ? value : value == null ? [] : [value];
  }

  function getCustomFields(model) {
    return ensureArray(model.get("customfields") || model.get("customFields"));
  }

  function setCustomFields(model, fields) {
    model.set("customfields", fields);
    model.set("customFields", fields);
  }

  function upsertBodyField(model, id, value) {
    if (!model || !id) return;

    var fields = getCustomFields(model);
    var found = false;

    _.each(fields, function (field) {
      if (field && field.id === id) {
        field.value = value;
        found = true;
      }
    });

    if (!found) {
      fields.push({
        id: id,
        value: value
      });
    }

    setCustomFields(model, fields);
  }

  function stageSelectedPacejetFieldsOnOrder(order) {
    order = order || getOrderModel();
    if (!order || !order.get || !order.set) return;

    var selectedRate =
      PacejetState && PacejetState.getSelectedRate
        ? PacejetState.getSelectedRate()
        : null;

    if (!selectedRate) return;

    var amount =
      selectedRate.amount === null || selectedRate.amount === undefined
        ? ""
        : String(selectedRate.amount);

    var carrier = selectedRate.carrier || "";
    var service = selectedRate.service || "";
    var originKey = selectedRate.originKey || "";
    var transitDays =
      selectedRate.transitDays === null ||
      selectedRate.transitDays === undefined
        ? ""
        : String(selectedRate.transitDays);
    var estimatedArrivalDate = selectedRate.estimatedArrivalDate || "";
    var quoteJson = selectedRate.quoteJson || "";

    upsertBodyField(order, PACEJET_BODY_FIELDS.amount, amount);
    upsertBodyField(order, PACEJET_BODY_FIELDS.carrier, carrier);
    upsertBodyField(order, PACEJET_BODY_FIELDS.service, service);
    upsertBodyField(order, PACEJET_BODY_FIELDS.originKey, originKey);
    upsertBodyField(order, PACEJET_BODY_FIELDS.transitDays, transitDays);
    upsertBodyField(
      order,
      PACEJET_BODY_FIELDS.estimatedArrivalDate,
      estimatedArrivalDate
    );
    upsertBodyField(order, PACEJET_BODY_FIELDS.quoteJson, quoteJson);

    if (order.trigger) {
      order.trigger("change:customfields", order);
    }
  }

  function preparePacejetFieldsForPlaceOrder(order) {
    order = order || getOrderModel();
    if (!order || !order.get || !order.set) return;

    var selectedRate =
      PacejetState && PacejetState.getSelectedRate
        ? PacejetState.getSelectedRate()
        : null;

    if (!selectedRate) {
      console.log("[Pacejet] beforePlaceOrder skipped: no selectedRate");
      return;
    }

    var options = order.get("options") || {};

    var amount =
      selectedRate.amount === null || selectedRate.amount === undefined
        ? ""
        : String(selectedRate.amount);

    var carrier = selectedRate.carrier || "";
    var service = selectedRate.service || "";
    var originKey = selectedRate.originKey || "";
    var transitDays =
      selectedRate.transitDays === null ||
      selectedRate.transitDays === undefined
        ? ""
        : String(selectedRate.transitDays);
    var estimatedArrivalDate = selectedRate.estimatedArrivalDate || "";
    var quoteJson = selectedRate.quoteJson || "";

    upsertBodyField(order, PACEJET_BODY_FIELDS.amount, amount);
    upsertBodyField(order, PACEJET_BODY_FIELDS.carrier, carrier);
    upsertBodyField(order, PACEJET_BODY_FIELDS.service, service);
    upsertBodyField(order, PACEJET_BODY_FIELDS.originKey, originKey);
    upsertBodyField(order, PACEJET_BODY_FIELDS.transitDays, transitDays);
    upsertBodyField(
      order,
      PACEJET_BODY_FIELDS.estimatedArrivalDate,
      estimatedArrivalDate
    );
    upsertBodyField(order, PACEJET_BODY_FIELDS.quoteJson, quoteJson);

    options[PACEJET_BODY_FIELDS.amount] = amount;
    options[PACEJET_BODY_FIELDS.carrier] = carrier;
    options[PACEJET_BODY_FIELDS.service] = service;
    options[PACEJET_BODY_FIELDS.originKey] = originKey;
    options[PACEJET_BODY_FIELDS.transitDays] = transitDays;
    options[PACEJET_BODY_FIELDS.estimatedArrivalDate] = estimatedArrivalDate;
    options[PACEJET_BODY_FIELDS.quoteJson] = quoteJson;

    order.set("options", options);

    if (order.trigger) {
      order.trigger("change:customfields", order);
      order.trigger("change:options", order);
    }

    console.log("[Pacejet] beforePlaceOrder prepared fields", {
      amount: amount,
      carrier: carrier,
      service: service,
      originKey: originKey,
      transitDays: transitDays,
      estimatedArrivalDate: estimatedArrivalDate
    });
  }

  function deriveOriginKey(payload) {
    return normalizeOrigins(payload && payload.origins)
      .map(function (origin) {
        return origin && origin.originKey ? String(origin.originKey) : "";
      })
      .filter(function (value) {
        return !!value;
      })
      .join("|");
  }

  function deriveEstimatedArrivalDate(payload) {
    if (
      payload &&
      payload.estimatedArrivalDate !== null &&
      payload.estimatedArrivalDate !== undefined &&
      payload.estimatedArrivalDate !== ""
    ) {
      return String(payload.estimatedArrivalDate);
    }

    if (
      payload &&
      payload.estDelivery !== null &&
      payload.estDelivery !== undefined &&
      payload.estDelivery !== ""
    ) {
      return String(payload.estDelivery);
    }

    return "";
  }

  function normalizeAccessorialSelection(accessorials) {
    return accessorials &&
      typeof accessorials === "object" &&
      !Array.isArray(accessorials)
      ? accessorials
      : {};
  }

  function normalizeAccessorialArray(accessorials) {
    return Array.isArray(accessorials) ? accessorials : [];
  }

  function buildAccessorialCustomFields(accessorialSelection) {
    var selection = normalizeAccessorialSelection(accessorialSelection);

    return [
      {
        id: NONE_ACCESSORIAL_FIELD_ID,
        value: selection[NONE_ACCESSORIAL_ID] ? "T" : "F"
      }
    ];
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

  function applyPacejetSelectionToCart(order, payload) {
    if (!order) {
      return jQuery
        .Deferred()
        .reject(new Error("LiveOrder model is unavailable"))
        .promise();
    }

    var shipmethodId = getShipmethodId(payload && payload.shipCode);

    if (!shipmethodId) {
      return jQuery
        .Deferred()
        .reject(new Error("shipmethod is required"))
        .promise();
    }

    logSummarySnapshot(order, "before-native-save", {
      selectedShipCode: shipmethodId,
      selectedCost: payload && payload.cost
    });

    order.set("shipmethod", shipmethodId);
    return order.save().then(function () {
      logSummarySnapshot(order, "after-native-save", {
        selectedShipCode: shipmethodId
      });

      return fetchOrderSummary(order).then(function () {
        syncSelectionFromOrder(order);
        order.trigger("change:summary", order, order.get("summary"));

        if (PacejetSummary && PacejetSummary.renderSummaryUI) {
          PacejetSummary.renderSummaryUI(order);
        }

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
      pacejetSelectedRate: PacejetState.getSelectedRate(),
      timestamp: new Date().toISOString()
    };

    if (extra) snapshot.extra = extra;

    console.log("[Pacejet][TaxDebug] summary snapshot", snapshot);
  }

  function clearSelectedRate() {
    PacejetState.clearSelectedRate();
    PacejetState.clearPersistenceResult();
    state.selection.shipCode = null;
    state.selection.cost = null;
    state.selection.carrier = null;
    state.selection.service = null;
    state.selection.transitDays = null;
    state.selection.originKey = null;
    state.selection.estimatedArrivalDate = null;
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
    var selectedRate;
    if (!order || !order.get) return;

    var shipmethodId = getShipmethodId(order.get("shipmethod"));
    if (!shipmethodId) {
      clearSelectedRate();
      return;
    }

    state.selection.shipCode = shipmethodId;

    selectedRate = PacejetState.getSelectedRate();

    if (
      !selectedRate ||
      getShipmethodId(selectedRate.shipmethod) !== shipmethodId
    ) {
      clearSelectedRate();
      return;
    }

    state.selection.cost = asNumber(selectedRate.amount, 0);
    state.selection.carrier = selectedRate.carrier || null;
    state.selection.service = selectedRate.service || null;
    state.selection.transitDays = selectedRate.transitDays || null;
    state.selection.originKey = selectedRate.originKey || null;
    state.selection.estimatedArrivalDate =
      selectedRate.estimatedArrivalDate || null;
    state.selection.origins = normalizeOrigins(selectedRate.origins);
  }

  function syncRouteUi(order) {
    if (!order) return;

    syncSelectionFromOrder(order);
    PacejetUI.setContinueButtonState(!!state.selection.shipCode);

    if (PacejetSummary && PacejetSummary.renderSummaryUI) {
      PacejetSummary.renderSummaryUI(order);
    }

    if (PacejetUI && PacejetUI.renderReviewSelection) {
      PacejetUI.renderReviewSelection(order, state);
    }
  }

  function ensureModelWired(order) {
    if (!order || MODEL_WIRED) {
      return;
    }

    MODEL_WIRED = true;
    order.on("change:shipaddress change:lines", onOrderContextChanged);
    order.on("change:shipmethod", onShipmethodChanged);
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

    var originKey = deriveOriginKey(payload);
    var estimatedArrivalDate = deriveEstimatedArrivalDate(payload);
    var quoteJson = JSON.stringify({
      shipmethod: payload.shipCode,
      amount: asNumber(payload.cost, 0),
      carrier: payload.carrier || "",
      service: payload.service || "",
      transitDays: payload.transitDays,
      originKey: originKey,
      estimatedArrivalDate: estimatedArrivalDate,
      origins: normalizeOrigins(payload.origins)
    });

    PacejetState.setSelectedRate({
      shipmethod: payload.shipCode,
      amount: asNumber(payload.cost, 0),
      carrier: payload.carrier || "",
      service: payload.service || "",
      transitDays:
        payload.transitDays === null || payload.transitDays === undefined
          ? ""
          : payload.transitDays,
      originKey: originKey,
      estimatedArrivalDate: estimatedArrivalDate,
      origins: normalizeOrigins(payload.origins),
      quoteJson: quoteJson
    });

    stageSelectedPacejetFieldsOnOrder(order);

    state.selection.shipCode = payload.shipCode;
    state.selection.cost = payload.cost;
    state.selection.carrier = payload.carrier;
    state.selection.service = payload.service;
    state.selection.transitDays = payload.transitDays;
    state.selection.originKey = originKey;
    state.selection.estimatedArrivalDate = estimatedArrivalDate;
    state.selection.origins = normalizeOrigins(payload.origins);
    PacejetState.clearPersistenceResult();

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
      originKey: originKey,
      estimatedArrivalDate: estimatedArrivalDate,
      origins: normalizeOrigins(payload.origins),
      customfields: buildAccessorialCustomFields(state.selection.accessorials),
      accessorials: normalizeAccessorialArray(payload.accessorials),
      accessorialSelection: normalizeAccessorialSelection(
        state.selection.accessorials
      ),
      quoteJson: quoteJson
    })
      .then(function () {
        if (applyToken !== SELECTION_APPLY_TOKEN) return;

        console.log("[Pacejet] Native shipmethod save applied successfully");

        waitForHostThenRefresh(order);
      })
      .fail(function (err) {
        if (applyToken !== SELECTION_APPLY_TOKEN) return;
        clearSelectedRate();
        console.error(
          "[Pacejet] LiveOrder error",
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

    syncRouteUi(order);

    if (state.flags.suppressRefresh) return;

    scheduleRefresh(order, "soft");
  }

  function onShipmethodChanged() {
    var order = getOrderModel();
    if (!order) return;

    syncRouteUi(order);

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

    ensureModelWired(order);
    syncRouteUi(order);

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

  function wireBeforePlaceOrder(application) {
    var checkout =
      application && application.getComponent
        ? application.getComponent("Checkout")
        : null;

    if (!checkout || !checkout.on) return;

    checkout.on("beforePlaceOrder", function () {
      var order = getOrderModel();
      if (!order) return;

      preparePacejetFieldsForPlaceOrder(order);

      console.log("[Pacejet] beforePlaceOrder persisted Pacejet body fields");
    });
  }

  return {
    mountToApp: function (application) {
      wireBeforePlaceOrder(application);
    },

    run: runOnShippingStep,

    syncCurrentRoute: function () {
      var order = getOrderModel();
      if (!order) return;

      ensureModelWired(order);
      syncRouteUi(order);
    }
  };
});
