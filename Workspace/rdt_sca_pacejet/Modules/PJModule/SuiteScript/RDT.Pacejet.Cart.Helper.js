define("RDT.Pacejet.Cart.Helper", [], function () {
  "use strict";

  function isPlainObject(value) {
    return (
      !!value &&
      Object.prototype.toString.call(value) === "[object Object]"
    );
  }

  function asString(value) {
    if (value === null || value === undefined) {
      return "";
    }

    return String(value);
  }

  function asNumber(value, fallback) {
    var num = Number(value);
    return isFinite(num) ? num : fallback || 0;
  }

  function toScalarValue(value) {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "boolean") {
      return value ? "T" : "F";
    }

    if (typeof value === "string" || typeof value === "number") {
      return value;
    }

    if (isPlainObject(value)) {
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
    }

    return asString(value);
  }

  function normalizeShipmethod(shipmethod) {
    if (shipmethod === null || shipmethod === undefined || shipmethod === "") {
      return "";
    }

    if (typeof shipmethod === "object") {
      return asString(
        shipmethod.internalid ||
          shipmethod.internalId ||
          shipmethod.id ||
          shipmethod.value ||
          shipmethod.shipmethod
      ).trim();
    }

    return asString(shipmethod).trim();
  }

  function normalizePayload(payload) {
    var raw = isPlainObject(payload) ? payload : {};
    var shipmethod =
      raw.shipmethod !== undefined && raw.shipmethod !== null && raw.shipmethod !== ""
        ? raw.shipmethod
        : raw.shipMethod;

    return {
      shipmethod: normalizeShipmethod(shipmethod),
      pacejetAmount: asNumber(
        raw.pacejetAmount !== undefined && raw.pacejetAmount !== null
          ? toScalarValue(raw.pacejetAmount)
          : raw.cost !== undefined && raw.cost !== null
            ? toScalarValue(raw.cost)
            : 0,
        0
      ),
      carrier: asString(toScalarValue(raw.carrier)),
      service: asString(toScalarValue(raw.service)),
      transitDays: asString(toScalarValue(raw.transitDays)),
      quoteJson: asString(toScalarValue(raw.quoteJson))
    };
  }

  function validatePayload(payload) {
    if (!payload.shipmethod) {
      throw new Error("shipmethod is required");
    }
  }

  function getSummaryValue(summary, keys) {
    var i;

    for (i = 0; i < keys.length; i += 1) {
      if (summary[keys[i]] !== undefined && summary[keys[i]] !== null) {
        return summary[keys[i]];
      }
    }

    return 0;
  }

  function normalizeSummary(order) {
    var summary = (order && order.summary) || {};
    var subtotal = asNumber(getSummaryValue(summary, ["subtotal"]), 0);
    var shipping = asNumber(
      getSummaryValue(summary, [
        "shipping",
        "shippingcost",
        "shippingCost",
        "estimatedshipping",
        "handlingcost"
      ]),
      0
    );
    var tax = asNumber(
      getSummaryValue(summary, [
        "tax",
        "taxtotal",
        "taxTotal",
        "taxamount",
        "taxAmount"
      ]),
      0
    );
    var total = asNumber(
      getSummaryValue(summary, ["total", "order_total", "totalamount", "totalAmount"]),
      subtotal + shipping + tax
    );

    return {
      subtotal: +subtotal.toFixed(2),
      shipping: +shipping.toFixed(2),
      tax: +tax.toFixed(2),
      total: +total.toFixed(2)
    };
  }

  return {
    normalizePayload: normalizePayload,
    normalizeShipmethod: normalizeShipmethod,
    normalizeSummary: normalizeSummary,
    toScalarValue: toScalarValue,
    validatePayload: validatePayload
  };
});
