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

  // Replace with your actual email template internal ID
  var EMAIL_TEMPLATE_ID = 196;

  // Replace with an employee internal ID that can send the email
  var EMAIL_AUTHOR_ID = 33415;

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

    var reasons = [];

    if (!emailReady) {
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

  function sendOrderEmail(soId, customerEmail) {
    var mergeResult = render.mergeEmail({
      templateId: EMAIL_TEMPLATE_ID,
      transactionId: soId
    });

    email.send({
      author: EMAIL_AUTHOR_ID,
      recipients: customerEmail,
      replyTo: "info@curecrete.com",
      subject: mergeResult.subject,
      body: mergeResult.body,
      relatedRecords: {
        transactionId: soId
      }
    });

    return mergeResult;
  }

  function afterSubmit(context) {
    try {
      if (
        context.type !== context.UserEventType.CREATE &&
        context.type !== context.UserEventType.EDIT
      ) {
        return;
      }

      if (context.newRecord.type !== record.Type.SALES_ORDER) {
        return;
      }

      var soId = context.newRecord.id;
      if (!soId) {
        return;
      }

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
        markStatus(soId, {
          [FIELD_EMAIL_READY]: false,
          [FIELD_EMAIL_ERROR]: "Not a web order"
        });
        return;
      }

      if (eligibility.alreadySent) {
        return;
      }

      if (!eligibility.readiness.snapshot.emailReady) {
        return;
      }

      if (!eligibility.readiness.ready) {
        markStatus(soId, {
          [FIELD_EMAIL_READY]: false,
          [FIELD_EMAIL_ERROR]: eligibility.readiness.reasons.join(" | ")
        });
        return;
      }

      var customerEmail = eligibility.readiness.snapshot.customerEmail;
      if (!customerEmail) {
        markStatus(soId, {
          [FIELD_EMAIL_READY]: false,
          [FIELD_EMAIL_ERROR]: "Missing customer email on Sales Order"
        });
        return;
      }

      var merged = sendOrderEmail(soId, customerEmail);

      markStatus(soId, {
        [FIELD_EMAIL_SENT]: true,
        [FIELD_EMAIL_READY]: true,
        [FIELD_EMAIL_ERROR]: ""
      });

      log.audit({
        title: "SO email sent",
        details: {
          soId: soId,
          subject: merged.subject
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
