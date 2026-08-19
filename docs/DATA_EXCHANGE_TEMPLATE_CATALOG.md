# Data Exchange template catalog

All 45 registered templates (the original 24 mandated templates, plus
11 Reverse Formulation templates, 6 Phase 8 dossier-expansion templates,
and the 4 FVL-04.005/.007/.008/.011 operational templates below), every column,
straight from
`packages/shared/src/engine/dataExchangeRegistry.ts` (the single source
of truth — this document is a rendering of it, not a separate spec).
Every template supports both CSV and Excel, `schemaVersion: "1.0"`.
"Commit" says whether a real handler in
`apps/desktop/src/lib/dataExchangeCommit.ts` writes the row, or whether
the template is registered-but-unwired (see
[DATA_EXCHANGE_CENTER.md](DATA_EXCHANGE_CENTER.md#implemented-vs-not-yet-implemented)).

Role-group shorthand: **Master** = administrator only. **Quality** =
quality, administrator. **Formulation** = researcher, chemist,
administrator. **Cost** = chemist, quality, administrator. **Lab** =
researcher, chemist, quality, administrator. **Regulatory** = regulatory,
quality, administrator. **Draft** = researcher, chemist, quality,
regulatory, administrator. **DOE** = researcher, chemist, administrator.

---

## 1. Raw Materials Master — `raw_materials`

Module: materials · Natural key: `material_code` · Duplicate policy:
`create_or_update` · Authorization: Master · Target collection:
`materials` · Commit: **wired**

`material_code` updates mutable material fields on the existing record;
the code itself is immutable once created.

| Column | Type | Req'd | Description |
|---|---|---|---|
| material_code | code_reference | yes | Stable internal material code — the natural key. |
| material_name | string | yes | Display name. |
| inci_name | string | | INCI name. |
| cas_number | multi_value | | CAS number(s), semicolon-separated. |
| ec_number | multi_value | | EC number(s), semicolon-separated. |
| material_category | string | | Broad category, e.g. Surfactant, Preservative. |
| material_function | multi_value | | Functional role(s), semicolon-separated — real `MaterialFunction` enum values only; an unrecognized token is dropped at commit, never fabricated as a role (FVL-04.001 — this mapping was previously silently discarded entirely; now real). |
| physical_form | string | | Liquid, powder, paste, ... |
| active_matter_percent | percentage | | As-supplied active content. |
| density | decimal | | g/mL at 20°C. |
| recommended_min_percent | percentage | | Recommended minimum use concentration — read by `resolve_concentration()`'s Tier 4 (FVL-04.001). |
| recommended_max_percent | percentage | | Recommended maximum use concentration — read by `resolve_concentration()`'s Tier 4 (FVL-04.001). |
| technical_max_percent | percentage | | Hard technical ceiling — above this the material does not work, whatever a spec says (FVL-04.001). |
| default_unit | string | | Default quantity unit, e.g. kg (default `kg`). |
| currency | enum | | Default price currency: KES/USD/EUR/GBP/TZS/UGX. |
| default_price | currency | | Reference price; historical pricing lives on the Material-Supplier Price List template. |
| price_basis_quantity | decimal | | Quantity the default_price is per (default 1). |
| manufacturer_name | string | | Manufacturer name. |
| manufacturer_code | string | | Manufacturer's own code for this material. |
| preferred_supplier_code | code_reference → suppliers.supplier_code | | Preferred supplier. |
| country_of_origin | string | | ISO country of origin. |
| manufacture_date | date | | Reference batch manufacture date (metadata, not a lot record). |
| expiry_date | date | | Reference batch expiry date (metadata, not a lot record). |
| shelf_life_months | integer | | Typical shelf life. |
| minimum_order_quantity | decimal | | MOQ in default_unit. |
| lead_time_days | integer | | Typical lead time. |
| storage_condition | string | | Storage instructions. |
| hazardous | boolean | | GHS-hazardous flag (default false). |
| allergen | boolean | | Contains a declarable allergen (default false). |
| vegan | boolean | | Vegan-suitable (default false). |
| natural_origin_percent | percentage | | ISO 16128 natural-origin index. |
| renewable_carbon_percent | percentage | | Renewable-carbon index. |
| biodegradable | boolean | | Readily biodegradable per OECD 301. |
| regulatory_status | string | | Free-text summary; **does not itself verify a regulatory rule.** |
| tags | multi_value | | Semicolon-separated tags. |
| notes | string | | Free text. |

---

## 2. Suppliers Master — `suppliers`

Module: materials · Natural key: `supplier_code` · Duplicate policy:
`create_or_update` · Authorization: Master · Target collection:
`suppliers` · Commit: **wired**

`supplier_code` updates mutable supplier fields; `approved_supplier` is
never set true by import alone.

| Column | Type | Req'd | Description |
|---|---|---|---|
| supplier_code | code_reference | yes | Stable internal supplier code — the natural key. |
| supplier_name | string | yes | Display name. |
| legal_name | string | | Registered legal name. |
| contact_name | string | | Primary contact. |
| email | string | | Contact email. |
| phone | string | | Contact phone. |
| website | url | | Supplier website. |
| country | string | | ISO country. |
| city | string | | City. |
| address | string | | Postal address. |
| currency | enum | | Quoting currency (default `KES`). |
| payment_terms | string | | Payment terms, e.g. "Net 30". |
| lead_time_days | integer | | Typical lead time. |
| minimum_order_value | currency | | MOQ expressed as a value. |
| approved_supplier | boolean | | **A quality decision — import never sets this true on its own** (default false). |
| qualification_status | enum | | approved / conditional / under_review / suspended / not_assessed. |
| last_audit_date | date | | Date of last audit. |
| next_audit_date | date | | Date of next scheduled audit. |
| rating | decimal (0-5) | | Supplier rating. |
| tags | multi_value | | Semicolon-separated tags. |
| notes | string | | Free text. |

---

## 3. Material-Supplier Price List — `material_prices`

Module: materials · Natural key: `material_code, supplier_code,
valid_from` · Duplicate policy: `append_history` · Authorization: Master
· Target collection: `material_prices` · Commit: **wired**

Every row is a new price-validity period; re-importing an identical
period is a duplicate, never a silent overwrite of a prior quote.

| Column | Type | Req'd | Description |
|---|---|---|---|
| material_code | code_reference → raw_materials | yes | Material this price is for. |
| supplier_code | code_reference → suppliers | yes | Quoting supplier. |
| supplier_material_code | string | | Supplier's own code for the material. |
| manufacturer_name | string | | Manufacturer name. |
| brand_name | string | | Brand/trade name. |
| currency | enum | yes | Quote currency: KES/USD/EUR/GBP/TZS/UGX. |
| unit_price | currency | yes | Price per price_unit. |
| price_unit | string | | Unit the price is quoted per (default `kg`). |
| minimum_order_quantity | decimal | | MOQ for this quote. |
| pack_size | string | | Supplier pack size, e.g. 25kg drum. |
| valid_from | date | yes | Validity start. |
| valid_until | date | | Validity end, open-ended if blank. |
| lead_time_days | integer | | Lead time for this quote. |
| incoterm | string | | Incoterm, e.g. FOB. |
| country_of_origin | string | | Country of origin for this quote. |
| preferred | boolean | | Preferred quote for this material (default false). |
| approved | boolean | | **A quality decision; never set true by import alone** (default false). |
| certificate_available | boolean | | A certificate of analysis type is available. |
| coa_available | boolean | | COA available. |
| sds_available | boolean | | SDS available. |
| notes | string | | Free text. |

---

## 4. Material Documents Register — `material_documents`

Module: materials · Natural key: `material_code, document_type,
document_number` · Duplicate policy: `create_or_update` · Authorization:
Quality · Target collection: `material_documents` · Commit: **wired**

Metadata updates on match; `verification_status`/`verified_by`/
`verified_at` are never set by import.

**FVL-04.003/.004**: this is the confirmed, sole canonical TDS and SDS
import/reference path — both are real `document_type` values on the
same template, same commit handler, same collection; no separate TDS or
SDS storage framework exists or was created. `RawMaterial.documents[]`
(a different, older field shape) is confirmed unused by any UI or import
path — not a competing document registry, just dead schema. This
template is metadata-only by design (no file-binary ingestion anywhere
in Data Exchange) — `file_name`/`expected_sha256` are a match-against-a-
locally-held-file hint for a human, never an attachment.

| Column | Type | Req'd | Description |
|---|---|---|---|
| material_code | code_reference → raw_materials | yes | Material the document is for. |
| supplier_code | code_reference → suppliers | | Issuing/related supplier. |
| document_type | enum (13 values, see `MATERIAL_DOCUMENT_TYPES`) | yes | SDS/TDS/COA/etc. |
| document_number | string | | Issuer's document number. |
| document_title | string | yes | Document title. |
| revision | string | | Revision label. |
| language | string | | Document language. |
| issuer | string | | Issuing organization. |
| issue_date | date | | Issue date. |
| expiry_date | date | | Expiry date, if applicable. |
| file_name | file_name | | Name of a locally-selected file to match against — **importing metadata never attaches a file by itself.** |
| expected_sha256 | sha256 | | Expected SHA-256 of the matched file, for integrity checking. |
| verification_status | enum | | **An import can never set this to "verified"; always recorded unverified regardless of the file's content.** |
| tags | multi_value | | Semicolon-separated tags. |
| notes | string | | Free text. |

---

## 5. Product Families — `product_families`

Module: product · Natural key: `family_code` · Duplicate policy:
`create_or_update` · Authorization: Master · Target collection:
`product_families` · Commit: **wired**

`family_code` updates mutable fields on the existing record. This is a
live, mutable master-data collection, distinct from the static Kenya
reference catalog's `productFamilySchema`.

| Column | Type | Req'd | Description |
|---|---|---|---|
| family_code | code_reference | yes | Stable family code — natural key. |
| family_name | string | yes | Display name. |
| category | string | | Category, e.g. Personal Care. |
| subcategory | string | | Subcategory, e.g. Hand Wash. |
| default_unit | string | | Default batch-size unit (default `kg`). |
| default_batch_size | decimal | | Default batch size in default_unit. |
| target_market | string | | Primary target market. |
| default_jurisdictions | multi_value | | Default regulatory jurisdictions, semicolon-separated. |
| default_packaging_type | string | | Default packaging type. |
| active | boolean | | Active flag (default true). |
| tags | multi_value | | Semicolon-separated tags. |
| notes | string | | Free text. |

---

## 6. Finished Products / SKU Master — `finished_products`

Module: product · Natural key: `sku_code` · Duplicate policy:
`create_or_update` · Authorization: Master · Target collection:
`finished_products` · Commit: **wired**

`sku_code` updates mutable fields on the existing record.

| Column | Type | Req'd | Description |
|---|---|---|---|
| sku_code | code_reference | yes | Stable SKU code — natural key. |
| sku_name | string | yes | Display name. |
| product_family_code | code_reference → product_families | | Owning product family. |
| brand | string | | Brand name. |
| formula_code | code_reference → formula_bom | | Formula this SKU is filled from. |
| formula_version | integer | | Specific saved formula version, if pinned. |
| packaging_sku_code | code_reference → packaging_bom | | Packaging BOM used. |
| net_quantity | decimal | | Net fill quantity. |
| quantity_unit | string | | Unit for net_quantity, e.g. ml. |
| barcode | string | | EAN/UPC barcode. |
| target_markets | multi_value | | Target markets, semicolon-separated. |
| languages | multi_value | | Label languages, semicolon-separated. |
| status | enum | | draft / active / discontinued (default draft). |
| manufacture_site | string | | Manufacturing site. |
| shelf_life_months | integer | | Shelf life. |
| tags | multi_value | | Semicolon-separated tags. |
| notes | string | | Free text. |

---

## 7. Packaging Components — `packaging_components`

Module: packaging · Natural key: `component_code` · Duplicate policy:
`create_or_update` · Authorization: Master · Target collection:
`packaging_components` · Commit: **wired**

`component_code` updates mutable fields on the existing record.

| Column | Type | Req'd | Description |
|---|---|---|---|
| component_code | code_reference | yes | Stable component code — natural key. |
| component_name | string | yes | Display name. |
| component_type | string | yes | e.g. bottle. |
| material_type | string | | Packaging material, e.g. PET. |
| supplier_code | code_reference → suppliers | | Supplier. |
| manufacturer_name | string | | Manufacturer name. |
| capacity | decimal | | Capacity. |
| capacity_unit | string | | Capacity unit, e.g. ml. |
| weight | decimal | | Component weight. |
| weight_unit | string | | Weight unit, e.g. g. |
| color | string | | Color. |
| dimensions | string | | Free-text dimensions. |
| closure_type | string | | Closure type. |
| food_contact | boolean | | Food-contact grade. |
| recyclable | boolean | | Recyclable. |
| recycled_content_percent | percentage | | Recycled content. |
| unit_price | currency | | Unit price. |
| currency | enum | | Price currency. |
| minimum_order_quantity | decimal | | MOQ. |
| lead_time_days | integer | | Lead time. |
| tags | multi_value | | Semicolon-separated tags. |
| notes | string | | Free text. |

---

## 8. Packaging SKU / Packaging BOM — `packaging_bom`

Module: packaging · Natural key: `packaging_sku_code, component_code` ·
Duplicate policy: `create_or_update` · Authorization: Master · Target
collection: `packaging_boms` · Commit: **wired**

One row per (packaging SKU, component); several rows share one
`packaging_sku_code`. An existing (packaging_sku_code, component_code)
line updates in place — the packaging BOM record itself is mutable,
unlike price history.

| Column | Type | Req'd | Description |
|---|---|---|---|
| packaging_sku_code | code_reference | yes | Packaging BOM code — natural key together with component_code. |
| packaging_sku_name | string | | Display name (only needs to appear on one row of the group). |
| product_family_code | code_reference → product_families | | Owning product family. |
| component_code | code_reference → packaging_components | yes | Component used in this line. |
| component_quantity | decimal | yes | Quantity of this component per unit. |
| quantity_unit | string | | Unit for component_quantity (default `pieces`). |
| primary_packaging | boolean | | Primary packaging flag. |
| secondary_packaging | boolean | | Secondary packaging flag. |
| tertiary_packaging | boolean | | Tertiary packaging flag. |
| fill_volume | decimal | | Fill volume (header fact, first non-empty row wins). |
| fill_weight | decimal | | Fill weight (header fact, first non-empty row wins). |
| line_code | string | | Filling line code. |
| unit_cost | currency | | Unit cost. |
| currency | enum | | Cost currency. |
| effective_from | date | | Validity start. |
| effective_until | date | | Validity end. |
| tags | multi_value | | Semicolon-separated tags. |
| notes | string | | Free text. |

---

## 9. Formula / BOM Import — `formula_bom`

Module: formulation · Natural key: `formula_code, formula_version,
line_number` · Duplicate policy: `new_revision` (**grouped commit**) ·
Authorization: Formulation · Target collection: `formulations` (the
session-based store, not a generic masterdata collection) · Commit:
**wired**

Rows sharing `(formula_code, formula_version)` are grouped and become
one saved formula version. An existing `(formula_code, formula_version)`
is immutable and refused; a new version number is created (or the next
one auto-assigned when `formula_version` is left blank).

| Column | Type | Req'd | Description |
|---|---|---|---|
| formula_code | code_reference | yes | Formula code — the group key. |
| formula_name | string | | Formula/product display name (header fact). |
| formula_version | integer | | Target version number — see above. |
| project_code | string | | Originating project code, if any. |
| product_family_code | code_reference → product_families | | Product family (header fact). |
| line_number | integer | yes | Line number within the formula; unique per formula/version. |
| material_code | code_reference → raw_materials | yes | Material for this line. |
| quantity | decimal | | As-supplied quantity at the batch basis. |
| quantity_unit | string | | Unit for quantity (default `kg`). |
| percentage | percentage | yes | As-supplied percent of the total formula. |
| phase | string | | Manufacturing phase (default `A`). |
| addition_order | integer | | Addition order within the phase. |
| process_temperature | decimal | | Process temperature for this addition. |
| mixing_speed | string | | Mixing speed for this addition. |
| mixing_time | string | | Mixing time for this addition. |
| is_qs_material | boolean | | True for the line that absorbs the remainder to 100% — its percentage is computed, not authored. |
| function | string | | Functional role of this line. |
| notes | string | | Free text. |

---

## 10. Process Parameters — `process_parameters`

Module: formulation · Natural key: `formula_code, formula_version,
step_number` · Duplicate policy: `create_or_update` · Authorization:
Formulation · Target collection: `process_parameters` · Commit: **wired**

`(formula_code, formula_version, step_number)` updates the existing
step.

| Column | Type | Req'd | Description |
|---|---|---|---|
| formula_code | code_reference → formula_bom | yes | Formula this process belongs to. |
| formula_version | integer | yes | Formula version this process belongs to. |
| step_number | integer | yes | Step order. |
| step_name | string | | Step name. |
| phase | string | | Manufacturing phase. |
| equipment_type | string | | Equipment used. |
| temperature_min / temperature_target / temperature_max | decimal | | Temperature range. |
| mixing_speed_min / mixing_speed_target / mixing_speed_max | decimal | | Mixing speed range. |
| mixing_time_minutes | decimal | | Mixing duration. |
| addition_rate | string | | Rate of addition, free text. |
| hold_time_minutes | decimal | | Hold time. |
| critical_parameter | boolean | | Flags a critical process parameter (default false). |
| instruction | string | | Operator instruction text. |
| notes | string | | Free text. |

---

## 11. Costing Assumptions — `costing_assumptions`

Module: costing · Natural key: `costing_profile_code, effective_date` ·
Duplicate policy: `append_history` · Authorization: Cost · Target
collection: `factory_cost_profiles` · Commit: **wired**

A new `effective_date` for an existing profile code is appended,
preserving historical costing snapshots. `freight_percent`/
`duty_percent`/`tax_percent`/`target_margin_percent` are folded into the
profile's `notes` on commit — the factory cost profile schema doesn't
have dedicated fields for them yet.

| Column | Type | Req'd | Description |
|---|---|---|---|
| costing_profile_code | code_reference | yes | Stable profile code — natural key. |
| currency | enum | yes | Profile currency. |
| effective_date | date | yes | Effective date. |
| labor_cost_per_hour | currency | | Direct labour cost per hour. |
| energy_cost_per_kwh | currency | | Electricity cost per kWh. |
| water_cost_per_m3 | currency | | Water cost per m3. |
| steam_cost_per_kg | currency | | Steam cost per kg. |
| waste_cost_per_kg | currency | | Waste disposal cost per kg. |
| overhead_percent | percentage | | Overhead percent. |
| manufacturing_loss_percent | percentage | | Expected manufacturing loss. |
| freight_percent | percentage | | Freight allocation percent (kept as a note). |
| duty_percent | percentage | | Duty percent (kept as a note). |
| tax_percent | percentage | | Tax percent (kept as a note). |
| target_margin_percent | percentage | | Target margin (kept as a note). |
| notes | string | | Free text. |

---

## 12. Formula Cost Overrides — `formula_cost_overrides`

Module: costing · Natural key: `formula_code, formula_version,
material_code, effective_from` · Duplicate policy: `append_history` ·
Authorization: Cost · Target collection: `formula_cost_overrides` ·
Commit: **wired**

A new `effective_from` period is appended; `approved_by` text is stored
as a note only and never grants approval.

| Column | Type | Req'd | Description |
|---|---|---|---|
| formula_code | code_reference → formula_bom | yes | Formula this override applies to. |
| formula_version | integer | yes | Formula version. |
| material_code | code_reference → raw_materials | yes | Material being overridden. |
| supplier_code | code_reference → suppliers | | Supplier for the override price. |
| override_price | currency | yes | Override unit price. |
| currency | enum | yes | Currency. |
| price_unit | string | | Unit the override price is per (default `kg`). |
| effective_from | date | yes | Validity start. |
| effective_until | date | | Validity end. |
| reason | string | | Reason for the override. |
| approved_by | string | | **Kept as a note only — never grants approval; a real approval requires the existing authorization workflow, separately, after import.** |
| notes | string | | Free text. |

---

## 13. Laboratory Test Definitions — `test_definitions`

Module: laboratory · Natural key: `test_code` · Duplicate policy:
`create_or_update` · Authorization: Lab · Target collection:
`test_definitions` · Commit: **wired**

`test_code` updates mutable fields on the existing definition;
`verificationStatus` is always written `imported_unverified`.

| Column | Type | Req'd | Description |
|---|---|---|---|
| test_code | code_reference | yes | Stable test code — natural key. |
| test_name | string | yes | Display name. |
| test_category | string | | Category, e.g. physicochemical. |
| method_reference | string | | Method reference/standard. |
| unit | string | | Result unit. |
| result_type | enum | | numeric / text / pass_fail (default numeric). |
| lower_limit / target_value / upper_limit | decimal | | Acceptable range and target. |
| decimal_places | integer | | Display decimal places. |
| replicate_count | integer | | Required replicate count (default 1). |
| destructive_test | boolean | | Destructive test flag. |
| required_for_release | boolean | | Required for batch release (default false). |
| required_for_stability | boolean | | Required for stability protocols (default false). |
| active | boolean | | Active flag (default true). |
| tags | multi_value | | Semicolon-separated tags. |
| notes | string | | Free text. |

---

## 14. Laboratory Results — `lab_results`

Module: laboratory · Natural key: `trial_code, sample_code, test_code,
replicate_number` · Duplicate policy: `new_revision` (**grouped
commit**) · Authorization: Lab · Target collection: `test_results` ·
Commit: **wired**

Rows sharing `(trial_code, sample_code, test_code)` are grouped into one
saved test result's `replicates[]`. Re-importing the same
(trial, sample, test, replicate) creates a **new result revision**
rather than overwriting the original measurement — laboratory results
are append-only history; the new revision stays unreviewed until a human
reviews it in the Laboratory workspace. Requires an existing
`laboratory_trials` row (matched by `trial_code`) and an existing
`test_definitions` row (matched by `test_code`) — both resolved through
live lookups, both refused with a named error if missing.

| Column | Type | Req'd | Description |
|---|---|---|---|
| project_code | string | | Owning project/formulation code. |
| formula_version | integer | | Formula version tested. |
| trial_code | code_reference | yes | Laboratory trial this result belongs to. |
| sample_code | string | yes | Sample identifier. |
| test_code | code_reference → test_definitions | yes | Test performed. |
| replicate_number | integer | yes | Replicate number (default 1). |
| numeric_value | decimal | | Numeric result. **Left blank, the value is stored as missing, never as zero.** |
| text_value | string | | Text/pass-fail result. |
| unit | string | | Result unit. |
| result_date | date | | Date measured. |
| analyst | string | | Analyst. |
| instrument | string | | Instrument used. |
| status | enum | | Import always writes an unreviewed result; formal review happens afterward in the Laboratory workspace. |
| deviation_code | string | | Deviation reference, if any. |
| notes | string | | Free text. |

---

## 15. Stability Protocols — `stability_protocols`

Module: stability · Natural key: `protocol_code, condition_code,
time_point, test_code` · Duplicate policy: `create_or_update` ·
Authorization: Lab · Target collection: `stability_studies` · Commit:
**not wired** — see
[below](#stability-protocols-and-stability-results-not-wired).

| Column | Type | Req'd | Description |
|---|---|---|---|
| protocol_code | code_reference | yes | Protocol code — natural key together with condition_code/time_point/test_code. |
| protocol_name | string | | Display name (header fact). |
| product_family_code | code_reference → product_families | | Product family (header fact). |
| packaging_sku_code | code_reference → packaging_bom | | Packaging used (header fact). |
| condition_code | string | yes | Storage condition code, e.g. 40C-75RH. |
| temperature | decimal | | Condition temperature. |
| humidity | decimal | | Condition humidity. |
| light_condition | string | | Light exposure condition. |
| orientation | string | | Sample orientation. |
| time_point | string | yes | Time point label, e.g. M3. |
| time_unit | string | | Unit for the time point (default `months`). |
| test_code | code_reference → test_definitions | yes | Test required at this time point. |
| sample_quantity | integer | | Samples required. |
| acceptance_criteria | string | | Free-text acceptance criteria. |
| active | boolean | | Active flag (default true). |
| notes | string | | Free text. |

---

## 16. Stability Results — `stability_results`

Module: stability · Natural key: `study_code, sample_code,
condition_code, time_point, test_code` · Duplicate policy:
`new_revision` · Authorization: Lab · Target collection:
`stability_results` · Commit: **not wired** — see
[below](#stability-protocols-and-stability-results-not-wired).

| Column | Type | Req'd | Description |
|---|---|---|---|
| study_code | code_reference | yes | Stability study code. |
| sample_code | string | yes | Sample identifier. |
| formula_version | integer | | Formula version. |
| packaging_sku_code | code_reference → packaging_bom | | Packaging used. |
| condition_code | string | yes | Storage condition. |
| time_point | string | yes | Time point. |
| test_code | code_reference → test_definitions | yes | Test performed. |
| numeric_value | decimal | | Numeric result. **A future time point that has not been tested yet is never converted to zero or to a failure — leave it out of the file.** |
| text_value | string | | Text result. |
| unit | string | | Result unit. |
| result_date | date | | Date measured. |
| analyst | string | | Analyst. |
| status | enum | | Import always writes an unreviewed result. |
| observation | string | | Free-text observation. |
| notes | string | | Free text. |

### Stability Protocols and Stability Results — not wired

Both templates are fully registered (schema, CSV, Excel, validation —
identical quality to every other template) but have no commit handler.
`stabilityStudySchema` requires a frozen `formulaSnapshot`/
`packagingSnapshot` — a deep, point-in-time capture of the formula and
packaging a study was actually run against — that cannot be safely
synthesized from a spreadsheet row without inventing data the platform's
core "never fabricate" rule forbids. Uploading either template previews
normally (headers, validation, row classification all work); attempting
to commit reports every row `skipped` with "No commit handler is wired
for template … yet" — never a silent or fake write, and never a
misleading "success."

---

## 17. Regulatory Rules — `regulatory_rules`

Module: regulatory · Natural key: `rule_code` · Duplicate policy:
`create_or_update` · Authorization: Regulatory · Target collection:
`regulatory_rules` · Commit: **wired**

`rule_code` updates mutable content fields in place;
`verification_status`/`verified_by`/`verified_at` are never taken from
the file — every import resets `verificationStatus` to `not_verified`,
so an updated rule always needs re-verification. An unrecognized
`rule_type` is refused with the full list of valid values, never
silently mis-filed.

| Column | Type | Req'd | Description |
|---|---|---|---|
| rule_code | code_reference | yes | Stable rule code — natural key. |
| jurisdiction | string | yes | Jurisdiction code, e.g. KE. |
| authority | string | | Issuing authority. |
| rule_type | enum (`REGULATORY_RULE_TYPES`) | | e.g. label_requirement. |
| product_family_code | code_reference → product_families | | Scoping product family, if any. |
| material_code | code_reference → raw_materials | | Scoping material, if any. |
| claim_keyword | string | | Scoping claim keyword, if any. |
| requirement | string | yes | Requirement text. |
| severity | enum | | info / warning / blocking (default warning). |
| mandatory | boolean | | Mandatory flag (default false). |
| required_document_type | string | | Required document type, if any. |
| required_label_element | string | | Required label element, if any. |
| required_warning | string | | Required warning text, if any. |
| source_reference | string | | Citation/reference. |
| source_url | url | | Source URL. |
| effective_date / expiry_date | date | | Effective/expiry dates. |
| verification_status | enum | | **Ignored on import** — every imported rule enters as `not_verified`. |
| verified_by / verified_at | string / datetime | | **Ignored on import.** |
| notes | string | | Free text. |

---

## 18. Dossier Requirements — `dossier_requirements`

Module: dossier · Natural key: `dossier_code, requirement_code` ·
Duplicate policy: `reject_conflict` · Authorization: Regulatory · Target
collection: `regulatory_dossier_requirements` · Commit: **wired**

Updates a non-frozen requirement in place; a requirement on a frozen
dossier revision is refused and reported as a conflict. Requires an
existing `regulatory_dossiers` row matched by `dossier_code` — resolved
through a live lookup, refused with a named error if missing.

| Column | Type | Req'd | Description |
|---|---|---|---|
| dossier_code | code_reference | yes | Dossier code. |
| jurisdiction | string | yes | Jurisdiction. |
| requirement_code | code_reference | yes | Requirement code — natural key together with dossier_code. |
| requirement_type | string | | Requirement type. |
| title | string | yes | Title. |
| description | string | | Description. |
| mandatory | boolean | | Mandatory flag (default false). |
| critical | boolean | | Critical flag (default false). |
| applicability_status | enum | | applicable / not_applicable / excluded (default applicable). |
| accepted_evidence_types | multi_value | | Accepted evidence types, semicolon-separated. |
| minimum_evidence_count | integer | | Minimum evidence items required. |
| expiry_policy | string | | Evidence expiry policy text. |
| source_rule_code | code_reference → regulatory_rules | | Source regulatory rule, if any. |
| notes | string | | Free text. A frozen historical dossier revision is never rewritten by import. |

---

## 19. Dossier Evidence Metadata — `dossier_evidence`

Module: dossier · Natural key: `dossier_code, requirement_code,
evidence_code` · Duplicate policy: `create_or_update` · Authorization:
Regulatory · Target collection: `regulatory_evidence_items` · Commit:
**wired**

Matching `evidence_code` updates metadata; `status` is always
draft/present_unverified regardless of the file. `formulationId`/
`formulaVersionId` on the created evidence item are inherited from the
resolved dossier, never taken from the file.

| Column | Type | Req'd | Description |
|---|---|---|---|
| dossier_code | code_reference | yes | Owning dossier. |
| requirement_code | code_reference | yes | Requirement this evidence supports. |
| evidence_code | code_reference | yes | Evidence code — natural key. |
| evidence_type | string | | Evidence type. |
| document_type | enum (`MATERIAL_DOCUMENT_TYPES`) | | Document type, if document-based. |
| title | string | yes | Title. |
| document_number | string | | Document number. |
| issuer | string | | Issuer. |
| issue_date / expiry_date | date | | Dates. |
| language | string | | Language. |
| file_name | file_name | | Name of a locally-selected file to match — **import never fabricates the attachment itself.** |
| source_entity_code | string | | Code of the FormuLab record this evidence was discovered from, if any. |
| status | enum | | **Import always writes draft/present_unverified**, regardless of this column. |
| notes | string | | Free text. |

---

## 20. Product Claims — `product_claims`

Module: claims_labels · Natural key: `claim_code` · Duplicate policy:
`new_revision` · Authorization: Draft · Target collection:
`product_claims` · Commit: **wired**

A changed `claim_text` for an existing `claim_code` creates a new claim
revision rather than editing the reviewed text in place. Requires an
existing project (`listFormulations`, matched by `project_code`) and a
saved formula version (or the latest saved version if
`formula_version` is blank) — both resolved live, both refused if
missing. An unrecognized `claim_category` falls back to `"other"`
instead of throwing.

| Column | Type | Req'd | Description |
|---|---|---|---|
| claim_code | code_reference | yes | Stable claim code — natural key. |
| project_code | string | | Owning project/formulation code. |
| formula_version | integer | | Formula version this claim targets. |
| packaging_sku_code | code_reference → packaging_bom | | SKU this claim targets. |
| claim_text | string | yes | Claim text. |
| claim_category | enum (`CLAIM_CATEGORIES`) | | Falls back to "other" if unrecognized. |
| jurisdictions | multi_value | | Applicable jurisdictions, semicolon-separated. |
| languages | multi_value | | Languages, semicolon-separated. |
| risk_level | enum | | low / medium / high. |
| status | enum | | **Every imported claim starts as draft**, regardless of this column. |
| evidence_code | code_reference → dossier_evidence | | Supporting evidence, if any. |
| notes | string | | Free text. |

---

## 21. Label Content — `label_content`

Module: claims_labels · Natural key: `label_code, label_revision, panel,
block_type, language` · Duplicate policy: `new_revision` ·
Authorization: Draft · Target collection: `label_content_blocks` ·
Commit: **wired**

Label content blocks are append-only history — a matching
(label_code, revision, panel, block_type, language) row is a new content
revision, never an edit of previously reviewed text; `source` is always
`"imported"` and `status` always `"draft"`. Requires an existing
`product_labels` row matched by `label_code`, resolved live.

| Column | Type | Req'd | Description |
|---|---|---|---|
| label_code | code_reference | yes | Label code — natural key together with label_revision/panel/block_type/language. |
| formula_version | integer | | Formula version this label reflects. |
| packaging_sku_code | code_reference → packaging_bom | | SKU this label is for. |
| jurisdiction | string | | Jurisdiction. |
| language | string | yes | Language. |
| label_revision | string | yes | Revision label. |
| panel | string | yes | Label panel, e.g. front, back. |
| block_type | string | yes | Content block type, e.g. warning, ingredient_list. |
| content_text | string | yes | Block text. |
| mandatory | boolean | | Mandatory flag (default false). |
| source | enum | | Always recorded `"imported"`. |
| status | enum | | Always recorded `"draft"`. |
| notes | string | | Free text. |

---

## 22. Artwork Register — `artwork_register`

Module: claims_labels · Natural key: `artwork_code` · Duplicate policy:
`new_revision` · Authorization: Draft · Target collection:
`label_artworks` · Commit: **wired**

A repeated `artwork_code` is refused outright — use
`supersedes_artwork_code` with a new `artwork_code` to record a
replacement as a new revision, never an overwrite.

| Column | Type | Req'd | Description |
|---|---|---|---|
| artwork_code | code_reference | yes | Stable artwork code — natural key. |
| label_code | code_reference → label_content | yes | Related label. |
| label_revision | string | | Related label revision. |
| file_name | file_name | | Name of a locally-selected file to match — **metadata import never fabricates the attachment.** |
| format | string | | File format, e.g. AI. |
| width / height | decimal | | Dimensions. |
| dimension_unit | string | | Unit for width/height, e.g. mm. |
| color_mode | string | | Color mode, e.g. CMYK. |
| languages | multi_value | | Languages present, semicolon-separated. |
| status | enum | | **Imported artwork always starts as draft/uploaded — never approved automatically.** |
| created_by | string | | Original creator, metadata only. |
| created_at | datetime | | Original creation timestamp, metadata only. |
| supersedes_artwork_code | code_reference → artwork_register | | Prior artwork this replaces, if any. |
| notes | string | | Free text. |

---

## 23. DOE Factors and Responses — `doe_factors_responses`

Module: doe · Natural key: `study_code, factor_or_response_code` ·
Duplicate policy: `create_or_update` · Authorization: DOE · Target
collection: `doe_factors` (factor rows) / `doe_responses` (response
rows) · Commit: **wired**

`record_type` dispatches each row to `doe_factors` or `doe_responses`.
Requires an existing `doe_studies` row matched by `study_code`, resolved
live, refused if missing. `studyRevision` is stamped from the resolved
study.

| Column | Type | Req'd | Description |
|---|---|---|---|
| study_code | code_reference | yes | DOE study code. |
| record_type | enum | yes | `factor` or `response` — dispatches this row. |
| factor_or_response_code | code_reference | yes | Natural key together with study_code. |
| name | string | yes | Display name. |
| factor_type | enum (`DOE_FACTOR_TYPES`) | | Factor rows only. |
| source_type | enum (`DOE_FACTOR_SOURCE_TYPES`) | | Factor rows only. |
| unit | string | | Unit. |
| low_value / center_value / high_value | decimal | | Factor rows: level range. |
| categorical_levels | multi_value | | Factor rows: categorical levels, semicolon-separated. |
| objective | enum (`DOE_RESPONSE_OBJECTIVES`) | | Response rows only. |
| target_value / lower_limit / upper_limit | decimal | | Response rows: target/limits. |
| weight | decimal | | Response rows: desirability weight. |
| notes | string | | Free text. |

---

## 24. DOE Observations — `doe_observations`

Module: doe · Natural key: `study_code, run_number, response_code` ·
Duplicate policy: `create_or_update` · Authorization: DOE · Target
collection: `doe_observations` · Commit: **wired**

Matching `(study_code, run_number, response_code)` updates that
observation; `status` is limited to `recorded`/`missing` from import,
never `excluded`/`outlier_confirmed` — those require a human decision in
the DOE workspace. Requires an existing study (matched by `study_code`),
an existing run within that study (matched by `run_number`), and an
existing response within that study (matched by `response_code`) — all
three resolved live, each refused independently if missing.

| Column | Type | Req'd | Description |
|---|---|---|---|
| study_code | code_reference | yes | DOE study code. |
| design_code | string | | Design code, for cross-checking. |
| run_number | integer | yes | Run number within the design. |
| trial_code | string | | Linked laboratory trial code, if any. |
| response_code | code_reference → doe_factors_responses | yes | Response being observed. |
| numeric_value | decimal | | Numeric observation. **Left blank, recorded as missing, never as zero.** |
| text_value | string | | Text observation. |
| unit | string | | Unit. |
| status | enum | | `recorded` or `missing` only (default recorded). |
| measured_at | datetime | | Measurement timestamp. |
| analyst | string | | Analyst. |
| exclusion_reason | string | | **Recorded as a note only; does not exclude the observation from analysis by itself.** |
| notes | string | | Free text. |

---

## Material-Supplier Links — `material_suppliers` (FVL-04.011)

Module: materials · Natural key: `material_code` + `supplier_code` ·
Duplicate policy: `create_or_update` · Authorization: Master · Target
collection: `material_suppliers` · Commit: **wired**

Canonical `MaterialSupplier` (`packages/shared/src/schemas/materials.ts`)
— no new schema. Re-assessed under FVL-04.011 hardening: FVL-03's own
consumers never needed this (supplier provenance is carried through
`MaterialPrice.supplierCode` instead), but the approved FVL-04.013+
enterprise connector architecture explicitly anticipates a source row
fanning into `RawMaterial + Supplier + MaterialSupplier + MaterialPrice +
InventoryRecord` — a pure material-supplier relationship with no price
yet (an approved vendor before a quote exists) is a legitimate
enterprise-migration shape, and this template is the only way to import
it. `code` is generated deterministically as `material_code::supplier_code`
so a repeated import updates the same link rather than duplicating it.
`qualified` is never set true by import alone — a quality decision,
preserved from the existing record on update.

| Column | Type | Req'd | Description |
|---|---|---|---|
| material_code | code_reference → raw_materials | yes | Material. |
| supplier_code | code_reference → suppliers | yes | Supplier. |
| supplier_trade_name | string | | The supplier's own name for this material — often not our display name. |
| supplier_material_code | string | | Supplier's own code for the material. |
| preferred | boolean | | Preferred link for this material (default false). |
| qualified | boolean | | Quality-qualification status is a quality decision; import never sets this true on its own (default false). |
| notes | string | | Free text. |

---

## Inventory Lots — `inventory_records` (FVL-04.007)

Module: materials · Natural key: `inventory_code` · Duplicate policy:
`create_or_update` · Authorization: Master · Target collection:
`inventory` · Commit: **wired**

Canonical `InventoryRecord` (`packages/shared/src/schemas/materials.ts`)
— no new schema, just a Data Exchange import path for an existing, live
masterdata collection. `inventory_code` updates the existing lot's
mutable fields (quantity, reserved_quantity, quarantined, released,
coa_status, ...) in place — a physical count/status correction, not a
new lot. **Importing a lot never computes usable availability itself**
— quarantine/release/expiry are imported as plain facts; the sole
authority for "how much is actually usable right now" remains the
canonical `evaluateMaterialAvailability()`
(`packages/shared/src/engine/inventoryAvailability.ts`), which every
consumer (`MaterialsPage.tsx`, `AdvancedOptimizerPanel.tsx`,
`SubstitutionPanel.tsx`, and the generated-formula inventory evaluator)
calls afterward.

| Column | Type | Req'd | Description |
|---|---|---|---|
| inventory_code | code_reference | yes | Stable inventory-lot record code — the natural key. |
| material_code | code_reference → raw_materials | yes | Material this lot is stock of. |
| warehouse | string | | Storage location (default "main"). |
| lot | string | | Internal lot/batch number. |
| supplier_lot | string | | Supplier's own lot/batch number. |
| quantity | decimal | yes | On-hand quantity, in unit. |
| unit | string | | Quantity unit (default "kg"). |
| reserved_quantity | decimal | | Quantity already reserved/allocated (default 0). |
| manufactured_at | date | | Manufacture date. |
| expires_at | date | | Expiry date — a lot at or past this date is excluded by `evaluateMaterialAvailability()`, never treated as usable. |
| coa_status | enum | | `received` / `pending` / `not_required` / `missing` (default pending). |
| quarantined | boolean | | Quarantined lots are excluded from usable availability regardless of quantity (default false). |
| released | boolean | | QC-released — an unreleased lot is excluded from usable availability regardless of quantity (default false). |
| unit_cost | decimal | | Reference unit cost, informational only — not the authoritative price (see the Material-Supplier Price List template). |
| currency | enum | | Currency of unit_cost. |
| notes | string | | Free text. |

---

## Exchange Rates — `exchange_rates` (FVL-04.008)

Module: costing · Natural key: `base_currency` + `quote_currency` +
`effective_from` · Duplicate policy: `append_history` · Authorization:
Cost · Target collection: `exchange_rates` · Commit: **wired**

Canonical `ExchangeRate` (`packages/shared/src/schemas/costing.ts`) —
no new schema. Every row is a new rate-validity period; re-importing an
identical (base, quote, effective_from) triple is a duplicate, never a
silent overwrite of a prior rate — the same append-only convention the
Material-Supplier Price List template already uses. **Imports facts
only** — the real Cost Engine's `findRate()` (`engine/cost.ts`) remains
the sole rate-selection/conversion authority; a missing pair is never
defaulted to 1:1, and `verification` is never taken from the file
(always `not_verified` regardless of what the row said, same convention
as every other verification-shaped column in this catalog).

| Column | Type | Req'd | Description |
|---|---|---|---|
| base_currency | enum | yes | Base currency — units of quote_currency per 1 unit of this. |
| quote_currency | enum | yes | Quote currency. |
| rate | decimal | yes | Units of quote_currency per 1 unit of base_currency. |
| effective_from | date | yes | Date this rate takes effect. |
| source | string | yes | Where the rate came from — a bank, a portal, a finance email. Never blank. |
| notes | string | | Free text. |

---

## Finished-Product Specifications — `finished_product_specifications` (FVL-04.005)

Module: product · Natural key: `sku_code` + `test_definition_code` +
`effective_from` · Duplicate policy: `append_history` · Authorization:
Master · Target collection: `finished_product_specifications` · Commit:
**wired**

Canonical `FinishedProductSpecification`
(`packages/shared/src/schemas/dataExchange.ts`) — the release/QC-limit
domain closed under FVL-04.005 hardening, explicitly approved before
FVL-04.013. Owns ONLY which test applies to which SKU and what limit/
target that SKU needs for release — never how the test itself works
(`TestDefinition`'s job, referenced by `test_definition_code`, never
copied) and never the measured outcome (`TestResult`'s job). No `unit`
column: the referenced `TestDefinition` already owns the unit of
measurement — a second unit field here would be a second source of
truth. Every row is a new specification-validity period; re-importing
an identical (sku_code, test_definition_code, effective_from) triple is
a duplicate, never a silent overwrite of a prior specification — a
batch already evaluated against the old limits must keep meaning what
it meant then. `verification_status` is not a column on this template
at all — the commit handler always forces the record's
`verificationStatus` to `imported_unverified` (reusing `TestDefinition`'s
own vocabulary), so there is nothing in the file for a human to even
attempt to smuggle a verified state through.

Real UI consumer: no dedicated Finished Product workspace exists in the
app (confirmed by repository-wide search), so a read-only
"Specifications" tab was added to the existing generic masterdata
browser (`MaterialsPage.tsx`) — a flat list across all SKUs with a SKU
filter, displaying the canonical limits honestly; no pass/fail
evaluation happens there (no existing authoritative evaluator owns that
decision for this domain).

| Column | Type | Req'd | Description |
|---|---|---|---|
| sku_code | code_reference → finished_products.sku_code | yes | Finished product SKU this specification is for. |
| test_definition_code | code_reference → test_definitions.test_code | yes | The test this specification's limits apply to. |
| target_value | decimal | | Target value for this SKU's release, overriding the test definition's own generic target. |
| lower_limit | decimal | | Acceptable lower limit for this SKU's release. |
| upper_limit | decimal | | Acceptable upper limit for this SKU's release. |
| required_for_release | boolean | | Must pass for this specific product to release (default `true`). |
| market | string | | Blank applies to every one of the SKU's own target markets; a specific market overrides only that market's release requirement. |
| effective_from | date | yes | Validity start. |
| effective_until | date | | Validity end, open-ended if blank. |
| notes | string | | Free text. |
