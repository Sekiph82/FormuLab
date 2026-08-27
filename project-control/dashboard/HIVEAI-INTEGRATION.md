# H!veAI Project Dashboard Integration Contract

Integration version: `1.1`

## Canonical entrypoint

H!veAI MUST begin FormuLab discovery from:

`/.hiveai/PROJECT_DASHBOARD.md` on `main`.

That file is the single canonical dashboard manifest and source map.

This `project-control/` tree is only the structured coordination/evidence backend referenced by that manifest. It is not a second dashboard definition.

## Discovery flow

1. Fetch `.hiveai/PROJECT_DASHBOARD.md` from `main`.
2. Read its `workingBranch` and control-path metadata.
3. Fetch the declared control files from that working branch.
4. Use the control files to render live status in H!veAI's own Project Dashboard UI.
5. Do not rewrite `.hiveai/PROJECT_DASHBOARD.md` as a generated status snapshot.

## Primary backend sources

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

After every detected change to a declared control source or completed session manifest, H!veAI should refresh the FormuLab Project Dashboard card/section with:

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

These values are rendered by H!veAI. They are not written back into `.hiveai/PROJECT_DASHBOARD.md` as generated status prose.

## Trust hierarchy

When sources disagree, dashboard truth precedence is:

1. `.hiveai/PROJECT_DASHBOARD.md` for discovery/routing authority.
2. Latest GPT audit verdict for acceptance/reopen truth.
3. `project-control/state/project-state.json` for current coordination state.
4. Latest session manifest for session execution details.
5. Claude log/handoff for implementation narrative.
6. Canonical task tracker for roadmap/task definition.
7. Legacy progress prose only as supporting context.

Claude cannot self-accept an implementation. A Claude log saying `ACCEPTANCE COMPLETE` remains `IMPLEMENTED_PENDING_AUDIT` until GPT records `CLOSE_ACCEPT` for the relevant commit.

## Polling / refresh strategy

Recommended implementation for H!veAI:

- Watch `main:.hiveai/PROJECT_DASHBOARD.md` for source-map changes.
- Resolve `workingBranch` from that manifest.
- Watch the resolved branch for declared control-source changes.
- If the working-branch HEAD changed, fetch `project-state.json`.
- If `project-state.json` changed or `session-index.json` gained entries, ingest the delta.
- Persist the last ingested commit/session id inside H!veAI's own project data.
- Do not mutate FormuLab's GPT/Claude evidence during ingestion.

A GitHub webhook can replace polling later, but the data contract remains the same.

## Effective registration

Registration is derived from `.hiveai/PROJECT_DASHBOARD.md`; an equivalent resolved record is:

```json
{
  "projectId": "formulab",
  "displayName": "FormuLab",
  "repository": "Sekiph82/FormuLab",
  "manifestBranch": "main",
  "manifestPath": ".hiveai/PROJECT_DASHBOARD.md",
  "workingBranch": "feature/laboratory-stability",
  "controlRoot": "project-control",
  "statePath": "project-control/state/project-state.json",
  "sessionIndexPath": "project-control/state/session-index.json"
}
```

## Migration state

While `migrationPending` is `true`, H!veAI should show a small `CONTROL HUB MIGRATION` state and avoid treating an incomplete session history as exhaustive. Once Claude completes the historical move/backfill, it sets `migrationPending` to `false` in the control-state files.
