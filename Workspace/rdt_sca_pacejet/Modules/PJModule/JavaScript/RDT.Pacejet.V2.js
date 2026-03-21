/// <amd-module name="RDT.Pacejet.V2"/>

define("RDT.Pacejet.V2", [
  "RDT.Pacejet.Checkout.Module.V2",
  "RDT.Pacejet.Summary",
  "jQuery",
  "LiveOrder.Model"
], function (
  PacejetCheckout,
  PacejetSummary,
  jQuery,
  LiveOrderModel
) {
  "use strict";

  var $ = jQuery;
  var LAYOUT_AFTER_APPEND_HANDLER = null;
  var SUMMARY_CHANGE_HANDLER = null;
  var SHIPMETHOD_CHANGE_HANDLER = null;

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
    return (window.location.hash || "").toLowerCase().indexOf("shipping/address") !== -1;
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

  function maybeRun(order) {
    if (!order) return;

    paintSummaryWhenReady(order, "route change");

    if (isShippingStep()) {
      PacejetCheckout.run();
    }
  }

  function mountToApp(container) {
    var order = getOrder();
    var layout = container && container.getComponent
      ? container.getComponent("Layout")
      : null;

    if (!order) return;

    if (!SUMMARY_CHANGE_HANDLER) {
      SUMMARY_CHANGE_HANDLER = function () {
        paintSummaryWhenReady(order, "summary change");
      };
    }

    if (!SHIPMETHOD_CHANGE_HANDLER) {
      SHIPMETHOD_CHANGE_HANDLER = function () {
        paintSummaryWhenReady(order, "shipmethod change");
      };
    }

    if (order.off) {
      order.off("change:summary", SUMMARY_CHANGE_HANDLER);
      order.off("change:shipmethod", SHIPMETHOD_CHANGE_HANDLER);
    }

    if (order.on) {
      order.on("change:summary", SUMMARY_CHANGE_HANDLER);
      order.on("change:shipmethod", SHIPMETHOD_CHANGE_HANDLER);
    }

    if (!LAYOUT_AFTER_APPEND_HANDLER) {
      LAYOUT_AFTER_APPEND_HANDLER = function () {
        maybeRun(order);
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
      setTimeout(function () {
        maybeRun(order);
      }, 0);
    });

    maybeRun(order);
  }

  return {
    mountToApp: mountToApp
  };
});
