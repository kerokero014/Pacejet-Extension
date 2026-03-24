define("RDT.Pacejet.Cart.Helper", [], function () {
  "use strict";

  var PERSISTED_FIELD_IDS = {
    pacejetAmount: "custbody_rdt_pacejet_amount",
    carrier: "custbody_rdt_pacejet_carrier",
    service: "custbody_rdt_pacejet_service",
    transitDays: "custbody_rdt_pacejet_transitdays",
    quoteJson: "custbody_rdt_pacejet_quotejson"
  };

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

  function getFieldValue(field) {
    if (!field || typeof field !== "object") {
      return "";
    }

    if (field.value !== undefined && field.value !== null && field.value !== "") {
      return field.value;
    }

    if (field.internalid !== undefined && field.internalid !== null && field.internalid !== "") {
      return field.internalid;
    }

    if (field.internalId !== undefined && field.internalId !== null && field.internalId !== "") {
      return field.internalId;
    }

    return "";
  }

  function getFieldId(field) {
    if (!field || typeof field !== "object") {
      return "";
    }

    return asString(field.id || field.name || field.fieldid || field.fieldId).trim();
  }

  function findFieldValueInLists(raw, fieldId) {
    var lists = [
      raw && raw.customfields,
      raw && raw.customFields,
      raw && raw.options,
      raw && raw.bodyfields,
      raw && raw.bodyFields,
      raw && raw.fields,
      raw && raw.itemoptions_detail && raw.itemoptions_detail.fields,
      raw && raw.itemoptions && raw.itemoptions.fields
    ];
    var list;
    var i;
    var candidateId;
    var value;

    for (i = 0; i < lists.length; i += 1) {
      list = lists[i];

      if (Array.isArray(list)) {
        for (var j = 0; j < list.length; j += 1) {
          candidateId = getFieldId(list[j]);
          if (candidateId && candidateId === fieldId) {
            value = getFieldValue(list[j]);
            if (value !== "" || value === 0) {
              return value;
            }
          }
        }
      } else if (isPlainObject(list) && Object.prototype.hasOwnProperty.call(list, fieldId)) {
        return list[fieldId];
      }
    }

    return "";
  }

  function findFieldValue(raw, fieldId, depth, seen) {
    var keys;
    var nested;
    var i;

    if (!raw || !fieldId || depth > 4) {
      return "";
    }

    if (seen.indexOf(raw) !== -1) {
      return "";
    }

    seen.push(raw);

    if (isPlainObject(raw) && Object.prototype.hasOwnProperty.call(raw, fieldId)) {
      return raw[fieldId];
    }

    var listedValue = findFieldValueInLists(raw, fieldId);
    if (listedValue !== "" || listedValue === 0) {
      return listedValue;
    }

    keys = Object.keys(raw);
    for (i = 0; i < keys.length; i += 1) {
      nested = raw[keys[i]];

      if (!nested || typeof nested !== "object") {
        continue;
      }

      nested = findFieldValue(nested, fieldId, depth + 1, seen);
      if (nested !== "" || nested === 0) {
        return nested;
      }
    }

    return "";
  }

  function getPersistedFieldValue(order, fieldId) {
    var value = findFieldValue(order, fieldId, 0, []);

    return value !== "" || value === 0 ? value : "";
  }

  function getPersistedPacejetAmount(order) {
    var value = getPersistedFieldValue(order, PERSISTED_FIELD_IDS.pacejetAmount);

    return value === "" ? null : asNumber(value, 0);
  }

  function buildPersistenceFieldMap(payload) {
    var normalized = normalizePayload(payload);
    var fields = {};

    fields[PERSISTED_FIELD_IDS.pacejetAmount] = normalized.pacejetAmount.toFixed(2);

    if (normalized.carrier) {
      fields[PERSISTED_FIELD_IDS.carrier] = normalized.carrier;
    }

    if (normalized.service) {
      fields[PERSISTED_FIELD_IDS.service] = normalized.service;
    }

    if (normalized.transitDays) {
      fields[PERSISTED_FIELD_IDS.transitDays] = normalized.transitDays;
    }

    if (normalized.quoteJson) {
      fields[PERSISTED_FIELD_IDS.quoteJson] = normalized.quoteJson;
    }

    return fields;
  }

  function normalizeSummary(order) {
    var summary = (order && order.summary) || {};
    var subtotal = asNumber(getSummaryValue(summary, ["subtotal"]), 0);
    var persistedAmount = getPersistedPacejetAmount(order);
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

    if (persistedAmount !== null) {
      shipping = persistedAmount;
      total = subtotal + shipping + tax;
    }

    return {
      subtotal: +subtotal.toFixed(2),
      shipping: +shipping.toFixed(2),
      tax: +tax.toFixed(2),
      total: +total.toFixed(2)
    };
  }

  return {
    buildPersistenceFieldMap: buildPersistenceFieldMap,
    getPersistedFieldValue: getPersistedFieldValue,
    getPersistedPacejetAmount: getPersistedPacejetAmount,
    normalizePayload: normalizePayload,
    normalizeShipmethod: normalizeShipmethod,
    normalizeSummary: normalizeSummary,
    PERSISTED_FIELD_IDS: PERSISTED_FIELD_IDS,
    toScalarValue: toScalarValue,
    validatePayload: validatePayload
  };
});
