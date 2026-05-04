define(["N/log"], function (log) {
  function afterSubmit() {
    log.debug(
      "RDT Order READY skipped",
      "Email readiness is set by Test_SO_SL.js after Pacejet totals are saved."
    );
  }

  return {
    afterSubmit: afterSubmit
  };
});
