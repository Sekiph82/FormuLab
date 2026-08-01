# Phase 11 — Backup, Restore and Data Safety

## Status: SESSION 1 (Backup and Restore Foundation) COMPLETE. Awaiting Session 2.

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

## Exact next session

**Phase 11 Session 2: Backup Verification.**
