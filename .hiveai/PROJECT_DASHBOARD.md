---
hiveaiDashboardSchema: hiveai-project-dashboard/v1
projectKey: formulab
repository: Sekiph82/FormuLab
branchPolicy: feature/laboratory-stability is the active FormuLab development branch
dashboardMode: source-map
refreshPolicy: watcher-driven source invalidation; no generated status commits
---

# H!veAI Project Dashboard Manifest

This file is a pointer map for H!veAI. It is not a task ledger and must not duplicate task checkboxes.

## Project identity

Project: FormuLab
Repository: `Sekiph82/FormuLab`
Active branch: `feature/laboratory-stability`

## Source authorities

Canonical task source: `docs/FORMULAB_V1_TASK_TRACKER.md`
Roadmap source: `docs/FORMULAB_V1_FINAL_SCOPE.md`
Handoff source: `docs/handoffs/FORMULAB_V1_CURRENT.md`
Progress/history sources: `PROGRESS.md`, `docs/audits/`, `docs/external-logs/`, `project-control/gpt/audits/`, `project-control/claude/logs/`
Architecture source: repository architecture/design documents under `docs/` when explicitly referenced by the canonical tracker or final scope
Decision/governance source: `docs/FORMULAB_V1_FINAL_SCOPE.md`
Agent instruction sources: `AGENTS.md`, `CLAUDE.md`
Security source: `SECURITY.md`
Build/test metadata: `package.json`, workspace manifests, Rust/Python manifests where present

## Authority notes

`docs/FORMULAB_V1_TASK_TRACKER.md` is the canonical FormuLab task ledger. H!veAI should derive task identifiers, task state, dependencies, and completion status from that source rather than from progress prose.

`PROGRESS.md`, GPT audits/prompts, Claude implementation logs, and handoffs are evidence/history. They must not override the canonical task ledger unless the task ledger itself is updated or an explicit audit reopens a task and the tracker is subsequently synchronized.

The `project-control/` tree is a GPT↔Claude communication and evidence archive. It is not a second Project Dashboard, not the canonical task ledger, and must not replace this manifest or `docs/FORMULAB_V1_TASK_TRACKER.md` as H!veAI task authority.

During the planned historical migration, legacy `docs/audits`, `docs/prompts`, `docs/external-logs`, and `docs/handoffs` material may be moved into `project-control/`. Until that migration is completed and this manifest is intentionally updated, the current canonical handoff remains `docs/handoffs/FORMULAB_V1_CURRENT.md`.

## Refresh model

H!veAI should derive live state from Registry/Git/watcher evidence plus the canonical sources above. This manifest should remain pointer-only and should not be rewritten as a generated status snapshot.
