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

  function maybeRun(order) {
    if (!order) return;

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
