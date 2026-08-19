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
| Generic file connector | `packages/shared/src/engine/fileConnector.ts` | CSV (reuses `importer.ts`'s `parseCsv`), JSON, XML staging |
| XLSX multi-sheet reader | `apps/desktop/src/lib/xlsx.ts` (`readWorkbookAllSheets`) | Each sheet its own source entity |
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
