/// <amd-module name="RDT.Pacejet.Summary"/>

define("RDT.Pacejet.Summary", [
  "jQuery",
  "RDT.Pacejet.State",
  "LiveOrder.Model"
], function (jQuery, PacejetState, LiveOrderModel) {
  "use strict";

  var $ = jQuery;
  var SUMMARY_REPAINT_TIMER = null;
  var SUMMARY_OVERRIDE_MOUNTED = false;
  var SUMMARY_OVERRIDE_FLAG = "_rdtPacejetSummaryApplied";
  var SUMMARY_OVERRIDE_SHIPPING_KEY = "_rdtPacejetSummaryShipping";

  // --------------------------------------------
  // Helpers
  // --------------------------------------------
  function num(v) {
    return Number(String(v || "").replace(/[^0-9.\-]/g, "")) || 0;
  }

  function asNumber(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback || 0;
  }

  function cloneObject(source) {
    var key;
    var copy = {};
    var data = source && typeof source === "object" ? source : {};

    for (key in data) {
      if (data.hasOwnProperty(key)) {
        copy[key] = data[key];
      }
    }

    return copy;
  }

  function getShipmethodId(shipmethod) {
    if (shipmethod === null || shipmethod === undefined || shipmethod === "") {
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

  function fmtMoney(n) {
    var v = Number(n || 0);
    if (!isFinite(v)) v = 0;
    try {
      return v.toLocaleString(undefined, {
        style: "currency",
        currency: "USD"
      });
    } catch (_) {
      return "$" + v.toFixed(2);
    }
  }

  function isConfirmationPage() {
    return /confirmation/i.test(
      (typeof window !== "undefined" && window.location.hash) || ""
    );
  }

  // --------------------------------------------
  // Read helpers
  // --------------------------------------------
  function getOrderSummaryRecord(order) {
    var summary;
    var confirmation;
    var confirmationSummary;

    if (!order || !order.get) {
      return {};
    }

    summary = cloneObject(order.get("summary") || {});
    confirmation = order.get("confirmation") || {};
    confirmationSummary =
      confirmation && typeof confirmation.summary === "object"
        ? confirmation.summary
        : null;

    if (!confirmationSummary) {
      return summary;
    }

    if (
      confirmationSummary.subtotal !== undefined &&
      confirmationSummary.subtotal !== null
    ) {
      summary.subtotal = confirmationSummary.subtotal;
      summary.subtotal_formatted = confirmationSummary.subtotal_formatted;
    }

    if (
      confirmationSummary.taxtotal !== undefined &&
      confirmationSummary.taxtotal !== null
    ) {
      summary.taxtotal = confirmationSummary.taxtotal;
      summary.taxTotal = confirmationSummary.taxtotal;
      summary.tax = confirmationSummary.taxtotal;
      summary.taxamount = confirmationSummary.taxtotal;
      summary.taxAmount = confirmationSummary.taxtotal;
      summary.taxtotal_formatted = confirmationSummary.taxtotal_formatted;
    }

    if (
      confirmationSummary.total !== undefined &&
      confirmationSummary.total !== null
    ) {
      summary.total = confirmationSummary.total;
      summary.totalamount = confirmationSummary.total;
      summary.totalAmount = confirmationSummary.total;
      summary.order_total = confirmationSummary.total;
      summary.total_formatted = confirmationSummary.total_formatted;
    }

    if (
      !summary.shippingcost &&
      !summary.shippingCost &&
      !summary.shipping &&
      confirmationSummary.shippingcost !== undefined &&
      confirmationSummary.shippingcost !== null
    ) {
      summary.shippingcost = confirmationSummary.shippingcost;
      summary.shippingCost = confirmationSummary.shippingcost;
      summary.shipping = confirmationSummary.shippingcost;
      summary.estimatedshipping = confirmationSummary.shippingcost;
      summary.shippingcost_formatted =
        confirmationSummary.shippingcost_formatted;
    }

    return summary;
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

  function hasSummaryValue(summary, keys) {
    var i;

    if (!summary || !keys || !keys.length) {
      return false;
    }

    for (i = 0; i < keys.length; i += 1) {
      if (summary[keys[i]] !== undefined && summary[keys[i]] !== null) {
        return true;
      }
    }

    return false;
  }

  function getFieldValue(field) {
    if (!field || typeof field !== "object") {
      return "";
    }

    if (
      field.value !== undefined &&
      field.value !== null &&
      field.value !== ""
    ) {
      return field.value;
    }

    if (
      field.internalid !== undefined &&
      field.internalid !== null &&
      field.internalid !== ""
    ) {
      return field.internalid;
    }

    if (
      field.internalId !== undefined &&
      field.internalId !== null &&
      field.internalId !== ""
    ) {
      return field.internalId;
    }

    return "";
  }

  function getFieldId(field) {
    if (!field || typeof field !== "object") {
      return "";
    }

    return String(
      field.id || field.name || field.fieldid || field.fieldId || ""
    );
  }

  function findFieldValueInRaw(raw, fieldId, depth, seen) {
    var lists;
    var list;
    var i;
    var j;
    var nested;
    var candidateId;

    if (!raw || !fieldId || depth > 4) {
      return "";
    }

    if (seen.indexOf(raw) !== -1) {
      return "";
    }

    seen.push(raw);

    if (
      Object.prototype.hasOwnProperty.call(raw, fieldId) &&
      raw[fieldId] !== undefined &&
      raw[fieldId] !== null &&
      raw[fieldId] !== ""
    ) {
      return raw[fieldId];
    }

    lists = [
      raw.customFields,
      raw.customfields,
      raw.options,
      raw.bodyFields,
      raw.bodyfields,
      raw.fields,
      raw.itemoptions_detail && raw.itemoptions_detail.fields,
      raw.itemoptions && raw.itemoptions.fields
    ];

    for (i = 0; i < lists.length; i += 1) {
      list = lists[i];

      if (Array.isArray(list)) {
        for (j = 0; j < list.length; j += 1) {
          candidateId = getFieldId(list[j]);
          if (candidateId === fieldId) {
            nested = getFieldValue(list[j]);
            if (nested !== "" || nested === 0) {
              return nested;
            }
          }
        }
      } else if (
        list &&
        typeof list === "object" &&
        Object.prototype.hasOwnProperty.call(list, fieldId)
      ) {
        return list[fieldId];
      }
    }

    for (i = 0; i < Object.keys(raw).length; i += 1) {
      nested = raw[Object.keys(raw)[i]];
      if (!nested || typeof nested !== "object") {
        continue;
      }

      nested = findFieldValueInRaw(nested, fieldId, depth + 1, seen);
      if (nested !== "" || nested === 0) {
        return nested;
      }
    }

    return "";
  }

  function getDeepOrderFieldValue(order, fieldId) {
    var directValue;
    var raw;

    if (!order || !fieldId) {
      return "";
    }

    if (order.get) {
      directValue = order.get(fieldId);
      if (
        directValue !== undefined &&
        directValue !== null &&
        directValue !== ""
      ) {
        return directValue;
      }
    }

    raw = (order.toJSON && order.toJSON()) || order.attributes || order;
    return findFieldValueInRaw(raw, fieldId, 0, []);
  }

  function getSelectedRateForOrder(order) {
    var selectedRate = PacejetState.getSelectedRate
      ? PacejetState.getSelectedRate()
      : null;
    var currentShipmethod = getShipmethodId(
      order && typeof order.get === "function" ? order.get("shipmethod") : ""
    );

    if (
      !selectedRate ||
      !selectedRate.shipmethod ||
      getShipmethodId(selectedRate.shipmethod) !== currentShipmethod
    ) {
      return null;
    }

    return selectedRate;
  }

  function getPersistedStateSummaryForOrder(order) {
    var persistence = PacejetState.getPersistenceResult
      ? PacejetState.getPersistenceResult()
      : null;
    var currentShipmethod = getShipmethodId(
      order && typeof order.get === "function" ? order.get("shipmethod") : ""
    );
    var currentConfirmationId = getOrderConfirmationId(order);
    var persistedOrderId =
      persistence &&
      persistence.orderId !== undefined &&
      persistence.orderId !== null
        ? String(persistence.orderId)
        : "";
    var shipmethodMatches =
      !!persistence &&
      !!persistence.shipmethod &&
      getShipmethodId(persistence.shipmethod) === currentShipmethod;
    var confirmationMatches =
      !!currentConfirmationId &&
      !!persistedOrderId &&
      currentConfirmationId === persistedOrderId;

    if (!persistence || !persistence.saved || !persistence.totals) {
      return null;
    }

    if (!shipmethodMatches && !confirmationMatches) {
      return null;
    }

    return cloneObject(persistence.totals);
  }

  function getOrderConfirmationId(order) {
    var confirmation;
    var candidate;

    if (!order || !order.get) {
      return "";
    }

    confirmation = order.get("confirmation") || {};
    candidate =
      confirmation.internalid ||
      confirmation.order_id ||
      confirmation.recordid ||
      confirmation.id ||
      order.get("internalid") ||
      "";

    return candidate ? String(candidate) : "";
  }

  function getResolvedShippingAmount(order, sourceSummary) {
    var persistedAmount = getPacejetShippingOverride(order);
    var selectedRate = getSelectedRateForOrder(order);
    var nativeShipping = asNumber(
      getSummaryValue(sourceSummary || {}, [
        "shipping",
        "shippingcost",
        "shippingCost",
        "estimatedshipping"
      ]),
      0
    );

    if (persistedAmount !== null) {
      return {
        amount: persistedAmount,
        source: "persisted"
      };
    }

    if (
      selectedRate &&
      selectedRate.amount !== undefined &&
      selectedRate.amount !== null
    ) {
      return {
        amount: asNumber(selectedRate.amount, nativeShipping),
        source: "selectedRate"
      };
    }

    return {
      amount: nativeShipping,
      source: "native"
    };
  }

  function hasRenderableValues(data) {
    if (!data) {
      return false;
    }

    return !!(data.subtotal || data.shipping || data.tax || data.total);
  }

  function buildOverriddenSummary(order, sourceSummary) {
    var summary = cloneObject(sourceSummary);
    var authoritativeSummary = getPersistedStateSummaryForOrder(order);
    var resolvedShipping = getResolvedShippingAmount(order, summary);
    var subtotal;
    var nativeTax;
    var shipping;
    var taxTotal;
    var total;
    var subtotalKeys = ["subtotal"];
    var shippingKeys = [
      "shipping",
      "shippingcost",
      "shippingCost",
      "estimatedshipping"
    ];
    var taxKeys = ["taxtotal", "taxTotal", "tax", "taxamount", "taxAmount"];
    var totalKeys = ["total", "totalamount", "totalAmount", "order_total"];

    if (authoritativeSummary) {
      shipping = hasSummaryValue(authoritativeSummary, shippingKeys)
        ? asNumber(getSummaryValue(authoritativeSummary, shippingKeys), 0)
        : asNumber(resolvedShipping.amount, 0);
      subtotal = hasSummaryValue(authoritativeSummary, subtotalKeys)
        ? asNumber(getSummaryValue(authoritativeSummary, subtotalKeys), 0)
        : asNumber(getSummaryValue(summary, subtotalKeys), 0);
      taxTotal = hasSummaryValue(authoritativeSummary, taxKeys)
        ? asNumber(getSummaryValue(authoritativeSummary, taxKeys), 0)
        : asNumber(getSummaryValue(summary, taxKeys), 0);
      total = hasSummaryValue(authoritativeSummary, totalKeys)
        ? asNumber(getSummaryValue(authoritativeSummary, totalKeys), 0)
        : +(subtotal + shipping + taxTotal).toFixed(2);

      summary.shipping = shipping;
      summary.shippingcost = shipping;
      summary.shippingCost = shipping;
      summary.estimatedshipping = shipping;
      summary.tax = taxTotal;
      summary.taxtotal = taxTotal;
      summary.taxTotal = taxTotal;
      summary.taxamount = taxTotal;
      summary.taxAmount = taxTotal;
      summary.total = total;
      summary.totalamount = total;
      summary.totalAmount = total;
      summary.order_total = total;
      summary.subtotal = subtotal;
      summary[SUMMARY_OVERRIDE_FLAG] = true;
      summary[SUMMARY_OVERRIDE_SHIPPING_KEY] = summary.shipping;
      return summary;
    }

    if (!resolvedShipping || resolvedShipping.source === "native") {
      return summary;
    }

    if (
      asNumber(getSummaryValue(summary, shippingKeys), 0) ===
      asNumber(resolvedShipping.amount, 0)
    ) {
      return summary;
    }

    if (
      summary[SUMMARY_OVERRIDE_FLAG] &&
      asNumber(summary[SUMMARY_OVERRIDE_SHIPPING_KEY], null) ===
        asNumber(resolvedShipping.amount, 0)
    ) {
      return summary;
    }

    subtotal = asNumber(getSummaryValue(summary, subtotalKeys), 0);
    nativeTax = asNumber(getSummaryValue(summary, taxKeys), 0);
    shipping = asNumber(resolvedShipping.amount, 0);
    taxTotal = +nativeTax.toFixed(2);
    total = +(subtotal + shipping + taxTotal).toFixed(2);

    summary.shipping = shipping;
    summary.shippingcost = shipping;
    summary.shippingCost = shipping;
    summary.estimatedshipping = shipping;
    summary.handlingcost = 0;
    summary.handlingCost = 0;
    summary.showHandlingCost = false;
    summary.handlingcost_formatted = "";
    summary.handlingCost_formatted = "";
    summary.tax = taxTotal;
    summary.taxtotal = taxTotal;
    summary.taxTotal = taxTotal;
    summary.taxamount = taxTotal;
    summary.taxAmount = taxTotal;
    summary.total = total;
    summary.totalamount = total;
    summary.totalAmount = total;
    summary.order_total = total;
    summary[SUMMARY_OVERRIDE_FLAG] = true;
    summary[SUMMARY_OVERRIDE_SHIPPING_KEY] = shipping;

    return summary;
  }

  function getPatchTarget() {
    var instance;

    try {
      instance =
        LiveOrderModel && typeof LiveOrderModel.getInstance === "function"
          ? LiveOrderModel.getInstance()
          : null;
    } catch (_e) {
      instance = null;
    }

    if (
      instance &&
      instance.constructor &&
      instance.constructor.prototype &&
      typeof instance.constructor.prototype.get === "function"
    ) {
      return instance.constructor.prototype;
    }

    if (
      LiveOrderModel &&
      LiveOrderModel.prototype &&
      typeof LiveOrderModel.prototype.get === "function"
    ) {
      return LiveOrderModel.prototype;
    }

    return instance && typeof instance.get === "function" ? instance : null;
  }

  function mountToApp() {
    var target;
    var originalGet;

    if (SUMMARY_OVERRIDE_MOUNTED) {
      return;
    }

    target = getPatchTarget();

    if (!target || typeof target.get !== "function") {
      return;
    }

    originalGet = target.get;

    if (originalGet.__rdtPacejetSummaryOverride) {
      SUMMARY_OVERRIDE_MOUNTED = true;
      return;
    }

    target.get = function get(attr) {
      var value = originalGet.apply(this, arguments);

      if (attr !== "summary") {
        return value;
      }

      return buildOverriddenSummary(this, value);
    };

    target.get.__rdtPacejetSummaryOverride = true;
    SUMMARY_OVERRIDE_MOUNTED = true;
  }

  function getCustomFieldValue(order, fieldId) {
    if (!order || !fieldId) {
      return "";
    }

    return getDeepOrderFieldValue(order, fieldId);
  }

  function getPacejetShippingOverride(order) {
    var rawValue = getCustomFieldValue(order, "custbody_rdt_pacejet_amount");

    if (rawValue === null || rawValue === undefined || rawValue === "") {
      return null;
    }

    return num(rawValue);
  }

  function getShipping(order) {
    var pacejetShipping;
    var summary;

    if (!order || !order.get) return 0;

    pacejetShipping = getPacejetShippingOverride(order);
    if (pacejetShipping !== null) {
      return pacejetShipping;
    }

    summary = getOrderSummaryRecord(order);
    return num(
      summary.shipping ||
        summary.shippingcost ||
        summary.shippingCost ||
        summary.estimatedshipping ||
        0
    );
  }

  function logSummaryDebug(order, stage, data) {
    if (!order || !order.get || !console || !console.log) return;

    var summary = getOrderSummaryRecord(order);
    var shipping = getShipping(order);
    var payload = {
      stage: stage,
      shipmethod: order.get("shipmethod"),
      summarySubtotal: num(summary.subtotal || 0),
      summaryShipping: shipping,
      summaryTax: num(
        summary.taxtotal ||
          summary.taxTotal ||
          summary.tax ||
          summary.taxamount ||
          summary.taxAmount ||
          0
      ),
      summaryTotal: num(
        summary.total ||
          summary.totalamount ||
          summary.totalAmount ||
          summary.order_total ||
          0
      )
    };

    if (data) {
      payload.computed = data;
    }
  }

  function getSummary(order) {
    if (!order || !order.get) return null;

    var sourceSummary = getOrderSummaryRecord(order);
    var summary = buildOverriddenSummary(order, sourceSummary);
    var authoritativeSummary = getPersistedStateSummaryForOrder(order);
    var resolvedShipping = getResolvedShippingAmount(order, sourceSummary);
    var tax = num(
      summary.taxtotal ||
        summary.taxTotal ||
        summary.tax ||
        summary.taxamount ||
        summary.taxAmount ||
        0
    );
    var shipping = authoritativeSummary
      ? asNumber(authoritativeSummary.shipping, 0)
      : asNumber(resolvedShipping.amount, 0);
    var subtotal = num(summary.subtotal || 0);
    var total = num(
      summary.total ||
        summary.totalamount ||
        summary.totalAmount ||
        summary.order_total ||
        0
    );

    if (authoritativeSummary) {
      total = asNumber(authoritativeSummary.total, total);
    } else if (resolvedShipping.source !== "native" || !total) {
      total = +(subtotal + shipping + tax).toFixed(2);
    }

    var data = {
      subtotal: subtotal,
      shipping: shipping,
      tax: tax,
      total: total
    };

    logSummaryDebug(order, "getSummary", data);
    return data;
  }

  // --------------------------------------------
  // Compute subtotal from line items (authoritative)
  // --------------------------------------------

  function enforcePacejetSummary(order) {
    if (!order || !order.get) return;

    var data = getSummary(order);
    if (!data) return;

    logSummaryDebug(order, "enforcePacejetSummary", data);
  }

  // --------------------------------------------
  // Render summary DOM (shipping + tax + total)
  // --------------------------------------------
  function paintValueByLabel(regex, valueText) {
    var updates = 0;
    var $scope = $(
      ".order-wizard-cart-summary, .order-wizard-cart-summary-container"
    );
    if (!$scope.length) return updates;

    $scope.each(function () {
      var $root = $(this);
      var $labels = $root.find(
        ".order-wizard-cart-summary-grid-left, " +
          ".order-wizard-cart-summary-label, " +
          ".order-wizard-cart-summary-subtotal-label, " +
          ".order-wizard-cart-summary-shipping-label, " +
          ".order-wizard-cart-summary-tax-label, " +
          ".order-wizard-cart-summary-total-label, " +
          ".cart-summary-label, .summary-label, [class*='-label']"
      );

      $labels
        .filter(function () {
          return regex.test($(this).text() || "");
        })
        .each(function () {
          var $label = $(this);
          var $row = $label.closest(
            "tr, li, .order-wizard-cart-summary-grid, .order-wizard-cart-summary-row, .summary-row"
          );

          var $targets = $row.find(
            ".order-wizard-cart-summary-grid-right, " +
              ".order-wizard-cart-summary-value, " +
              ".cart-summary-amount, .summary-value, [class*='-amount']"
          );

          if (!$targets.length) {
            $targets = $label.siblings(
              ".order-wizard-cart-summary-grid-right, " +
                ".order-wizard-cart-summary-value, " +
                ".cart-summary-amount, .summary-value, [class*='-amount']"
            );
          }

          if ($targets.length) {
            $targets.last().text(valueText);
            updates++;
          }
        });
    });

    return updates;
  }

  function paintLabel(regex, newLabel) {
    var updates = 0;
    var $scope = $(
      ".order-wizard-cart-summary, .order-wizard-cart-summary-container"
    );
    if (!$scope.length) return updates;

    $scope.each(function () {
      $(this)
        .find(
          ".order-wizard-cart-summary-grid-left, " +
            ".order-wizard-cart-summary-label, " +
            ".order-wizard-cart-summary-subtotal-label, " +
            ".order-wizard-cart-summary-shipping-label, " +
            ".order-wizard-cart-summary-tax-label, " +
            ".order-wizard-cart-summary-total-label, " +
            ".cart-summary-label, .summary-label, [class*='-label']"
        )
        .filter(function () {
          return regex.test($.trim($(this).text() || ""));
        })
        .each(function () {
          $(this).text(newLabel);
          updates++;
        });
    });

    return updates;
  }

  function getSummaryContainer() {
    var $container = $(".order-wizard-cart-summary-container").first();
    if (!$container.length) {
      $container = $(".order-wizard-cart-summary").first();
    }
    return $container;
  }

  function isElementShown($el) {
    if (!$el || !$el.length) return false;

    return $el.css("display") !== "none" && $el.css("visibility") !== "hidden";
  }

  function hasVisibleNativeTaxRow($container) {
    var found = false;

    $container
      .find(
        ".order-wizard-cart-summary-tax, " +
          ".order-wizard-cart-summary-tax-total, " +
          ".order-wizard-cart-summary-taxes, " +
          ".order-wizard-cart-summary-estimated-tax"
      )
      .each(function () {
        var $row = $(this);
        if (isElementShown($row)) {
          found = true;
          return false;
        }
      });

    if (found) {
      return true;
    }

    $container
      .find(
        ".order-wizard-cart-summary-grid-left, " +
          ".order-wizard-cart-summary-label, " +
          ".order-wizard-cart-summary-tax-label, " +
          ".summary-label, [class*='-label']"
      )
      .each(function () {
        var $label = $(this);
        var text = $.trim($label.text() || "");
        if (!/^tax(?:\s+total)?$/i.test(text)) {
          return;
        }

        if (isElementShown($label)) {
          found = true;
          return false;
        }
      });

    return found;
  }

  function ensureInjectedTaxRow(valueText) {
    var $container = getSummaryContainer();
    if (!$container.length) return 0;

    var $row = $container.find(".rdt-pj-tax-row");
    if (!$row.length) {
      var rowHtml =
        '<p class="order-wizard-cart-summary-grid-float rdt-pj-tax-row">' +
        '<span class="order-wizard-cart-summary-grid-right rdt-pj-tax-value"></span>' +
        '<span class="order-wizard-cart-summary-grid-left order-wizard-cart-summary-tax-label">Tax</span>' +
        "</p>";

      var $shippingBlock = $container.find(
        ".order-wizard-cart-summary-shipping, " +
          ".order-wizard-cart-summary-shipping-cost-applied"
      );
      var $totalBlock = $container.find(".order-wizard-cart-summary-total");

      if ($shippingBlock.length) {
        $shippingBlock.after(rowHtml);
      } else if ($totalBlock.length) {
        $totalBlock.before(rowHtml);
      } else {
        $container.append(rowHtml);
      }

      $row = $container.find(".rdt-pj-tax-row");
    }

    $row
      .find(".rdt-pj-tax-value, .order-wizard-cart-summary-grid-right")
      .first()
      .text(valueText);

    return 1;
  }

  function ensureCheckoutTaxRow(data) {
    if (!data) return;
    if (isConfirmationPage()) return;

    var $container = getSummaryContainer();
    if (!$container.length) return;

    var hasNativeTaxBlock = hasVisibleNativeTaxRow($container);

    if (!hasNativeTaxBlock) {
      ensureInjectedTaxRow(fmtMoney(data.tax));
    } else if ($container.find(".rdt-pj-tax-row").length) {
      $container.find(".rdt-pj-tax-row").remove();
    }
  }

  function showNativeConfirmationSummary($container) {
    var selectorsToShow = [
      ".order-wizard-cart-summary-body > .order-wizard-cart-summary-subtotal",
      ".order-wizard-cart-summary-subtotal",
      ".order-wizard-cart-summary-shipping-cost-applied",
      ".order-wizard-cart-summary-shipping",
      ".order-wizard-cart-summary-tax",
      ".order-wizard-cart-summary-tax-total",
      ".order-wizard-cart-summary-taxes",
      ".order-wizard-cart-summary-estimated-tax",
      ".order-wizard-cart-summary-total",
      ".rdt-pj-tax-row"
    ];

    $container.find(selectorsToShow.join(", ")).show();
    $container
      .find(
        ".order-wizard-cart-summary-subtotal-text, .order-wizard-cart-summary-subtotal-legend"
      )
      .show();
    $container.find(".rdt-pj-confirmation-summary").remove();
  }

  function ensureConfirmationSummary(data) {
    var $container = $(".order-wizard-cart-summary-container").first();
    if (!$container.length) {
      $container = $(".order-wizard-cart-summary").first();
    }
    if (!$container.length) return false;

    if (!hasRenderableValues(data)) {
      showNativeConfirmationSummary($container);
      return false;
    }

    var selectorsToHide = [
      ".order-wizard-cart-summary-body > .order-wizard-cart-summary-subtotal",
      ".order-wizard-cart-summary-subtotal",
      ".order-wizard-cart-summary-shipping-cost-applied",
      ".order-wizard-cart-summary-shipping",
      ".order-wizard-cart-summary-tax",
      ".order-wizard-cart-summary-tax-total",
      ".order-wizard-cart-summary-taxes",
      ".order-wizard-cart-summary-estimated-tax",
      ".order-wizard-cart-summary-total",
      ".rdt-pj-tax-row"
    ];

    var $custom = $container.find(".rdt-pj-confirmation-summary");
    if (!$custom.length) {
      $custom = $('<div class="rdt-pj-confirmation-summary"></div>');
      $container.append($custom);
    }

    var rows = [
      { key: "subtotal", label: "Subtotal", amount: data.subtotal },
      { key: "shipping", label: "Shipping", amount: data.shipping },
      { key: "tax", label: "Tax", amount: data.tax },
      { key: "total", label: "Total", amount: data.total }
    ];

    $container.find(selectorsToHide.join(", ")).hide();
    $container
      .find(
        ".order-wizard-cart-summary-subtotal-text, " +
          ".order-wizard-cart-summary-subtotal-legend, " +
          ".order-wizard-cart-summary-shipping-cost-applied p, " +
          ".order-wizard-cart-summary-total p"
      )
      .hide();

    $custom.empty();

    rows.forEach(function (row) {
      var rowClass =
        "rdt-pj-confirmation-row rdt-pj-confirmation-row-" + row.key;
      var html =
        '<p class="order-wizard-cart-summary-grid-float ' +
        rowClass +
        '">' +
        '<span class="order-wizard-cart-summary-grid-right">' +
        fmtMoney(row.amount) +
        "</span>" +
        '<span class="order-wizard-cart-summary-grid-left">' +
        row.label +
        "</span>" +
        "</p>";

      $custom.append(html);
    });

    return true;
  }

  function paintSummary(data) {
    if (!data) return;

    if (isConfirmationPage()) {
      ensureConfirmationSummary(data);
      return;
    }

    var $shipEls = $(
      ".order-wizard-cart-summary-shipping-cost-formatted, " +
        ".order-wizard-cart-summary-shipping .order-wizard-cart-summary-grid-right"
    );

    var $totalEls = $(
      ".order-wizard-cart-summary-total .order-wizard-cart-summary-grid-right"
    );
    var nativeTaxSelector =
      ".order-wizard-cart-summary-tax, " +
      ".order-wizard-cart-summary-tax .order-wizard-cart-summary-grid-right, " +
      ".order-wizard-cart-summary-tax .order-wizard-cart-summary-grid-float .order-wizard-cart-summary-grid-right, " +
      ".order-wizard-cart-summary-tax-total .order-wizard-cart-summary-grid-right, " +
      ".order-wizard-cart-summary-tax-total .order-wizard-cart-summary-grid-float .order-wizard-cart-summary-grid-right, " +
      ".order-wizard-cart-summary-taxes .order-wizard-cart-summary-grid-right, " +
      ".order-wizard-cart-summary-estimated-tax .order-wizard-cart-summary-grid-right, " +
      ".order-wizard-cart-summary-tax-cost-formatted";
    var $taxEls = $(nativeTaxSelector);
    var hasNativeTaxBlock = $(nativeTaxSelector).length > 0;
    if (!$taxEls.length) {
      var $labels = $(
        ".order-wizard-cart-summary .order-wizard-cart-summary-grid-left, " +
          ".order-wizard-cart-summary-container .order-wizard-cart-summary-grid-left"
      ).filter(function () {
        return /tax/i.test($(this).text() || "");
      });

      var $fallbackTax = $();
      $labels.each(function () {
        $fallbackTax = $fallbackTax.add(
          $(this)
            .closest("tr, li, .order-wizard-cart-summary-grid")
            .find(
              ".order-wizard-cart-summary-grid-right, .order-wizard-cart-summary-value"
            )
            .last()
        );
      });

      if ($fallbackTax.length) {
        $taxEls = $fallbackTax;
      }
    }

    // Paint all matches
    if ($shipEls.length) $shipEls.text(fmtMoney(data.shipping));
    if ($taxEls.length) $taxEls.text(fmtMoney(data.tax));
    if ($totalEls.length) $totalEls.text(fmtMoney(data.total));

    paintLabel(/^tax(?:\s+total)?$/i, "Tax");

    // Container-based fallbacks for themes that don't expose standard tax selectors.
    $(
      ".order-wizard-cart-summary-tax, " +
        ".order-wizard-cart-summary-tax-total, " +
        ".order-wizard-cart-summary-taxes, " +
        ".order-wizard-cart-summary-estimated-tax"
    )
      .find(
        ".order-wizard-cart-summary-grid-right, .order-wizard-cart-summary-value, [class*='-amount']"
      )
      .last()
      .text(fmtMoney(data.tax));

    paintValueByLabel(/^tax(?:\s+total)?$/i, fmtMoney(data.tax));
    paintValueByLabel(/shipping/i, fmtMoney(data.shipping));
    paintValueByLabel(/\btotal\b/i, fmtMoney(data.total));

    ensureCheckoutTaxRow(data);

    // Optional compatibility hook
    var $trueTotal = $("#rdt-true-total-amount");
    if ($trueTotal.length) $trueTotal.text(fmtMoney(data.total));
  }

  function renderSummaryUI(order) {
    if (!order || !order.get) return;

    var data = getSummary(order);
    if (!data) return;

    paintSummary(data);
    ensureCheckoutTaxRow(data);

    // Checkout can repaint summary after async view refresh; repaint once shortly after.
    if (SUMMARY_REPAINT_TIMER) clearTimeout(SUMMARY_REPAINT_TIMER);
    SUMMARY_REPAINT_TIMER = setTimeout(function () {
      var lateData = getSummary(order);
      if (lateData) {
        paintSummary(lateData);
        ensureCheckoutTaxRow(lateData);
      }
    }, 320);

    setTimeout(function () {
      var delayedData = getSummary(order);
      if (delayedData) {
        ensureCheckoutTaxRow(delayedData);
      }
    }, 900);

    setTimeout(function () {
      var delayedData = getSummary(order);
      if (delayedData) {
        ensureCheckoutTaxRow(delayedData);
      }
    }, 1600);
  }

  return {
    mountToApp: mountToApp,
    getSummary: getSummary,
    getShipping: getShipping,

    enforcePacejetSummary: enforcePacejetSummary,
    renderSummaryUI: renderSummaryUI
  };
});
