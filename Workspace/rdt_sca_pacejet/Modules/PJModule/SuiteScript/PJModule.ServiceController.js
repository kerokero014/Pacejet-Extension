define(
  "RDT.rdt_sca_pacejet.PJModule.ServiceController",
  ["ServiceController", "RDT.Pacejet.Cart.Model", "N/log"],
  function(ServiceController, PacejetCartModel, log) {
    "use strict";

    return ServiceController.extend({
      name: "RDT.rdt_sca_pacejet.PJModule.ServiceController",

      options: {
        common: {}
      },

      get: function get() {
        return {
          ok: true,
          message: "Pacejet backend service is available"
        };
      },

      post: function post() {
        try {
          return PacejetCartModel.applyRateToCart(this.data || {});
        } catch (e) {
          log.error({
            title: "Pacejet service POST failed",
            details: {
              message: e && e.message,
              stack: e && e.stack
            }
          });
          throw e;
        }
      },

      put: function put() {
        return this.post();
      },

      delete: function() {
        return {
          ok: false,
          error: "DELETE not supported"
        };
      }
    });
  }
);
