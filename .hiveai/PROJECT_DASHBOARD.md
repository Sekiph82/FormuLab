hiveaiDashboardSchema: hiveai-project-dashboard/v1
projectKey: formulab
repository: Sekiph82/FormuLab
branchPolicy: feature/laboratory-stability
dashboardMode: source-map
trackingMode: canonical-control-plane-v1
refreshPolicy: watcher-first-500ms-plus-60s-reconcile

## Source authorities

Canonical task source: `docs/FORMULAB_V1_TASK_TRACKER.md`
Handoff source: `.hiveai/HANDOFF.md`
Roadmap source: `docs/FORMULAB_V1_TASK_TRACKER.md`
Progress/history source: `.hiveai/EVENTS.jsonl`
Architecture source: `.hiveai/PROJECT.json`
Decision/governance source: `.hiveai/RULES.md`
Agent instruction source: `.hiveai/RULES.md`
Build/test metadata: `.hiveai/STATE.json`
