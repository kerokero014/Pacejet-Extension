/// <amd-module name="RDT.Pacejet.V2"/>

define("RDT.Pacejet.V2", [
  "RDT.Pacejet.Checkout.Module.V2",
  "RDT.Pacejet.Config",
  "jQuery",
  "LiveOrder.Model"
], function (PacejetCheckout, PacejetConfig, jQuery, LiveOrderModel) {
  "use strict";

  var $ = jQuery;
  var LAYOUT_AFTER_APPEND_HANDLER = null;
  var ROUTE_SYNC_TIMER = null;
  var TEST_APPLY_IN_FLIGHT = false;
  var LAST_APPLIED_ORDER_ID = null;

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

  function buildTestApplyPayload(order) {
    var confirmationOrderId = getConfirmationOrderId(order);
    var shipmethod = safeGet(order, "shipmethod");

    return {
      orderId: confirmationOrderId,
      shipmethod: shipmethod ? String(shipmethod) : "",
      pacejetAmount: Number(
        getCustomFieldValue(order, "custbody_rdt_pacejet_amount") || 0
      ),
      carrier: getCustomFieldValue(order, "custbody_rdt_pj_carrier_name") || "",
      service: getCustomFieldValue(order, "custbody_rdt_pj_service_name") || "",
      transitDays:
        getCustomFieldValue(order, "custbody_rdt_pj_transit_days") || "",
      originKey: getCustomFieldValue(order, "custbody_rdt_pj_origin_key") || "",
      estimatedArrivalDate:
        getCustomFieldValue(order, "custbody_rdt_pj_est_arrival_date") || "",
      quoteJson: getCustomFieldValue(order, "custbody_rdt_pj_quote_json") || ""
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
      return;
    }

    if (
      LAST_APPLIED_ORDER_ID &&
      LAST_APPLIED_ORDER_ID === String(payload.orderId)
    ) {
      return;
    }

    TEST_APPLY_IN_FLIGHT = true;

    callTestApplySuitelet(payload)
      .done(function (response) {
        LAST_APPLIED_ORDER_ID = String(payload.orderId);
        try {
          console.log("Pacejet test apply success", response);
        } catch (_e) {}
      })
      .fail(function (xhr) {
        try {
          console.error("Pacejet test apply failed", xhr);
        } catch (_e) {}
      })
      .always(function () {
        TEST_APPLY_IN_FLIGHT = false;
      });
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
  }

  function scheduleMaybeRun(order) {
    if (ROUTE_SYNC_TIMER) {
      clearTimeout(ROUTE_SYNC_TIMER);
    }

    ROUTE_SYNC_TIMER = setTimeout(function () {
      maybeRun(order);
    }, 0);
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
