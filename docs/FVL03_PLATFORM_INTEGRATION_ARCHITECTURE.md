# FVL-03 — Platform Integration Architecture

Companion to `docs/FORMULAB_V1_TASK_TRACKER.md`'s FVL-03 section. Each
FVL-03 subtask that involves a real integration seam gets a section here,
appended as it closes — never rewritten retroactively (see each session's
own Desktop external log entry for the full narrative; this document is
the durable, code-referenced reference).

---

## FVL-03.001 — Material Master ↔ `engine.build_candidate_pool()` integration-seam audit

**Completed 2026-08-17.** Audit only — no cost logic, supplier wiring, or
inventory wiring implemented (that is FVL-03.002/.003/.004, deliberately
out of scope here). Every claim below is traced to a real file/function,
not inferred from schema names.

### CANONICAL SOURCE OF TRUTH

`packages/shared/src/schemas/materials.ts` defines the real Material
Master: `rawMaterialSchema` (`RawMaterial`), `supplierSchema`
(`Supplier`), `materialSupplierSchema` (`MaterialSupplier`),
`materialPriceSchema` (`MaterialPrice`, append-only price history),
`inventoryRecordSchema` (`InventoryRecord`). Identity is explicit and
deliberate: `RawMaterial.code` is "stable forever"; `displayName`,
`tradeName`, `inciName` are attributes, never identity (schema file's own
module docstring, lines 1-17).

**Storage**: `apps/desktop/src-tauri/src/masterdata.rs`. Flat, allow-
listed JSON-array files under `<project_root>/data/master/`:
`materials.json`, `suppliers.json`, `material_suppliers.json`,
`material_prices.json`, `inventory.json`, `exchange_rates.json`,
`factory_profiles.json`, `cost_snapshots.json`, `packaging_components.json`,
`packaging_boms.json`, and ~80 more collections for the rest of the
platform (`masterdata.rs`'s own top-of-file comment enumerates all of
them). `project_root` resolves via `crate::formulation_v2::
project_data_dir(app, "data")` — the SAME project root the Python
pipeline's own `data/sessions/`, `data/literature/`, `formulas/` already
live under (`formulation_v2.rs::project_root()` /
`crate::data_root::resolve_data_root()`).

Rows are keyed by `code` (`row_key()`, `masterdata.rs:471`) — an
append-only collection (`material_prices`, `cost_snapshots`,
`exchange_rates`, …) rejects re-upserting an existing code
(`collection_spec`'s own `append_only` flag), everything else is a normal
insert-or-update-by-code. Write path is write-then-rename
(`write_array`, `masterdata.rs:461`) so an interrupted write cannot
truncate the file.

**Frontend access**: `apps/desktop/src/lib/masterdata.ts` — thin Tauri
bindings (`listRecords`/`upsertRecords`/`deleteRecord`) over
`list_master_records`/`upsert_master_records`/`delete_master_record`.
`apps/desktop/src/app/routes/MaterialsPage.tsx` — the real, live
Materials screen — calls `listRecords("materials")` directly
(`MaterialsPage.tsx:104`). This is the canonical path a user's real
material library reaches.

### CURRENT PYTHON INPUT (what `build_candidate_pool()` actually receives today)

**It is NOT the canonical Material Master.** `runtime/pipeline/
materials.py` is a second, independent, much simpler material
representation:

- **Storage**: a single flat file, `<materials_dir>/materials.json`
  (`materials.py::store_path()`), shape `{schema_version, updated,
  currency, mixed_currencies, materials: [...]}` — a completely
  different file, different path, different shape from
  `data/master/materials.json`.
- **`materials_dir` resolution**: `apps/desktop/src-tauri/src/
  materials.rs::run()` sets `data_dir` = `crate::formulation_v2::
  project_data_dir(app, "data")` (`materials.rs:31`) — i.e.
  `<project_root>/data`, NOT `<project_root>/data/master`. So the file
  Python actually reads/writes is `<project_root>/data/materials.json`
  — a sibling of, and entirely unrelated to, the canonical
  `data/master/materials.json`.
- **Row shape** (`materials.py::parse_materials()`'s own output,
  confirmed by `load_materials()`/`save_materials()`): `material_id,
  name, inci, cas, price, currency, unit, supplier, stock, function,
  external_ref` — a flat, denormalized record with price/supplier/stock
  embedded directly on the material row. No `Supplier` entity, no
  `MaterialSupplier` relationship, no append-only `MaterialPrice`
  history, no `InventoryRecord`.
- **Populated by**: `import_materials` (`materials.rs`, live UI:
  `apps/desktop/src/components/settings/MaterialsCard.tsx`, mounted at
  Settings → General — confirmed reachable via `SettingsPage.tsx:151`)
  — a CSV/TSV upload the user picks, parsed by `materials.py::
  parse_materials()`'s own header-alias table (`_ALIASES`). This is a
  **second, independent, live, user-reachable material-entry path**,
  entirely disconnected from the canonical Materials screen.
- **`build_candidate_pool()` wiring**: `pipeline.py` calls
  `materials.load_materials(materials_dir).get("materials", [])` when
  `materials_dir` is provided, then passes that flat list straight into
  `engine.build_candidate_pool(brief, constraints, ranked_evidence,
  materials_list, ...)`.

**Conclusion: this IS a second material-master source of truth, live and
user-reachable today, predating this session.** It is not something
FVL-03.001 created — it is the gap FVL-03.001 exists to document and
FVL-03.002 exists to close.

### FIELD MAPPING (what `engine.build_candidate_pool()`'s §3 "Supplier materials" block actually consumes)

Source: `runtime/pipeline/engine.py`, the `# 3. Supplier materials` block
(~line 690) and `_roles_for_supplier_material()` (line 426).

| Consumed today (from the LEGACY `materials.py` row shape) | How |
|---|---|
| `inci` / `name` | Identity key: `normalize_ingredient_key(m.get("inci") or m.get("name"))` — see IDENTITY MAPPING below |
| `function` | Free-text keyword match (`_SUPPLIER_FUNCTION_KEYWORDS`) → formulation role, only when the key isn't already in `ROLE_MAP` |
| `price` | Tie-break bonus in `_selection_score()` (engine.py:993-996, `max(0.0, 10.0 - min(price, 10.0))`) — cheaper material nudges a role tie, never a real cost calculation |
| `material_id` | Survives into trace provenance as `source_ids` (engine.py, `traceability.selected_event(... source_ids=([c.supplier_material.get("material_id", "")] ...))`) — the only identifier that makes it through today |
| whole row | Stored verbatim on `IngredientCandidate.supplier_material` (engine.py:703) — available to later tiers, but only 2 of its ~11 fields (`price`, `material_id`) are ever actually read again |

**Never consumed by Python today** (real canonical `RawMaterial` fields
with no equivalent anywhere in the legacy schema, so they can never
reach `build_candidate_pool()` regardless of what a user enters):
`code` (stable identity), `recommendedMinPercent`/`recommendedMaxPercent`
(engine.py's own Tier 4 concentration resolution reads
`recommended_min_pct`/`recommended_max_pct` off `supplier_material` —
`engine.py:905-907` — a key that **never exists** on a legacy-schema row,
so Tier 4 never fires for a supplier material today, confirmed by
reading both sides), `technicalMaxPercent`, `density`, `activeMatterPercent`,
`ionicCharacter`, `hlb`, `regulatoryStatuses`, `incompatibilities`,
`substituteCodes`, `documents`, `active` (see GAPS below), `manufacturer`,
`countryOfOrigin`, `casNumbers` (plural — legacy has a single `cas`
string), `hazardClassifications`, `allergens`.

### IDENTITY MAPPING

**Mismatch, confirmed by code on both sides:**

- Canonical Material Master identity: `RawMaterial.code` — "stable
  forever" (`materials.ts`'s own docstring), the primary key every other
  canonical record (`MaterialSupplier.materialCode`, `MaterialPrice.
  materialCode`, `InventoryRecord.materialCode`, `CostLine.materialCode`)
  joins against.
- Current Python pool identity: `normalize_ingredient_key(inci or name)`
  — a normalized TEXT string derived from a free-text chemistry
  name/INCI, computed independently in Python
  (`evidence.normalize_ingredient_key`), with **no relationship to
  `code` at all**. The legacy row's own `material_id` field (derived
  from `external_ref or cas or inci or name` — `materials.py::
  material_id()`) is a DIFFERENT derived string that also has no
  relationship to canonical `code`, and isn't even what the candidate
  pool keys on — it only survives as a trailing provenance string
  (`source_ids`).

Trade name / supplier trade name / INCI / display name are correctly
treated as attributes, never identity, on the canonical TypeScript side
(`materials.ts`'s own explicit design principle) — but the Python side
has no `code` concept to compare against, so this principle simply
doesn't cross the seam today; Python's only identity notion is the
free-text chemistry-name match.

### GAPS (classified by which future FVL-03 task owns closing them)

| Gap | Owner |
|---|---|
| Python reads a second, non-canonical `data/materials.json` instead of the canonical `data/master/materials.json` | **FVL-03.002 seam issue** |
| No `code`-based identity crosses the seam — pool candidates key on normalized INCI/name text, not `RawMaterial.code` | **FVL-03.002 seam issue** |
| `Supplier`/`MaterialSupplier` records (approval status, quality status, preferred/qualified) never reach the pool — "whether supplier identity is preserved" is currently **no**, only a free-text `supplier` string survives on the raw dict, never linked to a real `Supplier.code` | **FVL-03.002 supplier/price wiring** |
| Append-only `MaterialPrice` history (with landed-cost components, exchange rate, verification state) is invisible to Python — only a single flat `price`/`currency` pair, with no `effectiveFrom`/`effectiveTo`, no landed-cost fields at all | **FVL-03.002 supplier/price wiring, FVL-03.003 cost strategy wiring** |
| `recommendedMinPercent`/`recommendedMaxPercent`/`technicalMaxPercent` never reach concentration resolution for a supplier material (Tier 4 in `resolve_concentration()` is dead code on this path today — the field name it looks for cannot exist on a legacy-schema row) | **FVL-03.002 seam issue** |
| `RawMaterial.active` is never read — an inactive/discontinued material can still be selected as a candidate today | **FVL-03.002 seam issue** |
| `InventoryRecord` (stock, reserved quantity, quarantine/release, lot/expiry) never reaches candidate feasibility | **FVL-03.004 inventory wiring** (already the tracker's own explicit assignment) |
| `packages/shared/src/engine/cost.ts::costFormula()` is never called from the formulation-generation path — pricing shown to a user via `CostingPanel.tsx`/`cost_formulation` is a SEPARATE, hand-rolled recomputation (`materials.py::cost_formula()`, kg × flat price, no landed cost, no exchange rate, no factory overhead) against the SAME legacy material list, re-matching ingredients independently rather than reading what `build_candidate_pool()` actually selected | **FVL-03.003 cost strategy wiring** |
| `MaterialsCard.tsx` (Settings → General) writes to the legacy `data/materials.json` via `import_materials`, a live, reachable, second material-entry UI, fully disconnected from the canonical `MaterialsPage.tsx` → `data/master/materials.json` path | **FVL-03.002 seam issue** (the adapter should make this screen either read/write the canonical store or be retired — a decision for FVL-03.002, not made here) |
| Incompatibilities/substitutes/regulatory-status/hazard/document fields never reach Python at all | **FVL-03.006 (substitution), FVL-03.008 (compatibility)** — already the tracker's own explicit assignments; not addressed here |

### REQUIRED ADAPTER/SEAM (for FVL-03.002 — not implemented this session)

The smallest correct boundary, given everything above:

1. **Read the canonical store, not a second one.** The adapter's real
   job is: read `data/master/materials.json` (+ `material_suppliers.json`
   + `material_prices.json` as FVL-03.002 needs them), never
   `data/materials.json`. This can be a thin Rust or Python read of the
   SAME JSON files `masterdata.rs` already owns — no new database, no
   new file format. `materials_dir` (or a renamed equivalent) should
   point at `<project_root>/data/master`, not `<project_root>/data`.
2. **Carry `code` across the seam as the real identity field**, in
   addition to (never instead of) the existing INCI/name-based matching
   `match_material()`/`normalize_ingredient_key()` already do for
   evidence-derived ingredients that have no canonical record at all.
   `IngredientCandidate`/`SolvedIngredient` need a real `material_code`
   field (distinct from the current `material_id` — that name should
   likely be retired once `code` is available, but that rename is
   FVL-03.002's own call, not made here).
3. **The adapter transforms shape, never owns business data.** It maps
   `RawMaterial`'s real fields (`recommendedMinPercent` →
   `recommended_min_pct`, `technicalMaxPercent` → `technical_max_pct`,
   `active`, `density`, etc.) onto whatever shape `build_candidate_pool()`
   needs — it must not compute a price, a landed cost, or a
   concentration range itself; those numbers already exist on the
   canonical record or (for cost) come from calling the real Cost Engine
   (see below).
4. **Do not duplicate `MaterialPrice`/`Supplier` as new Python-owned
   structures.** If a future card needs to show a price, it should carry
   enough identity (`material_code`, chosen `MaterialPrice.code`) for the
   FRONTEND to look the real record up via `masterdata.ts::listRecords`,
   not a Python-side copy of the number.

### DATA OWNERSHIP BOUNDARY

- **Material/supplier/price/inventory identity and history**: owned by
  `data/master/*.json` via `masterdata.rs`. Python (and any future
  adapter) reads it; never writes it, never recomputes a price/landed
  cost/exchange rate independently.
- **Costing arithmetic**: owned by `packages/shared/src/engine/cost.ts`
  (`costFormula`, `landedUnitCost`, `findRate`, `costSku`,
  `buildCostSnapshot`, `compareCostSnapshots`). This is real, tested
  logic (`cost.test.ts`, 673 lines) — landed cost, exchange-rate
  selection (`findRate` — nearest rate on/before `asOf`, with an
  `"identity"` no-op path for same-currency), missing-price/missing-rate
  representation (`missingReason: "no_price" | "no_exchange_rate"`,
  never a silent zero), immutable `CostSnapshot` production
  (`buildCostSnapshot`), and historical comparison (`compareCostSnapshots`).
  **The future formulation pipeline must call this engine (from the
  TypeScript/frontend side, passing it a real `materialCode`-bearing
  `FormulationLine[]`), never reimplement any of it in Python.**

  **FVL-03.003 (COMPLETED, 2026-08-18) closed this boundary for real.**
  Python cannot call `cost.ts` at all (`run_cli.py` is a one-shot
  stdin→stdout subprocess, no back-channel to the JS engine) — confirmed
  by this session's audit, which also confirmed the brief's own proposed
  "Option A" bridge is the only architecturally real one: Python generates
  cards unchanged; `apps/desktop/src/lib/generatedFormulaCost.ts::costGeneratedFormula()`
  costs each one client-side, after generation, by calling
  `buildCostSnapshot()` directly — zero business logic of its own, proven
  by test to return the identical result a direct `buildCostSnapshot()`
  call would. Wired into both UIs: `CostingPanel.tsx` (old `/live`) and
  `FormulationResultPage.tsx` (new result UI, previously three hardcoded
  "not available" placeholders). `materials.py::cost_formula()` — the
  reimplementation this principle forbade — is deleted, not merely
  bypassed; its Rust bridge (`materials.rs::cost_formulation`) and TS
  wrapper (`formulationV2.ts::costFormulation()`) are deleted too, after
  confirming (by grep, then by full regression) zero remaining callers.
- **Formulation generation itself** (role selection, concentration
  resolution, diversity, strategy): stays owned by
  `runtime/pipeline/engine.py`, unchanged by this audit.

### NEXT TASK BOUNDARY

This session (FVL-03.001) documents the seam. It does **not**:
- point `materials_dir` at the canonical store,
- add a `code`/`material_code` field to `IngredientCandidate`,
- wire `MaterialSupplier`/`MaterialPrice` into concentration or cost,
- call `costFormula()` from the generation path,
- wire `InventoryRecord` into feasibility,
- retire `materials.py::cost_formula()`/`MaterialsCard.tsx`.

All of the above are explicitly FVL-03.002 (seam + supplier/price wiring),
FVL-03.003 (cost strategy wiring), or FVL-03.004 (inventory wiring), per
the GAPS table.

---

## Architecture correction — SINGLE-AUTHORITY rule (2026-08-18)

Session scope: roadmap/documentation correction only, before FVL-03.002
implementation begins. No production code changed. Adopted the
single-authority principle now stated in
`docs/FORMULAB_V1_FINAL_SCOPE.md`'s "Single-authority principle" section:
every business domain has exactly one authoritative engine/source of
truth; a pipeline-local adapter transports and reshapes data only, it
never recomputes a business decision. This section records the code-traced
audit that principle is based on, and the resulting hardened wording in
`docs/FORMULAB_V1_TASK_TRACKER.md`'s FVL-03.002-.012 rows (and two flagged
rows further out, FVL-07.008/FVL-08.005). `FVL-03.001` stays `COMPLETED`;
`FVL-03.002` stays blank/NOT STARTED — this session does not implement it.

### Authoritative domain map (verified by code, 2026-08-18)

| Domain | Authoritative implementation | Confirmed live (called from) |
|---|---|---|
| Material / Supplier / Price history / Inventory | `packages/shared/src/schemas/materials.ts`, `apps/desktop/src-tauri/src/masterdata.rs`, `data/master/*.json` | `MaterialsPage.tsx` → `listRecords()` |
| Cost | `packages/shared/src/engine/cost.ts` (`costFormula`, `buildCostSnapshot`, `priceFor`, `landedUnitCost`, `findRate`, `costSku`) | `CostPanel.tsx` (manual formula editor) |
| Compatibility | `packages/shared/src/engine/compatibility.ts::evaluateCompatibility` | `CompatibilityPanel.tsx`, `ApprovalPanel.tsx`, `SubstitutionPanel.tsx`, `optimization.ts` (DOE scoring) |
| Safety | `packages/shared/src/engine/safety.ts::evaluateSafety`/`classifyProductSafety` | `SafetyPanel.tsx`, `ApprovalPanel.tsx`, `SubstitutionPanel.tsx`, `optimization.ts` |
| Kenya/EAC Regulatory | `packages/shared/src/engine/regulatoryRules.ts::evaluateRegulatory` + `regulatoryClassification.ts::classifyProductRegulatory` | `RegulatoryPanel.tsx`, `ApprovalPanel.tsx` |
| Advanced Optimizer (mathematical optimization of a chosen material set) | `apps/desktop/src-tauri/src/formulation_advanced.rs` → `runtime/formulation/advanced_optimizer.py` (PuLP/CBC, MILP, multi-objective) | `AdvancedOptimizerPanel.tsx` via `FormulasPage.tsx`/`OptimizationPage.tsx` |
| Simple optimizer (single-objective cost-min LP) | `apps/desktop/src-tauri/src/formulation.rs` → `runtime/formulation/formulation_core.py` | distinct command from the Advanced Optimizer; different responsibility, not a duplicate of it |
| Material substitution | `packages/shared/src/engine/substitution.ts` | `SubstitutionPanel.tsx` |
| System substitution | `packages/shared/src/engine/systemSubstitution.ts` (routes through the Advanced Optimizer, never solves independently) | `SubstitutionPanel.tsx` |
| DOE | `packages/shared/src/engine/doeDesign.ts`/`doeMath.ts`/`doeAnalysis.ts`/`doeCandidates.ts`/`doeExpression.ts`/`doeLabIntegration.ts`/`doeExports.ts` | `/doe` workspace |
| Laboratory | `packages/shared/src/engine/laboratory.ts`/`laboratoryStandards.ts`/`testResults.ts`/`testApplicability.ts` | Laboratory UI |
| Stability | `packages/shared/src/engine/stability.ts`/`stabilityExports.ts` | Stability UI |
| Data Exchange | `packages/shared/src/engine/dataExchangeRegistry.ts`/`dataExchangeCsv.ts`/`dataExchangeValidation.ts`, `apps/desktop/src/lib/dataExchangeCommit.ts` | `/data-exchange` workspace |
| Formula Generation (deterministic, zero-LLM) | `runtime/pipeline/engine.py` (`build_candidate_pool()`, `resolve_concentration()`, `build_formula_for_strategy()`) | `formulation_v2.rs` → `run_cli.py` → `pipeline.py` — the SAME backend behind both `/live` and the new request/result UI |
| Scientific literature / evidence | Phase 14 pipeline (`runtime/pipeline/evidence.py`, `literature_cache.py`, `scientific_formulation.py`, `fulltext.py`) | `pipeline.py` |
| Predictive performance | none yet — genuinely new, FVL-07 only (supervised ML, not an LLM, not a formula generator) | not built |

Terminology going forward in all NEW roadmap/architecture wording: **"Deterministic Formulation Engine"** for `runtime/pipeline/engine.py`; **"Predictive Performance Engine"** (or "Supervised ML Performance Engine") for the future FVL-07 work. Avoid calling the current generator "AI generation" in new documentation — it is zero-LLM. Historical comments/files may keep old terminology; only new wording is held to this standard.

### Duplicate-authority audit results

**Confirmed real duplicate final-verdict engines (single-authority violations, both now resolved):**

- **Safety** — ~~`runtime/pipeline/safety.py::evaluate_safety()` independently computed its own `overall_status`~~ **RESOLVED (FVL-03.009, COMPLETED 2026-08-18)**: the module (and its own hazard tables — `_SENSITIZER_CLASS_INGREDIENTS`, GHS pH boundaries, rule IDs like `SAFETY-SENS-001`) was deleted entirely; `packages/shared/src/engine/safety.ts::evaluateSafety`/`classifyProductSafety` is now the single authoritative safety verdict for every consumer, generated-formula sessions included (via `apps/desktop/src/lib/generatedFormulaSafety.ts`). See the "Safety Engine boundary" section above for the full resolution.
- **Regulatory** — ~~`runtime/pipeline/regulatory.py::evaluate_regulatory()` was, per its own module docstring, "a direct, faithful port" of `packages/shared/src/catalog/regulatoryRules.ts`'s seed rule data into a second, independent Python evaluation engine producing its own terminal `overall_status`~~ **RESOLVED (FVL-03.010, COMPLETED 2026-08-18)**: the module was deleted entirely — and was itself confirmed STALE before retirement, its own port carrying only 7 of the TS catalog's real 16 seed rules; `packages/shared/src/engine/regulatoryRules.ts::evaluateRegulatory`/`regulatoryClassification.ts` is now the single authoritative regulatory verdict for every consumer, generated-formula sessions included (via `apps/desktop/src/lib/generatedFormulaRegulatory.ts`). See the "Regulatory Engine boundary" section above for the full resolution.

**Confirmed NOT a duplicate (legitimate, no change needed):**

- **Compatibility**: `runtime/pipeline/rules.py::validate()` performs exactly one check — substring/word-boundary match of formula ingredients against a request-supplied `avoid` exclusion list. `derive_constraints()` adds brief-derived exclusions (sensitivity/anti-dandruff/child-audience → sulfate/preservative avoidance) and a target-pH hint. Neither function performs any pairwise ingredient-interaction, packaging-incompatibility, temperature-dependent, or `ph_dependent` compatibility reasoning — the entire rule-type surface `packages/shared/src/engine/compatibility.ts::evaluateCompatibility` owns. This is legitimate generation-REQUEST constraint logic, not a competing compatibility engine. FVL-03.008's wording reflects this: `rules.py` stays, the TS Compatibility Engine becomes the authoritative verdict alongside it, not "instead of" it.
- **Optimizer vs. deterministic generation**: `engine.py` (candidate generation/selection via evidence+rules heuristics) and `advanced_optimizer.py`/`formulation_core.py` (mathematical LP/MILP solve of an already-chosen material set) are confirmed different responsibilities with zero code-level overlap (`engine.py` never imports `pulp`/`PuLP`/`CBC`). FVL-03.005's existing wording ("existing optimizer, not a new solver") was already correct; hardened to also say "not a merge into `engine.py`."
- **Substitution**: both `substitution.ts` and `systemSubstitution.ts` explicitly document in their own header comments that they never re-implement compatibility/safety rules and (for system substitution) route candidate combinations through the real Advanced Optimizer rather than solving independently. No Python-side substitution duplicate exists (`grep` for substitution-scoring logic in `runtime/pipeline/*.py` found none).
- **DOE / Laboratory / Stability / Data Exchange**: all TypeScript-engine-only, no Python duplication. `runtime/pipeline/validation_plan.py` outputs plain-text recommended-check labels ("Accelerated stability", "Freeze/thaw stability") as part of a validation-plan report — this is text-recommendation output, not a competing `StabilityStudy` data model or lifecycle, so it is not classified as a duplicate authority. No DOE-related Python file exists at all.

### Legacy retirement matrix

| Component | Current role | Authoritative replacement | Retirement task | Can remain temporarily? | Deletion condition |
|---|---|---|---|---|---|
| `runtime/pipeline/materials.py` (storage/import: `load_materials`/`save_materials`/`parse_materials`) | Second, legacy material representation — still backs the Settings → General CSV-import screen (`MaterialsCard.tsx`), a deliberately separate, unrelated purpose | Canonical Material Master (`data/master/*.json` via `masterdata.rs`), read for generation via `master_materials_adapter.py` | FVL-03.002 | **CLOSED for the generation path** (FVL-03.002, COMPLETED) — this module's storage/import functions remain, permanently, for the CSV-import screen only | Generation-path usage already retired (FVL-03.002). The CSV-import screen itself is not scheduled for retirement — a separate, explicit product decision, not made by any FVL-03 session |
| `runtime/pipeline/materials.py::cost_formula()` / `render_costing_markdown()` | ~~Separate, simpler flat kg×price costing reimplementation~~ **DELETED** (FVL-03.003) | `packages/shared/src/engine/cost.ts::costFormula()`/`buildCostSnapshot()`, via `apps/desktop/src/lib/generatedFormulaCost.ts::costGeneratedFormula()` | FVL-03.003 | No — **retired**, code no longer exists | Done: `CostingPanel.tsx` redirected to the real engine first (this session), then this function and its own tests (`test_materials.py::CostingTests`) deleted once zero callers remained — confirmed by full `pytest`/`cargo check` regression |
| `apps/desktop/src-tauri/src/materials.rs::cost_formulation` (+ `materials_cli.py`'s `"cost"` action, `apps/desktop/src/lib/formulationV2.ts::costFormulation()`/`CostSheet`/`CostLine`) | ~~Backs the legacy AI-session costing view~~ **DELETED** (FVL-03.003) | `packages/shared/src/engine/cost.ts`, called from `CostingPanel.tsx`/`FormulationResultPage.tsx` via `costGeneratedFormula()` | FVL-03.003 | No — **retired**, code no longer exists | Done — `cost_formulation` removed from `materials.rs` and `lib.rs`'s command list; `materials.rs::import_materials`/`list_materials` (a SEPARATE command family, Settings → General CSV-import) deliberately untouched, still live |
| `runtime/pipeline/safety.py` | ~~Independent, competing final safety verdict (`overall_status`)~~ **DELETED** (FVL-03.009) | `packages/shared/src/engine/safety.ts::evaluateSafety`/`classifyProductSafety`, via `apps/desktop/src/lib/generatedFormulaSafety.ts::evaluateGeneratedFormulaSafety()` | FVL-03.009 | No — **retired**, code no longer exists | Done: no genuinely-useful preprocessing survived (the hazard-table lookups were themselves the competing verdict logic, not separable input prep) — the whole module and its own tests (`test_safety.py`, 9 tests) deleted; `pipeline.py`/`validation_plan.py`/`test_pipeline.py`/`test_traceability.py` updated to remove every caller/consumer of `card["safety"]`, confirmed by full `pytest` regression (376 passed, 5 subtests, down from 386+5 by exactly the 10 tests removed) |
| `runtime/pipeline/regulatory.py` | ~~Independent, self-documented "faithful port" of the TS regulatory rule catalog into a second evaluation engine~~ **DELETED** (FVL-03.010) | `packages/shared/src/engine/regulatoryRules.ts::evaluateRegulatory`/`regulatoryClassification.ts`, via `apps/desktop/src/lib/generatedFormulaRegulatory.ts::evaluateGeneratedFormulaRegulatory()` | FVL-03.010 | No — **retired**, code no longer exists | Done: the module's own port was already confirmed STALE (7 of the TS catalog's real 16 seed rules) before retirement; the one genuinely distinct capability (`review_claims()`'s structural claim-vs-composition check) computed a real claim VERDICT, not inert preprocessing, so it was retired with the rest rather than kept as a disguised second claims authority — flagged for a possible future TS-side rule-type addition instead. Whole module + its own tests (`test_regulatory.py`, 14 tests) deleted; `pipeline.py`/`validation_plan.py`/`test_pipeline.py`/`test_traceability.py` updated to remove every caller/consumer of `card["regulatory"]`, confirmed by full `pytest` regression (361 passed, 5 subtests, down from 376+5 by exactly the 15 tests removed) |
| `runtime/pipeline/rules.py::validate()`/`derive_constraints()` | Generation-request constraint enforcement (excluded ingredients, sulfate-free, pH bounds) | N/A — not a duplicate, stays as-is | N/A | Yes, permanently | Never — this is legitimate request-constraint logic, confirmed not to overlap the Compatibility Engine's rule-type surface |
| `runtime/pipeline/materials.py`'s legacy `stock` field (`_ALIASES["stock"]`, parsed at row-build time) | Parsed and stored on the legacy CSV-import row; confirmed (FVL-03.004) read by nothing else anywhere in `runtime/pipeline/*.py` — stored-but-unused dead data | Canonical `InventoryRecord` (`data/master/inventory.json` via `masterdata.rs`), consumed client-side only via `apps/desktop/src/lib/generatedFormulaInventory.ts` | N/A — not a duplicate authority (never read back for any computation), stays as-is | Yes, permanently | Never — deleting a stored-but-unused legacy field is gratuitous churn on the legacy CSV-import path, out of scope; classified here so a future session doesn't mistake it for a live second inventory source |

### Inventory feasibility boundary (FVL-03.004, COMPLETED 2026-08-18)

Same constraint as the Cost Engine boundary above, confirmed again for
inventory: Python cannot call into `packages/shared`. Canonical
`InventoryRecord` (`packages/shared/src/schemas/materials.ts:221-242` —
`materialCode`, `quantity`, `reservedQuantity`, `warehouse`, `lot`,
`expiresAt`, `coaStatus`, `quarantined`, `released`, `unit`) lives in
`data/master/inventory.json` via `masterdata.rs`'s generic
`list_master_records`/`upsert_master_records` (not append-only, no
dedicated command). No field stores a usable/available quantity — it is
always derived, and before this task three UI call sites
(`MaterialsPage.tsx`, `AdvancedOptimizerPanel.tsx`,
`SubstitutionPanel.tsx`) each re-implemented `quantity − reservedQuantity`
inline, none applying `quarantined`/`released`/`expiresAt` filtering.

**New canonical derivation** (used by new code only — the three existing
call sites are untouched, out of scope, no regression risk introduced):
`packages/shared/src/engine/inventoryAvailability.ts::evaluateMaterialAvailability()`.
A lot counts as usable iff `!quarantined && released && (!expiresAt || not
yet expired)` — the only unambiguous, schema-defined facts; `coaStatus` is
deliberately not gated on (its business meaning is undefined by the schema
and by every existing caller). Distinguishes "no record at all"
(`hasRecords: false`, genuinely unknown) from "records exist but all
blocked" (a real, computed zero — `quarantined`/`released` are known
facts, not missing data) from "usable lots in mixed units"
(`usableQuantity: undefined`, never silently summed).

**Client-side evaluation, read-only, version-level preference** — mirrors
FVL-03.003 exactly, confirmed with the user as the deliberate architecture
choice over extending `master_materials_adapter.py` to read inventory
(which would have required either duplicating the availability formula in
Python or piping in pre-computed numbers, neither with real precedent):
`apps/desktop/src/lib/generatedFormulaInventory.ts::evaluateGeneratedFormulaInventory()`
reuses `linesFromGeneratedFormula()`'s `material_code` join (never text
similarity — proven by test with a same-display-name decoy material),
computes required quantity from the SAME `batchKg` control FVL-03.003
already lifted to `FormulationResultPage.tsx`'s top level (never the
original free-text `estimatedBatchSize` brief field, which stays purely
decorative), and rolls per-ingredient AVAILABLE/INSUFFICIENT/UNKNOWN
states into one formula-level FEASIBLE/INFEASIBLE/UNKNOWN state (any
insufficient → infeasible; else any unknown → unknown; else feasible).

"Prefer a feasible candidate" is satisfied at the **version** level, not
by mutating `engine.py`'s per-role candidate loop — Python remains
entirely inventory-blind, by design. New
`apps/desktop/src/lib/inventoryComparison.ts::pickMostInventoryFeasibleVersion()`
picks the first already-generated, hard-rule-valid version whose
inventory state is `feasible` (mirrors `pickCheapestValidVersion`'s own
choice to return `undefined` rather than recommend a lower-confidence
result when nothing fully qualifies — an infeasible or merely-unknown
version is never returned as "the best available anyway"). Kept as an
entirely separate function/badge from cost (task §12) — a version can be
priced-but-unavailable or available-but-unpriced; neither is inferred
from the other, proven by a joint test.

**Read-only, by construction**: no code path introduced by this task
calls `upsertRecords("inventory", ...)` or otherwise mutates
`InventoryRecord` — confirmed by grep across the changed files. Generation
never reserves, decrements, or allocates stock.

Wired into the new result UI only (`FormulationResultPage.tsx`'s Summary
tab + `VersionSummaryCard` badge) — `CostingPanel.tsx` (old `/live` UI)
was deliberately not extended to inventory this session, since it has no
multi-version/cards context to make a feasibility comparison meaningful
and the task's own UI minimum was stated specifically for the new result
UI.

### Advanced Optimizer boundary (FVL-03.005, COMPLETED 2026-08-18)

Unlike Cost/Inventory, this task found **no engine gap at all**. Full audit
of `runtime/formulation/advanced_optimizer.py` (1732 lines, a real
constraint-satisfaction + multi-objective MILP solver, PuLP/CBC — its own
module docstring: "additive; the simple optimizer is untouched, keeps its
own CLI/Tauri command," confirmed distinct from `formulation_core.py`'s
simple LP), its Rust bridge (`formulation_advanced.rs`), and its full
schema set (`packages/shared/src/schemas/optimization.ts`:
`formulationProblemSchema`, `advancedOptimizationResultSchema`,
`optimizationRunSchema`, `optimizationScenarioSchema`,
`optimizationProfileSchema`, backed by real canonical `masterdata.rs:150-152`
collections — `optimization_profiles` mutable, `optimization_runs`/
`optimization_scenarios` append-only) confirmed everything the task's
own constraints demand is already correct: real `materialCode` identity
(`Material.code = raw.get("materialCode") or self.id`), caller-computed
compatibility/safety risk (`compatibilityRiskScore`/`safetyRiskScore` —
"the solver never invents one," from the module's own comments), honest
`stock`/`reservedStock`/`availableStock` handling, hard-constraint
preservation (exclusions, `technical_max_pct`/`regulatory_max_pct`,
locked percentages, composition/functional/ratio/conditional
constraints — cost ceiling is deliberately soft-only, "against silent
infeasibility," never a hard override), weighted/lexicographic
multi-objective support restricted to a real `SUPPORTED_METRICS` set
(explicitly excludes `performance_score`/`regulatory_uncertainty`,
deferred to FVL-07 — never fabricated), and structured honest failure
(`status`: `optimal`/`infeasible`/`unbounded`/`timeout`/`error`/
`feasible_with_penalties`, with `_diagnose_infeasibility()` for the
non-feasible cases — never a fake result). The existing
`AdvancedOptimizerPanel.tsx` (1332 lines) is the one UI, already mounted
project-bound in both `FormulasPage.tsx` (`/live`'s Optimizer tab) and
`OptimizationPage.tsx` (`/optimization?project=<id>`). **Zero
engine/schema/solver/Rust changes were made or are needed.**

**The one real gap — and it isn't in the optimizer**:
`formulationProblemSchema.projectId`/`productFamilyId` are non-optional
(confirmed at the one real call site,
`AdvancedOptimizerPanel.tsx:271-272`), but a generated AI session card
(`SessionDetail`/`FormulationBrief` in `formulationV2.ts`) carries no
project association at all — sessions and `Formulation` projects are
deliberately separate concepts in this codebase (a session is a
disposable AI-generation workspace; a `Formulation` is the persisted,
versioned unit everything else — cost snapshots, inventory checks, the
optimizer — is built around). Fabricating placeholder IDs to satisfy the
schema would violate this project's own standing "no fake persistent
IDs" rule. The `/optimizer` page (`OptimizerPage.tsx`) was investigated
as a possible project-free path and ruled out — it is the unrelated
**simple** optimizer (`formulation_core.py`/`runFormulationOptimize`),
hand-entered rows, no canonical Material Master connection, no
`materialCode` — not a lighter-weight entry to the Advanced Optimizer.

**Resolution — require save-first** (decided with the user): a new
"Optimize / Refine" quick action on `FormulationResultPage.tsx` promotes
the selected version into a real `Formulation`/`FormulationVersion` pair
first, using new pure `apps/desktop/src/lib/promoteGeneratedFormula.ts::buildPromotedFormulation()`
— built entirely from the codebase's own existing, already-tested
helpers (`newFormulation()`/`newVersion()`/`linesFromGeneratedFormula()`
in `formulations.ts`, the same `materialCode`-carrying line conversion
FVL-03.002/.003 already fixed), zero new persistence shape or mapping
logic. `productFamilyCode` uses the session brief's real `category` when
present, else an honestly-disclosed `"general"` fallback — never a
fabricated specific category. The handler
(`FormulationResultPage.tsx::onOptimize`) calls the existing
`saveFormulation()`/`saveFormulationVersion()` Tauri wrappers, caches the
promoted `formulation.id` per card version in memory (avoiding duplicate
`Formulation` records on repeat clicks within one visit), then navigates
into the existing, **completely unmodified**
`/optimization?project=<id>` route — landing directly in
`OptimizationPage.tsx` → `AdvancedOptimizerPanel.tsx`, already fully
wired to canonical cost/inventory/materials for the new project.

**Read-only w.r.t. the session, by construction**: `buildPromotedFormulation()`
is pure (no Tauri/network call — proven by test) and only ever reads
`session.brief`/`session.id`/the selected `card`; no code path writes
back to session storage — the original generated cards are never
mutated. Only NEW `Formulation`/`FormulationVersion` records are ever
created. Confirmed by diff review across the changed files (no
`session.*` mutation, and the promotion helper itself contains no
Tauri import at all).

**No substitution, no new UI, no LLM**: this task does not touch
substitution/compatibility/safety/regulatory integration (deferred to
later FVL-03 rows), introduces no new optimizer dashboard (the existing
panel is reused unmodified), and involves no predictive AI/LLM anywhere
— the promotion step is pure data construction from the session's own
already-generated, deterministic formula.

### Material Substitution Engine boundary (FVL-03.006, COMPLETED 2026-08-18)

Same conclusion pattern as the Advanced Optimizer boundary above: full
audit found **no engine/schema/scoring gap at all**. The one-to-one
Material Substitution Engine (`packages/shared/src/schemas/substitution.ts`
+ `packages/shared/src/engine/substitution.ts`, fully specified in
`docs/MATERIAL_SUBSTITUTION.md`) already scores candidates over 15 real
dimensions — function match, active-matter equivalence, a real
`evaluateCompatibility`/`evaluateSafety` re-run with the candidate
substituted in, ionic character, regulatory status, available stock
(canonical `InventoryRecord`), HLB, pH, recommended-use overlap, landed
cost (canonical `MaterialPrice`/`cost.ts`), supplier approval, lead time,
Kenya-local, evidence confidence — never name/trade-name similarity, and
a dimension with no backing data is reported `missingData: true`
(`SubstitutionWeights.missingDataPenalty`, 0 by default), never defaulted
to a perfect-match score. `rankCandidates()` sorts any candidate with a
blocking compatibility/safety finding after every clean one regardless of
score — a blocking candidate is shown, never hidden. Applying a candidate
writes an immutable `substitution_runs` record
(`substitutionRunSchema`: request, every scored candidate, the selected
one) BEFORE ever touching the draft, then updates only the **working
draft** (`useFormulationWorkspace.ts::onApplySubstitution`) — never the
saved `FormulationVersion` the draft was derived from; a chemist must
still take an explicit "Save Version" action for the substitution to
become part of formulation history. The existing, already-tested
`SubstitutionDialog`/`SubstitutionPanel.tsx` UI already implements this
whole workflow, mounted project-bound in both `/live`
(`FormulasPage.tsx`) and `/formulation` (`FormulationPage.tsx`).
**Zero engine/schema/scoring/Rust/Python changes were made or are
needed.**

**Trigger boundary — the platform's own two named cases, nothing else**:
new pure `apps/desktop/src/lib/generatedFormulaInventory.ts::shouldOfferSubstitution()`
returns `true` only for (A) an ingredient that never resolved to a
canonical `materialCode` at all, or (B) a resolved ingredient whose
FVL-03.004 inventory state is definitively `insufficient` — and `false`
for every other UNKNOWN (no inventory record for an otherwise-resolved
material, mixed-unit lots, or an unusable batch size). This is a
strict reading of the task's own "UNKNOWN means insufficient data, never
automatic unavailability" rule, proven by test for all three UNKNOWN
sub-cases plus the two real triggers and the "fully available" negative
case.

**Case A's "unresolved source" is not a new mechanism** — audited and
confirmed already handled, honestly, by the existing
`SubstitutionPanel.tsx` itself: `target.materialId = line.materialId ??
line.id` and `target.materialCode = line.materialCode ?? ""` already
fall back gracefully for ANY formula line without a resolved material
(pre-existing behavior, exercised by the pre-existing formula builder,
not introduced by this task). No fabricated source material code was
added anywhere.

**Generated-vs-saved integration**: identical seam to FVL-03.005 — a
generated AI session card has no project, and `substitutionRequestSchema`
requires a real `projectId`/`formulaVersionId` (both non-optional), so
"Find substitute" promotes the selected version via the SAME
`promoteGeneratedFormula.ts::buildPromotedFormulation()` FVL-03.005
already introduced. The in-memory promotion cache in
`FormulationResultPage.tsx` was widened from "formulation id only" to the
full `{formulation, version}` pair so the Optimizer and Substitution
entry points share one promoted project per generated version (never two
separate `Formulation` records for the same click-session), and so a
"Find substitute" click can resolve the promoted version's own
persisted line id — by array index into `version.lines`, which is
guaranteed to align 1:1 with the generated formula's own ingredient
order since both are built from the same `card.formula.ingredients`
array by the same `linesFromGeneratedFormula()` (FVL-03.002/.003) — without
a re-fetch.

**UI entry point — smallest addition to an existing, unmodified
component, not a new dashboard**: a "Find substitute" button was added
only inside the existing `InventoryFeasibilitySummary` component
(FVL-03.004's own read-only per-ingredient inventory display), shown per
line only when `shouldOfferSubstitution()` is true. Clicking it promotes
(if not already promoted this visit) and navigates to
`/formulation?project=<id>&substituteLine=<lineId>` — a new one-shot
query-param handoff added to `FormulationPage.tsx`, exactly mirroring its
own pre-existing `focusLine` query-param pattern (same file, same
`useEffect`), which opens the existing, **completely unmodified**
`SubstitutionDialog` for that exact line. A defensive existence-guard
(`draft.value.lines.some(l => l.id === substitutingLineId)`) was added at
that same render site so a stale or malformed `substituteLine` id can
never crash the dialog — it simply fails to open, honestly. No new
substitution dashboard, no duplicated ranking/filter UI — the dialog
itself (reason selection, ranked candidates, per-dimension score
breakdown, system-substitution section) is byte-for-byte the same
component every other substitution entry point in this app already uses.

**No system substitution pulled forward**: `systemSubstitution.ts`,
`generateSystemCandidates`, `buildSystemSubstitutionProblem`, and
`scoreSystemResult` are never referenced by any code this task added —
confirmed by grep. FVL-03.007 remains untouched and NOT started.

**Read-only w.r.t. the session, by construction**: the new "Find
substitute" handler
(`FormulationResultPage.tsx::onFindSubstitute`) only reads
`session.brief`/`session.id`/`card`, exactly like FVL-03.005's
`onOptimize` — confirmed by diff review that no `session.*` assignment
exists anywhere in the changed files. Only new `Formulation`/
`FormulationVersion` records are ever created by promotion; the actual
substitution apply step still only ever mutates the working draft, per
the existing, unmodified `onApplySubstitution`.

### System Substitution Engine boundary (FVL-03.007, COMPLETED 2026-08-18)

Same conclusion pattern as Material Substitution and the Advanced
Optimizer: full audit found **no engine/schema/scoring gap at all**, and
system substitution is already fully implemented, not merely documented.
`packages/shared/src/engine/systemSubstitution.ts`
(`generateSystemCandidates`, `buildSystemSubstitutionProblem`,
`scoreSystemResult`) + the `systemCandidateLimitsSchema`/
`rejectedSystemCandidateSchema`/system-mode fields on
`substitutionRequestSchema` (`packages/shared/src/schemas/substitution.ts`)
are the sole authority — full mechanism documented in
`docs/SYSTEM_SUBSTITUTION.md`.

**What "system" means in this platform — confirmed by audit, not
assumed**: there is no fixed chemistry taxonomy anywhere in the codebase
(no hardcoded "surfactant system"/"preservative system"/"chelation
system" categories). A system is whichever set of ≥2 formula lines a
human selects in the existing `SubstitutionDialog`'s own checklist —
membership is always 100% human-identified, never auto-detected. This
resolves the task's own "if a system cannot be identified
deterministically, surface that honestly, never fabricate membership"
requirement by construction: the UI never attempts automatic
identification at all, so that failure mode cannot arise in new code.

**Candidate generation, optimizer routing, scoring — all pre-existing,
all real**: `generateSystemCandidates` builds combinations from real
material functions + stock/supplier-approval/Kenya-local filters only
(never name similarity); a combination that fails to cover every
preserved function is recorded as `rejected` with a real
`missing_required_function` reason, never silently offered partial.
Every surviving proposal is turned into a real `FormulationProblem` and
solved by the actual Advanced Optimizer
(`runtime/formulation/advanced_optimizer.py`) via
`buildSystemSubstitutionProblem` — untouched lines locked, source lines
removed as candidates, a `min_total` functional constraint per preserved
function, a **soft** active-contribution-preservation constraint (never
hard — the same "against silent infeasibility" reasoning FVL-03.005
confirmed for the plain optimizer), real technical/stock limits, and
real compatibility/safety hard exclusions computed by the caller (never
re-implemented here) via the same `blockingExclusionConstraints` the
plain Optimizer screen uses. `scoreSystemResult` reads feasibility,
soft-constraint violations, real cost delta, and
`compatibility_risk`/`safety_risk` (when the caller's base problem
included them — otherwise `missingData: true`, never assumed) directly
from the optimizer's own result, nothing re-derived.

**Non-destructive apply, identical lifecycle to material substitution**:
selecting a valid system and applying persists the underlying
`OptimizationRun` (`optimization_runs`) AND an immutable `SubstitutionRun`
(`substitution_runs`, `isSystem: true`, `systemMaterialIds`,
`optimizationRunCode` pointing at the run above) before ever touching
anything, then replaces the selected source lines with the system's
materials in the WORKING DRAFT only — never the saved
`FormulationVersion` (`useFormulationWorkspace.ts::onApplySystemSubstitution`,
confirmed unchanged). The existing, already-tested `SubstitutionDialog`
(`SubstitutionPanel.tsx`, mounted in both `/live` and `/formulation`)
already implements this entire workflow end-to-end in its system-mode
section (check 2+ lines → Generate → Evaluate → Apply). **Zero
engine/schema/scoring/Rust/Python changes were made or are needed.**

**The one real gap — identical shape to FVL-03.005/.006**: a generated
AI session card has no real project (`substitutionRequestSchema`
requires `projectId`/`formulaVersionId`, both non-optional — the same
requirement FVL-03.006 already resolved for one-to-one substitution),
and the existing dialog's `selectedLineIds` could only ever be seeded
with ONE line (the required `line` prop) — there was no way to open it
already pre-checked into system mode for 2+ ingredients a chemist picked
from a generated card. Resolved with a small, additive, backward-
compatible change: a new optional `initialExtraLineIds?: string[]` prop
on `SubstitutionDialog` seeds `selectedLineIds` with additional lines on
open — filtered defensively against real `allLines` inside the dialog
itself (never trusting a caller-supplied id blindly, so a stale/bogus id
can never masquerade as a second system member and silently enter system
mode with a fabricated membership). Every caller that doesn't pass this
prop is unaffected (existing `FormulasPage.tsx`/`FormulationPage.tsx`
one-to-one call sites unchanged in behavior). The human retains full
control after open — every checkbox remains freely editable, generation/
evaluation/application are all still explicit, separate steps.

**UI entry point — smallest addition, reusing rather than cloning**: a
"System substitution" multi-select was added only to the existing
generated-formula ingredient table (`FormulaTab` in
`FormulationResultPage.tsx`) — a checkbox per row (click isolated via
`stopPropagation` so it never also opens that ingredient's evidence
panel) plus a small action bar showing the live selection count, with
the action itself disabled below 2 selections so a one-material problem
can never be routed into system mode. Clicking it reuses the exact
FVL-03.005/.006 promotion seam (`ensurePromoted()` in
`FormulationResultPage.tsx`) to obtain a real `Formulation`/
`FormulationVersion`, resolves the selected ingredient indices to that
promoted version's own real line ids (the same index-alignment guarantee
FVL-03.006 established: both the generated card and the promoted
version's lines are built from the same `card.formula.ingredients` array
via the same `linesFromGeneratedFormula()`), and navigates to
`/formulation?project=<id>&substituteLine=<anchor>&systemLines=<rest>` —
a new one-shot query-param handoff in `FormulationPage.tsx` mirroring its
own pre-existing `focusLine`/`substituteLine` pattern, which opens the
existing, otherwise completely unmodified `SubstitutionDialog` already
pre-seeded into system mode for those exact lines.

**Version scoping, proven by a caught-and-fixed bug**: a genuine
cross-version state leak was found during this session's own testing —
`FormulaTab`'s local ingredient-selection `Set<number>` persisted across
a version switch (React reuses the component instance; nothing reset the
selection), so selecting 2 ingredients on V1 then switching to V2 left
the "System substitution" action wrongly enabled against V2's unrelated
ingredient indices. Fixed with a `useEffect` resetting the selection
whenever `card.version` changes — caught by a new test
(`FormulationResultPage.test.tsx`) before this ever shipped, exactly the
kind of scoping bug the task's own Acceptance I exists to catch.

**Read-only w.r.t. the session, by construction**: the new
`FormulationResultPage.tsx::onSystemSubstitution` handler only reads
`session.brief`/`session.id`/`card`, identical to FVL-03.005/.006's own
handlers — confirmed by diff review that no `session.*` assignment
exists anywhere in the changed files. Only new `Formulation`/
`FormulationVersion` records are ever created by promotion; the actual
system-substitution apply step still only ever mutates the working
draft, exactly as before this task.

### Compatibility Engine boundary (FVL-03.008, COMPLETED 2026-08-18)

Same conclusion pattern as every prior FVL-03 engine audit: **no
engine/schema gap at all**. `evaluateCompatibility()`
(`packages/shared/src/engine/compatibility.ts`) is already a complete,
deterministic, rule-driven checker — no model in the loop — fully
specified in `docs/COMPATIBILITY_ENGINE.md`. A `CompatibilityRule`
(`compatibilityRuleSchema`) carries a real severity
(`info`/`warning`/`error`/`blocking`), scope filters (`materialIds`,
`casNumbers`, `functionGroups`, `ionicCharacters`, `productDomains`), and
a `ruleType` (forbidden/warning combination, required co-ingredient,
pH-/temperature-/concentration-dependent, order-of-addition, packaging/
storage incompatibility). Missing data (no pH target on a `ph_dependent`
rule, etc.) produces a finding with `dataIncomplete: true` — a blocking
rule downgrades to `warning` under incomplete data rather than either
silently passing or blocking on a guess. `matchLines`/`lineMatchesCondition`
(`engine/ruleConditions.ts`) already join by real `materialCode` via
`materialFor()`, with graceful (not fabricated) fallback to function/
name-keyword matching for a line with no resolved material. **Zero
engine/schema/Rust/Python changes were made or are needed.**

**Real, already-battle-tested severity semantics — confirmed by audit,
not invented here**: `packages/shared/src/engine/optimization.ts::blockingExclusionConstraints`
and `SubstitutionPanel.tsx`'s own `hasBlockingCompatibilityFinding` both
already treat ONLY `severity === "blocking"` as a hard exclusion;
`info`/`warning`/`error` are all real, non-blocking findings (the
optimizer's risk-objective scoring explicitly reuses them as signal, per
`engine/optimization.ts`'s own comment: "already turns every `blocking`
finding into a hard exclusion — this instead scores every non-blocking
finding"). This session's own new code reuses that exact distinction —
never invents a fourth-tier "this counts as blocking too" rule.

**Read-only, no promotion needed — unlike FVL-03.005/.006/.007**:
`evaluateCompatibility()` is pure, so a generated (not-yet-saved) card is
evaluated directly, with zero persistence step. New pure
`apps/desktop/src/lib/generatedFormulaCompatibility.ts::evaluateGeneratedFormulaCompatibility(formula, materials, rules, opts)`
reshapes a card via `linesFromGeneratedFormula()` (the same helper every
prior FVL-03 session already reuses) and hands it, unmodified, to the
real engine. The rule set is a REQUIRED caller-supplied parameter —
deliberately never hardcoded inside this new module — because the real
authoritative rule library is the LIVE, chemist-editable
`compatibility_rules` masterdata collection
(`CompatibilityPanel.tsx::listRecordsSeeded("compatibility_rules",
SEED_COMPATIBILITY_RULES)`), not the bare `SEED_COMPATIBILITY_RULES`
constant. New `apps/desktop/src/hooks/useCompatibilityRules.ts` loads
that live collection once, mirroring `useMasterCostData`/
`useInventoryData`'s own established pattern.

**`formulaState` — a fourth, honest coverage state, not invented
severity**: `"compatible"` | `"warning"` | `"blocked"` | `"unknown"`.
`"blocked"` iff any `blocking` finding fired; `"warning"` iff any
non-blocking finding fired; otherwise `"unknown"` (never `"compatible"`)
when at least one ingredient never resolved to a canonical `materialCode`
— a materialCode-/CAS-scoped rule could never have fired against it, so
reporting "compatible" would be a fabricated claim. `unresolvedMaterialCount`
is always exposed separately and honestly alongside real findings,
whatever the state — one fact never hides the other.

**A real, pre-existing bug found and fixed by this session's own
testing**: `apps/desktop/src/lib/masterdata.ts::listRecordsSeeded()`
threw `"not-desktop"` outside Tauri (its `upsertRecords` call has no
`isTauri` guard, unlike its sibling `listRecords()`) — a latent gap never
previously exercised, since no existing test rendered a caller of it
(`CompatibilityPanel.tsx` has no test file). Fixed with a one-line
`!isTauri` early return of `seed`, mirroring `listRecords()`'s own
established convention exactly; zero behavior change inside a real Tauri
build (the fix only touches the previously-throwing `!isTauri` branch).

**Version eligibility, not a combined score**: `pickCheapestValidVersion()`
(`costComparison.ts`) and `pickMostInventoryFeasibleVersion()`
(`inventoryComparison.ts`) both gained an optional `compatibilities`
parameter — one more per-index eligibility gate in the same style as
their existing `formula_state.startsWith("invalid")` check, not a merged
opaque score (task §8 explicitly forbids that). A `"blocked"` version can
never be crowned cheapest-valid or most-inventory-feasible merely because
its price or stock looks attractive; `"warning"`/`"unknown"` never
exclude a version, matching the real platform's own "only blocking is a
hard block" semantics; omitting the parameter preserves every pre-existing
call site's behavior exactly (proven by test).

**UI — a thin presenter, not a second dashboard**: new
`GeneratedCompatibilitySummary` (`apps/desktop/src/components/
compatibility/`) renders a `GeneratedFormulaCompatibility` result as-is —
no severity math, no rule matching, purely display — wired into the
result page's Summary tab alongside the existing Cost/Inventory
summaries, plus a compatibility data row and a red "blocked" banner on
`VersionSummaryCard` (same visual pattern as the existing "cheapest
valid"/"most feasible" banners). `CompatibilityPanel.tsx` (the
project-bound, saved-version panel with pH/temperature inputs and a
save-snapshot action) is untouched — this is a separate, generated-card-
specific presenter, not a clone of it.

**Optimizer/substitution/system-substitution reuse — confirmed by audit,
not rewritten**: `AdvancedOptimizerPanel.tsx` already builds
`blockingExclusionConstraints`/`compatibilityRiskScore` from the real
engine; `SubstitutionPanel.tsx` already re-runs `evaluateCompatibility`
per one-to-one candidate; system substitution already threads
`blockingExclusionConstraints` into `buildSystemBasis()`. All three were
confirmed unchanged and already correct — none needed a single line of
new code for this task. **Disclosed, out-of-scope finding, not a
duplicate-authority violation**: all three of those existing callers pass
the hardcoded `SEED_COMPATIBILITY_RULES` constant, not the live edited
`compatibility_rules` collection this task's own new
`useCompatibilityRules()` correctly reads — a real data-freshness gap (a
chemist's rule edit/addition via `RuleManager.tsx` would not be seen by
those three re-run call sites), but NOT a second engine, second scoring
function, or second rule-matching implementation — the same single
`evaluateCompatibility()` is called every time, just fed a
possibly-stale snapshot. Retrofitting those three already-closed
FVL-03.005/.006/.007 call sites is out of this task's own boundary (they
are correct, tested, and unrelated to "make the Compatibility Engine
authoritative for generated formulas" — the actual FVL-03.008 scope);
flagged here for a future session, not fixed silently as if it were part
of this task.

### Safety Engine boundary (FVL-03.009, COMPLETED 2026-08-18)

Same conclusion pattern as FVL-03.008, but with one real duplicate to
retire rather than a pure integration gap: `evaluateSafety()`/
`classifyProductSafety()` (`packages/shared/src/engine/safety.ts`, fully
specified in `docs/SAFETY_ENGINE.md`) is already a complete,
deterministic, rule-driven checker — no model in the loop. But
`runtime/pipeline/safety.py::evaluate_safety()` was confirmed by audit to
be a real, independently-computed SECOND final-verdict authority: its own
`_SENSITIZER_CLASS_INGREDIENTS`/`_ALLERGEN_DECLARATION_INGREDIENTS`/
`_CORROSIVE_HANDLING_INGREDIENTS`/`_IRRITANT_POWDER_HANDLING_INGREDIENTS`/
`_SULFATE_KEYS` name-keyed hazard tables produced its own `overall_status`
(`PASS`/`PASS_WITH_CONDITIONS`/`FAIL`/`DATA_INCOMPLETE`), never consuming
or deferring to the TS engine's result. **Resolved by full retirement,
not permanent reconciliation** — `runtime/pipeline/safety.py` and
`runtime/pipeline/test_safety.py` (9 tests) were deleted entirely, the
same Option-A precedent FVL-03.003 already established for a
fully-superseded legacy function. `pipeline.py` no longer imports
`safety`, no longer computes `safety_result`, no longer emits
`card["safety"]`, and no longer appends a `safety`-sourced
`DATA_INCOMPLETE` entry to `evidence_gaps`.
`validation_plan.py::build_validation_plan()` had its `safety_overall`
parameter removed outright (not stubbed/defaulted) — VAL-002 now checks
only the still-live `regulatory_overall == "NON_COMPLIANT"` half of its
original condition; Regulatory consolidation itself (`regulatory.py`/
`regulatoryRules.ts`) is confirmed completely untouched, reserved for
FVL-03.010. `test_pipeline.py`'s zero-LLM regression guard now asserts
`"safety" not in card`; `test_traceability.py`'s
`test_every_safety_finding_has_a_source_or_rule` (reading the now-removed
`card["safety"]["findings"]`) was deleted, its adjacent, unrelated
regulatory-provenance test left untouched. **One separate responsibility
confirmed by audit and deliberately left alone**: `pipeline.py`'s
pre-generation `classify_target()`/`safety_gate()`/`safety_decision`
AI-request classification gate (mirrors the TS
`PRODUCT_SAFETY_CLASSIFICATIONS` enum by design, runs before generation
even starts) is not a final-verdict engine at all and is out of this
task's retirement scope.

**Same "only blocking is a real hard block" semantics reused, not
reinvented**: `optimization.ts::blockingExclusionConstraints` and
`SubstitutionPanel.tsx::hasBlockingSafetyFinding` both already treat only
`severity === "blocking"` Safety findings as a hard exclusion, exactly
mirroring the Compatibility convention FVL-03.008 already confirmed;
`info`/`warning`/`error` remain non-blocking, usable as optimizer
risk-objective signal.

**Read-only, no promotion needed — same as FVL-03.008**: new pure
`apps/desktop/src/lib/generatedFormulaSafety.ts::evaluateGeneratedFormulaSafety(formula, materials, rules, opts)`
reshapes a card via the same `linesFromGeneratedFormula()` helper and
hands it, unmodified, to the real engine. The rule set is a REQUIRED
caller-supplied parameter, never hardcoded — the real authoritative rule
library is the LIVE, chemist-editable `safety_rules` masterdata
collection, not the bare `SEED_SAFETY_RULES` constant. New
`apps/desktop/src/hooks/useSafetyRules.ts` loads that live collection,
mirroring `useCompatibilityRules.ts`'s own established pattern exactly
(the `listRecordsSeeded()` `!isTauri` fix FVL-03.008 already made is
reused as-is here, not re-fixed).

**`formulaState` — the same fourth, honest coverage state pattern**:
`"safe"` | `"warning"` | `"blocked"` | `"unknown"`. `"blocked"` iff any
`blocking` finding fired; `"warning"` iff any non-blocking finding fired;
otherwise `"unknown"` (never `"safe"`) when at least one ingredient never
resolved to a canonical `materialCode`. `unresolvedMaterialCount` is
always exposed separately and honestly, whatever the state.
`classifyProductSafety()` (product-family + claims classification)
deliberately NOT wired into this seam: a generated session's free-text
`brief.category` has no reliable join to a real `ProductFamily.hazardClass`
record, and fabricating that join would violate the standing
no-fabricated-identity rule — the same scope decision FVL-03.008 already
made for Compatibility's product-domain context.

**Version eligibility, not a combined score**: `pickCheapestValidVersion()`
and `pickMostInventoryFeasibleVersion()` each gained an optional 4th
`safeties` parameter — independent of, and additive to, the existing
`compatibilities` gate (both dimensions stay separate eligibility checks,
never merged into one opaque score, per task's own explicit instruction).
A safety-`"blocked"` version can never be crowned cheapest-valid or
most-inventory-feasible; `"warning"`/`"unknown"` never exclude; omitting
the parameter preserves every pre-existing call site's behavior exactly.

**UI — a thin presenter, not a second dashboard**: new
`GeneratedSafetySummary` (`apps/desktop/src/components/safety/`) renders
a `GeneratedFormulaSafety` result as-is (including `humanReviewRequired`/
`requiredPpe`/`requiredEngineeringControls` when present) — wired into
the result page's Summary tab alongside Cost/Inventory/Compatibility, plus
a safety data row and red "blocked" banner on `VersionSummaryCard`. The
existing `SafetyPanel.tsx` (the project-bound, saved-version panel) is
untouched — this is a separate, generated-card-specific presenter. The
old `SafetyTab`/`SafetyFindingRow` code that read the legacy Python-shaped
`card.safety` fields (`overall_status`/`subject`/`rule_id`/`rationale`/
`required_action`/`source_type`, grouped by `subject_type`) was deleted
outright, not left dead alongside the new path. The "Readiness" badges
block inside `SummaryTab` had one further `card.safety.overall_status`
reference — caught only by this task's own required closure-time grep
audit, not by typecheck/lint/the first test pass — fixed the same way.

**Report/export path — the one real split-authority risk in this task,
closed by construction**: `formulationReport.ts`'s `versionSection()`/
`buildReportHtml()`/`openAndPrintReport()` were rewired to accept a
`safetyByVersion` map — built from the exact same computed `safeties`
array the UI renders, threaded from `FormulationResultPage.tsx`'s
`TopBar` — instead of reading the retired `card.safety` JSON. A
backward-compatible default `= {}` keeps every other caller working;
a version with no computed safety result renders an honest "not
available", never a fabricated verdict. `formulationV2.ts`'s
`SafetyResult` interface (the `card.safety` shape) is kept, not deleted —
its doc comment now states plainly it is legacy-only, read by zero
current code, kept solely so a historical session file saved before this
retirement still parses without error.

**Optimizer/substitution/system-substitution reuse — confirmed by audit,
not rewritten**: `AdvancedOptimizerPanel.tsx`'s
`blockingExclusionConstraints`/safety-risk scoring, `SubstitutionPanel.tsx`'s
`hasBlockingSafetyFinding` re-run per one-to-one candidate, and system
substitution's `buildSystemBasis()` were all confirmed unchanged and
already correct — none needed a single line of new code for this task.
**Same disclosed, out-of-scope finding FVL-03.008 already flagged, now
reconfirmed still present for Safety too**: all three of those existing
callers pass the hardcoded `SEED_SAFETY_RULES` constant, not the live
edited `safety_rules` collection this task's own new
`useSafetyRules()` correctly reads — a real data-freshness gap, but NOT
a second engine, second scoring function, or second rule-matching
implementation; retrofitting those already-closed call sites remains out
of this task's boundary, flagged here again for a future session.

**Compatibility and Safety confirmed to remain separate domains
throughout** — no merged findings, no shared verdict field, no opaque
combined score anywhere in this task's new code.

**Historical sessions carrying the legacy `card.safety` JSON open without
crashing, and the legacy payload never becomes current authority** —
proven by a dedicated `FormulationResultPage.test.tsx` test against the
pre-existing SESSION_V6 fixture (which still carries a real legacy
`card.safety` object): the Safety tab shows neither that fixture's legacy
ingredient name nor its legacy rule id, only the freshly recomputed
authoritative result. That same test incidentally surfaced a genuine,
non-obvious real-engine fact (not a bug in the new wrapper): the real
`SEED_SAFETY_RULES` `safety-flammable-solvent` rule's `functionsAny:
["solvent"]` OR-condition legitimately fires on a plain q.s.-to-100%
"Water (Aqua)" line, alongside `safety-ventilation-reminder`, producing a
genuine `formulaState: "warning"` — confirmed by isolated direct-engine
inspection before the test assertion was corrected to match it.

**Closure-time single-authority grep re-audit (§24)**: `overall_status`,
`evaluate_safety`, `evaluateSafety`, `classifyProductSafety`, `hazard`
searched across `runtime/pipeline`, `runtime/formulation`,
`packages/shared/src`, `apps/desktop/src`,
`apps/desktop/src-tauri/src`. Zero live-code hits outside the one
authoritative TS engine (`packages/shared/src/engine/safety.ts`) and its
already-confirmed-correct callers; the only remaining `card.safety`/
`overall_status` matches anywhere are explanatory comments and disposable
test fixtures documenting the retirement, plus the unrelated
pre-generation `hazardous_lawful_product` request-classification label in
`pipeline.py::classify_target()` (confirmed out of scope, a request-time
label, not a safety verdict).

### Regulatory Engine boundary (FVL-03.010, COMPLETED 2026-08-18)

Same conclusion pattern as FVL-03.009, but with a materially larger and
more complex duplicate to retire: `evaluateRegulatory()`/
`classifyProductRegulatory()` (`packages/shared/src/engine/
regulatoryRules.ts`/`regulatoryClassification.ts`, fully specified across
`docs/REGULATORY_ENGINE.md`/`REGULATORY_CLASSIFICATION.md`/
`REGULATORY_RULES.md`) is already a complete, deterministic,
versioned-rule Kenya/EAC engine — a real six-state finding vocabulary
(`REGULATORY_FINDING_STATUSES`), a real eight-state rule/finding
verification vocabulary (`REGULATORY_VERIFICATION_STATUSES`, `verified`
reachable only through the human-only `verifyRule()` gate — never import,
never an AI/system actor), 15 rule types across ingredient-, claim-, and
product-level requirements, real market scoping (`REGULATORY_JURISDICTIONS`
= KE/UG/TZ/RW/BI/SS/EAC, with EAC as an overlay bloc profile that applies
alongside, not instead of, a member state's own rules). But
`runtime/pipeline/regulatory.py::evaluate_regulatory()` was confirmed by
audit to be a real, independently-computing SECOND final-verdict
authority — its own module docstring literally called it "a direct,
faithful port" of the TS catalog, with its own `_STATUS_PRECEDENCE`
resolution producing its own `overall_status`
(`COMPLIANT`/`COMPLIANT_WITH_CONDITIONS`/`NON_COMPLIANT`/
`DATA_INCOMPLETE`), never consuming or deferring to the TS engine — and,
confirmed by direct comparison of both rule catalogs, the Python port was
itself STALE: it carried only 7 of the TS catalog's real 16 seed rules
(missing, among others, KE-REG-001/002's registration/chlorine-
concentration rules and every UG/TZ/BI/SS rule beyond one each), proving
the duplication was already silently drifting out of sync with its own
source of truth before this task even started.

**Resolved by full retirement, not permanent reconciliation** (same
Option-A precedent FVL-03.003/.009 already established): `regulatory.py`
and `test_regulatory.py` (14 tests) deleted entirely. `pipeline.py` no
longer imports `regulatory`, no longer computes `regulatory_result`, no
longer emits `card["regulatory"]`, and no longer appends a
`regulatory`-sourced `DATA_INCOMPLETE` entry to `evidence_gaps`.
`validation_plan.py::build_validation_plan()` had its now-last remaining
parameter (`regulatory_overall`, already reduced to this alone by
FVL-03.009) removed entirely — VAL-002 (the last Safety/Regulatory
advisory checklist entry) removed outright, since nothing it could
honestly reference remains computed in Python; the checklist generator
is now purely formula-shape-derived (category, functional roles, batch
scale), never re-deriving a business verdict itself. `test_pipeline.py`'s
zero-LLM guard now asserts `"regulatory" not in card` (alongside the
`"safety" not in card` FVL-03.009 already added); `test_traceability.py`'s
`test_every_regulatory_finding_has_a_source_or_rule` (reading the
now-removed `card["regulatory"]["findings"]`) was deleted with an
explanatory comment.

**One genuinely useful Python-side capability was found and deliberately
NOT ported, rather than kept as disguised duplicate business logic**:
`regulatory.py::review_claims()`'s structural "formulation condition"
check (verifying a "sulfate-free"/"silicone-free"/"fragrance-free" claim
against the formula's own actually-resolved ingredients) has no TS-side
equivalent rule type — `REGULATORY_RULE_TYPES`'s `claim_restriction`/
`claim_evidence_requirement` match by keyword/evidence-on-file, not by
re-deriving a structural fact from composition. This capability was
retired along with the rest of the module rather than selectively kept —
keeping it alone would have been exactly the "genuinely useful
preprocessing survives, competing verdict computation retires" split
the task allowed for, but this specific check computed a real
`COMPLIANT`/`NON_COMPLIANT` claim VERDICT (feeding the same
`_STATUS_PRECEDENCE` merge as everything else), not inert preprocessing
— keeping it would have been a second, smaller claims-verdict authority
surviving inside a supposedly-retired module. Flagged here, not silently
dropped: a future session (out of FVL-03's own scope — this is a Claims/
Labels capability, not a Regulatory Engine one) may want to add a real
`ingredient_prohibition`-shaped structural claim-verification rule type
to the TS catalog itself, the single-authority-correct way to gain this
capability back.

**Same "only a real hard finding excludes" convention, adapted to this
engine's own real vocabulary — not the severity-based one, confirmed not
to apply here**: unlike Compatibility/Safety (whose real blocking gate is
`severity === "blocking"`), Regulatory's own already-established
blocking convention — confirmed by audit at its one real live caller,
`regulatoryApproval.ts::hasBlockingFinding`/`deriveRegulatoryReadiness`
— is STATUS-based: `NON_BLOCKING_FINDING_STATUSES = ["compliant_with_rule",
"not_applicable"]`; every other status, including `missing_data`/
`human_review_required`, blocks a saved formula's own approval
readiness. Reusing that exact convention verbatim for the NEW
generated-formula eligibility question (§9's "hard regulatory failure
remains a hard constraint") would make virtually EVERY generated formula
"blocked," since a generated session never has a named human's
`manuallyConfirmedRuleIds` — every empty-`productCategories` product-
level requirement rule (label/language/market-identifier) would
permanently read as blocking. That is real, honest incompleteness (needs
review), never a proven violation, and collapsing the two would make the
eligibility gate degenerate (always fires) rather than meaningful. New
`formulaState` therefore narrows `"blocked"` specifically to a real
`non_compliant` finding — the literal trigger every one of this task's
own acceptance cases describes ("a formula violates a rule") — while
`missing_data`/`human_review_required`/`unknown`-status findings surface
as `"warning"` (visible, not hidden, not excluded). This is not a fourth
invented taxonomy: both `"blocked"` and `"warning"` are derived
exclusively from the engine's own real `REGULATORY_FINDING_STATUSES`
values, just partitioned differently than the saved-formula approval
gate partitions them — an eligibility question ("can this candidate be
ranked as valid") is not the same question as an approval question ("is
this exact reviewed version ready to ship"), and the engine's own schema
already carries both meanings in one status enum without contradiction.

**Zero findings is never `"compliant"`, deliberately preserving a real
policy `regulatory.py`'s own module docstring stated before retirement**
("Coverage itself, even with zero matched findings, is always surfaced —
never silently implying a clean COMPLIANT from nothing having matched"):
this installation's real rule catalog is inherently sparse per
jurisdiction (as few as 2 rules for RW/SS), so an empty finding list far
more often means "no rule in this installation's data happens to cover
this yet" than "this product is confirmed clean." `formulaState` is
`"unknown"` for both an unresolved market and a resolved-but-empty
result — carried forward as the single authoritative place that policy
now lives, since the module that used to state it is gone.

**Market resolution — legitimate input preprocessing, not a second rule
catalog**: `jurisdiction`/`category` are both REQUIRED, non-optional
fields on `evaluateRegulatory()`'s own context — unlike Compatibility/
Safety's optional context filters. A generated session's `brief.market`
is free text ("kenya," not "KE"); a small, wrapper-local
`MARKET_ALIASES` table in `generatedFormulaRegulatory.ts` — the exact
same real-world alias set `regulatory.py::_MARKET_ALIASES` used, ported
directly — resolves it to a real `RegulatoryJurisdiction` code or
`undefined` (never guessed); `undefined` maps to `formulaState: "unknown"`
with zero rules evaluated, honoring §6's "unknown market coverage must
remain unknown" requirement exactly. `category` is deliberately always
`"human_review_required"` — the same scope decision FVL-03.008/.009
already made for `classifyProductCompatibility`-adjacent/
`classifyProductSafety`: a generated session has no real `ProductFamily`
record to classify against, and `"human_review_required"` is not an
invented fallback but the REAL classifier's own admission-of-uncertainty
category value, reused honestly. The practical effect is under-coverage,
never fabrication: a `productCategories`-scoped rule (e.g. KE-REG-001's
disinfectant/biocidal registration requirement) simply never fires for a
generated formula, while an unrestricted rule (label/language/market-
identifier) still evaluates normally.

**Generated-formula evaluation seam — mirrors FVL-03.008/.009 exactly**:
new pure `apps/desktop/src/lib/generatedFormulaRegulatory.ts::evaluateGeneratedFormulaRegulatory(formula, materials, rules, opts)`
reshapes via `linesFromGeneratedFormula()`, resolves the jurisdiction as
above, and hands the result to the real engine, computing nothing itself
beyond the `formulaState`/`unresolvedMaterialCount` derivation described
above. New `apps/desktop/src/hooks/useRegulatoryRules.ts` loads the LIVE,
chemist-editable `regulatory_rules` masterdata collection
(`listRecordsSeeded("regulatory_rules", SEED_REGULATORY_RULES)`), not a
frozen seed copy — mirroring `useSafetyRules.ts`/`useCompatibilityRules.ts`
exactly.

**Version eligibility, not a combined score**: `pickCheapestValidVersion()`/
`pickMostInventoryFeasibleVersion()` each gained an optional 5th
`regulatories` parameter — independent of, and additive to, the existing
`compatibilities`/`safeties` gates (three separate eligibility checks,
never merged into one opaque score). A regulatory-`"blocked"` version
(a real `non_compliant` finding) can never be crowned cheapest-valid or
most-inventory-feasible; `"warning"`/`"unknown"` never exclude; omitting
the parameter preserves every pre-existing call site's behavior exactly.

**UI/report — fully rewired off the legacy `card.regulatory` shape**: the
old `RegulatoryTab`/`RegulatoryFindingRow` code that read the legacy
Python-shaped fields (`subject_type`/`subject`/`rule_id`/`condition`/
`rationale`/`overall_status`/`coverage`/`claims`/`missing_coverage_note`)
was deleted outright and replaced with a rewritten `RegulatoryTab`
rendering a new thin `GeneratedRegulatorySummary` presenter
(`apps/desktop/src/components/regulatory/`) — showing state, resolved
jurisdiction (or the honest "market unresolved" disclosure), per-finding
status AND verification status side by side (a `not_verified` rule's
finding is never shown as though it were a confirmed legal conclusion),
affected materials/claims, rule code, and required action. A Regulatory
section added to `SummaryTab`; a Regulatory row + red "blocked" banner
added to `VersionSummaryCard`; the "Readiness" badges block's stale
`card.regulatory.overall_status` reference (and the now-fully-dead
shared `statusTone()` helper it was the last caller of) removed.
`formulationReport.ts` rewired to accept a `regulatoryByVersion` map
(the exact same computed result the UI renders) instead of reading the
retired `card.regulatory` JSON — closing the same "Download Report"
split-authority risk FVL-03.009 already closed for Safety, with an
honest "not available" when no result was computed.
`formulationV2.ts`'s `RegulatoryResult`/`RegulatoryFinding`/`ClaimFinding`
interfaces kept, not deleted — doc comments now state plainly they are
legacy-only, read by zero current code, kept solely so a historical
session file saved before this retirement still parses without error.

**Material Substitution — a real, new wiring, not merely an audit
finding this time**: unlike Compatibility/Safety (already fully wired at
this call site when FVL-03.008/.009 audited it), `SubstitutionPanel.tsx`'s
one-to-one candidate scoring had NEVER populated
`SubstitutionCandidateInput.regulatoryPermitted` — `substitution.ts`'s
own `regulatory_status` scoring dimension already existed and was
already tested (honestly scoring `undefined` as "unknown, not assumed
permitted"), but nothing fed it a real value. This is now wired: for each
candidate, `evaluateRegulatory()` re-runs against the real
`SEED_REGULATORY_RULES` catalog, using the project's own real
`formulation.targetMarkets[0]` (the same field/convention
`RegulatoryPanel.tsx` already treats as the primary jurisdiction) and
the same honest `"human_review_required"` category fallback described
above; `regulatoryPermitted` is `false` only for a real `non_compliant`
finding, `true` only when every applicable finding is genuinely clean
(`NON_BLOCKING_FINDING_STATUSES`), `undefined` otherwise (jurisdiction
unresolved, zero findings, or only a needs-review finding) — never
assumed permitted. **Deliberately NOT done**: extending
`buildCandidateRecord()`'s own exported `SubstitutionCandidate` schema
with a new definite prohibited/permitted output field (it currently only
ever exposes `regulatoryUncertain: boolean`, collapsing "definitely
prohibited" and "definitely permitted" together) — that would be
extending the shared engine's own schema, beyond "consuming
authoritative data" into rewriting its output contract. Instead, the
one real actionable fact this task needs — "never present a prohibited
candidate as valid" — is satisfied by additionally excluding a
regulatory-prohibited candidate from the existing `noBlockingOnly`
UI filter, tracked locally by `materialCode` in
`SubstitutionPanel.tsx` only, never persisted, never a second scoring
source. With the REAL current seed catalog, this `false` branch cannot
actually fire yet (no ingredient-based KE/UG/TZ/RW/BI/SS rule has an
empty `productCategories`, so none can match a `"human_review_required"`
candidate) — an honest, disclosed, structural limitation identical in
kind to the generated-formula seam's own category-blindness, not a bug
in this session's wiring.

**Advanced Optimizer / System Substitution — confirmed by audit to be a
genuine, pre-existing, DOCUMENTED "not yet implemented" boundary, not a
duplicate-authority gap to close**: `packages/shared/src/schemas/
optimization.ts::regulatoryOptimizationPolicySchema.mode` is hard-locked
to the literal `"not_available"` — the solver ignores it and, per
`docs/architecture/IMPLEMENTATION_STATUS.md`'s own pre-existing text,
"honestly refuses `regulatory_uncertainty` rather than compute it from
nothing." This is the SAME kind of deliberate no-fabrication choice the
Compatibility/Safety `exclude_blocking`/`penalize` policies already make
when they DO have enough identity to check — the Optimizer's own
candidate material set has no reliable market/category resolution any
more than the generated-formula seam's does, so refusing rather than
guessing is the correct behavior, not a gap this task should force open.
Wiring the optimizer's own solver to actually consume a regulatory
policy would mean extending `runtime/formulation/advanced_optimizer.py`'s
constraint model itself — real new solver logic, explicitly beyond this
task's "smallest transport mapping" boundary. Only a stale doc comment
(dated to before the Regulatory Engine itself existed, incorrectly
implying the ENGINE was unimplemented rather than merely un-consumed
here) was corrected, with zero schema/behavior change — verified by the
full `packages/shared` test suite, unchanged count.
`packages/shared/src/engine/systemSubstitution.ts` has zero regulatory
references at all — confirmed by grep — since system-substitution
candidate evaluation routes entirely through this same Optimizer
(FVL-03.007's own established architecture), inheriting the identical,
already-documented gap rather than adding a new one.

**Compatibility and Safety confirmed to remain separate domains
throughout** — no merged findings, no shared verdict field, no opaque
combined score anywhere in this task's new code.

**Historical sessions carrying the legacy `card.regulatory` JSON open
without crashing, and the legacy payload never becomes current
authority** — proven by two rewritten `FormulationResultPage.test.tsx`
tests against the pre-existing SESSION_V6 fixture (which still carries a
real legacy `card.regulatory` object with a fabricated "rosemary" claim
finding and a "COMPLIANT_WITH_CONDITIONS" overall status): the Regulatory
tab shows neither the legacy claim text nor that legacy status, only the
freshly recomputed authoritative result — which, once the fixture's
brief was given a real `market: "kenya"` field (a legitimate test-data
completion, not a fixture rewrite to force a result), turned out to
legitimately produce its own real `KE-REG-003` (label_requirement)
`missing_data` finding via the exact same real, unmodified seed catalog
mechanism FVL-03.009's own SESSION_V6 test discovered for Safety.

**Closure-time single-authority grep re-audit (§25)**: `evaluate_regulatory`,
`evaluateRegulatory`, `regulatory status`, `regulatory verdict`,
`overall_status`, `compliance`, `not_verified`, `regulatoryClassification`,
`regulatoryRules` searched across `runtime/pipeline`, `runtime/formulation`,
`packages/shared/src`, `apps/desktop/src`, `apps/desktop/src-tauri/src`.
Zero live-code hits outside the one authoritative TS engine and its
already-confirmed-correct callers (`ApprovalPanel.tsx`/`RegulatoryPanel.tsx`,
both pre-existing and unrelated to generated formulas; `claims.ts`'s own
pre-existing, unrelated comment reference). The only remaining
`card.regulatory`/`overall_status` matches anywhere are explanatory
comments and disposable test fixtures documenting the retirement.

### Future FVL hardening — flagged for human review (not changed by this session beyond noted wording)

- **FVL-05.003-.008** ("Extractor: ..." rows): read-only/"reuse existing schema, never fork it" guarantee lives only in the FVL-05 package intro and FVL-05.013, not restated per-row. Left as-is (package intro already covers it); flagged in case a future session edits these rows in isolation without the intro's context.
- **FVL-06.001/.002** (new "structured measured-response schema"/"spectrophotometric/detergent-performance metric schema"): these define new schemas, but are explicitly downstream of existing `TestDefinition`/Laboratory linkage (FVL-06.005) and routed through the existing Data Exchange (FVL-06.006 says "no new import path" explicitly) — not a single-authority violation as written. Left as-is; a future implementation session should confirm these schemas extend `packages/shared/src/schemas/testDefinitions.ts`/`laboratory.ts` rather than forking a parallel result model.
- **FVL-07.008**: hardened this session (see tracker) — "deterministic/statistical/ML" candidate model comparison was ambiguous enough to risk being misread as a second deterministic ingredient-selection engine parallel to `engine.py`. Reworded to make clear this is prediction-model selection for FVL-07's performance target only.
- **FVL-08.005**: `Blocking = NO` even though its own wording is the single-authority guard for the Advanced Optimizer at the ranking stage. This session hardened the wording (see tracker) but deliberately did **not** change `Blocking` from `NO` to `YES` — that is a scope/gating decision beyond "harden wording," reserved for an explicit human decision, not made here. Flagged for future review.
- **FVL-09.001** ("Candidate experiment space definition over the existing formula/DOE model"): "candidate ... over the existing ... model" phrasing echoes `engine.build_candidate_pool()` language in a different domain (experiment selection, not ingredient selection). Not a true conflict — the FVL-09 package intro already clarifies "over the existing DOE + Laboratory architecture... Does not replace the DOE engine." Left as-is.

### Old / new formulation UI policy (restated, unchanged)

- `/live` (old UI, `FormulationWorkspaceV2`) and `/formulation-request` + `/formulation-result/:sessionId` (new UI) both remain available. Neither is removed by this or any FVL-03 session.
- Both UIs share the SAME active backend: `formulation_v2.rs` → `run_cli.py` → `pipeline.py` → `runtime/pipeline/engine.py` (the deterministic engine). There is exactly one active formulation-generation engine — this is itself a single-authority instance, now made explicit.
- Historical LLM-related code/settings (`provider`/`model`/`api_key` request fields, `llm.py`, etc.) may remain in the repository for the old UI's backward compatibility. Their presence is not permission to use them for current formulation generation — the active generation path remains zero-LLM, enforced by the existing permanent regression guard (FVL-11.007 re-confirms this at v1 closure).
- The old-vs-new UI retirement decision remains exactly where it was: `FVL-11.005`, made only after the new UI is proven stable across `FVL-11.002`/`FVL-11.003`. This correction session does not move that decision earlier and does not remove either UI.
