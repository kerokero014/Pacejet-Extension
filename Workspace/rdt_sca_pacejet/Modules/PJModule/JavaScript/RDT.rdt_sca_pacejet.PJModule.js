define("RDT.rdt_sca_pacejet.PJModule", ["RDT.Pacejet.V2"], function (
  PacejetV2
) {
  "use strict";

  return {
    mountToApp: function mountToApp(container) {
      if (PacejetV2 && PacejetV2.mountToApp) {
        PacejetV2.mountToApp(container);
      }
    }
  };
});
