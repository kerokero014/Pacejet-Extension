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

  function updateLiveOrder(liveOrder, payload) {
    var orderModel =
      liveOrder && typeof liveOrder.update === "function"
        ? liveOrder
        : typeof LiveOrderModel.update === "function"
          ? LiveOrderModel
          : null;

    if (!orderModel) {
      throw new Error("LiveOrder.update is unavailable");
    }

    orderModel.update({
      shipmethod: ""
    });

    orderModel.update({
      shipmethod: payload.shipmethod
    });

    return callModelMethod(orderModel, "get") || {};
  }

  function applyCustomFields(liveOrder, customFieldsInput) {
    if (
      !liveOrder ||
      typeof liveOrder.setTransactionBodyField !== "function" ||
      !Array.isArray(customFieldsInput)
    ) {
      return;
    }

    customFieldsInput.forEach(function (field) {
      if (!field || !field.id) {
        return;
      }

      liveOrder.setTransactionBodyField({
        fieldId: field.id,
        type: "string",
        value: String(field.value)
      });
    });
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

    CartHelper.validatePayload(payload);

    payload.shipmethod = CartHelper.normalizeShipmethod(payload.shipmethod);
    payload.customFields = payload.customFields || [];
    payload.pacejetAmount = Number(payload.pacejetAmount) || 0;

    updatedOrder = updateLiveOrder(liveOrder, payload);

    if (typeof liveOrder.update === "function") {
      liveOrder.update({});
    }

    if (payload.customFields.length) {
      applyCustomFields(liveOrder, payload.customFields);
    }

    if (typeof liveOrder.update === "function") {
      liveOrder.update({});
    }

    updatedOrder = callModelMethod(liveOrder, "get") || updatedOrder;

    var summaryOverrides = {
      shippingcost: payload.pacejetAmount,
      shippingCost: payload.pacejetAmount,
      shipping: payload.pacejetAmount,
      estimatedshipping: payload.pacejetAmount
    };

    var normalizedSummary = CartHelper.normalizeSummary(
      updatedOrder,
      summaryOverrides
    );

    return {
      ok: true,
      shipmethod: payload.shipmethod,
      summary: normalizedSummary,
      customfields: payload.customFields
    };
  }

  return {
    applyRateToCart: applyRateToCart
  };
});
