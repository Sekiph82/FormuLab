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

**Confirmed real duplicate final-verdict engines (single-authority violations, targeted by FVL-03.009/.010):**

- **Safety**: `runtime/pipeline/safety.py::evaluate_safety()` (called `pipeline.py:846`) independently computes its own `overall_status` (`PASS`/`PASS_WITH_CONDITIONS`/`FAIL`/`DATA_INCOMPLETE`) from its own hazard tables (`_SENSITIZER_CLASS_INGREDIENTS`, GHS pH boundaries, its own rule IDs like `SAFETY-SENS-001`) — it never calls or consumes a result from `packages/shared/src/engine/safety.ts::evaluateSafety`, the confirmed-live authoritative engine (called from `SafetyPanel.tsx`, `ApprovalPanel.tsx`, `SubstitutionPanel.tsx`, `optimization.ts`).
- **Regulatory**: `runtime/pipeline/regulatory.py::evaluate_regulatory()` (called `pipeline.py:847`) is, per its own module docstring, "a direct, faithful port" of `packages/shared/src/catalog/regulatoryRules.ts`'s seed rule data into a second, independent Python evaluation engine (`SEED_REGULATORY_RULES`, `evaluate_rule()`) producing its own terminal `overall_status`. This is the clearest single-authority violation found — self-documented duplication, not accidental overlap.

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
| `runtime/pipeline/safety.py` | Independent, competing final safety verdict (`overall_status`) | `packages/shared/src/engine/safety.ts::evaluateSafety`/`classifyProductSafety` | FVL-03.009 | Yes — genuinely useful generation-time preprocessing (hazard-table lookups feeding the request) may be retained/merged into the authoritative engine's inputs; the competing final-verdict computation is what gets retired, not necessarily the whole file | Not deleted in this documentation-only session — code is in live use (`pipeline.py:846`). Consolidation happens in FVL-03.009's own implementation session, with regression tests proving one verdict, not two disagreeing ones |
| `runtime/pipeline/regulatory.py` | Independent, self-documented "faithful port" of the TS regulatory rule catalog into a second evaluation engine | `packages/shared/src/engine/regulatoryRules.ts::evaluateRegulatory` + `regulatoryClassification.ts` | FVL-03.010 | Yes — same reasoning as safety.py; claim-review preprocessing may be retained/merged, the competing rule universe/verdict is what gets retired | Not deleted in this documentation-only session — code is in live use (`pipeline.py:847`). Consolidation happens in FVL-03.010's own implementation session |
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
