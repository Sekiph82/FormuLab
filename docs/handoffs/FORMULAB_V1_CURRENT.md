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
ON PROCESS, 10/18 tasks COMPLETED (FVL-03.001, FVL-03.002, FVL-03.003,
FVL-03.004, FVL-03.013-018). FVL-01 remains CLOSED (21/21); FVL-02 remains
CLOSED (24/24, 2026-08-17).

## Current task

**`FVL-03.005`** — blank, NOT STARTED. `FVL-03.004` closed this session
(see below) — `FVL-03.005` ("wire the existing Advanced Optimizer as an
optional post-generation refinement, not a new solver") is the next
frozen task per the tracker's own dependency chain. Deliberately not
begun this session.

## FVL-03.004 resolution (this session)

"Wire canonical InventoryRecord availability into candidate feasibility,
read-only." Confirmed by audit: `InventoryRecord`
(`packages/shared/src/schemas/materials.ts:221-242`) stores no
usable/available quantity field — always derived — and before this task
three UI call sites each re-implemented `quantity − reservedQuantity`
inline, none applying `quarantined`/`released`/`expiresAt` filtering. New
`packages/shared/src/engine/inventoryAvailability.ts::evaluateMaterialAvailability()`
is now the one canonical derivation (used by new code only — the three
existing call sites untouched, out of scope, no regression risk).

**Same client-side, read-only, version-level architecture as FVL-03.003's
cost wiring — confirmed with the user as the deliberate choice**: Python
is not extended to read inventory; `master_materials_adapter.py`
untouched. New `apps/desktop/src/lib/generatedFormulaInventory.ts::evaluateGeneratedFormulaInventory()`
joins by `material_code` only (proven immune to a same-display-name decoy
material by test), computes required quantity from the SAME numeric
`batchKg` control FVL-03.003 already added to `FormulationResultPage.tsx`
(never the original free-text `estimatedBatchSize` brief field, confirmed
purely decorative — never parsed as a number anywhere in
`runtime/pipeline/`). Rolls per-ingredient AVAILABLE/INSUFFICIENT/UNKNOWN
into one formula-level FEASIBLE/INFEASIBLE/UNKNOWN state.

"Prefer a feasible candidate" (satisfied at the **version** level, not by
mutating `engine.py`'s per-role candidate loop): new
`apps/desktop/src/lib/inventoryComparison.ts::pickMostInventoryFeasibleVersion()`
mirrors `pickCheapestValidVersion` exactly — picks the first already-
generated, hard-rule-valid version whose inventory state is `feasible`,
never recommending an infeasible/unknown version as "best available
anyway." Kept as an entirely separate dimension from cost (task §12) —
proven by a joint test that a real cost total and an independently-
computed `INFEASIBLE` inventory state coexist without either influencing
the other.

**Read-only by construction** — confirmed by grep across every file this
session touched: no `upsertRecords("inventory", ...)` call exists
anywhere. Generation never reserves, decrements, or allocates stock.

Wired into the new result UI only (`FormulationResultPage.tsx`'s Summary
tab + `VersionSummaryCard` badge, plus a per-version cost line in the
version-card grid) — `CostingPanel.tsx` (old `/live` UI) deliberately not
extended, since it has no multi-version/cards context to make a
feasibility comparison meaningful. `runtime/pipeline/materials.py`'s
legacy `stock` field (parsed, stored, read by nothing else) documented
with a one-line comment classifying it non-authoritative — not deleted
(gratuitous churn on an unrelated legacy path, out of scope).

Verified: `pnpm --filter @formulab/shared test` — 1311/1311 (9 new in
`inventoryAvailability.test.ts`). `pnpm --filter @formulab/desktop test`
— 1303/1303 (16 new: `generatedFormulaInventory.test.ts` 9,
`inventoryComparison.test.ts` 4, `InventoryFeasibilitySummary` render
sanity via typecheck; i18n locale-parity suite re-verified green across
all 8 locales after 7 new translation keys added to each). `typecheck`/
`lint` — clean. `python -m pytest runtime/pipeline -q` — 386/386,
unchanged from the FVL-03.003 baseline (Python untouched except one
non-functional doc comment). `cargo check` — clean, unchanged (no Rust
edits this session). `git diff --check` — clean. No FVL-03.005+ work
started; no Python inventory logic added anywhere; no substitution logic
implemented (explicitly deferred to FVL-03.006).

## FVL-03.003 resolution (prior session)

"Wire the existing authoritative Cost Engine into the formulation
pipeline." **Critical architecture finding, confirmed by audit**: Python
cannot call `packages/shared/src/engine/cost.ts` at all —
`run_cli.py` is a one-shot stdin→stdout subprocess (`formulation_v2.rs`'s
`generate_formulation` spawns it, writes one JSON request, reads one JSON
reply, no back-channel to the JS engine). The only architecturally real
bridge is client-side, post-generation costing — new
`apps/desktop/src/lib/generatedFormulaCost.ts::costGeneratedFormula()`, a
thin wrapper calling `buildCostSnapshot()` directly (zero business logic
of its own — proven by test to return the identical result a direct
`buildCostSnapshot()` call would, including a negative proof that a
same-display-name "decoy" material with a price is never matched by text
similarity, only by the exact `material_code`).

`apps/desktop/src/lib/formulations.ts::linesFromGeneratedFormula()` now
carries `material_code` (the field FVL-03.002 added to every generated
ingredient) into `FormulationLine.materialCode` — the one real gap that
had been blocking real costing of a generated card.

Wired into both UIs, consuming one authoritative result: `CostingPanel.tsx`
(old `/live` UI, previously called the legacy Python bridge, now redirected)
and `FormulationResultPage.tsx` (new result UI — three prior hardcoded
"not available" placeholders replaced with real per-version cost). New
shared `apps/desktop/src/components/cost/CostSnapshotSummary.tsx` renders
the money-grid + `missingDataWarnings` for both; `CostPanel.tsx` (the
manual formula builder) was left untouched — already correct, no reason to
risk it. New pure `apps/desktop/src/lib/costComparison.ts::pickCheapestValidVersion()`
picks the lowest-cost alternative among versions that are BOTH not
`invalid_*` (`formula_state`) AND completely costed (zero
`missingDataWarnings` — an incomplete/lower-bound total is never eligible
to be crowned "cheapest"). Surfaced as a badge in `VersionSummaryCard` and
inline per-version cost in the version-card grid.

**Legacy path deleted, not merely bypassed** (confirmed zero remaining
callers before deletion, by grep then by full regression):
`runtime/pipeline/materials.py::cost_formula()`/`render_costing_markdown()`,
`materials_cli.py`'s `"cost"` action, `apps/desktop/src-tauri/src/materials.rs::cost_formulation`
(+ its `lib.rs` registration), `apps/desktop/src/lib/formulationV2.ts::costFormulation()`/
`CostSheet`/`CostLine`. `materials.py`'s own storage/import functions and
`materials.rs::import_materials`/`list_materials` (a separate command
family) are untouched — still back the unrelated Settings → General
CSV-import screen.

Verified: `python -m pytest runtime/pipeline -q` — 386 passed, 5 subtests
(7 obsolete `CostingTests` removed). `cargo check` + `cargo test` — 345/345
passing (full suite, not just targeted — `materials.rs`/`lib.rs` changed).
`pnpm --filter @formulab/shared test` — 1302/1302 (`cost.test.ts`
untouched, re-verified as the sanity gate, no new tests added there per
the "don't duplicate expected-value formulas the authoritative engine can
already prove" instruction). `pnpm --filter @formulab/desktop test` —
1287/1287 (19 new: `generatedFormulaCost.test.ts` 6, `costComparison.test.ts`
5, `formulations.test.ts` 2, `CostSnapshotSummary.test.tsx` 3, plus the
i18n locale-parity suite re-verified green across all 8 locales after
adding 2 new translation keys to each). `typecheck`/`lint` — clean.
`git diff --check` — clean. No desktop rebuild/installer performed (dev-mode
`cargo check` + typecheck covers the changed surface; not required by this
task's own acceptance criteria). No FVL-03.004+ work started; no Python
price-selection/landed-cost/FX logic added anywhere.

## FVL-03.002 resolution (prior session)

"Canonical Material Master / supplier linkage into formulation generation
under the SINGLE-AUTHORITY architecture." New
`runtime/pipeline/master_materials_adapter.py` — a shape-only adapter
reading `data/master/{materials,material_suppliers,suppliers,
material_prices}.json` directly (bare canonical JSON arrays, no new
storage/database). Real identity: `RawMaterial.code` now carried as
`material_code` through `IngredientCandidate` → `SolvedIngredient` →
`traceability.selected_event()`'s `source_ids` → the rendered formula
ingredient dict — in addition to, never instead of, the existing
INCI/name text-matching pool key. Makes `resolve_concentration()`'s Tier 4
(supplier recommended range) live end-to-end for the first time (FVL-03.001
proved it dead code on the legacy path). Adds a new `technical_max_pct`
hard-ceiling clamp, implemented exactly once (`resolve_concentration()`'s
own thin wrapper over the renamed `_resolve_concentration_tiers()`,
`ConcentrationResolution.technical_max_clamped` flag, persisted into trace
event `output_values`).

**Single-authority boundary held, proven by test**: the adapter never
selects a current price the way `cost.ts::priceFor()` does — no `price`/
`currency` key is ever set on an emitted row; `material_price_refs` passes
every matching `MaterialPrice` row through raw/unfiltered instead. Supplier
identity is kept as the full `material_supplier_refs` set; a `supplier`
display string only surfaces when the canonical `MaterialSupplier.preferred`
field already makes it unambiguous (exactly one `preferred: true` link) —
never a new ranking rule. `_selection_score()`'s existing price tie-break
bonus is therefore untouched but receives no signal for canonical-sourced
candidates until FVL-03.003 wires real costing — a disclosed, intentional
behavior change, not a retune.

**Rust**: `formulation_v2.rs`'s `generate_formulation` payload now points
`materials_dir` at `data/master` (was `data`) — confirmed the identical
resolved path to `masterdata.rs::master_dir()`. The new adapter module was
registered in `materialize_pipeline()`'s embedded-file list; verified by
reproducing the exact materialized file set in a disposable temp directory
and importing `pipeline` cleanly — the same class of shipped-binary
`ImportError` bug FVL-02.009 found and fixed for `architecture_portfolio.py`
is proactively avoided here. `runtime/pipeline/materials.py`/
`materials.rs`'s legacy CSV-import commands (Settings → General) untouched,
unrelated, out of scope — a real, disclosed behavior change: materials that
only exist in that legacy store no longer surface as AI-generation
candidates (decided with the user during the architecture-correction
session, shipped without an added migration/warning).

Verified: `python -m pytest runtime/pipeline -q` — 393 passed, 5 subtests
(15 new tests: 11 in `test_master_materials_adapter.py`, 3
`technical_max_pct` clamp tests in `test_engine.py`, 1 new end-to-end Tier-4
test in `test_pipeline.py`; 2 existing tests extended in place). `cargo test
masterdata:: formulation_v2::` — 28/28 passing. `cargo check` — clean.
`python scripts/validate_v1_tracker.py` — OK, 157 tasks, no drift. No
FVL-03.003/.004 work started; no Python price-selection/landed-cost/FX
logic added anywhere.

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

**`FVL-03.005`** — blank, NOT STARTED (see above). Wire the existing
Advanced Optimizer as an optional post-generation refinement of a
selected alternative — no new solver, not a merge into `engine.py`. Not
begun this session.

## Known blockers

None. FVL-01/FVL-02 fully closed; FVL-03.001/.002/.003/.004 fully closed
(see above).

## Most recent relevant tests

- `pnpm --filter @formulab/shared test` — 1311/1311.
- `pnpm --filter @formulab/desktop test` — 1303/1303.
- `pnpm --filter @formulab/desktop typecheck` / `lint` — clean.
- `python -m pytest runtime/pipeline -q` — 386 passed, 5 subtests passed
  (unchanged from FVL-03.003's baseline — Python untouched this session
  except a non-functional doc comment).
- `cargo check` — clean (unchanged — no Rust edits this session).
- `python scripts/validate_v1_tracker.py` — OK, 157 tasks, no drift.
- `git diff --check` — clean.
- No desktop rebuild/installer performed (no Rust/shipped-runtime changes
  this session at all; TS/shared changes covered by `typecheck`/`lint`/
  vitest, matching the standing "full rebuild reserved for closure
  sessions" policy). No live Tauri-app smoke test was performed —
  verification relied on the automated suites above.

## Latest commit SHA

`ff923227a5bfe6b7347e36d842268f2562882fc5` (pushed to and matching
`origin/feature/laboratory-stability`) — "feat(v1): integrate canonical
inventory feasibility". Prior:
`426c9a196b7225e1a1e025536fdea9c9dd643f25` — "docs: finalize FVL-03.003
closure pointer with commit SHA".

## Reminder

- Do not invent a `FVL-12`.
- Do not mark a future task `COMPLETED` on assumption.
- Follow the full protocol in `FORMULAB_V1_TASK_TRACKER.md`'s own
  "Tracker update protocol" section before touching any task status.
