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

  function applyShippingMethod(liveOrder, shipmethod) {
    if (!liveOrder) {
      throw new Error("LiveOrder is unavailable");
    }

    if (typeof liveOrder.set === "function") {
      liveOrder.set("shipmethod", shipmethod);
      return;
    }

    if (typeof liveOrder.setFieldValue === "function") {
      liveOrder.setFieldValue("shipmethod", shipmethod);
      return;
    }

    throw new Error("Unable to set shipmethod on LiveOrder");
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

  function saveLiveOrder(liveOrder) {
    if (!liveOrder || typeof liveOrder.save !== "function") {
      throw new Error("LiveOrder.save is unavailable");
    }

    liveOrder.save();
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
    var customFieldsInput;
    var customFields;

    CartHelper.validatePayload(payload);

    var shipmethod = CartHelper.normalizeShipmethod(payload.shipmethod);
    customFieldsInput = payload.customFields || payload.customfields || [];

    if (shipmethod) {
      applyShippingMethod(liveOrder, shipmethod);
    }

    applyCustomFields(liveOrder, customFieldsInput);
    saveLiveOrder(liveOrder);
    updatedOrder = refreshOrderState(liveOrder);

    normalizedSummary = CartHelper.normalizeSummary(updatedOrder);
    customFields = CartHelper.mergeCustomFields(
      CartHelper.getCustomFieldList(updatedOrder),
      {
        customFields: customFieldsInput
      }
    );

    return {
      ok: true,
      shipmethod: shipmethod,
      summary: normalizedSummary,
      customfields: customFields
    };
  }

  return {
    applyRateToCart: applyRateToCart
  };
});
