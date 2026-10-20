# FVL07-GPT-PROMPT-000021 — Codex Master Execution Prompt

Repository: https://github.com/Sekiph82/FormuLab
Canonical branch: `main`
Canonical task authority: https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md
Governance: https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md
Codex master prompt: https://github.com/Sekiph82/FormuLab/blob/main/project-control/gpt/prompts/FVL07-GPT-PROMPT-000021.md
Actor: CODEX

## Objective

Complete the entire FVL-07 milestone in strict task order and push validated results to `main`.

Canonical scope:

### Sprint FVL-07-S01 — Eligibility & feature engineering
1. `FVL-07.001` — Eligibility: minimum dataset size and target-observation thresholds
2. `FVL-07.002` — Eligibility: missing-data rules and applicability-domain requirements
3. `FVL-07.003` — Explicit INSUFFICIENT_DATA outcome below threshold
4. `FVL-07.004` — Feature generation: composition + material/property features with provenance
5. `FVL-07.005` — Feature generation: process + test-context + product-family features
6. `FVL-07.006` — Optional reproducible interaction features

### Sprint FVL-07-S02 — Training, model selection & registry
7. `FVL-07.007` — Baseline models before ML candidates
8. `FVL-07.008` — Prediction-model comparison with train/validation/test split and recorded seeds
9. `FVL-07.009` — Hyperparameter recording with no fabricated result
10. `FVL-07.010` — Evaluation metrics, held-out performance vs baseline, failure thresholds and acceptance policy
11. `FVL-07.011` — Model registry with dataset hash, schema version, algorithm, params, metrics and checksums

### Sprint FVL-07-S03 — Prediction serving & acceptance
12. `FVL-07.012` — Prediction API with exact formula/version lineage and uncertainty where supported
13. `FVL-07.013` — Applicability-domain warning / out-of-domain refusal
14. `FVL-07.014` — Hard rule: prediction cannot override regulatory/safety
15. `FVL-07.015` — Per-product-family, per-target model training
16. `FVL-07.016` — Regression + acceptance tests for eligibility, model selection, registry and OOD refusal

Do not start FVL-08 implementation.

## Source of truth and startup

Before changing code:

1. checkout `main`
2. fetch and pull latest `main`
3. read https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md completely
4. read https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md completely
5. treat https://github.com/Sekiph82/FormuLab/blob/main/CLAUDE.md as compatibility-only
6. inspect FVL-05 dataset schema, lineage, fingerprinting, partitioning, and target extraction contracts
7. inspect FVL-06 measured-response and instrument-ingestion contracts
8. inspect any existing optimizer/prediction/model infrastructure before adding new model abstractions
9. inspect current safety, regulatory, compatibility, cost, inventory, and advanced-optimizer authorities so prediction cannot duplicate or override them

https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md is the only authoritative task-state ledger.

Codex is the primary implementation/execution agent.

Do not create:
- alternate task trackers
- competing dashboards
- `.hiveai` task/state/handoff/event files
- duplicate milestone ledgers
- a parallel dataset layer
- a second safety/regulatory authority
- a model framework that bypasses existing FormuLab domain contracts

## Execution behavior

Work continuously from FVL-07.001 through FVL-07.016.

Do not stop after each task for approval.

Only stop for a genuine non-resolvable blocker.

At task start:
- mark the task `[~]`
- set Current Task appropriately
- set Current Task Status = IN_PROGRESS
- keep Next Task accurate
- commit/push state transition with the implementation state it represents

At validated completion:
- mark the task `[x]`
- advance Current Task / Next Task atomically
- keep progress counts exact

Do not mark a task complete because code exists. Completion requires implementation plus focused validation.

---

# FVL-07.001 — Eligibility: minimum dataset size and target-observation thresholds

Define explicit, deterministic eligibility rules for whether a dataset is sufficient for model training.

Eligibility must be evaluated per:
- product family
- target variable
- applicable feature schema / dataset schema
- dataset fingerprint/version where relevant

Do not use arbitrary magic thresholds without making them explicit and testable.

Inspect actual dataset shapes before setting defaults.

The eligibility result must explain:
- observed row count
- usable row count
- target-observation count
- required minimums
- reason for pass/fail

No model training may start when eligibility fails.

Add focused tests for boundary counts and mixed target availability.

---

# FVL-07.002 — Missing-data rules and applicability-domain requirements

Define missing-data eligibility rules and minimum applicability-domain requirements.

Required behavior:
- missing stays missing
- zero is not missing
- false is not missing
- no silent imputation unless an explicit deterministic strategy is part of a versioned model contract
- training must reject or explicitly exclude unusable rows according to declared rules
- applicability-domain prerequisites must be explicit

Do not fabricate complete feature vectors.

Record the exact eligibility policy/version used.

Add tests for:
- sparse rows
- missing target
- missing features
- all-zero valid values
- categorical missingness
- mixed valid/invalid rows

---

# FVL-07.003 — Explicit INSUFFICIENT_DATA outcome

Introduce a first-class `INSUFFICIENT_DATA` outcome below eligibility thresholds.

This outcome must not be represented as:
- success with empty metrics
- zero-quality model
- generic exception when a structured eligibility outcome is possible
- fabricated prediction capability

The outcome must preserve human-readable reasons and machine-readable codes.

Prediction/training callers must be able to distinguish:
- eligible
- insufficient data
- invalid data / contract failure
- out-of-domain prediction later in the pipeline

Add regression tests proving no model artifact is registered when data is insufficient.

---

# FVL-07.004 — Composition + material/property features with provenance

Generate model features from formulation composition and canonical material/property data.

Use existing FVL-05 row lineage and FormuLab material authority.

Do not:
- substitute current/latest material data for historical frozen context
- invent missing material properties
- silently normalize units without deterministic mapping
- lose source provenance

Each generated feature must be traceable to source material/composition identity and relevant schema/version.

Preserve exact composition semantics.

Add deterministic feature-generation tests and lineage round-trip tests.

---

# FVL-07.005 — Process + test-context + product-family features

Generate reproducible features from:
- process parameters
- manufacturing observations where legitimate
- test context
- environmental/context fields
- product family

Avoid target leakage.

Do not include post-outcome information as predictors if it would reveal the target.

Explicitly audit temporal ordering and source semantics.

Feature generation must remain deterministic and provenance-aware.

Add anti-leakage tests.

---

# FVL-07.006 — Optional reproducible interaction features

Support interaction features only when:
- explicitly configured
- deterministic
- reproducible
- versioned
- based solely on permitted predictor features

Do not automatically explode feature space.

Interaction definitions must be recorded in the model/training contract.

Input ordering must not change generated interactions.

Add tests for:
- disabled interactions
- enabled deterministic interactions
- version/config round-trip
- no target-derived interactions

---

# FVL-07.007 — Baseline models before ML candidates

Implement simple baselines before evaluating ML candidates.

Examples must be chosen according to target semantics and existing dependencies, not by inventing scientific assumptions.

At minimum provide a defensible naive/baseline comparator appropriate for regression or classification if those target types exist.

Every ML candidate must be compared against a baseline.

Do not register a sophisticated model merely because it trains.

Add tests proving baseline metrics are produced and persisted.

---

# FVL-07.008 — Model comparison using train/validation/test and recorded seeds

Use FVL-05 leakage-safe partitions.

Never create an ad-hoc splitter that bypasses FVL-05.012.

Training/model comparison must record:
- exact dataset fingerprint
- schema versions
- partition strategy/config/version
- seed(s)
- algorithm identity/version
- feature-generation configuration

Test data must remain held out from selection/tuning.

Validation may drive model selection; test is for final held-out evaluation.

Add deterministic repeatability tests where algorithm support permits.

---

# FVL-07.009 — Hyperparameter recording with no fabricated result

Record exact hyperparameters for every candidate/trained model.

Do not:
- omit defaults that materially affect reproducibility
- claim searched/tuned values that were not actually evaluated
- fabricate best parameters
- silently change parameters between training and registry

Record search space and evaluated trials if hyperparameter search exists.

If no tuning was performed, say so explicitly in the artifact.

Add persistence/round-trip tests.

---

# FVL-07.010 — Evaluation metrics, baseline comparison, thresholds and acceptance policy

Define target-appropriate evaluation metrics.

Do not use a metric merely because it is common.

Record:
- validation metrics
- held-out test metrics
- baseline metrics
- comparison against baseline
- declared failure/acceptance thresholds
- sample counts

No model is accepted merely because training completed.

Acceptance policy must be explicit, deterministic, and testable.

If performance is not meaningfully better than the required baseline/policy, return a non-accepted model result.

Do not fabricate scientific validity from statistical score alone.

---

# FVL-07.011 — Model registry

Implement or extend the canonical model registry.

Each registered model must include at least:
- model ID/version
- product family
- target
- dataset fingerprint
- dataset/feature schema versions
- training timestamp
- algorithm identity/version
- exact hyperparameters
- partition config/seed
- evaluation metrics
- baseline metrics
- acceptance status
- artifact checksum(s)
- feature contract/version
- relevant provenance

Do not register insufficient/failed training as an accepted production model.

Model artifacts must be immutable/versioned.

Add checksum and registry round-trip tests.

---

# FVL-07.012 — Prediction API with exact lineage and uncertainty where supported

Create a prediction API that takes a well-defined formula/version context and returns a structured prediction.

Required output:
- model ID/version
- dataset/model provenance
- exact formula/version lineage
- target identity
- predicted value/class
- unit where applicable
- applicability-domain result
- uncertainty only when the algorithm/model supports a defensible uncertainty estimate

Do not fabricate uncertainty.

Prediction must not silently use “latest” formula/material context in place of the requested historical/versioned input.

Add API contract tests.

---

# FVL-07.013 — Applicability-domain warning / out-of-domain refusal

Implement explicit applicability-domain evaluation.

A prediction outside the model's defensible domain must:
- warn or refuse according to declared policy
- never masquerade as an ordinary validated prediction
- preserve machine-readable and human-readable reason

Prefer refusal when the model contract cannot support extrapolation safely.

Do not invent confidence scores as a substitute for applicability-domain checks.

Add boundary and clear-OOD tests.

---

# FVL-07.014 — Prediction cannot override regulatory/safety

Hard rule:

Prediction output is advisory and cannot override authoritative Safety or Regulatory decisions.

A predicted high-performance alternative that is Safety FAIL or Regulatory FAIL must remain failed/ineligible for any downstream decision.

Do not merge prediction score into safety/regulatory verdicts.

Use existing authoritative engines from FVL-03.

Add regression tests proving:
- Safety FAIL remains fail regardless of prediction
- Regulatory FAIL remains fail regardless of prediction
- missing prediction does not alter safety/regulatory status
- prediction service cannot write approvals

---

# FVL-07.015 — Per-product-family, per-target model training

Training must be scoped per product family and per target.

Do not train one global model unless the canonical task/source evidence explicitly proves it is scientifically justified.

Each training run must independently pass:
- eligibility
- feature generation
- partitioning
- baseline comparison
- evaluation policy

Model registry identity must distinguish product family and target.

Add tests with multiple families/targets proving separation.

---

# FVL-07.016 — Regression + acceptance

Create milestone-closing regression and acceptance coverage across:

1. eligibility thresholds
2. missing-data rules
3. INSUFFICIENT_DATA
4. feature provenance
5. anti-leakage
6. reproducible interactions
7. baseline generation
8. partition/seed recording
9. hyperparameter recording
10. validation/test metrics
11. registry integrity/checksums
12. prediction API lineage
13. applicability-domain refusal
14. safety/regulatory non-override
15. product-family/target isolation

Use real FVL-05/FVL-06 contracts, not a disconnected mock-only pipeline.

Acceptance should exercise:
dataset -> eligibility -> features -> partition -> baseline/candidates -> evaluation -> registry -> prediction -> OOD/safety gates

Do not call FVL-07 complete unless this integrated path passes.

---

# Scope control

Allowed:
- eligibility contracts
- feature engineering
- baseline/model training infrastructure
- model evaluation
- model registry
- prediction serving
- applicability-domain checks
- integration with FVL-05/FVL-06
- tests
- TASKS.md updates
- minimal UI/API exposure strictly required by current architecture

Not allowed:
- FVL-08 ranking/optimizer integration beyond preserving existing boundaries
- FVL-09 active-learning recommendations
- FVL-10 closed-loop retraining workflows
- FVL-11 release closure
- safety/regulatory rewrites
- replacement of existing Cost/Inventory/Compatibility/Advanced Optimizer authorities
- fabricated scientific evidence
- automatic approval

Do not create new task IDs.

# Scientific and data integrity rules

Non-negotiable:
- training data lineage must remain exact
- historical source records are immutable
- missing stays missing
- target leakage is forbidden
- held-out test data cannot drive model selection
- model metrics are not scientific validation by themselves
- uncertainty must not be fabricated
- prediction cannot override safety/regulatory
- insufficient data produces INSUFFICIENT_DATA, not a weak fake model
- all accepted model artifacts are reproducible and checksummed

# Dependencies

Prefer existing project dependencies and simple deterministic implementations.

Do not add large ML frameworks unless truly required by the task and justified by repository constraints.

If existing lightweight libraries can implement defensible baselines/models, prefer them.

Any new dependency must:
- be necessary
- be pinned/recorded according to project conventions
- pass license/security constraints already used by the repo
- not introduce remote/cloud inference

FormuLab remains local-first.

# Versioning

Inspect existing schema/version contracts before any bump.

Only bump serialized versions when contracts actually change.

Model/registry/training artifacts must have explicit versioning sufficient for reproducibility.

Do not silently reinterpret old model artifacts.

# Required validation

After each task, run focused tests.

Before closing FVL-07, run the broadest relevant validation available, including where present:

- shared package tests
- desktop tests
- FVL-05 dataset regression
- FVL-06 measured-response/Data Exchange regression
- new FVL-07 model tests
- TypeScript typecheck
- Rust tests/check if Rust is affected
- Python tests if Python runtime is affected
- lint
- production build
- git diff --check
- canonical TASKS.md ID/count validation

Do not claim tests passed unless actually run.

If an environment limitation blocks a suite:
- record the exact limitation
- run safe substitutes
- do not fake PASS

# Git rules

Work on `main`.

Before starting:
- fetch
- pull --ff-only where possible
- inspect working tree
- preserve unrelated owner changes

Commit meaningful checkpoints.

Suggested grouping:
1. FVL-07.001-.006 eligibility + features
2. FVL-07.007-.011 training + registry
3. FVL-07.012-.015 prediction + OOD + safety gates
4. FVL-07.016 acceptance + milestone closure

Smaller commits are acceptable when they improve auditability.

Push validated commits to `main`.

Never force-push `main`.

Do not create a long-lived branch unless repository protection makes direct-main work impossible.

# TASKS.md state transitions

Start:
- FVL-07.001 -> `[~]`
- Current Task = FVL-07.001
- Current Task Status = IN_PROGRESS
- Next Task = FVL-07.002

Advance sequentially through all sixteen tasks.

Sprint transitions:
- after FVL-07.006, Current Sprint = FVL-07-S02 and Current Task = FVL-07.007
- after FVL-07.011, Current Sprint = FVL-07-S03 and Current Task = FVL-07.012

After FVL-07.016 is fully validated:
- mark FVL-07.016 `[x]`
- Current Milestone = FVL-08
- Current Sprint = FVL-08-S01
- Current Task = FVL-08.001 — Ranking model keeps performance, uncertainty, cost, availability, compatibility, safety, regulatory, manufacturing and evidence dimensions separate
- Current Task Status = READY
- Next Task = FVL-08.002 — Hard rule: Safety/Regulatory FAIL cannot be outweighed by predicted performance
- Required Actor = CODEX
- Blockers/Waits = None unless genuinely blocked
- recalculate completed/remaining/completion exactly

Do not set FVL-08.001 to `[~]`.
FVL-08 must remain unstarted.

# Final report

At the end report:

`FORMULAB FVL-07 MILESTONE COMPLETE`

Include:
- final main HEAD SHA
- commits created
- implementation summary for FVL-07.001-.016
- exact test suites and pass/fail counts
- dataset/feature/model/registry version changes
- algorithms/baselines used
- eligibility thresholds and acceptance policy
- model registry details
- prediction/OOD behavior
- FVL-05/FVL-06 regression status
- TASKS.md final counts
- confirmation FVL-08.001 is READY but NOT STARTED
- known limitations
- working-tree status
- push status

Do not claim milestone completion while any required task or validation remains unresolved.

Begin now and continue autonomously until FVL-07 is complete or a genuine non-resolvable blocker is reached.
