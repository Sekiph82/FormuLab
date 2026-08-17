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
  `materials.py::cost_formula()` is the exact reimplementation this
  principle forbids going forward — it predates this policy and is not
  removed in this audit-only session, but FVL-03.003 should retire it in
  favor of calling the real engine.
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
