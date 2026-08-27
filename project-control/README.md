# FormuLab Project Control Backend

This directory is the structured coordination/evidence backend for the canonical H!veAI dashboard manifest:

`/.hiveai/PROJECT_DASHBOARD.md` on `main`.

It is **not a second dashboard** and must never compete with or replace `.hiveai/PROJECT_DASHBOARD.md`.

## Role in the architecture

`.hiveai/PROJECT_DASHBOARD.md` is the single project-dashboard entrypoint and source map. H!veAI starts there, learns the working branch and declared control paths, then reads this directory for machine-readable state and GPT↔Claude session evidence.

## Goals

1. Keep GPT-owned and Claude-owned artifacts physically separated.
2. Give every work session a stable session identity.
3. Expose compact machine-readable state that `.hiveai/PROJECT_DASHBOARD.md` can point H!veAI toward.
4. Preserve the complete historical audit/prompt/log/handoff record.
5. Prevent one agent from rewriting the other agent's evidence.
6. Keep generated session/status data out of `.hiveai/PROJECT_DASHBOARD.md` itself.

## Canonical structure

```text
.hiveai/
  PROJECT_DASHBOARD.md        # CANONICAL H!veAI ENTRYPOINT, on main

project-control/              # backend referenced by the manifest
  README.md
  PROTOCOL.md
  dashboard/
    HIVEAI-INTEGRATION.md
  state/
    project-state.json
    session-index.json
  gpt/
    audits/
    prompts/
  claude/
    logs/
    handoffs/
  sessions/
    <session-id>.json
  migration/
    FORMULAB-CONTROL-MIGRATION-000001.md
```

## Ownership

- `.hiveai/PROJECT_DASHBOARD.md` is the canonical dashboard source map. It should remain pointer-only and should not receive generated per-session status commits.
- GPT owns `project-control/gpt/**`.
- Claude owns `project-control/claude/**` and implementation-session manifests under `project-control/sessions/**` when it executes a coding session.
- `project-control/state/project-state.json` and `project-control/state/session-index.json` are shared protocol state. An actor may update only fields explicitly assigned to that actor by `PROTOCOL.md`.
- H!veAI reads this backend only because `.hiveai/PROJECT_DASHBOARD.md` points to it. H!veAI mirrors/render summaries inside its own dashboard UI, not by rewriting the canonical manifest after every session.

## Migration

The historical folders currently under `docs/audits`, `docs/prompts`, `docs/external-logs`, and `docs/handoffs` will be moved by Claude using the migration instructions in `project-control/migration/FORMULAB-CONTROL-MIGRATION-000001.md`.

Do not delete history. Prefer `git mv` so Git can retain rename ancestry.
