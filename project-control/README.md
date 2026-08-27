# FormuLab Project Control Hub

This directory is the single coordination surface for GPT audits/prompts, Claude implementation evidence, and H!veAI Project Dashboard ingestion.

## Goals

1. Keep GPT-owned and Claude-owned artifacts physically separated.
2. Give every work session a stable session identity.
3. Make project state machine-readable for H!veAI.
4. Preserve the complete historical audit/prompt/log/handoff record.
5. Prevent one agent from rewriting the other agent's evidence.

## Canonical structure

```text
project-control/
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

- GPT owns `project-control/gpt/**`.
- Claude owns `project-control/claude/**` and implementation-session manifests under `project-control/sessions/**` when it executes a coding session.
- `project-control/state/project-state.json` and `project-control/state/session-index.json` are shared protocol state. An actor may update only fields explicitly assigned to that actor by `PROTOCOL.md`.
- H!veAI reads the control hub and mirrors summaries into the Project Dashboard. H!veAI must not rewrite GPT audits/prompts or Claude source logs.

## Migration

The historical folders currently under `docs/audits`, `docs/prompts`, `docs/external-logs`, and `docs/handoffs` will be moved by Claude using the migration instructions in `project-control/migration/FORMULAB-CONTROL-MIGRATION-000001.md`.

Do not delete history. Prefer `git mv` so Git can retain rename ancestry.
