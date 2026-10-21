# FVL10-GPT-PROMPT-000027 — Codex Master Execution Prompt

Repository: https://github.com/Sekiph82/FormuLab
Canonical branch: `main`
Canonical task authority: https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md
Governance: https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md
Codex master prompt: https://github.com/Sekiph82/FormuLab/blob/main/project-control/gpt/prompts/FVL10-GPT-PROMPT-000027.md
Actor: CODEX

## Objective

Complete the entire FVL-10 milestone in strict task order and push validated results to `main`.

Canonical scope:

### Sprint FVL-10-S01 — Closed-loop lineage foundation
1. `FVL-10.001` — ID/provenance model spanning the full laboratory-feedback chain
2. `FVL-10.002` — Immutable references; later stages cite and never rewrite earlier records
3. `FVL-10.003` — Version relationships across formula, trial, result, dataset, model, prediction and recommendation
4. `FVL-10.004` — Corrective-action-derived draft linkage
5. `FVL-10.005` — DOE-derived draft linkage
6. `FVL-10.006` — Phase-14-generated draft linkage to generation session

### Sprint FVL-10-S02 — Model/retraining/UI linkage & gates
7. `FVL-10.007` — Prediction source-model linkage
8. `FVL-10.008` — Retraining lineage linking new data to model version
9. `FVL-10.009` — UI navigation across the full chain + audit trail view
10. `FVL-10.010` — Failure/retry behavior and human gates; no model may rewrite laboratory results

Do not start FVL-11 implementation.

## Mandatory startup

Before changing code:

1. checkout `main`
2. fetch and pull latest `main`
3. verify local HEAD equals remote `main`
4. inspect working tree and preserve unrelated owner changes
5. read https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md completely
6. read https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md completely
7. inspect FVL-05 through FVL-09 source contracts and strict-remediation paths
8. inspect current schemas for Formulation, FormulationVersion, LaboratoryTrial, TestResult, DOE run/candidate, dataset manifests, model registry, prediction result, ranking snapshots, optimization run, corrective actions and generation sessions
9. inspect existing audit/event/navigation infrastructure before adding a new lineage layer

Do not trust milestone logs as implementation evidence. Verify actual code.

## Source of truth

https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md is the only authoritative task-state ledger.

Codex is the primary implementation/execution agent.

Do not create:
- alternate trackers
- competing lineage ledgers
- `.hiveai` task/state/handoff files
- duplicate domain authorities
- a second audit system
- mutable historical pointers that can silently retarget old records

## Execution behavior

Work continuously from FVL-10.001 through FVL-10.010.

Do not stop after each task for approval.

Only stop for a genuine non-resolvable blocker.

At task start:
- mark task `[~]`
- update Current Task
- set Current Task Status = IN_PROGRESS
- keep Next Task accurate

At validated completion:
- mark task `[x]`
- advance Current Task / Next Task atomically
- recalculate counts exactly

Do not close a task merely because a type exists. Closure requires production integration plus tests.

---

# FVL-10.001 — Full-chain ID/provenance model

Define a canonical lineage/provenance model spanning:

- generation session
- working draft
- saved Formulation / FormulationVersion
- corrective action
- DOE candidate/recommendation
- DOE run
- LaboratoryTrial
- TestResult / measured response
- FVL-05 dataset artifact/fingerprint
- FVL-07 model version
- prediction result
- FVL-08 ranking snapshot
- optimization run
- retraining event/new model
- downstream recommendation lineage where applicable

Prefer adding explicit cross-links to existing canonical records over creating a detached graph that can drift.

Every lineage edge must have:
- source identity
- target identity
- relationship type
- immutable version/record identity where relevant
- provenance/audit timestamp or source context if required by existing conventions

Do not use display labels as identity.

Add tests for exact ID resolution and broken-link detection.

---

# FVL-10.002 — Immutable references

Later stages must cite earlier immutable records.

They must not rewrite them.

Required invariants include:

- trial cites exact FormulaVersion
- TestResult cites exact trial/test definition
- dataset cites exact source records/fingerprint
- model cites exact dataset fingerprint/schema
- prediction cites exact model/version + source formula/version
- ranking cites exact prediction/model and source alternative
- recommendation cites exact DOE/formula context
- retraining cites exact completed result + prior model/dataset lineage

Historical records must not silently move to "latest".

Do not allow mutable alias resolution as historical authority.

Add negative tests proving historical references do not retarget after newer records are added.

---

# FVL-10.003 — Version relationship model

Implement explicit version relationships across:

formula
-> trial
-> result
-> dataset
-> model
-> prediction
-> ranking/recommendation

and retraining/new-model relationships.

Required distinctions:
- derived_from
- measured_from
- trained_from
- predicted_by
- ranked_with
- recommended_from
- supersedes
- retrained_from
- corrective_action_from
- DOE_derived_from
- generation_session_from

Use repository naming conventions if equivalent relationships already exist.

Do not fabricate a universal relationship enum if existing canonical fields already express the same relationship cleanly.

The goal is deterministic navigability and provenance, not decorative graph theory.

---

# FVL-10.004 — Corrective-action-derived draft linkage

When a draft is created from a corrective action:

- preserve corrective action ID
- preserve originating trial/deviation/result identity where available
- preserve source FormulaVersion
- do not overwrite original laboratory record
- mark the new draft as derived work, not corrected historical truth

Human approval gates remain authoritative.

Add tests:
- corrective action -> draft
- draft edit does not mutate source
- missing source linkage fails or remains explicitly unavailable
- repeated corrective derivation creates new lineage, not overwrite

---

# FVL-10.005 — DOE-derived draft linkage

DOE candidate application already supports working-draft changes.

Strengthen lineage so DOE-derived draft stores:

- candidate ID
- study/revision
- design ID
- recommendation policy where applicable
- source FormulaVersion
- factor settings applied
- resulting draft/formulation identity

Do not overwrite saved version.

Do not mark DOE recommendation experimentally validated merely because a draft was created.

Preserve the FVL-09 human-selection rules.

Add retry/idempotency tests where applicable.

---

# FVL-10.006 — Phase-14 generation-session linkage

Any draft/formula generated from the existing Phase-14/formulation-generation session must retain exact generation session identity.

Preserve:
- session ID
- alternative/version label
- source generated formula fingerprint if canonical
- promotion/bridge lineage into saved FormulationVersion
- no synthetic identity substitution

Use existing generation session types and promotion code.

Do not create a parallel generation history system.

Add tests proving later saved version can navigate back to exact generation session/alternative.

---

# FVL-10.007 — Prediction source-model linkage

Every persisted/served prediction must preserve exact:

- source FormulaVersion
- product family
- target
- model ID/version
- model artifact checksum if available
- dataset fingerprint
- feature/schema versions
- applicability-domain result
- uncertainty status/value only when supported

Prediction records/results must not silently retarget to newer accepted model versions.

If "latest accepted model" is used to select a model at request time, persist the exact selected model identity in the resulting prediction lineage.

Add tests:
- model v1 prediction remains v1 after v2 exists
- source version mismatch fails closed
- OOD remains OOD in lineage
- unavailable model has no fabricated model identity

---

# FVL-10.008 — Retraining lineage

Every retraining outcome must connect:

new measured data
-> exact trial/run/result
-> dataset fingerprint
-> partition/config
-> prior accepted model where relevant
-> training run
-> new model version

Do not mutate prior models.

Do not mutate prior datasets.

If retraining returns INSUFFICIENT_DATA or NOT_ACCEPTED:
- preserve the attempted lineage/audit event
- do not register a fake model

Prevent duplicate retraining registration for the exact same immutable dataset fingerprint + target + family unless repository policy explicitly permits a new distinct training experiment.

Add tests for:
- successful retraining
- insufficient data
- duplicate exact dataset
- invalid lineage
- previous model remains immutable
- new model cites exact triggering evidence

---

# FVL-10.009 — Full-chain navigation + audit UI

Add a user-facing lineage/audit view using existing UI conventions.

From relevant records, users should be able to navigate or inspect:

FormulaVersion
-> Trial
-> Result
-> Dataset
-> Model
-> Prediction
-> Ranking/Recommendation
-> DOE/Optimization/Corrective derived work

Do not create fake links when records are unavailable.

Show:
- record type
- immutable ID/code
- version where relevant
- relationship
- status
- timestamp if authoritative
- missing/broken link state explicitly

Hard-gate and human-approval decisions should be visible in audit context where existing records support them.

Keep UI read-only unless an existing authoritative workflow already provides the action.

Add frontend tests for:
- full chain
- partial chain
- broken reference
- superseded/newer model existing without retargeting historical record

---

# FVL-10.010 — Failure/retry/human gates

This is the milestone acceptance task.

Required invariants:

1. no model may rewrite LaboratoryTrial
2. no model may rewrite TestResult
3. retraining never alters source measurement
4. prediction never changes regulatory/safety approval
5. recommendation does not imply validation
6. DOE recommendation still requires human selection
7. corrective draft does not rewrite source record
8. retries are idempotent or fail closed
9. partial persistence failure cannot create split-brain lineage
10. duplicate append attempts do not overwrite immutable history
11. broken lineage is surfaced, not silently healed to latest
12. model/prediction/ranking/recommendation records preserve exact historical IDs

Build a real integrated acceptance covering:

generation session
-> saved version
-> DOE or corrective derived work
-> LaboratoryTrial
-> measured result
-> dataset
-> model
-> prediction
-> ranking/recommendation
-> completed experiment
-> retraining/new model

Where actual physical experiment data is unavailable, use bounded repository-owned fixtures without claiming physical validation.

Do not call FVL-10 complete until negative paths pass.

---

# Cross-cutting integrity rules

Non-negotiable:

- immutable historical identity
- no "latest" fallback for old records
- no source-result mutation by models
- no automatic approval
- no fabricated evidence
- no fabricated uncertainty
- no recommendation-as-validation
- human gates remain human gates
- Safety/Regulatory remain authoritative
- missing links remain missing/broken
- retries must not duplicate immutable records
- exact IDs beat display names

# Persistence strategy

Reuse existing collections and schemas where practical.

If a new lineage record type is truly required:
- justify why existing direct fields/audit events cannot express the relationship
- keep it append-only or immutable where appropriate
- checksum/version it if downstream security depends on it
- add storage-level tests

Do not create a broad mutable "lineage graph" collection if explicit domain links are sufficient.

# Versioning

Only bump schema versions when serialized contracts actually change.

Preserve backward readability of historical records.

For newly required lineage fields on existing records:
- prefer additive optional fields where old records must remain readable
- new production writes should populate required lineage whenever the workflow has the information

Do not reinterpret historical absence as a false positive link.

# Required validation

After each task, run focused tests.

Before closing FVL-10, run the broadest relevant validation available:

- full shared tests
- full desktop tests
- FVL-05 dataset/fingerprint/partition regressions
- FVL-06 measurement/Data Exchange regressions
- FVL-07 model/prediction regressions
- FVL-08 ranking/optimizer strict acceptance
- FVL-09 recommendation/retraining strict acceptance
- new FVL-10 lineage/immutability/navigation tests
- TypeScript typecheck
- lint
- production build
- git diff --check
- i18n parity if UI changes
- Rust tests if Rust storage/schema code changes
- Python tests if Python code changes
- canonical TASKS count/ID validation

Do not claim PASS unless actually executed.

If environment blocks a required suite:
- document exact blocker
- run safe substitutes
- do not fake PASS

# Git rules

Work on `main`.

Before changes:
- fetch
- pull --ff-only where possible
- preserve unrelated owner changes

Suggested grouping:

1. FVL-10.001-.003 lineage foundation
2. FVL-10.004-.006 derived-work lineage
3. FVL-10.007-.008 model/retraining linkage
4. FVL-10.009 UI/audit navigation
5. FVL-10.010 integrated acceptance + closure

Smaller commits are acceptable for auditability.

Push validated commits to `main`.

Never force-push.

# TASKS state transitions

Start:
- FVL-10.001 -> `[~]`
- Current Task = FVL-10.001
- Current Task Status = IN_PROGRESS
- Next Task = FVL-10.002

Advance sequentially.

After FVL-10.006:
- Current Sprint = FVL-10-S02
- Current Task = FVL-10.007

After FVL-10.010 passes strict acceptance:
- mark FVL-10.010 `[x]`
- Current Milestone = FVL-11
- Current Sprint = FVL-11-S01
- set Current Task to the exact canonical FVL-11.001 text from the then-current https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md
- Current Task Status = READY
- set Next Task to exact canonical FVL-11.002 text
- Required Actor = CODEX
- recalculate counts exactly

Do not set FVL-11.001 to `[~]`.
Do not start FVL-11 implementation.

# Final report

Report exactly:

`FORMULAB FVL-10 MILESTONE COMPLETE`

Include:
- final main HEAD
- commits
- FVL-10.001-.010 implementation summary
- lineage model/fields introduced
- immutable-reference guarantees
- derived-draft linkage behavior
- prediction/model lineage behavior
- retraining lineage behavior
- UI/audit navigation behavior
- failure/retry/human-gate behavior
- exact tests and counts
- schema/version changes
- TASKS final counts
- confirmation FVL-11.001 READY but NOT STARTED
- known limitations
- worktree status
- push status

Do not close FVL-10 if any critical lineage or immutability invariant remains unresolved.

Begin now and continue autonomously until FVL-10 is complete or a genuine non-resolvable blocker is reached.
