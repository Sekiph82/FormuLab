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
| Transformation | `packages/shared/src/engine/transformation.ts` | Declarative ops only, no scripting language |
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

- `mapping_profiles` (mutable — a `draft` profile may be edited before
  it's ever applied; a materially changed mapping is a new
  `profileVersion` row by application-layer discipline, not by storage
  immutability).
- `external_id_crosswalks` (mutable — `lastSeenAt` updates in place on
  re-import; `firstSeenAt`/`canonicalRecordId` never change once set,
  enforced by `crosswalk.ts`'s own conflict detection, not by storage).

No SQLite side database, no ad hoc JSON file outside the existing
masterdata architecture. Raw customer payloads are never persisted
beyond ephemeral in-memory staging for one connector run.
