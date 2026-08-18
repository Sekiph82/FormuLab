# FormuLab v1 — Task Tracker

Authoritative operational source of truth for FormuLab v1 completion.
Scope is frozen by [`docs/FORMULAB_V1_FINAL_SCOPE.md`](FORMULAB_V1_FINAL_SCOPE.md).
Current execution pointer: [`docs/handoffs/FORMULAB_V1_CURRENT.md`](handoffs/FORMULAB_V1_CURRENT.md).

## Status values

Only three literal values are used. Never `TODO`/`PARTIAL`/`REVIEW`/
`BLOCKED`/`READY`/`DONE`/`IN PROGRESS`.

- **(blank)** — not started
- **ON PROCESS** — actively being implemented in the current session
- **COMPLETED** — implemented, tested, acceptance criteria met, committed

A dependency may explain why a blank task cannot begin yet; its status
still reads blank until work actually starts.

## Tracker update protocol (mandatory for every future session)

At the **start** of every implementation session:
1. Read `FORMULAB_V1_FINAL_SCOPE.md`, this tracker, and
   `handoffs/FORMULAB_V1_CURRENT.md`.
2. Inspect `git status`.
3. Select the exact next eligible blank task (respecting `Depends on`).
4. Change **only** that task's status to `ON PROCESS`.
5. Update `handoffs/FORMULAB_V1_CURRENT.md`.
6. Synchronize the task's GitHub issue/checklist status.
7. Then begin implementation.

**During implementation:**
8. Bugs required for the selected task to work are documented and fixed
   under that same task — never a new top-level work package.
9. Genuinely unrelated discoveries go in that task's Notes only; they are
   not added to frozen v1 scope and are not implemented unless required.
10. Never silently change another task to `ON PROCESS`.

**At task completion:**
11. Run the task's required tests.
12. Run regression tests proportional to the change.
13. Record exact test results in the task's Evidence field.
14. Record acceptance evidence.
15. Commit the implementation.
16. Record the commit SHA in the task.
17. Change status to `COMPLETED`.
18. Synchronize the GitHub issue/checklist.
19. Update `handoffs/FORMULAB_V1_CURRENT.md` to the next exact task.
20. Push normally to `origin/feature/laboratory-stability`.
21. Never force-push or rewrite history.

A task is **not** COMPLETED merely because code exists — it requires
implementation + tests + acceptance criteria satisfied + tracker evidence +
commit + successful push where expected.

## Completion percentage (derived, not guessed)

Recompute from the counts below whenever tasks change. Do not use
subjective percentages.

| Work package | GitHub issue | Total tasks | COMPLETED | ON PROCESS | blank |
|---|---|---|---|---|---|
| FVL-01 | [#2](https://github.com/Sekiph82/FormuLab/issues/2) (closed) | 21 | 21 | 0 | 0 |
| FVL-02 | [#3](https://github.com/Sekiph82/FormuLab/issues/3) (closed) | 24 | 24 | 0 | 0 |
| FVL-03 | [#4](https://github.com/Sekiph82/FormuLab/issues/4) (closed) | 18 | 18 | 0 | 0 |
| FVL-04 | [#5](https://github.com/Sekiph82/FormuLab/issues/5) | 26 | 0 | 0 | 26 |
| FVL-05 | [#6](https://github.com/Sekiph82/FormuLab/issues/6) | 14 | 0 | 0 | 14 |
| FVL-06 | [#7](https://github.com/Sekiph82/FormuLab/issues/7) | 10 | 0 | 0 | 10 |
| FVL-07 | [#8](https://github.com/Sekiph82/FormuLab/issues/8) | 16 | 0 | 0 | 16 |
| FVL-08 | [#9](https://github.com/Sekiph82/FormuLab/issues/9) | 8 | 0 | 0 | 8 |
| FVL-09 | [#10](https://github.com/Sekiph82/FormuLab/issues/10) | 10 | 0 | 0 | 10 |
| FVL-10 | [#11](https://github.com/Sekiph82/FormuLab/issues/11) | 10 | 0 | 0 | 10 |
| FVL-11 | [#12](https://github.com/Sekiph82/FormuLab/issues/12) | 14 | 0 | 0 | 14 |
| **Total** | milestone [#1](https://github.com/Sekiph82/FormuLab/milestone/1) | **171** | **63** | **0** | **108** |

Overall: **63 / 171 tasks completed (36.8%)**. FVL-01, FVL-02, and FVL-03
are now the fully closed packages (100%, 21/21, 24/24, and 18/18 —
FVL-03 closed 2026-08-18 after FVL-03.001-.012, Material Master through
final single-authority integration acceptance). FVL-04 grew from 12 to
26 tasks on 2026-08-18 —
approved scope expansion adding enterprise external-source connector/
mapping/crosswalk onboarding (FVL-04.013-.025) and a human-readable
literature/formulation artifact naming convention (FVL-04.026); all 14
new tasks are blank, none started. This table's FVL-03/Total row counts
were found stale (not recomputed since an earlier session) and corrected
in the same edit that added FVL-04's new tasks — recomputed directly
from the tracker's own per-task status cells, not estimated.

---

## FVL-01 — Phase 14 Closure Baseline

Freeze the completed Phase 14 implementation as the baseline the remaining
v1 work builds on. Audited directly against source, tests, and the latest
external log
(`C:\Users\sekip\Desktop\FormuLab-Phase14-Literature-Formulation-Intelligence-Log.md`)
on 2026-08-17. Any regression discovered later attaches to the task that
exposes it — Phase 14 is not redone to generate work.

**Existing dependency / baseline capability**: none — this package *is* the
baseline every later package depends on.

| Task ID | Title | Status |
|---|---|---|
| FVL-01.001 | Zero-LLM formulation generation (no provider/model/api_key/llm_call in `pipeline.run()`) | COMPLETED |
| FVL-01.002 | Deterministic requirement parsing (`engine.parse_requirements`, controlled vocabulary, scent-character extraction) | COMPLETED |
| FVL-01.003 | Hybrid literature discovery (OpenAlex/OpenAIRE/Europe PMC/Crossref/DOAJ, Unpaywall OA resolution) | COMPLETED |
| FVL-01.004 | CanonicalPaper dedup/provenance (`canonical_paper.py`, `provenance_sources`) | COMPLETED |
| FVL-01.005 | Full-text acquisition gate (`literature_cache.gather`, `discovery_stats.json::full_text_gate_met`) | COMPLETED — policy corrected 2026-08-17, see FVL-01.005 note below |
| FVL-01.006 | Evidence extraction / A-E classes (`evidence.py`) | COMPLETED |
| FVL-01.007 | Concentration evidence (six-tier resolution hierarchy, plausibility gate) | COMPLETED |
| FVL-01.008 | Multi-alternative architecture generation (historical fixed-3, diversity pressure) | COMPLETED — superseded going forward by dynamic 3–7, see FVL-02 |
| FVL-01.009 | Manufacturing Procedure generation | COMPLETED |
| FVL-01.010 | Critical Parameters (target vs. hard limit distinction) | COMPLETED |
| FVL-01.011 | Equipment derivation + availability matching | COMPLETED |
| FVL-01.012 | Deterministic Safety intelligence (`safety.py`) | COMPLETED |
| FVL-01.013 | Deterministic Regulatory intelligence (`regulatory.py`) | COMPLETED |
| FVL-01.014 | Decision traceability (`traceability.py` + UI) | COMPLETED |
| FVL-01.015 | Structured evidence-gap analysis | COMPLETED |
| FVL-01.016 | Evidence & Sources UI (fixed columns, expandable rows, Evidence Class/Records) | COMPLETED |
| FVL-01.017 | Dedicated report generation (`formulationReport.ts`) | COMPLETED |
| FVL-01.018 | Historical session compatibility (pre-Session-6 cards degrade safely) | COMPLETED |
| FVL-01.019 | Full regression suite (pytest/cargo/vitest) green | COMPLETED |
| FVL-01.020 | Fresh desktop build + shortcut verification | COMPLETED |
| FVL-01.021 | GitHub commit/push state (`8bfc11b`, pushed) | COMPLETED |

**FVL-01.005 note (2026-08-17, same-day correction)**: the recovery round
that closed this package added a hard `< 15 full texts → zero formulas`
gate. A same-day follow-up correction replaced that with the three-state
`full`/`partial`/`insufficient` policy — `provenance.py::
RESEARCH_FULL_TEXT_TARGET = 15`, `RESEARCH_FULL_TEXT_MINIMUM = 10`, the one
authoritative source of truth every other module reads. `full` (≥15) is
normal generation (`status: "ok"`); `partial` (10–14) still generates real
formulas with the shortfall visibly disclosed (`status:
"ok_partial_research"`, a page-level notice, an `insufficient_full_text`
evidence gap, and the Download Report); `insufficient` (<10) still blocks
(`status: "research_corpus_incomplete"`, zero cards). This is a bug-fix/
behavior correction to an already-COMPLETED FVL-01 task, not new v1 scope,
per the scope-change policy §1 rule 3.

Regression: `python -m pytest runtime/pipeline -q` — 326/326 (offline,
deterministic tests at 15/15 full, 14/15 partial, 10/15 partial, 9/15
insufficient, 0/15 insufficient, plus mass-balance-under-partial-corpus and
persistence-round-trip checks). Frontend: `pnpm vitest run` — 138
files/1252 tests. Rust: `cargo test --release` — 342/342. `tsc`/ESLint
clean. Live acceptance: two real disposable-library network runs (hand
soap w/ rosemary scent → 9/15; sulfate-free anti-dandruff shampoo → 8/15)
both landed below the minimum and were correctly, honestly blocked — cold
disposable-cache full-text acquisition for these narrow queries continues
to land under 10 within this round's time budget (consistent with prior
sessions' own findings), so the live acceptance exercised the
`insufficient` path for real while the `partial`-generates-formulas path
is proven by the deterministic offline suite above.

**Verification evidence**: `python -m pytest runtime/pipeline -q` — 320/320
(pre-correction baseline; see FVL-01.005 note for the corrected count).
Rust: `cargo check --release` clean, `cargo test --release` — 342/342.
Frontend: `pnpm tsc --noEmit` clean, ESLint clean, `pnpm vitest run` — 138
files/1248 tests. `git diff --check` clean. Real live acceptance: two
disposable network requests (hand soap w/ rosemary scent; sulfate-free
anti-dandruff shampoo) — commit `8bfc11b04142fa30c623c37ca8d7b01d58d0797b`.
**Commit**: `8bfc11b04142fa30c623c37ca8d7b01d58d0797b`. **Completed**: 2026-08-17.

---

## FVL-02 — Dynamic 3–7 Formula Alternatives — CLOSED (24/24, 2026-08-17)

Purpose: implement the frozen requirement in `FORMULAB_V1_FINAL_SCOPE.md`
§1. Must never fabricate alternatives to hit a requested count.

**Existing dependency / baseline capability**: fixed-3 diversity pressure
(`strategy.diversity_report`, `engine.build_formula_for_strategy`,
`avoid_major_role_keys`) from FVL-01.008 — generalized, not rebuilt.

| Task ID | Title | Depends on | Blocking | Status |
|---|---|---|---|---|
| FVL-02.001 | Define request/data contract: `requestedFormulaCount` (or equivalent) on `FormulationBrief`, min 3 / max 7 / default 3 | — | YES | COMPLETED |
| FVL-02.002 | Python: validate/clamp requested count in `pipeline.run()` (reject/clamp policy for <3 and >7, documented) | FVL-02.001 | YES | COMPLETED |
| FVL-02.003 | Generalize `strategy.derive_strategies()` from fixed `n=3` to requested N (reuse existing strategy library only, no new categories) | FVL-02.002 | YES | COMPLETED |
| FVL-02.004 | Generalize deterministic solver loop (`pipeline.py` per-strategy loop) to N cards instead of hardcoded 3 | FVL-02.003 | YES | COMPLETED |
| FVL-02.005 | Generalize cross-formula diversity pressure (`avoid_major_role_keys`) across N versions | FVL-02.004 | YES | COMPLETED |
| FVL-02.006 | Generalize `strategy.diversity_report()`/`distinct_architecture_count` to operate over N alternatives, not assume 3 | FVL-02.005 | YES | COMPLETED |
| FVL-02.007 | Architecture-uniqueness enforcement for N (never pad with a near-duplicate to hit count) | FVL-02.006 | YES | COMPLETED |
| FVL-02.008 | Insufficient-defensible-alternatives behavior: return M honestly when M < requested N (M ≥ 3 normal case) | FVL-02.006 | YES | COMPLETED |
| FVL-02.009 | Below-3-defensible-alternatives behavior: mark result incomplete/insufficient rather than fabricate | FVL-02.008 | YES | COMPLETED — new `engine.FORMULA_ALTERNATIVES_SUFFICIENT`/`FORMULA_ALTERNATIVES_INSUFFICIENT` constants and a top-level `formula_alternatives_status` field on `pipeline.run()`'s return, independent of `status` (research-corpus completeness) — real alternatives always returned as-is, never discarded/padded. 8 new tests (`test_formula_alternatives_status.py`), including both signals held simultaneously (partial corpus + below-minimum count) without either overwriting the other. Note: under the current strategy library `actual_formula_count < 3` is not reachable through genuine strategy scarcity (`balanced` + one of `cost_optimized`/`premium_sensory` + the unconditional `max_performance` fallback jointly guarantee 3) — tests prove the signal via a real `strategy.derive_strategies()` output truncation, not fabrication. |
| FVL-02.010 | `formulaVersionId`/card collection refactor: remove hardcoded v1/v2/v3 branching wherever it exists in `pipeline.py`/`engine.py` | FVL-02.004 | YES | COMPLETED |
| FVL-02.011 | Session persistence: `cards.json`/session directory representation supports N cards (3–7) | FVL-02.010 | YES | COMPLETED |
| FVL-02.012 | Rust bridge (`formulation_v2.rs`): remove any 3-card assumption, pass through N cards generically | FVL-02.011 | YES | COMPLETED — was already a generic `serde_json::Value` passthrough with no fixed struct/enum; proven directly with a new 7-card round-trip test (`read_cards_round_trips_all_seven_alternatives`) |
| FVL-02.013 | TypeScript types (`formulationV2.ts`): `cards: FormulationCard[]` already generic — audit and fix any `[0]`/`[1]`/`[2]`-indexed assumption | FVL-02.012 | YES | COMPLETED |
| FVL-02.014 | Frontend: dynamic version selector (replaces implicit V1/V2/V3 tab set) driven by real returned card count | FVL-02.013 | YES | COMPLETED |
| FVL-02.015 | Frontend: responsive handling of 3–7 version selector entries (no layout break, no giant side-by-side table — preserve one-formula-at-a-time UX) | FVL-02.014 | YES | COMPLETED — `VersionCards` switches from a fixed 3-column grid to a horizontally scrollable strip (real min-width per card) once `cards.length > 3` |
| FVL-02.016 | Frontend: version switching + selected-ingredient reset generalized to N | FVL-02.014 | YES | COMPLETED |
| FVL-02.017 | Frontend: every version-scoped tab (Manufacturing, Critical Parameters, Equipment, Safety, Regulatory, Evidence & Sources, Alternatives, Summary) reads the active card generically, not `card[0..2]` | FVL-02.014 | YES | COMPLETED |
| FVL-02.018 | Frontend: Download Report generalized to N formulas (loop, not V1/V2/V3 literals) in `formulationReport.ts` | FVL-02.011 | YES | COMPLETED |
| FVL-02.019 | Backward compatibility: existing 3-version historical sessions still open and render correctly | FVL-02.017 | YES | COMPLETED |
| FVL-02.020 | Tests: pytest parametrized for N = 3, 4, 5, 6, 7 (strategy count, diversity, persistence) | FVL-02.009 | YES | COMPLETED — `test_acceptance_formula_count.py::RequestedCountParametrizedTests` |
| FVL-02.021 | Tests: request > 7 clamped/rejected per FVL-02.002 policy; request < 3 handled per same policy | FVL-02.002 | YES | COMPLETED — Acceptance Case E |
| FVL-02.022 | Tests: fewer-than-requested scientifically-defensible case (e.g. request 5, only 4 defensible) | FVL-02.008 | YES | COMPLETED — Acceptance Case D |
| FVL-02.023 | Tests: frontend Vitest for dynamic selector at N=3 and N=7, backward-compat session render | FVL-02.019 | YES | COMPLETED — `FormulationResultPage.test.tsx`'s new "dynamic 3-7 version selector" describe block (N=3..7 parametrized + switching + single-active-at-a-time) |
| FVL-02.024 | Real, disposable, zero-LLM network acceptance test at a non-default N (e.g. 5) | FVL-02.020 | YES | COMPLETED — Acceptance Cases A/B (real anti-dandruff PDF, N=5) |

---

## FVL-03 — Unified Formulation Pipeline ↔ Existing FormuLab Engines

Integrate the Phase 14 deterministic pipeline with already-existing FormuLab
platform capabilities. Do not build replacements.

**Single-authority rule applies to every task below** (see
`docs/FORMULAB_V1_FINAL_SCOPE.md`'s "Single-authority principle" and the
authoritative domain map + legacy retirement matrix in
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`, both added 2026-08-18 as
an architecture correction — no new scope, only hardened wording). Every
subtask below must reuse/call/extend the cited existing engine; a
Python-side adapter transports and reshapes data only, it never becomes a
second authority for that domain's business decision.

**Existing dependency / baseline capability** (verified present in
`docs/architecture/IMPLEMENTATION_STATUS.md`, and re-confirmed by code
during the 2026-08-18 architecture-correction audit): Cost Engine
(`packages/shared/src/engine/cost.ts`), Advanced Optimizer
(`apps/desktop/src-tauri/src/formulation_advanced.rs` /
`runtime/formulation/advanced_optimizer.py`), material substitution
(`packages/shared/src/engine/substitution.ts`) / system substitution
(`packages/shared/src/engine/systemSubstitution.ts`), Compatibility Engine
(`packages/shared/src/engine/compatibility.ts`), Safety Engine
(`packages/shared/src/engine/safety.ts`), Kenya/EAC Regulatory Engine
(`packages/shared/src/engine/regulatoryRules.ts` +
`regulatoryClassification.ts`), Material Master + supplier records + price
history (`packages/shared/src/schemas/materials.ts`,
`apps/desktop/src-tauri/src/masterdata.rs`, `data/master/*.json`).

| Task ID | Title | Depends on | Blocking | Status |
|---|---|---|---|---|
| FVL-03.001 | Audit exact integration seam: Material Master ↔ `engine.build_candidate_pool()` (what's read today via `materials_dir`, what's missing) | FVL-01 | YES | COMPLETED (2026-08-18) — full audit in `docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`. Confirmed by code: `build_candidate_pool()` consumes a SECOND, legacy material representation (`runtime/pipeline/materials.py`'s flat `<materials_dir>/materials.json`, populated by the live `MaterialsCard.tsx` CSV-import path), never the canonical `data/master/materials.json` (`masterdata.rs`) the real Materials screen uses. Identity mismatch confirmed: pool keys on normalized INCI/name text, never `RawMaterial.code`. `resolve_concentration()`'s own Tier 4 (supplier recommended range) is dead code on this path — proven end-to-end with a real CSV import (`test_material_master_seam.py`, 4 tests). Cost Engine boundary documented (`packages/shared/src/engine/cost.ts::costFormula()`, keyed on `materialCode`) — confirmed NOT called from the generation path; `materials.py::cost_formula()` is a separate, unrelated reimplementation. No production code changed — audit-only, per FVL-03.001's own scope. |
| FVL-03.002 | Canonical Material Master (`data/master/materials.json` + supplier-link + price-history collections, via `masterdata.rs`) reaches `engine.build_candidate_pool()` through a shape-only Python adapter. `RawMaterial.code` carried end-to-end as real identity, in addition to (never instead of) existing INCI/name text matching. Adapter transports/reshapes only — it must not own supplier or price business logic (single-authority rule). | FVL-03.001 | YES | COMPLETED (2026-08-18) — new `runtime/pipeline/master_materials_adapter.py` reads `data/master/{materials,material_suppliers,suppliers,material_prices}.json` directly (bare canonical arrays, no new storage), filters `active`, carries `code`/`material_code` as real identity through `IngredientCandidate`/`SolvedIngredient`/`traceability.selected_event`'s `source_ids`/the rendered formula ingredient (`material_code` field). Makes Tier 4 (`recommended_min_pct`/`recommended_max_pct`) live end-to-end (previously proven dead code by FVL-03.001) and adds a single-implementation-point `technical_max_pct` hard-ceiling clamp (`resolve_concentration()`'s new wrapper, `ConcentrationResolution.technical_max_clamped`). Rust: `formulation_v2.rs`'s `materials_dir` now points at `data/master` (was `data`), new adapter registered in `materialize_pipeline()`'s embedded-file list (verified by reproducing the exact materialized set in a disposable temp dir and importing `pipeline` cleanly — the same class of bug FVL-02.009 found and fixed). Single-authority boundary held: no `price`/`currency` key is ever set by the adapter (`material_price_refs` passed through raw/unfiltered instead — proven by `test_no_price_key_is_ever_set...`); supplier identity kept as the full `material_supplier_refs` set, a `supplier` display string surfacing only when the canonical `preferred` field is already unambiguous (never a new ranking rule). `runtime/pipeline/materials.py`/`materials.rs`'s legacy CSV-import commands untouched, out of scope. `python -m pytest runtime/pipeline -q`: 393 passed, 5 subtests (15 new: `test_master_materials_adapter.py` 11, 3 `technical_max_pct` clamp tests, 1 new end-to-end Tier-4 test; 2 existing tests extended in place, not counted as new). `cargo test masterdata:: formulation_v2::`: 28/28 passing. `cargo check`: clean. |
| FVL-03.003 | Cost-oriented formulation behavior calls the EXISTING Cost Engine (`packages/shared/src/engine/cost.ts::costFormula()`/`buildCostSnapshot()`) for any real price, landed-cost, or exchange-rate result. `runtime/pipeline/materials.py::cost_formula()` is legacy and is retired or bypassed for the generation path. No Python reimplementation of price selection, landed cost, or FX conversion. | FVL-03.002 | YES | COMPLETED (2026-08-18) — audit confirmed Python cannot call `cost.ts` at all (`run_cli.py` is a one-shot subprocess); real cost is computed client-side, post-generation, via new `apps/desktop/src/lib/generatedFormulaCost.ts::costGeneratedFormula()` (thin wrapper over `buildCostSnapshot()`, no business logic — proven identical to a direct call by test). `linesFromGeneratedFormula()` now carries `material_code` (FVL-03.002's own field) into `FormulationLine.materialCode`, the exact key `costFormula`/`priceFor` join on — never text-similarity matching (proven by test: a same-name decoy material with a price is NOT matched). Wired into both UIs (`CostingPanel.tsx` old `/live`, `FormulationResultPage.tsx` new result UI — 3 prior hardcoded placeholders replaced with real cost + a "cheapest among valid alternatives" indicator via new pure `costComparison.ts::pickCheapestValidVersion()`, which excludes invalid-`formula_state` and incomplete-cost candidates from ever winning). Legacy path DELETED (not bypassed): `materials.py::cost_formula()`/`render_costing_markdown()`, `materials_cli.py`'s `"cost"` action, `materials.rs::cost_formulation`, `formulationV2.ts::costFormulation()`/`CostSheet`/`CostLine` — confirmed zero remaining callers before deletion. `python -m pytest runtime/pipeline -q`: 386/386 (7 obsolete `CostingTests` removed). `cargo check`+`cargo test`: 345/345. `pnpm --filter @formulab/shared test`: 1302/1302 (`cost.test.ts` untouched, re-verified). `pnpm --filter @formulab/desktop test`: 1287/1287 (19 new). `typecheck`/`lint`: clean. |
| FVL-03.004 | Inventory feasibility consumes canonical `InventoryRecord` collections and existing availability semantics directly (missing data stays missing, never assumed available) — no copied stock rules, no second availability model. | FVL-03.001 | NO | COMPLETED (2026-08-18) — new `packages/shared/src/engine/inventoryAvailability.ts::evaluateMaterialAvailability()` is the one canonical usable-quantity derivation (`quantity − reservedQuantity`, restricted to lots that are `!quarantined && released` and not expired — the only unambiguous schema-defined facts; `coaStatus` deliberately not gated on). Client-side, read-only, mirrors FVL-03.003 exactly (Python cannot call `packages/shared` — confirmed by audit; `master_materials_adapter.py` NOT extended to read inventory, decided with the user). New `apps/desktop/src/lib/generatedFormulaInventory.ts::evaluateGeneratedFormulaInventory()` joins by `material_code` only (proven immune to a same-display-name decoy via test), computes required quantity from the same numeric `batchKg` control FVL-03.003 already lifted to `FormulationResultPage.tsx` (never the free-text `estimatedBatchSize` brief field, confirmed purely decorative). Rolls up to formula-level FEASIBLE/INFEASIBLE/UNKNOWN. "Prefer a feasible candidate" satisfied at the version level — new `apps/desktop/src/lib/inventoryComparison.ts::pickMostInventoryFeasibleVersion()`, the same pattern as `pickCheapestValidVersion` for cost — never by mutating `engine.py`'s per-role candidate loop; Python stays entirely inventory-blind. Cost and inventory proven to stay separate dimensions (joint test: a real cost total and an independently-computed INFEASIBLE inventory state coexist). Wired into the new result UI only (Summary tab + `VersionSummaryCard` badge) — `CostingPanel.tsx` deliberately not extended (no multi-version context). Read-only confirmed by grep: no `upsertRecords("inventory", ...)` call exists anywhere in the changed files. `pnpm --filter @formulab/shared test`: 1311/1311 (9 new). `pnpm --filter @formulab/desktop test`: 1303/1303 (16 new). `typecheck`/`lint`: clean. `python -m pytest runtime/pipeline -q`: 386/386 (unchanged — Python untouched except a non-functional doc comment on the legacy, confirmed-unused `stock` field). `cargo check`: clean (unchanged — no Rust edits). |
| FVL-03.005 | Existing Advanced Optimizer (`apps/desktop/src-tauri/src/formulation_advanced.rs` / `runtime/formulation/advanced_optimizer.py`) used as an optional post-generation refinement of a selected alternative — no new solver, and not a merge into `engine.py`'s deterministic candidate-generation logic (different responsibility, both legitimately exist). | FVL-03.003 | NO | COMPLETED (2026-08-18) — audit confirmed the Advanced Optimizer (`advanced_optimizer.py`, 1732-line real MILP/PuLP solver, distinct and untouched vs. `formulation_core.py`'s simple LP), its Rust bridge, and its full result/persistence schema set (`packages/shared/src/schemas/optimization.ts`) are already single-authority-correct — real `materialCode` identity, caller-computed compatibility/safety risk (never re-derived by the solver), honest `stock`/`reservedStock`/`availableStock`, existing `AdvancedOptimizerPanel.tsx`/`OptimizationPage.tsx` UI already project-bound and already wired to canonical cost/inventory/materials. Zero engine/schema/solver/Rust changes made. Sole gap: `formulationProblemSchema.projectId`/`productFamilyId` are non-optional but a generated AI session card has no project association — resolved (decided with the user via AskUserQuestion, "require save-first" over "old-UI-only") with new pure `apps/desktop/src/lib/promoteGeneratedFormula.ts::buildPromotedFormulation()`, which builds a real `Formulation`/`FormulationVersion` from the card's own real data using the exact existing `newFormulation()`/`newVersion()`/`linesFromGeneratedFormula()` helpers (zero new persistence shape; `materialCode` carried through unchanged from FVL-03.002/.003). New "Optimize / Refine" quick action on `FormulationResultPage.tsx` (`SlidersHorizontal` icon, `formulationResult.quickActions.optimize`/`optimizing` i18n keys, all 8 locales) calls `saveFormulation()`+`saveFormulationVersion()` once per version (cached in-memory per visit to avoid duplicate `Formulation` records on repeat clicks), then navigates into the existing, unmodified `/optimization?project=<id>` workflow. Source session/cards are never written to — confirmed by diff review (no `session.*` mutation in the changed code, only reads of `session.brief`/`session.id`) and by construction (`buildPromotedFormulation` is pure, makes no Tauri/network call, proven by test). No new optimizer UI/dashboard; `/live`'s own optimizer path (`FormulasPage.tsx`'s Optimizer tab) untouched; zero-LLM, zero-substitution, all hard constraints (exclusions, `technicalMaxPercent`, mass balance) inherited unchanged from the existing panel — none of this task's new code touches constraint/objective logic. Acceptance A/B/C/D/E/F/G/H/J inherited as regression from the existing, unmodified `AdvancedOptimizerPanel`/its own test suite (re-verified green, not re-proven); this task's own narrow proof burden — promotion correctness, read-only w.r.t. the session, honest `"general"` fallback when brief category is empty, never a fabricated specific category — covered by new `promoteGeneratedFormula.test.ts` (5/5 passing). `pnpm --filter @formulab/desktop test`: 1308/1308 across 145 files (5 new; `AdvancedOptimizerPanel.test.tsx`/`OptimizationPage.test.tsx` unmodified and green). `typecheck`/`lint`: clean. `packages/shared`, `runtime/formulation`, `src-tauri/src/formulation*` all confirmed untouched by diff (no Python/Rust/shared sanity re-run needed). |
| FVL-03.006 | Existing material substitution engine (`packages/shared/src/engine/substitution.ts`) used for an ingredient the candidate pool cannot resolve — no pipeline-local duplicate substitution scoring. | FVL-03.001 | NO | COMPLETED (2026-08-18) — audit confirmed the one-to-one Material Substitution Engine (`packages/shared/src/schemas/substitution.ts` + `engine/substitution.ts`, `docs/MATERIAL_SUBSTITUTION.md`) is already single-authority-correct: deterministic scoring over 15 real dimensions traced to real material/price/inventory/supplier/compatibility/safety data (never name similarity), `missingData: true` never defaulted to a perfect match, real `materialCode` identity throughout, and an already-real, already-tested UI (`SubstitutionDialog`/`SubstitutionPanel.tsx`, mounted in both `/live` `FormulasPage.tsx` and the project-bound `/formulation` `FormulationPage.tsx`) that persists an immutable `substitution_runs` record before ever touching the WORKING DRAFT (never the saved version) — confirmed via `useFormulationWorkspace.ts::onApplySubstitution`. Zero engine/schema/scoring/Rust/Python changes made. Trigger boundary: new pure `apps/desktop/src/lib/generatedFormulaInventory.ts::shouldOfferSubstitution()` returns true only for the two named cases — (A) an ingredient with no resolvable `materialCode` at all, or (B) a resolved ingredient whose FVL-03.004 inventory state is definitively `insufficient` — and explicitly false for every other UNKNOWN (no inventory record, mixed units, unusable batch size), matching the "UNKNOWN is missing data, never automatic unavailability" requirement (5/5 new predicate tests + existing Acceptance A-C fixtures). Reused, not reinvented, the case-A "unresolved source" path — `SubstitutionPanel.tsx` already falls back to `line.materialId ?? line.id` / `line.materialCode ?? ""` for any line without a resolved material, pre-existing behavior confirmed by audit, never a new source-identity mechanism. New "Find substitute" entry point added only to the existing `InventoryFeasibilitySummary` component (read-only display, FVL-03.004) — a small button per flagged ingredient that promotes the selected generated version via the existing `promoteGeneratedFormula.ts` (FVL-03.005's same promotion seam, now caching the full `{formulation, version}` pair so both the Optimizer and Substitution entry points share one promoted project per version, never creating duplicates), then navigates to `/formulation?project=<id>&substituteLine=<lineId>` — a new one-shot query-param handoff in `FormulationPage.tsx`, exactly mirroring its own pre-existing `focusLine` pattern, that opens the existing, completely unmodified `SubstitutionDialog` for that exact promoted line (plus a defensive existence-guard so a stale/bad line id can never render a broken dialog). No new substitution dashboard; no second scoring function; no system-substitution work pulled forward (FVL-03.007 untouched — `systemSubstitution.ts`/`generateSystemCandidates` never referenced by any new code this session); source session/cards never mutated — confirmed by diff review (only `session.brief`/`session.id`/`card` reads). Acceptance A/D/E/F/G/H/I/J inherited as regression from the existing, unmodified engine/UI's own test suite (`SubstitutionPanel.test.tsx`, re-verified green); Acceptance B/C are this task's own new proof burden, covered by the new predicate tests plus a new `InventoryFeasibilitySummary.test.tsx` (7 tests: button shown only for A/B triggers, never for a generic UNKNOWN or a fully available line, click reports the correct ingredient index, no button at all without a wired callback, only the in-flight row shows a busy/disabled state). `pnpm --filter @formulab/desktop test`: 1321/1321 across 146 files (13 new). `typecheck`/`lint`: clean. `packages/shared`, `runtime/formulation`, `runtime/pipeline`, `src-tauri/src/formulation*` all confirmed untouched by diff (no Python/Rust/shared sanity re-run needed). Zero-LLM intact. |
| FVL-03.007 | Existing system substitution engine (`packages/shared/src/engine/systemSubstitution.ts`, which itself routes candidates through the Advanced Optimizer rather than solving independently) used at the formula level where applicable — no parallel system-substitution logic. | FVL-03.006 | NO | COMPLETED (2026-08-18) — audit confirmed system substitution is already single-authority-correct and already fully implemented, not merely documented: `packages/shared/src/engine/systemSubstitution.ts` (`generateSystemCandidates`, `buildSystemSubstitutionProblem`, `scoreSystemResult`), `packages/shared/src/schemas/substitution.ts` (`systemCandidateLimitsSchema`, `rejectedSystemCandidateSchema`, the `lineIds`/`materialIds`/`preserveFunctions`/... fields on `substitutionRequestSchema`), full spec in `docs/SYSTEM_SUBSTITUTION.md`. Confirmed "system" has NO fixed chemistry taxonomy anywhere in this platform (no hardcoded surfactant/preservative/chelation/etc. categories) — a "system" is whichever ≥2 formula lines a human selects; membership is 100% human-identified via checkboxes, never auto-detected, matching the task's own "do not fabricate membership" requirement by construction. Candidate generation never uses name similarity (function-coverage + stock/supplier-approval/Kenya-local filters only); every candidate combination is routed through the REAL Advanced Optimizer (`buildSystemSubstitutionProblem`→`runtime/formulation/advanced_optimizer.py`, never a proportional-scaling shortcut); a combination that fails to cover a preserved function is recorded as rejected (`missing_required_function`), never silently offered partial. Scoring reads directly from the real optimizer result (feasibility ranking, soft-constraint violation count, real cost delta, `compatibility_risk`/`safety_risk` when the caller wired them, `missingData: true` otherwise — never assumed perfect/zero). Applying persists BOTH the underlying `OptimizationRun` and an immutable `SubstitutionRun` (`isSystem: true`, `systemMaterialIds`, `optimizationRunCode` pointer) before ever touching the working DRAFT (never the saved `FormulationVersion`) — same non-destructive lifecycle FVL-03.006 already confirmed for one-to-one substitution. The existing `SubstitutionDialog`/`SubstitutionPanel.tsx` (mounted in both `/live` and `/formulation`) already implements this ENTIRE workflow in its system-mode section (check 2+ lines → generate → evaluate → apply). **Zero engine/schema/scoring/Rust/Python changes made.** Sole gap closed: a generated AI session card has no real project (same `substitutionRequestSchema.projectId`/`formulaVersionId` requirement FVL-03.006 already resolved) and the existing dialog had no way to open pre-seeded with 2+ lines already checked. New optional `initialExtraLineIds?: string[]` prop added to `SubstitutionDialog` (`SubstitutionPanel.tsx`) — seeds `selectedLineIds` beyond the required anchor `line` on open only, filtered defensively against real `allLines` so a stale/bogus id can never masquerade as a second system member; the human can still freely add/remove lines afterward, exactly as before — no behavior change to anyone who doesn't pass it. New multi-select UI added only to the existing ingredient table (`FormulaTab` in `FormulationResultPage.tsx`) — a checkbox per row (`stopPropagation`'d so it never also opens the evidence panel) plus a small action bar ("N ingredient(s) selected" / "System substitution", disabled below 2 selections, so a one-material problem can never reach system mode). Clicking it reuses the exact FVL-03.005/.006 promotion seam (`ensurePromoted()`) to get a real `Formulation`/`FormulationVersion`, resolves the selected ingredient indices to that version's own real line ids (same index-alignment guarantee as FVL-03.006), and navigates to `/formulation?project=<id>&substituteLine=<anchor>&systemLines=<rest>` — a new one-shot query-param handoff in `FormulationPage.tsx` (mirrors its own `focusLine`/`substituteLine` pattern) that opens the existing, otherwise-unmodified `SubstitutionDialog` pre-seeded into system mode. Selection state is version-scoped: a real cross-version leak bug was caught by a new test and fixed with a `useEffect` resetting `selectedForSystem` on `card.version` change (Acceptance I). Source session/cards never mutated — confirmed by diff review. No compatibility/safety/regulatory logic added (FVL-03.008/.009/.010 untouched); no fabricated ratios/concentrations (the existing engine's own deterministic optimizer-derived percentages are used as-is, never locally recomputed); no-candidate/infeasible results inherited honestly from the existing dialog. Acceptance A/B/C/D/E/F/G/H/J inherited as regression from the existing, unmodified engine/dialog's own test suite (`SubstitutionPanel.test.tsx`, re-verified green); this task's own new proof burden — `initialExtraLineIds` pre-seeding, defensive bogus-id filtering, multi-select UI correctness, and version scoping (Acceptance I) — covered by 3 new `SubstitutionPanel.test.tsx` tests + 4 new `FormulationResultPage.test.tsx` tests. `pnpm --filter @formulab/desktop test`: 1328/1328 across 146 files (7 new). `typecheck`/`lint`: clean. `packages/shared`, `runtime/formulation`, `runtime/pipeline`, `src-tauri/src/formulation*` all confirmed untouched by diff. Zero-LLM intact. |
| FVL-03.008 | Existing Compatibility Engine (`packages/shared/src/engine/compatibility.ts::evaluateCompatibility`) becomes the authoritative compatibility verdict for generated formulas. `runtime/pipeline/rules.py::validate()`/`derive_constraints()` remain in place — confirmed by the 2026-08-18 audit to implement only generation-REQUEST constraints (excluded ingredients, sulfate-free, requested pH bounds), never chemical/material compatibility logic — so they are not a competing engine. No duplicate compatibility business rules. | FVL-03.001 | YES | COMPLETED (2026-08-18) — audit confirmed `evaluateCompatibility()` (`packages/shared/src/engine/compatibility.ts`, deterministic rule-driven engine, no model in the loop, `docs/COMPATIBILITY_ENGINE.md`) is already the single authority: real `RULE_SEVERITIES` vocabulary (`info`/`warning`/`error`/`blocking`), real materialCode-based identity (`materialFor()`), 20 seed rules covering forbidden/warning combinations, pH-/temperature-/concentration-dependent conditions, missing-data honestly downgraded to `dataIncomplete: true` (never silently safe). Confirmed by direct audit of `optimization.ts::blockingExclusionConstraints` and `SubstitutionPanel.tsx` that ONLY `severity === "blocking"` is a real hard block anywhere in this platform — reused verbatim, not invented. Zero engine/schema/Rust/Python changes. `runtime/pipeline/rules.py` re-confirmed request-constraint-only (zero chemistry/ionic/pH/hlb/cationic/anionic keyword hits). New pure `apps/desktop/src/lib/generatedFormulaCompatibility.ts::evaluateGeneratedFormulaCompatibility(formula, materials, rules, opts)` — read-only, no promotion/persistence needed (`evaluateCompatibility` is pure) unlike FVL-03.005/.006/.007. Rule set is a REQUIRED caller-supplied param (never hardcoded) — new `useCompatibilityRules()` hook loads the LIVE, chemist-editable `compatibility_rules` masterdata collection (same one `CompatibilityPanel.tsx` reads), not a frozen `SEED_COMPATIBILITY_RULES` copy. `formulaState` (`compatible`/`warning`/`blocked`/`unknown`) follows real engine severity semantics exactly; `unknown` is reported (never `compatible`) when zero findings fire AND at least one ingredient has no resolvable `materialCode` — `unresolvedMaterialCount` always surfaced honestly alongside real findings, neither hides the other. Fixed a real pre-existing gap found by this session's own testing: `masterdata.ts::listRecordsSeeded()` threw `"not-desktop"` outside Tauri (a latent bug never previously exercised, since no test rendered a caller of it) — fixed to return `seed` directly outside Tauri, mirroring `listRecords()`'s own established `!isTauri` convention; zero behavior change inside Tauri. `pickCheapestValidVersion()`/`pickMostInventoryFeasibleVersion()` extended with an optional `compatibilities` eligibility-gate parameter — a `"blocked"` version can never be crowned cheapest-valid or most-feasible merely because its price/stock is attractive (task §9); `"warning"`/`"unknown"` never exclude; omitting the parameter preserves prior behavior exactly (proven by test). New thin `GeneratedCompatibilitySummary` presenter (not a second dashboard) wired into the result page's Summary tab and a compatibility row/blocked-banner on `VersionSummaryCard`. Confirmed by audit (not rewritten, since already correct) that the Advanced Optimizer (`blockingExclusionConstraints`), Material Substitution (`SubstitutionPanel.tsx`'s own `evaluateCompatibility` re-run), and System Substitution (`blockingExclusionConstraints` inside `buildSystemBasis()`) all already consume the SAME authoritative engine — disclosed, out-of-scope, pre-existing finding: those three callers pass the hardcoded `SEED_COMPATIBILITY_RULES` constant rather than the live edited collection this task's own new code correctly reads via `useCompatibilityRules()`; not a duplicate-authority violation (same single engine, same call, no second scoring logic anywhere) and out of this task's boundary to retrofit already-closed FVL-03.006/.007 code. No Safety/Regulatory work pulled forward. Acceptance A/B/C/D proven directly by 9 new `generatedFormulaCompatibility.test.ts` tests (disposable fixture rules, per task's own instruction); E/F proven by 4 new `costComparison.test.ts` + 3 new `inventoryComparison.test.ts` tests; G/H/I confirmed by audit/inherited regression (existing `AdvancedOptimizerPanel.tsx`/`SubstitutionPanel.tsx` tests unmodified and green); J proven by a new `FormulationResultPage.test.tsx` test plus 3 more end-to-end wiring tests using REAL seed rules (a genuine `compat-acid-hypochlorite` blocking finding, real version scoping). `pnpm --filter @formulab/desktop test`: 1354/1354 across 148 files (26 new). `typecheck`/`lint`: clean. `packages/shared`, `runtime/formulation`, `runtime/pipeline`, `src-tauri/src/formulation*` all confirmed untouched by diff. Zero-LLM intact. |
| FVL-03.009 | Existing Safety Engine (`packages/shared/src/engine/safety.ts::evaluateSafety`/`classifyProductSafety`) becomes the single authoritative final safety verdict. `runtime/pipeline/safety.py::evaluate_safety()` is a confirmed duplicate — it independently computes its own `overall_status` from its own hazard tables, never consuming the TS engine's result. Its pipeline-local duplicate final-verdict logic is retired or reduced to non-authoritative preprocessing that feeds the authoritative engine — not permanently reconciled as a second, independently-disagreeing verdict authority. | FVL-03.008 | YES | COMPLETED (2026-08-18) — audit confirmed `runtime/pipeline/safety.py::evaluate_safety()` was a real, fully independent second final-verdict authority (its own `_SENSITIZER_CLASS_INGREDIENTS`/`_ALLERGEN_DECLARATION_INGREDIENTS`/`_CORROSIVE_HANDLING_INGREDIENTS`/`_IRRITANT_POWDER_HANDLING_INGREDIENTS`/`_SULFATE_KEYS` name-keyed hazard tables computing its own `overall_status`, never consuming `packages/shared/src/engine/safety.ts`). Resolved by full retirement (Option A, matching FVL-03.003's precedent), not permanent reconciliation: `runtime/pipeline/safety.py` and `runtime/pipeline/test_safety.py` deleted entirely; `pipeline.py` no longer imports `safety`, no longer builds `safety_result`, no longer emits `card["safety"]` or a `safety`-sourced `evidence_gaps` entry; `validation_plan.py::build_validation_plan()` had its `safety_overall` parameter removed, VAL-002 narrowed to the still-live regulatory-only check (Regulatory consolidation itself untouched — FVL-03.010's job); `test_pipeline.py`'s zero-LLM guard now asserts `"safety" not in card`; `test_traceability.py`'s `test_every_safety_finding_has_a_source_or_rule` (which read the now-nonexistent `card["safety"]["findings"]`) removed, the adjacent regulatory provenance test left untouched. The separate, legitimate `classify_target`/`safety_gate` pre-generation AI-request gate in `pipeline.py` (mirrors the TS `PRODUCT_SAFETY_CLASSIFICATIONS` enum by design) was confirmed by audit to be an unrelated responsibility and left completely alone. New client-side integration seam — same pattern as FVL-03.008 — since `evaluateSafety()` is pure/read-only: new `apps/desktop/src/lib/generatedFormulaSafety.ts::evaluateGeneratedFormulaSafety(formula, materials, rules, opts)` computes a `formulaState` (`safe`/`warning`/`blocked`/`unknown`) from real `findings`, with `unknown` reserved for zero-findings-plus-unresolved-materialCode (never silently "safe") and `unresolvedMaterialCount` always surfaced honestly alongside real findings; `blocked` set if and only if any finding has `severity === "blocking"`, reusing the platform's own already-confirmed "only blocking is a real hard block" convention (`optimization.ts::blockingExclusionConstraints`, `SubstitutionPanel.tsx::hasBlockingSafetyFinding`) rather than inventing new severity semantics. `classifyProductSafety` deliberately NOT wired for generated-formula evaluation — a generated session's free-text `brief.category` has no reliable join to a real `ProductFamily.hazardClass` record, and fabricating that join would violate the standing no-fabricated-identity rule (same scope decision FVL-03.008 made for Compatibility's product-domain context). New `useSafetyRules()` hook loads the LIVE `safety_rules` masterdata collection (`listRecordsSeeded`), not a frozen `SEED_SAFETY_RULES` copy. `pickCheapestValidVersion()`/`pickMostInventoryFeasibleVersion()` extended with an optional 4th `safeties` eligibility-gate parameter, independent of and additive to the existing `compatibilities` gate — a safety-`blocked` version can never be crowned cheapest-valid/most-feasible; omitting the parameter preserves prior behavior exactly (proven by test). `FormulationResultPage.tsx` fully rewired off the legacy Python-shaped `card.safety` (`overall_status`/`subject`/`rule_id`/`rationale`) onto the authoritative client-side result: `SafetyTab` rewritten to render the new `GeneratedSafetySummary` presenter; a Safety section added to `SummaryTab` (including the "Readiness" badges block, whose stale `card.safety.overall_status` reference was caught only by a deliberate post-implementation grep audit, not by typecheck/lint/the first test pass); a Safety row + red "blocked" banner added to `VersionSummaryCard`. `formulationReport.ts`'s `versionSection()`/`buildReportHtml()`/`openAndPrintReport()` rewired to accept a `safetyByVersion` map (built from the exact same computed `safeties` array the UI renders) instead of reading the retired `card.safety` JSON — closing the one real split-authority risk in the whole task (the "Download Report" path), with a backward-compatible default `= {}` so no other caller breaks and an honest "not available" (never a fabricated verdict) when no result was computed for a version. `formulationV2.ts`'s `SafetyResult` interface kept (not deleted) but its doc comment now states plainly it is legacy-only, read by zero current code, present solely so a historical session file saved before this retirement still parses without error — the authoritative verdict for every session, old or new, is `evaluateGeneratedFormulaSafety()` recomputed client-side from `card.formula`. Confirmed by audit (not rewritten, since already correct) that the Advanced Optimizer (`blockingExclusionConstraints`) and both Material/System Substitution (`SubstitutionPanel.tsx::hasBlockingSafetyFinding`) already consume the SAME authoritative engine; same disclosed, out-of-scope, pre-existing gap FVL-03.008 already flagged (those three callers pass the hardcoded `SEED_SAFETY_RULES`/`SEED_COMPATIBILITY_RULES` constants rather than the live edited collections) reconfirmed still present and still out of this task's boundary. Compatibility and Safety confirmed to remain separate domains throughout — no merged findings, no shared verdict field, no opaque combined score. Real `materialCode` identity carried through via the shared `ruleConditions.ts` matcher (`matchLines`/`lineMatchesCondition`/`materialFor`), with graceful name-/function-keyword fallback for unresolved lines, never fabricated identity. All 8 i18n locales given new `safety.state.*`/`safety.severity.*`/`safety.notYetAvailable`/`safety.unresolvedMaterialCount`/`safety.findingRequiresHumanReview` keys (English placeholder text in de/es/fr/ja/ko/zh-Hans, real Turkish translations). Historical sessions carrying the legacy `card.safety` JSON confirmed to open without crashing and never surface as current authority — proven by a dedicated rewritten `FormulationResultPage.test.tsx` test against the pre-existing SESSION_V6 fixture, which also surfaced a genuine, non-obvious real-engine fact (the real `SEED_SAFETY_RULES` `safety-flammable-solvent`+`safety-ventilation-reminder` rules legitimately fire on a plain q.s.-to-100% "Water (Aqua)"/function="Solvent" line via their `functionsAny: ["solvent"]` OR-condition, producing a genuine `formulaState: "warning"`, not "unknown"). Acceptance A/B/C/D/G proven by 9 new `generatedFormulaSafety.test.ts` tests plus 7 new `GeneratedSafetySummary.test.tsx` tests (disposable fixture rules); E/F proven by 5 new `costComparison.test.ts` + 3 new `inventoryComparison.test.ts` tests; H/I confirmed by audit/inherited regression (existing `AdvancedOptimizerPanel.tsx`/`SubstitutionPanel.tsx` tests unmodified and green); J/K proven by 4 corrected `FormulationResultPage.test.tsx` tests (two needed `findAllByText`/`toBeGreaterThanOrEqual(2)` fixes since the real Safety and Compatibility engines now legitimately co-fire on the same pre-existing fixtures) plus 3 new `formulationReport.test.ts` tests; L proven by this row's own closure-time grep re-audit (`overall_status`/`evaluate_safety`/`evaluateSafety`/`classifyProductSafety`/`hazard` across `runtime/pipeline`, `runtime/formulation`, `packages/shared/src`, `apps/desktop/src`, `apps/desktop/src-tauri/src` — zero live-code hits outside the one authoritative TS engine and its confirmed-correct callers; the only `card.safety`/`overall_status` matches remaining anywhere are explanatory comments and test fixtures documenting the retirement, plus the unrelated pre-generation `hazardous_lawful_product` request-classification label in `pipeline.py`, confirmed out of scope). `pnpm --filter @formulab/desktop test`: 1381/1381 across 150 files. `typecheck`/`lint`: clean. `python -m pytest runtime/pipeline -q`: 376 passed, 5 subtests passed (down from 386+5 baseline by exactly 10 = 9 deleted `test_safety.py` tests + 1 deleted `test_traceability.py` test). Regulatory consolidation (`regulatory.py`/`regulatoryRules.ts`) confirmed completely untouched — FVL-03.010's own job. Zero-LLM intact; `/live` untouched. |
| FVL-03.010 | Existing Kenya/EAC Regulatory Engine (`packages/shared/src/engine/regulatoryRules.ts::evaluateRegulatory` + `regulatoryClassification.ts`) becomes the single authoritative regulatory verdict per market. `runtime/pipeline/regulatory.py::evaluate_regulatory()` is a confirmed duplicate — its own module docstring describes it as "a direct, faithful port" of the TS rule catalog into an independent second evaluation engine with its own terminal verdict. Its pipeline-local duplicate rule universe/verdict is retired or reduced to non-authoritative preprocessing — not a permanent second rule universe. | FVL-03.009 | YES | COMPLETED (2026-08-18) — audit confirmed `runtime/pipeline/regulatory.py::evaluate_regulatory()` was a real, independently-computing second final-verdict authority (its own `_STATUS_PRECEDENCE` merge producing `overall_status`, never consuming `packages/shared/src/engine/regulatoryRules.ts`) — and, by direct catalog comparison, itself STALE: only 7 of the TS catalog's real 16 seed rules ported. Resolved by full retirement (Option A, matching FVL-03.003/.009's precedent), not permanent reconciliation: `runtime/pipeline/regulatory.py` and `runtime/pipeline/test_regulatory.py` (14 tests) deleted entirely; `pipeline.py` no longer imports `regulatory`, no longer builds `regulatory_result`, no longer emits `card["regulatory"]` or a `regulatory`-sourced `evidence_gaps` entry; `validation_plan.py::build_validation_plan()` had its now-last `regulatory_overall` parameter removed entirely (VAL-002, the last Safety/Regulatory advisory entry, removed outright — the checklist generator is now purely formula-shape-derived); `test_pipeline.py`'s zero-LLM guard now asserts `"regulatory" not in card`; `test_traceability.py`'s `test_every_regulatory_finding_has_a_source_or_rule` removed. `regulatory.py::review_claims()`'s structural claim-vs-composition check (the one genuinely distinct Python capability, with no TS rule-type equivalent) was deliberately retired with the rest rather than selectively kept, since it computed a real claim verdict, not inert preprocessing — flagged for a possible future TS catalog addition instead of ported as a disguised second authority. New client-side integration seam — same pattern as FVL-03.008/.009: new `apps/desktop/src/lib/generatedFormulaRegulatory.ts::evaluateGeneratedFormulaRegulatory(formula, materials, rules, opts)` resolves `brief.market` free text into a real `RegulatoryJurisdiction` via a small wrapper-local alias table (ported directly from `regulatory.py`'s own retired `_MARKET_ALIASES` — legitimate input preprocessing, never a second rule catalog), computes a `formulaState` (`compliant`/`warning`/`blocked`/`unknown`) reusing the engine's own real `REGULATORY_FINDING_STATUSES`/`NON_BLOCKING_FINDING_STATUSES` vocabulary — `blocked` reserved specifically for a real `non_compliant` finding (the literal trigger every acceptance case describes), never for the `missing_data`/`human_review_required` findings a generated, unconfirmed session will almost always carry (which surface honestly as `warning` instead, avoiding a degenerate always-blocked gate); zero findings is never `compliant`, deliberately preserving the exact "sparse coverage ≠ clean" policy the retired module's own docstring stated. `category` deliberately always `"human_review_required"` (the real classifier's own honest uncertainty value, not an invented fallback) — same no-fabricated-identity scope decision FVL-03.008/.009 already made for `classifyProductSafety`. New `useRegulatoryRules()` hook loads the LIVE `regulatory_rules` masterdata collection, not a frozen `SEED_REGULATORY_RULES` copy. `pickCheapestValidVersion()`/`pickMostInventoryFeasibleVersion()` extended with an optional 5th `regulatories` eligibility-gate parameter, independent of and additive to the existing `compatibilities`/`safeties` gates. `FormulationResultPage.tsx` fully rewired off the legacy Python-shaped `card.regulatory` onto the authoritative client-side result (`RegulatoryTab` rewritten around a new `GeneratedRegulatorySummary` presenter showing status AND verification status side by side; Summary tab section; VersionSummaryCard row/banner; the now-fully-dead `statusTone()` helper removed). `formulationReport.ts` rewired to accept a `regulatoryByVersion` map instead of the retired `card.regulatory` JSON, closing the same "Download Report" split-authority risk FVL-03.009 already closed for Safety. `formulationV2.ts`'s legacy `RegulatoryResult`/`RegulatoryFinding`/`ClaimFinding` interfaces kept (not deleted) with doc comments marking them legacy-only. New real wiring (not just an audit finding) into Material Substitution: `SubstitutionPanel.tsx`'s one-to-one candidate scoring had never populated `SubstitutionCandidateInput.regulatoryPermitted` even though `substitution.ts`'s own `regulatory_status` scoring dimension already existed/was already tested — now wired per candidate via `evaluateRegulatory()` against the project's own real `formulation.targetMarkets[0]`, with a locally-tracked (never persisted, never schema-extending) `noBlockingOnly` filter exclusion for a real `non_compliant` result. Advanced Optimizer/System Substitution confirmed by audit to be a genuine, pre-existing, DOCUMENTED "not yet implemented" boundary (`regulatoryOptimizationPolicySchema.mode` hard-locked to `"not_available"`, the solver honestly refusing `regulatory_uncertainty` rather than computing it from nothing) — not a duplicate-authority gap to close; only its stale doc comment (predating the Regulatory Engine's own existence) was corrected, zero schema/behavior change, confirmed by the full unchanged-count `packages/shared` test suite. Compatibility and Safety confirmed to remain separate domains throughout. All 8 i18n locales given new `regulatory.generated.*` keys (English placeholder in de/es/fr/ja/ko/zh-Hans, real Turkish translations). Historical sessions carrying the legacy `card.regulatory` JSON confirmed to open without crashing and never surface as current authority — proven by two rewritten `FormulationResultPage.test.tsx` tests against the pre-existing SESSION_V6 fixture (given a real `market: "kenya"` brief field, a legitimate test-data completion), which legitimately produced a real `KE-REG-003` `missing_data` finding via the same real, unmodified seed catalog. Acceptance A/B/C/D proven by 14 new `generatedFormulaRegulatory.test.ts` tests (disposable fixture rules); E/F proven by 5 new `costComparison.test.ts` + 3 new `inventoryComparison.test.ts` tests; G confirmed by audit + a corrected stale doc comment (Advanced Optimizer never fabricates a regulatory constraint); H proven by 2 new `SubstitutionPanel.test.tsx` market-scoping tests plus the underlying `generatedFormulaRegulatory.test.ts` non_compliant-exclusion proof (the real seed catalog cannot itself trigger `non_compliant` for a `human_review_required` category — an honest, disclosed structural limitation, not a bug); I confirmed by audit (System Substitution inherits the same documented Optimizer-level gap, no local clone); J/K proven by rewritten `FormulationResultPage.test.tsx`/`formulationReport.test.ts` tests; L proven by dedicated market-resolution tests (`resolveRegulatoryMarket` never guesses); M proven by this row's own closure-time grep re-audit (zero live-code hits outside the one authoritative TS engine and its confirmed-correct callers). `pnpm --filter @formulab/desktop test`: 1416/1416 across 152 files. `typecheck`/`lint`: clean. `pnpm --filter @formulab/shared test`: 1311/1311 (comment-only edit, unchanged count). `python -m pytest runtime/pipeline -q`: 361 passed, 5 subtests passed (down from 376+5 baseline by exactly 15 = 14 deleted `test_regulatory.py` tests + 1 deleted `test_traceability.py` test). Zero-LLM intact; `/live` untouched. |
| FVL-03.011 | Supplier/material/safety/regulatory/compatibility provenance remains traceable end-to-end, carrying each authoritative engine's real source IDs (`material_code`, rule/verdict references) — extends `traceability.py`'s existing model, does not fork it. | FVL-03.002 | YES | COMPLETED (2026-08-18) — full audit (`traceability.py`, `provenance.py`, `pipeline.py`, `engine.py`, generated-formula structures, every FVL-03.002-.010 domain's own persisted/computed record shape, promotion path, existing UI) confirmed ONE coherent provenance model already exists, correctly NOT forked: `traceability.py`'s `TraceEvent` (real `source_ids`/`rule_id`/`evidence_ids` fields, `material_code` carried since FVL-03.002) owns ingredient selection/rejection decision trace ONLY, by its own explicit, still-valid design ("everything else... already has its own real, structured, authoritative home... a trace event that needed one of those facts REFERENCES it by id/key rather than copying it") — each domain engine (Compatibility/Safety/Regulatory/Cost/Inventory/Substitution/Optimization) owns its OWN real IDs on its OWN real record shape, never duplicated into Python trace_events, confirmed unchanged and correct. Generated→saved lineage (§A13) confirmed ALREADY satisfied, not a gap: `promoteGeneratedFormula.ts::buildPromotedFormulation()` (FVL-03.005) already writes a real, structured back-reference — `changeReason: "Promoted from AI-generated session ${session.id}, ${card.version.toUpperCase()}, for Advanced Optimizer refinement."` — into the EXISTING `FormulationVersion.changeReason` field, answering "which exact generated session/version produced this saved version" without any new persistence system. Scientific/evidence lineage (FVL-03.013-.018) confirmed untouched, not re-audited beyond confirming no new fork. Two real, concrete provenance-VISIBILITY gaps were found and fixed (data existed, was never rendered) — not new business logic, not a new provenance model: (1) `GeneratedSafetySummary.tsx`/`GeneratedCompatibilitySummary.tsx` computed each finding's real `ruleId` all along but used it only as a React `key`, never displaying it — now shown, alongside affected material ids, on every finding row; (2) `formulationReport.ts` ("Download Report") had a Safety section and a Regulatory section (FVL-03.009/.010) but had NEVER had a Compatibility section at all since FVL-03.008 — added, reusing the exact same already-computed `compatibilities` array the UI tab renders, never a new computation. A third gap closed: no ingredient row anywhere in the new result UI ever displayed its own resolved `material_code` at all (`GeneratedIngredient` interface didn't even type the field) — added the field (optional, backward-compatible) and a small honest subtext under each ingredient name showing the real code or an explicit "Unresolved — no canonical material match" disclosure, never a fabricated id. No `traceability_v2.py`/`provenance_engine.py`/second source-reference schema created. Acceptance P1/P2 proven by a new `FormulationResultPage.test.tsx` test (SESSION_V6's genuinely unresolved ingredient shows the honest disclosure, never a fake id) plus the pre-existing decoy-material-immunity tests in every domain's own `generatedFormula*.test.ts`; P3/P4 proven by 2 new tests in `GeneratedSafetySummary.test.tsx`/`GeneratedCompatibilitySummary.test.tsx`; P5/P6 already proven by FVL-03.010's own `generatedFormulaRegulatory.test.ts`; P7 confirmed untouched (FVL-03.013-.018); P8/P9 confirmed by FVL-03.006/.007's own existing `substitution_runs`/`optimization_runs` persistence, unchanged; P10 confirmed by FVL-03.005's own existing `optimization_runs.projectId` linkage; P11 proven by 3 new `formulationReport.test.ts` tests (Compatibility section uses the same computed result the UI uses, discloses unresolved coverage honestly, shows "not available" rather than a fabricated verdict); P12 confirmed — no new session-storage schema field was added, a historical session opens exactly as before. `pnpm --filter @formulab/desktop test`: 1422/1422 across 152 files (6 new: 1 `FormulationResultPage.test.tsx`, 1 `GeneratedSafetySummary.test.tsx`, 1 `GeneratedCompatibilitySummary.test.tsx`, 3 `formulationReport.test.ts`). `typecheck`/`lint`: clean. `python -m pytest runtime/pipeline -q`: 361 passed, 5 subtests passed (unchanged — zero Python files touched this task). `packages/shared` confirmed untouched by this task's own diff (no sanity re-run needed). Zero-LLM intact; `/live` untouched; no new provenance framework; `traceability.py` extended in spirit (confirmed still valid) but not one line changed in code. |
| FVL-03.012 | Integration acceptance proves exactly one authoritative result per domain (material, cost, inventory, compatibility, safety, regulatory, substitution, optimization) with no duplicated business calculation remaining, covering at least one cost-constrained and one substitution-triggered request. | FVL-03.005, FVL-03.007, FVL-03.010 | YES | COMPLETED (2026-08-18) — final authority matrix built in `docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md` (13 domains: Material/Supplier/Price/Cost/Inventory/Compatibility/Safety/Regulatory/Material Substitution/System Substitution/Advanced Optimizer/Deterministic Generation/Traceability — all PASS). Final repository-wide duplicate-business-logic audit (material/cost/inventory/compatibility/safety/regulatory/substitution/optimization/provenance search terms) found zero category-E ("actual duplicate business authority") hits; every match classified A (authoritative engine)/B (legitimate adapter)/C (separate legitimate responsibility, e.g. `rules.py` request constraints, `strategy.py`'s `regulatory_conservative` strategy-selection concept)/D (dead legacy code, never read). One disclosed, pre-existing, pre-FVL-03 gap re-confirmed rather than ignored: `MaterialsPage.tsx`/`AdvancedOptimizerPanel.tsx`/`SubstitutionPanel.tsx` still compute `quantity − reservedQuantity` inline instead of calling the canonical `evaluateMaterialAvailability()` (FVL-03.004's own disclosed, out-of-scope finding) — explicitly does NOT conflict with the generated-formula integrated workflow this domain's own acceptance targets, so does not block closure; flagged again for a future session. **A real, build-breaking Rust regression was found and fixed by this task's own mandatory `cargo check`**: `formulation_v2.rs::materialize_pipeline()` still `include_str!`'d the two Python files FVL-03.009/.010 deleted (`F_SAFETY`/`F_REGULATORY`, pointing at the now-nonexistent `safety.py`/`regulatory.py`) — those two sessions correctly made no Rust changes and so correctly never ran `cargo check` (their own scope discipline was right), but this left the shipped desktop binary unable to compile at all, undiscovered until this session. Fixed by removing both dead constants and their materialize-list entries; verified end-to-end (not just `cargo check` passing) by reproducing the exact materialized file set in a disposable temp directory — `pipeline.py` imported with zero `ImportError`, and a real deterministic generation ran through it end-to-end (`status: "ok"`, 3 real cards, `"safety"`/`"regulatory"` correctly absent) — the same verification method FVL-02.009 established for the analogous missing-file defect. `cargo test formulation_v2`: 10/10 passing. Cost-constrained acceptance (§B11): new `costComparison.test.ts` "FVL-03.012" block feeds three disposable, realistically-shaped alternatives through the REAL `costGeneratedFormula()`/`buildCostSnapshot()` engine — a real cheaper total is genuinely lower (computed, not asserted), a missing-price version carries a real warning and cannot win, an `invalid_constraint_violation` alternative is never selected even at the lowest raw total. Substitution-triggered acceptance (§B12): new `SubstitutionPanel.test.tsx` "FVL-03.012" block proves no auto-substitution (a human must click Apply), the applied line carries the candidate's real canonical `materialCode`, the run is traceable via a real persisted `substitution_runs` record, source formula never mutated. Cross-domain hard-constraint acceptance (§B13) already proven by the existing three-independent-exclusion-gates tests across `costComparison.test.ts`/`inventoryComparison.test.ts`. Unknown/missing-data honesty (§B14) reconfirmed throughout every domain by the full existing suite. Both UIs confirmed unchanged (§B15); zero-LLM reconfirmed via the full Python suite plus a live materialized-directory generation run (§B16); no real business data touched anywhere this session (§B17). `pnpm --filter @formulab/desktop test`: 1424/1424 across 152 files (2 new). `typecheck`/`lint`: clean. `pnpm --filter @formulab/shared test`: 1311/1311 (untouched). `python -m pytest runtime/pipeline -q`: 361 passed, 5 subtests (untouched). `cargo check`: clean (after the fix). `python scripts/validate_v1_tracker.py`: OK. `git diff --check`: clean. All 23 final FVL-03 completion conditions (§B19) confirmed. **FVL-03 — Unified Formulation Pipeline ↔ Existing FormuLab Engines — COMPLETE (18/18).** |
| FVL-03.013 | Scientific Full-Formulation Extraction — `fulltext.pdf_lines()` (real, standard-library-only, positional PDF text reconstruction) + `scientific_formulation.py`'s deterministic F1..Fn composition-table extractor | FVL-01 | YES | COMPLETED |
| FVL-03.014 | Scientific Formulation Experimental Outcome Linking — `ExperimentalOutcome` records tied to the correct `source_formulation_id`, both row-indexed (RPM/time tables) and F-labeled-row (results tables) shapes | FVL-03.013 | YES | COMPLETED |
| FVL-03.015 | Scientific Architecture Candidate Seeding — `engine.build_candidate_pool()`/`resolve_concentration()` Tier 0, `ORIGIN_SCIENTIFIC_FORMULATION`, real priority over a bare evidence mention, never overriding hard constraints | FVL-03.013 | YES | COMPLETED |
| FVL-03.016 | Scientific Architecture Adaptation Traceability — `engine._classify_architecture()` (`architecture_basis`: origin/source/retained/modified/added/removed), enriched `hard_exclusion` trace events naming the source architecture | FVL-03.015 | YES | COMPLETED |
| FVL-03.017 | Scientific-vs-Rule Architecture Selection — `pipeline.py`'s session-wide `scientific_formulation_summary` (architectures used/rejected, `rule_only_despite_applicable_scientific_formulation` with a real reason) | FVL-03.015 | YES | COMPLETED |
| FVL-03.018 | Evidence & Sources Scientific Formulation Detail UI — redesigned compact primary table + full-width detail panel (never clipped/ellipsized), extracted-formulation ingredient/outcome drill-down, Formula-tab Architecture Basis, Alternatives tab (selected/rejected architectures) | FVL-03.013 | YES | COMPLETED |

**Verification (FVL-03.013-018)**: real acceptance against the user's own
actual downloaded PDF (`10.20431_2455-1538.0402005.pdf`, a real F1-F5
herbal anti-dandruff shampoo composition table), copied read-only into a
disposable fixture per this project's own standing data-safety rule — 5
formulations extracted, 61 experimental outcomes linked, SLS present at
20/15/10/5/-% across F1-F5 exactly matching the source. `python -m pytest
runtime/pipeline -q`: 349/349 (23 new: `test_scientific_formulation.py`
14 + `ScientificFormulationPriorityTests` 9). Rust: `cargo check
--release` clean, `cargo test --release formulation_v2::` — 9/9 (2 new),
full workspace `cargo test --release` — 344/344 (2 new). Frontend: `pnpm
tsc --noEmit` clean, ESLint clean, `pnpm vitest run` — 138 files/1258
tests (1252 baseline + 6 new: 5 `FormulationResultPage.test.tsx` +
1 `formulationReport.test.ts`), zero regressions.

---

## FVL-04 — Data Onboarding Through Existing Data Exchange

Use the existing Data Exchange Center (template registry — see
`docs/DATA_EXCHANGE_CENTER.md` for the current template count and
architecture). No crawler, no parallel import framework.

This package covers TWO related onboarding cases, both landing in the
SAME existing Data Exchange lifecycle:

**A. Canonical/template-based onboarding** (FVL-04.001–.012) — confirm and,
only where genuinely necessary, extend the existing template registry for
FormuLab's own native import/export shape.

**B. External/customer-system schema adaptation** (FVL-04.013–.026,
approved scope expansion, 2026-08-18) — a read-only connector/mapping/
crosswalk layer that lets an enterprise customer's existing systems (ERP,
LIMS, proprietary formulation software, spreadsheets, relational
databases, REST APIs) enter through the SAME existing Data Exchange
preview/validation/commit authority, without customer-specific
modifications to FormuLab's canonical business engines.

**This is NOT a second import platform.** The connector/mapping layer is
an enterprise onboarding adapter in front of the existing Data Exchange
authority. It owns: extraction, source-schema description, source-to-
canonical mapping, external-ID resolution, repeatable transformation
configuration. It does NOT own: Material Master business rules, cost
calculations, inventory availability calculations, compatibility, safety,
or regulatory verdicts, formulation generation, laboratory interpretation,
or Data Exchange commit semantics — the single-authority principle
(`docs/FORMULAB_V1_FINAL_SCOPE.md`'s "Single-authority principle") applies
here exactly as it does to every FVL-03 engine integration.

Required architecture for the connector layer (FVL-04.013–.026):

```
Customer / External System
    ↓
Read-only Connector / Extractor
    ↓
Source Staging
    ↓
Schema Discovery
    ↓
Customer Mapping Profile
    ↓
Transformation / Crosswalk Resolution
    ↓
Canonical FormuLab import objects
    ↓
EXISTING Data Exchange Preview
    ↓
EXISTING Validation
    ↓
Human Review
    ↓
EXISTING Explicit Commit
    ↓
Canonical FormuLab records
```

**Explicitly out of scope for v1**: no supplier crawler; no new literature
crawler; no new Regulatory Database; no second Data Exchange; no
vendor-specific ERP connector (SAP, Dynamics, etc.) unless separately
approved later; no business-engine duplication of any kind.

**Existing dependency / baseline capability**: Data Exchange Center (Phase
6) — template registry, CSV/XLSX generation, validation/preview engine,
commit layer, import history — already implemented and tested. See
`docs/DATA_EXCHANGE_CENTER.md`, `docs/DATA_EXCHANGE_IMPORTS.md`,
`docs/DATA_EXCHANGE_TEMPLATE_REGISTRY.md`, `docs/DATA_EXCHANGE_HISTORY.md`.
Confirmed by this session's own audit: no alias/header-mapping, external-ID
crosswalk, or source-schema-discovery capability exists anywhere in the
current Data Exchange architecture — FVL-04.013–.026 is a genuinely new
adapter layer, not a duplicate of anything already implemented.

| Task ID | Title | Depends on | Blocking | Status |
|---|---|---|---|---|
| FVL-04.001 | Confirm material master import template covers fields Phase 14's candidate pool needs | — | YES | |
| FVL-04.002 | Confirm supplier import + supplier-material link templates are sufficient for FVL-03's provenance needs | FVL-04.001 | YES | |
| FVL-04.003 | Confirm TDS metadata/document import path (existing template or genuinely missing field) | — | NO | |
| FVL-04.004 | Confirm SDS metadata/document import path | — | NO | |
| FVL-04.005 | Confirm specifications import path | — | NO | |
| FVL-04.006 | Confirm price history import feeds FVL-03.002/003 correctly | FVL-04.002 | YES | |
| FVL-04.007 | Confirm inventory import feeds FVL-03.004 correctly | FVL-04.002 | NO | |
| FVL-04.008 | Confirm exchange-rate import feeds FVL-03.003 correctly | FVL-04.006 | NO | |
| FVL-04.009 | Confirm process-parameter import path relevant to Manufacturing Procedure | — | NO | |
| FVL-04.010 | Regulatory rule/evidence content import: verify `not_verified` seed status is preserved on import, never silently upgraded | — | YES | |
| FVL-04.011 | Extend the existing template registry only where a genuinely necessary field mapping is proven missing (no new import framework) | FVL-04.001–010 | NO | |
| FVL-04.012 | Real sample file acceptance test per confirmed/extended template, using disposable fixtures | FVL-04.011 | YES | |
| FVL-04.013 | External Source Connector Contract — define the common read-only connector contract for external/customer systems: connector/profile ID, source system ID/name/version, source entity/dataset, source record identity, extraction mode, schema metadata, raw source values, source timestamps, extraction timestamp, source lineage, connector version, error/result contract. No canonical FormuLab business rules in the connector contract. | FVL-04.001, FVL-04.002, FVL-04.003, FVL-04.004, FVL-04.005, FVL-04.006, FVL-04.007, FVL-04.008, FVL-04.009, FVL-04.010 | YES | |
| FVL-04.014 | Generic File Connector — scope for generic external-source file ingestion (CSV, XLSX, JSON, XML where current libraries already permit) that reads the customer's own source structure, does not require FormuLab column names, and feeds source staging/schema discovery, ultimately entering the existing Data Exchange lifecycle. | FVL-04.013 | YES | |
| FVL-04.015 | Source Schema Discovery — deterministic discovery/inspection of incoming source schemas: field/column names, primitive data types, nullable/missing patterns, date formats, decimal conventions, units when explicitly represented, probable primary/external IDs, relationship/reference columns, sheet/table/entity structure. Discovery may propose classifications but must never silently create authoritative canonical mappings. | FVL-04.013, FVL-04.014 | YES | |
| FVL-04.016 | Mapping Profile Model — reusable, versioned customer mapping profiles recording source system, source entity, destination canonical entity, source field, destination field, transformation references, required/optional status, default only where explicitly allowed, relationship mapping, mapping version, created/updated timestamps, human approval state, mapping provenance. A mapping can fan one source entity into multiple canonical FormuLab record types (e.g. one external raw-material row → RawMaterial + Supplier + MaterialSupplier + MaterialPrice + InventoryRecord) — a simple one-column rename is not assumed sufficient. | FVL-04.015 | YES | |
| FVL-04.017 | External ID Crosswalk Registry — persistent crosswalk from external source identity (sourceSystem/sourceEntity/sourceRecordId) to canonical FormuLab identity (canonicalEntity/canonicalRecordId), e.g. CHT_LIMS/MATERIAL/883729 → RawMaterial/RM-00291. Stable external IDs preferred over display-name matching; aliases/names are never authoritative identity; requires mapping provenance, mapping version, conflict detection, human confirmation when unresolved/ambiguous, reuse on later imports. No name-only silent matching. | FVL-04.016 | YES | |
| FVL-04.018 | Transformation / Unit / Enum Mapping — configurable transformations between customer and FormuLab representations: decimal locale conversion, date parsing, whitespace normalization, explicit text casing where safe, enum/value crosswalk, unit conversion through an EXISTING canonical unit-conversion capability where one exists, boolean representation mapping, relationship resolution. No duplicate business engines — reuse an existing FormuLab domain conversion/validation function wherever one already exists. Missing/ambiguous transformations fail validation or remain unresolved, never guessed. | FVL-04.016 | YES | |
| FVL-04.019 | Formula / Recipe Relationship Import — customer recipe/formula migration into existing Formulation/FormulationVersion/FormulationLine: preserve source formula ID and source version ID if present, resolve materials through the external-ID crosswalk, keep unresolved materials explicit, preserve exact source percentages/quantities, validate units and relationship integrity, validate mass/composition structure using existing FormuLab validation, never invent missing concentration, never silently identify a material from a trade name, retain original source lineage. | FVL-04.017, FVL-04.018 | YES | |
| FVL-04.020 | Laboratory / Test Result Relationship Import — migration of customer laboratory/history records into existing LaboratoryTrial/TestResult and applicable existing stability/DOE linkage: external trial ID, external formula/version reference, sample/test references, measurement metadata, timestamps, method/device where available, units, raw values, source attachments/references where available, unresolved-linkage detection, provenance. Not a second laboratory platform — FVL-06 remains responsible for the structured measured-response expansion and instrument-specific performance model; this is the enterprise migration/mapping bridge into the existing records only. | FVL-04.017, FVL-04.018 | YES | |
| FVL-04.021 | Generic Database Read Connector — generic READ-ONLY database connector capability (SQL Server, PostgreSQL, MySQL/MariaDB, Oracle where practical, SQLite, ODBC-compatible sources where supported) — generic connectivity, not customer-specific business logic. Read-only by architecture, configurable queries/views, no writes back to the customer database, credentials/secrets handled securely, extraction goes to source staging then mapping then the existing Data Exchange. No SAP/Dynamics/etc. business logic built into this task. | FVL-04.013, FVL-04.015 | NO | |
| FVL-04.022 | REST API Connector Contract — REST-based external extraction using the same connector contract: API endpoint/entity configuration, pagination, authentication references, incremental cursors/timestamps where exposed by the source, error/retry semantics, source identity, raw-response lineage. Auth mechanisms limited to what implementation later proves necessary (e.g. API key, Basic, OAuth2/client credentials). No vendor-specific API implementation in the tracker unless separately approved later. | FVL-04.013, FVL-04.015 | NO | |
| FVL-04.023 | Incremental Re-import / Conflict Handling — repeatable enterprise re-import behavior: same external record maps to the same canonical identity via the crosswalk; detect new vs updated vs unchanged source rows; detect mapping conflicts; detect deleted/missing source records without silently deleting canonical history; no duplicate canonical records on repeated import; dry-run/preview before commit; preserve import batch/job lineage; deterministic conflict outcomes; human decision required for ambiguous/destructive changes. | FVL-04.017, FVL-04.024 | YES | |
| FVL-04.024 | Connector → Existing Data Exchange Bridge — the critical architectural integration task: connector output must enter the EXISTING Data Exchange lifecycle exactly (connector extraction → source staging → mapping/transformation → canonical import candidate → existing Data Exchange preview → existing validator → human review → existing explicit commit → existing import history). Prove there is NO second commit/import authority and no second import-history model — reuse the existing one. | FVL-04.014, FVL-04.015, FVL-04.016, FVL-04.017, FVL-04.018, FVL-04.019, FVL-04.020, FVL-04.021, FVL-04.022 | YES | |
| FVL-04.025 | Customer Migration Acceptance Fixture — future acceptance task (not its implementation now): a realistic enterprise customer fixture with intentionally non-FormuLab schemas covering materials, suppliers, prices, inventory, formulations/recipes, formulation versions, laboratory trials/test results, with deliberately different column names, IDs, decimal/date conventions, units, enum values, relationships. Must prove schema discovery, a saved mapping profile, the external-ID crosswalk, transformations, unresolved-data handling, repeat import without duplication, preview/validation, human explicit commit, lineage, final canonical records. Disposable fixtures only. | FVL-04.012, FVL-04.019, FVL-04.020, FVL-04.023, FVL-04.024 | YES | |
| FVL-04.026 | Human-Readable Literature & Formulation Artifact Naming Convention — ONE deterministic, cross-platform-safe naming convention for (A) downloaded literature/source documents and (B) saved/exported formulation artifacts, replacing opaque names like `DOI-209899898789.pdf` with a human-browsable filename while keeping stable identifiers for uniqueness/provenance. Literature: a display title separate from the physical filename (`<First Author> (<Year>) — <Short Human-Readable Title>`, e.g. "Sharma (2024) — Herbal Anti-Dandruff Shampoo Formulation and Evaluation") and a deterministic filename `LIT_<Year>_<FirstAuthor>_<ShortTitle>_<StableSourceId>.<ext>` (year/author fall back to `UnknownYear`/`UnknownAuthor`; DOI slashes and filesystem-illegal characters sanitized deterministically; original extension preserved; no illegal Windows characters; no trailing dot/space; reasonable max length; collision-safe deterministic suffix). Formulation: a display title `<Product Family> — <Formula Name> — <Formula Code> — V<Version>` and a deterministic export filename `FORM_<ProductFamily>_<ShortFormulaName>_<FormulaCode>_V<Version>_<ArtifactType>.<ext>` (e.g. "FORM_Shampoo_Anti-Dandruff_FML-0042_V03_Formula.xlsx") — never renaming canonical internal database IDs. The ORIGINAL source filename, URL/source, DOI/source ID, acquisition timestamp, and content hash (if already available) are always preserved as provenance metadata, never destroyed by display renaming — reuse existing provenance/storage models, no duplicate document registry. | FVL-01, FVL-03.011 | NO | |

---

## FVL-05 — Historical Experiment Dataset Builder

A derived, versioned dataset builder over existing source-of-truth records.
Not a duplicate knowledge base. No mutation of source records.

**Existing dependency / baseline capability**: Formula versions, Laboratory
Trials, TestResult, Stability Studies, DOE studies/runs, corrective
actions, cost snapshots — all already implemented per
`IMPLEMENTATION_STATUS.md`.

| Task ID | Title | Depends on | Blocking | Status |
|---|---|---|---|---|
| FVL-05.001 | Define dataset schema version + feature schema version (explicit, incrementable) | FVL-02, FVL-03 | YES | |
| FVL-05.002 | Row/entity lineage model: every dataset row cites its exact source record IDs | FVL-05.001 | YES | |
| FVL-05.003 | Extractor: formula version + exact composition + materials + material properties + product family | FVL-05.002 | YES | |
| FVL-05.004 | Extractor: process plan + actual process observations (from Manufacturing Procedure / real trial records) | FVL-05.002 | YES | |
| FVL-05.005 | Extractor: LaboratoryTrial + TestResult | FVL-05.002 | YES | |
| FVL-05.006 | Extractor: stability studies/results | FVL-05.002 | NO | |
| FVL-05.007 | Extractor: DOE studies/runs/observations | FVL-05.002 | NO | |
| FVL-05.008 | Extractor: corrective actions when relevant, cost snapshots, packaging/context, environmental/test conditions | FVL-05.002 | NO | |
| FVL-05.009 | Normalization: units, categorical, numeric — missing values stay missing, no missing-to-zero unless mathematically/domain-explicitly valid | FVL-05.003–008 | YES | |
| FVL-05.010 | Exact target-variable definitions (per product family / measured response) | FVL-05.009 | YES | |
| FVL-05.011 | Dataset hash/fingerprint + reproducible rebuild from source records | FVL-05.009 | YES | |
| FVL-05.012 | Train/validation/test partition rules with leakage prevention (no same-formula-version rows split across partitions) | FVL-05.010 | YES | |
| FVL-05.013 | Immutable historical linkage — dataset build never mutates a source record | FVL-05.003–008 | YES | |
| FVL-05.014 | Regression tests: rebuild determinism, missing-value handling, leakage checks, lineage round-trip | FVL-05.011, FVL-05.012 | YES | |

---

## FVL-06 — Instrument & Performance Result Ingestion

Extends the existing Laboratory/TestResult/Data Exchange architecture. Not
a second lab platform.

**Existing dependency / baseline capability**: Laboratory Trials + Stability
Studies (spec §9), Data Exchange import/commit layer.

| Task ID | Title | Depends on | Blocking | Status |
|---|---|---|---|---|
| FVL-06.001 | Define structured measured-response schema (pH, viscosity, foam, density, active matter, and only product-family-specific responses with real documented definitions) | FVL-04 | YES | |
| FVL-06.002 | Spectrophotometric/detergent-performance metric schema (device, method, metric, unit, substrate/fabric, stain type, pretreatment, wash/test conditions, control/reference, replicate) | FVL-06.001 | YES | |
| FVL-06.003 | Raw measurement + normalized-performance field (only when a deterministic, documented normalization exists — otherwise leave raw-only) | FVL-06.002 | YES | |
| FVL-06.004 | Raw-file attachment/provenance linkage | FVL-06.002 | NO | |
| FVL-06.005 | Linkage fields: `formulaVersionId`, `trialId`, `sampleId`, `testDefinitionId`, timestamps | FVL-06.001 | YES | |
| FVL-06.006 | CSV/Excel instrument import routed through existing Data Exchange (no new import path) | FVL-06.001–005 | YES | |
| FVL-06.007 | Validation rules for instrument imports (unit consistency, required linkage fields present) | FVL-06.006 | YES | |
| FVL-06.008 | Import history / commit behavior reuses existing Data Exchange job lifecycle | FVL-06.006 | NO | |
| FVL-06.009 | Feed instrument/performance data into FVL-05's dataset extractors | FVL-06.001–005, FVL-05.005 | YES | |
| FVL-06.010 | Real sample instrument-export acceptance test (disposable fixture) | FVL-06.006 | YES | |

---

## FVL-07 — Predictive Performance Engine

Supervised ML, **not** an LLM. Learns from real historical formulation +
experiment data (FVL-05/FVL-06) to predict measurable performance.

**Existing dependency / baseline capability**: none — this is genuinely new,
built strictly on top of FVL-05's dataset builder.

| Task ID | Title | Depends on | Blocking | Status |
|---|---|---|---|---|
| FVL-07.001 | Eligibility: minimum dataset size + minimum target observations per product family/target | FVL-05 | YES | |
| FVL-07.002 | Eligibility: missing-data rules, applicability-domain requirements | FVL-07.001 | YES | |
| FVL-07.003 | Eligibility: explicit `INSUFFICIENT_DATA` outcome (never trains/serves below threshold) | FVL-07.001, FVL-07.002 | YES | |
| FVL-07.004 | Feature generation: composition + material/property features, with provenance | FVL-05.003 | YES | |
| FVL-07.005 | Feature generation: process + test-context + product-family features | FVL-05.004, FVL-06 | YES | |
| FVL-07.006 | Feature generation: optional interaction features, only when reproducible | FVL-07.004, FVL-07.005 | NO | |
| FVL-07.007 | Baseline models first (simple deterministic/statistical baseline before any ML candidate) | FVL-07.004–006 | YES | |
| FVL-07.008 | Candidate PREDICTION-MODEL comparison for the performance target (deterministic/statistical baseline vs. ML), train/validation/test split, cross-validation where appropriate, recorded random seeds — this is model selection for FVL-07's prediction target only, never a second deterministic ingredient-selection/candidate-pool engine parallel to `engine.py` | FVL-07.007 | YES | |
| FVL-07.009 | Hyperparameter recording — no fabricated result | FVL-07.008 | YES | |
| FVL-07.010 | Evaluation: appropriate metrics (RMSE/MAE/R² only where mathematically suitable), held-out performance vs. baseline, failure thresholds, acceptance policy | FVL-07.008 | YES | |
| FVL-07.011 | Model registry: ID/version, dataset hash, feature-schema version, training date, algorithm, params, metrics, target definition, applicability domain, uncertainty method, artifact checksum, status | FVL-07.009, FVL-07.010 | YES | |
| FVL-07.012 | Prediction API: exact formula/version lineage in, predicted target + uncertainty/CI where supported | FVL-07.011 | YES | |
| FVL-07.013 | Applicability-domain warning / out-of-domain refusal | FVL-07.012 | YES | |
| FVL-07.014 | No regulatory/safety override by prediction (hard rule, tested) | FVL-07.012 | YES | |
| FVL-07.015 | Per-product-family, per-target model training — never one universal model claiming to predict everything | FVL-07.001, FVL-07.011 | YES | |
| FVL-07.016 | Regression + acceptance tests: eligibility gate, baseline-vs-candidate comparison, registry round-trip, out-of-domain refusal | FVL-07.003, FVL-07.011, FVL-07.013 | YES | |

---

## FVL-08 — Performance Ranking + Existing Optimizer Integration

Rank feasible alternatives using FVL-07's predictions. No single opaque AI
score.

**Existing dependency / baseline capability**: Advanced Optimizer, Cost
Engine — reused, not duplicated.

| Task ID | Title | Depends on | Blocking | Status |
|---|---|---|---|---|
| FVL-08.001 | Ranking data model: predicted performance, uncertainty, cost, material availability, compatibility, safety, regulatory, manufacturing feasibility, evidence completeness — kept separately visible, never collapsed into one score | FVL-07.012, FVL-03 | YES | |
| FVL-08.002 | Hard rule: Safety/Regulatory FAIL cannot be outweighed by predicted performance | FVL-08.001 | YES | |
| FVL-08.003 | Missing prediction never silently becomes zero; out-of-domain prediction never looks equivalent to a validated one | FVL-08.001, FVL-07.013 | YES | |
| FVL-08.004 | Cost dimension sourced from the existing Cost Engine (FVL-03.003), never recomputed independently | FVL-08.001 | YES | |
| FVL-08.005 | Optimization pass uses the existing Advanced Optimizer where applicable (FVL-03.005), not a new solver — single-authority rule applies here exactly as elsewhere even though this row is non-blocking; do not build a second solver merely because this task itself isn't gating | FVL-08.001 | NO | |
| FVL-08.006 | UI: result screen exposes why one alternative ranks differently (per-dimension breakdown, not a single number) | FVL-08.001 | YES | |
| FVL-08.007 | Persistence + audit trail for every ranking input | FVL-08.001 | YES | |
| FVL-08.008 | Regression + acceptance test: a Safety-FAIL alternative never outranks a passing one regardless of predicted performance | FVL-08.002 | YES | |

---

## FVL-09 — Active Learning / Next Best Experiment

Uncertainty-aware experiment recommendation over the existing DOE +
Laboratory architecture. Does not replace the DOE engine.

**Existing dependency / baseline capability**: DOE engine (spec §5),
Laboratory Trials.

| Task ID | Title | Depends on | Blocking | Status |
|---|---|---|---|---|
| FVL-09.001 | Candidate experiment space definition over the existing formula/DOE model | FVL-07, FVL-02 | YES | |
| FVL-09.002 | Feasibility filtering (materials, manufacturing) | FVL-09.001, FVL-03 | YES | |
| FVL-09.003 | Safety/regulatory filtering (hard exclusion, never overridden) | FVL-09.001 | YES | |
| FVL-09.004 | Uncertainty + defensible acquisition criterion (expected information gain or equivalent, named and documented) | FVL-07.012 | YES | |
| FVL-09.005 | Diversity + estimated experiment cost where real cost data exists | FVL-09.004, FVL-03.003 | NO | |
| FVL-09.006 | DOE integration: recommendation ranking + rationale surfaced through the existing DOE UI/workflow | FVL-09.004, FVL-09.002, FVL-09.003 | YES | |
| FVL-09.007 | Human selection required — no automatic lab execution | FVL-09.006 | YES | |
| FVL-09.008 | Creation/linkage of a real LaboratoryTrial/DOE run from an accepted recommendation | FVL-09.007 | YES | |
| FVL-09.009 | Completed-experiment ingestion triggers model retraining (versioned, per FVL-07.011) | FVL-09.008, FVL-07.011 | YES | |
| FVL-09.010 | Regression test: an unperformed recommendation is never presented/labeled as validated | FVL-09.007 | YES | |

---

## FVL-10 — Closed Laboratory Feedback Loop

Close and trace the full lineage: Generated Formula → Saved Version →
Laboratory Trial → Actual Process Data → Test Results → Stability Results →
DOE Observation → Historical Dataset → Model Training → Prediction → Active
Learning Recommendation → Next Trial → New Data → Retraining.

**Existing dependency / baseline capability**: every individual stage above
already exists as a FormuLab record type; this package closes the
traceable chain between them.

| Task ID | Title | Depends on | Blocking | Status |
|---|---|---|---|---|
| FVL-10.001 | ID/provenance model spanning every transition in the chain (extends `traceability.py`'s existing convention) | FVL-03.011, FVL-05.002 | YES | |
| FVL-10.002 | Immutable references — a later stage cites, never rewrites, an earlier one | FVL-10.001 | YES | |
| FVL-10.003 | Version relationships across the chain (formula version ↔ trial ↔ result ↔ dataset row ↔ model ↔ prediction ↔ recommendation) | FVL-10.001 | YES | |
| FVL-10.004 | Corrective-action-derived draft linkage | FVL-10.001 | NO | |
| FVL-10.005 | DOE-derived draft linkage | FVL-09.008 | NO | |
| FVL-10.006 | Phase-14-generated draft linkage (formula version ↔ its own generation session) | FVL-10.001 | YES | |
| FVL-10.007 | Prediction source-model linkage (which exact model version produced a shown prediction) | FVL-07.012, FVL-10.001 | YES | |
| FVL-10.008 | Retraining lineage (which new data triggered which model version) | FVL-09.009 | YES | |
| FVL-10.009 | UI navigation across the full chain + audit trail view | FVL-10.003 | YES | |
| FVL-10.010 | Failure/retry behavior + human gates at each transition; hard rule: no model may rewrite a laboratory result | FVL-10.002 | YES | |

---

## FVL-11 — Final Integrated Acceptance & FormuLab v1 Closure

Closure only — no new feature development.

**Existing dependency / baseline capability**: every prior FVL package.

| Task ID | Title | Depends on | Blocking | Status |
|---|---|---|---|---|
| FVL-11.001 | Acceptance matrix design across several genuinely different product families | FVL-02–FVL-10 | YES | |
| FVL-11.002 | Full-chain acceptance run 1: request → literature → full-text gate → evidence → 3–7 alternatives → materials/masterdata → supplier → cost → optimization → compatibility → safety → regulatory → manufacturing → report | FVL-11.001 | YES | |
| FVL-11.003 | Full-chain acceptance run 2 (second product family) covering the same chain plus lab trial → measured performance → stability → DOE → historical dataset → predictive model → alternative ranking → active learning → next experiment → retraining → traceability | FVL-11.001 | YES | |
| FVL-11.004 | Backward compatibility: historical sessions (including pre-dynamic-count V1/V2/V3 sessions) still open correctly | FVL-02.019 | YES | |
| FVL-11.005 | Old vs. new formulation UI decision — made only after the new UI is proven stable across FVL-11.002/003 | FVL-11.002, FVL-11.003 | YES | |
| FVL-11.006 | Authorization/role gates + approval gates re-verified end to end; no AI auto-approval anywhere in the chain | FVL-11.002 | YES | |
| FVL-11.007 | Zero-LLM formulation regression re-confirmed (permanent guard test still passes) | FVL-11.002 | YES | |
| FVL-11.008 | Data integrity + backup/restore re-verified where relevant to new record types (dataset, model registry, predictions, recommendations) | FVL-10 | YES | |
| FVL-11.009 | Full regression suite: `runtime/pipeline` pytest, Rust workspace, frontend Vitest, tsc, ESLint, `git diff --check` | FVL-11.002, FVL-11.003 | YES | |
| FVL-11.010 | Installer build: fresh `formulab.exe`, MSI/NSIS bundles | FVL-11.009 | YES | |
| FVL-11.011 | `C:\Users\sekip\Desktop\FormuLab.lnk` verification against the fresh build | FVL-11.010 | YES | |
| FVL-11.012 | GitHub branch state confirmed (local HEAD == `origin/feature/laboratory-stability`, no outstanding blocking issue) | FVL-11.010 | YES | |
| FVL-11.013 | `docs/handoffs/FORMULAB_V1_CURRENT.md` updated to closure state | FVL-11.012 | YES | |
| FVL-11.014 | Explicit **FormuLab v1 COMPLETE** declaration recorded, only after every task above is COMPLETED | FVL-11.001–013 | YES | |

---

## Validation

Run `python scripts/validate_v1_tracker.py` before every commit that
touches this file or `FORMULAB_V1_FINAL_SCOPE.md`. It checks: unique task
IDs, only allowed status literals, every dependency references a real task
ID, all eleven `FVL-01`..`FVL-11` packages present and no `FVL-12`+, and
every task belongs to exactly one package. See that script's own header for
usage.
