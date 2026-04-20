/// <amd-module name="RDT.Pacejet.Surcharge.Hooks"/>

define("RDT.Pacejet.Surcharge.Hooks", [
  "LiveOrder.Model",
  "RDT.Pacejet.Summary",
  "RDT.Pacejet.Surcharge.Summary.View"
], function (LiveOrderModel, PacejetSummary, SurchargeSummaryView) {
  "use strict";

  var CONTEXT_VIEW_IDS = ["OrderWizard.Module.CartSummary", "Cart.Summary.View"];
  var CHILD_VIEW_TARGETS = [
    {
      viewId: "OrderWizard.Module.CartSummary",
      placeholder: "Cart.Summary"
    },
    {
      viewId: "Cart.Summary.View",
      placeholder: "Cart.Summary"
    }
  ];

  function getLayoutComponent(container) {
    try {
      return container && typeof container.getComponent === "function"
        ? container.getComponent("Layout")
        : null;
    } catch (_e) {
      return null;
    }
  }

  function getOrder() {
    try {
      return LiveOrderModel && typeof LiveOrderModel.getInstance === "function"
        ? LiveOrderModel.getInstance()
        : null;
    } catch (_e) {
      return null;
    }
  }

  function getSummaryContext() {
    var order = getOrder();

    if (!order || !PacejetSummary || !PacejetSummary.getSummary) {
      return null;
    }

    return PacejetSummary.getSummary(order);
  }

  function addContextDefinitions(layout) {
    if (!layout || typeof layout.addToViewContextDefinition !== "function") {
      return;
    }

    CONTEXT_VIEW_IDS.forEach(function (viewId) {
      try {
        layout.addToViewContextDefinition(
          viewId,
          "rdtSurchargeSummary",
          "object",
          getSummaryContext
        );
      } catch (_e) {}
    });
  }

  function addChildViews(layout, container) {
    if (!layout || typeof layout.addChildView !== "function") {
      return;
    }

    CHILD_VIEW_TARGETS.forEach(function (target) {
      try {
        layout.addChildView(target.viewId, target.placeholder, function () {
          return new SurchargeSummaryView({
            container: container
          });
        });
      } catch (_e) {}
    });
  }

  function mountToApp(container) {
    var layout = getLayoutComponent(container);

    if (!layout) {
      return;
    }

    addContextDefinitions(layout);
    addChildViews(layout, container);
  }

  return {
    mountToApp: mountToApp
  };
});
