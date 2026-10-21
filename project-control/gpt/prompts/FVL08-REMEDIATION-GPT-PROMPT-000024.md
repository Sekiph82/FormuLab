# FVL08-REMEDIATION-GPT-PROMPT-000024 — Codex Corrective Master Prompt

Repository: https://github.com/Sekiph82/FormuLab
Canonical branch: `main`
Canonical task authority: https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md
Governance: https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md
Original FVL-08 master prompt: https://github.com/Sekiph82/FormuLab/blob/main/project-control/gpt/prompts/FVL08-GPT-PROMPT-000022.md
This remediation prompt: https://github.com/Sekiph82/FormuLab/blob/main/project-control/gpt/prompts/FVL08-REMEDIATION-GPT-PROMPT-000024.md
Actor: CODEX

## Purpose

FVL-08 was previously marked complete, but a strict post-completion source audit found material production-path and acceptance gaps.

Treat the prior FVL-08 closure as **not accepted** until this remediation is fully implemented and independently validated.

Do not start FVL-09 implementation.

The remediation must correct the actual production integration, strengthen negative-path tests, restore truthful canonical task state during remediation, and only then re-close FVL-08.

## Mandatory startup

Before changing code:

1. checkout `main`
2. fetch and pull latest `main`
3. verify current HEAD and working tree
4. read https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md completely
5. read https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md completely
6. read the original FVL-08 master prompt completely
7. inspect the current FVL-08 implementation files listed below
8. inspect FVL-07 prediction/model contracts and existing Advanced Optimizer contracts
9. do not trust prior milestone logs as evidence; verify actual code and tests

Key files to inspect:

- https://github.com/Sekiph82/FormuLab/blob/main/packages/shared/src/schemas/alternativeRanking.ts
- https://github.com/Sekiph82/FormuLab/blob/main/packages/shared/src/engine/alternativeRanking.ts
- https://github.com/Sekiph82/FormuLab/blob/main/apps/desktop/src/lib/alternativeRanking.ts
- https://github.com/Sekiph82/FormuLab/blob/main/apps/desktop/src/app/routes/FormulationResultPage.tsx
- https://github.com/Sekiph82/FormuLab/blob/main/apps/desktop/src/components/formula/AlternativeRankingPanel.tsx
- https://github.com/Sekiph82/FormuLab/blob/main/apps/desktop/src/app/routes/OptimizationPage.tsx
- https://github.com/Sekiph82/FormuLab/blob/main/apps/desktop/src/components/formula/AdvancedOptimizerPanel.tsx
- https://github.com/Sekiph82/FormuLab/blob/main/packages/shared/src/schemas/optimization.ts
- https://github.com/Sekiph82/FormuLab/blob/main/apps/desktop/src-tauri/src/masterdata.rs
- https://github.com/Sekiph82/FormuLab/blob/main/packages/shared/src/engine/predictivePerformance.ts
- https://github.com/Sekiph82/FormuLab/blob/main/packages/shared/src/schemas/predictiveModel.ts

## Canonical tracker correction

Before remediation implementation begins, update `TASKS.md` so the repository no longer claims FVL-08 is accepted while known closure failures are open.

Use the existing FVL-08 task IDs only. Do not create new product task IDs.

Reopen the affected tasks:

- `FVL-08.001` -> `[~]`
- `FVL-08.002` -> `[ ]`
- `FVL-08.003` -> `[ ]`
- `FVL-08.005` -> `[ ]`
- `FVL-08.006` -> `[ ]`
- `FVL-08.007` -> `[ ]`
- `FVL-08.008` -> `[ ]`

Keep `FVL-08.004` complete unless fresh source inspection finds a real Cost Engine authority defect.

Set Project Status to:

- Current Milestone: FVL-08
- Current Sprint: FVL-08-S01
- Current Task: FVL-08.001 — Ranking model keeps performance, uncertainty, cost, availability, compatibility, safety, regulatory, manufacturing and evidence dimensions separate
- Current Task Status: IN_PROGRESS
- Next Task: FVL-08.002 — Hard rule: Safety/Regulatory FAIL cannot be outweighed by predicted performance
- Required Actor: CODEX
- Blockers/Waits: None unless a genuine blocker exists

Recalculate progress counts exactly after reopening.

Commit and push this canonical state transition before claiming remediation is underway.

Do not start FVL-09.

---

# Corrective Finding R1 — Production prediction integration is missing

## Audit finding

The ranking adapter accepts:

`predictions?: ReadonlyMap<string, PredictionResult>`

and reads:

`input.predictions?.get(card.version)`

but the real production call in `FormulationResultPage.tsx` does not pass predictions.

Therefore the ranking production path defaults to `UNAVAILABLE_MODEL` even though FVL-07 prediction infrastructure exists.

## Required remediation

Wire real FVL-07 prediction results into the Formulation Result ranking production path.

Do not fabricate predictions.

Reuse canonical FVL-07 contracts and accepted model registry behavior.

Required behavior:

- load/resolve the correct accepted model by product family and target
- generate the exact model feature row from the exact formula/version context
- call the canonical prediction API
- preserve formula/version lineage
- preserve model ID/version
- preserve target identity/unit
- preserve applicability-domain result
- pass prediction result into `buildAlternativeRankingCandidates`
- no accepted model -> `UNAVAILABLE_MODEL` or equivalent explicit status
- model not accepted -> explicit `MODEL_NOT_ACCEPTED`
- OOD -> explicit `OUT_OF_DOMAIN`
- prediction failure -> explicit non-numeric failure status
- never coerce any of these to zero

If current persisted/session generated alternatives do not yet have the exact saved FormulaVersion identity required by the FVL-07 predictor, implement a truthful bridge that either:

1. promotes/resolves the exact version before prediction, preserving lineage; or
2. explicitly reports prediction unavailable until that identity exists.

Do not invent a fake version ID merely to get a prediction.

## Required tests

Add a real production-path test proving:

accepted model + in-domain formula
-> PredictionResult
-> FormulationResultPage
-> ranking candidate performance = PREDICTED
-> correct model/version/target/value lineage shown

Also add:

- no accepted model
- model not accepted
- OOD
- prediction contract error

Do not leave the only production test asserting "No accepted model prediction is available."

---

# Corrective Finding R2 — Safety/Regulatory BLOCKED alternative can still be optimized

## Audit finding

`AlternativeRankingPanel` renders Optimize for BLOCKED alternatives.

`FormulationResultPage.optimizeAlternative()` also lacks a BLOCKED hard-stop and can promote/navigate a failed alternative into the Advanced Optimizer.

This violates the FVL-08 hard-gate contract.

## Required remediation

Enforce the hard gate at multiple layers.

### UI layer

For a ranking entry with:
- Safety FAIL
- Regulatory FAIL
- disposition BLOCKED because of either gate

the Optimize action must be disabled or not rendered.

The UI must explain why optimization is unavailable.

### Handler/domain layer

Do not rely only on disabled UI.

`optimizeAlternative()` must independently refuse a BLOCKED ranking entry.

The refusal must happen before:
- saveFormulation
- saveFormulationVersion
- navigation to optimizer

Return or surface an explicit hard-gate reason.

### Optimizer boundary

When optimization is opened from a ranked alternative, the optimizer boundary must preserve and re-check the source ranking hard-gate status.

A Safety/Regulatory BLOCKED source alternative must not be allowed to proceed merely by direct URL manipulation.

Do not trust query-string metadata alone.

Resolve the referenced immutable ranking record where applicable and verify the source candidate/disposition before running optimization.

If ranking record is unavailable, the workflow must fail closed for a ranking-originated optimization that claims a hard-gated lineage.

Do not implement a second Safety/Regulatory engine.

Use the persisted ranking snapshot and existing authoritative verdicts.

## Required tests

Add negative-path tests proving:

1. Safety FAIL -> Optimize disabled/not rendered
2. Regulatory FAIL -> same
3. direct handler call cannot optimize BLOCKED
4. no Formulation/FormulationVersion promotion occurs on blocked path
5. direct optimizer URL/query manipulation cannot bypass a persisted BLOCKED ranking
6. PASS alternative still reaches Advanced Optimizer normally

---

# Corrective Finding R3 — Ranking snapshot is optional before optimizer handoff

## Audit finding

Current code only adds `rankingRecordCode` if a previous ranking record exists.

Therefore the workflow can be:

live ranking
-> Optimize
-> OptimizationRun

without an immutable ranking snapshot.

This violates the audit reproducibility requirement.

## Required remediation

A ranking-originated optimizer handoff must have an immutable ranking snapshot.

Implement one of these acceptable patterns:

### Preferred

When Optimize is clicked:
1. create an immutable ranking record from the exact current ranking inputs if one does not already represent the current state
2. persist it successfully
3. verify checksum
4. then navigate to optimizer with its `rankingRecordCode`

### Alternative

Require the user to persist the ranking first and block Optimize until a valid persisted record exists.

Preferred behavior is automatic atomic snapshot creation before handoff because it reduces human error.

Do not reuse an old ranking record merely because it is the latest record for the session unless its checksum/content matches the exact current ranking state.

Add a deterministic way to determine whether an existing ranking snapshot matches the current ranking input.

## Required optimization linkage

Every optimization run launched from ranking must carry:

- source session ID
- source alternative ID
- formula fingerprint if available
- exact rankingRecordCode

Make `rankingRecordCode` required for ranking-originated `sourceAlternative` linkage if the type system can express this safely.

Do not require it for optimizer runs that did not originate from ranking.

## Required tests

Prove:

- Optimize auto-creates or requires an immutable ranking snapshot
- optimization never starts if snapshot persistence fails
- run stores exact rankingRecordCode
- stored ranking checksum verifies
- modified/tampered snapshot is rejected
- stale ranking snapshot is not silently reused for changed ranking inputs

---

# Corrective Finding R4 — OOD/missing prediction integration is only partially tested

## Required remediation

Extend end-to-end production-path coverage so FVL-07 statuses propagate through ranking UI and persistence.

Required statuses to prove:

- PREDICTED
- OUT_OF_DOMAIN
- MODEL_NOT_ACCEPTED
- UNAVAILABLE_MODEL
- prediction/contract error if represented in the current adapter schema

Verify each status:

- remains non-numeric unless actually PREDICTED
- is rendered honestly in UI
- is preserved in persisted ranking snapshot
- does not become zero
- does not become PASS/validated

---

# Corrective Finding R5 — Advanced Optimizer integration must preserve hard gates

## Required remediation

Continue reusing the existing Advanced Optimizer.

Do not create a new optimizer.

But enforce this invariant:

A ranking-originated Safety/Regulatory BLOCKED alternative must never produce a usable optimization run.

If the source ranking snapshot says BLOCKED due to Safety/Regulatory:
- optimizer run action must be refused before solver invocation

For PASS/eligible alternatives:
- existing `runAdvancedFormulationOptimize()` remains the canonical solver path

Record exact source ranking linkage on successful runs.

Add tests that prove the solver bridge is not called for a hard-gated ranked source.

---

# Corrective Finding R6 — UI explanation and action semantics must agree

## Required remediation

Keep the existing per-dimension UI.

Add action consistency:

- BLOCKED => Optimize unavailable
- REVIEW_REQUIRED => may remain allowed only if existing governance permits it; if allowed, clearly label that the user is proceeding with unresolved warnings and do not convert review state to PASS
- ELIGIBLE => Optimize allowed
- UNAVAILABLE formula => Optimize unavailable

Show hard-gate reason adjacent to disabled action or in the card.

Preserve accessibility.

Add UI tests for each disposition.

---

# Corrective Finding R7 — Audit snapshot persistence must be fully reproducible

Current append-only storage design is good and should be preserved.

Verify and strengthen:

- schemaVersion
- rankingPolicyVersion
- all nine dimensions
- source snapshots
- deterministic ordering
- context
- checksum
- immutable storage identity
- exact optimizer linkage

Add/confirm runtime verification of checksum when a ranking snapshot is loaded for a sensitive downstream action such as optimizer handoff.

Do not only verify checksum in isolated unit tests while production reads trust unverified payloads.

A tampered persisted ranking must fail closed.

---

# Corrective Finding R8 — Append-only Rust storage requires targeted validation

The FVL-08 change added `alternative_rankings` to the Rust master-data allow-list as append-only, but the previous closure did not execute Rust tests because the Tauri binary resource was missing.

Remediation must add or identify targeted Rust tests for:

1. first insert into `alternative_rankings` succeeds
2. same code overwrite is refused
3. new code append succeeds
4. delete from append-only collection is refused
5. collection remains allow-listed correctly

Run those targeted tests if the environment can be repaired safely.

If the missing `uv-x86_64-pc-windows-msvc.exe` resource still blocks `cargo test`:

- diagnose why Tauri config requires it
- do not modify unrelated packaging architecture merely to satisfy a test
- if a safe existing repo-supported setup step restores the required binary, use it
- otherwise report the exact blocker and run the maximum static/unit validation available
- do not claim Rust PASS without execution

FVL-08 may not be fully re-accepted if the exact storage invariant changed in Rust cannot be validated at all unless there is equivalent direct proof sufficient under repository policy.

---

# Corrective Finding R9 — Integrated FVL-08 acceptance must be real production path

Rewrite/extend FVL-08.008 acceptance so it proves the actual end-to-end path rather than disconnected unit pieces.

Minimum integrated acceptance matrix:

1. real generated/saved alternative context
2. real Cost Engine snapshot feeds ranking
3. real FVL-07 accepted prediction feeds ranking where eligible
4. OOD prediction remains OOD
5. missing model remains unavailable, not zero
6. Safety FAIL alternative is BLOCKED
7. Regulatory FAIL alternative is BLOCKED
8. BLOCKED alternative cannot be optimized
9. eligible alternative can be optimized
10. exact current ranking is immutably snapshotted before optimizer handoff
11. snapshot checksum verifies
12. optimizer run stores exact rankingRecordCode
13. tampered ranking snapshot blocks downstream optimizer action
14. Advanced Optimizer canonical bridge is used for eligible path
15. optimizer does not run for hard-gated path
16. stored audit inputs reproduce the ranking result
17. UI explanation matches the stored ranking dimensions
18. cost remains Cost Engine sourced
19. no prediction path can create approval
20. Safety/Regulatory remain authoritative after every downstream action

Do not mark FVL-08.008 complete until this integrated matrix passes.

---

# Fresh audit of FVL-08.004

FVL-08.004 was previously judged PASS because production ranking receives a canonical `CostSnapshot` from existing `costGeneratedFormula()`.

Re-verify this during remediation.

If still true:
- leave FVL-08.004 `[x]`

If fresh inspection reveals a bypass or duplicate cost calculation:
- reopen it and fix it

Do not reopen it merely for bookkeeping.

---

# Tracker transitions during remediation

Work sequentially through reopened FVL-08 tasks.

Suggested closure sequence:

1. FVL-08.001 prediction integration
2. FVL-08.002 hard-gate enforcement
3. FVL-08.003 full missing/OOD production propagation
4. FVL-08.005 optimizer safe integration
5. FVL-08.006 action-consistent UI
6. FVL-08.007 mandatory immutable audit snapshot
7. FVL-08.008 integrated acceptance

For each task:
- `[~]` while active
- `[x]` only after focused tests and actual production-path evidence
- advance Project Status atomically

Do not reopen/close all rows in one unverified bookkeeping commit.

---

# Required validation

Run focused tests after each corrective area.

Before re-closing FVL-08, run:

## Shared
- full shared tests
- alternative ranking tests
- predictive performance regressions
- ranking checksum/verification tests

## Desktop
- full desktop tests
- FormulationResultPage tests
- AlternativeRankingPanel tests
- OptimizationPage tests
- AdvancedOptimizerPanel tests
- real ranking -> snapshot -> optimizer integration tests

## Rust
- targeted masterdata append-only tests for `alternative_rankings`
- broader relevant masterdata tests if available

## Project checks
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- canonical TASKS ID/count validation

Run Rust/Python checks only where relevant, but any changed Rust path must receive appropriate Rust validation.

Do not report a suite as passed unless it actually ran.

Existing build warnings are not failures unless new/remediation-related.

---

# Git rules

Work on `main`.

Before changes:
- fetch
- pull --ff-only where possible
- inspect working tree
- preserve unrelated owner changes

Suggested commits:

1. `chore(FVL-08): reopen failed audit tasks`
2. `fix(FVL-08): wire predictions and enforce hard gates`
3. `fix(FVL-08): require immutable ranking snapshot for optimizer handoff`
4. `test(FVL-08): add production-path remediation acceptance`
5. `chore(FVL-08): re-close milestone after strict audit`

Smaller commits are acceptable.

Push validated commits to `main`.

Never force-push.

Do not create a long-lived branch unless repository protection requires it.

---

# Re-closure criteria

FVL-08 may be re-closed only when all of the following are true:

- real FVL-07 predictions reach production ranking
- OOD/unavailable/not-accepted statuses remain explicit
- Safety/Regulatory FAIL cannot optimize
- direct handler bypass is prevented
- optimizer boundary bypass is prevented
- ranking snapshot is mandatory for ranking-originated optimizer handoff
- snapshot checksum is verified on downstream use
- OptimizationRun carries exact rankingRecordCode
- append-only storage invariant is validated
- full integrated acceptance matrix passes
- FVL-08.001-.008 are truthfully complete
- no FVL-09 code was started

Then update `TASKS.md` to:

- Current Milestone: FVL-09
- Current Sprint: FVL-09-S01
- Current Task: FVL-09.001 — Candidate experiment-space definition over existing formula/DOE model
- Current Task Status: READY
- Next Task: FVL-09.002 — Feasibility filtering for materials and manufacturing
- Required Actor: CODEX
- Blockers/Waits: None unless genuine
- recalculate exact counts

Keep FVL-09.001 unchecked.

Do not start FVL-09 implementation.

---

# Final remediation report

At the end report exactly:

`FORMULAB FVL-08 STRICT REMEDIATION COMPLETE`

Include:

- final main HEAD SHA
- commits created
- reopened TASKS state and final TASKS state
- exact fixes for R1-R9
- exact production prediction integration path
- hard-gate enforcement layers
- optimizer bypass prevention proof
- ranking snapshot lifecycle
- checksum verification path
- optimizer linkage details
- Rust append-only validation result
- exact tests/suites run with counts
- typecheck/lint/build/diff-check results
- remaining warnings/limitations
- confirmation that FVL-09.001 is READY but NOT STARTED
- working-tree status
- push status

If any critical criterion remains unresolved, do not re-close FVL-08 and do not advance TASKS to FVL-09.

Begin now and continue autonomously until strict remediation is complete or a genuine non-resolvable blocker is reached.
