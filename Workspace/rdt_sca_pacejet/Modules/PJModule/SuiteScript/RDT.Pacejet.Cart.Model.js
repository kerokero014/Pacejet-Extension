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

  function updateLiveOrder(liveOrder, payload) {
    if (liveOrder && typeof liveOrder.update === "function") {
      return liveOrder.update(payload);
    }

    if (typeof LiveOrderModel.update === "function") {
      return LiveOrderModel.update(payload);
    }

    throw new Error("LiveOrder.update is unavailable");
  }

  function applyCustomFields(liveOrder, customFieldsInput) {
    if (typeof liveOrder.setTransactionBodyField !== "function") {
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

  function refreshOrderState(liveOrder) {
    var updatedOrder = getCurrentOrder(liveOrder);

    if (!updatedOrder || !updatedOrder.summary) {
      updatedOrder = callModelMethod(LiveOrderModel, "get") || updatedOrder;
    }

    return updatedOrder || {};
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
    var amount;

    CartHelper.validatePayload(payload);

    payload.shipmethod = CartHelper.normalizeShipmethod(payload.shipmethod);
    payload.customFields = payload.customFields || [];
    amount = Number(payload.pacejetAmount) || 0;

    updateLiveOrder(liveOrder, {
      shipmethod: payload.shipmethod
    });

    updateLiveOrder(liveOrder, {
      summary: {
        shippingcost: amount
      }
    });

    applyCustomFields(liveOrder, payload.customFields);

    updatedOrder = refreshOrderState(liveOrder);
    normalizedSummary = CartHelper.normalizeSummary(updatedOrder);
    customFields = CartHelper.mergeCustomFields(
      CartHelper.getCustomFieldList(updatedOrder),
      {
        customFields: payload.customFields
      }
    );

    return {
      ok: true,
      shipmethod: payload.shipmethod,
      summary: normalizedSummary,
      customfields: customFields
    };
  }

  return {
    applyRateToCart: applyRateToCart
  };
});
