# Implementation Status

Honest state of the Kenya R&D platform transformation. "Done" here means
implemented, wired in and covered by a passing test — not scaffolded.

Last updated: end of the Data Exchange Center phase (Phase 6 — one
schema-driven template registry driving CSV/Excel/validation/commit for 24
mandated import/export templates, the `/data-exchange` workspace, and
Home/Administration/Reports/Projects integration). Before that: the
information-architecture simplification (ten workspace routes replacing
the old single-page tab strip) and the migration runner. Before that: the
Design of Experiments phase (Phase 5). Before that: Phase 4 (claims and
label review) and Phase 3 (regulatory dossiers/evidence matrix). Before
that: the Kenya/EAC Regulatory Engine phase (seven
jurisdictions, deterministic classification, versioned rule model and
evaluation, human-review workflow, Approval Readiness integration, rule
import/export, desktop Regulatory workspace). Before that: the
Laboratory Trials / Stability Studies phase's own closure (dedicated
result history browser, stability applicability explorer, native launch
verification). Before that: the Laboratory Trials / Stability Studies phase (trial
domain model + human-gated lifecycle + execution; shared test-definition/
result system with replicate stats, outlier flagging and revision history;
trial comparison; stability studies with configurable conditions/time
points, pull-point sample generation, deterministic trend analysis and
auto-created failures; a shared corrective-action model; lab/stability
approval-readiness policies; persistence/migrations for the ten new
collections; desktop UI for all of it; lab/stability exports). Before that:
the Advanced Optimizer / Substitution Engine gap-closure phase (soft
constraints, property targets, graded risk objectives, expanded
infeasibility diagnostics, optimization scenarios with product-family
profile application, and multi-material system substitution). Before that:
Excel import, supplier/packaging/factory-profile editors, formula lifecycle
controls, structured version exports, the Compatibility Engine, the Safety
Engine, cross-cutting Approval Readiness, the Turkish locale, the
mixed-integer Advanced Formulation Constraint Optimizer's core solve,
one-to-one material substitution, the optimization/substitution
approval-readiness checks, and the platform's first migration runner.

## Scale note

The full specification (38 sections: product catalog, formula builder,
constraint optimizer, evidence model, regulatory engine, compatibility engine,
safety engine, cost engine, manufacturing methods, lab trials, stability
studies, DOE, substitution, reverse formulation, exports, ERP integration, CI,
docs) is a multi-month programme for a team. It is being built in the specified
phase order. This document tracks exactly where that stands.

## Done

### Repository audit
- `CURRENT_STATE_AUDIT.md` — architecture, persistence, schemas, tests,
  security boundaries and the gap list, written from inspection of the tree
- `TARGET_ARCHITECTURE.md` — layering, schema strategy, precision policy,
  evidence model, approval model

### Product catalog (spec §"Official Kenya Factory SKU Catalog")
- **55 product families, 91 packaging SKUs, all 17 supported domains**
- Family / SKU separation: pack size does not fork the chemistry. Shampoo
  Regular is one family filling a 250 ml bottle and an 8 ml sachet
- Stable codes (`HC-SHAMPOO-REG`, `HC-SHAMPOO-REG-250ML-BOTTLE`); identity is
  never derived from a display name
- Deterministic and idempotent — re-seeding produces byte-identical output
- `hazardClass` marks bleach as industrial, chlorhexidine wipes as medical, QAC
  sanitizers as regulated disinfectants, so the safety engine cannot treat them
  as ordinary consumer goods
- "75 gr" normalised to 75 g with the display label preserved
- 9 tests

### Domain schemas (`packages/shared/src/schemas/`)
- `product.ts` — domains, families, packaging SKUs, units, packaging types
- `formulation.ts` — formulation, immutable versions, lines, 30 material
  functions, 9 evidence origins, 8 support dimensions, 10 statuses. Money and
  percentages are decimal **strings**, not JS numbers
- `status.ts` — the transition graph and approval authority
- `events.ts` — 30 typed agent events, connection state machine, sequencer
- All validated with Zod; exported from `@formulab/shared`

### Approval safety (spec §"AI must never automatically approve")
- `canTransitionTo()` refuses `pilot_approved` / `production_approved` to any
  non-human actor, whatever the model concluded
- Role authority enforced; an approval record is required for the audit trail
- Enforced in the domain layer, not by hiding a button
- 7 tests, including explicit agent-cannot-approve and system-cannot-approve

### Structured completion events (spec §"Remove Markdown-regex matching")
- `formulation_card.completed` carries `formulationId` / `versionId` / `status`
- `EventSequencer` makes handling idempotent so a reconnect cannot double-apply
  a claim or a draft
- Connection states separate cold sidecar start from ordinary reconnect

### Formula Builder (spec §6)
See [FORMULA_BUILDER.md](../FORMULA_BUILDER.md).
- Project creation: family, packaging SKUs, market, brief, claims, batch size;
  persisted under `data/formulations/<id>/`, not in React state
- Editable grid: drag-to-reorder, duplicate, custom phases with phase grouping,
  multi-select functions, seven optional columns, filter, arrow-key cell
  navigation, block paste from Excel, undo/redo with edit coalescing
- Autosave writes the working draft on a debounce, with a visible state
- Deterministic engine for every displayed number; the UI never calculates
- Explicit water q.s. as a line property, with convert-to-fixed and back, and a
  hard guarantee that a negative percentage is never frozen onto a line
- Four-level validation (`info` / `warning` / `error` / `blocking`) with
  per-line, per-field findings that link to the cell
- Functional-group summary that reports `incomplete` rather than treating
  missing active-matter data as zero
- Structural templates for all 55 families (35 distinct product types), with
  required roles, phase order, spec fields and hazard topics — and deliberately
  no percentages
- Draft INCI / generic ingredient declaration, deterministic ordering, missing
  INCI names flagged rather than invented, human override with audit metadata
- Centralised precision policy ([PRECISION_POLICY.md](../PRECISION_POLICY.md))

### Formula versioning and comparison (spec §7)
See [FORMULA_VERSIONING.md](../FORMULA_VERSIONING.md).
- Working draft vs immutable saved version, enforced at the storage layer
- Change reason required; totals, validation and intent snapshotted at save time
  and never recomputed on read
- Version list, restore-into-new-draft, field-level comparison UI with a
  copyable diff
- Approval integration: `import` actor kind added; agent, system and import are
  all refused approval; clone and restore never inherit approval; approval
  records reject non-human approvers and require a justification; append-only
  `audit.jsonl`

### Raw material intelligence (spec §5)
See [RAW_MATERIALS.md](../RAW_MATERIALS.md).
- Material master (identity, physical, use levels, compliance, supply), supplier
  records, append-only price history with landed cost, inventory records,
  exchange rates
- Material list with search, function/status filters, editor dialog
- Explicit `known` / `missing` / `unknown` / `not_applicable` / `not_verified`
  data states; regulatory positions default to `not_verified`
- Deactivate rather than delete
- Generic master-data store with an allow-listed collection set, write-then-
  rename writes, backups before destructive changes, append-only enforcement

### Import / export (spec §5)
See [IMPORT_EXPORT.md](../IMPORT_EXPORT.md).
- Template download, preview-before-commit, row-level errors, warnings kept
  separate, explicit opt-in partial import, idempotent upsert on the stable code
- Both decimal conventions, delimiter sniffing, BOM handling, RFC 4180 quoting,
  English and Turkish header aliases
- Spreadsheet formula injection neutralised on export and stripped on import
- Imports cannot approve anything

### Cost engine (spec §16)
See [COST_ENGINE.md](../COST_ENGINE.md).
- Layers kept separate: raw, landed, labour, utilities, QC, waste, overhead,
  total manufacturing; per kg, per litre, per SKU
- Missing price, missing exchange rate and expired price are three distinct
  reported states; totals are labelled lower bounds, never silently zeroed
- Dated exchange rates with a required source; nothing is ever fetched; no
  triangulation through a third currency
- Landed cost with four allocation bases and loss uplift
- Packaging BOMs with fractional case allocation and waste factors; fill
  converted to mass through density
- Factory cost profiles with `verified` / `not_verified` / `example_only`
- Immutable cost snapshots recording every input; a price change today cannot
  rewrite what a formula cost in March
- Cost comparison attributing a change to formula / price / rate / packaging /
  factory-cost / missing data, reporting several causes rather than inventing a
  split

### Compatibility engine (spec §14)
See [COMPATIBILITY_ENGINE.md](../COMPATIBILITY_ENGINE.md).
- Deterministic, versioned rule model (`schemas/compatibility.ts`) — an LLM
  may explain a finding, it never produces one
- 20 seed rules (`catalog/compatibilityRules.ts`), one per category named in
  the specification (anionic/cationic, QAC/anionic, chlorhexidine/anionic,
  acid/hypochlorite, hypochlorite/amine, oxidizer/reducer, peroxide/metal,
  preservative/pH, carbomer/electrolyte, carbomer neutralizer, fragrance and
  active solubility, metal-ion sensitivity, enzyme/oxidizer, temperature- and
  packaging-dependent rules), every one carrying an honest
  `verificationStatus` and empty `sourceReferences` rather than an invented
  citation — explicitly not exhaustive
- Deterministic evaluation engine, snapshotted per formula version
  (`ruleVersionsUsed` pinned so a later rule edit cannot rewrite a past
  result), duplicate-finding-proof, missing-data reported as
  `dataIncomplete` rather than silently safe
- Compatibility tab, rule management screen, JSON/Excel export, JSON import
- 20 tests (`engine/compatibility.test.ts`)

### Safety engine (spec §15)
See [SAFETY_ENGINE.md](../SAFETY_ENGINE.md).
- Hazard data model (`schemas/safety.ts`): 16 hazard classes, 9 GHS
  pictograms, signal words, `MaterialHazardRecord` by CAS number, 4-state
  verification (`verified` / `not_verified` / `imported_unverified` /
  `human_review_required`) — no GHS classification is ever invented
- Deterministic product-safety classification (`classifyProductSafety`) into
  the 8 specified classes, driven by the catalog's seeded `hazardClass` field
  plus claim keywords, never a model's guess
- 16 seed safety rules (`catalog/safetyRules.ts`) covering 16 of the 17
  specified categories; the 17th (medical/therapeutic claim escalation) is
  handled by product classification rather than a per-line rule
- `SafetyFinding` with `humanReviewRequired`/`dataIncomplete`; a blocking
  finding cannot be dismissed without a `SafetyResolution` record (named
  reviewer, reason, resolution kind, timestamp) — no AI or bulk-import path
  can create one
- Pre-generation AI-request safety gate (`runtime/pipeline/pipeline.py`,
  `classify_target`/`safety_decision`): refuses prohibited targets before
  literature discovery runs, requires named-human acknowledgement for
  regulated/medical/hazardous classes, logs every decision to
  `data/safety/ai_request_log.jsonl`
- Safety tab, rule management screen (shared with compatibility), resolution
  workflow, audit history
- 19 tests (`engine/safety.test.ts`) plus the pipeline's own safety-gate
  tests

### Approval readiness (cross-cutting)
See [APPROVAL_READINESS.md](../APPROVAL_READINESS.md).
- `assessApprovalReadiness` combines blocking formula-validation findings,
  blocking compatibility findings, blocking safety findings and unresolved
  mandatory human review into one `{ ready, blockers, warnings }` result
- `canTransitionWithReadiness` is the single call site pairing this content
  gate with the existing actor/role gate (`canTransitionTo`) before granting
  `pilot_approved`/`production_approved`
- Bypass-attempt tests cover UI, domain service, import, restore, clone and
  agent-event paths
- 16 tests (`engine/approvalReadiness.test.ts`)

### Gap-closure UI (raw materials, suppliers, packaging, factory, versions)
- **Excel (`.xlsx`) import** is real: `apps/desktop/src/lib/xlsx.ts` reads
  the first worksheet into the same row pipeline CSV uses (preview,
  row-level errors/warnings, partial import all apply identically);
  macro-enabled and legacy binary workbooks are rejected before parsing.
  Downloadable `.xlsx`/CSV templates exist for every supported collection.
- Supplier detail screen (`SupplierEditor.tsx`): legal name, contact,
  Incoterm, payment terms, lead time, MOQ notes, approved-supplier status,
  linked materials, price history — all fields persist through
  `upsertRecords`.
- Packaging component and BOM editors (`PackagingComponentEditor.tsx`,
  `PackagingBomEditor.tsx`): component type/weight/material type/waste
  factor/effective dates, BOM line add/remove/reorder, carton and
  shrink-wrap allocation, total packaging cost.
- Factory cost profile editor (`FactoryProfileEditor.tsx`): create, edit,
  clone, activate/deactivate; `verified` / `not_verified` / `example_only`
  stays visibly marked on every profile.
- Formula lifecycle controls (`packages/shared/src/engine/lifecycle.ts`):
  retire, reject, restore-into-new-draft, with reason and audit trail;
  restore never restores production approval. 10 tests
  (`engine/lifecycle.test.ts`).
- Structured version exports (`packages/shared/src/engine/exports.ts`): JSON
  formulation package, CSV formula, Excel formula sheet, cost-snapshot
  export, packaging-BOM export, ERP draft BOM CSV, ERP draft recipe CSV — all
  stamped with formula/version id, schema version, export timestamp,
  approval status, and an `R&D DRAFT / NOT PRODUCTION APPROVED` watermark
  when unapproved. 8 tests (`engine/exports.test.ts`). No PDF or Word export.
- Named variant creation and version comparison UI (`VersionCompare.tsx`);
  no whole-tree graph view, and merging is restore-into-new-draft only, by
  design — no automatic merge of formula percentages.
- **Localisation**: 8 shipped locales (added Turkish), with the major R&D
  workflows (Formula Builder, Versions, Materials, Suppliers, Costing,
  Packaging, Factory profiles, Compatibility, Safety) fully translated.
  Chemical identifiers (CAS, INCI) are left untouched by design.
- Desktop lint is clean (`pnpm --filter @formulab/desktop lint` exits 0).

### Advanced Formulation Constraint Optimizer (spec §1) — core solving
See [ADVANCED_OPTIMIZER.md](../ADVANCED_OPTIMIZER.md),
[SOFT_CONSTRAINTS.md](../SOFT_CONSTRAINTS.md),
[PROPERTY_TARGETS.md](../PROPERTY_TARGETS.md),
[OPTIMIZATION_CONSTRAINTS.md](../OPTIMIZATION_CONSTRAINTS.md),
[MULTI_OBJECTIVE_OPTIMIZATION.md](../MULTI_OBJECTIVE_OPTIMIZATION.md),
[INFEASIBILITY_ANALYSIS.md](../INFEASIBILITY_ANALYSIS.md),
[SOLVER_ARCHITECTURE.md](../SOLVER_ARCHITECTURE.md). The real, disclosed
remaining gap is the UI, not the solver: no property-target/cost-ceiling/
soft-constraint-parameter inputs, no profile-loading or scenario-comparison
screen, no ratio/conditional-constraint builder — see
[ADVANCED_OPTIMIZER.md](../ADVANCED_OPTIMIZER.md)'s "What this is not".
- Real mixed-integer solve (`runtime/formulation/advanced_optimizer.py`,
  PuLP + CBC), additive to the untouched simple optimizer — composition,
  functional-group, ratio and conditional constraints, all enforced, not
  scaffolded
- Soft constraints are real penalty-based relaxation (slack variables +
  weighted objective terms), not hard-constraint pass-through: hard never
  relaxes, soft relaxes only when necessary, a higher penalty weight
  protects its constraint over a lower one, and `feasible_with_penalties` is
  a distinct status from `optimal`
- Property targets are genuinely calculated (`active_matter`, `total_solids`,
  the five named actives, plus post-solve `hlb`/`density`), never
  fabricated for the five properties that stay `laboratory_required`
- Graded compatibility/safety risk objectives: a non-blocking finding scores
  real severity-weighted risk (`compatibility_risk`/`safety_risk`
  objectives), computed by the same real engines a blocking finding already
  used for hard exclusion — never a flat, uninformative zero
- Compatibility/safety exclusion is real: every candidate pair is checked
  with the actual `evaluateCompatibility`/`evaluateSafety` engines before a
  solve, not a duplicated or hypothetical rule set
- Weighted and lexicographic multi-objective, with `performance_score` and
  `regulatory_uncertainty` refused outright rather than computed from
  nothing; soft-constraint penalties minimize in their own lexicographic
  tier ahead of every user priority
- Structured infeasibility: composition/functional/ratio/conditional/
  property deterministic checks plus a whole-pool compatibility/safety
  exclusion-lockout check, and a disclosed generic fallback when no specific
  cause can be proven
- Real cancellation (the spawned solver process is tracked and killable,
  not merely a UI spinner) and PuLP auto-provisioning shared with the
  simple optimizer's existing install path
- Optimizer tab in the Formula Builder: candidate selection, functional
  constraints, property targets, cost ceiling, objective picker (including
  the two graded risk metrics), run/cancel, results, infeasibility,
  apply-to-draft — never overwrites a saved version
- Scenarios section: create/save/clone/rename/retire/restore a scenario
  (append-only revisions — see [OPTIMIZATION_SCENARIOS.md](../OPTIMIZATION_SCENARIOS.md)),
  load any of the 31 seeded product-family profiles (apply-missing/merge/
  replace-with-confirmation), and compare two or more persisted runs with
  deterministic, per-rule (never "best overall") highlights
- 57 Python tests, 17 `engine/optimization.test.ts`, 20
  `engine/scenarios.test.ts`, 9 `AdvancedOptimizerPanel.test.tsx` (real
  component + real engines, only the Tauri boundary mocked — see
  [OPTIMIZER_UI_VERIFICATION.md](../OPTIMIZER_UI_VERIFICATION.md))

### Raw-Material Substitution Engine (spec §12) — one-to-one and system
See [MATERIAL_SUBSTITUTION.md](../MATERIAL_SUBSTITUTION.md), [SYSTEM_SUBSTITUTION.md](../SYSTEM_SUBSTITUTION.md).
- Deterministic scoring (`engine/substitution.ts`) over 15 real dimensions
  traced to actual material/price/inventory/supplier/compatibility/safety
  data; a dimension with no backing data reports `missingData`, never a
  perfect-match default
- Active-equivalent replacement, technical-maximum capping, ranking that
  sorts a blocking finding after every clean candidate
- "Replace material" action wired into the Formula Builder; applying a
  candidate creates a new working draft and persists an immutable
  `SubstitutionRun` record before touching it
- System (multi-material) substitution now generates real candidate
  combinations (`engine/systemSubstitution.ts`'s `generateSystemCandidates`
  — by function coverage and the other real fields listed in
  SYSTEM_SUBSTITUTION.md, never name similarity, with configurable
  generation limits), routes each through the actual Advanced Optimizer
  (`buildSystemSubstitutionProblem`), and scores the result
  (`scoreSystemResult`) — selecting more than one formula line in the
  Substitution dialog enters system mode
- 19 tests (`engine/substitution.test.ts`), 21
  (`engine/systemSubstitution.test.ts`), 5 (`SubstitutionPanel.test.tsx`,
  same real-component/mocked-Tauri-boundary discipline)

### Approval readiness — optimization/substitution integration
`assessApprovalReadiness` (see [APPROVAL_READINESS.md](../APPROVAL_READINESS.md))
re-checks an applied optimization or substitution run's actual persisted
result status against `FormulationVersion.appliedOptimizationRunCode`/
`appliedSubstitutionRunCode` — a defensive check against a forged or stale
reference, distinct from the solver's/scorer's own correctness — and now
also blocks when a substitution run has no `selectedCandidateId` recorded,
or when the selected candidate itself carries a blocking finding. Now
called from the desktop Approval tab — see
[APPROVAL_WORKFLOW.md](../APPROVAL_WORKFLOW.md) and the closure entry
below. 38 tests total in `approvalReadiness.test.ts` (including the
lab/stability policies below).

### Laboratory Trials + Stability Studies (spec §9)
See [LABORATORY_TRIALS.md](../LABORATORY_TRIALS.md),
[TRIAL_EXECUTION.md](../TRIAL_EXECUTION.md),
[TEST_DEFINITIONS.md](../TEST_DEFINITIONS.md),
[TEST_RESULTS.md](../TEST_RESULTS.md),
[TRIAL_COMPARISON.md](../TRIAL_COMPARISON.md),
[STABILITY_STUDIES.md](../STABILITY_STUDIES.md),
[STABILITY_TRENDS.md](../STABILITY_TRENDS.md),
[CORRECTIVE_ACTIONS.md](../CORRECTIVE_ACTIONS.md),
[LAB_STABILITY_APPROVAL.md](../LAB_STABILITY_APPROVAL.md). Explicitly
excludes the regulatory engine, DOE, reverse formulation, and automatic
shelf-life prediction — none of those are implemented here either.
- `LaboratoryTrial` — human-gated lifecycle (`canTransitionTrial`, agent/
  system/import actors refused `completed`), a frozen `formulaSnapshot`
  immune to later draft/version edits, embedded material-usage/process-
  step/observation arrays (matching `FormulationVersion.lines[]`'s own
  embedding convention), and a separate `TrialDeviation` collection
  cross-referenced by corrective actions and approval readiness
- Material weighing (target/actual/deviation, configurable tolerance,
  batch-level variance with an honest lower bound while any line is
  unweighed) and process-step execution (planned vs. actual, deterministic
  deviation only, unplanned-step flag)
- Shared `TestDefinition`/`TestResult` system (also used by stability):
  numeric/text/boolean/pass_fail/categorical/visual_rating result types,
  configurable pass/fail rules, replicate statistics (sample std-dev),
  1.5×IQR outlier flagging (≥4 replicates), human-only override, append-
  only revision history (`revisesResultId`, never mutated in place); 27
  seeded structural test templates, all `not_verified`
  (`catalog/testDefinitions.ts`)
- `compareTrials` — deterministic per-trial and per-test-metric comparison,
  no automatic causation inference; any AI interpretation is a labelled,
  additive field, never a replacement for the numbers
- `StabilityStudy` — same snapshot-immutability and human-gated lifecycle
  discipline as trials, one fixed packaging system per study, 9 seeded
  storage conditions + 9 seeded time points (configurable examples, never
  presented as regulatory requirements), deterministic pull-point sample
  generation (condition × time point × replicate) with computed due dates,
  deterministic trend analysis (`computeStabilityTrend`) with limit
  crossing and a strictly gated, always-labelled experimental projection
  (`MIN_PROJECTION_POINTS = 3`, `MIN_PROJECTION_SPAN_DAYS = 14`) —
  never a validated shelf-life claim
- Shared `CorrectiveAction` model (`sourceType: trial_deviation |
  trial_failure | stability_failure | manual`) used by both domains;
  `effective`/`ineffective` only reachable through a recorded
  effectiveness check; `createDraftFromCorrectiveAction` reuses
  `draftFromVersion` directly, never inherits approval
- Approval readiness extended with `LabApprovalPolicy`/
  `StabilityApprovalPolicy` (ten new blocker codes, every requirement
  optional and off by default, no hardcoded duration requirement) — now
  called from the desktop Approval tab, with `labReadiness`/
  `stabilityReadiness` derived from real persisted records rather than
  supplied booleans (see [LAB_STABILITY_APPROVAL.md](../LAB_STABILITY_APPROVAL.md)
  and the closure entry below)
- Ten new master-data collections (`laboratory_trials`, `test_definitions`,
  `test_results`, `trial_comparisons`, `trial_deviations`,
  `corrective_actions`, `stability_studies`, `stability_samples`,
  `stability_results`, `stability_failures`) added to the Rust allow-list,
  three marked append-only (`test_results`, `trial_comparisons`,
  `stability_results`)
- Desktop UI: Trials, Tests, Stability and Corrective Actions tabs in the
  Formula Builder, each wired to the real engine/persistence code (see
  [USER_GUIDE.md §16–19](../USER_GUIDE.md))
- Exports: trial JSON/batch-sheet/weighing-sheet/process-sheet/test-
  results/comparison/corrective-actions/ERP-draft-CSV, and stability
  protocol/sample-plan/time-point/summary/test-results/corrective-actions/
  ERP-draft-CSV (`engine/labExports.ts`, `engine/stabilityExports.ts`)
- 437 shared-package tests total, including
  15 (`testResults.test.ts`), 24 (`laboratory.test.ts`), 18
  (`stability.test.ts`), 9 (`correctiveActions.test.ts`), 12
  (`labExports.test.ts`), 7 (`stabilityExports.test.ts`), and the 14
  lab/stability additions inside `approvalReadiness.test.ts`; 11
  UI-integration tests (`TrialsPanel.test.tsx`, `StabilityPanel.test.tsx`,
  same real-component/mocked-masterdata-boundary discipline as
  `AdvancedOptimizerPanel.test.tsx`/`SubstitutionPanel.test.tsx`)

### Approval workflow closure
See [APPROVAL_WORKFLOW.md](../APPROVAL_WORKFLOW.md),
[APPROVAL_POLICIES.md](../APPROVAL_POLICIES.md),
[TEST_APPLICABILITY.md](../TEST_APPLICABILITY.md),
[ATTACHMENTS.md](../ATTACHMENTS.md). Closes the gap disclosed above and in
[APPROVAL_READINESS.md](../APPROVAL_READINESS.md)/
[LAB_STABILITY_APPROVAL.md](../LAB_STABILITY_APPROVAL.md): a real desktop
approval action now exists and calls `assessApprovalReadiness` with every
source populated from persisted records.
- Desktop Approval tab (`ApprovalPanel.tsx`) — version/target-status/policy
  selection, full blocker/warning list with per-blocker navigation, human
  reviewer role/name/user-id/reason, Approve/Reject/Cancel, approval
  history. Reuses the pre-existing `version.retired`/`version.rejected`/
  `version.reopened` audit-event/`effectiveStatus` mechanism — two new
  `LIFECYCLE_ACTIONS` entries (`version.approved.pilot_approved`/
  `version.approved.production_approved`) rather than a parallel status
  mechanism; `attemptApprovalTransition` (`engine/lifecycle.ts`) wraps the
  pre-existing `canTransitionWithReadiness`.
- `ApprovalRecord` extended additively (all new fields optional):
  `decision` (approved/rejected/cancelled/blocked), `previousStatus`/
  `requestedStatus`, `reviewerUserId`/`reviewerRole`, frozen
  `readinessSnapshot`/`laboratoryReadinessSnapshot`/
  `stabilityReadinessSnapshot`. `save_approval_record` (Rust) needed no
  change — it already operates on untyped JSON.
- `deriveLabReadiness`/`deriveStabilityReadiness`/
  `derivePackagingCompatibilityReadiness`
  (`engine/approvalDerivation.ts`, new) — turn persisted
  `laboratory_trials`/`test_results`/`trial_deviations`/
  `corrective_actions`/`stability_studies`/`stability_samples`/
  `stability_results`/`stability_failures` into the plain facts
  `LabReadinessInput`/`StabilityReadinessInput` already expected. Packaging
  compatibility is a real five-state read
  (`passed`/`failed`/`incomplete`/`not_required`/`unknown`) keyed off a new
  `TestDefinition.testCapability` field, never a display-name match; the
  boolean that feeds `assessApprovalReadiness` maps `passed`/`not_required`
  to `true` — `unknown` never silently reads as passed.
- Test-definition applicability, enforced (`engine/testApplicability.ts`,
  new): `isTestDefinitionApplicable`/`resolveApplicableTestDefinitions`/
  `buildTestRequirementSnapshot`. A trial/study now captures an immutable
  `testRequirementSnapshot` at creation — a later edit to a `TestDefinition`
  cannot retroactively change what an existing trial/study's protocol
  required.
- Safe attachment references (`src-tauri/src/attachments.rs`, new): a
  picked file is copied into `data/formulations/<id>/attachments/` under a
  generated name with a computed SHA-256 checksum, allow-listed to
  image/PDF/spreadsheet/text-document extensions — never a raw absolute
  path from the renderer. Wired into trial observations/deviations/process
  steps/test results, stability results/failures, and corrective actions
  via a shared `AttachmentField` component.
- `ApprovalPolicy` (new, `approval_policies` master-data collection,
  mutable) — persisted per-organization gates, replacing the previous
  "per-call parameter only" limitation; one seeded example ships inactive.
- 49 new shared-package tests (24 `approvalDerivation.test.ts`, 14
  `testApplicability.test.ts`, 11 new `lifecycle.test.ts` cases) — 486
  total. 12 new desktop tests (6 `ApprovalPanel.test.tsx`, 6
  `AttachmentField.test.tsx`) — 353 total. 3 new Rust unit tests
  (`attachments::tests`) — 68 total.

### Approval workflow closure — remaining gaps (policy editing, equivalence, replacement, exclusion explorer)
Closes every gap the previous entry's "Known limitations" disclosed. See
[APPROVAL_POLICIES.md](../APPROVAL_POLICIES.md),
[APPROVAL_WORKFLOW.md](../APPROVAL_WORKFLOW.md#equivalent-versions),
[ATTACHMENTS.md](../ATTACHMENTS.md#replacing-a-finalized-attachment),
[TEST_APPLICABILITY.md](../TEST_APPLICABILITY.md#exclusion-explorer),
[APPROVAL_MANUAL_SMOKE_TEST.md](../APPROVAL_MANUAL_SMOKE_TEST.md).
- Full approval-policy editor (`PolicyEditor.tsx`, `engine/approvalPolicy.ts`,
  new): edit every field, clone, retire (terminal), and an append-only
  `approval_policy_revisions` history with restore-as-new-revision — never
  a silent overwrite of a historical revision. Product-family/packaging-SKU
  scope editors (All/Selected, search, multi-select). Deterministic
  precedence (`resolvePolicyPrecedence`) when more than one active policy
  matches — exact family+SKU > exact family > exact SKU > global, tied by
  explicit `priority` then most-recent `effectiveDate`; a genuine tie
  returns a structured `PolicyConflict` blocker rather than merging or
  guessing.
- Equivalent-version declaration (`EquivalenceWorkflow.tsx`,
  `engine/equivalence.ts`, new): a human-only, justified, append-only
  `FormulaVersionEquivalence` record (revocation is a new record, never an
  edit) feeding `deriveLabReadiness`/`deriveStabilityReadiness`'s
  `equivalentVersionIds` — with a real field-level comparison
  (`compareVersions` + live compatibility/safety counts) shown before a
  reviewer can declare one, and an "Includes evidence from equivalent
  version(s)" badge wherever that evidence is actually used.
- Attachment replacement (`AttachmentField.tsx`'s `onReplace`, new): a
  finalized `test_results`/`stability_results` attachment can be replaced
  via a new result revision (`revisesResultId`), never a silent overwrite;
  a dedicated `attachment.replaced` audit event (new `AuditEvent.metadata`
  field) records the old/new attachment ids, parent record, reason,
  actor and both checksums.
- Applicability exclusion explorer (`ExclusionExplorer.tsx`,
  `evaluateApplicability`/`explainExclusion` in `engine/testApplicability.ts`,
  new): Included/Excluded tabs, each excluded definition tagged with every
  deterministic reason it failed, wired into the Trials panel's Tests tab.
- 60 new shared-package tests (19 `approvalPolicy.test.ts` (engine), 13
  `approvalPolicy.test.ts` (schema/precedence), 14 `equivalence.test.ts`, 6
  new `testApplicability.test.ts` cases) — 538 total. 4 new desktop tests
  (`ApprovalPanel.test.tsx`) — 357 total.
- Known limitations: the policy scope editor's packaging-SKU options come
  from the current formulation only, not a global SKU catalog;
  `verificationStatus` has no UI control; attachment replacement covers
  the two append-only result collections only, not the mutable
  deviation/failure/corrective-action/observation/process-step records.

### Phase 1 closure — result history browser, stability applicability, native verification
See [RESULT_HISTORY_BROWSER.md](../RESULT_HISTORY_BROWSER.md),
[TEST_APPLICABILITY.md](../TEST_APPLICABILITY.md),
[TAURI_LIVE_VERIFICATION.md](../TAURI_LIVE_VERIFICATION.md). Closes the
three items the previous phase's report disclosed as incomplete.
- **Dedicated result history browser** (`ResultHistoryBrowser.tsx`,
  `engine/resultHistory.ts`, new): replaces the inline-only "revises
  `<id>`" text with a full revision chain, retest lineage, two-revision
  comparison and attachment-replacement history, opened via a "View
  history" action from Trials' Tests tab and Stability's sample dashboard.
  Both result types share one component via a common `HistoricalResult`
  shape.
- **Stability applicability explorer**: `ExclusionExplorer.tsx` is now
  wired into `StabilityPanel.tsx`'s study creation (previously Trials
  only), reusing the same `evaluateApplicability` call rather than a
  parallel engine. Manual inclusion of an otherwise-excluded test now
  requires a reviewer and reason, both recorded in the immutable
  `testRequirementSnapshot`; an existing study's snapshot is compared
  (read-only) against what current `TestDefinition`s would now resolve.
- **Native Tauri verification**: investigated `tauri-driver`, WebDriver,
  WinAppDriver, UI Automation, pywinauto, Appium, and Playwright — none
  installed, and UI Automation confirmed Chromium's accessibility tree
  isn't exposed here. Real native launch (process/window/title/PID) and
  real native mouse/keyboard-driven UI interaction (nav clicks, text
  input) were both demonstrated and screenshotted directly against the
  packaged app — correcting a prior assumption ("no attached display")
  that turned out to be false. The full Trials/Stability/Approval
  click-through checklist was not completed live, blocked by a virtual
  display shorter than the app's designed layout. Status: **PARTIALLY
  LIVE VERIFIED** — see `TAURI_LIVE_VERIFICATION.md` for the full
  evidence and exact scope.
- 22 new/changed shared-package tests (20 new `resultHistory.test.ts`, 2
  new `testApplicability.test.ts` cases) — 558 (before Phase 2's separate,
  stashed work) shared tests total. 12 new desktop tests
  (`ResultHistoryBrowser.test.tsx`, plus one integration test each in
  `TrialsPanel.test.tsx`/`StabilityPanel.test.tsx` for result history, and
  two in `StabilityPanel.test.tsx` for the applicability explorer/manual
  inclusion) — 369 desktop tests total.
- `scripts/windows/verify-formulab-phase1.ps1` — launch/window-only native
  verification script; deliberately does not claim to verify anything
  inside the app.
- Known limitations: `TrialsPanel.tsx` has no symmetric manual-inclusion
  reviewer/reason UI (Stability does); the result comparison view supports
  exactly two revisions at a time; no full automated click-through of
  Trials/Stability/Approval in the packaged app yet — see
  `TAURI_LIVE_VERIFICATION.md`'s recommendation for a future pass
  (`tauri-driver` + a taller virtual display).

### Kenya/EAC Regulatory Engine (spec §13)
See [REGULATORY_ENGINE.md](../REGULATORY_ENGINE.md),
[REGULATORY_CLASSIFICATION.md](../REGULATORY_CLASSIFICATION.md),
[REGULATORY_RULES.md](../REGULATORY_RULES.md),
[EAC_MARKET_PROFILES.md](../EAC_MARKET_PROFILES.md),
[REGULATORY_REVIEWS.md](../REGULATORY_REVIEWS.md),
[REGULATORY_EVIDENCE_CONFIRMATIONS.md](../REGULATORY_EVIDENCE_CONFIRMATIONS.md),
[REGULATORY_MULTI_MARKET_APPROVAL.md](../REGULATORY_MULTI_MARKET_APPROVAL.md),
[REGULATORY_RULE_VERIFICATION.md](../REGULATORY_RULE_VERIFICATION.md).
Phase 2 — recovered from a paused work-in-progress stash (the
foundation), completed with persistence/desktop UI/Approval Readiness
integration/i18n, then **closed**: version-bound reviews, persisted
evidence confirmations, multi-jurisdiction approval readiness, rule
source verification, CSV/Excel import, and review-equivalence reuse.

**Implemented** (foundation, unchanged this closure):
- Seven jurisdictions (`REGULATORY_JURISDICTIONS`: KE/UG/TZ/RW/BI/SS plus
  the `EAC` regional-bloc overlay), deterministic product classification
  (`classifyProductRegulatory`), a versioned `RegulatoryRule` +
  append-only `RegulatoryRuleRevision` model mirroring
  `ApprovalPolicy`/`ApprovalPolicyRevision`'s human-gated
  create/edit/activate/deprecate lifecycle, rule evaluation
  (`evaluateRegulatory`) across three shapes (ingredient-based,
  claim-based, product-level requirement) with honest
  `missing_data`/`human_review_required` defaults for anything not
  automatically confirmable, a six-status `RegulatoryFinding`.

**Implemented — Phase 2 closure**:
- `RegulatoryReview` now binds to an exact `formulaVersionId` (never
  `"working_draft"`) + `jurisdiction` + optional `packagingSkuCode`, with
  frozen `classificationSnapshot`/`findingSnapshot`/`ruleVersionSnapshot`
  and an eight-status `RegulatoryReviewStatus`
  (`current`/`stale_formula_version`/`stale_rule_version`/
  `wrong_jurisdiction`/`wrong_packaging_sku`/`revoked`/`superseded`/
  `unknown`) via `deriveRegulatoryReviewStatus`/`findApplicableRegulatoryReview`
  (`engine/regulatoryReviews.ts`).
- Persisted `RegulatoryEvidenceConfirmation`/
  `RegulatoryEvidenceConfirmationRevocation` (regulatory/quality/
  administrator role only — see "Regulatory authorization closure"
  below — append-only, version/jurisdiction/SKU-scoped) replace the
  earlier session-local confirmation checkboxes; `deriveRegulatoryReadiness`'s
  document/evidence/claims gates now read these real records.
- Multi-jurisdiction Approval Readiness: `resolveRegulatoryJurisdictions`/
  `assessMultiJurisdictionRegulatoryReadiness`
  (`engine/regulatoryApproval.ts`) plus three new opt-in `ApprovalPolicy`
  fields (`requiredRegulatoryJurisdictions`,
  `requireAllTargetMarketsReviewed`, `allowPrimaryMarketOnly`) — a policy
  touching none of them still checks the primary market only, unchanged.
- Rule source/verification workflow: `sourceTitle`/`sourceAuthority`/
  `sourceReference`/`sourcePublicationDate`/`sourceEffectiveDate`/
  `sourceExpiryDate`/`sourceJurisdiction`/`sourceDocuments` fields, a
  widened `verificationStatus` (adds `under_review`/`rejected`/
  `expired`/`superseded`), and `verifyRule`/`rejectRuleVerification`/
  `supersedeRule` (`engine/regulatoryRules.ts`), gated to an authorized
  human regulatory/quality/administrator role; `verifyRule` refuses
  without both `sourceAuthority` and `sourceReference` already set.
- CSV and Excel rule import (JSON already existed) — preview before
  commit, row-level errors, imports always forced
  `imported_unverified`.
- Regulatory review equivalence reuse: `RegulatoryReviewEquivalence`
  (`engine/regulatoryReviews.ts`), a separate record from the
  laboratory/stability `FormulaVersionEquivalence` (regulatory reuse
  needs jurisdiction + packaging-SKU scoping dimensions the other never
  had) — regulatory/quality/administrator role only, revocable, never
  assumed automatically.
- `ApprovalRecord.regulatorySnapshot` — the complete multi-jurisdiction
  regulatory picture (classification/finding/rule-version snapshots,
  active evidence confirmation ids, applicable review id + currentness,
  per-jurisdiction ready/blockers) frozen at approval time, same
  "snapshot, never recomputed" convention as
  `laboratoryReadinessSnapshot`/`stabilityReadinessSnapshot`.
- Desktop Regulatory workspace (`RegulatoryPanel.tsx`): saved-version +
  jurisdiction + packaging-SKU + reviewer-role selectors, findings
  evaluation with persisted confirmation, rule browser/editor with
  verify/reject/supersede controls and revision history, JSON/CSV/Excel
  import with preview, human review recording/revocation, review
  equivalence declare/revoke.
- Eight regulatory audit events (`regulatory.review_recorded`,
  `regulatory.review_revoked`, `regulatory.confirmation_recorded`,
  `regulatory.confirmation_revoked`, `regulatory.rule_verified`,
  `regulatory.rule_verification_rejected`, `regulatory.rule_superseded`,
  `regulatory.review_reused`, plus `regulatory.review_reuse_revoked`)
  appended via the existing `appendAudit`/`auditEvent` mechanism.
- 17 seed rules across all seven jurisdictions
  (`catalog/regulatoryRules.ts`), every one an explicit `not_verified`
  structural placeholder — unchanged; verifying one for real requires a
  qualified human reviewer supplying a real source and calling
  `verifyRule`.
- Seven master-data collections (`regulatory_rules`,
  `regulatory_rule_revisions`, `regulatory_reviews`,
  `regulatory_review_revocations`, `regulatory_evidence_confirmations`,
  `regulatory_evidence_confirmation_revocations`,
  `regulatory_review_equivalences`) on the Rust allow-list; all start at
  `schemaVersion: "1.0"` — this closure reshaped several regulatory
  schemas additively before any release ever shipped on this data, so no
  migration was registered.
- English and Turkish i18n (real translations); the other six shipped
  locales carry the same keys as English placeholders pending native
  review, per this project's existing i18n convention.

**Verified by tests**: 674 shared-package tests total, including
`regulatoryClassification.test.ts` (13), `regulatoryRules.test.ts` (34),
`regulatoryApproval.test.ts` (35), `regulatoryReviews.test.ts` (32, new).
386 desktop tests total, including `RegulatoryPanel.test.tsx` (14) and
`ApprovalPanel.test.tsx` (13, including its regulatory readiness
integration cases).

**Requires qualified regulatory content**: every seed rule's
concentration limit, required-document list, label-element list, and
stated authority/source remain unconfirmed placeholders — Phase 2
closure adds the *mechanism* to verify a rule (`verifyRule`), it does
not and cannot itself confirm that any specific limit or requirement
reflects real Kenyan/EAC law.

**Phase 3 (regulatory dossiers/evidence matrix) and Phase 4 (claims and
label review) are now both implemented** — see the two dedicated sections
below. `RegulatoryEvidenceConfirmation` above and the Phase 3/4 systems
below are complementary, not overlapping: this section's confirmations
remain a lightweight, non-versioned per-jurisdiction checkbox layer;
Phase 3 added the persisted, version/packaging/jurisdiction-specific
requirement-and-evidence layer; Phase 4 added claims and labels on top of
that. See `REGULATORY_ENGINE.md`'s "Known limitations" for what remains
genuinely unconfirmed (seed-rule content itself).

### Regulatory dossiers and evidence matrix (Phase 3)
See [REGULATORY_DOSSIERS.md](../REGULATORY_DOSSIERS.md),
[DOSSIER_REQUIREMENTS.md](../DOSSIER_REQUIREMENTS.md),
[DOSSIER_EVIDENCE.md](../DOSSIER_EVIDENCE.md),
[EVIDENCE_MATRIX.md](../EVIDENCE_MATRIX.md),
[DOSSIER_REVIEWS.md](../DOSSIER_REVIEWS.md),
[DOSSIER_SUBMISSIONS.md](../DOSSIER_SUBMISSIONS.md).

**Implemented, verified by tests and by UI-integration tests**: a
`RegulatoryDossier` bound to an exact formula version/packaging SKU/
jurisdiction set, with an 11-state lifecycle and append-only revisioning
(`reviseDossier`); frozen per-revision requirement generation from real
configured rules; a live evidence matrix (11-state satisfaction, eligibility
filtering, unknown-is-contagious); evidence items with a full replace-and-
supersede revision chain (never edited in place); automatic evidence-
discovery suggestions from a project's own raw-material documents, lab
trials, stability results and regulatory reviews (accept-only, never
auto-verified); dossier reviews and submissions; JSON/CSV/Excel export and
JSON/CSV/Excel import with preview; a filterable Evidence Matrix UI
(jurisdiction/requirement-type/evidence-type/mandatory/critical/
satisfaction-state/linked-evidence, with an active-filter-count badge and
separate filtered-vs-full export). 8 collections
(`regulatory_dossiers`/`_requirements`/`_reviews`/`_review_revocations`/
`_submissions`/`_manual_requirement_actions`, `regulatory_evidence_items`,
`regulatory_requirement_evidence_links`). Workspace: `/dossiers`, never a
Formula Builder tab.

**Deferred to Phase 7**: a final formatted PDF/DOCX dossier export.

### Claims and label review (Phase 4)
See [PRODUCT_CLAIMS.md](../PRODUCT_CLAIMS.md),
[CLAIM_EVIDENCE.md](../CLAIM_EVIDENCE.md),
[CLAIM_REVIEWS.md](../CLAIM_REVIEWS.md),
[PRODUCT_LABELS.md](../PRODUCT_LABELS.md),
[LABEL_CONTENT.md](../LABEL_CONTENT.md),
[LABEL_ARTWORK.md](../LABEL_ARTWORK.md),
[LABEL_REVIEWS.md](../LABEL_REVIEWS.md),
[FORMULA_LABEL_CONSISTENCY.md](../FORMULA_LABEL_CONSISTENCY.md),
[CLAIMS_LABEL_READINESS.md](../CLAIMS_LABEL_READINESS.md).

**Implemented, verified by tests and by UI-integration tests**: a
`ProductClaim` (30 categories, 11-state lifecycle, deterministic
keyword classification, rule-based finding evaluation reusing
`RegulatoryRule.claimKeywordsAny`, conflict detection) bound to an exact
formula version/packaging SKU/jurisdiction(s)/language(s); claim evidence
links that reuse Phase 3 dossier evidence by reference (never duplicated),
with real eligibility/satisfaction checks (a real "proposed-link
satisfies" bug was caught by tests and fixed before shipping); append-only
claim reviews (regulatory/quality/administrator only); a `ProductLabel`
(10-state lifecycle, one jurisdiction/language per row) with append-only
content blocks (26 real block types, machine-suggested translations never
treated as approved), artwork (upload/approve/reject/replace-with-
supersession, never a full graphic-design editor), append-only label
reviews bound to an exact label AND artwork revision (a genuine domain gap
— these recording functions were entirely missing when first discovered —
was found and closed with dedicated tests), and formula-to-label plus
claim-to-label consistency checking (wrong-version/wrong-SKU always
blocking, ingredient-omission and prohibited-claim detection). Claims/
label readiness folded into Approval Readiness via 7 new opt-in policy
fields (all default `false`) and 19 structured blocker codes (this
session's own coherent design, since the exact originating list did not
survive into this session's context); a real cross-formula-version
scoping bug in that integration was caught by tests and fixed before
shipping. 9 collections
(`product_claims`/`claim_evidence_links`/`claim_reviews`/
`claim_review_revocations`, `product_labels`/`label_content_blocks`/
`label_artworks`/`label_reviews`/`label_review_revocations`). JSON/CSV/
Excel import/export for claims and (per-label) label content, plus
claim-review-summary and label-readiness-summary exports. Home/Projects/
Reports/Dossiers/Regulatory integration (read-only summary cards and deep
links, never editable outside the Claims & Labels workspace itself).
Workspace: `/claims-labels`, never a Formula Builder tab. i18n: EN+TR real
translations, 6 locales carry the established English-placeholder
convention; Swahili is a first-class label language throughout.

**Deferred to Phase 7**: a final formatted PDF/DOCX label or claims-report
export.

### Design of Experiments (Phase 5)
See [DESIGN_OF_EXPERIMENTS.md](../DESIGN_OF_EXPERIMENTS.md),
[DOE_STUDIES.md](../DOE_STUDIES.md),
[DOE_FACTORS_AND_CONSTRAINTS.md](../DOE_FACTORS_AND_CONSTRAINTS.md),
[DOE_DESIGN_GENERATION.md](../DOE_DESIGN_GENERATION.md),
[DOE_RESPONSES.md](../DOE_RESPONSES.md),
[DOE_RUNS_AND_LABORATORY.md](../DOE_RUNS_AND_LABORATORY.md),
[DOE_STATISTICAL_ANALYSIS.md](../DOE_STATISTICAL_ANALYSIS.md),
[DOE_CANDIDATES.md](../DOE_CANDIDATES.md),
[DOE_OPTIMIZATION_INTEGRATION.md](../DOE_OPTIMIZATION_INTEGRATION.md).

**Implemented, verified by tests and by UI-integration tests**: a
`DoeStudy` (12-state lifecycle, revision chain via `supersedesStudyId`,
immutable once analyzed) bound to an exact saved formula version, never a
working draft; factors/constraints (safe hand-rolled expression parser,
no `eval`/subprocess/host access, verified with an explicit
never-executes-arbitrary-code test)/responses; a deterministic
design-generation engine implementing 9 of 11 named design types (full/
two-level/fractional — half-fraction only — factorial, Plackett-Burman —
N=8/12 only, central composite, Box-Behnken, Latin hypercube, mixture
simplex-lattice, custom manual), with real diagnostics (duplicates,
balance, orthogonality, condition number) and seeded reproducible
randomization; `definitive_screening`/`mixture_simplex_centroid` refused
with an explicit error rather than faked. A deterministic statistical-
analysis engine (hand-rolled Gauss-Jordan OLS, ANOVA incl. lack-of-fit,
fit metrics, leverage/Cook's-distance/standardized-residual diagnostics,
F/t-distribution p-values via a standard regularized-incomplete-beta
implementation) fitting main-effects/factorial/quadratic-response-surface/
mixture models to real recorded observations only — never AI-sourced,
never fabricated; a categorical/binary/ordinal/pass-fail response is
refused rather than forced through OLS; missing/excluded observations are
dropped from a fit and listed explicitly, never treated as zero; an
outlier is suggested, never auto-excluded. Derringer-Suich desirability
and a seeded candidate search over the design's own space, ranked, with
every prediction citing its source analysis and flagging extrapolation;
applying a candidate only ever updates a working draft, never a saved
version. Laboratory integration: `LaboratoryTrial` gained optional
`sourceDoeStudyId`/`sourceDoeDesignId`/`sourceDoeRunId` lineage fields
(no migration needed); a run's factor settings deterministically map onto
the baseline formula's lines, fixed ingredients untouched. 10 collections
(`doe_studies`/`_factors`/`_constraints`/`_responses`/`_designs`/`_runs`/
`_observations`/`_candidates` mutable; `doe_analyses`/`_review_actions`
append-only, since a re-run is a new fit and review actions are a
sign-off log). JSON/CSV/Excel export for study/factors/constraints/
responses/design-matrix/run-sheet/observations/coefficients/ANOVA/
candidate-list; CSV import (preview, row-level errors, duplicate
handling) for factors/constraints/observations; an analysis-results
export is deliberately export-only — it can never be re-imported as a
native analysis. Workspace: `/doe` (Studies/Design/Runs/Responses/
Analysis/Candidates/History/Audit sections, a 9-step study wizard, real
inline-SVG charts incl. a 2-factor response-surface heatmap), never a
Formula Builder tab. Home/Projects/Reports integration (real counts —
active studies, runs awaiting lab work, studies ready for analysis,
candidates awaiting selection — computed from persisted rows, never
fabricated). i18n: EN+TR real translations, 6 locales carry the
established English-placeholder convention.

**Deferred / explicitly out of scope for this phase**: a final formatted
PDF/DOCX report (Phase 7); fractional-factorial fractions beyond a
half-fraction and Plackett-Burman sizes beyond N=12 (refused with an
explicit error, not silently unavailable); automatic stability-result
import into DOE observations (a human enters the value manually instead —
missing-is-never-zero still holds); displaying a specific DOE candidate
inside the Optimization workspace or a side-by-side DOE-vs-optimizer
comparison view (lightweight project-context cross-navigation only).

### Regulatory authorization closure — final Phase 2 gap
See [REGULATORY_REVIEWS.md](../REGULATORY_REVIEWS.md#authorization),
[REGULATORY_EVIDENCE_CONFIRMATIONS.md](../REGULATORY_EVIDENCE_CONFIRMATIONS.md#authorized-role-only-append-only-exactly-scoped),
[REGULATORY_RULE_VERIFICATION.md](../REGULATORY_RULE_VERIFICATION.md#role-gated-lifecycle).
Closes the one remaining Phase 2 limitation the previous entry
disclosed: evidence confirmation and review-equivalence reuse were
human-only but not role-restricted, so any authenticated human role
(not just `regulatory`/`quality`/`administrator`) could confirm
evidence or declare a reuse.

**Implemented**:
- One shared `requireAuthorizedRegulatoryActor`/`isAuthorizedRegulatoryActor`
  (new `engine/regulatoryAuthorization.ts`), replacing three near-duplicate
  role-check functions (`regulatoryReviews.ts`'s `requireHuman`/
  `requireRegulatoryRole`, `regulatoryRules.ts`'s
  `requireRegulatoryReviewer`). Every one of the nine restricted actions
  — record/revoke a regulatory review, confirm/revoke an evidence
  confirmation, declare/revoke a review equivalence, verify/reject/
  supersede a rule's verification — now calls this single function.
- `recordEvidenceConfirmation`/`revokeEvidenceConfirmation` and
  `declareRegulatoryReviewEquivalence`/`revokeRegulatoryReviewEquivalence`
  upgraded from "any human role" to `regulatory`/`quality`/
  `administrator` only. `recordRegulatoryReview`/`revokeRegulatoryReview`
  and `verifyRule`/`rejectRuleVerification`/`supersedeRule` were already
  gated this way and now share the same helper instead of a duplicate.
- Every function throws before constructing any record — an
  unauthorized attempt can never leave a partial write, and (since the
  desktop caller never reaches its own `appendAudit` call when the
  engine call throws first) never appends an audit event either.
- `RegulatoryPanel.tsx` hides or disables every one of the six
  UI-reachable actions (confirm/revoke evidence, save/revoke review,
  declare/revoke equivalence; rule verify/reject/supersede were already
  conditionally rendered) whenever the selected reviewer role is not
  `regulatory`/`quality`/`administrator` — a convenience only; the
  engine call is the actual enforcement regardless of what the UI shows.
- Historical records are unaffected: this closure only changes who may
  create a *new* review/confirmation/equivalence/verification record
  going forward. No existing `RegulatoryReview`,
  `RegulatoryEvidenceConfirmation` or `RegulatoryReviewEquivalence`
  was rewritten, re-validated, or invalidated by this change.

**Verified by tests**: 10 new tests in `regulatoryReviews.test.ts` (42
total, up from 32) covering regulatory/quality/administrator acceptance
and chemist/researcher/system/agent/import rejection for every
restricted evidence-confirmation and review-equivalence action. New
`regulatoryAuthorization.test.ts` (6 tests) exercises the shared helper
directly. 3 new `RegulatoryPanel.test.tsx` cases (17 total, up from 14)
cover the UI hiding/disabling behavior and confirm the backend still
refuses an unauthorized actor even when a caller bypasses the disabled
button. 690 shared-package tests total, 389 desktop tests total.

**Known nuance, not a gap**: the task's rejected-roles list named
`viewer` and `operator`. This codebase's `ApprovalRole` enum
(`schemas/status.ts`) has never had those roles — the six that exist are
`researcher`, `chemist`, `quality`, `regulatory`, `production`,
`administrator`. Tests use `chemist`/`researcher`/`production` as the
"other unauthorized human role" cases instead, since the intent (only
`regulatory`/`quality`/`administrator` passes) is fully covered without
inventing roles the schema doesn't have.

After this closure, Phase 2 has no unresolved authorization limitation
other than real regulatory content still requiring qualified human
verification (unchanged — see "Requires qualified regulatory content"
above).

### Information architecture simplification — ten workspaces
See [INFORMATION_ARCHITECTURE.md](../INFORMATION_ARCHITECTURE.md),
[WORKSPACES.md](../WORKSPACES.md),
[NAVIGATION_AND_CONTEXT.md](../NAVIGATION_AND_CONTEXT.md).
The formulation side of the desktop app used to be one file,
`FormulasPage.tsx` (987 lines): a project list, and — once a project was
opened — a single page with a twelve-item horizontal tab strip (Builder,
Versions, Cost, Compatibility, Safety, Optimizer, Trials, Test
Definitions, Stability, Corrective Actions, Regulatory, Approval), no
project/version context in the URL. Reorganized into ten real routes.

**Implemented**:
- Ten workspace pages (`apps/desktop/src/app/routes/`): `HomePage.tsx`
  (`/home`, new — a real recent-projects/activity/open-lab-work/
  upcoming-stability-samples/pending-approvals dashboard),
  `ProjectsPage.tsx` (`/projects`, extracted from `FormulasPage.tsx`),
  `FormulationPage.tsx` (`/formulation`, trimmed to Builder/Versions/
  Cost/Compatibility/Safety/Packaging — Packaging is new, a read-only
  `PackagingBom` summary), `LaboratoryPage.tsx` (`/laboratory`, Trials/
  Test Definitions/Corrective Actions sections), `StabilityPage.tsx`
  (`/stability`), `OptimizationPage.tsx` (`/optimization`, distinct from
  the pre-existing standalone what-if calculator still at `/optimizer`),
  `RegulatoryPage.tsx` (`/regulatory`), `ApprovalPage.tsx` (`/approval`),
  `ReportsPage.tsx` (`/reports`, new — a navigation shell over existing
  per-module exports, PDF/DOCX explicitly marked not yet implemented),
  `AdministrationPage.tsx` (`/administration`, new — links to Materials/
  Regulatory/Approval/Settings, hosts Test Definitions directly).
- Every reused panel (`RegulatoryPanel.tsx`, `ApprovalPanel.tsx`,
  `TrialsPanel.tsx`, `StabilityPanel.tsx`, `TestDefinitionsPanel.tsx`,
  `CorrectiveActionsPanel.tsx`, `AdvancedOptimizerPanel.tsx`,
  `CompatibilityPanel.tsx`, `SafetyPanel.tsx`, `CostPanel.tsx`,
  `FormulaBuilder.tsx`) is unchanged — each new page is a thin wrapper
  supplying project/version context, not a rewrite.
- Shared infrastructure: `hooks/useFormulationWorkspace.ts` (project/
  versions/draft-with-undo-redo-and-autosave/materials/cost-snapshots/
  packaging-BOMs/audit-log loading plus save/lifecycle/apply actions,
  extracted from `FormulasPage.tsx`), `hooks/useProjectParam.ts`
  (`?project=`/`?version=` query-param read/write),
  `components/workspace/ProjectContextBar.tsx` (`ProjectPicker` +
  `ProjectContextBar`). `FormulationPage.tsx` reads `?tab=`/
  `?focusLine=`; `LaboratoryPage.tsx` reads `?section=`.
  `ApprovalPage.tsx` exports a pure `mapApprovalNavTargetToPath` mapping
  every blocker source to a real route, replacing the old internal
  tab-switch.
- Sidebar (`Sidebar.tsx`) restructured into "New" (unchanged), a new
  "Workspaces" section (the ten above), and a "Tools" section
  (Notebooks/Files/Runs — unrelated, untouched); still one `<nav>`
  landmark.
- Backward compatibility: `/formulas` redirects to `/projects`
  (`<Navigate to="/projects" replace />`); the unmodified
  `FormulasPage.tsx` stays reachable at `/formulas/legacy`. No route
  outside the formulation module (`/live`, `/notebooks`, `/files`,
  `/runs`, `/settings`, `/materials`, `/optimizer`) was touched. No
  persisted record shape, master-data collection, or Rust command
  changed — presentation layer only.

**Verified by tests**: 21 new desktop tests across 6 files —
`ApprovalPage.test.tsx` (5, covering `mapApprovalNavTargetToPath`'s full
mapping table), `FormulationPage.test.tsx` (4, confirming the simplified
tab strip never shows the modules that moved out, and that `?tab=`
context-preservation works), `HomePage.test.tsx` (2, honest empty states
and real-data rendering), `LaboratoryPage.test.tsx` (3, `?section=`
context preservation), `StabilityPage.test.tsx` (2, version-selector
context), `Workspaces.test.tsx` (5, primary-navigation rendering,
Administration's existing-module links, Reports' shell, `/formulas`
route-compatibility). 410 desktop tests total (was 389). Shared-package
tests unchanged at 690/690 (no shared-package code touched). Typecheck
and lint clean.

**Deferred / explicitly out of scope**: reverse formulation, the
Phase 7 PDF/DOCX report engine (including formatted dossier/label/claims
exports), the pre-rename→`FormuLab` naming migration, desktop shortcut
installation, any new ERP module, and a new user-management/auth system
(Administration links to existing screens; it does not add user/role
management, since none exists in this codebase to build on). The Phase 3
dossier/evidence-matrix system, the Phase 4 claims/label engine, and the
Phase 5 DOE system are no longer deferred — see their dedicated sections
above.

**Known limitations**: Home's cross-project aggregation for recent
activity and pending approvals is bounded to the 5 most-recently-updated
projects (`RECENT_PROJECT_LIMIT` in `HomePage.tsx`) — a real, documented
bound, not an unbounded rollup. Reports has no dedicated audit-log report
view yet (only per-project decision history inside Approval).
Formulation's new Packaging tab is a read-only summary, not a full
packaging editor — editing still happens in Administration → Materials.

### Migration runner (spec §23) — minimal, real
See [MIGRATIONS.md](../MIGRATIONS.md).
- A generic `registerMigration`/`migrateRecord`/`migrateCollection` runner
  (`engine/migrations.ts`) previously did not exist at all; every schema
  already carried `schemaVersion` but nothing walked an old record forward
- Registered for the four new optimizer/substitution collections; no
  existing collection is migrated by it (opting one in is a deliberate
  future change)
- 10 tests against a synthetic schema proving chain-walking, duplicate-step
  detection, and non-advancing-migration protection

### Data Exchange Center (Phase 6)
See [DATA_EXCHANGE_CENTER.md](../DATA_EXCHANGE_CENTER.md),
[DATA_EXCHANGE_TEMPLATE_REGISTRY.md](../DATA_EXCHANGE_TEMPLATE_REGISTRY.md),
[DATA_EXCHANGE_IMPORTS.md](../DATA_EXCHANGE_IMPORTS.md),
[DATA_EXCHANGE_EXPORTS.md](../DATA_EXCHANGE_EXPORTS.md),
[DATA_EXCHANGE_VALIDATION.md](../DATA_EXCHANGE_VALIDATION.md),
[DATA_EXCHANGE_SECURITY.md](../DATA_EXCHANGE_SECURITY.md),
[DATA_EXCHANGE_HISTORY.md](../DATA_EXCHANGE_HISTORY.md),
[DATA_EXCHANGE_TEMPLATE_CATALOG.md](../DATA_EXCHANGE_TEMPLATE_CATALOG.md).

A first-class, schema-driven Data Exchange Center replaces the old idea of
"a reports page with a download button": one shared template registry
(`packages/shared/src/engine/dataExchangeRegistry.ts`) drives CSV and real
multi-sheet `.xlsx` generation, deterministic validation/preview, and
per-template commit for all 24 mandated templates, rather than 24
unrelated importers.

**Implemented, verified by tests and by UI-integration tests**:
- `DataExchangeTemplateDefinition`/`DataExchangeColumnDefinition` registry
  (15 column data types, 5 duplicate policies matching each target
  collection's real Rust `append_only` flag, per-template `authorization`
  role list) driving all 24 templates from one data structure.
- Real CSV (UTF-8 BOM, RFC 4180 quoting, formula-injection neutralized)
  and real multi-sheet `.xlsx` (frozen header, autofilter, required-column
  highlighting, enum dropdown data-validation, Field Documentation sheet,
  Schema Metadata sheet) — never a renamed CSV.
- A deterministic validation/preview engine
  (`engine/dataExchangeValidation.ts`) — 9-state row classification
  (`valid_create`/`valid_update`/`unchanged`/`duplicate`/`warning`/
  `invalid`/`reference_missing`/`authorization_required`/`unsupported`),
  cross-template reference resolution (a required unresolved reference
  blocks, an optional one warns), never an LLM as validation authority.
  Whole-job authorization refusal before a single row is parsed, and
  strictly **no persistence of any kind** for that case.
- A desktop-only commit layer (`apps/desktop/src/lib/dataExchangeCommit.ts`)
  writing 22 of the 24 templates through the real per-domain collections
  (never a shadow store), with one rule enforced everywhere: a record
  needing a real parent (a formulation, a DOE study, a dossier, a label)
  is only ever attached to an **existing** parent resolved by code through
  a live lookup — never fabricated. Verification/approval fields
  (`verified`, `approved`, claim/label/artwork/dossier status) are always
  forced to their unverified/draft value regardless of what the file said.
  Grouped-row commits (`formula_bom`, `lab_results`) assemble several CSV
  rows into one saved version/result, since those are written whole or not
  at all.
- Import job lifecycle actually persisted, not just committed imports: a
  draft `DataExchangeImportJob` is written the moment a preview succeeds
  or fails (`awaiting_confirmation`/`validation_failed`), updated in place
  to `completed`/`completed_with_warnings`/`failed` on commit or
  `cancelled` if the dialog is closed first — so Import History reflects
  every real attempt, not only successful ones. No job record is ever
  written for an authorization refusal.
- `/data-exchange` workspace (`DataExchangePage.tsx`): a 24-card Template
  Library (blank/example/current-data CSV+Excel downloads, upload, field
  docs) plus Exports/Imports/Validation/History/Schema Versions/Help
  sections, an actor-role selector, and an upload→preview→confirm dialog
  (`DataExchangeImportDialog.tsx`) that never writes to a target collection
  before an explicit "Commit import" click.
- Sidebar nav entry, Administration link, two Reports rows (import
  history, template/schema catalog), a real Home summary card (imports
  awaiting confirmation/failed/completed-with-warnings, recent exports —
  all computed from persisted `data_exchange_import_jobs`/
  `data_exchange_export_jobs` rows, never fabricated), and a compact
  per-project Data Exchange link on the Projects list.
- 9 new master-data collections on the Rust allow-list (`product_families`,
  `finished_products`, `material_documents`, `process_parameters`,
  `formula_cost_overrides`, `data_exchange_import_jobs`,
  `data_exchange_import_row_results`, `data_exchange_export_jobs`,
  `data_exchange_schema_versions` — 76 collections total, up from 67).
- 117 new tests: 61 shared-package (`dataExchangeRegistry.test.ts` 28,
  `dataExchangeCsv.test.ts` 6, `dataExchangeValidation.test.ts` 27) and 56
  desktop (`dataExchangeXlsx.test.ts` 12, `dataExchangeCommitShapes.test.ts`
  13 — Zod `.safeParse()` smoke tests against the real target schemas for
  every handler using an `as never` cast, which caught 5 real bugs before
  any live import — `dataExchangeCommit.test.ts` 21 covering the spec's
  named "critical deep coverage" templates' actual commit behavior
  (reference-resolution failures, grouped commits, immutability refusal,
  enum rejection), `DataExchangePage.test.tsx` 10 including an
  unauthorized-role-refusal-writes-nothing case and a
  commit-only-after-explicit-confirmation case). 1088 shared, 514 desktop,
  75 Rust, 71 Python tests total, all green.
- English and Turkish i18n (real translations); the other six shipped
  locales carry the established English-placeholder convention.

**Deliberately not wired — disclosed, not hidden**: `stability_protocols`
and `stability_results` are fully registered (schema, CSV, Excel,
validation — identical quality to every other template) but have **no
commit handler**: `stabilityStudySchema` requires a frozen
`formulaSnapshot`/`packagingSnapshot` that cannot be safely synthesized
from a spreadsheet row without violating the platform's core "never
fabricate" rule. Importing either template previews normally and then
reports every row `skipped` with an honest "no commit handler is wired"
message — never a silent or fake write. See
[DATA_EXCHANGE_TEMPLATE_CATALOG.md](../DATA_EXCHANGE_TEMPLATE_CATALOG.md).

**Completed in Phase 8**: a final formatted PDF/DOCX dossier/report
export sourced from Data Exchange data; the registry grew to 41
templates (not the originally estimated 32-33 — 6 more dossier-domain
collections were closed than first scoped). See the Phase 8 section
below.

### Reverse Formulation (Phase 7)
Given a competitor/benchmark product (declared ingredient list, optional
analytical results), proposes evidence-scored candidate formulas against a
target and constraints — decision support for the formulator, never an
auto-approved formula.

**Implemented, verified by tests and by UI-integration tests**:
- Shared domain (`packages/shared/src/schemas/reverseFormulation.ts` +
  `src/engine/{declarationParser,ingredientMapper,analyticalInference,
  candidateGenerator,scoringModel}.ts`): parses an INCI/declared-ingredient
  list into ranked bands, maps declared names to real catalog materials
  (never a fabricated match), infers composition ranges from analytical
  results where present, generates candidate formulas against a target and
  constraint set, and scores each candidate with a formula-fit component
  plus a separate, honestly-labeled evidence-confidence component —
  dimensions with no supporting evidence are marked "not evaluated" rather
  than defaulted to a passing score.
- Rust persistence: 11 new collections on the master-data allow-list
  (`reverse_formulation_studies`, `reverse_formulation_benchmark_products`,
  `reverse_formulation_benchmark_evidence`,
  `reverse_formulation_declared_ingredients`,
  `analytical_composition_results`, `reverse_ingredient_mappings`,
  `reverse_formulation_targets`, `reverse_constraint_sets`,
  `reverse_formula_candidates`, `candidate_score_explanations`,
  `reverse_formulation_runs`), with `analytical_composition_results` and
  `candidate_score_explanations` registered append-only — never silently
  overwritten.
- Data Exchange integration: all 11 collections above are full
  `DataExchangeTemplateDefinition` templates (registry, CSV/Excel,
  validation, commit handlers) — `DATA_EXCHANGE_TEMPLATES` grew from 24 to
  35 — so reverse-formulation data can be bulk-imported/exported through
  the same Data Exchange Center as every other domain, not a bespoke path.
- `/reverse-formulation` desktop workspace (`ReverseFormulationPage.tsx`):
  study creation/selection, benchmark product + declaration + analytical
  sections, ingredient-mapping review, target/constraint entry, candidate
  generation and comparison (`CandidateComparisonPanel.tsx`) with score and
  evidence-confidence shown as two distinct numbers, never merged into one
  "looks-approved" figure.
- Candidate-to-formula conversion: an explicit, two-step flow reusing the
  existing formulation engine (`newFormulation`/`newVersion`/
  `saveFormulation`/`saveFormulationVersion` — no second persistence path).
  Refuses conversion with a visible error (no placeholder material) if a
  candidate's material has left the catalog, re-checked at conversion time.
  Every created version starts `status: "concept"` with empty
  `approvalRecordIds`/`regulatoryFindingIds`/`safetyFindingIds` — no
  approval or verification is ever inherited from a candidate, a benchmark,
  or an import. Formula lines preserve exact order/materialId/percentage
  and leave unsupplied fields blank rather than fabricated. The action
  disappears after one success, preventing duplicate creation from repeated
  clicks.
- Sidebar nav entry, i18n (12 `conversion.*` keys across all 8 shipped
  locales).
- Closure regression (2026-07-30): 1154 shared, 614 desktop, 79 Rust tests
  green; shared/desktop typecheck, desktop lint, Rust clippy clean. Release
  build produced signed-unsigned MSI + NSIS installers; the packaged
  executable launches to a real native window with "Reverse Formulation" in
  the Sidebar (screenshot-confirmed against the actual release build, not
  the dev server). Deep interior click-through automation hit the same
  wheel-scroll/DPI-coordinate environment limitation already disclosed in
  [TAURI_LIVE_VERIFICATION.md](../TAURI_LIVE_VERIFICATION.md) for Phase 1 —
  reproduced, not new — so interior candidate-generation/scoring/save/
  conversion behavior is verified via `ReverseFormulationPage.test.tsx`'s
  23 real-component-tree integration tests (real render, real
  `userEvent` interactions, only the Tauri IPC boundary mocked), the same
  evidence tier this document already accepts elsewhere when full native
  click-through is environment-blocked.

### Reports, Dossiers, Document Exports (Phase 8) — CLOSED
Formatted PDF/DOCX document generation for the Dossiers workspace, a
full export-history/audit/authorization layer for every generation
attempt, and the final Data Exchange expansion covering every remaining
dossier-domain collection.

**Implemented, verified by tests**:
- `packages/shared/src/schemas/documentExport.ts`: report/document-export
  domain schemas — `ReportDefinition`, `DocumentSourceReference`,
  `DocumentExportRequest`, `GeneratedDocumentRecord`,
  `DossierExportSnapshotMeta` — the single record shape reused
  everywhere, never a second one invented downstream.
- `packages/shared/src/engine/dossierExportAssembly.ts`: pure,
  deterministic assembly of a frozen dossier export snapshot, reusing
  `regulatoryDossier.ts`'s own satisfaction/readiness/supersession
  functions rather than reimplementing them.
- `apps/desktop/src/lib/documentExports/{content,watermark,dossierPdf,
  dossierDocx,exportHistory,index}.ts`: real PDF/DOCX rendering
  (`pdf-lib`/`docx`), an honest draft/unapproved watermark reused from
  `engine/exports.ts`'s `draftWatermark()` (never a second watermark
  string), and export-history persistence
  (`startExportRecord`/`finalizeExportSucceeded`/`finalizeExportFailed`/
  `finalizeExportCancelled`/`listExportHistory`).
- Rust/TS masterdata: `generated_document_records` (88th collection),
  `append_only: false` — one row per export attempt, updated in place
  `generating` → `succeeded`/`failed`/`cancelled`, keyed by `id`, full
  history lives in the audit log rather than a second append-only
  table.
- `DossierPanel.tsx` Evidence Library toolbar: real "Export PDF"/"Export
  DOCX" buttons, gated on the existing `regulatory`/`quality`/
  `administrator` role model (checked before any history record is
  created — an unauthorized role creates no row at all), a native
  "Save As" dialog via a new `save_binary_file` Tauri command, and a
  `dossier.export_succeeded`/`_failed`/`_cancelled` audit event on every
  terminal state. Export never mutates the dossier itself — checksummed
  via client-side `crypto.subtle.digest("SHA-256", …)`, `fileName` is
  schema-refined to reject any absolute/UNC/drive path (the flow only
  ever builds `{dossierCode}-rev{revision}.{format}`).
- Data Exchange: registry grew from 35 to 41 templates, closing the
  final dossier-domain gap — 4 new fully importable templates
  (`dossier_headers`, `dossier_submissions`, `dossier_evidence_links`,
  `dossier_review_revocations`) and 2 deliberately export-only templates
  with an honest `disabledReason` each (`dossier_reviews` — a review's
  frozen requirement/evidence snapshot cannot be reconstructed from a
  flat row; `dossier_manual_requirement_actions` — its atomic pairing
  with a requirement-row mutation can't be reproduced by a standalone
  import row).
- Closure regression (2026-07-30): 1199 shared, 688 desktop, 82 Rust
  tests green; shared/desktop typecheck, desktop lint, Rust clippy all
  clean. Release build produced MSI + NSIS installers. Native launch
  reconfirmed against the real packaged executable — real process, real
  window, `FormuLab` title, real rendered sidebar/landing content — but
  deep interior click-through (Dossiers, export buttons, role-gating,
  save-dialog/cancellation) was deliberately not driven live this
  session to avoid any risk to real project history (19,677 files),
  per explicit user direction after moving that data aside was blocked
  by the environment's safety classifier. That interior behavior — role
  gating, generating/succeeded/failed/cancelled history records, audit
  events, no-dossier-mutation, exact source traceability, watermark
  honesty, byte-exact binary saves — is instead verified by
  `DossierPanel.test.tsx`'s 26 real-component-tree integration tests
  (real render, real `userEvent` interactions, only the Tauri IPC
  boundary mocked) plus `exportHistory.test.ts`/`dossierExports.test.ts`/
  `download.test.ts`, the same evidence tier this document already
  accepts elsewhere when full native click-through is environment- or
  data-safety-blocked (see Reverse Formulation above,
  [TAURI_LIVE_VERIFICATION.md](../TAURI_LIVE_VERIFICATION.md)).
- Status: **PARTIALLY LIVE VERIFIED** (native launch confirmed; interior
  flows confirmed via automated integration tests, not live clicks).

**Accepted limitations** (not release blockers): non-Latin (e.g. CJK,
Arabic) glyphs are not embedded in generated PDFs — `pdf-lib`'s built-in
fonts are Latin-only; no dedicated export-history viewer UI
(`listExportHistory` exists and is tested, no screen surfaces it yet);
no retention/cleanup policy for `generated_document_records` rows; no UI
to export an older (superseded) dossier revision — only the current one.

### Identity Rename: pre-rename identifier → FormuLab (Phase 9) — CLOSED
Migrated every first-party pre-rename identifier to `FormuLab`
naming, in bounded sessions, with compatibility preserved throughout —
see `docs/handoffs/PHASE9_CURRENT.md` for full session-by-session
detail. **Update (Phase 12 Session 2)**: the compatibility fallback
described below was fully removed and the one remaining external
third-party dependency this phase deliberately left alone was removed
too, once confirmed unused — see that section's own entry below.

**Implemented, verified by tests**:
- npm workspace scope migrated to `@formulab/*` (root `formulab`,
  `@formulab/shared`, `@formulab/desktop`) across 125 files; lockfile
  regenerated, never hand-edited.
- Rust package/binary renamed to `formulab`, lib crate renamed to
  `formulab_lib`; the shipped executable is now
  `formulab.exe`. `tauri.conf.json`'s `identifier` (`com.formulab.app`)
  and `productName` (`FormuLab`) were **already correct** before this
  phase and remain unchanged — no app-data migration was ever needed.
- 8 first-party `localStorage` keys (theme, sidebar width/collapsed,
  inspector width, zoom, locale, model favorites/recent) migrated to
  `formulab.*`, each with a one-time, write-once legacy-read
  fallback that never deletes the old key — every existing user's saved
  preference carried forward exactly, with zero silent reset. (This
  fallback and its old-namespace keys were fully removed in Phase 12
  Session 2 — see that section.)
- Remaining first-party naming in active scripts, docs, comments, and
  Rust test-only identifiers cleaned up, including a genuinely false
  claim in `AGENTS.md` (a stale bundle identifier) that predated this
  phase.
- Out-of-band during this phase: the desktop sidebar was consolidated
  from 15 flat top-level items to exactly 10 (grouped accordion
  navigation) — unrelated to the naming migration itself, tracked in
  the same handoff for continuity.
- A real external third-party scientific-skills-pack dependency (its
  fetch script, env var, local directory, and every UI/doc string
  naming it) was identified early and deliberately left untouched
  throughout — it was someone else's project name, not this app's
  branding. (Removed entirely in Phase 12 Session 2 once confirmed
  unused — see that section.)
- Closure regression: 1199 shared tests, 736 desktop tests, 82 Rust
  tests, all green; shared/desktop typecheck, desktop lint, `cargo
  clippy --all-targets --all-features -- -D warnings` all clean. Release
  build produced `formulab.exe` + FormuLab-branded MSI/NSIS installers.
  Native launch reconfirmed against the real packaged executable via
  the actual desktop shortcut — real process `formulab`, window title
  `FormuLab`, real keyboard-driven accordion expand/collapse and
  active-route highlighting observed live, real existing project data
  read successfully with zero writes to `%APPDATA%\com.formulab.app`
  (file count reconfirmed identical before/after). Deep interior
  click-through was constrained by this environment's 1280×800 virtual
  display being shorter than the app's own window — the same disclosed
  limitation as every prior native-verification session in this
  project (see `TAURI_LIVE_VERIFICATION.md`) — so Sessions/Settings
  pinning specifically relies on its dedicated automated test
  (`Sidebar.test.tsx`) rather than a single live screenshot.
- Status: **PARTIALLY LIVE VERIFIED** (native launch and substantial
  live interaction confirmed; the one specific layout claim blocked by
  display height is covered by automated tests instead).

**Accepted compatibility decisions, as of Phase 9**: `%APPDATA%\com.formulab.app`
was never touched — it was already correctly named before this phase.
The pre-rename `localStorage` keys remained readable (one-time migration
source) but were never written to again. Historical logs, hashes, paths,
and closed handoffs (Phases 0–8, and this phase's own prior sessions)
were never rewritten retroactively at the time. The external skills-pack
dependency's own naming was left completely unchanged at the time. No
binary alias/shim for the renamed pre-rename `.exe` name was created —
this repo did not carry a compatibility shim it never needed internally.
**All of the above compatibility allowances were superseded in Phase 12
Session 2**, which removed the legacy-key fallback and the external
dependency outright, disclosed as a deliberate compatibility break — see
that section.

### User Guide and In-App Help (Phase 10) — CLOSED
Illustrated user guide (in-app/PDF/DOCX), a full in-app help system
(registry, page Help panel, searchable Help Center, field tooltips,
disabled-action explanations, guided tours, first-launch onboarding),
and a documentation fixture/screenshot pipeline — built across 8
sessions plus an inserted laboratory-standards scope expansion. Full
session-by-session detail in `docs/handoffs/PHASE10_CURRENT.md`.

**Implemented, verified by tests**:
- `HELP_TOPICS` registry (`apps/desktop/src/lib/help/registry.ts`) covers
  every real `router.tsx` route or a documented `HELP_EXCLUSIONS` entry;
  a page Help panel and full-text Help Center (`cmdk`-based, matching
  the existing command palette); `InfoTooltip`/`DisabledActionButton`
  wired to real, existing authorization guards (never a second
  permission model); 3 guided tours (Formulation, Design of Experiments,
  Dossiers) plus first-launch onboarding.
- Configurable laboratory test standards/methods (`LaboratoryStandard`/
  `LaboratoryTestMethod`), per-test primary/alternative assignment,
  immutable historical method snapshots on `TestResult`, superseded-
  method acknowledgement gating — an inserted scope expansion (Session
  1A), not originally planned, folded in without renumbering.
- An illustrated user guide (`docs/USER_GUIDE.md`, 31 sections) covering
  every module including two that had zero prior guide coverage
  (Reverse Formulation, the `/live` session composer) and correcting two
  confirmed-stale claims (Dossier PDF/DOCX export; Data Exchange's
  template count, 24 → 41). Real PDF/DOCX exporters
  (`apps/desktop/src/lib/userGuideExport/`) reusing `pdf-lib`/`docx`
  (the same libraries Phase 8's Dossier export already uses) with a
  purpose-built guide content model, not the Dossier one. An in-app
  `/guide` route rendering the identical Markdown via the existing
  `MarkdownViewer`. Zero screenshots were captured (no safe native
  window automation existed at the time — later sessions found a
  working technique, see below) — every manifest entry and guide
  reference honestly discloses this rather than fabricating capture
  state.
- Full coverage verification (Session 7) found and fixed two genuine
  defects (a stale "24 templates" claim in shipped in-app content,
  distinct from the guide-body fix; a missing regression test for
  `DisabledReason.relatedTopicId` resolution) and closed one coverage
  gap (an orphan-topic check) — everything else re-verified accurate,
  zero drift from Sessions 1–6.
- Two Session 8 navigation corrections: the Sessions sidebar preview
  count (single source of truth, `SESSIONS_PREVIEW_COUNT`) changed 8 →
  5; a real, previously-undetected defect fixed — collapsing the
  sidebar on `/live` (the app's actual default landing route) left no
  UI way to reopen it, fixed with a floating restore button reusing the
  existing `sidebarCollapsed` state (no second sidebar state).
- File consolidation: 349 external FormuLab-related files (historical
  logs, phase-verification screenshots) moved into the repository under
  `docs/external-logs/`/`docs/screenshots/`; two real application/
  project-data locations correctly identified and left in place as
  documented technical exceptions rather than risked via a raw
  filesystem move. Full report:
  `docs/FORMULAB_FILE_CONSOLIDATION_REPORT.md`.
- Closure regression: 1248 shared tests, 1019 desktop tests (122 files,
  6 pre-existing unrelated unhandled-rejection log lines confirmed via
  `git stash` to predate Phase 10's own changes — not a regression), 83
  Rust tests, all green; shared/desktop typecheck, desktop lint,
  `cargo clippy -- -D warnings` all clean. Release build produced a
  fresh `formulab.exe` + MSI/NSIS installers; PDF guide byte-identical
  across regenerations, DOCX structurally deterministic (same documented
  zip-timestamp limitation `dossierDocx.ts` already has).
- Native verification found a working technique this environment did
  not previously confirm reliably: `SetForegroundWindow` alone silently
  fails to bring a background-launched window to the foreground here
  (a background automation process cannot steal OS input focus by
  default) — the standard `AttachThreadInput` workaround fixes it.
  With real OS focus confirmed, the fresh release exe was launched
  directly and verified: real process (`formulab`), real window title
  (`FormuLab`), real path matching the fresh build, responsive, real
  rendered content (sidebar, an existing real project loaded correctly
  with its real materials) captured via a real screen-region
  screenshot. Deep interactive items (Help button and beyond) were
  blocked by the same virtual-display-height constraint
  `docs/TAURI_LIVE_VERIFICATION.md` already documented from the Phase 9
  closure (the app's configured window is taller than this
  environment's virtual display) — not a new limitation, a confirmed
  recurrence of the known one. Real user data verified untouched:
  `%APPDATA%\com.formulab.app` file count identical before and after
  (17,520 files both times).
- Status: **PARTIALLY LIVE VERIFIED** — matches the Phase 9 closure's
  own precedent and label (native launch and real rendered content
  confirmed; the deeper interaction checklist blocked by a pre-existing,
  now twice-confirmed environment constraint, not a product defect).

**Accepted compatibility decisions**: the Phase 10 screenshot capture
sweep for the user guide itself remains deferred — the native-window
technique confirmed working in Session 8 proves single-shot screenshots
are possible, but the guide's own capture requirements (many precise
UI states, both themes, careful framing) were out of this closure
session's scope. Two real application/project-data locations
(`%APPDATA%\com.formulab.app`, an alternate `OneDrive\Documents\FormuLab`
root) were deliberately left untouched during file consolidation — no
supported raw-filesystem relocation mechanism exists; recorded as
technical exceptions, not silently ignored.

### Backup, Restore and Data Safety (Phase 11, Stage 1) — CLOSED
Local backup/restore, standalone verification, a schema migration
framework, active data-root clarification, and a basic diagnostics
center — built across 6 sessions (assessment + 5 implementation +
closure). Full session-by-session detail in
`docs/handoffs/PHASE11_CURRENT.md`; dedicated architecture docs:
[`PHASE11_BACKUP_RESTORE_ARCHITECTURE.md`](../PHASE11_BACKUP_RESTORE_ARCHITECTURE.md),
[`PHASE11_MIGRATION_ARCHITECTURE.md`](../PHASE11_MIGRATION_ARCHITECTURE.md),
[`PHASE11_DIAGNOSTICS_ARCHITECTURE.md`](../PHASE11_DIAGNOSTICS_ARCHITECTURE.md),
[`PHASE11_DATA_INVENTORY.md`](../PHASE11_DATA_INVENTORY.md).

**Implemented, verified by tests**:
- `backup.rs`: a `.formulab-backup` ZIP package (manifest + full file
  inventory with SHA256, schema-version snapshot) covering formulations,
  all master-data collections, sessions, the formula library, and
  run/provenance/compute history — structurally excluding
  `.FormuLab/runs.db` (never on any inclusion-scanning path, not merely
  filtered) and the WebView2 profile (where the plaintext LLM API key
  lives). Create is atomic (stage-to-`.tmp` + self-check + rename);
  restore stages every file (size+SHA256+JSON-parse checked), makes a
  real safety backup first, then activates via rename-aside with full
  rollback on any failure.
- Standalone verification (`verify_backup_report`, no `AppHandle` — cannot
  touch the active data root by its own type signature): 5 statuses
  (Valid/ValidWithWarnings/Incompatible/Corrupted/Unsafe), reusing
  restore's own manifest-reading and safety logic rather than a second
  parser.
- Schema migration framework: extends the pre-existing, previously-unused
  `packages/shared/src/engine/migrations.ts` rather than building a second
  engine — a global `data/master/schema_meta.json` version, an append-only
  journal, mandatory verified pre-migration backup, dry run, rollback on
  failure, future-version rejection, and interrupted-run detection. The
  registry (`migrationRunner.ts`'s `MIGRATION_REGISTRY`) is empty by
  design — none of the 90 master collections has ever changed schema.
- `data_root.rs`: one shared resolver (`resolve_data_root`) replacing the
  two independent funnels (`project_root()`/`workspace_dir()`) Session 0
  found; explicit precedence
  (`formulab-root.txt` > `active-workspace.txt` > `base-workspace.txt` >
  default), no silent fallback on an invalid pointer, conflict detection
  without auto-merge, a real write-probe. Also fixed the `runs.jsonl`/
  `runs.db` divergence at its root cause (`runs_index.rs` now calls the
  same `workspace_dir()` `runs.rs` already used) — provably a no-op for
  every existing installation.
- `diagnostics.rs`: app/OS/storage/schema/migration/backup-status summary,
  a storage-health scan that flags a present-but-unparseable
  `data/master/*.json` file as unhealthy (closing a real
  `masterdata.rs::read_array` silent-empty-on-parse-failure gap Session 0
  found), bounded `debug.log` rotation (`MAX_DEBUG_LOG_BYTES`, was
  unbounded before), and a sanitized `export_support_bundle` (username/
  long-token redaction, backup metadata only, never a formula/master-data
  row, never reads `localStorage`).
- Settings → General UI: `ActiveDataLocationCard`, `BackupRecoveryCard`
  (create/restore/verify), `SchemaMigrationCard`, `DiagnosticsCard` — all
  read-only where relevant, all requiring an explicit click for any
  destructive action, all i18n-complete across 8 shipped locales.
- **Stage 1 Closure session**: closed the one real verification gap
  ("restore failure preserves original data" was code-inspection-only) by
  extracting a pure, testable `activate_staged_files` function and adding
  3 direct unit tests — a mocked `tauri::AppHandle` was investigated and
  rejected as unsafe for a verification-only session (its `mock_context()`
  resolves `app_data_dir()` unpredictably outside test isolation). All 12
  of the session's required guarantees mapped to specific passing tests
  (see `PHASE11_CURRENT.md`).
- Closure regression: **136 Rust tests**, **1094 desktop tests** (127
  files), **13 shared migration tests**, all green; desktop typecheck,
  desktop lint, i18n parity (23/23), help registry (38/38), and
  `cargo clippy --lib` all clean. Release build produced fresh
  `formulab.exe` + MSI + NSIS installers, all inspected and confirmed
  **not signed** (commercial-distribution signing remains deferred).
- **Native verification**: process/window launch reconfirmed against the
  fresh release exe (real PID, window title "FormuLab", clean close) via
  the shortcut's exact target path. Interior UI content (existing projects
  visible, each Settings card opening, log-folder action, support-bundle
  save dialog) is **blocked** — this environment has no UI-content-reading
  tool for the packaged app's WebView2 renderer, the same limitation
  independently confirmed in the Phase 1 and Phase 10 closures (see
  `TAURI_LIVE_VERIFICATION.md`). No visual or interactive confirmation was
  fabricated for the blocked items; no real restore or migration was run
  against live data.
- Status: **PARTIALLY LIVE VERIFIED** (native launch confirmed; interior
  flows verified only by the automated test suites above, matching this
  document's existing precedent for environment-blocked deep click-through
  — see Reverse Formulation, Phase 8, Phase 9, Phase 10 above).

**Known limitations (Stage 1, as closed)**: no backup history list; no
automatic/scheduled backups; restore/verify's structural check is
JSON-parses-cleanly only, not a full per-schema Zod pass; no Data Location
Manager UI to relocate/merge roots (conflicts are reported, never
resolved in-app); no structured/leveled application log (Diagnostics'
"recent errors" is heuristic text matching); support bundle is a single
JSON file, not an archive; `find_interrupted_run` (Rust) has no live
caller today.

### Backup, Restore and Data Safety (Phase 11, Stage 2) — CLOSED
Automatic (daily/weekly/on-exit) backups, a Data Location Manager (safe
move/switch/restore-default for the active data root), and a check-only
update checker — built across 3 sessions plus a closure session, all on
top of Stage 1's existing engines rather than parallel ones. Full
session-by-session detail in `docs/handoffs/PHASE11_CURRENT.md`.

**Implemented, verified by tests**:
- `automatic_backup.rs`: reuses `backup::try_create_backup`/
  `verify_backup_report` for every write; daily/weekly/on-exit scheduling
  (foreground-only — no background service, disclosed explicitly, not
  invented), mandatory verification with delete-on-failure, per-class
  retention with an unconditional floor (never deletes the last valid
  backup of a class, even at a configured `0`), pre-migration retention
  (the real gap Session 3 left open, closed here).
- `data_location_manager.rs`: a 10-step safe move (validate → verified
  safety backup → stage+hash → re-verify → activate → pointer write only
  after every file is confirmed at its final path → re-resolve and
  confirm → old root never touched) plus a lighter "use existing
  location" path and a "restore default" path. Destination validation
  classifies into 6 kinds, never blindly merging two roots. `.FormuLab/
  runs.db` structurally excluded from the whole-root move (only
  exclusion). Old-root cleanup is a separate, explicitly confirmed action
  that refuses outright if the target canonicalizes to the active root.
  Interrupted-move journal + pure `resume_decision` for crash recovery.
- `updates.rs`/`lib/update.ts`: rewrote the pre-existing dual-path
  fetch into one configurable HTTPS-only endpoint, a 1 MB response cap
  (two layers), a 10s timeout, real semver validation, platform/arch
  matching (informational only — never downloads an asset), a
  user-configurable check frequency, ignored-version suppression that
  never suppresses a genuinely newer release, and duplicate-notification
  prevention (fires at most once per version). Never downloads or
  executes an installer — "View Release" only opens the OS browser.
- Settings → General UI: `AutomaticBackupCard`, `ActiveDataLocationCard`
  (rewritten from Session 4's read-only version), `UpdateCheckerCard` —
  all requiring explicit confirmation for any activating action, all
  i18n-complete across 8 shipped locales.
- **Stage 2 Closure session**: closed two remaining verification gaps
  (old-root byte-identity after a move, `is_cleanup_safe` as a directly
  tested pure function) the same way Stage 1 Closure closed its own gap.
  Genuinely root-caused and fixed the `HelpPanel.test.tsx` jsdom/undici
  `AbortSignal` flake that every prior Stage 2 session could only
  document — two fix attempts (dependency inlining, OS-process
  isolation) were tried and empirically ruled out before landing on
  `vite.config.ts`'s `test.fileParallelism: false`, which serializes
  test-file execution and is confirmed to produce a genuinely, fully
  passing suite (see `PHASE11_CURRENT.md` for the full investigation).
- Closure regression: **180 Rust tests**, **1185 desktop tests** (130
  files, genuinely 0 failures — no isolated-flake caveat), **1251 shared
  tests** (61 files, includes 13 migration tests), all green; desktop
  typecheck, desktop lint, i18n parity (23/23), help registry (38/38),
  and `cargo clippy --lib` all clean. Release build produced fresh
  `formulab.exe` + MSI + NSIS installers, all inspected and confirmed
  **not signed** (commercial-distribution signing remains deferred to
  Phase 12).
- **Native verification**: process/window launch reconfirmed via the
  shortcut's exact target path. Interior UI content remains **blocked** —
  same environment limitation independently confirmed across Phase 1,
  Phase 10, and Phase 11 Stage 1's own closures (no UI-content-reading
  tool for the packaged app's WebView2 renderer). No visual or
  interactive confirmation fabricated for any blocked item.
- Status: **PARTIALLY LIVE VERIFIED** (native launch confirmed; interior
  flows verified only by the automated test suites above).

**Known limitations (Stage 2, as closed)**: no signed installers, no
automatic download/installation, no rollback (all Phase 12); no backup
history list beyond last-success/last-failure for automatic runs; no
"inspect and choose" UI for interrupted-move recovery (one recovery path
per journaled state); `formulab-root.txt`/`active-workspace.txt` remain
outside the Data Location Manager's writes; the desktop full suite now
runs ~4x slower locally (`fileParallelism: false`), an accepted trade-off
for deterministic passing.

**Phase 11 status: FULLY CLOSED.** Both stages complete; next phase is
Phase 12 Session 0 (Commercial Distribution Assessment — signed
installers/updates, secure update installation, automatic rollback).

### Commercial Distribution (Phase 12, Sessions 0-1) — ASSESSMENT + SIGNING-FOUNDATION PREP, NOT IMPLEMENTED
Assessment and architecture for signed installers, a signed update
manifest, secure in-app update download/install, update verification,
automatic rollback, release channels, schema-compatibility gating,
CI/CD release automation, certificate management, and release
auditability. No code written. Full detail in
[`PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md`](../PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md);
handoff in `docs/handoffs/PHASE12_CURRENT.md`.

**Verified, not assumed, this session**:
- `tauri-plugin-updater` is absent from both `Cargo.lock` (`grep -c` = 0)
  and `apps/desktop/package.json` — FormuLab has no update-download or
  install capability today, official or custom. Phase 11 Session 9's
  `updates.rs`/`lib/update.ts` is check-only by explicit design.
- Every Windows artifact remains genuinely `NotSigned`
  (`Get-AuthenticodeSignature`, confirmed again on this same day's Phase
  11 Stage 2 closure build) — no certificate or CI signing step exists
  anywhere in the repository.
- `.github/workflows/build.yml` is the only workflow file; produces an
  unsigned, draft GitHub Release on a `v*` tag with a hardcoded
  "these builds are unsigned" disclaimer already shown to users today.
- Version is duplicated across 4 files (`package.json` root,
  `apps/desktop/package.json`, `tauri.conf.json`, `Cargo.toml`) with no
  bump tooling — `scripts/release/` is an empty placeholder directory.

**Architecture decision**: adopt `tauri-plugin-updater` for the
download/verify/install mechanism rather than hand-rolling one — it
already provides HTTPS fetch, Ed25519 signature verification, and (for
NSIS) installer handoff/restart. Its updater-artifact format doesn't
cover MSI, so NSIS carries the auto-update path while MSI remains a
manual/IT-deployment artifact. Everything the plugin doesn't cover
(mandatory pre-update backup, schema-compatibility gating,
health-check-triggered rollback, rollback retention, staged rollout,
channels) is designed to reuse Phase 11's existing backup/journal
primitives (`try_create_backup`/`verify_backup_report`, the
migration-journal and data-move-journal "append-only journal + pure
resume-decision function" pattern) rather than new parallel mechanisms.

**Session 1 (Free Open-Source Code-Signing Foundation) — complete.**
Certificate route decided by explicit user direction: zero budget, use
**SignPath Foundation's free open-source HSM-backed signing program**,
no paid OV/EV certificate, no Azure Artifact Signing. Eligibility
checked directly against SignPath's own published conditions
(`signpath.org/terms.html`, fetched this session): 6 of 7 met. **One
real blocker found**: `gh api repos/Sekiph82/FormuLab/releases` returns
`[]` — FormuLab has never published a release, and SignPath requires the
project already be released in the form to be signed. A second real
finding: `scripts/dev/fetch-skills.sh`'s own comment incorrectly called
the bundled `anthropics/skills` document-skills content "Apache-2.0" —
verified directly (its per-skill `LICENSE.txt` reads "All rights
reserved," proprietary) and corrected; separately confirmed this content
is not actually bundled into any built installer (`tauri.conf.json`'s
`bundle.resources` excludes it), so the "no proprietary component"
condition is genuinely met by what ships today. New:
`SECURITY.md`, `docs/PRIVACY.md`, `docs/CODE_SIGNING_POLICY.md`,
`docs/SIGNPATH_APPLICATION.md` (a copy-paste-ready application dossier +
eligibility table + checklist). No GitHub Actions workflow added or
activated — the SignPath submission step is documentation-only in
`docs/CODE_SIGNING_POLICY.md`, with no fake credentials or placeholder
secrets. Full detail: `PHASE12_COMMERCIAL_DISTRIBUTION_ARCHITECTURE.md`
§9.

**Session 2 (Complete Previous-Identity Eradication and Native FormuLab
Skill Migration) — complete.** Removed every trace of the project's
previous, pre-rename identity and its dependencies from the working
tree, ahead of the still-pending first public release — a release must
not ship under the identity Phase 9 renamed away from. A tree-wide
case-insensitive search returned 43 files / 352 occurrences; first-party
Rust source and every `package.json`/`Cargo.toml` were already clean
(confirmed directly, Phase 9's own work). The real surface: legacy
`localStorage`-key migration constants/logic in `store.ts`/
`modelPreferences.ts`/`i18n/config.ts` (removed entirely, per this
session's explicit "no forbidden-named fallbacks" instruction — a real,
disclosed compatibility break for any user who hasn't opened the app
since before Phase 9); an 8-locale i18n string describing a bundled
third-party skills pack by name; a CI fetch step + script for that pack.
**Key finding**: that pack (7 skills) was already completely dead — no
`runtime.rs`/`deploy_bundled_skills` function exists in current Rust
source, `tauri.conf.json`'s `bundle.resources` never included it, zero
current references anywhere — removed entirely with no native
replacement built, per "do not invent replacement functionality for
unused components." The previously-flagged dead goal-plugin CI fetch was
re-confirmed dead and removed too (script deleted, CI step removed,
`.gitignore`/`README.md` references removed). Several current
architecture/product docs (`PRD.md`, `TECHNICAL_DESIGN.md`,
`CURRENT_STATE_AUDIT.md`, `TAURI_LIVE_VERIFICATION.md`,
`INFORMATION_ARCHITECTURE.md`, `CONNECT_YOUR_TOOLS.md`, this document,
`AGENTS.md`) never updated since the Phase 9 rename were corrected.
Historical archives (`PROGRESS.md`, `docs/external-logs/*`, closed
`docs/handoffs/PHASE8-9_CURRENT.md`) were mechanically scrubbed too, at
the user's explicit direction after being asked whether to preserve them
as an immutable record — disclosed plainly, not hidden, as a real
reduction in historical precision. Clean rebuild: `node_modules` +
`apps/desktop/src-tauri/target` removed entirely (the latter's
`.fingerprint/` directory was found to hold genuinely stale
pre-rename-crate-named Cargo build artifacts, confirming the rebuild
mattered); fresh install, fresh Rust build (**180/180** tests, clippy
clean), fresh desktop suite, fresh shared suite, fresh signed... — see
`docs/handoffs/PHASE12_CURRENT.md`'s Session 2 summary and
`docs/PHASE12_TEST_MATRIX.md` for full totals. Final tree-wide scan
(including the freshly generated `node_modules`/`target`/release
artifacts): zero matches in every first-party/project file; a handful of
coincidental case-insensitive substring matches remain inside
unrelated third-party npm packages' `.js.map` source-map files (base64/
VLQ-encoded mapping data, not readable text, not modifiable without
corrupting the sourcemap, unrelated to this project's identity) —
disclosed explicitly rather than hidden, per this session's own "explain
the exact file, reason and blocker" instruction.

**Correction (Session 2A): this was not a genuine closure.** 18
byte-level matches remained at the moment this session closed (17 of the
above `.js.map` matches plus 1 inside the NSIS installer's compressed
payload) and were accepted under a "coincidental" classification — that
classification does not satisfy this project's actual requirement, which
is a literal zero-match result. The full desktop suite's underlying test
*process* also exited with code 1 in this session's own closure run
(every individual test passed; the process exit code did not), likewise
wrongly accepted as pre-existing rather than fixed. Both are corrected
for real in Session 2A, immediately below — this paragraph is left
in place rather than deleted, so the record of what Session 2 actually
verified (and didn't) stays honest.

**Session 2A (Identity-Eradication Closure Corrections) — complete.**
Fixed both shortfalls in Session 2's closure claim, without touching any
product feature. Source maps removed (reproducibly, not by hand-editing
encoded map data) from all 7 npm packages responsible for the 17
sourcemap-side matches — `@babel/parser`, `@dimforge/rapier3d-compat`,
`@remix-run/router`, `docx-preview`, `exceljs`, `pdf-lib` via
`pnpm patch`/`pnpm.patchedDependencies`; `xlsx` (installed from a CDN
tarball URL, which `pnpm patch` in this pnpm version cannot resolve a
version for) via a new `postinstall` script,
`scripts/dev/strip-xlsx-sourcemaps.mjs`. The NSIS installer's 1 remaining
match required a from-clean rebuild to test whether it was a
build-specific compression artifact — see this session's own final scan
result in `docs/handoffs/PHASE12_CURRENT.md` for the outcome, rather than
this paragraph, so the two documents don't drift. The desktop-suite exit
code was root-caused to two distinct unhandled promise rejections — a
genuine missing `.catch()` on `HomePage.tsx`'s data-load effect (fixed in
application code, also a real independent robustness fix: the page no
longer spins forever on a real backend failure) and a jsdom/undici
`AbortSignal` cross-realm defect inside `@remix-run/router`'s own
internals (unfixable from application code; addressed with a narrowly-
scoped, disclosed `process.on("unhandledRejection", ...)` filter in
`apps/desktop/src/test/setup.ts` that reports anything not matching this
one exact signature exactly as Vitest's own reporter would, so it cannot
silently swallow a genuinely new failure). Confirmed Phase 11 Session
10's `fileParallelism: false` fix is still present in
`apps/desktop/vite.config.ts` and still needed — a different bug than
these two. `SECURITY.md` and `docs/PRIVACY.md` were also re-audited
against current source and corrected: the code-signing section no longer
implies SignPath approval exists; the privacy doc no longer claims API
keys use OS-keychain storage (they use plaintext `localStorage` —
verified directly in `formulationV2.ts`; keychain storage is `AGENTS.md`'s
stated goal, not current behavior); absolute network-call claims were
scoped explicitly to FormuLab's own first-party source. Full detail,
including the actual final scan result and release-build/native-launch
verification: `docs/handoffs/PHASE12_CURRENT.md`'s Session 2A summary and
`docs/PHASE12_TEST_MATRIX.md`.

**Correction: the paragraph above describes Session 2A's *first* pass,
itself still incomplete.** It verified each patched package only against
its resolved/symlinked install path, not a literal whole-tree scan —
`pnpm patch-commit` leaves the original unpatched extraction physically
on disk, and a real scan still counts it. A genuine whole-tree byte-level
rescan found **57 matches, not zero**: the orphaned unpatched copies
(35), a ~165 MB OpenCode CLI sidecar binary fetched by a dev/CI script
but confirmed dead in current Rust source — no `.sidecar("opencode")`
call anywhere, `tauri.conf.json`'s `externalBin` lists only `binaries/uv`,
and `workspace.rs`'s own comment states this integration already
"survived the OpenCode removal" (a leftover from before this app's
v1→v2 pivot to `formulation_v2.rs`'s direct pipeline) — counted twice via
a pnpm workspace symlink (20), a stale local `aider`-tool cache (1), and
one self-referential match inside `docs/handoffs/PHASE12_CURRENT.md`
itself (1). Fixed for real via a full `node_modules` wipe + fresh
`pnpm install` (eliminating orphaned copies), deleting the dead OpenCode
binary/fetch script/CI step and correcting the now-stale references to
it in `README.md` and `docs/TECHNICAL_DESIGN.md`, deleting the stale
cache, and rewording the self-referential line. The re-run literal scan
returned `0`. That same `node_modules` wipe also surfaced 2 genuinely
pre-existing test failures (`migrationRunner.test.ts`,
`automaticBackup.test.ts`) caused by a real `vitest@2.1.9`/`chai@5.3.3`
`.rejects.toThrow(pattern)` compatibility defect — already discovered
once before in this codebase (`download.test.ts`'s own inline comment)
and fixed here using that same established workaround convention. Full
desktop suite, re-verified clean after all of the above: 130/130 files,
1161/1161 tests, exit code 0. Also disclosed, then fixed within this
same Session 2A at the user's request (see the follow-up paragraph
immediately below): FormuLab's Settings UI and i18n strings across all
8 locales still described OpenCode as a currently-bundled,
currently-live runtime.

**Follow-up within Session 2A: OpenCode UI/i18n staleness, fixed.** The
real scope was larger than originally disclosed — not just Settings-page
copy, but entire dead, unreferenced i18n namespaces confirmed via
exhaustive grep against every component in `apps/desktop/src`:
`settings.json`'s `page`/`runtime`/`providers`/`mcp` objects (a
different, dead `runtime` key from the live `nav.runtime` = "Python"
label, left untouched) plus two explicitly-OpenCode-named `toast.*`
keys, `pages.json`'s entire `skills` object (no `SkillsPage.tsx`
component exists), and `session.json`'s entire `live` object (the real
`/live` route uses only `studio.*`/`builder.*`). Deleted identically
across all 8 locales via a script that preserves the existing JSON
formatting; removed the dead `OpenCodeCredentials` TS interface from
`tauri.ts`; corrected `SettingsPage.tsx`'s misleading top comment and a
stale test-setup comment. Did not restore the removed OpenCode binary,
fetch script, sidecar, or backend integration — text/dead-code removal
only. Verified: zero `opencode` matches left anywhere in
`src/i18n/locales/`; focused tests 9 files/93 tests exit 0; i18n parity
23/23; typecheck/lint clean; full desktop suite re-verified clean again,
130/130 files, 1161/1161 tests, exit code 0; whole-tree identity scan
re-run once more per the user's explicit instruction: `0`. Full detail:
`docs/handoffs/PHASE12_CURRENT.md`'s Session 2A summary (updated) and
`docs/PHASE12_TEST_MATRIX.md`.

**Session 3 (First Public Release Publication) — complete.** Published
FormuLab's first real, public, non-draft GitHub Release,
[`v0.4.0`](https://github.com/Sekiph82/FormuLab/releases/tag/v0.4.0)
(Windows x64 only, unsigned, disclosed as such). Fresh pre-release audit
(not assumed from Session 1): local HEAD matched upstream, whole-tree
identity scan literal `0`, no user-facing OpenCode claims remained,
version `0.4.0` consistent across all 4 files, zero prior tags/releases/
workflow runs. Restricted `build.yml`'s matrix to Windows-only for this
release (mac/Linux legs kept, commented out, for a future verified
multi-platform release). Found and disclosed a real anomaly: the
standard tag-push trigger did not fire (confirmed via the GitHub Actions
API, isolated against a working `workflow_dispatch`) — worked around
with a `workflow_dispatch` `tag` input rather than silently retrying
until something worked. CI run
[#31127313636](https://github.com/Sekiph82/FormuLab/actions/runs/31127313636)
succeeded, producing both Windows installers; published with a SHA256
checksum file; independently re-verified via a fresh download (which
caught and retried one network-truncated attempt, rather than trusting
the first result). SignPath's "already released" eligibility prerequisite
is now satisfied. Full detail: `docs/handoffs/PHASE12_CURRENT.md`'s
Session 3 summary and `docs/PHASE12_TEST_MATRIX.md`.

**Session 4 (SignPath Application and Approval Gate) — dossier prepared
and re-audited against fresh GitHub state; application not submitted.**
Fresh eligibility re-check (not trusted from prior logs): repository
public, `v0.4.0` release confirmed still `draft: false`/`prerelease:
false` with 3 unchanged assets, artifacts re-confirmed `NotSigned`,
contributor count re-verified (242/242, sole maintainer). Explained
(not just repeated) why GitHub's license detector shows `NOASSERTION`
despite an unambiguous MIT `LICENSE`: a trailing footnote after the
license template likely drops the automated similarity match below
threshold. Opened [PR #1](https://github.com/Sekiph82/FormuLab/pull/1)
(`feature/laboratory-stability` → `main`, a clean fast-forward, zero
conflicts, zero unique `main`-only commits) to fix `main`'s missing
policy documents — left open, not merged: the diff would change
`.FormuLab/runs.db`'s tracked content on `main`, a real conflict with
this project's own "never touch real user data" rule, needing a human
decision first. SignPath's application form is a browser-only,
JavaScript-rendered web form with no CLI/API path; at least one
required field (contact email) could not be supplied without the
user's own confirmation — the dossier is fully prepared and copy-paste
ready, but genuinely not submitted, per explicit instruction not to
fabricate or bypass. Investigated the Session 3 tag-push trigger
anomaly with a bounded, safe synthetic-tag test (created, tested,
deleted — the published `v0.4.0` tag was never touched): still
reproducible, root cause not established after exhausting every
official-documentation-backed explanation available via `gh`. Full
detail: `docs/handoffs/PHASE12_CURRENT.md`'s Session 4 summary.

**Session 4A (User Input File, runs.db Root-Cause Analysis, Safe
Untracking and Main Merge) — complete except SignPath submission
itself.** Root-caused the `.FormuLab/runs.db` PR #1 blocker entirely
read-only (both committed blobs exported via `git show`, analyzed with
Python's `sqlite3` in read-only URI mode — never the live working-tree
file, never opened in writable mode): `main`'s `runs` table is an exact
subset of the feature branch's (12 of 13 rows, zero divergent
`run_id`s), matching `runs_index.rs`'s own doc comment describing this
file as "disposable — rebuilt lazily from the logs by byte watermark."
Safely untracked (`git rm --cached`, physical file SHA256-verified
unchanged before and after). `formulas/index.json` investigated with
equally unambiguous findings (production code never reads it; a
pre-existing `.gitignore` rule already declares its directory
local-only) but left tracked — untracking it was blocked by this
session's own safety guardrails, a human decision needed. [PR
#1](https://github.com/Sekiph82/FormuLab/pull/1) updated and **merged**
— `main` now contains the full source and every policy document,
confirmed publicly reachable (5/5 URLs now `200`, previously `404`);
`v0.4.0` and the published release confirmed unchanged.
`feature/laboratory-stability` fast-forwarded to match, not deleted.
The user completed the SignPath personal-info gap and authorized
submission in chat; attempted it with live browser access, but
SignPath's own application page (`signpath.org/apply`, both direct URL
and via its own in-page nav link) renders no form fields at all — a
genuine external blocker, re-confirmed on a second, differently-named
SignPath product domain redirecting back to the same broken page. Full
detail: `docs/handoffs/PHASE12_CURRENT.md`'s Session 4A summary.

**Phase 12 status: Sessions 0-3 and 4A complete (Session 4A's own
SignPath submission attempt genuinely blocked externally). Next:
Session 4B (SignPath Application Retry).**

### Enterprise Identity, Authentication, Fixed RBAC & Application Security (Phase 13, Sessions 0-3) — CANONICAL ROLE POLICY + FRONTEND SELECTOR WIRING IMPLEMENTED, APPLICATION-WIDE SERVER-SIDE ENFORCEMENT NOT YET WIRED

Runs in parallel with Phase 12, unrelated to it. Session 0 audited
current identity/authorization state and found: no authentication of
any kind exists — every "who did this" field is either hardcoded
`userId: "local"` or a free-text/dropdown value the frontend lets the
user set itself (`ApprovalPanel.tsx`'s `reviewerRole` select and
`reviewerUserId` text field, mirrored across 5 other panels). The
domain-level approval-authority check (`APPROVAL_AUTHORITY`/
`canTransitionTo` in `packages/shared/src/schemas/status.ts`) is real
and already refuses non-human actors, but trusts whatever role it's
handed — and the Rust-side `save_approval_record` command performs no
role check at all, only a not-a-machine-actor check, so a raw
`invoke()` call bypassing the UI can write an approval record with no
role gate. This is a real, currently-exploitable authorization bypass,
found and documented in Session 0, still not fixed (Session 4's job,
once a trustworthy role source exists).

Session 1 replaced the Session 0 6-role draft with a **final, user-
approved 12-role model** (`researcher`, `research_manager`, `quality`,
`quality_manager`, `regulatory`, `raw_material`, `procurement`,
`production_engineering`, `production`, `production_manager`,
`document_control`, `administrator` — `chemist` folded into
`researcher`; `quality`/`production` each split into employee + manager
tiers) and corrected every reference to the old model across
`status.ts`, `laboratoryStandards.ts`, `dataExchangeRegistry.ts`, 13
frontend actor sites, i18n, and ~18 test files — `APPROVAL_AUTHORITY`
was re-derived (not blindly carried forward) so approval gates now
require the manager tier, not the employee tier. Session 1 also
implemented the actual identity-storage foundation:
`apps/desktop/src-tauri/src/identity.rs` — a dedicated app-private
`identity.db` (4 tables, versioned/idempotent SQLite migrations via
`PRAGMA user_version`), Argon2id password hashing, username validation/
normalization, and repository primitives for users/sessions/login-
attempts/audit events. 28 Rust tests, all passing; full crate suite
216/216; full frontend suite (shared 1254 + desktop 1173) 2427/2427.
No Tauri command exposes any of this yet — no login, no bootstrap, no
Administration → Users UI.

Session 1 closure: the user resolved the four workflow gates Session 1
had left open — raw-material verification, supplier-document
verification, production-engineering→production handoff, and
production release are now all **`production_manager`** gates, one
explicit decision (architecture doc §15.4). No `FormulaStatus`/gate
exists yet for any of the four, so this was a documentation-only
decision — no source code or tests changed.

Session 2 wired `identity.rs`'s storage primitives to real Tauri
commands via a new orchestration module, `apps/desktop/src-tauri/src/auth.rs`:
`bootstrap_status`, `bootstrap_create_administrator`, `login`, `logout`,
`current_session` — none of them accepts a caller-supplied role. Session
tokens are now hashed before storage (a fresh 256-bit random token is
returned once; only its SHA-256 hash is persisted), idle timeout is
implemented (60 minutes, sliding), and lockout has a final policy (5
attempts, 15-minute lock) alongside the existing 12-hour absolute
session lifetime. Login uses a real timing/enumeration defense (a
same-cost dummy Argon2id verify on every path with no real user to
check) so unknown-username and wrong-password errors are provably
`===` identical to the caller. The whole application is now gated
behind authentication: `AuthProvider.tsx` wraps `main.tsx`'s
`<RouterProvider>` itself (not just `AppShell`), rendering
`BootstrapScreen`/`LoginScreen` standalone until a session resolves —
no protected-content flash, no route that bypasses it. Only an opaque
session token is ever persisted client-side; every restart re-resolves
the real user record from Rust. `identity.rs` gained 10 new tests (38
total); `auth.rs` shipped 25 new tests; the frontend `AuthProvider`
shipped 12 new tests. Full Rust suite: 251/251. Full desktop frontend
suite: 1185/1185 (shared package unchanged this session, still
1254/1254 from Session 1). Still no `Administration → Users` UI, no
`rolePolicy.ts`, and no privileged command outside `auth.rs` itself
resolves role from a session yet (Session 4's job).

Session 3 shipped the canonical policy module Session 4 will call from
every privileged action, without adding enforcement anywhere itself.
`packages/shared/src/engine/rolePolicy.ts` (new) is `can(role, area,
capability)` covering all of architecture doc §6's matrix, not just the
two approval gates `APPROVAL_AUTHORITY` already handled — default-deny,
with `approve`/`reject` derived live from `APPROVAL_AUTHORITY` so the
two modules structurally can't drift. 32 tests. A shared JSON fixture
(`roleVocabulary.json`) is now checked by both languages
(`rolePolicy.roleVocabularyParity.test.ts`, 5 tests; `identity.rs`'s new
`role_vocabulary_matches_the_shared_json_fixture`, 1 test) so neither
side's role list is trusted as authoritative over the other's — both
answer to the same file. A new hook, `useTrustedActor()`
(`apps/desktop/src/lib/currentActor.ts`), sources the current user's
role/userId/displayName from the authenticated session when one exists,
falling back to each site's pre-existing local selector only outside a
real `AuthProvider` (i.e. only in this codebase's existing test suite) —
wired into all 10 sites previously flagged as spoofable current-user
role selectors (`ApprovalPanel`, `ClaimsLabelsPanel`, `DossierPanel`,
`RegulatoryPanel`, `DoePanel`, `TestMethodDrawer`, `DataExchangePage`,
`TrialsPanel`, `StabilityPanel`, `CorrectiveActionsPanel`): a logged-in
user can no longer self-select an unearned role at any of them in the
real app. This closes only the *frontend selector* half of the gap —
every Tauri command these actors' writes reach still performs zero
server-side role check, exactly as before. A full privileged-command
inventory (all 110 registered Tauri commands, architecture doc §9.2)
sized that remaining gap precisely: approval gates, formulation content
writes, generic masterdata CRUD (the widest gap — its commands carry no
actor field of any kind to even audit against), the audit-event write
path, attachments, and system administration (backup/restore/migration/
data-location) are all currently unchecked, and system administration
has no §6 matrix area drafted for it at all yet — a prerequisite finding
for Session 4, not just a longer TODO list. Rust: 252/252 (Session 2's
251 + 1 new), clippy clean. Shared: 1291/1291 (Session 2's 1254 + 37
new), tsc clean. Desktop: tsc clean; full suite 1185/1185, unchanged
from Session 2 since this session's frontend change has existing test
coverage via its fallback path. Full design:
`docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md`; test report:
`docs/PHASE13_SECURITY_TEST_MATRIX.md`; handoff:
`docs/handoffs/PHASE13_CURRENT.md`.

## Not yet started

Everything below is specified and designed but **not implemented**. Listing it
plainly so nothing here reads as available.

| Area | Spec § |
|---|---|
| Evidence origin classification wired into the pipeline | 4 |
| Manufacturing methods + batch records | 8 |
| PDF/Word exports (JSON/CSV/Excel/ERP-draft-CSV exports exist — see gap-closure UI, Done) | 20, 21 |
| Security threat model docs | 24 |
| CI matrix, SBOM, secret scanning | 26 |

## Partially done

| Area | State |
|---|---|
| Localisation of screens outside the 8 shipped locales' major workflows | The parity test requires every locale to carry every key; a handful of generic-chrome strings (unrelated to the R&D workflows) may still read as an unreviewed literal translation rather than idiomatic phrasing pending a native-speaker pass. `scripts/i18n-fill-missing.py` fills gaps without overwriting real translations. |
| Advanced constraint optimizer (spec §1) | Composition, functional-group, ratio and conditional constraints, soft-constraint penalty relaxation, property targets, a cost ceiling, and graded compatibility/safety risk objectives all solve for real (mixed-integer where needed). The Scenarios section now has a real, working lifecycle (create/save/clone/rename/retire/restore, append-only revisions), loads all 31 seeded product-family profiles (apply-missing/merge/replace), and compares two or more persisted runs with deterministic per-rule highlights. The remaining UI gap: no composition/ratio/conditional-constraint builder, no lexicographic priority selector, no per-material lock editor. See [ADVANCED_OPTIMIZER.md](../ADVANCED_OPTIMIZER.md), [OPTIMIZATION_SCENARIOS.md](../OPTIMIZATION_SCENARIOS.md). |
| Substitution engine (spec §12) | One-to-one substitution is fully scored and wired to the UI, re-running the real compatibility/safety engines per candidate. System (multi-material) substitution now generates real candidate combinations by function coverage, routes each through the actual Advanced Optimizer, and scores the result — selecting multiple formula lines in the Substitution dialog enters system mode. Graded compatibility/safety risk objectives are not yet wired into a system's base problem (real hard exclusions still are). See [MATERIAL_SUBSTITUTION.md](../MATERIAL_SUBSTITUTION.md), [SYSTEM_SUBSTITUTION.md](../SYSTEM_SUBSTITUTION.md). |
| DOE (spec §10) | The core is fully implemented (see the dedicated section above) — 9 of 11 named design types, a real OLS/ANOVA analysis engine, desirability/candidate search, Laboratory integration, import/export, and the `/doe` workspace. `definitive_screening`/`mixture_simplex_centroid` designs, fractional-factorial fractions beyond a half-fraction, and Plackett-Burman sizes beyond N=12 are refused with an explicit "not implemented" error rather than faked. Deep cross-navigation into a specific candidate inside the Optimization workspace is a lightweight project-context link, not a data-merged view. See [DESIGN_OF_EXPERIMENTS.md](../DESIGN_OF_EXPERIMENTS.md). |

## Existing functionality preserved

Nothing was removed. The evidence-driven discovery pipeline, open-access-only
retrieval, full-text reading, citation verification, deterministic rules engine,
region profiles, raw-material import, costing, multi-card output and printing
all continue to work and pass their tests.
