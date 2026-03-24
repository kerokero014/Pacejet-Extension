define(
  "RDT.rdt_sca_pacejet.PJModule.ServiceController",
  [
    "ServiceController",
    "RDT.Pacejet.Cart.Model"
  ],
  function(ServiceController, PacejetCartModel) {
    "use strict";

    function toScalarValue(value) {
      if (value === null || value === undefined) {
        return "";
      }

      if (typeof value === "string" || typeof value === "number") {
        return value;
      }

      if (typeof value === "boolean") {
        return value ? "T" : "F";
      }

      if (typeof value === "object") {
        if (value.value !== undefined && value.value !== value) {
          return toScalarValue(value.value);
        }

        if (value.internalid !== undefined) {
          return toScalarValue(value.internalid);
        }

        if (value.internalId !== undefined) {
          return toScalarValue(value.internalId);
        }

        if (value.id !== undefined) {
          return toScalarValue(value.id);
        }

        return "";
      }

      return String(value);
    }

    function safeParseBody(raw) {
      if (!raw) {
        return {};
      }

      if (typeof raw === "string") {
        try {
          return JSON.parse(raw);
        } catch (_e) {
          return {};
        }
      }

      return raw && typeof raw === "object" ? raw : {};
    }

    function getRequestBody(context) {
      var request =
        (context && (context.request || context.req)) || null;
      var data = {};
      var raw;

      if (request && typeof request.getBody === "function") {
        raw = request.getBody();
        data = safeParseBody(raw);
      } else if (context && context.data) {
        data = safeParseBody(context.data);
      }

      data = data && typeof data === "object" ? data : {};
      data.shipmethod =
        data.shipmethod !== null &&
        data.shipmethod !== undefined &&
        data.shipmethod !== ""
          ? String(toScalarValue(data.shipmethod))
          : data.shipMethod !== null && data.shipMethod !== undefined
            ? String(toScalarValue(data.shipMethod))
            : "";
      data.pacejetAmount =
        data.pacejetAmount !== null &&
        data.pacejetAmount !== undefined &&
        data.pacejetAmount !== ""
          ? Number(toScalarValue(data.pacejetAmount))
          : data.cost !== null && data.cost !== undefined && data.cost !== ""
            ? Number(toScalarValue(data.cost))
            : 0;

      if (!isFinite(data.pacejetAmount)) {
        data.pacejetAmount = 0;
      }

      data = {
        shipmethod: data.shipmethod,
        pacejetAmount: data.pacejetAmount,
        carrier:
          data.carrier !== null && data.carrier !== undefined
            ? String(toScalarValue(data.carrier))
            : "",
        service:
          data.service !== null && data.service !== undefined
            ? String(toScalarValue(data.service))
            : "",
        transitDays:
          data.transitDays !== null && data.transitDays !== undefined
            ? String(toScalarValue(data.transitDays))
            : "",
        quoteJson:
          data.quoteJson !== null && data.quoteJson !== undefined
            ? String(toScalarValue(data.quoteJson))
            : "",
        customfields: Array.isArray(data.customfields) ? data.customfields : [],
        customFields: Array.isArray(data.customFields) ? data.customFields : []
      };

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
