STATUS: READY

Applied dashboard answer Q-FVL-11.005-1 exactly once to `TASKS.md`, cleared the open question, and recorded the owner decision. The selected direction is the new workspace-based UI as the single v1 default after FVL-11 acceptance confirms feature parity and historical-project access; the existing UI remains a temporary compatibility bridge for historical deep links and workflows not yet mapped. No default switch or history deletion was performed before the explicit condition.

Validation:
- Dashboard `/api/overview` showed the question answered/removed after the TASKS update.
- `pnpm codex:tasks:check` and `git diff --check` — passed.

No product source changes were required for this decision task.
