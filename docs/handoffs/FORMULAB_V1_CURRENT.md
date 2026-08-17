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

**FVL-02 — Dynamic 3-7 Formula Alternatives** — **CLOSED, 24/24 tasks
COMPLETED (2026-08-17).** FVL-01 remains CLOSED (21/21); FVL-03 sits at
6/18 (FVL-03.013-018).

## Current task

**`FVL-03.001`** — blank, NOT STARTED. FVL-02's own closure resolved its
one remaining subtask this session (`FVL-02.009` — see below); FVL-03.001
is the next frozen task in the tracker's own default execution order.
Deliberately not begun this session per the standing "do not start
FVL-03" instruction that governed the FVL-02 closure work itself.

## FVL-02.009 resolution (this session)

"Below-3-defensible-alternatives behavior: mark result incomplete/
insufficient rather than fabricate." Added `engine.FORMULA_ALTERNATIVES_
SUFFICIENT`/`FORMULA_ALTERNATIVES_INSUFFICIENT` and a new top-level
`formula_alternatives_status` field on `pipeline.run()`'s return —
**independent** of `status` (which stays entirely about research-corpus
completeness): `"sufficient"` when `actual_formula_count >=
MIN_FORMULA_ALTERNATIVES` (3), `"insufficient_formula_alternatives"`
otherwise. The real alternatives already produced are always returned
as-is either way — never discarded, never padded to reach the minimum.
Proven with 8 new tests (`test_formula_alternatives_status.py`), including
both signals held true simultaneously (`ok_partial_research` + `insufficient_
formula_alternatives`) without either overwriting the other. **Real,
disclosed finding**: under the CURRENT strategy library, `actual <
MIN_FORMULA_ALTERNATIVES` is not reachable through genuine strategy
scarcity for any real brief — `balanced` + one of `cost_optimized`/
`premium_sensory` (mutually exclusive but jointly exhaustive over every
`targetCostLevel` value) + the unconditional `max_performance` fallback
together guarantee at least 3 applicable strategies, and the deterministic
engine never fails a slot once a strategy is chosen (no `generation_failed`
path exists in the current engine). The tests prove the SIGNAL is correct
by truncating `strategy.derive_strategies()`'s own real output (never
fabricating a strategy) — a defensive correctness proof for a case that
is not reachable today but could become reachable if the strategy library
is ever narrowed.

**Also found and fixed while preparing the rebuild** (not part of
FVL-02.009 itself, but a real, pre-existing packaging defect uncovered by
it): `apps/desktop/src-tauri/src/formulation_v2.rs`'s `materialize_
pipeline()` embedded-files list was missing `architecture_portfolio.py`
entirely — `pipeline.py` has imported it since an earlier FVL-02 session,
so the SHIPPED desktop binary would have failed with `ImportError` on
every real generation attempt despite every Python-level test passing (the
test suite always runs against the live repo checkout, never the
materialized/embedded copy, so this gap was invisible to `pytest`). Fixed
by adding the missing `include_str!`/materialize-list entry. Verified
directly: reproduced the exact Rust materialization list in a disposable
temp directory, ran `run_cli.py` against it — clean JSON response, no
`ImportError`, reached real pipeline business logic
(`research_corpus_incomplete`, the correct/expected outcome for a sandbox
with no live literature-retrieval network access).

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
