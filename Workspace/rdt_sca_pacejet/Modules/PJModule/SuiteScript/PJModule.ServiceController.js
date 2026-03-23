define(
  "RDT.rdt_sca_pacejet.PJModule.ServiceController",
  [
    "ServiceController",
    "RDT.Pacejet.Cart.Model"
  ],
  function(ServiceController, PacejetCartModel) {
    "use strict";

    function getRequestBody(context) {
      var request =
        (context && (context.request || context.req)) || null;
      var data = {};
      var raw;

      if (request && typeof request.getBody === "function") {
        raw = request.getBody();

        if (typeof raw === "string") {
          try {
            data = JSON.parse(raw);
          } catch (e) {
            data = {};
          }
        } else {
          data = raw || {};
        }
      } else if (context && context.data) {
        data = context.data || {};
      }

      data = data && typeof data === "object" ? data : {};
      data.customfields = Array.isArray(data.customfields)
        ? data.customfields
        : Array.isArray(data.customFields)
          ? data.customFields
          : [];
      data.shipmethod =
        data.shipmethod !== null && data.shipmethod !== undefined
          ? String(data.shipmethod)
          : data.shipMethod !== null && data.shipMethod !== undefined
            ? String(data.shipMethod)
            : "";

      if (typeof log !== "undefined" && log && typeof log.debug === "function") {
        log.debug("Parsed request body", JSON.stringify(data));
      }

      return data;
    }

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
        return PacejetCartModel.applyRateToCart(getRequestBody(this));
      },

      put: function put() {
        return PacejetCartModel.applyRateToCart(getRequestBody(this));
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
