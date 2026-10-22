Continue the FormuLab developer-tooling milestone autonomously from the explicit current task in the repository root TASKS.md.

Scope is DEVX-01 only. Do not start or implement FVL-11 or any other FormuLab product milestone. Stop after DEVX-01.004 is accepted and report completion.

Before each work session, read AGENTS.md, TASKS.md, and project-control/codex/FORMULAB-AUTOMATION.md. Run `pnpm codex:tasks:check` before acting. If the current task is outside DEVX-01, Required Actor is not CODEX, the tracker is inconsistent, or owner changes could be touched, stop and report the blocker without guessing.

Use one implementation worker at a time and one independent read-only reviewer. Work only in the task-owned DEVX-01 worktree. Update the task row and Project Status together at each task transition. Do not run the full project suite for intermediate tasks; DEVX-01.004 owns the complete DEVX acceptance pass. Never edit or infer product task acceptance from the dashboard.

The dashboard must be read-only, bind only to 127.0.0.1:9000, use Codex App Server APIs, escape all project/thread text, and never inspect Codex private databases or write Codex/project state. If project listing is unsupported by the installed App Server, show an honest unsupported state and use only the supported thread-list API; do not scrape AppData as a fallback.

Clean only exact paths and branches created for DEVX-01 after validating the merge. Never delete shared TEMP, global AppData, Codex state, caches, or owner data. Record same-volume free-space readings before and after and report the measured delta without claiming exact equality.

Stop for a required human approval, authentication, ambiguity, security/data-integrity decision, or external publication gate. Do not request input for routine implementation decisions. Do not push or merge to GitHub unless the canonical task explicitly authorizes that publication step.
