define("RDT.Pacejet.Cart.Model", [
  "LiveOrder.Model",
  "RDT.Pacejet.Cart.Helper"
], function (LiveOrderModel, CartHelper) {
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

    return arguments.length > 2
      ? target[methodName](arg)
      : target[methodName]();
  }

  function getCurrentOrder(liveOrder) {
    var order =
      callModelMethod(liveOrder, "get") ||
      callModelMethod(LiveOrderModel, "get") ||
      {};

    return order || {};
  }

  function sanitizeRequest(request) {
    var data = request && typeof request === "object" ? request : {};

    data.customfields = Array.isArray(data.customfields)
      ? data.customfields
      : Array.isArray(data.customFields)
        ? data.customFields
        : [];

    return data;
  }

  function applyRateToCart(request) {
    var payload = CartHelper.normalizePayload(sanitizeRequest(request));
    var liveOrder = getLiveOrderModel();
    var updatedOrder;
    var normalizedSummary;
    var customFields;

    CartHelper.validatePayload(payload);

    var shipmethod = CartHelper.normalizeShipmethod(payload.shipmethod);

    if (shipmethod) {
      if (typeof liveOrder.setShippingMethod === "function") {
        liveOrder.setShippingMethod(shipmethod);
      } else {
        throw new Error("LiveOrder.setShippingMethod is unavailable");
      }
    }

    var customFieldsInput = payload.customFields || payload.customfields || [];

    customFieldsInput.forEach(function (field) {
      if (!field || !field.id) return;

      if (typeof liveOrder.setTransactionBodyField === "function") {
        liveOrder.setTransactionBodyField({
          fieldId: field.id,
          type: "string",
          value: String(field.value)
        });
      }
    });

    updatedOrder = getCurrentOrder(liveOrder);

    // Optional nudge for recalculation
    if (liveOrder.getSummary) {
      liveOrder.getSummary();
    }

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
      customfields: customFields
    };
  }

  return {
    applyRateToCart: applyRateToCart
  };
});
