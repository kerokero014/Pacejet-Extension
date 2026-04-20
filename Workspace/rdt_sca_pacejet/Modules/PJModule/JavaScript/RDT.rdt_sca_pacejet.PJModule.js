define("RDT.rdt_sca_pacejet.PJModule", [
  "RDT.Pacejet.Summary",
  "RDT.Pacejet.V2",
  "RDT.Pacejet.Surcharge.Hooks"
], function (PacejetSummary, PacejetV2, PacejetSurchargeHooks) {
  "use strict";

  return {
    mountToApp: function mountToApp(container) {
      if (PacejetSummary && PacejetSummary.mountToApp) {
        PacejetSummary.mountToApp(container);
      }

      if (PacejetSurchargeHooks && PacejetSurchargeHooks.mountToApp) {
        PacejetSurchargeHooks.mountToApp(container);
      }

      if (PacejetV2 && PacejetV2.mountToApp) {
        PacejetV2.mountToApp(container);
      }
    },
  };
});
