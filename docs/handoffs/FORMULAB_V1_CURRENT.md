# FormuLab v1 — Current Execution Pointer

**Do not create a new task outside `docs/FORMULAB_V1_TASK_TRACKER.md`.**
This file only points at the tracker's current state — it is not itself a
scope document. Frozen scope: `docs/FORMULAB_V1_FINAL_SCOPE.md`.

## Frozen scope reference

- Scope: [`docs/FORMULAB_V1_FINAL_SCOPE.md`](../FORMULAB_V1_FINAL_SCOPE.md)
  — frozen 2026-08-17.
- Tracker: [`docs/FORMULAB_V1_TASK_TRACKER.md`](../FORMULAB_V1_TASK_TRACKER.md)
  — 11 work packages (FVL-01..FVL-11), 157 tasks total.

## Current work package

**FVL-03 — Unified Formulation Pipeline ↔ Existing FormuLab Engines** —
6/18 COMPLETED (FVL-03.013-018, the scientific full-formulation
architecture correction). FVL-01 remains CLOSED (21/21).

## Current task

None `ON PROCESS`.

## Immediately preceding completed task

`FVL-03.013`-`FVL-03.018` — real complete scientific formulations
(F1..Fn composition tables) extracted from downloaded full-text PDFs via
a new, real, standard-library-only positional PDF text reconstruction
(`fulltext.pdf_lines()`), seeded as top-priority architecture candidates
in the deterministic solver (`ORIGIN_SCIENTIFIC_FORMULATION`,
`resolve_concentration()` Tier 0), with real adaptation traceability
(`architecture_basis`) and a redesigned, non-clipping Evidence & Sources
UI. See `docs/PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md` §23 for
the full account. **Session note**: this work was done directly under
FVL-03 at the user's own explicit instruction, ahead of FVL-02 in the
tracker's own stated default execution order — a legitimate, disclosed
exception per the scope-change policy (a direct human instruction), not
a silent reordering.

## Exact next task

**`FVL-02.001`** — Define request/data contract: `requestedFormulaCount`
(or equivalent) on `FormulationBrief`, min 3 / max 7 / default 3.
Status: blank. No blocking dependency — this remains the next task in
the tracker's own default execution order. FVL-03's own remaining blank
tasks (FVL-03.001-012, Cost Engine/Optimizer/substitution/Compatibility/
Safety/Regulatory integration) are also eligible and unblocked; which to
pick next is a decision for the next session (or an explicit human
instruction), not assumed here.

## Known blockers

None.

## Most recent relevant tests

- `python -m pytest runtime/pipeline -q` — 349/349.
- `cargo test --release` (full workspace) — 344/344; `formulation_v2::`
  alone — 9/9.
- `pnpm vitest run` — 138 files / 1258 tests.
- `tsc --noEmit` / ESLint — clean.
- `git diff --check` — clean.
- Real acceptance: the user's own actual downloaded PDF
  (`10.20431_2455-1538.0402005.pdf`) — 5 scientific formulations
  extracted, 61 experimental outcomes linked, SLS correctly excluded and
  traced under a sulfate-free constraint.

## Latest commit SHA

See `git log` for the exact current HEAD — recorded here once the
scientific-formulation correction is committed and pushed.

## Reminder

- Do not invent a `FVL-12`.
- Do not mark a future task `COMPLETED` on assumption.
- Follow the full protocol in `FORMULAB_V1_TASK_TRACKER.md`'s own
  "Tracker update protocol" section before touching any task status.
