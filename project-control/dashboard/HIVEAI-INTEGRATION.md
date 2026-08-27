# H!veAI Project Dashboard Integration Contract

Integration version: `1.0`

## Purpose

H!veAI Project Dashboard should treat FormuLab's `project-control/` directory as the canonical project-communication feed.

The dashboard must not scrape arbitrary prose from the repository when structured control files are available.

## Primary sources

Fast current-state read:

- `project-control/state/project-state.json`

Historical/session index:

- `project-control/state/session-index.json`

Per-session detail:

- `project-control/sessions/*.json`

Human evidence/drill-down:

- `project-control/gpt/audits/*.md`
- `project-control/gpt/prompts/*.md`
- `project-control/claude/logs/*.md`
- `project-control/claude/handoffs/*.md`

## Dashboard behavior

After every detected control-hub commit or completed session manifest, H!veAI should refresh the FormuLab Project Dashboard card/section with:

1. Current task id and title.
2. Current machine status (`READY`, `IN_PROGRESS`, `IMPLEMENTED_PENDING_AUDIT`, `CORRECTIVE`, `CLOSED`, etc.).
3. Latest Claude implementation commit.
4. Latest GPT audit verdict and audited commit.
5. Latest session summary.
6. Tests/build summary.
7. Current blockers.
8. Next task and whether it is authorized.
9. Direct links to the latest audit, prompt, Claude log, and handoff.
10. Session timeline ordered newest first.

## Trust hierarchy

When sources disagree, dashboard truth precedence is:

1. Latest GPT audit verdict for acceptance/reopen truth.
2. `project-control/state/project-state.json` for current coordination state.
3. Latest session manifest for session execution details.
4. Claude log/handoff for implementation narrative.
5. Legacy tracker prose only as supporting context.

Claude cannot self-accept an implementation. A Claude log saying `ACCEPTANCE COMPLETE` remains `IMPLEMENTED_PENDING_AUDIT` until GPT records `CLOSE_ACCEPT` for the relevant commit.

## Polling / refresh strategy

Recommended implementation for H!veAI:

- Fetch GitHub branch HEAD for the configured project branch.
- If HEAD changed since last dashboard ingestion, fetch `project-state.json`.
- If `project-state.json` changed or `session-index.json` gained entries, ingest the delta.
- Persist the last ingested commit/session id inside H!veAI's own project data.
- Do not mutate FormuLab's GPT/Claude evidence during ingestion.

A GitHub webhook can replace polling later, but the data contract remains the same.

## Project registration payload

H!veAI should be able to register FormuLab with a record equivalent to:

```json
{
  "projectId": "formulab",
  "displayName": "FormuLab",
  "repository": "Sekiph82/FormuLab",
  "branch": "feature/laboratory-stability",
  "controlRoot": "project-control",
  "statePath": "project-control/state/project-state.json",
  "sessionIndexPath": "project-control/state/session-index.json"
}
```

## Migration state

While `migrationPending` is `true`, H!veAI should show a small `CONTROL HUB MIGRATION` state and avoid treating an incomplete session history as exhaustive. Once Claude completes the historical move/backfill, it sets `migrationPending` to `false` in both state files.
