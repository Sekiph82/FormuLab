# FVL09-REMEDIATION-GPT-PROMPT-000026 — Recommendation Execution Gate Remediation

Repository: https://github.com/Sekiph82/FormuLab
Canonical branch: `main`
Canonical task authority: https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md
Governance: https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md
Original FVL-09 master prompt: https://github.com/Sekiph82/FormuLab/blob/main/project-control/gpt/prompts/FVL09-GPT-PROMPT-000023.md
This remediation prompt: https://github.com/Sekiph82/FormuLab/blob/main/project-control/gpt/prompts/FVL09-REMEDIATION-GPT-PROMPT-000026.md
Actor: CODEX

## Purpose

FVL-09 was marked complete, but strict post-completion audit found a remaining critical execution-gate defect.

The first recommendation -> DOE run creation path correctly calls the human-selection gate. However, a persisted recommendation-origin DOE run can later reach LaboratoryTrial creation through retry/generic run paths without re-verifying the original recommendation acceptance, eligibility, and human-selection lineage.

This violates FVL-09.007/.008 and the FVL-09.010 integrated acceptance requirement.

Do not start FVL-10 implementation.

## Mandatory startup

1. checkout `main`
2. fetch and pull latest `main`
3. verify working tree
4. read https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md completely
5. read https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md completely
6. read https://github.com/Sekiph82/FormuLab/blob/main/project-control/gpt/prompts/FVL09-GPT-PROMPT-000023.md completely
7. inspect actual current FVL-09 recommendation, DOE run, LaboratoryTrial and tests
8. do not trust prior completion logs as evidence

Key files:

- https://github.com/Sekiph82/FormuLab/blob/main/packages/shared/src/engine/doeCandidates.ts
- https://github.com/Sekiph82/FormuLab/blob/main/packages/shared/src/schemas/doe.ts
- https://github.com/Sekiph82/FormuLab/blob/main/apps/desktop/src/components/formula/DoePanel.tsx
- https://github.com/Sekiph82/FormuLab/blob/main/apps/desktop/src/components/formula/DoePanel.test.tsx
- https://github.com/Sekiph82/FormuLab/blob/main/apps/desktop/src/lib/doeModelRetraining.ts
- https://github.com/Sekiph82/FormuLab/blob/main/packages/shared/src/engine/doeCandidates.test.ts

## Tracker correction

Reopen only the affected FVL-09 tasks:

- `FVL-09.007` -> `[~]`
- `FVL-09.008` -> `[ ]`
- `FVL-09.010` -> `[ ]`

Set Project Status:

- Current Milestone: FVL-09
- Current Sprint: FVL-09-S02
- Current Task: FVL-09.007 — Human selection required; no automatic lab execution
- Current Task Status: IN_PROGRESS
- Next Task: FVL-09.008 — Create/link real LaboratoryTrial or DOE run from accepted recommendation
- Required Actor: CODEX
- Blockers/Waits: None unless genuine

Recalculate exact counts.

Do not start FVL-10.

---

# Corrective finding C1 — Retry path can bypass the human-selection gate

## Audit finding

Current production flow contains:

`createTrialFromRecommendation(candidate)`

which does:

- find existing run by `run.recommendationId === candidate.id`
- if an existing run is found and has no linked trial, reuse it
- skip `createDoeRunFromAcceptedCandidate(...)`
- call `generateTrialForRun(run)`

The original run-creation path calls `assertDoeCandidateHumanSelected()`, but the existing-run retry path does not re-verify:

- candidate is still the exact accepted recommendation
- candidate status is selected
- candidate feasibility is FEASIBLE
- Safety is PASS
- Regulatory is PASS
- acquisition is AVAILABLE
- run carries real human acceptance lineage
- recommendationId/policy matches candidate
- run study/design/source formula lineage matches candidate

Therefore a malformed/imported/stale/partially persisted recommendation-origin run can become a LaboratoryTrial without proving the human acceptance contract.

## Required remediation

Create a canonical reusable domain assertion for an existing recommendation-origin DOE run.

Suggested concept:

`assertAcceptedRecommendationRunCanCreateTrial(candidate, run, study, design, actor)`

Use an appropriate name consistent with repository conventions.

It must fail closed unless ALL are true:

1. actor is human under existing authorization rules
2. candidate.status === `selected`
3. `isDoeCandidateEligibleForSelection(candidate)` is true
4. run.recommendationId === candidate.id
5. run.recommendationPolicyVersion === candidate.recommendationPolicyVersion / canonical FVL-09 policy
6. run.recommendationAcceptedBy exists and is non-empty
7. run.recommendationAcceptedAt exists and is valid under project timestamp conventions
8. run studyId/studyRevision match candidate and active study
9. run designId matches candidate.experimentSpace.designId and active design
10. candidate.experimentSpace.sourceFormulaVersionId matches study.baselineFormulaVersionId
11. run has not already produced/linked a LaboratoryTrial
12. run is still in a lifecycle state where trial creation is legal

Do not infer acceptance merely from:
- rank
- recommendationId
- candidate existence
- candidate being shown in the UI

## Retry semantics

A partial failure is allowed to be retried safely.

Example:

human selects candidate
-> accepted recommendation run persisted
-> process crashes before LaboratoryTrial write
-> user retries

This retry MAY create the trial only if the persisted run independently proves the acceptance lineage above.

Do not require a second human acceptance event if the original immutable run already contains valid acceptance provenance.

But do revalidate current source integrity and hard eligibility evidence before creating the trial if repository policy requires those gates to remain valid at execution time.

---

# Corrective finding C2 — Generic Runs UI can bypass recommendation execution gate

## Audit finding

The Runs table currently offers generic `Generate Trial` for any run lacking `linkedTrialId`.

For an ordinary DOE design run this existing behavior may be correct.

For a recommendation-origin run (`recommendationId` present), calling generic `generateTrialForRun(run)` bypasses the recommendation-specific acceptance assertion.

## Required remediation

Separate the two cases.

### Ordinary DOE run

Preserve existing non-recommendation behavior unless fresh audit shows it is unsafe.

### Recommendation-origin DOE run

The generic Runs UI must not call unguarded `generateTrialForRun()`.

It must either:

- route through the recommendation-aware verified creation path, or
- disable/hide the generic Generate Trial action and require creation through the accepted recommendation workflow

Preferred architecture: centralize the trial-creation gate so every caller uses one safe function.

UI must never be the only enforcement layer.

---

# Corrective finding C3 — Trial creation domain function must fail closed

Refactor so `generateTrialForRun()` cannot accidentally become a recommendation bypass.

Acceptable designs include:

1. split into:
   - ordinary DOE-run trial creation
   - accepted-recommendation trial creation with strict gate

or

2. make a single function inspect `run.recommendationId` and require the candidate/acceptance contract when present.

For recommendation-origin run:

- no candidate -> fail
- candidate not selected -> fail
- candidate ineligible -> fail
- missing acceptedBy -> fail
- missing acceptedAt -> fail
- recommendation policy mismatch -> fail
- study/design/source-version mismatch -> fail

No LaboratoryTrial write may happen before this verification.

No DOE run transition to `trial_created` may happen before this verification.

---

# Corrective finding C4 — Preserve exact recommendation -> run -> trial lineage

After successful guarded creation, verify persisted records contain:

DOE candidate:
- candidate.id
- recommendationPolicyVersion
- experiment-space design/source version

DOE run:
- recommendationId
- recommendationPolicyVersion
- recommendationAcceptedBy
- recommendationAcceptedAt
- linkedTrialId
- linkedFormulaVersionId
- design/study identity

LaboratoryTrial:
- sourceDoeStudyId
- sourceDoeDesignId
- sourceDoeRunId
- sourceFormulaVersionId
- status = planned

All identities must agree exactly.

Do not rewrite the source recommendation to pretend execution/validation occurred.

---

# Corrective finding C5 — Negative-path acceptance

Add targeted negative tests.

At minimum:

1. selected eligible candidate + valid human-accepted recommendation run -> trial creation PASS
2. proposed candidate + persisted recommendation run -> FAIL
3. shortlisted candidate + persisted recommendation run -> FAIL
4. selected candidate but Safety FAIL -> FAIL
5. selected candidate but Regulatory FAIL -> FAIL
6. selected candidate but feasibility UNKNOWN/INFEASIBLE -> FAIL
7. selected candidate but acquisition UNAVAILABLE -> FAIL
8. run recommendationId mismatch -> FAIL
9. run recommendationPolicyVersion mismatch -> FAIL
10. missing recommendationAcceptedBy -> FAIL
11. missing recommendationAcceptedAt -> FAIL
12. study/revision mismatch -> FAIL
13. design mismatch -> FAIL
14. source formula version mismatch -> FAIL
15. already-linked run -> no duplicate LaboratoryTrial
16. generic Runs UI cannot bypass recommendation gate
17. simulated partial failure after accepted-run persistence can retry safely only with valid acceptance lineage
18. all failed paths produce:
    - zero new `laboratory_trials` writes
    - no transition to `trial_created`

---

# Corrective finding C6 — Reconfirm retraining trigger integrity

The strict audit found the retraining order logic appears to cover both:

- run already completed, then observation becomes validated
- observation already validated, then run becomes completed

Re-verify with tests.

Also preserve:

- completed LaboratoryTrial required
- exact run/trial/design/study/formula lineage
- validated DOE observation path
- FVL-06 TestResult path
- FVL-05 dataset/fingerprint/partition
- FVL-07 eligibility/training
- structured INSUFFICIENT_DATA
- immutable prior models/datasets

Do not broaden this remediation unless a fresh defect is found.

---

# FVL-09.010 integrated acceptance extension

Extend milestone acceptance to prove:

recommendation proposed
-> human selected
-> accepted run with actor/timestamp/policy lineage
-> safe retry semantics
-> planned LaboratoryTrial
-> no automatic execution
-> completed/validated result
-> retraining path

AND prove:

malformed recommendation-origin existing run
-> cannot create LaboratoryTrial

The test must exercise the production-facing path or shared domain function actually used by the production UI.

Do not rely only on a mock that bypasses the real gate.

---

# Required validation

Run:

- focused `doeCandidates` tests
- focused `DoePanel` tests
- recommendation -> trial integration tests
- retry-path tests
- full shared tests
- full desktop tests
- FVL-05/06/07/08 regression coverage relevant to this path
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- i18n parity if UI strings change
- TASKS count/ID validation

Rust/Python only if touched.

Do not claim any suite passed unless executed.

---

# Git rules

Work on `main`.

Suggested commits:

1. `chore(FVL-09): reopen recommendation execution audit tasks`
2. `fix(FVL-09): enforce accepted recommendation lineage on trial creation`
3. `test(FVL-09): cover retry and generic-run bypass paths`
4. `chore(FVL-09): re-close milestone after strict acceptance`

Push validated commits to `main`.

Never force-push.

Preserve unrelated owner changes.

---

# Re-closure criteria

Only re-close FVL-09 when:

- every recommendation-origin trial creation path enforces human acceptance
- retry path validates persisted acceptance lineage
- generic Runs UI cannot bypass recommendation gate
- no malformed recommendation run can create a trial
- no failed path writes a trial or marks run trial_created
- exact recommendation/run/trial lineage persists
- integrated acceptance passes
- no FVL-10 implementation was started

Then set:

- FVL-09.007 -> `[x]`
- FVL-09.008 -> `[x]`
- FVL-09.010 -> `[x]`

and restore Project Status:

- Current Milestone: FVL-10
- Current Sprint: FVL-10-S01
- Current Task: FVL-10.001 — ID/provenance model spanning the full laboratory-feedback chain
- Current Task Status: READY
- Next Task: FVL-10.002 — Immutable references; later stages cite and never rewrite earlier records
- Required Actor: CODEX

Keep FVL-10.001 unchecked.

Do not implement FVL-10.

## Final report

Report exactly:

`FORMULAB FVL-09 STRICT REMEDIATION COMPLETE`

Include:
- final HEAD
- commits
- tracker reopen/final state
- domain gate implementation
- retry behavior
- generic Runs UI behavior
- human acceptance provenance checks
- negative test matrix
- zero-write evidence on rejected paths
- recommendation/run/trial lineage proof
- retraining trigger regression status
- exact test counts
- typecheck/lint/build/diff-check
- known limitations
- confirmation FVL-10.001 READY but NOT STARTED
- clean worktree/push status

If any critical execution-gate criterion remains unresolved, do not re-close FVL-09.

Begin now and continue autonomously until remediation is complete or a genuine non-resolvable blocker is reached.
