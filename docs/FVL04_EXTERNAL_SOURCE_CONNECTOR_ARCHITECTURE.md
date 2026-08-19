# FVL-04 External Source Connector Architecture

Covers FVL-04.013-.018 (contract, generic file connector, schema discovery,
mapping profile, external-ID crosswalk, transformation). Written at
closure of that block, 2026-08-19. Scope is frozen by
[`FORMULAB_V1_FINAL_SCOPE.md`](FORMULAB_V1_FINAL_SCOPE.md); status lives
in [`FORMULAB_V1_TASK_TRACKER.md`](FORMULAB_V1_TASK_TRACKER.md).

## Frozen pipeline

```
Customer/External System
  -> READ-ONLY Connector/Extractor              (FVL-04.013/.014)
  -> Source Staging                              (FVL-04.014)
  -> Schema Discovery                            (FVL-04.015)
  -> Reusable Versioned Mapping Profile           (FVL-04.016)
  -> Transformation / External-ID Crosswalow      (FVL-04.017/.018)
  -> Canonical FormuLab import candidate objects
  -> EXISTING Data Exchange Preview
  -> EXISTING Validation
  -> Human Review
  -> EXISTING Explicit Commit
  -> EXISTING Import History
  -> Canonical FormuLab Records
```

Everything above the "canonical import candidate objects" line is new,
pure, and deterministic. Everything from Preview downward is the
pre-existing Data Exchange system (`packages/shared/src/schemas/dataExchange.ts`,
`packages/shared/src/engine/dataExchangeValidation.ts`,
`apps/desktop/src/lib/dataExchangeCommit.ts`) — untouched by this block.

## What the connector layer owns / does not own

Owns: extraction, source identity, source-schema description,
source-to-canonical mapping configuration, external-ID resolution,
deterministic transformations.

Does not own: canonical business rules, Material Master decisions,
supplier approval, price selection, cost calculation, inventory
availability, compatibility, safety, regulatory verdicts, formula
generation, laboratory interpretation, or Data Exchange commit
semantics. It also does not call masterdata persistence as a normal
final write path — its normal output is candidate rows + provenance,
handed to the existing Data Exchange authority.

## Module map

| Concern | File | Notes |
|---|---|---|
| Connector contract | `packages/shared/src/schemas/connector.ts` | `SourceConnector`, `ConnectorResult`, `ConnectorError` — no write method exists on the interface |
| FNV-1a fingerprint | `packages/shared/src/engine/connectorFingerprint.ts` | Deterministic, synchronous, no dependency |
| XML parsing | `packages/shared/src/engine/xmlParser.ts` | Hand-rolled; DOCTYPE/ENTITY rejected before parsing ever starts |
| Generic file connector | `packages/shared/src/engine/fileConnector.ts` | `createFileConnector()` — a real `SourceConnector` implementation (Session 7) — plus `stageFile()`/`stageCsvFile()`/`stageJsonFile()`/`stageXmlFile()` staging |
| XLSX multi-sheet reader | `apps/desktop/src/lib/xlsx.ts` (`readWorkbookAllSheets`) | Each sheet its own source entity; injected into `createFileConnector`/`stageFile` as the `readWorkbook` adapter |
| Production reference resolver | `apps/desktop/src/lib/dataExchangeExisting.ts` (`buildReferenceResolver`) | Session 7 — reused by BOTH the production `DataExchangeImportDialog` and this connector layer's own end-to-end acceptance; never a parallel implementation |
| Schema discovery | `packages/shared/src/engine/schemaDiscovery.ts` | Types, null patterns, date/decimal convention (evidence-based only), unit hints, relationship hints, fingerprint |
| Mapping profile | `packages/shared/src/schemas/connector.ts` (`mappingProfileSchema`) + `packages/shared/src/engine/mappingProfile.ts` | Configuration only, fans one source row into many target templates |
| Unit conversion authority | `packages/shared/src/engine/unitConversion.ts` | The ONE generic mass/volume conversion module (Session 6 hardening) — `transformation.ts` is its only consumer |
| Transformation | `packages/shared/src/engine/transformation.ts` | Declarative ops only, no scripting language; delegates unit conversion to `unitConversion.ts` |
| Crosswalk | `packages/shared/src/engine/crosswalk.ts` | Pure resolve/upsert/conflict logic |
| Desktop persistence bridge | `apps/desktop/src/lib/connectorPersistence.ts` | The only place this layer calls `listRecords`/`upsertRecords` |
| End-to-end proof | `apps/desktop/src/lib/connectorEndToEnd.test.ts` | Two customer fixtures through real commit |

## Security boundaries (verified at closure)

- Connectors are read-only by construction: `SourceConnector` has no
  write/update/delete/patch/put/executeMutation method, proven by a
  source-text regex scan test, not just by type-checking.
- No arbitrary SQL execution surface exists — no database connector
  implementation exists yet, and the contract itself carries no
  query-execution method.
- No arbitrary code execution in mapping profiles or transformations —
  no `eval`, no dynamic JS, no Python snippet support. Transformation
  steps are a closed enum (`TRANSFORMATION_OPS`).
- XML external entities are structurally impossible: the parser has no
  code path capable of resolving a DOCTYPE or entity declaration.
- No plaintext secret is ever staged or logged — proven by a source-text
  regex check across staged records and error details.
- Crosswalk identity cannot silently remap: same tuple + different
  target returns an explicit `CrosswalkConflict`, array left unchanged.
- No name-based silent matching exists anywhere in the crosswalk or
  transformation layers — relationship resolution always prefers (1)
  crosswalk, (2) explicit canonical code, (3) unresolved/human review.

## Data Exchange boundary

This block never adds a second Data Exchange platform, preview/
validation/commit/history lifecycle, Material Master, Cost/Inventory/
Regulatory/Safety engine, or Laboratory platform. Canonical candidates
produced here are shaped to pass through the existing
`previewDataExchangeImport()`/`commitDataExchangeRows()` unchanged —
proven directly in `connectorEndToEnd.test.ts`.

## FVL-04.024 bridge boundary (not built here)

FVL-04.024 will own the formal Connector -> Existing Data Exchange
Bridge (a UI/orchestration surface wiring a connector run to a Data
Exchange import job automatically). This block deliberately stops short
of that: it proves candidates ARE bridgeable (by calling the real Data
Exchange preview/commit functions directly in tests) but does not build
a permanent orchestration abstraction that would compete with .024.

## Persistence

Two new masterdata collections, following the existing
zod-schema-for-persisted convention:

- `mapping_profiles` (**append-only**, corrected in Session 6 — see
  Hardening below. Immutable storage identity is
  `code = "${profileId}::v${profileVersion}"`; the storage layer itself
  rejects a second write reusing an existing `code`).
- `external_id_crosswalks` (mutable — `lastSeenAt` updates in place on
  re-import; `firstSeenAt`/`canonicalRecordId` never change once set,
  enforced by `crosswalk.ts`'s own conflict detection, not by storage).

No SQLite side database, no ad hoc JSON file outside the existing
masterdata architecture. Raw customer payloads are never persisted
beyond ephemeral in-memory staging for one connector run.

## Hardening (Session 6, 2026-08-19) — independent review corrections

An independent repository-level review of the Session 5 closure found
real implementation and acceptance gaps. All were verified against
current code, fixed, and re-tested. Nothing below is a documentation-only
narrowing — every corrected claim now matches genuinely corrected code.

**Corrected claims.** Session 5's log stated `ConnectorResult` "exposes
source identity/type/size/hash" — that was aspirational, not real: no
such fields existed. `ConnectorResult.sourceResource` (a new
`SourceResourceMetadata` shape: kind/resourceName/mediaType/byteSize/
contentFingerprint/sourceSchemaVersion) now genuinely carries this, and
`contentFingerprint` is explicitly documented as the same non-cryptographic
FNV-1a fingerprint used elsewhere — never called a "hash"/"SHA256"
anywhere, since it isn't one.

**FVL-04.013.** `SourceRecordIdentity` gained `idSource:
"configured" | "ordinal"` — the three-tier identity model (staging-row
ordinal / explicit external source ID / canonical FormuLab ID) is now
represented in the type itself, not just prose. `ConnectorError` secret
exclusion is now proven with a REAL fake credential object in
`connector.test.ts` (C13-8 hardening), not merely the absence of one. A
mocked retryable `ConnectorError` is proven alongside the existing
non-retryable one.

**FVL-04.014.** New `stageFile()` in `fileConnector.ts` is the one
common abstraction CSV/XLSX/JSON/XML all funnel through, each returning
real `sourceResource` metadata. XLSX is staged through it via an
injected `readWorkbook` adapter — `apps/desktop/src/lib/xlsx.ts`'s
`readWorkbookAllSheets` is the real production adapter, proven wired in
`xlsx.test.ts` with a genuine ExcelJS-written buffer AND a genuinely
corrupt buffer (`corrupt_xlsx`, structured, never a leaked raw
exception). `StageOptions.requireExplicitId` makes a missing configured
source ID a structured `missing_source_id` error instead of a silent
ordinal fallback.

**FVL-04.015.** `EXTERNAL_ID_STATUSES` (`"candidate" | "unresolved"`)
replaced by `EXTERNAL_ID_EVIDENCE` (`explicit_primary_key` /
`configured_external_id` / `metadata_primary_key` / `unique_candidate` /
`unresolved`) — a unique DISPLAY NAME now earns only the honest
`unique_candidate` observation, never authority; only an explicitly
configured `idField` earns `configured_external_id`.
`discoverUnitColumnHints()` adds deterministic per-row unit-column
discovery (`Quantity|UOM` shared-column and `Viscosity|ViscosityUnit`
per-field-suffix conventions, both structural, both refusing to guess
when genuinely ambiguous). `observedNullTokens` reports candidate null
tokens (`N/A`/`NULL`/`-`/...) without ever silently nulling them. The
structural fingerprint now also covers unit hints and CONFIGURATION-
driven identity role (never a sample-driven `unique_candidate`
observation, which must not flip the fingerprint batch to batch).
`SourceSchema.sourceProvidedSchemaVersion` preserves a source-declared
version separately from the computed fingerprint.

**FVL-04.016.** `mappingProfileSchema` gained a `code` field — the real
immutable storage identity (`profileId::vN`), always re-derived
defensively in `connectorPersistence.ts`'s `saveMappingProfile()`, never
trusted from a caller. `mapping_profiles` is now registered
**append-only** in `masterdata.rs` (was mutable — a real gap: nothing
previously stopped a second write from silently rewriting an existing
version's own mappings). `validateMappingProfile()` gained
`validateTransformationConfig()` — real per-op config-shape validation
(e.g. `parse_decimal` requires `decimalSeparator`; `convert_unit`
requires two recognized, dimensionally-compatible units) before any row
is ever mapped — and fan-out natural-key coverage validation
(`missing_target_natural_key_field`), so a fanned-out target missing its
own identity fields fails before commit, not after.

**FVL-04.017.** `CROSSWALK_STATUSES` narrowed from `["active",
"conflict"]` to `["active"]` — `"conflict"` was a dead enum value
nothing ever persisted (a conflict was always returned as a separate,
unpersisted `CrosswalkConflict`, the active record left untouched). The
chosen, now-documented behavior: the canonical active crosswalk is never
silently overwritten; a conflicting write is never persisted; the
conflict surfaces to the caller for human review. No other correction
needed — `.017`'s own tuple/no-name-matching/no-auto-delete guarantees
were already correct.

**FVL-04.018 — the largest correction.** `MASS_UNITS`/`VOLUME_UNITS`
moved out of `transformation.ts` into the new, single
`unitConversion.ts` authority (a repository-wide audit found no
pre-existing generic authority — `cost.ts`'s own inline conversions are
deliberately different, density-specific business logic, left
untouched). `resolve_crosswalk` now requires an explicit `canonicalEntity`
in its own step config (previously implicit/hardcoded by the caller's
own context wiring) and implements the full required precedence: (1)
crosswalk, (2) an explicit canonical code named by
`fallbackCanonicalField` on the SAME source record, (3) unresolved —
never a name match. `parseExplicitDate` now performs real calendar
validation (`isValidCalendarDate`, leap years included) — `31/02/2026`,
`29/02/2025`, and `31/04/2026` are now rejected; they previously were
not. `parseExplicitDecimal` now validates thousands-grouping structure
properly — `"1,23,4"` and `"1.2.3"` are now rejected as malformed rather
than silently digit-stripped into a wrong number.

**End-to-end acceptance.** `connectorEndToEnd.test.ts` was rewritten:
every commit now goes through a real `ReferenceStore` (built only from
actually-committed `DataExchangeRowResult.naturalKey` values) passed as
`resolveReference`, replacing the prior unconditional stub. A negative
case proves an unregistered code is genuinely refused
(`reference_missing`), not merely that a registered one passes. ACME_ERP
now performs at least one real explicit commit, not just a preview. A
new "Structured failure matrix" describe block gives FAIL1-FAIL20 each
an explicit test or a direct pointer to the specific existing test that
covers it.

Full re-verification: `pnpm --filter @formulab/shared test` 1467/1467
(73 files), `typecheck` clean. `pnpm --filter @formulab/desktop test`
full suite green, `typecheck`/`lint` clean. `cargo test masterdata`
25/25 (2 new: `mapping_profiles_is_allow_listed_as_append_only`,
`external_id_crosswalks_is_allow_listed_as_mutable`). No task count
change — FVL-04 remains 18/26, Total 81/171 (47.4%); this was a
hardening pass on already-COMPLETED tasks, not new task completion.

## Hardening (Session 7, 2026-08-19) — a second independent review, the production reference-resolution gap

A second independent repository-level review of Session 6's own closure
found further real gaps — most importantly, that the production Data
Exchange import path itself never actually validated `code_reference`
existence, meaning Session 6's own `ReferenceStore` end-to-end proof
covered a test path, not the real one. All findings below were verified
against current code, fixed, and re-tested. Session 6's own hardening
section above is left unchanged, not erased.

**The most important fix: production reference resolution was
missing.** `apps/desktop/src/components/dataExchange/DataExchangeImportDialog.tsx`
— the REAL screen a user uploads a file through — called
`previewDataExchangeImport()` with no `resolveReference` at all. A row
whose `material_prices.supplier_code` named a nonexistent supplier would
have silently "passed" preview, not because the check was bypassed by a
test, but because production itself never performed it. Fixed by reusing
the EXISTING per-template existing-record authority
(`dataExchangeExisting.ts`'s own `loadExisting`/`loadExistingFormulaBom`,
already used for create-vs-update classification) through a new
`buildReferenceResolver(referenceTemplates)`, wired into the dialog's own
preview call. No new reference engine, no material/supplier-specific `if`
branch — the resolver is generic and registry-driven, and the SAME
function is reused by this connector layer's own end-to-end acceptance
(`connectorEndToEnd.test.ts`), never a parallel test-only semantic
implementation. Five pre-existing `DataExchangeImportDialog.test.tsx`
fixtures had never seeded their referenced parent records (inventory
referencing a material, material_suppliers referencing a material and a
supplier, three finished_product_specifications fixtures referencing a
SKU and a TestDefinition) — they only ever "passed" because production
validated nothing; fixed by seeding the referenced parents in each
fixture's own mocked `listRecords`, matching what a real user would
actually need to import first.

**File-level provenance corrected further.** The XLSX
`contentFingerprint` previously fingerprinted the SELECTED SHEET's own
parsed rows, not the source file — selecting a different sheet of the
same file produced a different fingerprint, and `resourceName` had the
sheet name folded into it (`"file.xlsx#Materials"`), conflating file
identity with sheet identity. Both corrected: a new `fingerprintBytes()`
(`connectorFingerprint.ts`) fingerprints the RAW WORKBOOK BYTES directly,
so selecting a different sheet of the identical file now produces the
identical fingerprint; `SourceResourceMetadata` gained `subResourceName`
to carry the sheet name separately, `resourceName` stays the plain
filename. `byteSize` was previously a caller-supplied field on
`FileConnectorInput` — removed entirely; `stageFile()` now always derives
it internally from the actual bytes (XLSX) or real UTF-8 byte length
(`TextEncoder`, not JS `string.length`, proven with a multibyte fixture)
for text formats — a caller can no longer assert a false size.

**A real generic FILE `SourceConnector` implementation.** The common
contract previously existed only as an interface sitting next to the
standalone `stageFile()` function — no FILE-shaped value actually
implemented it. New `createFileConnector()` does: `identity`,
`discoverEntities()` (returns real sheet names for XLSX, the configured/
derived logical entity for CSV/JSON/XML), and `extract(entity)` — all
internally reusing `stageFile()`, no parser/staging logic duplicated.

**Sanitized parse errors, proven executably.** Every parse-failure path
(CSV/JSON/XML/XLSX) previously interpolated the raw library exception's
own `.message` into the structured `ConnectorError.message` — a genuine
leak vector (a path, a connection string, anything the underlying
library's own error text happened to contain). Fixed: every failure now
returns a STABLE, hand-written message; `detail` carries only the
exception's own constructor name (`"Error"`), never its content. Proven
with an executable test — not a source-text inspection — that throws a
realistic adapter error containing a real credential and a real local
path, and asserts neither value appears anywhere in the serialized
`ConnectorResult`.

**Structural fingerprint hardened further.** `observedTypes` was still
part of the fingerprint input — SAMPLE-derived, not declared structure: a
`Quantity` column reading `"100"` in one batch and `"unknown"` in the
next produced two different fingerprints for the identical header/
structure. Removed from the fingerprint input entirely; a new regression
test proves the fingerprint is now identical across two batches whose
same-named field has genuinely different observed value types, while
`SourceFieldSchema.observedTypes` itself still honestly reports the
different per-batch profile — fingerprint STABILITY and honest reporting
are deliberately separate concerns now.

**Configurable null tokens.** `DiscoverEntityOptions.nullTokenCandidates`
lets a caller extend (never replace) the default null-token recognizer
with customer-specific tokens (`"NO DATA"`, `"NOT RECORDED"`, `"~"`) —
still only ever REPORTED via `observedNullTokens`, never silently
converted to an actual null.

**`explicit_primary_key` removed.** A dead enum value in
`ExternalIdEvidence` — nothing ever set it. `metadata_primary_key`
(which DOES have a real, tested input path via
`DiscoverEntityOptions.metadataPrimaryKeyFields`) is retained.

**Mapping-profile version lifecycle corrected.** Session 6's own
append-only fix introduced a real contradiction: a persisted `active` v1
can never be rewritten to `"superseded"` (storage forbids it), yet the
schema implied that mutation was expected. Fixed: every persisted row's
own `status` is now understood as its status AT CREATION, never rewritten
— whether a version is CURRENTLY superseded is a DERIVED fact, computed
by a new pure `effectiveMappingProfileStatus(profile, allVersions)`
(superseded iff a newer version in the same `profileId` family exists),
never stored. The ambiguous `supersedesProfileId` (which could not
distinguish "replaces v1" from "replaces v2" once three-plus versions
exist) is replaced by `supersedesProfileCode`, naming the EXACT immutable
prior version. New `validateMappingProfileSupersession()` rejects
self-supersession, a nonexistent target, cross-family supersession, and
an outright duplicate version code — wired into
`connectorPersistence.ts`'s `saveMappingProfile()` before it ever reaches
storage.

**Transformation config type safety — real crash risk fixed.**
`map_boolean`'s runtime previously cast `config.trueValues`/`falseValues`
to `string[]` without checking the shape; a malformed non-array value
(e.g. a bare string) would have thrown `TypeError: ... .some is not a
function` at runtime if it ever bypassed profile validation. Fixed with
explicit `Array.isArray`/per-member `typeof` checks before use, at BOTH
runtime (`transformation.ts`) and profile-validation time
(`mappingProfile.ts`) — the "never throws" promise is now actually true
even if malformed config somehow reaches execution, not merely true when
profile validation was run first. `map_enum`/`parse_decimal` gained the
same defense-in-depth: `parse_decimal`'s `decimalSeparator`/`groupSeparator`
are now restricted to explicitly supported values (`.`/`,` for the
decimal separator; a small supported set for the group separator) rather
than an arbitrary non-empty string.

**Relationship resolution made explicit, not merely functional.**
`resolve_crosswalk` previously defaulted `sourceEntity` to
`ctx.currentEntity` whenever the step's own config omitted it — an
accidental same-entity shorthand, not a deliberate one. Now the shorthand
must be requested explicitly via `sameEntity: true`; omitting both
`sourceEntity` and `sameEntity` is a structured
`crosswalk_source_entity_not_configured` error. A configured
`fallbackCanonicalField` is now validated against the discovered source
schema at profile-validation time (`mappingProfile.ts`), not left to fail
silently at row-mapping time if the field never existed.

**Crosswalk ordinal-identity enforcement moved into the API itself.**
Session 6 only ever avoided persisting a crosswalk from a staging-only
ordinal identity by TEST-USAGE CONVENTION. `persistCrosswalkEntry()` now
REQUIRES `sourceIdentity: { sourceRecordId, idSource }` as part of its
own call signature; when `idSource === "ordinal"`, persistence is refused
before `upsertCrosswalk()` or any storage call ever runs — structurally
impossible to call this function with an ordinal identity and have it
actually persist, not merely a convention nobody violated yet.

**Rust storage-layer acceptance strengthened.** The real merge/
append-only-rejection logic was factored out of the async
`upsert_master_records` Tauri command (which requires a real `AppHandle`
and so cannot be unit-tested directly) into a new pure `apply_upsert()`
function, unit-tested directly against disposable in-memory rows — proving
a `mapping_profiles`-shaped record reusing an existing `code` is genuinely
rejected, a new `code` is genuinely accepted, and a mutable collection
still updates in place — real behavior, not merely a metadata assertion
about the `append_only` flag.

**Structured failure matrix rebuilt with explicit no-mutation proof.**
`connectorEndToEnd.test.ts`'s FAIL1-FAIL20 matrix now asserts, for every
relevant scenario (corrupt XLSX, missing source ID, schema mismatch,
missing target mapping, missing/conflicting crosswalk, invalid target
template/field, reference failure, shape failure), that the realistic
in-memory masterdata store genuinely received no write — not merely that
a structured error code was returned. FAIL20 (secret exclusion) is now an
EXECUTABLE assertion against a real `createFileConnector()` extraction
result, not a source-text inspection for a marker string.

**Final end-to-end rebuild.** Both fixtures now stage through the REAL
`createFileConnector()`, resolve references through the REAL
`buildReferenceResolver()` (the same function production uses), and
persist crosswalks only with an explicitly-declared identity provenance.
A new negative test proves an ordinal identity is refused by
`persistCrosswalkEntry()` itself. ACME_ERP performs two real commits
(supplier, then material), not merely a preview.

Full re-verification: `pnpm --filter @formulab/shared test` — full suite
green (1497+ across 73 files). `pnpm --filter @formulab/desktop test` —
full suite green (`connectorEndToEnd.test.ts` rebuilt to 24 tests;
`DataExchangeImportDialog.test.tsx` 14/14 after seeding five previously-
unvalidated fixtures). `typecheck`/`lint` clean both packages. `cargo
check`/`cargo test masterdata` — 28/28 (3 new: `apply_upsert_*`). No task
count change — FVL-04 remains 18/26, Total 81/171 (47.4%); this was a
second hardening pass on already-COMPLETED tasks, not new task
completion.
