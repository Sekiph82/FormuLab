# H!veAI Integration Note for FormuLab Project-Control Evidence

Integration version: `1.2`

## Canonical discovery

H!veAI must discover FormuLab through:

`.hiveai/PROJECT_DASHBOARD.md`

That manifest is the only Project Dashboard source map.

`project-control/` is not a dashboard backend contract and must not be auto-promoted into task authority.

## Canonical task authority

H!veAI task state, dependencies, completion counts, and active-task truth come from the canonical task source declared in `.hiveai/PROJECT_DASHBOARD.md`:

`docs/FORMULAB_V1_TASK_TRACKER.md`

## Role of project-control

Files under `project-control/` are supporting evidence/history only:

- GPT audits: `project-control/gpt/audits/**`
- GPT prompts: `project-control/gpt/prompts/**`
- Claude logs: `project-control/claude/logs/**`
- Claude handoffs: `project-control/claude/handoffs/**`
- optional communication summaries: `project-control/state/**`
- optional session manifests: `project-control/sessions/**`

H!veAI may surface these in Audit, Logs, Activity, or drill-down views when they are listed by the project manifest, but they must not replace the canonical task ledger.

## Trust model

1. `.hiveai/PROJECT_DASHBOARD.md` tells H!veAI where the project authorities are.
2. `docs/FORMULAB_V1_TASK_TRACKER.md` is task authority.
3. Current handoff declared by the manifest provides current-session orientation.
4. GPT audits and Claude logs are evidence/history.
5. `project-control/state/**` is coordination metadata only.

If an audit reopens a task, the canonical tracker must be synchronized. H!veAI should not be required to merge competing task states from audit JSON and tracker prose.

## Refresh behavior

Use H!veAI's existing watcher-driven source invalidation model.

Watch the sources declared by `.hiveai/PROJECT_DASHBOARD.md`. When the canonical tracker changes, refresh task state. When audit/log/history sources change, refresh evidence/history panels without changing task authority unless the tracker also changed.

Do not write generated session state back into `.hiveai/PROJECT_DASHBOARD.md`.
