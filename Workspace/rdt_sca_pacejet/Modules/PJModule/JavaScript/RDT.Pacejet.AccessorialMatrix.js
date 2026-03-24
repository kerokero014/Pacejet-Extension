define("RDT.Pacejet.AccessorialMatrix", [], function () {
  "use strict";

  return {
    /* ==========================================
     * ACCESSORIAL SUPPORT PER CARRIER
     * ========================================== */
    carriers: {
      NONE: {
        driver_call: false,
        job_site: false,
        lift_gate: false,
        residential: false,
        schedule_appt: false,
        self_storage: false,
        school: false,
        inside_delivery: false,
        hazmat_parcel: false,
        dangerous_goods: false
      },
      AAA_COOPER: {
        driver_call: true,
        job_site: true,
        lift_gate: true,
        residential: true,
        schedule_appt: true,
        self_storage: true,
        school: true,
        inside_delivery: true,
        hazmat_parcel: false,
        dangerous_goods: true
      },
      ESTES: {
        driver_call: true,
        job_site: true,
        lift_gate: true,
        residential: true,
        schedule_appt: true,
        self_storage: true,
        school: true,
        inside_delivery: true,
        hazmat_parcel: false,
        dangerous_goods: false
      },
      FEDEX_FREIGHT: {
        driver_call: true,
        job_site: true,
        lift_gate: true,
        residential: true,
        schedule_appt: false,
        self_storage: false,
        school: false,
        inside_delivery: true,
        hazmat_parcel: false,
        dangerous_goods: true
      },
      SAIA: {
        driver_call: false,
        job_site: false,
        lift_gate: true,
        residential: true,
        schedule_appt: true,
        self_storage: false,
        school: false,
        inside_delivery: true,
        hazmat_parcel: false,
        dangerous_goods: false
      },
      XPO: {
        driver_call: true,
        job_site: true,
        lift_gate: true,
        residential: true,
        schedule_appt: false,
        self_storage: false,
        school: false,
        inside_delivery: false,
        hazmat_parcel: false,
        dangerous_goods: true
      }
    },

    /* ==========================================
     * SHIPMENT SUPPRESSION RULES (STATE-BASED)
     * ========================================== */
    suppressionRules: [
      {
        originState: "IL",
        suppressCarriers: ["RL_CARRIERS", "NORTH_PARK"]
      },
      {
        originState: "DE",
        suppressCarriers: ["AAA_COOPER", "DIAMOND_LINE"]
      }
    ],

    /* ==========================================
     * DROPSHIP-ONLY SUPPRESSION RULE
     * ========================================== */
    dropShipRules: {
      allowedCarriers: ["FEDEX", "UPS", "FEDEX_FREIGHT"]
    }
  };
});
