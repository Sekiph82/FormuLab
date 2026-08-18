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
| FVL-03 | [#4](https://github.com/Sekiph82/FormuLab/issues/4) | 18 | 7 | 0 | 11 |
| FVL-04 | [#5](https://github.com/Sekiph82/FormuLab/issues/5) | 12 | 0 | 0 | 12 |
| FVL-05 | [#6](https://github.com/Sekiph82/FormuLab/issues/6) | 14 | 0 | 0 | 14 |
| FVL-06 | [#7](https://github.com/Sekiph82/FormuLab/issues/7) | 10 | 0 | 0 | 10 |
| FVL-07 | [#8](https://github.com/Sekiph82/FormuLab/issues/8) | 16 | 0 | 0 | 16 |
| FVL-08 | [#9](https://github.com/Sekiph82/FormuLab/issues/9) | 8 | 0 | 0 | 8 |
| FVL-09 | [#10](https://github.com/Sekiph82/FormuLab/issues/10) | 10 | 0 | 0 | 10 |
| FVL-10 | [#11](https://github.com/Sekiph82/FormuLab/issues/11) | 10 | 0 | 0 | 10 |
| FVL-11 | [#12](https://github.com/Sekiph82/FormuLab/issues/12) | 14 | 0 | 0 | 14 |
| **Total** | milestone [#1](https://github.com/Sekiph82/FormuLab/milestone/1) | **157** | **27** | **0** | **130** |

Overall: **27 / 157 tasks completed (17.2%)**. FVL-01 is the only fully
closed package (100%, 21/21). FVL-03 is 6/18 (33.3%) after the scientific
full-formulation architecture correction (FVL-03.013-018).

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
| FVL-03.004 | Inventory feasibility consumes canonical `InventoryRecord` collections and existing availability semantics directly (missing data stays missing, never assumed available) — no copied stock rules, no second availability model. | FVL-03.001 | NO | |
| FVL-03.005 | Existing Advanced Optimizer (`apps/desktop/src-tauri/src/formulation_advanced.rs` / `runtime/formulation/advanced_optimizer.py`) used as an optional post-generation refinement of a selected alternative — no new solver, and not a merge into `engine.py`'s deterministic candidate-generation logic (different responsibility, both legitimately exist). | FVL-03.003 | NO | |
| FVL-03.006 | Existing material substitution engine (`packages/shared/src/engine/substitution.ts`) used for an ingredient the candidate pool cannot resolve — no pipeline-local duplicate substitution scoring. | FVL-03.001 | NO | |
| FVL-03.007 | Existing system substitution engine (`packages/shared/src/engine/systemSubstitution.ts`, which itself routes candidates through the Advanced Optimizer rather than solving independently) used at the formula level where applicable — no parallel system-substitution logic. | FVL-03.006 | NO | |
| FVL-03.008 | Existing Compatibility Engine (`packages/shared/src/engine/compatibility.ts::evaluateCompatibility`) becomes the authoritative compatibility verdict for generated formulas. `runtime/pipeline/rules.py::validate()`/`derive_constraints()` remain in place — confirmed by the 2026-08-18 audit to implement only generation-REQUEST constraints (excluded ingredients, sulfate-free, requested pH bounds), never chemical/material compatibility logic — so they are not a competing engine. No duplicate compatibility business rules. | FVL-03.001 | YES | |
| FVL-03.009 | Existing Safety Engine (`packages/shared/src/engine/safety.ts::evaluateSafety`/`classifyProductSafety`) becomes the single authoritative final safety verdict. `runtime/pipeline/safety.py::evaluate_safety()` is a confirmed duplicate — it independently computes its own `overall_status` from its own hazard tables, never consuming the TS engine's result. Its pipeline-local duplicate final-verdict logic is retired or reduced to non-authoritative preprocessing that feeds the authoritative engine — not permanently reconciled as a second, independently-disagreeing verdict authority. | FVL-03.008 | YES | |
| FVL-03.010 | Existing Kenya/EAC Regulatory Engine (`packages/shared/src/engine/regulatoryRules.ts::evaluateRegulatory` + `regulatoryClassification.ts`) becomes the single authoritative regulatory verdict per market. `runtime/pipeline/regulatory.py::evaluate_regulatory()` is a confirmed duplicate — its own module docstring describes it as "a direct, faithful port" of the TS rule catalog into an independent second evaluation engine with its own terminal verdict. Its pipeline-local duplicate rule universe/verdict is retired or reduced to non-authoritative preprocessing — not a permanent second rule universe. | FVL-03.009 | YES | |
| FVL-03.011 | Supplier/material/safety/regulatory/compatibility provenance remains traceable end-to-end, carrying each authoritative engine's real source IDs (`material_code`, rule/verdict references) — extends `traceability.py`'s existing model, does not fork it. | FVL-03.002 | YES | |
| FVL-03.012 | Integration acceptance proves exactly one authoritative result per domain (material, cost, inventory, compatibility, safety, regulatory, substitution, optimization) with no duplicated business calculation remaining, covering at least one cost-constrained and one substitution-triggered request. | FVL-03.005, FVL-03.007, FVL-03.010 | YES | |
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

Use the existing Data Exchange Center (24-template registry). No crawler,
no parallel import framework.

**Existing dependency / baseline capability**: Data Exchange Center (Phase
6) — template registry, CSV/XLSX generation, validation/preview engine,
commit layer, import history — already implemented and tested.

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
