# FVL08-REMEDIATION-GPT-PROMPT-000025 — R10 Lineage Binding Corrective Prompt

Repository: https://github.com/Sekiph82/FormuLab
Canonical branch: `main`
Canonical task authority: https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md
Governance: https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md
Prior strict remediation prompt: https://github.com/Sekiph82/FormuLab/blob/main/project-control/gpt/prompts/FVL08-REMEDIATION-GPT-PROMPT-000024.md
This corrective prompt: https://github.com/Sekiph82/FormuLab/blob/main/project-control/gpt/prompts/FVL08-REMEDIATION-GPT-PROMPT-000025.md
Actor: CODEX

## Purpose

A second strict audit found one remaining critical FVL-08 closure defect:

A checksum-valid, ELIGIBLE ranking snapshot for source Formula/Project A can potentially be paired with a different `project=B` in the optimizer URL because the ranking snapshot is not yet cryptographically/structurally bound to the actual project/formula-version being optimized.

This is a lineage and hard-gate boundary defect.

FVL-08 is not accepted until this is fixed and validated.

Do not start FVL-09 implementation.

## Mandatory startup

1. checkout `main`
2. fetch and pull latest `main`
3. verify working tree
4. read https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md
5. read https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md
6. read https://github.com/Sekiph82/FormuLab/blob/main/project-control/gpt/prompts/FVL08-REMEDIATION-GPT-PROMPT-000024.md
7. inspect current ranking, optimizer, FormulationVersion, and workspace contracts
8. verify all claims against actual source, not previous logs

## Tracker correction

Reopen only the affected FVL-08 tasks needed for this correction.

At minimum:
- `FVL-08.005` -> `[~]`
- `FVL-08.007` -> `[ ]`
- `FVL-08.008` -> `[ ]`

Set:
- Current Milestone: FVL-08
- Current Sprint: FVL-08-S01
- Current Task: FVL-08.005 — Optimization pass reuses existing Advanced Optimizer
- Current Task Status: IN_PROGRESS
- Next Task: FVL-08.007 — Persistence + audit trail for every ranking input
- Required Actor: CODEX

Recalculate counts exactly.

Do not touch FVL-09 implementation.

## R10 — Exact ranking-to-project/formula-version binding

### Audit defect

The verified ranking record currently proves:
- source session
- source alternative
- ranking checksum
- candidate disposition
- optional formula fingerprint

but does not prove that the actual optimizer workspace `projectId` and exact saved `FormulationVersion` belong to that same ranked candidate.

Therefore a valid eligible ranking record for Formula A may be paired with unrelated Project B via URL manipulation unless explicitly rejected.

### Required invariant

For every ranking-originated optimization:

`ranking snapshot candidate -> exact source FormulationVersion -> exact source Formulation/project -> optimizer workspace project`

must be one unbroken verified chain.

No mismatch may reach the solver.

## Required implementation

### 1. Persist exact source version identity

Ranking candidates already support `sourceFormulationVersionId`.

Require this identity for ranking-originated optimization when the candidate has been bridged/saved for prediction/optimization.

Preserve it inside the checksum-covered ranking snapshot.

Do not invent or infer a version ID.

### 2. Extend ranking-origin source contract

For the strict `origin: "ranking"` sourceAlternative contract, include:

- `sourceFormulationVersionId`

If a direct `sourceFormulationId` is useful and canonical, include it too, but do not duplicate authority unnecessarily.

Preserve backward readability of historical pre-remediation optimization runs.

### 3. Verify exact FormulationVersion

At optimizer handoff:

- resolve the persisted ranking record
- verify checksum
- resolve ranked candidate
- verify candidate is optimizable
- require `sourceFormulationVersionId`
- load the exact saved FormulationVersion
- resolve its owning Formulation
- prove that owning Formulation.id equals the optimizer `projectId`

If not:
- fail closed
- do not render runnable optimizer controls
- do not invoke solver
- do not persist optimization run

### 4. Verify formula fingerprint against actual saved version

Where a ranking candidate carries `formulaFingerprint`:

- deterministically derive/recompute the fingerprint of the exact saved source formula/version using the same canonical representation used when ranking was created
- compare it to the snapshot fingerprint
- mismatch => fail closed

Do not trust the query-string fingerprint as authority.

The query string is only a locator/request hint.

The immutable ranking record plus persisted source record is the authority.

### 5. Bind OptimizationPage to verified project identity

Update:

https://github.com/Sekiph82/FormuLab/blob/main/apps/desktop/src/app/routes/OptimizationPage.tsx

so a ranking-originated route validates the current `projectId` against the ranking source lineage before rendering `AdvancedOptimizerPanel`.

Required negative behavior:

`ranking=A + project=B`

must display a blocking error and never render the runnable optimizer.

### 6. Re-check at solver boundary

Do not rely solely on the route-level check.

Before `runAdvancedFormulationOptimize()`:

- re-resolve/verify the immutable ranking source
- verify exact project/formula-version binding again, or consume a typed verified source object that can only be created after that verification

A stale/tampered/mismatched ranking-origin source must never reach the solver.

### 7. Persist exact lineage on OptimizationRun

For ranking-originated runs, persist at minimum:

- rankingRecordCode
- source session ID
- source alternative ID
- sourceFormulationVersionId
- formula fingerprint where present

The resulting OptimizationRun must unambiguously identify the exact ranked source version.

### 8. Regulatory hard-gate integrity

Freshly inspect whether the Advanced Optimizer itself has a regulatory policy dimension.

Do not invent a duplicate Regulatory engine merely to satisfy this correction.

The required invariant is:

If the source ranking candidate is Regulatory FAIL, it cannot enter the optimizer at all.

This must be enforced by the verified ranking hard gate before solver invocation.

Add an explicit regression proving a Regulatory FAIL source cannot be bypassed by substituting a different `project` parameter.

## Required negative tests

Add all of these:

1. valid ELIGIBLE ranking A + project A -> PASS
2. valid ELIGIBLE ranking A + project B -> FAIL CLOSED
3. valid ranking A + wrong sourceFormulationVersionId -> FAIL CLOSED
4. valid ranking A + persisted source version whose formula content no longer matches expected fingerprint -> FAIL CLOSED
5. Safety FAIL ranking A + project B -> FAIL CLOSED
6. Regulatory FAIL ranking A + project B -> FAIL CLOSED
7. checksum-invalid snapshot -> FAIL CLOSED
8. missing sourceFormulationVersionId for strict ranking-origin handoff -> FAIL CLOSED
9. solver call count remains zero for every failed lineage/hard-gate case
10. optimization_runs write count remains zero for every failed case
11. successful run persists exact rankingRecordCode + sourceFormulationVersionId
12. direct URL manipulation cannot bypass the binding

## Acceptance test

Extend the strict FVL-08 production acceptance so it proves:

generated/saved candidate
-> exact FormulationVersion
-> accepted FVL-07 prediction
-> ranking snapshot
-> checksum verification
-> exact sourceFormulationVersionId
-> exact owning Formulation/project
-> OptimizationPage project binding
-> Advanced Optimizer boundary re-verification
-> solver
-> OptimizationRun with exact immutable source lineage

Also prove the same flow fails when only `project` is changed.

## Required validation

Run:

- focused rankingOptimization tests
- OptimizationPage tests
- AdvancedOptimizerPanel tests
- strict FVL-08 acceptance
- full shared tests
- full desktop tests
- targeted Rust masterdata tests if Rust schema/storage is changed
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- TASKS count/ID validation

Do not claim a test passed unless executed.

## Re-closure

Only after every R10 acceptance criterion passes:

- FVL-08.005 -> `[x]`
- FVL-08.007 -> `[x]`
- FVL-08.008 -> `[x]`

Then restore:

- Current Milestone: FVL-09
- Current Sprint: FVL-09-S01
- Current Task: FVL-09.001 — Candidate experiment-space definition over existing formula/DOE model
- Current Task Status: READY
- Next Task: FVL-09.002 — Feasibility filtering for materials and manufacturing
- Required Actor: CODEX

Keep FVL-09.001 unchecked.

Do not implement FVL-09.

## Final report

Report:

`FORMULAB FVL-08 R10 LINEAGE REMEDIATION COMPLETE`

Include:
- final HEAD
- commits
- tracker reopen/close states
- exact lineage-binding implementation
- project mismatch handling
- sourceFormulationVersionId handling
- fingerprint verification
- Safety/Regulatory bypass tests
- solver-call negative evidence
- optimization-run lineage evidence
- all test counts
- warnings/limitations
- FVL-09.001 READY but NOT STARTED
- clean worktree/push status

If any critical lineage binding criterion remains unresolved, do not close FVL-08.

Begin now and continue autonomously until R10 is complete or a genuine non-resolvable blocker is reached.
