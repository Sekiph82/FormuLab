# FormuLab v1 — Current Execution Pointer

**Do not create a new task outside `docs/FORMULAB_V1_TASK_TRACKER.md`.**
This file only points at the tracker's current state — it is not itself a
scope document. Frozen scope: `docs/FORMULAB_V1_FINAL_SCOPE.md`.

## Frozen scope reference

- Scope: [`docs/FORMULAB_V1_FINAL_SCOPE.md`](../FORMULAB_V1_FINAL_SCOPE.md)
  — frozen 2026-08-17.
- Tracker: [`docs/FORMULAB_V1_TASK_TRACKER.md`](../FORMULAB_V1_TASK_TRACKER.md)
  — 11 work packages (FVL-01..FVL-11), 161 tasks total.

## Current work package

**FVL-01 — Phase 14 Closure Baseline** — CLOSED (21/21 COMPLETED).

## Current task

None `ON PROCESS`.

## Immediately preceding completed task

`FVL-01.021` — GitHub commit/push state confirmed at commit
`8bfc11b04142fa30c623c37ca8d7b01d58d0797b`. Same-day correction recorded
under `FVL-01.005` (full-text gate policy: full/partial/insufficient,
`RESEARCH_FULL_TEXT_TARGET = 15`, `RESEARCH_FULL_TEXT_MINIMUM = 10`).

## Exact next task

**`FVL-02.001`** — Define request/data contract: `requestedFormulaCount`
(or equivalent) on `FormulationBrief`, min 3 / max 7 / default 3.
Status: blank. No blocking dependency. This is the first eligible task —
do not start it automatically; the next session begins from here.

## Known blockers

None. FVL-02.001 is unblocked and ready to start.

## Most recent relevant tests

- `python -m pytest runtime/pipeline -q` — 326/326 (includes the
  full/partial/insufficient full-text-gate correction, FVL-01.005).
- `cargo test --release` (full workspace) — 342/342.
- `pnpm vitest run` — 138 files / 1252 tests.
- `tsc --noEmit` / ESLint — clean.
- `git diff --check` — clean.

## Latest commit SHA

See `git log` for the exact current HEAD — this file is updated again once
the full-text-gate correction (FVL-01.005) and this tracker's own creation
are both committed and pushed to `origin/feature/laboratory-stability`.

## Reminder

- Do not invent a `FVL-12`.
- Do not mark a future task `COMPLETED` on assumption.
- Follow the full protocol in `FORMULAB_V1_TASK_TRACKER.md`'s own
  "Tracker update protocol" section before touching any task status.
