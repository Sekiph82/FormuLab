# Optimizer/substitution UI verification

Records what was actually verified for the Advanced Optimizer's scenario UI
(spec §A6) and the Substitution dialog's system-substitution UI (spec §A7),
and — as honestly as the previous phase's equivalent note — what was not.

## Why the WebView could not be driven directly

Browser automation in this environment controls Chrome tabs, not the
packaged Tauri desktop window — they are different processes, and no tool
available here can attach to or drive a native WebView window. Two more
specific reasons this is not a workaround-able gap:

1. Even opening the Vite dev server URL in an ordinary Chrome tab would not
   exercise real behavior: `apps/desktop/src/lib/tauri.ts`'s `isTauri` gate
   makes every masterdata read/write and every solver invocation a no-op
   (`listRecords` returns `[]`, `upsertRecords`/`runAdvancedFormulationOptimize`
   throw) outside the actual Tauri context. A Chrome tab could only confirm
   that empty-state screens render, which is not what this checklist asks.
2. The previous phase's equivalent note recorded the same limitation for
   the base Optimizer/Substitution screens; nothing about this phase's
   environment changed that.

## What was verified instead

Per the fallback the task itself specifies: real components mounted with
real React state, with only the Tauri IPC boundary
(`@/lib/masterdata`, `@/lib/tauri`) mocked. No formula calculation,
scenario-lifecycle, candidate-generation, or result-rendering logic is
mocked anywhere in these tests — `generateSystemCandidates`,
`buildSystemSubstitutionProblem`, `applyProfileToProblem`,
`compareOptimizationRuns`, `scoreSystemResult` and every React state
transition run for real.

`apps/desktop/src/components/formula/AdvancedOptimizerPanel.test.tsx` (9 tests):

| Checklist item | Verified by |
|---|---|
| Optimizer tab opens without exception | "renders the candidate list and the scenario section" |
| Scenario selector renders | same test — asserts the "Scenarios" heading and selector |
| New scenario saves | "New scenario persists a real OptimizationScenario record" — asserts the real `upsertRecords("optimization_scenarios", ...)` call with `revision: 1, status: "active"` |
| Saved scenario reloads | "loads a saved scenario's candidate selection when chosen from the selector" — a scenario record round-trips through the real `onLoadScenario` handler into the candidate checklist |
| Profile merge/apply-missing works, never silently overwrites | "apply_missing only adds constraints, never removes existing ones" |
| Run button starts solver | "Run starts the solver and renders an optimal result" — asserts the real `runAdvancedFormulationOptimize` call and the resulting Apply-to-draft button |
| Result renders | same test |
| Cancel button cancels solver | "Cancel calls the real cancel bridge while a solve is in progress" — a deliberately unresolved run promise, then asserts the real cancel bridge call |
| `feasible_with_penalties` renders correctly | "renders feasible_with_penalties with the soft-constraint list" — asserts the warning banner, the soft-constraint row and its `violated` label |
| Property results render | same test — asserts the `active_matter` property row |
| Infeasibility causes render | "renders structured infeasibility causes" — asserts the cause message and its suggested action |
| Replace requires confirmation | "Replace requires a second confirming click before it takes effect" |

`apps/desktop/src/components/formula/SubstitutionPanel.test.tsx` (5 tests):

| Checklist item | Verified by |
|---|---|
| Substitution dialog opens | "renders the dialog title and the one-to-one candidate list" |
| Multiple lines can be selected | "multiple lines can be selected" |
| System candidates render | "generates system candidates covering every preserved function..." |
| Rejected candidates show reason | same test — asserts the "Rejected combinations" section renders for a partial-coverage combination |
| Selected system applies to a new draft | "evaluates generated systems through the real optimizer and renders the result" — asserts the real `onApplySystem(removedLineIds, newLines, runCode)` call, that both source lines are removed and both new materials are added, and that both `optimization_runs`/`substitution_runs` are persisted |
| Infeasible system shows structured cause, offers no Apply | "renders an infeasible system result with its cause, and offers no Apply for it" |

Both suites pass: `pnpm --filter desktop test -- --run AdvancedOptimizerPanel.test SubstitutionPanel.test` → 14 passed.

## What was NOT verified (genuine gaps)

- **Visual rendering** — layout, overflow, scroll-area behavior, focus
  order, and actual pixel-level appearance were never observed; jsdom has no
  layout engine. A real click-through in the packaged app is the only way
  to catch a CSS overflow or a focus trap.
- **Version creation and approval-readiness integration** — not exercised
  by these tests; `assessApprovalReadiness` is not called from anywhere in
  the desktop app yet (a pre-existing gap from before this phase, not
  introduced by it — see [APPROVAL_READINESS.md](APPROVAL_READINESS.md)).
- **Scenario comparison view** — `compareOptimizationRuns` itself has
  direct unit tests (`packages/shared/src/engine/scenarios.test.ts`), but
  the `ScenarioComparisonView` component's own rendering (the table, the
  highlight badges) was not separately exercised in these integration
  tests.
- **Actual Python solver subprocess** — every optimizer/system-substitution
  test here mocks `runAdvancedFormulationOptimize` at the Tauri boundary;
  the real CBC solve is exercised separately by
  `runtime/formulation/test_advanced_optimizer.py`, not from these UI tests.
- **Keyboard-only navigation and screen-reader behavior** — not tested.

Anyone with access to the packaged Tauri app should still do a manual
click-through before relying on this UI for a real formulation decision —
these tests substantially reduce, but do not eliminate, the value of that
pass.
