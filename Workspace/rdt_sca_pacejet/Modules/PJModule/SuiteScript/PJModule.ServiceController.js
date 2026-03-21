define(
  "RDT.rdt_sca_pacejet.PJModule.ServiceController",
  [
    "ServiceController",
    "RDT.Pacejet.Cart.Model"
  ],
  function(ServiceController, PacejetCartModel) {
    "use strict";

    return ServiceController.extend({
      name: "RDT.rdt_sca_pacejet.PJModule.ServiceController",

      options: {
        common: {}
      },

      get: function get() {
        return {
          ok: true,
          message: "Pacejet cart backend service is available"
        };
      },

      post: function post() {
        return PacejetCartModel.applyRateToCart(this.data || {});
      },

      put: function put() {
        return PacejetCartModel.applyRateToCart(this.data || {});
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
