/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define([
  "N/record",
  "N/runtime",
  "N/search",
  "N/render",
  "N/email",
  "N/log"
], function (record, runtime, search, render, email, log) {
  "use strict";

  var FIELD_EMAIL_SENT = "custbody_rdt_order_email_sent";
  var FIELD_EMAIL_ERROR = "custbody_rdt_order_email_error";
  var FIELD_EMAIL_READY = "custbody_rdt_order_email_ready";

  var FIELD_PJ_AMOUNT = "custbody_rdt_pacejet_amount";
  var FIELD_PJ_CARRIER = "custbody_rdt_pj_carrier_name";
  var FIELD_PJ_SERVICE = "custbody_rdt_pj_service_name";
  var FIELD_PJ_ORIGIN = "custbody_rdt_pj_origin_key";
  var FIELD_PJ_TRANSIT = "custbody_rdt_pj_transit_days";
  var FIELD_PJ_EST_ARRIVAL = "custbody_rdt_pj_est_arrival_date";
  var FIELD_PJ_QUOTE_JSON = "custbody_rdt_pj_quote_json";

  // Replace with an employee internal ID that can send the email
  // var EMAIL_AUTHOR_ID = 33415; // Kevin ID for testing --- IGNORE ---
  var EMAIL_AUTHOR_ID = 23827; // Customer Suppport ID for production

  // Optional: restrict only to your web source text
  var WEB_SOURCE_TEXT = "Web (Curecrete Distribution, Inc.)";

  function asNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback || 0;
  }

  function asString(value) {
    return value == null ? "" : String(value).trim();
  }

  function asBool(value) {
    return value === true || value === "T" || value === "true" || value === "1";
  }

  function getEventType(context) {
    return asString(context && context.type).toLowerCase();
  }

  function isSupportedEvent(context) {
    var eventType = getEventType(context);
    return (
      eventType === "create" || eventType === "edit" || eventType === "xedit"
    );
  }

  function getTextSafe(rec, fieldId) {
    try {
      return rec.getText({ fieldId: fieldId }) || "";
    } catch (e) {
      return "";
    }
  }

  function getValueSafe(rec, fieldId) {
    try {
      return rec.getValue({ fieldId: fieldId });
    } catch (e) {
      return null;
    }
  }

  function isWebOrder(rec) {
    var sourceText =
      getTextSafe(rec, "source") || getTextSafe(rec, "custbody_source") || "";

    if (!sourceText) {
      // Keep permissive if source text is not exposed in this account
      return true;
    }

    return sourceText.indexOf(WEB_SOURCE_TEXT) !== -1;
  }

  function isWillCallOrZeroShipAllowed(rec) {
    var shipMethodText = getTextSafe(rec, "shipmethod").toUpperCase();

    return (
      shipMethodText.indexOf("WILL CALL") !== -1 ||
      shipMethodText.indexOf("PICKUP") !== -1 ||
      shipMethodText.indexOf("EXW") !== -1
    );
  }

  function hasPacejetData(rec) {
    return !!(
      asString(getValueSafe(rec, FIELD_PJ_AMOUNT)) ||
      asString(getValueSafe(rec, FIELD_PJ_CARRIER)) ||
      asString(getValueSafe(rec, FIELD_PJ_SERVICE)) ||
      asString(getValueSafe(rec, FIELD_PJ_QUOTE_JSON))
    );
  }

  function getCustomerEmail(rec) {
    var emailValue = asString(getValueSafe(rec, "email"));
    if (emailValue) {
      return emailValue;
    }

    var entityId = getValueSafe(rec, "entity");
    if (!entityId) {
      return "";
    }

    var result = search.lookupFields({
      type: search.Type.CUSTOMER,
      id: entityId,
      columns: ["email"]
    });

    return asString(result && result.email);
  }

  function getOrderReadiness(rec) {
    var shippingCost = asNumber(getValueSafe(rec, "shippingcost"), 0);
    var taxTotal = asNumber(getValueSafe(rec, "taxtotal"), 0);
    var total = asNumber(getValueSafe(rec, "total"), 0);
    var subtotal = asNumber(getValueSafe(rec, "subtotal"), 0);
    var shipmethod = getValueSafe(rec, "shipmethod");
    var pacejetAmount = asNumber(getValueSafe(rec, FIELD_PJ_AMOUNT), 0);
    var customerEmail = getCustomerEmail(rec);
    var zeroShipAllowed = isWillCallOrZeroShipAllowed(rec);
    var pacejetPresent = hasPacejetData(rec);
    var emailReady = asBool(getValueSafe(rec, FIELD_EMAIL_READY));
    var pacejetPersisted =
      pacejetPresent && pacejetAmount > 0 && shippingCost > 0 && total > 0;

    var reasons = [];

    if (!emailReady && !pacejetPersisted) {
      reasons.push("Waiting for Pacejet persistence to mark email ready");
    }

    if (!customerEmail) {
      reasons.push("No customer email");
    }

    if (!shipmethod) {
      reasons.push("No shipmethod yet");
    }

    if (subtotal <= 0 && total <= 0) {
      reasons.push("Totals not populated yet");
    }

    if (total <= 0) {
      reasons.push("Order total is not finalized");
    }

    if (!zeroShipAllowed) {
      if (shippingCost <= 0 && pacejetAmount <= 0 && pacejetPresent) {
        reasons.push("Freight order still has zero shipping");
      }

      if (pacejetPresent && pacejetAmount > 0 && shippingCost <= 0) {
        reasons.push("Pacejet amount exists but SO shippingcost is still zero");
      }
    }

    return {
      ready: reasons.length === 0,
      reasons: reasons,
      snapshot: {
        shippingCost: shippingCost,
        taxTotal: taxTotal,
        total: total,
        subtotal: subtotal,
        shipmethod: shipmethod,
        pacejetAmount: pacejetAmount,
        pacejetPresent: pacejetPresent,
        pacejetPersisted: pacejetPersisted,
        zeroShipAllowed: zeroShipAllowed,
        emailReady: emailReady,
        customerEmail: customerEmail
      }
    };
  }

  function canAttemptSend(rec) {
    var webOrder = isWebOrder(rec);
    var alreadySent = asBool(getValueSafe(rec, FIELD_EMAIL_SENT));
    var readiness = getOrderReadiness(rec);

    return {
      ok: webOrder && !alreadySent && readiness.ready,
      webOrder: webOrder,
      alreadySent: alreadySent,
      readiness: readiness
    };
  }

  function markStatus(soId, values) {
    log.debug({
      title: "SO email status update",
      details: {
        soId: soId,
        values: values
      }
    });

    record.submitFields({
      type: record.Type.SALES_ORDER,
      id: soId,
      values: values,
      options: {
        enableSourcing: false,
        ignoreMandatoryFields: true
      }
    });
  }

  function logSkip(soId, reason, details) {
    log.audit({
      title: "SO email skipped",
      details: {
        soId: soId,
        reason: reason,
        details: details || {}
      }
    });
  }

  function escapeHtml(value) {
    return asString(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatMoney(value) {
    return "$" + asNumber(value, 0).toFixed(2);
  }

  function getSublistValueSafe(rec, sublistId, fieldId, line) {
    try {
      return rec.getSublistValue({
        sublistId: sublistId,
        fieldId: fieldId,
        line: line
      });
    } catch (e) {
      return "";
    }
  }

  function getSublistTextSafe(rec, sublistId, fieldId, line) {
    try {
      return rec.getSublistText({
        sublistId: sublistId,
        fieldId: fieldId,
        line: line
      });
    } catch (e) {
      return "";
    }
  }

  function getItemRows(rec) {
    var rows = [];
    var count = 0;
    var i;

    try {
      count = rec.getLineCount({ sublistId: "item" }) || 0;
    } catch (e) {
      count = 0;
    }

    for (i = 0; i < count; i++) {
      rows.push({
        item:
          getSublistTextSafe(rec, "item", "item", i) ||
          getSublistValueSafe(rec, "item", "item", i),
        description: getSublistValueSafe(rec, "item", "description", i),
        quantity: getSublistValueSafe(rec, "item", "quantity", i),
        rate: getSublistValueSafe(rec, "item", "rate", i),
        amount: getSublistValueSafe(rec, "item", "amount", i)
      });
    }

    return rows;
  }

  function buildOrderEmailBody(rec) {
    var tranid = asString(getValueSafe(rec, "tranid"));
    var customerName = getTextSafe(rec, "entity") || "Customer";
    var shipMethod = getTextSafe(rec, "shipmethod");

    var subtotal = getValueSafe(rec, "subtotal");
    var shipping = getValueSafe(rec, "shippingcost");
    var tax = getValueSafe(rec, "taxtotal");
    var total = getValueSafe(rec, "total");
    var discount = getValueSafe(rec, "discounttotal") || 0;

    var shipAddress = asString(getValueSafe(rec, "shipaddress"));
    var billAddress = asString(getValueSafe(rec, "billaddress"));

    var rows = getItemRows(rec);

    var itemRows = rows
      .map(function (line) {
        return (
          "<tr>" +
          "<td style='padding:12px;border-bottom:1px solid #eee;'>" +
          "<strong>" +
          escapeHtml(line.item) +
          "</strong><br>" +
          "<span style='color:#6b7280;font-size:12px;'>" +
          escapeHtml(line.description) +
          "</span>" +
          "</td>" +
          "<td style='padding:12px;text-align:center;border-bottom:1px solid #eee;'>" +
          escapeHtml(line.quantity) +
          "</td>" +
          "<td style='padding:12px;text-align:right;border-bottom:1px solid #eee;'>" +
          formatMoney(line.rate) +
          "</td>" +
          "<td style='padding:12px;text-align:right;border-bottom:1px solid #eee;'><strong>" +
          formatMoney(line.amount) +
          "</strong></td>" +
          "</tr>"
        );
      })
      .join("");

    return (
      "<div style='background:#f3f4f6;padding:30px;font-family:Arial,sans-serif;'>" +
      "<div style='max-width:720px;margin:auto;background:#ffffff;border-radius:10px;padding:28px;border:1px solid #e5e7eb;'>" +
      "<h2 style='margin:0;color:#111827;'>Order Received</h2>" +
      "<p style='color:#6b7280;margin-top:4px;font-size:small;'>Order number <strong>" +
      escapeHtml(tranid) +
      "</strong></p>" +
      "<p style='margin-top:20px;font-size: large;font-weight: 600;'>Dear " +
      escapeHtml(customerName) +
      ",</p>" +
      "<p style='line-height:1.6;color:#374151;font-size:medium;'>" +
      "Thank you for shopping at " +
      "<a href='https://buy.curecrete.com' style='color:#2563eb;text-decoration:none;font-weight:600;'>Curecrete Distribution, Inc.</a>" +
      ". Please find all the order details below and have a nice day.<br>" +
      "<span style='color:#6b7280;'>- Curecrete Distribution, Inc.</span>" +
      "</p>" +
      "<h3 style='margin-top:28px;border-bottom:1px solid #e5e7eb;padding-bottom:8px;color:#111827;'>Order Summary</h3>" +
      "<table style='width:100%;border-collapse:collapse;margin-top:12px;font-size:14px;'>" +
      "<thead>" +
      "<tr style='background:#f9fafb;color:#6b7280;text-transform:uppercase;font-size:12px;'>" +
      "<th style='padding:10px;text-align:left;'>Item</th>" +
      "<th style='padding:10px;text-align:center;'>Qty</th>" +
      "<th style='padding:10px;text-align:right;'>Price</th>" +
      "<th style='padding:10px;text-align:right;'>Total</th>" +
      "</tr>" +
      "</thead>" +
      "<tbody>" +
      itemRows +
      "</tbody>" +
      "</table>" +
      "<table style='width:100%;margin-top:20px;border-collapse:collapse;font-size:14px;'>" +
      "<tr><td style='padding:6px;color:#6b7280;'>Subtotal</td><td style='text-align:right;'>" +
      formatMoney(subtotal) +
      "</td></tr>" +
      "<tr><td style='padding:6px;color:#6b7280;'>Discount</td><td style='text-align:right;'>" +
      formatMoney(discount) +
      "</td></tr>" +
      "<tr><td style='padding:6px;color:#6b7280;'>Shipping</td><td style='text-align:right;'>" +
      formatMoney(shipping) +
      "</td></tr>" +
      "<tr><td style='padding:6px;color:#6b7280;'>Tax</td><td style='text-align:right;'>" +
      formatMoney(tax) +
      "</td></tr>" +
      "<tr>" +
      "<td style='padding:10px;border-top:2px solid #e5e7eb;font-weight:bold;'>TOTAL</td>" +
      "<td style='text-align:right;border-top:2px solid #e5e7eb;font-weight:bold;'>" +
      formatMoney(total) +
      "</td>" +
      "</tr>" +
      "</table>" +
      "<div style='display:flex;gap:20px;margin-top:28px;flex-wrap:wrap;'>" +
      "<div style='flex:1;min-width:260px;'>" +
      "<h4 style='margin-bottom:6px;color:#111827;'>Shipping</h4>" +
      "<div style='color:#374151;font-size:14px;white-space:pre-line;'>" +
      escapeHtml(shipAddress) +
      "</div>" +
      "<p style='margin-top:8px;font-size:14px;'><strong>Method:</strong> " +
      escapeHtml(shipMethod) +
      "</p>" +
      "</div>" +
      "<div style='flex:1;min-width:260px;'>" +
      "<h4 style='margin-bottom:6px;color:#111827;'>Bill To</h4>" +
      "<div style='color:#374151;font-size:14px;white-space:pre-line;'>" +
      escapeHtml(billAddress) +
      "</div>" +
      "</div>" +
      "</div>" +
      "<p style='margin-top:30px;font-size:13px;color:#6b7280;'>" +
      "If you are a registered customer, you can log in to see your order status." +
      "</p>" +
      "</div>" +
      "</div>"
    );
  }

  function buildTransactionPdf(soId) {
    try {
      return render.transaction({
        entityId: Number(soId),
        printMode: render.PrintMode.PDF
      });
    } catch (e) {
      log.error({
        title: "SO email PDF render failed",
        details: {
          soId: soId,
          name: e.name,
          message: e.message || String(e)
        }
      });
      return null;
    }
  }

  function sendOrderEmail(soId, customerEmail, soRec) {
    var tranid = asString(getValueSafe(soRec, "tranid"));
    var subject = "Order Received " + tranid + "has been received";
    var body = buildOrderEmailBody(soRec);
    var pdf = buildTransactionPdf(soId);
    var emailPayload = {
      author: EMAIL_AUTHOR_ID,
      recipients: customerEmail,
      replyTo: "info@curecrete.com",
      subject: subject,
      body: body,
      relatedRecords: {
        transactionId: soId
      }
    };

    if (pdf) {
      emailPayload.attachments = [pdf];
    }

    log.audit({
      title: "SO email send start",
      details: {
        soId: soId,
        authorId: EMAIL_AUTHOR_ID,
        recipient: customerEmail,
        subject: subject,
        hasPdfAttachment: !!pdf
      }
    });

    email.send(emailPayload);

    return {
      subject: subject
    };
  }

  function afterSubmit(context) {
    try {
      var eventType = getEventType(context);

      if (!isSupportedEvent(context)) {
        log.debug({
          title: "SO email ignored event",
          details: {
            eventType: eventType,
            executionContext: runtime.executionContext
          }
        });
        return;
      }

      if (context.newRecord.type !== record.Type.SALES_ORDER) {
        log.debug({
          title: "SO email ignored record type",
          details: {
            recordType: context.newRecord.type,
            eventType: eventType,
            executionContext: runtime.executionContext
          }
        });
        return;
      }

      var soId = context.newRecord.id;
      if (!soId) {
        log.debug({
          title: "SO email skipped",
          details: {
            reason: "No Sales Order internal ID",
            eventType: eventType,
            executionContext: runtime.executionContext
          }
        });
        return;
      }

      log.audit({
        title: "SO email afterSubmit start",
        details: {
          soId: soId,
          eventType: eventType,
          executionContext: runtime.executionContext
        }
      });

      var soRec = record.load({
        type: record.Type.SALES_ORDER,
        id: soId,
        isDynamic: false
      });

      var eligibility = canAttemptSend(soRec);

      log.audit({
        title: "SO email eligibility",
        details: {
          soId: soId,
          canSend: eligibility.ok,
          webOrder: eligibility.webOrder,
          alreadySent: eligibility.alreadySent,
          ready: eligibility.readiness.ready,
          reasons: eligibility.readiness.reasons,
          snapshot: eligibility.readiness.snapshot
        }
      });

      if (!eligibility.webOrder) {
        logSkip(soId, "Not a web order", {
          eventType: eventType,
          source:
            getTextSafe(soRec, "source") ||
            getTextSafe(soRec, "custbody_source")
        });

        markStatus(soId, {
          [FIELD_EMAIL_READY]: false,
          [FIELD_EMAIL_ERROR]: "Not a web order"
        });
        return;
      }

      if (eligibility.alreadySent) {
        logSkip(soId, "Email already sent", {
          eventType: eventType,
          snapshot: eligibility.readiness.snapshot
        });
        return;
      }

      if (
        !eligibility.readiness.snapshot.emailReady &&
        !eligibility.readiness.snapshot.pacejetPersisted
      ) {
        logSkip(soId, "Waiting for Pacejet ready flag", {
          eventType: eventType,
          reasons: eligibility.readiness.reasons,
          snapshot: eligibility.readiness.snapshot
        });
        return;
      }

      if (!eligibility.readiness.ready) {
        logSkip(soId, "Order is not email-ready", {
          eventType: eventType,
          reasons: eligibility.readiness.reasons,
          snapshot: eligibility.readiness.snapshot
        });

        markStatus(soId, {
          [FIELD_EMAIL_READY]: false,
          [FIELD_EMAIL_ERROR]: eligibility.readiness.reasons.join(" | ")
        });
        return;
      }

      var customerEmail = eligibility.readiness.snapshot.customerEmail;
      if (!customerEmail) {
        logSkip(soId, "Missing customer email", {
          eventType: eventType,
          snapshot: eligibility.readiness.snapshot
        });

        markStatus(soId, {
          [FIELD_EMAIL_READY]: false,
          [FIELD_EMAIL_ERROR]: "Missing customer email on Sales Order"
        });
        return;
      }

      if (
        !eligibility.readiness.snapshot.emailReady &&
        eligibility.readiness.snapshot.pacejetPersisted
      ) {
        log.audit({
          title: "SO email using Pacejet persisted fallback",
          details: {
            soId: soId,
            eventType: eventType,
            executionContext: runtime.executionContext,
            snapshot: eligibility.readiness.snapshot
          }
        });
      }

      var sentEmail = sendOrderEmail(soId, customerEmail, soRec);

      markStatus(soId, {
        [FIELD_EMAIL_SENT]: true,
        [FIELD_EMAIL_READY]: true,
        [FIELD_EMAIL_ERROR]: ""
      });

      log.audit({
        title: "SO email sent",
        details: {
          soId: soId,
          subject: sentEmail.subject,
          recipient: customerEmail,
          eventType: eventType,
          executionContext: runtime.executionContext
        }
      });
    } catch (e) {
      log.error({
        title: "SO email afterSubmit error",
        details: e
      });

      try {
        if (context && context.newRecord && context.newRecord.id) {
          markStatus(context.newRecord.id, {
            [FIELD_EMAIL_READY]: false,
            [FIELD_EMAIL_ERROR]: e && e.message ? e.message : String(e)
          });
        }
      } catch (inner) {
        log.error({
          title: "SO email error logging failed",
          details: inner
        });
      }
    }
  }

  return {
    afterSubmit: afterSubmit
  };
});
