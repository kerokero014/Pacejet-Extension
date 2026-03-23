define("RDT.Pacejet.Cart.Helper", [], function () {
  "use strict";

  function asNumber(value, fallback) {
    var num = Number(value);
    return isFinite(num) ? num : fallback || 0;
  }

  function asString(value) {
    if (value === null || value === undefined) {
      return "";
    }

    return String(value);
  }

  function cloneField(field) {
    return {
      id: field && (field.id || field.name || field.fieldid || field.fieldId),
      value: field ? field.value : ""
    };
  }

  function getCustomFieldList(order) {
    var list =
      (order && (order.customfields || order.customFields)) ||
      [];

    if (!Array.isArray(list)) {
      return [];
    }

    return list
      .map(cloneField)
      .filter(function (field) {
        return !!field.id;
      });
  }

  function setField(fieldMap, fieldId, value) {
    if (!fieldId) {
      return;
    }

    fieldMap[fieldId] = {
      id: fieldId,
      value: value
    };
  }

  function normalizeCustomFields(customFields) {
    return Array.isArray(customFields) ? customFields : [];
  }

  function normalizePayload(payload) {
    var raw = payload || {};
    return {
      shipmethod: asString(raw.shipmethod || raw.shipMethod).trim(),
      customFields: normalizeCustomFields(raw.customFields || raw.customfields),
      raw: raw
    };
  }

  function getFieldMap(existingFields) {
    var fieldMap = {};

    (Array.isArray(existingFields) ? existingFields : []).forEach(function (
      field
    ) {
      if (field && field.id) {
        fieldMap[field.id] = cloneField(field);
      }
    });

    return fieldMap;
  }

  function validatePayload(payload) {
    if (!payload.shipmethod) {
      throw new Error("shipmethod is required");
    }
  }

  function mergeCustomFields(existingFields, payload) {
    var fieldMap = getFieldMap(existingFields);
    var customFields = normalizeCustomFields(payload.customFields);

    customFields.forEach(function (field) {
      var fieldId = field && (field.id || field.name || field.fieldId);
      if (fieldId) {
        setField(fieldMap, fieldId, field.value);
      }
    });

    return Object.keys(fieldMap).map(function (fieldId) {
      return fieldMap[fieldId];
    });
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

  function buildOrderUpdatePayload(order, payload) {
    var update = {};
    var existingFields = getCustomFieldList(order);
    var mergedCustomFields = mergeCustomFields(existingFields, payload);

    update.shipmethod = payload.shipmethod;
    update.customfields = mergedCustomFields;

    return update;
  }

  function normalizeSummary(order) {
    var summary = (order && order.summary) || {};
    var subtotal = asNumber(summary.subtotal, 0);
    var shipping = asNumber(
      summary.shippingcost || summary.shippingCost || summary.estimatedshipping,
      0
    );
    var tax = asNumber(
      summary.taxtotal ||
        summary.taxTotal ||
        summary.tax ||
        summary.taxamount ||
        summary.taxAmount,
      0
    );
    var total = asNumber(
      summary.total || summary.totalAmount || summary.totalamount,
      subtotal + shipping + tax
    );

    return {
      subtotal: subtotal,
      shipping: shipping,
      tax: tax,
      total: total
    };
  }

  return {
    getCustomFieldList: getCustomFieldList,
    buildOrderUpdatePayload: buildOrderUpdatePayload,
    mergeCustomFields: mergeCustomFields,
    normalizeShipmethod: normalizeShipmethod,
    normalizePayload: normalizePayload,
    normalizeSummary: normalizeSummary,
    validatePayload: validatePayload
  };
});
