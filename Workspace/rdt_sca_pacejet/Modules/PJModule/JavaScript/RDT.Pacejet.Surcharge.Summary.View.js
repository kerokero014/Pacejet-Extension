/// <amd-module name="RDT.Pacejet.Surcharge.Summary.View"/>

define("RDT.Pacejet.Surcharge.Summary.View", [
  "Backbone",
  "LiveOrder.Model",
  "RDT.Pacejet.Summary",
  "rdt_pacejet_surcharge_summary_row.tpl"
], function (Backbone, LiveOrderModel, PacejetSummary, surchargeRowTpl) {
  "use strict";

  return Backbone.View.extend({
    template: surchargeRowTpl,

    initialize: function initialize(options) {
      this.container = options && options.container;
    },

    getContext: function getContext() {
      var order = null;
      var surchargeSummary = null;

      try {
        order =
          LiveOrderModel && typeof LiveOrderModel.getInstance === "function"
            ? LiveOrderModel.getInstance()
            : null;
      } catch (_e) {
        order = null;
      }

      surchargeSummary =
        order && PacejetSummary && PacejetSummary.getSummary
          ? PacejetSummary.getSummary(order)
          : null;

      return {
        showSurcharge:
          !!surchargeSummary &&
          !!surchargeSummary.showSurcharge &&
          surchargeSummary.surcharge > 0,
        surchargeLabel:
          (surchargeSummary && surchargeSummary.surchargeLabel) ||
          "Surcharge 2%",
        surchargeFormatted:
          (surchargeSummary && surchargeSummary.surchargeFormatted) || "$0.00"
      };
    }
  });
});
