---
hiveaiDashboardSchema: hiveai-project-dashboard/v1
projectKey: formulab
repository: Sekiph82/FormuLab
branchPolicy: main-manifest-with-explicit-working-source
workingBranch: feature/laboratory-stability
dashboardMode: source-map
refreshPolicy: watcher-driven source invalidation; no generated status commits
controlRoot: project-control
controlStatePath: project-control/state/project-state.json
controlSessionIndexPath: project-control/state/session-index.json
controlProtocolPath: project-control/PROTOCOL.md
---

# H!veAI Project Dashboard Manifest

This file is the **single canonical H!veAI dashboard entrypoint for FormuLab**.

It is a pointer map, not a generated task/status ledger. H!veAI MUST discover project status, GPT↔Claude coordination state, session history, audits, prompts, implementation logs, and handoffs through the sources declared here. No parallel dashboard manifest may supersede this file.

## Project identity

Project: FormuLab
Repository: `Sekiph82/FormuLab`
Canonical dashboard manifest branch: `main`
Current development/control branch: `feature/laboratory-stability`
Canonical dashboard manifest: `.hiveai/PROJECT_DASHBOARD.md`

## Source authorities

### Dashboard/control authority

Canonical H!veAI entrypoint: `.hiveai/PROJECT_DASHBOARD.md` on `main`.

Structured coordination/control root on the current development branch:
- `project-control/PROTOCOL.md`
- `project-control/state/project-state.json`
- `project-control/state/session-index.json`
- `project-control/sessions/*.json`

The `project-control/` tree is **not a second dashboard**. It is the structured evidence/state backend referenced by this manifest.

### GPT/Claude communication evidence

GPT-owned audit authority:
- `project-control/gpt/audits/**`

GPT-owned execution prompt authority:
- `project-control/gpt/prompts/**`

Claude-owned implementation evidence:
- `project-control/claude/logs/**`

Claude-owned handoff evidence:
- `project-control/claude/handoffs/**`

Ownership and acceptance semantics are defined by:
- `project-control/PROTOCOL.md`

### Project/task sources

Current canonical structured task source on the development branch:
- `docs/FORMULAB_V1_TASK_TRACKER.md`

Current project handoff source after Control Hub migration:
- `project-control/claude/handoffs/FORMULAB_V1_CURRENT.md`

Progress/history source:
- `PROGRESS.md` when present on the queried branch
- `project-control/claude/logs/**` for session implementation history

Agent instruction sources:
- `AGENTS.md`
- `CLAUDE.md`

Security source:
- `SECURITY.md`

Build/test metadata:
- `package.json`
- workspace manifests
- Rust/Python manifests where present

## Authority hierarchy

When sources disagree, H!veAI should apply this precedence:

1. This `.hiveai/PROJECT_DASHBOARD.md` manifest for **where to read** and branch/path routing.
2. Latest GPT audit verdict for whether an implementation is accepted, reopened, or blocked.
3. `project-control/state/project-state.json` for current coordination state.
4. Latest `project-control/sessions/*.json` manifest for session execution facts.
5. Claude log/handoff for implementation narrative and evidence.
6. `docs/FORMULAB_V1_TASK_TRACKER.md` for roadmap/task definitions and dependencies.
7. `PROGRESS.md` and other historical prose as supporting history only.

Claude cannot self-accept an implementation. A Claude log may say implementation complete, but H!veAI must keep the task at `IMPLEMENTED_PENDING_AUDIT` until the relevant GPT audit records `CLOSE_ACCEPT` for that implementation commit.

## Refresh model

H!veAI should:

1. Start from this file on `main`.
2. Read `workingBranch` and the control paths from this manifest.
3. Watch the configured working branch for changes to `project-control/**`, the canonical task tracker, and explicitly declared sources.
4. On invalidation, fetch `project-control/state/project-state.json` first for fast current state.
5. Fetch `session-index.json` and the newest session manifest when history changed.
6. Fetch audit/prompt/log/handoff files only for drill-down or when state references change.
7. Render/update the H!veAI Project Dashboard from those sources inside H!veAI itself.

This manifest should remain pointer-only. H!veAI MUST NOT rewrite this file after each session with generated status snapshots.

## Migration note

The historical `docs/audits`, `docs/prompts`, `docs/external-logs`, and `docs/handoffs` trees are being consolidated under `project-control/` while preserving history and ownership. During migration, H!veAI should respect `migrationPending` from `project-control/state/project-state.json` and avoid claiming the session history is exhaustive.
