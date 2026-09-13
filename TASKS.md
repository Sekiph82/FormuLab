# FormuLab — Canonical GitHub Task State

This root `TASKS.md` is the **only authoritative project-status tracker consumed by H!veAI**.
GitHub repository metadata, the tracked branch, and this file are the project-management truth inputs.
`PROGRESS.md`, `project-control/**`, audit/log/handoff files, GitHub issues, roadmap/spec documents, and archived legacy trackers are evidence/history only and must not override this ledger.

## Project Status

- Current Milestone: FVL-05
- Current Sprint: FVL-05-S04
- Current Task: FVL-05.012 — Train/validation/test partition rules with leakage prevention
- Current Task Status: READY
- Next Task: FVL-05.013 — Immutable historical linkage; dataset build never mutates a source record
- Required Actor: CODEX
- Tracking Repository: Sekiph82/FormuLab
- Tracking Branch: main
- Blockers/Waits: None

## Progress

- Total Tasks: 171
- Completed Tasks: 100
- Remaining Tasks: 71
- Completion: 58.5%

H!veAI derives metrics from the checkbox rows below. These summary numbers are human-readable mirrors and must remain consistent with the ledger.

## Tracking Rules

- `[x]` = validated complete.
- `[~]` = actively in progress.
- `[ ]` = planned / pending / ready but not started.
- `[!]` = blocked.
- `Current Task` is explicit in **Project Status** and is never inferred from the first unchecked row.
- `Next Task` is explicit in **Project Status**.
- Every task ID appears exactly once in the canonical checkbox ledger.
- Milestone and sprint headings are organizational structure only; they are not counted as tasks.
- Detailed historical implementation evidence from the pre-TASKS-only tracker is preserved under `docs/migration/legacy-task-trackers/` and is non-authoritative.
- Scope/governance documents may explain a task, but task state changes only here.
- When work starts, update the selected row to `[~]` and update Project Status in the same commit.
- When independently accepted/validated complete, update the row to `[x]`, advance Project Status, and push the tracked branch.
- Do not create or revive `.hiveai` task/state/handoff/event files as a competing tracker.

## Tasks

Sprint grouping below is a management-only organization of the existing frozen task scope. It does not create new product scope or new task IDs.

# FVL-01

## Sprint FVL-01-S01 — Research & evidence foundation
- [x] FVL-01.001 — Zero-LLM formulation generation
- [x] FVL-01.002 — Deterministic requirement parsing
- [x] FVL-01.003 — Hybrid literature discovery and OA resolution
- [x] FVL-01.004 — CanonicalPaper deduplication and provenance
- [x] FVL-01.005 — Full-text acquisition gate and research-corpus policy
- [x] FVL-01.006 — Evidence extraction and A-E evidence classes
- [x] FVL-01.007 — Concentration evidence resolution hierarchy and plausibility gate

## Sprint FVL-01-S02 — Generation & engineering intelligence
- [x] FVL-01.008 — Multi-alternative architecture generation baseline
- [x] FVL-01.009 — Manufacturing Procedure generation
- [x] FVL-01.010 — Critical Parameters with target vs hard-limit distinction
- [x] FVL-01.011 — Equipment derivation and availability matching
- [x] FVL-01.012 — Deterministic Safety intelligence
- [x] FVL-01.013 — Deterministic Regulatory intelligence
- [x] FVL-01.014 — Decision traceability
- [x] FVL-01.015 — Structured evidence-gap analysis

## Sprint FVL-01-S03 — UX, reporting & release closure
- [x] FVL-01.016 — Evidence & Sources UI
- [x] FVL-01.017 — Dedicated formulation report generation
- [x] FVL-01.018 — Historical session compatibility
- [x] FVL-01.019 — Full regression suite green
- [x] FVL-01.020 — Fresh desktop build and shortcut verification
- [x] FVL-01.021 — GitHub commit/push state verified

# FVL-02

## Sprint FVL-02-S01 — Dynamic alternative-count engine
- [x] FVL-02.001 — Define requested formula-count contract, min 3 / max 7 / default 3
- [x] FVL-02.002 — Validate requested formula count in the Python pipeline
- [x] FVL-02.003 — Generalize strategy derivation from fixed 3 to requested N
- [x] FVL-02.004 — Generalize deterministic solver loop to N cards
- [x] FVL-02.005 — Generalize cross-formula diversity pressure across N versions
- [x] FVL-02.006 — Generalize diversity report and distinct architecture count to N
- [x] FVL-02.007 — Architecture-uniqueness enforcement without near-duplicate padding
- [x] FVL-02.008 — Return fewer than requested alternatives honestly when only M are defensible
- [x] FVL-02.009 — Below-3 defensible alternatives produce an explicit insufficient outcome
- [x] FVL-02.010 — Remove hardcoded v1/v2/v3 branching from card collection logic

## Sprint FVL-02-S02 — Persistence, bridge & UI generalization
- [x] FVL-02.011 — Session persistence supports 3–7 cards
- [x] FVL-02.012 — Rust bridge passes N cards generically
- [x] FVL-02.013 — TypeScript card types and consumers support arbitrary N
- [x] FVL-02.014 — Dynamic version selector driven by returned card count
- [x] FVL-02.015 — Responsive 3–7 version selector layout
- [x] FVL-02.016 — Version switching and selected-ingredient reset generalized to N
- [x] FVL-02.017 — All version-scoped tabs read the active card generically
- [x] FVL-02.018 — Download Report generalized to N formulas
- [x] FVL-02.019 — Backward compatibility for existing 3-version historical sessions

## Sprint FVL-02-S03 — Boundary tests & real acceptance
- [x] FVL-02.020 — Parametrized pytest coverage for N=3..7
- [x] FVL-02.021 — Boundary tests for requests below 3 and above 7
- [x] FVL-02.022 — Test fewer-than-requested scientifically defensible alternatives
- [x] FVL-02.023 — Frontend Vitest coverage for dynamic selector and backward compatibility
- [x] FVL-02.024 — Real disposable zero-LLM acceptance test at a non-default N

# FVL-03

## Sprint FVL-03-S01 — Single-authority platform integration
- [x] FVL-03.001 — Audit Material Master ↔ candidate-pool integration seam
- [x] FVL-03.002 — Feed canonical Material Master into candidate pool with real material identity
- [x] FVL-03.003 — Route real cost behavior through the existing Cost Engine
- [x] FVL-03.004 — Route inventory feasibility through canonical InventoryRecord semantics
- [x] FVL-03.005 — Use existing Advanced Optimizer as optional post-generation refinement
- [x] FVL-03.006 — Use existing material substitution engine, never duplicate substitution scoring
- [x] FVL-03.007 — Use existing system substitution engine at formula level
- [x] FVL-03.008 — Make the existing Compatibility Engine authoritative for generated formulas
- [x] FVL-03.009 — Make the existing Safety Engine authoritative and retire duplicate pipeline verdict logic
- [x] FVL-03.010 — Make the Kenya/EAC Regulatory Engine authoritative and retire duplicate pipeline verdict logic
- [x] FVL-03.011 — Preserve supplier/material/safety/regulatory/compatibility provenance end to end
- [x] FVL-03.012 — Integration acceptance proving one authoritative result per domain

## Sprint FVL-03-S02 — Scientific formulation intelligence
- [x] FVL-03.013 — Scientific full-formulation extraction
- [x] FVL-03.014 — Scientific formulation experimental-outcome linking
- [x] FVL-03.015 — Scientific architecture candidate seeding
- [x] FVL-03.016 — Scientific architecture adaptation traceability
- [x] FVL-03.017 — Scientific-vs-rule architecture selection
- [x] FVL-03.018 — Evidence & Sources scientific formulation detail UI

# FVL-04

## Sprint FVL-04-S01 — Canonical Data Exchange onboarding
- [x] FVL-04.001 — Confirm material-master import template covers generation requirements
- [x] FVL-04.002 — Confirm supplier import and supplier-material link paths
- [x] FVL-04.003 — Confirm TDS metadata/document import path
- [x] FVL-04.004 — Confirm SDS metadata/document import path
- [x] FVL-04.005 — Confirm specifications import path
- [x] FVL-04.006 — Confirm price-history import feeds canonical Cost Engine
- [x] FVL-04.007 — Confirm inventory import feeds canonical availability engine
- [x] FVL-04.008 — Confirm exchange-rate import feeds canonical Cost Engine
- [x] FVL-04.009 — Confirm process-parameter import path for Manufacturing Procedure
- [x] FVL-04.010 — Regulatory rule/evidence import preserves unverified state
- [x] FVL-04.011 — Extend template registry only for proven missing mappings
- [x] FVL-04.012 — Real sample-file acceptance per confirmed/extended template

## Sprint FVL-04-S02 — External connector foundation
- [x] FVL-04.013 — External Source Connector Contract
- [x] FVL-04.014 — Generic File Connector
- [x] FVL-04.015 — Source Schema Discovery
- [x] FVL-04.016 — Mapping Profile Model
- [x] FVL-04.017 — External ID Crosswalk Registry
- [x] FVL-04.018 — Transformation / Unit / Enum Mapping

## Sprint FVL-04-S03 — Enterprise migration bridge & acceptance
- [x] FVL-04.019 — Formula / Recipe Relationship Import
- [x] FVL-04.020 — Laboratory / Test Result Relationship Import
- [x] FVL-04.021 — Generic Database Read Connector
- [x] FVL-04.022 — REST API Connector Contract
- [x] FVL-04.023 — Incremental Re-import / Conflict Handling
- [x] FVL-04.024 — Connector → Existing Data Exchange Bridge
- [x] FVL-04.025 — Customer Migration Acceptance Fixture
- [x] FVL-04.026 — Human-readable literature & formulation artifact naming convention

# FVL-05

## Sprint FVL-05-S01 — Dataset schema & lineage
- [x] FVL-05.001 — Define dataset schema version + feature schema version
- [x] FVL-05.002 — Row/entity lineage model with exact source-record IDs

## Sprint FVL-05-S02 — Historical source extractors
- [x] FVL-05.003 — Extractor: formula version + exact composition + materials + properties + product family
- [x] FVL-05.004 — Extractor: process plan + actual process observations
- [x] FVL-05.005 — Extractor: LaboratoryTrial + TestResult
- [x] FVL-05.006 — Extractor: stability studies/results
- [x] FVL-05.007 — Extractor: DOE studies/runs/observations
- [x] FVL-05.008 — Extractor: corrective actions, cost snapshots, packaging/context, environmental/test conditions

## Sprint FVL-05-S03 — Feature normalization & targets
- [x] FVL-05.009 — Normalization: units, categorical, numeric; missing stays missing
- [x] FVL-05.010 — Exact target-variable definitions per product family / measured response

## Sprint FVL-05-S04 — Reproducibility, partitioning & regression
- [x] FVL-05.011 — Dataset hash/fingerprint + reproducible rebuild from source records
- [ ] FVL-05.012 — Train/validation/test partition rules with leakage prevention
- [ ] FVL-05.013 — Immutable historical linkage; dataset build never mutates a source record
- [ ] FVL-05.014 — Regression tests: rebuild determinism, missing-value handling, leakage checks, lineage round-trip

# FVL-06

## Sprint FVL-06-S01 — Measured-response domain model
- [ ] FVL-06.001 — Define structured measured-response schema
- [ ] FVL-06.002 — Define spectrophotometric/detergent-performance metric schema
- [ ] FVL-06.003 — Raw measurement + normalized-performance field only when deterministic normalization exists
- [ ] FVL-06.004 — Raw-file attachment/provenance linkage
- [ ] FVL-06.005 — Measured-response linkage fields for formula version, trial, sample, test definition, timestamps

## Sprint FVL-06-S02 — Instrument ingestion & dataset integration
- [ ] FVL-06.006 — CSV/Excel instrument import through existing Data Exchange
- [ ] FVL-06.007 — Instrument-import validation rules for units and linkage
- [ ] FVL-06.008 — Reuse existing Data Exchange import-history/commit lifecycle
- [ ] FVL-06.009 — Feed instrument/performance data into FVL-05 dataset extractors
- [ ] FVL-06.010 — Real sample instrument-export acceptance test

# FVL-07

## Sprint FVL-07-S01 — Eligibility & feature engineering
- [ ] FVL-07.001 — Eligibility: minimum dataset size and target-observation thresholds
- [ ] FVL-07.002 — Eligibility: missing-data rules and applicability-domain requirements
- [ ] FVL-07.003 — Explicit INSUFFICIENT_DATA outcome below threshold
- [ ] FVL-07.004 — Feature generation: composition + material/property features with provenance
- [ ] FVL-07.005 — Feature generation: process + test-context + product-family features
- [ ] FVL-07.006 — Optional reproducible interaction features

## Sprint FVL-07-S02 — Training, model selection & registry
- [ ] FVL-07.007 — Baseline models before ML candidates
- [ ] FVL-07.008 — Prediction-model comparison with train/validation/test split and recorded seeds
- [ ] FVL-07.009 — Hyperparameter recording with no fabricated result
- [ ] FVL-07.010 — Evaluation metrics, held-out performance vs baseline, failure thresholds and acceptance policy
- [ ] FVL-07.011 — Model registry with dataset hash, schema version, algorithm, params, metrics and checksums

## Sprint FVL-07-S03 — Prediction serving & acceptance
- [ ] FVL-07.012 — Prediction API with exact formula/version lineage and uncertainty where supported
- [ ] FVL-07.013 — Applicability-domain warning / out-of-domain refusal
- [ ] FVL-07.014 — Hard rule: prediction cannot override regulatory/safety
- [ ] FVL-07.015 — Per-product-family, per-target model training
- [ ] FVL-07.016 — Regression + acceptance tests for eligibility, model selection, registry and OOD refusal

# FVL-08

## Sprint FVL-08-S01 — Performance ranking & optimizer integration
- [ ] FVL-08.001 — Ranking model keeps performance, uncertainty, cost, availability, compatibility, safety, regulatory, manufacturing and evidence dimensions separate
- [ ] FVL-08.002 — Hard rule: Safety/Regulatory FAIL cannot be outweighed by predicted performance
- [ ] FVL-08.003 — Missing or out-of-domain prediction never masquerades as validated zero
- [ ] FVL-08.004 — Cost dimension sourced only from existing Cost Engine
- [ ] FVL-08.005 — Optimization pass reuses existing Advanced Optimizer

## Sprint FVL-08-S02 — Explainability, audit & acceptance
- [ ] FVL-08.006 — UI explains ranking by per-dimension breakdown
- [ ] FVL-08.007 — Persistence + audit trail for every ranking input
- [ ] FVL-08.008 — Regression acceptance: Safety-FAIL alternative never outranks a passing one

# FVL-09

## Sprint FVL-09-S01 — Experiment recommendation engine
- [ ] FVL-09.001 — Candidate experiment-space definition over existing formula/DOE model
- [ ] FVL-09.002 — Feasibility filtering for materials and manufacturing
- [ ] FVL-09.003 — Safety/regulatory hard-exclusion filtering
- [ ] FVL-09.004 — Uncertainty + defensible acquisition criterion
- [ ] FVL-09.005 — Diversity + estimated experiment cost where real cost data exists

## Sprint FVL-09-S02 — DOE/laboratory execution loop
- [ ] FVL-09.006 — DOE integration: recommendation ranking + rationale in existing workflow
- [ ] FVL-09.007 — Human selection required; no automatic lab execution
- [ ] FVL-09.008 — Create/link real LaboratoryTrial or DOE run from accepted recommendation
- [ ] FVL-09.009 — Completed-experiment ingestion triggers versioned model retraining
- [ ] FVL-09.010 — Regression test: unperformed recommendation is never labeled validated

# FVL-10

## Sprint FVL-10-S01 — Closed-loop lineage foundation
- [ ] FVL-10.001 — ID/provenance model spanning the full laboratory-feedback chain
- [ ] FVL-10.002 — Immutable references; later stages cite and never rewrite earlier records
- [ ] FVL-10.003 — Version relationships across formula, trial, result, dataset, model, prediction and recommendation
- [ ] FVL-10.004 — Corrective-action-derived draft linkage
- [ ] FVL-10.005 — DOE-derived draft linkage
- [ ] FVL-10.006 — Phase-14-generated draft linkage to generation session

## Sprint FVL-10-S02 — Model/retraining/UI linkage & gates
- [ ] FVL-10.007 — Prediction source-model linkage
- [ ] FVL-10.008 — Retraining lineage linking new data to model version
- [ ] FVL-10.009 — UI navigation across the full chain + audit trail view
- [ ] FVL-10.010 — Failure/retry behavior and human gates; no model may rewrite laboratory results

# FVL-11

## Sprint FVL-11-S01 — Integrated acceptance
- [ ] FVL-11.001 — Acceptance matrix across genuinely different product families
- [ ] FVL-11.002 — Full-chain acceptance run 1 through report
- [ ] FVL-11.003 — Full-chain acceptance run 2 through lab, model, active learning and retraining
- [ ] FVL-11.004 — Backward compatibility for historical sessions
- [ ] FVL-11.005 — Old vs new formulation UI decision after acceptance proof
- [ ] FVL-11.006 — Authorization/role and approval gates re-verified; no AI auto-approval
- [ ] FVL-11.007 — Zero-LLM formulation regression re-confirmed
- [ ] FVL-11.008 — Data integrity + backup/restore re-verified for new record types

## Sprint FVL-11-S02 — Regression, installer & v1 closure
- [ ] FVL-11.009 — Full regression suite across Python, Rust, Vitest, TypeScript, ESLint and diff check
- [ ] FVL-11.010 — Fresh installer build: formulab.exe + MSI/NSIS
- [ ] FVL-11.011 — Desktop FormuLab.lnk verification against fresh build
- [ ] FVL-11.012 — GitHub branch state confirmed with no outstanding blocking issue
- [ ] FVL-11.013 — Current handoff updated to closure state
- [ ] FVL-11.014 — Explicit FormuLab v1 COMPLETE declaration after every prior task is complete

## Historical Detail & Evidence

The verbose pre-migration tracker, dependency tables, acceptance notes, corrective-cycle history, and evidence are preserved under:

- `docs/migration/legacy-task-trackers/formulab-pre-M21.md`
- `docs/migration/legacy-task-trackers/`

Those files are historical evidence only. They are not alternative task ledgers and H!veAI must not derive current project state from them.
