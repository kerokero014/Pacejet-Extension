define(["N/email", "N/render", "N/runtime", "N/record"], function (
  email,
  render,
  runtime,
  record
) {
  function afterSubmit(context) {
    if (
      context.type !== context.UserEventType.CREATE &&
      context.type !== context.UserEventType.EDIT
    ) {
      return;
    }

    var rec = context.newRecord;

    if (rec.type !== "salesorder") return;

    // GATE 1: must be ready
    if (!rec.getValue("custbody_rdt_order_email_ready")) {
      return;
    }

    // GATE 2: prevent duplicates
    if (rec.getValue("custbody_rdt_order_email_sent")) {
      return;
    }

    var pdf = render.transaction({
      entityId: rec.id,
      printMode: render.PrintMode.PDF
    });

    email.send({
      author: runtime.getCurrentUser().id,
      recipients: rec.getValue("email"),
      subject: "Order Received " + rec.getValue("tranid"),
      body: buildBody(rec),
      attachments: [pdf],
      relatedRecords: {
        transactionId: rec.id
      }
    });

    // Mark SENT
    record.submitFields({
      type: "salesorder",
      id: rec.id,
      values: {
        custbody_rdt_order_email_sent: true
      }
    });
  }

  function buildBody(rec) {
    return `
            Order Received

            Order #: ${rec.getValue("tranid")}

            Thank you for your order.
        `;
  }

  return {
    afterSubmit: afterSubmit
  };
});
