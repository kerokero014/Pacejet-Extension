// Model.js
// -----------------------
// @module Case
define("RDT.rdt_sca_pacejet.PJModule.SS2Model", ["Backbone", "Utils"], function(
    Backbone,
    Utils
) {
    "use strict";

    // @class Case.Fields.Model @extends Backbone.Model
    return Backbone.Model.extend({
        //@property {String} urlRoot
        urlRoot: Utils.getAbsoluteUrl(
            getExtensionAssetsPath(
                "services/PJModule.Service.ss"
            )
        )
});
});
