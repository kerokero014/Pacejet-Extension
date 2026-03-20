/**
* @NApiVersion 2.x
* @NModuleScope Public
*/
define(function () {
    "use strict";
    return {
        service: function (ctx) {
            ctx.response.write(JSON.stringify({message: 'Hello SS2 World!'}));
        }
    };
});
