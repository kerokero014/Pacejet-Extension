/// <amd-module name="RDT.Pacejet.Summary"/>

define("RDT.Pacejet.Summary", ["jQuery", "RDT.Pacejet.State"], function (
  jQuery,
  PacejetState
) {
  "use strict";

  var $ = jQuery;
  var SUMMARY_REPAINT_TIMER = null;

  // --------------------------------------------
  // Helpers
  // --------------------------------------------
  function num(v) {
    return Number(String(v || "").replace(/[^0-9.\-]/g, "")) || 0;
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
  function getCustomField(order, id) {
    var cfs = (order && order.get && order.get("customFields")) || [];
    for (var i = 0; i < cfs.length; i++) {
      if (cfs[i].id === id) return num(cfs[i].value);
    }
    return 0;
  }

  function getShipping(order) {
    if (!order || !order.get) return 0;

    // Pacejet authoritative body field first
    var pj = getCustomField(order, "custbody_rdt_pacejet_amount");
    if (pj > 0) return pj;

    // Fallback: NetSuite summary
    var summary = order.get("summary") || {};
    return num(
      summary.shippingcost ||
        summary.shippingCost ||
        summary.estimatedshipping ||
        0
    );
  }

  function getCachedSummarySnapshot() {
    var state = PacejetState && PacejetState.get ? PacejetState.get() : null;
    var snapshot = state && state.cache ? state.cache.lastGoodSummary : null;
    return snapshot || null;
  }

  function cacheSummarySnapshot(data) {
    if (!data) return;

    var subtotal = num(data.subtotal);
    var shipping = num(data.shipping);
    var tax = num(data.tax);
    var total = num(data.total);

    if (subtotal <= 0 && tax <= 0) return;

    var state = PacejetState && PacejetState.get ? PacejetState.get() : null;
    if (!state || !state.cache) return;

    state.cache.lastGoodSummary = {
      subtotal: subtotal,
      shipping: shipping,
      tax: tax,
      total: total || +(subtotal + shipping + tax).toFixed(2),
      capturedAt: Date.now()
    };
  }

  function logSummaryDebug(order, stage, data) {
    if (!order || !order.get || !console || !console.log) return;

    var summary = order.get("summary") || {};
    var payload = {
      stage: stage,
      shipmethod: order.get("shipmethod"),
      summarySubtotal: num(summary.subtotal || 0),
      summaryShipping: num(
        summary.shippingcost || summary.shippingCost || summary.estimatedshipping
      ),
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
      ),
      pacejetShipping: getShipping(order)
    };

    if (data) {
      payload.computed = data;
    }

    console.log("[Pacejet][SummaryDebug]", payload);
  }

  function getSummary(order) {
    if (!order || !order.get) return null;

    var summary = order.get("summary") || {};
    var summaryShipping = num(
      summary.shippingcost || summary.shippingCost || summary.estimatedshipping
    );
    var summaryTax = num(
      summary.taxtotal ||
        summary.taxTotal ||
        summary.tax ||
        summary.taxamount ||
        summary.taxAmount ||
        0
    );
    var shipping = num(getShipping(order));
    var tax = num(
      summary.taxtotal ||
        summary.taxTotal ||
        summary.tax ||
        summary.taxamount ||
        summary.taxAmount ||
        0
    );
    var subtotal = num(summary.subtotal || 0);
    var summaryTotal = num(
      summary.total ||
        summary.totalamount ||
        summary.totalAmount ||
        summary.order_total ||
        0
    );
    var derivedTax = summaryTotal - subtotal - shipping;

    // Some accounts don't populate taxtotal reliably on the first fetch.
    // If total exists, infer tax from total - subtotal - shipping.
    if (!tax && summaryTotal) {
      tax = +derivedTax.toFixed(2);
    }

    var shippingChanged = Math.abs(shipping - summaryShipping) > 0.009;
    var taxChanged = Math.abs(tax - summaryTax) > 0.009;
    var total =
      shippingChanged || taxChanged || !summaryTotal
        ? +(subtotal + shipping + tax).toFixed(2)
        : summaryTotal;

    var cachedSummary = getCachedSummarySnapshot();
    var likelyBrokenSummary =
      subtotal <= 0 && tax <= 0 && shipping > 0 && total <= shipping + 0.009;

    if (cachedSummary && likelyBrokenSummary) {
      var sameShipping =
        Math.abs(num(cachedSummary.shipping) - shipping) <= 0.009;

      if (sameShipping || !shipping) {
        subtotal = num(cachedSummary.subtotal);
        tax = num(cachedSummary.tax);
        if (!shipping) shipping = num(cachedSummary.shipping);
        total = num(cachedSummary.total || subtotal + shipping + tax);
      }
    }

    var data = {
      subtotal: subtotal,
      shipping: shipping,
      tax: tax,
      total: total
    };

    logSummaryDebug(order, "getSummary", data);
    cacheSummarySnapshot(data);
    return data;
  }

  // --------------------------------------------
  // Compute subtotal from line items (authoritative)
  // --------------------------------------------

  function enforcePacejetSummary(order) {
    if (!order || !order.get || !order.set) return;

    var summary = order.get("summary") || {};
    var pj = getCustomField(order, "custbody_rdt_pacejet_amount");
    var shipping = num(
      pj ||
        summary.shippingcost ||
        summary.shippingCost ||
        summary.estimatedshipping
    );
    var subtotal = num(summary.subtotal || 0);
    var tax = num(
      summary.taxtotal ||
        summary.taxTotal ||
        summary.tax ||
        summary.taxamount ||
        summary.taxAmount
    );
    var total = num(
      summary.total ||
        summary.totalamount ||
        summary.totalAmount ||
        subtotal + shipping + tax
    );

    if (subtotal || summary.subtotal) summary.subtotal = subtotal;
    summary.shippingcost = shipping;
    summary.shippingCost = shipping;
    summary.estimatedshipping = shipping;
    summary.taxtotal = tax;
    summary.taxTotal = tax;
    summary.tax = tax;
    summary.taxamount = tax;
    summary.taxAmount = tax;
    summary.total = total;
    summary.totalamount = total;
    summary.totalAmount = total;

    logSummaryDebug(order, "enforcePacejetSummary", {
      subtotal: subtotal,
      shipping: shipping,
      tax: tax,
      total: total
    });

    order.set("summary", summary, { silent: true });
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

  function ensureConfirmationSummary(data) {
    var $container = $(".order-wizard-cart-summary-container").first();
    if (!$container.length) {
      $container = $(".order-wizard-cart-summary").first();
    }
    if (!$container.length) return false;

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

    $container.find(selectorsToHide.join(", ")).hide();
    $container
      .find(
        ".order-wizard-cart-summary-subtotal-text, " +
          ".order-wizard-cart-summary-subtotal-legend, " +
          ".order-wizard-cart-summary-shipping-cost-applied p, " +
          ".order-wizard-cart-summary-total p"
      )
      .hide();

    var $custom = $container.find(".rdt-pj-confirmation-summary");
    if (!$custom.length) {
      $custom = $('<div class="rdt-pj-confirmation-summary"></div>');
      $container.append($custom);
    }

    var rows = [
      { key: "subtotal", label: "Subtotal", amount: data.subtotal },
      { key: "tax", label: "Tax Total", amount: data.tax },
      { key: "shipping", label: "Shipping Cost", amount: data.shipping },
      { key: "total", label: "Total", amount: data.total }
    ];

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
    var $taxEls = $(
      nativeTaxSelector
    );
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

    // enforce first (so getSummary() reads correct)
    enforcePacejetSummary(order);

    var data = getSummary(order);
    if (!data) return;

    paintSummary(data);
    ensureCheckoutTaxRow(data);

    // Checkout can repaint summary after async view refresh; repaint once shortly after.
    if (SUMMARY_REPAINT_TIMER) clearTimeout(SUMMARY_REPAINT_TIMER);
    SUMMARY_REPAINT_TIMER = setTimeout(function () {
      enforcePacejetSummary(order);
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
    getSummary: getSummary,
    getShipping: getShipping,

    enforcePacejetSummary: enforcePacejetSummary,
    renderSummaryUI: renderSummaryUI
  };
});
