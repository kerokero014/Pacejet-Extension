/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @description Create a Customer Deposit from the persisted Sales Order card portion; skip deposit for pure terms orders
 */
define(["N/record", "N/search", "N/log"], (record, search, log) => {
  var SURCHARGE_ITEM_ID = 7768;

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function round2(n) {
    return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
  }

  function asBool(v) {
    return v === true || v === "T" || v === "true" || v === 1 || v === "1";
  }

  // Attempts setValue; logs and returns false instead of throwing for non-critical fields
  function safeSetValue(rec, fieldId, value, label) {
    try {
      rec.setValue({ fieldId: fieldId, value: value });
      return true;
    } catch (e) {
      log.debug("safeSetValue skipped", {
        field: label || fieldId,
        error: e.message
      });
      return false;
    }
  }

  function getLineCountSafe(rec, sublistId) {
    try {
      return rec.getLineCount({ sublistId: sublistId }) || 0;
    } catch (_e) {
      return 0;
    }
  }

  function getSublistValueSafe(rec, sublistId, fieldId, line) {
    try {
      return rec.getSublistValue({
        sublistId: sublistId,
        fieldId: fieldId,
        line: line
      });
    } catch (_e) {
      return null;
    }
  }

  function getSurchargeAmountFromSO(soRec) {
    var count = getLineCountSafe(soRec, "item");
    var total = 0;
    var i;

    for (i = 0; i < count; i += 1) {
      if (
        String(getSublistValueSafe(soRec, "item", "item", i) || "") !==
        String(SURCHARGE_ITEM_ID)
      ) {
        continue;
      }

      total += num(
        getSublistValueSafe(soRec, "item", "amount", i) ||
          getSublistValueSafe(soRec, "item", "grossamt", i) ||
          0
      );
    }

    return round2(total);
  }

  function readSalesOrderAmounts(soRec) {
    var adjustedSubtotal = num(soRec.getValue({ fieldId: "subtotal" }));
    var surcharge = getSurchargeAmountFromSO(soRec);
    var subtotal =
      surcharge > 0 && adjustedSubtotal >= surcharge
        ? round2(adjustedSubtotal - surcharge)
        : adjustedSubtotal;
    var shipping = num(soRec.getValue({ fieldId: "shippingcost" }));
    var tax = num(soRec.getValue({ fieldId: "taxtotal" }));
    var total = num(soRec.getValue({ fieldId: "total" }));
    var computedTotal = round2(subtotal + surcharge + shipping + tax);

    return {
      subtotal: round2(subtotal),
      adjustedSubtotal: round2(adjustedSubtotal),
      surcharge: surcharge,
      shipping: round2(shipping),
      tax: round2(tax),
      total: round2(total),
      computedTotal: computedTotal
    };
  }

  function getBestSalesOrderTotal(soId) {
    var attempts = 3;
    var last = null;

    for (var i = 0; i < attempts; i++) {
      var soRec = record.load({
        type: record.Type.SALES_ORDER,
        id: soId,
        isDynamic: false
      });

      var amounts = readSalesOrderAmounts(soRec);
      last = { soRec: soRec, amounts: amounts };

      log.debug("SO amount read attempt", {
        soId: soId,
        attempt: i + 1,
        subtotal: amounts.subtotal,
        surcharge: amounts.surcharge,
        shipping: amounts.shipping,
        tax: amounts.tax,
        total: amounts.total,
        computedTotal: amounts.computedTotal
      });

      if (Math.abs(amounts.total - amounts.computedTotal) < 0.01) {
        return { soRec: soRec, amounts: amounts };
      }

      if (amounts.computedTotal > amounts.total + 0.01) {
        return { soRec: soRec, amounts: amounts };
      }
    }

    return {
      soRec: last.soRec,
      amounts: last.amounts,
      salesOrderTotal:
        Math.abs(last.amounts.total - last.amounts.computedTotal) < 0.01
          ? last.amounts.total
          : last.amounts.computedTotal > last.amounts.total + 0.01
            ? last.amounts.computedTotal
            : last.amounts.total
    };
  }

  function readSplitAmounts(soRec) {
    var useTerms = asBool(soRec.getValue({ fieldId: "custbody_sc_use_terms" }));
    var cardPortion = round2(
      num(soRec.getValue({ fieldId: "custbody_card_portion" }))
    );
    var termsPortion = round2(
      num(soRec.getValue({ fieldId: "custbody_terms_portion" }))
    );

    return {
      useTerms: useTerms,
      cardPortion: Math.max(0, cardPortion),
      termsPortion: Math.max(0, termsPortion)
    };
  }

  function resolveDepositAmount(soRec, amounts) {
    var split = readSplitAmounts(soRec);
    var soTotal = round2(num(amounts && amounts.total));

    if (!split.useTerms) {
      return {
        mode: "card",
        depositAmount: soTotal,
        split: split,
        correctedFromCardPortion:
          split.cardPortion > 0 && Math.abs(split.cardPortion - soTotal) >= 0.01
      };
    }

    var cardAmount = round2(Math.max(0, Math.min(split.cardPortion, soTotal)));

    if (cardAmount <= 0) {
      return { mode: "terms", depositAmount: 0, split: split };
    }

    return { mode: "hybrid", depositAmount: cardAmount, split: split };
  }

  function extractCardMetaFromSO(soRec) {
    var meta = {
      hasCard: false,
      paymentMethodId: null,
      paymentMethodName: null,
      profileId: null
    };

    try {
      var lineCount = soRec.getLineCount({ sublistId: "paymentmethods" }) || 0;
      if (!lineCount) return meta;

      for (var i = 0; i < lineCount; i++) {
        var type = (
          soRec.getSublistValue({
            sublistId: "paymentmethods",
            fieldId: "type",
            line: i
          }) || ""
        ).toLowerCase();

        var name =
          soRec.getSublistValue({
            sublistId: "paymentmethods",
            fieldId: "name",
            line: i
          }) || "";

        var isPaypal = soRec.getSublistValue({
          sublistId: "paymentmethods",
          fieldId: "ispaypal",
          line: i
        });

        if (isPaypal === true || isPaypal === "T") continue;

        if (
          type.indexOf("creditcard") > -1 ||
          type.indexOf("cc") > -1 ||
          name.toLowerCase().indexOf("visa") > -1 ||
          name.toLowerCase().indexOf("master") > -1 ||
          name.toLowerCase().indexOf("amex") > -1 ||
          name.toLowerCase().indexOf("discover") > -1
        ) {
          meta.hasCard = true;
          meta.paymentMethodId =
            soRec.getSublistValue({
              sublistId: "paymentmethods",
              fieldId: "paymentmethod",
              line: i
            }) || null;
          meta.paymentMethodName = name || null;
          meta.profileId =
            soRec.getSublistValue({
              sublistId: "paymentmethods",
              fieldId: "paymentoption",
              line: i
            }) ||
            soRec.getSublistValue({
              sublistId: "paymentmethods",
              fieldId: "creditcard",
              line: i
            }) ||
            soRec.getSublistValue({
              sublistId: "paymentmethods",
              fieldId: "paymentinstrument",
              line: i
            }) ||
            null;

          log.debug("Extracted card meta from SO line", {
            line: i,
            type: type,
            name: name,
            paymentMethodId: meta.paymentMethodId,
            profileId: meta.profileId
          });

          break;
        }
      }
    } catch (e) {
      log.error("extractCardMetaFromSO error", e);
    }

    return meta;
  }

  function applyCardMetaToDeposit(depRec, cardMeta) {
    if (!depRec || !cardMeta) return;

    try {
      if (cardMeta.hasCard) {
        if (cardMeta.paymentMethodId) {
          safeSetValue(
            depRec,
            "custbody_rdt_cc_pm_id",
            String(cardMeta.paymentMethodId),
            "cc_pm_id"
          );
        }
        if (cardMeta.paymentMethodName) {
          safeSetValue(
            depRec,
            "custbody_rdt_cc_pm_name",
            cardMeta.paymentMethodName,
            "cc_pm_name"
          );
        }
        if (cardMeta.profileId) {
          safeSetValue(
            depRec,
            "custbody_rdt_cc_profile",
            String(cardMeta.profileId),
            "cc_profile"
          );
        }
      } else {
        safeSetValue(depRec, "custbody_rdt_cc_pm_id", "", "cc_pm_id");
        safeSetValue(depRec, "custbody_rdt_cc_pm_name", "", "cc_pm_name");
        safeSetValue(depRec, "custbody_rdt_cc_profile", "", "cc_profile");
      }
    } catch (e) {
      log.error("applyCardMetaToDeposit error", e);
    }
  }

  function prepareNonProcessingDeposit(depRec) {
    if (!depRec) return;
    safeSetValue(depRec, "chargeit", false, "chargeit");
  }

  // Returns the first Customer Deposit already linked to this SO, or null
  function findExistingDeposit(soId) {
    try {
      var found = null;
      search
        .create({
          type: search.Type.CUSTOMER_DEPOSIT,
          filters: [["salesorder", "anyof", String(soId)]],
          columns: [
            search.createColumn({ name: "internalid" }),
            search.createColumn({ name: "amount" })
          ]
        })
        .run()
        .each(function (r) {
          found = {
            id: r.id,
            amount: num(r.getValue({ name: "amount" }))
          };
          return false; // stop after first match
        });
      return found;
    } catch (e) {
      log.error("findExistingDeposit error — proceeding with creation", {
        soId: soId,
        error: e.message
      });
      return null; // non-fatal: if search fails, attempt creation anyway
    }
  }

  function buildDepositRecord(soId, customerId, modeRef) {
    var dep = record.create({
      type: record.Type.CUSTOMER_DEPOSIT,
      isDynamic: true
    });
    safeSetValue(dep, "customer", customerId, "customer");

    var soLinked = safeSetValue(dep, "salesorder", soId, "salesorder");
    if (!soLinked) {
      throw new Error(
        "Failed to link salesorder " + soId + " on Customer Deposit record"
      );
    }

    modeRef.value = "manual";
    return dep;
  }

  function createDepositForOrder(soId) {
    soId = parseInt(soId, 10);
    if (!soId || isNaN(soId)) {
      throw new Error("Invalid soId: " + soId);
    }

    // Idempotency: if a CD already exists for this SO, return it instead of creating a duplicate
    var existing = findExistingDeposit(soId);
    if (existing) {
      log.debug("Customer Deposit already exists for SO — skipping creation", {
        soId: soId,
        depositId: existing.id,
        amount: existing.amount
      });
      return {
        action: "already_exists",
        soId: soId,
        depositId: existing.id,
        depositAmount: existing.amount
      };
    }

    var soInfo = getBestSalesOrderTotal(soId);
    var soRec = soInfo.soRec;
    var amounts = soInfo.amounts;

    var customerId = soRec.getValue({ fieldId: "entity" });
    var currencyId = soRec.getValue({ fieldId: "currency" });
    var locationId = soRec.getValue({ fieldId: "location" }) || null;

    var subtotal = amounts.subtotal;
    var shipping = amounts.shipping;
    var surcharge = amounts.surcharge;
    var tax = amounts.tax;
    var salesOrderTotal = soInfo.salesOrderTotal || amounts.total;

    var depositDecision = resolveDepositAmount(soRec, amounts);
    var depositAmount = depositDecision.depositAmount;
    var paymentMode = depositDecision.mode;
    var split = depositDecision.split;
    var cardMeta = extractCardMetaFromSO(soRec);

    log.debug("Creating Customer Deposit", {
      soId: soId,
      customerId: customerId,
      currencyId: currencyId,
      locationId: locationId,
      subtotal: subtotal,
      surcharge: surcharge,
      shipping: shipping,
      tax: tax,
      salesOrderTotal: salesOrderTotal,
      paymentMode: paymentMode,
      depositAmount: depositAmount,
      split: split
    });

    if (!customerId) {
      throw new Error(
        "No customer on SO " + soId + "; cannot create Customer Deposit"
      );
    }

    if (depositAmount <= 0) {
      log.debug("Skipping Customer Deposit: no card portion", {
        soId: soId,
        paymentMode: paymentMode,
        split: split
      });
      return {
        action: "skipped",
        reason: "No card portion on Sales Order",
        soId: soId,
        depositAmount: 0,
        salesOrderTotal: salesOrderTotal,
        salesOrderAmounts: {
          subtotal: subtotal,
          surcharge: surcharge,
          shipping: shipping,
          tax: tax,
          total: salesOrderTotal
        },
        paymentMode: paymentMode,
        split: split,
        cardMeta: cardMeta
      };
    }

    var modeRef = { value: null };
    var dep = buildDepositRecord(soId, customerId, modeRef);
    var depositCreationMode = modeRef.value;

    // Non-critical fields — failures are logged but won't abort
    if (currencyId) safeSetValue(dep, "currency", currencyId, "currency");
    if (locationId) safeSetValue(dep, "location", locationId, "location");
    safeSetValue(dep, "account", 110, "account"); // Unapproved Customer Payment account

    // Payment amount is critical — abort if it can't be set
    if (!safeSetValue(dep, "payment", depositAmount, "payment")) {
      throw new Error(
        "Failed to set payment amount " +
          depositAmount +
          " on Customer Deposit for SO " +
          soId
      );
    }

    prepareNonProcessingDeposit(dep);
    applyCardMetaToDeposit(dep, cardMeta);

    var depId = dep.save({
      enableSourcing: true
    });

    log.audit("Customer Deposit created", {
      soId: soId,
      depositId: depId,
      depositAmount: depositAmount,
      depositCreationMode: depositCreationMode
    });

    return {
      action: "created",
      soId: soId,
      depositId: depId,
      depositAmount: depositAmount,
      depositCreationMode: depositCreationMode,
      salesOrderTotal: salesOrderTotal,
      salesOrderAmounts: {
        subtotal: subtotal,
        surcharge: surcharge,
        shipping: shipping,
        tax: tax,
        total: salesOrderTotal
      },
      paymentMode: paymentMode,
      split: split,
      cardMeta: cardMeta
    };
  }

  function onRequest(context) {
    var req = context.request;
    var res = context.response;

    try {
      var soId =
        req.parameters.soId ||
        req.parameters.salesorderid ||
        req.parameters.orderid ||
        null;

      if (req.method === "POST" && !soId) {
        try {
          var body = JSON.parse(req.body || "{}");
          soId =
            body.soId || body.salesorderid || body.orderid || body.internalid;
        } catch (_e) {}
      }

      if (!soId) {
        res.setHeader({ name: "Content-Type", value: "application/json" });
        res.write(
          JSON.stringify({
            ok: false,
            error: { name: "MISSING_SO_ID", message: "Missing soId parameter" }
          })
        );
        return;
      }

      var result = createDepositForOrder(soId);

      res.setHeader({ name: "Content-Type", value: "application/json" });
      res.write(JSON.stringify({ ok: true, soId: soId, result: result }));
    } catch (e) {
      log.error("Suitelet error in SO -> Customer Deposit create", e);
      res.setHeader({ name: "Content-Type", value: "application/json" });
      res.write(
        JSON.stringify({
          ok: false,
          error: { name: e.name || "", message: e.message || String(e) }
        })
      );
    }
  }

  return {
    onRequest: onRequest
  };
});
