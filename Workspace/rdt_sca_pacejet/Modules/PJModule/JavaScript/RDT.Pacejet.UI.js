/// <amd-module name="RDT.Pacejet.UI"/>

define("RDT.Pacejet.UI", ["jQuery", "RDT.Pacejet.State"], function (
  jQuery,
  PacejetState
) {
  "use strict";

  var $ = jQuery;
  var NONE_ACCESSORIAL_ID = "none_additional_fees_may_app";

  var ACCESSORIALS = [
    {
      id: NONE_ACCESSORIAL_ID,
      label:
        "NONE - Additional fees may be charged if accessorials are needed at delivery and not prearranged."
    },
    { id: "driver_call", label: "Driver Call Ahead" },
    { id: "job_site", label: "Job Site Delivery" },
    { id: "lift_gate", label: "Lift Gate" },
    { id: "residential", label: "Residential Delivery" },
    { id: "schedule_appt", label: "Schedule Appointment" },
    { id: "self_storage", label: "Self-Storage Facility" },
    { id: "school", label: "School Delivery" },
    { id: "inside_delivery", label: "Inside Delivery" },
    { id: "hazmat_parcel", label: "Hazmat Parcel Shipping" },
    { id: "dangerous_goods", label: "Dangerous Goods" }
  ];

  var accessorialState = {};

  ACCESSORIALS.forEach(function (a) {
    accessorialState[a.id] = false;
  });

  function getAllowedAccessorials() {
    var state = PacejetState && PacejetState.get ? PacejetState.get() : null;
    return state && state.allowedAccessorials
      ? state.allowedAccessorials
      : null;
  }

  function getForcedAccessorials() {
    if (PacejetState && PacejetState.getForcedAccessorials) {
      return PacejetState.getForcedAccessorials();
    }

    var state = PacejetState && PacejetState.get ? PacejetState.get() : null;
    return state && state.selection && state.selection.forcedAccessorials
      ? state.selection.forcedAccessorials
      : {};
  }

  function syncAccessorialStateFromStore() {
    var selected = {};

    if (PacejetState && PacejetState.get) {
      var state = PacejetState.get();
      selected =
        state && state.selection && state.selection.accessorials
          ? state.selection.accessorials
          : {};
    }

    ACCESSORIALS.forEach(function (a) {
      accessorialState[a.id] = !!selected[a.id];
    });
  }

  function applyAccessorialSelection(accessorialId, checked) {
    var forcedAccessorials = getForcedAccessorials();

    if (forcedAccessorials[accessorialId]) {
      accessorialState[accessorialId] = true;
      accessorialState[NONE_ACCESSORIAL_ID] = false;
      return;
    }

    accessorialState[accessorialId] = checked;

    if (accessorialId === NONE_ACCESSORIAL_ID && checked) {
      ACCESSORIALS.forEach(function (a) {
        if (a.id !== NONE_ACCESSORIAL_ID) {
          accessorialState[a.id] = false;
        }
      });
      return;
    }

    if (accessorialId !== NONE_ACCESSORIAL_ID && checked) {
      accessorialState[NONE_ACCESSORIAL_ID] = false;
    }
  }

  function isAccessorialDisabled(accessorialId, allowedAccessorials) {
    var forcedAccessorials = getForcedAccessorials();

    if (forcedAccessorials[accessorialId]) {
      return true;
    }

    if (
      accessorialId !== NONE_ACCESSORIAL_ID &&
      accessorialState[NONE_ACCESSORIAL_ID]
    ) {
      return true;
    }

    if (
      allowedAccessorials &&
      accessorialId !== NONE_ACCESSORIAL_ID &&
      allowedAccessorials[accessorialId] === false
    ) {
      return true;
    }

    return false;
  }

  function syncRatesButtonState($btn) {
    if (!$btn || !$btn.length) return;

    $btn.toggleClass(
      "rdt-pj-rates-toggle-btn--pulse",
      !!accessorialState[NONE_ACCESSORIAL_ID]
    );
  }

  function hasDropShipInCart(state) {
    var snap = state && state.cache && state.cache.lastSnapshot;
    var items = (snap && snap.items) || [];
    return items.some(function (i) {
      return i && i.dropShip === true;
    });
  }

  function renderTruckloadNotice($host) {
    if (!$host || !$host.length) return;
    if ($host.find(".rdt-pj-truckload-notice").length) return;

    var html = `
    <div class="rdt-pj-truckload-notice">
      <div class="rdt-pj-truckload-title">
        Truckload Review
      </div>
      <div class="rdt-pj-truckload-body">
        This order exceeds <strong>20 linear feet</strong> or
        <strong>20,000 lbs</strong>. Curecrete will review truckload
        options and follow up within <strong>24 hours</strong>
        with the best available rate.
      </div>
    </div>
  `;

    $host.prepend(html);
  }

  function renderAccessorials() {
    syncAccessorialStateFromStore();

    var $box = $("<div/>").addClass("rdt-pj-accessorials");
    var allowedAccessorials = getAllowedAccessorials();
    var forcedAccessorials = getForcedAccessorials();
    var $noneGroup = $("<div/>").addClass("rdt-pj-accessorials-none");
    var $otherGroup = $("<div/>").addClass("rdt-pj-accessorials-grid");

    $box.append(
      $("<div/>")
        .addClass("rdt-pj-accessorials-title")
        .text("Additional Shipping Options")
    );

    ACCESSORIALS.forEach(function (a) {
      var id = "pj-acc-" + a.id;

      var $row = $("<div/>").addClass("rdt-pj-accessorial");
      if (a.id === NONE_ACCESSORIAL_ID) {
        $row.addClass("rdt-pj-accessorial--none");
      }

      var disabled = isAccessorialDisabled(a.id, allowedAccessorials);
      var $chk = $("<input/>", {
        type: "checkbox",
        id: id,
        "data-id": a.id,
        checked: !!accessorialState[a.id],
        disabled: disabled
      });
      var $label = $("<label/>", {
        for: id,
        text: a.label
      });

      if (disabled) {
        $row.addClass("rdt-pj-accessorial--disabled");
        $label.attr("aria-disabled", "true");
      }

      if (forcedAccessorials[a.id]) {
        $row.addClass("rdt-pj-accessorial--forced");
      }

      $chk.on("change", function () {
        if (forcedAccessorials[a.id] && !this.checked) {
          this.checked = true;
          return;
        }

        applyAccessorialSelection(a.id, this.checked);

        if (PacejetState && PacejetState.setAccessorials) {
          PacejetState.setAccessorials(jQuery.extend({}, accessorialState));
        }

        $box.replaceWith(renderAccessorials());

        emitSelect({
          accessorials: jQuery.extend({}, accessorialState)
        });

        syncRatesButtonState(
          $(".rdt-pj-rates-toggle-btn")
            .addClass("rdt-pj-rates-toggle-btn--dirty")
            .prop("disabled", false)
        );
      });

      $row.append($chk).append($label);
      if (a.id === NONE_ACCESSORIAL_ID) {
        $noneGroup.append($row);
      } else {
        $otherGroup.append($row);
      }
    });

    $box.append($noneGroup).append($otherGroup);

    return $box;
  }

  var listeners = { select: [] };

  function onSelect(cb) {
    if (typeof cb === "function") listeners.select.push(cb);
  }

  function emitSelect(payload) {
    for (var i = 0; i < listeners.select.length; i++) {
      try {
        listeners.select[i](payload);
      } catch (_) {}
    }
  }

  function fmtMoney(n) {
    var v = Number(n || 0);
    if (!isFinite(v) || v < 0) v = 0;
    try {
      return v.toLocaleString(undefined, {
        style: "currency",
        currency: "USD"
      });
    } catch (_) {
      return "$" + v.toFixed(2);
    }
  }

  function getEta(rate) {
    var days = Number(rate.transitDays);

    if (isFinite(days) && days > 0) {
      return days + " day" + (days === 1 ? "" : "s");
    }

    return "";
  }

  function getHostTitleEl($host) {
    return $host
      .find(".order-wizard-step-title, .order-wizard-shipmethod-module-title")
      .first();
  }

  function setContinueButtonState(enabled) {
    var selectors = [
      "[data-action='submit-step']",
      "[data-action='place-order']",
      ".wizard-step-navigation-buttons-right .button-primary",
      ".order-wizard-submitbutton-module-button"
    ];
    var shouldEnable = !!enabled;

    $(selectors.join(", ")).each(function () {
      var $button = $(this);
      $button.prop("disabled", !shouldEnable);
      $button.attr("aria-disabled", shouldEnable ? "false" : "true");
      $button.toggleClass("rdt-pj-disabled", !shouldEnable);
    });

    return enabled;
  }

  function showLoading($host) {
    if (!$host || !$host.length) return;
    if ($host.find(".rdt-pj-wrapper").length) return;

    var $wrapper = $("<div/>").addClass("rdt-pj-wrapper rdt-pj-loading");
    var $header = $("<div/>").addClass("rdt-pj-loading-header");
    $header.append($("<div/>").addClass("rdt-pj-loading-title"));
    $header.append($("<div/>").addClass("rdt-pj-loading-sub"));
    $wrapper.append($header);

    var $tableWrap = $("<div/>").addClass("rdt-pj-loading-table");
    for (var i = 0; i < 5; i++) {
      var $row = $("<div/>").addClass("rdt-pj-skel-row");
      for (var c = 0; c < 5; c++) {
        var $block = $("<div/>").addClass("rdt-pj-skel-block");
        if (c === 4) $block.addClass("rdt-pj-skel-block--tag");
        $row.append($block);
      }
      $tableWrap.append($row);
    }

    $wrapper.append($tableWrap);

    var $title = getHostTitleEl($host);
    $title.length ? $title.after($wrapper) : $host.prepend($wrapper);
  }

  function clear($host) {
    if ($host && $host.length) $host.find(".rdt-pj-wrapper").remove();
  }

  function getEstimatedArrivalDate(rate) {
    var raw =
      (rate &&
        (rate.estimatedArrivalDate ||
          rate.estDelivery ||
          rate.arrivalDateText ||
          "")) ||
      "";

    raw = String(raw).trim();

    if (!raw || raw.toUpperCase() === "NA") {
      return "";
    }

    // If Pacejet already returned a display string like:
    // "MON - 4/6/2026" or "TUE - 4/7/2026 11:00:00 PM"
    // keep that as the source of truth.
    if (/[A-Z]{3}\s*-\s*\d{1,2}\/\d{1,2}\/\d{4}/i.test(raw)) {
      return raw;
    }

    // If mapper/aggregation gave us YYYY-MM-DD, format it nicely.
    var ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) {
      var y = parseInt(ymd[1], 10);
      var m = parseInt(ymd[2], 10);
      var d = parseInt(ymd[3], 10);
      var dateFromYmd = new Date(y, m - 1, d);

      if (!isNaN(dateFromYmd.getTime())) {
        try {
          return dateFromYmd.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "2-digit",
            year: "numeric"
          });
        } catch (_) {
          return dateFromYmd.toDateString();
        }
      }
    }

    // If the value contains an M/D/YYYY date, parse and format it.
    var mdY = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (mdY) {
      var month = parseInt(mdY[1], 10);
      var day = parseInt(mdY[2], 10);
      var year = parseInt(mdY[3], 10);
      var parsed = new Date(year, month - 1, day);

      if (!isNaN(parsed.getTime())) {
        try {
          return parsed.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "2-digit",
            year: "numeric"
          });
        } catch (_) {
          return parsed.toDateString();
        }
      }
    }

    // Last fallback: return the raw Pacejet value instead of inventing a date.
    return raw;
  }

  function buildRatesWrapper(rates, state, selectedShipCode) {
    var isDropShipCart = hasDropShipInCart(state);
    var selectedApplied = false;
    var $tbody = $("<tbody/>");
    var $ratesWrapper = $("<div/>").addClass(
      "rdt-pj-wrapper rdt-pj-rates-wrapper"
    );

    var $header = $("<div/>").addClass("rdt-pj-header");
    $header.append(
      $("<div/>")
        .addClass("rdt-pj-header-title")
        .text("Pacejet Shipping Options")
    );
    $header.append(
      $("<div/>")
        .addClass("rdt-pj-header-sub")
        .text("Recommended, fastest, and lowest cost options")
    );
    $ratesWrapper.append($header);

    var $table = $("<table/>").addClass("rdt-pj-table");
    var $thead = $("<thead/>").append(
      $("<tr/>")
        .append($("<th/>").text("Carrier"))
        .append($("<th/>").text("Service"))
        .append($("<th/>").text("Price"))
        .append($("<th/>").text("ETA"))
        .append($("<th/>").text("Estimated Arrival Date"))
        .append($("<th/>").text("Tag"))
    );

    for (var i = 0; i < rates.length; i++) {
      var rate = rates[i] || {};
      var mappingType = rate._mapping && rate._mapping.type;
      if (mappingType === "unmapped" && rate.shipCode) continue;

      var shipCode = String(rate.shipCode || "");
      var price = Number((rate.finalCost || rate.cost || 0).toFixed(2));
      var carrier = rate.carrierName || rate.carrier || "";
      var service = rate.serviceName || rate.service || "";

      if (isDropShipCart && state?.flags?.dropShipEnforced !== true) {
        console.warn("[Pacejet][UI] DropShip not enforced in backend");
      }

      var $tr = $("<tr/>")
        .addClass("rdt-pj-row")
        .attr("role", "radio")
        .attr("aria-checked", "false")
        .attr("tabindex", "0")
        .attr("data-shipcode", shipCode)
        .attr("data-cost", price)
        .attr("data-accessorial-delta", rate.accessorialDelta || 0)
        .attr("data-carrier", carrier)
        .attr("data-service", service)
        .attr("data-transit-days", rate.transitDays || "")
        .attr(
          "data-estimated-arrival-date",
          rate.estimatedArrivalDate || rate.estDelivery || ""
        )
        .data("origins", rate.origins || []);

      if (
        !selectedApplied &&
        selectedShipCode &&
        shipCode === selectedShipCode
      ) {
        $tr.addClass("rdt-pj-row--selected").attr("aria-checked", "true");
        selectedApplied = true;
      }

      $tr.append($("<td/>").addClass("rdt-pj-col-carrier").text(carrier));
      $tr.append(
        $("<td/>")
          .addClass("rdt-pj-col-service")
          .append($("<div/>").addClass("rdt-pj-service-main").text(service))
      );
      $tr.append($("<td/>").addClass("rdt-pj-td-price").text(fmtMoney(price)));
      $tr.append($("<td/>").addClass("rdt-pj-col-eta").text(getEta(rate)));
      $tr.append(
        $("<td/>")
          .addClass("rdt-pj-col-arrival-date")
          .text(getEstimatedArrivalDate(rate))
      );

      var $tag = $("<td/>").addClass("rdt-pj-col-tag");
      if (rate.tag) {
        $tag.append($("<span/>").addClass("rdt-pj-tag-pill").text(rate.tag));
      } else if (mappingType === "fallback") {
        $tag.append(
          $("<span/>")
            .addClass("rdt-pj-tag-pill rdt-pj-tag-pill--neutral")
            .text("Standard service")
        );
      }
      $tr.append($tag);
      $tbody.append($tr);

      var origins = rate.origins || [];
      if (origins.length > 1) {
        var $expandRow = $("<tr/>")
          .addClass("rdt-expand-row")
          .attr("aria-hidden", "true");
        var $expandTd = $("<td/>").attr("colspan", 6);
        var $grid = $("<div/>").addClass("rdt-origin-breakdown");

        origins.forEach(function (o) {
          var $card = $("<div/>").addClass("rdt-origin-card");
          var carrierLabel = o.carrier || carrier;
          var serviceLabel = o.service || service;
          var costLabel = fmtMoney(o.cost || 0);

          var $left = $("<div/>").append(
            $("<div/>").text(carrierLabel),
            $("<div/>").addClass("rdt-origin-meta").text(serviceLabel)
          );
          var $right = $("<div/>").text(costLabel);

          $card.append($left).append($right);
          $grid.append($card);
        });

        $expandTd.append($grid);
        $expandRow.append($expandTd);
        $tbody.append($expandRow);

        $tr.on("click", function (e) {
          if ($(e.target).closest("input, button").length) return;
          $(this).toggleClass("rdt-row--open");
        });
      }
    }

    if (!$tbody.children().length) {
      return null;
    }

    $table.append($thead).append($tbody);

    var $scroll = $("<div/>").addClass("rdt-pj-table-scroll");
    $scroll.append($table);
    $ratesWrapper.append($scroll);

    return {
      wrapper: $ratesWrapper,
      tbody: $tbody
    };
  }

  function render($host, rates, state, opts) {
    if (!$host || !$host.length) return;

    opts = opts || {};
    var deferClear = !!opts.deferClear;
    var $oldWrappers = deferClear ? $host.find(".rdt-pj-wrapper") : $();
    var safeRates = Array.isArray(rates)
      ? rates.filter(function (rate) {
          return !!String((rate && rate.shipCode) || "").trim();
        })
      : [];
    var showRates = !!opts.showRates;
    var isLoading = !!opts.loading;
    var selectedShipCode =
      state && state.selection ? String(state.selection.shipCode || "") : "";

    var $selects = $(
      ".order-wizard-shipmethod-module-option-select[data-action='select-delivery-option'], " +
        ".order-wizard-shipmethod-module-option-select"
    );
    var nativeShipmethodValue = String($selects.first().val() || "").trim();

    var continueEnabled =
      !!nativeShipmethodValue &&
      !(state && state.flags && state.flags.selectionApplying);

    if (!deferClear) {
      clear($host);
    }

    if (!safeRates.length && state?.flags?.truckloadRequired) {
      renderTruckloadNotice($host);

      setContinueButtonState(false);
      return;
    }
    $selects.addClass("rdt-pj-native-hidden").attr("aria-hidden", "true");

    var $accessorialWrapper = $("<div/>").addClass(
      "rdt-pj-wrapper rdt-pj-accessorials-wrapper"
    );
    var $btn = $("<button/>")
      .addClass("rdt-pj-rates-toggle-btn")
      .attr("type", "button")
      .prop("disabled", isLoading)
      .text(
        showRates
          ? isLoading
            ? "Updating Shipping Rates..."
            : "Update Shipping Rates"
          : isLoading
            ? "Loading Shipping Rates..."
            : "Show Shipping Rates"
      );

    $btn.on("click", function () {
      emitSelect({ showRates: true });
    });

    syncRatesButtonState($btn);

    $accessorialWrapper.append(renderAccessorials()).append($btn);

    var ratesUi = null;
    if (showRates && safeRates.length) {
      ratesUi = buildRatesWrapper(safeRates, state, selectedShipCode);
      if (!ratesUi) {
        clear($host);
        $selects
          .removeClass("rdt-pj-native-hidden")
          .attr("aria-hidden", "false");
        setContinueButtonState(continueEnabled);
        return;
      }
    }

    var $title = getHostTitleEl($host);
    if ($title.length) {
      if (ratesUi && ratesUi.wrapper) {
        $title.after(ratesUi.wrapper);
        ratesUi.wrapper.before($accessorialWrapper);
      } else {
        $title.after($accessorialWrapper);
      }
    } else {
      $host.append($accessorialWrapper);
      if (ratesUi && ratesUi.wrapper) {
        $host.append(ratesUi.wrapper);
      }
    }

    if (deferClear && $oldWrappers.length) {
      $oldWrappers.remove();
    }

    if (!showRates || !ratesUi || !ratesUi.wrapper) {
      setContinueButtonState(continueEnabled);
      return;
    }

    ratesUi.tbody.off("click.rdtpj keydown.rdtpj");

    ratesUi.tbody.on("click.rdtpj", ".rdt-pj-row", function (e) {
      e.preventDefault();

      var $row = $(this);

      ratesUi.tbody
        .find(".rdt-pj-row")
        .removeClass("rdt-pj-row--selected rdt-row--open")
        .attr("aria-checked", "false");

      $row.addClass("rdt-pj-row--selected").attr("aria-checked", "true");
      setContinueButtonState(false);

      var shipCode = $row.attr("data-shipcode") || "";
      var cost = Number($row.attr("data-cost") || 0);

      emitSelect({
        shipCode: shipCode,
        cost: cost,
        accessorialDelta: Number($row.attr("data-accessorial-delta") || 0),
        carrier: $row.attr("data-carrier") || "",
        service: $row.attr("data-service") || "",
        transitDays: $row.attr("data-transit-days") || "",
        estimatedArrivalDate: $row.attr("data-estimated-arrival-date") || "",
        origins: $row.data("origins") || []
      });
    });

    ratesUi.tbody.on("keydown.rdtpj", ".rdt-pj-row", function (e) {
      if (e.key === "Enter" || e.key === " " || e.code === "Space") {
        e.preventDefault();
        $(this).trigger("click");
      }
    });
  }

  function updateAccessorials() {
    var $wrap = $(".rdt-pj-accessorials-wrapper").first();
    if (!$wrap.length) return;

    syncAccessorialStateFromStore();

    var $btn = $wrap.find(".rdt-pj-rates-toggle-btn").detach();
    var before = jQuery.extend({}, accessorialState);

    $wrap.empty().append(renderAccessorials()).append($btn);

    var changed = false;
    Object.keys(before).forEach(function (k) {
      if (!!before[k] !== !!accessorialState[k]) changed = true;
    });

    if (changed) {
      emitSelect({ accessorials: jQuery.extend({}, accessorialState) });
    }
  }

  function isReviewStep() {
    return (window.location.hash || "").toLowerCase().indexOf("review") !== -1;
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

  function getOrderSummaryShipping(order) {
    var summary;

    if (!order || !order.get) {
      return 0;
    }

    summary = order.get("summary") || {};
    return (
      Number(
        summary.shipping ||
          summary.shippingcost ||
          summary.shippingCost ||
          summary.estimatedshipping ||
          0
      ) || 0
    );
  }

  function getReviewRate(order) {
    var persistence =
      PacejetState && PacejetState.getPersistenceResult
        ? PacejetState.getPersistenceResult()
        : null;
    var selectedRate =
      PacejetState && PacejetState.getSelectedRate
        ? PacejetState.getSelectedRate()
        : null;
    var shipmethodId = getShipmethodId(
      order && order.get ? order.get("shipmethod") : ""
    );

    if (
      persistence &&
      persistence.saved &&
      getShipmethodId(persistence.shipmethod) === shipmethodId
    ) {
      return {
        shipmethod: shipmethodId,
        carrier: persistence.carrier || "Pacejet",
        service: persistence.service || "Selected shipping service",
        amount:
          persistence.totals &&
          persistence.totals.shipping !== undefined &&
          persistence.totals.shipping !== null
            ? persistence.totals.shipping
            : getOrderSummaryShipping(order),
        transitDays: persistence.transitDays || ""
      };
    }

    if (
      selectedRate &&
      getShipmethodId(selectedRate.shipmethod) === shipmethodId
    ) {
      return {
        shipmethod: shipmethodId,
        carrier: selectedRate.carrier || "Pacejet",
        service: selectedRate.service || "Selected shipping service",
        amount:
          selectedRate.amount !== undefined && selectedRate.amount !== null
            ? selectedRate.amount
            : getOrderSummaryShipping(order),
        transitDays: selectedRate.transitDays || ""
      };
    }

    if (!shipmethodId) {
      return null;
    }

    return {
      shipmethod: shipmethodId,
      carrier: "Pacejet",
      service: "Selected shipping service",
      amount: getOrderSummaryShipping(order),
      transitDays: ""
    };
  }

  function clearReviewSelection() {
    $(".rdt-mui-shipping-card").remove();
    $(
      ".order-wizard-showshipments-module-shipping-details-method, " +
        ".order-wizard-showshipments-actionable-module-shipping-details-method"
    )
      .removeClass("rdt-mui-native-hidden")
      .find("select")
      .removeClass("rdt-mui-native-hidden");
  }

  function buildReviewCard(rate) {
    var carrier = rate.carrier || "Pacejet";
    var service = rate.service || "Selected shipping service";
    var transitDays = getEta(rate);
    var chipText = transitDays ? carrier + " - " + transitDays : carrier;
    var $card = $("<div/>").addClass("rdt-mui-shipping-card");
    var $left = $("<div/>").addClass("rdt-mui-shipping-left");
    var $changeBtn = $("<button/>", {
      type: "button",
      text: "Change"
    }).addClass("rdt-mui-change-btn");

    $left.append($("<span/>").addClass("rdt-mui-chip").text(chipText));
    $left.append($("<div/>").addClass("rdt-mui-service").text(service));
    $card.append($left);
    $card.append(
      $("<div/>").addClass("rdt-mui-price").text(fmtMoney(rate.amount))
    );
    $card.append($changeBtn);

    $changeBtn.on("click", function (e) {
      e.preventDefault();
      window.location.hash = "#shipping/address";
    });

    return $card;
  }

  function renderReviewSelection(order) {
    var reviewRate = getReviewRate(order);
    var $method = $(
      ".order-wizard-showshipments-module-shipping-details-method, " +
        ".order-wizard-showshipments-actionable-module-shipping-details-method"
    ).first();

    if (
      !isReviewStep() ||
      !$method.length ||
      !reviewRate ||
      !reviewRate.shipmethod
    ) {
      clearReviewSelection();
      return;
    }

    $method.addClass("rdt-mui-native-hidden");
    $method.find("select").addClass("rdt-mui-native-hidden");

    var $existing = $method.siblings(".rdt-mui-shipping-card").first();
    var $card = buildReviewCard(reviewRate);

    if ($existing.length) {
      $existing.replaceWith($card);
    } else {
      $method.after($card);
    }
  }

  return {
    render: render,
    showLoading: showLoading,
    clear: clear,
    onSelect: onSelect,
    updateAccessorials: updateAccessorials,
    setContinueButtonState: setContinueButtonState,
    renderReviewSelection: renderReviewSelection,
    clearReviewSelection: clearReviewSelection
  };
});
