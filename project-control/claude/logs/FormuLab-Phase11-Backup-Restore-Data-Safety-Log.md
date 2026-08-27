# FormuLab Phase 11 — Backup, Restore and Data Safety — External Log

Active external log for Phase 11. Lives on the Desktop per approved
exception; never moved into the repository, never renamed.

---

## Session 0 — Backup, Restore and Data Safety Assessment

**Objective**: assessment and planning only for Phase 11's first stage
(backup/restore, backup verification, schema migration, active
data-location clarification, basic diagnostics/log export). No
implementation, no data movement.

**Initial HEAD**: `3ce0e9932d5f5c7bd4f3c6aae784057026aca639`
**Upstream HEAD at start**: `3ce0e9932d5f5c7bd4f3c6aae784057026aca639`
(match — branch was clean relative to remote at session start, aside
from two pre-existing working-tree modifications noted below).

**Pre-existing working-tree state at session start** (not caused by
this session, not touched): `M .FormuLab/runs.db`, `M formulas/index.json`.
Both are real, pre-existing modifications on this dev machine's own
live FormuLab data (this checkout doubles as the developer's real
project — see the Data Inventory doc). Left exactly as found.

### Files and systems inspected
- `AGENTS.md`, `docs/architecture/IMPLEMENTATION_STATUS.md` (partial,
  first 835 lines — phase history through Phase 10 Session 5),
  `docs/handoffs/PHASE10_CURRENT.md` (partial, first 830 lines),
  `docs/FORMULAB_FILE_CONSOLIDATION_REPORT.md` (full).
- `apps/desktop/src-tauri/src/`: `formulation_v2.rs`, `workspace.rs`,
  `masterdata.rs`, `formulations.rs`, `materials.rs`, `formulation.rs`,
  `attachments.rs`, `runs.rs`, `runs_index.rs`, `debug_log.rs`,
  `provenance.rs`, `compute.rs`, `lib.rs`, `Cargo.toml`,
  `tauri.conf.json`.
- `apps/desktop/src/lib/store.ts`, `apps/desktop/src/lib/formulationV2.ts`,
  `apps/desktop/src/app/routes/SettingsPage.tsx`.
- `packages/shared/src/engine/migrations.ts`,
  `packages/shared/src/engine/migrations.test.ts`, `docs/MIGRATIONS.md`.
- `packages/shared/src/schemas/*` (grepped for `schemaVersion`, 24 files
  confirmed).
- `.gitignore`, `git ls-files` for `formulas`/`data`/`.FormuLab`,
  `formulas/index.json` (read directly).

### Current storage findings (see `docs/PHASE11_DATA_INVENTORY.md` for full detail)
- All real user data (formulations, 90 master-data collections,
  sessions, formulas library, attachments) resolves under
  `formulation_v2::project_root()`.
- The kernel/notebooks/provenance/artifact/run-log surface resolves
  under a *separate* function, `workspace::workspace_dir()`
  (active-workspace override) / `base_workspace_dir()` (base override).
- `.FormuLab/runs.jsonl` (authoritative) is written under the **active**
  workspace; `.FormuLab/runs.db` (its derived, disposable SQLite index)
  is read/written under the **base** workspace — these are the same
  directory unless `active-workspace.txt` has ever been set, a real
  divergence risk with no existing reconciliation, precedented by
  `compute.rs`'s own explicit base/active materialization logic for a
  *different* file (`compute.json`).
- `data/master/backups/<collection>-<timestamp>.json` is an existing ad
  hoc pre-destructive-change snapshot mechanism (`masterdata.rs`), unbounded
  growth, no pruning — a real, pre-existing partial-backup precedent
  Session 1 should reconcile with, not duplicate blindly.
- Real git-tracking anomaly: `.gitignore` marks `/data/` and `/formulas/`
  ignored, yet `formulas/*.md` + `formulas/index.json` and
  `.FormuLab/runs.db` are tracked in git regardless (pre-dating the
  ignore rule; `.gitignore` cannot retroactively untrack). Recorded, not
  corrected.

### Active data-root findings
- Three independent pointer files
  (`formulab-root.txt`/`base-workspace.txt`/`active-workspace.txt`, all
  under `app_data_dir()/runtime/`), two resolution functions, zero
  reconciliation between them.
- `formulab-root.txt` has no writer and no exposing Tauri command
  anywhere in the codebase (`lib.rs`'s `invoke_handler` registers only
  `workspace_path`/`workspace_base`/`set_workspace_base`/
  `open_workspace_base`) — manual-edit-only, invisible to the UI.
- Settings (`SettingsPage.tsx`) displays only `workspaceBase()` — if a
  `formulab-root.txt` override is manually placed, Settings would show
  the wrong root relative to where real data actually lives. A genuine,
  evidenced "silently choose the wrong root" scenario, not hypothetical.
- Malformed or missing-target pointer files silently fall through to the
  next fallback with no surfaced error, in both resolution functions.

### Backup architecture decisions
- Single-file `.formulab-backup` (ZIP container), not a bare directory
  copy or a custom binary format.
- New dependency required: the `zip` crate (not currently in
  `Cargo.toml`) — disclosed, not silently assumed. `sha2` (already a
  dependency, already used identically in `attachments.rs`) covers
  hashing, no new crate needed there.
- Manifest carries format version, app version, per-collection +
  reserved global schema version, root identity/fingerprint, full file
  inventory with size+SHA256, explicit included/excluded lists, warnings,
  compatibility metadata.
- Explicit, evidenced exclusions: `EBWebView` (webview cache + plaintext
  API key), `runtime/pipeline`/`runtime/formulation`/`runtime/skills`
  (regenerated code cache), `.FormuLab/runs.db` (never-touch +
  disposable).
- `data/literature` left as an open, undecided inclusion question for
  Session 1 (network cache, ambiguous regenerability) rather than
  guessed here.

### Restore architecture decisions
- Full restore only, this stage — partial restore explicitly not
  designed, pending evidence on safe per-collection semantics for the 24
  append-only collections.
- Mandatory safety backup of current state before any restore begins.
- Stage-then-atomic-swap, re-verify post-extraction, validate against
  real Zod schemas before declaring restore complete, roll back to the
  safety backup on any validation failure.
- Root-pointer files are captured for diagnostics only, never blindly
  restored onto a different machine (absolute-path portability risk).

### Verification architecture decisions
- Standalone, archive-only inspection (manifest + hashes), no
  extraction beyond what's needed to check them.
- Five statuses: valid / valid with warnings / incompatible / corrupted /
  unsafe — corruption and incompatibility kept explicitly distinct.
- A present `.FormuLab/runs.db` inside an archive is itself grounds for
  `unsafe` — a direct test of this session's own never-touch rule.

### Migration architecture decisions
- Builds on the existing, real, tested
  `packages/shared/src/engine/migrations.ts` runner — registered against
  zero collections today (every one of 90 collections has only ever
  shipped `schemaVersion: "1.0"`, confirmed by grep + `docs/MIGRATIONS.md`).
- Adds: a global application-data schema version (new, doesn't exist
  today), a migration `id` field (missing from the current
  `SchemaMigration` shape), an optional `validate` hook, an append-only
  migration journal, mandatory pre-migration verified backup,
  interrupted-migration recovery via that backup, future-version
  rejection at the storage layer, an explicit `reversible` flag.
- Explicitly does not invent a migration for any existing collection —
  none has a real version change to migrate from yet.

### Diagnostics architecture decisions
- No crash-dump mechanism exists today (confirmed zero matches for
  Sentry/crash-report/panic-hook/ErrorBoundary) — none claimed.
- Diagnostics summary command assembles version/OS/arch/active-path/
  root-resolution-source/writable/free-disk/schema-version/migration-
  status/backup-status/recent-errors/log-dirs/storage-health/
  collection-health — table in the architecture doc marks each field
  available-today vs. new plumbing.
- Support bundle: sanitized summary + bounded logs + backup **metadata
  only** (never contents) + redacted config — explicit redaction rules
  for Windows usernames, absolute paths, API keys (never read from
  `localStorage` by the bundle generator at all), credentials, formula/
  project/customer content, file contents, PII.

### Risks
- Silent wrong-root selection via an invisible `formulab-root.txt`.
- `runs.jsonl`/`runs.db` active-vs-base divergence with no existing
  reconciliation.
- Unbounded `data/master/backups/` growth (pre-existing, unrelated to
  this phase's new work but adjacent to it).
- Git-tracked `formulas/`+`runs.db` anomaly vs. `.gitignore`'s stated
  intent.
- `masterdata.rs`'s `read_array` silently treats a corrupted collection
  file identically to an empty one (`masterdata.rs:418-423`) — a real
  gap the diagnostics health check should close, not previously
  documented anywhere found this session.

### Blockers
None. Assessment completed without needing user input.

### Deferred items
- Second stage: automatic backups, Data Location Manager, update
  checker — dependencies noted in `docs/handoffs/PHASE11_CURRENT.md`,
  not designed.
- Commercial-distribution stage: signed installers/updates, automatic
  rollback — not designed at all this session.

### Inspection commands run
See the Method/evidence sections of each of the four new architecture/
inventory docs for the exact command list (not duplicated here to avoid
drift between two copies of the same list).

### Repository documentation created
- `docs/handoffs/PHASE11_CURRENT.md`
- `docs/PHASE11_DATA_INVENTORY.md`
- `docs/PHASE11_BACKUP_RESTORE_ARCHITECTURE.md`
- `docs/PHASE11_MIGRATION_ARCHITECTURE.md`
- `docs/PHASE11_DIAGNOSTICS_ARCHITECTURE.md`
- `docs/PHASE11_TEST_MATRIX.md`

### Commit
`4c501e6d6e2abe1d25acc7d76702e2911ed81114` —
`docs(phase11): assess backup restore and data safety` (6 files changed,
1216 insertions, 0 deletions — the 6 new docs only; `.FormuLab/runs.db`
and `formulas/index.json` were left staged out and untouched).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`3ce0e99..4c501e6`), no force, no conflicts.

### Final HEAD
`4c501e6d6e2abe1d25acc7d76702e2911ed81114` — matches
`origin/feature/laboratory-stability` exactly.

### Exact next session
**Phase 11 Session 1: Backup and Restore Foundation.**

---

## Session 1 — Backup and Restore Foundation

**Objective**: implement the backup and restore foundation planned in
Session 0 — a portable `.formulab-backup` ZIP package, full restore with
a mandatory pre-restore safety backup and rollback, and a bounded
Settings UI section.

**Initial HEAD**: `4c501e6d6e2abe1d25acc7d76702e2911ed81114`
**Upstream HEAD at start**: same (clean, matched).

**Pre-existing working-tree state at session start** (not caused by this
session, not touched): `M .FormuLab/runs.db`, `M formulas/index.json` —
same two files noted in Session 0, still untouched.

### Files and systems touched
- New: `apps/desktop/src-tauri/src/backup.rs` (manifest, create/restore
  commands, 5 unit tests).
- Edited: `apps/desktop/src-tauri/src/lib.rs` (module registration,
  `BackupState`, 6 new commands), `apps/desktop/src-tauri/Cargo.toml`
  (new `zip` and `fs4` dependencies, disclosed).
- New: `apps/desktop/src/components/settings/BackupRecoveryCard.tsx` +
  `BackupRecoveryCard.test.tsx` (12 tests).
- Edited: `apps/desktop/src/lib/tauri.ts` (backup/restore invoke
  wrappers + progress-event listeners), `apps/desktop/src/app/routes/SettingsPage.tsx`
  (mounts the new card under General).
- Edited: `apps/desktop/src/i18n/locales/*/settings.json` (all 8
  locales — `backup.*` keys, full genuine translation),
  `apps/desktop/src/i18n/locales/*/help.json` (all 8 locales —
  `settings.sections.0` extended, `settings.warnings.0` added),
  `apps/desktop/src/lib/help/registry.ts` (`warningKeys` wired to the
  existing `settings` topic — no new topic).
- Docs: `docs/handoffs/PHASE11_CURRENT.md`,
  `docs/PHASE11_BACKUP_RESTORE_ARCHITECTURE.md`,
  `docs/PHASE11_DATA_INVENTORY.md`, `docs/PHASE11_TEST_MATRIX.md`,
  `docs/USER_GUIDE.md` (new §28a).

### Backup behavior implemented
Full scan → hash every included file (SHA256) → disk-space check
(`fs4::available_space`, required = total + 10%) → write to
`<destination>.tmp` → self-check (reopen, re-parse manifest) → atomic
rename. Progress events (`backup-progress`) and real cancellation
(checked between files during both hashing and writing) both work; any
failure after `.tmp` creation removes it.

**Included**: `data/formulations/**`, `data/master/*.json` (top-level
only — `data/master/backups/` never walked), `data/sessions/**`,
`formulas/**`, `.FormuLab/{runs.jsonl,remote-runs.jsonl,provenance.jsonl,
logs/*.txt}` (workspace root), `.FormuLab/compute.json` (base root).

**Excluded, structurally**: `.FormuLab/runs.db` (never referenced by any
scan path — not merely filtered), `EBWebView`/`localStorage` (outside
this crate's filesystem reach; holds the plaintext per-provider API
key), `runtime/pipeline`/`runtime/formulation`/`runtime/skills`
(materialized code cache), `data/master/backups/` (existing ad hoc
mechanism, left alone).

**`data/literature` decision (final)**: excluded by default. Re-read
`runtime/pipeline/literature_cache.py` this session — it stores
`pdfs/<doi>.pdf`, a network cache of public open-access papers keyed by
DOI, re-fetchable through ordinary use. A manifest warning names it
explicitly when the directory exists and holds files.

### Restore and rollback behavior
Manifest read → every archive entry checked against an **allow-list** of
known path prefixes (stricter than a traversal/symlink denylist alone —
an unrecognized-but-technically-safe-looking path is still rejected) →
real safety backup of current data created via the same backup
mechanism → staged extraction with size+SHA256+JSON-parses verification
per file → activation via rename-aside (`<path>.pre-restore-<ts>.bak`)
then copy-in, with full rollback (aside copies restored) on any
mid-activation failure. Root-pointer files
(`formulab-root.txt`/`base-workspace.txt`/`active-workspace.txt`) are
never read or written by restore — only this machine's own currently
resolved root is ever touched.

### UI behavior
`BackupRecoveryCard` in Settings → General: idle (Create/Restore) →
creating (live progress + cancel) → done (file count/size + warnings)
or failed; restore adds an inspect step showing the manifest summary and
warnings before an explicit confirmation is required to proceed.

### Tests
Rust: 5 new (`backup.rs`), full suite 88/88. TypeScript: 12 new
(`BackupRecoveryCard.test.tsx`), all passing. i18n parity 23/23. Help
registry 38/38 (unchanged — extended existing topic). Typecheck clean.
Lint clean. Full desktop suite not run (no shared Settings/global shell
change — only one conditional block in `SettingsPage.tsx` plus new,
already-tested files).

### Limitations
No backup history list, no standalone verify-without-restoring (Session
2), no automatic/scheduled backups — all explicitly out of scope this
session. Restore's structural check is JSON-parses-cleanly only, not a
full per-schema Zod pass (that lives client-side in TypeScript, not
invoked from this Rust-only foundation).

### Risks / blockers
None new. Same pre-existing risks from Session 0 remain relevant
(silent wrong-root selection via `formulab-root.txt`, `runs.jsonl`/
`runs.db` active-vs-base divergence) — neither touched or worsened by
this session's work.

### Deferred items
Unchanged from Session 0: second stage (automatic backups, Data
Location Manager, update checker) and commercial-distribution stage
(signing, rollback) remain undesigned.

### Inspection/verification commands run
`cargo check --lib`, `cargo test --lib backup::`, `cargo test --lib`
(full, 88/88), `pnpm vitest run src/components/settings/BackupRecoveryCard.test.tsx`,
`pnpm vitest run src/components/settings` (28/28), `pnpm vitest run
src/i18n src/lib/help` (100/100), `pnpm typecheck`, `pnpm lint`, plus a
`node -e "JSON.parse(...)"` syntax check on all 16 touched locale JSON
files (8× `settings.json`, 8× `help.json`).

### Repository documentation updated
`docs/handoffs/PHASE11_CURRENT.md`, `docs/PHASE11_BACKUP_RESTORE_ARCHITECTURE.md`,
`docs/PHASE11_DATA_INVENTORY.md`, `docs/PHASE11_TEST_MATRIX.md`,
`docs/USER_GUIDE.md` (new §28a, General section bullet updated), help
content (`registry.ts` + 8-locale `help.json`).

### Commit
`8b33ca3575c4f365974c04c1d5cf28f7e73fc69b` —
`feat(backup): add backup and restore foundation` (30 files changed,
2373 insertions, 41 deletions; `.FormuLab/runs.db` and
`formulas/index.json` left staged out and untouched).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`4c501e6..8b33ca3`), no force, no conflicts.

### Final HEAD
`8b33ca3575c4f365974c04c1d5cf28f7e73fc69b` — matches
`origin/feature/laboratory-stability` exactly.

### Exact next session
**Phase 11 Session 2: Backup Verification.**

---

## Session 2 — Backup Verification

**Objective**: standalone `.formulab-backup` verification — inspect a
package without restoring it or touching the active data root, reusing
the existing restore-inspection logic rather than a second parser.

**Initial HEAD**: `8b33ca3575c4f365974c04c1d5cf28f7e73fc69b`
**Upstream HEAD at start**: same (clean, matched).

**Pre-existing working-tree state at session start** (not caused by this
session, not staged): `M .FormuLab/runs.db`, `M formulas/index.json` —
same two files noted in Sessions 0 and 1, still untouched.

### Files and systems touched
- Edited: `apps/desktop/src-tauri/src/backup.rs` — refactored
  `open_zip`/`read_manifest_from_archive`/`entry_safety_violation` out of
  the Session 1 restore path (now shared by restore, `inspect_backup`,
  the backup self-check, and the new verifier); added
  `VerificationStatus`/`VerificationIssue`/`VerificationReport`,
  `verify_backup_report`, the `verify_backup` Tauri command, and 13 new
  tests.
- Edited: `apps/desktop/src-tauri/src/lib.rs` (registered `verify_backup`).
- Edited: `apps/desktop/src/lib/tauri.ts` (`verifyBackup` wrapper +
  `VerificationReport`/`VerificationStatus`/`VerificationIssue` types).
- Edited: `apps/desktop/src/components/settings/BackupRecoveryCard.tsx` +
  `.test.tsx` — third action (Verify Backup), a `VerifyResult` panel
  (status badge, manifest summary, errors, warnings), 9 new tests.
- Edited: `apps/desktop/src/i18n/locales/*/settings.json` (all 8 locales
  — `backup.verifyButton/verifying/errorsHeading/warningsHeading/
  status.*/toast.verifyFailed`), `.../help.json` (all 8 locales — a
  second `settings.warnings` entry), `apps/desktop/src/lib/help/registry.ts`
  (`warningKeys` extended).
- Docs: `docs/handoffs/PHASE11_CURRENT.md`,
  `docs/PHASE11_BACKUP_RESTORE_ARCHITECTURE.md`,
  `docs/PHASE11_TEST_MATRIX.md`, `docs/USER_GUIDE.md` (§28a extended).

### Verification statuses and precedence
`Unsafe > Corrupted > Incompatible > ValidWithWarnings > Valid` — every
check runs to completion once the manifest parses (not short-circuited),
and the single worst tier found becomes the report's status. Corruption
and incompatibility are disjoint error-code sets, never blended.

### Checks implemented
ZIP readability, manifest presence/JSON-validity/required-fields (via
serde deserialization itself), backup-format-version support,
app-version compatibility range (`min/max`, minimal semver-lite
comparator), per-collection schema-version support, path
traversal/absolute/drive-letter rejection, symlink rejection, directory-
entry rejection, prohibited file extensions, duplicate-name detection
(pure-function level — see real finding below), the allow-listed
FormuLab-path check (reusing restore's own `archive_path_to_live`),
`.FormuLab/runs.db` presence (dedicated check), missing files (declared
but absent), unexpected files (present but undeclared — a warning, not
an error), declared-vs-actual size, SHA256 hash, and JSON-parses-cleanly
for every `.json` entry.

### Real finding
`zip::ZipWriter` (this project's own writer) refuses to write two
archive entries sharing a name — confirmed directly in a test
(`start_file` errors on the second attempt). A duplicate-path
`.formulab-backup` is therefore not producible via this project's own
tooling. Duplicate detection is still implemented as defense in depth
(a pure `duplicate_names()` function) and unit-tested at that level,
since a full end-to-end "open a real duplicate-path package" test
cannot exist against this crate's own writer.

### UI behavior
Verify Backup is a third, independent action in `BackupRecoveryCard`:
pick a package → a brief "Verifying…" spinner (no restore, no data-root
access) → a result panel with a color-coded status badge, the manifest
summary when readable, every error, every warning, and a Done button.
Never offers to restore from this flow.

### Tests
Rust: 13 new (`backup.rs`), full suite 101/101. TypeScript: 9 new
(`BackupRecoveryCard.test.tsx`), 21/21 total passing. i18n parity
23/23. Help registry 38/38. Typecheck clean. Lint clean. Full desktop
suite not run (no shared/global-shell change).

### Limitations
JSON structural check remains parses-cleanly only, not per-schema Zod
(same disclosed limitation as Session 1's restore). No CLI or exportable
verification report — UI-only. No standalone verification history.

### Risks / blockers
None new.

### Deferred items
Unchanged from Sessions 0–1.

### Inspection/verification commands run
`cargo check --lib`, `cargo test --lib backup::`, `cargo test --lib`
(full, 101/101), `pnpm vitest run src/components/settings/BackupRecoveryCard.test.tsx`
(21/21), `pnpm vitest run src/i18n src/lib/help` (100/100), `pnpm typecheck`,
`pnpm lint`, `node -e "JSON.parse(...)"` on all 16 touched locale JSON
files.

### Repository documentation updated
`docs/handoffs/PHASE11_CURRENT.md`,
`docs/PHASE11_BACKUP_RESTORE_ARCHITECTURE.md`,
`docs/PHASE11_TEST_MATRIX.md`, `docs/USER_GUIDE.md` (§28a extended),
help content (`registry.ts` + 8-locale `help.json`).

### Commit
`d93226356b58a3f64083dc5418d30d07c35d884e` —
`feat(backup): add standalone backup verification` (26 files changed,
1223 insertions, 64 deletions; `.FormuLab/runs.db` and
`formulas/index.json` left staged out and untouched).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`8b33ca3..d932263`), no force, no conflicts.

### Final HEAD
`d93226356b58a3f64083dc5418d30d07c35d884e` — matches
`origin/feature/laboratory-stability` exactly.

### Exact next session
**Phase 11 Session 3: Schema Migration Framework.**

---

## Session 3 — Schema Migration Framework

**Objective**: a versioned schema migration framework integrated with the
existing backup system — global schema version, ordered migration
registry, append-only journal, mandatory verified pre-migration backup,
rollback on failure, interrupted-migration detection, dry run, and a
bounded Settings surface. Reuses the existing migration engine
(`packages/shared/src/engine/migrations.ts`) and the existing backup
APIs (Sessions 1-2) — no second engine, no second backup mechanism.

**Initial HEAD**: `d93226356b58a3f64083dc5418d30d07c35d884e`
**Upstream HEAD at start**: same (clean, matched).

**Pre-existing working-tree state at session start** (not caused by this
session, not staged): `M .FormuLab/runs.db`, `M formulas/index.json` —
same two files noted every prior session, still untouched.

### Files and systems touched
- Edited: `packages/shared/src/engine/migrations.ts` (`id`/`description`/
  `reversible`/`validate` added to `SchemaMigration`), `migrations.test.ts`
  (fixtures updated, 5 new/changed tests), `docs/MIGRATIONS.md`.
- New: `apps/desktop/src-tauri/src/migration.rs` (schema-meta read/write,
  append-only journal, pre-migration backup, future-version comparator,
  interrupted-run detection, 7 tests).
- Edited: `apps/desktop/src-tauri/src/backup.rs` (widened `try_create_backup`/
  `GLOBAL_SCHEMA_VERSION`/`app_private_dir`/`now_secs` to `pub(crate)` for
  reuse — no logic changes), `apps/desktop/src-tauri/src/masterdata.rs`
  (`list_master_collections`, `write_master_collection_raw`, 1 new test),
  `apps/desktop/src-tauri/src/lib.rs` (module + 8 new command
  registrations).
- New: `apps/desktop/src/lib/migrationRunner.ts` (plan computation, dry
  run, full run with backup/journal/rollback, interrupted-run recovery)
  + `migrationRunner.test.ts` (18 tests).
- Edited: `apps/desktop/src/lib/masterdata.ts` (`listMasterCollections`,
  `writeMasterCollectionRaw`).
- New: `apps/desktop/src/components/settings/SchemaMigrationCard.tsx` +
  `.test.tsx` (11 tests).
- Edited: `apps/desktop/src/app/routes/SettingsPage.tsx` (mounts the new
  card), `apps/desktop/src/i18n/locales/*/settings.json` (8 locales —
  `migration.*` keys), `.../help.json` (8 locales — `settings` topic
  extended again), `apps/desktop/src/lib/help/registry.ts`.
- Docs: `docs/handoffs/PHASE11_CURRENT.md`,
  `docs/PHASE11_MIGRATION_ARCHITECTURE.md`, `docs/PHASE11_TEST_MATRIX.md`,
  `docs/USER_GUIDE.md` (§28a extended).

### Schema version model
`data/master/schema_meta.json` (`{globalSchemaVersion, updatedAt}`),
absent = implicitly current (`"1.0"`, re-exported from `backup.rs` as the
one shared constant). `schema_version_status(declared, supported)` — a
dedicated `major.minor` comparator, deliberately separate from
`backup.rs`'s `major.minor.patch` app-version comparator (different
version schemes, not reused across the mismatch).

### Migration registry
`packages/shared/src/engine/migrations.ts`'s `SchemaMigration` extended
with required `id`/`description`/`reversible` and optional `validate`.
`apps/desktop/src/lib/migrationRunner.ts`'s `MIGRATION_REGISTRY` ships
**empty** — no collection has ever shipped at anything but `"1.0"`,
confirmed again this session; nothing invented.

### Backup integration
`create_pre_migration_backup` (Rust) calls `backup::try_create_backup`
directly into app-private storage; the orchestrator then calls the
existing `verifyBackup`/`restoreBackup` commands from Sessions 1-2
unchanged. `write_master_collection_raw` (new) is the one new
persistence primitive: a migration-only whole-file overwrite bypassing
`upsert_master_records`'s append-only-refuses-existing-key rule, safe
because it's only reached after a verified backup already exists.

### Journal/recovery behavior
Append-only `data/master/migration_journal.jsonl`:
`run_started → collection_started/collection_completed × N →
run_completed`, or `collection_failed → rolled_back → run_failed` on any
error, or a standalone `rejected_future_version`. Interrupted-run
detection (`findInterruptedRun`/`find_interrupted_run`, independently
implemented and tested on both the TS and Rust sides) surfaces as a
Settings banner with a one-click recovery action, never auto-resolved.

### UI behavior
`SchemaMigrationCard` (Settings → General): current version, pending
count, Dry Run, Run Migration (disabled with nothing pending), a
completed/failed result panel (rollback status shown on failure), a
rejected-future-version banner, and an interrupted-migration recovery
banner checked on mount.

### Tests
Rust: 7 new (`migration.rs`) + 1 new (`masterdata.rs`), full suite
109/109. Shared: `migrations.test.ts` extended, 13/13. TypeScript: 18 new
(`migrationRunner.test.ts`) + 11 new (`SchemaMigrationCard.test.tsx`),
all passing. i18n parity 23/23. Help registry 38/38. Typecheck clean
(one real test-authoring variance bug caught and fixed — direct
`MigrationRegistry` object-literal construction failed TS's
contravariant check; fixed by using `registerMigration()` in test
fixtures). Lint clean. Full desktop suite not run (no shared/global-shell
change).

### Limitations
No cross-collection migration ordering (no evidence any dependency
exists). No scheduled/automatic migration — every run is a deliberate
click. `write_master_collection_raw` has no access control beyond "only
the migration runner calls it today" — a trust boundary to revisit if it
ever gets a second caller.

### Risks / blockers
None new. Same pre-existing risks from Sessions 0-2 remain relevant.

### Deferred items
Unchanged from Sessions 0-2.

### Inspection/verification commands run
`cargo test --lib migration::` (7/7), `cargo test --lib` (full, 109/109),
`pnpm vitest run src/engine/migrations.test.ts` (shared, 13/13),
`pnpm vitest run src/lib/migrationRunner.test.ts` (18/18),
`pnpm vitest run src/components/settings/SchemaMigrationCard.test.tsx`
(11/11), `pnpm vitest run src/i18n src/lib/help` (100/100), `pnpm typecheck`,
`pnpm lint`, `node -e "JSON.parse(...)"` on all 16 touched locale JSON
files.

### Repository documentation updated
`docs/handoffs/PHASE11_CURRENT.md`, `docs/PHASE11_MIGRATION_ARCHITECTURE.md`,
`docs/PHASE11_TEST_MATRIX.md`, `docs/USER_GUIDE.md` (§28a extended),
`docs/MIGRATIONS.md`, help content (`registry.ts` + 8-locale `help.json`).

### Commit
`5e041723ada174431c1e8172d960c56ecbce33e5` —
`feat(storage): add schema migration framework` (34 files changed,
2270 insertions, 39 deletions; `.FormuLab/runs.db` and
`formulas/index.json` left staged out and untouched).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`d932263..5e04172`), no force, no conflicts.

### Final HEAD
`5e041723ada174431c1e8172d960c56ecbce33e5` — matches
`origin/feature/laboratory-stability` exactly.

### Exact next session
**Phase 11 Session 4: Active Data Location Clarification.**

---

## Session 4 — Active Data Location Clarification

**Objective**: unify the current root-resolution behavior (formulab-root.txt
/ base-workspace.txt / active-workspace.txt / project_root() /
workspace_dir() / base_workspace_dir()) into one authoritative resolver,
surface malformed/missing/unwritable/conflicting roots instead of
silently falling through, fix the runs.jsonl/runs.db divergence at the
root cause, and show the real active data root in Settings — without
moving/merging data or building the full Data Location Manager.

**Initial HEAD**: `5e041723ada174431c1e8172d960c56ecbce33e5`
**Upstream HEAD at start**: same (clean, matched).

**Pre-existing working-tree state at session start** (not caused by this
session, not staged): `M .FormuLab/runs.db`, `M formulas/index.json` —
same two files noted every prior session, still untouched.

### Files and systems touched
- New: `apps/desktop/src-tauri/src/data_root.rs` (unified resolver, 10
  tests).
- Edited: `apps/desktop/src-tauri/src/workspace.rs` (`workspace_dir()`
  delegates to the unified resolver; removed the now-dead
  `active_workspace_file` helper), `apps/desktop/src-tauri/src/formulation_v2.rs`
  (`project_root()` delegates to the unified resolver), `apps/desktop/src-tauri/src/runs_index.rs`
  (switched from `base_workspace_dir()` to `workspace_dir()` — the
  divergence fix), `apps/desktop/src-tauri/src/lib.rs` (module + 2 new
  command registrations).
- New: `apps/desktop/src/components/settings/ActiveDataLocationCard.tsx`
  + `.test.tsx` (11 tests).
- Edited: `apps/desktop/src/lib/tauri.ts` (`activeDataRootStatus`/
  `openActiveDataRoot` wrappers), `apps/desktop/src/app/routes/SettingsPage.tsx`
  (mounts the new card), `apps/desktop/src/i18n/locales/*/settings.json`
  (8 locales — `dataLocation.*` keys), `.../help.json` (8 locales —
  `settings` topic extended again), `apps/desktop/src/lib/help/registry.ts`.
- Docs: `docs/handoffs/PHASE11_CURRENT.md`, `docs/PHASE11_DATA_INVENTORY.md`,
  `docs/PHASE11_TEST_MATRIX.md`, `docs/USER_GUIDE.md` (§28a extended).

### New root-resolution model
One function, `data_root::resolve_data_root_at()` (pure, path-based) /
`resolve_data_root()` (AppHandle wrapper): precedence `formulab-root.txt`
> `active-workspace.txt` > `base-workspace.txt` > default
(`~/Documents/FormuLab`). `project_root()` and `workspace_dir()` both now
delegate to it and are therefore always identical — the "two funnels"
Session 0 found are gone. `base_workspace_dir()` stays separate on
purpose (the few callers — `compute.rs`, `artifact_file.rs`'s `"base"`
scope, Settings' own workspace-folder controls — genuinely want "the
base regardless of override").

### Legacy compatibility
Every existing valid installation resolves to the exact same path as
before (dedicated tests per pointer tier, plus "active and base
agreeing"). Neither `formulab-root.txt` nor `active-workspace.txt` has
ever had a writer anywhere in this codebase (confirmed again this
session) — this unification and the `runs_index.rs` fix are provably
no-ops for every current real user.

### Conflict behavior
A malformed or missing-target pointer now produces a specific, visible
warning instead of silently falling through. A lower-precedence pointer
that ALSO resolves to a real, existing directory holding actual project
data (`data/formulations`/`data/master`/`data/sessions`/`formulas`) is
reported as a conflict — never auto-merged, never silently preferred.
An unwritable resolved root is flagged but still returned so the app
keeps working. `runs.jsonl`/`runs.db` divergence: `runs_index.rs` now
reads through the same `workspace_dir()` `runs.rs` already wrote
through — `.FormuLab/runs.db` itself was never opened, rewritten, or
moved by this fix.

### Settings behavior
New `ActiveDataLocationCard` (General, right after Workspace): resolved
path, plain-language resolution source, writable yes/no, every warning
listed, Open Folder (read-only reveal), Refresh. No relocation or
move-data control — explicitly deferred.

### Tests
Rust: 10 new (`data_root.rs`, incl. an explicit byte-level "no data
moved" assertion in the conflict test), full suite 119/119. TypeScript:
11 new (`ActiveDataLocationCard.test.tsx`); all settings-card tests
re-run together, 59/59. i18n parity 23/23. Typecheck clean. Lint clean.
Full desktop suite not run (no shared/global-shell change).

### Limitations
No in-app relocation/merge action yet (Data Location Manager, deferred).
`base_workspace_dir()`'s own internal malformed-pointer handling is
unchanged (still silent internally) — the new resolver's independent
read of `base-workspace.txt` is what produces a warning for it now, not
a change to `base_workspace_dir()` itself.

### Risks / blockers
None new.

### Deferred items
Unchanged from Sessions 0-3. Data Location Manager remains second-stage.

### Inspection/verification commands run
`cargo test --lib data_root::` (10/10), `cargo test --lib` (full,
119/119), `pnpm vitest run src/components/settings/ActiveDataLocationCard.test.tsx`
(11/11), `pnpm vitest run src/components/settings` (59/59), `pnpm vitest
run src/i18n src/lib/help` (100/100), `pnpm typecheck`, `pnpm lint`,
`node -e "JSON.parse(...)"` on all 16 touched locale JSON files.

### Repository documentation updated
`docs/handoffs/PHASE11_CURRENT.md`, `docs/PHASE11_DATA_INVENTORY.md`,
`docs/PHASE11_TEST_MATRIX.md`, `docs/USER_GUIDE.md` (§28a extended),
help content (`registry.ts` + 8-locale `help.json`).

### Commit
`ee41945d5f13579b18630a337ab0bba1e261b493` —
`feat(storage): clarify active data location` (30 files changed, 1150
insertions, 61 deletions; `.FormuLab/runs.db` and `formulas/index.json`
left staged out and untouched).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`5e04172..ee41945`), no force, no conflicts.

### Final HEAD
`ee41945d5f13579b18630a337ab0bba1e261b493` — matches
`origin/feature/laboratory-stability` exactly.

### Exact next session
**Phase 11 Session 5: Basic Diagnostics and Log Export.**

---

## Session 5 — Basic Diagnostics and Log Export

**Objective**: a basic Diagnostics Center and sanitized support-bundle
export — app/OS/storage/schema/migration/backup status, storage health,
recent log lines, bounded log retention/rotation, and a redacted export
safe to share. Closes Phase 11's first stage (Sessions 1-5).

**Initial HEAD**: `ee41945d5f13579b18630a337ab0bba1e261b493`
**Upstream HEAD at start**: same (clean, matched).

**Pre-existing working-tree state at session start** (not caused by this
session, not staged): `M .FormuLab/runs.db`, `M formulas/index.json` —
same two files noted every prior session, still untouched.

### Files and systems touched
- New: `apps/desktop/src-tauri/src/diagnostics.rs` (summary assembly,
  redaction, support-bundle export, 10 tests).
- Edited: `apps/desktop/src-tauri/src/debug_log.rs` (bounded rotation, 4
  tests), `apps/desktop/src-tauri/src/lib.rs` (module + 4 new command
  registrations), `apps/desktop/src-tauri/Cargo.toml` (new `regex`
  dependency, disclosed).
- New: `apps/desktop/src/lib/diagnostics.ts` (merges Rust's
  `diagnostics_summary` with the existing `computeMigrationPlan()` for
  pending-migration count), `apps/desktop/src/components/settings/DiagnosticsCard.tsx`
  + `.test.tsx` (14 tests).
- Edited: `apps/desktop/src/app/routes/SettingsPage.tsx` (mounts the new
  card), `apps/desktop/src/i18n/locales/*/settings.json` (8 locales —
  `diagnostics.*` keys), `.../help.json` (8 locales — `settings` topic
  extended again), `apps/desktop/src/lib/help/registry.ts`.
- Docs: `docs/handoffs/PHASE11_CURRENT.md`,
  `docs/PHASE11_DIAGNOSTICS_ARCHITECTURE.md`, `docs/PHASE11_TEST_MATRIX.md`,
  `docs/USER_GUIDE.md` (§28a extended).

### Diagnostics shown
App version (`CARGO_PKG_VERSION`), build id (honestly `null`), OS/arch,
active data path + resolution source + writable + warnings (reusing
Session 4's `data_root::resolve_data_root` directly), free disk space
(`fs4`), global schema version + compatibility status + last migration
result (reusing Session 3's `migration.rs` directly), last internal
safety backup found (scans the app-private `backups/` dir Sessions 1/3
already write into), storage health (a genuinely new check: every
`data/master/*.json` parsed, a present-but-unparseable file flagged —
closing the exact gap Session 0 found in `masterdata.rs`'s `read_array`),
both log directories, and a bounded heuristic "recent errors" scan of
`debug.log`. Pending-migration count comes from the frontend
(`computeMigrationPlan()`), merged in, since the registry only exists in
TypeScript.

### Support-bundle contents
Sanitized JSON: app/OS/schema/migration/storage-health/log-directory
fields (paths redacted), last-backup **metadata only** (filename/kind/
timestamp, never contents), and up to 200 bounded, redacted recent log
lines. No formula/master-data row, no backup file inventory, no
`localStorage` content (structurally unreachable from Rust) ever appears.

### Redaction behavior
New `regex` dependency (disclosed). Windows (`C:\Users\<name>\`) and
Unix (`/home/`, `/Users/`) usernames in paths replaced with
`<redacted>`. A 24+ character alphanumeric/`-`/`_` run containing both a
digit and a letter is replaced with `[REDACTED]` (checked in a
replacement closure, since the `regex` crate has no look-around) —
deliberately over-redacts (a long hash isn't a secret) since
safe-by-default is correct for an exported bundle. The on-screen summary
keeps the real active data path (the user needs it locally); only the
exported bundle redacts it.

### Log retention
`debug_log.rs` previously had no cap — fixed with `MAX_DEBUG_LOG_BYTES`
(2 MB) and a 3-generation rotation (`debug.log` -> `.1` -> `.2` -> `.3`,
oldest dropped), checked before every append.

### UI behavior
`DiagnosticsCard` (Settings → General, after Schema Migration): all
fields above, Refresh, Open Log Folder, Copy Summary (plain text via the
existing clipboard helper), Export Support Bundle (native save dialog).

### Tests
Rust: 4 new (`debug_log.rs`) + 10 new (`diagnostics.rs`), full suite
133/133. TypeScript: 14 new (`DiagnosticsCard.test.tsx`); all
settings-card tests re-run together, 73/73. i18n parity 23/23. Typecheck
clean. Lint clean. Full desktop suite not run (no shared/global-shell
change).

### Limitations
"Recent errors" is heuristic text matching, not a structured/leveled
log. "Last backup" only sees the internal safety-backup directory, not a
full history (none exists — out of scope since Sessions 1-2). No
crash-dump support exists or is claimed. Bundle is a single JSON file,
not an archive.

### Risks / blockers
None new.

### Deferred items
Unchanged from Sessions 0-4. This closes Phase 11's first stage.

### Inspection/verification commands run
`cargo test --lib debug_log::` (4/4), `cargo test --lib diagnostics::`
(10/10), `cargo test --lib` (full, 133/133), `pnpm vitest run
src/components/settings/DiagnosticsCard.test.tsx` (14/14), `pnpm vitest
run src/components/settings` (73/73), `pnpm vitest run src/i18n
src/lib/help` (100/100), `pnpm typecheck`, `pnpm lint`, `node -e
"JSON.parse(...)"` on all 16 touched locale JSON files.

### Repository documentation updated
`docs/handoffs/PHASE11_CURRENT.md`,
`docs/PHASE11_DIAGNOSTICS_ARCHITECTURE.md`, `docs/PHASE11_TEST_MATRIX.md`,
`docs/USER_GUIDE.md` (§28a extended), help content (`registry.ts` +
8-locale `help.json`).

### Commit
`f048ae55376048541ed3876a36f9ea1753d4d368` —
`feat(diagnostics): add diagnostics center and log export` (30 files
changed, 1608 insertions, 44 deletions; `.FormuLab/runs.db` and
`formulas/index.json` left staged out and untouched).

Note: the first push attempt was rejected by GitHub's secret-scanning
push protection — a test fixture string in `diagnostics.rs`
(`"sk_live_..."`, used only to exercise the token-redaction regex)
matched Stripe's live-secret-key format. No real secret was ever
involved; the commit had not reached the remote, so it was amended
in place (not a new commit) to use a non-provider-shaped fixture string
instead, tests re-run (still 10/10), then pushed successfully.

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`ee41945..f048ae5`), no force, no conflicts, after the fixture-string
fix above.

### Final HEAD
`f048ae55376048541ed3876a36f9ea1753d4d368` — matches
`origin/feature/laboratory-stability` exactly.

### Exact next session
**Phase 11 Stage 1 Closure and Verification.**

---

## Session 6 — Stage 1 Closure and Verification (2026-08-01)

### Scope
Verify all 8 Session 1-5 features, close the one real verification gap,
run every full test suite once, build a fresh Windows release, perform
honest native verification, update documentation. No new feature added.
`.FormuLab/runs.db` and real user data untouched throughout — fixture/
synthetic data only for every test.

### Verification gap closed
"Restore failure preserves the original fixture data" was previously
confirmed only by code inspection. Extracted `activate_staged_files` (a
pure, `AppHandle`-free function) from `try_restore_backup` in
`backup.rs`, then added 3 direct unit tests: rollback restores original
content on a mid-activation failure, a clean run leaves no aside copies
behind, a brand-new file (no prior live file) activates correctly. A
mocked `tauri::AppHandle` (`tauri::test::mock_app()`) was investigated
and rejected — its `mock_context()` resolves `app_data_dir()`
unpredictably outside test isolation, unsafe for a verification-only
session.

### Clippy cleanup
2 pre-existing `clippy::type_complexity` warnings (backup.rs) fixed with
named type aliases (`IncludedFile`, `HashedFile`); 1 `dead_code` warning
(migration.rs's `find_interrupted_run`, real but currently uncalled)
fixed with `#[allow(dead_code)]` + a doc comment.

### All 12 required guarantees confirmed
Full audit mapping each to specific passing tests — see
`docs/handoffs/PHASE11_CURRENT.md`'s "All 12 required guarantees" section
for the complete list. Summary: backup create/verify, 5-status
rejection, staged restore with safety backup, restore-failure rollback
(closed this session), migration dry-run no-writes, future-version
rejection, interrupted-migration detection, real resolver status,
storage-corruption-not-treated-as-empty, redaction, no-backup-contents-
in-bundle, and runs.db-never-included — all confirmed with named tests.

### Full test suites (run once)
- Rust (`cargo test --lib`): **136/136** (133 prior + 3 new).
- Rust clippy (`cargo clippy --lib`): clean.
- Desktop suite (`pnpm --filter @formulab/desktop test`): **1094/1094**,
  127/127 files. One real regression found and fixed:
  `SettingsPage.i18n.test.tsx` assumed a single match for the shared
  fallback string "available in the desktop app," which 5 Settings
  cards now render identically; fixed with `getAllByText(...).length >
  0`. Confirmed real (not flaky) by running the full suite twice and
  comparing which failure persisted — 6 pre-existing `HelpPanel.test.tsx`
  unhandled-rejection log lines did not recur on the second run and are
  documented, unrelated flaky noise.
- Shared migration tests (`migrations.test.ts`): 13/13.
- Desktop typecheck: clean. Desktop lint: clean.
- i18n parity: 23/23. Help registry: 38/38.

### Native verification
Fresh release build: `pnpm tauri build` from `apps/desktop` →
`formulab.exe`, `FormuLab_0.4.0_x64_en-US.msi`,
`FormuLab_0.4.0_x64-setup.exe` under `src-tauri/target/release/`.
Shortcut `C:\Users\sekip\Desktop\FormuLab.lnk` confirmed to point at this
exact exe.

`scripts/windows/verify-formulab-phase1.ps1` run against the release exe:
process launched, stayed running, top-level window appeared with title
"FormuLab", closed cleanly. **App starts: Verified.**

Remaining 8 checks (existing projects visible; Backup and Recovery,
Verify Backup, Schema Migration, Active Data Location, Diagnostics cards
opening; log-folder action; support-bundle save dialog): **Blocked.**
This environment has no UI Automation content access, WebDriver/
`tauri-driver`, or accessibility-tree reach into the packaged app's
WebView2 renderer — confirmed independently in both the Phase 1 and
Phase 10 closures (`docs/TAURI_LIVE_VERIFICATION.md`). No visual or
interactive confirmation was fabricated for these 8 items. No real
restore or migration was run against live data.

### Release artifacts
| Artifact | Path | Size (bytes) | SHA256 | Signed |
|---|---|---|---|---|
| EXE | `formulab.exe` | 23,040,512 | `F8C16F041BDE468348D9F0258E411D88B4CEF98E81AB9B5262466E8A9D12503E` | Not signed |
| MSI | `bundle/msi/FormuLab_0.4.0_x64_en-US.msi` | 36,986,880 | `3B2F8EF53B99066897634B15EE554AE69C44B21CAB22E80740AA933F6D915BE0` | Not signed |
| NSIS | `bundle/nsis/FormuLab_0.4.0_x64-setup.exe` | 25,300,117 | `CE1F4FA46E219D1831C52F0146C42AE8DD5289BE8A260713334E57405D669D24` | Not signed |

All three confirmed `NotSigned` via `Get-AuthenticodeSignature` — signing
was not claimed for any artifact.

### Limitations (Stage 1, as closed)
No backup history list; no automatic/scheduled backups; restore/verify
structural check is JSON-parses-cleanly only; no Data Location Manager
UI; no structured/leveled application log; support bundle is a single
JSON file, not an archive; `find_interrupted_run` (Rust) has no live
caller; native verification proves launch only, not interior UI content
(environment limitation, not a product defect).

### Deferred Stage 2 items
Automatic backups, Data Location Manager, update checker — unchanged
from Session 0's scoping.

### Repository documentation updated
`docs/architecture/IMPLEMENTATION_STATUS.md` (new Phase 11 Stage 1
section), `docs/handoffs/PHASE11_CURRENT.md` (full closure summary),
`docs/PHASE11_TEST_MATRIX.md` (closure test totals),
`docs/PHASE11_BACKUP_RESTORE_ARCHITECTURE.md`,
`docs/PHASE11_MIGRATION_ARCHITECTURE.md`,
`docs/PHASE11_DIAGNOSTICS_ARCHITECTURE.md` (closure notes each).
`docs/USER_GUIDE.md` re-read and confirmed already accurate — no change
needed.

### Files intentionally excluded from this commit
`.FormuLab/runs.db`, `formulas/index.json` (per every session's standing
instruction), and `docs/generated/FormuLab-User-Guide.{docx,pdf}` (an
unrelated side effect of an earlier full-suite test run this session,
regenerated with a new embedded date — not part of this session's actual
work, left unstaged per this project's "stage only current-task files"
convention).

### Commit
`fbeb84ff2acba770d6e8558c452076834c94e6e6` —
`chore(phase11): close stage 1 data safety` (9 files changed, 552
insertions, 63 deletions; `.FormuLab/runs.db`, `formulas/index.json`, and
`docs/generated/FormuLab-User-Guide.{docx,pdf}` left staged out and
untouched).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`f048ae5..fbeb84f`), no force, no conflicts.

### Final HEAD
`fbeb84ff2acba770d6e8558c452076834c94e6e6` — matches
`origin/feature/laboratory-stability` exactly.

### Exact next session
**Phase 11 Stage 2** (when scheduled): automatic backups, Data Location
Manager, update checker.

---

## Session 7 — Automatic Backups (2026-08-05)

**Objective**: Stage 2's first item — automatic (daily/weekly/on-exit)
backups and retention, built entirely on the existing `.formulab-backup`
engine (Sessions 1-3). No second backup format, no second write path.
`.FormuLab/runs.db` and real user data untouched throughout — every Rust
test runs against synthetic temp directories only.

### Initial HEAD
`fbeb84ff2acba770d6e8558c452076834c94e6e6` — `chore(phase11): close
stage 1 data safety`, confirmed matching `origin/feature/laboratory-stability`
before this session's first change.

### Schedule behavior
No background service — disclosed honestly in the UI and Help content,
per this session's own instruction, rather than building one to hide the
limitation. Every automatic backup only runs while FormuLab is the
foreground process: on launch, on a 30-minute while-open interval
(`installAutomaticBackupLifecycle`, `apps/desktop/src/lib/automaticBackup.ts`),
and on window close if backup-on-exit is enabled
(`getCurrentWindow().onCloseRequested`). Daily is eligible once 24h have
elapsed since the last one (or never run); weekly once 7 days have. A
backup-on-exit run is classified `daily` (also satisfies that day's own
eligibility, so closing the app doesn't double up with the next launch's
daily check the same day).

### Retention behavior
Three classes — `daily` (default keep 7), `weekly` (default keep 4),
`preMigration` (default keep 2, closing a real pre-existing gap: Session
3's `create_pre_migration_backup` had no retention at all before this
session). `apply_retention` (Rust, `automatic_backup.rs`, pure and
AppHandle-free) keeps the newest N per class, deletes older ones, and
sweeps any stray `.tmp` package left by a crash mid-write. A floor of 1
is unconditional — a configured `0`, or any count, never deletes the
last remaining valid backup of a class. Retention only runs after a
verified-good backup; a failed run never touches existing backups of any
class.

### Verification behavior
Every automatic backup is checked with the exact same
`verify_backup_report` Session 2 built, immediately after writing.
Anything short of `Valid`/`ValidWithWarnings` is deleted on the spot and
recorded as a failure, carrying the verification status — an automatic
backup is never left on disk pretending to be valid.

### Failure handling
Missing/moved destination folder, low disk space (via the existing
`try_create_backup` disk-space check), and permission errors all surface
with their real, distinct message text, not swallowed or generalized.
Concurrency: `run_automatic_backup` reuses the exact `BackupState` slot
manual create/restore already hold — a collision (manual backup/restore,
or another automatic run, in progress) reports itself as a normal failed
result, never an unhandled exception. A failed automatic backup shows a
toast (if focused) and a native OS notification
(`notifyAutomaticBackupFailure`, extending `lib/systemNotification.ts`;
silent if notification permission was never granted — never prompts for
it proactively).

### UI behavior
New `AutomaticBackupCard` (Settings → General, after Backup and
Recovery): master enable, destination folder (choose/open), daily/weekly
toggles each with their own retention count, backup-on-exit toggle, an
always-visible pre-migration retention count (applies regardless of the
master toggle — pre-migration backup itself is mandatory, not part of
this schedule), a status panel (next eligible run, last success, last
failure with reason), Run Automatic Backup Now, and an always-visible
limitation note about the no-background-service constraint. Full i18n
across all 8 shipped locales, no placeholders.

### Tests
Rust: 12 new tests in `automatic_backup.rs`, all against pure functions
requiring no `AppHandle` (matching the Stage 1 Closure session's own
precedent of avoiding the unsafe mocked-`AppHandle` workaround). Full
Rust suite **148/148 passing** (136 prior + 12 new). `cargo clippy --lib`:
clean (one `clippy::result_large_err` warning closed by boxing the `Err`
variant, not suppressed).

TypeScript: 21 new `automaticBackup.test.ts` tests, 12 new
`AutomaticBackupCard.test.tsx` tests, 3 new `migrationRunner.test.ts`
tests (pre-migration retention applied after a completed run, skipped
after a failed run, a retention failure never fails an otherwise-
completed migration) — migrationRunner suite **21/21**. i18n parity
**23/23**. Help registry suite passing (settings topic extended in
place, one new warning entry across all 8 locales). Desktop typecheck
clean. Desktop lint clean.

**Full desktop suite run this session** (`AppShell.tsx` — a global/
shared file every route mounts — changed, meeting this project's own
"run broader suites when shared/global behavior changes" trigger):
**1130/1130 passing** once the one pre-existing flake is isolated —
`HelpPanel.test.tsx`'s documented jsdom/undici `AbortSignal` cross-realm
incompatibility (first recorded in the Stage 1 Closure session, predates
Phase 11 entirely) reproduced 3 failures only when run inside the full
suite; the same file passes 11/11 in isolation, confirming no regression
was introduced this session. No Rust module outside `automatic_backup.rs`
and `migration.rs`'s call site changed, so the full Rust suite above is
the complete Rust regression check.

### Limitations (disclosed, not silently assumed away)
No background service — the load-bearing one, stated in the product
itself. No backup history list for automatic runs beyond "last success"/
"last failure" (matches manual backup's own existing limitation).
Manually triggered "Run Automatic Backup Now" and backup-on-exit are
always daily-classed — no UI to force a one-off weekly or pre-migration
run. `AutomaticBackupCard`'s retention inputs clamp to 1-99 client-side;
the Rust-side floor of 1 is the actual safety guarantee, the UI range is
just a sane input bound. The `onCloseRequested` window hook itself is
not unit-tested (no headless Tauri window in this environment — the same
kind of environment limitation the Stage 1 Closure session's native-
verification section already documented) — it is a thin, reviewed
wrapper around `runOnExit`, which is unit-tested directly.

### Repository documentation updated
`docs/handoffs/PHASE11_CURRENT.md` (Session 7 summary, status line,
next-session pointer), `docs/PHASE11_BACKUP_RESTORE_ARCHITECTURE.md`
(new Session 7 section), `docs/PHASE11_TEST_MATRIX.md` (new Session 7
entry), `docs/USER_GUIDE.md` (new §28a Automatic Backups subsection,
intro list updated, stale "not yet available: automatic scheduled
backups" line corrected). Help content: `settings` topic's `sections.0`
extended in place and one new `warnings.5` entry added, across all 8
locales, plus `apps/desktop/src/lib/help/registry.ts`'s `warningKeys`.

### Files intentionally excluded from this commit
`.FormuLab/runs.db`, `formulas/index.json` (per this session's own
instruction and every prior session's standing convention), and
`docs/generated/FormuLab-User-Guide.{docx,pdf}` (the same recurring
side effect of `generate.test.ts`'s real end-to-end document generation
during the full-suite run — not part of this session's actual work,
left unstaged).

### Commit
`07f1c5bf8ebb9fa924bc734189a439b4c6b2b485` —
`feat(backup): add automatic backups and retention` (33 files changed,
2483 insertions, 25 deletions; `.FormuLab/runs.db`, `formulas/index.json`,
and `docs/generated/FormuLab-User-Guide.{docx,pdf}` left staged out and
untouched).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`fbeb84f..07f1c5b`), no force, no conflicts.

### Final HEAD
`07f1c5bf8ebb9fa924bc734189a439b4c6b2b485` — matches
`origin/feature/laboratory-stability` exactly.

### Exact next session
**Phase 11 Session 8: Data Location Manager.**

---

## Session 8 — Data Location Manager (2026-08-05)

**Objective**: Stage 2's second item — turn the read-only Active Data
Location card (Session 4) into a safe way to actually relocate the
active data root, using the existing backup engine and the existing
`base-workspace.txt` pointer, with the old location always retained until
success is confirmed. `.FormuLab/runs.db` and real user data untouched
throughout — every Rust test uses synthetic temp directories; no real
folder was moved during this session's own testing.

### Initial HEAD
`07f1c5bf8ebb9fa924bc734189a439b4c6b2b485` — `feat(backup): add
automatic backups and retention`, confirmed matching
`origin/feature/laboratory-stability` before this session's first change.

### Validation behavior
A candidate destination is classified into exactly one of six kinds
before anything is offered: `empty` (safe to move into), 
`existingCompatibleRoot` (already holds real FormuLab data — safe to
switch to as-is, never to move into), `conflicting` (holds other,
unrelated files — refused outright, never merged), `sameAsCurrent`,
`notADirectory`, `unwritable`. Free disk space is checked only for a
move (a copy); it never blocks "use existing," which copies nothing.

### Move transaction
Ten steps, exactly as specified: validate source+destination → reject
conflicting/unrelated destinations → verified safety backup (reusing
Sessions 1-2's `try_create_backup`/`verify_backup_report` unchanged) →
stage every file (recursive walk of the whole root, excluding only
`.FormuLab/runs.db`) into a private staging directory under the
destination, hashing as read → re-hash every staged copy against the
recorded size+SHA256 → activate (rename each staged file into its final
path; any failure rolls back everything already placed and removes the
staging directory) → write the `base-workspace.txt` pointer only once
every file is confirmed at its final path → re-resolve and confirm the
app actually now resolves to the destination → the old root is never
touched at any point in this flow → any failure restores the pointer to
its exact previous content (or removes it) and reports why.

### Conflict handling
"Never blindly merge two roots" is structural: `Move Data` is offered
only for an `empty` destination, `Use Existing Location` only for
`existingCompatibleRoot`. A destination holding both real FormuLab data
and other unrelated content is not a case this session's classification
produces — `path_holds_real_data` (Session 4's own check, reused
directly) is checked first and wins if any of the four known data
directories hold anything.

### Rollback and recovery
Every failure path (safety-backup failure, staged hash mismatch,
activation failure, post-pointer-write resolution mismatch) leaves the
previous location fully active and byte-for-byte untouched — proven
directly for activation by `activate_staged_rolls_back_and_removes_staging_on_failure`
and for the pointer by `restore_pointer_writes_back_previous_content_or_removes_a_new_file`.
Interrupted moves are journaled to app-private
`runtime/data_move_journal.jsonl` (deliberately outside the data root
itself); a pure `resume_decision` function determines whether an
interrupted run can be safely finished or must be rolled back, based
solely on which journal steps it reached — directly unit-tested for all
four outcomes.

### Old-root cleanup behavior
Never automatic. A dedicated `cleanup_old_data_location` command exists
but is reachable only from a UI panel shown after a successful move/
switch, itself gated behind its own explicit confirmation, and refuses
outright if the target is (or canonicalizes to) the currently active
root.

### Automatic-backup integration
`automatic_backup::remap_path` (pure, directly tested) remaps the
configured daily/weekly destination folder to the new root only when it
was inside the OLD root; otherwise it is left completely untouched. The
move result reports which happened, with a plain-language note, shown in
the UI's success summary.

### UI behavior
`ActiveDataLocationCard` rewritten in place — same read-only status
section preserved (path/source/writable/warnings, Open Folder, Refresh)
plus Change Location, Use Existing Location, Restore Default, live move
progress with cancel, a validation result panel, an explicit confirmation
step before any activating action (move, switch, restore default, or
cleanup), a successful-move summary, an interrupted-move recovery banner
checked on mount, and optional post-move cleanup.

### Tests
Rust: 14 new tests in `data_location_manager.rs` + 2 new tests in
`automatic_backup.rs` (`remap_path`). Full Rust suite **164/164 passing**
(148 prior + 16 new). `cargo clippy --lib`: clean.

TypeScript: 20 new `ActiveDataLocationCard.test.tsx` tests (all six
destination kinds, a full successful move, gated cleanup, automatic-
backup adjustment note, safety-backup failure, hash-mismatch failure,
activation failure, cancelled move, a full use-existing switch, gated
Restore Default, interrupted-move banner + resume + no-banner-when-clean,
plus the original read-only status tests re-verified). i18n parity
**23/23**. Help registry suite passing. Desktop typecheck clean. Desktop
lint clean (one real `react-hooks/rules-of-hooks` false positive on a
`use`-prefixed non-hook function, fixed by renaming, not suppressing).

**Full desktop suite**: not run — only Settings-scoped files changed, no
global/shared shell file touched this session (unlike Session 7's
`AppShell.tsx` change). Targeted run instead: every `components/settings/*`
card test + `SettingsPage.i18n.test.tsx` + `migrationRunner.test.ts` +
`automaticBackup.test.ts` together — **141/141 passing** across 12 files.

### Limitations (disclosed, not silently assumed away)
`formulab-root.txt`/`active-workspace.txt` remain entirely outside this
manager's writes — a manually-placed `formulab-root.txt` still silently
outranks anything chosen here, surfaced only as a resolution warning
(Session 4's existing behavior, unchanged). No progress granularity finer
than per-file. Interrupted-move resume offers exactly one recovery path
per state (finish if safe, otherwise roll back) — no "inspect and
choose" UI, mirroring Session 3's migration-recovery banner precedent.
Cleanup deletes the entire old root in one operation — no selective/
partial cleanup.

### Repository documentation updated
`docs/handoffs/PHASE11_CURRENT.md` (Session 8 summary, status line,
next-session pointer), `docs/PHASE11_DATA_INVENTORY.md` (Session 8 update
note on item 12), `docs/PHASE11_TEST_MATRIX.md` (new Session 8 entry),
`docs/USER_GUIDE.md` (§28a Active Data Location rewritten to describe the
manager). Help content: `settings` topic's `sections.0` extended in place
and one new `warnings.6` entry added, across all 8 locales, plus
`apps/desktop/src/lib/help/registry.ts`'s `warningKeys`.

### Files intentionally excluded from this commit
`.FormuLab/runs.db`, `formulas/index.json` (per this session's own
instruction and every prior session's standing convention), and
`docs/generated/FormuLab-User-Guide.{docx,pdf}` (the same recurring side
effect of `generate.test.ts`'s real end-to-end document generation during
a targeted test run — not part of this session's actual work, left
unstaged).

### Commit
`5c42212f12a61622127604235b941dbc377cff81` —
`feat(storage): add data location manager` (29 files changed, 3129
insertions, 102 deletions; `.FormuLab/runs.db`, `formulas/index.json`,
and `docs/generated/FormuLab-User-Guide.{docx,pdf}` left staged out and
untouched).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`07f1c5b..5c42212`), no force, no conflicts.

### Final HEAD
`5c42212f12a61622127604235b941dbc377cff81` — matches
`origin/feature/laboratory-stability` exactly.

### Exact next session
**Phase 11 Session 9: Update Checker.**

---

## Session 9 — Update Checker (2026-08-06)

**Objective**: Stage 2's third item — a safe, check-only update checker.
Signed installation, automatic update installation, and rollback remain
explicitly Phase 12. Rewrote the pre-existing (pre-Phase-11) update-check
code — it already had current-version display, manual/automatic check,
and a Settings badge, but used a hardcoded dual-path fetch (Rust Atom-
feed scraper + raw browser `fetch` fallback), a fixed 24h interval, no
size/timeout/HTTPS enforcement, no release notes, no platform info, and
no ignored-version or notification support.

**Interruption note**: an API error occurred immediately before running
the focused update tests. On resume, `git status --short` and `git diff
--check` showed every Session 9 file already fully written with no
conflict markers or truncation. One real defect was found — a garbled
sentence fragment left mid-edit in `docs/USER_GUIDE.md`'s new App
Updates section — fixed before continuing. No source file needed repair;
Rust and TypeScript both compiled clean and every focused test passed on
the first resumed run.

### Initial HEAD
`5c42212f12a61622127604235b941dbc377cff81` — `feat(storage): add data
location manager`, confirmed matching `origin/feature/laboratory-stability`
both before this session's first change and again at resume time.

### Metadata contract
One configurable HTTPS endpoint (GitHub's public Releases API by
default — `updates::DEFAULT_RELEASE_METADATA_URL` in Rust,
`lib/update.ts`'s own copy of the same literal in TypeScript, duplicated
deliberately since the two runtimes can't share a constant). Not exposed
as a Settings text field this session (not requested in the UI list) —
the store's `setEndpointUrl` exists, HTTPS-validated, for future/
programmatic use.

### Version comparison
Rust validates the response is safe and well-formed; TypeScript owns
everything version-shaped. `isValidSemver` now rejects a malformed
version outright instead of silently coercing it to `0`. A same-or-older
reported version always resolves to `"upToDate"` — never an error, never
`"updateAvailable"` — which is this session's downgrade/same-version
rejection: a stale or misconfigured endpoint's claim is never trusted
blindly.

### Scheduling behavior
`shouldAutoCheck(lastCheckedAt, now, frequencyHours)` replaces the old
fixed 24h interval — `frequencyHours` is user-configurable (6/12/24/72/
168, default 24), persisted in localStorage (this module's existing,
already-tested persistence layer — deliberately not migrated to Sessions
7-8's app-private JSON pattern, since that wasn't asked for and this code
already shipped and worked). A manual check always bypasses the
frequency gate; the automatic one (unchanged `AppShell` call site) is
gated by both the enabled toggle and the configured frequency.

### Security controls
HTTPS enforced twice (the endpoint itself, before any request; the
response's own `html_url` field, after parsing) — non-HTTPS is refused
at both points. A 1 MB response-size cap enforced twice (a
`Content-Length` pre-check and a hard-capped `Read::take` on the actual
bytes, so neither a missing nor a lying header can bypass it). A 10s
request timeout. Structural validation rejects a missing version, a
missing URL, malformed JSON, and a draft/prerelease entry, each with a
distinct message. Platform/architecture matching is filename-keyword
only, informational, and never downloads an asset to confirm anything.

### Notification behavior
A newly detected update fires a native OS notification at most once per
version (`notifiedVersion`, tracked separately from `ignoredVersion`) —
repeated checks for the same version never notify again; a genuinely
newer version later does. Never requests notification permission
proactively (matches Session 7's `notifyAutomaticBackupFailure`
precedent exactly). An ignored version, or a non-newer response, never
notifies at all.

### UI behavior
New `UpdateCheckerCard.tsx` replaces the inline "App updates" block that
previously lived directly in `SettingsPage.tsx`: current version, status
(idle/checking/up to date/update available/error/offline), last-checked
time, an available-version summary (version, publish date, platform-
support note, release notes rendered as plain text only — never HTML,
directly tested against a hostile `<img onerror>` string), View Release
/ Download (opens the browser only — never downloads or runs anything),
Ignore This Version, Clear Ignored Version, an automatic-check toggle, a
frequency select, a Settings-badge toggle, and an always-visible
disclaimer stating FormuLab checks only and does not install updates.

### Tests
Rust: 14 new tests in `updates.rs`. Full Rust suite **177/177 passing**
(163 prior + 14 new). `cargo clippy --lib`: clean.

TypeScript: 30 new `update.test.ts` tests, 19 new
`UpdateCheckerCard.test.tsx` tests, 2 new `systemNotification.test.ts`
tests. i18n parity **23/23**. Help registry suite passing. Desktop
typecheck clean. Desktop lint clean.

**Full desktop suite run this session** (launch behavior and shared
update state changed, per this session's own instruction):
**1182/1185 passing** once the one pre-existing flake is isolated —
`HelpPanel.test.tsx`'s documented jsdom/undici `AbortSignal` cross-realm
incompatibility (first recorded in the Stage 1 Closure session,
reconfirmed in Sessions 7 and 8) reproduced 3 failures only inside the
full suite; the same file passes 11/11 in isolation, confirming no
regression this session introduced.

### Limitations (disclosed, not silently assumed away)
No signed installers, no automatic download/installation, no rollback —
all explicitly Phase 12. The update endpoint is configurable in the
store but has no Settings UI field this session. Offline classification
is best-effort text matching on Rust's own error message, not a
guaranteed network-state API. Platform/architecture detection is
filename-keyword matching against release assets, not a guarantee a
given asset will run — informational only.

### Repository documentation updated
`docs/handoffs/PHASE11_CURRENT.md` (Session 9 summary, status line,
next-session pointer), `docs/PHASE11_TEST_MATRIX.md` (new Session 9
entry), `docs/USER_GUIDE.md` (new App Updates subsection in §28a). Help
content: `settings` topic's `warnings.7` added across all 8 locales,
plus `apps/desktop/src/lib/help/registry.ts`'s `warningKeys`.

### Files intentionally excluded from this commit
`.FormuLab/runs.db`, `formulas/index.json` (per this session's own
instruction and every prior session's standing convention), and
`docs/generated/FormuLab-User-Guide.{docx,pdf}` (the same recurring side
effect of `generate.test.ts`'s real end-to-end document generation
during the full-suite run — not part of this session's actual work, left
unstaged).

### Commit
`5d5c4e2ddde99eddcacbb4162cbdee41edea164b` —
`feat(updates): add safe update checker` (30 files changed, 1945
insertions, 471 deletions; `.FormuLab/runs.db`, `formulas/index.json`,
and `docs/generated/FormuLab-User-Guide.{docx,pdf}` left staged out and
untouched).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`5c42212..5d5c4e2`), no force, no conflicts.

### Final HEAD
`5d5c4e2ddde99eddcacbb4162cbdee41edea164b` — matches
`origin/feature/laboratory-stability` exactly.

### Exact next session
**Phase 11 Session 10: Second-Stage Closure and Verification.**

---

## Session 10 — Second-Stage Closure and Verification (2026-08-06)

**Objective**: verify and close Stage 2 (Sessions 7-9: automatic backups,
Data Location Manager, update checker). No new product feature. Mid-
session, the user explicitly required genuinely root-causing and fixing
the recurring `HelpPanel.test.tsx` jsdom/undici `AbortSignal` flake
instead of continuing to document it as a known limitation — Phase 11
could only be marked fully closed if the full suite genuinely, fully
passed as a result.

### Initial HEAD
`5d5c4e2ddde99eddcacbb4162cbdee41edea164b` — `feat(updates): add safe
update checker`, confirmed matching `origin/feature/laboratory-stability`.

### The AbortSignal flake — investigation and fix

Confirmed mechanism: `TourOverlay.tsx:62`'s unawaited `navigate(tour.route)`
drives `@remix-run/router`'s internal `createClientSideRequest`, which
builds `new Request(href, { signal })`. Under genuine multi-file
concurrent test execution this occasionally throws inside Node's own
undici (`Expected signal to be an instance of AbortSignal`) as an
unhandled rejection Vitest attributes to whatever test is active at that
instant.

Two fix attempts tried and empirically ruled out:
1. `test.server.deps.inline` forcing `@remix-run/router`/`react-router`/
   `react-router-dom` through Vite's per-file-fresh transform pipeline —
   full suite still failed identically. Rules out stale cross-file
   module caching.
2. `pool: "forks"` with `poolOptions.forks.isolate: true` — every file in
   its own OS process — full suite still failed identically. Rules out
   cross-file/cross-realm global pollution of any kind.

What isolated it: `pnpm vitest run --no-file-parallelism` produced
130/130 files, 1185/1185 tests passing, same background errors present
but attributed to no test — proving this is a genuine scheduling race
present only under real concurrency, not a caching/identity bug.

A third attempt — catching the rejection from `TourOverlay.tsx` directly
(`navigate(tour.route).catch(() => {})`) — was tried and immediately
reverted: this app uses React Router's classic `<BrowserRouter>`, whose
`navigate()` is synchronous/`void`; the change crashed the app
(`Cannot read properties of undefined (reading 'catch')`). Confirmed via
`git diff --stat` that the revert left no residual change to
`TourOverlay.tsx`.

**Landed fix**: `apps/desktop/vite.config.ts`'s `test` block sets
`fileParallelism: false`. Test-harness-only; no test skipped, muted,
quarantined, or weakened. Validated: `HelpPanel.test.tsx` alone, 4
consecutive runs, 11/11 every time; full suite via plain `pnpm vitest
run` (no flag), **130/130 files, 1185/1185 tests, 0 failures**, twice.
Trade-off: local full-suite run time increased from ~70-90s to
~275-280s — disclosed, accepted.

### Verification gaps closed
Two guarantees previously argued only from code signature, now directly
tested in `data_location_manager.rs`: old-root byte-identity after a
successful move (`a_full_stage_and_activate_sequence_leaves_the_source_root_byte_identical`),
and `is_cleanup_safe` extracted as a pure, directly-tested function
(including a canonicalization edge case).

### Tests
Rust: 3 new tests, full suite **180/180 passing** (177 prior + 3 new).
`cargo clippy --lib`: clean.

Desktop: **130/130 files, 1185/1185 tests passing**, plain `pnpm vitest
run`, twice, no isolation required.

Shared package: **61/61 files, 1251/1251 tests passing** (includes 13
migration tests), run standalone.

i18n parity **23/23**. Help registry **38/38** (`registry.test.ts`) +
**9/9** (`tours.test.ts`), run standalone. Desktop typecheck clean.
Desktop lint clean.

### Release build and native verification
`pnpm tauri build` from `apps/desktop` — see
`docs/handoffs/PHASE11_CURRENT.md`'s Stage 2 Closure section for
artifact paths/sizes/SHA256/signing status and the shortcut-target
launch confirmation. Interior UI content checks remain **blocked** —
same environment limitation independently confirmed across Phase 1,
Phase 10, and Phase 11 Stage 1's own closures (no UI-content-reading
tool for the packaged app's WebView2 renderer). No visual or
interactive confirmation fabricated for any blocked item.

### Repository documentation updated
`docs/handoffs/PHASE11_CURRENT.md` (Stage 2 Closure section, status line
→ "PHASE 11 FULLY CLOSED", next-phase pointer), `docs/PHASE11_TEST_MATRIX.md`
(Stage 2 Closure entry), `docs/architecture/IMPLEMENTATION_STATUS.md`
(new "Phase 11, Stage 2 — CLOSED" section), `docs/PHASE11_BACKUP_RESTORE_ARCHITECTURE.md`
(Stage 2 Closure note, mirroring the existing Stage 1 Closure note).

### Files intentionally excluded from this commit
`.FormuLab/runs.db`, `formulas/index.json`,
`docs/generated/FormuLab-User-Guide.{docx,pdf}` — per this session's own
instruction and every prior session's standing convention.

### Commit
`e5c2b43d0c23a2e95f0d0ec2c8ce3776740d1199` —
`chore(phase11): close stage 2 data safety` (6 files changed, 508
insertions, 6 deletions; `.FormuLab/runs.db`, `formulas/index.json`, and
`docs/generated/FormuLab-User-Guide.{docx,pdf}` left staged out and
untouched).

### Push result
Pushed clean to `origin/feature/laboratory-stability`
(`5d5c4e2..e5c2b43`), no force, no conflicts.

### Final HEAD
`e5c2b43d0c23a2e95f0d0ec2c8ce3776740d1199` — matches
`origin/feature/laboratory-stability` exactly.

### Phase 11 status
**FULLY CLOSED.** Both Stage 1 and Stage 2 complete, including this
session's genuine (not documented-around) fix of the last known test
flake.

### Exact next phase
**Phase 12 Session 0: Commercial Distribution Assessment.** Scope: signed
installers/updates, secure update installation, automatic rollback.
