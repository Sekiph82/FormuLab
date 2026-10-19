AGENTS.md

## Compatibility notice

Claude is **not** the default FormuLab implementation executor.

The primary implementation/execution agent is **Codex**, as defined in:
- https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md
- https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md

If Claude is explicitly assigned a bounded task by the owner, it must follow `AGENTS.md` and `TASKS.md` and must not create a competing task ledger or override the actor named in `TASKS.md`.

## H!veAI GitHub tracking

- Read https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md before doing project work. It is the only current project-status tracker.
- H!veAI project truth is GitHub repository metadata plus root `TASKS.md` on the configured tracked branch `main`.
- `PROGRESS.md`, `project-control/**`, handoffs, audits, prompts, logs, roadmap/spec documents, GitHub issues, and legacy tracker archives are evidence/history only and must not override `TASKS.md`.
- Valid task markers are `[x]` complete, `[~]` in progress, `[ ]` planned/pending, and `[!]` blocked.
- `Current Task`, `Current Sprint`, `Current Milestone`, `Next Task`, and `Required Actor` are explicit in the `Project Status` section.
- Update the task row and `Project Status` atomically when work changes state, then commit and push `main` before claiming the remote state changed.
- Do not create or revive `.hiveai` control-plane files or any second task ledger.
- Follow all remaining project rules in https://github.com/Sekiph82/FormuLab/blob/main/AGENTS.md.
