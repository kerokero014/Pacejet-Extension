/// <amd-module name="RDT.Pacejet.Checkout.Module.V2"/>

define("RDT.Pacejet.Checkout.Module.V2", [
  "LiveOrder.Model",
  "jQuery",
  "underscore",
  "RDT.Pacejet.Config",
  "RDT.Pacejet.State",
  "RDT.Pacejet.Service",
  "RDT.Pacejet.Summary",
  "RDT.Pacejet.UI",
  "RDT.Pacejet.AccessorialMatrix"
], function (
  LiveOrderModel,
  jQuery,
  _,
  PacejetConfig,
  PacejetState,
  PacejetService,
  PacejetSummary,
  PacejetUI,
  AccessorialMatrix
) {
  "use strict";

  var $ = jQuery;

  var MODEL_WIRED = false;
  var INITIAL_FETCH_DONE = false;
  var REFRESH_TIMER = null;
  var REVIEW_SYNC_TIMER = null;
  var SELECTION_APPLY_TOKEN = 0;
  var SUMMARY_FETCH_IN_FLIGHT = false;
  var NONE_ACCESSORIAL_ID = "none_additional_fees_may_app";
  var NONE_ACCESSORIAL_FIELD_ID = "custbody_none_additional_fees_may_app";
  var SUMMARY_PREVIEW_URL =
    "/app/site/hosting/scriptlet.nl?script=3985&deploy=1";

  var PACEJET_BODY_FIELDS = {
    amount: "custbody_rdt_pacejet_amount",
    carrier: "custbody_rdt_pj_carrier_name",
    service: "custbody_rdt_pj_service_name",
    originKey: "custbody_rdt_pj_origin_key",
    transitDays: "custbody_rdt_pj_transit_days",
    estimatedArrivalDate: "custbody_rdt_pj_est_arrival_date",
    quoteJson: "custbody_rdt_pj_quote_json"
  };

  var state = PacejetState.get();

  function getRenderableRates(rates, source) {
    var list = Array.isArray(rates) ? rates : [];

    if (
      PacejetService &&
      typeof PacejetService.filterRatesBySelectedAccessorials === "function"
    ) {
      return PacejetService.filterRatesBySelectedAccessorials(
        list,
        normalizeAccessorialSelection(state.selection.accessorials),
        source || "checkout-render"
      );
    }

    return list;
  }

  function getSelectedAccessorialPayload() {
    var selection = normalizeAccessorialSelection(state.selection.accessorials);

    return {
      callPriorTruck: !!selection.driver_call,
      jobsite: !!selection.job_site,
      liftgateTruck: !!selection.lift_gate,
      residential: !!selection.residential,
      appointmentTruck: !!selection.schedule_appt,
      selfStorage: !!selection.self_storage,
      schoolDelivery: !!selection.school,
      insideDelivery: !!selection.inside_delivery,
      accessHazmatParcel: !!selection.hazmat_parcel,
      dangerousGoods: !!selection.dangerous_goods,
      noneAdditionalFeesMayApply: !!selection.none_additional_fees_may_app
    };
  }

  function asNumber(value, fallback) {
    var num = Number(value);
    return isFinite(num) ? num : fallback || 0;
  }

  function isConfirmationRoute() {
    return /confirmation/i.test(
      (typeof window !== "undefined" && window.location.hash) || ""
    );
  }

  function isReviewRoute() {
    return /review/i.test(
      (typeof window !== "undefined" && window.location.hash) || ""
    );
  }

  function normalizeOrigins(origins) {
    return Array.isArray(origins) ? origins : [];
  }

  function ensureArray(value) {
    return _.isArray(value) ? value : value == null ? [] : [value];
  }

  function getCustomFields(model) {
    return ensureArray(model.get("customfields") || model.get("customFields"));
  }

  function setCustomFields(model, fields) {
    model.set("customfields", fields);
    model.set("customFields", fields);
  }

  function upsertBodyField(model, id, value) {
    if (!model || !id) return;

    var fields = getCustomFields(model);
    var found = false;

    _.each(fields, function (field) {
      if (field && field.id === id) {
        field.value = value;
        found = true;
      }
    });

    if (!found) {
      fields.push({
        id: id,
        value: value
      });
    }

    setCustomFields(model, fields);
  }

  function stageSelectedPacejetFieldsOnOrder(order) {
    order = order || getOrderModel();
    if (!order || !order.get || !order.set) return;

    var selectedRate =
      PacejetState && PacejetState.getSelectedRate
        ? PacejetState.getSelectedRate()
        : null;

    if (!selectedRate) return;

    var amount =
      selectedRate.amount === null || selectedRate.amount === undefined
        ? ""
        : String(selectedRate.amount);

    var carrier = selectedRate.carrier || "";
    var service = selectedRate.service || "";
    var originKey = selectedRate.originKey || "";
    var transitDays =
      selectedRate.transitDays === null ||
      selectedRate.transitDays === undefined
        ? ""
        : String(selectedRate.transitDays);
    var estimatedArrivalDate = selectedRate.estimatedArrivalDate || "";
    var quoteJson = selectedRate.quoteJson || "";

    upsertBodyField(order, PACEJET_BODY_FIELDS.amount, amount);
    upsertBodyField(order, PACEJET_BODY_FIELDS.carrier, carrier);
    upsertBodyField(order, PACEJET_BODY_FIELDS.service, service);
    upsertBodyField(order, PACEJET_BODY_FIELDS.originKey, originKey);
    upsertBodyField(order, PACEJET_BODY_FIELDS.transitDays, transitDays);
    upsertBodyField(
      order,
      PACEJET_BODY_FIELDS.estimatedArrivalDate,
      estimatedArrivalDate
    );
    upsertBodyField(order, PACEJET_BODY_FIELDS.quoteJson, quoteJson);

    if (order.trigger) {
      order.trigger("change:customfields", order);
    }
  }

  function preparePacejetFieldsForPlaceOrder(order) {
    order = order || getOrderModel();
    if (!order || !order.get || !order.set) return;

    var selectedRate =
      PacejetState && PacejetState.getSelectedRate
        ? PacejetState.getSelectedRate()
        : null;

    var options = order.get("options") || {};

    var amount =
      selectedRate.amount === null || selectedRate.amount === undefined
        ? ""
        : String(selectedRate.amount);

    var carrier = selectedRate.carrier || "";
    var service = selectedRate.service || "";
    var originKey = selectedRate.originKey || "";
    var transitDays =
      selectedRate.transitDays === null ||
      selectedRate.transitDays === undefined
        ? ""
        : String(selectedRate.transitDays);
    var estimatedArrivalDate = selectedRate.estimatedArrivalDate || "";
    var quoteJson = selectedRate.quoteJson || "";

    upsertBodyField(order, PACEJET_BODY_FIELDS.amount, amount);
    upsertBodyField(order, PACEJET_BODY_FIELDS.carrier, carrier);
    upsertBodyField(order, PACEJET_BODY_FIELDS.service, service);
    upsertBodyField(order, PACEJET_BODY_FIELDS.originKey, originKey);
    upsertBodyField(order, PACEJET_BODY_FIELDS.transitDays, transitDays);
    upsertBodyField(
      order,
      PACEJET_BODY_FIELDS.estimatedArrivalDate,
      estimatedArrivalDate
    );
    upsertBodyField(order, PACEJET_BODY_FIELDS.quoteJson, quoteJson);

    options[PACEJET_BODY_FIELDS.amount] = amount;
    options[PACEJET_BODY_FIELDS.carrier] = carrier;
    options[PACEJET_BODY_FIELDS.service] = service;
    options[PACEJET_BODY_FIELDS.originKey] = originKey;
    options[PACEJET_BODY_FIELDS.transitDays] = transitDays;
    options[PACEJET_BODY_FIELDS.estimatedArrivalDate] = estimatedArrivalDate;
    options[PACEJET_BODY_FIELDS.quoteJson] = quoteJson;

    order.set("options", options);

    if (order.trigger) {
      order.trigger("change:customfields", order);
      order.trigger("change:options", order);
    }
  }

  function deriveOriginKey(payload) {
    return normalizeOrigins(payload && payload.origins)
      .map(function (origin) {
        return origin && origin.originKey ? String(origin.originKey) : "";
      })
      .filter(function (value) {
        return !!value;
      })
      .join("|");
  }

  function deriveEstimatedArrivalDate(payload) {
    if (
      payload &&
      payload.estimatedArrivalDate !== null &&
      payload.estimatedArrivalDate !== undefined &&
      payload.estimatedArrivalDate !== ""
    ) {
      return String(payload.estimatedArrivalDate);
    }

    if (
      payload &&
      payload.estDelivery !== null &&
      payload.estDelivery !== undefined &&
      payload.estDelivery !== ""
    ) {
      return String(payload.estDelivery);
    }

    return "";
  }

  function normalizeAccessorialSelection(accessorials) {
    return accessorials &&
      typeof accessorials === "object" &&
      !Array.isArray(accessorials)
      ? accessorials
      : {};
  }

  function normalizeAccessorialArray(accessorials) {
    return Array.isArray(accessorials) ? accessorials : [];
  }

  function buildAccessorialCustomFields(accessorialSelection) {
    var selection = normalizeAccessorialSelection(accessorialSelection);

    return [
      {
        id: NONE_ACCESSORIAL_FIELD_ID,
        value: selection[NONE_ACCESSORIAL_ID] ? "T" : "F"
      }
    ];
  }

  function asPlainArray(value) {
    if (!value) return [];

    if (_.isArray(value)) {
      return value;
    }

    if (value.models && _.isArray(value.models)) {
      return _.map(value.models, function (model) {
        return model && model.toJSON ? model.toJSON() : model;
      });
    }

    if (value.toJSON) {
      var json = value.toJSON();
      return _.isArray(json) ? json : [];
    }

    return [];
  }

  function fetchOrderSummary(order) {
    if (!order || !order.fetch) {
      return jQuery.Deferred().resolve(order).promise();
    }

    if (SUMMARY_FETCH_IN_FLIGHT) {
      return jQuery.Deferred().resolve(order).promise();
    }

    SUMMARY_FETCH_IN_FLIGHT = true;

    logSummarySnapshot(order, "before-followup-fetch");

    return order
      .fetch({
        reset: true,
        data: {
          t: Date.now(),
          fullsummary: true
        }
      })
      .then(function (resp) {
        logSummarySnapshot(order, "after-followup-fetch", {
          responseKeys: resp ? Object.keys(resp) : []
        });
        return resp;
      })
      .always(function () {
        SUMMARY_FETCH_IN_FLIGHT = false;
      });
  }

  function applyPacejetSelectionToCart(order, payload) {
    if (!order) {
      return jQuery
        .Deferred()
        .reject(new Error("LiveOrder model is unavailable"))
        .promise();
    }

    var shipmethodId = getShipmethodId(payload && payload.shipCode);
    var nativeSynced;

    if (!shipmethodId) {
      return jQuery
        .Deferred()
        .reject(new Error("shipmethod is required"))
        .promise();
    }

    logSummarySnapshot(order, "before-native-save", {
      selectedShipCode: shipmethodId,
      selectedCost: payload && payload.cost
    });

    order.set("shipmethod", shipmethodId);

    nativeSynced = syncNativeDeliveryOptionControl(shipmethodId);

    if (!nativeSynced) {
      return jQuery
        .Deferred()
        .reject(
          new Error(
            "Selected Pacejet shipmethod could not be synced to the native delivery selector: " +
              shipmethodId
          )
        )
        .promise();
    }

    return order.save().then(function () {
      var confirmedShipmethod = getConfirmedOrderShipmethod(order);

      logSummarySnapshot(order, "after-native-save", {
        selectedShipCode: shipmethodId,
        confirmedShipmethod: confirmedShipmethod
      });

      if (confirmedShipmethod !== shipmethodId) {
        return jQuery
          .Deferred()
          .reject(
            new Error(
              "Native save did not persist the selected shipmethod. Expected " +
                shipmethodId +
                " but found " +
                (confirmedShipmethod || "[blank]")
            )
          )
          .promise();
      }

      return fetchOrderSummary(order).then(function () {
        syncSelectionFromOrder(order);
        order.trigger("change:summary", order, order.get("summary"));

        if (PacejetSummary && PacejetSummary.renderSummaryUI) {
          PacejetSummary.renderSummaryUI(order);
        }

        return order;
      });
    });
  }

  function applyCarrierAccessorialRules(payload) {
    if (!payload) return;

    var carrier =
      payload.carrierCode || payload.carrier || payload.carrierName || "";

    var key = String(carrier).toUpperCase().replace(/\s+/g, "_");

    var allowed = AccessorialMatrix.carriers && AccessorialMatrix.carriers[key];

    if (allowed) {
      state.allowedAccessorials = allowed;

      if (PacejetUI && PacejetUI.updateAccessorials) {
        PacejetUI.updateAccessorials(allowed);
      }
    } else {
      console.warn("[Pacejet] No accessorial matrix match for key:", key);
    }

    return { key: key, allowed: allowed };
  }

  function getOrderModel() {
    try {
      return LiveOrderModel && LiveOrderModel.getInstance
        ? LiveOrderModel.getInstance()
        : null;
    } catch (_e) {
      return null;
    }
  }

  function logSummarySnapshot(order, stage, extra) {
    if (!order || !order.get) return;

    var summary = order.get("summary") || {};
    var snapshot = {
      stage: stage,
      shipmethod: order.get("shipmethod"),
      shippingCost:
        summary.shippingcost ||
        summary.shippingCost ||
        summary.estimatedshipping,
      taxtotal: summary.taxtotal,
      taxTotal: summary.taxTotal,
      tax: summary.tax,
      taxamount: summary.taxamount,
      total: summary.total || summary.totalAmount || summary.totalamount,
      subtotal: summary.subtotal,
      pacejetSelectedRate: PacejetState.getSelectedRate(),
      timestamp: new Date().toISOString()
    };

    if (extra) snapshot.extra = extra;
  }

  function clearSelectedRate(preservePersistence) {
    PacejetState.clearSelectedRate();
    if (!preservePersistence) {
      PacejetState.clearPersistenceResult();
    }
    state.selection.shipCode = null;
    state.selection.cost = null;
    state.selection.carrier = null;
    state.selection.service = null;
    state.selection.transitDays = null;
    state.selection.originKey = null;
    state.selection.estimatedArrivalDate = null;
    state.selection.origins = [];
  }

  function getShipmethodId(shipmethod) {
    if (shipmethod === undefined || shipmethod === null || shipmethod === "") {
      return "";
    }

    if (typeof shipmethod === "object") {
      return String(
        shipmethod.internalid ||
          shipmethod.internalId ||
          shipmethod.id ||
          shipmethod.shipmethod ||
          shipmethod.value ||
          ""
      );
    }

    return String(shipmethod);
  }

  function syncNativeDeliveryOptionControl(shipmethodId) {
    var normalizedId = getShipmethodId(shipmethodId);
    var synced = false;

    if (!normalizedId) {
      return false;
    }

    var $selects = $(
      ".order-wizard-shipmethod-module-option-select[data-action='select-delivery-option'], " +
        ".order-wizard-shipmethod-module-option-select"
    );

    if (!$selects.length) {
      console.warn(
        "[Pacejet] Native delivery select not found for shipmethod:",
        normalizedId
      );
      return false;
    }

    $selects.each(function () {
      var $select = $(this);
      var currentValue = getShipmethodId($select.val());

      if (currentValue === normalizedId) {
        synced = true;
        return;
      }

      if (!$select.find("option[value='" + normalizedId + "']").length) {
        console.warn(
          "[Pacejet] Native select does not contain shipmethod option:",
          normalizedId
        );
        return;
      }

      $select.val(normalizedId);
      $select.trigger("change");
      $select.trigger("blur");

      if (getShipmethodId($select.val()) === normalizedId) {
        synced = true;
      }
    });

    return synced;
  }

  function getConfirmedOrderShipmethod(order) {
    if (!order || !order.get) {
      return "";
    }

    return getShipmethodId(order.get("shipmethod"));
  }

  function hasSyncedPacejetSelection(order) {
    var selectedRate = PacejetState.getSelectedRate();
    var confirmedShipmethod = getConfirmedOrderShipmethod(order);
    var selectedShipmethod = selectedRate
      ? getShipmethodId(selectedRate.shipmethod)
      : "";

    return !!(
      selectedShipmethod &&
      confirmedShipmethod &&
      selectedShipmethod === confirmedShipmethod
    );
  }

  function shouldEnableContinue(order) {
    if (state.flags.selectionApplying) {
      return false;
    }

    if (isReviewRoute() || isConfirmationRoute()) {
      return hasSyncedPacejetSelection(order);
    }

    if (state.flags.ratesVisible || state.flags.ratesFetched) {
      return hasSyncedPacejetSelection(order);
    }

    return false;
  }

  function syncContinueStateFromOrder(order) {
    PacejetUI.setContinueButtonState(shouldEnableContinue(order));
  }

  function firstDefined() {
    var i;
    for (i = 0; i < arguments.length; i++) {
      if (
        arguments[i] !== undefined &&
        arguments[i] !== null &&
        arguments[i] !== ""
      ) {
        return arguments[i];
      }
    }
    return "";
  }

  function getCurrentProfile() {
    try {
      return (window.SC && window.SC.PROFILE) || null;
    } catch (_e) {
      return null;
    }
  }

  function getCustomerIdFromOrder(order) {
    var summaryProfile = null;
    var scProfile = null;
    var envProfile = null;
    var raw = "";

    if (!order || !order.get) return "";

    summaryProfile = order.get("profile") || {};
    scProfile = (window.SC && window.SC.PROFILE) || {};
    envProfile =
      (window.SC && window.SC.ENVIRONMENT && window.SC.ENVIRONMENT.PROFILE) ||
      {};

    raw = firstDefined(
      summaryProfile.internalid,
      summaryProfile.internalId,
      scProfile.internalid,
      scProfile.internalId,
      envProfile.internalid,
      envProfile.internalId,
      order.get("customer"),
      order.get("customerId"),
      order.get("entity"),
      ""
    );

    raw = String(raw || "").trim();

    return /^\d+$/.test(raw) ? raw : "";
  }

  function normalizeOrderAddress(address) {
    address = address || {};

    return {
      country: firstDefined(
        address.country && address.country.code,
        address.country,
        ""
      ),
      state: firstDefined(address.state, address.stateCode, ""),
      city: firstDefined(address.city, ""),
      zip: firstDefined(address.zip, address.zipcode, ""),
      addr1: firstDefined(address.addr1, address.address1, ""),
      addr2: firstDefined(address.addr2, address.address2, ""),
      attention: firstDefined(address.attention, ""),
      addressee: firstDefined(
        address.addressee,
        address.fullname,
        address.name,
        ""
      ),
      phone: firstDefined(address.phone, address.addrphone, "")
    };
  }

  function getShippingAddressFromOrder(order) {
    var shipaddress = (order && order.get && order.get("shipaddress")) || {};
    var addresses = asPlainArray(order && order.get && order.get("addresses"));
    var shipaddressId = "";
    var found = null;

    if (
      shipaddress &&
      typeof shipaddress === "object" &&
      (shipaddress.zip || shipaddress.country)
    ) {
      return normalizeOrderAddress(shipaddress);
    }

    if (shipaddress && typeof shipaddress === "object") {
      shipaddressId = firstDefined(
        shipaddress.internalid,
        shipaddress.internalId,
        shipaddress.id,
        ""
      );
    } else {
      shipaddressId = String(shipaddress || "").trim();
    }

    if (shipaddressId) {
      found = _.find(addresses, function (addr) {
        return (
          String(
            firstDefined(addr.internalid, addr.internalId, addr.id, "")
          ) === String(shipaddressId)
        );
      });
    }

    if (found) {
      return normalizeOrderAddress(found);
    }

    return {
      country: "",
      state: "",
      city: "",
      zip: "",
      addr1: "",
      addr2: "",
      attention: "",
      addressee: "",
      phone: ""
    };
  }

  function buildPreviewLines(order) {
    var lines = asPlainArray(order && order.get && order.get("lines"));

    return _.chain(lines)
      .map(function (line) {
        var item = line && line.item ? line.item : {};
        var itemId = firstDefined(
          item.internalid,
          item.internalId,
          item.id,
          line.itemId,
          line.internalid,
          ""
        );
        var quantity = asNumber(firstDefined(line.quantity, line.qty, 0), 0);
        var amount = asNumber(firstDefined(line.amount, line.rate, 0), 0);

        if (!/^\d+$/.test(String(itemId || "")) || quantity <= 0) {
          return null;
        }

        return {
          itemId: String(itemId),
          quantity: quantity,
          amount: amount
        };
      })
      .filter(function (line) {
        return !!line;
      })
      .value();
  }

  function buildPreviewTotals(order, selectedShippingAmount) {
    var summary = (order && order.get && order.get("summary")) || {};

    return {
      subtotal: asNumber(
        firstDefined(summary.discountedsubtotal, summary.subtotal, 0),
        0
      ),
      shipping: asNumber(
        firstDefined(
          selectedShippingAmount,
          summary.shippingcost,
          summary.shippingCost,
          summary.estimatedshipping,
          0
        ),
        0
      ),
      tax: asNumber(
        firstDefined(
          summary.taxtotal,
          summary.taxTotal,
          summary.taxamount,
          summary.tax,
          0
        ),
        0
      ),
      total: asNumber(
        firstDefined(
          summary.total,
          summary.totalAmount,
          summary.totalamount,
          0
        ),
        0
      )
    };
  }

  function buildPreviewPayload(
    order,
    payload,
    selectedAccessorials,
    originKey,
    estimatedArrivalDate,
    quoteJson
  ) {
    return {
      customerId: getCustomerIdFromOrder(order),
      shipmethod: payload.shipCode,
      pacejetAmount: asNumber(payload.cost, 0),
      carrier: payload.carrier || "",
      service: payload.service || "",
      transitDays: payload.transitDays,
      originKey: originKey,
      estimatedArrivalDate: estimatedArrivalDate,
      quoteJson: quoteJson,
      locationId: "",
      shippingAddress: getShippingAddressFromOrder(order),
      lines: buildPreviewLines(order),
      totals: buildPreviewTotals(order, payload.cost),
      callPriorTruck: !!selectedAccessorials.callPriorTruck,
      jobsite: !!selectedAccessorials.jobsite,
      liftgateTruck: !!selectedAccessorials.liftgateTruck,
      residential: !!selectedAccessorials.residential,
      appointmentTruck: !!selectedAccessorials.appointmentTruck,
      selfStorage: !!selectedAccessorials.selfStorage,
      schoolDelivery: !!selectedAccessorials.schoolDelivery,
      insideDelivery: !!selectedAccessorials.insideDelivery,
      accessHazmatParcel: !!selectedAccessorials.accessHazmatParcel,
      dangerousGoods: !!selectedAccessorials.dangerousGoods,
      noneAdditionalFeesMayApply:
        !!selectedAccessorials.noneAdditionalFeesMayApply
    };
  }

  function syncPreviewTotalsToState(order, payload, response) {
    if (!(response && response.ok && response.totals)) {
      return;
    }

    PacejetState.setPersistenceResult({
      saved: true,
      orderId: "preview",
      shipmethod: payload.shipCode,
      pacejetAmount: payload.cost,
      carrier: payload.carrier,
      service: payload.service,
      transitDays: payload.transitDays,
      totals: {
        subtotal: Number(response.totals.subtotal || 0),
        baseSubtotal: Number(
          response.totals.baseSubtotal || response.totals.subtotal || 0
        ),
        adjustedSubtotal: Number(
          response.totals.adjustedSubtotal || response.totals.subtotal || 0
        ),
        surcharge: Number(response.totals.surcharge || 0),
        shipping: Number(response.totals.shipping || 0),
        tax: Number(response.totals.tax || 0),
        total: Number(response.totals.total || 0),
        effectiveTaxRate: response.totals.effectiveTaxRate || null,
        taxIncludesAll: response.totals.taxIncludesAll || false
      }
    });

    if (PacejetSummary && PacejetSummary.renderSummaryUI) {
      PacejetSummary.renderSummaryUI(order);
    }
  }

  function requestPreviewTotals(
    order,
    payload,
    originKey,
    estimatedArrivalDate,
    quoteJson
  ) {
    var selectedAccessorials = getSelectedAccessorialPayload();
    var previewPayload = buildPreviewPayload(
      order,
      payload,
      selectedAccessorials,
      originKey,
      estimatedArrivalDate,
      quoteJson
    );

    console.log("[Pacejet] preview payload", previewPayload);

    return $.ajax({
      url: SUMMARY_PREVIEW_URL,
      type: "POST",
      contentType: "application/json",
      dataType: "json",
      data: JSON.stringify(previewPayload)
    });
  }

  function syncSelectionFromOrder(order) {
    var selectedRate;
    var preservePersistence = isConfirmationRoute();
    var selectedRateShipmethodId;
    if (!order || !order.get) return;

    selectedRate = PacejetState.getSelectedRate();
    selectedRateShipmethodId = selectedRate
      ? getShipmethodId(selectedRate.shipmethod)
      : "";

    var shipmethodId = getShipmethodId(order.get("shipmethod"));
    if (!shipmethodId) {
      clearSelectedRate(preservePersistence);
      return;
    }

    state.selection.shipCode = shipmethodId;

    if (!selectedRate || selectedRateShipmethodId !== shipmethodId) {
      if (state.flags.suppressRefresh && selectedRateShipmethodId) {
        state.selection.shipCode = selectedRateShipmethodId;
        state.selection.cost = asNumber(selectedRate.amount, 0);
        state.selection.carrier = selectedRate.carrier || null;
        state.selection.service = selectedRate.service || null;
        state.selection.transitDays = selectedRate.transitDays || null;
        state.selection.originKey = selectedRate.originKey || null;
        state.selection.estimatedArrivalDate =
          selectedRate.estimatedArrivalDate || null;
        state.selection.origins = normalizeOrigins(selectedRate.origins);
        return;
      }

      clearSelectedRate(preservePersistence);
      return;
    }

    state.selection.cost = asNumber(selectedRate.amount, 0);
    state.selection.carrier = selectedRate.carrier || null;
    state.selection.service = selectedRate.service || null;
    state.selection.transitDays = selectedRate.transitDays || null;
    state.selection.originKey = selectedRate.originKey || null;
    state.selection.estimatedArrivalDate =
      selectedRate.estimatedArrivalDate || null;
    state.selection.origins = normalizeOrigins(selectedRate.origins);
  }

  function syncRouteUi(order) {
    if (!order) return;

    syncSelectionFromOrder(order);
    syncNativeDeliveryOptionControl(state.selection.shipCode);
    syncContinueStateFromOrder(order);

    if (PacejetSummary && PacejetSummary.renderSummaryUI) {
      PacejetSummary.renderSummaryUI(order);
    }

    if (PacejetUI && PacejetUI.renderReviewSelection) {
      PacejetUI.renderReviewSelection(order, state);
    }
  }

  function waitForReviewHostThenRender(order) {
    var tries = 0;
    var maxTries = 30;

    if (!isReviewRoute()) {
      if (REVIEW_SYNC_TIMER) {
        clearInterval(REVIEW_SYNC_TIMER);
        REVIEW_SYNC_TIMER = null;
      }
      return;
    }

    if (REVIEW_SYNC_TIMER) {
      clearInterval(REVIEW_SYNC_TIMER);
      REVIEW_SYNC_TIMER = null;
    }

    REVIEW_SYNC_TIMER = setInterval(function () {
      var $host = $(
        ".order-wizard-showshipments-module-shipping-details-method, " +
          ".order-wizard-showshipments-actionable-module-shipping-details-method"
      ).first();

      if ($host.length) {
        clearInterval(REVIEW_SYNC_TIMER);
        REVIEW_SYNC_TIMER = null;

        if (PacejetUI && PacejetUI.renderReviewSelection) {
          PacejetUI.renderReviewSelection(order, state);
        }
        return;
      }

      tries += 1;
      if (tries >= maxTries) {
        clearInterval(REVIEW_SYNC_TIMER);
        REVIEW_SYNC_TIMER = null;
      }
    }, 150);
  }

  function ensureModelWired(order) {
    if (!order || MODEL_WIRED) {
      return;
    }

    MODEL_WIRED = true;
    order.on("change:shipaddress change:lines", onOrderContextChanged);
    order.on("change:shipmethod", onShipmethodChanged);
  }

  PacejetUI.onSelect(function (payload) {
    if (!payload) return;

    var order = getOrderModel();
    if (!order) return;

    /* ===============================
     * ACCESSORIAL EDIT (NO RERATE)
     * =============================== */
    if (payload.accessorials) {
      var normalizedAccessorials = normalizeAccessorialSelection(
        payload.accessorials
      );

      PacejetState.setAccessorials(normalizedAccessorials);
      state.flags.accessorialsDirty = true;
      clearSelectedRate();
      PacejetUI.setContinueButtonState(false);
      return;
    }

    /* ===============================
     * SHOW / UPDATE RATES
     * =============================== */
    if (payload.showRates === true) {
      state.flags.ratesVisible = true;
      state.flags.accessorialsDirty = false;
      refreshFromOrder(order, { mode: "hard", forceShowRates: true });
      return;
    }

    /* ===============================
     * RATE SELECTION
     * =============================== */
    if (!payload.shipCode) return;

    applyCarrierAccessorialRules(payload);

    var originKey = deriveOriginKey(payload);
    var estimatedArrivalDate = deriveEstimatedArrivalDate(payload);
    var quoteJson = JSON.stringify({
      shipmethod: payload.shipCode,
      amount: asNumber(payload.cost, 0),
      carrier: payload.carrier || "",
      service: payload.service || "",
      transitDays: payload.transitDays,
      originKey: originKey,
      estimatedArrivalDate: estimatedArrivalDate,
      origins: normalizeOrigins(payload.origins)
    });

    PacejetState.setSelectedRate({
      shipmethod: payload.shipCode,
      amount: asNumber(payload.cost, 0),
      carrier: payload.carrier || "",
      service: payload.service || "",
      transitDays:
        payload.transitDays === null || payload.transitDays === undefined
          ? ""
          : payload.transitDays,
      originKey: originKey,
      estimatedArrivalDate: estimatedArrivalDate,
      origins: normalizeOrigins(payload.origins),
      quoteJson: quoteJson
    });

    stageSelectedPacejetFieldsOnOrder(order);

    state.selection.shipCode = payload.shipCode;
    state.selection.cost = payload.cost;
    state.selection.carrier = payload.carrier;
    state.selection.service = payload.service;
    state.selection.transitDays = payload.transitDays;
    state.selection.originKey = originKey;
    state.selection.estimatedArrivalDate = estimatedArrivalDate;
    state.selection.origins = normalizeOrigins(payload.origins);
    PacejetState.clearPersistenceResult();

    var applyToken = ++SELECTION_APPLY_TOKEN;

    state.flags.suppressRefresh = true;
    state.flags.ratesVisible = true;
    state.flags.selectionApplying = true;
    PacejetUI.setContinueButtonState(false);

    logSummarySnapshot(order, "before-apply", {
      selectedShipCode: payload.shipCode,
      selectedCost: payload.cost
    });

    if (window.ShippingAppliedFlag !== undefined) {
      window.ShippingAppliedFlag = false;
    }

    PacejetState.setPersistencePending(true);
    if (PacejetSummary && PacejetSummary.renderSummaryUI) {
      PacejetSummary.renderSummaryUI(order);
    }

    applyPacejetSelectionToCart(order, {
      shipCode: payload.shipCode,
      cost: payload.cost || 0,
      carrier: payload.carrier || "",
      service: payload.service || "",
      transitDays: payload.transitDays,
      originKey: originKey,
      estimatedArrivalDate: estimatedArrivalDate,
      origins: normalizeOrigins(payload.origins),
      customfields: buildAccessorialCustomFields(state.selection.accessorials),
      accessorials: normalizeAccessorialArray(payload.accessorials),
      accessorialSelection: normalizeAccessorialSelection(
        state.selection.accessorials
      ),
      quoteJson: quoteJson
    })
      .then(function () {
        if (applyToken !== SELECTION_APPLY_TOKEN) return;

        state.flags.selectionApplying = false;

        requestPreviewTotals(
          order,
          payload,
          originKey,
          estimatedArrivalDate,
          quoteJson
        )
          .done(function (response) {
            syncPreviewTotalsToState(order, payload, response);
          })
          .fail(function (err) {})
          .always(function () {
            PacejetState.setPersistencePending(false);
            if (PacejetSummary && PacejetSummary.renderSummaryUI) {
              PacejetSummary.renderSummaryUI(order);
            }
            syncContinueStateFromOrder(order);
            waitForHostThenRefresh(order);
          });
      })
      .fail(function (err) {
        if (applyToken !== SELECTION_APPLY_TOKEN) return;
        state.flags.selectionApplying = false;
        PacejetState.setPersistencePending(false);
        clearSelectedRate();
        if (PacejetSummary && PacejetSummary.renderSummaryUI) {
          PacejetSummary.renderSummaryUI(order);
        }
        syncContinueStateFromOrder(order);
        console.error(
          "[Pacejet] LiveOrder error",
          err && err.responseText ? err.responseText : err
        );
      })
      .always(function () {
        if (applyToken !== SELECTION_APPLY_TOKEN) return;
        state.flags.suppressRefresh = false;
      });
  });

  function refreshFromOrder(order, opts) {
    opts = opts || {};
    var softRefresh = opts.mode === "soft";
    var forceShowRates = opts.forceShowRates === true;

    var $host = $(".order-wizard-shipmethod-module").first();
    if (!$host.length) return;

    if (forceShowRates) {
      state.flags.ratesVisible = true;
    }

    if (
      PacejetService &&
      typeof PacejetService.syncForcedAccessorialsFromOrder === "function"
    ) {
      PacejetService.syncForcedAccessorialsFromOrder(order);
    }

    if (!state.flags.ratesVisible) {
      PacejetUI.render(
        $host,
        getRenderableRates(state.cache.lastRates || [], "hidden-render-cache"),
        state,
        {
          deferClear: softRefresh,
          showRates: false,
          loading: false,
          continueEnabled: shouldEnableContinue(order)
        }
      );
      syncContinueStateFromOrder(order);
      $host.css("min-height", "");
      return;
    }

    state.flags.ratesLoading = true;
    PacejetUI.setContinueButtonState(shouldEnableContinue(order));

    var hostHeight = 0;
    if (softRefresh) {
      hostHeight = Number($host.outerHeight()) || 0;
      if (hostHeight > 0) {
        $host.css("min-height", hostHeight + "px");
      }
    } else {
      if (state.flags.ratesVisible) {
        document.body.classList.add("rdt-pj-prehide");
        PacejetUI.clear($host);
        PacejetUI.showLoading($host);
      } else {
        PacejetUI.render(
          $host,
          getRenderableRates(
            state.cache.lastRates || [],
            "loading-render-cache"
          ),
          state,
          {
            showRates: false,
            loading: true
          }
        );
      }
    }

    PacejetService.fetchRates(order)
      .then(function (rates) {
        var renderableRates = getRenderableRates(rates, "fetch-success-render");
        state.flags.ratesLoading = false;
        state.flags.ratesFetched = true;
        syncSelectionFromOrder(order);
        PacejetUI.render($host, renderableRates, state, {
          deferClear: softRefresh,
          showRates: !!state.flags.ratesVisible
        });

        if (state.allowedAccessorials) {
          PacejetUI.updateAccessorials(state.allowedAccessorials);
        }

        if (!softRefresh) {
          document.body.classList.remove("rdt-pj-prehide");
        }

        $host.css("min-height", "");
      })
      .fail(function () {
        state.flags.ratesLoading = false;
        if (!softRefresh) {
          document.body.classList.remove("rdt-pj-prehide");
        }

        $host.css("min-height", "");

        $(".order-wizard-shipmethod-module-option-select")
          .removeClass("rdt-pj-native-hidden")
          .attr("aria-hidden", "false");
      });
  }

  function scheduleRefresh(order, mode) {
    if (REFRESH_TIMER) clearTimeout(REFRESH_TIMER);

    REFRESH_TIMER = setTimeout(function () {
      refreshFromOrder(order, { mode: mode || "soft" });
    }, 400);
  }

  function onOrderContextChanged() {
    var order = getOrderModel();
    if (!order) return;

    syncRouteUi(order);

    if (state.flags.suppressRefresh) return;

    scheduleRefresh(order, "soft");
  }

  function onShipmethodChanged() {
    var order = getOrderModel();
    if (!order) return;

    syncRouteUi(order);

    if (state.flags.suppressRefresh) return;

    scheduleRefresh(order, "soft");
  }

  function waitForHostThenRefresh(order) {
    var tries = 0;
    var maxTries = 30;

    var timer = setInterval(function () {
      var $host = $(".order-wizard-shipmethod-module").first();

      if ($host.length) {
        clearInterval(timer);
        syncSelectionFromOrder(order);
        if (state.flags.ratesVisible) {
          refreshFromOrder(order, { mode: "hard" });
        } else {
          PacejetUI.render(
            $host,
            getRenderableRates(state.cache.lastRates || [], "wait-host-cache"),
            state,
            {
              showRates: false,
              loading: false,
              continueEnabled: shouldEnableContinue(order)
            }
          );
          PacejetUI.setContinueButtonState(shouldEnableContinue(order));
        }
        return;
      }

      tries++;
      if (tries >= maxTries) clearInterval(timer);
    }, 150);
  }

  function runOnShippingStep() {
    var order = getOrderModel();
    if (!order) return;

    ensureModelWired(order);
    syncRouteUi(order);

    if (!INITIAL_FETCH_DONE) {
      INITIAL_FETCH_DONE = true;
      order
        .fetch({
          reset: true,
          data: {
            t: Date.now(),
            fullsummary: true
          }
        })
        .always(function () {
          waitForHostThenRefresh(order);
        });
    } else {
      waitForHostThenRefresh(order);
    }
  }

  function wireBeforePlaceOrder(application) {
    var checkout =
      application && application.getComponent
        ? application.getComponent("Checkout")
        : null;

    if (!checkout || !checkout.on) return;

    checkout.on("beforePlaceOrder", function () {
      var order = getOrderModel();
      if (!order) return;

      preparePacejetFieldsForPlaceOrder(order);
    });
  }

  return {
    mountToApp: function (application) {
      wireBeforePlaceOrder(application);
    },

    run: runOnShippingStep,

    syncCurrentRoute: function () {
      var order = getOrderModel();
      if (!order) return;

      ensureModelWired(order);
      syncRouteUi(order);
      waitForReviewHostThenRender(order);
    }
  };
});
