/// <amd-module name="RDT.Pacejet.Pacejet.Payload"/>

define("RDT.Pacejet.Pacejet.Payload", ["RDT.Pacejet.Config"], function (
  Config
) {
  "use strict";

  var ACCESSORIAL_TO_SHIPMENT_SERVICE = {
    driver_call: "CALL_PRIOR",
    job_site: "JOB_SITE",
    lift_gate: "LIFT_GATE",
    residential: "RESIDENTIAL",
    schedule_appt: "APPOINTMENT",
    self_storage: "SELF_STORAGE",
    school: "SCHOOL",
    inside_delivery: "INSIDE_DELIVERY",
    dangerous_goods: "DANGEROUS_GOODS",
    hazmat_parcel: "HAZMAT_PARCEL"
  };

  function buildShipmentServicesFromAccessorials(accessorials) {
    var services = [];

    if (!accessorials) return services;

    Object.keys(ACCESSORIAL_TO_SHIPMENT_SERVICE).forEach(function (key) {
      if (accessorials[key]) {
        services.push(ACCESSORIAL_TO_SHIPMENT_SERVICE[key]);
      }
    });

    return services;
  }

  // --------------------------------------------------
  // Helpers
  // --------------------------------------------------
  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function normalizeDimsFromCartItem(item, quantity) {
    return {
      length: num(item.length),
      width: num(item.width),
      height: num(item.height),
      weight: num(item.weight),
      quantity: num(quantity || item.quantity || 1) || 1,
      packageType: item.packageType || ""
    };
  }

  function buildOptions(opts) {
    var options = {};

    var services = buildShipmentServicesFromAccessorials(
      opts && opts.accessorials
    );

    if (services.length) {
      options.ShipmentServices = services.map(function (code) {
        return { Code: code };
      });
    }

    return options;
  }

  // --------------------------------------------------
  // Item classification
  // --------------------------------------------------

  function classifyItem(it) {
    var totalWeight = num(it.weight) * num(it.quantity || 1);

    var maxDim = Math.max(num(it.length), num(it.width), num(it.height));

    var isLTL =
      String(it.packageType || "").toUpperCase() === "PALLET" ||
      totalWeight >= 150 ||
      maxDim >= 48;

    return {
      isLTL: isLTL
    };
  }

  // --------------------------------------------------
  // Address helpers
  // --------------------------------------------------

  function getOrigin() {
    var o = (Config && Config.origin) || {};
    return {
      CompanyName: o.company || "Curecrete",
      Address1: o.addr1 || "1203 Spring Creek Place",
      City: o.city || "Springville",
      StateOrProvinceCode: o.state || "UT",
      PostalCode: o.postal || "84663",
      CountryCode: o.country || "US",
      ContactName: o.contactName || "",
      Email: o.email || "",
      Phone: o.phone || ""
    };
  }

  function buildDestination(addr) {
    var first = addr.firstname || "";
    var last = addr.lastname || "";

    var fullName =
      addr.addressee || (first && last ? first + " " + last : "Ship To");

    return {
      CompanyName: addr.company || fullName,
      Address1: addr.addr1 || "",
      City: addr.city || "",
      StateOrProvinceCode: addr.state || "",
      PostalCode: addr.postal || addr.zip || addr.postalcode || "",
      CountryCode: addr.country || "US",
      ContactName: fullName,
      Email: addr.email || "",
      Phone: addr.phone || ""
    };
  }

  // --------------------------------------------------
  // Package builder
  // --------------------------------------------------

  function buildPackageDetailsFromItems(items, autoPack) {
    var packages = [];

    items.forEach(function (it, idx) {
      var dims = normalizeDimsFromCartItem(it, it.quantity);

      if (
        dims.weight <= 0 ||
        dims.length <= 0 ||
        dims.width <= 0 ||
        dims.height <= 0
      ) {
        console.warn("[Pacejet] Skipping invalid item", it);
        return;
      }

      packages.push({
        Dimensions: {
          Length: String(dims.length),
          Width: String(dims.width),
          Height: String(dims.height),
          Units: "IN"
        },

        ProductDetailsList: [
          {
            Number: String(it.sku || it.internalid || "ITEM-" + (idx + 1)),
            Description: it.description || "",
            Weight: String(dims.weight),

            AutoPack: autoPack ? "true" : "false",

            Dimensions: {
              Length: String(dims.length),
              Width: String(dims.width),
              Height: String(dims.height),
              Units: "IN"
            },

            Quantity: {
              Units: "EA",
              Value: String(dims.quantity)
            },

            commodityName: it.commodityName || ""
          }
        ]
      });
    });

    return packages;
  }

  // --------------------------------------------------
  // MAIN ENTRY
  // --------------------------------------------------

  function fromCart(cart, shipping, opts) {
    opts = opts || {};

    var addr = (shipping && (shipping.address || shipping)) || {};
    var destination = buildDestination(addr);

    var lines =
      cart && typeof cart.get === "function"
        ? cart.get("lines")
        : cart && cart.lines;

    if (!lines || !lines.each) {
      return [];
    }

    var allItems = [];

    lines.each(function (line) {
      var item = line.get && line.get("item");
      if (!item || !item.get) return;

      var qty = Number(line.get("quantity")) || 1;

      allItems.push({
        internalid: item.get("internalid"),
        sku: item.get("itemid"),
        description: item.get("displayname"),

        length: Number(item.get("custitem_pacejet_item_length")) || 0,
        width: Number(item.get("custitem_pacejet_item_width")) || 0,
        height: Number(item.get("custitem_pacejet_item_height")) || 0,

        weight: Number(item.get("weight")) || 0,
        quantity: qty,

        packageType: item.get("custitem_package_type") || ""
      });
    });

    if (!allItems.length) return [];

    return [
      {
        mode: "Single",
        payload: {
          Origin: getOrigin(), // default origin
          Destination: destination,
          PackageDetailsList: buildPackageDetailsFromItems(allItems, true),
          Options: buildOptions(opts)
        }
      }
    ];
  }

  function isValidRate(r) {
    return (
      r &&
      (num(r.consignorFreight) > 0 || num(r.consigneeFreight) > 0) &&
      r.currencyCode === "USD"
    );
  }

  function rateKey(r) {
    return [r.carrierNumber, r.carrierClassOfServiceCode, r.shipMode].join("|");
  }

  function aggregateOrigins(originsMap) {
    var combined = {};
    var originCount = 0;

    Object.keys(originsMap || {}).forEach(function (originKey) {
      var raw = originsMap[originKey] && originsMap[originKey].raw;
      if (!raw || !raw.ratingResultsList) return;

      originCount++;

      raw.ratingResultsList.forEach(function (r) {
        if (!isValidRate(r)) return;

        var key = rateKey(r);

        if (!combined[key]) {
          combined[key] = {
            carrier: r.carrierNumber,
            service: r.carrierClassOfServiceCode,
            serviceDescription: r.carrierClassOfServiceCodeDescription,
            shipMode: r.shipMode,
            currency: r.currencyCode,

            totalFreight: 0,
            totalFuel: 0,
            totalFees: 0,
            maxTransitTime: 0,
            legs: 0
          };
        }

        combined[key].totalFreight += num(r.consignorFreight);
        combined[key].totalFuel += num(r.fuelSurcharge);
        combined[key].totalFees += num(r.totalServiceFees || 0);

        combined[key].maxTransitTime = Math.max(
          combined[key].maxTransitTime,
          num(r.transitTime)
        );

        combined[key].legs++;
      });
    });

    // only keep services that exist for *all* origins
    return Object.keys(combined).map(function (k) {
      var c = combined[k];
      return Object.assign({}, c, {
        total: +(c.totalFreight + c.totalFuel + c.totalFees).toFixed(2)
      });
    });
  }

  function pickCheapest(aggregated) {
    return (
      aggregated.slice().sort(function (a, b) {
        return a.total - b.total;
      })[0] || null
    );
  }

  function pickFastest(aggregated) {
    return (
      aggregated.slice().sort(function (a, b) {
        return a.maxTransitTime - b.maxTransitTime;
      })[0] || null
    );
  }

  return {
    fromCart: fromCart,
    aggregateOrigins: aggregateOrigins,
    pickCheapest: pickCheapest,
    pickFastest: pickFastest
  };
});
