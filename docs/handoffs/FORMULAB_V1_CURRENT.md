# FormuLab v1 — Current Execution Pointer

**Do not create a new task outside `docs/FORMULAB_V1_TASK_TRACKER.md`.**
This file only points at the tracker's current state — it is not itself a
scope document. Frozen scope: `docs/FORMULAB_V1_FINAL_SCOPE.md`.

## Frozen scope reference

- Scope: [`docs/FORMULAB_V1_FINAL_SCOPE.md`](../FORMULAB_V1_FINAL_SCOPE.md)
  — frozen 2026-08-17.
- Tracker: [`docs/FORMULAB_V1_TASK_TRACKER.md`](../FORMULAB_V1_TASK_TRACKER.md)
  — 11 work packages (FVL-01..FVL-11), 171 tasks total (FVL-04 grew from
  12 to 26 tasks on 2026-08-18 — see "FVL-04 scope expansion" below).

## Current work package

**FVL-03 — Unified Formulation Pipeline ↔ Existing FormuLab Engines** —
**CLOSED, 18/18 tasks COMPLETED** (FVL-03.001 through FVL-03.012,
FVL-03.013-018). FVL-01 remains CLOSED (21/21); FVL-02 remains CLOSED
(24/24, 2026-08-17). GitHub issue #4 closed 2026-08-18 to match.

**FVL-04 — Data Onboarding Through Existing Data Exchange** — ON
PROCESS, 18/26 tasks COMPLETED. **FVL-04.001-.012 — COMPLETE, HARDENED,
AND NO KNOWN CANONICAL/TEMPLATE ONBOARDING GAP REMAINS.** **FVL-04.013-.018
FINAL-HARDENED AND COMPLETED** (external source connector contract
through transformation/unit/enum mapping, plus two independent
end-to-end customer fixtures proving the whole chain through real Data
Exchange commit — including the REAL PRODUCTION import dialog's own
reference resolution, now genuinely field-aware for composite-key
targets, no self-reference bypass, an exact immutable Mapping Profile
version chain, and a discriminated `FileConnectorInput`/`FileConnectorSource`
contract) — see "FVL-04.013-.018 final correction (Session 8)",
"FVL-04.013-.018 hardening (Session 7)", "FVL-04.013-.018 hardening
(Session 6)", and "FVL-04.013-.018 resolution (Session 5)" below.
**FVL-04 EXTERNAL CONNECTOR FOUNDATION — FINAL CLOSURE VERIFIED.**
**FVL-04.019 — COMPLETED** (Formula/Recipe Relationship Import),
**FVL-04.020 — COMPLETED** (Laboratory/Test Result Relationship
Import), **FVL-04.021 — COMPLETED** (Generic Database Read Connector —
engine layer; real driver adapter wired later), **FVL-04.022 —
COMPLETED** (REST API Connector Contract — engine layer; real HTTP
client adapter wired later) — see their own resolution sections below.
FVL-04.023-.026 remain blank, none started.

## Current task

**`FVL-04.023`** — blank, **NOT STARTED** (Incremental Re-import /
Conflict Handling — depends on FVL-04.024, the Connector -> Data
Exchange Bridge, which is built next; the queued task order named
.023 before .024 but the tracker's own dependency graph requires the
bridge to exist first, so this session builds .024 before .023,
documented here rather than silently reordered). FVL-04.019/.020/
.021/.022 just closed — see their own resolution sections below.
FVL-04.013-.018 (External
Source Connector Contract, Generic File Connector, Source Schema
Discovery, Mapping Profile Model, External ID Crosswalk Registry,
Transformation/Unit/Enum Mapping) all COMPLETED in an earlier session,
independently re-audited and hardened in Session 6 (a single
unit-conversion authority, storage-enforced mapping-profile immutability,
real end-to-end reference resolution in a TEST path, calendar-valid date
parsing, stricter decimal validation, honest external-ID identity
evidence), independently re-audited a SECOND time and hardened again in
Session 7 (the most important remaining gap at the time: PRODUCTION's own
`DataExchangeImportDialog` never actually validated `code_reference`
existence at all — fixed by reusing the existing per-template
existing-record authority through a new `buildReferenceResolver()`,
wired into both production and this layer's own end-to-end tests; plus
file-level provenance corrections, a real generic FILE `SourceConnector`
implementation, sanitized parse errors, a corrected mapping-profile
version-lifecycle model, transformation runtime-safety fixes, and
API-enforced ordinal-crosswalk rejection), then given a narrow FINAL
correction pass in Session 8 (Session 7's own reference resolver
silently checked the wrong key for every reference into a
composite-natural-key target; a blanket self-reference bypass existed;
the mapping-profile version chain allowed gaps/branching and an unlinked
draft could wrongly mark an active predecessor superseded; the generic
file-connector input types allowed an invalid shape to silently default
to empty content) — see "FVL-04.013-.018 final correction (Session 8)"
below. FVL-04.005-.012 were closed,
then independently re-audited and hardened (real gaps found and fixed: a
unit-contract bug in the Optimizer/Substitution stock fields, a missing
real Manufacturing Procedure consumer for process_parameters, and a
missing `material_suppliers` Data Exchange template), then two
explicitly user-approved remaining gaps were closed in this session — a
real finished-product specification domain (schema + Data Exchange
template + real UI consumer) and a dedicated per-material TDS/SDS/
specification document viewer. FVL-04.001-.004 (Material Master,
Supplier/MaterialSupplier link, TDS, and SDS Data Exchange coverage)
COMPLETED in an earlier session.

## FVL-04.019 resolution (this session — Formula/Recipe Relationship Import)

Audit found the existing `formula_bom` Data Exchange template (registered
in an earlier session) already covers most of this task: real reference
validation on `material_code` (REQUIRED, `raw_materials`), exact decimal
percent/quantity passthrough, `formula_code`/`formula_version` preserved
directly as the canonical `Formulation.code`/`FormulationVersion.
versionNumber` (blank `formula_version` auto-appends the next version),
no trade-name matching anywhere. One real gap found and fixed:
`commitFormulaBom` built the saved version through the bare `newVersion()`
helper, which never computes `totalsSnapshot`/`validationSnapshot` — an
imported formula silently skipped the SAME mass/composition-structure
validation (`validateFormula()`) every hand-authored version gets. Fixed
by switching to the single-authority `createVersion()`
(`engine/versioning.ts`), the exact function the real Formula Builder
save path already uses. New end-to-end test proves a customer recipe's
material reference resolves through the REAL External ID Crosswalk
before reaching `formula_bom.material_code`, fans two lines into one
real `FormulationVersion`, and that version's totals/validation are
genuinely computed. Two disclosed non-blocking scope decisions:
`quantity_unit` has no dedicated known-unit check (not required; unit
normalization is the upstream mapping/transformation layer's own job);
"source lineage" is satisfied by the EXISTING Data Exchange import-job
history plus the connector's own `MappingResult.trace` — deliberately
not a second lineage field on `Formulation`, consistent with FVL-04.024's
own "no second import-history model" requirement.
`pnpm --filter @formulab/desktop test`: 1556/1556 (158 files).
`typecheck`/`lint`: clean. FVL-04 now 19/26.

## FVL-04.020 resolution (this session — Laboratory/Test Result Relationship Import)

Audit found the existing `lab_results` Data Exchange template already
covers most of this task (real reference validation on `test_code`,
replicate grouping, exact raw value passthrough, `passFail` always
forced `not_evaluated` on import). `trial_code` has no `referenceTemplate`
since `laboratory_trials` is deliberately not itself Data-Exchange-
importable — the same established pattern every other non-importable-
parent reference in the registry already uses; existence is checked at
commit time via `findByCode`. Two real gaps found and fixed: (1) the
template's own `instrument` column was read but silently dropped —
`testResultSchema` had no field for it; added `instrument?: string`
(additive, optional) and wired it through `commitLabResults`. (2)
`project_code`/`formula_version` were accepted but never used — added a
cross-check against the RESOLVED trial's own real link
(`LaboratoryTrial.projectId`/`sourceFormulaVersionId`, never duplicated
onto `TestResult`), refusing the commit on a genuine mismatch — real
unresolved-linkage detection for a wrong `trial_code` silently accepted
for the wrong formula. `pnpm --filter @formulab/shared test`:
1575/1575. `pnpm --filter @formulab/desktop test`: 1559/1559.
`typecheck`/`lint`: clean. FVL-04 now 20/26.

## FVL-04.021 resolution (this session — Generic Database Read Connector)

New `databaseConnector.ts` — a real `SourceConnector` for databases, the
same shape `createFileConnector()` already implements, funneling every
staged row through the SAME `stageRows()` path CSV/XLSX/JSON/XML use
(generalized to accept its own `connectorType`, zero behavior change for
existing callers). Read-only enforced two ways: `DatabaseConnectorDeps`
exposes exactly one capability (`executeQuery`, injected — the real
driver-backed adapter is desktop-only and NOT built this task, disclosed,
the same "engine now, adapter wired later" boundary `readWorkbook`
already established for XLSX); `assertReadOnlyQuery()` structurally
refuses a write-shaped leading statement keyword before the query ever
reaches the adapter, proven not a naive substring match. `connectionRef`
is opaque — no credential field exists anywhere on the contract.
`pnpm --filter @formulab/shared test`: 1590/1590 (75 files, 15 new).
`typecheck`: clean both packages. FVL-04 now 21/26.

## FVL-04.022 resolution (this session — REST API Connector Contract)

New `restApiConnector.ts` — a real `SourceConnector` for REST APIs, the
same shape `createFileConnector()`/`createDatabaseConnector()` already
implement. Pagination follows each page's own `nextCursor` (the
adapter's own convention, never guessed here), capped by `maxPages`
(default 500) so a misbehaving API cannot page forever. Every page's
JSON body reuses the SAME `stageJsonFile()` staging logic (generalized
to accept its own `connectorType`, like `stageRows()` in the same task).
Real gap found and fixed while wiring this: staging each page
independently gave records an ordinal identity relative to their OWN
page, so two pages' first records would collide on the same ordinal
`sourceRecordId` — fixed with a post-merge renumbering pass across the
whole batch (a configured external ID is never touched). Auth is a
`connectionRef` reference only, resolved server-side by the desktop-only
`fetchPage` adapter (wired later, the same boundary FVL-04.021's own
`executeQuery` established) — this module never issues an HTTP request
or sees a raw credential. `pnpm --filter @formulab/shared test`:
1601/1601 (76 files, 11 new). `typecheck`: clean both packages. FVL-04
now 22/26.

## FVL-04.013-.018 final correction (Session 8, this session — narrow, four-part final correction)

A narrow, explicitly-scoped final correction pass — NOT a redesign of
FVL-04.013-.018, NOT the start of FVL-04.019. Four defects, all found in
prior sessions' own work and fixed here:

**1. Reference resolution made genuinely field-aware.** The resolver
contract checked a reference's key against the TARGET template's own
composite `naturalKeys` set, regardless of which single field the
referencing column actually needed — a live false negative for every
real reference into a composite-natural-key template (`packaging_bom`,
`label_content`, `doe_factors_responses`, and others). Fixed:
`resolveReference(referenceTemplate, referenceField, key)`; new
`resolveColumnReferenceField()` is the one authority for which field a
column resolves against; `buildReferenceResolver()` rewritten to index
arbitrary exported fields, not just each template's composite key.
Registry audit: all ~94 real `code_reference` columns already carry
explicit `referenceField` — the bug was resolver logic, not registry
data — now locked in by `dataExchangeRegistry.consistency.test.ts` (57
tests).

**2. Blanket self-reference bypass removed.** The validator's
`column.referenceTemplate === template.templateCode ? true : ...` special
case is gone; self-reference now resolves through the same field-aware
path as any other reference. Same-file forward references (a row citing
another uncommitted row in the same batch) are explicitly, deliberately
NOT supported — documented policy, not a silent gap.

**3. Mapping Profile version chain made exact.** A version is now
effectively superseded only when some OTHER persisted version explicitly
names its exact `code` AND that successor's own status is `"active"` — a
draft successor never deactivates its predecessor. The chain itself must
be exact and linear: `profileVersion === max(existing) + 1`, and
`supersedesProfileCode` must equal the current latest version's exact
code (no gaps, no branching). Storage model audited first, per this
session's own instruction not to invent a second lifecycle database:
`mapping_profiles` was already append-only with status fixed at
creation and no separate activation pointer exists anywhere — Option A
was already the codebase's real model; no storage/Rust change needed.

**4. `FileConnectorInput`/`FileConnectorSource` strengthened into
discriminated unions.** CSV/JSON/XML now require `text`; XLSX requires
`bytes`, at the type level — the prior silent `?? ""` / `?? new
ArrayBuffer(0)` fallbacks are gone. Proven with `@ts-expect-error`
compile-time acceptance tests.

Closure-level acceptance rebuilt around the new contract: REF1-REF11 in
`connectorEndToEnd.test.ts` (single-key and composite-key targets, two
genuine REQUIRED-into-composite-target hard-block proofs —
`artwork_register.label_code`/`doe_observations.response_code` — plus an
honest non-blocking composite proof for `packaging_bom`, since no
REQUIRED reference into it exists anywhere in the registry); four new
dialog-level acceptance tests (A-D) against the real production dialog
in `DataExchangeImportDialog.test.tsx`. Full re-verification:
`pnpm --filter @formulab/shared test` 1575/1575 (74 files);
`pnpm --filter @formulab/desktop test` 1555/1555 (158 files);
`typecheck`/`lint` clean both packages; no Rust file touched this
session; `python scripts/validate_v1_tracker.py` OK, 171 tasks, no
drift; `git diff --check` clean. See
`docs/FVL04_EXTERNAL_SOURCE_CONNECTOR_ARCHITECTURE.md`'s own Session 8
section and each task's own tracker row for full per-item detail.

## FVL-04.013-.018 hardening (Session 7, this session — second independent review corrections)

A SECOND independent repository-level review of Session 6's own closure
below found further real gaps. All were independently re-verified
against current code (not trusted from the prior log), fixed, and
re-tested; task counts are unchanged — FVL-04 stays 18/26, Total 81/171.
Full detail in each task's own tracker row and
`docs/FVL04_EXTERNAL_SOURCE_CONNECTOR_ARCHITECTURE.md`'s own Session 7
Hardening section.

**The single most important finding**: the REAL production import
screen, `DataExchangeImportDialog.tsx`, called `previewDataExchangeImport()`
with NO `resolveReference` at all — real user uploads never validated
`code_reference` existence, even though Session 6 had already proven the
validator itself works correctly in a TEST path. Fixed by reusing the
EXISTING per-template existing-record authority (`dataExchangeExisting.ts`'s
`loadExisting`/`loadExistingFormulaBom`) through a new
`buildReferenceResolver(referenceTemplates)`, wired into the dialog's own
preview call — generic, registry-driven, no new reference engine, no
material/supplier-specific branch. This immediately surfaced 5
pre-existing `DataExchangeImportDialog.test.tsx` fixtures that had never
actually seeded their referenced parent records — they only ever
"passed" because production validated nothing; fixed by seeding the
referenced parents in each fixture. `connectorEndToEnd.test.ts` was
rebuilt around the SAME `buildReferenceResolver()`, never a parallel
test-only implementation.

**Other real gaps found and fixed:**

1. **File-level provenance was still wrong** — the XLSX `contentFingerprint`
   fingerprinted the SELECTED SHEET's own rows, not the file; selecting a
   different sheet of the same file produced a different fingerprint, and
   `resourceName` had the sheet folded into it (`"file.xlsx#Materials"`).
   Fixed: new `fingerprintBytes()` fingerprints the raw workbook bytes
   directly (same file, different sheet → identical fingerprint, proven);
   new `SourceResourceMetadata.subResourceName` carries the sheet
   separately. `byteSize` — previously caller-supplied and therefore
   able to lie — removed entirely from `FileConnectorInput`; always
   derived internally (real UTF-8 byte length via `TextEncoder` for text
   formats, proven against a multibyte fixture distinguishing it from JS
   `string.length`; real `ArrayBuffer.byteLength` for XLSX).
2. **No real generic FILE `SourceConnector` implementation existed** —
   the common contract was only an unimplemented interface next to a
   standalone `stageFile()` function. New `createFileConnector()` now
   genuinely implements it (`discoverEntities()` returns real XLSX sheet
   names), reusing `stageFile()` internally, no duplicated logic.
3. **Raw parser exceptions could leak** — every parse-failure path
   previously interpolated the underlying library's own `.message` into
   `ConnectorError.message`. Fixed: every failure now returns a stable,
   hand-written message; `detail` carries only the exception's
   constructor name. Proven executably (a real credential + real path in
   a thrown error, asserted absent from the serialized result), not by
   source-text inspection.
4. **Mapping-profile version lifecycle had a real contradiction** —
   Session 6's append-only fix meant a persisted `active` v1 could never
   be rewritten to `"superseded"`, yet nothing said so explicitly. Fixed:
   a version's `status` is now understood as its status AT CREATION,
   never rewritten; "currently superseded" is a DERIVED fact via new
   `effectiveMappingProfileStatus()`. The ambiguous `supersedesProfileId`
   replaced with exact `supersedesProfileCode`; new
   `validateMappingProfileSupersession()` rejects self-supersession, a
   nonexistent target, cross-family supersession, and duplicate codes.
5. **A real transformation runtime-throw risk** — `map_boolean`'s blind
   `as string[]` cast could throw `TypeError` on malformed config that
   bypassed profile validation. Fixed with explicit shape checks at BOTH
   runtime and validation time; `map_enum`/`parse_decimal` hardened
   similarly. `resolve_crosswalk` now requires an explicit `sourceEntity`
   or `sameEntity:true` (no more accidental `ctx.currentEntity` fallback);
   a configured `fallbackCanonicalField` is now validated against the
   discovered source schema.
6. **Ordinal-crosswalk rejection was convention-only** — nothing in
   `persistCrosswalkEntry()`'s own signature prevented an ordinal
   identity from being passed. Fixed: `sourceIdentity: { sourceRecordId,
   idSource }` is now REQUIRED; an `"ordinal"` identity is refused before
   any storage call runs.
7. **Rust storage acceptance was metadata-only** — new pure
   `apply_upsert()`, extracted from the async Tauri command, is directly
   unit-tested against disposable in-memory rows, proving the real
   merge/rejection behavior, not just the collection's own `append_only`
   flag.
8. **`explicit_primary_key` was a dead enum value** — removed;
   `metadata_primary_key` (which has a real input path) retained.
9. **Fingerprint stability had one more real gap** — `observedTypes` was
   still in the fingerprint input (sample-derived, not declared
   structure); a `Quantity` column reading numeric in one batch and text
   in the next produced two different fingerprints for the identical
   header/structure. Removed from the fingerprint input entirely.
10. **Null-token recognition was hardcoded** — new
    `nullTokenCandidates` config extends (never replaces) the default
    recognizer with customer-specific tokens.

Verified: `pnpm --filter @formulab/shared test` — full suite green (73
files, `transformation.test.ts` 40/40 with 10 new, `schemaDiscovery.test.ts`
33/33, `fileConnector.test.ts` 36/36, `mappingProfile.test.ts` 20/20).
`pnpm --filter @formulab/desktop test` — full suite green
(`connectorEndToEnd.test.ts` rebuilt to 24/24, `DataExchangeImportDialog.test.tsx`
14/14 after the 5-fixture seeding fix, `connectorPersistence.test.ts`
10/10). `typecheck`/`lint` — clean on both packages. `cargo check`/`cargo
test masterdata` — 28/28 (3 new: `apply_upsert_*`). `python
scripts/validate_v1_tracker.py` — OK, 171 tasks, no drift (one
self-inflicted false-positive from a literal `|` character inside this
session's own tracker prose, matching the SAME class of bug Session 6
also hit and fixed, found and corrected before final validation). `git
diff --check` — clean (LF/CRLF warnings only). No FVL-04.019+ work
started; no second Data Exchange/canonical registry/masterdata system/
business engine; no LLM mapper/schema-discovery layer; no arbitrary
executable mapping code; no real customer data mutated (every fixture
uses a mocked/disposable masterdata bridge or store).

## FVL-04.013-.018 hardening (Session 6, this session — independent review corrections)

A subsequent independent repository-level review of the Session 5
closure below found real implementation and acceptance gaps. All were
independently re-verified against current code (not trusted from the
prior log), fixed, and re-tested; task counts are unchanged (re-closing
already-COMPLETED tasks, not new completions) — FVL-04 stays 18/26,
Total 81/171. Full detail in each task's own tracker row and
`docs/FVL04_EXTERNAL_SOURCE_CONNECTOR_ARCHITECTURE.md`'s Hardening
section.

**Real gaps found and fixed:**

1. **`ConnectorResult` had no real file metadata** — the prior log's claim
   of "exposes source identity/type/size/hash" was aspirational, not
   real. New `SourceResourceMetadata` (`ConnectorResult.sourceResource`)
   genuinely carries filename/media-type/byte-size/content-fingerprint,
   explicitly never mislabeled a cryptographic hash.
2. **XLSX had no common connector abstraction** — `readWorkbookAllSheets`
   was fed manually into `stageRows` by callers, disconnected from CSV/
   JSON/XML. New `stageFile()` is the one abstraction all four formats
   funnel through; XLSX via an injected `readWorkbook` adapter, proven
   wired to the REAL `readWorkbookAllSheets` in `xlsx.test.ts`.
3. **Corrupt XLSX leaked a raw ExcelJS exception** — now caught and
   returned as a structured `corrupt_xlsx` connector error, proven with
   both a mocked reader and a genuinely corrupt real buffer.
4. **A unique display name could read as identity authority** — the old
   `EXTERNAL_ID_STATUSES` (`"candidate"|"unresolved"`) let a merely-
   unique field (including `MaterialName`) look identical to a real
   configured ID. New `EXTERNAL_ID_EVIDENCE` separates
   `configured_external_id`/`metadata_primary_key` (real evidence) from
   `unique_candidate` (an honest observation, never authority).
5. **No dedicated unit-column discovery** — `Quantity|UOM` and
   `Viscosity|ViscosityUnit` patterns are now deterministically
   discovered (structural conventions, never guessed when genuinely
   ambiguous — two numeric fields sharing one bare `UOM` column stays
   unresolved).
6. **No null-token profiling** — `N/A`/`NULL`/`-`/... are now reported as
   `observedNullTokens` for a mapping profile to configure, never
   silently nulled by discovery; real `0`/`false`/`"0"` proven excluded.
7. **Schema fingerprint too weak / mapping-profile immutability not
   storage-enforced** — fingerprint now also covers unit hints and
   CONFIG-driven identity role while still excluding sample-driven
   observations (proven stable across batches with different null
   ratios). `mapping_profiles` re-registered **append-only=true** in
   `masterdata.rs` (was mutable — nothing previously stopped a silent
   version overwrite; `MappingProfile` also had no `code`/`id` field at
   all, so a real desktop write would have failed outright, never caught
   because tests fully mocked the masterdata bridge). New `code` field
   (`profileId::vN`) is the real immutable storage identity.
8. **Transformation config wasn't validated up front** — new
   `validateTransformationConfig()` catches e.g. a `parse_decimal` with
   no `decimalSeparator` or a `convert_unit` with an unrecognized/
   incompatible unit pair at PROFILE validation time, not silently at
   row-mapping runtime. Fan-out natural-key coverage is now validated
   too (`missing_target_natural_key_field`).
9. **A dead crosswalk status** — `CROSSWALK_STATUSES` included
   `"conflict"`, which nothing ever persisted (`upsertCrosswalk()`
   always returns a conflict as a separate, unpersisted object). Narrowed
   to `["active"]`, the real behavior now documented explicitly.
10. **Duplicate unit-conversion tables** — `MASS_UNITS`/`VOLUME_UNITS`
    existed only inside `transformation.ts`, no genuine single authority
    (a repo-wide audit found none pre-existing; `cost.ts`'s own inline
    conversions are deliberately different density-specific business
    logic, correctly untouched). New `packages/shared/src/engine/unitConversion.ts`
    is now the ONE generic authority; `transformation.ts` delegates to it.
11. **`resolve_crosswalk`'s relationship precedence was implicit** —
    `canonicalEntity` was only ever supplied by a caller's own context
    wiring, never the step's own config. Now a REQUIRED step-config
    field, with the full precedence implemented: (1) crosswalk, (2) an
    explicit canonical code named by a new `fallbackCanonicalField` on
    the same source record, (3) unresolved — never a name match.
12. **Impossible dates silently accepted** — `31/02/2026`, `29/02/2025`
    (non-leap), `31/04/2026` all previously "parsed". New
    `isValidCalendarDate()` (real days-in-month + leap-year rule) rejects
    all three; `29/02/2024` still correctly accepts.
13. **Malformed decimal grouping silently digit-stripped** — `"1,23,4"`
    and `"1.2.3"` previously parsed into a wrong number. `parseExplicitDecimal`
    now validates real thousands-grouping structure and refuses more than
    one decimal-separator occurrence.
14. **End-to-end closure tests bypassed real reference resolution** — an
    unconditional `resolveReference` stub answered "yes, it exists" for
    every reference everywhere. `connectorEndToEnd.test.ts` rewritten
    around a real `ReferenceStore` built only from actually-committed
    natural keys; a new negative case proves an unregistered code is
    genuinely refused. ACME_ERP now performs a real explicit commit, not
    just a preview. A new "Structured failure matrix" gives FAIL1-FAIL20
    each an explicit test or a direct pointer to the covering test.

**Deliberately confirmed correct, not changed:** FVL-04.017's tuple
matching/no-name-matching/no-auto-delete guarantees (XW1-XW9 re-run
unchanged and still passing); F6's "Data Exchange remains the final
enum-value authority" boundary (no duplicate enum universe was ever
built, nothing to fix); the read-only connector contract itself (no
write method, C13-7 unchanged).

Verified: `pnpm --filter @formulab/shared test` — 1467/1467 across 73
files (67 new/changed this hardening pass). `pnpm --filter @formulab/desktop
test` — 1533/1533 across 158 files (23 in `connectorEndToEnd.test.ts`
alone, rewritten; plus `connectorPersistence.test.ts`/`xlsx.test.ts`
additions). `typecheck`/`lint` — clean on both packages. `cargo test
masterdata` — 25/25 (2 new: `mapping_profiles_is_allow_listed_as_append_only`,
`external_id_crosswalks_is_allow_listed_as_mutable`). `python
scripts/validate_v1_tracker.py` — OK, 171 tasks, no drift. `git diff
--check` — clean (LF/CRLF warnings only). No FVL-04.019+ work started;
no second Data Exchange/canonical registry/masterdata system/business
engine; no LLM mapper/schema-discovery layer; no arbitrary executable
mapping code; no real customer data mutated (every fixture uses a
mocked masterdata bridge).

## FVL-04.013-.018 resolution (Session 5)

Built the enterprise external-source connector foundation, in strict
order .013→.014→.015→.016→.017→.018, per the approved FVL-04 scope
expansion. Full detail in
`docs/FVL04_EXTERNAL_SOURCE_CONNECTOR_ARCHITECTURE.md`.

**.013 Connector Contract** — new `packages/shared/src/schemas/connector.ts`:
`ConnectorIdentity`/`SourceRecordIdentity`/`ExtractionMetadata`/
`SourceLineage`/`StagedSourceRecord`/`ConnectorError`/`ConnectorResult`,
and the `SourceConnector` interface (`identity`/`discoverEntities`/
`extract` only — no write method anywhere, proven by a source-text regex
scan, not just typing). **.014 Generic File Connector** — new
`fileConnector.ts`/`xmlParser.ts`/`connectorFingerprint.ts`: CSV reuses
the existing `parseCsv`; JSON supports bare arrays and `{items:[...]}`
with reversible path notation; XML is a hand-rolled parser with XXE
safety by construction (DOCTYPE/ENTITY rejected before parsing starts —
the vulnerable code path doesn't exist, not merely disabled). New
`readWorkbookAllSheets()` (`apps/desktop/src/lib/xlsx.ts`) gives XLSX
genuine multi-sheet support, each sheet its own entity. **.015 Schema
Discovery** — new `schemaDiscovery.ts`: type/null/date-format/decimal-
convention/unit/relationship discovery, all evidence-based, never
guessed — ambiguous date order and ambiguous decimal grouping both stay
explicitly `ambiguous` rather than silently resolved. **.016 Mapping
Profile Model** — new `mappingProfileSchema` (zod, persisted-masterdata
convention) + `mappingProfile.ts`: one source row fans into many
canonical templates only when the profile explicitly declares it (proven:
one CHT_LIMS row → raw_materials+suppliers+material_suppliers+
material_prices+inventory_records); every target resolved through the
REAL `getDataExchangeTemplate()` registry, never a duplicate catalog; a
changed mapping is a new `profileVersion` row, never a silent rewrite.
**.017 External ID Crosswalk Registry** — new `externalIdCrosswalkSchema`
(zod) + `crosswalk.ts`: exact-tuple resolution only, same-tuple-different-
target returns an explicit `CrosswalkConflict` with nothing overwritten,
no name-based matching anywhere in the module. **.018 Transformation/
Unit/Enum Mapping** — new `transformation.ts`: 14 declarative ops, no
scripting language; decimal/date parsing require explicit profile
configuration, never host-locale guessing; unit conversion is dimension-
gated (mass↔mass, volume↔volume only — no density-based conversion
authority exists in this layer); `resolve_crosswalk` calls the real
FVL-04.017 resolver.

**Persistence**: two new masterdata collections, `mapping_profiles` and
`external_id_crosswalks`, registered through the full existing ritual
(Rust `COLLECTIONS`, TS `MASTERDATA_COLLECTIONS`/policy areas, role-
policy matrix regenerated, every hardcoded collection-count assertion
updated). Desktop-side `apps/desktop/src/lib/connectorPersistence.ts` is
the only place this layer calls `listRecords`/`upsertRecords`.

**End-to-end acceptance**: new `apps/desktop/src/lib/connectorEndToEnd.test.ts`
(6 tests) proves the full chain twice, with two structurally different
customer schemas and zero source-specific code branching anywhere in the
engines (proven by a dedicated source-text grep test). Fixture 1
(`CHT_LIMS`, `Chemical_ID`/`Chemical_Name`/`Vendor_ID`/.../`Active_Flag`
headers) stages → discovers → maps → transforms (unit conversion
250000g→250kg, boolean mapping `Y`→`released:true`) → resolves a
supplier reference through a REAL persisted crosswalk (proven load-
bearing: the same mapping without the crosswalk fails with an explicit
`crosswalk_unresolved` error rather than silently falling back to the
raw source ID) → commits candidates through the REAL
`commitDataExchangeRows()`. Fixture 2 (`ACME_ERP`, `ItemNo`/
`Description`/`VendorNo`/... headers) proves a different fingerprint and
a different profile through the identical framework. Structured-failure
and security-audit acceptance (malformed files, unsafe XML, fingerprint
mismatch, crosswalk conflict, invalid-candidate-never-reaches-commit) all
covered in the same file.

**Deliberately not built this session**: no admin/dev viewer UI
(primary deliverables were architecture/models/engines/tests, per the
brief's own framing); no FVL-04.024 bridge orchestration (candidates
proven bridgeable by calling the real Data Exchange functions directly in
tests, but no permanent orchestration abstraction created); no
FVL-04.019+ work.

Verified: `pnpm --filter @formulab/shared test` — 1423/1423 across 73
files (86 new: connector/fileConnector/schemaDiscovery/mappingProfile/
crosswalk/transformation test files). `pnpm --filter @formulab/desktop
test` — 1511/1511 across 158 files (10 new: connectorPersistence.test.ts,
connectorEndToEnd.test.ts, xlsx.test.ts multi-sheet addition).
`typecheck`/`lint` — clean on both packages. `cargo check` — clean.
`cargo test masterdata` — 23/23 (collection-count assertions updated
91→93). `python scripts/validate_v1_tracker.py` — OK, 171 tasks, no
drift. No second Data Exchange platform, Material Master, Cost/
Inventory/Regulatory/Safety engine, or Laboratory platform created; no
vendor-specific connector branch; no LLM anywhere in mapping/discovery/
transformation; no real customer data mutated (every fixture uses a
mocked masterdata bridge). FVL-04 now 18/26; Total 81/171 (47.4%).

## FVL-04.005-.012 resolution (this session)

Closed the original canonical/template-based Data Exchange onboarding
block. **.005 Specifications** — audit-only; `TestDefinition`/
`test_definitions` (already registered, already wired) is the real
specification concept, already fully covering acceptance-limit/method
fields, already `imported_unverified`-forced, already the real
`lab_results`/`stability_*` consumer link. **.006 Price History** —
audit-only; `material_prices` reconfirmed append-only (a new record on
every commit, never overwritten) and genuinely consumed by the real
`cost.ts::priceFor`/`buildCostSnapshot`, no importer-local price
selection. **.007 Inventory** — real gap: `inventory_records` template +
`commitInventoryRecords` handler added (Case C, existing
`InventoryRecord` schema/collection, no new schema). **Also fixed the
explicit FVL-03.004-era carry-forward**: `MaterialsPage.tsx`,
`AdvancedOptimizerPanel.tsx`, `SubstitutionPanel.tsx` all still computed
`quantity − reservedQuantity` inline with no quarantine/release/expiry
filtering — a real single-authority violation, not cosmetic. All three
switched to the existing `evaluateMaterialAvailability()` (no new
helper). **.008 Exchange Rates** — real gap: `exchange_rates` template +
`commitExchangeRates` handler added (Case C; the pre-existing
in-workspace "rates" importer had an empty field spec, so bulk FX import
had no working path anywhere before this session); zero FX math added —
`cost.ts::findRate()` remains the sole authority, no 1:1 fallback.
**.009 Process Parameters** — audit-only; `process_parameters` is the
codebase's one real manufacturing-process-step structure (no separate
engine exists to preserve a distinction against), already fully wired,
parent-bound to a real `formula_bom` entry. **.010 Regulatory** —
audit-only, high-integrity; `not_verified`/`draft`/`review_required` are
forced by the commit handler regardless of file content, proven by a
test that deliberately smuggles a `verification_status: "verified"`
value onto the row and confirms it's ignored; evidence-is-not-verdict
confirmed absolute (no compliance field exists on evidence records, a
proposed link requires a real human actor to accept). **.011** —
consolidation gate; final gap register classified every .001-.010
finding, only the two genuine Case-C gaps above extended the registry,
every previously-disclosed non-gap (`material_suppliers` bulk template,
binary document ingestion, viewer UIs) re-confirmed still correctly not
needed. Template count 41→43, every hardcoded-count test/doc found and
corrected. **.012** — real sample-file acceptance; every confirmed/
extended template's own real example row parses/validates through the
actual CSV lifecycle; the two new templates additionally proven through
a full `DataExchangeImportDialog` round-trip (real `File` → parse →
preview → explicit commit) with both positive and negative fixtures;
committed inventory/exchange-rate records proven genuinely consumable by
the real `evaluateMaterialAvailability()`/`findRate()`, no fabricated
outcomes.

Verified (all eight tasks combined): `pnpm --filter @formulab/desktop
test` — 1452/1452 across 152 files. `pnpm --filter @formulab/shared
test` — 1327/1327 across 67 files. `typecheck`/`lint` — clean on both
packages. `python scripts/validate_v1_tracker.py` — OK, 171 tasks, no
drift. `git diff --check` — clean (LF/CRLF warnings only). Zero Python/
Rust changes this session — no `pytest`/`cargo` re-run required. No
FVL-04.013+ work started; no connector/mapping layer touched; no
crawlers; no second Data Exchange system; no second document/binary
registry; no FVL-04.026 artifact naming.

## Finished-product specification + material document viewer (this session)

Two explicitly user-approved remaining gaps closed before FVL-04.013 may
begin.

**Part A — Finished-Product Specification domain.** The prior hardening
session's Specification Domain Matrix correctly identified this as a
real, disclosed gap: no canonical schema anywhere carried QC/release
limits for a specific finished-product SKU. Closed with a genuine new
domain, not a notes-field workaround: `finishedProductSpecificationSchema`
(`packages/shared/src/schemas/dataExchange.ts`) references a real
`FinishedProduct` (`skuCode`) and a real `TestDefinition`
(`testDefinitionCode`) — never copies either's own semantics.
`targetValue`/`minimum`/`maximum` mirror `TestDefinition`'s own field
names (a product-specific override), deliberately no separate `unit`
field (the referenced TestDefinition already owns it).
`requiredForRelease` is this SKU's own release gate, distinct from
`TestDefinition.criticalTestFlag`. History is append-only, the exact
`material_prices`/`exchange_rates` convention — a specification change
never silently rewrites what an earlier batch was evaluated against.
`verificationStatus` reuses `TestDefinition`'s own vocabulary,
force-set to `imported_unverified` on every commit, never taken from the
file. New `finished_product_specifications` Data Exchange template +
`commitFinishedProductSpecifications` handler, 100% the existing
registry/validation/commit/history pipeline. Real UI consumer: no
Finished Product workspace exists anywhere in the app (confirmed by
search), so a new read-only "Specifications" tab was added to the
existing generic masterdata-browser (`MaterialsPage.tsx`) — flat list,
SKU filter, deterministic expiry indicator, no pass/fail evaluation (no
existing authoritative evaluator owns that decision for this domain).
Required a genuine Rust change for the first time in FVL-04.005-.012:
`finished_product_specifications` registered in `masterdata.rs`'s
`COLLECTIONS` array and `masterdataPolicyAreas.ts`'s
`MASTERDATA_COLLECTIONS` mapping, role-policy JSON fixtures regenerated
via the existing `generate:role-policy-matrix` script (never hand-edited).

**Part B — Per-material TDS/SDS/specification document viewer.** New
`apps/desktop/src/components/formula/MaterialDocumentsPanel.tsx`,
mounted inside `MaterialEditor.tsx` as a "Documents" section (gated on
`isExisting`, same convention `WorkflowGatePanel` already uses). Reads
`listRecords("material_documents")`, filters strictly by
`materialCode === selectedMaterial.code`. Displays type/title/number/
revision/issuer/supplier (resolved by code)/dates/language/verification/
fileName/tags, TDS/SDS/specification filter, deterministic expired
indicator. No "open file" action anywhere — `fileName` is provenance
text only, matching the schema's own metadata-only boundary; no path
ever inferred. No Safety or Regulatory verdict rendered anywhere
(verified by a dedicated test). `RawMaterial.documents[]` (the confirmed
dead/orphaned path) never read or written.

Template count 44→45 (`finished_product_specifications`) — the only new
schema this entire FVL-04 block has introduced beyond the five already
documented in `DATA_EXCHANGE_CENTER.md`'s own header. Masterdata
collection count 90→91. Every hardcoded-count assertion (TS and Rust)
updated to match.

Verified: `pnpm --filter @formulab/desktop test` — 1500/1500 across 156
files (43 new: `MaterialDocumentsPanel.test.tsx` (9),
`MaterialsPage.specifications.test.tsx` (2),
`dataExchangeCommit.test.ts` (7 FinishedProductSpecification tests),
`DataExchangeImportDialog.test.tsx` (4), template-count assertion
44→45). `pnpm --filter @formulab/shared test` — 1347/1347 across 67
files (12 new independent fixtures + negatives, template-count
44→45). `cargo test` — 345/345 (collection-count assertions 90→91).
`typecheck`/`lint` — clean on both packages. `python
scripts/validate_v1_tracker.py` — OK, 171 tasks, no drift (task counts
unchanged — hardening, not new task completion). `git diff --check` —
clean (LF/CRLF warnings only). No FVL-04.013+ work started; no second
Data Exchange/document registry/laboratory platform/Regulatory-Safety
engine created.

## FVL-04.005-.012 closure hardening (this session)

An independent review found the prior FVL-04.005-.012 closure was too
fast in three places. This session re-audited all eight tasks from
scratch (not trusting the prior COMPLETED labels), fixed every proven
gap, and closed them again with stronger acceptance. Prior evidence in
the tracker was kept, not erased — each row now carries a `**HARDENING
(2026-08-19...)**` addendum.

**Real defects found and fixed:**

1. **Unit-contract bug (FVL-04.007)** — `AdvancedOptimizerPanel.tsx`'s
   `stock` field (and the two matching fields in `SubstitutionPanel.tsx`)
   fed `evaluateMaterialAvailability(...).usableQuantity` straight into a
   field `advanced_optimizer.py` treats as a literal kg cap, with no
   check that `InventoryRecord.unit` was actually "kg". A gram- or
   litre-denominated lot would have silently produced a physical-stock
   cap wrong by orders of magnitude. Fixed: all three fields now only
   report a genuinely kg-denominated quantity; anything else reports
   unknown rather than a guessed number. Proven by two new tests that
   render the real optimizer, run it, and inspect the exact problem
   handed to the solver.
2. **Storage-only closure (FVL-04.009)** — the prior session had
   correctly disclosed that no UI consumed `process_parameters`, but
   closed the task anyway. That is no longer accepted. New
   `ProcessParametersPanel.tsx`, wired as a real "Process" tab in
   `FormulasPage.tsx`, is the genuine consumer — a saved formula's
   canonical process steps are now visible, keyed to the exact
   formula/version, explicitly distinguished from a generated session
   card's own separate `ManufacturingProcedureTab` proposal.
3. **MaterialSupplier reassessment (FVL-04.011)** — re-examined against
   the APPROVED FVL-04.013+ connector architecture (which explicitly
   anticipates a source row producing `RawMaterial + Supplier +
   MaterialSupplier + MaterialPrice + InventoryRecord`, price included
   or not) rather than the old FVL-03-only lens. A pure vendor
   qualification list with no price is a legitimate enterprise shape, so
   a new `material_suppliers` Data Exchange template was added — the
   third genuine Class-C gap this block ever found.

**Strengthened, not rewritten:** .005 (built a full Specification Domain
Matrix, proved the `material_documents` `document_type="specification"`
path explicitly, confirmed finished-product specs are a real disclosed
domain gap rather than a Data Exchange gap); .006/.008 (new
`dataExchangeCostAcceptance.test.ts`, 18 tests proving imported
MaterialPrice/ExchangeRate reach the real `costFormula()` end to end —
current/expired/future/multi-supplier/missing-price/missing-FX/mixed-currency,
every assertion reading the engine's own return value); .010 (added a
full real-`File`-through-the-dialog test proving a verification-smuggling
attempt is refused at the highest lifecycle level, not just at the
commit-handler unit level); .012 (rebuilt with independent fixtures never
derived from `exampleRows`, a real sequential reference chain across 8
templates, real `.xlsx` round-trips, real import-history job-lifecycle
assertions, and full-dialog coverage expanded beyond the original two
templates).

Cross-cutting single-authority re-audit: repository-wide grep confirmed
exactly one definition each of `priceFor`/`findRate`/
`evaluateMaterialAvailability`/`evaluateRegulatory` in the whole shared
package, zero duplicate/reimplemented copies anywhere in the desktop app,
and zero remaining `quantity - reservedQuantity`-style inline arithmetic
anywhere in the codebase.

Verified: `pnpm --filter @formulab/desktop test` — 1480/1480 across 154
files. `pnpm --filter @formulab/shared test` — 1341/1341 across 67
files. `typecheck`/`lint` — clean on both packages. `python
scripts/validate_v1_tracker.py` — OK, 171 tasks, no drift. `git diff
--check` — clean (LF/CRLF warnings only). Zero Python/Rust changes — no
`pytest`/`cargo` re-run required. No FVL-04.013+ work started; no
connector/mapping layer touched; no second Data Exchange/Cost/Inventory/
Regulatory/Manufacturing engine created.

## FVL-04.001 resolution (this session)

"Confirm the Material Master import template covers the fields Phase
14's candidate pool needs." Audit found the existing `raw_materials`
Data Exchange template/lifecycle already fully sufficient in structure,
but found two real, genuine, blocking commit-handler gaps: (1)
`material_function` was collected as a real column but the commit
handler hardcoded `functions: []` on every commit, silently discarding
it — `master_materials_adapter.py` confirmed to actively read
`RawMaterial.functions` for the candidate pool's own role-matching, so
every material imported via Data Exchange was invisible to candidate
generation no matter how the CSV was filled in; (2)
`recommendedMinPercent`/`recommendedMaxPercent`/`technicalMaxPercent` —
confirmed by direct read of `resolve_concentration()`'s own Tier 4 to be
the exact three concentration-range fields the candidate pool consumes
— were not columns on the template at all.

Fixed with the smallest correct extension to the EXISTING template/
commit path: three new optional `percentage` columns added to
`MATERIAL_COLUMNS`, never defaulted to zero when absent; `material_function`
now parsed and filtered against the real, canonical `MaterialFunction`
enum (an unrecognized token is dropped, never fabricated as a role) and
refreshed on every import — matching how every other plain material-
master field already behaves, since functional role isn't owned by
another authority's own review workflow (unlike hazard/allergen/
regulatory-status fields, confirmed still correctly preserve-only-on-
create).

Full coverage matrix (A required / B optional-importable / C not
currently required / D imported elsewhere) recorded in the tracker's own
FVL-04.001 row. Canonical `material_code` identity confirmed preserved
throughout — immutable on update, never name/INCI/CAS-derived.

A real, pre-existing, unrelated test bug also found and fixed: a
validation test built its CSV row from a hardcoded 33-value positional
array that silently broke the moment the template gained any new
column — rewritten to derive blank cells from the live column list.

Verified: `pnpm --filter @formulab/desktop test` — 1427/1427 (3 new).
`pnpm --filter @formulab/shared test` — 1311/1311 (one pre-existing test
fixed, no net new). `typecheck`/`lint` — clean on both packages. Zero
Python/Rust changes — `test_master_materials_adapter.py` already proves
the seam correct once the TS-side write is correct, confirmed by
reading it, not by re-running new Python tests.

## FVL-04.002 resolution (this session)

"Confirm supplier import + supplier-material link templates are
sufficient for FVL-03's provenance needs." Audit-only — the existing
`suppliers` template already fully sufficient (real code identity,
`approved_supplier`/`qualification_status` never import-set-true). Real
finding: a genuine, live `MaterialSupplier` relationship record and its
own `material_suppliers` masterdata collection exist, but have no Data
Exchange template — confirmed by grep this is NOT a gap FVL-03 needs
closed, since neither `SubstitutionPanel.tsx` nor the Cost Engine reads
it. FVL-03's real supplier-provenance chain (`RawMaterial.code` ↔
`MaterialPrice.supplierCode` ↔ `Supplier.code`) is already fully carried
by the existing, wired `material_prices` template. `MaterialSupplier`
records are created solely through the existing in-workspace
`SupplierEditor.tsx` UI — out of this task's scope, flagged as a
disclosed, non-blocking finding for a future session. Zero production
code changed. 2 new `dataExchangeCommit.test.ts` tests.

## FVL-04.003/.004 resolution (this session)

"Confirm TDS/SDS metadata/document import path." Both audit-only,
identical finding: the existing `material_documents` template already
covers both — `MATERIAL_DOCUMENT_TYPES` is a real 13-value enum
including both `"TDS"` and `"SDS"`, same schema, same wired commit
handler, same collection. Confirmed metadata-only by design (no file-
binary ingestion anywhere in Data Exchange — `file_name`/
`expected_sha256` are a match-against-a-locally-held-file hint, never an
attachment, matching the schema's own documented boundary).
`RawMaterial.documents[]` confirmed completely unused by any UI or
import path — dead schema, not a competing registry. Safety/Regulatory
boundary confirmed absolute: the commit handler writes exactly 19 real
metadata fields, no `severity`/`formulaState`/hazard-scoring shape
anywhere, verified by a new test enumerating the committed record's own
key set. Zero production code changed. 5 new `dataExchangeCommit.test.ts`
tests + 1 new `dataExchangeValidation.test.ts` test, shared across both
tasks (proportional, not duplicated).

Verified (all four tasks combined): `pnpm --filter @formulab/desktop
test` — 1434/1434 across 152 files (10 new). `pnpm --filter
@formulab/shared test` — 1312/1312 (1 new). `typecheck`/`lint` — clean
on both packages. `python scripts/validate_v1_tracker.py` — OK, 171
tasks, no drift. `git diff --check` — clean (LF/CRLF warnings only). No
Python/Rust changes this session — no `pytest`/`cargo` re-run required.
No FVL-04.005+ work started; no connector/mapping layer touched; no
supplier or literature crawler created; no second Data Exchange system.

## FVL-04 scope expansion (2026-08-18, documentation/tracker session only)

An explicit human decision approved widening FVL-04 (Data Onboarding
Through Existing Data Exchange) from 12 to 26 tasks: FVL-04.013–.025 add
enterprise external-source connector/mapping/crosswalk onboarding (a
read-only connector layer — file/database/REST API extraction, a
reusable mapping profile, and an external-ID crosswalk — landing in the
SAME existing Data Exchange preview/validation/commit lifecycle, never a
second import platform); FVL-04.026 adds a human-readable, stable
naming convention for downloaded literature/source documents and saved/
exported formulation artifacts. Full detail in
`docs/FORMULAB_V1_TASK_TRACKER.md`'s FVL-04 section and
`docs/FORMULAB_V1_FINAL_SCOPE.md`'s new "FVL-04 scope expansion —
approved 2026-08-18" subsection.

**This session was documentation/tracker scope only — no production code,
schema, or UI was created or modified.** All 14 new tasks are blank, none
started. **FVL-04 IMPLEMENTATION — NOT STARTED.**

**The current implementation pointer does NOT move.** It remains exactly
as recorded above:

**CURRENT IMPLEMENTATION TASK REMAINS: `FVL-03.009` — NOT STARTED.**

## FVL-03.012 resolution — FVL-03 package CLOSED (this session)

"Integration acceptance proves exactly one authoritative result per
domain, with no duplicated business calculation, covering at least one
cost-constrained and one substitution-triggered request." Final
authority matrix built (13 domains, all PASS) in
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`. Final repository-wide
duplicate-business-logic audit found zero real duplicate authorities.
One disclosed, pre-existing, pre-FVL-03 gap re-confirmed (three UI call
sites still compute `quantity − reservedQuantity` inline instead of the
canonical `evaluateMaterialAvailability()`) — explicitly does not
conflict with the generated-formula integrated workflow this domain's
acceptance targets, does not block closure.

**A real, build-breaking Rust regression found and fixed by this task's
own mandatory `cargo check`**: `formulation_v2.rs::materialize_pipeline()`
still embedded the two Python files FVL-03.009/.010 deleted
(`F_SAFETY`/`F_REGULATORY`) — those sessions correctly skipped `cargo
check` since they made no Rust changes themselves, but this left the
shipped desktop binary unable to compile at all. Fixed; verified
end-to-end by reproducing the materialized file set in a disposable
temp directory and running a real generation through it (`status: "ok"`,
3 cards, `safety`/`regulatory` keys correctly absent) — the same method
FVL-02.009 established for the analogous defect.

**Cost-constrained acceptance**: new `costComparison.test.ts` test feeds
three disposable, realistically-shaped alternatives through the REAL
`costGeneratedFormula()`/`buildCostSnapshot()` engine — real cheaper
total genuinely lower, missing price cannot win, invalid alternative
never selected even at the lowest raw total. **Substitution-triggered
acceptance**: new `SubstitutionPanel.test.tsx` test proves no
auto-substitution, real canonical `materialCode` on the applied
candidate, a real traceable `substitution_runs` record, source formula
never mutated.

Verified: `pnpm --filter @formulab/desktop test` — 1424/1424 across 152
files (2 new). `typecheck`/`lint` — clean. `pnpm --filter
@formulab/shared test` — 1311/1311 (untouched). `python -m pytest
runtime/pipeline -q` — 361 passed, 5 subtests (untouched). `cargo check`
— clean (after the Rust fix). `cargo test formulation_v2` — 10/10.
`python scripts/validate_v1_tracker.py` — OK, 171 tasks, no drift.
`git diff --check` — clean (LF/CRLF warnings only).

**FVL-03 — Unified Formulation Pipeline ↔ Existing FormuLab Engines —
COMPLETE (18/18).** GitHub issue #4 closed to match FVL-01/FVL-02's own
established convention. FVL-04 implementation explicitly NOT started —
hard boundary stated in this session's own task brief.

## FVL-03.011 resolution (prior session)

"End-to-end authoritative provenance — extend `traceability.py`'s
existing model, do not fork it." Full audit (no subagents, per explicit
instruction) confirmed ONE coherent provenance model already exists:
`traceability.py`'s `TraceEvent` owns ONLY role-level ingredient
selection/rejection decisions (`material_code` carried in `source_ids`
since FVL-03.002), by its own explicit, still-valid design — every other
domain (Compatibility/Safety/Regulatory/Cost/Inventory/Substitution/
Optimization) owns its own real IDs on its own real record shape, never
duplicated into Python trace_events. **No `traceability_v2.py` or second
provenance schema created.** Generated→saved lineage (§A13) confirmed
ALREADY satisfied: `promoteGeneratedFormula.ts` already writes a real
back-reference into the existing `FormulationVersion.changeReason`
field ("Promoted from AI-generated session ${session.id}...") — no new
persistence needed.

**Two real, concrete visibility gaps found and closed** (data already
existed, was never rendered): (1) `GeneratedSafetySummary.tsx`/
`GeneratedCompatibilitySummary.tsx` computed each finding's real
`ruleId` all along but used it only as a React `key` — now shown,
alongside affected materials, on every finding row; (2)
`formulationReport.ts` had a Safety section (FVL-03.009) and a
Regulatory section (FVL-03.010) but had NEVER had a Compatibility
section at all since FVL-03.008 — added, reusing the exact same
already-computed `compatibilities` array the UI renders. A third gap:
no ingredient row anywhere in the result UI displayed its own resolved
`material_code` (the `GeneratedIngredient` type didn't even carry the
field) — added (optional, backward-compatible) with an honest subtext
showing the real code or an explicit "Unresolved" disclosure.

Verified: `pnpm --filter @formulab/desktop test` — 1422/1422 across 152
files (6 new). `typecheck`/`lint` — clean. `python -m pytest
runtime/pipeline -q` — 361 passed/5 subtests (unchanged, zero Python
files touched). `python scripts/validate_v1_tracker.py` — OK, 171
tasks, no drift. `git diff --check` — clean (LF/CRLF warnings only). No
FVL-03.012 work started; no new provenance framework anywhere.

## FVL-03.010 resolution (prior session)

"Make the EXISTING Kenya/EAC Regulatory Engine the single authoritative
regulatory verdict for the formulation workflow — retire
`runtime/pipeline/regulatory.py`, no new engine, no Python port." Full
audit confirmed `regulatory.py::evaluate_regulatory()` was a real,
independently-computing second final-verdict authority — and, by direct
comparison, itself STALE against its own source (only 7 of the TS
catalog's real 16 seed rules). **Resolved by full retirement** (same
precedent as safety.py): `regulatory.py`/`test_regulatory.py` (14 tests)
deleted; `pipeline.py`/`validation_plan.py` (whose last remaining
`regulatory_overall` parameter — and VAL-002, the last Safety/Regulatory
advisory entry — is now gone entirely)/`test_pipeline.py`/
`test_traceability.py` updated. `review_claims()`'s structural
claim-vs-composition check (the one distinct Python capability, no TS
equivalent) was deliberately retired with the rest, not selectively
kept, since it computed a real claim verdict — flagged for a possible
future TS catalog addition instead.

**New client-side seam**: `generatedFormulaRegulatory.ts::evaluateGeneratedFormulaRegulatory()`
resolves `brief.market` free text into a real `RegulatoryJurisdiction`
via a small wrapper-local alias table (ported from the retired module's
own `_MARKET_ALIASES`); `formulaState` reuses the engine's own real
`REGULATORY_FINDING_STATUSES`/`NON_BLOCKING_FINDING_STATUSES` — `blocked`
reserved for a real `non_compliant` finding only (never the
`missing_data`/`human_review_required` findings a generated,
unconfirmed session will almost always carry, which surface as
`warning` instead); zero findings is never `compliant`, preserving the
retired module's own "sparse coverage ≠ clean" policy. `category` is
always `"human_review_required"` (the classifier's own honest-
uncertainty value, not an invented fallback) — same scope decision
FVL-03.008/.009 made for Safety. New `useRegulatoryRules()` hook loads
the LIVE `regulatory_rules` collection.

**Downstream wiring**: `pickCheapestValidVersion()`/
`pickMostInventoryFeasibleVersion()` gained an independent 5th
`regulatories` eligibility gate. `FormulationResultPage.tsx`
(RegulatoryTab/SummaryTab/VersionSummaryCard) and `formulationReport.ts`
fully rewired off the legacy `card.regulatory` JSON — closing the same
"Download Report" split-authority risk FVL-03.009 closed for Safety. The
now-fully-dead `statusTone()` helper was removed. **Real new wiring, not
just an audit finding**: `SubstitutionPanel.tsx`'s one-to-one candidate
scoring had never populated `SubstitutionCandidateInput.regulatoryPermitted`
even though `substitution.ts`'s own scoring dimension already existed —
now wired per candidate against the project's own real
`formulation.targetMarkets[0]`, with a locally-tracked `noBlockingOnly`
filter exclusion for a real violation (never persisted, never extending
the shared engine's own output schema). Advanced Optimizer/System
Substitution confirmed to be a genuine, pre-existing, DOCUMENTED "not
yet implemented" boundary (`regulatoryOptimizationPolicySchema.mode`
hard-locked to `"not_available"`) — not a gap this task closes; only its
now-stale doc comment was corrected, zero behavior change.

Verified: `pnpm --filter @formulab/desktop test` — 1416/1416 across 152
files (32 new: 14 `generatedFormulaRegulatory.test.ts`, 8
`GeneratedRegulatorySummary.test.tsx`, 5 `costComparison.test.ts`, 3
`inventoryComparison.test.ts`, 3 `formulationReport.test.ts`, 2
`SubstitutionPanel.test.tsx`; `FormulationResultPage.test.tsx` count
unchanged, 3 tests corrected in place). `typecheck`/`lint` — clean.
`pnpm --filter @formulab/shared test` — 1311/1311 (comment-only doc fix
in `optimization.ts`, unchanged count). `python -m pytest
runtime/pipeline -q` — 361 passed, 5 subtests (down from 376+5 by
exactly the 15 tests removed with `regulatory.py`). `python scripts/
validate_v1_tracker.py` — OK, 171 tasks, no drift. `git diff --check` —
clean (LF/CRLF warnings only). No FVL-03.011+ work started; no new
regulatory engine anywhere; no Python regulatory rule-matching logic
remains.

## FVL-03.009 resolution (prior session)

"Make the EXISTING Safety Engine the single authoritative final safety
verdict for the formulation workflow — retire `runtime/pipeline/
safety.py` as a competing final-verdict authority, no new engine, no
Python port." Full audit (no subagents, per explicit instruction)
confirmed `runtime/pipeline/safety.py::evaluate_safety()` was a real,
independently-computing SECOND final-verdict authority — its own
`_SENSITIZER_CLASS_INGREDIENTS`/`_ALLERGEN_DECLARATION_INGREDIENTS`/
`_CORROSIVE_HANDLING_INGREDIENTS`/`_IRRITANT_POWDER_HANDLING_INGREDIENTS`/
`_SULFATE_KEYS` hazard tables computing its own `overall_status`, never
consuming `packages/shared/src/engine/safety.ts`. **Resolved by full
retirement, not permanent reconciliation** (same Option-A precedent
FVL-03.003 already established): `safety.py` and `test_safety.py` (9
tests) deleted entirely; `pipeline.py` no longer imports `safety`,
builds `safety_result`, emits `card["safety"]`, or appends a
`safety`-sourced `evidence_gaps` entry; `validation_plan.py`'s
`safety_overall` parameter removed, VAL-002 narrowed to its still-live
regulatory-only half (Regulatory consolidation untouched — FVL-03.010's
job); `test_pipeline.py`'s zero-LLM guard now asserts `"safety" not in
card`; `test_traceability.py`'s safety-provenance test (reading the
now-removed `card["safety"]["findings"]`) deleted, its adjacent
regulatory test untouched. The separate, legitimate pre-generation
`classify_target()`/`safety_gate()` AI-request classification gate was
confirmed unrelated and left completely alone. Full detail in
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`'s new "Safety Engine
boundary" section.

**Read-only, no promotion needed — same seam pattern as FVL-03.008**:
new pure `apps/desktop/src/lib/generatedFormulaSafety.ts::evaluateGeneratedFormulaSafety(formula, materials, rules, opts)`
reshapes via `linesFromGeneratedFormula()` and hands it, unmodified, to
the real `evaluateSafety()`. Rule set is a REQUIRED caller-supplied
parameter — new `useSafetyRules()` hook loads the LIVE `safety_rules`
masterdata collection, not the bare `SEED_SAFETY_RULES` constant.
`classifyProductSafety()` deliberately NOT wired (a generated session's
free-text `brief.category` has no reliable join to a real
`ProductFamily.hazardClass` record — fabricating that join would violate
the standing no-fabricated-identity rule, the same scope decision
FVL-03.008 made for Compatibility).

**`formulaState`**: `safe`/`warning`/`blocked`/`unknown`. `"blocked"` iff
a real `severity === "blocking"` finding fired (the platform's own
already-confirmed hard-block convention, reused not invented);
`"warning"` iff any non-blocking finding fired; otherwise `"unknown"`
(never `"safe"`) when at least one ingredient never resolved to a
canonical `materialCode`. `unresolvedMaterialCount` always surfaced
honestly alongside real findings.

**Version eligibility, not a combined score**: `pickCheapestValidVersion()`/
`pickMostInventoryFeasibleVersion()` gained an optional 4th `safeties`
parameter, independent of and additive to the existing `compatibilities`
gate — a safety-`blocked` version can never be crowned cheapest-valid or
most-feasible; `warning`/`unknown` never exclude; omitting the parameter
preserves every pre-existing call site's behavior exactly.

**UI/report — fully rewired off the legacy `card.safety` shape**:
`FormulationResultPage.tsx`'s `SafetyTab` rewritten around a new thin
`GeneratedSafetySummary` presenter; a Safety section added to
`SummaryTab` (including its "Readiness" badges block — a third,
easy-to-miss `card.safety.overall_status` reference caught only by this
task's own required closure-time grep audit, not by typecheck/lint/the
first test pass); a Safety row/blocked-banner added to
`VersionSummaryCard`. `formulationReport.ts` rewired to accept a
`safetyByVersion` map (the exact same computed result the UI renders)
instead of reading the retired `card.safety` JSON — closing the one real
split-authority risk in this task (the "Download Report" path), with an
honest "not available" (never a fabricated verdict) when no result was
computed. `formulationV2.ts`'s `SafetyResult` interface kept, not
deleted, but its doc comment now states plainly it is legacy-only —
read by zero current code, kept only so a historical session file still
parses. Historical sessions carrying legacy `card.safety` JSON open
without crashing and never surface as current authority (proven by a
dedicated test against the pre-existing SESSION_V6 fixture).

**Optimizer/substitution/system-substitution reuse — confirmed, not
rewritten**: all three already consume the real Safety Engine correctly
(`blockingExclusionConstraints`, `SubstitutionPanel.tsx`'s
`hasBlockingSafetyFinding`); none needed new code. **Same disclosed,
out-of-scope finding FVL-03.008 already flagged, reconfirmed for
Safety**: those three callers pass the hardcoded `SEED_SAFETY_RULES`
constant rather than the live edited collection — a data-freshness gap,
not a duplicate-authority violation; flagged again for a future
session. Compatibility and Safety confirmed to remain separate domains
throughout — no merged findings, no shared verdict field.

Verified: `pnpm --filter @formulab/desktop test` — 1381/1381 across 150
files (24 new: 9 `generatedFormulaSafety.test.ts`, 7
`GeneratedSafetySummary.test.tsx`, 5 `costComparison.test.ts`, 3
`inventoryComparison.test.ts`, 3 `formulationReport.test.ts`; 4 existing
`FormulationResultPage.test.tsx` tests corrected, not newly added, since
the real Safety and Compatibility engines now legitimately co-fire on
pre-existing fixtures). `typecheck`/`lint` — clean. `python -m pytest
runtime/pipeline -q` — 376 passed, 5 subtests (down from 386+5 by
exactly the 10 tests removed with `safety.py`/its traceability test).
`python scripts/validate_v1_tracker.py` — OK, 171 tasks, no drift.
`git diff --check` — clean (LF/CRLF warnings only). Closure-time
single-authority grep re-audit (`overall_status`/`evaluate_safety`/
`evaluateSafety`/`classifyProductSafety`/`hazard` across
`runtime/pipeline`, `runtime/formulation`, `packages/shared/src`,
`apps/desktop/src`, `apps/desktop/src-tauri/src`) found zero live-code
hits outside the one authoritative TS engine and its confirmed-correct
callers. No FVL-03.010+ work started; no new safety engine anywhere; no
Python safety hazard-scoring logic remains. Regulatory consolidation
(`regulatory.py`/`regulatoryRules.ts`) completely untouched. Zero-LLM
intact; `/live` untouched.

## FVL-03.008 resolution (prior session)

"Wire the EXISTING Compatibility Engine as the authoritative chemical/
material compatibility hard-constraint verdict — no new engine, no
duplicate rules in Python, `rules.py` stays request-constraint-only."
Full audit (no subagents, per explicit instruction) found **zero engine/
schema gap**: `evaluateCompatibility()`
(`packages/shared/src/engine/compatibility.ts`) is already a complete,
deterministic, rule-driven checker — real `RULE_SEVERITIES`
(`info`/`warning`/`error`/`blocking`), real `materialCode` identity via
`materialFor()`, honest `dataIncomplete` downgrade for missing pH/
temperature data. Confirmed by audit that ONLY `severity === "blocking"`
is a real hard block anywhere in this platform
(`blockingExclusionConstraints`/`SubstitutionPanel.tsx`'s own
`hasBlockingCompatibilityFinding`) — reused exactly, not invented.
`runtime/pipeline/rules.py` re-confirmed request-constraint-only (zero
chemistry/ionic/pH/cationic/anionic keyword hits). **Zero engine/schema/
Rust/Python changes made.** Full detail in
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`'s new "Compatibility
Engine boundary" section.

**No promotion needed, unlike FVL-03.005/.006/.007**:
`evaluateCompatibility()` is pure, so a generated card is evaluated
read-only with zero persistence step. New pure
`apps/desktop/src/lib/generatedFormulaCompatibility.ts::evaluateGeneratedFormulaCompatibility(formula, materials, rules, opts)`
reshapes via the existing `linesFromGeneratedFormula()`. The rule set is
a REQUIRED caller-supplied parameter, deliberately never hardcoded — the
real authoritative rules live in the LIVE, chemist-editable
`compatibility_rules` masterdata collection (same one
`CompatibilityPanel.tsx` reads), not the bare `SEED_COMPATIBILITY_RULES`
constant. New `useCompatibilityRules()` hook loads that live collection
once, mirroring `useMasterCostData`/`useInventoryData`'s pattern.

**`formulaState`**: `compatible`/`warning`/`blocked`/`unknown`.
`"blocked"` iff a real blocking finding fired; `"warning"` iff any
non-blocking finding fired; otherwise `"unknown"` (never `"compatible"`)
when at least one ingredient never resolved to a canonical `materialCode`
— reporting "compatible" there would be a fabricated claim.
`unresolvedMaterialCount` always surfaced honestly alongside real
findings, neither hides the other.

**A real, pre-existing bug found and fixed by this session's own
testing**: `masterdata.ts::listRecordsSeeded()` threw `"not-desktop"`
outside Tauri (its `upsertRecords` call had no `isTauri` guard, unlike
its sibling `listRecords()`) — never previously exercised since no test
rendered a caller of it. Fixed with a one-line `!isTauri` early return of
`seed`, mirroring `listRecords()`'s own convention; zero behavior change
inside a real Tauri build.

**Version eligibility, not a combined score**: `pickCheapestValidVersion()`/
`pickMostInventoryFeasibleVersion()` gained an optional `compatibilities`
eligibility-gate parameter (same style as their existing
`formula_state.startsWith("invalid")` check) — a `"blocked"` version can
never be crowned cheapest-valid or most-feasible merely because its
price/stock looks good; `"warning"`/`"unknown"` never exclude; omitting
the parameter preserves every pre-existing call site's behavior exactly.

**UI — a thin presenter**: new `GeneratedCompatibilitySummary` renders
the result as-is (no severity math, no rule matching) in the result
page's Summary tab, plus a compatibility row/blocked-banner on
`VersionSummaryCard`. `CompatibilityPanel.tsx` untouched.

**Optimizer/substitution/system-substitution reuse — confirmed, not
rewritten**: `AdvancedOptimizerPanel.tsx`, `SubstitutionPanel.tsx` (both
one-to-one and system mode) already consume the real engine correctly;
none needed a single line of new code. **Disclosed, out-of-scope
finding**: all three pass the hardcoded `SEED_COMPATIBILITY_RULES`
constant rather than the live edited collection this task's own new code
reads — a real data-freshness gap, not a duplicate-authority violation
(same single engine, same call, no second scoring logic) — flagged for a
future session, out of this task's own boundary to retrofit.

Verified: `pnpm --filter @formulab/desktop test` — 1354/1354 across 148
files (26 new: 9 `generatedFormulaCompatibility.test.ts`, 6
`GeneratedCompatibilitySummary.test.tsx`, 4 `costComparison.test.ts`, 3
`inventoryComparison.test.ts`, 4 `FormulationResultPage.test.tsx`).
`typecheck`/`lint` — clean. `packages/shared`, `runtime/formulation`,
`runtime/pipeline`, `apps/desktop/src-tauri/src/formulation*` confirmed
untouched by `git status` diff — no Python/Rust/shared sanity suite
re-run performed. `python scripts/validate_v1_tracker.py` — OK, 157
tasks, no drift. `git diff --check` — clean (LF/CRLF warnings only). No
FVL-03.009+ work started; no new compatibility engine anywhere; no
Python compatibility logic added.

## FVL-03.007 resolution (prior session)

"Wire the EXISTING system substitution engine into the formulation
workflow — no new system engine, no second scoring system, system
(multi-material) substitution only (FVL-03.006 already closed material
substitution)." Full audit (no subagents, per explicit instruction) found
**zero engine/schema/scoring gap** and confirmed system substitution is
already fully implemented, not merely documented:
`packages/shared/src/engine/systemSubstitution.ts`
(`generateSystemCandidates`/`buildSystemSubstitutionProblem`/
`scoreSystemResult`), spec in `docs/SYSTEM_SUBSTITUTION.md`. Confirmed
"system" has no fixed chemistry taxonomy anywhere in this platform — a
system is whichever ≥2 formula lines a HUMAN selects in the existing
`SubstitutionDialog`'s own checklist; membership is never auto-detected.
Candidate generation never uses name similarity; every proposal is routed
through the real Advanced Optimizer (never a proportional-scaling
shortcut); a proposal failing to cover a preserved function is recorded
`rejected`, never silently offered partial. Applying persists BOTH the
`OptimizationRun` and an immutable `SubstitutionRun` before touching
anything, then updates only the working draft — never the saved
`FormulationVersion`, identical lifecycle to FVL-03.006. Full detail in
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`'s new "System
Substitution Engine boundary" section. **Zero
engine/schema/scoring/Rust/Python changes made.**

**The one real gap — same shape as FVL-03.005/.006**: a generated AI
session card has no real project, and the existing dialog's
`selectedLineIds` could only ever be seeded with ONE line (the required
`line` prop) — no way to open pre-checked into system mode for 2+
ingredients picked from a generated card. Resolved with a small, additive
change: new optional `initialExtraLineIds?: string[]` prop on
`SubstitutionDialog` seeds additional pre-checked lines on open, filtered
defensively against real `allLines` inside the dialog itself (never
trusting a caller blindly — a stale/bogus id can never fabricate system
membership). Every existing call site that doesn't pass it is unaffected.
The human retains full control after open — every checkbox stays freely
editable.

**UI — smallest addition, reusing rather than cloning**: a "System
substitution" multi-select added only to the existing generated-formula
ingredient table (`FormulaTab` in `FormulationResultPage.tsx`) — a
checkbox per row (click isolated so it never also opens the evidence
panel) plus a small action bar, disabled below 2 selections so a
one-material problem can never reach system mode. Clicking it reuses the
exact FVL-03.005/.006 promotion seam, resolves selected ingredient
indices to the promoted version's own real line ids (same index-alignment
guarantee as FVL-03.006), and navigates to
`/formulation?project=<id>&substituteLine=<anchor>&systemLines=<rest>` —
a new one-shot query-param handoff in `FormulationPage.tsx` mirroring its
own pre-existing `focusLine`/`substituteLine` pattern — opening the
existing, otherwise completely unmodified `SubstitutionDialog` already
pre-seeded into system mode.

**Version scoping — a real bug caught and fixed by this session's own
testing**: `FormulaTab`'s local ingredient-selection state persisted
across a version switch (React reuses the component instance), leaving a
V1 selection wrongly enabled against V2's unrelated ingredient indices. A
new test caught it; fixed with a `useEffect` resetting the selection on
`card.version` change — exactly the class of scoping bug this task's own
Acceptance I exists to catch.

**Read-only w.r.t. the session, by construction**: confirmed by diff
review — only `session.brief`/`session.id`/`card` reads appear anywhere
in the changed files, no `session.*` mutation. Only new `Formulation`/
`FormulationVersion` records are ever created by promotion; the actual
system-substitution apply step still only mutates the working draft. No
compatibility/safety/regulatory logic added (FVL-03.008/.009/.010
untouched); no fabricated ratios/concentrations (the existing engine's
own deterministic optimizer-derived percentages used as-is); zero-LLM.

Verified: `pnpm --filter @formulab/desktop test` — 1328/1328 across 146
files (7 new: 3 in `SubstitutionPanel.test.tsx`'s new
`initialExtraLineIds` describe block, 4 in `FormulationResultPage.test.tsx`'s
new selection/scoping block; `SubstitutionPanel.test.tsx`'s pre-existing
system-substitution tests unmodified and green). `typecheck`/`lint` —
clean. `packages/shared`, `runtime/formulation`, `runtime/pipeline`,
`apps/desktop/src-tauri/src/formulation*` confirmed untouched by `git
status` diff — no Python/Rust/shared sanity suite re-run performed.
`python scripts/validate_v1_tracker.py` — OK, 157 tasks, no drift.
`git diff --check` — clean (LF/CRLF warnings only). No FVL-03.008+ work
started; no new substitution/scoring engine anywhere; no Python
system-substitution logic added.

## FVL-03.006 resolution (prior session)

"Wire the EXISTING material substitution engine for unresolved/
unavailable ingredients — no new substitution engine, no second scoring
system, material substitution only (not FVL-03.007's system
substitution)." Full audit (no subagents, per explicit instruction) found
**zero engine/schema/scoring gap**: the one-to-one Material Substitution
Engine (`packages/shared/src/schemas/substitution.ts` +
`packages/shared/src/engine/substitution.ts`, spec in
`docs/MATERIAL_SUBSTITUTION.md`) already scores 15 real dimensions (never
name similarity), reports `missingData: true` rather than a fabricated
perfect match, uses real `materialCode` identity throughout, and already
has a real, tested UI (`SubstitutionDialog`/`SubstitutionPanel.tsx`,
mounted in both `/live` and `/formulation`) that persists an immutable
`substitution_runs` record before ever touching the working DRAFT (never
the saved `FormulationVersion`). Full detail in
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`'s new "Material
Substitution Engine boundary" section.

**New trigger boundary**: pure
`apps/desktop/src/lib/generatedFormulaInventory.ts::shouldOfferSubstitution()`
returns true only for (A) an ingredient with no resolvable `materialCode`
at all, or (B) a resolved ingredient whose FVL-03.004 inventory state is
definitively `insufficient` — false for every other UNKNOWN (no
inventory record, mixed units, unusable batch size), matching the "UNKNOWN
means missing data, never automatic unavailability" rule exactly.

**Generated-vs-saved integration — same seam FVL-03.005 already
established**: `substitutionRequestSchema` requires a real
`projectId`/`formulaVersionId`, so "Find substitute" reuses
`promoteGeneratedFormula.ts::buildPromotedFormulation()` unchanged. The
in-memory promotion cache in `FormulationResultPage.tsx` was widened to
hold the full `{formulation, version}` pair (not just the id) so the
Optimizer and Substitution entry points share one promoted project per
generated version, and so a click can resolve the promoted version's own
line id by array index (guaranteed aligned to the generated formula's own
ingredient order, since both derive from the same
`card.formula.ingredients` array via the same
`linesFromGeneratedFormula()`).

**UI — smallest addition to an existing component, not a new
dashboard**: a "Find substitute" button was added only inside the
existing `InventoryFeasibilitySummary` (FVL-03.004's own per-ingredient
display), shown per line only when `shouldOfferSubstitution()` is true.
It navigates to `/formulation?project=<id>&substituteLine=<lineId>` — a
new one-shot query-param handoff in `FormulationPage.tsx` mirroring its
own pre-existing `focusLine` pattern — which opens the existing,
completely unmodified `SubstitutionDialog` for that line, with a
defensive existence-guard so a stale/malformed line id can never crash
the dialog. `SubstitutionPanel.tsx` itself already handles an unresolved
source material gracefully (`line.materialId ?? line.id` /
`line.materialCode ?? ""`) — pre-existing behavior, reused as-is, not a
new source-identity mechanism.

**Read-only w.r.t. the session, by construction**: confirmed by diff
review — only `session.brief`/`session.id`/`card` reads appear anywhere
in the changed files, no `session.*` mutation. Only new `Formulation`/
`FormulationVersion` records are ever created by promotion; the actual
substitution apply step still only mutates the working draft, exactly as
before. No system substitution pulled forward — `systemSubstitution.ts`/
`generateSystemCandidates`/`buildSystemSubstitutionProblem`/
`scoreSystemResult` are never referenced by any new code (confirmed by
grep); FVL-03.007 remains untouched and NOT started. Zero-LLM.

Verified: `pnpm --filter @formulab/desktop test` — 1321/1321 across 146
files (13 new: 6 in `generatedFormulaInventory.test.ts`'s new
`shouldOfferSubstitution` describe block, 7 in new
`InventoryFeasibilitySummary.test.tsx`; `SubstitutionPanel.test.tsx`/
`FormulationPage.test.tsx` unmodified and green, confirming zero behavior
change to the reused engine/dialog). `typecheck`/`lint` — clean.
`packages/shared`, `runtime/formulation`, `runtime/pipeline`,
`apps/desktop/src-tauri/src/formulation*` confirmed untouched by `git
status` diff — no Python/Rust/shared sanity suite re-run performed.
`python scripts/validate_v1_tracker.py` — OK, 157 tasks, no drift.
`git diff --check` — clean (LF/CRLF warnings only). No FVL-03.007+ work
started; no new substitution/scoring engine anywhere; no Python
substitution logic added.

## FVL-03.005 resolution (prior session)

"Wire the EXISTING Advanced Optimizer as an optional post-generation
refinement of a selected formulation alternative — no new solver, not a
merge into `engine.py`." Full audit (no subagents used, per explicit
instruction) found **zero engine/schema/solver/Rust gap**:
`runtime/formulation/advanced_optimizer.py` (1732-line real MILP/PuLP
solver, confirmed additive and distinct from `formulation_core.py`'s
simple LP), its Rust bridge, `packages/shared/src/schemas/optimization.ts`'s
full schema set, and the existing `AdvancedOptimizerPanel.tsx`/
`OptimizationPage.tsx` UI were already single-authority-correct — real
`materialCode` identity, caller-computed compatibility/safety risk, honest
stock fields, hard-constraint preservation, structured infeasibility
handling. Full detail in
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`'s new "Advanced
Optimizer boundary" section.

**The one real gap**: `formulationProblemSchema.projectId`/
`productFamilyId` are non-optional, but a generated AI session card has
no project association. The seemingly-promising `/optimizer` standalone
page was investigated and ruled out — it's the unrelated **simple**
optimizer, no `materialCode`/canonical Material Master connection.
Fabricating placeholder IDs would violate the standing "no fake
persistent IDs" rule.

**Resolved with the user (AskUserQuestion) — "require save-first"**: new
pure `apps/desktop/src/lib/promoteGeneratedFormula.ts::buildPromotedFormulation()`
builds a real `Formulation`/`FormulationVersion` from the card's own
real data, reusing the existing `newFormulation()`/`newVersion()`/
`linesFromGeneratedFormula()` helpers (zero new persistence shape;
`materialCode` carried through unchanged from FVL-03.002/.003).
`productFamilyCode` uses the brief's real `category` when present, else
an honest `"general"` fallback — never a fabricated specific category.
New "Optimize / Refine" quick action on `FormulationResultPage.tsx`
(`SlidersHorizontal` icon; `formulationResult.quickActions.optimize`/
`optimizing` i18n keys added to all 8 locales) calls the existing
`saveFormulation()`/`saveFormulationVersion()` Tauri wrappers once per
version (cached in-memory per visit to avoid duplicate `Formulation`
records on repeat clicks), then navigates into the existing, completely
unmodified `/optimization?project=<id>` route.

**Read-only w.r.t. the session, by construction**: `buildPromotedFormulation()`
is pure (no Tauri/network call, proven by test); no code path writes back
to session storage — confirmed by diff review (only reads of
`session.brief`/`session.id`, no `session.*` mutation anywhere in the
changed files). Only new `Formulation`/`FormulationVersion` records are
ever created; the original generated session card is never mutated.

No new optimizer UI/dashboard (existing panel reused unmodified); `/live`'s
own optimizer path (`FormulasPage.tsx`'s Optimizer tab) untouched; no
substitution/compatibility/safety/regulatory logic touched; zero-LLM.
Acceptance A/B/C/D/E/F/G/H/J inherited as regression from the existing,
unmodified `AdvancedOptimizerPanel`'s own test suite (re-verified green,
not re-proven); this task's own narrow proof burden (promotion
correctness, read-only behavior, honest fallback) covered by new
`promoteGeneratedFormula.test.ts` (5/5 passing).

Verified: `pnpm --filter @formulab/desktop test` — 1308/1308 across 145
files (5 new; `AdvancedOptimizerPanel.test.tsx`/`OptimizationPage.test.tsx`
unmodified and green, confirming zero behavior change to the reused
workflow). `typecheck`/`lint` — clean. `packages/shared`,
`runtime/formulation`, `apps/desktop/src-tauri/src/formulation*`
confirmed untouched by `git status` diff (no Python/Rust/shared sanity
suite re-run needed — nothing in those trees changed). `python scripts/
validate_v1_tracker.py` — OK, 157 tasks, no drift. `git diff --check` —
clean (LF/CRLF line-ending warnings only, no real conflicts). No
FVL-03.006+ work started; no new solver/second optimizer implementation
anywhere; no substitution logic implemented.

## FVL-03.004 resolution (prior session)

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

**`FVL-04.013`** — blank, NOT STARTED (see above). Not begun this
session — explicit boundary in this session's own task brief.
FVL-04.001-.012 — **COMPLETE, HARDENED, AND NO KNOWN CANONICAL/TEMPLATE
ONBOARDING GAP REMAINS**; FVL-04.013 begins the enterprise
external-source connector/mapping/crosswalk layer.

## Known blockers

None. FVL-01/FVL-02/FVL-03 fully closed; FVL-04.001-.012 complete,
hardened, and both explicitly user-approved remaining gaps closed.
Disclosed, out-of-scope, non-blocking findings carried forward for a
future session: (1)/(2) the existing Optimizer/Substitution
compatibility/safety re-run call sites use the hardcoded
`SEED_COMPATIBILITY_RULES`/`SEED_SAFETY_RULES` constants rather than the
live edited collections; (3) Material Substitution's regulatory wiring
cannot currently produce a real `false`/prohibited result with the
actual seed catalog; (4) the Advanced Optimizer/System Substitution
carry a genuine, pre-existing, documented "regulatory not yet
implemented" boundary; (5) **RESOLVED** — the three pre-existing UI call
sites that computed inventory availability inline now call the
canonical `evaluateMaterialAvailability()`, with a proven kg-unit guard;
(6) **RESOLVED** — `material_suppliers` has a real Data Exchange
template; (7) **RESOLVED this session** — Process Parameters has a real
consumer (`ProcessParametersPanel.tsx`) AND TDS/SDS/specification
documents now have a real dedicated per-material viewer
(`MaterialDocumentsPanel.tsx`) — both previously-disclosed UI/UX gaps
closed. No known canonical/template-onboarding gap remains from
FVL-04.001-.012. None of the above are duplicate-authority issues.

## Most recent relevant tests

- `pnpm --filter @formulab/desktop test` — 1500/1500 across 156 files
  (43 new this session: `MaterialDocumentsPanel.test.tsx` (9, new file),
  `MaterialsPage.specifications.test.tsx` (2, new file),
  `dataExchangeCommit.test.ts` (7 FinishedProductSpecification tests),
  `DataExchangeImportDialog.test.tsx` (4); template card count updated
  44→45).
- `pnpm --filter @formulab/desktop typecheck` / `lint` — clean.
- `pnpm --filter @formulab/shared test` — 1347/1347 across 67 files (12
  new independent fixtures + negatives for `finished_product_specifications`;
  template-count assertions updated 44→45).
- `cargo check` / `cargo test` — 345/345 (the first Rust change in the
  FVL-04.005-.012 block: `masterdata.rs`'s `COLLECTIONS` array +
  `role_policy.rs` collection-count assertions updated 90→91).
- `pnpm --filter @formulab/shared generate:role-policy-matrix` — re-run
  after `masterdataPolicyAreas.ts`'s mapping changed; the three generated
  JSON fixtures re-checked in, parity tests re-verified passing.
- i18n parity — 23/23 (new `materials.tab.specifications`/
  `materials.documents.*` keys added to all 8 locales).
- `python scripts/validate_v1_tracker.py` — OK, 171 tasks, no drift
  (task counts unchanged — hardening evidence appended, no new task
  completion).
- `git diff --check` — clean (LF/CRLF warnings only).

## Latest commit SHA

`7ab18dc` (pushed to and matching `origin/feature/laboratory-stability`)
— "feat(v1): complete specification and material document UX gaps
(FVL-04.005/.003/.004)". Prior: `418c0d9` — "fix(v1): harden canonical
Data Exchange integrations (FVL-04.005-.012)".

## Reminder

- Do not invent a `FVL-12`.
- Do not mark a future task `COMPLETED` on assumption.
- Follow the full protocol in `FORMULAB_V1_TASK_TRACKER.md`'s own
  "Tracker update protocol" section before touching any task status.
