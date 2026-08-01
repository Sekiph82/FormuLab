# FormuLab User Guide

*FormuLab — literature-driven chemical formulation discovery, laboratory
and stability tracking, regulatory dossiers, and cost optimization, for
Kenya/EAC R&D teams. Local-first: your projects live on your own machine,
never on a server you don't control.*

This is the walkthrough for the full R&D workflow: generate a starting
idea, build a formula, save versions, test it in the lab and on the
shelf, clear it for the markets you sell into, price it against real
materials, and compare. Each section links to the document that covers
the topic in depth; this page is the map, not a replacement for those.

> **Copyright and standards notice.** This guide is FormuLab's own
> documentation. It does not reproduce, summarize in full, or replace any
> copyrighted standard (ISO, ASTM, EN, DIN, AOAC, USP, EP, BS, or any
> other issuing body's publication) — see
> [§17a](#17a-test-standards-and-methods) for exactly how FormuLab
> handles standards. Consult the current official publication before any
> regulated test, review, or submission.

## 0. Navigating FormuLab

![Home](screenshots/home-home-default-light-en.png "Recent projects, activity, open lab work, upcoming stability samples, pending approvals")

The sidebar's **Workspaces** section is the primary navigation: **Home**
(a real dashboard — recent projects, activity, open lab work, upcoming
stability samples, pending approvals), **Projects** (every formulation
project), **Formulation** (the grid, versions, cost, compatibility, safety,
packaging — sections 2–13 below), **Laboratory** (trials, test
definitions, corrective actions — sections 16–19), **Stability** (section
18), **Optimization** (section 14), **Regulatory** (section 20),
**Approval** (sections 5, 12), **Reports** (a navigation shell over each
module's existing export), **Data Exchange** (section 23 — bulk CSV/Excel
import/export across every module), and **Administration** (materials/
suppliers/packaging/factory profiles, plus links to regulatory rules,
approval policies, the Data Exchange Center and app settings).

Opening a project from **Projects** or **Home** carries it with you as a
`?project=` link — Laboratory, Stability, Optimization, Regulatory and
Approval all open already scoped to that project; a blocker inside
Approval that names a specific module opens that module directly, on the
right formula version. See [WORKSPACES.md](WORKSPACES.md) and
[NAVIGATION_AND_CONTEXT.md](NAVIGATION_AND_CONTEXT.md) for the full model.
This replaced a single crowded Formula Builder page that carried every one
of these as a horizontal tab; nothing described in this guide was removed
or rewritten — every section below still describes real, working
functionality, just reached from its own workspace rather than a tab.

## 0a. Getting help in the app

Every workspace above has a small **Help** button (bottom-right corner)
that opens a side panel explaining the current page — summary, purpose,
prerequisites, a quick-start list, its sections, warnings, role notes, and
known limitations, with clickable **related topics** and **glossary
terms** that switch the panel in place (never leaving your page or
losing your work). A page reached through a nested URL (e.g. a Settings
section, or a live session) shows its parent page's help when it has no
dedicated topic of its own.

![The page Help panel](screenshots/help-panel-default-light-en.png "Summary, purpose, quick start, sections, related topics")

Press **Ctrl/Cmd+/** (or run **Search help** from the command palette,
**Ctrl/Cmd+K**) to open the global **Help Center** — a full-text search
across every topic's title, summary, keywords, and quick-start text, plus
every glossary term, regardless of which page you're on. Selecting a
result opens the same Help panel; searching help never navigates you
away from what you're doing. A handful of pages (an old redirect, the
retained legacy Formula Builder, the 404 page) intentionally have no
help topic — the Help button simply doesn't appear there.

![The Help Center](screenshots/help-center-default-light-en.png "Full-text search across every topic and glossary term")

Laboratory's help topic covers the Session 1A test-standards/methods
feature — selecting a standard, primary vs. alternative methods, internal
methods, and the official-standard copyright notice — reachable from
Laboratory's own Help button or by searching "standard" or "method" in
the Help Center.

A small **i** icon next to some fields (Formulation's total/q.s. badge
and cost snapshot, Laboratory's method status badges, Design of
Experiments' factors/responses, Stability's conditions/time points)
opens a short explanation on hover or keyboard focus, with a "Learn more"
link into that page's own Help panel where relevant.

![An InfoTooltip open](screenshots/help-tooltip-default-light-en.png "Hover or keyboard-focus a field's \"i\" icon for a short explanation")

When a button is greyed out (Laboratory's Make primary, Approval's
Approve, a Dossier's Export PDF/DOCX, Data Exchange's Commit import,
Formulation's Save cost snapshot), the reason is written directly beneath
it — what's blocking it, which role can act if it's a permission issue,
and whether you can resolve it yourself. A disabled button never reacts
to a click; the explanation is not a hint to try anyway.

![A disabled-action explanation](screenshots/help-disabled-action-default-light-en.png "What's blocking the action, and whether you can resolve it yourself")

Three short **guided tours** — Formulation (the session composer where a
formulation is generated), Design of Experiments, and Dossiers — walk
through each workspace's real controls with a spotlight and a small
step card. Every tour is optional and skippable at any point, supports
**Next/Back/Skip/Finish**, closes on **Escape**, and returns keyboard
focus to wherever you were when you started it. Start one from that
page's Help panel ("Start tour"), or from the one-time **onboarding
prompt** shown the first time you open the app (dismiss it with the ✕ or
"Maybe later" — it never reappears once dismissed or once you've picked a
tour). A tour never edits any project data; it only highlights.

![The first-use onboarding prompt](screenshots/help-onboarding-default-light-en.png "Shown once per profile; pick a tour or dismiss it")

![A guided tour step](screenshots/help-guided-tour-formulation-step-light-en.png "A spotlight and step card walk through the workspace's real controls")

This guide itself is one Markdown source, rendered three ways: **in-app**
(Help Center → **Open the full guide**, or the command palette), as a
**PDF** (`docs/generated/FormuLab-User-Guide.pdf`), and as a **DOCX**
(`docs/generated/FormuLab-User-Guide.docx`) — see
[§29](#29-in-app-guide-and-pdfdocx-generation). English-only for v1, the
same locale policy every screenshot in this guide follows.

## 0b. Generate a starting formulation (the composer)

![Formulation generation](screenshots/formulation-live-generation-light-en.png "The composer: target product, category, market, and Generate")

**Sessions** (the sidebar's pinned bottom section, or `Ctrl/Cmd+B`'s
default landing page) opens the composer at `/live` — FormuLab's front
door for a brand-new idea, distinct from the **Formulation** project
workspace described from [§1](#1-create-a-formula-project) onward.

1. Describe the **target product** in plain language (e.g. "a
   sulfate-free gentle shampoo"), optionally narrow the **category** and
   **market**, then click **Generate**. This runs the real
   discovery pipeline — retrieve open-access literature, extract cited
   compositions, synthesize a brief, optimize, and report — never a
   single unchecked model guess. A target FormuLab's safety classifier
   flags as hazardous/regulated/medical asks for a named human's
   acknowledgement before it proceeds; a prohibited target is refused
   outright. See [§11](#11-safety).
2. The result streams back as one or more numbered **candidates**
   (V1, V2, V3, …), each a citable, printable formulation card.

   ![Candidate versions](screenshots/formulation-live-candidate-tabs-light-en.png "V1/V2/V3 candidate tabs")

3. **Card** shows the generated write-up and a cost estimate; **Edit
   formula** opens that exact candidate in the same grid
   [§2](#2-build-the-formula) uses, so you can adjust it immediately —
   each candidate keeps its own independent, unsaved edits; editing V2
   never touches V1 or V3.

   ![Edit formula, function totals and warnings](screenshots/formulation-live-function-totals-warning-light-en.png "Function totals and an active-matter warning")

4. The same **function totals** and validation findings from
   [§2](#2-build-the-formula) apply here — a badge like "anionic
   surfactant: 18%" is always the real formula percentage, never zeroed
   just because a material's active-matter content is unrecorded; an
   incomplete active-matter figure is reported as its own honest
   `(active data incomplete)` note, not folded into the percentage.

> **A generated candidate is not automatically a project.** The composer
> and the Formulation project workspace do not currently bridge
> automatically — there is no "save this candidate as a project version"
> button. If a candidate looks promising, start a real project
> ([§1](#1-create-a-formula-project)) and rebuild it there, using the
> candidate as your reference; only a project version gets save-history,
> approval, laboratory/stability/regulatory tracking, and dossiers.

Every past run appears in the sidebar's **Sessions** list (newest first,
up to 8 shown, **View all** for the rest) — click one to reopen it
**read-only** (no new model call); delete one with the trash icon next
to it. A session never appears there unless it actually produced at
least one card — a refused or failed run is never listed as if it
succeeded.

## 1. Create a formula project

![Projects](screenshots/projects-projects-default-light-en.png "Every formulation project")

**Projects → New project** in the sidebar (or **Home → Recent projects**
once you have one).

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

Open the **Approval workspace** (`/approval`) for the selected project.
No automated actor — agent, system process, or import — can set
`pilot_approved` or `production_approved`, regardless of what a model
concluded or a spreadsheet claimed. Approval is a named human action with a
signed record and an audit entry. Clones and restores of an approved version
always start unapproved. Details and the bypass tests:
[FORMULA_VERSIONING.md](FORMULA_VERSIONING.md#approval).

## 6. Raw materials and suppliers

**Administration → Materials, suppliers, packaging & factory profiles**
in the sidebar. Create a material with whatever is known today
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

Open the **Cost** tab in the **Formulation workspace**. It calculates, as distinct layers —
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

Open the **Compatibility** tab in the **Formulation workspace**. A deterministic rule engine —
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

Open the **Safety** tab in the **Formulation workspace**. The product is classified deterministically
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

Open the **Optimization workspace** (`/optimization`) for the selected
project — distinct from the standalone what-if calculator linked from it,
which is not project-bound. Unlike the plain cost-minimizing Formulation
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

## 16. Laboratory trials

Open the **Laboratory workspace** (`/laboratory`)'s **Trials** section.
Create a trial from the current working draft (or
a saved version, if one is selected) — it freezes its own formula snapshot,
so later formula edits never change what the trial recorded. Move it
through its lifecycle (**planned → materials prepared → in progress →
awaiting results → completed/failed → archived**) with the status buttons;
an invalid move is refused, and only a human can mark a trial `completed`.

- **Material weighing**: enter each material's actual weight; the computed
  deviation and batch-level variance appear immediately. A material with no
  actual weight yet shows "not entered," never a zero.
- **Process execution**: add process steps, record actual temperature/pH/
  duration against the planned range.
- **Observations & deviations**: log an observation, file a deviation
  (minor/major/critical), resolve it or accept it with a written
  justification, and open a [corrective action](#19-corrective-actions)
  directly from an unresolved one. A critical open deviation blocks the
  trial from being marked complete.
- **Test results**: enter replicate values for any active numeric
  [test definition](#17-test-definitions); mean, standard deviation and
  pass/fail compute automatically from the test's own logic. Click **View
  history** on any result to open the dedicated
  [result history browser](RESULT_HISTORY_BROWSER.md) — every revision,
  retest, override and attachment replacement, plus a side-by-side
  comparison of any two revisions. Click **Test applicability** to see
  which test definitions are included/excluded for this trial's product
  family and packaging, and exactly why.

Select two or more trials (checkbox in the list) and **Compare selected**
to see material-usage, deviation and pass/fail counts side by side — a
deterministic comparison, never an inferred "why."

**Export** (per trial): JSON package, batch sheet (CSV), weighing sheet
(CSV), process sheet (Excel), test-results report (Excel), corrective-
actions report (CSV), and a draft ERP lab-result CSV — every export
watermarked `R&D DRAFT — NOT PRODUCTION APPROVED` unless the source formula
is genuinely `production_approved`. Full model:
[LABORATORY_TRIALS.md](LABORATORY_TRIALS.md),
[TRIAL_EXECUTION.md](TRIAL_EXECUTION.md),
[TRIAL_COMPARISON.md](TRIAL_COMPARISON.md).

## 17. Test definitions

Open the **Laboratory workspace**'s **Test Definitions** section (also
reachable from **Administration**, since this catalog is global rather
than per-project) to manage the reusable test-definition catalog
shared by trials and stability studies — 27 structural templates ship
seeded (pH, viscosity, density, foam, microbiology, preservative
challenge, and more), all explicitly `not_verified` until a chemist attaches
their own method reference and marks one `verified`. Edit result type,
unit, min/max, pass/fail rule, critical flag and active status inline. Full
model: [TEST_DEFINITIONS.md](TEST_DEFINITIONS.md).

## 17a. Test standards and methods

Each test definition can now carry its own configurable standard(s) and
method, independent of every other test — changing pH's standard never
touches viscosity's. Open a definition's **Method** button (next to it in
Test Definitions) to manage this.

![Laboratory test method drawer](screenshots/laboratory-laboratory-test-methods-light-en.png "The Method drawer: primary vs. alternative, standard status, historical snapshots")

- **Selecting a method**: a test may have one **primary** method and any
  number of **alternative** methods, each linking a `LaboratoryStandard`
  (code, title, issuing organization, edition/revision, status) to
  procedural detail (equipment, reagents, sample prep, instrument
  settings, steps, calculations, acceptance criteria, safety, waste
  disposal, and more — see the Method drawer's own sections).
- **Primary vs. alternative**: only chemist/quality/administrator roles may
  promote an alternative to primary or create a new method; any role may
  view. Promoting a method demotes the previous primary to alternative —
  a test is never left with two primaries.
- **Internal methods**: an authorized user may create a FormuLab-internal
  method (no external standard body) directly from the drawer; it is
  marked `internal` and behaves like any other standard for assignment
  purposes.
- **Status and revision**: a standard is `draft`, `active`, `superseded`,
  or `internal`. Selecting a `superseded` standard as primary requires
  explicitly checking an acknowledgement box first — it is never silently
  selectable.
- **Detailed instructions**: the Method drawer's sections (overview,
  scope, equipment, reagents, sample prep, instrument setup, conditioning,
  procedure, calculations, acceptance criteria, result interpretation,
  troubleshooting, repeat-test conditions, safety, waste disposal, related
  tests, alternative standards, revision/source) render whatever has
  actually been entered; an unfilled section says so honestly rather than
  inventing content.
- **Historical snapshots**: recording a test result can capture an
  immutable copy of the method actually used (standard code/edition/
  revision, method id/version, instrument settings, unit, acceptance
  criteria). A later edit to the standard or method never changes an
  already-recorded result's snapshot.
- **Legacy references**: a test definition's older free-text
  `methodReference` field (e.g. "ISO 4316") is never auto-converted into a
  structured standard — it stays visible as an unresolved legacy reference
  until a chemist creates the real structured standard/method themselves.
- **Copyright notice**: FormuLab never reproduces or invents the full text
  of a copyrighted standard (ISO/ASTM/EN/DIN/AOAC/USP/EP/BS/...). The
  drawer always shows a notice that its summaries and internal procedures
  do not replace the official licensed standard — consult the current
  official publication before regulated testing.

Full model: `packages/shared/src/schemas/laboratoryStandards.ts`,
`packages/shared/src/engine/laboratoryStandards.ts`.

## 18. Stability studies

Open the **Stability workspace** (`/stability`). Create a study against the current working
draft or a saved version (frozen formula + packaging snapshot), pick which
seeded storage conditions, time points and test definitions apply — these
are configurable starting examples, never a claim of what any regulator
requires — and move it to `active` (this sets its start date). Click
**Test applicability** before creating the study to see the same
Included/Excluded explorer Trials uses, scoped to this study's product
family, packaging, conditions and time points; selecting a test the
explorer marks excluded prompts for a reviewer and reason, both recorded
permanently in the study's requirement snapshot. **Generate samples**
creates one pull-point sample per condition × time point × replicate,
each with a deterministically computed due date.

Record a result for a due sample — click **View history** on it for the
same [result history browser](RESULT_HISTORY_BROWSER.md) Trials uses. An
out-of-range numeric result
automatically opens a [stability failure](STABILITY_TRENDS.md#failures) —
critical when the test is flagged critical. **Trends** shows one small
chart per condition × test metric (change from initial, rate per day, min/
max/mean); a projection toward a limit only ever appears once enough real
data exists, and is always labelled "experimental estimate — not validated
— human review required," never a shelf-life claim. Resolve a failure, open
a corrective action from it, or create a draft formula from that action —
same as the Trials workspace.

**Export**: protocol (JSON), sample plan (CSV), time-point report (Excel),
summary report (Excel), test-results report (Excel), corrective-actions
report (CSV), and a draft ERP lab-result CSV. Full model:
[STABILITY_STUDIES.md](STABILITY_STUDIES.md),
[STABILITY_TRENDS.md](STABILITY_TRENDS.md).

## 19. Corrective actions

Open the **Laboratory workspace**'s **Corrective Actions** section for
the cross-cutting list of every
action opened against a trial deviation or stability failure for this
project (a trial/study's own workspace also shows its actions inline). Move
one through **start progress → mark complete → verify effective/
ineffective**; `effective`/`ineffective` only exist after that verification
step, never set directly. **Create draft** branches a new working draft
from the action's source formula version — never inheriting approval, and
never mutating the version it branched from. **Export** the whole list as
CSV. Full model: [CORRECTIVE_ACTIONS.md](CORRECTIVE_ACTIONS.md).

## 20. Regulatory (Kenya/EAC)

Open the **Regulatory workspace** (`/regulatory`). First pick a **saved formula version** —
findings, confirmations, and reviews are all recorded against this exact
version, never the working draft — then a **jurisdiction** (Kenya,
Uganda, Tanzania, Rwanda, Burundi, South Sudan, or the EAC regional
bloc), a **packaging SKU** (where relevant), and the **reviewer role**
you're acting as. The classification card shows this project's
deterministic regulatory category with its reasoning, never a model's
guess. Click **Evaluate** to run every applicable rule (the
jurisdiction's own plus any active EAC rule) against the current formula
and see the resulting findings — compliant, non-compliant, missing
data, or human review required, each with its reason and, where
relevant, controls to confirm a requirement is satisfied or evidence has
been provided. These confirmations are now **persisted** (not a
session-local checkbox) — they survive a reload and can be revoked with
a reason.

The **Rules** section lists every rule for the selected jurisdiction —
17 seed placeholders ship across all seven jurisdictions, every one
explicitly `not_verified` pending a qualified regulatory reviewer's
confirmation. Create, edit, activate/deactivate, deprecate, verify,
reject a verification, or supersede a rule (edits, deprecations, and
verification decisions require a reason, recorded in the rule's own
revision history); import/export the rule set as **JSON, CSV, or
Excel** — every import previews the parsed rows before you commit.

The **Reviews** section records a human's regulatory sign-off (reviewer
name, outcome, notes) bound to the exact version/jurisdiction/SKU
selected above, and lets you revoke a review with a reason. A separate
"declare equivalence" control lets an authorized human explicitly permit
reusing one version's review for another version, scoped to jurisdiction
and packaging SKU — never assumed automatically.

Turning on any of the Approval workspace's regulatory-gate toggles
(classification completed, no blocking finding, mandatory documents/
evidence/claims reviewed, human review completed) folds these facts
into that formula's readiness check, the same way the cost-snapshot
gate already works — and, when a policy is configured to require more
than the primary market, across every required jurisdiction at once, not
just the first one. Full model:
[REGULATORY_ENGINE.md](REGULATORY_ENGINE.md),
[REGULATORY_CLASSIFICATION.md](REGULATORY_CLASSIFICATION.md),
[REGULATORY_RULES.md](REGULATORY_RULES.md),
[EAC_MARKET_PROFILES.md](EAC_MARKET_PROFILES.md),
[REGULATORY_REVIEWS.md](REGULATORY_REVIEWS.md),
[REGULATORY_EVIDENCE_CONFIRMATIONS.md](REGULATORY_EVIDENCE_CONFIRMATIONS.md),
[REGULATORY_MULTI_MARKET_APPROVAL.md](REGULATORY_MULTI_MARKET_APPROVAL.md),
[REGULATORY_RULE_VERIFICATION.md](REGULATORY_RULE_VERIFICATION.md).

## 21. Dossiers and Claims & Labels

Open the **Dossiers workspace** (`/dossiers`) to build a per-version, per-
jurisdiction regulatory dossier: create one against a real saved formula
version, then work through Requirements, the Evidence Library (with
suggested evidence pulled from your own raw-material documents, lab
trials, stability results and regulatory reviews), the live Evidence
Matrix (filterable, exportable), Reviews and Submissions. Evidence can be
replaced (never edited in place) with a full revision chain kept visible.

![Dossier readiness and export](screenshots/dossiers-dossiers-default-light-en.png "Readiness summary and PDF/DOCX export")

Once enough evidence is accepted, the readiness summary shows exactly how
many mandatory requirements are satisfied and what's still missing —
never a single pass/fail flag standing in for the real detail. **Export
PDF** / **Export DOCX** (Evidence Library section) render a real,
watermarked document from the current evidence matrix — see
[§21a](#21a-dossier-pdfdocx-export). Exporting never approves anything by
itself: approval only happens in the Approval workspace
([§5](#5-approval)/[§12](#12-approval-readiness)).

### 21a. Dossier PDF/DOCX export

A Dossier's **Export PDF**/**Export DOCX** buttons (authorized
regulatory/quality/administrator roles only — shown disabled with the
exact reason for anyone else, never hidden) generate a real, deterministic
document straight from `pdf-lib`/`docx` — the same two libraries this
guide's own PDF/DOCX exports use ([§0a](#0a-getting-help-in-the-app)) —
never an HTML/DOM screenshot. Every export is persisted as a dated
export-history record and an audit event, whether it succeeded or
failed, and is watermarked `R&D DRAFT — NOT PRODUCTION APPROVED` unless
the source formula version is genuinely `production_approved`.

Open the **Claims & Labels workspace** (`/claims-labels`) to manage
product claims and product labels for the same formula version. A
**claim** starts as a draft with an auto-classified category (30
categories, from performance to medical to eco); link it to evidence
already in a dossier (never a duplicated file) and record a formal review
once evidence is accepted — only that review, from an authorized
regulatory/quality/administrator role, changes its true status. A
**label** is one jurisdiction/language combination for one formula version
— fill in its structured content sections (Front/Back/Side panel,
Ingredients, Directions, Warnings, Claims, Manufacturer, Codes), upload
artwork and get it approved, then run the Consistency check to catch a
label pointing at the wrong formula version, an incomplete ingredient
declaration, or a prohibited claim printed on the label. Both claims and
labels support JSON/CSV/Excel import/export with a preview step; imported
records always start as drafts, never auto-verified or auto-approved.

Turning on any of the Approval workspace's claims/label-gate toggles
(all claims reviewed, no prohibited/unsupported claims, label review
complete, artwork approved, formula-label consistency, all required
languages reviewed) folds these facts into that formula's readiness check
the same way the dossier gates already do. Full model:
[PRODUCT_CLAIMS.md](PRODUCT_CLAIMS.md), [CLAIM_EVIDENCE.md](CLAIM_EVIDENCE.md),
[CLAIM_REVIEWS.md](CLAIM_REVIEWS.md), [PRODUCT_LABELS.md](PRODUCT_LABELS.md),
[LABEL_CONTENT.md](LABEL_CONTENT.md), [LABEL_ARTWORK.md](LABEL_ARTWORK.md),
[LABEL_REVIEWS.md](LABEL_REVIEWS.md),
[FORMULA_LABEL_CONSISTENCY.md](FORMULA_LABEL_CONSISTENCY.md),
[CLAIMS_LABEL_READINESS.md](CLAIMS_LABEL_READINESS.md).

## 22. Design of Experiments

Open the **Design of Experiments workspace** (`/doe`) to plan and run a
statistically valid formulation/process experiment. Create a study through
the wizard: pick a real saved formula version as its baseline, define
factors (formula materials, mixing speed/time, temperature, pH, or a
custom process parameter — each with a low/center/high range or a
categorical level list), add any hard/soft constraints, define responses
and their objectives (maximize/minimize/target/within-range), pick a
design type (full/fractional/two-level factorial, Plackett-Burman, central
composite, Box-Behnken, Latin hypercube, mixture simplex-lattice, or a
hand-built custom design), and generate — the app randomizes the run order
and shows real diagnostics (duplicate/balance/orthogonality/condition-
number checks) before you commit.

Work through the generated **Runs**: record each response's observed value
per run (or mark it missing/invalid/excluded with a reason — never
silently treated as zero), and generate or link a real Laboratory trial
directly from a run. Once enough data is in, run a **statistical
analysis** — the app fits a real OLS model (main effects, factorial with
interactions, quadratic response-surface, or a mixture blending model) to
what was actually recorded, and shows the coefficients, ANOVA, fit
quality, and residual charts. It will suggest — never auto-exclude — a run
that looks like an outlier; you decide. Generate **candidates** from a
finished analysis to see a ranked, desirability-scored list of promising
factor settings, then apply the best one to your current working draft (it
never overwrites a saved version) and save it as a new version through the
normal Formulation workflow when you're satisfied.

Full model: [DESIGN_OF_EXPERIMENTS.md](DESIGN_OF_EXPERIMENTS.md) and its
companion documents (`DOE_STUDIES.md`, `DOE_FACTORS_AND_CONSTRAINTS.md`,
`DOE_DESIGN_GENERATION.md`, `DOE_RESPONSES.md`,
`DOE_RUNS_AND_LABORATORY.md`, `DOE_STATISTICAL_ANALYSIS.md`,
`DOE_CANDIDATES.md`, `DOE_OPTIMIZATION_INTEGRATION.md`).

## 23. Data Exchange Center

Open the **Data Exchange Center** (`/data-exchange`, sidebar between
Reports and Administration) to bulk import or export structured data —
materials, suppliers, prices, formulas, lab/stability results, regulatory
rules, dossier evidence, claims, label content, DOE data, Reverse
Formulation studies, and more — as CSV or real Excel files, across **41
templates** (the exact, test-enforced count — see
`packages/shared/src/engine/dataExchangeRegistry.ts`).

For any template's card in the **Template Library**: download a **Blank**
file (header row only) to fill in from scratch, an **Example** file (a
few synthetic, clearly-`TEST-`-prefixed rows) to see the expected shape,
or the **current data** already in that collection to review or hand off.
Excel downloads include dropdown validation on every enum column and a
Field Documentation sheet, so you don't need this guide open while
filling one in.

To import: click **Upload**, choose your CSV or Excel file. The app shows
a **preview before anything is written** — how many rows are new,
updates, unchanged, duplicates, warnings or errors, with the exact reason
for every problem row and a downloadable error report. Fix your file and
re-upload as many times as you need; nothing is written to FormuLab until
you click **Commit import**. If some rows are wrong but others are clean,
you can choose to import just the valid ones and skip the rest.

![Data Exchange validation preview](screenshots/data-exchange-data-exchange-default-light-en.png "Row-level preview before commit — new/updated/duplicate/warning/error counts")

The **Import History** section shows every attempt — including ones you
cancelled or that failed validation — with counts, status, and a link
back to the row-level detail. **Schema Versions** lists every template's
current column requirements. An import can never mark something
verified or approved on its own — a regulatory rule, a dossier's
evidence, a claim, a label, an artwork, a costing override all come in
as drafts/unverified, exactly as if you'd typed them in by hand; formal
sign-off still happens through that module's own workspace.

Two templates — Stability Protocols and Stability Results — preview and
validate normally but cannot yet be committed (a stability study needs a
frozen formula/packaging snapshot that a spreadsheet row can't safely
provide); importing one reports every row honestly skipped rather than
silently doing nothing or faking success.

Full model: [DATA_EXCHANGE_CENTER.md](DATA_EXCHANGE_CENTER.md) and its
companion documents (`DATA_EXCHANGE_TEMPLATE_REGISTRY.md`,
`DATA_EXCHANGE_IMPORTS.md`, `DATA_EXCHANGE_EXPORTS.md`,
`DATA_EXCHANGE_VALIDATION.md`, `DATA_EXCHANGE_SECURITY.md`,
`DATA_EXCHANGE_HISTORY.md`, `DATA_EXCHANGE_TEMPLATE_CATALOG.md`).

## 24. Reverse Formulation

Open the **Reverse Formulation workspace** (`/reverse-formulation`,
Formulation group) to benchmark a competitor's product and generate
candidate formulas that could plausibly recreate it — a research aid,
never a claim of an exact recreation.

1. **Studies** — create a study (code, name, project, product family).
2. **Products** — attach one or more benchmark products to the study;
   for each, record its **ingredient declaration** (the label's INCI
   list, in order — order matters, since INCI order is itself evidence
   of relative concentration) and any real **analytical composition
   results** you have (lab-measured values), each explicitly
   `unverified` until a human checks it.
3. **Mapping** — map each declared ingredient to a real material in your
   own catalog (manual, or a suggested match), then **confirm** or
   **reject** the proposal — a mapping is never auto-accepted.
4. **Target & constraints** — attach a target product profile (pH range,
   jurisdictions, and more) and a constraint set (required/preferred/
   excluded materials, required functions, min/max percentages per
   material).
5. **Candidates** — generate candidate formulas from the declaration,
   mappings, target, and constraints (`engine/candidateGenerator.ts`),
   each scored (`engine/scoringModel.ts`) and ranked, with its scoring
   broken down and explained per dimension, never a single unexplained
   number. Save a candidate you like, or convert it straight into a real
   Formulation project version through the normal versioning path — the
   only module in this guide with that direct bridge (see the composer's
   own limitation in [§0b](#0b-generate-a-starting-formulation-the-composer)).
   A converted version always starts at `concept` status and is
   traceable back to its source study/candidate in the audit log; it
   never inherits approval.

Every line a candidate proposes is attributed `model_estimate`
provenance, the same honest-origin convention every other estimated
number in FormuLab uses ([§2](#2-build-the-formula)) — never presented
as a measured or confirmed fact.

## 25. Reports

Open **Reports** (sidebar, between Approval and Data Exchange) for a
single navigation shell over every module's own real export — it does
not generate a new document type of its own. From here you can jump
straight to a project's Formulation exports, a trial's or study's lab/
stability reports, a dossier's PDF/DOCX, or the Data Exchange Center's
current-data downloads, without hunting through each workspace
individually.

## 26. Administration

Open **Administration** (sidebar, near the bottom) for the
organization-wide configuration screens that sit above any one project:

- **Materials, suppliers, packaging & factory profiles** — the same
  screens described in [§6](#6-raw-materials-and-suppliers) and
  [§7](#7-prices-landed-cost-and-inventory), reachable here since they're
  shared across every project, not owned by one.
- **Test definitions** — the same catalog described in
  [§17](#17-test-definitions), reachable here for the same reason.
- Links out to **Regulatory rules** ([§20](#20-regulatory-kenyaeac)),
  **Approval policies** ([§5](#5-approval)/[§12](#12-approval-readiness)),
  the **Data Exchange Center** ([§23](#23-data-exchange-center)), and
  **Settings** ([§28](#28-settings)) — Administration is the map between
  them, not a duplicate of any one.

![Administration](screenshots/administration-administration-default-light-en.png "Materials, test definitions, and links to every other configuration screen")

## 27. Notebooks, Files, and Runs

Three **Tools** workspaces, useful once your project grows beyond the
formula grid itself:

- **Notebooks** (`/notebooks`) lists every real `.ipynb` notebook across
  every session/project folder, newest first. Create one, or open an
  existing one, and run cells on the app's local Python kernel — the
  same file the app itself edits, so there's exactly one copy to keep in
  sync, never a second "generated" mirror. **Open JupyterLab** is
  available once the app-managed Python environment is set up.
- **Files** (`/files`) is a real file browser and previewer (image,
  notebook, spreadsheet, and more, by extension) for your project
  folder — right-click for the usual file actions.
- **Runs** (`/runs`) is the reproducibility log: every command FormuLab
  itself executed on your behalf (what ran, when, its environment,
  its inputs/outputs), searchable and filterable, with a **Reproduce**
  action that hands the exact original prompt back to you rather than
  silently re-running something that may no longer be safe to repeat
  unattended.

![Notebooks, Files, and Runs](screenshots/tools-notebooks-default-light-en.png "Tools: real .ipynb notebooks, a file browser, and the reproducibility log")

## 28. Settings

Open **Settings** (bottom of the sidebar) for six sections:

- **General** — the raw-materials/pricing screen ([§6](#6-raw-materials-and-suppliers)),
  your **workspace folder** (where projects/sessions/formulas live on
  disk — change or reveal it in Explorer/Finder), **Backup and Recovery**
  and **Schema Migration** ([§28a](#28a-backup-and-recovery)), and **app
  updates** (manual check, auto-check toggle, update-badge visibility).
- **Models** — the provider, model, and API key the composer
  ([§0b](#0b-generate-a-starting-formulation-the-composer)) uses to
  generate a formulation. Never used for anything approval-related —
  see [§30](#30-roles-safety-and-auditability).
- **Runtime** *(desktop app only)* — the local Python interpreter
  notebooks and the pipeline run on; auto-detected, with a manual
  override if you need a specific one.
- **Compute** — optional remote compute (a remote cluster, or Modal) for
  work heavier than your own machine.
- **Privacy** — a data-flow summary: what leaves your machine, to where,
  and under which model/workspace configuration.
- **Appearance** — theme (light/warm/dark), UI **language** (any of the
  8 shipped locales), and, in the desktop app, page **zoom**.

![Settings](screenshots/settings-settings-default-light-en.png "General, Models, Runtime, Compute, Privacy, and Appearance")

## 28a. Backup and Recovery

Inserted section — does not renumber §29/§30 below.

**Settings → General → Backup and Recovery** — save a portable copy of
your data, or restore from one.

- **Create Backup** packages your formulations, master data (materials,
  suppliers, trials, stability, regulatory, dossiers, claims, labels,
  DOE, and every other collection), your session/formula library, and
  your run/provenance history into a single `.formulab-backup` file you
  choose the name and location for. A summary (file count, size, any
  warnings) appears when it finishes.
- **Restore Backup** picks an existing `.formulab-backup` file, shows you
  what it contains before anything happens, and asks you to confirm —
  restoring replaces your current data. A safety backup of your current
  data is made automatically first, so a failed or unwanted restore can
  always be undone; its path is shown to you when the restore finishes.
- **Verify Backup** checks a `.formulab-backup` file without restoring
  it or touching your current data at all — useful before trusting an
  old backup, or one you received from somewhere else. It reports one of
  five results: **Valid**, **Valid, with warnings**, **Incompatible**
  (a version this build doesn't support — not the same thing as a
  damaged file), **Corrupted** (the file itself is damaged — a bad hash,
  a missing piece, broken JSON), or **Unsafe** (the package contains
  something FormuLab will never allow — a path trying to escape its
  folder, a symbolic link, `.FormuLab/runs.db`, or an executable file).
  Every error and warning found is listed individually.
- Create/Restore both show live progress and can be cancelled; Verify is
  a quick, read-only check.
- **What's included**: formulations, all master-data collections,
  sessions, the formula library, and your run/provenance/compute
  history. **What's excluded**: `.FormuLab/runs.db` (a disposable index
  rebuilt automatically, never touched by backup or restore), the
  webview cache (which is also where your LLM provider API key lives —
  never included in a backup), and `data/literature` (the shared
  open-access paper cache — re-fetched through ordinary use, not
  something you authored, so it's left out and noted as a warning when
  skipped).
- Restore only ever writes into **this machine's own** data folder — a
  backup made on another computer never overwrites where your workspace
  or `formulab-root.txt` override points here.
- Not yet available: a backup history list, and automatic scheduled
  backups — planned for later Phase 11 sessions.

**Settings → General → Schema Migration** — shows the data schema
version your project is currently at, and whether anything needs
updating for this version of FormuLab.

- **Dry Run** shows exactly what a migration would change — which
  collections, how many rows — without touching anything.
- **Run Migration** (only enabled when something is actually pending)
  makes a verified safety backup first, migrates one collection at a
  time, and automatically restores that backup if anything fails partway
  — you are told whether the restore succeeded.
- If FormuLab was closed or crashed during a migration, an **An earlier
  migration did not finish** banner appears with a one-click **Restore
  Pre-Migration Backup** action.
- If your project's data was created by a newer version of FormuLab than
  the one you're running, you'll see a clear message asking you to
  update rather than a confusing error.
- As of this version, every collection is already current — Run
  Migration will normally show nothing pending.

## 29. In-app guide and PDF/DOCX generation

This guide is one Markdown source
(`docs/USER_GUIDE.md`) rendered three ways, never duplicated into a
second copy:

- **In-app**: Help Center → **Open the full guide** (or the command
  palette) renders this exact file through the same `MarkdownViewer`
  every other in-app document uses — no separate in-app content model.
- **PDF**: `docs/generated/FormuLab-User-Guide.pdf` — a real,
  paginated document with a cover page, a table of contents with real
  page numbers, page numbers on every page, embedded screenshots with
  captions, callout boxes, and readable tables, built with `pdf-lib`
  (the same library Dossier PDF export uses, with a guide-specific
  layout — never the dossier's own content model).
- **DOCX**: `docs/generated/FormuLab-User-Guide.docx` — the same
  content via `docx` (the same library Dossier DOCX export uses), with a
  native, Word-refreshable table of contents.

Regenerate both with `pnpm docs:guide:generate` after editing this file.
A screenshot referenced in the Markdown that hasn't been captured yet is
skipped with a small "image not yet available" placeholder rather than
breaking the build — see `docs/PHASE10_SCREENSHOT_MANIFEST.json` for
which screenshots exist and which are still pending.

## 30. Roles, safety, and auditability

FormuLab's real role model
(`ApprovalRole`): **researcher**, **chemist**, **quality**,
**regulatory**, **production**, **administrator**. There is no login or
session-identity system — every workspace that needs a role asks you to
select which one you're acting as (an honest limitation, not a security
boundary; see [§0a](#0a-getting-help-in-the-app)'s disabled-action
explanations for exactly which role each gated action needs).

| Gate | Who can act | Enforced |
|---|---|---|
| `pilot_approved` | chemist, quality, administrator | engine-side, not just the UI |
| `production_approved` | quality, regulatory, production, administrator | engine-side, not just the UI |
| Dossier/Claims formal review or export | regulatory, quality, administrator | engine-side, not just the UI |
| Laboratory method assignment/promotion | chemist, quality, administrator | engine-side, not just the UI |

> **No automated actor can ever approve.** An AI-generated candidate, an
> imported spreadsheet row, or a system process can never set
> `pilot_approved`/`production_approved`, record a regulatory review,
> or verify evidence — only a named human, through that module's own
> workspace. This is checked in the engine layer itself
> (`packages/shared/src/engine/`), not merely hidden in the interface —
> see [FORMULA_VERSIONING.md](FORMULA_VERSIONING.md#approval).

Every meaningful change — a saved version, an approval, a status change,
an evidence upload, a review, an export — appends to that project's own
audit log; nothing in FormuLab silently rewrites history. A number this
guide cannot honestly compute stays labelled `missing` / `unknown` /
`not_applicable` / `not_verified` / `estimated` rather than defaulting to
zero or an invented value — the same discipline every module above
follows, not a one-off caveat.

## Known limitations

For how the sidebar's workspaces are organized and why, see
[INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md),
[WORKSPACES.md](WORKSPACES.md) and
[NAVIGATION_AND_CONTEXT.md](NAVIGATION_AND_CONTEXT.md).

See [IMPLEMENTATION_STATUS.md](architecture/IMPLEMENTATION_STATUS.md) for the
authoritative list of what is built versus not yet started. In short: the
Kenya/EAC regulatory engine (§20 above) is implemented, including
version-bound human review, persisted evidence confirmations,
multi-jurisdiction approval readiness, and rule source verification. Phase
3 (regulatory dossiers, evidence matrix, `/dossiers`) and Phase 4 (product
claims, labels, artwork, formula-label consistency, `/claims-labels`) are
both implemented, including their workspace UIs — see
[REGULATORY_DOSSIERS.md](REGULATORY_DOSSIERS.md),
[PRODUCT_CLAIMS.md](PRODUCT_CLAIMS.md), [PRODUCT_LABELS.md](PRODUCT_LABELS.md).
Dossiers generates a real, watermarked final PDF/DOCX (Phase 7 — see
[§21a](#21a-dossier-pdfdocx-export)); Claims & Labels does not have its
own equivalent document export yet. Phase 5
(Design of Experiments, `/doe`) is implemented, including its workspace
UI — see [DESIGN_OF_EXPERIMENTS.md](DESIGN_OF_EXPERIMENTS.md); within it,
`definitive_screening`/`mixture_simplex_centroid` designs, fractions beyond
a half-fraction, and Plackett-Burman sizes beyond N=12 are refused rather
than faked, and an analysis-results export can never be re-imported as a
native analysis. Reverse Formulation ([§24](#24-reverse-formulation)) is
implemented, including candidate generation, scoring, and a direct
conversion path into a real Formulation project version. Laboratory trials and
stability studies (§16–19 above) are implemented, but automatic shelf-life
prediction is deliberately not — see
[STABILITY_TRENDS.md](STABILITY_TRENDS.md#no-validated-shelf-life-claims).
The Advanced Optimizer's screen has no builder for composition,
ratio or conditional constraints (only functional-group constraints,
property targets, a cost ceiling, and the automatic compatibility/safety
exclusion are user-facing) and no lexicographic-priority selector; the
Substitution dialog's system mode does not yet wire graded compatibility/
safety risk into a system's score (real hard exclusions still apply) — see
[ADVANCED_OPTIMIZER.md](ADVANCED_OPTIMIZER.md#what-this-is-not) and
[SYSTEM_SUBSTITUTION.md](SYSTEM_SUBSTITUTION.md#known-limitations).
Compatibility and safety are deterministic rule engines against a
hand-maintained, explicitly non-exhaustive seed rule set — they are not a
regulatory engine and do not establish legal compliance. The Approval
workspace calls approval readiness (including the
lab/stability policies in
[LAB_STABILITY_APPROVAL.md](LAB_STABILITY_APPROVAL.md)) for real —
see [APPROVAL_WORKFLOW.md](APPROVAL_WORKFLOW.md). Its approval-policy
editor supports full field editing, product-family/packaging-SKU scoping,
clone, retire and revision history/restore, plus deterministic
conflict resolution when more than one active policy matches — see
[APPROVAL_POLICIES.md](APPROVAL_POLICIES.md#known-limitations) for the
narrower gaps that remain. No native GUI click-through of the packaged
app exists yet in this environment — see
[APPROVAL_MANUAL_SMOKE_TEST.md](APPROVAL_MANUAL_SMOKE_TEST.md). Nothing in
this guide describes an unimplemented module as available.

This guide now references real screenshot filenames throughout (the
`<module>-<page>-<state>-<theme>-<locale>.png` convention from
`docs/PHASE10_SCREENSHOT_MANIFEST.json`), but **no screenshot has
actually been captured yet** — every reference currently resolves to a
missing image, rendered as a small, honest placeholder in the PDF/DOCX
rather than a broken image or a silently-dropped one. This is a genuine,
disclosed gap, not an oversight: capturing a real screenshot requires
driving the actual Tauri desktop window (launching it against the
Session 5 documentation fixture, navigating it, and taking a pixel
capture), and no reliable, safe automation driver for that native
window was available in this session's environment — attempting it
with fragile timing-based input injection risked capturing and shipping
a wrong or half-loaded state, which would be worse than no image. The
safe, deterministic documentation fixture and screenshot manifest exist
and are fully wired up (every fixture record is synthetic and clearly
marked `DEMO-`, seeded into an isolated profile that is never the app's
real data folder); only the actual capture pass remains, for a future
session with a proper window-automation harness.
