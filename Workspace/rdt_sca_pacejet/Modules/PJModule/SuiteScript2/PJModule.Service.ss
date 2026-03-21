/**
* @NApiVersion 2.x
* @NModuleScope Public
*/
define(["N/log"], function (log) {
    "use strict";
    return {
        service: function (ctx) {
            try {
                require("RDT.rdt_sca_pacejet.PJModule.ServiceController").handle(
                    ctx.request,
                    ctx.response
                );
            } catch (ex) {
                log.error({
                    title: "PJModule.Service.ss failed",
                    details: ex
                });
                ctx.response.write(
                    JSON.stringify({
                        ok: false,
                        error: ex && ex.message ? ex.message : String(ex)
                    })
                );
            }
        }
    };
});
