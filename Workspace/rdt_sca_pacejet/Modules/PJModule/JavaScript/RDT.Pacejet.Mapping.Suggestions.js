/// <amd-module name="RDT.Pacejet.Mapping.Suggestions"/>

define("RDT.Pacejet.Mapping.Suggestions", ["RDT.Pacejet.State"], function (
  PacejetState
) {
  "use strict";

  function norm(t) {
    return String(t || "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildKey(carrier, service) {
    return norm(carrier) + "|" + norm(service);
  }

  function suggestRule(entry) {
    var words = norm(entry.service).split(" ");
    return {
      carrier: norm(entry.carrier),
      serviceIncludes: words.slice(0, Math.min(4, words.length)).join(" "),
      shipCode: "????" // ← you decide
    };
  }

  function buildSuggestions() {
    var state = PacejetState.get();
    var map = {};

    var all = []
      .concat(state.unmappedRates || [])
      .concat(state.fallbackRates || []);

    for (var i = 0; i < all.length; i++) {
      var e = all[i] || {};
      if (!e.carrier || !e.service) continue;

      var key = buildKey(e.carrier, e.service);

      if (!map[key]) {
        map[key] = {
          carrier: norm(e.carrier),
          service: norm(e.service),
          count: 0,
          example: e
        };
      }

      map[key].count++;
    }

    var out = [];
    for (var k in map) {
      out.push({
        carrier: map[k].carrier,
        service: map[k].service,
        occurrences: map[k].count,
        suggestedRule: suggestRule(map[k])
      });
    }

    // Highest business impact first
    out.sort(function (a, b) {
      return b.occurrences - a.occurrences;
    });

    return out;
  }

  return {
    build: buildSuggestions
  };
});
