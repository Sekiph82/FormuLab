# FormuLab FVL-03 — Unified Formulation Pipeline Integration — External Log

Active external log for FVL-03 integration work (Material Master, suppliers,
price history, inventory, Cost Engine, Optimizer, substitution,
Compatibility/Safety/Regulatory engines), on the Desktop, outside the git
repository — this project's standing per-topic convention (see the Phase
2-13 logs for precedent: a new, separate log per topic, never a reuse or
rename of another topic's log). Never moved into the repository, never
renamed.

---

## Session 0 — FVL-03.001 closure confirmation (2026-08-18)

### Scope

A fresh session opened with a full FVL-03.001 audit brief (Material Master
↔ `engine.build_candidate_pool()` integration-seam audit). Before doing any
new work, the brief's own instruction ("trust the actual repository state,
not this prompt") was followed: the repository was inspected end-to-end and
found that **FVL-03.001 was already fully completed in a prior session**,
with every acceptance criterion in the brief already satisfied. This
session performed no new audit work and made no production/doc changes to
the tracker, handoff pointer, or GitHub issue — it only confirms the
already-closed state and starts this log, which no FVL-tracker session had
used before.

### Branch / commit state

- Branch: `feature/laboratory-stability`.
- Starting HEAD: `2abec269ed9ac971146585a841f0980abf1cdf30`.
- Final HEAD: unchanged — `2abec269ed9ac971146585a841f0980abf1cdf30` (no new
  commit required; only this log file is new, and it is deliberately kept
  outside the repository per this convention).
- `git rev-parse HEAD` == `git rev-parse origin/feature/laboratory-stability`
  — both `2abec269ed9ac971146585a841f0980abf1cdf30`. Nothing ahead or behind.
- Recent relevant commits: `86e965a` ("docs(v1): close FVL-03.001 material
  master integration-seam audit"), `2abec26` ("docs: finalize FVL-03.001
  closure pointer with commit SHA").

### FVL-03.001 status

**COMPLETED** (prior session, 2026-08-18, commits `86e965a` + `2abec26`,
pushed). Confirmed in `docs/FORMULAB_V1_TASK_TRACKER.md:208` and
`docs/handoffs/FORMULAB_V1_CURRENT.md`. Full audit document:
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`.

### Canonical Material Master — source of truth

`packages/shared/src/schemas/materials.ts` defines the real Material
Master (`RawMaterial`, `Supplier`, `MaterialSupplier`, `MaterialPrice`
append-only history, `InventoryRecord`). Identity is `RawMaterial.code`
("stable forever" per the schema's own docstring) — display/trade
name/INCI are attributes, never identity. Persisted as flat JSON arrays
under `<project_root>/data/master/*.json`
(`apps/desktop/src-tauri/src/masterdata.rs`, write-then-atomic-rename),
read by the real Materials screen (`MaterialsPage.tsx` →
`listRecords("materials")`).

### Current Python material-data path

`engine.build_candidate_pool()` does **not** consume the canonical Material
Master. `runtime/pipeline/materials.py` is a second, independent, simpler
representation: a single flat `<materials_dir>/materials.json` (different
path AND shape from `data/master/materials.json`), populated by a live,
separate CSV-import screen (`MaterialsCard.tsx`, Settings → General),
confirmed disconnected from the canonical `MaterialsPage.tsx` path. This is
a genuine, pre-existing, live, user-reachable second source of truth — not
introduced by any FVL-03 session, and not yet closed.

### `build_candidate_pool()` input shape

Legacy row shape: `material_id, name, inci, cas, price, currency, unit,
supplier, stock, function, external_ref` — a flat, denormalized record
with price/supplier/stock embedded directly, no `Supplier` entity, no
`MaterialSupplier` relationship, no append-only `MaterialPrice` history, no
`InventoryRecord`.

### Identity mapping

Mismatch confirmed by code on both sides: canonical identity is
`RawMaterial.code`; the Python pool instead keys candidates on
`normalize_ingredient_key(inci or name)` — a normalized free-text string
with no relationship to `code`. The legacy row's own `material_id` survives
only as trailing trace provenance (`source_ids`), never as the actual pool
key.

### Fields currently used / missing

Used: `inci`/`name` (identity key), `function` (free-text role keyword
match), `price` (minor tie-break scoring bonus only, never real costing),
`material_id` (trace provenance only). Never reaches Python today: `code`,
`recommendedMinPercent`/`recommendedMaxPercent` (so `resolve_concentration()`'s
Tier 4 is proven dead code, `test_material_master_seam.py`, 4 tests),
`technicalMaxPercent`, `density`, `activeMatterPercent`, `ionicCharacter`,
`hlb`, `regulatoryStatuses`, `incompatibilities`, `substituteCodes`,
`documents`, `active`, `manufacturer`, `countryOfOrigin`, `casNumbers`
(plural), `hazardClassifications`, `allergens`.

### Duplicate-source-of-truth finding

Confirmed real and pre-existing: the legacy `data/materials.json` path is a
second material-master source of truth, live and user-reachable today. It
is the gap FVL-03.001 exists to document and FVL-03.002 exists to close —
not created by this or the prior FVL-03.001 session.

### Integration seam decided (required adapter, not implemented yet)

1. Read the canonical store directly (`data/master/*.json`), not a second
   one — no new database, no new file format.
2. Carry `code` across the seam as a real `material_code` field on
   `IngredientCandidate`/`SolvedIngredient`, in addition to (never instead
   of) existing INCI/name text matching.
3. The adapter transforms shape only — it must never compute a price,
   landed cost, or concentration range itself.
4. Never duplicate `MaterialPrice`/`Supplier` as new Python-owned
   structures; future display code should carry identity for the frontend
   to look up via `masterdata.ts::listRecords`, not a Python-side copy of a
   computed number.

### Cost Engine boundary

`packages/shared/src/engine/cost.ts::costFormula()` (keyed on
`materialCode`, real landed cost/exchange-rate/missing-data handling,
673-line tested suite) is the authoritative engine the future formulation
pipeline must call — confirmed NOT called from the AI-generation path
today. `materials.py::cost_formula()` is a separate, simpler, unrelated
reimplementation (flat price × kg, no landed cost, no exchange rate) —
retiring it is explicitly FVL-03.003's job, not FVL-03.001's or FVL-03.002's.

**Explicit statement: no new Cost Engine, Material Master, supplier
database, price table, or inventory database was created by FVL-03.001, or
by this confirmation session.** The existing platform capabilities
(`packages/shared/src/engine/cost.ts`, `packages/shared/src/schemas/
materials.ts`/`costing.ts`, `masterdata.rs`) remain the sole source of
truth throughout.

### Tasks intentionally deferred

- FVL-03.002 — wire supplier records + price history into candidate
  concentration/cost basis (one source of truth, no duplicated cost
  formula). Depends on FVL-03.001. **Not started.**
- FVL-03.003 — wire landed cost + exchange rates into a real
  cost-oriented strategy (reuse existing Cost Engine, no reimplementation).
  Depends on FVL-03.002.
- FVL-03.004 — wire inventory/raw-material availability into candidate
  feasibility. Depends on FVL-03.001 (not .002).
- FVL-03.005 through FVL-03.012 — Optimizer, substitution, Compatibility
  Engine, Safety/Regulatory reconciliation, integration regression suite —
  all still blank per the tracker, none touched this session.

### Files changed this session

- `docs/external-logs/FormuLab-FVL03-Integration-Log.md` (this file, new —
  kept outside the git repository per the external-log convention).
- No production code, no tracker/handoff/GitHub edits — all already
  correctly reflect FVL-03.001's closed state from the prior session.

### Tests / results

No code changed this session, so no new test run was performed. Results
already on record from the closing FVL-03.001 session: `python -m pytest
runtime/pipeline -q` — 378 passed, 5 subtests passed;
`packages/shared/src/engine/cost.test.ts` — 44/44 passing (re-verified
untouched); `git diff --check` clean; no Rust/TypeScript/frontend
production code changed, no rebuild performed.

### Tracker update

No change made — `docs/FORMULAB_V1_TASK_TRACKER.md:208` already reads
`FVL-03.001 | ... | COMPLETED (2026-08-18)` with full evidence text.
`docs/handoffs/FORMULAB_V1_CURRENT.md` already points "Current task:
FVL-03.002 — blank, NOT STARTED."

### GitHub update

No change made — GitHub issue #4's most recent comment already reports
"FVL-03.001 COMPLETED (commit 86e965a, doc pointer finalized in 2abec26,
both pushed)" with the full audit summary, test counts, and "Next:
FVL-03.002 (supplier/price wiring) — NOT started this session."

### Commit SHA

None created this session (nothing to commit in the git repository — this
log is deliberately kept outside it, per convention, and the user
confirmed leaving all other pre-existing working-tree changes untouched as
unrelated to this task).

### Push result

Not applicable — no repository commit was made this session. Repository
HEAD already matches `origin/feature/laboratory-stability` from the prior
session's push.

### Exact next frozen task (Session 0)

**FVL-03.001 COMPLETED**

**NEXT: FVL-03.002 — NOT STARTED**

---

## Session 1 — SINGLE-AUTHORITY architecture correction (2026-08-18)

### Scope

Roadmap/architecture correction only, explicitly before FVL-03.002
implementation. No `FVL-12` created, no engine created, FVL-03.002 not
started, no other blank FVL task marked `ON PROCESS`.

### Branch / commit state

- Branch: `feature/laboratory-stability`.
- Starting HEAD: `2abec269ed9ac971146585a841f0980abf1cdf30`.
- Final HEAD: `fd09a943cc8d6064b8e9680c661622cd9225c046`.
- `git rev-parse HEAD` == `git rev-parse origin/feature/laboratory-stability`
  — both `fd09a943cc8d6064b8e9680c661622cd9225c046`. Nothing ahead/behind.

### Architecture-correction status

Complete. Adopted the SINGLE-AUTHORITY rule (every business domain has
exactly one authoritative engine/source of truth; a pipeline-local adapter
transports/reshapes data only, never recomputes a business decision) in
`docs/FORMULAB_V1_FINAL_SCOPE.md`'s new "Single-authority principle"
section.

### Authoritative domain map (summary — full table in
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`)

Material/Supplier/Price/Inventory → `materials.ts`/`masterdata.rs`/
`data/master/*.json`. Cost → `cost.ts`. Compatibility → `compatibility.ts`.
Safety → `safety.ts`. Regulatory → `regulatoryRules.ts`+
`regulatoryClassification.ts`. Advanced Optimizer →
`formulation_advanced.rs`/`advanced_optimizer.py`. Material/System
substitution → `substitution.ts`/`systemSubstitution.ts`. DOE/Laboratory/
Stability/Data Exchange → their respective `packages/shared/src/engine/*`
modules, TS-only, no Python duplication found. Formula generation
(deterministic, zero-LLM) → `runtime/pipeline/engine.py`. Predictive
performance → none yet, genuinely new, FVL-07 only.

### Duplicate findings

- **Material**: confirmed pre-existing gap (from Session 0's FVL-03.001
  audit, not new) — `runtime/pipeline/materials.py` is a second material
  representation feeding generation today; FVL-03.002's job to close.
- **Cost**: confirmed pre-existing gap (Session 0) —
  `materials.py::cost_formula()` is a separate reimplementation;
  FVL-03.003's job to retire/bypass.
- **Safety**: **new finding this session** — `runtime/pipeline/safety.py`
  independently computes its own final `overall_status` verdict from its
  own hazard tables, never consuming `packages/shared/src/engine/
  safety.ts::evaluateSafety`'s result. Real duplicate authority. Targeted
  by FVL-03.009.
- **Regulatory**: **new finding this session** — `runtime/pipeline/
  regulatory.py`'s own module docstring calls itself "a direct, faithful
  port" of the TS regulatory rule catalog into a second, independent
  evaluation engine with its own terminal verdict. Real duplicate
  authority, most clear-cut case found. Targeted by FVL-03.010.
- **Compatibility**: **confirmed NOT a duplicate** —
  `runtime/pipeline/rules.py::validate()`/`derive_constraints()` implement
  only generation-request constraints (excluded ingredients, sulfate-free,
  pH bounds); no chemical/material compatibility logic exists in this
  file. Not a competing engine against `packages/shared/src/engine/
  compatibility.ts`. FVL-03.008 hardened to reflect this explicitly.

### Optimizer classification

`runtime/pipeline/engine.py` (deterministic candidate generation/selection)
and `advanced_optimizer.py`/`formulation_core.py` (mathematical LP/MILP
solve of an already-chosen material set, PuLP/CBC) confirmed as two
different, legitimate responsibilities with zero code-level overlap —
`engine.py` never imports `pulp`/`PuLP`/`CBC`. FVL-03.005's wording
hardened to also say "not a merge into `engine.py`."

### Old/new UI policy

Restated, unchanged: `/live` (old UI) and `/formulation-request`+
`/formulation-result/:sessionId` (new UI) both remain. Both share the SAME
active backend (`formulation_v2.rs` → `run_cli.py` → `pipeline.py` →
`engine.py`). `FVL-11.005` still owns the retirement decision — not moved
earlier, neither UI removed this session.

### Zero-LLM policy / historical LLM compatibility

Active formulation generation remains zero-LLM (`engine.py`). Historical
`provider`/`model`/`api_key` request fields and `llm.py` NOT removed this
session — their presence is not permission to use them for current
generation. New roadmap/architecture wording uses "Deterministic
Formulation Engine" (`engine.py`) and "Predictive Performance Engine"
(future FVL-07), avoiding "AI generation" terminology going forward;
historical comments/files may keep old terminology.

### Roadmap sections changed

- `docs/FORMULAB_V1_FINAL_SCOPE.md` — new "Single-authority principle"
  section after the Scope-change policy.
- `docs/FORMULAB_V1_TASK_TRACKER.md` — FVL-03 package intro + all of
  FVL-03.002 through FVL-03.012 reworded with exact repository
  names/paths (no dependency or status values changed). `FVL-07.008`
  reworded (prediction-model comparison, not a second ingredient-selection
  engine). `FVL-08.005` wording strengthened, `Blocking` left `NO`
  (deliberate — a scope decision not made this session).
- `docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md` — new sections:
  Authoritative domain map, Duplicate-authority audit results, Legacy
  retirement matrix, Future FVL hardening (flagged rows), Old/new
  formulation UI policy restatement.
- `docs/handoffs/FORMULAB_V1_CURRENT.md` — new "Architecture correction"
  section; Current-task note updated; commit SHA pointer updated.

### FVL-03.002 status

Blank, **NOT STARTED**. Not begun this session, per explicit instruction.

### Future FVL hardening performed

Audited FVL-04 through FVL-11 tracker wording for the same duplicate-
authority pattern. No implementation. Two rows hardened (FVL-07.008,
FVL-08.005 — see above). Three additional ambiguities identified and
documented as flagged-for-review in the architecture doc without editing
(FVL-05.003-.008 extractor rows, FVL-06.001/.002 new schemas, FVL-09.001
phrasing) — all already resolved at the package-intro level, left as-is to
avoid unnecessary tracker churn.

### Legacy retirement matrix summary

Full table in `docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`. Six rows:
`materials.py` legacy storage (→ FVL-03.002), `materials.py::cost_formula`
(→ FVL-03.003), `materials.rs` legacy commands (decision point, not
auto-scheduled), `safety.py` (→ FVL-03.009), `regulatory.py` (→
FVL-03.010), `rules.py` (not legacy — stays permanently, confirmed
legitimate). No deletion scheduled prematurely — retirement gated on the
authoritative replacement being wired and regression-tested, same
philosophy as keeping `/live` until the new UI is proven stable.

### Files changed

`docs/FORMULAB_V1_FINAL_SCOPE.md`, `docs/FORMULAB_V1_TASK_TRACKER.md`,
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`,
`docs/handoffs/FORMULAB_V1_CURRENT.md`. No production code touched. Stray
pre-existing working-tree changes (`docs/generated/*`, `formulas/*`
deletions, untracked Phase11-13 logs) left untouched, unrelated to this
session, per standing decision from the prior session.

### Tests / results

Documentation/tracker-only session — no pytest/cargo/vitest run performed
(no production code changed, matches this project's "don't run massive
suites for doc-only sessions" policy). Tracker validation and diff-check
were the applicable checks (see below).

### Tracker validation result

`python scripts/validate_v1_tracker.py` → `OK: 157 unique tasks across 11
work packages, no drift found.` (run both before and after all edits).

### `git diff --check` result

Clean — only pre-existing LF→CRLF line-ending warnings on the touched
files (not errors), no whitespace-conflict markers.

### GitHub issue update

Commented on issue #4 (`https://github.com/Sekiph82/FormuLab/issues/4#issuecomment-5324760713`)
— architecture-correction summary: single-authority rule adopted, FVL-03.001
remains closed, FVL-03.002 remains not started, confirmed duplicate
findings (safety.py, regulatory.py) and confirmed non-duplicate (rules.py),
retirement targets, old/new UI policy, zero-LLM policy. No new issue
created.

### Commit SHA

`c2ef4e5b6b279fcee475399490986a58208945ab` — "docs(v1): enforce
single-authority integration architecture". `fd09a943cc8d6064b8e9680c661622cd9225c046`
— "docs: finalize architecture-correction closure pointer with commit SHA".

### Push result

Both commits pushed to `origin/feature/laboratory-stability`. No force
push, no history rewrite. Local HEAD == remote HEAD ==
`fd09a943cc8d6064b8e9680c661622cd9225c046`.

### Exact next frozen task (Session 1)

**FVL-03 SINGLE-AUTHORITY ARCHITECTURE CORRECTION COMPLETED**

**FVL-03.002 — NOT STARTED**

---

## Session 2 — FVL-03.002 implementation (2026-08-18)

### Scope

Canonical Material Master / supplier linkage into the AI-generation
candidate pool, under the single-authority rule adopted in Session 1.
FVL-03.003/.004 and all later FVL-03 tasks NOT started; no
`safety.py`/`regulatory.py`/`rules.py` touched (those are
FVL-03.008/.009/.010).

### Branch / commit state

- Branch: `feature/laboratory-stability`.
- Starting HEAD: `fd09a943cc8d6064b8e9680c661622cd9225c046`.
- Final HEAD: `fcb7cdcfbb0df3953708db942b5c94958d643c3c`.
- `git rev-parse HEAD` == `git rev-parse origin/feature/laboratory-stability`
  — both `fcb7cdcfbb0df3953708db942b5c94958d643c3c`. Nothing ahead/behind.

### FVL-03.002 status

**COMPLETED.** New `runtime/pipeline/master_materials_adapter.py` —
shape-only adapter reading `data/master/{materials,material_suppliers,
suppliers,material_prices}.json` directly (bare canonical JSON arrays, no
new storage). Filters `active` (schema default `true`, only explicit
`false` excludes) — the sole filtering point.

### Canonical Material Master source of truth / storage path

Unchanged from Session 0/1: `packages/shared/src/schemas/materials.ts` +
`apps/desktop/src-tauri/src/masterdata.rs`, `<project_root>/data/master/
*.json`, identity `RawMaterial.code`. Confirmed collection registry
(`masterdata.rs:126-135`): `materials`, `suppliers`, `material_prices`
(append-only), `material_suppliers`.

### Current Python material-data path

Now the canonical one. `pipeline.py`'s `materials_dir` (semantics updated
in a comment) is read via `master_materials_adapter.load_master_materials()`
— replaces the prior `materials.load_materials(materials_dir).get(
"materials", [])` call entirely for the generation path. `import materials`
removed from `pipeline.py` (no longer used there); the legacy module
remains used by `materials.rs`'s own CSV-import/costing commands,
untouched.

### `build_candidate_pool()` input shape

Adapter rows: `code`/`material_code` (new identity), `name`, `inci`, `cas`,
`external_ref` (= `code`), `function`, `active`, `manufacturer`,
`country_of_origin`, `recommended_min_pct`/`recommended_max_pct`/
`technical_max_pct` (only when present — missing stays missing),
`material_supplier_refs` (full raw set), `material_price_refs` (full raw
set), and `supplier` (display string) only when the canonical `preferred`
field already makes it unambiguous. **No `price`/`currency` key is ever
set** — the deliberate single-authority boundary for this task.

### Identity mapping

`RawMaterial.code` now crosses the seam as `IngredientCandidate.
material_code` → `SolvedIngredient.material_code` →
`traceability.selected_event()`'s `source_ids` (preferred over the legacy
`material_id` string when present) → the rendered formula ingredient's own
`material_code` field. Carried in addition to, never instead of, the
existing `normalize_ingredient_key(inci or name)` pool-key matching —
proven by an added assertion in `test_material_master_seam.py`'s existing
identity-mismatch test (extended, not rewritten; the legacy-path assertion
it originally proved stays true and unchanged).

### Fields now used / still not wired

Now used (new this session): `code`, `recommended_min_pct`,
`recommended_max_pct`, `technical_max_pct`, `active`. Still not wired
(explicitly deferred): any `price`/`currency`/landed-cost value
(FVL-03.003), `InventoryRecord` stock/reservation (FVL-03.004),
`regulatoryStatuses`/`hazardClassifications`/`incompatibilities`/
`substituteCodes`/`documents` (FVL-03.006/.008/.009/.010).

### Duplicate-source-of-truth findings

None new. The adapter is shape-only, reads the canonical files directly,
writes nothing, invents no new identity, and does not implement
`cost.ts::priceFor()`'s selection logic — proven by
`test_no_price_key_is_ever_set_price_refs_pass_through_unselected` (two
price rows for one material, neither selected, both passed through raw).
Supplier "preferred" surfacing reuses the canonical `MaterialSupplier.
preferred` field only when it is already unambiguous — proven by three
tests (zero preferred, two preferred, exactly one preferred).

### Exact integration seam decided (implemented)

Matches FVL-03.001's own "REQUIRED ADAPTER/SEAM" section exactly: reads
the canonical store directly (no second store), carries `code` as real
identity alongside existing text matching, transforms shape only (never
computes a price/landed cost/concentration range itself — the
`recommended_min_pct`/`recommended_max_pct`/`technical_max_pct` values are
canonical record fields passed straight through, not computed), and does
not duplicate `MaterialPrice`/`Supplier` as a new Python-owned structure.

### Cost Engine boundary

Unchanged, still deliberately not implemented here.
`packages/shared/src/engine/cost.ts::costFormula()`/`buildCostSnapshot()`
remain the sole future caller target for FVL-03.003. This session's own
adapter explicitly does not select a price, compute landed cost, or touch
exchange rates — verified by test, not merely by omission.

**Explicit statement: no new Cost Engine, Material Master, supplier
database, price table, or inventory database was created this session.**
The canonical store remains the sole source of truth throughout;
`master_materials_adapter.py` owns no business data.

### Tasks intentionally deferred

FVL-03.003 (real Cost Engine/landed-cost/FX wiring), FVL-03.004 (inventory
wiring), FVL-03.005 through FVL-03.012 (optimizer, substitution,
Compatibility Engine, Safety/Regulatory consolidation, integration
regression suite) — all still blank, none touched this session.

### Files changed

`runtime/pipeline/master_materials_adapter.py` (new),
`runtime/pipeline/test_master_materials_adapter.py` (new),
`runtime/pipeline/pipeline.py`, `runtime/pipeline/engine.py`,
`runtime/pipeline/provenance.py`, `runtime/pipeline/test_pipeline.py`,
`runtime/pipeline/test_engine.py`,
`runtime/pipeline/test_material_master_seam.py`,
`apps/desktop/src-tauri/src/formulation_v2.rs`,
`docs/FORMULAB_V1_TASK_TRACKER.md`, `docs/handoffs/FORMULAB_V1_CURRENT.md`.
Stray pre-existing working-tree changes (`docs/generated/*`, `formulas/*`
deletions, untracked Phase11-14 logs) left untouched, unrelated, per
standing decision.

### Tests / results

`python -m pytest runtime/pipeline -q` — 393 passed, 5 subtests (up from
378+5 at Session 0; 15 new tests: 11 in
`test_master_materials_adapter.py`, 3 `technical_max_pct` clamp tests in
`test_engine.py`, 1 new end-to-end Tier-4 test in `test_pipeline.py`; 2
existing tests extended in place, not counted as new). `cargo check` —
clean (28.39s). `cargo test masterdata:: formulation_v2::` — 18 + 10 = 28
passing. Materialize-list regression check: reproduced the exact Rust
`materialize_pipeline()` embedded-file set in a disposable temp directory,
`python -c "import pipeline"` succeeded with no `ImportError` — the same
verification method FVL-02.009 used, applied proactively here since a new
module (`master_materials_adapter.py`) was added to that list.

### Tracker validation result

`python scripts/validate_v1_tracker.py` → `OK: 157 unique tasks across 11
work packages, no drift found.` (run before and after all edits).

### `git diff --check` result

Clean — only pre-existing LF→CRLF line-ending warnings on touched files,
no whitespace-conflict markers.

### GitHub issue update

Two comments on issue #4: session-start ("Starting FVL-03.002...") and
completion (`https://github.com/Sekiph82/FormuLab/issues/4#issuecomment-5324989550`)
— full summary matching this log entry. No new issue created.

### Commit SHA

`e3e238051e8c5b890b46c3abebaf834f4712b49c` — "feat(v1): FVL-03.002
canonical Material Master into generation (single-authority)".
`fcb7cdcfbb0df3953708db942b5c94958d643c3c` — "docs: finalize FVL-03.002
closure pointer with commit SHA".

### Push result

Both commits pushed to `origin/feature/laboratory-stability`. No force
push, no history rewrite. Local HEAD == remote HEAD ==
`fcb7cdcfbb0df3953708db942b5c94958d643c3c`.

### Exact next frozen task (Session 2)

**FVL-03.002 COMPLETED**

**NEXT: FVL-03.003 — NOT STARTED**

---

## Session 3 — FVL-03.003 implementation (2026-08-18)

### Scope

Wire the existing authoritative Cost Engine (`packages/shared/src/engine/
cost.ts`) into the AI-generation formulation pipeline. FVL-03.004 and all
later FVL-03 tasks NOT started; no Safety/Regulatory/Compatibility
integration touched (those are FVL-03.008/.009/.010).

### Branch / commit state

- Branch: `feature/laboratory-stability`.
- Starting HEAD: `fcb7cdcfbb0df3953708db942b5c94958d643c3c`.
- Final HEAD: `426c9a196b7225e1a1e025536fdea9c9dd643f25`.
- `git rev-parse HEAD` == `git rev-parse origin/feature/laboratory-stability`
  — both `426c9a196b7225e1a1e025536fdea9c9dd643f25`. Nothing ahead/behind.

### FVL-03.003 status

**COMPLETED.**

### Authoritative Cost Engine path/functions used

`packages/shared/src/engine/cost.ts::buildCostSnapshot()` (which itself
calls `costFormula()`, `priceFor()`, `findRate()`, `landedUnitCost()`,
`conversionCost()`, `costSku()` internally) — called directly, unmodified,
from a new thin TS wrapper. No Cost Engine source file was touched.
`cost.test.ts` (673 lines, 8 describe blocks) re-verified green, unchanged.

### Actual bridge architecture

**Client-side, post-generation** — confirmed the only architecturally real
option by audit: `run_cli.py` is a one-shot stdin→stdout subprocess
(`formulation_v2.rs`'s `generate_formulation` writes one JSON request,
reads one JSON reply — no back-channel), so Python cannot call `cost.ts`
synchronously during generation. New `apps/desktop/src/lib/
generatedFormulaCost.ts::costGeneratedFormula(sessionId, version, formula,
batchKg, currency, {materials, prices, rates, profile})` reshapes a
generated card's `formula.ingredients[]` into `FormulationLine[]` (via
`linesFromGeneratedFormula()`) and calls `buildCostSnapshot()` — zero
business logic of its own, proven by test to return the identical result a
direct `buildCostSnapshot()` call would. Never persisted (`opts.code:
"live"`, matching `CostPanel.tsx`'s own established non-persisted "live"
snapshot convention) — a generated session card has no real
`formulationId`/`versionId` until a human saves it as a `Formulation`.

### Cost-oriented strategy integration

`cost_optimized` (one of 9 real `strategy.py` strategies — confirmed
complete list this session: `balanced`, `sensitive_skin`, `cost_optimized`,
`premium_sensory`, `natural_origin`, `regulatory_conservative`,
`simplified_manufacturing`, `low_raw_material_count`, `max_performance`)
stays exactly what it was — a legitimate generation-time concentration-bias
heuristic (`engine.py::_pick_within_range`, biases to the bottom of a
resolved range), reading no real price. NOT touched. Real cost comparison
happens entirely client-side, after generation: new pure
`apps/desktop/src/lib/costComparison.ts::pickCheapestValidVersion(cards,
snapshots)` picks the lowest-`totalManufacturingCost` version among those
that are both not `invalid_*` (`formula_state`, the exact convention
`FormulationResultPage.tsx` already used for its own status badge) and
completely costed (zero `missingDataWarnings` — an incomplete/lower-bound
total is never eligible to be crowned "cheapest"). `strategy.py::
compute_version_score` has no cost term and was not given one — cost
comparison is additive UI-layer logic, not a change to the deterministic
engine's own scoring.

### materialCode join behavior

`apps/desktop/src/lib/formulations.ts::linesFromGeneratedFormula()` now
sets `FormulationLine.materialCode` from the generated ingredient's
`material_code` (the field FVL-03.002 added). Proven by test: exact-code
join works; a same-display-name "decoy" material carrying a price is NEVER
matched by text similarity — only the real `material_code` join succeeds,
confirming `costFormula`/`priceFor` never fall back to name matching; an
ingredient with no resolvable `material_code` stays unresolved
(`missingReason: "no_price"`) rather than being costed against the wrong
material.

### Price-history handling

No Python `_price_for()` clone — confirmed by design (the adapter layer
from FVL-03.002 already refused to select a price; this session's bridge
similarly never selects one itself, it only passes real `MaterialPrice[]`
straight into `buildCostSnapshot()`, which does its own real selection via
`priceFor()`). Acceptance-style tests proved: current price used when
live; missing price → `missingReason: "no_price"`, formula stays valid,
warning present, no zero assumed.

### FX handling

Mixed-currency line with a real exchange rate present costs correctly
(Acceptance B). Missing exchange rate → `missingReason: "no_exchange_rate"`,
result incomplete, never a 1:1 assumption (Acceptance D) — both proven by
calling the real engine with a deliberately incomplete `rates` array, not
by asserting a hand-computed expected number.

### Landed-cost handling

Untouched — `buildCostSnapshot()`'s own `landedUnitCost()`/
`conversionCost()` logic runs exactly as it does for `CostPanel.tsx`'s
manual formula editor. No factory profile is passed for a generated
(not-yet-saved) card, so `conversionCost()`'s own honest "raw-material
cost only, not manufacturing cost" warning appears — expected, not a bug
(a test initially asserted zero warnings and was corrected to expect this
real, documented engine behavior instead).

### CostSnapshot/persistence behavior

No new persistence — a generated session card has no real
`formulationId`/`versionId` until saved as a `Formulation`; `CostPanel.tsx`'s
existing `upsertRecords("cost_snapshots", ...)` save flow already handles
that case once a card is promoted, untouched by this session. No new cost
DTO invented — `CostSnapshot`/`CostLine` (canonical schema) used as-is.

### Formula-version cost scoping

Every version/card in a session is costed independently at the SAME
batch size/currency (state lifted to `FormulationResultPage`'s top level),
so switching versions shows that version's own real cost, never a stale
one from another version — and "cheapest valid" compares like with like
across the whole session.

### Legacy `materials.py::cost_formula()` status

**DELETED** (not bypassed), along with `render_costing_markdown()`. Sole
production caller was `materials_cli.py`'s `"cost"` action, also deleted.
Sole test coverage (`test_materials.py::CostingTests`, 7 tests) removed —
the function it tested no longer exists. `materials.py`'s storage/import
functions (`parse_materials`/`load_materials`/`save_materials`/
`match_material`) remain, unchanged — still back the unrelated Settings →
General CSV-import screen.

### `materials.rs::cost_formulation` status

**DELETED**, along with its `lib.rs` `generate_handler!` registration.
`materials.rs::import_materials`/`list_materials` (a separate command
family backing the same CSV-import screen) untouched.

### Duplicate business-logic audit

None found in the new code — `costGeneratedFormula()` and
`pickCheapestValidVersion()` were read back against the single-authority
rule during design: neither selects a price, computes landed cost, or
does FX conversion; both are pure shape/comparison glue over the real
engine's own real output.

### Zero-LLM result

Unaffected — no LLM touched anywhere in this session; costing is 100%
deterministic arithmetic (the same guarantee `cost.ts`'s own design
already provides).

### Acceptance A-G results

- **A** (complete cost, same currency): proven via
  `generatedFormulaCost.test.ts`'s wiring-equivalence test.
- **B** (mixed currency + valid FX): proven, no missing-price/FX warning,
  real raw material cost produced.
- **C** (missing price): formula stays valid, cost incomplete,
  `missingReason: "no_price"`, warning present, no zero assumed.
- **D** (missing FX): `missingReason: "no_exchange_rate"`, incomplete,
  never 1:1 assumed.
- **E** (two valid alternatives, cost differs): `pickCheapestValidVersion`
  picks the cheaper one — proven by unit test.
- **F** (cheapest violates a hard constraint): a cheaper but
  `invalid_constraint_violation` candidate never wins — proven by unit
  test (the more expensive valid one wins instead).
- **G** (historical session without cost metadata): satisfied by
  construction — cost is computed on-the-fly client-side from existing
  card JSON only, no session-storage schema changed, nothing new is
  required on disk for a session to open. Not separately automated-tested
  (no new fixture needed since nothing about session loading changed).

### Tests / results

`python -m pytest runtime/pipeline -q` — 386 passed, 5 subtests (down from
393 — 7 obsolete `CostingTests` removed, matches the deleted function).
`cargo check` — clean. `cargo test` — 345/345 passing (full suite, since
`materials.rs`/`lib.rs` changed — no dedicated Rust test existed for
`cost_formulation` before deletion, confirmed by audit, so the full check
was the real gate). `pnpm --filter @formulab/shared test` — 1302/1302
(`cost.test.ts` re-verified untouched — zero new tests added there, per
the explicit "don't duplicate expected-value formulas the authoritative
engine can already prove" instruction). `pnpm --filter @formulab/desktop
test` — 1287/1287 (19 new: `generatedFormulaCost.test.ts` 6,
`costComparison.test.ts` 5, `formulations.test.ts` 2,
`CostSnapshotSummary.test.tsx` 3, plus the 8-locale i18n parity suite
re-verified green after 2 new translation keys were added to all 8
locales — English/6 others as English-text placeholders matching this
project's own established convention for un-translated additions, Turkish
given a real translation since that locale already carries real
translations for the adjacent `cost.*` keys). `pnpm --filter
@formulab/desktop typecheck` / `lint` — clean. `git diff --check` — clean.

No live Tauri-app smoke test was performed this session (would require a
running native build + real session data) — verification relied on the
automated suites above plus a new component-render test
(`CostSnapshotSummary.test.tsx`) proving real, non-crashing rendering with
real i18n lookups. Disclosed honestly, not claimed as a full UI
walkthrough.

### Tracker update

`docs/FORMULAB_V1_TASK_TRACKER.md` — `FVL-03.003` marked `COMPLETED
(2026-08-18)` with full evidence. `python scripts/validate_v1_tracker.py`
— OK, 157 tasks, no drift (run before and after all edits).

### GitHub update

Two comments on issue #4: session-start ("Starting FVL-03.003...") and
completion (`https://github.com/Sekiph82/FormuLab/issues/4#issuecomment-5326122604`)
— full summary matching this log entry. No new issue created.

### Build/shortcut result

Not applicable — no desktop rebuild/installer performed this session
(dev-mode `cargo check`/`typecheck` covers the changed surface; nothing in
this task's own acceptance criteria required a shipped binary, matching
the standing "full rebuild reserved for closure sessions" policy).

### Files changed

New: `apps/desktop/src/lib/generatedFormulaCost.ts` (+`.test.ts`),
`apps/desktop/src/lib/costComparison.ts` (+`.test.ts`),
`apps/desktop/src/lib/formulations.test.ts`,
`apps/desktop/src/hooks/useMasterCostData.ts`,
`apps/desktop/src/components/cost/CostSnapshotSummary.tsx` (+`.test.tsx`).
Modified: `apps/desktop/src/lib/formulations.ts`,
`apps/desktop/src/lib/formulationV2.ts`,
`apps/desktop/src/components/thread/CostingPanel.tsx`,
`apps/desktop/src/app/routes/FormulationResultPage.tsx`,
`apps/desktop/src-tauri/src/materials.rs`,
`apps/desktop/src-tauri/src/lib.rs`, all 8
`apps/desktop/src/i18n/locales/*/session.json`,
`runtime/pipeline/materials.py`, `runtime/pipeline/materials_cli.py`,
`runtime/pipeline/test_materials.py`,
`docs/FORMULAB_V1_TASK_TRACKER.md`,
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`,
`docs/handoffs/FORMULAB_V1_CURRENT.md`. Stray pre-existing working-tree
changes (`docs/generated/*`, `formulas/*` deletions, untracked Phase logs)
left untouched, unrelated, per standing decision.

### Commit SHA

`8fec21d2f6e020c149ba3b2728f60d03369d2dab` — "feat(v1): integrate
authoritative Cost Engine into formulation pipeline".
`426c9a196b7225e1a1e025536fdea9c9dd643f25` — "docs: finalize FVL-03.003
closure pointer with commit SHA".

### Push result

Both commits pushed to `origin/feature/laboratory-stability`. No force
push, no history rewrite. Local HEAD == remote HEAD ==
`426c9a196b7225e1a1e025536fdea9c9dd643f25`.

### Exact next frozen task (Session 3)

**FVL-03.003 COMPLETED**

**NEXT: FVL-03.004 — NOT STARTED**

---

## Session 4 — FVL-03.004 implementation (2026-08-18)

### Scope

Wire canonical `InventoryRecord` availability into AI-generation candidate
feasibility, read-only, client-side. FVL-03.005 and all later FVL-03
tasks NOT started; no Safety/Regulatory/Compatibility work touched; no
substitution logic implemented (that is FVL-03.006's job, not this one's).

### Branch / commit state

- Branch: `feature/laboratory-stability`.
- Starting HEAD: `426c9a196b7225e1a1e025536fdea9c9dd643f25`.
- Final HEAD: `a12f5095f30c2bc32aa32426097b9ad580e59566`.
- `git rev-parse HEAD` == `git rev-parse origin/feature/laboratory-stability`
  — both `a12f5095f30c2bc32aa32426097b9ad580e59566`. Nothing ahead/behind.

### FVL-03.004 status

**COMPLETED.**

### Authoritative `InventoryRecord` path/schema

`packages/shared/src/schemas/materials.ts:221-242` — `inventoryRecordSchema`.
Confirmed exact field set: `code`, `materialCode`, `warehouse` (default
`"main"`), `lot?`, `supplierLot?`, `quantity` (on-hand, decimalString,
required), `unit` (default `"kg"`), `reservedQuantity` (decimalString,
default `"0"`), `manufacturedAt?`, `expiresAt?`, `coaStatus` (enum
`received|pending|not_required|missing`, default `"pending"`),
`quarantined` (boolean, default `false`), `released` (boolean, default
`false`), `unitCost?`, `currency?`, `updatedAt`, `notes?`. No field stores
a usable/available quantity — always derived. Persisted at
`data/master/inventory.json` via `masterdata.rs`'s generic
`list_master_records`/`upsert_master_records` (not append-only, no
dedicated command).

### Actual inventory integration seam

Client-side, post-generation, read-only — identical architecture to
FVL-03.003's cost wiring, confirmed with the user as the deliberate
choice over extending `master_materials_adapter.py` to read inventory
(which would have required either duplicating the availability formula in
Python or piping in pre-computed numbers — neither with real precedent).
`master_materials_adapter.py` is UNCHANGED — still reads only
`materials.json`/`material_suppliers.json`/`suppliers.json`/
`material_prices.json`, never `inventory.json`. Python remains entirely
inventory-blind.

### `material_code` join behavior

`apps/desktop/src/lib/generatedFormulaInventory.ts::evaluateGeneratedFormulaInventory()`
joins purely on `FormulationLine.materialCode` (via the existing
`linesFromGeneratedFormula()` reuse, same field FVL-03.002/.003 already
carry). Proven by test (`generatedFormulaInventory.test.ts` "Acceptance
D"): a same-display-name "decoy" material carrying real inventory under a
DIFFERENT `materialCode` is never matched — the correct material stays
`UNKNOWN` ("no inventory record for this material"), never silently
costed/joined against the wrong stock. An ingredient with no resolved
`material_code` at all also stays `UNKNOWN`, never text-matched.

### Canonical inventory fields used

`materialCode` (join key), `quantity`, `reservedQuantity`, `quarantined`,
`released`, `expiresAt`, `unit`. `coaStatus` is deliberately NOT gated on
— its business meaning ("pending" blocking or not) is undefined by the
schema and by every pre-existing caller; surfaced for potential future
display only, never used to include/exclude a lot. This is a disclosed
judgment call, not a silently invented semantic.

### Availability semantics

New canonical, single derivation:
`packages/shared/src/engine/inventoryAvailability.ts::evaluateMaterialAvailability()`.
A lot is usable iff `!quarantined && released && (!expiresAt || not yet
expired as of the date asked about)`. `usableQuantity = Σ max(0, quantity
− reservedQuantity)` over usable lots sharing one unit. Three distinct,
tested outcomes: (1) no `InventoryRecord` at all for the material →
`hasRecords: false`, genuinely UNKNOWN, never zero; (2) records exist but
every lot is blocked (quarantined/unreleased/expired) → `hasRecords: true`,
`usableQuantity: 0` — a real, computed fact (quarantined/released are
known booleans, not missing data), not UNKNOWN; (3) usable lots span more
than one unit → `usableQuantity: undefined`, never silently summed across
incompatible units. Before this task, three UI call sites
(`MaterialsPage.tsx`, `AdvancedOptimizerPanel.tsx`,
`SubstitutionPanel.tsx`) each re-implemented `quantity − reservedQuantity`
inline with NONE of this filtering — confirmed by audit. This module is
the one canonical definition for new code; the three pre-existing call
sites are untouched, out of scope, no regression risk introduced.

### Required-quantity calculation behavior

`requiredQty = (percent / 100) × batchKg`, using the SAME numeric,
user-editable `batchKg` state FVL-03.003 already lifted to
`FormulationResultPage.tsx`'s top level (shared with costing — one batch
control, not two). The original brief's free-text `estimatedBatchSize`
field is NOT used — confirmed by audit to be purely decorative in Python
today (text-heuristics only in `manufacturing.py`/`strategy.py`, never
parsed as a number anywhere in `runtime/pipeline/`).

### Unknown vs. insufficient behavior

Per-ingredient: no `material_code` → `UNKNOWN` ("ingredient not resolved
to a canonical material"). Has `material_code` but no inventory record →
`UNKNOWN` ("no inventory record for this material"). Usable quantity
undefined (mixed units) → `UNKNOWN`. `batchKg` not a valid positive finite
number → `UNKNOWN` ("batch size is not a usable number") — material
existence is still knowable, sufficiency stays unknown, quantities are
never fabricated. Otherwise: `usableQuantity >= requiredQty` →
`AVAILABLE`, else `INSUFFICIENT`. Formula-level: any `INSUFFICIENT` line →
`INFEASIBLE`; else any `UNKNOWN` line → `UNKNOWN`; else `FEASIBLE` — the
exact precedence the task specified, applied to the ingredients actually
present in the rendered formula (client-side code has no access to
Python's internal REQUIRED/PREFERRED/OPTIONAL role tiers — a disclosed
simplification).

### Batch-size handling

See "Required-quantity calculation behavior" above — no free-text parsing
of `estimatedBatchSize` was added or attempted; the existing numeric
`batchKg` UI control (already real, already validated by FVL-03.003) is
reused as-is.

### Candidate preference/filter behavior

Satisfied at the VERSION level, not inside `engine.py`'s per-role
candidate loop (Python stays inventory-blind by design — decided
explicitly with the user before implementation). New
`apps/desktop/src/lib/inventoryComparison.ts::pickMostInventoryFeasibleVersion()`
mirrors `pickCheapestValidVersion`'s own pattern exactly: eligible =
not `generation_failed`, not `invalid_*` `formula_state`; returns the
first eligible version whose inventory state is `FEASIBLE`, or
`undefined` if none — an infeasible or merely-unknown version is never
returned as "the best available anyway" (same choice
`pickCheapestValidVersion` makes for an incomplete cost total). No
per-ingredient-role candidate swapping was implemented — confirmed by
reading the diff, `engine.py` was not touched.

### Hard-required unavailable behavior

Not specially handled — inventory feasibility is purely an additional,
separate, informational/preference dimension on top of formulas the
deterministic engine already produced. It never removes an ingredient,
never invents a substitute, and never causes a formula to be regenerated
or altered. A version with a hard-required-but-unavailable ingredient is
simply marked `INFEASIBLE` and excluded from `pickMostInventoryFeasibleVersion`'s
eligible set — the formula itself is preserved and still fully viewable,
matching the task's "retain/flag honestly, never invent a substitute"
requirement.

### Formula-level inventory feasibility

Exposed via `FormulaInventoryFeasibility.formulaState` (`feasible` |
`infeasible` | `unknown`), computed once per version in
`FormulationResultPage.tsx`, displayed in the Summary tab
(`InventoryFeasibilitySummary`) and as a `VersionSummaryCard` badge/row,
plus an inline per-version indicator in the version-card grid.

### Cost/inventory dimensional separation

Proven by a dedicated joint test
(`generatedFormulaInventory.test.ts`, "Acceptance I"): the same formula
costed via `costGeneratedFormula()` and evaluated via
`evaluateGeneratedFormulaInventory()` independently produces a real,
non-zero `rawMaterialCost` AND a separately-computed `INFEASIBLE`
inventory state, with neither function's result influencing the other.
`pickCheapestValidVersion` and `pickMostInventoryFeasibleVersion` remain
two entirely separate functions/badges — audited to confirm neither reads
the other's output; no combined score exists anywhere.

### Legacy `materials.py` `stock` status

Confirmed (by audit, re-confirmed by grep this session): parsed into a
float on the legacy CSV-import row (`_ALIASES["stock"]`,
`materials.py:42,131`ish) but read by nothing else anywhere in
`runtime/pipeline/*.py` — stored-but-unused dead data on the legacy,
non-authoritative path. A one-line doc comment was added at its parsing
site classifying it explicitly non-authoritative, pointing at the real
canonical source (`InventoryRecord`). Not deleted — deleting an unrelated,
harmless legacy field would be gratuitous churn outside this task's scope.

### Mutation audit — generation is read-only

Confirmed by `grep -r "upsertRecords(.inventory" apps/desktop/src` across
every file this session touched: **zero matches**. No code path
introduced this session reserves, decrements, allocates, or otherwise
writes to `InventoryRecord`. `useInventoryData.ts` only ever calls
`listRecords("inventory")`.

### Zero-LLM result

Unaffected — no LLM touched anywhere this session; inventory feasibility
is 100% deterministic arithmetic/comparison, same guarantee as cost.

### Acceptance A-I results

- **A** (sufficient inventory): `AVAILABLE`, formula `FEASIBLE` — proven
  by test.
- **B** (usable inventory below required amount): `INSUFFICIENT`, formula
  `INFEASIBLE` — proven by test.
- **C** (material exists, no `InventoryRecord`): `UNKNOWN`, never zero,
  never available — proven by test.
- **D** (same-display-name decoy has stock, correct `material_code` does
  not): no false join, stays `UNKNOWN` — proven by test.
- **E** (two defensible candidates, one available one definitively
  unavailable): the available VERSION is preferred by
  `pickMostInventoryFeasibleVersion` — proven by test (candidate-level
  swapping inside one formula was explicitly not implemented — see
  "Candidate preference/filter behavior" above; this is satisfied at
  version granularity, matching the confirmed architecture decision).
- **F** (hard-required material unavailable, no valid substitution):
  formula retained/flagged honestly, no substitute invented — proven by
  test (`inventoryComparison.test.ts` Acceptance F: an invalid-hard-rule
  version is never preferred even if it looks inventory-feasible; a
  merely-infeasible-but-otherwise-valid version is preserved and shown,
  never silently dropped).
- **G** (no usable batch size): `UNKNOWN`, never a fabricated required kg
  — proven by test.
- **H** (historical session without inventory annotations): satisfied by
  construction — inventory is computed on-the-fly client-side from
  existing card JSON only, no session-storage schema changed.
- **I** (costed-but-unavailable formula): cost result stays real,
  inventory dimension separately indicates infeasibility — proven by
  joint test (see "Cost/inventory dimensional separation" above).

### Tests / results

`pnpm --filter @formulab/shared test` — 1311/1311 passing (9 new in
`inventoryAvailability.test.ts`; full existing suite re-verified, since a
new file was added to the same package as `cost.ts`/`substitution.ts`).
`pnpm --filter @formulab/desktop test` — 1303/1303 passing (16 new:
`generatedFormulaInventory.test.ts` 9, `inventoryComparison.test.ts` 4,
plus the 8-locale i18n parity suite re-verified green after adding 7 new
translation keys to each locale file — English placeholder text for
6 languages matching this project's established convention, Turkish
given a real translation). `pnpm --filter @formulab/desktop typecheck` /
`lint` — clean. `python -m pytest runtime/pipeline -q` — 386 passed, 5
subtests — IDENTICAL to the FVL-03.003 baseline, confirming Python was
genuinely untouched (only a non-functional doc comment on the legacy
`stock` field). `cargo check` — clean, unchanged (no Rust edits this
session at all).

### Tracker update

`docs/FORMULAB_V1_TASK_TRACKER.md` — `FVL-03.004` marked `COMPLETED
(2026-08-18)` with full evidence. `python scripts/validate_v1_tracker.py`
— OK, 157 tasks, no drift (run before and after all edits).

### `git diff --check` result

Clean — only pre-existing LF→CRLF line-ending warnings on touched files,
no whitespace-conflict markers.

### GitHub update

Two comments on issue #4: session-start ("Starting FVL-03.004...") and
completion (`https://github.com/Sekiph82/FormuLab/issues/4#issuecomment-5327125265`)
— full summary matching this log entry. No new issue created.

### Build/shortcut result

Not applicable — no desktop rebuild/installer performed this session (no
Rust or shipped-runtime code changed at all; TS/shared changes fully
covered by `typecheck`/`lint`/vitest, matching the standing "full rebuild
reserved for closure sessions" policy).

### Files changed

New: `packages/shared/src/engine/inventoryAvailability.ts` (+`.test.ts`),
`apps/desktop/src/lib/generatedFormulaInventory.ts` (+`.test.ts`),
`apps/desktop/src/lib/inventoryComparison.ts` (+`.test.ts`),
`apps/desktop/src/hooks/useInventoryData.ts`,
`apps/desktop/src/components/inventory/InventoryFeasibilitySummary.tsx`.
Modified: `packages/shared/src/index.ts` (export),
`apps/desktop/src/app/routes/FormulationResultPage.tsx`, all 8
`apps/desktop/src/i18n/locales/*/session.json`,
`runtime/pipeline/materials.py` (doc comment only),
`docs/FORMULAB_V1_TASK_TRACKER.md`,
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`,
`docs/handoffs/FORMULAB_V1_CURRENT.md`. Stray pre-existing working-tree
changes (`docs/generated/*`, `formulas/*` deletions, untracked Phase logs)
left untouched, unrelated, per standing decision.

### Commit SHA

`ff923227a5bfe6b7347e36d842268f2562882fc5` — "feat(v1): integrate
canonical inventory feasibility".
`a12f5095f30c2bc32aa32426097b9ad580e59566` — "docs: finalize FVL-03.004
closure pointer with commit SHA".

### Push result

Both commits pushed to `origin/feature/laboratory-stability`. No force
push, no history rewrite. Local HEAD == remote HEAD ==
`a12f5095f30c2bc32aa32426097b9ad580e59566`.

### Exact next frozen task (Session 4)

**FVL-03.004 COMPLETED**

**NEXT: FVL-03.005 — NOT STARTED**

---

## Session 5 — FVL-03.005 implementation (2026-08-18)

### Scope

Wire the EXISTING Advanced Optimizer (`runtime/formulation/
advanced_optimizer.py` / `apps/desktop/src-tauri/src/formulation_advanced.rs`)
as an optional post-generation refinement of a selected formulation
alternative. No subagents used this session, per explicit instruction —
all research via direct Read/Grep/Bash/Glob. FVL-03.006 and all later
FVL-03 tasks NOT started; no substitution/Compatibility/Safety/Regulatory
integration touched; `/live` not removed; no LLM formulation generation
re-enabled.

### Branch / commit state

- Branch: `feature/laboratory-stability`.
- Starting HEAD: `a12f5095f30c2bc32aa32426097b9ad580e59566`.
- Final HEAD: `0a32b83`.
- `git rev-parse HEAD` == `git rev-parse origin/feature/laboratory-stability`
  — both `0a32b83`. Nothing ahead/behind.

### FVL-03.005 status

**COMPLETED.**

### Authoritative Advanced Optimizer path

`runtime/formulation/advanced_optimizer.py` (1732 lines) + `apps/desktop/
src-tauri/src/formulation_advanced.rs`. Confirmed by module docstring:
"additive; the simple optimizer is untouched, keeps its own CLI/Tauri
command" — distinct from `formulation_core.py`'s simple LP.

### Existing solver implementation reused

Real MILP/PuLP/CBC solver already supports composition/functional/ratio/
conditional constraints, property targets, locked percentages,
exclusions, real `materialCode` identity
(`Material.code = raw.get("materialCode") or self.id`), caller-computed
`compatibilityRiskScore`/`safetyRiskScore` ("the solver never invents
one" — the module's own comment), honest `stock`/`reservedStock`/
`availableStock`, weighted/lexicographic multi-objective support
restricted to a real `SUPPORTED_METRICS` set (excludes
`performance_score`/`regulatory_uncertainty`, deferred to FVL-07, never
fabricated), structured `status` outcomes (`optimal`/`infeasible`/
`unbounded`/`timeout`/`error`/`feasible_with_penalties`) with
`_diagnose_infeasibility()`. **Zero lines of this file changed.**

### Optimizer input contract

`packages/shared/src/schemas/optimization.ts::formulationProblemSchema`
— confirmed `projectId: z.string().min(1)` and
`productFamilyId: z.string().min(1)` both non-optional (the schema
itself, not merely convention, at the one real call site
`AdvancedOptimizerPanel.tsx:271-272`).

### Selected-version integration seam

New pure `apps/desktop/src/lib/promoteGeneratedFormula.ts::buildPromotedFormulation(session, card, batchKg)`
builds a real `Formulation`/`FormulationVersion` from the card's own real
data, using the codebase's existing `newFormulation()`/`newVersion()`/
`linesFromGeneratedFormula()` helpers (`formulations.ts`) — zero new
persistence shape or mapping logic. New "Optimize / Refine" quick action
on `FormulationResultPage.tsx` (handler `onOptimize`) calls the existing
`saveFormulation()`/`saveFormulationVersion()` Tauri wrappers, caches the
promoted `formulation.id` per card version in memory (`useState<Record
<string,string>>`, avoids duplicate `Formulation` records on repeat
clicks within one visit), then `navigate(`/optimization?project=${id}`)`
— landing in the existing, completely unmodified `OptimizationPage.tsx`
→ `AdvancedOptimizerPanel.tsx`.

### materialCode mapping

Unchanged, reused as-is from FVL-03.002/.003:
`linesFromGeneratedFormula()` already sets `FormulationLine.materialCode`
from the generated ingredient's `material_code` field. Proven carried
through by test (`promoteGeneratedFormula.test.ts`: a `material_code`
present on the source ingredient survives onto the promoted version's
line).

### Objective mode used/reused

Neither new nor selected by this task — `AdvancedOptimizerPanel.tsx`'s
existing weighted/lexicographic objective configuration UI is reused
completely unmodified; this task's own new code (`promoteGeneratedFormula.ts`,
the `onOptimize` handler) never constructs or touches an
`OptimizationObjective`/`formulationProblemSchema` object at all — that
remains entirely the existing panel's own responsibility, post-promotion.

### Hard-constraint preservation

Inherited, not reimplemented — since promotion only creates the
`Formulation`/`FormulationVersion` records the existing panel already
expects, every hard constraint (exclusions, `technicalMaxPercent`,
`regulatoryMaxPercent`, locked percentages, mass balance) is enforced
exactly as it already is for any other project opened in
`AdvancedOptimizerPanel.tsx` — none of this task's new code touches
constraint-building logic.

### Cost-input behavior

Unchanged/inherited — the existing panel already sources cost inputs
from the authoritative Cost Engine (FVL-03.003); this task adds no cost
logic of its own.

### Inventory interaction

Unchanged/inherited — the existing panel already sources availability
from canonical `InventoryRecord`/FVL-03.004's derivation; this task adds
no inventory logic of its own.

### Generated-vs-saved persistence decision

**Require save-first** (decided with the user via `AskUserQuestion`,
over an "old-UI-only this session" alternative). A generated AI session
card is never optimizer-eligible in its raw, unsaved form — "Optimize /
Refine" promotes it into a real, persisted `Formulation`/
`FormulationVersion` first (via the existing `saveFormulation()`/
`saveFormulationVersion()` calls, the same persistence path any other
save in this app uses), never fabricating a placeholder `projectId` to
force the schema to accept an unsaved card.

### Source-formula immutability

Confirmed: `buildPromotedFormulation()` is pure (no Tauri/network call
inside it — proven by test) and only ever reads `session.brief`/
`session.id`/the selected `card`; no code path in the changed files
writes back to session storage. Confirmed by diff review (only
`session.brief`/`session.id` reads appear in the diff, no `session.*`
assignment). Two versions of a session remain independent by
construction — optimizing one promoted version never touches another
card or session record.

### Solver failure/infeasibility behavior

Unchanged/inherited — the existing `advanced_optimizer.py`'s own
`status: infeasible`/`_diagnose_infeasibility()` path and
`AdvancedOptimizerPanel.tsx`'s existing rendering of that state are
reused completely unmodified; this task introduces no new
success/failure handling.

### Substitution non-implementation confirmation

Confirmed not touched — no `substitution.ts`/`systemSubstitution.ts`
call, import, or reference exists anywhere in this task's new/changed
code (`promoteGeneratedFormula.ts`, `FormulationResultPage.tsx`'s diff).

### Zero-LLM result

Unaffected — no LLM touched anywhere this session;
`buildPromotedFormulation()` is pure data construction from the
session's own already-generated, deterministic formula.

### Acceptance A-J results

A/B/C/D/E/F/G/H/J are satisfied by construction/inheritance — since
promotion routes into the existing, completely unmodified
`AdvancedOptimizerPanel.tsx`/`advanced_optimizer.py`, every one of those
cases (real optimize result with source unchanged; two versions
independent; hard ceiling/exclusion preserved; cost minimization uses
authoritative cost; known infeasibility handled honestly with no
substitution; mathematically infeasible → solver reports infeasible, no
fake result; unresolved `materialCode` → no fabricated identity;
optimization never overwrites the source card/`FormulationVersion`) are
already covered by that existing component's own pre-existing test
suite, re-run this session as regression (not re-proven from scratch —
matches this project's own "don't duplicate an authoritative engine's
own proofs" instruction). This task's own narrow, newly-tested proof
burden: promotion produces a real, `materialCode`-preserving
`Formulation`/`Version` (Acceptance-adjacent to A), honestly falls back
to `"general"` rather than fabricating a specific product family when
the brief's category is empty, and performs no Tauri/network call
(pure) — all 5 proven in `promoteGeneratedFormula.test.ts`. Historical
session without an optimizer result (case I in the task's own lettering,
folded into this list) still opens by construction — no session-storage
schema was changed by this task.

### Tests / results

`pnpm --filter @formulab/desktop test` — 1308/1308 passing across 145
files (5 new: `promoteGeneratedFormula.test.ts`;
`AdvancedOptimizerPanel.test.tsx`/`OptimizationPage.test.tsx` unmodified
and green, confirming zero behavior change to the reused workflow).
`pnpm --filter @formulab/desktop typecheck` / `lint` — clean.
`packages/shared`, `runtime/formulation`, `apps/desktop/src-tauri/src/
formulation*` confirmed untouched by `git status`/diff this session — no
dedicated shared/pytest/cargo run performed (nothing in those trees
changed; last real baselines, from the FVL-03.004 session: `pnpm
--filter @formulab/shared test` 1311/1311, `python -m pytest
runtime/pipeline -q` 386 passed/5 subtests, `cargo check` clean).

### Tracker update

`docs/FORMULAB_V1_TASK_TRACKER.md` — `FVL-03.005` marked `COMPLETED
(2026-08-18)` with full evidence. `python scripts/validate_v1_tracker.py`
— OK, 157 tasks, no drift (run before and after all edits).

### `git diff --check` result

Clean — only pre-existing LF→CRLF line-ending warnings on touched files,
no whitespace-conflict markers.

### GitHub update

One start comment on issue #4 (recorded in the prior session summary,
before this log's Session 5 entry existed) and one completion comment
(`https://github.com/Sekiph82/FormuLab/issues/4#issuecomment-5328470853`)
— full summary matching this log entry. No new issue created.

### Build/shortcut result

Not applicable — no desktop rebuild/installer performed this session (no
Rust or shipped-runtime code changed at all; TS/shared changes fully
covered by `typecheck`/`lint`/vitest, matching the standing "full
rebuild reserved for closure sessions" policy).

### Files changed

New: `apps/desktop/src/lib/promoteGeneratedFormula.ts` (+`.test.ts`).
Modified: `apps/desktop/src/app/routes/FormulationResultPage.tsx`, all 8
`apps/desktop/src/i18n/locales/*/session.json`,
`docs/FORMULAB_V1_TASK_TRACKER.md`,
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`,
`docs/handoffs/FORMULAB_V1_CURRENT.md`. Stray pre-existing working-tree
changes (`docs/generated/*`, `formulas/*` deletions, untracked Phase
logs) left untouched, unrelated, per standing decision.

### Commit SHA

`f90f61d` — "feat(v1): integrate Advanced Optimizer refinement".
`0a32b83` — "docs: finalize FVL-03.005 closure pointer with commit SHA".

### Push result

Both commits pushed to `origin/feature/laboratory-stability`. No force
push, no history rewrite. Local HEAD == remote HEAD == `0a32b83`.

### Exact next frozen task (Session 5)

**FVL-03.005 COMPLETED**

**NEXT: FVL-03.006 — NOT STARTED**

---

## Session 6 — FVL-03.006 implementation (2026-08-18)

### Scope

Wire the EXISTING material substitution engine
(`packages/shared/src/engine/substitution.ts`) as an entry point for a
generated-formula ingredient that never resolved to a canonical
`materialCode`, or that FVL-03.004 confirms is definitively inventory-
insufficient. No subagents used this session, per explicit instruction —
all research via direct Read/Grep/Bash. Material (one-to-one)
substitution only — FVL-03.007 (system substitution) and all later
FVL-03 tasks NOT started; no Compatibility/Safety/Regulatory
consolidation touched; `/live` not removed; no LLM formulation
generation re-enabled.

### Branch / commit state

- Branch: `feature/laboratory-stability`.
- Starting HEAD: `0a32b83caba14860ec447ba40fc9024a6324e61a`.
- Final HEAD: `6a92f6f`.
- `git rev-parse HEAD` == `git rev-parse origin/feature/laboratory-stability`
  — both `6a92f6f`. Nothing ahead/behind.

### FVL-03.006 status

**COMPLETED.**

### Authoritative Material Substitution Engine path/functions

`packages/shared/src/schemas/substitution.ts` (domain model) +
`packages/shared/src/engine/substitution.ts` (`scoreCandidate`,
`buildCandidateRecord`, `rankCandidates`, `activeEquivalentPercent`) —
fully specified in `docs/MATERIAL_SUBSTITUTION.md`. UI:
`apps/desktop/src/components/formula/SubstitutionPanel.tsx`'s
`SubstitutionDialog`, mounted project-bound in `FormulasPage.tsx` (`/live`)
and `FormulationPage.tsx` (`/formulation`). **Zero lines of any of these
changed.**

### Substitution input contract

`substitutionRequestSchema` — confirmed `projectId`/`formulaVersionId`
both non-optional (`z.string().min(1)`), same shape of gap FVL-03.005
already resolved for the Advanced Optimizer.
`SubstitutionCandidateInput`/`SubstitutionTarget` (`engine/substitution.ts`)
— every field optional except identity; a caller assembles these from
real `RawMaterial`/`MaterialPrice`/`InventoryRecord`/`Supplier` records
(already done by `SubstitutionPanel.tsx`, unmodified).

### Source materialCode behavior

Unresolved source (no `materialCode` on the formula line) already
handled honestly by the existing `SubstitutionPanel.tsx`:
`target.materialId = line.materialId ?? line.id`,
`target.materialCode = line.materialCode ?? ""` — pre-existing fallback,
exercised by the pre-existing formula builder for ANY line missing a
resolved material, confirmed by audit, not a new mechanism added this
session. No fabricated source material code anywhere.

### Candidate materialCode behavior

Unchanged — `engine/substitution.ts` scores/ranks candidates by real
`materialCode` only (`buildCandidateRecord`'s `id:
\`${target.materialId}->${candidate.materialId}\``,
`rankCandidates`'s tie-break on `materialCode`), never display-name/
trade-name similarity.

### Trigger conditions

New pure `apps/desktop/src/lib/generatedFormulaInventory.ts::shouldOfferSubstitution(line)`:
`true` only for (A) `!line.materialCode` (unresolved) or (B)
`line.state === "insufficient"` (FVL-03.004-confirmed definitive
insufficiency); `false` for every other `state === "unknown"` case (no
inventory record for an otherwise-resolved material, mixed-unit lots, an
unusable batch size) — proven by 6 new tests covering all three UNKNOWN
sub-cases, both real triggers, and the "fully available" negative case.

### Inventory interaction

Read-only — reuses the exact FVL-03.004 canonical result
(`IngredientAvailabilityLine`) already computed for the active card; no
new inventory computation, no stock mutation/reservation/allocation
anywhere in this session's code (confirmed by grep: no `upsertRecords`
call in any changed file). `SubstitutionPanel.tsx`'s own existing
candidate-availability logic (canonical `listRecords("inventory")`,
unmodified) is what actually populates candidate `availableStockKg`.

### Cost interaction

Unchanged/inherited — `SubstitutionPanel.tsx`'s existing `priceFor()`
call (canonical `MaterialPrice`/`cost.ts` semantics) is what populates
candidate `landedCost`; this session's new code introduces no cost
computation of its own.

### Compatibility/safety/regulatory boundary

Untouched — `SubstitutionPanel.tsx`'s existing
`evaluateCompatibility()`/`evaluateSafety()` re-run per candidate
(`compatibility_impact`/`safety_impact` dimensions) is unmodified; no new
compatibility/safety/regulatory logic was added anywhere this session,
and no Phase 14 Python safety/regulatory logic was duplicated.

### Concentration handling

Unchanged/inherited — `buildCandidateRecord()`'s existing
`activeEquivalentPercent()` (returns `undefined`, never a guessed 1:1
swap, when either active-matter percentage is unknown) and its existing
`technicalMaxPercent` cap on `suggestedPercent` are untouched; this
session added no concentration-conversion logic of its own.

### Generated-vs-saved persistence decision

Same seam FVL-03.005 established: `promoteGeneratedFormula.ts::buildPromotedFormulation()`
reused unchanged. The in-memory promotion cache in
`FormulationResultPage.tsx` was widened from "formulation id only" to
the full `{formulation, version}` pair so the Optimizer and Substitution
entry points share one promoted project per generated version (never two
`Formulation` records for one click-session) and so a "Find substitute"
click can resolve the promoted version's own persisted line id by array
index — guaranteed aligned to the generated formula's own ingredient
order, since both are built from the same `card.formula.ingredients`
array via the same `linesFromGeneratedFormula()`.

### Human-selection behavior

Unchanged — the existing `SubstitutionDialog` still requires an explicit
"Apply" click per candidate; nothing in this session's code auto-selects
or auto-applies a candidate. The new "Find substitute" button only
navigates to and opens that existing dialog.

### Source formula immutability

Confirmed by construction and by diff review: the new
`FormulationResultPage.tsx::onFindSubstitute` handler only reads
`session.brief`/`session.id`/`card` (same pattern as FVL-03.005's
`onOptimize`) — no `session.*` assignment appears anywhere in the
changed files. Only new `Formulation`/`FormulationVersion` records are
ever created by promotion.

### Substitution run/version traceability

Unchanged/inherited — `SubstitutionPanel.tsx`'s existing `apply()` writes
an immutable `substitution_runs` record (request + every scored
candidate + the selection) BEFORE touching anything, then updates only
the working DRAFT (`useFormulationWorkspace.ts::onApplySubstitution`) —
never the saved `FormulationVersion` the draft was derived from. A
chemist must still take an explicit "Save Version" action for the
substitution to become part of formulation history.

### No-candidate behavior

Unchanged/inherited — `SubstitutionPanel.tsx` already renders
`t("substitution.noCandidates")` when the scored/filtered candidate list
is empty; nothing in this session's code fabricates a replacement.

### System substitution non-implementation confirmation

Confirmed by grep: `systemSubstitution.ts`, `generateSystemCandidates`,
`buildSystemSubstitutionProblem`, `scoreSystemResult` are never
referenced by any code added this session. FVL-03.007 remains untouched
and NOT started.

### Zero-LLM result

Unaffected — no LLM touched anywhere this session; `shouldOfferSubstitution()`
is a pure boolean predicate over already-computed, deterministic
inventory-feasibility data.

### Acceptance A-J results

A/D/E/F/G/H/I/J are satisfied by construction/inheritance — since the
new entry point routes into the existing, completely unmodified
`SubstitutionDialog`/`engine/substitution.ts`, every one of those cases
(real ranked candidate returned, nothing auto-applied; candidate identity
stays `materialCode`-based against a same-name decoy; correct real-
dimension ranking when the cheapest candidate is inventory-infeasible;
explicit no-candidate result, never fabricated; a `technicalMaxPercent`
violation can never be silently applied; preview-vs-real-lifecycle
distinction honored via the same promotion seam as FVL-03.005; source
formula/version unchanged with new-run traceability; historical session
still opens) are already covered by that existing component's own
pre-existing test suite (`SubstitutionPanel.test.tsx`), re-run this
session as regression, not re-proven from scratch. This task's own new
proof burden — the B/C trigger boundary itself (offer on definitive
insufficiency, never on generic UNKNOWN) — is covered by the new
`shouldOfferSubstitution` predicate tests plus new
`InventoryFeasibilitySummary.test.tsx` (button shown only for A/B
triggers, never for UNKNOWN or a fully available line, click reports the
correct ingredient index, no button without a wired callback, only the
in-flight row shows a busy/disabled state).

### Tests / results

`pnpm --filter @formulab/desktop test` — 1321/1321 passing across 146
files (13 new: 6 in `generatedFormulaInventory.test.ts`'s
`shouldOfferSubstitution` block, 7 in new
`InventoryFeasibilitySummary.test.tsx`; `SubstitutionPanel.test.tsx`/
`FormulationPage.test.tsx` unmodified and green, confirming zero
behavior change to the reused engine/dialog). `pnpm --filter
@formulab/desktop typecheck` / `lint` — clean. `packages/shared`,
`runtime/formulation`, `runtime/pipeline`, `apps/desktop/src-tauri/src/
formulation*` confirmed untouched by `git status`/diff this session — no
dedicated shared/pytest/cargo run performed (nothing in those trees
changed; last real baselines, from the FVL-03.004 session: `pnpm
--filter @formulab/shared test` 1311/1311, `python -m pytest
runtime/pipeline -q` 386 passed/5 subtests, `cargo check` clean).

### Tracker update

`docs/FORMULAB_V1_TASK_TRACKER.md` — `FVL-03.006` marked `COMPLETED
(2026-08-18)` with full evidence. `python scripts/validate_v1_tracker.py`
— OK, 157 tasks, no drift (run before and after all edits).

### GitHub update

One start comment
(`https://github.com/Sekiph82/FormuLab/issues/4#issuecomment-5328811716`)
and one completion comment
(`https://github.com/Sekiph82/FormuLab/issues/4#issuecomment-5329078359`)
on issue #4 — full summary matching this log entry. No new issue
created.

### Build/shortcut result

Not applicable — no desktop rebuild/installer performed this session (no
Rust or shipped-runtime code changed at all; TS/shared changes fully
covered by `typecheck`/`lint`/vitest, matching the standing "full
rebuild reserved for closure sessions" policy).

### Files changed

New: `apps/desktop/src/components/inventory/InventoryFeasibilitySummary.test.tsx`.
Modified: `apps/desktop/src/app/routes/FormulationPage.tsx`,
`apps/desktop/src/app/routes/FormulationResultPage.tsx`,
`apps/desktop/src/components/inventory/InventoryFeasibilitySummary.tsx`,
`apps/desktop/src/lib/generatedFormulaInventory.ts` (+`.test.ts`), all 8
`apps/desktop/src/i18n/locales/*/session.json`,
`docs/FORMULAB_V1_TASK_TRACKER.md`,
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`,
`docs/handoffs/FORMULAB_V1_CURRENT.md`. Stray pre-existing working-tree
changes (`docs/generated/*`, `formulas/*` deletions, untracked Phase
logs) left untouched, unrelated, per standing decision.

### Commit SHA

`4693041` — "feat(v1): integrate material substitution workflow".
`6a92f6f` — "docs: finalize FVL-03.006 closure pointer with commit SHA".

### Push result

Both commits pushed to `origin/feature/laboratory-stability`. No force
push, no history rewrite. Local HEAD == remote HEAD == `6a92f6f`.

### Exact next frozen task (Session 6)

**FVL-03.006 COMPLETED**

**NEXT: FVL-03.007 — NOT STARTED**

---

## Session 7 — FVL-03.007 implementation (2026-08-18)

### Scope

Wire the EXISTING system substitution engine
(`packages/shared/src/engine/systemSubstitution.ts`) into the formulation
workflow as an entry point for a human-selected, multi-ingredient
functional system. No subagents used this session, per explicit
instruction — all research via direct Read/Grep/Bash. System (multi-
material) substitution only — FVL-03.008 and all later FVL-03 tasks NOT
started; no Compatibility/Safety/Regulatory consolidation touched; `/live`
not removed; no LLM formulation generation re-enabled.

### Branch / commit state

- Branch: `feature/laboratory-stability`.
- Starting HEAD: `6a92f6fdb0f5257a464585dc8d42b0ce29ed94f7`.
- Final HEAD: `837f7b6`.
- `git rev-parse HEAD` == `git rev-parse origin/feature/laboratory-stability`
  — both `837f7b6`. Nothing ahead/behind.

### FVL-03.007 status

**COMPLETED.**

### Authoritative System Substitution Engine path/functions

`packages/shared/src/engine/systemSubstitution.ts`
(`generateSystemCandidates`, `buildSystemSubstitutionProblem`,
`scoreSystemResult`) + `packages/shared/src/schemas/substitution.ts`
(`systemCandidateLimitsSchema`, `rejectedSystemCandidateSchema`, the
system-mode fields on `substitutionRequestSchema`) — fully specified in
`docs/SYSTEM_SUBSTITUTION.md`. UI: the SAME `SubstitutionDialog`
(`SubstitutionPanel.tsx`) FVL-03.006 already wired an entry point into —
its pre-existing system-mode section (select 2+ lines → Generate →
Evaluate → Apply). **Zero lines of any of these changed.**

### System substitution input contract

Same `substitutionRequestSchema` FVL-03.006 already audited —
`projectId`/`formulaVersionId` non-optional. System-specific fields
(`lineIds`, `materialIds`, `preserveFunctions`, `maxReplacementMaterials`,
`costCeiling`, `requireStock`, `requireApprovedSupplier`,
`preferKenyaLocal`) all pre-existing, all optional, all already consumed
by the existing dialog's `buildRequest()`/`generateSystems()`/
`runSystemProposals()`.

### Source system identification

Confirmed by audit (`docs/SYSTEM_SUBSTITUTION.md`): there is NO fixed
chemistry taxonomy anywhere in this platform (no hardcoded "surfactant
system"/"preservative system"/etc.). A system is whichever set of ≥2
formula lines a human explicitly checks in the dialog's own checklist —
membership is 100% human-identified, never auto-detected, by design. New
UI (checkboxes + action bar on the generated-formula ingredient table)
lets a chemist make that selection before the dialog even opens, but the
identification itself remains entirely human-driven both before and
after — nothing in this session's new code attempts automatic system
detection.

### Source materialCode behavior

Unchanged — the existing `buildRequest()`/`generateSystems()` already use
`sourceLines.map(l => l.materialCode ?? l.id)`, the same honest fallback
FVL-03.006 confirmed for the one-to-one case; no fabricated source
identity anywhere.

### Replacement materialCode behavior

Unchanged — `generateSystemCandidates` builds candidate materials by real
`materialCode` only (never name similarity); `scoreSystemResult` and the
applied `newLines` construction read `materialCode` straight from the
real optimizer result.

### Multi-material/ratio behavior

Unchanged/inherited — every replacement system's percentages come
directly from the real Advanced Optimizer's own solve
(`buildSystemSubstitutionProblem`→`advanced_optimizer.py`), never a
locally-fabricated proportional-scaling guess. Technical maximums, stock
limits, and the soft active-contribution-preservation constraint are all
pre-existing, unmodified engine behavior.

### Trigger conditions

Purely human-selected — a chemist checks 2+ ingredient rows in the new
multi-select UI (`FormulaTab`, `FormulationResultPage.tsx`); the "System
substitution" action is disabled below 2 selections so a one-material
problem can never be routed into system mode (§5's explicit boundary).
No automatic detection heuristic was added or needed.

### Inventory interaction

Unchanged/inherited — the existing dialog's own `requireStock` filter and
per-candidate stock data (canonical `InventoryRecord`) are untouched; no
new inventory computation, no stock mutation anywhere in this session's
code (confirmed by grep: no `upsertRecords("inventory", ...)` in any
changed file).

### Cost interaction

Unchanged/inherited — the existing dialog's own `priceFor()`/cost-ceiling
handling (canonical `MaterialPrice`/`cost.ts` semantics, real
recalculation by the solver) is untouched; this session's new code
introduces no cost computation of its own.

### Compatibility/safety/regulatory boundary

Untouched — the existing `blockingExclusionConstraints` call (caller-
computed hard exclusions from the real `evaluateCompatibility`/
`evaluateSafety` engines) is unmodified; no new compatibility/safety/
regulatory logic was added anywhere this session; no Phase 14 Python
safety/regulatory logic was duplicated or called as authority.

### Generated-vs-saved persistence decision

Same seam FVL-03.005/.006 established: `promoteGeneratedFormula.ts::buildPromotedFormulation()`
reused unchanged via the shared `ensurePromoted()` helper in
`FormulationResultPage.tsx`. The new "System substitution" handler
resolves the human-selected ingredient indices to the promoted version's
own real, persisted line ids (guaranteed index-aligned to the generated
formula's own ingredient order, per FVL-03.006's established invariant),
passing the first as the dialog's required anchor `line` and the rest via
a new `initialExtraLineIds` prop / `?systemLines=` query param.

### Human-selection behavior

Fully preserved — pre-checking lines via `initialExtraLineIds` is purely
an initial-state convenience; every checkbox remains freely editable once
the dialog is open, and Generate/Evaluate/Apply remain three explicit,
separate human actions. Nothing in this session's code auto-applies or
auto-selects a candidate.

### Source formula immutability

Confirmed by construction and diff review: the new
`FormulationResultPage.tsx::onSystemSubstitution` handler only reads
`session.brief`/`session.id`/`card` — no `session.*` assignment appears
anywhere in the changed files. Only new `Formulation`/
`FormulationVersion` records are ever created by promotion.

### System-substitution run/version traceability

Unchanged/inherited — the existing `applySystem()` in
`SubstitutionPanel.tsx` persists the underlying `OptimizationRun`
(`optimization_runs`) AND an immutable `SubstitutionRun`
(`substitution_runs`, `isSystem: true`, `systemMaterialIds`,
`optimizationRunCode` pointer) before touching anything, then updates
only the working draft (`useFormulationWorkspace.ts::onApplySystemSubstitution`)
— never the saved `FormulationVersion`.

### No-candidate behavior

Unchanged/inherited — a proposal that cannot cover every preserved
function is recorded `rejected` (`missing_required_function`) rather than
silently offered partial; an infeasible optimizer result is rendered
honestly with its real causes and offers no Apply button — both
pre-existing, both unmodified.

### Material substitution separation confirmation

Confirmed by grep: no code added this session independently calls the
one-to-one `scoreCandidate`/`rankCandidates` multiple times to fake a
system result — every system-mode path in this session's new code routes
through the SAME existing `SubstitutionDialog` system-mode section
FVL-03.006 already exposed; the one-to-one and system-mode code paths
inside `SubstitutionPanel.tsx` remain exactly as they were.

### Zero-LLM result

Unaffected — no LLM touched anywhere this session; system identification
is 100% human-driven and candidate generation/scoring/optimization are
100% deterministic, same guarantee as material substitution.

### Acceptance A-J results

A/B/C/D/E/F/G/H/J are satisfied by construction/inheritance — since the
new entry point routes into the existing, completely unmodified
`SubstitutionDialog`/`systemSubstitution.ts`, every one of those cases
(real ranked system candidate(s), nothing auto-applied; multi-materialCode
source members correctly identified; replacement members/ratios sourced
only from the real optimizer output; honest partial/unsupported handling
for an unresolved source ingredient — same graceful `materialCode ?? id`
fallback FVL-03.006 confirmed; correct real-dimension surfacing when the
cheapest system is inventory-infeasible; a hard-constraint violation
cannot be silently applied; explicit no-candidate result; source
formula/version unchanged with new-run traceability; historical session
still opens) are already covered by that existing component's own
pre-existing test suite (`SubstitutionPanel.test.tsx`'s system-
substitution describe block), re-run this session as regression, not
re-proven from scratch. This task's own new proof burden — Acceptance I
(version/system scoping) — surfaced a REAL cross-version selection-state
leak (React reusing the `FormulaTab` component instance across a version
switch left a stale ingredient selection wrongly enabled against a
different version's ingredients), caught by a new test and fixed with a
`useEffect` resetting the selection on `card.version` change. Covered by
3 new `SubstitutionPanel.test.tsx` tests (`initialExtraLineIds`
pre-seeding, human-editable after open, defensive bogus-id filtering) and
4 new `FormulationResultPage.test.tsx` tests (checkbox-per-row + disabled-
below-2 button state, uncheck-drops-below-threshold, checkbox click never
also opens the evidence panel, version-switch scoping).

### Tests / results

`pnpm --filter @formulab/desktop test` — 1328/1328 passing across 146
files (7 new: 3 in `SubstitutionPanel.test.tsx`, 4 in
`FormulationResultPage.test.tsx`; `SubstitutionPanel.test.tsx`'s
pre-existing system-substitution tests unmodified and green, confirming
zero behavior change to the reused engine/dialog). `pnpm --filter
@formulab/desktop typecheck` / `lint` — clean. `packages/shared`,
`runtime/formulation`, `runtime/pipeline`, `apps/desktop/src-tauri/src/
formulation*` confirmed untouched by `git status`/diff this session — no
dedicated shared/pytest/cargo run performed (nothing in those trees
changed; last real baselines, from the FVL-03.004 session: `pnpm
--filter @formulab/shared test` 1311/1311, `python -m pytest
runtime/pipeline -q` 386 passed/5 subtests, `cargo check` clean).

### Tracker update

`docs/FORMULAB_V1_TASK_TRACKER.md` — `FVL-03.007` marked `COMPLETED
(2026-08-18)` with full evidence. `python scripts/validate_v1_tracker.py`
— OK, 157 tasks, no drift (run before and after all edits).

### GitHub update

One completion comment on issue #4
(`https://github.com/Sekiph82/FormuLab/issues/4#issuecomment-5329450533`)
— full summary matching this log entry (a separate session-start comment
was not posted this session; the completion comment itself records the
full start-to-finish picture). No new issue created.

### Build/shortcut result

Not applicable — no desktop rebuild/installer performed this session (no
Rust or shipped-runtime code changed at all; TS/shared changes fully
covered by `typecheck`/`lint`/vitest, matching the standing "full
rebuild reserved for closure sessions" policy).

### Files changed

Modified: `apps/desktop/src/app/routes/FormulationPage.tsx`,
`apps/desktop/src/app/routes/FormulationResultPage.tsx` (+`.test.tsx`),
`apps/desktop/src/components/formula/SubstitutionPanel.tsx` (+`.test.tsx`),
all 8 `apps/desktop/src/i18n/locales/*/session.json`,
`docs/FORMULAB_V1_TASK_TRACKER.md`,
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`,
`docs/handoffs/FORMULAB_V1_CURRENT.md`. No new files this session. Stray
pre-existing working-tree changes (`docs/generated/*`, `formulas/*`
deletions, untracked Phase logs) left untouched, unrelated, per standing
decision.

### Commit SHA

`39c6ee7` — "feat(v1): integrate system substitution workflow".
`837f7b6` — "docs: finalize FVL-03.007 closure pointer with commit SHA".

### Push result

Both commits pushed to `origin/feature/laboratory-stability`. No force
push, no history rewrite. Local HEAD == remote HEAD == `837f7b6`.

### Exact next frozen task (Session 7)

**FVL-03.007 COMPLETED**

**NEXT: FVL-03.008 — NOT STARTED**

---

## Session 8 — FVL-03.008 implementation (2026-08-18)

### Scope

Wire the EXISTING Compatibility Engine
(`packages/shared/src/engine/compatibility.ts::evaluateCompatibility`)
as the authoritative chemical/material compatibility hard-constraint
verdict for the formulation workflow. No subagents used this session,
per explicit instruction — all research via direct Read/Grep/Bash.
Compatibility only — FVL-03.009 (Safety) and FVL-03.010 (Regulatory) and
all later FVL-03 tasks NOT started; `/live` not removed; no LLM
formulation generation re-enabled.

### Branch / commit state

- Branch: `feature/laboratory-stability`.
- Starting HEAD: `837f7b67ca3b7f4eadbb1772d5b66eef24ffa31f`.
- Final HEAD: `cd49421`.
- `git rev-parse HEAD` == `git rev-parse origin/feature/laboratory-stability`
  — both `cd49421`. Nothing ahead/behind.

### FVL-03.008 status

**COMPLETED.**

### Authoritative Compatibility Engine path/functions

`packages/shared/src/engine/compatibility.ts::evaluateCompatibility()` +
`summarizeCompatibilityFindings()`, `packages/shared/src/schemas/
compatibility.ts` (`compatibilityRuleSchema`, `compatibilityFindingSchema`,
`compatibilitySnapshotSchema`), `packages/shared/src/engine/
ruleConditions.ts` (`matchLines`/`lineMatchesCondition`/`materialFor`),
`packages/shared/src/catalog/compatibilityRules.ts`
(`SEED_COMPATIBILITY_RULES`, 20 rules) — fully specified in
`docs/COMPATIBILITY_ENGINE.md`. **Zero lines of any of these changed.**

### Compatibility input contract

`evaluateCompatibility(lines: FormulationLine[], rules:
CompatibilityRule[], context: CompatibilityContext):
CompatibilityFinding[]` — pure, deterministic. `CompatibilityContext =
{ materials: RawMaterial[], phTarget?, processTempC?, productDomain?,
packagingComponentTypes? }`. Confirmed pure (no persistence dependency)
— unlike `substitutionRequestSchema`/`formulationProblemSchema`
(FVL-03.005/.006/.007's target engines), nothing here requires a real
`projectId`/`formulaVersionId` to EVALUATE (only to SAVE a
`CompatibilitySnapshot`, which this task's generated-formula seam
deliberately does not do).

### materialCode behavior

Unchanged — `materialFor(line, byCode)` joins by `line.materialCode`
only; `lineMatchesCondition` additionally supports function- and
name-keyword-scoped matching (not gated on materialCode resolution) as
the engine's own pre-existing, honest design — never a fabricated
identity. New `unresolvedMaterialCount` (this session's own addition, in
the wrapper only) counts lines with no `materialCode` for honest coverage
disclosure, never fed back into the engine itself.

### Request-rules vs compatibility-domain separation

Re-confirmed by direct grep this session: `runtime/pipeline/rules.py`
contains zero chemistry/ionic/pH-dependent/HLB/cationic/anionic keyword
hits — still exactly request-constraint-only (excluded ingredients,
sulfate-free, requested pH bounds), matching the 2026-08-18
architecture-correction session's own original finding. No chemical
compatibility logic was added to it, and none exists there.

### Generated-formula evaluation seam

New pure `apps/desktop/src/lib/generatedFormulaCompatibility.ts::evaluateGeneratedFormulaCompatibility(formula, materials, rules, opts)`
— reshapes via the existing `linesFromGeneratedFormula()`, calls the
real engine directly, computes nothing itself beyond a formula-level
`formulaState` derived strictly from the engine's own real findings. The
rule set is a REQUIRED caller-supplied parameter (never hardcoded inside
this module) — new `apps/desktop/src/hooks/useCompatibilityRules.ts`
loads the LIVE, chemist-editable `compatibility_rules` masterdata
collection (`listRecordsSeeded("compatibility_rules",
SEED_COMPATIBILITY_RULES)`), the same one `CompatibilityPanel.tsx`
already reads — not a frozen seed copy.

### Blocker/warning/unknown semantics

Confirmed by audit (`optimization.ts::blockingExclusionConstraints`'s own
comment, `SubstitutionPanel.tsx`'s `hasBlockingCompatibilityFinding`):
ONLY `severity === "blocking"` is a real hard block anywhere in this
platform; `info`/`warning`/`error` are all real, non-blocking findings.
Reused verbatim. New `formulaState`: `"blocked"` iff a blocking finding
fired; `"warning"` iff any non-blocking finding fired; `"unknown"`
(never `"compatible"`) when zero findings fired AND at least one
ingredient never resolved to a canonical `materialCode`; otherwise
`"compatible"`. `unresolvedMaterialCount` always surfaced separately and
honestly, whatever the state.

### Formula-version compatibility scoping

Computed per-card in `FormulationResultPage.tsx` (`compatibilities:
(GeneratedFormulaCompatibility | undefined)[]`, indexed exactly like
`costSnapshots`/`inventoryFeasibilities`); switching versions shows only
that version's own state — proven by a new test (blocked V1 → unresolved
V2, "Compatibility blocked" text confirmed absent after switching).
Historical sessions without any stored compatibility metadata open
normally by construction (on-the-fly evaluation, no session-storage
schema change) — proven by a new test.

### Cheapest-valid interaction

`pickCheapestValidVersion()` (`costComparison.ts`) gained an optional
`compatibilities` parameter — an additional per-index eligibility gate
(never a combined score): a `"blocked"` version is never returned even
if it is the real cheapest price; `"warning"`/`"unknown"` never exclude;
omitting the parameter preserves every pre-existing call site's exact
behavior (proven by test).

### Inventory-valid interaction

`pickMostInventoryFeasibleVersion()` (`inventoryComparison.ts`) gained
the identical optional `compatibilities` eligibility gate, same pattern,
same non-exclusion of warning/unknown, same backward-compatible default
(proven by test).

### Advanced Optimizer interaction

Confirmed by audit, not modified: `AdvancedOptimizerPanel.tsx` already
builds `blockingExclusionConstraints`/`compatibilityRiskScore` from the
real `evaluateCompatibility()` output for any real project — since
FVL-03.005 already established the promotion seam into this exact panel,
a promoted generated version already receives the same authoritative
compatibility-derived exclusions/risk input with zero new code this
session.

### Material Substitution interaction

Confirmed by audit, not modified: `SubstitutionPanel.tsx`'s one-to-one
candidate scoring already re-runs `evaluateCompatibility()` per candidate
(`compatFindings = evaluateCompatibility(substitutedLines,
SEED_COMPATIBILITY_RULES, { materials })`) and computes
`hasBlockingCompatibilityFinding` from it — a compatibility-blocked
candidate is never a valid pick per the existing, unmodified engine.

### System Substitution interaction

Confirmed by audit, not modified: system-mode candidate generation
already threads `blockingExclusionConstraints(...)` into
`buildSystemBasis()`'s `conditionalConstraints` — a system candidate
violating a real compatibility hard rule is excluded by the real
Advanced Optimizer itself, not by any new code this session.

### Duplicate-authority audit

Grepped `runtime/pipeline`, `apps/desktop/src`, `packages/shared/src`,
`runtime/formulation` for new compatibility calculations: zero found. No
`severity:` literal assignment exists anywhere in this session's new
files (`generatedFormulaCompatibility.ts`,
`GeneratedCompatibilitySummary.tsx`) — `evaluateCompatibility()` is the
single call site in the new code. **Disclosed, non-blocking finding**:
`AdvancedOptimizerPanel.tsx`, `SubstitutionPanel.tsx` (both modes) all
pass the hardcoded `SEED_COMPATIBILITY_RULES` constant, not the live
`compatibility_rules` collection this session's own new
`useCompatibilityRules()` correctly reads — a real data-freshness gap
(a chemist's rule edit via `RuleManager.tsx` would not be seen by those
three re-run call sites), NOT a duplicate engine, second scoring
function, or second rule-matching implementation — same single
`evaluateCompatibility()` call every time. Retrofitting those three
already-closed FVL-03.005/.006/.007 call sites is out of THIS task's own
boundary; flagged for a future session, not silently "fixed" as if in
scope.

### Safety/Regulatory non-implementation confirmation

Confirmed: no `safety.py`/`regulatory.py` touched, no safety/regulatory
verdict logic added or rewritten, no combining of Safety or Regulatory
into the Compatibility Engine anywhere in this session's code.

### Zero-LLM result

Unaffected — no LLM touched anywhere this session; compatibility
evaluation is 100% deterministic rule matching, same guarantee as every
other engine wired in prior FVL-03 sessions.

### Acceptance A-J results

A/B/C/D: proven directly by 9 new `generatedFormulaCompatibility.test.ts`
tests using disposable fixture rules (per the task's own instruction) —
explicit blocking pair → `"blocked"`; compatible pair → no fabricated
blocker; unresolved materialCode + zero findings → `"unknown"`, never
`"compatible"`; a warning-only finding → `"warning"`, formula not
hard-blocked. E/F: proven by 4 new `costComparison.test.ts` + 3 new
`inventoryComparison.test.ts` tests — a compatibility-blocked formula is
never crowned cheapest-valid or most-inventory-feasible even when it
would otherwise win on price/stock. G/H/I: confirmed by audit and
inherited regression — the existing `AdvancedOptimizerPanel.tsx`/
`SubstitutionPanel.tsx` test suites (unmodified, re-verified green)
already prove these; not re-proven from scratch, matching the "don't
duplicate an authoritative engine's own proofs" project convention. J:
proven by a new `FormulationResultPage.test.tsx` test (historical
session without compatibility metadata opens normally) plus 3 more
end-to-end wiring tests exercising REAL seed rules (a genuine
`compat-acid-hypochlorite` blocking finding — "Mixing hypochlorite with
acid releases chlorine gas" — rendered from the actual, unmodified engine
output, plus real version-switch scoping proof).

### Tests / results

`pnpm --filter @formulab/desktop test` — 1354/1354 passing across 148
files (26 new: 9 `generatedFormulaCompatibility.test.ts`, 6
`GeneratedCompatibilitySummary.test.tsx`, 4 `costComparison.test.ts`, 3
`inventoryComparison.test.ts`, 4 `FormulationResultPage.test.tsx`;
`SubstitutionPanel.test.tsx`/`AdvancedOptimizerPanel.test.tsx` unmodified
and green). `pnpm --filter @formulab/desktop typecheck` / `lint` —
clean. `packages/shared`, `runtime/formulation`, `runtime/pipeline`,
`apps/desktop/src-tauri/src/formulation*` confirmed untouched by `git
status`/diff this session — no dedicated shared/pytest/cargo run
performed (nothing in those trees changed; last real baselines, from the
FVL-03.004 session: `pnpm --filter @formulab/shared test` 1311/1311,
`python -m pytest runtime/pipeline -q` 386 passed/5 subtests, `cargo
check` clean).

A real, pre-existing latent bug was found and fixed during this
session's own test-writing: `apps/desktop/src/lib/masterdata.ts::listRecordsSeeded()`
threw `"not-desktop"` outside Tauri — its `upsertRecords` call has no
`isTauri` guard, unlike its sibling `listRecords()` — never previously
exercised since no existing test rendered a caller of it
(`CompatibilityPanel.tsx` has no test file). Fixed with a one-line
`!isTauri` early return of `seed`, mirroring `listRecords()`'s own
convention; verified zero behavior change inside a real Tauri build (the
fix only touches the previously-throwing branch).

### Tracker update

`docs/FORMULAB_V1_TASK_TRACKER.md` — `FVL-03.008` marked `COMPLETED
(2026-08-18)` with full evidence. `python scripts/validate_v1_tracker.py`
— OK, 157 tasks, no drift (run before and after all edits).

### GitHub update

One completion comment on issue #4
(`https://github.com/Sekiph82/FormuLab/issues/4#issuecomment-5330018225`)
— full summary matching this log entry (a separate session-start
comment was not posted this session, matching the FVL-03.007 session's
own precedent; the completion comment records the full start-to-finish
picture). No new issue created.

### Build/shortcut result

Not applicable — no desktop rebuild/installer performed this session (no
Rust or shipped-runtime code changed at all; TS/shared changes fully
covered by `typecheck`/`lint`/vitest, matching the standing "full
rebuild reserved for closure sessions" policy).

### Files changed

New: `apps/desktop/src/lib/generatedFormulaCompatibility.ts` (+`.test.ts`),
`apps/desktop/src/hooks/useCompatibilityRules.ts`,
`apps/desktop/src/components/compatibility/GeneratedCompatibilitySummary.tsx`
(+`.test.tsx`). Modified: `apps/desktop/src/app/routes/
FormulationResultPage.tsx` (+`.test.tsx`), `apps/desktop/src/lib/
costComparison.ts` (+`.test.ts`), `apps/desktop/src/lib/
inventoryComparison.ts` (+`.test.ts`), `apps/desktop/src/lib/masterdata.ts`,
all 8 `apps/desktop/src/i18n/locales/*/session.json`,
`docs/FORMULAB_V1_TASK_TRACKER.md`,
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`,
`docs/handoffs/FORMULAB_V1_CURRENT.md`. Stray pre-existing working-tree
changes (`docs/generated/*`, `formulas/*` deletions, untracked Phase
logs) left untouched, unrelated, per standing decision.

### Commit SHA

`0c0814d` — "feat(v1): integrate authoritative Compatibility Engine".
`cd49421` — "docs: finalize FVL-03.008 closure pointer with commit SHA".

### Push result

Both commits pushed to `origin/feature/laboratory-stability`. No force
push, no history rewrite. Local HEAD == remote HEAD == `cd49421`.

### Exact next frozen task (Session 8)

**FVL-03.008 COMPLETED**

**NEXT: FVL-03.009 — NOT STARTED**

---

## Session 9 — FVL-04 tracker scope expansion, documentation only (2026-08-18)

### Scope

**Documentation/tracker session only.** No connector, no production code,
no schema, no UI, no Data Exchange engine change of any kind. Purpose:
update the frozen FormuLab v1 planning/tracker documents with (1) the
newly approved customer/external-system connector scope under FVL-04,
and (2) a human-readable, stable artifact naming convention task for
downloaded literature/documents and formulation files. No subagents
used, per explicit instruction. Did NOT start FVL-03.009, did NOT start
any FVL-04 task, did NOT create FVL-12.

### Production implementation

**NONE.** This session touched exactly three files, all documentation:
`docs/FORMULAB_V1_TASK_TRACKER.md`, `docs/FORMULAB_V1_FINAL_SCOPE.md`,
`docs/handoffs/FORMULAB_V1_CURRENT.md`.

### Branch / commit state

- Branch: `feature/laboratory-stability`.
- Starting HEAD: `cd4942150739ddf152994365d82e18f3ff6191d1`.
- Final HEAD: `94f04f0`.
- `git rev-parse HEAD` == `git rev-parse origin/feature/laboratory-stability`
  — both `94f04f0`. Nothing ahead/behind.

### Data Exchange architecture audit (wording only, no code touched)

Read `docs/DATA_EXCHANGE_CENTER.md`, `docs/DATA_EXCHANGE_IMPORTS.md`,
`docs/DATA_EXCHANGE_TEMPLATE_REGISTRY.md`,
`docs/DATA_EXCHANGE_VALIDATION.md`. Confirmed existing architecture:
schema-driven template registry (`DataExchangeTemplateDefinition`/
`DataExchangeColumnDefinition`), upload → parse → validate → preview →
confirm → commit pipeline, row states, grouped commits, duplicate/update
policy, import job status lifecycle, existing-parent reference resolution
by human-readable code. Grepped for existing alias/header-mapping,
external-ID crosswalk, and source-schema-discovery capability across all
Data Exchange docs: **zero hits** — confirmed none of this exists today.
This proves the new FVL-04.013–.026 connector/mapping/crosswalk layer is
a genuinely new adapter, not a duplicate of anything already built.

### FVL-04 old task count

12 (FVL-04.001–.012, all "confirm/extend existing template registry"
tasks — all still blank, unmodified in content, only a small intro-prose
extension added around them).

### FVL-04 new task count

26 (FVL-04.001–.026). 14 new tasks added.

### Overall old/new tracker task count

Old: 157 (as last validated at the close of the FVL-03.008 session).
New: 171. Confirmed by `python scripts/validate_v1_tracker.py` →
`OK: 171 unique tasks across 11 work packages, no drift found.`

**Stale-count correction found and fixed in the same edit** (disclosed,
not silently done): the tracker's own completion-percentage summary
table (top of the file) had not been recomputed since the FVL-03.002–.008
sessions closed — it still showed FVL-03 at "7 completed" and a Total row
of "27 completed" that was already internally inconsistent with the
FVL-01(21)+FVL-02(24) rows directly above it (45 alone, already exceeding
the stated 27). Recomputed directly from the tracker's own per-task
status cells (a small Python one-liner counting `COMPLETED`/`ON PROCESS`/
blank per package — script output kept as this session's own working
note, not committed): FVL-01 21/21, FVL-02 24/24, FVL-03 14/18, FVL-04
0/26, FVL-05–11 all 0/their totals. Corrected Total row: 59/171 completed
(34.5%). This is a documentation accuracy fix required to satisfy the
task's own "recalculate mathematically, do not guess" instruction, not a
status change to any individual task.

### Exact new task IDs FVL-04.013–.026

FVL-04.013 External Source Connector Contract; FVL-04.014 Generic File
Connector; FVL-04.015 Source Schema Discovery; FVL-04.016 Mapping
Profile Model; FVL-04.017 External ID Crosswalk Registry; FVL-04.018
Transformation / Unit / Enum Mapping; FVL-04.019 Formula / Recipe
Relationship Import; FVL-04.020 Laboratory / Test Result Relationship
Import; FVL-04.021 Generic Database Read Connector; FVL-04.022 REST API
Connector Contract; FVL-04.023 Incremental Re-import / Conflict
Handling; FVL-04.024 Connector → Existing Data Exchange Bridge;
FVL-04.025 Customer Migration Acceptance Fixture; FVL-04.026
Human-Readable Literature & Formulation Artifact Naming Convention. All
14 status cells blank. Dependencies written as explicit comma-separated
task-ID lists (not en-dash ranges) so every reference is fully checked by
`validate_v1_tracker.py`'s own ID-existence logic — confirmed by reading
the validator's source that a range like `FVL-04.014–022` would only
register the FIRST id in the string as a real, checked dependency (the
regex-based extractor finds one `FVL-XX.YYY` match per contiguous
`FVL-`-prefixed token, then stops); explicit lists avoid that silent
under-validation for every new task.

### Connector architecture decision

Fixed, documented in the FVL-04 package intro:

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

Connector layer owns: extraction, source-schema description, source-to-
canonical mapping, external-ID resolution, repeatable transformation
configuration. It does NOT own: Material Master business rules, cost
calculations, inventory availability calculations, compatibility,
safety, or regulatory verdicts, formulation generation, laboratory
interpretation, or Data Exchange commit semantics.

### Existing Data Exchange authority preserved

Explicitly documented in the tracker's FVL-04 intro and
`docs/FORMULAB_V1_FINAL_SCOPE.md`'s new subsection: "This is NOT a second
import platform." FVL-04.024 ("Connector → Existing Data Exchange
Bridge") is the explicit task requiring proof there is no second commit/
import authority and no second import-history model. Explicitly out of
scope for v1: no supplier crawler, no new literature crawler, no new
Regulatory Database, no second Data Exchange, no vendor-specific ERP
connector unless separately approved later, no business-engine
duplication.

### Naming convention decision

FVL-04.026 added: (A) literature — a display title
(`<First Author> (<Year>) — <Short Human-Readable Title>`) separate from
a deterministic physical filename
(`LIT_<Year>_<FirstAuthor>_<ShortTitle>_<StableSourceId>.<ext>`,
`UnknownYear`/`UnknownAuthor` fallbacks, sanitized DOI/illegal
characters, original extension preserved, no illegal Windows characters,
no trailing dot/space, collision-safe deterministic suffix); (B)
formulation — a display title
(`<Product Family> — <Formula Name> — <Formula Code> — V<Version>`) and a
deterministic export filename
(`FORM_<ProductFamily>_<ShortFormulaName>_<FormulaCode>_V<Version>_<ArtifactType>.<ext>`).
Original source filename, URL/source, DOI/source ID, acquisition
timestamp, and content hash (where available) always preserved as
provenance metadata — display renaming must never destroy them; reuse
existing provenance/storage models, no duplicate document registry. This
task is added to the tracker only — no filename runtime helper, no
literature-downloader behavior change, no formula-export behavior
change, implemented this session.

### Tracker validation result

`python scripts/validate_v1_tracker.py` → `OK: 171 unique tasks across
11 work packages, no drift found.` (run after all edits). `git diff
--check` — clean (LF/CRLF warnings only, no real conflicts).

### Files changed

`docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-04 package intro extended, 14 new
task rows appended, completion-summary table corrected),
`docs/FORMULAB_V1_FINAL_SCOPE.md` (new "FVL-04 scope expansion — approved
2026-08-18" subsection, eleven-package structure unchanged, no FVL-12),
`docs/handoffs/FORMULAB_V1_CURRENT.md` (task-total corrected to 171, new
"FVL-04 scope expansion" section added, current-task pointer explicitly
NOT moved). No production code, schema, UI, connector, mapping engine,
crosswalk runtime, or filename runtime helper created or modified. Stray
pre-existing working-tree changes (`docs/generated/*`, `formulas/*`
deletions, untracked Phase logs) left untouched, unrelated, per standing
decision.

### GitHub update

One comment on the existing FVL-04 issue
(`https://github.com/Sekiph82/FormuLab/issues/5#issuecomment-5330663910`)
— full summary of the scope expansion, architecture decision, and stale-
count correction. No new issue created. Issue #4 (FVL-03) untouched this
session — no FVL-03 work occurred.

### Commit SHA

`94f04f0` — "docs(v1): expand FVL-04 enterprise data onboarding scope".
Single commit — no separate closure-pointer commit needed (this is a
one-shot documentation session, not an FVL-03.00X implementation task
with its own two-commit precedent).

### Push result

Pushed to `origin/feature/laboratory-stability`. No force push, no
history rewrite. Local HEAD == remote HEAD == `94f04f0`.

### Current execution pointer

**CURRENT IMPLEMENTATION TASK REMAINS:**
**`FVL-03.009` — NOT STARTED.**

**FVL-04 IMPLEMENTATION — NOT STARTED.**

### Exact next frozen task (Session 9)

**TRACKER SCOPE UPDATE COMPLETED**

---

## Session 10 — FVL-03.009 implementation (2026-08-18)

### Scope

Make the EXISTING Safety Engine
(`packages/shared/src/engine/safety.ts::evaluateSafety`/
`classifyProductSafety`) the single authoritative final safety verdict
for the formulation workflow, retiring `runtime/pipeline/safety.py` as a
competing final-verdict engine. No subagents used this session, per
explicit instruction — all research/implementation via direct
Read/Grep/Edit/Bash. Safety only — FVL-03.010 (Regulatory) and all later
FVL-03 tasks NOT started; Regulatory consolidation
(`runtime/pipeline/regulatory.py`, `regulatoryRules.ts`) not touched;
`/live` not removed; no LLM formulation generation re-enabled.

### Branch / commit state

- Branch: `feature/laboratory-stability`.
- Starting HEAD: `94f04f0`.
- Final HEAD: `860b57e`.
- `git rev-parse HEAD` == `git rev-parse origin/feature/laboratory-stability`
  — both `860b57e`. Nothing ahead/behind.

### FVL-03.009 status

**COMPLETED.**

### Authoritative Safety Engine path/functions

`packages/shared/src/engine/safety.ts::evaluateSafety()` +
`classifyProductSafety()`, `packages/shared/src/schemas/safety.ts`
(`safetyRuleSchema`, `safetyFindingSchema`), `packages/shared/src/engine/
ruleConditions.ts` (`matchLines`/`lineMatchesCondition`/`materialFor`,
shared with Compatibility), `packages/shared/src/catalog/
safetyRules.ts` (`SEED_SAFETY_RULES`) — fully specified in
`docs/SAFETY_ENGINE.md`. **Zero lines of any of these changed.**

### Safety input contract

`evaluateSafety(lines: FormulationLine[], rules: SafetyRule[], context:
SafetyContext): SafetyFinding[]` — pure, deterministic, no persistence
dependency (unlike the Optimizer/Substitution schemas' `projectId`
requirement).

### Status/severity semantics

Confirmed by audit, reused verbatim, not invented: only
`severity === "blocking"` is a real hard block anywhere in this
platform (`optimization.ts::blockingExclusionConstraints`,
`SubstitutionPanel.tsx::hasBlockingSafetyFinding`); `info`/`warning`/
`error` are all non-blocking. New `formulaState`:
`safe`/`warning`/`blocked`/`unknown` — `"blocked"` iff a blocking
finding fired; `"warning"` iff any non-blocking finding fired;
`"unknown"` (never `"safe"`) when zero findings fired AND at least one
ingredient never resolved to a canonical `materialCode`.

### materialCode behavior

Unchanged — `materialFor(line, byCode)` joins by `line.materialCode`
only, with graceful (never fabricated) function-/name-keyword fallback
for unresolved lines. New `unresolvedMaterialCount` (this session's own
addition, wrapper-only) counts unresolved lines for honest coverage
disclosure, never fed back into the engine.

### Missing-safety-data behavior

Confirmed honest by construction and by test: an unresolved-materialCode
line with zero findings yields `"unknown"`, never `"safe"` — a silent
false-negative is impossible by the wrapper's own state derivation
(`unresolvedMaterialCount > 0` is checked before defaulting to `"safe"`).

### `runtime/pipeline/safety.py` audit AND retirement result

Confirmed by audit to be a real, independently-computing SECOND final
safety-verdict authority: its own `_SENSITIZER_CLASS_INGREDIENTS`/
`_ALLERGEN_DECLARATION_INGREDIENTS`/`_CORROSIVE_HANDLING_INGREDIENTS`/
`_IRRITANT_POWDER_HANDLING_INGREDIENTS`/`_SULFATE_KEYS` name-keyed hazard
tables computed its own `overall_status`
(`PASS`/`PASS_WITH_CONDITIONS`/`FAIL`/`DATA_INCOMPLETE`), never
consuming or deferring to the TS engine. **Retired by full deletion, not
permanent reconciliation** (Option A, same precedent FVL-03.003 already
established for a fully-superseded legacy function — no genuinely
separable preprocessing survived, since the hazard-table lookups WERE
the competing verdict logic): `runtime/pipeline/safety.py` (269 lines)
and `runtime/pipeline/test_safety.py` (9 tests) deleted entirely.
`pipeline.py` — removed `import safety`, the `safety_result` computation
block, the `safety`-sourced `evidence_gaps` loop, and `card["safety"]`
from the emitted card dict; stale comment near the `traceability.json`
write corrected. `validation_plan.py::build_validation_plan()` — removed
the `safety_overall` parameter entirely; VAL-002 narrowed to its
still-live `regulatory_overall == "NON_COMPLIANT"` half only
(Regulatory's own consolidation left completely untouched, reserved for
FVL-03.010). `test_pipeline.py` — zero-LLM regression guard changed from
`assertIn("safety", card)` to `assertNotIn("safety", card)`.
`test_traceability.py` — `test_every_safety_finding_has_a_source_or_rule`
(read the now-removed `card["safety"]["findings"]`) deleted with an
explanatory comment; the adjacent, unrelated
`test_every_regulatory_finding_has_a_source_or_rule` left untouched.

### Pre-generation AI-request safety gate confirmation

Confirmed by audit and deliberately left completely alone:
`pipeline.py`'s `classify_target()`/`safety_gate()`/`safety_decision`
(request-time classification before generation even starts, mirrors the
TS `PRODUCT_SAFETY_CLASSIFICATIONS` enum by design) is a separate,
legitimate responsibility, not a final-verdict engine, and out of this
task's retirement scope.

### Generated-formula evaluation seam

New pure `apps/desktop/src/lib/generatedFormulaSafety.ts::evaluateGeneratedFormulaSafety(formula, materials, rules, opts)`
— reshapes via the existing `linesFromGeneratedFormula()`, calls the
real engine directly, computes nothing itself beyond the
`formulaState`/`unresolvedMaterialCount` derivation above. The rule set
is a REQUIRED caller-supplied parameter, never hardcoded — new
`apps/desktop/src/hooks/useSafetyRules.ts` loads the LIVE,
chemist-editable `safety_rules` masterdata collection
(`listRecordsSeeded("safety_rules", SEED_SAFETY_RULES)`), not a frozen
seed copy — mirroring `useCompatibilityRules.ts`'s established pattern
exactly (the `listRecordsSeeded()` `!isTauri` fix FVL-03.008 already
made is reused as-is, not re-fixed).

### Old/new UI behavior

`FormulationResultPage.tsx`'s old `SafetyTab`/`SafetyFindingRow` (which
read the legacy Python-shaped `card.safety` fields — `overall_status`/
`subject`/`rule_id`/`rationale`/`required_action`/`source_type`, grouped
by `subject_type`) deleted outright and replaced with a rewritten
`SafetyTab` rendering a new thin `GeneratedSafetySummary` presenter
(`apps/desktop/src/components/safety/`). A Safety section added to
`SummaryTab` (including its "Readiness" badges block, whose stale
`card.safety.overall_status` reference — a third, easy-to-miss
occurrence — was caught only by this session's own required
closure-time grep audit, not by typecheck/lint/the first two rounds of
test runs). A Safety row + red "blocked" banner added to
`VersionSummaryCard`, mirroring the existing Compatibility
row/banner exactly. `SafetyPanel.tsx` (the project-bound, saved-version
panel) untouched — this is a separate, generated-card-specific
presenter.

### Cost/Inventory eligibility interaction

`pickCheapestValidVersion()`/`pickMostInventoryFeasibleVersion()` each
gained an optional 4th `safeties` parameter — independent of, and
additive to, the existing `compatibilities` gate (both dimensions stay
separate eligibility checks, never merged into one opaque score, per
task's own explicit instruction). A safety-`"blocked"` version can never
be crowned cheapest-valid or most-inventory-feasible; `"warning"`/
`"unknown"` never exclude; omitting the parameter preserves every
pre-existing call site's behavior exactly (proven by test).

### Compatibility separation confirmation

Confirmed by construction and by audit throughout this session's new
code: no merged findings, no shared verdict field, no opaque combined
score — Compatibility and Safety remain two fully separate domain
results everywhere (`compatibilities`/`safeties` are two distinct
arrays, two distinct eligibility-gate parameters, two distinct UI
presenters/rows/banners).

### Advanced Optimizer / Material Substitution / System Substitution interaction

Confirmed by audit, not modified: `AdvancedOptimizerPanel.tsx`'s
`blockingExclusionConstraints`/safety-risk scoring and
`SubstitutionPanel.tsx`'s `hasBlockingSafetyFinding` (both one-to-one and
system mode) already consume the real `evaluateSafety()` output — none
needed a single line of new code for this task.

### Report/export source

`formulationReport.ts`'s `versionSection()`/`buildReportHtml()`/
`openAndPrintReport()` rewired to accept a `safetyByVersion` map — built
from the exact same computed `safeties` array the UI renders, threaded
through `FormulationResultPage.tsx`'s `TopBar` — instead of reading the
retired `card.safety` JSON. Backward-compatible default `= {}` keeps
every other caller working; a version with no computed safety result
renders an honest "not available", never a fabricated verdict. This was
the one real split-authority risk in the whole task (the "Download
Report" path would otherwise have kept silently showing a stale Python
verdict) — closed by construction, not discovered as a gap after the
fact.

### Historical compatibility

`formulationV2.ts`'s `SafetyResult` interface (the `card.safety` shape)
kept, not deleted — doc comment updated to state plainly it is
legacy-only, read by zero current code, kept solely so a historical
session file saved before this retirement still parses without error.
Proven by a dedicated `FormulationResultPage.test.tsx` test against the
pre-existing SESSION_V6 fixture (which still carries a real legacy
`card.safety` object): the Safety tab shows neither that fixture's legacy
ingredient name nor its legacy rule id, only the freshly recomputed
authoritative result — the legacy payload opens without crashing and
never becomes current authority.

### Regulatory non-implementation confirmation

Confirmed: `runtime/pipeline/regulatory.py`/`regulatoryRules.ts` not
touched, no regulatory verdict logic added or rewritten, no combining of
Regulatory into the Safety Engine anywhere in this session's code.

### Single-authority grep/audit result

Closure-time re-audit (`overall_status`, `evaluate_safety`,
`evaluateSafety`, `classifyProductSafety`, `hazard` across
`runtime/pipeline`, `runtime/formulation`, `packages/shared/src`,
`apps/desktop/src`, `apps/desktop/src-tauri/src`): zero live-code hits
outside the one authoritative TS engine and its already-confirmed-correct
callers. The only remaining `card.safety`/`overall_status` matches
anywhere are explanatory comments and disposable test fixtures
documenting the retirement, plus the unrelated pre-generation
`hazardous_lawful_product` request-classification label in
`pipeline.py::classify_target()` (confirmed out of scope — a request-time
label, not a safety verdict). Stray `.pyc` bytecode cache files for the
deleted `safety.py`/`test_safety.py` (gitignored, `runtime/pipeline/
__pycache__/`) found and removed for hygiene during this audit.

### Zero-LLM result

Unaffected — no LLM touched anywhere this session; safety evaluation is
100% deterministic rule matching, same guarantee as every other engine
wired in prior FVL-03 sessions.

### Acceptance A-L results

A/B/C/D: proven directly by 9 new `generatedFormulaSafety.test.ts` tests
using disposable fixture rules — explicit blocking finding → `"blocked"`;
clean formula → no fabricated blocker; unresolved materialCode + zero
findings → `"unknown"`, never `"safe"`; a warning-only finding →
`"warning"`, formula not hard-blocked; plus blocking-wins-over-warning,
both-facts-surfaced, inactive-rule-inert, decoy-material-immunity, and
pure-no-Tauri-call coverage. E/F: proven by 5 new
`costComparison.test.ts` + 3 new `inventoryComparison.test.ts` tests — a
safety-blocked formula is never crowned cheapest-valid or
most-inventory-feasible even when it would otherwise win on price/stock,
and the compat+safety gates combine correctly when both fire on
different versions. G/H/I: confirmed by audit and inherited regression —
the existing `AdvancedOptimizerPanel.tsx`/`SubstitutionPanel.tsx` test
suites (unmodified, re-verified green) already prove these. J/K: proven
by 4 corrected `FormulationResultPage.test.tsx` tests (two needed
`findAllByText`/`toBeGreaterThanOrEqual(2)` fixes since the real Safety
and Compatibility engines now legitimately co-fire on the same
pre-existing fixtures — not a bug, two real engines correctly agreeing)
plus 3 new `formulationReport.test.ts` tests proving the report uses the
same authoritative result the UI renders, discloses unresolved coverage
honestly, and shows "not available" rather than a fabricated verdict. L:
proven by this entry's own "Single-authority grep/audit result" section
above.

### Tests / results

`pnpm --filter @formulab/desktop test` — 1381/1381 passing across 150
files (24 new/corrected: 9 `generatedFormulaSafety.test.ts`, 7
`GeneratedSafetySummary.test.tsx`, 5 `costComparison.test.ts`, 3
`inventoryComparison.test.ts`, 3 `formulationReport.test.ts`, 4 existing
`FormulationResultPage.test.tsx` tests corrected in place — not net-new).
`pnpm --filter @formulab/desktop typecheck` / `lint` — clean.
`python -m pytest runtime/pipeline -q` — 376 passed, 5 subtests (down
from the 386+5 baseline by exactly 10 = 9 deleted `test_safety.py` tests
+ 1 deleted `test_traceability.py` test). `packages/shared`,
`runtime/formulation`, `apps/desktop/src-tauri/src/formulation*`
confirmed untouched by `git status`/diff this session — no dedicated
shared/cargo run performed (nothing in those trees changed; last real
baselines, from the FVL-03.004 session: `pnpm --filter @formulab/shared
test` 1311/1311, `cargo check` clean).

Two genuine, non-obvious real-engine facts surfaced by this session's own
test-writing (not bugs in the new wrapper, confirmed by isolated
direct-engine inspection before correcting test expectations): (1) the
real `SEED_SAFETY_RULES` `safety-flammable-solvent` rule's
`functionsAny: ["solvent"]` OR-condition legitimately fires on a plain
q.s.-to-100% "Water (Aqua)" line, alongside `safety-ventilation-reminder`,
producing a genuine `formulaState: "warning"` on the SESSION_V6 fixture,
not `"unknown"` as first assumed; (2) the same "Safety warning" text
renders in two places simultaneously (the Safety tab's own state line and
`VersionSummaryCard`'s always-visible data row), requiring
`findAllByText`/count assertions rather than single-match `findByText` in
four separate tests across two describe blocks.

### Tracker update

`docs/FORMULAB_V1_TASK_TRACKER.md` — `FVL-03.009` marked `COMPLETED
(2026-08-18)` with full evidence; completion-summary table corrected
(FVL-03: 14/18 → 15/18; Total: 59/171 → 60/171, 35.1%).
`python scripts/validate_v1_tracker.py` — OK, 171 tasks, no drift (run
before and after all edits).

### GitHub update

One completion comment on issue #4
(`https://github.com/Sekiph82/FormuLab/issues/4#issuecomment-5331514608`)
— full summary matching this log entry. No new issue created.

### Build/shortcut result

Not applicable — no desktop rebuild/installer performed this session (no
Rust or shipped-runtime code changed at all; TS/shared changes fully
covered by `typecheck`/`lint`/vitest, Python changes covered by
`pytest`, matching the standing "full rebuild reserved for closure
sessions" policy).

### Files changed

New: `apps/desktop/src/lib/generatedFormulaSafety.ts` (+`.test.ts`),
`apps/desktop/src/hooks/useSafetyRules.ts`,
`apps/desktop/src/components/safety/GeneratedSafetySummary.tsx`
(+`.test.tsx`). Modified: `apps/desktop/src/app/routes/
FormulationResultPage.tsx` (+`.test.tsx`), `apps/desktop/src/lib/
costComparison.ts` (+`.test.ts`), `apps/desktop/src/lib/
inventoryComparison.ts` (+`.test.ts`), `apps/desktop/src/lib/
formulationReport.ts` (+`.test.ts`), `apps/desktop/src/lib/
formulationV2.ts`, all 8 `apps/desktop/src/i18n/locales/*/session.json`,
`runtime/pipeline/pipeline.py`, `runtime/pipeline/validation_plan.py`,
`runtime/pipeline/test_pipeline.py`, `runtime/pipeline/test_traceability.py`,
`docs/FORMULAB_V1_TASK_TRACKER.md`,
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`,
`docs/handoffs/FORMULAB_V1_CURRENT.md`. Deleted:
`runtime/pipeline/safety.py`, `runtime/pipeline/test_safety.py`. Stray
pre-existing working-tree changes (`docs/generated/*`, `formulas/*`
deletions, untracked Phase logs) left untouched, unrelated, per standing
decision.

### Commit SHA

`c1374d0` — "feat(v1): consolidate authoritative Safety Engine".
`860b57e` — "docs: finalize FVL-03.009 closure pointer with commit SHA".

### Push result

Both commits pushed to `origin/feature/laboratory-stability`. No force
push, no history rewrite. Local HEAD == remote HEAD == `860b57e`.

### Exact next frozen task (Session 10)

**FVL-03.009 COMPLETED**

**NEXT: FVL-03.010 — NOT STARTED**

---

## Session 11 — FVL-03.010 implementation (2026-08-18)

### Scope

Make the EXISTING Kenya/EAC Regulatory Engine
(`packages/shared/src/engine/regulatoryRules.ts::evaluateRegulatory`/
`regulatoryClassification.ts`) the single authoritative regulatory
verdict for the formulation workflow, retiring `runtime/pipeline/
regulatory.py` as a competing final-verdict engine. No subagents used
this session, per explicit instruction — all research/implementation
via direct Read/Grep/Edit/Bash. Regulatory only — FVL-03.011 (end-to-end
provenance) and all later tasks NOT started; full provenance
consolidation not touched; `/live` not removed; no LLM formulation
generation re-enabled.

### Branch / commit state

- Branch: `feature/laboratory-stability`.
- Starting HEAD: `860b57e`.
- Final HEAD: `fa96142`.
- `git rev-parse HEAD` == `git rev-parse origin/feature/laboratory-stability`
  — both `fa96142`. Nothing ahead/behind.

### FVL-03.010 status

**COMPLETED.**

### Authoritative Regulatory Engine path/functions

`packages/shared/src/engine/regulatoryRules.ts::evaluateRegulatory()` +
`summarizeRegulatoryFindings()` + the rule-lifecycle functions
(`editRule`/`setRuleActive`/`deprecateRule`/`verifyRule`/
`rejectRuleVerification`/`supersedeRule`), `packages/shared/src/engine/
regulatoryClassification.ts::classifyProductRegulatory()`,
`packages/shared/src/schemas/regulatory.ts` (`regulatoryRuleSchema`,
`regulatoryFindingSchema`, `REGULATORY_JURISDICTIONS`,
`REGULATORY_FINDING_STATUSES`, `REGULATORY_VERIFICATION_STATUSES`,
`NON_BLOCKING_FINDING_STATUSES`), `packages/shared/src/catalog/
regulatoryRules.ts` (`SEED_REGULATORY_RULES`, 16 rules across 7
jurisdictions) — fully specified across `docs/REGULATORY_ENGINE.md`/
`REGULATORY_CLASSIFICATION.md`/`REGULATORY_RULES.md`. **Zero lines of
any of these changed.**

### Regulatory input contract

`evaluateRegulatory(lines: FormulationLine[], rules: RegulatoryRule[],
ctx: RegulatoryEvaluationContext): RegulatoryFinding[]` — pure,
deterministic. `RegulatoryEvaluationContext = { jurisdiction, category,
materials, claims?, providedEvidenceTypes?, manuallyConfirmedRuleIds?,
asOf? }` — unlike Compatibility/Safety, `jurisdiction`/`category` are
REQUIRED, non-optional fields.

### Market/jurisdiction semantics

`REGULATORY_JURISDICTIONS` = KE/UG/TZ/RW/BI/SS/EAC (EAC an overlay bloc
profile applying alongside, never instead of, a member state's own
rules). A generated session's `brief.market` is free text ("kenya," not
"KE"); a small, wrapper-local `MARKET_ALIASES` table in
`generatedFormulaRegulatory.ts` — the exact real-world alias set
`regulatory.py::_MARKET_ALIASES` used, ported directly — resolves it to
a real jurisdiction code or `undefined` (never guessed). An unresolvable
market maps to `formulaState: "unknown"` with zero rules evaluated —
Kenya/EAC coverage is never silently generalized to an unsupported
jurisdiction (Acceptance L).

### Verified/not_verified semantics

`REGULATORY_VERIFICATION_STATUSES` (8 states) confirmed by audit:
`verified` reachable only through the human-only `verifyRule()` gate
(refuses without both `sourceAuthority` and `sourceReference` already
present) — never import, never an AI/system actor. Every current
`SEED_REGULATORY_RULES` entry ships `not_verified`/`status: "draft"` by
design. A `RegulatoryFinding`'s own `verificationStatus` is copied
straight from the rule that produced it and is always shown alongside
its `status` in the new UI presenter — a `not_verified` rule's finding
is never displayed as though it were a confirmed legal conclusion
(Acceptance D).

### Final status/severity semantics

Confirmed by audit at the engine's one real live blocking-gate caller,
`regulatoryApproval.ts::hasBlockingFinding`/`deriveRegulatoryReadiness`:
STATUS-based (`NON_BLOCKING_FINDING_STATUSES = ["compliant_with_rule",
"not_applicable"]`), not severity-based like Compatibility/Safety. Reusing
that exact convention verbatim for generated-formula eligibility would
make virtually every generated formula "blocked" (a generated session
never has `manuallyConfirmedRuleIds`, so every unrestricted product-level
rule reads `missing_data` always) — a degenerate, always-firing gate.
New `formulaState` (`compliant`/`warning`/`blocked`/`unknown`) narrows
`"blocked"` specifically to a real `non_compliant` finding — the literal
trigger every acceptance case describes — while `missing_data`/
`human_review_required`/`unknown`-status findings surface as `"warning"`
(visible, never hidden, never excluded from eligibility). Both states
derive exclusively from the engine's own real `REGULATORY_FINDING_STATUSES`
values — no fourth taxonomy invented.

### materialCode behavior

Unchanged — ingredient-based rule types (`ingredient_prohibition`/
`ingredient_restriction`/`concentration_limit`) join via the shared
`matchLines`/`materialFor` matcher, same as Compatibility/Safety, with
graceful (never fabricated) function-/name-keyword fallback for
unresolved lines.

### Unresolved/missing regulatory-data behavior

`unresolvedMaterialCount` (wrapper-only addition) counts unresolved
lines, surfaced honestly alongside real findings. Zero findings is
NEVER reported `"compliant"` — deliberately preserving the exact policy
`regulatory.py`'s own module docstring stated before retirement
("Coverage itself, even with zero matched findings, is always surfaced
— never silently implying a clean COMPLIANT from nothing having
matched"): this installation's real rule catalog is inherently sparse
per jurisdiction (as few as 2 rules for RW/SS), so an empty finding list
far more often means "no rule in this installation's data happens to
cover this yet" than "this product is confirmed clean." `formulaState`
is `"unknown"` for both an unresolved market and a resolved-but-empty
result (Acceptance C).

### `runtime/pipeline/regulatory.py` audit AND retirement result

Confirmed by audit to be a real, independently-computing SECOND final
regulatory-verdict authority: its own `_STATUS_PRECEDENCE` merge
produced its own `overall_status`
(`COMPLIANT`/`COMPLIANT_WITH_CONDITIONS`/`NON_COMPLIANT`/
`DATA_INCOMPLETE`), never consuming the TS engine. By direct catalog
comparison, also confirmed STALE against its own claimed source: its
port carried only 7 of the TS catalog's real 16 seed rules (missing
KE-REG-001/002, every UG rule but one, every TZ/BI/SS rule but one) —
already silently drifting before this task started. **Retired by full
deletion, not permanent reconciliation** (Option A, same precedent
FVL-03.003/.009 already established): `runtime/pipeline/regulatory.py`
(405 lines) and `runtime/pipeline/test_regulatory.py` (14 tests) deleted
entirely. `pipeline.py` — removed `import regulatory`, the
`regulatory_result` computation block, the `regulatory`-sourced
`evidence_gaps` loop, and `card["regulatory"]` from the emitted card
dict; stale comments corrected. `validation_plan.py::build_validation_plan()`
— removed its now-last `regulatory_overall` parameter entirely; VAL-002
(the last remaining Safety/Regulatory advisory checklist entry) removed
outright — the checklist generator is now purely formula-shape-derived
(category, functional roles, batch scale), never re-deriving a business
verdict itself. `test_pipeline.py` — zero-LLM guard changed from
`assertIn("regulatory", card)` to `assertNotIn("regulatory", card)`.
`test_traceability.py` — `test_every_regulatory_finding_has_a_source_or_rule`
(read the now-removed `card["regulatory"]["findings"]`) deleted with an
explanatory comment.

### One genuinely distinct Python capability, deliberately NOT ported

`regulatory.py::review_claims()`'s structural "formulation condition"
check (verifying a "sulfate-free"/"silicone-free"/"fragrance-free" claim
against the formula's own actually-resolved ingredients) has no TS-side
rule-type equivalent. Retired along with the rest of the module rather
than selectively kept, since it computed a real claim VERDICT (feeding
the same status-precedence merge as everything else), not inert
preprocessing — keeping it alone would have left a disguised second
claims-verdict authority inside a supposedly-retired module. Flagged in
the architecture doc for a possible future TS catalog rule-type
addition instead — out of FVL-03's own scope (a Claims/Labels
capability, not a Regulatory Engine one).

### Generated-formula evaluation seam

New pure `apps/desktop/src/lib/generatedFormulaRegulatory.ts::evaluateGeneratedFormulaRegulatory(formula, materials, rules, opts)`
— reshapes via `linesFromGeneratedFormula()`, resolves jurisdiction via
the wrapper-local alias table, calls the real engine directly. The rule
set is a REQUIRED caller-supplied parameter — new `apps/desktop/src/
hooks/useRegulatoryRules.ts` loads the LIVE `regulatory_rules`
masterdata collection, mirroring `useSafetyRules.ts`/
`useCompatibilityRules.ts` exactly. `category` deliberately always
`"human_review_required"` — the real classifier's own honest
admission-of-uncertainty category value, not an invented fallback —
since a generated session has no real `ProductFamily` record to
classify against (same no-fabricated-identity scope decision
FVL-03.008/.009 already made for Safety/Compatibility).

### Old/new UI behavior

`FormulationResultPage.tsx`'s old `RegulatoryTab`/`RegulatoryFindingRow`
(which read the legacy Python-shaped `card.regulatory` fields —
`subject_type`/`subject`/`rule_id`/`condition`/`rationale`/
`overall_status`/`coverage`/`claims`/`missing_coverage_note`) deleted
outright and replaced with a rewritten `RegulatoryTab` rendering a new
thin `GeneratedRegulatorySummary` presenter
(`apps/desktop/src/components/regulatory/`) — showing state, resolved
jurisdiction (or the honest "market unresolved" disclosure), per-finding
status AND verification status side by side, affected materials/claims,
rule code, required action. A Regulatory section added to `SummaryTab`;
a Regulatory row + red "blocked" banner added to `VersionSummaryCard`;
the "Readiness" badges block's stale `card.regulatory.overall_status`
reference — and the now-fully-dead shared `statusTone()` helper it was
the last caller of — removed. `RegulatoryPanel.tsx` (the project-bound,
saved-version panel) untouched.

### Cost/Inventory eligibility interaction

`pickCheapestValidVersion()`/`pickMostInventoryFeasibleVersion()` each
gained an optional 5th `regulatories` parameter — independent of, and
additive to, the existing `compatibilities`/`safeties` gates (three
separate eligibility checks, never merged into one opaque score). A
regulatory-`"blocked"` version can never be crowned cheapest-valid or
most-inventory-feasible; `"warning"`/`"unknown"` never exclude; omitting
the parameter preserves every pre-existing call site's behavior exactly.

### Compatibility separation

Confirmed by construction throughout: no merged findings, no shared
verdict field, no opaque combined score — Compatibility, Safety, and
Regulatory remain three fully separate domain results everywhere.

### Safety separation

Same confirmation — a Safety warning is never treated as a Regulatory
FAIL, and vice versa, anywhere in this session's new code.

### Advanced Optimizer interaction

Confirmed by audit to be a genuine, pre-existing, DOCUMENTED "not yet
implemented" boundary, not a duplicate-authority gap:
`packages/shared/src/schemas/optimization.ts::regulatoryOptimizationPolicySchema.mode`
is hard-locked to the literal `"not_available"` — the solver ignores it
and, per `docs/architecture/IMPLEMENTATION_STATUS.md`'s own pre-existing
text, honestly refuses `regulatory_uncertainty` rather than compute it
from nothing. Wiring the optimizer's own solver to consume a real
regulatory policy would mean extending `runtime/formulation/
advanced_optimizer.py`'s constraint model itself — real new solver
logic, beyond this task's "smallest transport mapping" boundary. Only a
stale doc comment (dated to before the Regulatory Engine itself existed)
was corrected, zero schema/behavior change, verified by the full
`packages/shared` test suite (1311/1311, unchanged count).

### Material Substitution interaction

**A real, new wiring, not merely an audit finding this time** — unlike
Compatibility/Safety, `SubstitutionPanel.tsx`'s one-to-one candidate
scoring had NEVER populated `SubstitutionCandidateInput.regulatoryPermitted`,
even though `substitution.ts`'s own `regulatory_status` scoring
dimension already existed and was already tested. Now wired: for each
candidate, `evaluateRegulatory()` re-runs against the real
`SEED_REGULATORY_RULES` catalog, using the project's own real
`formulation.targetMarkets[0]` (the same field/convention
`RegulatoryPanel.tsx` already treats as the primary jurisdiction) and
the same honest `"human_review_required"` category fallback;
`regulatoryPermitted` is `false` only for a real `non_compliant`
finding, `true` only when every applicable finding is genuinely clean,
`undefined` otherwise — never assumed permitted. Deliberately did NOT
extend `buildCandidateRecord()`'s own exported `SubstitutionCandidate`
schema with a new definite prohibited/permitted output field (it only
ever exposes `regulatoryUncertain: boolean`) — that would be rewriting
the shared engine's own output contract, beyond "consuming authoritative
data." Instead, the one real actionable fact needed — "never present a
prohibited candidate as valid" — is satisfied by additionally excluding
a regulatory-prohibited candidate from the existing `noBlockingOnly` UI
filter, tracked locally by `materialCode`, never persisted, never a
second scoring source. Disclosed limitation: with the REAL current seed
catalog, the `false` branch cannot actually fire yet (no ingredient-based
KE/UG/TZ/RW/BI/SS rule has an empty `productCategories` that would match
a `"human_review_required"` candidate) — identical in kind to the
generated-formula seam's own category-blindness, not a bug in this
session's wiring.

### System Substitution interaction

Confirmed by audit: `packages/shared/src/engine/systemSubstitution.ts`
has zero regulatory references at all, since system-substitution
candidate evaluation routes entirely through the same Advanced
Optimizer (FVL-03.007's own established architecture) — inheriting the
identical, already-documented Optimizer-level gap above, not a second,
independent gap.

### Report/export source

`formulationReport.ts`'s `versionSection()`/`buildReportHtml()`/
`openAndPrintReport()` rewired to accept a `regulatoryByVersion` map —
built from the exact same computed `regulatories` array the UI renders
— instead of reading the retired `card.regulatory` JSON. Backward-
compatible default `= {}`; an honest "not available" when no result was
computed. This closes the same "Download Report" split-authority risk
FVL-03.009 already closed for Safety.

### Historical compatibility

`formulationV2.ts`'s `RegulatoryResult`/`RegulatoryFinding`/`ClaimFinding`
interfaces kept, not deleted — doc comment updated to state plainly
they are legacy-only, read by zero current code. Proven by two rewritten
`FormulationResultPage.test.tsx` tests against the pre-existing
SESSION_V6 fixture (which still carries a real legacy `card.regulatory`
object with a fabricated "rosemary" claim finding and a
"COMPLIANT_WITH_CONDITIONS" status): the Regulatory tab shows neither
the legacy claim text nor that legacy status, only the freshly
recomputed authoritative result — which, once the fixture's brief was
given a real `market: "kenya"` field (a legitimate test-data
completion, not a rewrite to force a result), legitimately produced its
own real `KE-REG-003` (label_requirement) `missing_data` finding via the
same real, unmodified seed catalog mechanism FVL-03.009's own SESSION_V6
test discovered for Safety.

### Single-authority grep/audit result

Closure-time re-audit (`evaluate_regulatory`, `evaluateRegulatory`,
`regulatory status`, `regulatory verdict`, `overall_status`,
`compliance`, `not_verified`, `regulatoryClassification`,
`regulatoryRules` across `runtime/pipeline`, `runtime/formulation`,
`packages/shared/src`, `apps/desktop/src`,
`apps/desktop/src-tauri/src`): zero live-code hits outside the one
authoritative TS engine and its already-confirmed-correct callers
(`ApprovalPanel.tsx`/`RegulatoryPanel.tsx`, both pre-existing and
unrelated to generated formulas; `claims.ts`'s own pre-existing,
unrelated comment reference). The only remaining `card.regulatory`/
`overall_status` matches anywhere are explanatory comments and
disposable test fixtures documenting the retirement.

### Zero-LLM result

Unaffected — no LLM touched anywhere this session; regulatory evaluation
is 100% deterministic rule matching, same guarantee as every other
engine wired in prior FVL-03 sessions.

### Acceptance A-M results

A/B/C/D proven directly by 14 new `generatedFormulaRegulatory.test.ts`
tests using disposable fixture rules — a real verified prohibited-
ingredient finding → `"blocked"`; no matching prohibition → not
blocked; unresolved material honestly disclosed; a `not_verified`
rule's finding stays explicit, never promoted to a clean verdict — plus
market-resolution, zero-findings-never-compliant, category-scoping, and
pure-no-Tauri-call coverage. E/F proven by 5 new `costComparison.test.ts`
+ 3 new `inventoryComparison.test.ts` tests. G confirmed by audit + the
corrected stale doc comment (Advanced Optimizer never fabricates a
regulatory constraint, honestly refuses instead). H proven by 2 new
`SubstitutionPanel.test.tsx` market-scoping tests plus the underlying
`generatedFormulaRegulatory.test.ts` non_compliant-exclusion proof (the
real seed catalog cannot itself trigger `non_compliant` for a
`human_review_required` category on a real candidate — an honest,
disclosed structural limitation, not a bug). I confirmed by audit
(System Substitution inherits the same documented Optimizer-level gap,
no local clone). J/K proven by 2 rewritten `FormulationResultPage.test.tsx`
tests plus 3 new `formulationReport.test.ts` tests. L proven by dedicated
`resolveRegulatoryMarket` tests (never guesses an unrecognized market).
M proven by this entry's own "Single-authority grep/audit result"
section above.

### Tests / results

`pnpm --filter @formulab/desktop test` — 1416/1416 passing across 152
files (32 new: 14 `generatedFormulaRegulatory.test.ts`, 8
`GeneratedRegulatorySummary.test.tsx`, 5 `costComparison.test.ts`, 3
`inventoryComparison.test.ts`, 3 `formulationReport.test.ts`, 2
`SubstitutionPanel.test.tsx`; `FormulationResultPage.test.tsx` count
unchanged at 51, 3 tests corrected in place). `pnpm --filter
@formulab/desktop typecheck` / `lint` — clean. `pnpm --filter
@formulab/shared test` — 1311/1311 (comment-only edit in
`optimization.ts`, unchanged count — the only `packages/shared` change
this session). `python -m pytest runtime/pipeline -q` — 361 passed, 5
subtests (down from the 376+5 baseline by exactly 15 = 14 deleted
`test_regulatory.py` tests + 1 deleted `test_traceability.py` test).
`runtime/formulation`, `apps/desktop/src-tauri/src/formulation*`
confirmed untouched by `git status`/diff this session — no cargo run
performed (nothing in that tree changed).

### Tracker validation

`docs/FORMULAB_V1_TASK_TRACKER.md` — `FVL-03.010` marked `COMPLETED
(2026-08-18)` with full evidence; completion-summary table corrected
(FVL-03: 15/18 → 16/18; Total: 60/171 → 61/171, 35.7%).
`python scripts/validate_v1_tracker.py` — OK, 171 tasks, no drift (run
before and after all edits). `git diff --check` — clean (LF/CRLF
warnings only).

### Tracker update

Same as above — full evidence paragraph written into the FVL-03.010 row.

### GitHub update

One completion comment on issue #4
(`https://github.com/Sekiph82/FormuLab/issues/4#issuecomment-5333471410`)
— full summary matching this log entry. No new issue created.

### Build/shortcut result

Not applicable — no desktop rebuild/installer performed this session (no
Rust or shipped-runtime code changed at all; TS/shared changes fully
covered by `typecheck`/`lint`/vitest, Python changes covered by
`pytest`, matching the standing "full rebuild reserved for closure
sessions" policy).

### Files changed

New: `apps/desktop/src/lib/generatedFormulaRegulatory.ts` (+`.test.ts`),
`apps/desktop/src/hooks/useRegulatoryRules.ts`,
`apps/desktop/src/components/regulatory/GeneratedRegulatorySummary.tsx`
(+`.test.tsx`). Modified: `apps/desktop/src/app/routes/
FormulationResultPage.tsx` (+`.test.tsx`), `apps/desktop/src/components/
formula/SubstitutionPanel.tsx` (+`.test.tsx`), `apps/desktop/src/lib/
costComparison.ts` (+`.test.ts`), `apps/desktop/src/lib/
inventoryComparison.ts` (+`.test.ts`), `apps/desktop/src/lib/
formulationReport.ts` (+`.test.ts`), `apps/desktop/src/lib/formulationV2.ts`,
all 8 `apps/desktop/src/i18n/locales/*/session.json`,
`packages/shared/src/schemas/optimization.ts` (comment-only),
`runtime/pipeline/pipeline.py`, `runtime/pipeline/validation_plan.py`,
`runtime/pipeline/test_pipeline.py`, `runtime/pipeline/test_traceability.py`,
`docs/FORMULAB_V1_TASK_TRACKER.md`,
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`,
`docs/handoffs/FORMULAB_V1_CURRENT.md`. Deleted:
`runtime/pipeline/regulatory.py`, `runtime/pipeline/test_regulatory.py`.
Stray pre-existing working-tree changes (`docs/generated/*`, `formulas/*`
deletions, untracked Phase logs) left untouched, unrelated, per standing
decision.

### Commit SHA

`67ac343` — "feat(v1): consolidate authoritative Regulatory Engine".
`fa96142` — "docs: finalize FVL-03.010 closure pointer with commit SHA".

### Push result

Both commits pushed to `origin/feature/laboratory-stability`. No force
push, no history rewrite. Local HEAD == remote HEAD == `fa96142`.

### Exact next frozen task (Session 11)

**FVL-03.010 COMPLETED**

**NEXT: FVL-03.011 — NOT STARTED**

---

## Session 12 — FVL-03.011 implementation (2026-08-18)

### Scope

End-to-end authoritative provenance integration: supplier/material/
safety/regulatory/compatibility provenance remains traceable end-to-end,
carrying each authoritative engine's real source IDs — extend
`traceability.py`'s existing model, do not fork it. No subagents used
this session, per explicit instruction. Provenance only — FVL-03.012
(single-authority integration acceptance, the final FVL-03 closure task)
NOT started.

### Branch / commit state

- Branch: `feature/laboratory-stability`.
- Starting HEAD: `fa96142`.
- Final HEAD: `e77ec3d`.
- `git rev-parse HEAD` == `git rev-parse origin/feature/laboratory-stability`
  — both `e77ec3d`. Nothing ahead/behind.

### FVL-03.011 status

**COMPLETED.**

### Provenance model

Confirmed by full audit (`traceability.py`, `provenance.py`,
`pipeline.py`, `engine.py`, every FVL-03.002-.010 domain's own
persisted/computed record shape, the promotion path, existing UI): ONE
coherent provenance model already exists, correctly NOT forked. No
`traceability_v2.py`/`provenance_engine.py`/second source-reference
schema was created — zero Python files touched this session.

### Material lineage

Confirmed unchanged and correct: `material_code` carried in
`TraceEvent.source_ids` since FVL-03.002 (`engine.py:1263-1275`), in
addition to, never instead of, the INCI/name text-matching pool key.
New this session: the `GeneratedIngredient` TS type didn't even carry
`material_code` and no ingredient row in the result UI displayed it at
all — added the field (optional, backward-compatible) and an honest
subtext under each ingredient name in `FormulaTab` (the real code when
resolved, an explicit "Unresolved — no canonical material match"
disclosure otherwise).

### Supplier lineage

Confirmed unchanged, canonical, no ranking rule introduced: Cost/
Substitution already reference `MaterialSupplier`/`Supplier` records by
their own real codes (`priceFor()`, `suppliers.find(s => s.code ===
priceChoice?.price.supplierCode)`); nothing new needed or added.

### Compatibility lineage

Confirmed the finding's real `ruleId`/`materialIds` existed on the
`CompatibilityFinding` record all along but `GeneratedCompatibilitySummary.tsx`
used `ruleId` only as a React `key`, never displaying it — fixed, now
shown on every finding row. `formulationReport.ts`'s "Download Report"
had NO Compatibility section at all since FVL-03.008 (Safety/Regulatory
each got one in FVL-03.009/.010) — added, reusing the exact same
already-computed `compatibilities` array the UI tab renders.

### Safety lineage

Same fix as Compatibility: `GeneratedSafetySummary.tsx` computed each
finding's real `ruleId`/`affectedMaterialIds` but never rendered them —
now shown on every finding row. Safety's own report section (added
FVL-03.009) already showed `ruleId`, confirmed unchanged.

### Regulatory lineage

Confirmed already correct — FVL-03.010's own `GeneratedRegulatorySummary.tsx`
and report section already showed `ruleCode`/market/`verificationStatus`
from the moment they were built this arc; nothing further needed.
`not_verified` remains visibly `not_verified` throughout — provenance
records what happened, never upgrades a rule's own authority.

### Scientific/evidence lineage

Confirmed untouched (FVL-03.013-.018 already complete) — not re-audited
beyond confirming this task introduced no fork or duplicate alongside
it.

### Generated→saved lineage

Confirmed ALREADY satisfied, not a gap: `promoteGeneratedFormula.ts::buildPromotedFormulation()`
(FVL-03.005's own original work) already writes a real, structured
back-reference into the EXISTING `FormulationVersion.changeReason`
field — `"Promoted from AI-generated session ${session.id}, ${card.version.toUpperCase()}, for Advanced Optimizer refinement."`
— answering "which exact generated session/version produced this saved
version" without any new persistence system.

### Substitution lineage

Confirmed unchanged, correct: `substitution_runs`/`optimization_runs`
(FVL-03.006/.007) already persist real IDs before ever touching the
working draft; nothing new needed.

### Optimization lineage

Confirmed unchanged, correct: `optimization_runs.projectId` already
links to the real promoted `Formulation.id` (FVL-03.005); nothing new
needed.

### Duplicate-authority audit

No second provenance framework, no new hazard/verdict/scoring logic
introduced anywhere this session — confirmed by diff review (only
display-layer additions and one optional TS type field).

### Cost provenance

Confirmed unchanged: `CostSnapshot.priceRecordCodes`/`exchangeRateCodes`
already real references; not touched, not re-derived.

### Inventory provenance

Confirmed unchanged: inventory evaluation already keyed by real
`materialCode`; not touched, not re-derived.

### Acceptance P1-P12 results

P1/P2 proven by a new `FormulationResultPage.test.tsx` test (SESSION_V6's
genuinely unresolved ingredient shows the honest disclosure, never a
fake id) plus the pre-existing decoy-material-immunity tests in every
domain's own `generatedFormula*.test.ts`. P3/P4 proven by 2 new tests in
`GeneratedSafetySummary.test.tsx`/`GeneratedCompatibilitySummary.test.tsx`.
P5/P6 already proven by FVL-03.010's own `generatedFormulaRegulatory.test.ts`.
P7 confirmed untouched. P8/P9 confirmed by FVL-03.006/.007's own existing
persistence, unchanged. P10 confirmed by FVL-03.005's own existing
linkage. P11 proven by 3 new `formulationReport.test.ts` tests (the
Compatibility section uses the same computed result the UI uses,
discloses unresolved coverage honestly, shows "not available" rather
than a fabricated verdict). P12 confirmed — no new session-storage
schema field was added anywhere; a historical session opens exactly as
before.

### Tests / results

`pnpm --filter @formulab/desktop test` — 1422/1422 passing across 152
files (6 new: 1 `FormulationResultPage.test.tsx`, 1
`GeneratedSafetySummary.test.tsx`, 1 `GeneratedCompatibilitySummary.test.tsx`,
3 `formulationReport.test.ts`). `pnpm --filter @formulab/desktop
typecheck` / `lint` — clean. `python -m pytest runtime/pipeline -q` —
361 passed, 5 subtests (unchanged — zero Python files touched this
session). `packages/shared`, `runtime/formulation`, `apps/desktop/
src-tauri/src/formulation*` confirmed untouched by `git status`/diff —
no shared/cargo sanity re-run performed.

### Tracker validation

`docs/FORMULAB_V1_TASK_TRACKER.md` — `FVL-03.011` marked `COMPLETED
(2026-08-18)` with full evidence; completion-summary table corrected
(FVL-03: 16/18 → 17/18; Total: 61/171 → 62/171, 36.3%).
`python scripts/validate_v1_tracker.py` — OK, 171 tasks, no drift.
`git diff --check` — clean (LF/CRLF warnings only).

### GitHub update

Deferred to the combined FVL-03.011+.012 closure comment (per this
session's own task brief §B22 — "FVL-03.011 completed" is recorded
alongside the final FVL-03 package closure comment, not as a separate
mid-package comment, since FVL-03.012 is expected to complete in the
same session immediately after).

### Files changed

Modified: `apps/desktop/src/app/routes/FormulationResultPage.tsx`
(+`.test.tsx`), `apps/desktop/src/components/compatibility/
GeneratedCompatibilitySummary.tsx` (+`.test.tsx`), `apps/desktop/src/
components/safety/GeneratedSafetySummary.tsx` (+`.test.tsx`),
`apps/desktop/src/lib/formulationReport.ts` (+`.test.ts`),
`apps/desktop/src/lib/generatedFormula.ts`, all 8 `apps/desktop/src/
i18n/locales/*/session.json`, `docs/FORMULAB_V1_TASK_TRACKER.md`,
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`, `docs/handoffs/
FORMULAB_V1_CURRENT.md`. No files deleted. Stray pre-existing
working-tree changes (`docs/generated/*`, `formulas/*` deletions,
untracked Phase logs) left untouched, unrelated, per standing decision.

### Commit SHA

`cd19551` — "feat(v1): complete authoritative formulation provenance".
`e77ec3d` — "docs: finalize FVL-03.011 closure pointer with commit SHA".

### Push result

Both commits pushed to `origin/feature/laboratory-stability`. No force
push, no history rewrite. Local HEAD == remote HEAD == `e77ec3d`.

### Exact next frozen task (Session 12)

**FVL-03.011 COMPLETED**

**NEXT: FVL-03.012 — NOT STARTED**

Continuing immediately into FVL-03.012 in this same session, per this
session's own explicit "do not stop between .011 and .012" instruction.

---

## Session 13 — FVL-03.012 implementation, FVL-03 PACKAGE CLOSURE (2026-08-18)

### Scope

Final FVL-03 single-authority integration acceptance: prove exactly one
authoritative result per domain remains, with no duplicated business
calculation, covering at least one cost-constrained and one
substitution-triggered request. No subagents used this session, per
explicit instruction. Closure/acceptance task only — no new features
added; FVL-04 implementation explicitly NOT started.

### Branch / commit state

- Branch: `feature/laboratory-stability`.
- FVL-03.011 starting HEAD: `fa96142`. FVL-03.011 final HEAD: `e77ec3d`.
- FVL-03.012 starting HEAD: `e77ec3d`. FVL-03.012 final HEAD: `4deaf01`.
- `git rev-parse HEAD` == `git rev-parse origin/feature/laboratory-stability`
  — both `4deaf01`. Nothing ahead/behind.

### FVL-03.011 status

**COMPLETED** (see Session 12 entry above for full detail).

### FVL-03.012 status

**COMPLETED.**

### Final FVL-03 status

**FVL-03 — Unified Formulation Pipeline ↔ Existing FormuLab Engines —
COMPLETE (18/18).** GitHub issue #4 closed 2026-08-18, matching FVL-01
(#2)/FVL-02 (#3)'s own established closure convention (both were
actually closed via `gh issue close` on completion, confirmed by
`gh issue view` before acting).

### Material authority

`packages/shared/src/schemas/materials.ts`, canonical `data/master/
materials.json` via `masterdata.rs`, identity = `RawMaterial.code`. No
parallel material master exists. Generation-path usage confirmed on the
canonical path since FVL-03.002; the legacy CSV-import screen's own
storage remains, permanently, for its own separate, unrelated purpose.

### Supplier authority

`Supplier`/`MaterialSupplier` records, canonical, identity =
`Supplier.code`. Cost/Substitution reference these directly; no ranking
rule invented anywhere.

### Cost authority

`packages/shared/src/engine/cost.ts::costFormula`/`buildCostSnapshot`.
Real price selection, real landed cost, real FX conversion; missing
price/FX stays missing (never zero). No Python `cost_formula` clone
remains (deleted FVL-03.003). Generated formulas use this engine via
`generatedFormulaCost.ts`, reconfirmed by this session's new
cost-constrained acceptance test using the REAL engine, not a hand-built
snapshot.

### Inventory authority

`packages/shared/src/engine/inventoryAvailability.ts::evaluateMaterialAvailability`
for the FVL-03 integrated generated-formula workflow — one canonical
evaluation, `hasRecords: false` never treated as zero, quarantine/
release/expiry semantics real and consistent. **Disclosed, pre-existing,
pre-FVL-03 gap re-confirmed, not ignored**: `MaterialsPage.tsx`/
`AdvancedOptimizerPanel.tsx`/`SubstitutionPanel.tsx` still compute
`quantity − reservedQuantity` inline rather than calling the canonical
function (already disclosed in FVL-03.004's own doc comment as
deliberately out of scope) — does not conflict with the integrated
workflow this domain's own acceptance targets, so does not block
closure; flagged again explicitly for a future session.

### Compatibility authority

`evaluateCompatibility` is authoritative; `rules.py` confirmed
request-constraints-only, not a competing engine; blocking semantics
(`severity === "blocking"`) consistent everywhere; generated formulas,
Optimizer, and Substitution all consume the same authoritative output.

### Safety authority

`evaluateSafety` is the sole current final authority;
`runtime/pipeline/safety.py` remains retired (deleted, FVL-03.009); no
current report/UI uses a legacy safety verdict; missing material safety
stays unknown, never safe.

### Regulatory authority

`evaluateRegulatory` is the sole current final authority;
`runtime/pipeline/regulatory.py` remains retired (deleted, FVL-03.010);
market scoping preserved (KE/UG/TZ/RW/BI/SS/EAC); verified/not_verified
distinction preserved throughout; no current report/UI consumes an
alternative verdict.

### Material Substitution authority

`substitution.ts::scoreCandidate`/`buildCandidateRecord` is the one
authoritative one-to-one substitution engine; no pipeline-local scoring
clone exists anywhere.

### System Substitution authority

`systemSubstitution.ts` routes entirely through the Advanced Optimizer
(FVL-03.007's own established architecture); no local candidate/scoring
clone; confirmed by audit not conflated with one-to-one substitution.

### Advanced Optimizer authority

`runtime/formulation/advanced_optimizer.py` (PuLP/CBC) remains the sole
advanced optimization engine; deterministic candidate generation
(`engine.py`) confirmed a separate, non-overlapping responsibility; the
optimizer consumes caller-computed Compatibility/Safety risk from their
own real authorities, never reinventing those verdicts; its own
regulatory-consumption boundary remains a genuine, pre-existing,
documented "not yet implemented" state (`regulatoryOptimizationPolicySchema.mode`
locked to `"not_available"`) — not touched, only a stale doc comment
corrected in FVL-03.010.

### Deterministic formula-generation authority

`runtime/pipeline/engine.py` remains the sole generation engine, zero LLM
involvement, confirmed by this session's own live materialized-directory
generation run in addition to the full `pytest` regression.

### Provenance model

One coherent model, `traceability.py` extended (in spirit — zero lines
changed this session) not forked (FVL-03.011's own full audit,
reconfirmed here).

### Scientific/evidence lineage

Confirmed untouched throughout (FVL-03.013-.018 already complete).

### Generated→saved lineage

Confirmed already satisfied via the existing `FormulationVersion.changeReason`
field (FVL-03.011's own finding, reconfirmed here).

### Substitution lineage

`substitution_runs`/`optimization_runs` persist real IDs before ever
touching the working draft; reconfirmed by this session's own new
substitution-triggered acceptance test (a real `substitution_runs`
record with a real `selectedCandidateId` was asserted).

### Optimization lineage

`optimization_runs.projectId` links to the real promoted
`Formulation.id`; unchanged, confirmed correct.

### Duplicate-authority audit

Repository-wide greps (material/cost/inventory/compatibility/safety/
regulatory/substitution/optimization/provenance search terms) across
`runtime/pipeline`, `runtime/formulation`, `packages/shared/src`,
`apps/desktop/src`, `apps/desktop/src-tauri/src`: zero category-E
("actual duplicate business authority") hits. Full classification (A
authoritative engine / B legitimate adapter / C separate legitimate
responsibility / D dead legacy code / E duplicate) recorded in
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`'s new "Final
duplicate-business-logic audit" section.

### Cost-constrained acceptance

New `costComparison.test.ts::describe("FVL-03.012 — cost-constrained
integration acceptance")` test — disposable materials/prices/factory-
profile fixtures fed through the REAL `costGeneratedFormula()`/
`buildCostSnapshot()` engine for three alternatives sharing the exact
ingredient shape `pipeline.py::run()` actually emits. A real cheaper
total is genuinely lower (computed, not asserted); a missing-price
version carries a real `missingDataWarnings` entry and cannot win; an
`invalid_constraint_violation` alternative is never selected even at the
lowest raw total; no Python duplicate costing participates (100%
client-side TS by construction).

### Substitution-triggered acceptance

New `SubstitutionPanel.test.tsx::describe("FVL-03.012 — substitution-
triggered integration acceptance")` test — no auto-substitution (a human
must click Apply, `onApply` unfired until then); the applied line
carries the candidate's REAL canonical `materialCode` ("C"), never a
display-name guess; the substitution is traceable (a real
`substitution_runs` record with a real `selectedCandidateId`); source
formula/session never mutated; no duplicate substitution scorer (the
real, unmodified `scoreCandidate`/`buildCandidateRecord` compute
everything).

### Hard-constraint acceptance

Already proven by the pre-existing `costComparison.test.ts::"compatibility-
blocked, safety-blocked, and regulatory-blocked are three independent
exclusion gates"` test (built incrementally across FVL-03.008/.009/.010,
reconfirmed passing this session) and the equivalent
`inventoryComparison.test.ts` gates.

### Missing/unknown-data acceptance

Confirmed honest throughout by the full existing suite: unresolved
material → `unresolvedMaterialCount`/`"unknown"`; missing price/FX →
real warnings, never zero; missing inventory record → `hasRecords:
false`, never zero usable quantity; incomplete Compatibility/Safety/
Regulatory coverage → `"unknown"`/`"warning"`, never fabricated clean;
`not_verified` stays `not_verified`; unavailable material never
auto-substituted; zero LLM fallback anywhere.

### Old/new UI confirmation

Both `/live` and the new formulation-request/-result UI remain,
confirmed untouched this session; both consume the exact same
authoritative engines. Retirement decision remains `FVL-11.005`'s, not
made or moved here.

### Zero-LLM result

`test_llm_call_is_never_reached_by_the_deterministic_path` re-verified
passing as part of the full 361/5 Python suite; additionally confirmed
by this session's own live materialized-directory generation run
(`formulation_v2.rs` → `run_cli.py` → `pipeline.py` → `engine.py`,
zero LLM involvement, `status: "ok"`).

### A real, build-breaking Rust regression found and fixed

`apps/desktop/src-tauri/src/formulation_v2.rs::materialize_pipeline()`
still `include_str!`'d the two Python files FVL-03.009/.010 deleted
(`F_SAFETY`/`F_REGULATORY` constants, pointing at the now-nonexistent
`runtime/pipeline/safety.py`/`regulatory.py`) — those two sessions
correctly made no Rust changes and so correctly never ran `cargo check`
themselves (their own scope discipline was right), but this left the
SHIPPED DESKTOP BINARY unable to compile at all, undiscovered until this
session's own mandatory `cargo check` regression run surfaced it. Fixed
by removing both dead constants and their `materialize_pipeline()` list
entries. Verified end to end, not just by `cargo check` passing: the
exact materialized file set was reproduced in a disposable temp
directory (the same verification method FVL-02.009 established for the
analogous missing-file defect), `pipeline.py` imported cleanly with no
`ImportError`, and a real deterministic generation was run through it
(`status: "ok"`, 3 real cards, `"safety"`/`"regulatory"` correctly absent
from the card dict). `cargo test formulation_v2` — 10/10 passing.

### Python tests

`python -m pytest runtime/pipeline -q` — 361 passed, 5 subtests
(unchanged this session — zero Python files touched).

### Shared tests

`pnpm --filter @formulab/shared test` — 1311/1311 (unchanged this
session — only a comment-only edit in FVL-03.010, nothing this session).

### Desktop tests

`pnpm --filter @formulab/desktop test` — 1424/1424 across 152 files (2
new: `costComparison.test.ts`, `SubstitutionPanel.test.tsx`).

### TypeScript / ESLint

`pnpm --filter @formulab/desktop typecheck` — clean. `pnpm --filter
@formulab/desktop lint` — clean.

### Rust checks/tests

`cargo check` — clean (after the fix above; FAILED before the fix,
confirming the regression was real). `cargo test formulation_v2` —
10/10 passing.

### Tracker validation

`python scripts/validate_v1_tracker.py` — OK, 171 tasks, no drift (run
before and after all edits). `git diff --check` — clean (LF/CRLF
warnings only).

### Tracker completed count

FVL-03.012 marked `COMPLETED (2026-08-18)`. FVL-03: 17/18 → 18/18
(100%, closed). Total: 62/171 → 63/171 (36.8%).

### FVL-03 completed count

18/18 — the entire package is now closed, joining FVL-01 (21/21) and
FVL-02 (24/24) as the third fully-closed work package.

### GitHub issue #4 result

One combined completion comment covering both FVL-03.011 and FVL-03.012
(`https://github.com/Sekiph82/FormuLab/issues/4#issuecomment-5333925406`),
followed by `gh issue close 4 -R Sekiph82/FormuLab -r completed` —
confirmed CLOSED via `gh issue view` after closing, matching FVL-01
(#2)/FVL-02 (#3)'s own established convention (both confirmed actually
closed via the same command, checked before acting, not assumed).

### Files changed

FVL-03.011: `apps/desktop/src/app/routes/FormulationResultPage.tsx`
(+`.test.tsx`), `apps/desktop/src/components/compatibility/
GeneratedCompatibilitySummary.tsx` (+`.test.tsx`), `apps/desktop/src/
components/safety/GeneratedSafetySummary.tsx` (+`.test.tsx`),
`apps/desktop/src/lib/formulationReport.ts` (+`.test.ts`),
`apps/desktop/src/lib/generatedFormula.ts`, all 8 i18n locale files.
FVL-03.012: `apps/desktop/src-tauri/src/formulation_v2.rs` (the Rust
fix), `apps/desktop/src/components/formula/SubstitutionPanel.test.tsx`,
`apps/desktop/src/lib/costComparison.test.ts`. Both sessions:
`docs/FORMULAB_V1_TASK_TRACKER.md`,
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`,
`docs/handoffs/FORMULAB_V1_CURRENT.md`. No files deleted this session.
Stray pre-existing working-tree changes (`docs/generated/*`,
`formulas/*` deletions, untracked Phase logs) left untouched, unrelated,
per standing decision throughout.

### Commits

FVL-03.011: `cd19551` (feat), `e77ec3d` (docs closure pointer).
FVL-03.012: `0876c0b` (test — the suggested `test(v1): close FVL-03
single-authority integration` message), `4deaf01` (docs closure
pointer).

### Push result

All four commits pushed to `origin/feature/laboratory-stability`. No
force push, no history rewrite. Local HEAD == remote HEAD == `4deaf01`.

### Local/remote HEAD comparison

`git rev-parse HEAD` == `git rev-parse origin/feature/laboratory-stability`
== `4deaf01`. Confirmed match.

### Exact next frozen task (Session 13)

**FVL-03.011 COMPLETED**

**FVL-03.012 COMPLETED**

**FVL-03 — COMPLETE (18/18)**

**NEXT: FVL-04.001 — NOT STARTED**

**FVL-04 IMPLEMENTATION — NOT STARTED.**
