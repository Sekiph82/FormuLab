# FormuLab Codex Automation Contract

This file defines how a Codex run may execute the explicit current task in the root `TASKS.md`. The tracker remains the only task ledger.

## Run boundary

1. Read root `AGENTS.md`, `TASKS.md`, and the current task's referenced acceptance material.
2. Confirm `Current Task`, `Current Task Status`, `Required Actor`, `Current Milestone`, and `Next Task` explicitly. Never infer a task from checkbox order.
3. Confirm the repository is on the tracked project branch or an isolated task-owned worktree. Inspect owner changes before creating or modifying files. Stop before touching unrelated changes.
4. Work on one task at a time with one implementation worker. Use one read-only reviewer; use a specialist only when the task's security, data-integrity, or UI acceptance requires it.
5. Update the task row and `Project Status` in the same task transition. Keep the tracker counts derived from its checkbox rows. Commit task-scoped changes; do not claim remote state until publication succeeds.

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
