# Implementation Status

Honest state of the Kenya R&D platform transformation. "Done" here means
implemented, wired in and covered by a passing test — not scaffolded.

Last updated: end of the Advanced Optimizer / Substitution Engine
gap-closure phase (soft constraints, property targets, graded risk
objectives, expanded infeasibility diagnostics, optimization scenarios with
product-family profile application, and multi-material system
substitution). Before that: Excel import, supplier/packaging/factory-
profile editors, formula lifecycle controls, structured version exports,
the Compatibility Engine, the Safety Engine, cross-cutting Approval
Readiness, the Turkish locale, the mixed-integer Advanced Formulation
Constraint Optimizer's core solve, one-to-one material substitution, the
optimization/substitution approval-readiness checks, and the platform's
first migration runner.

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
or when the selected candidate itself carries a blocking finding. Not yet
called from any desktop UI screen (a pre-existing gap — see
APPROVAL_READINESS.md's "What this does not do"). 24 tests total in
`approvalReadiness.test.ts`.

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
| Regulatory engine + rule import | 13 |
| Manufacturing methods + batch records | 8 |
| Lab trials + stability studies | 9 |
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
