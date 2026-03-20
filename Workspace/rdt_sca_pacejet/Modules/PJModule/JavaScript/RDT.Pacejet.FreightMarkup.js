/// <amd-module name="RDT.Pacejet.FreightMarkup"/>

define("RDT.Pacejet.FreightMarkup", [], function () {
  "use strict";

  return [
    // ==========================================
    // BASE FREIGHT MARKUP
    // ==========================================

    // ---------- UTAH ----------
    { state: "UT", mode: "LTL", percent: 25 },
    { state: "UT", mode: "PARCEL", percent: 39 },

    // ---------- DELAWARE ----------
    { state: "DE", mode: "LTL", percent: 80, heavyOnly: true },
    { state: "DE", mode: "LTL", percent: 50, lightOnly: true },
    { state: "DE", mode: "PARCEL", percent: 0 },

    // ---------- ILLINOIS ----------
    { state: "IL", mode: "LTL", percent: 90, heavyOnly: true },
    { state: "IL", mode: "LTL", percent: 50, lightOnly: true },
    { state: "IL", mode: "PARCEL", percent: 0 },

    // ---------- TEXAS ----------
    { state: "TX", mode: "LTL", percent: 90, heavyOnly: true },
    { state: "TX", mode: "LTL", percent: 50, lightOnly: true },
    { state: "TX", mode: "PARCEL", percent: 0 },

    // ---------- GEORGIA ----------
    { state: "GA", mode: "LTL", percent: 120, heavyOnly: true },
    { state: "GA", mode: "LTL", percent: 60, lightOnly: true },
    { state: "GA", mode: "PARCEL", percent: 0 },

    // ---------- DROP SHIP ----------
    { dropShip: true, percent: 39 }
  ];
});
