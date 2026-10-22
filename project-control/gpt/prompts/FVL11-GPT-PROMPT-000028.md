# FVL11-GPT-PROMPT-000028 — Codex Master Execution Prompt

Repository: https://github.com/Sekiph82/FormuLab
Canonical branch: `main`
Canonical task authority: https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md
Governance: https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md
Codex master prompt: https://github.com/Sekiph82/FormuLab/blob/main/project-control/gpt/prompts/FVL11-GPT-PROMPT-000028.md
Actor: CODEX

## Objective

Complete the entire FVL-11 milestone in strict task order and push validated results to `main`.

This is the v1 closure milestone.

Do not declare FormuLab v1 COMPLETE until every FVL-11 task is complete and the full acceptance, regression, installer, desktop shortcut, branch-state, and closure-handoff evidence is verified.

Canonical scope:

### Sprint FVL-11-S01 — Integrated acceptance
1. `FVL-11.001` — Acceptance matrix across genuinely different product families
2. `FVL-11.002` — Full-chain acceptance run 1 through report
3. `FVL-11.003` — Full-chain acceptance run 2 through lab, model, active learning and retraining
4. `FVL-11.004` — Backward compatibility for historical sessions
5. `FVL-11.005` — Old vs new formulation UI decision after acceptance proof
6. `FVL-11.006` — Authorization/role and approval gates re-verified; no AI auto-approval
7. `FVL-11.007` — Zero-LLM formulation regression re-confirmed
8. `FVL-11.008` — Data integrity + backup/restore re-verified for new record types

### Sprint FVL-11-S02 — Regression, installer & v1 closure
9. `FVL-11.009` — Full regression suite across Python, Rust, Vitest, TypeScript, ESLint and diff check
10. `FVL-11.010` — Fresh installer build: formulab.exe + MSI/NSIS
11. `FVL-11.011` — Desktop FormuLab.lnk verification against fresh build
12. `FVL-11.012` — GitHub branch state confirmed with no outstanding blocking issue
13. `FVL-11.013` — Current handoff updated to closure state
14. `FVL-11.014` — Explicit FormuLab v1 COMPLETE declaration after every prior task is complete

## Mandatory startup

Before changing code or tracker state:

1. checkout `main`
2. fetch and pull latest `main`
3. verify local HEAD equals remote `main`
4. inspect working tree and preserve unrelated owner changes
5. read https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md completely
6. read https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md completely
7. inspect the strict FVL-08 and FVL-09 remediation contracts and FVL-10 lineage/immutability implementation
8. inspect installer/build/release scripts and current desktop shortcut conventions before changing packaging
9. inspect Python/Rust/TypeScript test entry points and CI-independent local validation commands
10. inspect historical session/schema readers and migration compatibility before acceptance runs

Do not trust prior milestone logs as proof. Verify actual source and execute tests.

## Source of truth

https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md is the only authoritative task ledger.

Do not create:
- alternate trackers
- competing release ledgers
- duplicate closure documents that contradict TASKS
- hidden acceptance state outside canonical records
- AI-generated approval records
- fake installer evidence
- fabricated test results

## Execution behavior

Work continuously from FVL-11.001 through FVL-11.014.

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

Do not close a task merely because a note was written. Closure requires evidence.

---

# FVL-11.001 — Acceptance matrix across genuinely different product families

Build a representative acceptance matrix using genuinely different product families already present in FormuLab.

Do not use three cosmetic variants of the same family.

Select families that exercise meaningfully different:
- ingredient/property patterns
- process parameters
- safety/regulatory constraints
- test definitions
- formulation templates
- DOE dimensions
- measurement targets

Document why each selected family is materially different.

At minimum cover:
- one liquid/surfactant-heavy family
- one emulsion or structurally different family if available
- one family with distinct regulatory/process/test behavior

Use repository-owned fixtures or existing canonical project data where appropriate.

Do not fabricate physical lab outcomes.

Acceptance matrix must map each family against:
- requirement parsing
- formulation generation
- cost
- compatibility
- safety
- regulatory
- laboratory
- DOE/recommendation
- dataset/model
- prediction/ranking
- lineage/audit
- export/reporting

---

# FVL-11.002 — Full-chain acceptance run 1 through report

Execute one complete representative chain from initial formulation input through final report/export.

The path should include all applicable canonical subsystems:

requirements
-> research/evidence
-> formulation generation
-> save/version
-> cost/compatibility/safety/regulatory
-> process
-> laboratory trial planning
-> measured-response fixture where allowed
-> DOE/recommendation where applicable
-> dataset/model/prediction/ranking
-> lineage/audit
-> report/export

Use real production-facing functions/workflows.

Do not bypass with disconnected unit-only helpers.

Capture deterministic evidence for each transition.

If no real physical result exists, use clearly labeled repository fixture data and do not claim real-world validation.

---

# FVL-11.003 — Full-chain acceptance run 2 through lab, model, active learning and retraining

Run a second chain that specifically exercises:

- laboratory trial
- validated measured-response fixture
- FVL-05 dataset extraction/fingerprint
- FVL-07 eligibility/training
- FVL-09 experiment recommendation
- human-selection gate
- completed-result ingestion
- retraining
- new model version
- immutable prior model
- FVL-10 lineage navigation

This run must be meaningfully different from acceptance run 1.

Prove:
- recommendation is not validation
- human selection is required
- retraining uses completed/validated evidence only
- prior model remains immutable
- new model cites exact new evidence
- lineage can navigate old and new model versions

---

# FVL-11.004 — Historical backward compatibility

Verify historical sessions and records remain readable.

Cover:
- predictive model schema 1.0
- predictive model schema 1.1
- historical records lacking newer optional lineage fields
- historical ranking records
- older generation sessions
- older drafts without origin fields
- older optimization runs without newest lineage additions where backward readability is intended

No migration may silently reinterpret absent fields as false lineage.

Add tests proving:
- old records load
- new records load
- historical missing linkage remains missing
- old record does not retarget to latest model/version
- serialization/deserialization round-trip preserves intended schema behavior

---

# FVL-11.005 — Old vs new formulation UI decision

Use acceptance evidence, not preference alone.

Audit whether legacy/duplicate formulation UI paths still exist.

Decide one of:

1. keep both because each has distinct justified workflow
2. retire old UI because new workspace fully covers it
3. keep compatibility redirect/read-only bridge temporarily

Document the decision in canonical project documentation without creating a competing task tracker.

If removing/redirecting old UI:
- preserve deep links where practical
- preserve historical project access
- add routing tests
- avoid deleting evidence/history needed for audit

Do not perform a broad UI redesign.

---

# FVL-11.006 — Authorization, role and approval gates

Re-verify all human gates.

At minimum cover:
- formulation approval
- regulatory review
- corrective-action verification
- DOE recommendation selection
- recommendation -> trial creation
- trial/lab completion where human action is required
- Safety/Regulatory hard gates
- no prediction/ranking/recommendation service can approve records
- no AI/system/import actor can impersonate a human approval path

Add negative tests for unauthorized actors.

Explicit invariant:
**no AI auto-approval anywhere in v1.**

---

# FVL-11.007 — Zero-LLM formulation regression

Re-confirm that baseline formulation generation does not require an LLM.

Run the real zero-LLM path.

Prove:
- deterministic requirement parsing works
- deterministic formulation generation works
- required evidence/cost/safety/regulatory paths do not require LLM completion to function
- LLM-assisted features, if present, remain optional/advisory

Add or refresh regression tests if coverage is insufficient.

Do not use a mocked "LLM unavailable" flag alone as proof.

---

# FVL-11.008 — Data integrity + backup/restore

Re-verify backup/restore for all new FVL-05 through FVL-10 record types that must persist.

Inventory the persisted collections added/extended by these milestones.

At minimum inspect:
- measured-response/TestResult additions
- predictive model registry
- alternative ranking snapshots
- DOE candidate/run lineage fields
- LaboratoryTrial lineage
- retraining/model lineage
- any generation-session linkage
- corrective/DOE draft origin fields

Prove backup/restore preserves:
- IDs
- schema versions
- checksums
- immutable references
- append-only semantics where applicable
- backward-readable historical records

Corrupted/tampered backup data must fail validation where the repository has schema/checksum gates.

Do not silently drop unknown/new collections during restore.

---

# FVL-11.009 — Full regression suite

Run the broadest complete local validation available.

Required categories:

## TypeScript/Vitest
- full shared suite
- full desktop suite

## Type checking
- shared
- desktop

## Lint
- repository ESLint / package lint commands

## Python
Run the repository's relevant Python test suite(s), not just a smoke import.

## Rust
Run the relevant Rust/Tauri unit test suite(s).

If default Tauri test startup is blocked by a known resource issue:
- use only an existing safe repo-supported test configuration/override
- document exact command
- do not modify packaging semantics just to make tests pass
- do not claim Rust PASS unless tests execute

## Additional
- i18n parity
- production build
- `git diff --check`
- TASKS count/ID uniqueness validation

Record exact pass/fail counts.

No skipped failing suite may be called PASS.

---

# FVL-11.010 — Fresh installer build

Produce a fresh Windows installer from current `main`.

Required outputs:
- fresh `formulab.exe`
- fresh MSI if supported by current packaging
- fresh NSIS installer if supported by current packaging

Do not reuse an old artifact.

Verify artifact timestamps/build provenance tie to current source HEAD.

If packaging signs artifacts, use the existing signing path. Do not invent signing credentials.

Record:
- source HEAD
- build command
- artifact names
- sizes
- checksums
- output paths

Do not upload secrets.

---

# FVL-11.011 — Desktop FormuLab.lnk verification

Verify the desktop shortcut points to the fresh installed/built FormuLab target.

Required checks:
- shortcut exists where expected
- target path resolves
- target points to fresh FormuLab executable/install
- working directory is valid
- icon target is valid if configured
- launch through shortcut succeeds if environment permits

Do not silently rewrite unrelated user shortcuts.

If verification requires a temporary test install, keep it scoped to FormuLab.

---

# FVL-11.012 — GitHub branch state

Confirm final repository state.

Required:
- canonical branch `main`
- local HEAD = origin/main = GitHub main
- no required milestone work stranded on another branch
- no unmerged FVL worktree/branch with unique required commits
- clean working tree
- no outstanding blocker recorded in canonical TASKS
- no accidental TASKS authority outside root TASKS

Do not delete owner branches merely for cleanliness unless they are clearly obsolete and policy permits deletion.

Report branch comparison evidence.

---

# FVL-11.013 — Current handoff closure state

Update the canonical handoff/closure documentation used by the repository, if such a document exists and remains part of the current governance.

Important:
- TASKS remains authority
- handoff is evidence/history only
- do not revive superseded H!veAI state files
- do not create a second authoritative tracker

The handoff should state:
- final HEAD
- completed milestones
- installer status
- test status
- known warnings/limitations
- v1 closure readiness
- no outstanding blocker, if true

If no current canonical handoff document exists under current governance, create only a concise closure evidence document in the existing project-control convention, not a competing tracker.

---

# FVL-11.014 — Explicit v1 COMPLETE declaration

This is the final gate.

Do not mark FVL-11.014 complete until FVL-11.001-.013 are all `[x]`.

Before declaring COMPLETE, re-read canonical TASKS and verify:
- all 171 tasks complete
- 0 remaining
- 0 active
- no blockers
- all task IDs unique
- no FVL task unchecked
- installer evidence exists
- desktop shortcut verified
- full regression suite passed or any explicitly accepted blocker is truly non-blocking under project policy
- branch state clean
- current HEAD pushed

Then update TASKS:

- Completed Tasks: 171
- Remaining Tasks: 0
- Completion: 100.0%
- Current Milestone: COMPLETE
- Current Sprint: COMPLETE
- Current Task: FormuLab v1 COMPLETE
- Current Task Status: COMPLETE
- Next Task: None
- Required Actor: NONE
- Blockers/Waits: None

Do not invent a new FVL-12.

Add explicit closure text in project evidence:

`FORMULAB V1 COMPLETE`

Only after every prior acceptance gate is satisfied.

---

# Strict acceptance rules

FVL-11 closure must fail if any of these are true:

- a full-chain acceptance run bypasses real production logic
- historical records fail to load
- unauthorized actor can approve
- AI can auto-approve
- zero-LLM generation regressed
- new persistent records are not backup/restored
- Python suite not run without a valid documented reason
- Rust suite not run without a valid documented reason
- installer is stale
- shortcut points to stale executable
- main is not canonical and clean
- TASKS counts are wrong
- any prior FVL task is reopened/failed
- any critical lineage/hard-gate regression appears

# Evidence discipline

Use logs, tests, hashes and artifact checksums.

Do not claim:
- physical laboratory validation when using fixtures
- production scientific validity from synthetic tests
- installer success without build artifacts
- shortcut success without target verification
- branch closure without actual comparisons

# Git rules

Work on `main`.

Suggested commit grouping:

1. FVL-11.001-.003 integrated acceptance
2. FVL-11.004-.008 compatibility/gates/integrity
3. FVL-11.009 full regression
4. FVL-11.010-.011 installer + shortcut
5. FVL-11.012-.013 branch + closure handoff
6. FVL-11.014 final v1 declaration

Smaller commits are acceptable.

Never force-push `main`.

Preserve unrelated owner changes.

# TASKS transitions

Start:
- FVL-11.001 -> `[~]`
- Current Task = FVL-11.001
- Current Task Status = IN_PROGRESS
- Next Task = FVL-11.002

Advance sequentially through all fourteen tasks.

After FVL-11.008:
- Current Sprint = FVL-11-S02
- Current Task = FVL-11.009

After FVL-11.014 passes:
- set final COMPLETE state exactly as defined above
- all FVL rows must be `[x]`

# Final report

Report exactly:

`FORMULAB V1 COMPLETE`

Include:
- final main HEAD SHA
- commits created
- acceptance matrix families
- full-chain run 1 evidence
- full-chain run 2 evidence
- backward-compatibility result
- old/new UI decision
- authorization/no-auto-approval result
- zero-LLM result
- backup/restore result
- complete Python/Rust/Vitest/TypeScript/ESLint/build results with counts
- installer artifact names/sizes/checksums
- shortcut target verification
- GitHub branch state
- closure handoff URL/path
- TASKS final counts 171/171
- known non-blocking warnings
- clean worktree
- remote/local HEAD equality

If any critical requirement is unresolved, do not declare FormuLab v1 COMPLETE.

Begin now and continue autonomously until FVL-11 is complete or a genuine non-resolvable blocker is reached.
