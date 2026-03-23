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
      value: asString(field ? field.value : "")
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

  function getCustomFieldValue(customFields, fieldId) {
    var match = (Array.isArray(customFields) ? customFields : []).filter(function (
      field
    ) {
      return field && field.id === fieldId;
    })[0];

    return match ? match.value : "";
  }

  function normalizePayload(payload) {
    var raw = payload || {};
    var customFields = normalizeCustomFields(raw.customFields || raw.customfields);

    return {
      shipmethod: asString(raw.shipmethod || raw.shipMethod).trim(),
      customFields: customFields,
      pacejetAmount: asNumber(
        raw.pacejetAmount !== undefined && raw.pacejetAmount !== null
          ? raw.pacejetAmount
          : raw.cost !== undefined && raw.cost !== null
            ? raw.cost
            : getCustomFieldValue(customFields, "custbody_rdt_pacejet_amount"),
        0
      ),
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
    getCustomFieldList: getCustomFieldList,
    mergeCustomFields: mergeCustomFields,
    normalizeShipmethod: normalizeShipmethod,
    normalizePayload: normalizePayload,
    normalizeSummary: normalizeSummary,
    validatePayload: validatePayload
  };
});
