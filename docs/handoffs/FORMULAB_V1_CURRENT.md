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

**FVL-02 — Dynamic 3-7 Formula Alternatives** — ON PROCESS, 23/24 tasks
COMPLETED. FVL-01 remains CLOSED (21/21); FVL-03 sits at 6/18
(FVL-03.013-018).

## Current task

**`FVL-02.009`** — ON PROCESS (the one remaining blocking subtask).
"Below-3-defensible-alternatives behavior: mark result incomplete/
insufficient rather than fabricate." No distinct `status` value exists
for `actual_formula_count` < 3 specifically — only the generic
`alternative_shortfall`/`shortfall_reason` pair, applied uniformly
regardless of how low `actual` goes. In every acceptance run performed
so far `actual` has never gone below 2 (`balanced`/`max_performance`
both apply unconditionally), so the literal "mark incomplete/
insufficient" signal for that specific edge remains unverified — left
ON PROCESS rather than assumed complete.

## Immediately preceding completed work (this session)

Fixed the real portfolio-gating defect reported at the top of this
session's own instructions: `architecture_portfolio.select_portfolio()`
modeled "use this slot's scientific architecture" and "use the generic
fallback" as mutually exclusive per slot; `engine.build_candidate_pool()`
never worked that way (always merges origins, role-by-role). Fixed via
`preferred_source_formulation_id`/`is_preferred_architecture` (a real,
bounded +50 priority for the portfolio-assigned seed, never exceeding an
explicit user requirement) plus a REAL fallback-completeness figure
(`engine.covered_roles()` against a scientific-formulation-free pool,
replacing the previous hardcoded `1.0`). 12 dedicated regression tests
added (`test_architecture_portfolio.py`). Then completed the rest of
FVL-02's frozen scope in the same session: Acceptance Cases A-E all
verified and codified as real tests (`test_acceptance_formula_count.py`
for C/D/E; `ScientificFormulationPriorityTests` for A/B against the real
PDF); New Request UI count control (3-7, default 3, wired end to end
through `formulationV2.ts` → Tauri → Rust → Python `n`, 11 new frontend
tests); dynamic V1-V7 result selector (horizontally scrollable strip for
>3 cards, 7 new frontend tests); Alternatives tab enriched with strategy/
retained-added-removed counts; report generator confirmed already
N-generic, one new 7-version test added; Rust bridge confirmed already
fully generic (`serde_json::Value` passthrough, no fixed struct), one new
7-card round-trip test added. Full validation: Python 366/366 (+1 subtest
group), Rust `formulation_v2::` 10/10, frontend 1274/1274 (`tsc`/ESLint
clean) — see the Desktop external log for the complete session account.

## Exact next task

**`FVL-02.009`** — determine and implement (or explicitly decide against,
with a recorded reason) a distinct result signal for
`actual_formula_count` < 3, then close FVL-02. After that: fresh desktop
build, shortcut update, commit, push, GitHub issue #3 sync. FVL-03's own
remaining blank tasks (FVL-03.001-012, Cost Engine/Optimizer/
substitution/Compatibility/Safety/Regulatory integration) remain
eligible and unblocked once FVL-02 formally closes — not started this
session.

## Known blockers

`FVL-02.009` (above) — the only remaining blocking FVL-02 subtask.

## Most recent relevant tests

- `python -m pytest runtime/pipeline -q` — 366 passed, 5 subtests passed.
- `cargo test --release formulation_v2` — 10/10 (full workspace
  `cargo test --release` not re-run this session — no bridge/persistence
  logic changed, only a new test added).
- `pnpm vitest run` — 138 files / 1274 tests, all passing.
- `pnpm tsc --noEmit` / `pnpm lint` (ESLint) — clean.
- `git diff --check` — clean.
- Real acceptance: the user's own actual downloaded PDF
  (`10.20431_2455-1538.0402005.pdf`) — 5 scientific formulations
  extracted, requested 5 / actual 4 (honest strategy-applicability
  shortfall), zero SLS in the sulfate-free case, real adaptation trace.

## Latest commit SHA

`cbda3db59a3dbdd10d2561f1e848ead504ded66f` (== current
`origin/feature/laboratory-stability`) — this session's FVL-02 work is
**not yet committed**; see the Desktop external log for the exact file
list staged for the next commit.

## Reminder

- Do not invent a `FVL-12`.
- Do not mark a future task `COMPLETED` on assumption.
- Follow the full protocol in `FORMULAB_V1_TASK_TRACKER.md`'s own
  "Tracker update protocol" section before touching any task status.
