/// <amd-module name="RDT.Pacejet.V2"/>

define("RDT.Pacejet.V2", [
  "RDT.Pacejet.Checkout.Module.V2",
  "RDT.Pacejet.PostOrder",
  "RDT.Pacejet.Summary",
  "RDT.Pacejet.State",
  "jQuery",
  "LiveOrder.Model"
], function (
  PacejetCheckout,
  PostOrder,
  PacejetSummary,
  PacejetState,
  jQuery,
  LiveOrderModel
) {
  "use strict";

  var $ = jQuery;

  // --------------------------------------------
  // Guards
  // --------------------------------------------
  var APPLY_IN_FLIGHT = false;
  var CONFIRMATION_LOCKED = false;
  var LAYOUT_AFTER_APPEND_HANDLER = null;

  // --------------------------------------------
  // Helpers
  // --------------------------------------------
  function getHash() {
    return (window.location.hash || "").toLowerCase();
  }

  function isShippingStep() {
    return getHash().indexOf("shipping/address") !== -1;
  }

  function isSummaryStep() {
    var h = getHash();
    return (
      h.indexOf("billing") !== -1 ||
      h.indexOf("review") !== -1 ||
      h.indexOf("confirmation") !== -1
    );
  }

  function num(v) {
    return Number(String(v || "").replace(/[^0-9.\-]/g, "")) || 0;
  }

  function fmt(n) {
    return n.toLocaleString(undefined, {
      style: "currency",
      currency: "USD"
    });
  }

  function getCustomFieldValue(order, id) {
    var cfs = (order && order.get && order.get("customFields")) || [];
    for (var i = 0; i < cfs.length; i++) {
      if (cfs[i] && cfs[i].id === id) return cfs[i].value;
    }
    return "";
  }

  function getOrderInternalId(order) {
    if (!order || !order.get) return "";

    var candidates = [
      order.get("internalid"),
      order.get("internalId"),
      order.get("id")
    ];

    var confirmation = order.get("confirmation") || {};
    candidates.push(
      confirmation.internalid,
      confirmation.internalId,
      confirmation.id
    );

    for (var i = 0; i < candidates.length; i++) {
      var value = String(candidates[i] || "").trim();
      if (/^\d+$/.test(value)) return value;
    }

    return "";
  }

  function getSummaryTax(summary) {
    summary = summary || {};
    return num(
      summary.taxtotal ||
        summary.taxTotal ||
        summary.tax ||
        summary.taxamount ||
        summary.taxAmount ||
        0
    );
  }

  function normalizeServerTotalsForDisplay(order, totals) {
    totals = totals || {};

    var state = PacejetState.get();
    var cache = (state && state.cache) || {};
    var summary = (order && order.get && order.get("summary")) || {};
    var base = cache.baseCartTotals || {};
    var subtotal = num(base.subtotal || summary.subtotal || totals.subtotal);
    var shipping = num(totals.shipping);
    var baseTax = num(base.tax || 0);
    var tax = num(totals.tax);

    return {
      subtotal: subtotal,
      shipping: shipping,
      tax: tax,
      total: +(subtotal + shipping + tax).toFixed(2)
    };
  }

  function getSelectedShippingDisplay(order, $module) {
    var state = PacejetState.get();
    var selection = state && state.selection ? state.selection : {};
    var shipCode =
      selection.shipCode ||
      (order && order.get ? order.get("shipmethod") : "") ||
      "";
    var carrier =
      selection.carrier ||
      getCustomFieldValue(order, "custbody_rdt_pj_carrier_name") ||
      "";
    var service =
      selection.service ||
      getCustomFieldValue(order, "custbody_rdt_pj_service_name") ||
      "";
    var cost = Number(
      selection.cost ||
        getCustomFieldValue(order, "custbody_rdt_pacejet_amount") ||
        0
    );

    var $select =
      $module && $module.length ? $module.find("select").first() : $();
    var $selectedOption = $select.find("option:selected");
    var selectedText = String($selectedOption.text() || "").trim();

    if (!service && selectedText) {
      service = selectedText.replace(/^Free!\s*-\s*/i, "").trim();
    }

    if (!carrier && service) {
      carrier = service.split(/\s+/).slice(0, 2).join(" ");
    }

    if (!shipCode && !$selectedOption.length) return null;

    return {
      shipCode: String(shipCode || $selectedOption.val() || ""),
      carrier: carrier || "Delivery",
      service: service || selectedText || "Shipping Method",
      cost: cost
    };
  }

  // --------------------------------------------
  // Cleanup Pacejet DOM
  // --------------------------------------------
  function cleanupPacejetDom() {
    $(".rdt-pj-wrapper").remove();
    $("body").removeClass("rdt-pj-prehide");
    $(".order-wizard-shipmethod-module-option-select")
      .removeClass("rdt-pj-native-hidden")
      .attr("aria-hidden", "false");
  }

  // --------------------------------------------
  // Confirmation DOM Authority (FINAL BOSS)
  // --------------------------------------------
  function repaintConfirmationSummary(force) {
    if (CONFIRMATION_LOCKED && !force) return true;

    var $container = $(".order-wizard-cart-summary-container");
    if (!$container.length) return false;

    var order =
      LiveOrderModel && LiveOrderModel.getInstance
        ? LiveOrderModel.getInstance()
        : null;
    var data =
      order && PacejetSummary.getSummary
        ? PacejetSummary.getSummary(order)
        : null;
    if (!data) return false;

    PacejetSummary.enforcePacejetSummary(order);
    PacejetSummary.renderSummaryUI(order);

    CONFIRMATION_LOCKED = true;

    console.log("[Pacejet] Confirmation summary LOCKED", {
      subtotal: data.subtotal,
      shipping: data.shipping,
      tax: data.tax,
      total: data.total
    });

    return true;
  }

  function renderReviewShippingCard(order) {
    var $module = $(
      ".order-wizard-showshipments-module-shipping-details-method"
    );
    if (!$module.length) return;

    var display = getSelectedShippingDisplay(order, $module);
    if (!display) return;

    $module.addClass("rdt-mui-native-hidden");
    $module.find("select").addClass("rdt-mui-native-hidden");

    var cost = fmt(Number(display.cost || 0));
    var $existing = $module.find(".rdt-mui-shipping-card");
    if ($existing.length) $existing.remove();

    var $card = $(
      '<div class="rdt-mui-shipping-card">' +
        '<div class="rdt-mui-shipping-left">' +
        '<span class="rdt-mui-chip">' +
        (display.carrier || "Delivery") +
        "</span>" +
        '<div class="rdt-mui-service">' +
        (display.service || "") +
        "</div>" +
        '<div class="rdt-mui-price">' +
        cost +
        "</div>" +
        "</div>" +
        '<button class="rdt-mui-change-btn">Change</button>' +
        "</div>"
    );

    $card.find(".rdt-mui-change-btn").on("click", function () {
      window.location.hash = "#shipping/address";
    });

    $module.append($card);
  }

  // --------------------------------------------
  // Paint summary when DOM is ready
  // --------------------------------------------
  function paintSummaryWhenReady(order, reason) {
    if (!order) return;

    var tries = 0;
    var max = 25;

    (function tick() {
      tries++;

      if (
        $(".order-wizard-cart-summary-container, .order-wizard-cart-summary")
          .length
      ) {
        PacejetSummary.enforcePacejetSummary(order);
        PacejetSummary.renderSummaryUI(order);
        return;
      }

      if (tries < max) setTimeout(tick, 100);
      else console.warn("[Pacejet] Summary paint timeout:", reason);
    })();
  }

  function waitForOrderId(order, maxTries) {
    maxTries = maxTries || 10;

    return new Promise(function (resolve, reject) {
      var tries = 0;

      function check() {
        var id = getOrderInternalId(order);

        if (id) return resolve(id);

        if (tries++ >= maxTries) {
          return reject("No SO after waiting");
        }

        setTimeout(check, 300);
      }

      check();
    });
  }

  function normalizeTaxFields(order) {
    if (!order || !order.get || !order.set) return;

    var summary = order.get("summary") || {};
    var baseTax =
      summary.taxtotal ||
      summary.taxTotal ||
      summary.taxamount ||
      summary.taxAmount ||
      summary.tax ||
      0;

    if (!baseTax) return;

    var changed = false;

    if (!summary.taxTotal) {
      summary.taxTotal = baseTax;
      changed = true;
    }
    if (!summary.taxAmount) {
      summary.taxAmount = baseTax;
      changed = true;
    }
    if (!summary.taxamount) {
      summary.taxamount = baseTax;
      changed = true;
    }
    if (!summary.tax) {
      summary.tax = baseTax;
      changed = true;
    }

    if (changed) {
      order.set("summary", summary, { silent: true });
      order.trigger("change:summary");
    }
  }

  // --------------------------------------------
  // Apply shipping SERVER-SIDE
  // --------------------------------------------
  function applyShippingServerSide(order) {
    var selection = PacejetState.get().selection;
    if (!selection || !selection.shipCode || !selection.cost) return;
    if (APPLY_IN_FLIGHT) return;

    APPLY_IN_FLIGHT = true;

    function applyWithRetry(attempt) {
      attempt = attempt || 0;

      return waitForOrderId(order)
        .then(function (orderId) {
          return $.ajax({
            url: "/app/site/hosting/scriptlet.nl?script=3956&deploy=1",
            type: "POST",
            contentType: "application/json",
            data: JSON.stringify({
              orderId: orderId,
              shipmethod: selection.shipCode,
              pacejetAmount: selection.cost,
              carrier: selection.carrier,
              service: selection.service,
              quoteJson: JSON.stringify(selection)
            })
          });
        })
        .then(function (resp) {
          if (resp && resp.retry && attempt < 5) {
            console.warn("[Pacejet] retrying apply...", attempt);

            return new Promise(function (resolve) {
              setTimeout(function () {
                resolve(applyWithRetry(attempt + 1));
              }, 500);
            });
          }

          if (!resp || !resp.ok) {
            throw new Error("Shipping apply failed");
          }

          return resp;
        });
    }

    function waitForTaxUpdate(live, expectedTax, previousTax) {
      return new Promise(function (resolve) {
        var tries = 0;

        function check() {
          var summary = live.get("summary") || {};
          var tax = Number(
            summary.taxtotal || summary.taxTotal || summary.tax || 0
          );

          if (expectedTax > 0 && Math.abs(tax - expectedTax) <= 0.009) {
            return resolve();
          }

          if (
            expectedTax <= 0 &&
            previousTax > 0 &&
            Math.abs(tax - previousTax) > 0.009
          ) {
            return resolve();
          }

          if (tax > 0 && previousTax <= 0) {
            return resolve();
          }

          if (tries++ < 10) {
            setTimeout(check, 300);
          } else {
            console.warn("[Pacejet] tax wait timeout");
            resolve();
          }
        }

        check();
      });
    }

    return applyWithRetry()
      .then(function (resp) {
        var previousTax = getSummaryTax(order.get("summary") || {});
        var normalizedTotals =
          resp && resp.totals
            ? normalizeServerTotalsForDisplay(order, resp.totals)
            : null;

        PacejetState.get().cache.lastServerTotals = normalizedTotals;

        var live = LiveOrderModel.getInstance();

        normalizeTaxFields(live);
        return live
          .fetch({
            reset: true,
            data: {
              t: Date.now(),
              fullsummary: "T"
            }
          })
          .then(function () {
            normalizeTaxFields(live);

            var summary = live.get("summary") || {};

            console.log("[Pacejet] AFTER SUITELET FETCH", {
              shipping: summary.shippingcost,
              tax: summary.taxtotal,
              total: summary.total
            });

            live.trigger("change");
            live.trigger("change:summary");
            live.trigger("sync");
          })
          .then(function () {
            return waitForTaxUpdate(
              live,
              normalizedTotals ? Number(normalizedTotals.tax || 0) : 0,
              previousTax
            );
          })
          .then(function () {
            normalizeTaxFields(live);

            var finalSummary = live.get("summary") || {};

            console.log("[Pacejet] FINAL summary:", finalSummary);

            live.trigger("change");
            live.trigger("change:summary");
            live.trigger("sync");

            paintSummaryWhenReady(live, "server apply FINAL");
          });
      })
      .catch(function (err) {
        console.error("[Pacejet] applyShipping failed", err);
      })
      .finally(function () {
        APPLY_IN_FLIGHT = false;
      });
  }

  // --------------------------------------------
  // Orchestrator
  // --------------------------------------------
  function maybeRun(order) {
    if (!order) return;

    var hash = getHash();

    // ----------------------------------
    // CONFIRMATION (LOCKED DOM)
    // ----------------------------------
    if (hash.indexOf("confirmation") !== -1) {
      cleanupPacejetDom();
      CONFIRMATION_LOCKED = false;

      var tries = 0;
      (function wait() {
        tries++;
        if (repaintConfirmationSummary()) {
          renderReviewShippingCard(order);
          return;
        }
        if (tries < 50) setTimeout(wait, 100);
      })();

      $(document).off("DOMNodeInserted._pj_confirm");
      $(document).on("DOMNodeInserted._pj_confirm", function (e) {
        if (
          CONFIRMATION_LOCKED &&
          $(e.target).closest(".order-wizard-cart-summary").length
        ) {
          repaintConfirmationSummary(true);
        }
        if (
          $(e.target).closest(
            ".order-wizard-showshipments-module-shipping-details-method"
          ).length
        ) {
          renderReviewShippingCard(order);
        }
      });

      return;
    }

    // ----------------------------------
    // SHIPPING
    // ----------------------------------
    if (isShippingStep()) {
      PacejetState.get().flags.suppressRefresh = false;
      document.body.classList.add("rdt-pj-prehide");
      PacejetCheckout.run();
      paintSummaryWhenReady(order, "shipping step");
      return;
    }

    // ----------------------------------
    // BILLING / REVIEW
    // ----------------------------------
    cleanupPacejetDom();
    if (!isSummaryStep()) return;

    paintSummaryWhenReady(order, "summary enter");
    applyShippingServerSide(order);

    if (hash.indexOf("review") !== -1) {
      setTimeout(function () {
        paintSummaryWhenReady(order, "review delayed");

        renderReviewShippingCard(order);
      }, 300);
    }
  }

  function mountToApp(container) {
    PacejetCheckout.run?.(container);
    PostOrder.mount?.();

    var order = LiveOrderModel?.getInstance?.();
    if (!order) return;

    order.off("change:summary");
    order.off("change:shipmethod");

    order.on("change:summary", function () {
      var summary = order.get("summary") || {};

      var hasBrokenTax =
        summary.taxtotal &&
        !summary.taxTotal &&
        !summary.taxamount &&
        !summary.tax;

      if (hasBrokenTax) {
        console.warn("[Pacejet] Fixing wiped tax fields");

        var baseTax = Number(summary.taxtotal) || 0;

        summary.taxTotal = baseTax;
        summary.taxamount = baseTax;
        summary.taxAmount = baseTax;
        summary.tax = baseTax;

        // silent to avoid cascading loops
        order.set("summary", summary, { silent: true });
      }

      paintSummaryWhenReady(
        order,
        hasBrokenTax ? "tax recovery" : "model change"
      );
    });

    order.on("change:shipmethod", function () {
      console.log("[Pacejet] shipmethod changed");

      waitForOrderId(order, 10)
        .then(function (orderId) {
          console.log("[Pacejet] SO exists → applying shipping server-side");

          return applyShippingServerSide(order);
        })
        .catch(function () {
          console.log("[Pacejet] No SO yet → using local UI only");

          // fallback UI only
          paintSummaryWhenReady(order, "local only");
        });
    });

    var layout = container?.getComponent?.("Layout");

    if (!LAYOUT_AFTER_APPEND_HANDLER) {
      LAYOUT_AFTER_APPEND_HANDLER = function () {
        maybeRun(order);
      };
    }

    if (layout?.off) {
      layout.off("afterAppendView", LAYOUT_AFTER_APPEND_HANDLER);
    }
    if (layout?.on) {
      layout.on("afterAppendView", LAYOUT_AFTER_APPEND_HANDLER);
    }

    $(window).off("hashchange");
    $(window).on("hashchange", function () {
      setTimeout(function () {
        maybeRun(order);
      }, 0);
    });

    maybeRun(order);
  }

  return {
    mountToApp: mountToApp
  };
});
