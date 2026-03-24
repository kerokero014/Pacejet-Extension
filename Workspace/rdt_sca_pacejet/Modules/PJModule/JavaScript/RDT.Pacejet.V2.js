/// <amd-module name="RDT.Pacejet.V2"/>

define("RDT.Pacejet.V2", [
  "RDT.Pacejet.Checkout.Module.V2",
  "jQuery",
  "LiveOrder.Model"
], function (
  PacejetCheckout,
  jQuery,
  LiveOrderModel
) {
  "use strict";

  var $ = jQuery;
  var LAYOUT_AFTER_APPEND_HANDLER = null;
  var ROUTE_SYNC_TIMER = null;

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

  function isPacejetSummaryRoute() {
    var hash = (window.location.hash || "").toLowerCase();

    return (
      hash.indexOf("shipping/address") !== -1 ||
      hash.indexOf("billing") !== -1 ||
      hash.indexOf("review") !== -1 ||
      hash.indexOf("confirmation") !== -1
    );
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
    var layout = container && container.getComponent
      ? container.getComponent("Layout")
      : null;

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
