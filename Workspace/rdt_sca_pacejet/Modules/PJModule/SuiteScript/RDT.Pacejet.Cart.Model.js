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

  function ensureLiveOrderMethod(liveOrder, methodName) {
    var target =
      liveOrder && typeof liveOrder[methodName] === "function"
        ? liveOrder
        : typeof LiveOrderModel[methodName] === "function"
          ? LiveOrderModel
          : null;

    if (!target) {
      throw new Error("LiveOrder." + methodName + " is unavailable");
    }

    return target;
  }

  function safeUpdate(liveOrder, payload) {
    return ensureLiveOrderMethod(liveOrder, "update").update(payload || {});
  }

  function safeGet(liveOrder) {
    var order = callModelMethod(ensureLiveOrderMethod(liveOrder, "get"), "get");

    return order && typeof order === "object" ? order : {};
  }

  function sanitizeRequest(request) {
    var data = request && typeof request === "object" ? request : {};
    var normalizedPayload = CartHelper.normalizePayload(data);

    return {
      shipmethod: normalizedPayload.shipmethod,
      pacejetAmount: normalizedPayload.pacejetAmount,
      carrier: normalizedPayload.carrier,
      service: normalizedPayload.service,
      transitDays: normalizedPayload.transitDays,
      quoteJson: normalizedPayload.quoteJson
    };
  }

  function applyRateToCart(request) {
    var payload = CartHelper.normalizePayload(sanitizeRequest(request));
    var liveOrder = getLiveOrderModel();
    var updatedOrder;

    CartHelper.validatePayload(payload);

    payload.shipmethod = CartHelper.normalizeShipmethod(payload.shipmethod);
    payload.pacejetAmount = Number(payload.pacejetAmount) || 0;

    safeUpdate(liveOrder, {
      shipmethod: ""
    });

    safeGet(liveOrder);

    safeUpdate(liveOrder, {
      shipmethod: payload.shipmethod
    });

    safeGet(liveOrder);

    safeUpdate(liveOrder, {});
    updatedOrder = safeGet(liveOrder);

    return {
      ok: true,
      shipmethod: payload.shipmethod,
      pacejetAmount: payload.pacejetAmount,
      summary: CartHelper.normalizeSummary(updatedOrder)
    };
  }

  return {
    applyRateToCart: applyRateToCart
  };
});
