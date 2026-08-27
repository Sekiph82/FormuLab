# FormuLab GPT ↔ Claude Project Control Archive

`project-control/` is a coordination and evidence archive for GPT ↔ Claude work.

It is **not** the H!veAI Project Dashboard, **not** the canonical task ledger, and **not** a replacement for `.hiveai/PROJECT_DASHBOARD.md`.

## H!veAI authority

The canonical H!veAI project manifest is:

`.hiveai/PROJECT_DASHBOARD.md`

The canonical FormuLab task ledger is:

`docs/FORMULAB_V1_TASK_TRACKER.md`

H!veAI should discover project sources from the manifest and derive task truth from the canonical tracker. Files under `project-control/` are supporting communication/history sources only when the manifest lists them.

## Purpose

This archive exists to:

1. Separate GPT audits/prompts from Claude implementation logs/handoffs.
2. Preserve the complete communication history between the two agents.
3. Give each implementation/audit cycle a stable session identity where useful.
4. Prevent Claude from rewriting GPT-owned audit/prompt evidence.
5. Provide drill-down evidence that H!veAI may display as project history without promoting it into task authority.

## Structure

```text
project-control/
  README.md
  PROTOCOL.md
  gpt/
    audits/
    prompts/
  claude/
    logs/
    handoffs/
  sessions/
    <session-id>.json
  state/
    project-state.json
    session-index.json
  migration/
    ...
```

`state/` and `sessions/` are coordination conveniences for GPT/Claude. They are not the canonical H!veAI task source and must never override `docs/FORMULAB_V1_TASK_TRACKER.md`.

## Ownership

- GPT owns `project-control/gpt/**`.
- Claude may read GPT-owned files but must not edit their substantive content.
- Claude owns `project-control/claude/**` implementation evidence.
- GPT may inspect Claude evidence for audit but should not rewrite historical Claude logs.
- Shared session/state files may summarize communication status, but task completion truth must be synchronized back to the canonical tracker.

## Historical migration

The planned migration may move historical coordination files:

- `docs/audits/**` → `project-control/gpt/audits/**`
- `docs/prompts/**` → `project-control/gpt/prompts/**`
- `docs/external-logs/**` → `project-control/claude/logs/**`
- `docs/handoffs/**` → `project-control/claude/handoffs/**`

Use `git mv` where possible and preserve content/history. If the canonical handoff path changes, `.hiveai/PROJECT_DASHBOARD.md` must be intentionally updated afterward so H!veAI follows the new source.
