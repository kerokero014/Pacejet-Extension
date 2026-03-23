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

  function applyShippingCost(liveOrder, updatePayload, amount) {
    if (!liveOrder) {
      throw new Error("LiveOrder is unavailable");
    }

    if (typeof liveOrder.set === "function") {
      liveOrder.set("shippingcost", amount);
      return;
    }

    if (typeof liveOrder.setFieldValue === "function") {
      liveOrder.setFieldValue("shippingcost", amount);
      return;
    }

    updatePayload.summary =
      updatePayload.summary && typeof updatePayload.summary === "object"
        ? updatePayload.summary
        : {};
    updatePayload.summary.shippingcost = amount;
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
    var currentOrder;
    var updatePayload;
    var updatedOrder;
    var normalizedSummary;
    var customFields;
    var amount;

    CartHelper.validatePayload(payload);

    payload.shipmethod = CartHelper.normalizeShipmethod(payload.shipmethod);
    payload.customFields = payload.customFields || [];
    amount = Number(payload.pacejetAmount) || 0;

    currentOrder = getCurrentOrder(liveOrder);
    updatePayload = CartHelper.buildOrderUpdatePayload(currentOrder, payload);

    if (
      typeof liveOrder.set !== "function" &&
      typeof liveOrder.setFieldValue !== "function"
    ) {
      applyShippingCost(liveOrder, updatePayload, amount);
    }

    if (typeof liveOrder.update === "function") {
      liveOrder.update(updatePayload);
    } else if (typeof LiveOrderModel.update === "function") {
      LiveOrderModel.update(updatePayload);
    } else {
      throw new Error("LiveOrder.update is unavailable");
    }

    if (
      typeof liveOrder.set === "function" ||
      typeof liveOrder.setFieldValue === "function"
    ) {
      applyShippingMethod(liveOrder, payload.shipmethod);
    }
    applyCustomFields(liveOrder, payload.customFields);
    applyShippingCost(liveOrder, updatePayload, amount);
    saveLiveOrder(liveOrder);

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
