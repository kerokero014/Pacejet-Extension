/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @description Suitelet to update Sales Order shipping and Pacejet fields from Pacejet PostOrder
 */
define(["N/record", "N/log"], function (record, log) {
  function onRequest(context) {
    try {
      if (context.request.method !== "POST") {
        context.response.write(
          JSON.stringify({ ok: false, message: "POST only" }),
        );
        return;
      }

      var body = {};
      try {
        body = JSON.parse(context.request.body || "{}");
      } catch (e) {
        log.error("Pacejet SL", "Invalid JSON body: " + e);
        context.response.write(
          JSON.stringify({ ok: false, message: "Invalid JSON" }),
        );
        return;
      }

      var soId = parseInt(body.soid, 10);
      if (!soId) {
        context.response.write(
          JSON.stringify({ ok: false, message: "Missing or invalid soid" }),
        );
        return;
      }

      // Shipping can be 0 (e.g. promo / will-call), so don't treat 0 as error
      var shipping = Number(body.shipping || 0);

      // These come from the browser PostOrder payload
      var pacejetAmount = Number(body.pacejet_amount || shipping || 0);
      var estArrivalDate = body.pacejet_est_arrival_date || "";
      var carrierName = body.pacejet_carrier_name || "";
      var serviceName = body.pacejet_service_name || "";
      var transitDays = body.pacejet_transit_days || "";
      var originKey = body.pacejet_origin_key || "";
      var quoteJson = body.pacejet_quote_json || "";

      // 🔹 NEW: multi-origin fields
      var originCountRaw = body.pacejet_origin_count;
      var originSummary = body.pacejet_origin_summary || "";

      // Normalize origin count to an integer if present
      var originCount = null;
      if (
        originCountRaw !== undefined &&
        originCountRaw !== null &&
        originCountRaw !== ""
      ) {
        var c = parseInt(originCountRaw, 10);
        if (!isNaN(c) && c >= 0) {
          originCount = c;
        }
      }

      // Optional safety: trim quote JSON so you don't blow the field
      if (quoteJson && quoteJson.length > 3800) {
        quoteJson = quoteJson.slice(0, 3800);
      }

      log.debug({
        title: "Pacejet SL payload",
        details: JSON.stringify(
          {
            soid: soId,
            shipping: shipping,
            pacejet_amount: pacejetAmount,
            carrier: carrierName,
            service: serviceName,
            transitDays: transitDays,
            originKey: originKey,
            originCount: originCount,
            hasOriginSummary: !!originSummary,
            quoteLen: quoteJson && quoteJson.length,
          },
          null,
          2,
        ),
      });

      // ---------- 1) Load SO to enforce default location if needed ----------

      var so = record.load({
        type: record.Type.SALES_ORDER,
        id: soId,
        isDynamic: false,
      });

      var location = so.getValue({ fieldId: "location" });
      if (!location) {
        var DEFAULT_LOCATION_ID = 62; // Springville - CDI
        so.setValue({
          fieldId: "location",
          value: DEFAULT_LOCATION_ID,
        });
      }

      // We don't need to set every field on the loaded record; we'll use submitFields
      so.save();

      // ---------- 2) Build values object for submitFields ----------

      var values = {};

      // Shipping related
      values.shippingcost = shipping;
      try {
        // optional: altshippingcost if you are using it
        values.altshippingcost = shipping;
      } catch (e) {
        // ignore if field doesn't exist
      }

      // Pacejet amount (mirror shipping)
      values.custbody_rdt_pacejet_amount = pacejetAmount;

      // Pacejet meta fields (only set if we got something)
      if (carrierName) {
        values.custbody_rdt_pj_carrier_name = carrierName;
      }
      if (serviceName) {
        values.custbody_rdt_pj_service_name = serviceName;
      }
      if (transitDays) {
        values.custbody_rdt_pj_transit_days = transitDays;
      }
      if (originKey) {
        values.custbody_rdt_pj_origin_key = originKey;
      }
      if (quoteJson) {
        values.custbody_rdt_pj_quote_json = quoteJson;
      }
      if (estArrivalDate) {
        values.custbody_rdt_pj_est_arrival_date = new Date(estArrivalDate);
      }
      // 🔹 NEW: origin count + summary to their own fields
      if (originCount !== null) {
        values.custbody_rdt_pj_origin_count = originCount;
      }
      if (originSummary) {
        values.custbody_rdt_pj_origin_summary = originSummary;
      }

      // ---------- 3) Submit fields in one shot ----------

      record.submitFields({
        type: record.Type.SALES_ORDER,
        id: soId,
        values: values,
      });

      var soFinal = record.load({
        type: record.Type.SALES_ORDER,
        id: soId,
        isDynamic: false,
      });

      context.response.write(
        JSON.stringify({
          ok: true,
          soid: soId,
          shipping: shipping,
          pacejet_amount: pacejetAmount,
          totals: {
            subtotal: Number(soFinal.getValue({ fieldId: "subtotal" }) || 0),
            shipping: Number(
              soFinal.getValue({ fieldId: "shippingcost" }) || 0,
            ),
            tax: Number(soFinal.getValue({ fieldId: "taxtotal" }) || 0),
            total: Number(soFinal.getValue({ fieldId: "total" }) || 0),
          },
        }),
      );
    } catch (e) {
      log.error({ title: "Pacejet SL error", details: e });
      context.response.write(
        JSON.stringify({
          ok: false,
          message: "Internal error",
        }),
      );
    }
  }

  return {
    onRequest: onRequest,
  };
});
