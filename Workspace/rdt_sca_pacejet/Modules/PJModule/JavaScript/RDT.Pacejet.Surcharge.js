/// <amd-module name="RDT.Pacejet.Surcharge"/>

define("RDT.Pacejet.Surcharge", [], function () {
  "use strict";

  var SURCHARGE_RATE = 0.02;

  function asNumber(value, fallback) {
    var number = Number(value);

    return isFinite(number) ? number : fallback || 0;
  }

  function round2(value) {
    return Math.round((asNumber(value, 0) + Number.EPSILON) * 100) / 100;
  }

  function formatMoney(value) {
    var number = round2(value);

    try {
      return number.toLocaleString(undefined, {
        style: "currency",
        currency: "USD"
      });
    } catch (_e) {
      return "$" + number.toFixed(2);
    }
  }

  function buildSummary(baseSubtotal, shipping, tax, options) {
    var opts = options && typeof options === "object" ? options : {};
    var normalizedSubtotal = round2(baseSubtotal);
    var normalizedShipping = round2(shipping);
    var sourceTax = round2(tax);
    var surchargeAmount = round2(normalizedSubtotal * SURCHARGE_RATE);
    var adjustedSubtotal = round2(normalizedSubtotal + surchargeAmount);
    var surchargeTax = 0; // declared at top scope so return object can always reference it
    var shippingTax = 0;
    var normalizedTax;

    if (opts.taxIncludesAll) {
      normalizedTax = sourceTax;
    } else if (opts.taxIncludesSurcharge) {
      normalizedTax = sourceTax;
    } else {
      var productBasis = normalizedSubtotal;
      var inferredTaxRate =
        productBasis > 0 && sourceTax > 0 ? sourceTax / productBasis : 0;
      surchargeTax = round2(surchargeAmount * inferredTaxRate);
      shippingTax = opts.shippingTaxed
        ? round2(normalizedShipping * inferredTaxRate)
        : 0;
      normalizedTax = round2(sourceTax + surchargeTax + shippingTax);
    }

    var total = round2(
      normalizedSubtotal + surchargeAmount + normalizedShipping + normalizedTax
    );

    return {
      rate: SURCHARGE_RATE,
      rateLabel: "2%",
      baseSubtotal: normalizedSubtotal,
      surchargeAmount: surchargeAmount,
      adjustedSubtotal: adjustedSubtotal,
      shipping: normalizedShipping,
      tax: normalizedTax,
      sourceTax: sourceTax,
      surchargeTax: surchargeTax,
      shippingTax: shippingTax,
      total: total,
      baseSubtotalFormatted: formatMoney(normalizedSubtotal),
      surchargeFormatted: formatMoney(surchargeAmount),
      adjustedSubtotalFormatted: formatMoney(adjustedSubtotal),
      shippingFormatted: formatMoney(normalizedShipping),
      taxFormatted: formatMoney(normalizedTax),
      totalFormatted: formatMoney(total)
    };
  }

  return {
    RATE: SURCHARGE_RATE,
    asNumber: asNumber,
    round2: round2,
    formatMoney: formatMoney,
    buildSummary: buildSummary
  };
});
