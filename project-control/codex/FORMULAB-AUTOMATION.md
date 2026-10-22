# FormuLab Codex Automation Contract

This file defines how a Codex run may execute the explicit current task in the root `TASKS.md`. The tracker remains the only task ledger.

## Run boundary

1. Run the **SPEC / Autonomous Queue** pass before implementation. The primary Codex orchestrator performs this pass; it does not need a separate long-lived agent.
2. Read root `AGENTS.md`, `TASKS.md`, and the explicit current task's referenced acceptance material. Treat `Current Task` and `Next Task` as the queue; never infer work from the first unchecked row or create scope from a dashboard card.
3. Confirm `Current Task`, `Current Task Status`, `Required Actor`, `Current Milestone`, and `Next Task` explicitly. Run `pnpm codex:tasks:check`, then `pnpm codex:tasks:claim` before implementation.
4. The queue-claim command validates the explicit task, branch, canonical remote, clean task file, and ledger totals. If the current task is `READY`, it changes only that row to `[~]`, sets `Current Task Status: IN_PROGRESS`, validates, commits only `TASKS.md`, and pushes the tracked branch. If already `IN_PROGRESS`, it resumes that task without editing. It never selects from checkbox order, changes `Next Task`, or claims a blocked task. If any check or publication fails, implementation must not start.
5. Confirm the repository is on the tracked project branch or an isolated task-owned worktree. Inspect owner changes before creating or modifying files. Stop before touching unrelated changes.
6. Work on one task at a time with one implementation worker. Use one read-only reviewer; use a specialist only when the task's security, data-integrity, or UI acceptance requires it.
7. After acceptance, update the completed row, `Project Status`, `Next Task`, and derived counts together. Publish that transition, then immediately repeat the SPEC / Autonomous Queue pass for the newly explicit current task when the authorized run covers it.

## Project activity stages

- After the published queue claim, create or update `project-control/codex/jobs/<task-id>/job.json` for the current task. This file is read-only dashboard activity metadata, not a task ledger; `TASKS.md` remains the sole authority for task selection and completion.
- Keep `id` and `task` equal to the explicit current `TASKS.md` entry. Set `stage` to `SPEC` while recording scope and acceptance, then `BUILD`, `REVIEW`, and `APPROVE` only when those actions begin. Use `MERGED` only after the accepted task change is pushed; use `ESCALATED` when work stops for a human gate or the bounded retry limit.
- Store the positive review `round` and `reviews` values (`pending`, `pass`, or `changes`) for `rules`, `code`, and `tests`. The single independent reviewer required by this repository may evaluate all three lenses; do not claim separate reviewer agents ran when they did not.
- Update `updatedAt` whenever the stage, round, or review result changes. Never infer a task stage from Codex thread titles or statuses. The dashboard validates and reads these files only; it never creates, edits, or deletes them.

## Acceptance and tests

- Review task acceptance criteria and changed files at each task boundary. Avoid full-project test suites during intermediate tasks.
- Run the complete required milestone suite once at its explicit closure task, after implementation is frozen. Capture concise command, exit code, and result evidence.
- If closure validation fails, fix the cause, run only affected checks during repair, then validate the final state before declaring the milestone accepted. A failed first run cannot be reported as a passing final run.
- Never mark a task complete solely because code exists. Require its acceptance evidence and independent review; the milestone closure task owns the integrated suite gate.

## Human gates

Continue without asking about routine coding decisions, local source edits, or safe read-only inspection. Stop and ask only when a named human decision, required approval, authentication, acceptance clarification, owner-data protection, or external publication decision is necessary. Never impersonate a human approval or verification.

## Workspace and cleanup

- Use one task-owned worktree and branch for the milestone; do not create a worktree per reviewer or per small task.
- Record volume free space before creating the worktree and after cleanup. Keep build outputs, logs, and temporary files under the task-owned workspace where possible.
- Remove only exact worktrees, branches, and temporary paths created by the run, after verifying the merge and path identity. Do not recursively clean shared TEMP, global AppData, Codex state, package caches, or owner files.
- Do not promise identical free-space readings. Report the measured delta and any application or operating-system writes that the run cannot own or remove.

## Token and agent budget

- Use the main Codex agent for task selection, implementation, tracker transitions, closure, and cleanup.
- Use one independent read-only reviewer for task diffs. Never launch a standing pool of six or seven reviewers.
- Keep prompts limited to the current task and its references. Prefer summaries and test failure excerpts over full logs. Select a lower-cost model for simple tracker/status work and reserve stronger reasoning for complex implementation or high-risk review.
- Run only one implementation task at a time; parallel work creates merge, disk, and token overhead without helping a sequential canonical tracker.

## Dashboard boundary

The Codex project dashboard is a separate local developer tool, not part of the FormuLab desktop product. It reads Codex project/thread state and the root `TASKS.md`; it never writes task state or reads Codex's private storage directly. Bind only to `127.0.0.1:9000`.

Start it with `pnpm codex:dashboard`, then open `http://127.0.0.1:9000`. Press Ctrl+C in that terminal to stop both the dashboard and its task-owned App Server process. The dashboard uses `thread/list` with `useStateDbOnly: true`; if that read-only source or `project/list` is unavailable, show a clear error instead of scanning or repairing Codex storage.
