/// <amd-module name="RDT.Pacejet.V2"/>

define("RDT.Pacejet.V2", [
  "RDT.Pacejet.Checkout.Module.V2",
  "RDT.Pacejet.Config",
  "RDT.Pacejet.State",
  "jQuery",
  "LiveOrder.Model"
], function (
  PacejetCheckout,
  PacejetConfig,
  PacejetState,
  jQuery,
  LiveOrderModel
) {
  "use strict";

  var $ = jQuery;
  var LAYOUT_AFTER_APPEND_HANDLER = null;
  var ROUTE_SYNC_TIMER = null;
  var ORDER_EVENT_HANDLER = null;
  var CONFIRMATION_POLL_TIMER = null;
  var CONFIRMATION_POLL_ATTEMPTS = 0;
  var TEST_APPLY_IN_FLIGHT = false;
  var LAST_APPLIED_ORDER_ID = null;

  console.log("[Pacejet] Pacejet V2 Module Loaded");

  function getOrder() {
    try {
      return LiveOrderModel && LiveOrderModel.getInstance
        ? LiveOrderModel.getInstance()
        : null;
    } catch (_e) {
      return null;
    }
  }

  function isShippingStep() {
    return (
      (window.location.hash || "").toLowerCase().indexOf("shipping/address") !==
      -1
    );
  }

  function isConfirmationStep() {
    return (
      (window.location.hash || "").toLowerCase().indexOf("confirmation") !== -1
    );
  }

  function isPacejetSummaryRoute() {
    var hash = (window.location.hash || "").toLowerCase();

    return (
      hash.indexOf("shipping/address") !== -1 ||
      hash.indexOf("billing") !== -1 ||
      hash.indexOf("review") !== -1 ||
      hash.indexOf("confirmation") !== -1
    );
  }

  function safeGet(obj, key) {
    try {
      return obj && typeof obj.get === "function"
        ? obj.get(key)
        : obj && obj[key];
    } catch (_e) {
      return null;
    }
  }

  function getConfirmationOrderId(order) {
    var confirmation = safeGet(order, "confirmation") || {};
    return (
      confirmation.internalid ||
      confirmation.order_id ||
      confirmation.recordid ||
      confirmation.id ||
      null
    );
  }

  function getShipmethodId(shipmethod) {
    if (shipmethod === null || shipmethod === undefined || shipmethod === "") {
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

  function getCustomFieldValue(order, fieldId) {
    var customFields = safeGet(order, "customfields") || [];
    var i;
    var field;

    for (i = 0; i < customFields.length; i++) {
      field = customFields[i];
      if (field && (field.id === fieldId || field.name === fieldId)) {
        return field.value;
      }
    }

    return null;
  }

  function safeParseJson(value) {
    if (!value || typeof value !== "string") {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch (_e) {
      return null;
    }
  }

  function buildTestApplyPayload(order) {
    var confirmationOrderId = getConfirmationOrderId(order);
    var shipmethod = getShipmethodId(safeGet(order, "shipmethod"));
    var selectedRate =
      PacejetState && PacejetState.getSelectedRate
        ? PacejetState.getSelectedRate()
        : null;
    var confirmation = safeGet(order, "confirmation") || {};
    var confirmationSummary =
      confirmation && typeof confirmation.summary === "object"
        ? confirmation.summary
        : {};
    var pacejetAmount = getCustomFieldValue(
      order,
      "custbody_rdt_pacejet_amount"
    );
    var carrier = getCustomFieldValue(order, "custbody_rdt_pj_carrier_name");
    var service = getCustomFieldValue(order, "custbody_rdt_pj_service_name");
    var transitDays = getCustomFieldValue(
      order,
      "custbody_rdt_pj_transit_days"
    );
    var originKey = getCustomFieldValue(order, "custbody_rdt_pj_origin_key");
    var estimatedArrivalDate = getCustomFieldValue(
      order,
      "custbody_rdt_pj_est_arrival_date"
    );
    var quoteJson = getCustomFieldValue(order, "custbody_rdt_pj_quote_json");
    var parsedQuote = safeParseJson(quoteJson);

    var callPriorTruck = getCustomFieldValue(order, "custbody_callpriortruck");
    var jobsite = getCustomFieldValue(order, "custbody_jobsite");
    var liftgateTruck = getCustomFieldValue(order, "custbody_liftgatetruck");
    var residential = getCustomFieldValue(order, "custbody_residential");
    var appointmentTruck = getCustomFieldValue(
      order,
      "custbody_appointmenttruck"
    );
    var selfStorage = getCustomFieldValue(order, "custbody_selfstorage");
    var schoolDelivery = getCustomFieldValue(order, "custbody_school_delivery");
    var insideDelivery = getCustomFieldValue(order, "custbody_inside_delivery");
    var accessHazmatParcel = getCustomFieldValue(
      order,
      "custbody_access_hazmat_parcel"
    );
    var dangerousGoods = getCustomFieldValue(order, "custbody_dangerous_goods");
    var noneAdditionalFeesMayApply = getCustomFieldValue(
      order,
      "custbody_none_additional_fees_may_app"
    );

    if (!shipmethod && selectedRate && selectedRate.shipmethod) {
      shipmethod = getShipmethodId(selectedRate.shipmethod);
    }

    if (!shipmethod && parsedQuote && parsedQuote.shipmethod) {
      shipmethod = getShipmethodId(parsedQuote.shipmethod);
    }

    if (
      (pacejetAmount === null ||
        pacejetAmount === undefined ||
        pacejetAmount === "") &&
      selectedRate &&
      selectedRate.amount !== null &&
      selectedRate.amount !== undefined
    ) {
      pacejetAmount = selectedRate.amount;
    }

    if (!carrier && selectedRate && selectedRate.carrier) {
      carrier = selectedRate.carrier;
    }

    if (!service && selectedRate && selectedRate.service) {
      service = selectedRate.service;
    }

    if (
      (transitDays === null ||
        transitDays === undefined ||
        transitDays === "") &&
      selectedRate &&
      selectedRate.transitDays !== null &&
      selectedRate.transitDays !== undefined
    ) {
      transitDays = selectedRate.transitDays;
    }

    if (!originKey && selectedRate && selectedRate.originKey) {
      originKey = selectedRate.originKey;
    }

    if (
      !estimatedArrivalDate &&
      selectedRate &&
      selectedRate.estimatedArrivalDate
    ) {
      estimatedArrivalDate = selectedRate.estimatedArrivalDate;
    }

    if (!quoteJson && selectedRate && selectedRate.quoteJson) {
      quoteJson = selectedRate.quoteJson;
    }

    if (
      (pacejetAmount === null ||
        pacejetAmount === undefined ||
        pacejetAmount === "") &&
      confirmationSummary &&
      confirmationSummary.shippingcost !== null &&
      confirmationSummary.shippingcost !== undefined
    ) {
      pacejetAmount = confirmationSummary.shippingcost;
    }

    return {
      orderId: confirmationOrderId,
      shipmethod: shipmethod || "",
      pacejetAmount: Number(pacejetAmount || 0),
      carrier: carrier || "",
      service: service || "",
      transitDays:
        transitDays === null || transitDays === undefined ? "" : transitDays,
      originKey: originKey || "",
      estimatedArrivalDate: estimatedArrivalDate || "",
      quoteJson: quoteJson || "",

      callPriorTruck: callPriorTruck,
      jobsite: jobsite,
      liftgateTruck: liftgateTruck,
      residential: residential,
      appointmentTruck: appointmentTruck,
      selfStorage: selfStorage,
      schoolDelivery: schoolDelivery,
      insideDelivery: insideDelivery,
      accessHazmatParcel: accessHazmatParcel,
      dangerousGoods: dangerousGoods,
      noneAdditionalFeesMayApply: noneAdditionalFeesMayApply
    };
  }

  function canSendTestApply(payload) {
    return !!(
      payload &&
      payload.orderId &&
      payload.shipmethod &&
      Number(payload.pacejetAmount) > 0
    );
  }

  function callTestApplySuitelet(payload) {
    if (
      !PacejetConfig ||
      !PacejetConfig.enableTestApplyShipping ||
      !PacejetConfig.testApplyShippingUrl
    ) {
      return $.Deferred().resolve({ skipped: true }).promise();
    }

    return $.ajax({
      url: PacejetConfig.testApplyShippingUrl,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify(payload)
    });
  }

  function maybeRunTestApply(order) {
    var payload;

    if (!isConfirmationStep() || !order || TEST_APPLY_IN_FLIGHT) {
      return;
    }

    payload = buildTestApplyPayload(order);

    if (!canSendTestApply(payload)) {
      try {
        console.log("[Pacejet] test apply skipped", payload);
      } catch (_skipLogError) {}
      return;
    }

    if (
      LAST_APPLIED_ORDER_ID &&
      LAST_APPLIED_ORDER_ID === String(payload.orderId)
    ) {
      return;
    }

    TEST_APPLY_IN_FLIGHT = true;
    try {
      console.log("[Pacejet] test apply request", payload);
    } catch (_requestLogError) {}

    callTestApplySuitelet(payload)
      .done(function (response) {
        LAST_APPLIED_ORDER_ID = String(payload.orderId);
        if (
          PacejetState &&
          PacejetState.setPersistenceResult &&
          response &&
          response.ok &&
          response.totals
        ) {
          PacejetState.setPersistenceResult({
            saved: true,
            shipmethod: payload.shipmethod,
            pacejetAmount: payload.pacejetAmount,
            carrier: payload.carrier,
            service: payload.service,
            transitDays: payload.transitDays,
            totals: {
              subtotal: Number(response.totals.subtotal || 0),
              shipping: Number(response.totals.shipping || 0),
              tax: Number(response.totals.tax || 0),
              total: Number(response.totals.total || 0)
            }
          });
        }

        if (PacejetCheckout && PacejetCheckout.syncCurrentRoute) {
          PacejetCheckout.syncCurrentRoute();
        }

        try {
          console.log("[Pacejet] test apply success", response);
        } catch (_e) {}
      })
      .fail(function (xhr) {
        try {
          console.error("[Pacejet] test apply failed", {
            status: xhr && xhr.status,
            statusText: xhr && xhr.statusText,
            responseText: xhr && xhr.responseText
          });
        } catch (_e) {}
      })
      .always(function () {
        TEST_APPLY_IN_FLIGHT = false;
      });
  }

  function stopConfirmationPolling() {
    if (CONFIRMATION_POLL_TIMER) {
      clearInterval(CONFIRMATION_POLL_TIMER);
      CONFIRMATION_POLL_TIMER = null;
    }
    CONFIRMATION_POLL_ATTEMPTS = 0;
  }

  function ensureConfirmationPolling() {
    if (!isConfirmationStep()) {
      stopConfirmationPolling();
      return;
    }

    if (CONFIRMATION_POLL_TIMER) {
      return;
    }

    CONFIRMATION_POLL_ATTEMPTS = 0;
    CONFIRMATION_POLL_TIMER = setInterval(function () {
      var order = getOrder();
      var orderId = getConfirmationOrderId(order);

      CONFIRMATION_POLL_ATTEMPTS += 1;
      maybeRun(order);

      if (
        (orderId && LAST_APPLIED_ORDER_ID === String(orderId)) ||
        CONFIRMATION_POLL_ATTEMPTS >= 20
      ) {
        stopConfirmationPolling();
      }
    }, 700);
  }

  function maybeRun(order) {
    if (!order) return;

    if (isShippingStep()) {
      PacejetCheckout.run();
      return;
    }

    if (isPacejetSummaryRoute() && PacejetCheckout.syncCurrentRoute) {
      PacejetCheckout.syncCurrentRoute();
    }

    maybeRunTestApply(order);

    if (isConfirmationStep()) {
      ensureConfirmationPolling();
    } else {
      stopConfirmationPolling();
    }
  }

  function scheduleMaybeRun(order) {
    if (ROUTE_SYNC_TIMER) {
      clearTimeout(ROUTE_SYNC_TIMER);
    }

    ROUTE_SYNC_TIMER = setTimeout(function () {
      maybeRun(order);
    }, 0);
  }

  function bindOrderListeners(order) {
    if (!order || !order.on) {
      return;
    }

    if (!ORDER_EVENT_HANDLER) {
      ORDER_EVENT_HANDLER = function () {
        scheduleMaybeRun(order);
      };
    }

    if (order.off) {
      order.off("change:confirmation", ORDER_EVENT_HANDLER);
      order.off("sync", ORDER_EVENT_HANDLER);
      order.off("reset", ORDER_EVENT_HANDLER);
    }

    order.on("change:confirmation", ORDER_EVENT_HANDLER);
    order.on("sync", ORDER_EVENT_HANDLER);
    order.on("reset", ORDER_EVENT_HANDLER);
  }

  function mountToApp(container) {
    var order = getOrder();
    var layout =
      container && container.getComponent
        ? container.getComponent("Layout")
        : null;

    if (PacejetCheckout && PacejetCheckout.mountToApp) {
      PacejetCheckout.mountToApp(container);
    }

    if (!order) return;

    bindOrderListeners(order);

    if (!LAYOUT_AFTER_APPEND_HANDLER) {
      LAYOUT_AFTER_APPEND_HANDLER = function () {
        scheduleMaybeRun(order);
      };
    }

    if (layout && layout.off) {
      layout.off("afterAppendView", LAYOUT_AFTER_APPEND_HANDLER);
    }
    if (layout && layout.on) {
      layout.on("afterAppendView", LAYOUT_AFTER_APPEND_HANDLER);
    }

    $(window).off("hashchange.rdtPacejetV2");
    $(window).on("hashchange.rdtPacejetV2", function () {
      scheduleMaybeRun(order);
    });

    scheduleMaybeRun(order);
  }

  return {
    mountToApp: mountToApp
  };
});
