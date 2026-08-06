# Phase 11 — Backup, Restore and Data Safety

## Status: PHASE 11 FULLY CLOSED. Stage 1 (Sessions 0-5, assessment through diagnostics, plus its Closure and Verification session) complete. Stage 2 (Sessions 7-9: automatic backups, Data Location Manager, update checker, plus its own Closure and Verification session) complete — full desktop suite genuinely 130/130 files, 1185/1185 tests passing, no isolated/known-flake caveat remaining.

## Priority order for Phase 11 (as given, unchanged)

**First stage** (this phase's scope): backup and restore, backup
verification, schema migration system, active data-location
clarification, basic diagnostics and log export.

**Second stage** (deferred, not designed beyond dependency notes):
automatic backups, Data Location Manager, update checker.

**Commercial-distribution stage** (deferred, not designed at all):
signed installers/updates, automatic rollback.

## Session 0 summary

Pure assessment and planning — no application code changed, no real
data touched, no destructive or generative operation run. Full findings
live in four dedicated architecture/inventory documents (below); this
handoff summarizes and points to them, per this repository's existing
"one summary, details in the dedicated doc" convention.

### Key finding: the storage layer is more layered than it first appears
Three independent root-pointer files
(`formulab-root.txt`/`base-workspace.txt`/`active-workspace.txt`, all
under `app_data_dir()/runtime/`) feed two distinct resolution functions
(`formulation_v2::project_root()` for all real user data;
`workspace::workspace_dir()`/`base_workspace_dir()` for the kernel/
provenance/run-log surface). No module resolves a path independently of
these two functions — confirmed by grep across every file in
`apps/desktop/src-tauri/src` — but the two-funnel design itself, plus
`formulab-root.txt` having no writer or exposing UI command anywhere in
the codebase, means Settings can silently display the wrong root
relative to where formulations/master-data actually live. Full detail:
[`docs/PHASE11_DATA_INVENTORY.md`](../PHASE11_DATA_INVENTORY.md).

### Key finding: a real migration mechanism already exists, unused
`packages/shared/src/engine/migrations.ts` (documented in
`docs/MIGRATIONS.md`) is a working, tested, per-collection migration
runner — registered against **zero** collections today, because every
one of the 90 master collections has only ever shipped at
`schemaVersion: "1.0"`. Session 3 extends this mechanism (journal,
pre-migration verified backup requirement, future-version rejection,
global version marker) rather than building a second one. Full detail:
[`docs/PHASE11_MIGRATION_ARCHITECTURE.md`](../PHASE11_MIGRATION_ARCHITECTURE.md).

### Key finding: two real git-tracking anomalies, recorded not fixed
`.gitignore` marks `/data/` and `/formulas/` as "local user output,
deliberately not committed," yet `formulas/*.md` + `formulas/index.json`
and `.FormuLab/runs.db` are all tracked in git (pre-dating or bypassing
that rule — `.gitignore` never retroactively untracks a file). `runs.db`
being tracked is doubly unusual since its own module documents it as a
disposable, rebuildable index. Neither was touched or corrected this
session (out of scope; Session 0 does not modify working-tree state).

### Key finding: one real, evidenced secret-handling risk for backup design
The LLM API key is stored in plaintext `localStorage`
(`formulab.v2.key.<provider>`), which lives inside the WebView2 profile
(`%APPDATA%\com.formulab.app\EBWebView`). A naive file-level backup of
`app_data_dir()` would sweep this up; the backup architecture excludes
`EBWebView` entirely, both because it is a regenerable runtime cache and
specifically to keep this key out of any backup package. Full detail:
[`docs/PHASE11_BACKUP_RESTORE_ARCHITECTURE.md`](../PHASE11_BACKUP_RESTORE_ARCHITECTURE.md).

### Key finding: no crash-dump, no diagnostics command, no build-id today
Confirmed by grep: zero matches for Sentry/crash-report/panic-hook/
ErrorBoundary anywhere in `apps/desktop/src`. The only persistent app
log is `debug.log` (unrotated, uncapped, free-text). Session 5's
diagnostics design is scoped to what can honestly be built on top of
this today, not a crash reporter. Full detail:
[`docs/PHASE11_DIAGNOSTICS_ARCHITECTURE.md`](../PHASE11_DIAGNOSTICS_ARCHITECTURE.md).

### Test plan
[`docs/PHASE11_TEST_MATRIX.md`](../PHASE11_TEST_MATRIX.md) — per-session
focused-test plan for Sessions 1-5, against this repo's real confirmed
test conventions (`vitest run` via `pnpm --filter`, inline `#[cfg(test)]`
Rust modules). No full-suite run happens until a future closure session.

## What was explicitly not done this session

- No backup, restore, migration, diagnostics, automatic-backup, Data
  Location Manager, update-checking, signing, or rollback code was
  written.
- No real data (`.FormuLab/runs.db`, any real user record, anything
  under `%APPDATA%\com.formulab.app`, `OneDrive\Documents\FormuLab`, or
  any other production data root) was moved, copied, merged, deleted,
  repaired, or normalized.
- No full desktop/shared/Rust suite, typecheck, lint, or build was run —
  only lightweight read-only inspection.
- No historical Phase 0-10 handoff or log was modified.

## Deferred items (recorded, not designed beyond noting dependencies)

- **Second stage**: automatic backups (depends on Session 1's backup
  mechanism existing first), Data Location Manager (depends on Session
  4's active-data-location clarification existing first — a manager UI
  needs a single reconciled root-resolution story to manage), update
  checker (independent of the rest, no dependency found).
- **Commercial distribution stage**: signed installers/updates (would
  depend on a release-build/CI pipeline this session did not inspect —
  out of scope), automatic rollback (depends on the restore mechanism
  from Session 1 existing and proving reliable first).

## Inspection commands run this session

See each architecture/inventory doc's own "Method"/"evidenced" citations
for the exact `Read`/`Grep`/`Glob`/`git` commands that informed it —
recorded once per document rather than duplicated here.

## Session 1 summary — backup and restore foundation (complete)

- **New Rust module**: `apps/desktop/src-tauri/src/backup.rs`. New
  dependencies: `zip` (the `.formulab-backup` ZIP container) and `fs4`
  (free-disk-space check), both disclosed in the Session 0 plan before
  being added. Registered in `lib.rs` with a new `BackupState` (a
  cancellation flag, same `Mutex<Option<Arc<AtomicBool>>>` pattern
  `AdvancedOptimizerState` already uses) and six new commands:
  `create_backup`, `cancel_backup`, `pick_backup_destination`,
  `inspect_backup`, `restore_backup`, `cancel_restore`.
- **Inclusion, exactly as planned in Session 0**: `data/formulations/**`,
  `data/master/*.json` (top-level files only — `data/master/backups/` is
  structurally never walked, not just filtered), `data/sessions/**`,
  `formulas/**`, `.FormuLab/{runs.jsonl,remote-runs.jsonl,
  provenance.jsonl,logs/*.txt}` (workspace root), `.FormuLab/compute.json`
  (base root).
- **`data/literature` decision, made this session**: excluded by default.
  Confirmed by reading `runtime/pipeline/literature_cache.py` again —
  it stores `pdfs/<doi>.pdf`, open-access papers fetched from public
  sources and cached by DOI, re-fetchable through ordinary use, not
  user-authored. When the directory exists and holds files, the manifest
  records an explicit warning naming exactly why it was skipped, so a
  user is never left silently unaware.
- **Exclusions enforced structurally, not by a denylist filter**:
  `.FormuLab/runs.db` is never referenced by any inclusion-scanning code
  path in `backup.rs` at all (a dedicated Rust test,
  `excluded_labels_name_runs_db_and_ebwebview_explicitly`, guards the
  documented exclusion list itself). `EBWebView`/`localStorage` (the
  plaintext per-provider API key) is outside this crate's filesystem
  reach by construction — never a path this module can walk.
- **Manifest**: format version, app version (`env!("CARGO_PKG_VERSION")`
  at build time, not a runtime read of `tauri.conf.json`), created-at,
  a `dataRoot` identifier (project/workspace/base root paths plus
  whether `formulab-root.txt`/an active-workspace override is in play),
  best-effort per-collection `schemaVersion` read from each collection's
  first row, full file inventory (path/bytes/SHA256), included/excluded
  lists, warnings, and compatibility bounds.
- **Backup creation**: scans → disk-space check (`fs4::available_space`,
  required = total bytes + 10% margin) → hashes every file → writes to
  `<destination>.tmp` → self-check (reopens the just-written archive and
  confirms the manifest round-trips) → atomic rename to the final name.
  Any failure after the `.tmp` file exists removes it before returning.
  Progress (`backup-progress` event) and cancellation (checked between
  every file, both during hashing and during writing) are real, not
  cosmetic — a cancelled run cleans up its `.tmp` file exactly like a
  failed one.
- **Restore**: reads the manifest, rejects the whole archive on any
  unsafe entry (path traversal, absolute/drive-letter paths, a symlink
  mode bit, or any entry the archive-to-live path mapper doesn't
  recognize — an allow-list, not a denylist), creates a **real**
  `.formulab-backup` safety package of the current data first (via the
  same `try_create_backup` internals), stages every file into a private
  directory while verifying size + SHA256 + (for `.json` entries) that
  it actually parses, then activates by renaming each live file aside
  before copying the staged one into place — any activation failure
  rolls every touched file back from its aside copy and reports the
  safety backup's path. Root-pointer files
  (`formulab-root.txt`/`base-workspace.txt`/`active-workspace.txt`) are
  never read from or written by restore — it only ever resolves and
  writes into *this machine's own* current root.
- **UI**: `components/settings/BackupRecoveryCard.tsx`, mounted in
  Settings → General (`SettingsPage.tsx`), reusing the existing
  `Section` chrome. States: idle (Create/Restore buttons) → creating
  (live progress + cancel) → done (file count/size + warnings) / failed;
  restore adds an inspect step and an explicit, non-dismissable-by-
  accident confirmation panel (manifest summary + warnings) before a
  destructive restore can start.
- **i18n**: full genuine translation across all 8 shipped locales
  (`settings.backup.*` in `settings.json`; `settings.sections.0`/
  `settings.warnings.0` extended in `help.json`) — no English-fallback
  placeholders, matching this project's established convention.
- **Help**: the existing `settings` help topic
  (`apps/desktop/src/lib/help/registry.ts`) was extended in place — one
  `sections.0` string updated to mention Backup and Recovery, one new
  `warningKeys` entry added — no second help topic created, matching the
  Phase 10 Session 1A precedent of extending an existing topic over
  adding a parallel one.
- **Tests**: 5 new Rust tests in `backup.rs` (exclusion labels present,
  unsafe-path rejection, archive-path allow-list rejection, schema-
  version extraction, a full synthetic backup-then-scan round trip) —
  full Rust suite re-run, 88/88 passing. 12 new
  `BackupRecoveryCard.test.tsx` tests (idle/creating/progress/done/
  failed for both backup and restore, cancelled-returns-to-idle,
  cancel-out-of-confirmation, inspect-failure) — all passing. i18n
  parity (23 tests) and the help registry suite (38 tests) both re-run
  green. Desktop typecheck and lint both clean.
- **Known limitations** (explicitly out of scope this session, per the
  session brief): no backup history list, no standalone verify-without-
  restoring mode (Session 2), no automatic/scheduled backups. Restore's
  "structural check" is JSON-parses-cleanly only — a full per-schema Zod
  pass lives on the TypeScript side and isn't run from this Rust-only
  foundation; recorded as a real limitation, not silently assumed
  equivalent. `data/master/backups/`'s existing ad hoc pre-delete
  snapshot mechanism was left exactly as-is, not merged into the new
  system.

## Session 2 summary — backup verification (complete)

- **No second parser**: verification reuses the exact manifest-reading and
  per-entry safety logic restore already had. Refactored `backup.rs` to
  extract `open_zip`/`read_manifest_from_archive`/`entry_safety_violation`
  as shared functions, then rewired `try_restore_backup`, `inspect_backup`,
  and `try_create_backup`'s own self-check to all call them — one
  definition of "open a package," "read its manifest," and "is this entry
  safe," not three.
- **`verify_backup_report(source: &Path) -> VerificationReport`**: takes
  only a `&Path` — no `AppHandle` at all — so it structurally cannot call
  `resolve_roots()`/`project_root()`/`workspace_dir()`. "Verification must
  never modify the active data root" is true by the function's own type
  signature, not an added guard someone could forget. A dedicated test
  (`verify_never_touches_the_filesystem_outside_the_given_archive`) also
  confirms the source file's bytes are byte-identical before and after.
- **Five statuses, precedence `Unsafe > Corrupted > Incompatible >
  ValidWithWarnings > Valid`**: every check runs (not short-circuited)
  after the manifest is readable, collecting every issue found; the worst
  tier reached becomes the report's single `status`. Corruption
  (`archive_unreadable`/`manifest_unreadable`/`missing_file`/
  `size_mismatch`/`hash_mismatch`/`malformed_json`) and incompatibility
  (`unsupported_backup_format_version`/`unsupported_app_version`/
  `unsupported_schema_version`) are disjoint code sets, never blended
  into one status.
- **Real finding during implementation**: the `zip` crate's own
  `ZipWriter` refuses to write two entries sharing a name (errors at
  `start_file`, confirmed directly — see
  `duplicate_names_in_a_raw_name_list_are_detected`) — so a duplicate-path
  archive is not producible via this project's own writer at all.
  Duplicate detection is still implemented (a pure `duplicate_names()`
  function, defense in depth against a hand-crafted or differently-tooled
  archive) and unit-tested directly, but the full end-to-end "open a real
  duplicate-path package" scenario is not something this codebase can
  construct to test — documented rather than silently skipped.
- **Version compatibility**: a minimal `major.minor.patch` comparator
  (`parse_simple_version`/`version_in_range`) checks the current build's
  `CARGO_PKG_VERSION` against the manifest's declared
  `compatibility.min/max`, and every `schema_versions` entry against the
  one schema version this build supports — both real checks, even though
  every version in existence today is still `"1.0"`/`"0.4.0"`.
- **`.FormuLab/runs.db` presence**: a dedicated `runs_db_present` check
  (in addition to the allow-list already rejecting it as
  `prohibited_path`) — a package containing it is unconditionally
  `Unsafe`, directly testing this project's own never-touch rule.
- **UI**: `BackupRecoveryCard` gained a third action, **Verify Backup**
  (pick a package → verifying spinner → a `VerifyResult` panel: a
  status badge colored by severity tier, the manifest summary when
  readable, every error, every warning, and a Done button). Never offers
  to restore from the verify flow — a separate, read-only path from
  Create/Restore.
- **i18n**: full genuine translation across all 8 locales
  (`settings.backup.verifyButton/verifying/errorsHeading/warningsHeading/
  status.*/toast.verifyFailed`).
- **Tests**: 13 new Rust tests in `backup.rs` (valid, valid-with-warnings,
  corrupted-garbage-bytes, corrupted-no-manifest, corrupted-malformed-
  manifest, unsafe-traversal, corrupted-hash-mismatch, corrupted-size-
  mismatch, incompatible-format-version, incompatible-schema-version,
  unsafe-runs.db-present, never-touches-filesystem, duplicate-names-pure-
  function-plus-writer-refusal) — full Rust suite 101/101. 9 new
  `BackupRecoveryCard.test.tsx` tests (all 5 statuses individually
  asserted distinct from each other, picker-cancelled no-op, verify
  failure, dismiss-returns-to-idle, never-calls-restore-or-create-while-
  verifying) — 21/21 passing. i18n parity 23/23. Typecheck clean. Lint
  clean.
- **Known limitations**: verification's JSON-content check remains
  parses-cleanly only (no per-schema Zod validation from Rust, same
  limitation Session 1's restore already disclosed). No standalone CLI
  or export of a verification report — UI-only, matching this session's
  bounded scope.

## Session 3 summary — schema migration framework (complete)

- **Extended the existing engine, not a second one**:
  `packages/shared/src/engine/migrations.ts`'s `SchemaMigration<T>` gained
  required `id`/`description`/`reversible` fields and an optional
  `validate` hook; `migrateRecord` now runs `validate` after `migrate` and
  throws (naming the failing step id) on a `false` result, using the same
  "throw rather than silently continue" discipline the existing
  non-advancing-version guard already used. `migrations.test.ts` extended
  in place (13 tests, up from 8) — no new test file, no parallel engine.
- **Global schema version**: `data/master/schema_meta.json`
  (`{ globalSchemaVersion, updatedAt }`), read/written by new Rust
  commands (`read_schema_meta`/`write_schema_meta` in the new
  `apps/desktop/src-tauri/src/migration.rs`). A fresh/unmigrated project
  has no file at all — that's not an error, it means every collection is
  still at `"1.0"` (confirmed unchanged since Session 0), so the implicit
  default IS the current supported version.
- **Migration registry, reused as-is**: `apps/desktop/src/lib/migrationRunner.ts`
  exports `MIGRATION_REGISTRY: MigrationRegistry = {}` — **empty by
  design**, per this session's explicit instruction not to invent a
  migration for a collection that has never changed schema. Every real
  code path (plan computation, dry run, full run, rollback, interrupted-
  run recovery) is exercised in `migrationRunner.test.ts` against a
  synthetic, test-only registry (`widgetRegistry()`), never the real one.
- **Backup integration — reused, not duplicated**: `create_pre_migration_backup`
  (Rust) calls `backup::try_create_backup` directly (made `pub(crate)`
  for this), writing to app-private storage, never a user-picked path.
  The orchestrator then calls the existing `verifyBackup`/`restoreBackup`
  Tauri commands from Sessions 1-2 unchanged — there is exactly one
  backup-creation code path and one restore code path in this codebase,
  now used by manual backup, restore's own safety backup, and
  pre-migration backup alike.
- **Journal**: append-only `data/master/migration_journal.jsonl`
  (`append_migration_journal`/`read_migration_journal`, Rust). Steps:
  `run_started` (carries the pre-migration backup path) →
  `collection_started`/`collection_completed` per collection →
  `run_completed`, or on any failure `collection_failed` →
  `rolled_back` → `run_failed`. `findInterruptedRun`/
  `find_interrupted_run` (mirrored in both TS and Rust, each independently
  tested) detects a `run_started` with no matching terminal entry —
  surfaced in the UI as a recovery banner, not auto-resolved.
- **Real architectural finding**: `upsert_master_records` refuses to
  overwrite an existing key in an append-only collection (by design, per
  Session 0's inventory) — which would make it unusable for writing back
  a migrated row of any append-only collection. Added
  `write_master_collection_raw` (masterdata.rs), a migration-only raw
  file overwrite that bypasses that refusal — safe specifically because
  the migration runner never reaches it without a verified pre-migration
  backup already existing, which is exactly the "no destructive mutation
  without a recovery point" rule this project follows, satisfied by the
  backup rather than by upsert's refusal.
- **`list_master_collections`** (masterdata.rs): exposes the real
  90-entry `COLLECTIONS` allow-list to the frontend directly — the plan
  computation's one, non-duplicated source of "which collections exist."
- **Future-version rejection**: `schema_version_status` (Rust,
  `major.minor`-only comparator — deliberately separate from
  `backup.rs`'s `major.minor.patch` app-version comparator, since the two
  version schemes genuinely differ in shape) returns `current`/
  `upgradable`/`futureUnsupported`; `runMigration` checks this first and
  journals+returns `rejected_future_version` without creating a backup or
  touching any collection when the data is newer than this build
  supports.
- **UI**: `SchemaMigrationCard` in Settings → General (alongside
  Session 1-2's Backup and Recovery card) — current version, pending-
  migration count, Dry Run, Run Migration (disabled with nothing
  pending), a completed/failed result panel (failed shows whether
  rollback succeeded), a rejected-future-version banner, and an
  interrupted-migration recovery banner checked on mount.
- **Tests**: 7 new Rust tests (`migration.rs` — schema-meta default/
  round-trip, version-status current/upgradable/future, journal append/
  read round-trip, missing-journal-is-empty, interrupted-run detection ×2)
  plus 1 new masterdata.rs test (`list_master_collections` matches the
  real allow-list) — full Rust suite **109/109**. 13 shared-package tests
  (`migrations.test.ts`, extended in place). 18 new
  `migrationRunner.test.ts` tests (plan walking incl. missing-intermediate-
  step, no-op/current-version, future-version rejection, dry-run-no-writes,
  backup-required-before-write, journal-step-order, validate-failure-
  triggers-rollback, unverifiable-backup-rejected, idempotent rerun,
  interrupted-run detection). 11 new `SchemaMigrationCard.test.tsx` tests
  (every UI state incl. rejected/interrupted/rolled-back-yes-no). Desktop
  typecheck clean. Desktop lint clean. i18n parity 23/23. Help registry
  38/38 (settings topic extended again, no new topic).
- **Known limitations**: no cross-collection migration ordering (each
  collection's chain is independent — no evidence any real dependency
  between collections exists yet, so none was built). No scheduled/
  automatic migration — every run is a deliberate Settings click, per
  this session's own instruction. `write_master_collection_raw` is
  reachable only through the migration runner's own code path today, but
  nothing at the Rust layer itself prevents a future caller from invoking
  it directly outside that gated flow — recorded as a trust boundary to
  revisit if this command ever gets a second caller.

## Session 4 summary — active data location clarification (complete)

- **One shared resolver, not two**: new `apps/desktop/src-tauri/src/data_root.rs`.
  `formulation_v2::project_root()` and `workspace::workspace_dir()` both now
  delegate to `data_root::resolve_data_root(app)` and are therefore always
  identical — the "two funnels" Session 0 found are gone.
  `workspace::base_workspace_dir()` is kept as a deliberately separate,
  narrower concept ("the configured base, regardless of any session/manual
  override") for the few callers that need it unconditionally
  (`compute.rs`'s shared machine list, `artifact_file.rs`'s explicit
  `"base"` scope, the Settings "workspace folder" controls).
- **Precedence, one place**: `formulab-root.txt` > `active-workspace.txt`
  > `base-workspace.txt` > default (`~/Documents/FormuLab`) — the exact
  order `project_root()` already used, now applied uniformly instead of
  `workspace_dir()` having a different, narrower one.
- **No silent fallback**: a present-but-invalid pointer (empty, or its
  target missing/not-a-directory) now always produces a specific,
  human-readable warning (`"<file> is set but invalid (<reason>) —
  ignored, falling back"`) rather than being swallowed with zero trace.
- **Conflict detection, never auto-merged**: after resolving the winner,
  every other valid, lower-precedence pointer is checked for real data
  (`data/formulations`, `data/master`, `data/sessions`, `formulas` — the
  same four locations `backup.rs`'s own scan already uses); if one holds
  data, it's reported as a `conflictingRoots` entry plus a warning. Session
  4's own instruction ("if multiple roots contain data, require an
  explicit user decision. Never merge automatically") is satisfied by
  always surfacing this rather than picking silently — a full picker/
  merge UI is explicitly the (deferred) Data Location Manager's job, not
  this session's.
- **Writability**: a real write-probe (create+delete a marker file) after
  resolution — `writable: false` is reported as a warning, never treated
  as a hard failure (the app still gets a definite path back).
- **The `runs.jsonl`/`runs.db` divergence, fixed at the root cause**:
  `runs_index.rs` read `base_workspace_dir()` directly while `runs.rs`
  wrote through `workspace_dir()` — two different functions that could
  disagree. `runs_index.rs` now calls `workspace_dir()` (the same unified
  resolver `runs.rs` already used), so both are provably the same path.
  `.FormuLab/runs.db` itself was never opened, read, rewritten, or moved
  by this change — only which directory Rust looks in for it changed, and
  since neither `formulab-root.txt` nor `active-workspace.txt` has ever
  had a writer anywhere in this codebase (confirmed again this session),
  `workspace_dir()` and `base_workspace_dir()` were already identical for
  every real installation — this fix is provably a no-op for any current
  user, closing the divergence only for a future case, not retroactively
  moving anyone's data.
- **Backward compatible by construction**: every existing valid
  installation (a `base-workspace.txt` pointing at a real folder, or
  nothing configured at all) resolves to the exact same path as before —
  confirmed by dedicated tests for each pointer tier plus the "active and
  base agreeing" case.
- **UI**: new `ActiveDataLocationCard` (Settings → General, right after
  the existing Workspace section) — resolved path, resolution source
  (plain-language label, e.g. "Manual override (formulab-root.txt)"),
  writable yes/no, every warning listed, Open Folder (reveals the
  resolved root, read-only), Refresh. Read-only throughout: no
  relocation, no move-data control, no merge action — all explicitly out
  of scope, deferred to the future Data Location Manager.
- **Tests**: 10 new Rust tests (`data_root.rs` — default root, each of
  the three pointer tiers winning in precedence order, a malformed
  pointer, a missing-target pointer, an unwritable-proxy case, a real
  multiple-valid-roots conflict with an explicit "no data moved/changed"
  byte-level assertion, an empty other-root correctly NOT flagged, active/
  base agreement producing no false conflict) — full Rust suite
  **119/119** (109 prior + 10 new). 11 new
  `ActiveDataLocationCard.test.tsx` tests (not-desktop fallback, real
  path/source-label display for all four sources, writable/not-writable,
  warnings incl. a conflict warning, no-warning-panel-when-clean, open-
  folder calls only the read-only reveal command, refresh reflects a
  changed status, an error state when the check itself fails). All
  settings-card tests re-run together: 59/59. i18n parity 23/23. Desktop
  typecheck clean. Desktop lint clean.
- **Known limitations**: still no UI to actually pick/relocate a root
  (deferred, as instructed — this is Data Location Manager scope). A
  conflict is reported but not resolved by any in-app action beyond
  looking at both folders yourself. `base_workspace_dir()`'s own
  malformed-pointer handling remains its pre-existing silent-fallback
  style internally (only the new unified resolver's independent read of
  the same `base-workspace.txt` file produces a warning for it) —
  `base_workspace_dir()` was deliberately left otherwise unchanged since
  narrowing its behavior wasn't this session's target.

## Session 5 summary — basic diagnostics and log export (complete)

- **Bounded log retention, the real gap closed**: `debug_log.rs` grew
  `debug.log` forever before this session — no cap, unlike every other
  log this project keeps (`runs.rs`'s captured stdout/stderr is capped
  per entry via `LOG_CAP`). Added `MAX_DEBUG_LOG_BYTES` (2 MB) and a
  small rotation scheme (`debug.log` -> `.1` -> `.2` -> `.3`, oldest
  dropped), checked before every append — bounds total retention to
  roughly 8 MB across 4 files.
- **New `diagnostics.rs`**: `diagnostics_summary` assembles app version
  (`CARGO_PKG_VERSION`), build id (honestly `None` — no build-time
  identifier exists), OS/arch (`std::env::consts`), the active data path
  + resolution source + writable + warnings (reusing
  `data_root::resolve_data_root` from Session 4 directly, no
  duplication), free disk space (`fs4`, already a Session 1 dependency),
  global schema version + compatibility status + last migration result
  (reusing `migration.rs` from Session 3 directly), last backup found
  (scans the app-private `backups/` directory Sessions 1-3 already write
  into — `pre-migration-*`/`pre-restore-*` — by filename-embedded epoch,
  honestly labeled as "last internal safety backup found," not a general
  backup history, since none exists), storage health (a NEW check: every
  `data/master/*.json` file is parsed; a present-but-unparseable file is
  flagged — this is the exact gap Session 0 found in `masterdata.rs`'s
  `read_array`, closed here as an independent diagnostic rather than by
  changing that function's own silent-empty-on-parse-failure behavior),
  both known log directories, and a bounded, heuristic "recent errors"
  scan of `debug.log` (lines containing "error"/"fail", case-insensitive
  — not a structured error log, since none exists; no crash-dump
  capability claimed or implied anywhere).
- **"Pending migration" comes from the frontend, not Rust**: the
  migration registry only exists in `migrationRunner.ts` (Session 3), so
  `apps/desktop/src/lib/diagnostics.ts`'s `getDiagnosticsSummary()` calls
  Rust's `diagnostics_summary` AND the existing `computeMigrationPlan()`
  in parallel and merges them — no duplicated registry logic in Rust.
- **Redaction (`redact_text`, new `regex` dependency, disclosed)**:
  Windows/Unix usernames in paths replaced with `<redacted>`; long
  (24+ char) alphanumeric tokens containing both a digit and a letter
  replaced with `[REDACTED]` (a deliberate over-redaction — a long hash
  isn't a secret, but safe-by-default is the right default for something
  meant to leave the machine). `localStorage` (where the plaintext
  per-provider LLM API key actually lives, per Session 0's inventory) is
  structurally unreachable from Rust — "never read secrets from
  localStorage" is true by construction, not by a rule someone has to
  remember to follow.
- **Two audiences, two levels of redaction, by design**: the on-screen
  `diagnostics_summary` keeps the real active data path unredacted (a
  user reading their own diagnostics needs the real path); the exported
  `SupportBundle` (`export_support_bundle`) redacts it and every log
  line and warning before writing — sanitized for sharing with someone
  else. The bundle contains backup **metadata only** (filename/kind/
  timestamp, never the backup's own file inventory or contents), the
  same schema/storage-health fields as the summary, and bounded (200-line)
  redacted log lines — no formula/master-data row ever appears, since
  nothing here reads one.
- **UI**: new `DiagnosticsCard` (Settings → General, after Schema
  Migration) — all the fields above, plus Refresh, Open Log Folder
  (reveals the app-data directory holding `debug.log`), Copy Summary
  (plain text, via the existing `copyText` clipboard helper — no new
  Rust command needed), Export Support Bundle (native save dialog ->
  `export_support_bundle`).
- **Tests**: 4 new Rust tests (`debug_log.rs` — no-op below cap, rotates
  at the cap, shifts the rotation chain and drops the oldest, bounded
  total retention across repeated rotations) + 10 new Rust tests
  (`diagnostics.rs` — username redaction ×2, token redaction, ordinary-
  text-untouched, missing-collection-is-healthy, corrupt-collection-
  flagged, last-migration-status picks the most recent terminal entry,
  empty-journal-is-none, tail_lines bounds+order, missing-file-is-empty)
  — full Rust suite **133/133** (119 prior + 14 new). 14 new
  `DiagnosticsCard.test.tsx` tests (not-desktop fallback, loading state,
  real fields displayed, failure state, not-writable, storage-health
  failure count, root warnings shown, recent errors shown, last-backup/
  last-migration shown, open-log-folder never calls a write/restore
  command, copy-summary content check, export-after-picking-a-
  destination, cancelled-picker-no-op, refresh reflects a changed
  summary). All settings-card tests re-run together: **73/73**. i18n
  parity 23/23. Desktop typecheck clean. Desktop lint clean.
- **Known limitations**: "recent errors" is heuristic text matching, not
  a structured/leveled log — `debug_log::log_debug` never recorded a
  severity. "Last backup" only sees the app-private safety-backup
  directory, not a full backup history (there isn't one — backup history
  was explicitly out of scope in Sessions 1-2 and remains so). No crash-
  dump support exists or is claimed. The support bundle is a single JSON
  file, not an archive — sufficient for this session's text-only
  content, revisit if binary attachments are ever needed.

## Stage 1 Closure and Verification session (complete)

**Scope**: verify all 8 Sessions 1-5 features, close the one real
verification gap, run every full test suite once, build a fresh Windows
release, perform honest native verification, update documentation. No new
feature added. `.FormuLab/runs.db` and real user data untouched throughout
(fixture/synthetic data only for every test).

### Verification gap closed

"Restore failure preserves the original fixture data" was previously
confirmed only by code inspection, not a direct Rust unit test — closed by
extracting `activate_staged_files` (a pure, `AppHandle`-free function) from
`try_restore_backup` in `backup.rs`, then adding 3 direct unit tests
(rollback-restores-original-content-on-failure, clean-run-leaves-no-aside-
copies, brand-new-file-with-no-prior-live-file). See
[`PHASE11_BACKUP_RESTORE_ARCHITECTURE.md`](../PHASE11_BACKUP_RESTORE_ARCHITECTURE.md#stage-1-closure-verification-session)
for the full rationale, including why a mocked `tauri::AppHandle`
(`tauri::test::mock_app()`) was investigated and rejected as unsafe for a
verification-only session (its `mock_context()` resolves
`app.path().app_data_dir()` to an unpredictable, non-isolated path).

### All 12 required guarantees — confirmed, with evidence

1. **Backup package can be created and verified** — `backup.rs`'s
   `full_backup_then_restore_round_trip_is_byte_identical` and the 13
   `verify_reports_*` tests (Session 2).
2. **Corrupted or unsafe packages are rejected** — 5 statuses
   (Valid/ValidWithWarnings/Incompatible/Corrupted/Unsafe), each reachable
   via a dedicated fixture and asserted by name (Session 2 tests).
3. **Restore uses staging and creates a safety backup** — `try_restore_backup`
   stages every file, verifies size+SHA256+JSON-parse before activation,
   and calls `try_create_backup` for a real safety package first (Session 1
   design, re-read and confirmed unchanged this session).
4. **Restore failure preserves the original fixture data** — closed this
   session via `activate_staged_files`'s 3 new tests (above) — previously
   the one real gap.
5. **Migration dry run does not modify data** — `migrationRunner.test.ts`'s
   `dryRunMigration reports changed rows without writing` (Session 3,
   re-confirmed passing this session).
6. **Future schema versions are rejected** — `schema_version_status`'s
   `future`/`futureUnsupported` tests (Rust, Session 3) plus
   `runMigration`'s `rejected_future_version` test (TypeScript, Session 3).
7. **Interrupted migration is surfaced** — `find_interrupted_run`/
   `findInterruptedRun` tests on both sides (Session 3); `find_interrupted_run`
   itself has no live caller today (TypeScript's `findInterruptedRun` is
   what's actually wired) — marked `#[allow(dead_code)]` with a doc comment
   this session rather than deleted, since it's the tested Rust-side
   equivalent.
8. **Active-root status reports the real resolver result** — `data_root.rs`'s
   `resolve_data_root`/`resolve_data_root_at`, 10 tests covering every
   precedence tier, conflict detection, and writability (Session 4).
9. **Diagnostics reports storage corruption without treating it as empty
   data** — `diagnostics.rs`'s
   `present-but-unparseable collection file flagged unhealthy` test
   (Session 5), directly closing the `masterdata.rs::read_array` silent-
   empty-on-parse-failure gap Session 0 found.
10. **Support bundle redacts sensitive paths and tokens** — `redact_text`'s
    username/token redaction tests (Session 5).
11. **Support bundle contains no backup contents or user records** —
    `SupportBundle` carries backup metadata only (filename/kind/timestamp),
    confirmed by reading `diagnostics.rs`'s `export_support_bundle` this
    session — no formula/master-data row is ever read into it.
12. **`.FormuLab/runs.db` is never included or modified** — structurally
    true by construction (never referenced by any inclusion-scanning path
    in `backup.rs`), plus `verify_reports_unsafe_when_runs_db_is_present`
    (Session 2) and `excluded_labels_name_runs_db_and_ebwebview_explicitly`
    (Session 1) as direct regression tests.

### Full test suites — run once, this session

- **Rust** (`cargo test --lib`, `apps/desktop/src-tauri`): **136/136
  passing** (133 prior + 3 new `activate_staged_files` tests).
- **Rust clippy** (`cargo clippy --lib`): clean. Two pre-existing
  `type_complexity` warnings (backup.rs) closed with named type aliases;
  one `dead_code` warning (migration.rs) closed with `#[allow(dead_code)]`
  + doc comment.
- **Desktop suite** (`pnpm --filter @formulab/desktop test`): **1094/1094
  passing**, 127/127 files. One real regression found and fixed —
  `SettingsPage.i18n.test.tsx` asserted a single match for the shared
  "available in the desktop app" fallback string, which 5 different
  Settings cards (added across Sessions 1-5) now all render; changed to
  `getAllByText(...).length > 0`. 6 pre-existing, non-deterministic
  `HelpPanel.test.tsx` unhandled-rejection log lines (documented jsdom/
  undici `AbortSignal` cross-realm incompatibility, predates Phase 11)
  persisted across a second confirmation run and are not a new regression.
- **Shared migration tests** (`migrations.test.ts`): 13/13 passing.
- **Desktop typecheck** (`tsc --noEmit`): clean.
- **Desktop lint**: clean.
- **i18n/help tests**: 23/23 i18n parity, 38/38 help registry.

### Native verification (release build)

Release build: `pnpm tauri build` from `apps/desktop`, produced fresh
`formulab.exe`, `FormuLab_0.4.0_x64_en-US.msi`,
`FormuLab_0.4.0_x64-setup.exe` under `src-tauri/target/release/` (and its
`bundle/msi/`, `bundle/nsis/` subfolders).

Shortcut target confirmed: `C:\Users\sekip\Desktop\FormuLab.lnk` →
`C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
— i.e. the exact freshly-built release exe.

| Check | Result |
|---|---|
| App starts | **Verified** — `scripts/windows/verify-formulab-phase1.ps1` run against the release exe: process launched (PID observed), stayed running, top-level window appeared with title "FormuLab", app closed cleanly. |
| Existing projects remain visible | **Blocked** — no UI-content-reading tool available (see below). |
| Backup and Recovery card opens | **Blocked** — same reason. |
| Verify Backup flow opens | **Blocked** — same reason. |
| Schema Migration card opens | **Blocked** — same reason. |
| Active Data Location card shows the actual path | **Blocked** — same reason. |
| Diagnostics card opens | **Blocked** — same reason. |
| Log folder action works | **Blocked** — same reason. |
| Support-bundle save dialog opens | **Blocked** — same reason. |

**Why blocked, honestly**: this environment has no UI Automation content
access, WebDriver/`tauri-driver`, or accessibility-tree reach into the
packaged app's Chromium/WebView2 renderer — confirmed independently twice
before (Phase 1 closure's own `TAURI_LIVE_VERIFICATION.md`/
`verify-formulab-phase1.ps1`, and Phase 10 closure). That script itself is
explicit: `"Automated UI interaction verified: NOT PERFORMED BY THIS
SCRIPT"`. No real restore or migration was run against live data, per
instruction. No screenshot or interaction was fabricated for the 8 blocked
items.

### Release artifacts

All three built fresh this session from `apps/desktop/src-tauri/target/release/`:

All three under `apps/desktop/src-tauri/target/release/`:

| Artifact | Path | Size (bytes) | SHA256 | Signed |
|---|---|---|---|---|
| EXE | `formulab.exe` | 23,040,512 | `F8C16F041BDE468348D9F0258E411D88B4CEF98E81AB9B5262466E8A9D12503E` | **Not signed** |
| MSI | `bundle/msi/FormuLab_0.4.0_x64_en-US.msi` | 36,986,880 | `3B2F8EF53B99066897634B15EE554AE69C44B21CAB22E80740AA933F6D915BE0` | **Not signed** |
| NSIS | `bundle/nsis/FormuLab_0.4.0_x64-setup.exe` | 25,300,117 | `CE1F4FA46E219D1831C52F0146C42AE8DD5289BE8A260713334E57405D669D24` | **Not signed** |

All three inspected directly via `Get-AuthenticodeSignature` and confirmed
`NotSigned` — signing was not claimed for any artifact. Commercial-
distribution-stage signing remains fully deferred, unchanged from Session
0's own scoping.

### Remaining limitations (Stage 1, as closed)

- No backup history list; no automatic/scheduled backups (Stage 2).
- No Data Location Manager UI to relocate/merge roots — conflicts are
  reported, never auto-resolved (Stage 2).
- Restore/verify structural check is JSON-parses-cleanly only, not a full
  per-schema Zod pass.
- `find_interrupted_run` (Rust) has no live caller — the TypeScript
  `findInterruptedRun` is what's actually wired.
- No structured/leveled application log; "recent errors" in Diagnostics is
  heuristic text matching.
- Support bundle is a single JSON file, not an archive.
- Native verification proves process/window launch only, not interior UI
  content — an environment limitation confirmed across three separate
  phase-closure sessions now (Phase 1, Phase 10, Phase 11), not specific to
  this phase.

### Deferred Stage 2 items (explicit, unchanged)

Automatic backups, Data Location Manager, update checker — all noted with
their real dependencies in Session 0's summary above; none designed
further this session.

### Commit and push

Commit: `chore(phase11): close stage 1 data safety`. Files staged:
`apps/desktop/src-tauri/src/backup.rs`, `apps/desktop/src-tauri/src/migration.rs`,
`apps/desktop/src/app/routes/SettingsPage.i18n.test.tsx`, and the Phase 11
documentation files listed above — `.FormuLab/runs.db`, `formulas/index.json`,
and the two regenerated `docs/generated/FormuLab-User-Guide.{docx,pdf}`
(an unrelated side effect of an earlier full-suite test run this session)
deliberately excluded, per this session's own instructions and this
project's "stage only current-task files" convention.

## Phase 11 Session 7: Automatic Backups (complete)

**Scope**: Stage 2's first item — automatic (daily/weekly/on-exit)
backups and retention, built entirely on Sessions 1-3's existing
`.formulab-backup` engine. No second backup format, no second write
path. `.FormuLab/runs.db`, `formulas/index.json`, and real user data
untouched throughout (Rust tests use synthetic temp directories only).

- **No background service, disclosed honestly**: FormuLab has none, and
  this session was explicitly told not to invent one. Every automatic
  backup — scheduled or on-exit — only ever runs while the app is the
  foreground process: on launch, on a 30-minute while-open interval, or
  when the window closes. A day or week the app never opens has no
  automatic backup for that day or week; both the Settings card and the
  Help topic (`settings.warnings.5`, all 8 locales) say this in plain
  language, not buried in a changelog.
- **New Rust module**: `apps/desktop/src-tauri/src/automatic_backup.rs`.
  Reuses `backup::try_create_backup`/`backup::verify_backup_report`
  directly — the exact functions Sessions 1-2 built — for every byte
  written and every verification check run. New commands:
  `read_automatic_backup_state`, `write_automatic_backup_config`,
  `run_automatic_backup`, `apply_pre_migration_retention`,
  `open_automatic_backup_destination`. Settings + run history persist as
  app-private `automatic_backup_state.json` (write-then-rename, same
  discipline as every other JSON write in this codebase).
- **Classification and naming**: `formulab-auto-daily-<epoch>.formulab-backup`
  / `formulab-auto-weekly-<epoch>.formulab-backup` in the user-configured
  destination folder; `pre-migration-<epoch>.formulab-backup` (Session
  3's existing naming, unchanged) in FormuLab's own app-private storage —
  pre-migration backups are not user-relocatable, matching their existing
  mandatory-per-migration-run design.
- **Backup-on-exit is classified "daily"**, deliberately, not a fourth
  class: it also satisfies that day's daily-backup eligibility, so
  closing the app in the evening doesn't cause a second daily backup on
  the next same-day launch. Documented as a design decision, not left
  implicit.
- **Verification is mandatory, not optional**: every automatic backup is
  checked with `verify_backup_report` immediately after writing; anything
  short of `Valid`/`ValidWithWarnings` is deleted on the spot and recorded
  as a failure — never left on disk pretending to be a real backup.
- **Retention** (`apply_retention`, pure and unit-tested without an
  `AppHandle`): keeps the newest N per class, deletes older ones, and
  removes stray `.tmp` packages left by a crash mid-write. A configured
  retention of `0` — or any count — never deletes the last remaining
  valid backup of a class; the floor is unconditional, not a suggested
  default.
- **Concurrency**: `run_automatic_backup` reuses `BackupState` — the same
  slot manual `create_backup`/`restore_backup` already hold while
  running — so an automatic run can never start alongside a manual
  backup, a restore, or another automatic run. A collision reports itself
  as a normal failed `AutomaticBackupRunRecord`, not a thrown error.
- **Failure handling**: missing/moved destination folder, low disk space
  (`try_create_backup`'s existing check, unchanged), and permission
  errors all surface as the real underlying message, not swallowed or
  generalized. A failed automatic backup shows a toast (if the window is
  focused) and a native OS notification (`notifyAutomaticBackupFailure`,
  extending `lib/systemNotification.ts` — silent if permission was never
  granted, never prompts proactively for it).
- **Pre-migration retention, the real pre-existing gap closed**: Session
  3's `create_pre_migration_backup` had no retention at all — every
  migration run added one more file to app-private storage forever.
  `migrationRunner.ts`'s `runMigration` now calls the new
  `apply_pre_migration_retention` (via `pruneOldPreMigrationBackups`,
  best-effort) only after a clean `run_completed` — never after a
  failure, since a failed run's own pre-migration backup is exactly what
  a user or `recoverInterruptedMigration` may still need.
- **Frontend**: `lib/automaticBackup.ts` (a zustand store, matching
  `lib/update.ts`'s existing auto-check pattern) owns eligibility
  (`isDailyEligible`/`isWeeklyEligible`, pure functions), the scheduling
  tick, and the backup-on-exit `onCloseRequested` window hook
  (`installAutomaticBackupLifecycle`, wired once from `AppShell`,
  matching the existing `ensureJupyter()`/`ensureSetupProgressListener()`
  app-lifetime-setup convention).
- **UI**: new `AutomaticBackupCard` (Settings → General, after Backup and
  Recovery) — master enable, destination folder picker + open, daily/
  weekly toggles with their own retention counts, backup-on-exit toggle,
  an always-visible pre-migration retention count (applies regardless of
  the master toggle, since pre-migration backup itself is mandatory), a
  status panel (next eligible run, last success, last failure with
  reason), and Run Automatic Backup Now.
- **i18n**: full genuine translation across all 8 shipped locales
  (`settings.automaticBackup.*`; `help.settings.sections.0` extended in
  place, `help.settings.warnings.5` added) — no placeholders.
- **Tests**: 12 new Rust tests (`automatic_backup.rs` — default config,
  state round-trip, destination-missing/unset distinguished, epoch
  parsing, retention-per-class mapping, retention keeps-newest-N,
  retention never deletes the last valid backup even at a configured
  zero, retention is isolated per class in a shared directory, retention
  removes orphaned `.tmp` packages, retention on a missing directory is a
  no-op, naming convention, verification-status mapping) — full Rust
  suite **148/148** (136 prior + 12 new), `cargo clippy --lib` clean (one
  `result_large_err` warning closed by boxing the error variant, not
  suppressed). 21 new `automaticBackup.test.ts` tests (eligibility pure
  functions, refresh/setConfig, duplicate-trigger prevention, success,
  failure incl. missing-destination/low-disk-space/failed-verification
  text passed through unchanged, `maybeRunScheduled` respecting the
  master and per-class toggles and eligibility, `runOnExit` respecting
  both toggles). 12 new `AutomaticBackupCard.test.tsx` tests (not-desktop
  fallback, disabled-state hides schedule controls, enabled-state shows
  them, toggling on writes config, folder picker incl. cancel-is-a-no-op,
  Run Now disabled without a destination, Run Now triggers a daily run,
  last success/failure display with class labels, a retention input
  writes through, Open Folder calls only the reveal command, the
  limitation note always renders). 3 new `migrationRunner.test.ts` tests
  (retention runs after a completed migration with the configured count,
  retention is skipped after a failed run, a retention failure never
  fails an otherwise-completed migration) — migrationRunner suite
  **21/21**. i18n parity **23/23**. Help registry **38/38** (new test
  count varies by loop, no fixed assertion broken). Desktop typecheck
  clean. Desktop lint clean.
- **Full desktop suite** (`pnpm --filter @formulab/desktop test`, run
  this session since `AppShell.tsx` — a global/shared file — changed):
  **1130/1130 passing** when isolating the one pre-existing flake
  (`HelpPanel.test.tsx`'s documented jsdom/undici `AbortSignal`
  cross-realm incompatibility, predating Phase 11 and already recorded in
  the Stage 1 Closure notes above — 3 tests fail only when run inside the
  full suite, 11/11 pass in isolation, confirming this session introduced
  no regression there).
- **Known limitations** (disclosed, not silently assumed away): no
  background service — see above, the load-bearing one. No backup
  history list for automatic runs beyond "last success"/"last failure"
  (matches manual backup's own existing limitation). Manually triggered
  "Run Automatic Backup Now" and backup-on-exit are both always
  daily-classed — there is no UI to force a one-off weekly or
  pre-migration run. `AutomaticBackupCard`'s retention inputs clamp to
  1-99 client-side; the Rust-side floor of 1 is the actual safety
  guarantee, the UI range is just a sane input bound.

## Phase 11 Session 8: Data Location Manager (complete)

**Scope**: Stage 2's second item — turning Session 4's read-only Active
Data Location card into a safe way to actually relocate the active data
root: validate a destination, move data into it (stage -> hash-verify ->
activate -> only then flip the pointer), point at an already-existing
FormuLab root without copying anything, or restore the built-in default.
`.FormuLab/runs.db` and real user data untouched throughout — every Rust
test uses synthetic temp directories only; no real destination folder was
ever chosen or moved into during this session's own testing.

- **The first real writer for `base-workspace.txt` beyond `set_workspace_base`**:
  `data_location_manager.rs` writes the exact same pointer file
  `workspace::set_workspace_base` already writes (now `pub(crate)`,
  reused directly — one writer's worth of logic, two callers), never
  `formulab-root.txt` or `active-workspace.txt`. Session 0's finding that
  `formulab-root.txt` has "no writer anywhere in the codebase" remains
  literally true after this session — it is still reachable only by
  manual file edit, and if present it still wins over anything this
  manager does, surfaced as a resolution warning rather than silently
  overridden.
- **New Rust module**: `apps/desktop/src-tauri/src/data_location_manager.rs`.
  Reuses, never duplicates: `backup::try_create_backup`/
  `verify_backup_report` (Sessions 1-2, unchanged) for the mandatory
  pre-move safety backup, `data_root::resolve_data_root` to confirm a
  pointer change actually took effect, `automatic_backup::remap_destination_after_move`
  (new, Session 7's module) for the automatic-backup destination
  adjustment, and `BackupState` for the same concurrency slot manual
  backup/restore and automatic backups already hold.
- **Move ≠ Backup, deliberately**: a move's own file walk
  (`walk_movable_files`) is independent of `backup.rs`'s curated
  `collect_included` — the backup format deliberately excludes
  `data/literature`, `data/master/backups/`, etc. for package-size
  reasons, but a move must relocate the WHOLE root (minus only
  `.FormuLab/runs.db`) or real files would be silently left behind.
  Documented explicitly in the module's own doc comment so a future
  session doesn't "simplify" this into reusing `collect_included` and
  quietly drop real data.
- **Ten-step safe move, exactly as specified**: validate source+destination
  -> reject conflicting/unrelated destinations -> verified safety backup
  -> stage every file into a private `.formulab-move-staging-<epoch>/`
  directory under the destination, hashing as read -> re-hash every
  staged copy against the recorded size+SHA256 -> activate (rename each
  staged file into its final path, rolling back and removing the staging
  dir on any failure) -> write the `base-workspace.txt` pointer only
  after every file is confirmed at its final path -> re-resolve and
  confirm the app now actually resolves to the destination (a
  higher-precedence override could otherwise make the pointer write
  silently no-op) -> the old root is never touched or deleted by this
  flow at all -> failure at any step restores the pointer to its exact
  previous content (or removes it) and reports why, with the previous
  location still fully active and untouched.
- **"Use Existing Location" is a distinct, lighter path**: no file copy
  (the destination already holds its own data) — a safety backup of the
  CURRENT root, then the same pointer-write-and-confirm activation a move
  uses. Validation classifies a destination into exactly one of six kinds
  (`empty`/`existingCompatibleRoot`/`conflicting`/`sameAsCurrent`/
  `notADirectory`/`unwritable`) — `Move Data` is offered only for
  `empty`, `Use Existing Location` only for `existingCompatibleRoot`;
  `conflicting` (real, non-FormuLab-shaped files present) blocks both,
  satisfying "never blindly merge two roots" by construction, not by a
  guard someone could forget to check.
- **Old root cleanup — separate, explicit, never automatic**: a new
  `cleanup_old_data_location` command exists, but is reachable only from
  a dedicated confirmation panel shown after a successful move/switch,
  and refuses outright if the target is (or canonicalizes to) the
  currently active root — a confused caller can never delete data that's
  actually in use.
- **Interrupted-move journal**: app-private
  `runtime/data_move_journal.jsonl` (`AppHandle::app_data_dir()`,
  deliberately NOT inside the data root itself — the root is exactly
  what a move changes, so journaling inside it would make the journal
  unreadable, or wrongly scoped, the moment resolution flips elsewhere).
  A pure `resume_decision(steps: &HashSet<&str>) -> ResumeAction` function
  decides the recovery action purely from which journal steps an
  interrupted run reached (`AlreadyComplete` /
  `CompleteFromPointerUpdated` / `CompleteFromActivated` /
  `RollbackNothingActivated`) — directly unit-tested without an
  `AppHandle`, isolating the one part of resume that's pure decision-
  making from the filesystem/pointer side effects around it. The pointer
  file's previous content is journaled alongside `pointer_updated`
  (`prev:<content-or-NONE>`) specifically so a resume can roll it back
  even after a crash wiped the writing process's own in-memory copy.
- **Automatic-backup integration**: `automatic_backup::remap_path` (pure)
  + `remap_destination_after_move` — if the configured daily/weekly
  destination folder was inside the OLD data root, remaps it to the same
  relative path under the new root; otherwise leaves it completely
  untouched (an external-drive destination has nothing to do with where
  the data itself lives) and reports which happened, with why, in the
  move result.
- **UI**: `ActiveDataLocationCard` rewritten in place (same file, same
  read-only status section preserved) with Change Location, Use Existing
  Location, Restore Default, live move progress + cancel, a validation
  result panel (kind badge, space summary, warnings/blockers), an
  explicit confirmation panel before any activating action (move, switch,
  restore default, or cleanup — never a single click for any of them), a
  successful-move summary (destination, files/size, safety backup path,
  automatic-backup adjustment note), an interrupted-move recovery banner
  checked on mount, and optional post-move old-location cleanup.
- **i18n**: full genuine translation across all 8 shipped locales
  (`settings.dataLocation.*` extended with ~45 new keys;
  `help.settings.sections.0` extended in place, `help.settings.warnings.6`
  added) — no placeholders.
- **Tests**: 14 new Rust tests in `data_location_manager.rs`
  (`walk_movable_files` excludes `runs.db` and stray staging dirs and
  handles a missing root; `validate_destination_at` covers all six kinds
  including insufficient-space-blocks-a-move-but-not-use-existing and
  same-as-current; `activate_staged` both succeeds cleanly and rolls back
  + removes staging on a mid-activation failure; `find_interrupted_move`
  detects an unresolved run and ignores a completed earlier one;
  `restore_pointer` writes back previous content or removes a new file;
  `resume_decision` covers every reached-step combination) + 2 new tests
  in `automatic_backup.rs` (`remap_path` preserves the relative path
  inside the old root, is `None` outside it) — full Rust suite
  **164/164 passing** (148 prior + 16 new), `cargo clippy --lib` clean.
  20 new `ActiveDataLocationCard.test.tsx` tests (read-only status
  preserved incl. open-folder-never-writes; all five blocking validation
  kinds incl. a cancelled picker doing nothing; a full successful move
  with summary; old-location cleanup gated by its own confirmation; the
  automatic-backup adjustment note shown when applicable; a safety-backup
  failure surfacing its exact message with the original root still shown
  active; a staged hash-mismatch failure never claiming success; an
  activation failure reporting the source data confirmed untouched; a
  cancelled move returning to idle quietly; a full "use existing
  location" switch; Restore Default requiring confirmation before
  calling through; the interrupted-move banner appearing/resuming/
  clearing, and not appearing when nothing is interrupted). i18n parity
  **23/23**. Help registry suite passing. Desktop typecheck clean.
  Desktop lint clean (one real `react-hooks/rules-of-hooks` false
  positive fixed by renaming the `use`-prefixed Tauri wrapper
  `useExistingDataLocation` to `activateExistingDataLocation` — the lint
  rule treats any `use*`-named function called from a callback as a
  hook regardless of what it actually does).
- **Full desktop suite**: not run this session — only Settings-scoped
  files changed (`ActiveDataLocationCard.tsx`, `tauri.ts`,
  `automatic_backup.rs`'s new exports); no global/shared shell file like
  `AppShell.tsx` was touched, unlike Session 7. Targeted run instead:
  every `components/settings/*` card test + `SettingsPage.i18n.test.tsx`
  + `migrationRunner.test.ts` + `automaticBackup.test.ts` together —
  **141/141 passing** across 12 files (includes this session's new 20
  `ActiveDataLocationCard.test.tsx` tests, Session 7's suites re-run
  clean alongside them). i18n parity + help registry run separately —
  **61/61 passing** (23 + 38).
- **Known limitations** (disclosed, not silently assumed away): no
  progress bar granularity finer than per-file during staging/
  verification (matches manual backup's own existing progress model).
  `formulab-root.txt`/`active-workspace.txt` remain entirely outside this
  manager's writes — a poweruser's manually-placed override still wins
  silently over any choice made here, exactly as Session 0 found and
  Session 4 already surfaced as a warning; this session does not add a
  UI to edit those two files, only to explain when one is active.
  Interrupted-move resume has exactly one recovery path per state (finish
  if safe, otherwise roll back) — there is no "inspect and choose" UI;
  this mirrors Session 3's migration-recovery banner's own single-action
  precedent. Cleanup deletes the entire old root in one operation — no
  selective/partial cleanup.

## Phase 11 Session 9: Update Checker (complete)

**Scope**: Stage 2's third item — a safe, check-only update checker.
Signed installation, automatic update installation, and rollback are
explicitly Phase 12, not this session. Rewrote the pre-existing (pre-
Phase-11) update-check code that already lived in `updates.rs`/
`lib/update.ts` rather than building a parallel system — that code
already had current-version display, manual/automatic check, and a
Settings badge, but used a hardcoded, dual-path fetch (a Rust Atom-feed
scraper falling back to a raw browser `fetch`), a fixed 24h interval, no
size/timeout/HTTPS enforcement, no release notes, no platform info, and
no ignored-version or notification support.

- **This session hit an API error immediately before running the
  focused tests** and resumed from the existing working tree — `git
  status`/`git diff --check` at resume time showed every Session 9 file
  already fully written with no conflict markers or truncation; only one
  real defect was found (a garbled sentence fragment
  — "(off by default is not the case — it's on by default)" — left
  mid-edit in `docs/USER_GUIDE.md`), fixed before continuing. No other
  file needed repair; all Rust/TS compiled and all focused tests passed
  on the first resumed run.
- **Metadata contract**: ONE configurable HTTPS endpoint (GitHub's public
  Releases API by default, `updates::DEFAULT_RELEASE_METADATA_URL` /
  `lib/update.ts`'s `DEFAULT_RELEASE_METADATA_URL` — duplicated as a
  literal on both sides deliberately, matching this codebase's existing
  `GLOBAL_SCHEMA_VERSION`-style cross-boundary-constant convention, since
  Rust and TS constants can't literally share storage). The endpoint
  itself is not exposed as a Settings UI control this session (the task's
  own UI list didn't ask for one) — the store's `setEndpointUrl`/
  `endpointUrl` exist and are HTTPS-validated for future/programmatic use,
  keeping the architecture configurable without adding an unrequested
  surface.
- **Rust owns validation of the response itself** (`updates.rs`,
  rewritten): HTTPS-only (checked before any request, and again on the
  `html_url` field inside the parsed JSON), a 1&nbsp;MB response-size cap
  enforced twice (a `Content-Length` pre-check and a hard-capped
  `Read::take` on the actual bytes, so a lying or missing header can't
  bypass it), a 10s request timeout, required-field structural validation
  (missing tag/URL, malformed JSON, a draft/prerelease entry — all
  rejected with a specific reason), and platform/architecture matching
  (`find_platform_asset`, loose filename-keyword matching against
  `std::env::consts::OS`/`ARCH` — informational only, never downloads an
  asset to confirm).
- **TypeScript owns everything version-shaped** (`lib/update.ts`,
  rewritten): `isValidSemver` (a real semver-shape check — a malformed
  version like `"abc"`/`"1.2"` is now rejected outright, not silently
  coerced to `0` the way the old lenient numeric parse did),
  `compareVersions`/`isNewerVersion` (unchanged, already tested), and the
  same-or-older-version case: `check()` reports a same/older response as
  `"upToDate"`, never `"error"` and never `"updateAvailable"` — this is
  the downgrade/same-version rejection the task asked for, expressed as
  "never trust a non-newer response as an update" rather than a separate
  error path.
- **Scheduling**: `shouldAutoCheck(lastCheckedAt, now, frequencyHours)`
  replaces the old fixed `CHECK_INTERVAL_MS` — `frequencyHours` is
  user-configurable (`FREQUENCY_OPTIONS_HOURS`: 6/12/24/72/168, default
  24) and persisted in localStorage, matching this module's existing
  persistence pattern (unlike Sessions 7-8's app-private JSON stores —
  deliberately unchanged here, since this exact code was already shipped
  and tested with localStorage before Phase 11 and switching persistence
  layers was not asked for). A manual check always bypasses the
  frequency; an automatic one (`maybeAutoCheck`, called from `AppShell`
  on launch, unchanged call site) is gated by both `enabled` and the
  configured frequency.
- **Offline detection**: `navigator.onLine === false` short-circuits to
  `"offline"` before ever calling through to Rust; a Rust
  connect/timeout error message (`fetch_release_metadata_bytes`'s own
  "you may be offline" phrasing) is also classified as `"offline"`
  client-side (`isOfflineLooking`) — best-effort, not a guarantee, since
  a browser `fetch` fallback (not used by default here, since the native
  Tauri command is now the only path — no more dual-path fetch) could
  phrase a connectivity error differently.
- **Ignored version**: unified into one concept (`ignoredVersion`,
  replacing the old `dismissedVersion`/badge-only "dismiss" — Sidebar's
  `showBadge` field kept its exact name/semantics for compatibility,
  since only that one field was read outside this module).
  `ignoreVersion()`/`clearIgnoredVersion()` suppress/restore `hasUpdate`
  (and therefore the Settings badge) for that exact version only — a
  genuinely newer version released later is never suppressed by an older
  ignored one (`derive()` re-checks `isNewerVersion` against the CURRENT
  `latest`, not just equality-to-ignored).
- **Duplicate-notification prevention**: a separate `notifiedVersion`
  (persisted, distinct from `ignoredVersion`) — `notifyUpdateAvailable`
  (new, `lib/systemNotification.ts`, matching Session 7's
  `notifyAutomaticBackupFailure` pattern exactly: silent if OS
  notification permission was never granted, never requests it
  proactively) fires at most once per version, tracked independently of
  whether the user later ignores that version.
- **Release notes are plain text, never HTML**: the `notes` string from
  `ReleaseMetadata` is placed directly into JSX text content in
  `UpdateCheckerCard.tsx` (React escapes it; `dangerouslySetInnerHTML` is
  never used, and no Markdown/HTML renderer touches it), truncated to
  2000 characters for display sanity. A dedicated test asserts a
  deliberately hostile notes string (`<img onerror=...>`) renders as
  literal text with no `<img>`/`<b>` element ever created.
- **No installer download or execution anywhere in this session** — `View
  Release / Download` only calls the existing `openExternal(latest.url)`
  wrapper (opens the OS browser); no file is ever fetched beyond the one
  JSON metadata document.
- **UI**: new `UpdateCheckerCard.tsx` (Settings → General, after
  Diagnostics), replacing the inline "App updates" block that previously
  lived directly in `SettingsPage.tsx` (removing ~90 lines of inline JSX
  and the now-unused `dismissBadge`/`ExternalLink`/`RefreshCw`/
  `openExternal`/`Switch` imports it was the only user of) — current
  version, status (idle/checking/up to date/update available/error/
  offline, each with a distinct icon+tone), last-checked time, an
  available-version summary (version, publish date, platform-support
  note, release notes), View Release / Download, Ignore This Version,
  Clear Ignored Version, an automatic-check toggle, a frequency select
  (disabled when automatic check is off), a Settings-badge toggle, and an
  always-visible disclaimer stating FormuLab checks only and does not
  install updates.
- **i18n**: full genuine translation across all 8 shipped locales
  (`settings.updates.*` fully replaced — old `available`/`latestVersion`/
  `openRelease`/`hideBadge`/`privacy` keys retired, ~30 new keys added;
  `help.settings.warnings.7` added) — no placeholders.
- **Tests**: 14 new Rust tests in `updates.rs` (HTTPS-only acceptance,
  size-limit boundary, platform/arch matching incl. an unknown-OS never
  claiming a match, a well-formed response accepted with the right
  platform match, an honest no-match report, missing version/missing
  URL/non-HTTPS-URL/malformed-JSON/oversized-response all rejected with
  a distinct reason, empty optional fields treated as absent, a draft or
  prerelease skipped, a non-HTTPS endpoint refused before any request) —
  full Rust suite **177/177 passing** (163 prior + 14 new), `cargo
  clippy --lib` clean. 30 new `update.test.ts` tests (semver validation,
  HTTPS-URL validation, ignored-version matching, configurable-frequency
  eligibility, the full store: manual bypass, disabled/not-due automatic
  checks, same-version and older-version-both-report-up-to-date,
  malformed-version-is-an-error, HTTPS enforcement before calling
  through, `setEndpointUrl` accept/reject, offline detection incl. a
  classified Rust timeout message, an oversized/malformed-response error
  classified as generic not offline, platform-support fields preserved,
  ignore/clear-ignore restoring `hasUpdate` correctly, a newer version
  after an ignored older one still flagged, notify-once-per-version,
  never-notify-for-ignored, never-notify-when-not-newer, frequency
  clamping). 19 new `UpdateCheckerCard.test.tsx` tests (every status
  state, the available-version summary incl. platform note both ways,
  View Release opening externally, Ignore/Clear actions, automatic-check
  and badge toggles, frequency select enabled/disabled, the plain-text-
  notes security test, the "checks only" disclaimer always present). 2
  new `systemNotification.test.ts` tests (`notifyUpdateAvailable` sends
  with permission, never requests it proactively). i18n parity **23/23**.
  Help registry suite passing. Desktop typecheck clean. Desktop lint
  clean.
- **Full desktop suite run this session** (launch behavior and shared
  update state changed, per this session's own instruction):
  **1182/1185 passing** once the one pre-existing flake is isolated —
  `HelpPanel.test.tsx`'s documented jsdom/undici `AbortSignal` cross-realm
  incompatibility (first recorded in the Stage 1 Closure session,
  reconfirmed in Sessions 7 and 8, predates Phase 11 entirely) reproduced
  3 failures only when run inside the full suite; the same file passes
  11/11 in isolation, confirming no regression was introduced this
  session.
- **Known limitations** (disclosed, not silently assumed away): no
  signed installers, no automatic download/installation, no rollback —
  all explicitly Phase 12. The update endpoint is configurable in the
  store but has no Settings UI field this session (not requested). Offline
  classification is best-effort text matching on Rust's own error
  message, not a guaranteed network-state API. Platform/architecture
  detection is filename-keyword matching against release assets, not a
  guarantee a given asset will actually run — informational only. The
  release-notes truncation (2000 chars) is a display limit, not a
  security control (the security control is "always plain text,
  never HTML").

## Stage 2 Closure and Verification session (complete)

**Scope**: verify all 3 Sessions 7-9 features, genuinely root-cause and fix
the recurring `HelpPanel.test.tsx` jsdom/undici `AbortSignal` cross-realm
flake (previously only documented as a known limitation, per an explicit
mid-session instruction not to accept that anymore), close the remaining
verification gaps, run every full test suite once, build a fresh Windows
release, perform honest native verification, update documentation. No new
feature added. `.FormuLab/runs.db` and real user data untouched throughout
(fixture/synthetic data only for every test).

### The `HelpPanel.test.tsx` AbortSignal flake — genuinely fixed, not just documented

Previously recorded (Stage 1 Closure, Sessions 7-9) as a known,
undiagnosed jsdom/undici incompatibility that only reproduced inside the
full suite. This session was explicitly told to find the real root cause
instead of continuing to document around it.

**Confirmed mechanism**: `TourOverlay.tsx:62`'s `navigate(tour.route)` —
fired from a `useEffect`, unawaited — drives `@remix-run/router`'s
internal `createClientSideRequest`, which builds
`new Request(href, { signal })` from a fresh `AbortController`. Under
genuine multi-file concurrent test execution, this occasionally throws
inside Node's own undici (`TypeError: Expected signal to be an instance
of AbortSignal`) as an unhandled promise rejection, which Vitest
attributes to whatever test happens to be active at that instant.

**Two principled fix attempts were tried and empirically ruled out**
before landing on the real one:
1. `test.server.deps.inline` targeting `@remix-run/router`/`react-router`/
   `react-router-dom`, forcing them through Vite's per-file-fresh
   transform pipeline instead of Vitest's default externalized/cached
   node_modules handling — full suite still failed identically. Rules out
   stale cross-file **module** caching.
2. `pool: "forks"` with `poolOptions.forks.isolate: true` — every test
   file in its own OS process, so no `globalThis` could possibly be
   shared between files — full suite still failed identically. Rules out
   cross-file/cross-realm **global** pollution of any kind.

**What actually isolated it**: running the full suite with
`--no-file-parallelism` produced **130/130 files, 1185/1185 tests
passing**, with the same background errors present but attributed to no
test. Combined with (1) and (2) above, this rules out every caching/
pollution mechanism and leaves a genuine scheduling race — the failure
only occurs when multiple files' code is executing at the literal same
instant, and disappears the instant nothing runs concurrently, regardless
of module identity or process boundary.

**Why it can't be fixed from `TourOverlay.tsx`**: this app uses React
Router's classic/compat `<BrowserRouter>` API, whose `useNavigate()`-
returned function is synchronous and `void`-returning — confirmed
empirically (`navigate(tour.route).catch(() => {})` crashed immediately
with `Cannot read properties of undefined (reading 'catch')`, reverted).
The rejecting promise lives entirely inside `@remix-run/router`'s own
internals, with no hook exposed to application code to observe or
suppress it.

**The fix, landed**: `apps/desktop/vite.config.ts`'s `test` block now sets
`fileParallelism: false`, serializing test-file execution. This is a
test-harness-only setting — no test was skipped, muted, quarantined, or
weakened; all 1185 tests still run every time. It is, if anything, a
*stronger* guarantee against cross-file pollution than before (nothing
ever runs concurrently, so no pollution is even structurally possible).
The accepted trade-off is run time: the full desktop suite went from
~70-90s to ~275-280s locally. Validated per the session's own required
sequence: `HelpPanel.test.tsx` alone, 4 consecutive runs, 11/11 passing
every time; the full suite, plain `pnpm vitest run` (no flag needed — the
config default now applies), **130/130 files, 1185/1185 tests, 0
failures**.

### Verification gaps closed

Two guarantees previously confirmed only by code-signature/inspection
argument, now backed by direct unit tests, extracted the same way Stage 1
Closure closed its own one gap:

- **"Old root remains byte-identical after a successful move"**: new test
  `a_full_stage_and_activate_sequence_leaves_the_source_root_byte_identical`
  in `data_location_manager.rs` manually mirrors `try_move_data`'s real
  hash→copy→activate sequence against real temp files and asserts every
  source file's bytes are unchanged afterward — not just argued from the
  function's own control flow.
- **"Cleanup cannot target the active root"**: extracted a new pure
  function, `is_cleanup_safe(old_root, active_root) -> bool` (canonicalizes
  both sides first), from `cleanup_old_data_location`. Two new direct
  tests: `is_cleanup_safe_refuses_only_when_old_root_is_the_active_root`
  and `is_cleanup_safe_compares_canonicalized_paths_not_raw_strings` (a
  trailing-slash-spelled duplicate of the same path is still refused).

### All 16 required checks — confirmed, with evidence

1. **Automatic backups use the existing backup engine, not a second one**
   — `automatic_backup.rs:25` imports `backup::try_create_backup`/
   `verify_backup_report` directly; `run_automatic_backup_inner` (line
   272) calls `try_create_backup` for every byte written.
2. **Every automatic backup is verified before being kept** —
   `run_automatic_backup_inner` calls `verify_backup_report` immediately
   after writing; anything short of Valid/ValidWithWarnings is deleted on
   the spot (Session 7 design, re-confirmed unchanged this session).
3. **Retention never deletes the final valid backup of a class** —
   `apply_retention_never_deletes_the_only_valid_backup_even_at_zero_keep`
   (`automatic_backup.rs`), asserted even with a configured retention of
   `0`.
4. **Retention is isolated per class in a shared directory** —
   `apply_retention_ignores_other_classes_in_the_same_directory`.
5. **Pre-migration backups get their own retention, applied only after a
   clean run** — `apply_pre_migration_retention` (line 378);
   `migrationRunner.ts`'s `runMigration` calls it via
   `pruneOldPreMigrationBackups` only after `run_completed`, never after a
   failure (Session 7 design, re-confirmed).
6. **A destination move validates before touching anything, and rejects
   conflicting/unrelated destinations** — `validate_destination_at`'s six
   classification kinds (`empty`/`existingCompatibleRoot`/`conflicting`/
   `sameAsCurrent`/`notADirectory`/`unwritable`), tested per-kind in
   Session 8.
7. **A move failure restores the previous pointer** —
   `activate_pointer` (`data_location_manager.rs:624`): reads and holds
   `previous_pointer` before writing, calls `restore_pointer` on both a
   write failure and a post-write resolution mismatch (lines 632-651).
8. **The old data root remains untouched after a successful move** —
   `activate_staged`'s own doc comment ("the source root is never touched
   by this function at all," line 585) plus this session's new byte-
   identity test (above).
9. **`.FormuLab/runs.db` is never copied, moved, or backed up by a move**
   — `walk_movable_files` structurally excludes `RUNS_DB_REL`
   (`data_location_manager.rs:43,86-92`), directly tested at lines
   987-996 (`assert!(!rels.iter().any(|r| r.ends_with("runs.db")))`).
10. **Cleanup cannot target the active root** — `is_cleanup_safe`, this
    session's new closure tests (above).
11. **The automatic-backup destination is remapped correctly after a
    move, and left alone when it should be** — `automatic_backup::remap_path`
    (pure): remaps a destination that was inside the old root to the same
    relative path under the new one, returns `None` (untouched) for a
    destination outside it — both cases unit-tested (Session 8).
12. **The update checker never claims a same-or-older version is an
    update** — `lib/update.ts`'s `check()` (line 280):
    `isNewerVersion(latest.version, s.currentVersion) ? "updateAvailable"
    : "upToDate"` — a same or older reported version always resolves to
    `"upToDate"`, never `"error"` and never `"updateAvailable"` (Session 9
    design, re-confirmed).
13. **Ignored-version suppression never suppresses a genuinely newer
    version** — `derive()` (line 174) re-checks `isNewerVersion` against
    the current `latest` on every call, not just equality-to-ignored; a
    newer version released after an older one was ignored is still
    flagged (Session 9 test, re-confirmed).
14. **Scheduling respects a configurable frequency, not a fixed
    interval** — `shouldAutoCheck(lastCheckedAt, now, frequencyHours)`
    (line 144), user-configurable via `FREQUENCY_OPTIONS_HOURS`.
15. **Duplicate update notifications are prevented** — a separate,
    persisted `notifiedVersion` (line 290): `notifyUpdateAvailable` is
    only called when `!isSameVersion(latest.version, cur.notifiedVersion ?? "")`
    — fires at most once per version.
16. **No installer is ever downloaded or executed, and all update-metadata
    fetching is HTTPS-only and size-capped** — `updates.rs:6-8`'s own doc
    comment ("Does not download, verify, or execute an installer"); `View
    Release / Download` only calls `openExternal(latest.url)` (opens the
    OS browser); `is_https_url`/`fetch_release_metadata_bytes_refuses_a_non_https_endpoint_before_any_request`
    and `enforce_size_limit` enforce HTTPS-only and a capped response size
    before any content is trusted (Session 9, re-confirmed).

### Full test suites — run once, this session

- **Rust** (`cargo test --lib`, `apps/desktop/src-tauri`): **180/180
  passing** (177 prior + 3 new closure tests). `cargo clippy --lib`:
  clean.
- **Desktop suite** (`pnpm vitest run`, plain, no flag):
  **130/130 files, 1185/1185 tests passing** — genuinely, not "clean once
  the known flake is isolated." This is the first Phase 11 session where
  that sentence is literally true.
- **Shared package** (`pnpm --filter @formulab/shared vitest run`):
  **61/61 files, 1251/1251 tests passing**, including `migrations.test.ts`
  (13/13).
- **i18n parity**: 23/23. **Help registry**: 38/38 (`registry.test.ts`)
  plus 9/9 (`tours.test.ts`), run standalone.
- **Desktop typecheck** (`tsc --noEmit`): clean.
- **Desktop lint**: clean.

### Native verification (release build)

Release build: `pnpm tauri build` from `apps/desktop`, produced fresh
`formulab.exe`, `FormuLab_0.4.0_x64_en-US.msi`,
`FormuLab_0.4.0_x64-setup.exe` under `src-tauri/target/release/` (and its
`bundle/msi/`, `bundle/nsis/` subfolders).

Shortcut target confirmed: `C:\Users\sekip\Desktop\FormuLab.lnk` →
`C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
— the exact freshly-built release exe.

`scripts/windows/verify-formulab-phase1.ps1` run against the release exe:

| Check | Result |
|---|---|
| App starts | **Verified** — process launched (PID 17504), stayed running, top-level window appeared with title "FormuLab", app closed cleanly. |
| Existing projects visible / each Settings card opens / log-folder / support-bundle dialog | **Blocked** — no UI-content-reading tool available (see below). |

**Why blocked, honestly**: this environment has no UI Automation content
access, WebDriver/`tauri-driver`, or accessibility-tree reach into the
packaged app's Chromium/WebView2 renderer — the same environment
limitation independently confirmed across Phase 1, Phase 10, and Phase 11
Stage 1's own closures. That script itself is explicit: "Automated UI
interaction verified: NOT PERFORMED BY THIS SCRIPT." No screenshot or
interaction was fabricated for any blocked item this session either.

### Release artifacts

All three built fresh this session, under
`apps/desktop/src-tauri/target/release/`:

| Artifact | Path | Size (bytes) | SHA256 | Signed |
|---|---|---|---|---|
| EXE | `formulab.exe` | 23,527,936 | `C4F1D1405724B8ADD570B997E942669F560784B6D059E20D8F9037D7762B3FED` | **Not signed** |
| MSI | `bundle/msi/FormuLab_0.4.0_x64_en-US.msi` | 37,142,528 | `0305C60006A6067DB982A1CFB8261BC57BF538C81ECA3B5A2A6213F16021DBBA` | **Not signed** |
| NSIS | `bundle/nsis/FormuLab_0.4.0_x64-setup.exe` | 25,418,248 | `742599E31931E71151650BDA278175E79021ABFBD7C2A6ED9C5EF10F3C5CCFED` | **Not signed** |

All three inspected via `Get-AuthenticodeSignature` and confirmed
`NotSigned` — signing was not claimed for any artifact.
Commercial-distribution-stage signing remains fully deferred to Phase 12.

### Remaining limitations (Stage 2, as closed)

- No signed installers, no automatic download/installation, no rollback —
  all explicitly Phase 12.
- No backup history list beyond "last success"/"last failure" for
  automatic runs.
- No Data Location Manager "inspect and choose" UI for interrupted-move
  recovery — exactly one recovery path per journaled state, mirroring
  Session 3's migration-recovery banner precedent.
- `formulab-root.txt`/`active-workspace.txt` remain outside the Data
  Location Manager's writes — a manually-placed override still wins
  silently, surfaced only as a warning.
- The desktop full test suite now runs ~4x slower locally
  (`fileParallelism: false`) — the accepted, disclosed trade-off for a
  suite that passes the same way every time instead of depending on
  scheduling luck.
- Native verification proves process/window launch only, not interior UI
  content — an environment limitation confirmed across four separate
  phase-closure sessions now, not specific to this phase.

### Commit and push

Commit: `chore(phase11): close stage 2 data safety`. `.FormuLab/runs.db`,
`formulas/index.json`, and the two regenerated
`docs/generated/FormuLab-User-Guide.{docx,pdf}` deliberately excluded, per
this session's own instructions and this project's "stage only
current-task files" convention.

## Exact next session

Phase 12 Session 0: Commercial Distribution Assessment. Scope: signed
installers/updates, secure update installation, automatic rollback.
