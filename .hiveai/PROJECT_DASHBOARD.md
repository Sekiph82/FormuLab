---
hiveaiDashboardSchema: hiveai-project-dashboard/v1
projectKey: formulab
repository: Sekiph82/FormuLab
branchPolicy: main
dashboardMode: source-map
refreshPolicy: watcher-driven source invalidation; no generated status commits
---

# H!veAI Project Dashboard Manifest

This file is a pointer map for H!veAI. It is not a task ledger and must not duplicate task checkboxes.

## Project identity

Project: FormuLab
Repository: `Sekiph82/FormuLab`
Default branch: `main`

## Source authorities

Canonical task source: none verified yet
Progress/history source: `PROGRESS.md`
Handoff source: none verified
Roadmap source: none verified at repository root
Architecture source: none verified at repository root
Decision source: none verified at repository root
Agent instruction sources: `AGENTS.md`, `CLAUDE.md`
Security source: `SECURITY.md`
Build/test metadata: `package.json`, workspace manifests, Rust/Python manifests where present

## Authority notes

`PROGRESS.md` is a large execution-history stream. It must not be promoted into the canonical task ledger automatically.

Explicit FormuLab task identifiers or structured conventions may be parsed when source-evidenced, but ordinary progress prose must remain history rather than operational backlog.

Until a dedicated canonical task ledger is created from verified current work, H!veAI should report `TASK AUTHORITY NOT YET CANONICALIZED` rather than inventing tasks.

## Refresh model

H!veAI should derive live state from Registry/Git/watcher evidence plus the verified sources above. This manifest should remain pointer-only and should not be rewritten as a generated status snapshot.
