# FormuLab Codex Automation Contract

This file defines how a Codex run may execute the explicit current task in the root `TASKS.md`. The tracker remains the only task ledger.

## Run boundary

1. Run the **SPEC / Autonomous Queue** pass before implementation. The primary Codex orchestrator performs this pass; it does not need a separate long-lived agent.
2. Read root `AGENTS.md`, `TASKS.md`, and the explicit current task's referenced acceptance material. Treat `Current Task` and `Next Task` as the queue; never infer work from the first unchecked row or create scope from a dashboard card.
3. Confirm `Current Task`, `Current Task Status`, `Required Actor`, `Current Milestone`, and `Next Task` explicitly. Run `pnpm codex:tasks:check`, then `pnpm codex:tasks:claim` before implementation.
4. The queue-claim command validates the explicit task, branch, canonical remote, clean task file, and ledger totals. If the current task is `READY`, it changes only that row to `[~]`, sets `Current Task Status: IN_PROGRESS`, validates, commits only `TASKS.md`, and pushes the tracked branch. If already `IN_PROGRESS`, it resumes that task without editing. It never selects from checkbox order, changes `Next Task`, or claims a blocked task. If any check or publication fails, implementation must not start.
5. Confirm the repository is on the tracked project branch or an isolated task-owned worktree. Inspect owner changes before creating or modifying files. Stop before touching unrelated changes.
6. Work on one task at a time with one implementation worker. Use one read-only reviewer; use a specialist only when the task's security, data-integrity, or UI acceptance requires it.
7. After acceptance, update the completed row, `Project Status`, `Next Task`, and derived counts together. Publish that transition, then immediately repeat the SPEC / Autonomous Queue pass for the newly explicit current task. Autonomous continuation is already authorized: do not stop at task, sprint, or milestone boundaries; continue until the queue is empty.
8. Before starting each task, inspect `TASKS.md` Questions for Şekip and the dashboard answer inbox. Process each unanswered inbox record exactly once: copy its exact answer under `Owner Decisions` with Q-ID and task ID, remove that Q-ID from open questions, and return only its blocked task to `[ ]`/READY. A question accepts one answer; the server rejects duplicate submissions while the Q-ID remains open. Do not interrupt unrelated work already in progress; process answers at the next task boundary. Surface genuine owner decisions through the dashboard Questions panel, mark only the affected task blocked, then advance to the next READY task that does not depend on that answer. Never wait for an answer while unrelated READY work remains. Stop only if no unrelated READY task exists and no answer has arrived, or the queue is empty.
9. When every canonical checkbox task is `[x]`, set `Current Task: None`, `Current Task Status: COMPLETE`, and `Next Task: None`; validate this terminal state and let the queue claimant return without selecting another task.

## Project activity stages

- After the published queue claim, create or update `project-control/codex/jobs/<task-id>/job.json` for the current task. This file is dashboard activity metadata, not a task ledger; `TASKS.md` remains the sole authority for task selection and completion. The dashboard may append owner-submitted responses only to `project-control/codex/owner-answers.jsonl`; the runner, never the dashboard, applies those answers to `TASKS.md`.
- Keep `id` and `task` equal to the explicit current `TASKS.md` entry. Set `stage` to `SPEC` while recording scope and acceptance, then `BUILD`, `REVIEW`, and `APPROVE` only when those actions begin. Use `MERGED` only after the accepted task change is pushed; use `ESCALATED` when work stops for a human gate or the bounded retry limit.
- Store the positive review `round` and `reviews` values (`pending`, `pass`, or `changes`) for `rules`, `code`, and `tests`. The single independent reviewer required by this repository may evaluate all three lenses; do not claim separate reviewer agents ran when they did not.
- Update `updatedAt` whenever the stage, round, or review result changes. Never infer a task stage from Codex thread titles or statuses. The dashboard validates and reads these files only; it never creates, edits, or deletes them.

## Acceptance and tests

- Review task acceptance criteria and changed files at each task boundary. Avoid full-project test suites during intermediate tasks.
- Run the complete required milestone suite once at its explicit closure task, after implementation is frozen. Capture concise command, exit code, and result evidence.
- If closure validation fails, fix the cause, run only affected checks during repair, then validate the final state before declaring the milestone accepted. A failed first run cannot be reported as a passing final run.
- Never mark a task complete solely because code exists. Require its acceptance evidence and independent review; the milestone closure task owns the integrated suite gate.

## Human gates

Continue without asking about routine coding decisions, local source edits, or safe read-only inspection. For a required human decision, approval, authentication, acceptance clarification, owner-data protection, or external publication decision, record and surface the exact question, block only dependent work, and continue unrelated READY tasks. Never impersonate a human approval or verification. Do not wait while unrelated READY work remains.

## Workspace and cleanup

- Use one task-owned worktree and branch for the milestone; do not create a worktree per reviewer or per small task.
- Before switching milestones, copy `project-control/codex/owner-answers.jsonl` byte-for-byte into the successor worktree, verify hashes, and retain the prior copy until the answer is recorded under `TASKS.md` Owner Decisions and published. Never remove an inbox containing an unprocessed answer; reconnect the dashboard to the successor only after verifying the handoff.
- Record volume free space before creating the worktree and after cleanup. Keep build outputs, logs, and temporary files under the task-owned workspace where possible.
- Remove only exact worktrees, branches, and temporary paths created by the run, after verifying the merge and path identity. Do not recursively clean shared TEMP, global AppData, Codex state, package caches, or owner files.
- Do not promise identical free-space readings. Report the measured delta and any application or operating-system writes that the run cannot own or remove.

## Token and agent budget

- Use the main Codex agent for task selection, implementation, tracker transitions, closure, and cleanup.
- Use one independent read-only reviewer for task diffs. Never launch a standing pool of six or seven reviewers.
- Keep prompts limited to the current task and its references. Prefer summaries and test failure excerpts over full logs. Select a lower-cost model for simple tracker/status work and reserve stronger reasoning for complex implementation or high-risk review.
- Run only one implementation task at a time; parallel work creates merge, disk, and token overhead without helping a sequential canonical tracker.

## Dashboard boundary

The Codex project dashboard is a separate local developer tool, not part of the FormuLab desktop product. It reads Codex project/thread state and the root `TASKS.md`; it never writes task state or reads Codex's private storage directly. Its only write is an owner-submitted answer appended to `project-control/codex/owner-answers.jsonl`. Bind only to `127.0.0.1:9000`.

Start it with `pnpm codex:dashboard`, then open `http://127.0.0.1:9000`. Press Ctrl+C in that terminal to stop both the dashboard and its task-owned App Server process. The dashboard uses `thread/list` with `useStateDbOnly: true`; if that read-only source or `project/list` is unavailable, show a clear error instead of scanning or repairing Codex storage.
