/// <amd-module name="RDT.Pacejet.State"/>

define("RDT.Pacejet.State", [], function () {
  "use strict";

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
    fallbackRates: []
  };

  return {
    get: function () {
      return state;
    },

    setAccessorials: function (acc) {
      state.selection.accessorials = acc || {};
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

      state.flags.accessorialsDirty = false;
      state.flags.ratesVisible = false;
      state.flags.ratesLoading = false;
    }
  };
});
