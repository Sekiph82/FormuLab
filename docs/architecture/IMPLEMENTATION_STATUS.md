# Implementation Status

Honest state of the Kenya R&D platform transformation. "Done" here means
implemented, wired in and covered by a passing test — not scaffolded.

Last updated: end of the Kenya/EAC Regulatory Engine phase (seven
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
- All validated with Zod; exported from `@ai4s/shared`

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
- Desktop lint is clean (`pnpm --filter @ai4s/desktop lint` exits 0).

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
[EAC_MARKET_PROFILES.md](../EAC_MARKET_PROFILES.md). Phase 2 — recovered
from a paused work-in-progress stash (the foundation) and completed with
persistence, desktop UI, Approval Readiness integration, and i18n.
- Seven jurisdictions (`REGULATORY_JURISDICTIONS`: KE/UG/TZ/RW/BI/SS plus
  the `EAC` regional-bloc overlay), deterministic product classification
  (`classifyProductRegulatory`), a versioned `RegulatoryRule` +
  append-only `RegulatoryRuleRevision` model mirroring
  `ApprovalPolicy`/`ApprovalPolicyRevision`'s human-gated
  create/edit/activate/deprecate lifecycle, rule evaluation
  (`evaluateRegulatory`) across three shapes (ingredient-based,
  claim-based, product-level requirement) with honest
  `missing_data`/`human_review_required` defaults for anything not
  automatically confirmable, a six-status `RegulatoryFinding`, and an
  append-only `RegulatoryReview` human sign-off record.
- Approval Readiness integration (`assessRegulatoryReadiness`/
  `deriveRegulatoryReadiness`, `engine/regulatoryApproval.ts`): a
  same-one-layer-up pattern as the cost-snapshot gate, six new opt-in
  `ApprovalPolicy` fields, wired into `ApprovalPanel.tsx` scoped to the
  formulation's primary target market.
- Rule import/export (JSON, same shape-check-then-upsert convention
  `RuleManager.tsx` already uses; imports always forced to
  `imported_unverified`).
- Desktop Regulatory workspace (`RegulatoryPanel.tsx`): jurisdiction
  picker, classification card, findings evaluation with manual
  confirmation, rule browser/editor with revision history, human review
  recording.
- 17 seed rules across all seven jurisdictions
  (`catalog/regulatoryRules.ts`), every one an explicit `not_verified`
  structural placeholder.
- Three new master-data collections (`regulatory_rules`,
  `regulatory_rule_revisions`, `regulatory_reviews`) added to the Rust
  allow-list; no migration registered (all start at `schemaVersion: "1.0"`,
  nothing yet to migrate from).
- English and Turkish i18n (real translations); the other six shipped
  locales carry the same keys as English placeholders pending native
  review, per this project's existing i18n convention.
- 53 new shared-package tests (13 `regulatoryClassification.test.ts`, 25
  `regulatoryRules.test.ts`, 15 `regulatoryApproval.test.ts`) — 613 shared
  tests total. 11 new desktop tests (8 `RegulatoryPanel.test.tsx`, 3 new
  `ApprovalPanel.test.tsx` cases) — 380 desktop tests total.
- Known limitations: no dossier/evidence-tracking system (product-level
  requirement confirmations are session-local, not persisted separately
  from a review); human review is matched by jurisdiction only, not by
  specific formula version; the Approval tab's automatic gate checks
  exactly one (primary) jurisdiction per formulation; every seed rule is
  a structural placeholder pending a qualified regulatory reviewer's
  confirmation. See `REGULATORY_ENGINE.md`'s "Known limitations" for the
  full list.

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

## Not yet started

Everything below is specified and designed but **not implemented**. Listing it
plainly so nothing here reads as available.

| Area | Spec § |
|---|---|
| Evidence origin classification wired into the pipeline | 4 |
| Manufacturing methods + batch records | 8 |
| DOE | 10 |
| Reverse formulation | 11 |
| PDF/Word exports (JSON/CSV/Excel/ERP-draft-CSV exports exist — see gap-closure UI, Done) | 20, 21 |
| Security threat model docs | 24 |
| CI matrix, SBOM, secret scanning | 26 |
| Identity rename (`ai4s` → `formulab`) | 22 |

## Partially done

| Area | State |
|---|---|
| Localisation of screens outside the 8 shipped locales' major workflows | The parity test requires every locale to carry every key; a handful of generic-chrome strings (unrelated to the R&D workflows) may still read as an unreviewed literal translation rather than idiomatic phrasing pending a native-speaker pass. `scripts/i18n-fill-missing.py` fills gaps without overwriting real translations. |
| Advanced constraint optimizer (spec §1) | Composition, functional-group, ratio and conditional constraints, soft-constraint penalty relaxation, property targets, a cost ceiling, and graded compatibility/safety risk objectives all solve for real (mixed-integer where needed). The Scenarios section now has a real, working lifecycle (create/save/clone/rename/retire/restore, append-only revisions), loads all 31 seeded product-family profiles (apply-missing/merge/replace), and compares two or more persisted runs with deterministic per-rule highlights. The remaining UI gap: no composition/ratio/conditional-constraint builder, no lexicographic priority selector, no per-material lock editor. See [ADVANCED_OPTIMIZER.md](../ADVANCED_OPTIMIZER.md), [OPTIMIZATION_SCENARIOS.md](../OPTIMIZATION_SCENARIOS.md). |
| Substitution engine (spec §12) | One-to-one substitution is fully scored and wired to the UI, re-running the real compatibility/safety engines per candidate. System (multi-material) substitution now generates real candidate combinations by function coverage, routes each through the actual Advanced Optimizer, and scores the result — selecting multiple formula lines in the Substitution dialog enters system mode. Graded compatibility/safety risk objectives are not yet wired into a system's base problem (real hard exclusions still are). See [MATERIAL_SUBSTITUTION.md](../MATERIAL_SUBSTITUTION.md), [SYSTEM_SUBSTITUTION.md](../SYSTEM_SUBSTITUTION.md). |

## Existing functionality preserved

Nothing was removed. The evidence-driven discovery pipeline, open-access-only
retrieval, full-text reading, citation verification, deterministic rules engine,
region profiles, raw-material import, costing, multi-card output and printing
all continue to work and pass their tests.
