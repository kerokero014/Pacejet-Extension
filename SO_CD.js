/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @description suitelet incharge of syncing Customer Deposit for Sales Order based on card portion - Final Version. sandbox - 4076, production -
 */
define(["N/record", "N/search", "N/log"], (record, search, log) => {
  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function findExistingDeposit(soId) {
    if (!soId) return null;

    var depId = null;

    var depSearch = search.create({
      type: search.Type.CUSTOMER_DEPOSIT,
      filters: [["mainline", "is", "T"], "AND", ["salesorder", "anyof", soId]],
      columns: ["internalid", "amount"]
    });

    depSearch.run().each(function (result) {
      depId = result.getValue("internalid");
      return false; // first match only
    });

    return depId;
  }

  // ---------- extract card meta from SO paymentmethods ----------
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

        // Skip PayPal / non-card methods
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

          var profile =
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

          meta.profileId = profile;

          log.debug("Extracted card meta from SO line", {
            line: i,
            type: type,
            name: name,
            paymentMethodId: meta.paymentMethodId,
            profileId: meta.profileId
          });

          break; // first card wins
        }
      }
    } catch (e) {
      log.error("extractCardMetaFromSO error", e);
    }

    return meta;
  }

  // ---------- write card meta into deposit custom fields ----------
  function applyCardMetaToDeposit(depRec, cardMeta) {
    if (!depRec || !cardMeta) return;

    try {
      if (cardMeta.hasCard) {
        if (cardMeta.paymentMethodId) {
          depRec.setValue({
            fieldId: "custbody_rdt_cc_pm_id",
            value: String(cardMeta.paymentMethodId)
          });
        }
        if (cardMeta.paymentMethodName) {
          depRec.setValue({
            fieldId: "custbody_rdt_cc_pm_name",
            value: cardMeta.paymentMethodName
          });
        }
        if (cardMeta.profileId) {
          depRec.setValue({
            fieldId: "custbody_rdt_cc_profile",
            value: String(cardMeta.profileId)
          });
        }
      } else {
        depRec.setValue({ fieldId: "custbody_rdt_cc_pm_id", value: "" });
        depRec.setValue({ fieldId: "custbody_rdt_cc_pm_name", value: "" });
        depRec.setValue({ fieldId: "custbody_rdt_cc_profile", value: "" });
      }
    } catch (e) {
      log.error("applyCardMetaToDeposit error", e);
    }
  }

  // ---------- make sure deposit does NOT try to hit the gateway ----------
  function neutralizeGatewayFields(depRec) {
    if (!depRec) return;

    function safeSet(fieldId, value) {
      try {
        depRec.setValue({ fieldId: fieldId, value: value });
      } catch (e) {
        // field might not exist – that's fine
      }
    }

    // Don't try to charge or auth anything
    safeSet("chargeit", "F");
    safeSet("ccapproved", "F");

    // Nuke any card-related fields that might auto-trigger gateway
    safeSet("paymentmethod", "");
    safeSet("creditcard", "");
    safeSet("creditcardprocessor", "");
    safeSet("pnrefnum", "");
    safeSet("authcode", "");
    safeSet("ccname", "");
    safeSet("ccexpiredate", "");
    safeSet("ccnumber", "");
  }

  function syncDepositForOrder(soId) {
    if (!soId) {
      throw new Error("Missing soId parameter");
    }

    var soRec = record.load({
      type: record.Type.SALES_ORDER,
      id: soId,
      isDynamic: false
    });

    var customerId = soRec.getValue({ fieldId: "entity" });
    var currencyId = soRec.getValue({ fieldId: "currency" });
    var locationId = soRec.getValue({ fieldId: "location" }) || null;

    var cardPortion = num(soRec.getValue({ fieldId: "custbody_card_portion" }));
    var termsPortion = num(
      soRec.getValue({ fieldId: "custbody_terms_portion" })
    );

    log.debug("SO credit split (Suitelet)", {
      soId: soId,
      cardPortion: cardPortion,
      termsPortion: termsPortion
    });

    var existingDepId = findExistingDeposit(soId);
    var cardMeta = extractCardMetaFromSO(soRec);

    // --- Case 1: no card portion → delete any existing deposit we created ---
    if (!cardPortion || cardPortion <= 0) {
      if (existingDepId) {
        log.audit("Deleting existing Customer Deposit (no card portion)", {
          soId: soId,
          depositId: existingDepId
        });
        record.delete({
          type: record.Type.CUSTOMER_DEPOSIT,
          id: existingDepId
        });
      }
      return {
        action: "deleted_or_none",
        cardPortion: cardPortion,
        termsPortion: termsPortion
      };
    }

    // --- Case 2: cardPortion > 0 → ensure deposit exists and matches cardPortion ---
    if (!customerId) {
      throw new Error("No customer on SO; cannot create Customer Deposit");
    }

    if (existingDepId) {
      var depRec = record.load({
        type: record.Type.CUSTOMER_DEPOSIT,
        id: existingDepId,
        isDynamic: true
      });

      var currentAmt = num(depRec.getValue({ fieldId: "payment" }));
      var changed = Math.abs(currentAmt - cardPortion) > 0.01;

      if (changed) {
        depRec.setValue({
          fieldId: "payment",
          value: cardPortion
        });
      }

      depRec.setValue({
        fieldId: "undepfunds",
        value: "T"
      });

      neutralizeGatewayFields(depRec);
      applyCardMetaToDeposit(depRec, cardMeta);

      var savedId = depRec.save();

      log.audit("Updated Customer Deposit from Suitelet", {
        soId: soId,
        depositId: savedId,
        oldAmount: currentAmt,
        newAmount: cardPortion,
        cardMeta: cardMeta
      });

      return {
        action: "updated",
        depositId: savedId,
        amount: cardPortion,
        cardMeta: cardMeta
      };
    }

    // --- No existing deposit → create one ---
    var dep = record.create({
      type: record.Type.CUSTOMER_DEPOSIT,
      isDynamic: true
    });

    dep.setValue({
      fieldId: "customer",
      value: customerId
    });

    dep.setValue({
      fieldId: "salesorder",
      value: soId
    });

    if (currencyId) {
      dep.setValue({
        fieldId: "currency",
        value: currencyId
      });
    }

    if (locationId) {
      dep.setValue({
        fieldId: "location",
        value: locationId
      });
    }

    dep.setValue({
      fieldId: "payment",
      value: cardPortion
    });

    dep.setValue({
      fieldId: "undepfunds",
      value: "T"
    });

    neutralizeGatewayFields(dep);
    applyCardMetaToDeposit(dep, cardMeta);

    var depId = dep.save();

    // 🔥 Force the linkage to stick
    record.submitFields({
      type: record.Type.CUSTOMER_DEPOSIT,
      id: depId,
      values: {
        salesorder: soId
      }
    });

    log.audit("Created Customer Deposit from Suitelet", {
      soId: soId,
      depositId: depId,
      amount: cardPortion,
      cardMeta: cardMeta
    });

    return {
      action: "created",
      depositId: depId,
      amount: cardPortion,
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
        } catch (e) {
          // ignore parse error; soId might still be in params
        }
      }

      if (!soId) {
        res.setHeader({
          name: "Content-Type",
          value: "application/json"
        });
        res.write(
          JSON.stringify({
            ok: false,
            error: "Missing soId parameter"
          })
        );
        return;
      }

      var result = syncDepositForOrder(soId);

      res.setHeader({
        name: "Content-Type",
        value: "application/json"
      });
      res.write(
        JSON.stringify({
          ok: true,
          soId: soId,
          result: result
        })
      );
    } catch (e) {
      log.error("Suitelet error in SO→CustomerDeposit", e);
      res.setHeader({
        name: "Content-Type",
        value: "application/json"
      });
      res.write(
        JSON.stringify({
          ok: false,
          error: e.name || e.message || String(e)
        })
      );
    }
  }

  return {
    onRequest: onRequest
  };
});
