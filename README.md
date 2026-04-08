# PJ2 / Pacejet Extension Overview

This repository contains a SuiteCommerce extension named `rdt_sca_pacejet` plus a few standalone NetSuite Suitelets used by the extension during checkout and after order placement.

The main goal of the project is:

1. Collect the cart, shipping address, item dimensions, warehouse availability, and accessorial selections.
2. Request shipping rates from Pacejet.
3. Map Pacejet results to valid NetSuite ship methods.
4. Let the shopper choose a rate in checkout.
5. Persist the selected shipping data back to the Sales Order.
6. Create a Customer Deposit after confirmation.


#
### Checkout flow

1. `RDT.rdt_sca_pacejet.PJModule.js` mounts the frontend Pacejet modules into checkout.
2. `RDT.Pacejet.V2.js` watches checkout route changes and order events.
3. `RDT.Pacejet.Checkout.Module.V2.js` drives the shipping-step UI and selection flow.
4. `RDT.Pacejet.Service.js` builds the Pacejet request, calls the rates Suitelet, maps and filters the returned options, and hands them to the UI.
5. `API_Pacejet.js` receives the request in NetSuite, builds origin logic, calls the Pacejet API, and returns grouped multi-origin results.
6. The user selects a shipping option in the custom Pacejet UI.
7. `RDT.Pacejet.Checkout.Module.V2.js` syncs that ship method into the native LiveOrder shipping selector and stores the chosen Pacejet metadata in frontend state.
8. `Test_SO_SL.js` is called to write the final shipping amount, carrier/service details, origin data, and accessorial flags back to the Sales Order.
9. `RDT.Pacejet.Summary.js` keeps the checkout/review/confirmation summary aligned with the persisted Pacejet totals.
10. `SO_CD.js` is called on confirmation to create a Customer Deposit tied to the completed Sales Order.

### Backend services

- `API_Pacejet.js` is the rate engine adapter.
- `Test_SO_SL.js` is the Sales Order persistence/update Suitelet.
- `SO_CD.js` is the post-order deposit Suitelet.
- `PJModule.Service.ss` and the SSP service controller are a legacy/compatibility service path for LiveOrder integration inside the extension.

## What The Standalone Suitelets Do

### `API_Pacejet.js`

This is the main Pacejet rating Suitelet.

It:

- Accepts a POST payload containing destination, package details, cart snapshot, availability data, and shipment options.
- Resolves the correct shipping origin per item.
- Supports warehouse-origin, vendor-origin, and drop-ship logic.
- Enriches missing availability by loading item records in NetSuite.
- Applies order-level origin planning rules, including Florida routing, 3PL rules, mixed-origin fallbacks, and packaging thresholds.
- Groups packages by origin or forced origin plan.
- Calls Pacejet `/Rates?api-version=3.5`.
- Returns grouped results under `origins`, including each origin block's raw Pacejet response and drop-ship flag.

This Suitelet is the source of truth for rating logic.

### `Test_SO_SL.js`

This Suitelet writes the chosen shipping result back to the Sales Order.

It:

- Accepts `orderId`, `shipmethod`, `pacejetAmount`, totals, carrier/service data, origin info, and accessorial booleans.
- Loads the Sales Order.
- Sets the native NetSuite `shipmethod`.
- Sets `shippingcost`.
- Writes custom body fields such as:
  - `custbody_rdt_pacejet_amount`
  - `custbody_rdt_pj_carrier_name`
  - `custbody_rdt_pj_service_name`
  - `custbody_rdt_pj_origin_key`
  - `custbody_rdt_pj_transit_days`
  - `custbody_rdt_pj_est_arrival_date`
  - `custbody_rdt_pj_quote_json`
- Writes selected accessorial flags to custom body fields.
- Attempts tax override and recalculation behavior and returns diagnostics showing what persisted.
- Resolves the Sales Order `location` from the selected origin data when possible.

This Suitelet is what turns a chosen Pacejet quote into actual Sales Order data.

### `SO_CD.js`

This Suitelet creates a new Customer Deposit from the final Sales Order total.

It:

- Accepts a Sales Order id.
- Loads the Sales Order after checkout is complete.
- Reads subtotal, shipping, tax, and total from the persisted order.
- Extracts payment method and credit card metadata from the SO payment methods sublist.
- Creates a new `Customer Deposit`.
- Sets the deposit amount to the Sales Order total, including shipping and tax.
- Clears gateway-specific fields so the deposit record does not try to re-run a card charge.
- Stores card metadata into custom deposit fields.

This is the final post-confirmation step in the flow.

## How They Work Together

- `API_Pacejet.js` calculates the available shipping options.
- The frontend extension renders those options and lets the shopper choose one.
- `Test_SO_SL.js` persists the chosen result back to the Sales Order so NetSuite totals and custom fields match the Pacejet choice.
- `SO_CD.js` then uses the saved Sales Order total to create the deposit after order confirmation.

In short:

- `API_Pacejet.js` = get rates
- `Test_SO_SL.js` = save chosen rate to Sales Order
- `SO_CD.js` = create deposit from final order

## Extension Structure

The actual SuiteCommerce extension lives under:

- `Workspace/rdt_sca_pacejet`

### Top-level extension files

#### `Workspace/rdt_sca_pacejet/manifest.json`

Extension manifest. Declares the extension metadata, checkout entry point, templates, Sass, configuration file, and SSP libraries.

#### `Workspace/rdt_sca_pacejet/Modules/PJModule/Configuration/PJModule.json`

SuiteCommerce configuration schema stub for the module. At the moment this is mostly placeholder configuration metadata.

#### `Workspace/rdt_sca_pacejet/Modules/PJModule/Templates/rdt_rdt_sca_pacejet_pjmodule.tpl`

Placeholder template file. It is currently minimal and not the main source of the Pacejet UI.

#### `Workspace/rdt_sca_pacejet/Modules/PJModule/Sass/_rdt_sca_pacejet-pjmodule.scss`

Sass stylesheet for the module's checkout UI.

## Frontend JavaScript files

#### `RDT.rdt_sca_pacejet.PJModule.js`

Frontend entry point. Mounts the Pacejet summary override and the Pacejet checkout module into the application.

#### `RDT.Pacejet.V2.js`

Frontend orchestration layer. Watches checkout route changes, shipping step, review, and confirmation. Also triggers:

- rate flow on shipping step
- summary syncing on review and confirmation
- `Test_SO_SL.js` on confirmation
- `SO_CD.js` after successful persistence

#### `RDT.Pacejet.Checkout.Module.V2.js`

Main checkout controller. Handles:

- wiring to `LiveOrder.Model`
- showing and hiding Pacejet rates UI
- loading rates
- applying the selected ship method to the native checkout selector
- preview total requests
- syncing accessorials
- preparing Pacejet fields before place order

This is the main "business flow" file on the frontend.

#### `RDT.Pacejet.Service.js`

Service and orchestration layer for rating. Handles:

- building the cart snapshot
- calling the rate Suitelet
- mapping raw Pacejet responses into UI rates
- drop-ship filtering
- carrier suppression rules
- accessorial filtering
- freight markup logic
- carrier limit checks
- caching rate results

#### `RDT.Pacejet.State.js`

Shared in-memory state store for the frontend. Tracks:

- last rates and hashes
- selected rate
- accessorial selections
- forced accessorials
- UI flags
- persistence results
- unmapped and fallback mapping observations

#### `RDT.Pacejet.UI.js`

Renders the custom shipping UI. Handles:

- accessorial checkbox rendering
- shipping option table rendering
- truckload notice rendering
- selection events
- continue button enable and disable state
- review-step selected shipping card

#### `RDT.Pacejet.Summary.js`

Overrides and repaints checkout, review, and confirmation summaries so Pacejet shipping, tax, and total values stay visible even when the native summary would otherwise lag or overwrite them.

#### `RDT.Pacejet.Config.js`

Static configuration file for the integration. Contains:

- Pacejet and NetSuite ship method mappings
- fallback mappings
- suitelet URLs
- location mapping
- default origin values
- license ids
- carrier limit rules
- markup enable flag

#### `RDT.Pacejet.AccessorialMatrix.js`

Defines which accessorials are allowed by carrier, plus suppression rules and drop-ship carrier restrictions.

#### `RDT.Pacejet.CarrierMap.js`

Small fallback map of carrier families to default NetSuite ship method ids.

#### `RDT.Pacejet.FreightMarkup.js`

Markup rule table by origin state, mode, and drop-ship behavior.

#### `RDT.Pacejet.Mapping.js`

Maps Pacejet carrier and service combinations to valid NetSuite ship method ids. It tries:

1. API ship code
2. explicit config rule
3. fallback carrier rule
4. unmapped tracking

#### `RDT.Pacejet.Mapping.Suggestions.js`

Observability helper that builds suggested future mapping rules from unmapped and fallback rate history.

#### `RDT.Pacejet.Pacejet.Payload.js`

Builds outbound Pacejet request payloads from the cart and shipping address. Also translates accessorials into Pacejet shipment service codes.

#### `RDT.Pacejet.Pacejet.Mapper.js`

Maps raw Pacejet responses into frontend rate objects and aggregates multi-origin shipments into consolidated UI options.

#### `RDT.Pacejet.Pacejet.Model.js`

Backbone model wrapper around the rates Suitelet endpoint. Mostly a lightweight fetch abstraction.

#### `RDT.rdt_sca_pacejet.PJModule.Model.js`

Standard generated extension model pointing to `PJModule.Service.ss`. Mostly scaffolding.

#### `RDT.rdt_sca_pacejet.PJModule.SS2Model.js`

SuiteScript 2 model variant for the same service endpoint. Also mostly scaffolding.

## SuiteScript / SSP backend files inside the extension

#### `RDT.rdt_sca_pacejet.PJModule.js`

Minimal SSP library entry point for the backend portion of the extension.

#### `PJModule.ServiceController.js`

Service controller for the extension service endpoint. Parses incoming JSON and forwards POST and PUT requests to `RDT.Pacejet.Cart.Model`.

#### `RDT.Pacejet.Cart.Helper.js`

Backend helper for:

- normalizing payloads
- normalizing ship method ids
- building persistence field maps
- reading persisted Pacejet custom fields
- building summary totals

#### `RDT.Pacejet.Cart.Model.js`

Backend LiveOrder bridge. Applies shipmethod updates to the LiveOrder model and returns summary data. It currently leaves direct record persistence disabled in this path and relies on the dedicated Suitelet-based persistence flow instead.

#### `PJModule.Service.ss`

SuiteScript 2 SSP service entry point that hands requests to `PJModule.ServiceController.js`.

## Current Architecture Notes

- The checkout UI is primarily driven by the custom frontend files in `JavaScript/`.
- The actual rate call goes to the standalone Suitelet `API_Pacejet.js`, not the lightweight SSP service.
- The actual Sales Order persistence is handled by `Test_SO_SL.js`.
- The actual Customer Deposit creation is handled by `SO_CD.js`.
- The SSP `PJModule.Service.ss` path appears to exist mainly as legacy or generated support infrastructure and a fallback integration surface.

## Repository Files Outside The Extension

#### `API_Pacejet.js`

Standalone Pacejet rates Suitelet used by the frontend integration.

#### `SO_CD.js`

Standalone Sales Order to Customer Deposit Suitelet.

#### `Test_SO_SL.js`

Standalone Sales Order shipping apply and update Suitelet.

## In Practice

If you are tracing a bug, the most common path is:

1. Start in `RDT.Pacejet.Checkout.Module.V2.js`
2. Follow into `RDT.Pacejet.Service.js`
3. Check `RDT.Pacejet.Pacejet.Payload.js` and `RDT.Pacejet.Pacejet.Mapper.js`
4. Review `API_Pacejet.js`
5. If the issue is persistence, review `Test_SO_SL.js`
6. If the issue is confirmation or deposit, review `RDT.Pacejet.V2.js` and `SO_CD.js`
