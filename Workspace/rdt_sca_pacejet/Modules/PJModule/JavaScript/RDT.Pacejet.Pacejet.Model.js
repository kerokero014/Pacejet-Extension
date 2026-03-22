define("RDT.Pacejet.Pacejet.Model", [
  "Backbone",
  "jQuery",
  "RDT.Pacejet.Config"
], function (Backbone, jQuery, Config) {
  "use strict";

  function getRatesUrl() {
    var baseUrl =
      String((Config && Config.getRatesUrl) || "").trim() ||
      "/app/site/hosting/scriptlet.nl?script=3954&deploy=1";
    var separator = baseUrl.indexOf("?") === -1 ? "?" : "&";

    return baseUrl + separator + "t=" + Date.now();
  }

  function buildRawRateRequest(payload) {
    var firstPayload =
      payload && payload.payload ? payload.payload : payload || {};

    return jQuery.extend(true, {}, firstPayload);
  }

  return Backbone.Model.extend({
    url: function () {
      return getRatesUrl();
    },

    fetchRates: function (payload) {
      var self = this;
      return jQuery
        .ajax({
          url: this.url(),
          type: "POST",
          contentType: "application/json",
          dataType: "json",
          data: JSON.stringify(buildRawRateRequest(payload))
        })
        .then(function (resp) {
          var first =
            (resp &&
              resp.modeResults &&
              resp.modeResults[0] &&
              resp.modeResults[0].resp) ||
            (resp && resp.origins ? resp : null);

          self.set(first || {});
          return first || {};
        });
    }
  });
});
