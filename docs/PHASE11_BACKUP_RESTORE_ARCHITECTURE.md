# Phase 11 Backup, Restore and Verification Architecture

Session 0 (assessment and planning only — nothing in this document is
implemented yet). Grounded in `docs/PHASE11_DATA_INVENTORY.md`'s
inventory and in the real dependencies already present in
`apps/desktop/src-tauri/Cargo.toml`.

## Design constraints this architecture must satisfy

- Real data root: `project_root()` (`formulab-root.txt` else
  `base_workspace_dir()`), never assumed to equal `app_data_dir()`.
- Real, evidenced exclusions: `EBWebView` (contains a plaintext API key
  in `localStorage`, see inventory item 15), `runtime/pipeline`,
  `runtime/formulation`, `runtime/skills` (regenerated code cache, item
  14), `.FormuLab/runs.db` (this session's own never-touch rule, and
  independently disposable/rebuildable per item 8).
- Real, evidenced append-only collections (24 of 90 master collections,
  plus `audit.jsonl`/`runs.jsonl`/`provenance.jsonl`) must never be
  restored in a way that truncates their history.
- `.FormuLab/runs.db` must never be touched by backup or restore code —
  it is excluded from the package and restore never writes to it
  (a post-restore app launch rebuilds it lazily from `runs.jsonl`, per
  `runs_index.rs`'s own stated design).
- Root-pointer files (`formulab-root.txt`, `base-workspace.txt`,
  `active-workspace.txt`) are machine-specific absolute paths — captured
  in the manifest for diagnostic purposes only, never blindly restored
  onto a different machine's filesystem.

## Package format

**Proposed: `.formulab-backup`**, a single file, being a standard ZIP
container (not a custom binary format) with:
- `manifest.json` at the archive root (uncompressed entry, or first
  entry — readable without decompressing the whole archive).
- `data/` — a mirror of the included real-data tree (see inclusion list
  below), stored relative to `project_root()`.
- `runs/` — `.FormuLab/runs.jsonl`, `remote-runs.jsonl`,
  `provenance.jsonl`, `logs/*.txt`, `compute.json` — stored relative to
  `workspace_dir()`/`base_workspace_dir()`, kept in a separate top-level
  folder from `data/` because they resolve under a *different* root
  function (see inventory's root-resolution layer) and must be restored
  to the correct one, not conflated with `project_root()`'s tree.
- No dependency on a new archive format: `Cargo.toml` has no `zip` crate
  today — **this is a new, disclosed dependency Session 1 must add**
  (the standard `zip` crate, pure Rust, matching the "no ad hoc format"
  principle). `sha2` (already a dependency, `Cargo.toml:35`, already used
  for exactly this kind of checksum in `attachments.rs:18,38-39`) covers
  the manifest's hash inventory with no new crate.
- Rejected alternative: a bare directory copy. A single file is easier
  for a user to move/name/attach to a support ticket, and lets the
  manifest be read without walking a whole directory tree first
  (relevant to verification, below).

## Manifest structure (`manifest.json`)

```jsonc
{
  "backupFormatVersion": "1.0",
  "formulabAppVersion": "0.4.0",           // from tauri.conf.json at backup time
  "createdAt": "2026-08-01T12:00:00Z",
  "dataRootIdentifier": {
    // Not the raw absolute path alone — also a stable fingerprint so a
    // restore can detect "this backup came from a different root" even
    // if paths happen to collide across machines.
    "resolvedProjectRoot": "C:\\Users\\...\\Documents\\FormuLab",
    "resolvedWorkspaceRoot": "C:\\Users\\...\\Documents\\FormuLab",
    "formulabRootOverrideActive": false,
    "activeWorkspaceOverrideActive": false
  },
  "schemaVersions": {
    "global": "1.0",                        // reserved; see Migration Architecture doc
    "perCollection": { "materials": "1.0", "formulations": "1.0", "...": "1.0" }
  },
  "included": ["data/formulations", "data/master", "data/sessions", "formulas",
               ".FormuLab/runs.jsonl", ".FormuLab/remote-runs.jsonl",
               ".FormuLab/provenance.jsonl", ".FormuLab/logs", ".FormuLab/compute.json"],
  "excluded": ["data/literature (optional, see inventory item 5)",
               ".FormuLab/runs.db (disposable, rebuilt on next launch)",
               "EBWebView (webview cache + local API key)",
               "runtime/pipeline, runtime/formulation, runtime/skills (regenerated code cache)"],
  "fileInventory": [
    { "path": "data/master/materials.json", "bytes": 12345, "sha256": "..." }
    // one entry per included file — the basis for both the size total
    // and the verification pass below
  ],
  "warnings": ["data/literature was NOT included (network cache, excluded by default)"],
  "compatibility": {
    "minSupportedAppVersion": "0.4.0",
    "maxKnownAppVersion": "0.4.0"
  }
}
```

Every field above is derived from something this session confirmed
exists (`tauri.conf.json`'s `version`, the per-record `schemaVersion`
literals, the exclusion list backed by the inventory doc) — nothing is
invented ahead of Session 1 actually building it.

## Backup creation — staging and atomic finalization

1. **Stage** into a temporary directory beside the final destination
   (same volume, so the final move is a rename, not a copy — matching
   the existing `write_array`'s write-then-rename discipline in
   `masterdata.rs:427-435`).
2. Walk the inclusion list, hashing each file with `sha2` as it is
   copied (same crate/pattern as `attachments.rs:38-39`'s
   `sha256_hex`).
3. Write `manifest.json` last, once every file's size/hash is known.
4. Zip the staging directory into `<name>.formulab-backup.tmp`.
5. **Atomic finalization**: rename `.tmp` to the final `.formulab-backup`
   name only after the zip write completes and its own central directory
   has been read back successfully (a cheap self-check: open the just
   written archive and confirm the manifest entry round-trips) — the
   same "don't call it done until you can read it back" discipline the
   inventory's write-then-rename pattern already uses elsewhere.
6. **Interrupted-backup handling**: a crash before step 5 leaves only a
   `.tmp` file, which a later backup run (or a cleanup pass) recognizes
   by extension and discards — never treated as a valid backup, never
   left silently masquerading as one.

## Restore — staging and safety

1. **Verify first** (see Backup Verification below) — restore never
   begins against an unverified package.
2. **Safety backup of current data before restore**: create a fresh
   backup of the *current* `project_root()`/`workspace_dir()` state,
   using this same mechanism, before touching anything — restore failure
   must never be able to leave the user with neither the old nor the new
   data.
3. **Stage** the restore into a temporary directory (not directly onto
   live files), fully extracted and re-verified (hash-checked against
   the manifest a second time, post-extraction, to catch a truncated
   unzip) before any live file is touched.
4. **Compatibility check** against `manifest.json`'s
   `backupFormatVersion`/`formulabAppVersion`/`schemaVersions` — see
   Migration Architecture doc for what happens when the backup is from
   an older schema version (migration integration point).
5. **Locked-file handling**: if the running app currently holds a file
   open in the destination (in practice: none of `masterdata.rs`'s
   writers hold files open, all are open-write-close, but a live restore
   should still assume the app could be mid-write) — restore must run
   with the app either fully quit or with write commands paused; staging
   to a temp dir first (step 3) means a lock is only ever hit at the
   final swap-in step, minimizing the exposure window.
6. **Validation before activation**: after copying staged files into
   place, re-read a sample of restored master-data collections through
   the real Zod schemas (matching this repo's existing
   `.parse()`-against-real-schema discipline used by the Phase 10
   fixture builder) before declaring restore complete.
7. **Rollback on restore failure**: if validation (step 6) fails, restore
   from the safety backup created in step 2 — never leave a partially
   restored, partially validated data root as the live state.
8. **Cancellation**: any point before the final swap-in (step 3's staging
   is complete but not yet copied over live files) can cancel cleanly by
   discarding the staging directory; cancellation after the swap begins
   is not offered as a partial rollback — the whole restore either
   completes or falls back to the step-2 safety backup, per step 7.

## Full restore only, not partial

Per this session's explicit instruction: full restore is the first
target, and partial restore is not invented without evidence the data
model makes it safe. Evidence found this session that argues *against* a
naive partial restore: `formulation.rs`'s versions are immutable and
referenced only by directory nesting (no cross-collection foreign keys
to reconcile), which suggests a per-collection partial restore *could*
eventually be safe — but `masterdata.rs`'s append-only collections
(24 of 90) would need explicit merge-vs-replace semantics for a partial
restore to avoid silently truncating history, which is unresolved and
therefore out of scope until a dedicated session designs it.

## Backup verification (standalone, does not restore)

Runs against a `.formulab-backup` file without extracting it beyond
reading the manifest and per-file hashes.

Checks:
- Archive readability (zip central directory parses).
- `manifest.json` present, well-formed JSON, matches its own declared
  schema.
- `backupFormatVersion` recognized (not future, not pre-historic).
- Every path in `fileInventory` exists in the archive; no unexpected
  extra paths outside the manifest's `included` set.
- No duplicate archive paths (a zip can technically contain the same
  path twice — reject on sight).
- No path-traversal entries (`../`, absolute paths, drive-letter paths)
  — reject the whole archive rather than sanitize and continue.
- No symbolic links or junction entries in the archive (zip supports a
  symlink bit; refuse it outright — a restored symlink could point
  anywhere on the target machine).
- Declared file sizes/hashes match actual decompressed bytes for every
  entry.
- `formulabAppVersion`/`schemaVersions` checked against what this build
  supports — future-versioned fields are flagged as "unsupported schema
  version," not silently accepted.
- JSON entries are parsed, not just size/hash-checked, catching a
  corrupted-but-right-length file.
- `.FormuLab/runs.db` must never appear in a valid backup — its presence
  is itself flagged as `unsafe` (a violation of this project's own
  never-touch rule, and evidence the backup was produced by tooling that
  didn't respect the exclusion list).
- No executable content (`.exe`/`.dll`/`.sh` etc. — none should ever be
  in scope, so any occurrence is `unsafe`, not merely unexpected).
- No absolute paths recorded inside `data/`/`runs/` archive entries
  themselves (only the manifest's `dataRootIdentifier` may carry an
  absolute path, and only as metadata, never as an extraction target).

Statuses:
- **valid** — every check passes, versions current.
- **valid with warnings** — passes, but e.g. `data/literature` excluded,
  or an append-only collection has more revoked-then-reissued rows than
  usual (informational, never blocking).
- **incompatible** — well-formed and uncorrupted, but
  `backupFormatVersion`/`formulabAppVersion`/a collection's
  `schemaVersion` is one this build cannot read (distinct from
  corruption: the bytes are fine, the *shape* isn't supported yet, or is
  from a newer build than this one).
- **corrupted** — bytes don't match declared hashes/sizes, JSON fails to
  parse, or the zip central directory itself is damaged.
- **unsafe** — path traversal, symlink entries, executable content, or a
  present `.FormuLab/runs.db` (see above).

Corruption and incompatibility are always reported as distinct statuses
— never conflated, per this session's explicit instruction.

## Session 2 implementation notes (what actually shipped)

`verify_backup_report(source: &Path) -> VerificationReport`
(`backup.rs`) — takes only a `&Path`, no `AppHandle`, so it cannot resolve
`project_root()`/`workspace_dir()` even in principle; "never modifies the
active data root" holds by the function's own signature.

- **No second parser**: `open_zip`/`read_manifest_from_archive`/
  `entry_safety_violation` were extracted out of the Session 1 restore
  path and are now shared by restore, `inspect_backup`, the backup
  self-check, and verification alike.
- **Status precedence**: `Unsafe > Corrupted > Incompatible >
  ValidWithWarnings > Valid` — every check runs to completion (not
  short-circuited) once the manifest parses, and the single worst tier
  reached is reported.
- **Checks implemented, mapped to status**:
  - `archive_unreadable`, `manifest_unreadable`, `missing_file`,
    `size_mismatch`, `hash_mismatch`, `malformed_json` → **Corrupted**.
  - `unsupported_backup_format_version`, `unsupported_app_version`
    (via a minimal `major.minor.patch` comparator against the manifest's
    `compatibility.min/max`), `unsupported_schema_version` (per
    `schema_versions` entry) → **Incompatible**.
  - `unsafe_path` (traversal/absolute/drive-letter/symlink/directory-
    entry/prohibited-extension, reusing `entry_safety_violation`),
    `duplicate_path`, `runs_db_present`, `prohibited_path` (an entry
    outside the same allow-list `archive_path_to_live` uses) → **Unsafe**.
  - `unexpected_file` (present in the archive, safe, allow-listed, but
    not declared in `manifest.file_inventory`) and any
    `manifest.warnings` entry → **ValidWithWarnings** (when nothing worse
    was found).
- **Real constraint discovered this session**: `zip::ZipWriter` (the
  crate this project uses to *write* `.formulab-backup` packages) refuses
  to write two entries sharing a name — confirmed directly in a test. A
  duplicate-path package is therefore not producible via this project's
  own tooling; the `duplicate_names()` detection remains as defense in
  depth against a hand-crafted or differently-produced archive, tested at
  the pure-function level rather than through a full package round-trip
  that cannot exist.
- **UI**: `BackupRecoveryCard` gained a third, independent action —
  Verify Backup — never offering to restore from within the verify flow.
- **Not built this session** (deferred, as scoped): a backup history
  list, a CLI/exportable verification report, automatic verification on
  a schedule.

## Known open questions from Session 0 — resolved in Session 1

- `data/master/backups/<collection>-<timestamp>.json` (the ad hoc
  pre-delete snapshot mechanism): **left exactly as-is, not superseded.**
  The new backup system structurally never walks
  `data/master/backups/` (only top-level `data/master/*.json` files are
  collected — `backup.rs`'s `collect_master_files` does not recurse), so
  the two mechanisms coexist without overlap or duplication.
- `data/literature`: **excluded by default, decision final.** Confirmed
  by re-reading `runtime/pipeline/literature_cache.py` — it stores
  `pdfs/<doi>.pdf`, a network cache of open-access papers keyed by DOI,
  re-fetchable through ordinary use, not user-authored. When the
  directory exists and holds files, `collect_included()` records an
  explicit manifest warning naming why it was skipped.
- Disk-space validation: implemented via the `fs4` crate's
  `available_space()` (a new, disclosed dependency — `std::fs` has no
  portable free-space API), checked against the real summed file sizes
  plus a 10% margin, before any file is opened for hashing/writing. A
  filesystem `fs4` cannot query is not treated as a hard failure — the
  write itself will fail cleanly if space genuinely runs out.

## Session 1 implementation notes (what actually shipped)

- **Package format confirmed**: `zip` crate v2 (`deflate` feature only,
  `default-features = false` — no bzip2/zstd/AES needed for this use).
  `SimpleFileOptions` (the `FileOptions<'static, ()>` alias in zip 2.x)
  is used for every entry, compression method Deflated.
- **Manifest `formulabAppVersion`**: read from `env!("CARGO_PKG_VERSION")`
  at compile time, not a runtime read of `tauri.conf.json` — the two are
  kept in sync manually today (`Cargo.toml` and `tauri.conf.json` both
  say `0.4.0`) and the compile-time constant is the more authoritative
  source for what the *running binary* actually is.
- **Atomicity**: exactly as planned — stage to `<destination>.tmp`,
  self-check by reopening and re-parsing the manifest, then
  `remove_file` (if a stale file with the final name exists) +
  `rename`. Every error path between `.tmp` creation and the final
  rename removes the `.tmp` file before returning.
- **Restore activation**: implemented with a rename-aside mechanic
  (`<live path>.pre-restore-<timestamp>.bak`) rather than only relying
  on the safety-backup archive for rollback — this makes rollback a
  guaranteed local filesystem operation (no re-unzipping needed) while
  the safety backup archive still exists as the durable, user-visible
  fallback. Both are produced; the rename-aside copies are deleted only
  after every file activates successfully.
- **Archive-path safety is an allow-list, not a denylist**: restore maps
  every archive-relative path back to a live path through a fixed set
  of known prefixes (`data/formulations/`, `data/master/`,
  `data/sessions/`, `formulas/`, and the specific `.FormuLab/*` file
  names) — anything else, including a technically-safe-looking but
  unrecognized path, is rejected. This is stricter than the traversal/
  absolute-path/symlink checks alone and was added during implementation
  as a defense-in-depth measure beyond what this document originally
  specified.
- **Structural validation limitation**: restore's "available structural
  check" is JSON-parses-cleanly for every `.json` entry — a full
  per-collection Zod pass is TypeScript-side and is not invoked from
  this Rust-only foundation. Recorded as a real, disclosed limitation,
  not silently treated as equivalent to schema validation.

## Stage 1 Closure (verification session)

- **`activate_staged_files` extracted** from `try_restore_backup`: a pure,
  `AppHandle`-free function `(staged: &[(String, PathBuf)], staging_dir:
  &Path) -> Result<Vec<PathBuf>, String>` that does the rename-aside /
  copy-from-staging / rollback-on-failure work restore's activation phase
  already did inline. Extracted specifically so "restore failure preserves
  the original data" — previously verified only by code inspection — could
  get a direct Rust unit test without needing a mocked `AppHandle` (a real
  `tauri::test::mock_app()` was investigated and rejected: its
  `mock_context()` uses an empty `identifier`, which resolves
  `app.path().app_data_dir()` unpredictably outside test isolation — unsafe
  for a verification-only session under "never modify real user data").
  Three new tests cover it directly: rollback restores original content on
  a mid-activation failure, a clean run leaves no aside copies behind, and
  a brand-new file (no prior live file) activates correctly.
- Two `clippy::type_complexity` warnings closed with named type aliases
  (`IncludedFile`, `HashedFile`) rather than suppression — no behavior
  change.
- Full Rust suite after this refactor: **136/136 passing** (133 prior + 3
  new), `backup::` module alone 21/21. `cargo clippy --lib` clean.
- No new feature, no format change, no behavior change to `try_restore_backup`
  itself — this is a test-ability refactor closing a real verification gap,
  not new functionality.
  not silently treated as equivalent to schema validation.

## Session 7 — automatic backups (Stage 2, complete)

New module `apps/desktop/src-tauri/src/automatic_backup.rs`. Builds
entirely on top of this document's Session 1-2 engine — `try_create_backup`
and `verify_backup_report` are called directly, unmodified; this session
adds no second backup format and no second write path.

### Package naming and destination, per class

| Class | Filename pattern | Destination |
|---|---|---|
| `daily` | `formulab-auto-daily-<epoch>.formulab-backup` | user-configured destination folder |
| `weekly` | `formulab-auto-weekly-<epoch>.formulab-backup` | user-configured destination folder |
| `preMigration` | `pre-migration-<epoch>.formulab-backup` (Session 3's existing naming, unchanged) | app-private `backups/` dir (never user-relocatable — matches its existing mandatory-per-migration-run design) |

A backup-on-exit trigger is classified `daily` — a deliberate choice
(documented in `PHASE11_CURRENT.md`'s Session 7 summary), not a fourth
class, so it also satisfies that day's own daily-backup eligibility.

### Run sequence (`run_automatic_backup_inner`)

1. Resolve the class's destination directory. Daily/weekly: the
   configured folder, validated to actually exist as a directory —
   missing/moved is reported as `"destination folder does not exist:
   <path>"`, unset as `"no automatic backup destination folder is
   configured"`, two distinct messages so a failure record is
   diagnosable at a glance. Pre-migration: `app_private_dir(app,
   "backups")`, same as Session 3.
2. `try_create_backup` — identical staging/hashing/atomic-rename flow
   Session 1 built, including its existing disk-space check
   (`fs4::available_space`, required = total bytes + 10% margin) and its
   own `.tmp`-file cleanup on failure.
3. **Mandatory verification**: `verify_backup_report` on the just-written
   package. Anything short of `Valid`/`ValidWithWarnings` deletes the
   package immediately and returns a failure record carrying the
   verification status — an automatic backup is never left on disk
   pretending to be valid.
4. **Retention**, only reached after a verified-good backup: `apply_retention`
   removes any stray `<prefix>...formulab-backup.tmp` orphaned by a
   crash mid-write (a later run's own cleanup, since a same-process
   failure already removes its own `.tmp`), then prunes to the class's
   configured count, oldest first, with a hard floor of 1 regardless of
   the configured number — the "never delete the only valid backup" rule
   holds even for a misconfigured `0`.

Retention is skipped entirely on a failed run — a failure's own backup
(or lack of one) is never touched, so a bug in a later run can never
cascade into deleting the last known-good backup of a class.

### Concurrency

`run_automatic_backup` takes `State<'_, BackupState>` — the exact same
`Mutex<Option<Arc<AtomicBool>>>` manual `create_backup`/`restore_backup`
already hold for the duration of their run (Session 1). If that slot is
already occupied, an automatic run reports itself as a normal failed
`AutomaticBackupRunRecord` ("another backup or restore is already in
progress") rather than throwing — a scheduling collision with a manual
backup, a restore, or another automatic run (same or a second app
instance, guarded upstream by the existing single-instance plugin) is an
expected, recoverable condition, not a bug.

### Settings and run-history persistence

App-private `automatic_backup_state.json`
(`{ config, lastDailyAt, lastWeeklyAt, lastSuccess, lastFailure }`),
write-then-rename like every other JSON write in this codebase. Not
localStorage (unlike `lib/update.ts`'s auto-check settings) — this
describes where real backup files land on disk, so it needs to survive
exactly as long as the backups it describes, in app-private storage the
user doesn't casually clear.

### No background service — the honest limitation

FormuLab has no OS-level scheduled task, system service, or tray-resident
process. Every automatic backup — scheduled or on-exit — only runs while
the app is the foreground process:

- **On launch**: `AppShell` calls `installAutomaticBackupLifecycle()`
  (`apps/desktop/src/lib/automaticBackup.ts`), which refreshes state and
  immediately checks eligibility once.
- **While open**: a 30-minute interval (`SCHEDULE_CHECK_INTERVAL_MS`)
  re-checks eligibility — fine-grained enough that a daily/weekly backup
  runs within half an hour of becoming due, without polling excessively.
- **On exit**: `getCurrentWindow().onCloseRequested` (Tauri's window-close
  hook) prevents the default close, runs a (daily-classed) backup if
  enabled, then calls `window.close()` again — best-effort: a failed
  exit backup is recorded as `lastFailure` but never traps the user in an
  unclosable window.

A day or week the app is never opened has no automatic backup for that
day or week. This is stated in the Settings card itself and in the
`settings` Help topic (`warnings.5`, all 8 locales) — not a gap discovered
later, a limitation this session's own instructions required disclosing
honestly rather than building a background service to hide it.

### Pre-migration retention — a real pre-existing gap closed

Session 3's `create_pre_migration_backup` had no retention at all —
every migration run added one more file to app-private storage,
unbounded, forever. This session adds `apply_pre_migration_retention`
(reusing the same `apply_retention` function daily/weekly use) and wires
it into `migrationRunner.ts`'s `runMigration`: called once, after a clean
`run_completed`, using the configured `retentionPreMigration` (default
2) regardless of whether the "automatic backups" master toggle itself is
on — a pre-migration backup is mandatory per migration run, not part of
that schedule, so its retention isn't gated by it either. Never called
after a failed run: a failed run's own pre-migration backup is exactly
what a user, or `recoverInterruptedMigration` on next launch, may still
need to restore from.

### Tests

12 new Rust tests, all against pure functions that take no `AppHandle`
(`configured_destination_dir`, `apply_retention`, `backup_epoch_from_name`,
`retention_for`, `class_file_prefix`, `status_str`) — the same
"AppHandle-free where possible" discipline the Stage 1 Closure session
established for `verify_backup_report`, avoiding the unsafe mocked-
`AppHandle` workaround that session investigated and rejected. Full Rust
suite **148/148**, `cargo clippy --lib` clean. Frontend: 21
`automaticBackup.test.ts` tests + 12 `AutomaticBackupCard.test.tsx` tests
+ 3 `migrationRunner.test.ts` retention tests — see
`PHASE11_CURRENT.md`'s Session 7 summary for the full breakdown.

## Stage 2 Closure (verification session)

Two guarantees this document (and Sessions 7-8) had previously argued
only from control flow / code signature were closed with direct tests,
following the same discipline the Stage 1 Closure section above
established:

- **"The old data root is never touched by a successful move"** — a new
  test in `data_location_manager.rs`,
  `a_full_stage_and_activate_sequence_leaves_the_source_root_byte_identical`,
  manually replays the real hash→copy→activate sequence against actual
  temp files and asserts every source byte is unchanged afterward.
- **"Cleanup cannot target the active root"** — `cleanup_old_data_location`
  now delegates to a new pure function, `is_cleanup_safe(old_root,
  active_root) -> bool` (canonicalizes both sides), directly tested
  including a trailing-slash-spelled duplicate of the active path (still
  refused).

The `HelpPanel.test.tsx` jsdom/undici `AbortSignal` flake — present since
before Phase 11 and only ever documented as a known limitation in every
prior session that touched the full desktop suite (Stage 1 Closure,
Sessions 7-9) — was root-caused and genuinely fixed this session rather
than documented again. Full investigation, including two ruled-out fix
attempts, lives in `PHASE11_CURRENT.md`'s Stage 2 Closure section; the
fix itself is a one-line `apps/desktop/vite.config.ts` change
(`test.fileParallelism: false`). Full Rust suite **180/180**, desktop
suite genuinely **1185/1185** (no isolated-flake caveat).
