define("RDT.Pacejet.Cart.Helper", [], function () {
  "use strict";

  var ACCESSORIAL_FIELD_MAP = {
    driver_call: "custbody_callpriortruck",
    lift_gate: "custbody_pj_ssliftgate",
    job_site: "custbody_jobsite",
    residential: "custbody_residential",
    schedule_appt: "custbody_appointmenttruck",
    self_storage: "custbody_selfstorage",
    school: "custbody_school_delivery",
    inside_delivery: "custbody_inside_delivery",
    dangerous_goods: "custbody_dangerous_goods",
    hazmat_parcel: "custbody_access_hazmat_parcel"
  };

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

  function firstDefined() {
    var i;
    var value;

    for (i = 0; i < arguments.length; i++) {
      value = arguments[i];
      if (value !== null && value !== undefined && value !== "") {
        return value;
      }
    }

    return "";
  }

  function asCheckboxValue(value) {
    if (
      value === true ||
      value === "T" ||
      value === "true" ||
      value === 1 ||
      value === "1"
    ) {
      return "T";
    }

    return "F";
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

  function buildEtaDate(transitDays) {
    var days = asNumber(transitDays, NaN);
    if (!isFinite(days) || days <= 0) {
      return "";
    }

    var eta = new Date();
    eta.setDate(eta.getDate() + days);

    return eta.toISOString().split("T")[0];
  }

  function buildOriginSummary(origins) {
    if (!Array.isArray(origins) || !origins.length) {
      return "";
    }

    return origins
      .map(function (origin) {
        var label =
          origin.city ||
          origin.zip ||
          origin.originKey ||
          origin.LocationCode ||
          "Origin";

        return label + ": $" + asNumber(origin.cost, 0).toFixed(2);
      })
      .join("\n");
  }

  function truncateQuoteJson(value) {
    var json = asString(value);
    return json.length > 3800 ? json.slice(0, 3800) : json;
  }

  function normalizeDateInput(value) {
    var raw = asString(value).trim();
    var date;

    if (!raw) {
      return "";
    }

    date = new Date(raw);
    if (!isFinite(date.getTime())) {
      return "";
    }

    return date.toISOString().split("T")[0];
  }

  function normalizePayload(payload) {
    var raw = payload || {};

    payload = payload || {};

    return {
      shipmethod: asString(firstDefined(raw.shipmethod, raw.shipMethod)).trim(),
      pacejetAmount: asNumber(
        firstDefined(raw.pacejetAmount, raw.pacejet_amount, raw.shipping),
        0
      ),
      carrier: asString(
        firstDefined(raw.carrier, raw.carrierName, raw.pacejet_carrier_name)
      ),
      service: asString(
        firstDefined(raw.service, raw.serviceName, raw.pacejet_service_name)
      ),
      quoteJson: truncateQuoteJson(
        firstDefined(raw.quoteJson, raw.pacejet_quote_json)
      ),
      transitDays: firstDefined(raw.transitDays, raw.pacejet_transit_days),
      estArrivalDate: normalizeDateInput(
        firstDefined(raw.estArrivalDate, raw.pacejet_est_arrival_date)
      ),
      originKey: asString(
        firstDefined(raw.originKey, raw.pacejet_origin_key)
      ),
      originCount: asNumber(
        firstDefined(raw.originCount, raw.pacejet_origin_count),
        0
      ),
      originSummary: asString(
        firstDefined(raw.originSummary, raw.pacejet_origin_summary)
      ),
      accessorials: raw.accessorials || {},
      customFields: raw.customFields || raw.customfields || [],
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
    var customFields = Array.isArray(payload.customFields)
      ? payload.customFields
      : [];
    var origins = payload.raw && payload.raw.origins;
    var originSummary = payload.originSummary || buildOriginSummary(origins);
    var originCount =
      payload.originCount ||
      (Array.isArray(origins) && origins.length ? origins.length : 0);
    var originKey =
      payload.originKey ||
      ((Array.isArray(origins) && origins[0] && origins[0].originKey) || "");
    var transitDays = payload.transitDays;
    var etaDate = payload.estArrivalDate || buildEtaDate(transitDays);

    customFields.forEach(function (field) {
      var fieldId = field && (field.id || field.name || field.fieldId);
      if (fieldId) {
        setField(fieldMap, fieldId, field.value);
      }
    });

    setField(fieldMap, "custbody_rdt_pacejet_amount", payload.pacejetAmount);
    setField(fieldMap, "custbody_rdt_pj_carrier_name", payload.carrier);
    setField(fieldMap, "custbody_rdt_pj_service_name", payload.service);
    setField(
      fieldMap,
      "custbody_rdt_pj_accessorial_total",
      asNumber(payload.raw && payload.raw.accessorialDelta, 0)
    );
    setField(fieldMap, "custbody_rdt_pj_quote_json", payload.quoteJson);

    if (transitDays !== "") {
      setField(fieldMap, "custbody_rdt_pj_transit_days", asNumber(transitDays));
    }

    if (etaDate) {
      setField(fieldMap, "custbody_rdt_pj_est_arrival_date", etaDate);
    }

    if (originCount) {
      setField(fieldMap, "custbody_rdt_pj_origin_count", originCount);
    }

    if (originKey) {
      setField(fieldMap, "custbody_rdt_pj_origin_key", originKey);
    }

    if (originSummary) {
      setField(fieldMap, "custbody_rdt_pj_origin_summary", originSummary);
    }

    Object.keys(ACCESSORIAL_FIELD_MAP).forEach(function (key) {
      setField(
        fieldMap,
        ACCESSORIAL_FIELD_MAP[key],
        asCheckboxValue(payload.accessorials[key])
      );
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
    update.customFields = mergedCustomFields;

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
