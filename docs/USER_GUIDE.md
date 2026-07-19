# User guide — Formula Builder, versioning, materials and costing

This is the walkthrough for the R&D workflow: create a project, build a
formula, save versions, price it against real materials, and compare. Each
section links to the document that covers the topic in depth; this page is
the map, not a replacement for those.

## 1. Create a formula project

**Formulas → New project** in the sidebar.

1. Pick a **product family** from the Kenya catalog (55 families across 17
   domains). This determines which packaging SKUs are offered and which
   structural template pre-populates the grid.
2. Pick one or more **packaging SKUs** the formula is meant to fill.
3. Enter **project name**, optional **project code** (generated if left
   blank), **product brief**, **target market** (Kenya or EAC), **target
   claims**, and **target batch size**.
4. Save. The project persists to `data/formulations/<id>/` — closing the app
   and reopening it later reopens the same project, not a blank grid.

See [FORMULA_BUILDER.md](FORMULA_BUILDER.md) for the full field list and the
templates for all 35 distinct product types.

## 2. Build the formula

The grid is the daily surface — not the chat thread. Add lines, set phase,
material, percentage and active-matter %; drag to reorder; move a line
between phases by editing its phase cell.

- **Water q.s.**: mark one line `q.s.` and it fills automatically to 100% of
  whatever the other lines leave, and never goes negative. Convert it to a
  fixed percentage, or a fixed water line back to q.s., at any time.
- **Validation** runs continuously: formula total vs. 100%, technical maxima,
  missing material references, invalid batch size, and more, at `info` /
  `warning` / `error` / `blocking` severity. Blocking findings are shown at
  the line and in a formula-level summary.
- **Functional-group totals** (total anionic surfactant %, total
  preservative %, ...) report `incomplete` rather than silently treating a
  missing active-matter figure as zero.
- **Undo/redo**, **autosave** (writes the working draft only), and a visible
  unsaved-changes indicator are all live controls, not decoration.

Full control reference, keyboard shortcuts, and paste-from-Excel behaviour:
[FORMULA_BUILDER.md](FORMULA_BUILDER.md). Precision rules for every number
shown: [PRECISION_POLICY.md](PRECISION_POLICY.md).

## 3. Save a version

**Save version** promotes the current working draft to an immutable, numbered
version and requires a change reason. A saved version is never edited in
place — editing it again means editing a new draft derived from it, which
saves as a new version with the old one recorded as its parent.

Every version freezes a snapshot of totals, validation results, and intent
(market, claims, SKUs) as they stood at save time, so a later edit to the
project brief cannot rewrite what a version says it was.

Full model: [FORMULA_VERSIONING.md](FORMULA_VERSIONING.md).

## 4. Compare versions

Open the **Compare** view and pick two versions. It reports, per line: added,
removed, changed or unchanged, with field-level detail (percentage, batch
quantity, supplier, price, currency, function, phase, INCI, evidence origin),
plus totals, active matter, and status changes — as a diff, not prose. Any
inferred performance impact is explicitly labelled `estimated` /
`requires laboratory confirmation`; nothing here claims a measured result.

## 5. Approval

No automated actor — agent, system process, or import — can set
`pilot_approved` or `production_approved`, regardless of what a model
concluded or a spreadsheet claimed. Approval is a named human action with a
signed record and an audit entry. Clones and restores of an approved version
always start unapproved. Details and the bypass tests:
[FORMULA_VERSIONING.md](FORMULA_VERSIONING.md#approval).

## 6. Raw materials and suppliers

**Materials** in the sidebar. Create a material with whatever is known today
— internal code and function are enough to start; every other field is
explicitly `missing`, `unknown`, `not_applicable` or `not_verified` rather
than blank-meaning-zero. Attach one or more **suppliers** to a material (one
trade name is not assumed to map to one supplier).

Search and filter by function, ionic character, supplier, country, stock
status, and data-completeness flags (has SDS, has price, has density, ...).

Full field list and data-state model: [RAW_MATERIALS.md](RAW_MATERIALS.md).

## 7. Prices, landed cost, and inventory

Prices are **append-only history**, not a single current field — a price
change today never rewrites what a formula cost in March. Each price record
can carry freight, insurance, duty, tax and other landed-cost components; the
engine supports per-kg, per-shipment, percentage-of-goods and fixed-amount
allocation.

Inventory records (lot, quantity, reserved/available, expiry, COA and
quarantine status) support stock-awareness in costing without pretending to
be a full ERP module.

Import materials, suppliers, prices and inventory from CSV: preview rows,
see row-level errors and warnings separately, and choose whether to commit a
partial import. Import is idempotent on the stable internal code, so
re-importing the same file does not create duplicates. See
[IMPORT_EXPORT.md](IMPORT_EXPORT.md).

## 8. Cost a formula

Open the **Costing** tab on a formula. It calculates, as distinct layers —
never merged into one number — raw-material cost, landed cost, packaging
cost, labour, utilities, QC, waste and factory overhead, then rolls up to
cost per kg, per litre (when density is known), per batch and per packaging
SKU (per sachet, bottle, drum, ...).

Currency conversion uses exchange rates you enter and date — FormuLab never
calls an external rate API. Factory cost profiles (electricity, water,
labour rate, overhead basis) are editable per factory and marked `verified`
/ `not_verified` / `example_only` so a demonstration number can never be
mistaken for real production data.

Full model: [COST_ENGINE.md](COST_ENGINE.md).

## 9. Save a cost snapshot

**Save cost snapshot** freezes the exact price records, exchange rates,
packaging costs and factory profile used, dated. Updating a material's
current price afterwards does not change that snapshot — a new snapshot must
be created explicitly to see the effect of the new price.

Comparing two versions' cost snapshots attributes the difference to formula
change, price change, exchange-rate change, packaging change or factory-cost
change, and reports missing-data impact as its own category rather than
folding it into one of the others.

## Known limitations

See [IMPLEMENTATION_STATUS.md](architecture/IMPLEMENTATION_STATUS.md) for the
authoritative list of what is built versus not yet started. In short: the
regulatory, compatibility, safety-classification, DOE, lab-trial and
reverse-formulation modules described in the full specification are designed
but not implemented. Nothing in this guide describes them as available.
