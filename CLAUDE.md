AGENTS.md

## H!veAI GitHub tracking

- Read repository root `TASKS.md` before doing project work. It is the only current project-status tracker.
- H!veAI project truth is GitHub repository metadata plus root `TASKS.md` on the configured tracked branch `feature/laboratory-stability`.
- `PROGRESS.md`, `project-control/**`, handoffs, audits, prompts, logs, roadmap/spec documents, GitHub issues, and legacy tracker archives are evidence/history only and must not override `TASKS.md`.
- Valid task markers are `[x]` complete, `[~]` in progress, `[ ]` planned/pending, and `[!]` blocked.
- `Current Task`, `Current Sprint`, `Current Milestone`, `Next Task`, and `Required Actor` are explicit in the `Project Status` section. Do not infer them from prose or the first unchecked row.
- Update the task row and `Project Status` atomically when work changes state, then commit and push the tracked branch before claiming the remote state changed.
- Do not create or revive `.hiveai` control-plane files or any second task ledger.
- Follow the remaining project rules in `AGENTS.md`.
