# Connector Management Frontend

The first real end-user UI over the FVL-04 connector architecture
(`docs/FVL04_EXTERNAL_SOURCE_CONNECTOR_ARCHITECTURE.md`). This document
covers the FRONTEND only — every capability it exposes (schema discovery,
mapping, transformation, crosswalk, incremental conflict classification,
prepare/confirm) is an EXISTING engine, never reimplemented here.

## Information architecture

Mounted as a new section inside the EXISTING Data Exchange Center
(`apps/desktop/src/app/routes/DataExchangePage.tsx`), never a second,
disconnected workspace:

```
Data Exchange Center
  Template Library | Exports | Imports | Connectors | Validation | Import History | Schema Versions | Help
```

**Connectors** (`ConnectorManagementShell.tsx`) owns its own internal
tab bar:

```
Connections | Source Explorer | Mapping Profiles | Crosswalks | Import Runs | Conflicts / Review
```

Selecting a connection in **Connections** carries it forward as
context for **Source Explorer**/**Mapping Profiles**/**Conflicts /
Review** — one shared piece of UI state (`ConnectorManagementShell`'s
own `selected`), never re-fetched or re-derived per tab.

The existing per-template "via Bridge" button in **Imports** (backed by
`ConnectorBridgeImportDialog.tsx`) is retained unchanged — this frontend
supersedes the need to *discover* connector functionality through it,
but does not remove it.

## Connection types

Exactly the three the engine defines (`CONNECTOR_TYPES`,
`schemas/connector.ts`): **FILE**, **DATABASE**, **REST_API**. No other
type is ever offered.

A **Connection** (`ConnectorConnection`, new — see "Persistence" below)
is a saved, reusable CONFIGURATION, never a live connector instance and
never a credential. `connectionRef` is the only field that may represent
authentication, always an opaque reference string resolved to a real
credential entirely outside this record — the same boundary
`RestConnectorDeps.fetchPage`/`DatabaseConnectorDeps.adapter` already
establish for every real connector call. No password/API key/bearer
token/connection string is ever persisted by this UI.

### FILE

Fully real. `apps/desktop/src/lib/connectorFileInspect.ts` wraps the
existing `createFileConnector()`/`discoverSourceSchema()` — CSV/JSON/XML/
XLSX, XLSX sheet selection via `discoverEntities()`. A FILE connection's
own saved configuration (name, file kind, id field) is deliberately
separate from "the file currently being inspected" — the physical bytes
are never persisted; each Source Explorer/Prepare Import session re-reads
whatever file the operator selects that session.

### REST_API

Fully real. `apps/desktop/src/lib/connectorTest.ts::testRestConnection()`
and the Prepare Import flow both build a real `SourceConnector` via
`createHttpFetchAdapter()`/`createRestApiConnector()` — the SAME adapters
`connectorImportBridge.ts` itself uses — through the pure config mapper
`packages/shared/src/engine/connectorConnection.ts`. GET-only,
structurally: no field on `ConnectorConnection`, `AddConnectionDialog.tsx`,
or `httpFetchConfigFromConnection()` can express a write method (proven
by `ConnectorManagement.architecture.test.ts`'s write-method-literal
sweep).

### DATABASE — current limitation, disclosed

Configuration-only. **No production `DatabaseAdapter` implementation
exists anywhere in this desktop app.** The `DatabaseAdapter` contract
(`packages/shared/src/engine/databaseConnector.ts`) is real and
exhaustively tested, but its only real implementation,
`sqliteTestAdapter.ts`, is explicitly documented as test/acceptance
infrastructure that "must never be wired into a real customer
connection." Building a genuine multi-driver SQL connectivity layer
(ODBC/native drivers from the Tauri/Rust side) is a real, substantial
backend capability this frontend-productization pass did not build —
doing so was judged out of proportion for this session and is called
out here honestly rather than faked.

`testDatabaseConnection()` therefore always returns a real, honest
non-success result ("No database driver is available in this build
yet...") — never a simulated success. The connection's own
configuration (name, driver, host, port, database, schema, table,
connectionRef) is still genuinely saved, ready for a future session that
wires a real driver.

## Persistence — `connector_connections` (new)

The one genuinely new persisted collection this session added, for the
one genuinely missing authority (`docs/FORMULAB_V1_TASK_TRACKER.md`'s
own audit found no existing "saved connection" model at all):

- Schema: `connectorConnectionSchema` (`packages/shared/src/schemas/connector.ts`).
- Masterdata registration: `("connector_connections", false)` in
  `masterdata.rs`'s `COLLECTIONS` (mutable — unlike `mapping_profiles`'
  immutable version chain, editing a connection's own host/path
  configuration in place is ordinary maintenance).
- Policy area: `dataExchange` (`masterdataPolicyAreas.ts`) — the SAME
  privilege gate as `mapping_profiles`/`external_id_crosswalks`; no new
  permission was invented.
- Desktop bindings: `apps/desktop/src/lib/connectorConnections.ts`
  (list/save/duplicate/archive/delete — delete is refused in the UI for
  any connection with real committed import history,
  `importRunCountFor()`).

No other new collection was created. Mapping profiles, crosswalks, and
import history all read/write through the EXISTING
`mapping_profiles`/`external_id_crosswalks`/`data_exchange_import_jobs`/
`data_exchange_import_row_results` collections and their existing
authorities (`connectorPersistence.ts`, `connectorImportBridge.ts`).

## Source Explorer

Renders ONLY what the real engines already returned — `discoverSourceSchema()`'s
`SourceSchema` (fields/types/nullability/identity evidence/relationship
hints) and the real `StagedSourceRecord[]` a connector's own `extract()`
produced. No second, React-local schema-discovery algorithm exists
anywhere in this UI. The Identity panel shows the real
`identity.idSource` ("configured" vs. "ordinal") and, when ordinal,
the same warning the engine itself would act on: an ordinal identity can
never be persisted as a crosswalk (`persistCrosswalkEntry()`'s own
structural refusal).

## Mapping Profiles

`MappingProfilesScreen.tsx` reads the EXISTING `mapping_profiles`
collection (`loadMappingProfiles()`) and derives the active/superseded
fact via the EXISTING `effectiveMappingProfileStatus()` — never
recomputed in React. `MappingProfileEditorDialog.tsx` builds
`FieldMapping[]` rows in the exact shape `applyMappingProfile()` already
consumes; "Match exact names" only ever performs case-insensitive exact
matching (no fuzzy/semantic guessing anywhere); "Validate Mapping" calls
the REAL `validateMappingProfile()` against the schema the editor was
opened with. A schema-fingerprint mismatch is rendered as a blocking
`[schema_fingerprint_mismatch]` issue from the real validator — the UI
never overrides or hides it.

Saving always produces a NEW version (`profileVersion + 1`,
`supersedesProfileCode` set to the prior version's own `code`) through
the EXISTING `saveMappingProfile()` — the immutable v1←v2←v3 chain is
enforced by the storage layer itself (`mapping_profiles` is append-only
in `masterdata.rs`), never by UI discipline alone.

## Crosswalks

`CrosswalksScreen.tsx` is READ-ONLY, deliberately — there is no
supported manual mutation operation in the real persistence authority
(`persistCrosswalkEntry()` only ever writes after a successful Data
Exchange commit), so no "Edit binding" action exists anywhere in this
UI. Filters over source system/entity/id and canonical entity/id; a
detail view shows the exact stored tuple.

## Prepare / Review / Commit

`PrepareReviewScreen.tsx` builds a real `SourceConnector` from the
selected connection (the SAME config adapters `connectorTest.ts` uses)
and calls the REAL `prepareConnectorImport()`/`confirmConnectorImport()`
(`apps/desktop/src/lib/connectorImportBridge.ts`) — no stage of that
pipeline is reimplemented in React. Only the exact
`PreparedConnectorImport` object `prepareConnectorImport()` returned may
ever be passed to `confirmConnectorImport()`; the UI never reconstructs
a prepared plan from its own state.

Conflict rows render the EXACT engine vocabulary
(`CANONICAL_LOCAL_CONFLICT`/`CANONICAL_MISSING`/`CROSSWALK_CONFLICT`/
`MAPPING_PROFILE_CHANGED`/`SCHEMA_CHANGED`) — never a paraphrased
synonym. No "force import"/automatic-merge action exists anywhere;
a blocking row's only offered next step is "correct the underlying
mapping/crosswalk/source configuration and prepare again."
`SOURCE_MISSING` findings are rendered informationally, explicitly
labelled "No canonical record will be deleted automatically" — because
`prepareConnectorImport()` itself never deletes anything (it is a pure,
non-writing planning function).

Commit is disabled whenever `prepared.blockingIssues.length > 0` — the
SAME `blockingIssues` array the engine itself computed, never a
second eligibility rule. A stale prepared plan (something reviewed
changed before confirm ran) is rejected by `confirmConnectorImport()`'s
own TOCTOU check; the UI surfaces that structured error and clears the
prepared plan, requiring an explicit fresh Prepare Import — never a
silent retry.

## Import Runs

`ImportRunsScreen.tsx` reads the EXISTING `data_exchange_import_jobs`/
`data_exchange_import_row_results` collections, scoped to
connector-sourced jobs (`fileType === "connector"`) so it never
duplicates the EXISTING plain-CSV "Import History" section elsewhere in
Data Exchange. No second Import History store exists.

## Authorization

No new permission system. `ConnectorManagementShell` receives the SAME
`actorRole`/`actorUserId` `DataExchangePage.tsx` already resolves
(`useTrustedActor()`, falling back to the existing role selector) and
threads it into `confirmConnectorImport()`'s own `ctx` exactly like
`ConnectorBridgeImportDialog.tsx`/`DataExchangeImportDialog.tsx`
already do — the backend (`commitDataExchangeRows()`'s own role checks)
remains the authoritative gate; this frontend never weakens or
duplicates it.

## i18n

All new user-facing strings live under `dataExchange.connectors.*`
(`session.json`) plus one new `common.actions.close` key, added to all
8 shipped locales (English source, Turkish translated for real, the
remaining five locales carry the English text as an explicit
established-convention placeholder — see `i18n/parity.test.ts`, which
enforces exact key-set parity across every locale).

## Security boundaries (Section 26 sweep)

- No REST source write method (GET-only, structurally — no field can
  express POST/PUT/PATCH/DELETE).
- No plaintext secret persisted or rendered by this UI —
  `connectionRef` is the only auth-adjacent field, always an opaque
  reference.
- No `eval`/`new Function`, no LLM SDK/API reference anywhere in this
  surface.
- No vendor/customer-specific production branch.
- No direct canonical write from any connector UI component — the only
  write path is `confirmConnectorImport()` → the existing
  `commitDataExchangeRows()`.
- No second Import History or Crosswalk collection.

All proven structurally by `ConnectorManagement.architecture.test.ts`,
not merely asserted in prose.

## Current limitations (honest, not designed away)

- **DATABASE connections cannot genuinely connect** — no production
  driver exists yet (see above). Configuration-only.
- The Mapping Profile editor supports direct/constant field mappings
  with manual source-field entry; a live "match against last-discovered
  schema" convenience (`sourceFieldOptions`) is wired but optional —
  the editor does not yet require or auto-populate from a specific
  discovery session's schema across every entry path.
- Crosswalk-target configuration in Prepare Import supports one
  canonical entity per primary target template (the common single-target
  case every FVL-04 fixture in this repository actually uses) — a
  profile that fans out into multiple target templates does not yet get
  a per-template crosswalk-target UI.
- `renderDossierPdf`/`renderDossierDocx`
  (`apps/desktop/src/lib/documentExports/`) remain unwired to any real
  UI caller anywhere in the app (pre-existing, not introduced or fixed
  by this session) — out of scope for a connector-frontend
  productization pass.

## Not changed by this session

FVL-04 tracker state is unchanged: **26/26, Total 89/171.** FVL-05 was
not started. No new top-level work package (no "FVL-04.027", no
"FVL-12") was invented for this frontend work.
