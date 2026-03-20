define("RDT.Pacejet.Pacejet.Model", [
  "Backbone",
  "RDT.Pacejet.Config"
], function (Backbone, Config) {
  "use strict";

  return Backbone.Model.extend({
    url: function () {
      // Suitelet URL
      return Config && Config.suiteletUrl
        ? Config.suiteletUrl
        : "/app/site/hosting/scriptlet.nl?script=3954&deploy=1";
    },

    fetchRates: function (payload) {
      var self = this;
      return jQuery
        .ajax({
          url: this.url(),
          type: "POST",
          contentType: "application/json",
          dataType: "json",
          data: JSON.stringify(payload)
        })
        .then(function (resp) {
          self.set(resp || {});
          return resp || {};
        });
    }
  });
});
