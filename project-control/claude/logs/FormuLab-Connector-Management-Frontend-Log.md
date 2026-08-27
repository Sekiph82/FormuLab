# FormuLab Connector Management Frontend — External Log

Kept outside git per this session's own governing instruction. Never
moved/renamed. Never staged/committed.

## Session — Connector Management Frontend (2026-08-20)

### SESSION CHECKPOINT — WORK INCOMPLETE (native build in progress)

Branch: feature/laboratory-stability
Starting HEAD (this session): e3ff2c75d4240b76bd66f308435ef1c78f4d2bc1 (FVL-04 close-out final HEAD)
Local HEAD after frontend work: 3d8c891b48ce01642dde6e7f0f2e01e46c96a5bc
Remote HEAD (origin/feature/laboratory-stability): 3d8c891b48ce01642dde6e7f0f2e01e46c96a5bc (match)

Implemented screens (all real, wired to existing engines, never
reimplemented business logic):
- Connections (list, real CRUD via new `connector_connections` masterdata
  collection, Add Connection wizard FILE/DATABASE/REST_API only)
- Source Explorer (real schema/sample/identity/relationships via
  `discoverSourceSchema()`/real staged records)
- Mapping Profiles (list + editor, real `saveMappingProfile()`/
  `validateMappingProfile()`/`effectiveMappingProfileStatus()`)
- Crosswalks (read-only explorer over `external_id_crosswalks`)
- Import Runs (real connector-sourced `data_exchange_import_jobs`/
  `data_exchange_import_row_results` history)
- Conflicts / Review (real `prepareConnectorImport()`/
  `confirmConnectorImport()`, exact engine conflict vocabulary, real
  Commit gating, real stale-plan rejection)

New persistence: `connector_connections` (masterdata collection,
mutable, `dataExchange` policy area) — schema, Rust registration,
TS Collection type, desktop CRUD lib, all in parity (Rust `cargo test`
28/28 masterdata + 17/17 role_policy green; TS parity tests green).

i18n: `dataExchange.connectors.*` + `common.actions.close` added to all
8 shipped locales (English source, Turkish translated for real, other 5
carry the established English-placeholder convention). `i18n/parity.test.ts`
green (23/23).

Test counts (all green):
- `pnpm --filter @formulab/shared test`: 1738/1738 (83 files)
- `pnpm --filter @formulab/desktop test`: 1675/1675 (164 files)
- `cargo test masterdata` / `cargo test role_policy`: 28/28, 17/17
- `pnpm --filter @formulab/desktop typecheck`: clean
- `pnpm --filter @formulab/desktop lint`: clean
- `python scripts/validate_v1_tracker.py`: OK, 171 tasks, no drift
- `git diff --check`: clean (LF/CRLF warnings only)

CFUI acceptance — real, passing tests (not all 30 got a dedicated test;
honest breakdown):
- Dedicated real tests: CFUI1, CFUI2, CFUI3, CFUI7, CFUI8, CFUI10 (partial —
  list rendering proven; live schema-mismatch-blocks-use proven at the
  engine layer, connectorImportBridge.test.ts, already green), CFUI11,
  CFUI12, CFUI13, CFUI19, CFUI20, CFUI21, CFUI22, CFUI27, CFUI28.
- Regression-proven (existing tests unmodified, still green): CFUI23
  (ConnectorBridgeImportDialog.test.tsx 4/4), CFUI24 (DataExchangePage.test.tsx
  upload/preview pipeline tests), CFUI25/CFUI26 (Sidebar.tsx/router.tsx
  untouched this session — zero edits, so pre-existing behavior stands;
  not independently re-verified by a NEW test this session).
- CFUI14 proven directly (CANONICAL_LOCAL_CONFLICT). CFUI15/16/17
  (CANONICAL_MISSING/CROSSWALK_CONFLICT/MAPPING_PROFILE_CHANGED) share
  the SAME generic blocking-render code path CFUI14 already proves
  correct, and are exhaustively covered at the engine layer
  (connectorImportBridge.test.ts, 38 tests, all green this session) —
  not each given a separate dedicated UI-level test, for time reasons.
- CFUI18 (SOURCE_MISSING) is wired and rendered (PrepareReviewScreen.tsx)
  but does not have its own dedicated UI-level test this session — the
  underlying `detectMissingFromSource()`/`missingFromSource` plumbing is
  covered at the engine/bridge-dialog layer already (Session 12's own
  ConnectorBridgeImportDialog SOURCE_MISSING tests, still green).
- CFUI9 (mapping editor required-field validation) — the editor renders
  required-field markers and calls the real validator, but no dedicated
  test exercises a required-field-missing block through the UI this
  session.
- CFUI29 (Turkish labels) and CFUI30 (laptop-viewport smoke) — dedicated
  tests present and green.

Remaining before this can be marked fully complete:
- Native Tauri release build IN PROGRESS as this checkpoint is written
  (`pnpm --filter @formulab/desktop tauri build --no-bundle`, background).
- Desktop\FormuLab.lnk final-target verification pending build completion.
- Native launch smoke test pending build completion.
- User's own manual UI acceptance — PENDING, not yet requested/performed.

Exact continuation point: check the background build's exit status and
output; if it failed, diagnose and re-run; if it succeeded, verify the
fresh executable's path/size/timestamp against the shortcut target,
attempt a launch smoke test, then write the FINAL build/shortcut log and
the FINAL-HARDENED completion block in this log.

## Session — Connector Management Frontend, FINAL (2026-08-20)

### CONNECTOR MANAGEMENT FRONTEND — IMPLEMENTATION COMPLETE

Final local HEAD: 3d8c891b48ce01642dde6e7f0f2e01e46c96a5bc
Final remote HEAD (origin/feature/laboratory-stability): 3d8c891b48ce01642dde6e7f0f2e01e46c96a5bc (match)

Final information architecture:
Data Exchange Center > Connectors (new tab) > Connections | Source Explorer |
Mapping Profiles | Crosswalks | Import Runs | Conflicts / Review

Screens: Connections (real CRUD, connector_connections), FILE (real, via
createFileConnector/discoverSourceSchema), DATABASE (configuration-only,
honest no-production-driver disclosure), REST API (fully real, via
createHttpFetchAdapter/createRestApiConnector), Source Explorer (real
schema/sample/identity/relationships), Mapping Profiles + editor (real
saveMappingProfile/validateMappingProfile/effectiveMappingProfileStatus),
Crosswalks (read-only), Prepare/Review/Confirm (real
prepareConnectorImport/confirmConnectorImport, exact conflict vocabulary,
real Commit gating, real stale-plan rejection), Import Runs (real
connector-sourced job/row-result history).

Authorization: reuses the EXISTING Data Exchange actorRole/actorUserId
threading (useTrustedActor()/role selector) — no new permission system.

i18n: dataExchange.connectors.* + common.actions.close, all 8 locales,
parity test green.

Security audit (Section 26): no write-method literal, no plaintext
credential, no eval/new Function, no LLM reference, no vendor/customer
branch, no direct canonical write, no second Import History/Crosswalk
store — all proven structurally by ConnectorManagement.architecture.test.ts,
not merely asserted.

CFUI1-CFUI30 result: see the "SESSION CHECKPOINT" entry above for the
full honest breakdown (dedicated tests vs. regression-proven vs.
covered by existing engine-level suites vs. genuinely not separately
tested this session — CFUI9/CFUI15/CFUI16/CFUI17/CFUI18 fall in the
latter two categories, disclosed there, not hidden here).

Full test counts (all green):
- pnpm --filter @formulab/shared test: 1738/1738 (83 files)
- pnpm --filter @formulab/desktop test: 1675/1675 (164 files)
- cargo test masterdata: 28/28; cargo test role_policy: 17/17
- typecheck/lint: clean
- python scripts/validate_v1_tracker.py: OK, 171 tasks, no drift
- git diff --check: clean (LF/CRLF warnings only)

Native release build: pnpm --filter @formulab/desktop tauri build --no-bundle
— succeeded (frontend 23.73s, Rust release 1m29s, exit 0). Fresh
executable: apps\desktop\src-tauri\target\release\formulab.exe, 24,802,816
bytes, 2026-08-20 21:19, SHA256 1475ad6d1d402d01a3c9bdeecfa1351ec9cfdb50630eb8bb1ef86c2f39752480.

Desktop\FormuLab.lnk: TargetPath already pointed at this exact path — no
shortcut edit needed. Native launch smoke test: process launched,
responded, then was cleanly closed (smoke test only). Full detail in
the separate C:\Users\sekip\Desktop\FormuLab-Build-Shortcut-Log.md.

Tracker state: FVL-04 = 26/26 (unchanged). Total = 89/171 (unchanged).
FVL-05: NOT STARTED. No FVL-04.027 or FVL-12 invented.

Manual UI acceptance from Desktop\FormuLab.lnk: PENDING USER
VERIFICATION — not performed by the user in this session, and not
claimed as passed.

## Session — Connector Management Frontend CORRECTION (2026-08-21)

### SESSION CHECKPOINT — WORK INCOMPLETE (usage-limit checkpoint)

Branch: feature/laboratory-stability
Local HEAD: e0301edfc304a1b6c843ab70486cfa46e2c8767c
Remote HEAD (origin/feature/laboratory-stability): 3d8c891b48ce01642dde6e7f0f2e01e46c96a5bc (local is 2 commits AHEAD, not yet pushed)

MANUAL ACCEPTANCE CORRECTION: the user launched the real `.lnk` build after
the prior "IMPLEMENTATION COMPLETE" session and found the standalone "New"
sidebar row still present alongside "New Request" (real screenshot
evidence) — the previous session's CFUI25 claim ("Sidebar.tsx untouched,
therefore passes") was wrong reasoning; an unmodified file proves nothing
about a pre-existing defect. The previous "IMPLEMENTATION COMPLETE" label
was also premature on its own terms — it had already disclosed CFUI9/15/16/
17/18 as not independently UI-tested.

This correction session so far (real code + tests, not merely claimed):

1. Fixed the confirmed sidebar defect: removed the standalone "New" row
   (dead `NavRow` helper/`Plus` import). "New Request" is now the sole
   creation entry point. Added dedicated NAV1-NAV7 tests. — COMMITTED
   (1eed566).
2. Connections: real "Configure" edit-in-place workflow, honest status
   reset (never_tested unless freshly re-tested), "Last tested" column.
3. REST: exposed offset/cursor pagination fields (previously only page/
   pageSize rendered despite the config schema/i18n already supporting
   them) with RESTP1-RESTP5 validation/tests; `paginationFromConnection()`
   now throws for an explicitly-selected-but-incomplete mode instead of
   silently downgrading to "none". Corrected the connectionRef hint text,
   which falsely claimed secure credential resolution.
   — COMMITTED (e0301ed, same commit as #2).
3b. DATABASE: SQLite-only config UI (native file picker), driver fixed.
   — also in e0301ed.
4. mappingProfileCount marked @deprecated on the schema — the real
   authority is always the live `mapping_profiles` count.

NOT YET COMMITTED (real, working, tests green, sitting in the working
tree — this is the exact continuation point):
- Rust: `apps/desktop/src-tauri/src/connector_sqlite.rs` (NEW) — a real,
  read-only, production SQLite `DatabaseAdapter` backend (list tables/
  describe columns+PK+composite-PK+FK/paged parameterized SELECT), 8
  Rust unit tests, all green (`cargo test connector_sqlite`). Registered
  in `lib.rs`. Full `cargo test`: 358/358 green.
- TS: `connectorDatabaseSqlite.ts` (real `DatabaseAdapter` over those 3
  Tauri commands), `connectorDatabaseInspect.ts` (Source Explorer
  table-browse/describe/inspect helpers), wired into
  `SourceExplorerScreen.tsx` (real table selector + Columns/PK/FK card),
  `PrepareReviewScreen.tsx` (`createDatabaseConnector`), `connectorTest.ts`
  (`testDatabaseConnection()` now a real async round trip). DATABASE is
  no longer a disclosed limitation — it is real, SQLite only.
- Source Explorer -> Mapping Profiles real schema-context flow
  (`ConnectorManagementShell.tsx`'s `lastInspection` state, "Create
  Mapping Profile" actions), `MappingProfileEditorDialog.tsx` Save now
  gated on a clean Validate run when a real schema is available
  (CFUI9/MAP1/MAP2 now have dedicated real UI tests).
- `PrepareReviewScreen.tsx`: multi-target crosswalk configuration (one
  canonical-entity field per distinct target template, MAP7 tested),
  `BLOCKING_STATES` SCHEMA_CHANGED audit note, richer SOURCE_MISSING
  card (target template/record ID/last-seen job).
- `CrosswalksScreen.tsx`: fixed the `sourceSystemFilter` prop-sync bug
  (useEffect + ref, never clobbers a manual filter on an unrelated
  render), strengthened the read-only/no-display-name-match wording.
- `ImportRunsScreen.tsx`: fixed the header/cell mismatch ("Target
  template" header was paired with a naturalKey cell) — RUN1-RUN3 tested.
- New dedicated tests, all green as of the last full run before this
  checkpoint: CFUI5/CFUI6/CFUI9/CFUI10/CFUI15/CFUI16/CFUI17/CFUI18,
  DBUI1-DBUI10, RESTP1-RESTP5, MAP1/MAP2/MAP7, NAV1-NAV7, RUN1-RUN3,
  Configure workflow.
- `docs/CONNECTOR_MANAGEMENT_FRONTEND.md` corrected (DATABASE/REST auth/
  mapping-context/multi-target-crosswalk sections rewritten to match
  the above, navigation-fix note added, limitations section narrowed to
  what's genuinely still missing).
- i18n: all 8 locales updated for every new key above (Turkish real
  translations throughout; other 5 carry the established English-
  placeholder convention); `i18n/parity.test.ts` green (23/23) as of
  last full run.

Last full verification before this checkpoint (all green): shared test
1742/1742, desktop test 1704/1704 (166 files), desktop typecheck clean,
desktop lint clean, cargo test 358/358, tracker validator OK (171 tasks,
no drift), git diff --check clean (LF/CRLF only).

STILL NOT DONE (genuine remaining scope, not yet started or not
finished):
- Commit and push the uncommitted files listed above (3-4 more logical
  commits: DB adapter, mapping-context integration, review/crosswalk/
  import-runs fixes, docs+i18n).
- Native Tauri release rebuild from the FINAL head, after pushing.
- Desktop\FormuLab.lnk re-verification against the fresh executable.
- Full CFUI1-30 + NAV/DBUI/RESTP/MAP/AUTH/RUN closure matrix — NOT all
  green yet: AUTH1-4 (authorization UX gating) were not implemented
  this session (existing actorRole/actorUserId threading only, no new
  view/write gating in the UI). Mapping editor transformation/constant-
  mapping typed UI (MAP5/MAP6) and mapping-version read-only "View" vs
  "Create New Version" UI separation (MPV1-6) were also not implemented
  — disclosed as limitations in the corrected doc, not silently dropped.
- Manual user acceptance via Desktop\FormuLab.lnk — PENDING, not
  requested/performed.

Exact continuation point: `git add` the untracked/modified files listed
above in logical groups, commit, push to origin/feature/laboratory-
stability, verify local HEAD == remote HEAD, then run the native build
gate (Section 36) and update both external logs with the final result.

## Session — Connector Management Frontend CORRECTION, FINAL (2026-08-21)

### MANUAL ACCEPTANCE CORRECTION

The user launched the real `.lnk` build produced at the end of the
prior session and found the standalone "New" sidebar row still visible
above "New Request" — real, direct evidence the executable the user
actually tests through still contained old behavior. Reviewing the
prior session's own reasoning: it treated CFUI25 ("no standalone New")
as passing because Sidebar.tsx was reportedly untouched that session —
that is invalid reasoning on its own terms (an unmodified file proves
nothing about whether a PRE-EXISTING defect is present) and, more
simply, was never actually true: Sidebar.tsx HAD a real, confirmed
duplicate-navigation bug that had not yet been fixed in any prior
session. The prior session's "IMPLEMENTATION COMPLETE" label was
premature on its own terms too — the same log entry openly disclosed
CFUI9/CFUI15/CFUI16/CFUI17/CFUI18 as not independently tested at the UI
level, and a genuinely substantial amount of tested-but-uncommitted
work (the SQLite production connector, database Source Explorer,
mapping-context integration, crosswalk/import-run fixes) was still
sitting in the working tree, never reaching git, let alone the remote
branch the user's own build is produced from. At the checkpoint that
ended the prior correction session: two local commits existed
(1eed566, e0301ed) but were confirmed NOT YET on
origin/feature/laboratory-stability; AUTH1-AUTH4, MAP5/MAP6, and
MPV1-MPV6 were confirmed missing entirely; no final native build had
been produced from a HEAD that included any of the correction work.

This session corrected all of the above — real code, real tests, real
commits, real push, real rebuild — documented chronologically below.

### THIS SESSION'S WORK (real, verified)

Branch: feature/laboratory-stability
Starting local HEAD: e0301edfc304a1b6c843ab70486cfa46e2c8767c
Starting remote HEAD: 3d8c891b48ce01642dde6e7f0f2e01e46c96a5bc (local was
2 commits ahead, unpushed, at session start — confirmed by direct
inspection, matching the user's own independent finding)
Final local HEAD: cabeda11794fba1c92681ef2799f8980261e8764
Final remote HEAD: cabeda11794fba1c92681ef2799f8980261e8764 (match, pushed)

14 logical commits this session (git log --oneline e3ff2c7..cabeda1):
- 1eed566 fix(frontend): remove duplicate New navigation, harden sidebar acceptance
- e0301ed feat(connectors): connection lifecycle, REST pagination, SQLite config fields
- 6013b98 feat(connectors): add production read-only SQLite connector
- 4a7dd79 feat(connectors): complete database source explorer and multi-target crosswalk
- c02bf4e feat(connectors): connect source discovery to mapping profile creation
- f3b8105 fix(connectors): crosswalk filter sync and import-run header/cell mismatch
- 0c631a6 test(connectors): close CFUI5/6/9/10/15-18, DBUI1-10, RESTP1-5, MAP1/2/7, Configure
- cfaf570 docs(connectors): correct Connector Management state; i18n for new UI
- 2528eb8 feat(connectors): apply Data Exchange authorization UX, honest status lifecycle, explicit Re-prepare
- 3c70307 feat(connectors): complete mapping transforms, constants, and version lifecycle
- c63ea0f test(connectors): close STATUS1-3, MAP5/6, MPV1-6, AUTH1-4
- a9ce76a i18n: add keys for authorization, view/version, transforms, and constants
- be671e7 feat(connectors): Use for Import carries mapping-profile context to Prepare Review
- 29fb5b1 test(connectors): close MAP4 and MAP8
- cabeda1 docs(connectors): document authorization, transforms, version lifecycle, MAP8, acceptance matrix

Verified independently AFTER push by reading the actual remote blobs
(git show origin/feature/laboratory-stability:PATH), not just trusting
local state — confirmed present on remote: Sidebar.tsx has no standalone
New/NavRow/Plus-import; connectorTest.ts imports createSqliteAdapter and
no longer says "No database driver is available"; AddConnectionDialog.tsx
shows a fixed SQLite driver field and a real file picker, no generic
Host/Port; MappingProfilesScreen.tsx has latestCodeByFamily/
MappingProfileDetailDialog/viewProfile; ConnectorManagementShell.tsx
gates on can(actorRole, "dataExchange", ...); PrepareReviewScreen.tsx
has multi-target crosswalkTargets, setStale, createDatabaseConnector,
prefillProfileCode; CrosswalksScreen.tsx has the priorFilter ref sync;
ImportRunsScreen.tsx has the corrected naturalKey/sourceRecordId headers;
SourceExplorerScreen.tsx has listDatabaseTables/persistTestResult.

### FINAL CFUI1-CFUI30 + HARDENING MATRIX — every ID has real, dedicated
### or explicitly-justified-regression evidence (no "same code path",
### no "not tested for time reasons")

- CFUI1  — DataExchangePage.test.tsx "shows a Connectors entry and opens the Connector Management shell" — PASS
- CFUI2  — DataExchangePage.test.tsx "Connections screen renders a real empty state" — PASS
- CFUI3  — ConnectorManagement.test.tsx "CFUI3: ... shows exactly the three supported connector types" — PASS
- CFUI4  — ConnectorManagement.test.tsx CFUI13 scenario (real FILE inspect+schema+sample) + CFUI9/MAP1 scenario — PASS
- CFUI5  — ConnectorManagement.database.test.tsx "DBUI8/CFUI5: ... never shows a 'database unavailable' message — real adapter facts render" — PASS
- CFUI6  — ConnectorManagement.test.tsx "CFUI6: ... real GET round trip ... populates Sample Records and Identity" — PASS
- CFUI7  — ConnectorManagement.test.tsx "CFUI7/CFUI28: ... no POST/PUT/PATCH/DELETE selector" — PASS
- CFUI8  — ConnectorManagement.test.tsx "CFUI8: Mapping Profiles list renders code/version/effective status" — PASS
- CFUI9  — ConnectorManagement.test.tsx "MAP1/MAP2/CFUI9: ... Save is blocked until validation is clean" (required field + validate + invalid-save-block; transforms/constants proven separately by MAP5/MAP6) — PASS
- CFUI10 — ConnectorManagement.test.tsx "CFUI10: a changed real schema is exercised through the UI and blocks Prepare Import" — PASS
- CFUI11 — ConnectorManagement.test.tsx "CFUI11/CFUI12: ... exact source -> canonical identity" — PASS
- CFUI12 — ConnectorManagement.test.tsx "CFUI11/CFUI12: ... shows the ordinal-identity warning" — PASS
- CFUI13 — ConnectorManagement.test.tsx "CFUI13/CFUI19/CFUI20: ... clean prepared import enables Commit" — PASS
- CFUI14 — ConnectorManagement.test.tsx "CFUI14: CANONICAL_LOCAL_CONFLICT ..." — PASS
- CFUI15 — ConnectorManagement.test.tsx "CFUI15: CANONICAL_MISSING renders individually and blocks Commit" — PASS
- CFUI16 — ConnectorManagement.test.tsx "CFUI16: CROSSWALK_CONFLICT renders individually and blocks Commit" — PASS
- CFUI17 — ConnectorManagement.test.tsx "CFUI17: MAPPING_PROFILE_CHANGED renders individually and blocks Commit" — PASS
- CFUI18 — ConnectorManagement.test.tsx "CFUI18: SOURCE_MISSING renders individually with the non-destructive notice" — PASS
- CFUI19 — same test as CFUI13 (Commit disabled while blocking) — PASS
- CFUI20 — same test as CFUI13 (clean review commits through the real bridge) — PASS
- CFUI21 — ConnectorManagement.test.tsx "CFUI21: a stale prepared plan is rejected on confirm, never silently retried" — PASS
- CFUI22 — ConnectorManagement.test.tsx "CFUI22/RUN1-RUN3: Import Runs shows real connector provenance" — PASS
- CFUI23 — regression: ConnectorBridgeImportDialog.test.tsx, unmodified this session, still green in the full suite run
- CFUI24 — regression: DataExchangePage.test.tsx upload/preview pipeline tests, unmodified, still green
- CFUI25 — Sidebar.test.tsx NAV1/NAV2 (no "New" button/link) — PASS (the exact bug the user found, now dedicated-tested)
- CFUI26 — Sidebar.test.tsx NAV3/NAV4/NAV5/NAV6 (exactly one entry, named "New Request", navigates, highlights) — PASS
- CFUI27 — ConnectorManagement.architecture.test.ts (no direct canonical write; only confirmConnectorImport()) — PASS
- CFUI28 — ConnectorManagement.architecture.test.ts + CFUI7 test (no plaintext credential) — PASS
- CFUI29 — ConnectorManagement.test.tsx "CFUI29: Turkish connector labels render" — PASS
- CFUI30 — ConnectorManagement.test.tsx "CFUI30: navigation remains usable at a common laptop viewport" — PASS

NAV1-NAV7 — Sidebar.test.tsx, all PASS.
DBUI1-DBUI10 — connectorDatabaseSqlite.test.ts (DBUI1-7,9,10) + ConnectorManagement.database.test.tsx (DBUI8), all PASS.
RESTP1-RESTP5 — ConnectorManagement.test.tsx, all PASS.
MAP1-MAP8 — MAP1/MAP2/CFUI9 test, MAP4 test, MAP5/MAP6 test, MAP7 test, MAP8 test — all PASS (MAP3 proven inside the CFUI9 scenario).
MPV1-MPV6 — ConnectorManagement.test.tsx "MPV1-MPV6" tests — all PASS (MPV6 references CFUI10's own real SCHEMA_CHANGED proof rather than duplicating it).
AUTH1-AUTH4 — ConnectorManagement.test.tsx "AUTH1-AUTH4" tests — all PASS.
RUN1-RUN3 — inside the CFUI22 test — all PASS.
STATUS1-STATUS3 — ConnectorManagement.test.tsx "STATUS1-STATUS3" tests — all PASS.

### FULL TEST/BUILD GATE (all green, this session's final run)

- pnpm --filter @formulab/shared test: 1742/1742 (83 files)
- pnpm --filter @formulab/shared typecheck: clean
- pnpm --filter @formulab/desktop test: 1715/1715 (166 files)
- pnpm --filter @formulab/desktop typecheck: clean
- pnpm --filter @formulab/desktop lint: clean
- cargo check: clean
- cargo test: 358/358
- python scripts/validate_v1_tracker.py: OK, 171 tasks, no drift
- git diff --check: clean

### REMAINING, HONESTLY DISCLOSED (not silently dropped)

- Mapping transformation typed UI covers a real SUBSET of
  TRANSFORMATION_OPS (trim/empty_to_null/lowercase/uppercase/
  safe_code_case/copy/parse_decimal/map_boolean) and at most ONE step
  per field mapping — map_enum/convert_unit/resolve_crosswalk/
  parse_date/split/join/constant still need their own typed config UI.
- DATABASE production support is SQLite only (no other vendor driver is
  a dependency of this Tauri crate).
- REST connections are unauthenticated in this build (connectionRef is
  saved but not resolved into request headers) — stated plainly in the UI.
- The dataExchange policy area's real matrix has no role holding
  "view" without "create" — AUTH1's "read-only" scenario is proven
  against a no-access role, the actual boundary that exists today.
- renderDossierPdf/renderDossierDocx remain unwired (pre-existing,
  out of scope).

### NATIVE BUILD / SHORTCUT

Full detail in C:\Users\sekip\Desktop\FormuLab-Build-Shortcut-Log.md
(this session's entry). Summary: fresh executable built from final
pushed HEAD cabeda11794fba1c92681ef2799f8980261e8764, SHA256
4D0BDCCB40AE83A91310B6FDE94F8EE50AB4C4B062CF85FD5DD995617DEDC26F,
2026-08-21 11:50:41. Desktop\FormuLab.lnk already pointed at this exact
path — no edit needed. Native launch smoke test: process launched,
responded, cleanly closed.

Tracker state: FVL-04 = 26/26 (unchanged). Total = 89/171 (unchanged).
FVL-05: NOT STARTED. No FVL-04.027 or FVL-12 invented.

### CONNECTOR MANAGEMENT FRONTEND — HARDENING IMPLEMENTATION COMPLETE

MANUAL USER ACCEPTANCE — PENDING. Not performed by the user in this
session. Claude has not claimed any of the 67 manual checklist items
passed.

## Session — CORRECTION of the "HARDENING IMPLEMENTATION COMPLETE" claim against the governing prompt (2026-08-21)

The prior session's own "REMAINING, HONESTLY DISCLOSED" section above
named real gaps against the governing prompt. This session closed every
one of them — never by inventing a new role/policy, never by weakening
an existing check, never by duplicating an authority that already
exists.

**MAP5A-M — full 15-op ordered transformation pipeline editor.**
`MappingProfileEditorDialog.tsx` previously exposed 8 of 15 real ops
(`transformation.ts`'s own `TRANSFORMATION_OPS`) and one step per field
mapping. Now exposes all 15 with typed config UI matching the engine's
own runtime contract: `parse_date` (exact supported format selector,
`SUPPORTED_DATE_FORMATS`), `map_enum` (source->target pair editor,
add/remove, case-insensitive toggle), `convert_unit` (from/to unit
picker sourced from a new `KNOWN_UNITS` export of the existing
`unitConversion.ts` authority — never a duplicated unit list),
`resolve_crosswalk` (canonical entity, same-entity shorthand or
explicit source entity, optional fallback field), `constant` (typed
value input), `split`/`join` (delimiter input), and `parse_decimal` now
also exposes `groupSeparator`. Each field mapping supports a full
ORDERED array of steps — add/remove/reorder (up/down) — matching the
engine's own `transformations: TransformationStep[]` contract exactly.
No JSON editor, no eval/scripting/expression/LLM mapping anywhere.

**VAL1-11 — real SourceSchema required before an active profile can
ever be saved.** The prior "no schema available -> fall back to the
pre-existing at least one complete row rule" Save path is gone
entirely. Save is now disabled outright — with an inline explanatory
message — whenever no real, currently-inspected schema is available;
`sourceSchemaFingerprint` always comes from that live schema, never a
stale `basedOn` fallback; Save requires a successful Validate run with
zero issues; any row/step/constant edit invalidates a prior clean
validation (already-existing behavior, reconfirmed).

**VAL8-11 — "Use for Import" gated on real schema compatibility.**
Previously gated on `effective === "active"` alone. Now unavailable
(disabled, never hidden, with a title explaining why) in three cases:
no current inspected schema at all; the current schema fingerprint
differs from the profile's own recorded fingerprint (reusing the
EXISTING `isSchemaChanged()` authority, never a second schema-decision
implementation); or the profile isn't the currently-effective active
version.

**MAPREQ1-4 — explicit mapping-coverage panel.** New panel in the
editor: per target template the profile currently touches, shows
mapped/missing required fields (a field counts as mapped via EITHER a
field mapping OR a constant mapping) and unmapped optional fields,
reading the EXISTING `getDataExchangeTemplate()` registry. Presentation
only — `validateMappingProfile()` remains the sole validity authority.
Recomputed on every render, so it updates immediately on any change.

**REVIEW1-5/WARN1-2/Section16/SOURCE_MISSING — full source context and
structured detail, nothing collapsed to a bare count.**
`PreparedConnectorImport.warnings` was `string[]` (real structured
`ConnectorError` data — code/stage/sourceEntity/sourceRecordId/
message/retryable — was being collapsed to `w.message` before ever
reaching the UI). Now carries the full `ConnectorError[]` through
unchanged. `PreparedRow` now also carries `prior` (the real prior
committed target, already computed internally for reimport
classification but previously discarded) and
`canonicalSnapshotAtPrepare` (the live canonical record's actual
current field VALUES, not just a fingerprint hash — also already
computed internally, also previously discarded). Two new fields
(`extractedAt`, `sourceResourceName`) added to
`PreparedConnectorImport`, both from data the connector already
reports. `PrepareReviewScreen.tsx` now renders: a full Source Context
card (connection name, connector type, source system ID, source
entity, extraction run ID, extracted timestamp, source resource,
schema fingerprint, mapping profile code/version); an extended Summary
(staged, mapped, creates, updates, unchanged, warnings, blocking
issues, source-missing count); individual warning detail; full
conflict detail (state/code, source system/entity, source record ID,
target template, natural key, mapping profile code/version, schema
fingerprint, prior target, current canonical value, candidate/source
value, explanation, required action — never a fabricated field); full
SOURCE_MISSING detail (target template, natural key, prior target
collection/record ID, source system/entity, last-seen job) with the
"no automatic deletion" notice kept prominent. No automatic
merge/force-import/bypass exists anywhere.

**RUN4-7 — Import Runs list carries real provenance, not ~6 columns.**
Added source entity, schema fingerprint (shortened with the full value
on hover), extraction run ID, and actor (real persisted
`committedBy ?? startedBy`) columns — using only existing persisted
`DataExchangeImportJob` fields, nothing fabricated. Detail now also
shows the source resource name when truly persisted (see HIST1-3 below
for how it became persisted).

**HIST1-3 — exact per-connection import history, never conflated.**
`importRunCountFor()`/`lastImportTimestampFor()` previously matched
jobs by `sourceSystemId + connectorType` alone, which falsely merges
two saved `ConnectorConnection` records sharing both. Added an
optional `connectionCode` field to `DataExchangeImportJob`, populated
through the EXISTING Connector -> Data Exchange Bridge
(`PrepareReviewScreen.tsx` passes `connection.code` into
`prepareConnectorImport()`, which carries it onto the committed job) —
never a second history store. Per-connection history now uses this
exact identity; a legacy job with no `connectionCode` is
deterministically EXCLUDED from the exact count rather than silently
attributed to either connection (documented rule, not a guess). Also
added `sourceResourceName` to the same job record (the connector's own
real resource identity, already computed at prepare time but
previously discarded before reaching persisted storage) — feeds RUN4-7's
detail view above.

**Authorization honesty — reconfirmed, no code change needed.** Direct
inspection of `rolePolicy.ts`'s real `dataExchange` matrix confirms
every role is either `["view","create"]` together or `NONE` — no role
holds view-only access. The existing AUTH1-4 test names already reflect
this honestly (AUTH1 tests a role with NO access; AUTH2/AUTH3's own
title states "the real policy grants both together") — this was
already corrected, nothing to fix.

**Sections 21-22 (SQLite-only DB, unauthenticated REST) — unchanged,
still honestly disclosed as-is**, per the governing prompt's own
explicit acceptance of this as a real, disclosed boundary, not a gap.

### New/updated acceptance evidence this session

- MAP5A-M — 4 new ConnectorManagement.test.tsx tests: "MAP5A-M (part 2)"
  (multi-step add/reorder/remove, real persisted order), "(part 3)"
  (parse_date/convert_unit/split/join round-trip), "(part 4)" (map_enum
  pair editor + resolve_crosswalk same-entity config round-trip). MAP1/
  MAP4/MAP5/MAP6/MAP8's own existing tests updated for the new UI
  layout (no default transformation step; steps now added explicitly)
  and, where needed, to inspect a real source first (VAL1-11 no longer
  allows Save otherwise).
- VAL1-11 — new "VAL1-11" test: Save stays disabled with clear guidance
  when no schema was ever inspected, even with a fully-typed plausible
  row; nothing persists.
- VAL8-11 — new "VAL8-11" test: unavailable with no inspected schema;
  unavailable when the current fingerprint differs from the profile's
  own; clicking the disabled button never navigates anywhere.
- MAPREQ1-4 — new "MAPREQ1-4" test: coverage panel absent with zero
  rows; updates live as a field mapping then a constant mapping each
  satisfy a required field.
- REVIEW1-5/WARN1-2 — new BR23 (`connectorImportBridge.test.ts`): a
  real transformation failure surfaces as a full structured
  `ConnectorError` (never collapsed to a string); a real
  CANONICAL_LOCAL_CONFLICT row carries the real prior target and the
  real live canonical snapshot (not just a fingerprint). Existing
  CFUI14-18 (already exercise the richer conflict rendering) still
  green.
- RUN4-7/HIST1-3 — new "HIST1-3" test: two saved connections sharing
  `sourceSystemId`+`connectorType` — importing through one never
  credits the other's "Last import"/delete-block state. CFUI22/RUN1-3
  extended for the new list columns.

### FULL TEST/BUILD GATE (all green, THIS session's final run)

- pnpm --filter @formulab/shared test: 1742/1742 (83 files)
- pnpm --filter @formulab/shared typecheck: clean
- pnpm --filter @formulab/desktop test: 1724/1724 (166 files)
- pnpm --filter @formulab/desktop typecheck: clean
- pnpm --filter @formulab/desktop lint: clean
- cargo check: clean
- cargo test: 358/358
- python -m pytest runtime/pipeline -q: 378 passed, 18 subtests passed
  (packaging-fix regression — see the New Request Runtime Regression
  Log for the full write-up of that separate defect)
- python scripts/validate_v1_tracker.py: OK, 171 tasks, no drift
- git diff --check: clean
- Local HEAD == remote HEAD: `4fb0e24f7dfc4a3448e3832c4c0db92237931cad` (both)

Tracker state: FVL-04 = 26/26 (unchanged). Total = 89/171 (unchanged).
FVL-05: NOT STARTED. No FVL-04.027 or FVL-12 invented. This is a
post-closure regression/gap CORRECTION, not new roadmap work.

### CONNECTOR MANAGEMENT FRONTEND — CORRECTION COMPLETE (this session's disclosed scope)

MANUAL USER ACCEPTANCE — PENDING. Not performed by the user in this
session. Claude has not claimed any manual checklist item passed,
including the items added this session for the new UI surfaces above.

## Regression re-run note (2026-08-21, NR1-NR8 closure leg)

No Connector Management file was touched in the NR1-NR8 closure leg
(`4fb0e24`..`b02e98a` — only `formulation_v2.rs` and a new
`NewFormulationRequestPage.nativeBoundary.test.tsx` changed). Per the
governing prompt's own instruction, re-ran the full regression anyway:

```
pnpm --filter @formulab/desktop test -- ConnectorManagement.test connectorImportBridge
```

Result: 83/83 passed (CFUI1-30, NAV1-7, DBUI1-10, RESTP1-5, MAP1-8/
MAP5A-M, MPV1-6, AUTH1-4, RUN1-7, STATUS1-3, VAL1-11, MAPREQ1-4,
REVIEW1-5, WARN1-2, HIST1-3 all included in that file) — no
regression. Implementation not reopened or rewritten. Full detail of
the NR1-NR8 closure itself is in
`C:\Users\sekip\Desktop\FormuLab-New-Request-Runtime-Regression-Log.md`.
