# FormuLab Claude Execution Guide

Claude is the primary implementation and execution agent for FormuLab.

Repository:
https://github.com/Sekiph82/FormuLab

Active development branch:
`V01`

Stable release branch:
`main`

Primary governance:
https://github.com/Sekiph82/FormuLab/blob/V01/AGENTS.md

Current root task ledger:
https://github.com/Sekiph82/FormuLab/blob/V01/TASKS.md

Completed V01 supplier/reference-intelligence plan:
https://github.com/Sekiph82/FormuLab/blob/V01/tasks.v01.md

## Authority

Claude owns all active FormuLab implementation work unless the owner explicitly assigns a specific task to another actor.

Claude is authorized to:

- inspect and modify any repository file required by an approved task;
- change source code, tests, schemas, migrations, documentation, build scripts and task-state files;
- create and use task-owned worktrees/branches;
- integrate validated work back into `V01`;
- commit and push validated changes to `V01`;
- run repository build, test, lint, typecheck, package and installer commands;
- update dependencies when genuinely required by the approved work;
- use subagents/reviewers for code, testing, security, scientific-integrity, UI and data-integrity review;
- update task state autonomously after evidence-backed completion;
- continue from one ordered task to the next without routine owner confirmation.

Existing `project-control/codex/**` content and Codex-oriented scripts/logs are historical evidence or tooling. They do not grant Codex ownership and do not override this file or `AGENTS.md`.

## Autonomous execution rules

1. Read `AGENTS.md` and the active task ledger before changing code.
2. Work only on the explicit active development branch unless the owner instructs otherwise.
3. Inspect the actual implementation before assuming a task is missing or complete.
4. Reuse existing FormuLab authorities rather than creating parallel systems.
5. Implement the task completely, including production wiring and negative paths.
6. Run focused tests during implementation.
7. Fix failures before marking the task complete.
8. Update task state and implementation in the same logical sequence.
9. Commit and push validated work.
10. Immediately continue to the next ordered task.
11. Reserve the full repository regression/build/installer sweep for milestone or release closure unless the task explicitly requires it.
12. Never claim PASS from logs alone.

## Do not stop for routine conditions

The following are not by themselves reasons to stop the queue:

- a provider is temporarily unavailable;
- a credential is not present;
- MFA/CAPTCHA requires the user;
- an external surface cannot legally or technically be automated;
- an SDS/TDS/formulation document is missing;
- a supplier does not disclose composition;
- one fixture fails parsing;
- a test reveals a code defect;
- a dependency or build script needs a normal repair.

Use the safe fallback, unresolved state, manual-assisted/user-attended path, fixture strategy, or code repair defined by the project and continue with independent work.

## Human gates that remain mandatory

Claude must not bypass:

- credentials, MFA, CAPTCHA or supplier authentication controls;
- supplier terms, legal/access restrictions or explicit authorization boundaries;
- human scientific/regulatory/material verification;
- Safety or Regulatory approval gates;
- LaboratoryTrial/TestResult measured-validation semantics;
- destructive operations on owner/user data without explicit authority;
- publication or external distribution not already authorized by the owner;
- owner decisions that materially change product scope.

If a genuine human gate prevents one task, record the exact condition and continue any independent work that can safely proceed.

## Scientific and data-integrity rules

- Missing stays missing; never silently convert unknown to zero/default.
- Supplier reference formulations are reference evidence, not measured validation.
- SDS/TDS evidence is not performance proof.
- Section 3 composition is not automatically active matter.
- Typical values are not specifications unless the source says so.
- Original source documents and historical versions remain immutable evidence.
- No AI/system/import actor may approve or verify regulated/master records.
- Saved formulation versions, laboratory results, datasets, models and lineage records must preserve exact historical identity.
- Safety, Regulatory, compatibility, manufacturing and availability hard gates outrank empirical/reference popularity.

## Git rules

- `V01` is the active Claude development branch.
- `main` is the stable completed release branch and must not be changed or merged into unless the owner explicitly requests it.
- Never force-push.
- Preserve unrelated owner changes.
- Push validated task transitions and code to `origin/V01`.
- Historical Codex branches/artifacts are not active task authority.

## Current handoff state

At the time Claude ownership was established:

- root `main/TASKS.md`: 178/178 complete, 0 open;
- `V01/tasks.v01.md`: 164/164 complete, 0 open, 0 active, 0 blocked;
- there is no pending implementation backlog to transfer;
- all future FormuLab implementation tasks should name Claude as the required actor and be executed under this governance.

