# FormuLab Codex Automation Contract

This file defines how a Codex run may execute the explicit current task in the root `TASKS.md`. The tracker remains the only task ledger.

## Run boundary

1. Run the **SPEC / Autonomous Queue** pass before implementation. The primary Codex orchestrator performs this pass; it does not need a separate long-lived agent.
2. Read root `AGENTS.md`, `TASKS.md`, and the explicit current task's referenced acceptance material. Treat `Current Task` and `Next Task` as the queue; never infer work from the first unchecked row or create scope from dashboard data.
3. Confirm `Current Task`, `Current Task Status`, `Required Actor`, `Current Milestone`, and `Next Task` explicitly. Run `pnpm codex:tasks:check`, then `pnpm codex:tasks:claim` before implementation.
4. The queue-claim command validates the explicit task, tracked branch, clean task file, and ledger totals without contacting a remote. If the current task is `READY`, it changes only that row to `[~]`, sets `Current Task Status: IN_PROGRESS`, validates, and commits only `TASKS.md` locally. If already `IN_PROGRESS`, it resumes that task without editing. It never selects from checkbox order, changes `Next Task`, claims blocked work, or pushes. If any local check fails, implementation must not start.
5. Work in the configured canonical FormuLab checkout. Do not create a clone, worktree, or extra project directory unless the explicit canonical task requires it. Preserve owner changes; if a task overlaps them, block only that task and continue with unrelated READY work.
6. Work on one task at a time with one implementation worker. Use one read-only reviewer; use a specialist only when the task's security, data-integrity, or UI acceptance requires it.
7. After acceptance, update the completed row, `Project Status`, `Next Task`, and derived counts together. Record and commit the transition locally, then immediately repeat the SPEC / Autonomous Queue pass for the newly explicit current task. Autonomous continuation is already authorized: do not stop at task, sprint, or milestone boundaries; continue until the queue is empty.
8. Before starting each task, inspect `TASKS.md` Questions for Şekip and the current Codex conversation for answers to open Q-IDs. Record each answer exactly once under `Owner Decisions` with its Q-ID and task ID, remove that Q-ID from open questions, and return only its blocked task to `[ ]`/READY. Do not interrupt unrelated work already in progress; apply answers at the next task boundary. Ask every genuine owner question directly in the current Codex conversation. Do not route questions or answers through the dashboard, an inbox, or another project. Block only the affected task and keep scanning past every blocked task until the next READY task independent of all open questions is found. Never wait while independent READY work remains. Wait only when no READY task can proceed without pending owner input or the queue is empty.
9. When every canonical checkbox task is `[x]`, set `Current Task: None`, `Current Task Status: COMPLETE`, and `Next Task: None`; validate and commit this terminal state locally. The queue claimant then returns without selecting another task.

## Project activity stages

- After the local queue claim, create or update `project-control/codex/jobs/<task-id>/job.json` only when the canonical task acceptance criteria require that activity record. It is optional activity metadata, never a task ledger; `TASKS.md` remains the sole authority for task selection and completion. Do not start, publish to, or depend on the dashboard for task execution or owner Q&A.
- Keep `id` and `task` equal to the explicit current `TASKS.md` entry. Set `stage` to `SPEC` while recording scope and acceptance, then `BUILD`, `REVIEW`, and `APPROVE` only when those actions begin. Use `MERGED` only after an explicitly authorized publication; use `ESCALATED` when work stops for a human gate or the bounded retry limit.
- Store the positive review `round` and `reviews` values (`pending`, `pass`, or `changes`) for `rules`, `code`, and `tests`. The single independent reviewer required by this repository may evaluate all three lenses; do not claim separate reviewer agents ran when they did not.
- Update `updatedAt` whenever the stage, round, or review result changes. Never infer a task stage from Codex thread titles or statuses. These optional files do not control task selection or completion.

## Acceptance and tests

- Review task acceptance criteria and changed files at each task boundary. Avoid full-project test suites during intermediate tasks.
- Run the complete required milestone suite once at its explicit closure task, after implementation is frozen. Capture concise command, exit code, and result evidence.
- If closure validation fails, fix the cause, run only affected checks during repair, then validate the final state before declaring the milestone accepted. A failed first run cannot be reported as a passing final run.
- Never mark a task complete solely because code exists. Require its acceptance evidence and independent review; the milestone closure task owns the integrated suite gate.

## Human gates

Continue without asking about routine coding decisions, local source edits, or safe read-only inspection. For a required human decision, approval, authentication, acceptance clarification, or owner-data protection, record and ask the exact question in this Codex conversation, block only dependent work, and continue unrelated READY tasks. Never impersonate a human approval or verification. Do not wait while unrelated READY work remains. Do not contact a remote or publish changes; the project instructions prohibit remote setup and pushes.

## Workspace and cleanup

- Stay in the canonical checkout and preserve all owner files and uncommitted changes. Do not treat `project-control/codex/owner-answers.jsonl` as task authority or copy it as an automation dependency.
- Keep build outputs, logs, and temporary files under the canonical workspace where possible. Do not delete shared TEMP, global AppData, Codex state, package caches, or owner files.

## Token and agent budget

- Use the main Codex agent for task selection, implementation, tracker transitions, closure, and cleanup.
- Use one independent read-only reviewer for task diffs. Never launch a standing pool of six or seven reviewers.
- Keep prompts limited to the current task and its references. Prefer summaries and test failure excerpts over full logs. Select a lower-cost model for simple tracker/status work and reserve stronger reasoning for complex implementation or high-risk review.
- Run only one implementation task at a time; parallel work creates merge, disk, and token overhead without helping a sequential canonical tracker.

## Dashboard boundary

The Codex project dashboard is a separate local developer tool and is not part of the autonomous coding or owner-question workflow. Do not start it, publish work to it, or use it to ask or collect owner questions. Ask the owner in the current Codex conversation and record answers in `TASKS.md`. Preserve historical dashboard code and answer-inbox data unless a separately authorized task explicitly changes them.
