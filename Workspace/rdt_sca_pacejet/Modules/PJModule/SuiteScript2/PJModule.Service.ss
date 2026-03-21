function service(request, response) {
    "use strict";

    try {
        require("RDT.rdt_sca_pacejet.PJModule.ServiceController").handle(
            request,
            response
        );
    } catch (ex) {
        response.write(
            JSON.stringify({
                ok: false,
                error: ex && ex.message ? ex.message : String(ex)
            })
        );
    }
}
