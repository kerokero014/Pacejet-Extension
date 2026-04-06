/// <amd-module name="RDT.Pacejet.State"/>

define("RDT.Pacejet.State", [], function () {
  "use strict";

  var NONE_ACCESSORIAL_ID = "none_additional_fees_may_app";

  function clone(value) {
    var key;
    var copy;

    if (!value || typeof value !== "object") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map(clone);
    }

    copy = {};

    for (key in value) {
      if (value.hasOwnProperty(key)) {
        copy[key] = clone(value[key]);
      }
    }

    return copy;
  }

  var state = {
    cache: {
      lastHash: null,
      lastRates: null
    },

    selection: {
      shipCode: null,
      carrier: null,
      service: null,
      cost: null,
      transitDays: null,
      origins: [],
      accessorials: {},
      forcedAccessorials: {}
    },

    flags: {
      suppressRefresh: false,
      autoselectDone: false,
      truckloadRequired: false,
      accessorialsDirty: false,
      ratesVisible: false,
      ratesLoading: false,
      selectionApplying: false,
      persistencePending: false
    },

    unmappedRates: [],
    fallbackRates: [],
    selectedRate: null,
    persistence: {
      saved: false,
      error: "",
      orderId: null,
      shipmethod: null,
      pacejetAmount: null,
      carrier: null,
      service: null,
      transitDays: null,
      totals: null
    }
  };

  return {
    get: function () {
      return state;
    },

    setAccessorials: function (acc) {
      var selection =
        acc && typeof acc === "object" && !Array.isArray(acc) ? clone(acc) : {};
      var forced = clone(state.selection.forcedAccessorials || {});

      Object.keys(forced).forEach(function (key) {
        if (forced[key]) {
          selection[key] = true;
        }
      });

      if (Object.keys(forced).some(function (key) { return forced[key]; })) {
        selection[NONE_ACCESSORIAL_ID] = false;
      }

      state.selection.accessorials = selection;
    },

    setForcedAccessorials: function (acc) {
      var forced =
        acc && typeof acc === "object" && !Array.isArray(acc) ? clone(acc) : {};

      state.selection.forcedAccessorials = forced;
      this.setAccessorials(state.selection.accessorials);
    },

    getForcedAccessorials: function () {
      return clone(state.selection.forcedAccessorials || {});
    },

    setSelectedRate: function (rate) {
      state.selectedRate = rate && typeof rate === "object" ? clone(rate) : null;
      return this.getSelectedRate();
    },

    getSelectedRate: function () {
      return state.selectedRate ? clone(state.selectedRate) : null;
    },

    clearSelectedRate: function () {
      state.selectedRate = null;
    },

    setPersistencePending: function (pending) {
      state.flags.persistencePending = !!pending;
    },

    setPersistenceResult: function (result) {
      var data = result && typeof result === "object" ? clone(result) : {};

      state.persistence = {
        saved: !!data.saved,
        error: data.error ? String(data.error) : "",
        orderId:
          data.orderId === 0 || data.orderId ? String(data.orderId) : null,
        shipmethod: data.shipmethod || null,
        pacejetAmount:
          data.pacejetAmount === 0 || data.pacejetAmount
            ? Number(data.pacejetAmount)
            : null,
        carrier: data.carrier || null,
        service: data.service || null,
        transitDays: data.transitDays || null,
        totals: data.totals && typeof data.totals === "object" ? data.totals : null
      };
    },

    getPersistenceResult: function () {
      return clone(state.persistence);
    },

    clearPersistenceResult: function () {
      state.persistence = {
        saved: false,
        error: "",
        orderId: null,
        shipmethod: null,
        pacejetAmount: null,
        carrier: null,
        service: null,
        transitDays: null,
        totals: null
      };
      state.flags.persistencePending = false;
    },

    recordUnmapped: function (info) {
      var carrier = info && info.carrier ? info.carrier : "";
      var service = info && info.service ? info.service : "";

      var exists = state.unmappedRates.some(function (r) {
        return r.carrier === carrier && r.service === service;
      });

      if (exists) return;

      state.unmappedRates.push({
        time: Date.now(),
        carrier: carrier,
        service: service,
        raw: info && info.raw ? info.raw : null
      });
    },

    recordFallback: function (info) {
      var carrier = info && info.carrier ? info.carrier : "";
      var service = info && info.service ? info.service : "";
      var shipCode = info && info.shipCode ? info.shipCode : "";

      var exists = state.fallbackRates.some(function (r) {
        return (
          r.carrier === carrier &&
          r.service === service &&
          r.shipCode === shipCode
        );
      });

      if (exists) return;

      state.fallbackRates.push({
        time: Date.now(),
        carrier: carrier,
        service: service,
        shipCode: shipCode
      });
    },

    clearObservability: function () {
      state.unmappedRates = [];
      state.fallbackRates = [];
    },

    resetSelection: function () {
      state.selection = {
        shipCode: null,
        carrier: null,
        service: null,
        cost: null,
        transitDays: null,
        origins: [],
        accessorials: {},
        forcedAccessorials: {}
      };

      state.selectedRate = null;
      state.flags.accessorialsDirty = false;
      state.flags.ratesVisible = false;
      state.flags.ratesLoading = false;
      state.flags.persistencePending = false;
      state.persistence = {
        saved: false,
        error: "",
        orderId: null,
        shipmethod: null,
        pacejetAmount: null,
        carrier: null,
        service: null,
        transitDays: null,
        totals: null
      };
    }
  };
});
