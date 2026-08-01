# Phase 11 Test Matrix

Session 0 (assessment and planning only — no tests were run or written
this session, per its lean-test-discipline instruction). This matrix
sets the proportional test plan each future first-stage session commits
to, against the repository's real, confirmed test conventions.

## Confirmed test conventions (evidenced, not assumed)

- **TypeScript/Vitest**: `pnpm --filter @formulab/shared test` and
  `pnpm --filter @formulab/desktop test`, both `vitest run`
  (`package.json`'s root `test` script; `apps/desktop/package.json`/
  `packages/shared/package.json`'s own `test` scripts). Co-located
  `*.test.ts`/`*.test.tsx` files, one per module, matching the pattern
  seen throughout `docs/architecture/IMPLEMENTATION_STATUS.md`'s test
  counts (e.g. `migrations.test.ts`, `masterdata.rs`'s own Rust tests).
- **Rust**: crate `formulab_lib` (`Cargo.toml:9`), tests as
  `#[cfg(test)] mod tests { ... }` inline in the same file, run via
  `cargo test` from `apps/desktop/src-tauri`. Confirmed pattern in
  `masterdata.rs:567-722` (allow-list length + collection-membership
  assertions) and `attachments.rs:148-151` (checksum stability).
- **Full-suite counts at last count** (from `PHASE10_CURRENT.md`): 898+
  desktop tests, 1248+ shared tests, Rust suite in the low hundreds —
  confirming full-suite runs are expensive enough that this project's
  own convention (`AGENTS.md`: "Use targeted tests during implementation
  sessions... Run full-project regression only in closure sessions") is
  real and load-bearing, not aspirational.

## Session 0 (this session): no tests run

Per explicit instruction: no full desktop/shared/Rust suite, no
typecheck, no lint, no release/installer build. Only read-only
inspection commands (listed in each architecture doc's own Method
section) informed this assessment.

## Session 1 — Backup and Restore Foundation (complete — actual results)

- Rust: 5 new tests in `backup.rs` (`excluded_labels_name_runs_db_and_ebwebview_explicitly`,
  `safe_archive_name_rejects_traversal_and_absolute_paths`,
  `archive_path_to_live_rejects_unknown_prefixes`,
  `schema_versions_reads_first_row_and_sets_global`,
  `full_backup_then_restore_round_trip_is_byte_identical`). Full Rust
  suite re-run (new module + `lib.rs`/`Cargo.toml` changed): **88/88
  passing** (83 pre-existing + 5 new).
- TypeScript: 12 new tests in `BackupRecoveryCard.test.tsx` (not-desktop
  fallback, idle actions, cancelled-destination-picker no-op, backup
  success summary, backup warnings display, backup failure, backup
  cancellation returns to idle quietly, live progress display, full
  restore confirm-then-restore flow, cancel-out-of-confirmation,
  restore failure, inspect failure) — **12/12 passing**.
- i18n parity: **23/23 passing** (8-locale `settings.backup.*` and
  `help.settings.sections/warnings` additions all real translations, no
  placeholders).
- Help registry: **38/38 passing** (unchanged count — the `settings`
  topic was extended in place, no new topic added).
- Desktop typecheck: clean. Desktop lint: clean.
- Full desktop suite: **not run** — only `SettingsPage.tsx` (a single
  conditional render block + one import) changed outside the new,
  already-tested files; no shared Settings infrastructure or global
  shell behavior changed, per this session's own run-full-suite
  trigger condition.

**Focused tests** (written during the session, run targeted — not full
suite):
- Rust: manifest build produces the exact inclusion/exclusion list from
  `docs/PHASE11_DATA_INVENTORY.md` (a fixed-list regression test, same
  pattern as `masterdata.rs`'s `collection_count_matches_the_fixed_array_length`).
  `EBWebView`/`runs.db`/`runtime/pipeline` etc. are asserted **absent**
  from any produced manifest.
- Backup creation: staging + atomic rename produces a readable archive;
  an interrupted staging (simulated) never produces a file at the final
  name.
- Restore: full restore round-trip against a synthetic fixture directory
  (never real `data`/`.FormuLab`) reproduces byte-identical content;
  pre-restore safety backup is provably created before any live file is
  touched.
- Path-traversal/duplicate-path/symlink rejection: adversarial archive
  fixtures (crafted `../`, duplicate entries, a symlink entry) are
  rejected, not silently sanitized.

**Session-end proportional tests**: `cargo test` scoped to the new
backup module + any Rust modules it touches; `pnpm --filter
@formulab/desktop test` scoped to new frontend restore/backup UI, if
any lands this session. No full shared-suite re-run unless a shared
schema file changed.

## Session 2 — Backup Verification (complete — actual results)

- Rust: 13 new tests in `backup.rs` — `verify_reports_valid_for_a_well_formed_package`,
  `verify_reports_valid_with_warnings_for_an_undeclared_extra_file`,
  `verify_reports_corrupted_for_garbage_bytes_that_are_not_a_zip`,
  `verify_reports_corrupted_for_a_zip_with_no_manifest`,
  `verify_reports_corrupted_for_a_malformed_manifest`,
  `duplicate_names_in_a_raw_name_list_are_detected` (pure-function check +
  a direct assertion that `zip::ZipWriter` itself refuses a duplicate
  entry name), `verify_reports_unsafe_for_a_path_traversal_entry`,
  `verify_reports_corrupted_for_a_hash_mismatch`,
  `verify_reports_corrupted_for_a_size_mismatch`,
  `verify_reports_incompatible_for_an_unsupported_backup_format_version`,
  `verify_reports_incompatible_for_an_unsupported_schema_version`,
  `verify_reports_unsafe_when_runs_db_is_present`,
  `verify_never_touches_the_filesystem_outside_the_given_archive`. Full
  Rust suite re-run: **101/101 passing** (88 prior + 13 new).
- TypeScript: 9 new tests in `BackupRecoveryCard.test.tsx` (picker-
  cancelled no-op, Valid, ValidWithWarnings with warning text, Corrupted
  with error text, Unsafe-distinct-from-Incompatible, Incompatible-
  distinct-from-Corrupted, dismiss-returns-to-idle, verify-itself-fails,
  never-calls-restore-or-create-while-verifying) — **21/21 passing**
  (12 prior + 9 new).
- i18n parity: **23/23 passing** (8-locale `settings.backup.verifyButton/
  verifying/errorsHeading/warningsHeading/status.*/toast.verifyFailed`,
  all real translations).
- Desktop typecheck: clean. Desktop lint: clean.
- Full desktop suite: **not run** — only the existing, already-tested
  `BackupRecoveryCard.tsx` changed; no shared Settings infrastructure or
  global shell behavior changed.

**Focused tests**:
- Each of the five statuses (`valid`/`valid with warnings`/
  `incompatible`/`corrupted`/`unsafe`) reachable via a dedicated fixture
  archive, asserted by name — not just "verification returns something."
- Corruption vs. incompatibility distinguished by two fixtures that
  differ only in which is wrong (one with a flipped byte, one with a
  future `backupFormatVersion`) — both must produce different statuses.
- `.FormuLab/runs.db` presence in an archive is asserted to force
  `unsafe`, directly testing this session's own never-touch finding.

**Session-end proportional tests**: targeted Rust + TS suites covering
the verification module and its call sites (restore's pre-flight check
from Session 1).

## Session 3 — Schema Migration Framework (complete — actual results)

- Rust: 7 new tests in `migration.rs` (schema-meta default-when-absent,
  schema-meta write-then-read round trip, `schema_version_status`
  current/upgradable/future-including-unparseable, journal append-then-
  read round trip in order, missing-journal-path is an empty list not an
  error, interrupted-run detection × 2 including an earlier-completed-run
  not masking a later started one) + 1 new test in `masterdata.rs`
  (`list_master_collections` matches the real `COLLECTIONS` allow-list
  exactly). Full Rust suite re-run: **109/109 passing** (101 prior + 8
  new).
- Shared package: `migrations.test.ts` extended in place (added `id`/
  `description`/`reversible` to every fixture, 2 new tests for the
  `validate` hook passing and failing, 1 new test confirming
  `migrateCollection` never mutates its input) — **13/13 passing** (8
  prior + 5 new/changed).
- TypeScript (desktop): 18 new tests in `migrationRunner.test.ts`
  (`planForCollection` no-registration/ordered-multi-step/missing-
  intermediate-step/already-current-no-op; `computeMigrationPlan` only
  reads registered collections; `dryRunMigration` reports changed rows
  without writing; `runMigration` no-op-at-current-version, future-
  version-rejection-without-touching-collections, backup-required-
  before-write with call-order assertion, journal-step-order,
  validate-failure-triggers-rollback-and-journals-it, unverifiable-
  backup-rejected-before-any-write, idempotent rerun via a stateful
  mock store; interrupted-run detection × 3; thin-command-wrapper
  round trips) — **18/18 passing**. 11 new tests in
  `SchemaMigrationCard.test.tsx` (not-desktop fallback, current-version-
  zero-pending, run-button-enabled-with-pending-plan, rejected-future-
  version banner, dry-run success/failure, run success/failure incl.
  rolled-back-yes/no wording, interrupted-migration banner + recover
  action, no-banner-when-clean) — **11/11 passing**.
- i18n parity: **23/23 passing** (8-locale `settings.migration.*` keys,
  all real translations, no placeholders).
- Help registry: **38/38 passing** (the `settings` topic's existing
  `sections.0`/`warnings` extended in place again — still no new topic).
- Desktop typecheck: clean (one real variance bug caught and fixed along
  the way — constructing a `MigrationRegistry` literal directly with a
  `SchemaMigration<Widget>` object fails TypeScript's contravariant
  parameter check against the type-erased `SchemaMigration<Record<string,
  unknown>>[]` storage type; fixed by using `registerMigration<Widget>()`
  in test fixtures, exactly as the shared package's own tests already
  do — not a framework bug, a test-authoring correction).
- Desktop lint: clean.
- Full desktop suite: **not run** — only `SettingsPage.tsx` (one more
  conditional render block + import) changed outside the new,
  already-tested files; no shared Settings infrastructure or global
  shell behavior changed.

**Originally planned focused tests** (for reference — see actual results above):
- Extends the existing `migrations.test.ts` synthetic-example coverage
  (chain-walking, duplicate `fromVersion`, non-advancing-migration
  throws) — already real and passing; new tests add the journal,
  pre-migration-backup requirement, and future-version rejection this
  session's architecture doc specifies, each as its own synthetic
  example (still no real collection has a version to migrate from yet,
  per the Migration Architecture doc's own honesty about that).
- Interrupted-migration recovery: a journal entry left at `started` with
  no `completed`/`failed` is asserted to trigger restore-from-backup on
  next check, not a resumed in-place mutation.
- Dry-run: asserted to produce zero filesystem writes (a spy/mock on the
  write path, or a real temp-directory run whose mtimes are asserted
  unchanged).

**Session-end proportional tests**: targeted `packages/shared` suite
(migrations.ts and its new journal/wiring companions) plus any
`masterdata.rs` wiring tests, if the session reaches that far. Full
shared-suite re-run only if a schema file's `schemaVersion` literal
itself changes (none is planned).

## Session 4 — Active Data Location Clarification (complete — actual results)

- Rust: 10 new tests in `data_root.rs` (default root when nothing
  configured, `formulab-root.txt` wins over everything, `active-workspace.txt`
  wins when formulab-root is absent, `base-workspace.txt` wins when both
  above are absent, a malformed pointer falls through with a visible
  warning, a missing-target pointer falls through with a visible warning,
  an unwritable-proxy case (a file standing in for a non-directory root)
  is flagged but still returned, multiple valid roots holding real data
  are flagged as a conflict — with an explicit byte-level assertion that
  neither root's files were touched — an empty other-root correctly NOT
  flagged, active/base agreement producing no false conflict). Full Rust
  suite re-run: **119/119 passing** (109 prior + 10 new).
- TypeScript: 11 new tests in `ActiveDataLocationCard.test.tsx`
  (not-desktop fallback, real path + each of the four source labels
  displayed, writable/not-writable, every warning rendered incl. a
  conflict warning, no warning panel when clean, Open Folder calls only
  the read-only reveal command, Refresh reflects a changed status, an
  error state when the status check itself throws) — **11/11 passing**.
  All settings-card tests re-run together (Backup/Verify/Migration/
  DataLocation/Modal/DataFlow/RemoteCompute): **59/59 passing**.
- i18n parity: **23/23 passing** (8-locale `settings.dataLocation.*` keys,
  all real translations).
- Desktop typecheck: clean. Desktop lint: clean.
- Full desktop suite: **not run** — only `SettingsPage.tsx` (one more
  conditional block + import) and the three refactored Rust resolution
  call sites changed outside new, already-tested files; no shared
  Settings infrastructure or global shell behavior changed.

**Originally planned focused tests** (for reference — see actual results above):
- Settings surface, once changed, correctly shows `project_root()`'s
  actual resolution source (including a `formulab-root.txt` override) —
  a synthetic-fixture test setting a fake override and asserting the UI
  data (or the backing command) reports it, closing this session's
  "Settings shows the wrong root" finding.
- Root-conflict detection (base vs. active vs. `formulab-root.txt` all
  present and different) surfaces a real, structured warning rather than
  silently picking one, per the Data Inventory doc's findings.
- `runs.jsonl` (active workspace) vs. `runs.db` (base workspace)
  divergence, if addressed this session, gets a dedicated regression
  test reproducing the exact scenario found in
  `docs/PHASE11_DATA_INVENTORY.md` item 8.

**Session-end proportional tests**: targeted Rust (`workspace.rs`,
`formulation_v2.rs`, `runs_index.rs` if touched) + targeted desktop UI
tests for `SettingsPage.tsx`/`NotebooksPage.tsx` (both already reference
workspace paths).

## Session 5 — Basic Diagnostics and Log Export

**Focused tests**:
- Redaction rules each get a dedicated test: a fixture path containing
  `C:\Users\realname\...` is asserted redacted in the exported bundle;
  a fixture `debug.log` line containing something resembling an API key
  pattern is asserted excluded/redacted (defense in depth, even though
  the real key never reaches Rust-side code per this session's finding).
  Not seeded, if left out. Explicit assertion for zero backup contents.
- Diagnostics summary fields each individually asserted present with
  the correct honest value (e.g. `buildId: null` today, not fabricated).
- Storage-health / collection-health check against a deliberately
  corrupted fixture collection file, asserting it is reported as
  unhealthy rather than silently treated as empty (closing the
  `read_array`-silent-empty-on-parse-failure gap this session found in
  `masterdata.rs:418-423`).

**Session-end proportional tests**: targeted desktop + Rust suites for
the new diagnostics command and bundle exporter. No full regression
unless a shared schema changed (none planned).

## What no session in this first stage runs

Per this session's own scope: none of Sessions 1-5 run the full desktop
suite, full shared suite, full Rust suite, typecheck, lint, release
build, or installer build as a matter of course — each runs targeted
tests for what it touched, with full regression reserved for a future
closure session (matching `AGENTS.md`'s existing "closure sessions"
convention, e.g. Phase 10 Session 8).
