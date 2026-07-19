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

Import materials, suppliers, material-supplier links, prices, inventory,
packaging components, packaging BOMs and factory cost profiles from CSV or
Excel (`.xlsx`): preview rows, see row-level errors and warnings separately,
and choose whether to commit a partial import. Import is idempotent on the
stable internal code, so re-importing the same file does not create
duplicates. Spreadsheet formula injection is stripped on import and on
export; macro-bearing or otherwise unsupported binary content is rejected
rather than executed. Downloadable `.xlsx` templates exist for every
importable collection. See [IMPORT_EXPORT.md](IMPORT_EXPORT.md).

**Materials** also has editor screens for supplier detail (contact,
Incoterm, payment terms, lead time, MOQ notes, approved-supplier and quality
status, linked materials and price history), packaging components and
packaging BOMs (component list, add/remove/reorder, quantity per SKU, waste
factor, carton and shrink-wrap allocation, total packaging cost), and
factory cost profiles (create, edit, clone, activate/deactivate, effective
date, utility and labour rates, QC allocation, waste rate, overhead basis).
Demonstration figures on a factory profile stay marked `example_only` /
`not_verified` until someone replaces them with real factory data.

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

## 10. Compatibility

Open the **Compatibility** tab on a formula. A deterministic rule engine —
not the LLM — checks the formula's materials, functions, ionic character,
concentrations, target pH, process temperature, addition order and
packaging against a hand-maintained, versioned rule set (anionic/cationic,
QAC/anionic, chlorhexidine, hypochlorite interactions, oxidizer/reducer,
carbomer, packaging incompatibilities, and more). Findings are `info` /
`warning` / `error` / `blocking`; missing data produces an explicit
"unknown — data missing" finding, never a false pass. Findings are
snapshotted onto a saved version and re-run whenever the draft changes.
**Manage rules** lets you create, edit, deprecate and import/export rules as
JSON or Excel. Full model: [COMPATIBILITY_ENGINE.md](COMPATIBILITY_ENGINE.md).

## 11. Safety

Open the **Safety** tab. The product is classified deterministically
(ordinary consumer / industrial / hazardous lawful / regulated disinfectant
/ medical / restricted / prohibited / human-review-required), and a
versioned rule set checks for known hazard interactions, corrosivity, pH
extremes, sensitizer and acute-toxicity thresholds, and more. A `blocking`
finding cannot be dismissed — resolving one requires a named reviewer, a
reason, a date and an audit record; the LLM can never resolve or approve one
on its own. The same deterministic classification also gates AI
formulation requests before literature discovery runs: a prohibited target
is refused outright, a hazardous/regulated/medical one requires a named
human's acknowledgement before generation proceeds. Full model:
[SAFETY_ENGINE.md](SAFETY_ENGINE.md).

## 12. Approval readiness

A formula cannot reach `pilot_approved` or `production_approved` while any
blocking validation error, blocking compatibility finding, blocking safety
finding, or unresolved mandatory human review is open — the UI names every
blocker. See [APPROVAL_READINESS.md](APPROVAL_READINESS.md).

## 13. Lifecycle, variants and exports

Saved versions are immutable but not static: **retire** or **reject** a
version with a reason, **reopen** a rejected one into a new draft, and
**create a named variant** from any saved version to branch exploration
without disturbing the parent line. None of this — retire, reopen, clone,
or variant creation — ever inherits or grants production approval.

**Export** a selected version as a JSON formulation package, CSV or Excel
formula sheet, cost-snapshot JSON, packaging-BOM JSON, or draft ERP BOM/
recipe CSV. Every export carries formula ID, version ID, version label,
schema version, export timestamp, approval status, cost-snapshot ID, and
target family/SKUs; a non-approved formula is stamped `R&D DRAFT — NOT
PRODUCTION APPROVED` on every export format.

## 14. Advanced optimization

Open the **Optimizer** tab. Unlike the plain cost-minimizing Formulation
Optimizer, this is a real constraint-solving workspace: pick candidate
materials, add functional-group constraints (e.g. "at least 15% anionic
surfactant") — soft or hard, with a penalty weight and allowed deviation for
a soft one — property targets (calculated for real where the platform
honestly can: active matter, total solids, several named actives; a
`laboratory_required` property is never given a fabricated value), an
optional cost ceiling, and one or more objectives (cost, supply risk, carbon
score, stock utilization, evidence confidence, and graded compatibility/
safety risk — weighted together, or lexicographic priority). Every candidate
pair is automatically checked against the real Compatibility and Safety
engines before the solve, so the optimizer can never select a combination
those engines flag as blocking. **Run** — a solve that had to relax a soft
constraint reports `feasible_with_penalties`, distinct from a clean
`optimal`, with each soft constraint's requested target, achieved value and
deviation shown. An infeasible run explains why in plain language with
suggested next steps, not just "infeasible". **Apply to draft** never
overwrites the saved version it started from — it creates a new working
draft, and the run is remembered so approval readiness can later verify it
was genuinely usable. Full model:
[ADVANCED_OPTIMIZER.md](ADVANCED_OPTIMIZER.md).

**Scenarios** — the same tab's Scenarios section lets you name and save a
"what if" (its full candidate/constraint/objective selection and a frozen
price/inventory snapshot), reload it later, clone it, rename it, retire it,
or restore a retired one as a new scenario. Load one of the 31 seeded
Kenya product-family structural profiles (apply only what's missing, merge
it in, or replace your current selection — the last asks for confirmation
first) as a starting point; every profile is explicitly `not_verified` and
needs chemist review, never an approved recipe. Select two or more runs
(from one scenario's history or several scenarios) and **Compare** to see
cost, risk, soft violations, stock utilization and solve time side by side,
with the lowest/highest of each highlighted — never a single fabricated
"best overall" score. Full model:
[OPTIMIZATION_SCENARIOS.md](OPTIMIZATION_SCENARIOS.md).

## 15. Material substitution

Click the replace-material icon on any formula line to open scored,
ranked candidates for that material — scored on real data (function match,
active-matter equivalence, ionic character, pH/HLB similarity, regulatory
status, available stock, landed cost, and a live compatibility/safety
re-check), never by name similarity. A candidate that would introduce a
blocking finding is still shown, sorted last, so you can see why it ranked
where it did. Applying a candidate uses the active-equivalent percentage
(10% of a 70%-active material needs 20% of a 35%-active replacement to
contribute the same active matter) and, like an optimizer result, only ever
creates a new working draft.

**System substitution** — check additional formula lines in the same
dialog to replace several lines with a whole new material system at once
(a surfactant blend, a preservation system, a thickener + neutralizer, ...).
Pick which functions to preserve, generate candidate systems (by real
function coverage, never name similarity, within configurable candidate
limits), then **Evaluate through optimizer** to route every proposal
through the actual Advanced Optimizer and score the results. A rejected
combination shows why; an infeasible one shows its structured cause.
Applying a system replaces every selected line with the new materials in a
new working draft. Full model:
[MATERIAL_SUBSTITUTION.md](MATERIAL_SUBSTITUTION.md),
[SYSTEM_SUBSTITUTION.md](SYSTEM_SUBSTITUTION.md).

## Known limitations

See [IMPLEMENTATION_STATUS.md](architecture/IMPLEMENTATION_STATUS.md) for the
authoritative list of what is built versus not yet started. In short: the
regulatory engine, DOE, lab-trial, stability-study and reverse-formulation
modules described in the full specification are designed but not
implemented. The Advanced Optimizer's screen has no builder for composition,
ratio or conditional constraints (only functional-group constraints,
property targets, a cost ceiling, and the automatic compatibility/safety
exclusion are user-facing) and no lexicographic-priority selector; the
Substitution dialog's system mode does not yet wire graded compatibility/
safety risk into a system's score (real hard exclusions still apply) — see
[ADVANCED_OPTIMIZER.md](ADVANCED_OPTIMIZER.md#what-this-is-not) and
[SYSTEM_SUBSTITUTION.md](SYSTEM_SUBSTITUTION.md#known-limitations).
Compatibility and safety are deterministic rule engines against a
hand-maintained, explicitly non-exhaustive seed rule set — they are not a
regulatory engine and do not establish legal compliance. Approval readiness
is fully implemented and tested but not yet called from any approval screen
in the desktop UI. Nothing in this guide describes an unimplemented module
as available.
