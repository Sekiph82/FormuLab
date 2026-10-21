# FVL09-GPT-PROMPT-000023 — Codex Master Execution Prompt

Repository: https://github.com/Sekiph82/FormuLab
Canonical branch: `main`
Canonical task authority: https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md
Governance: https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md
Codex master prompt: https://github.com/Sekiph82/FormuLab/blob/main/project-control/gpt/prompts/FVL09-GPT-PROMPT-000023.md
Actor: CODEX

## Objective

Complete the entire FVL-09 milestone in strict task order and push validated results to `main`.

Canonical scope:

### Sprint FVL-09-S01 — Experiment recommendation engine
1. `FVL-09.001` — Candidate experiment-space definition over existing formula/DOE model
2. `FVL-09.002` — Feasibility filtering for materials and manufacturing
3. `FVL-09.003` — Safety/regulatory hard-exclusion filtering
4. `FVL-09.004` — Uncertainty + defensible acquisition criterion
5. `FVL-09.005` — Diversity + estimated experiment cost where real cost data exists

### Sprint FVL-09-S02 — DOE/laboratory execution loop
6. `FVL-09.006` — DOE integration: recommendation ranking + rationale in existing workflow
7. `FVL-09.007` — Human selection required; no automatic lab execution
8. `FVL-09.008` — Create/link real LaboratoryTrial or DOE run from accepted recommendation
9. `FVL-09.009` — Completed-experiment ingestion triggers versioned model retraining
10. `FVL-09.010` — Regression test: unperformed recommendation is never labeled validated

Do not start FVL-10 implementation.

## Source of truth and startup

Before changing code:

1. checkout `main`
2. fetch and pull latest `main`
3. read https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md completely
4. read https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md completely
5. treat https://github.com/Sekiph82/FormuLab/blob/main/CLAUDE.md as compatibility-only
6. inspect FVL-07 model eligibility, prediction, uncertainty, OOD, registry, and retraining contracts
7. inspect FVL-08 ranking, hard-gate, cost, optimizer, persistence, and explainability contracts
8. inspect existing Formula, DOE, LaboratoryTrial, TestResult, sample, corrective-action, and workflow models
9. inspect existing material availability, manufacturing feasibility, Safety, Regulatory, Cost Engine, and Advanced Optimizer APIs before adding recommendation logic

https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md is the only authoritative task-state ledger.

Codex is the primary implementation/execution agent.

Do not create:
- alternate task trackers
- competing dashboards
- `.hiveai` task/state/handoff/event files
- a second DOE engine
- a second laboratory workflow
- a second Cost/Safety/Regulatory authority
- automatic lab execution
- automatic approval
- fabricated scientific validation

## Execution behavior

Work continuously from FVL-09.001 through FVL-09.010.

Do not stop after each task for approval.

Only stop for a genuine non-resolvable blocker.

At task start:
- mark task `[~]`
- set Current Task appropriately
- set Current Task Status = IN_PROGRESS
- keep Next Task accurate

At validated completion:
- mark task `[x]`
- advance Current Task / Next Task atomically
- keep progress counts exact

Do not mark complete merely because code exists. Completion requires implementation plus focused validation.

---

# FVL-09.001 — Candidate experiment-space definition

Define a bounded candidate experiment space over the existing formula and DOE models.

Do not invent a parallel experiment model.

Reuse existing:
- formulation/formula-version identity
- DOE study/design/run structures
- material identity and ranges
- process parameter definitions
- laboratory/test context
- product-family boundaries

Candidate generation must be:
- deterministic for identical inputs/configuration
- versioned/configurable
- reproducible
- bounded to scientifically and operationally meaningful dimensions already present in the domain
- lineage-aware

Do not generate arbitrary combinations from unknown ranges.

If a factor/range is absent, do not fabricate one.

Each candidate must preserve exact linkage to:
- source formula/version
- manipulated variables
- unchanged variables
- DOE or recommendation context
- configuration/version used to create the candidate

Add tests for deterministic candidate generation, boundedness, lineage, and empty/invalid spaces.

---

# FVL-09.002 — Feasibility filtering

Filter recommendation candidates using canonical material and manufacturing feasibility.

Reuse existing authorities for:
- material availability/inventory
- material identity
- equipment/manufacturing constraints
- process constraints
- compatibility where relevant

Do not implement duplicate feasibility logic.

A candidate that cannot be manufactured or lacks required materials must be excluded or explicitly marked infeasible according to existing project semantics.

Missing availability data must not become available=true.

Preserve human-readable and machine-readable rejection reasons.

Add tests for:
- available/feasible candidate
- missing material
- insufficient availability
- manufacturing constraint failure
- missing/unknown feasibility state
- deterministic filter behavior

---

# FVL-09.003 — Safety/regulatory hard exclusion

Safety and Regulatory remain hard authorities.

A candidate with authoritative Safety FAIL or Regulatory FAIL must not enter the recommendation shortlist.

UNKNOWN/UNVERIFIED must not silently become PASS.

Use existing FVL-03/FVL-08 authorities.

Do not recalculate or reinterpret regulated verdicts inside recommendation logic.

Preserve exclusion reasons and source verdict provenance.

Add tests proving a candidate with excellent predicted performance/acquisition value is excluded when Safety or Regulatory is FAIL.

---

# FVL-09.004 — Uncertainty + defensible acquisition criterion

Implement a defensible acquisition criterion for choosing informative next experiments.

The criterion must use only information that actually exists, such as:
- accepted model prediction
- uncertainty when the model supports defensible uncertainty
- applicability-domain status
- existing measured observations
- candidate feasibility

Do not fabricate uncertainty.

Do not substitute an arbitrary confidence score for model-supported uncertainty.

If uncertainty is unavailable, either:
- use an explicitly defined fallback criterion that does not pretend uncertainty exists, or
- declare the criterion unavailable for that candidate

Acquisition policy/configuration must be explicit and versioned if persisted.

The criterion must not override safety/regulatory hard exclusions.

Add tests for:
- supported uncertainty
- no uncertainty support
- OOD/refused prediction
- missing model
- deterministic ordering
- ties

---

# FVL-09.005 — Diversity + estimated experiment cost

Recommendation shortlist must avoid near-duplicate experiments when multiple defensible candidates exist.

Diversity must be computed from explicit candidate features/factors, not opaque heuristics.

Estimated experiment cost may be included only where real cost data exists.

Use canonical Cost Engine outputs.

Do not:
- fabricate cost
- assign missing cost as zero
- duplicate currency conversion
- let cheap cost override Safety/Regulatory exclusion

Preserve:
- acquisition value
- diversity contribution/status
- estimated experiment cost/status
- final recommendation rationale

Add tests for diversity, duplicate suppression, real-cost usage, and missing-cost semantics.

---

# FVL-09.006 — DOE integration

Integrate recommendation ranking and rationale into the existing DOE workflow.

Do not create a parallel recommendation-only DOE workflow.

Recommendations must be visible as proposals linked to existing DOE/formula context.

Each recommendation should expose:
- source formula/version
- manipulated factors/values
- predicted outcome if available
- uncertainty if available
- acquisition rationale
- feasibility status
- safety/regulatory status
- diversity rationale
- estimated cost where available
- model/version provenance
- recommendation policy/version

Reuse existing UI/workflow patterns.

Add tests for DOE linkage and rationale rendering/serialization where applicable.

---

# FVL-09.007 — Human selection required

Human selection is mandatory before any recommendation becomes an executable laboratory/DOE action.

No automatic lab execution.

No automatic trial creation merely because a recommendation ranked first.

No automatic approval.

Required state distinction:
- recommended
- selected/accepted by human
- converted to executable trial/run
- executed/completed
- validated result where applicable

Recommendation ranking must never imply laboratory validation.

Add tests proving no LaboratoryTrial/DOE run is created until the explicit human-selection gate is satisfied.

---

# FVL-09.008 — Create/link real LaboratoryTrial or DOE run

After explicit human acceptance, create or link the real existing LaboratoryTrial or DOE run using canonical APIs.

Do not create a duplicate lab record model.

Preserve lineage from:
recommendation -> accepted recommendation -> trial/DOE run

Record:
- recommendation ID/version
- formula/version
- selected factors
- human actor/selection event according to existing audit semantics
- resulting trial/run identity

Do not overwrite the recommendation after execution begins; append/link immutable lifecycle evidence according to current project conventions.

Add integration tests for accepted recommendation -> real trial/run linkage.

---

# FVL-09.009 — Completed experiment ingestion and versioned retraining

Only completed, valid experiment results may enter the next dataset/model-training cycle.

Reuse:
- FVL-06 measured-response ingestion
- FVL-05 dataset build/fingerprint
- FVL-07 eligibility/training/model registry

Completed experiment ingestion must create a new versioned data/model lineage where eligibility permits.

Do not mutate previous datasets/models.

Do not claim retraining if:
- experiment is not completed
- result is missing/invalid
- data remains insufficient

Required lineage:
recommendation -> trial/run -> result -> dataset version/fingerprint -> training run -> new model version

If data remains insufficient, return the structured FVL-07 insufficient-data outcome.

Add tests for:
- completed valid experiment
- incomplete experiment
- invalid/missing result
- retraining eligible
- retraining still insufficient
- prior model remains immutable

---

# FVL-09.010 — Milestone regression acceptance

Create integrated regression acceptance proving the full recommendation loop.

At minimum cover:

1. candidate space uses existing formula/DOE model
2. infeasible candidates are filtered
3. Safety FAIL candidates are excluded
4. Regulatory FAIL candidates are excluded
5. UNKNOWN/UNVERIFIED is not PASS
6. uncertainty is used only when defensible
7. OOD/refused prediction is not treated as valid
8. recommendation ranking is deterministic
9. diversity prevents redundant shortlist padding
10. experiment cost comes only from real Cost Engine data
11. recommendation remains unvalidated until performed
12. no automatic trial/run creation before human selection
13. accepted recommendation links to real LaboratoryTrial/DOE run
14. completed experiment can feed FVL-05/FVL-06 data path
15. retraining creates new versioned lineage only when eligible
16. prior datasets/models remain immutable
17. unperformed recommendation is never labeled validated

Use real project contracts, not a disconnected mock-only recommendation toy.

Do not call FVL-09 complete unless integrated acceptance passes.

---

# Scope control

Allowed:
- candidate experiment generation
- feasibility filtering
- safety/regulatory exclusions
- acquisition policy
- diversity
- experiment-cost integration
- DOE/lab recommendation workflow integration
- explicit human selection gate
- real LaboratoryTrial/DOE-run linkage
- completed-result ingestion integration
- versioned retraining trigger/integration
- tests
- TASKS.md updates
- minimal UI changes required by existing workflow

Not allowed:
- FVL-10 full closed-loop lineage architecture beyond what FVL-09 strictly needs
- FVL-11 release closure
- automatic laboratory execution
- automatic approval
- replacement DOE/lab workflow
- replacement Cost/Safety/Regulatory engines
- fabricated uncertainty
- fabricated experimental validation
- unrelated UI redesign

Do not create new task IDs.

# Scientific and decision integrity rules

Non-negotiable:
- recommendation is not validation
- unperformed recommendation is never “validated”
- human selection is required
- safety/regulatory FAIL is hard exclusion
- UNKNOWN/UNVERIFIED is not PASS
- uncertainty must not be fabricated
- OOD/refused predictions are not valid predictions
- missing experiment cost is not zero
- completed result is required before retraining ingestion
- historical datasets/models are immutable
- retraining creates versioned lineage
- no AI auto-approval

# Versioning

Version recommendation/acquisition policy if persisted.

Only bump existing schema versions when serialized contracts actually change.

Preserve backward compatibility with existing DOE/lab records.

Do not silently reinterpret historical recommendation records.

# Required validation

After each task, run focused tests.

Before closing FVL-09, run the broadest relevant validation available, including where present:

- shared package tests
- desktop tests
- FVL-05 dataset regressions
- FVL-06 measured-response/Data Exchange regressions
- FVL-07 model/prediction regressions
- FVL-08 ranking/hard-gate/audit regressions
- new FVL-09 recommendation/DOE/lab tests
- TypeScript typecheck
- Rust tests/check if Rust is affected and environment supports them
- Python tests if Python runtime is affected
- lint
- production build
- git diff --check
- canonical TASKS.md count/ID validation

Do not claim tests passed unless actually run.

If an environment limitation blocks a suite:
- record exact limitation
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
1. FVL-09.001-.005 recommendation engine
2. FVL-09.006-.008 DOE/lab human-gated execution integration
3. FVL-09.009-.010 retraining integration + acceptance + milestone closure

Smaller commits are acceptable when they improve auditability.

Push validated commits to `main`.

Never force-push `main`.

Do not create a long-lived branch unless repository protection makes direct-main work impossible.

# TASKS.md state transitions

Start:
- FVL-09.001 -> `[~]`
- Current Task = FVL-09.001
- Current Task Status = IN_PROGRESS
- Next Task = FVL-09.002

Advance sequentially through all ten tasks.

After FVL-09.005:
- Current Sprint = FVL-09-S02
- Current Task = FVL-09.006

After FVL-09.010 is fully validated:
- mark FVL-09.010 `[x]`
- Current Milestone = FVL-10
- Current Sprint = FVL-10-S01
- Current Task = FVL-10.001 — ID/provenance model spanning the full laboratory-feedback chain
- Current Task Status = READY
- Next Task = FVL-10.002 — Immutable references; later stages cite and never rewrite earlier records
- Required Actor = CODEX
- Blockers/Waits = None unless genuinely blocked
- recalculate completed/remaining/completion exactly

Do not set FVL-10.001 to `[~]`.
FVL-10 must remain unstarted.

# Final report

At the end report:

`FORMULAB FVL-09 MILESTONE COMPLETE`

Include:
- final main HEAD SHA
- commits created
- implementation summary for FVL-09.001-.010
- exact test suites and pass/fail counts
- recommendation/acquisition policy version
- feasibility and hard-exclusion behavior
- uncertainty/OOD behavior
- diversity and cost behavior
- DOE/lab human-selection workflow
- trial/run linkage behavior
- completed-result ingestion and retraining behavior
- FVL-05/06/07/08 regression status
- TASKS.md final counts
- confirmation FVL-10.001 is READY but NOT STARTED
- known limitations
- working-tree status
- push status

Do not claim milestone completion while any required task or validation remains unresolved.

Begin now and continue autonomously until FVL-09 is complete or a genuine non-resolvable blocker is reached.
