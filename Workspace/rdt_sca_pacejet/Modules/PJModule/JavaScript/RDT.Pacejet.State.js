/// <amd-module name="RDT.Pacejet.State"/>

define("RDT.Pacejet.State", [], function () {
  "use strict";

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
      accessorials: {}
    },

    flags: {
      suppressRefresh: false,
      autoselectDone: false,
      truckloadRequired: false,
      accessorialsDirty: false,
      ratesVisible: false,
      ratesLoading: false
    },

    unmappedRates: [],
    fallbackRates: [],
    selectedRate: null
  };

  return {
    get: function () {
      return state;
    },

    setAccessorials: function (acc) {
      state.selection.accessorials =
        acc && typeof acc === "object" && !Array.isArray(acc) ? acc : {};
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
        accessorials: {}
      };

      state.selectedRate = null;
      state.flags.accessorialsDirty = false;
      state.flags.ratesVisible = false;
      state.flags.ratesLoading = false;
    }
  };
});
