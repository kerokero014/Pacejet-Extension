define("RDT.Pacejet.Cart.Helper", [], function () {
  "use strict";

  var ARRAY_FIELDS = [
    "lines",
    "addresses",
    "shipmethods",
    "paymentmethods",
    "promocodes",
    "multishipmethods",
    "lines_sort"
  ];

  var PRESERVED_SCALAR_FIELDS = [
    "shipaddress",
    "billaddress",
    "summary",
    "options",
    "ismultishipto",
    "touchpoints",
    "purchasenumber"
  ];

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
      value: asString(field ? field.value : "")
    };
  }

  function cloneValue(value) {
    if (Array.isArray(value)) {
      return value.slice();
    }

    if (value && typeof value === "object") {
      var clone = {};

      Object.keys(value).forEach(function (key) {
        clone[key] = value[key];
      });

      return clone;
    }

    return value;
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
    return Array.isArray(customFields)
      ? customFields
          .map(function (field) {
            if (!field) {
              return null;
            }

            var fieldId =
              field.id || field.name || field.fieldid || field.fieldId;

            if (!fieldId) {
              return null;
            }

            return {
              id: asString(fieldId),
              value: asString(field.value)
            };
          })
          .filter(function (field) {
            return !!field;
          })
      : [];
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

  function normalizeArrayField(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function cloneOrder(order) {
    var source = order && typeof order === "object" ? order : {};
    var clone = {};

    Object.keys(source).forEach(function (key) {
      clone[key] = cloneValue(source[key]);
    });

    return clone;
  }

  function normalizeCollectionFields(update, order) {
    ARRAY_FIELDS.forEach(function (fieldName) {
      update[fieldName] = normalizeArrayField(
        update[fieldName] !== undefined ? update[fieldName] : order[fieldName]
      );
    });
  }

  function preserveScalarFields(update, order) {
    PRESERVED_SCALAR_FIELDS.forEach(function (fieldName) {
      if (update[fieldName] === undefined && order[fieldName] !== undefined) {
        update[fieldName] = cloneValue(order[fieldName]);
      }
    });
  }

  function buildOrderUpdatePayload(order, payload) {
    var baseOrder = order && typeof order === "object" ? order : {};
    var update = cloneOrder(baseOrder);
    var existingFields = getCustomFieldList(order);
    var mergedCustomFields = mergeCustomFields(existingFields, payload);

    update.shipmethod = payload.shipmethod;
    update.customfields = mergedCustomFields;
    update.customFields = mergedCustomFields;

    normalizeCollectionFields(update, baseOrder);
    preserveScalarFields(update, baseOrder);

    return update;
  }

  function normalizeSummary(order) {
    var summary = (order && order.summary) || {};
    var shippingCost =
      summary.shippingcost !== undefined
        ? summary.shippingcost
        : summary.shippingCost !== undefined
          ? summary.shippingCost
          : summary.estimatedshipping !== undefined
            ? summary.estimatedshipping
            : summary.handlingcost !== undefined
              ? summary.handlingcost
              : summary.shipping !== undefined
                ? summary.shipping
                : 0;
    var taxTotal =
      summary.taxtotal !== undefined
        ? summary.taxtotal
        : summary.taxTotal !== undefined
          ? summary.taxTotal
          : summary.tax !== undefined
            ? summary.tax
            : summary.taxamount !== undefined
              ? summary.taxamount
              : summary.taxAmount !== undefined
                ? summary.taxAmount
                : 0;
    var subtotal = asNumber(summary.subtotal, 0);
    var shipping = asNumber(shippingCost, 0);
    var tax = asNumber(taxTotal, 0);
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
    ARRAY_FIELDS: ARRAY_FIELDS,
    getCustomFieldList: getCustomFieldList,
    buildOrderUpdatePayload: buildOrderUpdatePayload,
    mergeCustomFields: mergeCustomFields,
    normalizeShipmethod: normalizeShipmethod,
    normalizePayload: normalizePayload,
    normalizeSummary: normalizeSummary,
    validatePayload: validatePayload
  };
});
