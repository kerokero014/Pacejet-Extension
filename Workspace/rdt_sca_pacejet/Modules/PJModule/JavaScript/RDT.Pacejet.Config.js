/// <amd-module name="RDT.Pacejet.Config"/>

define("RDT.Pacejet.Config", [], function () {
  "use strict";

  return {
    shipmethodMap: [
      // --------------------
      // WILL CALL
      // --------------------
      { carrier: "WILL CALL", shipCode: "4255" },
      { carrier: "EXW", shipCode: "7522" },
      // { serviceIncludes: "OUR ACCOUNT", shipCode: "7333" },
      // { serviceIncludes: "RMS SHIPPING", shipCode: "7694" },
      // {
      //   serviceIncludes: "OTHER SPECIAL CONSIDERATIONS",
      //   shipCode: "4254"
      // },
      // { serviceIncludes: "OTHER STANDARD", shipCode: "1349" },
      // {
      //   serviceIncludes: "INTERNATIONAL SHIPPING",
      //   shipCode: "4265"
      // },

      // --------------------
      // UPS
      // --------------------
      { carrier: "UPS", serviceIncludes: "2ND DAY AIR A.M.", shipCode: "1355" },
      { carrier: "UPS", serviceIncludes: "GROUND", shipCode: "1358" },
      { carrier: "UPS", serviceIncludes: "2ND DAY", shipCode: "1354" },
      { carrier: "UPS", serviceIncludes: "3 DAY", shipCode: "1356" },
      {
        carrier: "UPS",
        serviceIncludes: "FIRST CLASS MAIL",
        shipCode: "1357"
      },
      {
        carrier: "UPS",
        serviceIncludes: "EARLY A.M.",
        shipCode: "1361"
      },
      { carrier: "UPS", serviceIncludes: "NEXT DAY", shipCode: "1359" },
      { carrier: "UPS", serviceIncludes: "SAVER", shipCode: "1360" },
      { carrier: "UPS", serviceIncludes: "STANDARD", shipCode: "1362" },
      {
        carrier: "UPS",
        serviceIncludes: "WORLDWIDE ECONOMY DDP - CANADA",
        shipCode: "4269"
      },
      {
        carrier: "UPS",
        serviceIncludes: "WORLDWIDE ECONOMY DDU - CANADA",
        shipCode: "4270"
      },
      {
        carrier: "UPS",
        serviceIncludes: "WORLDWIDE EXPEDITED - CANADA",
        shipCode: "4271"
      },
      {
        carrier: "UPS",
        serviceIncludes: "WORLDWIDE EXPRESS - CANADA",
        shipCode: "4272"
      },
      {
        carrier: "UPS",
        serviceIncludes: "WORLDWIDE SAVER - CANADA",
        shipCode: "4273"
      },
      {
        carrier: "UPS",
        serviceIncludes: "WORLDWIDE ECONOMY DDP",
        shipCode: "1363"
      },
      {
        carrier: "UPS",
        serviceIncludes: "WORLDWIDE ECONOMY DDU",
        shipCode: "1364"
      },
      {
        carrier: "UPS",
        serviceIncludes: "WORLDWIDE EXPRESS",
        shipCode: "1366"
      },
      {
        carrier: "UPS",
        serviceIncludes: "WORLDWIDE EXPEDITED",
        shipCode: "1365"
      },
      { carrier: "UPS", serviceIncludes: "WORLDWIDE SAVER", shipCode: "1367" },

      // --------------------
      // FedEx (Parcel)
      // --------------------
      { carrier: "FEDEX", serviceIncludes: "GROUND", shipCode: "1340" },
      { carrier: "FEDEX", serviceIncludes: "2 DAY", shipCode: "2" },
      { carrier: "FEDEX", serviceIncludes: "NEXT DAY", shipCode: "3" },
      {
        carrier: "FEDEX",
        serviceIncludes: "INTERNATIONAL ECONOMY - CANADA",
        shipCode: "4266"
      },
      {
        carrier: "FEDEX",
        serviceIncludes: "INTERNATIONAL FIRST - CANADA",
        shipCode: "4267"
      },
      {
        carrier: "FEDEX",
        serviceIncludes: "INTERNATIONAL PRIORITY EXPRESS - CANADA",
        shipCode: "4268"
      },
      {
        carrier: "FEDEX",
        serviceIncludes: "INTERNATIONAL ECONOMY FREIGHT",
        shipCode: "1342"
      },
      {
        carrier: "FEDEX",
        serviceIncludes: "INTERNATIONAL ECONOMY",
        shipCode: "1341"
      },
      {
        carrier: "FEDEX",
        serviceIncludes: "INTERNATIONAL FIRST",
        shipCode: "1343"
      },
      {
        carrier: "FEDEX",
        serviceIncludes: "INTERNATIONAL PRIORITY EXPRESS",
        shipCode: "1337"
      },
      {
        carrier: "FEDEX",
        serviceIncludes: "PRIORITY OVERNIGHT",
        shipCode: "1345"
      },
      {
        carrier: "FEDEX",
        serviceIncludes: "STANDARD OVERNIGHT",
        shipCode: "1346"
      },

      // --------------------
      // FedEx Freight
      // --------------------
      {
        carrier: "FEDEX",
        serviceIncludes: "FREIGHT ECONOMY",
        shipCode: "1338"
      },
      {
        carrier: "FEDEX",
        serviceIncludes: "FREIGHT PRIORITY",
        shipCode: "1339"
      },

      // --------------------
      // Estes (LTL)
      // --------------------
      { carrier: "ESTES", serviceIncludes: "12PM", shipCode: "1332" },
      { carrier: "ESTES", serviceIncludes: "12 PM", shipCode: "1332" },
      { carrier: "ESTES", serviceIncludes: "5PM", shipCode: "1333" },
      { carrier: "ESTES", serviceIncludes: "5 PM", shipCode: "1333" },
      { carrier: "ESTES", serviceIncludes: "10AM", shipCode: "1330" },
      { carrier: "ESTES", serviceIncludes: "10 AM", shipCode: "1330" },
      {
        carrier: "ESTES",
        serviceIncludes: "TRUCKLOAD BASIC",
        shipCode: "1336"
      },
      {
        carrier: "ESTES",
        serviceIncludes: "VOLUME AND TRUCKLOAD BASIC",
        shipCode: "1336"
      },
      {
        carrier: "ESTES",
        serviceIncludes: "TRUCKLOAD STANDARD",
        shipCode: "1334"
      },
      {
        carrier: "ESTES",
        serviceIncludes: "VOLUME AND TRUCKLOAD STANDARD",
        shipCode: "1334"
      },
      { carrier: "ESTES", serviceIncludes: "GUARANTEED", shipCode: "1330" },
      { carrier: "ESTES", serviceIncludes: "LTL", shipCode: "1335" },
      { carrier: "ESTES", serviceIncludes: "VOLUME", shipCode: "1334" },

      // --------------------
      // Saia (LTL)
      // --------------------
      { carrier: "SAIA", serviceIncludes: "GUARANTEE 12", shipCode: "4257" },
      { carrier: "SAIA", serviceIncludes: "GUARANTEE 2", shipCode: "4258" },
      { carrier: "SAIA", serviceIncludes: "GUARANTEE 5", shipCode: "4259" },
      { carrier: "SAIA", serviceIncludes: "STANDARD", shipCode: "4260" },

      // --------------------
      // AAA Cooper / MME / NorthPark
      // --------------------
      {
        carrier: "AAA COOPER",
        serviceIncludes: "GUARANTEED",
        shipCode: "7764"
      },
      {
        carrier: "AAA COOPER",
        serviceIncludes: "STANDARD",
        shipCode: "365"
      },
      { carrier: "MME", serviceIncludes: "STANDARD", shipCode: "4252" },
      {
        carrier: "NORTHPARK",
        serviceIncludes: "STANDARD",
        shipCode: "4253"
      },

      // --------------------
      // XPO
      // --------------------
      { carrier: "XPO", serviceIncludes: "GUARANTEED", shipCode: "1368" },
      // { carrier: "XPO", serviceIncludes: "SPOT", shipCode: "1369" },
      { carrier: "XPO", serviceIncludes: "STANDARD", shipCode: "1370" },

      // --------------------
      // ODFL
      // --------------------
      { carrier: "ODFL", serviceIncludes: "STANDARD", shipCode: "1348" },
      { carrier: "ODFL", serviceIncludes: "GUARANTEED", shipCode: "1347" },

      // --------------------
      // RL Carriers
      // --------------------
      { carrier: "RL", serviceIncludes: "STD", shipCode: "1353" },
      { carrier: "RL", serviceIncludes: "GSAM", shipCode: "1350" },
      { carrier: "RL", serviceIncludes: "GSHW", shipCode: "1351" },
      { carrier: "RL", serviceIncludes: "GSDS", shipCode: "1352" },
      {
        carrier: "RL",
        serviceIncludes: "R&L CARRIERS STANDARD",
        shipCode: "1353"
      },
      {
        carrier: "RL",
        serviceIncludes: "GUARANTEED AM SERVICE",
        shipCode: "1350"
      },
      {
        carrier: "RL",
        serviceIncludes: "GUARANTEED HOURLY WINDOW",
        shipCode: "1351"
      },
      {
        carrier: "RL",
        serviceIncludes: "GUARANTEED SERVICE",
        shipCode: "1352"
      },

      // --------------------
      // Will Call / Special
      // --------------------
      { carrier: "WILL CALL", shipCode: "4255" },
      { carrier: "EXW", shipCode: "7522" }
    ],

    // // Full NetSuite shipping catalog used by this Pacejet integration.
    // // This preserves IDs that may share overlapping carrier/service names
    // // even when the active matcher cannot always distinguish them.
    // shipmethodCatalog: {
    //   2: "FedEx 2 Day",
    //   3: "FedEx Next Day",
    //   4: "UPS Ground",
    //   365: "AAACooper StandardLTL",
    //   1330: "Estes Guaranteed LTL Standard Transit: 10AM",
    //   1332: "Estes Guaranteed LTL Standard Transit: 12PM",
    //   1333: "Estes Guaranteed LTL Standard Transit: 5PM",
    //   1334: "Estes Guaranteed Volume and Truckload Standard",
    //   1335: "Estes LTL Standard Transit",
    //   1336: "Estes Volume and Truckload Basic",
    //   1337: "FedEx International Priority Express",
    //   1338: "FedEx Freight Economy",
    //   1339: "FedEx Freight Priority",
    //   1340: "FedEx Ground",
    //   1341: "FedEx International Economy",
    //   1342: "FedEx International Economy Freight",
    //   1343: "FedEx International First",
    //   1345: "FedEx Priority Overnight",
    //   1346: "FedEx Standard Overnight",
    //   1347: "ODFL Guaranteed",
    //   1348: "ODFL Standard",
    //   1349: "Other Standard",
    //   1350: "RLCarriers GSAM",
    //   1351: "RLCarriers GSHW",
    //   1352: "RLCarriers GSDS",
    //   1353: "RLCarriers STD",
    //   1354: "UPS 2nd Day Air",
    //   1355: "UPS 2nd Day Air A.M.",
    //   1356: "UPS 3 Day Select",
    //   1357: "UPS First Class Mail",
    //   1358: "UPS Ground",
    //   1359: "UPS Next Day Air",
    //   1360: "UPS Next Day Air Saver",
    //   1361: "UPS Next Day Air Early A.M.",
    //   1362: "UPS Standard",
    //   1363: "UPS Worldwide Economy DDP",
    //   1364: "UPS Worldwide Economy DDU",
    //   1365: "UPS Worldwide Exped",
    //   1366: "UPS Worldwide Express",
    //   1367: "UPS Worldwide Saver",
    //   1368: "XPO Guaranteed",
    //   1369: "XPO Spot Quote",
    //   1370: "XPO Standard",
    //   4252: "MME Standard",
    //   4253: "NorthPark Standard",
    //   4254: "Other Special Considerations",
    //   4255: "WillCall - Fee to Be Determined",
    //   4256: "Use Customer Account - Provide in Notes",
    //   4257: "Saia Guarantee 12 PM",
    //   4258: "Saia Guarantee 2 PM",
    //   4259: "Saia Guarantee 5 PM",
    //   4260: "Saia Standard Service",
    //   4265: "International Shipping",
    //   4266: "FedEx International Economy - Canada",
    //   4267: "FedEx International First - Canada",
    //   4268: "FedEx International Priority Express - Canada",
    //   4269: "UPS Worldwide Economy DDP - Canada",
    //   4270: "UPS Worldwide Economy DDU - Canada",
    //   4271: "UPS Worldwide Exped - Canada",
    //   4272: "UPS Worldwide Express - Canada",
    //   4273: "UPS Worldwide Saver - Canada",
    //   7333: "OUR ACCOUNT",
    //   7522: "EXW Will Call - Fee to Be Determined",
    //   7694: "RMS Shipping",
    //   7764: "AAACooper Guaranteed"
    // },

    // --------------------------------------------------
    // Option B fallback (ONLY if no rule matches)
    // --------------------------------------------------
    fallbackShipmethodByCarrier: {
      UPS: "1358",
      FEDEX: "1340",
      ESTES: "1335",
      SAIA: "4260",
      ODFL: "1348",
      XPO: "1370",
      WILL_CALL: "4255"
    },

    // Keep UI rates aligned with raw Pacejet/NetSuite values unless markup
    // is explicitly enabled for a given environment.
    enableFreightMarkup: false,

    getRatesUrl: "/app/site/hosting/scriptlet.nl?script=3954&deploy=1",

    testApplyShippingUrl: "/app/site/hosting/scriptlet.nl?script=3984&deploy=2",
    // Legacy confirmation-time apply Suitelet. Leave disabled unless that
    // NetSuite script/deployment is present and intentionally in use.
    enableTestApplyShipping: true,

    // Server-side Pacejet endpoint (used only from SuiteScript)
    pacejetEndpoint: "https://shipapi.pacejet.cc/Rates?api-version=3.5",
    ratesSuitelet: {
      path: "/app/site/hosting/scriptlet.nl",
      script: "customscript_rdt_pacejet_rates_sl",
      deploy: "customdeploy_rdt_pacejet_rates_sl"
    },

    location: "Curecrete",

    // --------------------------------------------------
    // NetSuite Location → Pacejet Facility mapping
    // --------------------------------------------------
    locationMap: {
      62: { code: "62", name: "Springville - CDI" }, // Utah
      63: { code: "63", name: "Delaware" }, // Delaware
      61: { code: "61", name: "Illinois" }, // Illinois
      66: { code: "66", name: "Texas" }, // Texas
      64: { code: "64", name: "Georgia" } // Georgia
    },

    // fallback if location missing
    defaultLocationId: "62",

    licenseKey: "66f5540a-9a81-ebea-c232-da7c4b18d229",

    pacejetLicenseId: "b92417f9-0ad3-09a5-563b-41cb00e0c4b8",
    upsLicenseId: "f809d2f1-af09-5ff7-e35d-2168a8de5bc9",

    origin: {
      company: "Curecrete",
      name: "Curecrete Shipping",
      phone: "",
      email: "",
      addr1: "1203 Spring Creek Place",
      addr2: "",
      city: "Springville",
      state: "UT",
      postal: "84663",
      country: "US"
    },

    carrierLimits: {
      PARCEL: {
        maxWeight: 325,
        maxDim: 119, // inches (max single side)
        carriers: {
          UPS: { maxDim: 108 },
          FEDEX: {
            // service-based (ground vs express)
            groundMaxDim: 108,
            expressMaxDim: 119
          }
        }
      },

      LTL: {
        maxWeight: 19999,
        maxDim: 240
      },

      // If EVERYTHING is suppressed, return original rates
      fallbackToOriginalIfEmpty: true
    }
  };
});
