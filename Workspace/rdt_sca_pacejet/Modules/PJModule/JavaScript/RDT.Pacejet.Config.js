/// <amd-module name="RDT.Pacejet.Config"/>

define("RDT.Pacejet.Config", [], function () {
  "use strict";

  return {
    // --------------------------------------------------
    // Phase 5.1 — Explicit Pacejet → NetSuite mapping
    // --------------------------------------------------

    shipmethodMap: [
      // --------------------
      // WILL CALL
      // --------------------
      { carrier: "WILL CALL", shipCode: "4255" },
      { carrier: "EXW", shipCode: "7522" },

      // --------------------
      // UPS
      // --------------------
      { carrier: "UPS", serviceIncludes: "GROUND", shipCode: "1358" },
      { carrier: "UPS", serviceIncludes: "2ND DAY", shipCode: "1354" },
      { carrier: "UPS", serviceIncludes: "3 DAY", shipCode: "1356" },
      { carrier: "UPS", serviceIncludes: "NEXT DAY", shipCode: "1359" },
      { carrier: "UPS", serviceIncludes: "SAVER", shipCode: "1360" },
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
      // XPO
      // --------------------
      { carrier: "XPO", serviceIncludes: "GUARANTEED", shipCode: "1368" },
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

    getRatesUrl: "/app/site/hosting/scriptlet.nl?script=3954&deploy=1",

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
