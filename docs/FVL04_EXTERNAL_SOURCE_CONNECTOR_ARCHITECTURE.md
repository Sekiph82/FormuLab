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

## FVL-04.024 bridge boundary (superseded — built in Session 10)

Historical note only — the paragraph below described the ORIGINAL,
correct decision to defer building the bridge. It is now built and
hardened; see "Hardening (Session 10/11, 2026-08-20)" below for the real
module (`connectorImportBridge.ts`, `prepareConnectorImport()`/
`confirmConnectorImport()`).

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

## Hardening (Session 8, 2026-08-19/20) — final reference & version-chain integrity correction

A narrow, four-part final correction pass. Session 7's own claim that
"production Data Exchange reference validation now works" was true but
incomplete: it worked only for references into a target whose OWN natural
key is a single field. Every finding below was verified against current
code, fixed, and re-tested; Sessions 6/7's hardening sections above are
left unchanged.

**1. Reference resolution made genuinely field-aware.** The prior
resolver contract was `resolveReference(referenceTemplate, key): boolean`
and checked the key against the TARGET TEMPLATE'S OWN composite
`naturalKeys` set (e.g. `"SKU-001::BOTTLE-01"`) regardless of which single
FIELD (`packaging_sku_code`) the referencing column actually needed. For
every real reference into a composite-natural-key template
(`packaging_bom`, `label_content`, `doe_factors_responses`,
`reverse_formula_candidates`, `formula_bom`), this was a live false
negative: a genuinely valid reference (`packaging_sku_code: "SKU-001"`,
which is real and present) would resolve `false`, because
`naturalKeys.has("SKU-001")` is false — only the full composite string is
a member. Fixed: the contract is now
`resolveReference(referenceTemplate, referenceField, key): boolean`. A
new `resolveColumnReferenceField(column)` (`dataExchangeValidation.ts`) is
the single authority for which field a `code_reference` column resolves
against — the column's own explicit `referenceField` when set, else the
target's single natural-key field when the target's natural key has
exactly one field, else a deterministic `configError` (never a guess).
`buildReferenceResolver()` (`dataExchangeExisting.ts`) was rewritten to
take `{referenceTemplate, referenceField}[]` requirements and index
arbitrary EXPORTED FIELDS from each template's own `rows` (reusing the
same loader output `ExistingLookup` already provides — no second
per-template reference registry), caching the underlying record load per
TEMPLATE and the resolved value set per `(template, field)` pair so a
template referenced by two different fields loads its collection once.
`resolveColumnReferenceField()` is reused identically by the validator's
own row loop, `DataExchangeImportDialog.tsx`'s requirement-gathering, and
`connectorEndToEnd.test.ts`'s requirement-gathering — one real authority,
never a parallel implementation.

**Registry audit: zero real gaps.** A full audit of every
`code_reference` column with a `referenceTemplate` in
`dataExchangeRegistry.ts` (~94 columns) found every single one already
carries an explicit `referenceField` — the bug was entirely in the
RESOLVER LOGIC, not in registry metadata. `resolveColumnReferenceField()`'s
composite-key-without-`referenceField` fallback-failure path is currently
unreachable in production, locked in by a new
`dataExchangeRegistry.consistency.test.ts` (57 tests) that fails the
build the moment any future column violates the invariant (a
`referenceTemplate` whose target either has no matching column at the
named `referenceField`, or has no explicit `referenceField` and a
composite natural key) — the exact bug class closed here can never
silently reappear as the registry grows.

**2. Blanket self-reference bypass removed.** `dataExchangeValidation.ts`
previously special-cased `column.referenceTemplate === template.templateCode
? true : ...` — any self-reference (e.g.
`artwork_register.supersedes_artwork_code -> artwork_register.artwork_code`)
was accepted unconditionally, without ever checking the referenced value
actually existed. Removed; a self-reference now goes through the exact
same field-aware resolution as any other reference. Policy decision,
made explicit rather than left implicit: a self-reference must already
exist in canonical storage AT PREVIEW TIME — same-file forward references
(a row referencing another row in the same import batch that hasn't been
committed yet) are deliberately NOT supported. Proven by SELF1-4 in
`dataExchangeValidation.test.ts`: an existing self-reference passes
(SELF1); a missing one is reported not-found — and since
`supersedes_artwork_code` is not itself a `required` column in the
registry (no `required` self-reference column exists anywhere in it),
this degrades to a warning rather than a hard block, honestly matching
the column's own declared required-ness, never silently treated as valid
(SELF2); a row naming ITSELF as its own supersession target is validated
normally and fails, since it does not exist in canonical storage yet —
never auto-accepted merely because the target template equals the row's
own template (SELF3); a source-text check (with comments stripped, to
avoid the self-referential-regex-matching-its-own-doc-comment trap) proves
no unconditional bypass remains (SELF4).

**3. Mapping Profile version chain made exact.** Session 7's
`effectiveMappingProfileStatus()` marked a version superseded whenever ANY
higher-numbered version existed in the same `profileId` family, including
an unlinked draft that never actually named it as its predecessor —
too loose. Corrected: a version is now effectively superseded only when
some OTHER persisted version explicitly names its exact `code` via its
own `supersedesProfileCode` AND that successor's own `status` is
`"active"` — a draft successor never deactivates its predecessor.
`validateMappingProfileSupersession()` now also enforces an exact linear
chain, no gaps and no branching: `profileVersion === 1` requires no
`supersedesProfileCode`; every `profileVersion > 1` must equal
`max(existing) + 1` for its `profileId` family AND its
`supersedesProfileCode` must equal the CURRENT latest persisted version's
exact code (a v3 naming v1 as predecessor is rejected whether v2 is
missing entirely — a gap — or genuinely exists — branching off the wrong
predecessor). Storage model audited before implementation, per the
session's own instruction not to invent a second lifecycle database:
`mapping_profiles` is already append-only with `status` fixed at creation
(Session 7's own correction) and no separate activation-pointer
collection exists anywhere in the codebase — the exact model this
correction assumes (Option A) was already the codebase's real, current
model; no storage or Rust change was needed. MP1-MP12
(`mappingProfile.test.ts`) prove: a no-predecessor v1 is valid (MP1); a
v2 with no `supersedesProfileCode` at all is rejected (MP2); a genuine
v2->v1 is valid (MP3); a v3->v1 while v2 is missing is rejected as a gap
(MP4); a v3->v1 while v2 genuinely exists is rejected as branching off
the wrong predecessor (MP5); v1 active + v2 draft naming v1 leaves v1
effectively active (MP6); v1 active + v2 active naming v1 leaves v1
effectively superseded (MP7); a full v1/v2/v3 active chain reports
correct effective status at every link (MP8); cross-family and duplicate-
version rejection still hold under the new rule (MP9/MP10); validating
never mutates any prior version's own object (MP11); an old version's own
stored `status` field is never rewritten (MP12).

**4. `FileConnectorInput`/`FileConnectorSource` strengthened into
discriminated unions.** Both were previously a single interface with
`text?`/`bytes?` optional regardless of `fileKind`, and `stageFile()`
silently fell back to `input.text ?? ""` / `input.bytes ?? new
ArrayBuffer(0)` for a caller that got the shape wrong — an empty-content
default standing in for what should have been a compile-time error. Now
`TextFileConnectorInput` (`fileKind: "csv"|"json"|"xml"`, `text: string`)
and `XlsxFileConnectorInput` (`fileKind: "xlsx"`, `bytes: ArrayBuffer`,
`sheetName?`) are unioned into `FileConnectorInput`; the matching split
applies to `FileConnectorSource`. Both silent fallbacks are gone from
`stageFile()`/`createFileConnector()`. Compile-time acceptance
(`fileConnector.test.ts`) proves CSV/JSON/XML+`text` and XLSX+`bytes` type-
check, and CSV+`bytes`-only, XLSX+`text`-only, XLSX-without-`bytes`, and
JSON-without-`text` are each rejected by `tsc` via `@ts-expect-error` —
each directive itself fails typecheck (TS2578, unused directive) if the
case it guards ever stopped being an error, so the negative proof cannot
silently rot.

**Closure-level acceptance rebuilt around the new 3-part contract.**
`connectorEndToEnd.test.ts` gained REF1-REF11: `material_suppliers` into
`raw_materials`/`suppliers` (single-key, REQUIRED, both directions);
`finished_products.packaging_sku_code` into `packaging_bom` (composite-key
positive/negative resolution proof — no REQUIRED reference into
`packaging_bom` exists anywhere in the registry, confirmed by audit, so
this pair honestly demonstrates correct resolution rather than a hard
block); `artwork_register.label_code` into `label_content` (composite-key,
REQUIRED — a genuine hard-block proof); `doe_observations.response_code`
into `doe_factors_responses` (composite-key, REQUIRED — a second genuine
hard-block proof); `artwork_register.supersedes_artwork_code`
self-reference to an existing prior artwork (REF11). Every negative case
asserts `reference_missing` and that the row was never handed to
`commitDataExchangeRows` at all (matching the file's own established
FAIL18/J3 convention — `commitDataExchangeRows` trusts its caller and
will run a handler regardless of row state, so a bad row must stop at
preview, never reach commit) — the target collection's store length is
asserted unchanged. `DataExchangeImportDialog.test.tsx` gained four
dialog-level acceptance tests against the real production dialog, all
using `artwork_register` (the one real template with both a REQUIRED
composite-key reference and a self-reference column): A — a real
`label_code` resolves through `label_content` and commits; B — a missing
`label_code` is `reference_missing`, the commit button stays disabled, no
`label_artworks` write occurs; C — an existing self-reference resolves and
commits; D — a missing self-reference reports "does not exist" but, since
`supersedes_artwork_code` is not a `required` column, warns rather than
blocks — the real registry behavior, not the harder framing a required
self-reference column would produce (none exists in the registry today).

**Overstatement corrected.** Session 7's closure language implied "all
`code_reference` fields are fully validated" — true for existence-
checking in general, but the check silently used the wrong key for every
composite-target reference until this session. That statement is only
now genuinely true, proven by the registry-wide consistency test plus
REF1-REF11.

Full re-verification: `pnpm --filter @formulab/shared test` — 1575/1575
across 74 files (up from 1497+/73 — three new files:
`dataExchangeRegistry.consistency.test.ts`, plus expanded
`dataExchangeValidation.test.ts` 85/85 and `mappingProfile.test.ts`
32/32, plus `fileConnector.test.ts` 37/37 and `dataExchangeExisting.test.ts`
54/54). `pnpm --filter @formulab/desktop test` — 1555/1555 across 158
files (`connectorEndToEnd.test.ts` 30/30,
`DataExchangeImportDialog.test.tsx` 18/18). `typecheck`/`lint` clean both
packages. No Rust file touched this session — `cargo check`/`cargo test
masterdata` not re-run (nothing to verify). No task count change — FVL-04
remains 18/26, Total 81/171 (47.4%); this was a third hardening pass on
already-COMPLETED tasks, not new task completion.

## Hardening (Session 10/11, 2026-08-20) — FVL-04.019-.025 final closure, real adapters, conflict enforcement

An independent audit of a prior session's FVL-04.019-.025 closure found
real implementation work that fell below the original acceptance
threshold on several tasks despite being marked COMPLETED. Two sessions
of re-hardening followed; this section summarizes the resulting
architecture changes (see `docs/FORMULAB_V1_TASK_TRACKER.md`'s own
per-task rows for the full itemized correction).

**Real DB and REST adapters now exist.** `databaseConnector.ts`'s
primary contract was rewritten around `DatabaseAdapter`
(`listSchemas`/`listTables`/`describeEntity`/`readPage` — structurally no
write method); the old free-form-SQL model survives only as a clearly
separate "expert" boundary. `sqliteTestAdapter.ts` (real sql.js/WASM
SQLite) proves it end-to-end, including — Session 11 — deterministic
`ORDER BY` on every paged read (real PK order, composite PK respected in
ordinal order, `rowid` fallback when no PK exists; LIMIT/OFFSET with no
ORDER BY at all was a real correctness gap, since SQLite makes no
ordering guarantee absent one). `httpFetchAdapter.ts` is a real GET-only
`fetch()`-backed adapter (page/offset/cursor pagination, `HttpStatusError`/
`retryableForStatus()`, `sanitizeUrl()`), hardened with a configurable
client-side request timeout — deliberately `Promise.race()`-based, never
`AbortController`/`fetch`'s own `signal`: a signal constructed in one JS
realm (e.g. jsdom's own spec-compliant `AbortController`, used by
`apps/desktop`'s own test environment) silently mishandled by `fetch()`
from another realm was a real regression this session found and fixed
after it broke every REST call in the desktop test suite.

**The production Connector -> Data Exchange Bridge is real.**
`apps/desktop/src/lib/connectorImportBridge.ts`'s `prepareConnectorImport()`/
`confirmConnectorImport()` replace the prior sessions' manual
test-only pipeline chaining with one real orchestration module:
registry-driven dependency ordering with cycle detection, a disclosed
non-transactional residual boundary, crosswalk persisted only after
successful commit, and a real desktop entry point
(`ConnectorBridgeImportDialog.tsx`, wired into the existing Data Exchange
screen). Session 11 fixed `withBatchOverlay()` — its own doc comment
claimed only an earlier-committing template could satisfy a same-batch
forward reference, but the implementation checked the FULL batch
unfiltered by commit order; now tracks `earlierTemplates` explicitly as
`plan.order` is walked. Import History provenance for a connector-sourced
job no longer claims `fileType:"csv"`/fabricated `fileSize`/`sha256` — a
new `"connector"` `fileType` value and honest optional
`extractionRunId`/`connectorVersion`/`sourceEntity`/`sourceSchemaFingerprint`/
`mappingProfileVersion` fields replace it.

**Conflict classification is now enforcement, not just a label.**
`classifyReimport()`'s `CANONICAL_LOCAL_CONFLICT` was structurally
unreachable as its own distinct state (it compared the freshly re-mapped
SOURCE candidate against itself, never the LIVE canonical record) —
fixed via `loadLiveCandidateFields()` (`dataExchangeExisting.ts`), which
also closed a real gap it exposed: `material_suppliers`/
`inventory_records`/`exchange_rates` had no live-record loader at all.
Then, the bigger fix: `CANONICAL_LOCAL_CONFLICT`/`CANONICAL_MISSING`/
`MAPPING_PROFILE_CHANGED`/the new `CROSSWALK_CONFLICT` were being
CLASSIFIED but never ENFORCED — a row in one of these states could still
silently enter the normal committable path. `isRowCommittable()`
(`connectorImportBridge.ts`) is now the one deterministic
commit-eligibility authority, considering BOTH Data Exchange preview
validity and re-import/conflict safety together; every unsafe state
blocks the WHOLE batch (the SAME atomic-preflight discipline
invalid/reference_missing already used) rather than an invented
per-row partial-skip semantic. `CROSSWALK_CONFLICT` is preflighted
during `prepareConnectorImport()` itself, reusing the existing crosswalk
authority (`resolveCrosswalk()`) read-only — zero canonical/crosswalk
write before a human resolves it.

**The customer migration fixture is real.** A prior session's fixture
never used a real DB/REST-backed source, never included inventory, never
exercised a real mapping-profile version chain, and never proved a
second migration's incremental/conflict states against real data.
`apps/desktop/src/lib/customerMigrationFixture.test.ts` replaces it: a
real SQLite-backed ERP, a legacy formulation file, a real REST-backed
LIMS (real local `node:http` server), real `convert_unit`/`map_boolean`
transformations, a real v1->v2 mapping-profile chain, and a genuine
second migration proving NEW/UNCHANGED/CHANGED/SOURCE_MISSING/
CANONICAL_LOCAL_CONFLICT/CANONICAL_MISSING/CROSSWALK_CONFLICT/
MAPPING_PROFILE_CHANGED — all through the real production bridge, never
manually chained.

Full re-verification: `pnpm --filter @formulab/shared test` — 1685/1685
across 80 files. `pnpm --filter @formulab/desktop test` — 1621/1621
across 161 files. `typecheck`/`lint` clean both packages.
`python scripts/validate_v1_tracker.py`: OK. No task count change — FVL-04
remains 25/26 (FVL-04.026 correctly not started); this was a hardening
pass on already-COMPLETED tasks, not new task completion.

## Hardening (Session 12, 2026-08-20) — narrow final hardening: relational production path, crosswalk preflight/config/TOCTOU, resource-safe timeout, review-UI findings

A further narrow hardening pass, scoped explicitly to FVL-04.019-.025
only, closed several remaining real gaps.

**A real, generic relationship-assembly path exists.** The Session 10/11
relational acceptance still relied on a test-local `filter()`/manual
object merge to join a header/line source — never a reusable
mechanism. `packages/shared/src/engine/relationalAssembly.ts` is that
mechanism: `assembleRelationalRecords()` extracts header and line
entities independently through the SAME real connector (no join inside
the connector itself), deterministically joins by a configured key
pair, copies only the configured header fields onto each matched line
(never overwriting a line's own value), and reports a structured error
— never a silent drop — for an unresolvable header relationship.
`wrapAssembledSource()` presents the result as a genuine
`SourceConnector`, so the UNCHANGED `prepareConnectorImport()`/
`confirmConnectorImport()` consumes it identically to any other
source. A real production-path test (`customerMigrationFixture.test.ts`,
"FVL-04.019 Section 1") proves it end-to-end into a genuine
`Formulation`+`FormulationVersion`.

**Crosswalk conflict detection is now independent of Import History.**
The prior `CROSSWALK_CONFLICT` preflight required
`prior?.targetRecordId` — missing the real case of an active crosswalk
with zero prior Data Exchange history. `canonicalIdentityFor()`
(create_or_update templates only, honestly `undefined` for append-only
ones) now decides "what canonical identity would this row's own
natural key represent" independent of any prior row, used to detect
agreement (safe), conflict, or the crosswalk's own bound target being
gone (`CANONICAL_MISSING`). The same helper, via a new
`priorTargetStillExists()`, also fixed `CANONICAL_MISSING` itself: it
previously inferred prior-target existence from the CURRENT candidate's
own (possibly-drifted) natural key rather than decoding
`prior.targetRecordId` directly.

**Crosswalk target configuration is now part of the immutable prepared
plan.** `confirmConnectorImport()` no longer accepts an independent
crosswalk-target argument at all — `prepareConnectorImport()` decides
it, and `PreparedConnectorImport.crosswalkTargets` carries the EXACT
configuration a human reviewed. The prepare/confirm mismatch this was
meant to prevent is now structurally unrepresentable, not merely
runtime-compared.

**Confirmation revalidates against staleness (TOCTOU).**
`confirmConnectorImport()` now re-derives, immediately before
committing each template, exactly the live state its own row
classifications depended on (canonical fingerprint, crosswalk binding
— both snapshotted on the `PreparedRow` at prepare time) and refuses
the whole confirmation if either has changed since review — a
canonical record edited or deleted, or a crosswalk rebound, between
prepare and confirm is never silently re-trusted.

**REST timeout cancellation is resource-safe without reintroducing the
cross-realm regression.** The Session 11 `Promise.race()` timeout
bounded caller wait but never cancelled the underlying request.
Re-attempted a signal-based fix (including the modern
`AbortSignal.timeout()` static method) and reproduced the SAME cross-
realm failure empirically: `apps/desktop`'s jsdom test environment
installs its own spec-compliant `AbortSignal` class, and Node's global
`fetch()` rejects it outright (`TypeError: RequestInit: Expected signal
... to be an instance of AbortSignal`) on EVERY request, not just at
timeout. Fixed with an opt-in `createAbortController` factory —
`undefined` by default (every call site in this codebase today),
behaving exactly as before; a caller in a genuinely single-realm
environment (plain Node, or a real browser/Tauri webview) can supply
`() => new AbortController()` to additionally get true socket-level
cancellation, proven server-side via a real connection-close event.

**SOURCE_MISSING findings and bridge warnings are now visible in the
review UI.** `ConnectorBridgeImportDialog.tsx` computed these via the
engine but never rendered either — fixed by reusing the EXISTING
`dataExchange.import.missingFromSource(Item)` i18n keys/rendering
convention `DataExchangeImportDialog.tsx` already established, purely
informational, never blocking, never triggering any destructive
resolution.

**The "MIG1-MIG35" numbering was audited honestly, not silently
renumbered.** The original Session 9 FVL-04.025 closure commit
(`f9a2aa1`) contains zero "MIG" references anywhere in its diff, and no
committed doc/tracker row/external log entry in this repository ever
transcribed an exact original numbered list — the labels are Session
10's own invented tracking labels, not a recoverable original scheme.
`customerMigrationFixture.test.ts`'s own top-of-file comment now
documents this and maps every required CATEGORY (materials, suppliers,
links, prices, inventory, formulas/versions, lab results, crosswalk
identity, import history, transformation behavior, second migration,
no-writeback/no-LLM/no-vendor-branch/no-second-Data-Exchange) to its
real, named, executable proof.

Full re-verification: `pnpm --filter @formulab/shared test` —
1692/1692 across 81 files. `pnpm --filter @formulab/desktop test` —
1639/1639 across 161 files. `typecheck`/`lint` clean both packages.
`python scripts/validate_v1_tracker.py`: OK. `git diff --check`: clean
(LF/CRLF warnings only). No task count change — FVL-04 remains 25/26
(FVL-04.026 correctly not started); this was a hardening pass on
already-COMPLETED tasks, not new task completion.

## FVL-04 close-out — final correction of FVL-04.019-.025 (2026-08-20)

A further governing brief, after independently re-inspecting the Session
12 closure above, found six genuine remaining gaps and directed a final
narrow correction pass before FVL-04.026 could begin. Each was
independently re-verified against current code (never trusted from the
log above), fixed, and re-proven:

**1. REST timeout cancellation was still opt-in.** `createHttpFetchAdapter()`
only genuinely cancelled the underlying request when a caller supplied
`createAbortController` — the real (and only) production
adapter-creation path never did, so `Promise.race()` alone bounded the
caller's wait while the socket kept running. Fixed: cancellation is now
UNCONDITIONAL — a real `AbortController` is constructed and attached to
every request by default; if one genuinely cannot be constructed, the
adapter fails CLOSED (refuses to issue an uncancellable request) rather
than silently degrading. The one file in `apps/desktop` that exercises
real HTTP through this adapter (`customerMigrationFixture.test.ts`) now
declares `@vitest-environment node`, removing the jsdom/undici
`AbortController` realm mismatch that originally motivated the opt-in
design — that mismatch is a jsdom test-harness artifact, never a real
production condition (a Tauri webview or plain Node process has exactly
one `fetch`/`AbortController` pair, by construction). Proven by
REST-CANCEL-1 through REST-CANCEL-6 in `httpFetchAdapter.test.ts`
(`packages/shared`).

**2. The append-only crosswalk preflight had a real blind spot.**
`canonicalIdentityFor()` correctly returns `undefined` for
`append_history`/`new_revision` templates (a generated id is never
decodable from a natural key) — but the crosswalk-conflict/missing
preflight used that `undefined` as a reason to skip the check ENTIRELY
for those templates, rather than falling back to a still-safe
reconciliation reference. Fixed: for non-`create_or_update` templates,
the preflight now uses Import History's own `prior.targetRecordId` (the
real, last-committed target for this exact source identity) as the
reconciliation reference — an active crosswalk with no reconcilable
prior history blocks as `CROSSWALK_CONFLICT`; a crosswalk that disagrees
with Import History blocks as `CROSSWALK_CONFLICT`; a crosswalk that
agrees but whose target was deleted blocks as `CANONICAL_MISSING`. Proven
by the new `XW-APPEND` suite in `connectorImportBridge.test.ts` (7 new
tests: initial import, active-crosswalk reuse, changed source, crosswalk
mismatch, no-reconcilable-prior-target, missing-canonical-target,
zero-crosswalk-mutation-on-conflict).

A related metric bug was found and fixed in the same pass:
`confirmConnectorImport()`'s crosswalk-persist step counted a
`{ conflict }` return from `persistCrosswalkEntry()` (a genuine mismatch,
correctly refused with zero mutation) as a successful persist, since it
only checked `{ refused }`. `crosswalksPersisted` now correctly excludes
both.

**3. `CANONICAL_MISSING` was structurally unreachable for append-only
templates.** `priorTargetStillExists()` explicitly restricted itself to
`create_or_update` (the natural-key-indexed live-lookup map an
append-only generated id can never appear in). Fixed with a new generic
authority, `priorTargetExists(targetCollection, targetRecordId)`
(`apps/desktop/src/lib/dataExchangeExisting.ts`) — resolves existence
directly against the prior commit's own real `targetCollection`/
`targetRecordId` (captured in `data_exchange_import_row_results` for
every duplicatePolicy already), generic across every real masterdata
collection plus the file-based formulation store (`formula_bom`'s own
`"<code>#v<version>"` target shape). Proven by "CANONICAL_MISSING
semantics ... bucket 4" in `connectorImportBridge.test.ts`.

While fixing (2)/(3), a genuine pre-existing false-positive bug was
found and fixed: the candidate-side fingerprint used in
`CANONICAL_LOCAL_CONFLICT`/`CHANGED` classification was computed from
the RAW pre-validation candidate row, while the live comparison target
always reflects the VALIDATED/NORMALIZED value `commitDataExchangeRows()`
actually writes (e.g. a `decimal`/`currency`/`percentage` column's
"100.00" normalizes to "100"). Any reimport of a byte-identical decimal
value formatted differently in the source therefore misfired
`CANONICAL_LOCAL_CONFLICT`. Fixed by fingerprinting the profile's own
mapped keys with VALIDATED values (`preview.record`) on both sides,
never the raw pre-validation string, while keeping the key set
restricted to the profile's own mapped fields (never the template's full
column set, which would pull in `defaultValue` columns the live-record
loaders don't even export — a second false-mismatch source ruled out
during the same fix).

A second, distinct duplicate-row bug was found and fixed for
append-only templates specifically: the bridge never supplies
`existingNaturalKeys`/`isUnchanged` to `previewDataExchangeImport()`, so
`preview.state` is always `"valid_create"` through this path (documented
by Session 12's own TOCTOU-4) — harmless for `create_or_update` (whose
commit handlers idempotently upsert by natural key) but a genuine
duplicate-row bug for `append_history`/`new_revision` handlers, which
unconditionally INSERT every call. Fixed: `confirmConnectorImport()` now
overrides `preview.state` to `"unchanged"` for rows the bridge's OWN
`reimportState` already classifies `"UNCHANGED"`, scoped to
non-`create_or_update` templates only (so TOCTOU-4's own asserted
`"updated"` outcome for a genuinely no-op `create_or_update` reimport is
unaffected) — reusing `commitDataExchangeRows()`'s EXISTING
`state === "unchanged"` skip rather than inventing a second one.

**4. The original MIG1-MIG35 acceptance matrix, now user-supplied.** A
prior session's honest repository search (see the Session 12 section
above) found the numbering unrecoverable from evidence and substituted a
category-based matrix. This governing brief then supplied the ORIGINAL
MIG1-MIG35 list directly, as an authoritative source (not re-derived).
`customerMigrationFixture.test.ts`'s top-of-file comment now restores it
verbatim, mapping every item to an exact named executable test — MIG9
(process-parameter relationship, previously N/A — now genuinely wired
through the existing `process_parameters` Data Exchange path), MIG15 (no
name matching — new negative test), MIG18 (File Connector arbitrary
columns — new test through the full Schema Discovery -> Mapping Profile
-> Bridge -> Data Exchange chain), MIG25 (schema mismatch blocks reuse of
an old profile — new test, zero canonical writes), MIG33/MIG34/MIG35
(structural guards: no LLM reference, no vendor-specific branch, single
commit/import-history/registry authority) were previously weak, N/A, or
prose-only and now have real new executable tests; MIG14 (crosswalks are
exact-ID, never display-name, based), MIG24 (SOURCE_MISSING never
deletes), and MIG28 (a retryable REST failure leaves zero partial
commit) were strengthened in place with direct assertions on existing
tests. Session 10's own MIG36/MIG37 labels remain as clearly-marked EXTRA
hardening tests, never a redefinition of the canonical MIG1-MIG35
numbering.

**5. Production bridge UI re-audited.** `ConnectorBridgeImportDialog.tsx`
was checked against the 10-point safety checklist (explicit commit
required; blocking issues disable commit; `SOURCE_MISSING` informational
only; warnings visible; exact-name identity mapping never guesses; TOCTOU
protection automatic inside `confirmConnectorImport()`; no DB/REST
connection UI invented) and found already fully compliant — no code
change was needed.

**6. Documentation current-state contradiction fixed.**
`project-control/claude/handoffs/FORMULAB_V1_CURRENT.md`'s own "Current work package"
section opened with a stale "18/26" headline directly above a "now
genuinely 25/26" statement in the same paragraph — corrected so the
current count is unambiguous; the "18/26" figure is now explicitly
labelled as historical narrative, never erased.

Full re-verification: `pnpm --filter @formulab/shared test` —
1696/1696 across 81 files (4 new: REST-CANCEL-1/2/3/4/6 group in
`httpFetchAdapter.test.ts`). `pnpm --filter @formulab/desktop test` —
1653/1653 across 161 files (14 new: 7 in the `XW-APPEND` suite plus one
CANONICAL_MISSING bucket-4 test in `connectorImportBridge.test.ts`; 6 in
the `MIG-CANONICAL closure` describe block plus 3 in-place
strengthenings in `customerMigrationFixture.test.ts`). `typecheck`/`lint`
clean both packages. `python scripts/validate_v1_tracker.py`: OK, 171
tasks, no drift. `git diff --check`: clean (LF/CRLF warnings only). No
existing GitHub Actions workflow runs tests on push/PR (`build.yml` only
builds platform installers on a version tag or manual dispatch) — local
verification complete; independent CI not available/applicable. No task
count change from this pass alone — FVL-04 remains 25/26
(FVL-04.026 correctly not started until this pass closes); this was a
hardening pass on already-COMPLETED tasks, not new task completion.

## FVL-04.026 — Human-Readable Literature & Formulation Artifact Naming Convention (2026-08-20)

Closes FVL-04 at 26/26. Full design rationale, sanitization rules, and
the frozen filename/display-title grammar live in
`docs/ARTIFACT_NAMING_SPEC.md` — not duplicated here. Summary:

- **Audit first (B1):** the real reachable formulation export surface is
  `ExportMenu.tsx`'s 7 actions; the real literature save path is
  `runtime/pipeline/literature_cache.py`; `renderDossierPdf`/
  `renderDossierDocx` exist with no real UI caller anywhere in the repo
  (confirmed by search) — left unwired rather than force-connected to an
  invented new export UI, which would have been scope creep beyond this
  task.
- **One spec, two adapters:** `packages/shared/src/engine/artifactNaming.ts`
  (TypeScript) and `runtime/pipeline/artifact_naming.py` (Python,
  literature only). Both pass the identical golden-vector file
  (`artifactNaming.goldenVectors.json`) — proven, not asserted, by
  `test_artifact_naming.py`.
- **Wired into real production paths**, not left as a standalone
  sanitizer: `literature_cache.py::_pdf_name()` (literature) and every
  `ExportMenu.tsx` download call (formulation). Two real integration
  tests prove this — a real local-HTTP-server download test, and a real
  component test that clicks the actual export button and captures the
  actual `<a download>` value.
- **Provenance extended, not replaced:** a genuinely missing
  `content_sha256` field was added to the literature paper-dict model
  (minimal, compatible); no second document/naming registry was created
  anywhere.
- **Canonical identity untouched:** `Formulation.id`/`.code`/
  `FormulationVersion.id`/`.versionNumber` are read-only inputs to the
  naming functions, never renamed or mutated (explicit regression test).

Full re-verification: `pnpm --filter @formulab/shared test` —
1729/1729 across 82 files. `pnpm --filter @formulab/desktop test` —
full suite re-verified green. `python -m pytest runtime/pipeline` —
371/371. `typecheck`/`lint` clean both packages. `python
scripts/validate_v1_tracker.py`: OK, 171 tasks, no drift.

**FVL-04 is now 26/26. Total 89/171.** FVL-05 and the Connector
Management frontend were NOT started this session.
