# FormuLab GPT ↔ Claude ↔ H!veAI Coordination Protocol

Protocol version: `1.1`

## 0. Canonical dashboard authority

The single canonical H!veAI entrypoint for FormuLab is:

`/.hiveai/PROJECT_DASHBOARD.md` on `main`.

This protocol and the entire `project-control/` tree are backend coordination/evidence sources referenced by that manifest. They are not a separate dashboard definition.

H!veAI MUST resolve branch/path routing from `.hiveai/PROJECT_DASHBOARD.md` first, then consume the sources declared there. Generated per-session status must be rendered inside H!veAI, not written back into the canonical manifest.

## 1. Session lifecycle

Every coding/audit cycle uses one stable `sessionId`.

Recommended format:

`FORMULAB-<TASK-ID>-<YYYYMMDD-HHMMSS>-<actor>`

Example:

`FORMULAB-FVL-05.010-20260827-113500-claude`

A normal cycle is:

1. GPT independently audits the current repository state.
2. GPT writes an immutable audit under `project-control/gpt/audits/`.
3. GPT writes the next immutable execution prompt under `project-control/gpt/prompts/`.
4. Claude fetches/pulls, reads both files, implements only the authorized task scope, and never edits GPT-owned files.
5. Claude appends or creates implementation evidence under `project-control/claude/logs/` and updates the current handoff under `project-control/claude/handoffs/`.
6. Claude writes/updates the session manifest under `project-control/sessions/`.
7. Claude updates only the Claude-owned fields in `project-control/state/project-state.json` and appends the session record to `project-control/state/session-index.json`.
8. H!veAI begins from `main:.hiveai/PROJECT_DASHBOARD.md`, resolves the working branch/control paths, ingests the changed state/index/session files, and refreshes its own Project Dashboard UI.
9. GPT audits Claude's actual GitHub source and evidence, then updates only GPT-owned state fields. If accepted, GPT creates the next audit/prompt pair. If rejected, GPT creates a corrective pair for the same task.

## 2. Ownership boundaries

### Canonical H!veAI manifest

- `.hiveai/PROJECT_DASHBOARD.md` on `main` is pointer-only routing/configuration authority.
- It MUST NOT become a generated session ledger.
- GPT, Claude, or H!veAI should change it only when project source routing/authority configuration itself changes.

### GPT-owned, READ-ONLY to Claude

- `project-control/gpt/audits/**`
- `project-control/gpt/prompts/**`
- GPT fields in shared state:
  - `gpt.latestAudit`
  - `gpt.latestPrompt`
  - `gpt.auditVerdict`
  - `gpt.auditedCommit`
  - `gpt.updatedAt`

Claude MUST NOT edit, append, rename, reconstruct, reconcile, or overwrite GPT-owned files.

### Claude-owned, READ-ONLY to GPT except audit inspection

- `project-control/claude/logs/**`
- `project-control/claude/handoffs/**`
- Claude fields in shared state:
  - `claude.latestImplementationCommit`
  - `claude.latestLog`
  - `claude.latestHandoff`
  - `claude.sessionStatus`
  - `claude.updatedAt`

GPT may read these files for audit but should not rewrite Claude's historical evidence.

### Shared protocol files

- `project-control/state/project-state.json`
- `project-control/state/session-index.json`
- `project-control/sessions/**`

Shared files must be changed minimally and deterministically. Never erase historical session entries.

## 3. Status vocabulary

Use only these task statuses in machine-readable state:

- `NOT_STARTED`
- `READY`
- `IN_PROGRESS`
- `IMPLEMENTED_PENDING_AUDIT`
- `CORRECTIVE`
- `CLOSED`
- `BLOCKED`

Audit verdicts:

- `NOT_AUDITED`
- `CLOSE_ACCEPT`
- `CONTINUE_REOPEN`
- `BLOCK`

## 4. Session manifest schema

Each file under `project-control/sessions/` is JSON with this conceptual shape:

```json
{
  "schemaVersion": "1.0",
  "sessionId": "FORMULAB-FVL-05.010-20260827-113500-claude",
  "project": "FormuLab",
  "repository": "Sekiph82/FormuLab",
  "branch": "feature/laboratory-stability",
  "taskId": "FVL-05.010",
  "actor": "claude",
  "status": "IMPLEMENTED_PENDING_AUDIT",
  "startedAt": "2026-08-27T11:35:00+03:00",
  "endedAt": "2026-08-27T12:10:00+03:00",
  "inputAudit": "project-control/gpt/audits/...md",
  "inputPrompt": "project-control/gpt/prompts/...md",
  "implementationCommit": "<sha>",
  "logFile": "project-control/claude/logs/...md",
  "handoffFile": "project-control/claude/handoffs/...md",
  "summary": "Short dashboard-ready summary.",
  "tests": [{"name": "shared", "result": "PASS", "detail": "..."}],
  "blockers": [],
  "nextTask": "FVL-05.011"
}
```

## 5. Dashboard summary rules

Every completed Claude session must produce a concise dashboard-ready summary containing:

- task id and title
- current status
- implementation commit SHA
- what changed
- tests/build result
- blockers or corrective findings
- latest GPT audit verdict when available
- next authorized task

H!veAI discovers these sources through `.hiveai/PROJECT_DASHBOARD.md`, uses `project-control/state/project-state.json` as the fast current-state source, and uses `session-index.json` + `sessions/*.json` for history/drill-down.

## 6. Historical migration rules

Historical files are moved, not rewritten.

Mapping:

- `docs/audits/**` → `project-control/gpt/audits/**`
- `docs/prompts/**` → `project-control/gpt/prompts/**`
- `docs/external-logs/**` → `project-control/claude/logs/**`
- `docs/handoffs/**` → `project-control/claude/handoffs/**`

Use `git mv` whenever possible. Preserve filenames and exact contents during the move. After moving, update repository references that still point at the old paths. Do not modify the substantive content of historical audits/prompts/logs merely to make them look newer.

## 7. Safety rails

- No actor may claim acceptance for its own implementation. Claude may claim implementation complete, but only GPT can set `auditVerdict = CLOSE_ACCEPT`.
- GPT must audit actual GitHub source, not accept Claude narrative alone.
- Claude must execute only the latest authorized GPT prompt and must obey task boundary restrictions such as “do not start next task.”
- H!veAI is a reader/aggregator of this protocol and must not silently change task truth.
- `.hiveai/PROJECT_DASHBOARD.md` remains the canonical source map even if `project-control/` evolves internally.
