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
ON PROCESS, 7/18 tasks COMPLETED (FVL-03.001, FVL-03.013-018). FVL-01
remains CLOSED (21/21); FVL-02 remains CLOSED (24/24, 2026-08-17).

## Current task

**`FVL-03.002`** — blank, NOT STARTED. An architecture-correction session
(2026-08-18, see below) hardened FVL-03.002-.012's wording with the
SINGLE-AUTHORITY rule and a code-traced duplicate-authority audit, but
deliberately did not implement anything — `FVL-03.002` ("canonical
Material Master reaches `build_candidate_pool()` through a shape-only
adapter, `RawMaterial.code` carried end-to-end, no duplicated
supplier/price business logic") remains the next frozen task per the
tracker's own dependency chain. Still not begun.

## Architecture correction (2026-08-18) — SINGLE-AUTHORITY rule adopted

Roadmap/documentation session only, before any FVL-03.002 implementation.
No production code changed. Added the single-authority principle to
`docs/FORMULAB_V1_FINAL_SCOPE.md` (every business domain has exactly one
authoritative engine/source of truth; a pipeline-local adapter transports
and reshapes data only). Full code-traced authoritative domain map and
legacy retirement matrix added to
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`. Key confirmed findings:
`runtime/pipeline/safety.py` and `runtime/pipeline/regulatory.py` are real,
independently-computing duplicate final-verdict engines (targeted by
FVL-03.009/.010 respectively); `runtime/pipeline/rules.py::validate()` is
**not** a duplicate of the Compatibility Engine — confirmed to implement
only generation-request constraints. Hardened FVL-03.002 through
FVL-03.012's wording in the tracker with exact repository names/paths, plus
two flagged-elsewhere rows (`FVL-07.008` reworded for clarity,
`FVL-08.005` wording strengthened, `Blocking` left `NO` — a scope decision
deliberately not made this session). No dependency-graph or status values
changed; no new work package created. Old UI (`/live`) and new UI
(`/formulation-request`+`/formulation-result/:sessionId`) both remain,
sharing one zero-LLM backend (`engine.py`) — `FVL-11.005` still owns the
retirement decision, not moved earlier.

## FVL-03.001 resolution (this session, audit only)

"Audit exact integration seam: Material Master ↔ `engine.
build_candidate_pool()`." Full findings in
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`. Summary:

- **Canonical Material Master**: `packages/shared/src/schemas/
  materials.ts` (`RawMaterial`/`Supplier`/`MaterialSupplier`/
  `MaterialPrice`/`InventoryRecord`), identity = `RawMaterial.code`.
  Persisted as flat JSON arrays under `<project_root>/data/master/*.json`
  (`apps/desktop/src-tauri/src/masterdata.rs`), read by the real
  Materials screen (`MaterialsPage.tsx` → `listRecords("materials")`).
- **What `build_candidate_pool()` actually consumes today: NOT the
  canonical Material Master.** `runtime/pipeline/materials.py` is a
  second, independent, much simpler representation — a single flat
  `<materials_dir>/materials.json` (different path AND shape from the
  canonical store), populated by a live, reachable, separate CSV-import
  screen (`MaterialsCard.tsx`, Settings → General) — confirmed
  disconnected from `MaterialsPage.tsx`'s own canonical path.
- **Identity mismatch confirmed**: pool candidates key on
  `normalize_ingredient_key(inci or name)` (derived text), never
  `RawMaterial.code`. The legacy row's own `material_id` survives only
  as trailing trace provenance, never as the actual pool key.
- **Real, proven gap**: `resolve_concentration()`'s own Tier 4 (supplier
  recommended range) is dead code on the current path — the legacy CSV
  import can never produce `recommended_min_pct`/`recommended_max_pct`,
  proven end-to-end with the REAL parser
  (`test_material_master_seam.py`, 4 new tests, all passing).
- **Cost Engine boundary documented, not implemented**:
  `packages/shared/src/engine/cost.ts::costFormula()` (keyed on
  `materialCode`, real landed cost/exchange-rate/missing-data handling,
  673-line test suite) is the authoritative engine future FVL-03.003
  must call. It is confirmed NOT called from the generation path today —
  `materials.py::cost_formula()` is a separate, simpler, unrelated
  reimplementation (flat price × kg, no landed cost, no exchange rate).
- **No production code changed.** Audit/seam-definition only, per
  FVL-03.001's own scope — explicitly did not implement supplier wiring
  (FVL-03.002), cost wiring (FVL-03.003), or inventory wiring
  (FVL-03.004).

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

## Exact next task

**`FVL-03.002`** — blank, NOT STARTED (see above). Wire supplier records
+ price history into candidate concentration/cost basis, per the exact
adapter/seam `FVL-03.001`'s own audit defined (`docs/
FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`). One source of truth (the
canonical `data/master/*.json` store), no duplicated cost formula. Not
begun this session.

## Known blockers

None. FVL-01/FVL-02 fully closed; FVL-03.001 fully closed (audit only,
no code change — see above).

## Most recent relevant tests

- `python -m pytest runtime/pipeline -q` — 378 passed, 5 subtests passed.
- `packages/shared/src/engine/cost.test.ts` (existing Cost Engine suite,
  re-verified untouched by this session's audit) — 44/44 passing.
- `git diff --check` — clean.
- No Rust/TypeScript/frontend production code changed this session (pure
  audit + Python-side proof tests) — no rebuild performed, per the
  standing "only rebuild when shipped code actually changes" policy.

## Latest commit SHA

`c2ef4e5b6b279fcee475399490986a58208945ab` (pushed to and matching
`origin/feature/laboratory-stability`) — "docs(v1): enforce single-authority
integration architecture" (architecture-correction session, no production
code changed). Prior: `86e965a6f8ddbb2144e077f05fbe66a635a46bd0` — "docs(v1):
close FVL-03.001 material master integration-seam audit".

## Reminder

- Do not invent a `FVL-12`.
- Do not mark a future task `COMPLETED` on assumption.
- Follow the full protocol in `FORMULAB_V1_TASK_TRACKER.md`'s own
  "Tracker update protocol" section before touching any task status.
