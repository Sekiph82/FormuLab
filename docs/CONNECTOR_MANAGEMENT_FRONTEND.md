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

**Navigation correction (Section 2)**: the main sidebar previously had a
fixed standalone "New" row (`Plus` icon, navigating to
`/formulation-request`) ABOVE the scrolling nav list, duplicating the
existing "New Request" entry already inside `navItems` at the same
route — a real, confirmed defect (native screenshot evidence). The
standalone row and its now-dead `NavRow` helper/`Plus` import were
removed; "New Request" is the sole formulation-request creation entry
point. `Sidebar.test.tsx` carries dedicated NAV1-NAV7 acceptance for
this exact defect.

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
sweep). Pagination (`none`/`page`/`offset`/`cursor`) each expose their
own required fields in the UI; an explicitly selected mode with an
incomplete configuration is a blocking error (Save/Test disabled) — it is
never silently downgraded to `none` (`paginationFromConnection()` throws
rather than falling back).

`testRestConnection()`'s one-page round trip returns the real staged
`ConnectorResult`, not just a record count — Source Explorer renders REST
Sample Records/Identity through the SAME generic cards FILE uses, never a
count-only summary.

**Authentication is honestly unauthenticated in this build.**
`connectionRef` is saved but this build does not resolve it into request
headers anywhere — `httpFetchConfigFromConnection()` never sets
`HttpFetchAdapterConfig.headers`. The UI states this plainly (`Connection
reference` field hint, and an explicit `REST authentication: unauthenticated`
notice in Add Connection) rather than claiming a secure resolver that does
not exist. A future session that wires a real credential resolver should
populate `headers` there and correct this note.

### DATABASE — SQLite, the one genuinely production-supported driver

Real, not configuration-only. **SQLite is the minimum production-safe
`DatabaseAdapter` implementation this build ships**
(`apps/desktop/src-tauri/src/connector_sqlite.rs`, three Tauri commands:
`connector_sqlite_list_tables`/`connector_sqlite_describe_table`/
`connector_sqlite_read_page`), wired to the frontend via
`apps/desktop/src/lib/connectorDatabaseSqlite.ts`'s `createSqliteAdapter()`
— a genuine implementation of the SAME `DatabaseAdapter` contract
(`packages/shared/src/engine/databaseConnector.ts`) FILE/REST already
prove real through `createFileConnector()`/`createRestApiConnector()`.
`sqliteTestAdapter.ts` (sql.js/WASM, in-memory) remains test/acceptance
infrastructure only — untouched, never imported by any production path.

Read-only, structurally, several ways: the file is opened with
`SQLITE_OPEN_READ_ONLY` (SQLite itself refuses any write at the driver
level); the three registered commands only ever issue `PRAGMA`
introspection or a parameterized `SELECT` — no write/DDL command exists
or is registered; every table/column identifier used in a query is first
checked against that exact database's own real introspection result
(a whitelist), never taken from caller input and dropped into SQL text
unchecked.

A connection's `database` field holds the absolute local `.sqlite`/`.db`
file path (never a credential — chosen via the native file dialog,
`pick_file(["sqlite","db","sqlite3"])`, the same picker FILE connections
already use); `driver` is always `"sqlite"`, fixed, never a free-text or
selectable field — no host/port/username/password fields are shown,
because none exist for a local file. `testDatabaseConnection()` performs
a real round trip (open + list tables) and reports the real result,
success or failure, never simulated. Source Explorer's DATABASE branch
lists real tables/views, describes real PK/composite-PK/FK/declared-type/
nullable column metadata, and reads a real bounded sample page — the
SAME adapter Prepare Import itself uses via `createDatabaseConnector()`.

No other database vendor's driver is a dependency of this Tauri crate —
the UI never offers a driver this adapter cannot genuinely back.

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
- **Configure**: `ConnectionsScreen.tsx`'s "Configure" action reopens
  `AddConnectionDialog.tsx` in edit mode (`editing` prop) — preloaded
  with the connection's current values, `code`/`createdAt`/`createdBy`
  preserved, connector type fixed (never silently switchable). Saving
  without a fresh Test Connection during that same edit session resets
  `status` to `never_tested` (clearing `lastTestedAt`/`lastTestMessage`)
  rather than risk carrying forward a stale "ready" for configuration
  nobody actually re-verified. `Connections` also shows real "Last
  tested" (`lastTestedAt`) alongside "Last import", not just the latter.
- `ConnectorConnection.mappingProfileCount` is `@deprecated` in the
  schema — always `0` at creation, never updated. The ONLY authority for
  a connection's mapping-profile count is `mappingProfileCountFor()`,
  derived live from the real `mapping_profiles` collection every time;
  no UI reads the persisted field for business truth.

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

**Source Explorer's real discovered schema flows into Mapping Profiles**
(`ConnectorManagementShell.tsx`'s own `lastInspection` state, scoped to
the currently selected connection — transient UI state only, never a
second persistence store). A successful inspection's "Create Mapping
Profile" action switches to the Mapping tab with that real schema,
`sourceFieldOptions`, and a prefilled `sourceEntity` already flowing into
the editor — never requiring the operator to retype an entity blind. When
a real schema IS available, Save is gated on a successful Validate run
reporting zero issues (rule: validate-clean-to-save); when no inspection
has been run for this connection yet (still possible — Mapping Profiles
is reachable independently of Source Explorer), Save falls back to the
pre-existing "at least one complete mapping row" rule rather than
becoming permanently unusable.

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

Crosswalk-target configuration supports EVERY distinct target template a
Mapping Profile's own `fieldMappings` actually reaches — one canonical-
entity input per template, not just the first — building the real
`crosswalkTargets` object for all of them at prepare time.

Review renders the full real per-row conflict vocabulary: blocking rows
(`CANONICAL_LOCAL_CONFLICT`/`CANONICAL_MISSING`/`CROSSWALK_CONFLICT`/
`MAPPING_PROFILE_CHANGED`) each show their real `reimportState`, target
template, natural key, and source record identity. `SCHEMA_CHANGED` is a
whole-batch-level finding (the profile's own `sourceSchemaFingerprint`
disagreeing with the current source) surfaced through `blockingIssues`
directly — it is included in the UI's local `BLOCKING_STATES` set for
exhaustive typed correctness even though it can never appear as an
individual row's `reimportState` (a schema mismatch aborts the whole
batch before any row is classified). `SOURCE_MISSING` findings render
their real `naturalKey`/target template/target record ID/last-seen job,
always with the explicit "No canonical record will be deleted
automatically" notice — `prepareConnectorImport()` is a pure, non-writing
planning function.

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

- **DATABASE production support is SQLite only.** No other vendor
  driver (PostgreSQL/MySQL/SQL Server/Oracle/ODBC/...) is a dependency
  of this Tauri crate — the UI never offers a driver it cannot back.
- **REST connections are unauthenticated.** `connectionRef` is saved but
  this build does not resolve it into request headers anywhere — see
  the REST_API section above. Stated plainly in the UI, not hidden.
- The Mapping Profile editor supports direct field mappings with manual
  or exact-name-matched source-field entry, and now (Section 11) real
  schema/entity context flowing from Source Explorer. It does NOT yet
  expose a typed UI for constant mappings or the transformation
  pipeline (`trim`/`parse_decimal`/`map_enum`/`convert_unit`/...) —
  those remain readable/round-trippable on an existing profile's own
  `constantMappings`/`transformations` fields (never dropped on save),
  but there is no dedicated form to author them yet.
- Mapping Profile version history has no dedicated read-only "View"
  screen distinct from the editor — opening an existing profile's code
  or clicking "Create New Version" both open the same editor dialog
  (which always saves as a NEW version, per the immutable v1←v2←v3
  chain enforced by storage itself); there is no separate, explicitly
  read-only historical-version viewer yet.
- No new authorization UX gating exists beyond the EXISTING
  `actorRole`/`actorUserId` threading into `confirmConnectorImport()` —
  a view-only role still sees write controls in this UI (the backend's
  own role checks remain the real, unweakened gate; this is a frontend
  UX gap, not a security gap).
- `renderDossierPdf`/`renderDossierDocx`
  (`apps/desktop/src/lib/documentExports/`) remain unwired to any real
  UI caller anywhere in the app (pre-existing, not introduced or fixed
  by this session) — out of scope for a connector-frontend
  productization pass.

## Not changed by this session

FVL-04 tracker state is unchanged: **26/26, Total 89/171.** FVL-05 was
not started. No new top-level work package (no "FVL-04.027", no
"FVL-12") was invented for this frontend work.
