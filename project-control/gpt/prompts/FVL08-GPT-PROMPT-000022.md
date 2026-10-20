# FVL08-GPT-PROMPT-000022 — Codex Master Execution Prompt

Repository: https://github.com/Sekiph82/FormuLab
Canonical branch: `main`
Canonical task authority: https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md
Governance: https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md
Codex master prompt: https://github.com/Sekiph82/FormuLab/blob/main/project-control/gpt/prompts/FVL08-GPT-PROMPT-000022.md
Actor: CODEX

## Objective

Complete the entire FVL-08 milestone in strict task order and push validated results to `main`.

Canonical scope:

### Sprint FVL-08-S01 — Performance ranking & optimizer integration
1. `FVL-08.001` — Ranking model keeps performance, uncertainty, cost, availability, compatibility, safety, regulatory, manufacturing and evidence dimensions separate
2. `FVL-08.002` — Hard rule: Safety/Regulatory FAIL cannot be outweighed by predicted performance
3. `FVL-08.003` — Missing or out-of-domain prediction never masquerades as validated zero
4. `FVL-08.004` — Cost dimension sourced only from existing Cost Engine
5. `FVL-08.005` — Optimization pass reuses existing Advanced Optimizer

### Sprint FVL-08-S02 — Explainability, audit & acceptance
6. `FVL-08.006` — UI explains ranking by per-dimension breakdown
7. `FVL-08.007` — Persistence + audit trail for every ranking input
8. `FVL-08.008` — Regression acceptance: Safety-FAIL alternative never outranks a passing one

Do not start FVL-09 implementation.

## Source of truth and startup

Before changing code:

1. checkout `main`
2. fetch and pull latest `main`
3. read https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md completely
4. read https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md completely
5. treat https://github.com/Sekiph82/FormuLab/blob/main/CLAUDE.md as compatibility-only
6. inspect FVL-03 authoritative Safety, Regulatory, Compatibility, Cost, Inventory, and Advanced Optimizer integrations
7. inspect FVL-07 prediction, uncertainty, applicability-domain, model-registry, and product-family/target contracts
8. inspect existing formulation alternative/card/result UI and persistence/audit structures before adding ranking surfaces
9. inspect existing Advanced Optimizer API before introducing any optimization glue

https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md is the only authoritative task-state ledger.

Codex is the primary implementation/execution agent.

Do not create:
- alternate task trackers
- competing dashboards
- `.hiveai` task/state/handoff/event files
- duplicate ranking authorities
- a second Cost Engine
- a second Safety/Regulatory/Compatibility authority
- a replacement Advanced Optimizer
- a scalar “magic score” that destroys dimension-level meaning

## Execution behavior

Work continuously from FVL-08.001 through FVL-08.008.

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

# FVL-08.001 — Multi-dimensional ranking model

Implement ranking as an explicit multi-dimensional decision model.

Required dimensions remain separate:
- predicted performance
- prediction uncertainty where supported
- cost
- availability
- compatibility
- safety
- regulatory
- manufacturing feasibility
- evidence quality/coverage

Do not collapse these dimensions into an opaque score without preserving the component values and gate semantics.

If a composite ordering is needed:
- preserve every dimension in the result
- make weighting/priority rules explicit
- version the ranking policy
- keep hard gates distinct from soft preferences
- make tie-breaking deterministic

Missing dimensions must remain explicitly missing/unknown, not zero.

Prediction status must distinguish:
- valid/in-domain
- missing
- insufficient data
- out-of-domain/refused
- unavailable model

Add tests for deterministic ranking, missing dimensions, ties, and policy versioning.

---

# FVL-08.002 — Safety/Regulatory hard gates

Hard rule:

A Safety FAIL or Regulatory FAIL cannot be outweighed by predicted performance, low cost, availability, or any other positive dimension.

Use existing authoritative engines from FVL-03.

Do not derive a second safety/regulatory verdict inside ranking.

Required behavior:
- Safety FAIL => alternative cannot rank as preferred over a passing eligible alternative
- Regulatory FAIL => same
- if both fail, preserve both reasons
- UNKNOWN/UNVERIFIED must not silently become PASS
- prediction service cannot write/modify safety or regulatory approval

Add explicit regression tests where a failing alternative has dramatically better predicted performance and still cannot win.

---

# FVL-08.003 — Missing/OOD prediction semantics

Missing, insufficient-data, unavailable, or out-of-domain prediction must never masquerade as validated zero performance.

Required distinctions:
- valid prediction
- no accepted model
- insufficient training data
- missing required features
- OOD/refused
- prediction engine error/invalid contract

Ranking must preserve this status.

Do not:
- coerce missing prediction to 0
- treat OOD refusal as low score
- fabricate uncertainty
- silently substitute another product-family/target model

Define deterministic fallback ranking behavior for alternatives without usable predictions without pretending they are measured or predicted zeros.

Add tests proving explicit status survives UI/persistence/audit.

---

# FVL-08.004 — Cost dimension from existing Cost Engine only

The cost dimension must come only from the canonical existing Cost Engine.

Audit existing cost APIs and provenance.

Do not:
- recompute ingredient cost inside ranking
- invent fallback prices
- use stale “latest” data where historical/frozen cost context is required
- duplicate currency conversion logic

Ranking receives canonical cost result plus relevant provenance/status.

Preserve:
- value/currency
- missing/unavailable status
- cost snapshot/source context where supported

Add tests proving ranking cannot diverge from canonical Cost Engine output.

---

# FVL-08.005 — Reuse existing Advanced Optimizer

Optimization pass must reuse existing Advanced Optimizer.

Do not create a parallel optimizer.

Clarify separation of concerns:
- ranking evaluates/explains alternatives
- Advanced Optimizer performs permitted refinement/optimization
- hard Safety/Regulatory gates remain authoritative
- optimizer cannot convert a failed alternative into accepted by score manipulation

Where optimization is optional:
- preserve pre-optimization alternative identity/state
- link optimized result to source alternative
- preserve provenance of changes
- expose whether optimization ran and with what configuration

Add integration tests proving existing optimizer is invoked through canonical API and ranking remains dimension-aware before/after optimization.

---

# FVL-08.006 — UI per-dimension explanation

UI must explain why alternatives rank as they do.

Reuse existing formulation result/card UI patterns.

Expose per-dimension breakdown, including status and provenance cues where practical:
- performance
- uncertainty
- cost
- availability
- compatibility
- safety
- regulatory
- manufacturing
- evidence

Hard-gate reasons must be visually unmistakable.

Do not present a single composite number as if it were the whole explanation.

Missing/OOD/insufficient prediction must be labeled honestly.

Keep accessibility and existing design conventions.

Add frontend tests for:
- passing alternative
- Safety FAIL
- Regulatory FAIL
- missing prediction
- OOD prediction
- missing cost
- dimension explanation rendering

---

# FVL-08.007 — Persistence and audit trail

Persist/audit every ranking input needed to reproduce the decision.

At minimum record:
- ranking policy/version
- alternative/formula version identity
- prediction model/version + prediction status/value/uncertainty
- cost result/provenance
- availability result
- compatibility result
- safety verdict
- regulatory verdict
- manufacturing result
- evidence dimension inputs
- weights/priorities if any
- optimizer invocation/configuration/result linkage
- timestamp
- deterministic final ordering/rank

Do not persist secrets or machine-local transient paths as authoritative audit data.

Audit record must be immutable/versioned according to existing project conventions.

Add round-trip/reproducibility tests.

---

# FVL-08.008 — Milestone regression acceptance

Create integrated regression acceptance proving the ranking architecture end to end.

At minimum cover:

1. Safety-FAIL alternative with highest predicted performance never outranks an eligible PASS alternative
2. Regulatory-FAIL same behavior
3. Missing prediction is not zero
4. OOD prediction is not zero and remains refused
5. Cost comes from canonical Cost Engine
6. Compatibility/availability/manufacturing dimensions remain separate
7. Ranking is deterministic for identical inputs/policy
8. UI explanation matches stored ranking inputs
9. Audit/persistence round-trip reproduces ranking result
10. Advanced Optimizer integration reuses canonical optimizer
11. Optimizer cannot override hard safety/regulatory gates
12. Evidence dimension remains distinct from predicted performance
13. No prediction path auto-approves regulated records

Use real existing domain contracts, not a disconnected mock-only ranking toy.

Do not call FVL-08 complete unless integrated acceptance passes.

---

# Scope control

Allowed:
- ranking policy/contracts
- integration with existing prediction/cost/availability/compatibility/safety/regulatory/manufacturing/evidence results
- Advanced Optimizer integration
- ranking persistence/audit
- ranking explanation UI
- tests
- TASKS.md updates
- minimal supporting schema/type changes

Not allowed:
- FVL-09 experiment recommendation/active learning
- FVL-10 closed-loop retraining lineage
- FVL-11 release closure
- replacement safety/regulatory/cost engines
- new optimization engine
- automatic laboratory execution
- automatic human approval
- fabricated prediction/evidence values
- unrelated UI redesign

Do not create new task IDs.

# Decision integrity rules

Non-negotiable:
- hard Safety/Regulatory gates are not soft scores
- UNKNOWN/UNVERIFIED is not PASS
- missing prediction is not zero
- OOD/refused prediction is not zero
- uncertainty remains separate from performance
- cost comes only from Cost Engine
- compatibility remains separate
- availability remains separate
- manufacturing remains separate
- evidence quality remains separate
- ranking must remain explainable and reproducible
- prediction cannot authorize regulated decisions
- optimizer cannot override hard gates

# Versioning

Version the ranking policy if persisted or relied on for reproducibility.

Only bump existing serialized schema versions when their contracts actually change.

Do not silently reinterpret historical ranking/audit artifacts.

# Required validation

After each task, run focused tests.

Before closing FVL-08, run the broadest relevant validation available, including where present:

- shared package tests
- desktop tests
- FVL-03 authoritative-engine regressions relevant to ranking
- FVL-05 dataset regressions
- FVL-06 measured-response regressions
- FVL-07 prediction/model regressions
- new FVL-08 ranking/audit/UI tests
- TypeScript typecheck
- Rust tests/check if Rust is affected
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
1. FVL-08.001-.005 ranking + hard gates + optimizer integration
2. FVL-08.006-.007 UI + persistence/audit
3. FVL-08.008 acceptance + milestone closure

Smaller commits are acceptable when they improve auditability.

Push validated commits to `main`.

Never force-push `main`.

Do not create a long-lived branch unless repository protection makes direct-main work impossible.

# TASKS.md state transitions

Start:
- FVL-08.001 -> `[~]`
- Current Task = FVL-08.001
- Current Task Status = IN_PROGRESS
- Next Task = FVL-08.002

Advance sequentially through all eight tasks.

After FVL-08.005:
- Current Sprint = FVL-08-S02
- Current Task = FVL-08.006

After FVL-08.008 is fully validated:
- mark FVL-08.008 `[x]`
- Current Milestone = FVL-09
- Current Sprint = FVL-09-S01
- Current Task = FVL-09.001 — Candidate experiment-space definition over existing formula/DOE model
- Current Task Status = READY
- Next Task = FVL-09.002 — Feasibility filtering for materials and manufacturing
- Required Actor = CODEX
- Blockers/Waits = None unless genuinely blocked
- recalculate completed/remaining/completion exactly

Do not set FVL-09.001 to `[~]`.
FVL-09 must remain unstarted.

# Final report

At the end report:

`FORMULAB FVL-08 MILESTONE COMPLETE`

Include:
- final main HEAD SHA
- commits created
- implementation summary for FVL-08.001-.008
- exact test suites and pass/fail counts
- ranking policy/version
- hard-gate behavior
- cost-engine integration
- Advanced Optimizer integration
- UI explanation behavior
- persistence/audit details
- FVL-03/FVL-07 regression status
- TASKS.md final counts
- confirmation FVL-09.001 is READY but NOT STARTED
- known limitations
- working-tree status
- push status

Do not claim milestone completion while any required task or validation remains unresolved.

Begin now and continue autonomously until FVL-08 is complete or a genuine non-resolvable blocker is reached.
