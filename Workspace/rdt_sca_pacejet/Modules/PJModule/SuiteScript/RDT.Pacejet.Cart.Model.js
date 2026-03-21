define(
  "RDT.Pacejet.Cart.Model",
  ["LiveOrder.Model", "RDT.Pacejet.Cart.Helper"],
  function (LiveOrderModel, CartHelper) {
    "use strict";

    function getLiveOrderModel() {
      if (!LiveOrderModel) {
        throw new Error("LiveOrder.Model is unavailable");
      }

      if (typeof LiveOrderModel.getInstance === "function") {
        return LiveOrderModel.getInstance();
      }

      return LiveOrderModel;
    }

    function callModelMethod(target, methodName, arg) {
      if (!target || typeof target[methodName] !== "function") {
        return null;
      }

      return arguments.length > 2 ? target[methodName](arg) : target[methodName]();
    }

    function getCurrentOrder(liveOrder) {
      var order =
        callModelMethod(liveOrder, "get") ||
        callModelMethod(LiveOrderModel, "get") ||
        {};

      return order || {};
    }

    function updateOrder(liveOrder, order) {
      var updated =
        callModelMethod(liveOrder, "update", order) ||
        callModelMethod(LiveOrderModel, "update", order);

      if (!updated) {
        throw new Error("LiveOrder update method is unavailable");
      }

      return updated;
    }

    function applyRateToCart(request) {
      var payload = CartHelper.normalizePayload(request);
      var liveOrder = getLiveOrderModel();
      var currentOrder = getCurrentOrder(liveOrder);
      var orderUpdate;
      var updatedOrder;
      var normalizedSummary;
      var customFields;

      CartHelper.validatePayload(payload);

      orderUpdate = CartHelper.buildOrderUpdatePayload(currentOrder, payload);

      updatedOrder = updateOrder(liveOrder, orderUpdate);

      if (!updatedOrder || !updatedOrder.summary) {
        updatedOrder = getCurrentOrder(liveOrder);
      }

      normalizedSummary = CartHelper.normalizeSummary(updatedOrder);
      customFields = CartHelper.getCustomFieldList(updatedOrder);

      return {
        ok: true,
        shipmethod:
          CartHelper.normalizeShipmethod(
            updatedOrder && updatedOrder.shipmethod
          ) || payload.shipmethod,
        summary: normalizedSummary,
        totals: normalizedSummary,
        customFields: customFields,
        customfields: customFields
      };
    }

    return {
      applyRateToCart: applyRateToCart
    };
  }
);
