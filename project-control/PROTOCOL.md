# FormuLab GPT ↔ Claude Coordination Protocol

Protocol version: `1.2`

## 0. Authority boundary

This protocol governs GPT ↔ Claude communication only.

It does **not** define H!veAI task authority.

Canonical H!veAI manifest:

`.hiveai/PROJECT_DASHBOARD.md`

Canonical FormuLab task ledger:

`docs/FORMULAB_V1_TASK_TRACKER.md`

Any communication/session state under `project-control/` is supporting evidence and must not override the canonical tracker.

## 1. Session lifecycle

1. GPT independently audits actual repository source.
2. GPT writes immutable audit evidence under `project-control/gpt/audits/`.
3. GPT writes the authorized execution prompt under `project-control/gpt/prompts/`.
4. Claude fetches/pulls, reads the authorized GPT files, implements only the authorized scope, and never edits GPT-owned substantive content.
5. Claude records implementation evidence under `project-control/claude/logs/` and handoff evidence under `project-control/claude/handoffs/` when those are the current configured paths.
6. Claude may create/update a session manifest under `project-control/sessions/` and communication summary under `project-control/state/`.
7. The canonical task tracker must remain the source of task status/dependency truth consumed by H!veAI.
8. GPT audits Claude's actual GitHub source and either closes or reopens the task.
9. Any accepted/reopened result must be reflected consistently in the canonical tracker/handoff so H!veAI sees the correct state through `.hiveai/PROJECT_DASHBOARD.md`.

## 2. Ownership

### GPT-owned, READ-ONLY to Claude

- `project-control/gpt/audits/**`
- `project-control/gpt/prompts/**`

Claude MUST NOT edit, append, reconstruct, reconcile, overwrite, or substantively rewrite these files.

### Claude-owned implementation evidence

- `project-control/claude/logs/**`
- `project-control/claude/handoffs/**`

GPT may inspect these files for audit but should not rewrite historical evidence.

### Shared coordination helpers

- `project-control/state/**`
- `project-control/sessions/**`

These files may summarize communication/session state. They are not a canonical task ledger and must never be used to contradict `docs/FORMULAB_V1_TASK_TRACKER.md`.

## 3. Status vocabulary

Communication/session summaries may use:

- `NOT_STARTED`
- `READY`
- `IN_PROGRESS`
- `IMPLEMENTED_PENDING_AUDIT`
- `CORRECTIVE`
- `CLOSED`
- `BLOCKED`

GPT audit verdicts:

- `NOT_AUDITED`
- `CLOSE_ACCEPT`
- `CONTINUE_REOPEN`
- `BLOCK`

These labels are evidence conveniences. H!veAI's operational task state comes from the canonical tracker declared by `.hiveai/PROJECT_DASHBOARD.md`.

## 4. Historical migration

Historical coordination artifacts may be moved without rewriting their substantive contents:

- `docs/audits/**` → `project-control/gpt/audits/**`
- `docs/prompts/**` → `project-control/gpt/prompts/**`
- `docs/external-logs/**` → `project-control/claude/logs/**`
- `docs/handoffs/**` → `project-control/claude/handoffs/**`

Use `git mv` whenever possible.

Important: if a currently declared canonical source such as the handoff is moved, update `.hiveai/PROJECT_DASHBOARD.md` intentionally after the move. Do not expect H!veAI to discover the new path from `project-control` automatically.

## 5. Safety rails

- Claude cannot self-accept its own implementation.
- GPT must audit actual GitHub source, not only Claude logs.
- Claude executes only the latest authorized GPT prompt.
- FVL task boundaries remain enforced by the canonical tracker and the latest authorized prompt.
- `project-control` never becomes a second dashboard or alternate task authority.
- `.hiveai/PROJECT_DASHBOARD.md` remains pointer-only and should only change when source routing itself changes.
