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

## Session 5 — Basic Diagnostics and Log Export (complete — actual results)

- Rust: 4 new tests in `debug_log.rs` (no rotation below the cap, rotates
  to `.1` once over the cap, shifts an existing rotation chain up and
  drops the oldest, bounded total retention across 10 repeated
  rotations) + 10 new tests in `diagnostics.rs` (Windows username
  redaction, Unix home-username redaction, long-token redaction while
  leaving ordinary short words/sentences untouched, a missing collection
  file reported healthy not unhealthy, a present-but-unparseable
  collection file flagged unhealthy — closing the exact
  `read_array`-silent-empty-on-parse-failure gap Session 0 found,
  last-migration-status picks the most recent terminal journal entry,
  empty journal is `None`, `tail_lines` bounds to the requested count and
  keeps order, a missing log file is an empty list not an error). Full
  Rust suite re-run: **133/133 passing** (119 prior + 14 new).
- TypeScript: 14 new tests in `DiagnosticsCard.test.tsx` (not-desktop
  fallback, loading state, every real field displayed, a failure state
  when the check itself throws, not-writable shown distinctly,
  storage-health failure count shown, root warnings shown, recent-error
  lines shown, last-backup + last-migration + pending-count shown,
  Open Log Folder never calls a write/restore command, Copy Summary's
  clipboard content checked for real field values, Export Support Bundle
  after picking a destination, cancelled-picker no-op, Refresh reflects
  a changed summary) — **14/14 passing**. All settings-card tests
  re-run together (Backup/Verify/Migration/DataLocation/Diagnostics/
  Modal/DataFlow/RemoteCompute): **73/73 passing**.
- i18n parity: **23/23 passing** (8-locale `settings.diagnostics.*` keys,
  all real translations).
- Desktop typecheck: clean. Desktop lint: clean.
- Full desktop suite: **not run** — only `SettingsPage.tsx` (one more
  conditional block + import) changed outside new, already-tested files;
  no shared Settings infrastructure or global shell behavior changed.

## Stage 1 Closure and Verification (complete — full-suite results)

Per this project's own closure-session convention, every full suite ran
exactly once this session (not repeated after, since no code changed
after the last run except the 3 new `activate_staged_files` tests, which
are included in the Rust count below).

- **Rust** (`cargo test --lib`): **136/136 passing** (133 prior + 3 new
  `activate_staged_files` tests in `backup.rs`, closing the one real
  verification gap — "restore failure preserves original data" was
  previously code-inspection-only).
- **Rust clippy** (`cargo clippy --lib`): clean. Closed 3 pre-existing
  warnings from this phase's own code: 2 `clippy::type_complexity`
  (backup.rs, fixed with named type aliases `IncludedFile`/`HashedFile`)
  and 1 `dead_code` (migration.rs's `find_interrupted_run`, fixed with
  `#[allow(dead_code)]` + a doc comment explaining why it's kept).
- **Desktop suite** (`pnpm --filter @formulab/desktop test`): **1094/1094
  passing**, 127/127 files. One real regression found and fixed this
  session: `SettingsPage.i18n.test.tsx` used a single-match `getByText`
  for the fallback string `"available in the desktop app"`, which 5
  different Settings cards (Workspace, Backup and Recovery, Schema
  Migration, Active Data Location, Diagnostics — one per Session 1-5)
  now all render identically outside the desktop app. Confirmed as a real,
  deterministic regression (not flaky) by running the full suite twice
  and comparing which failure persisted; fixed with
  `getAllByText(...).length).toBeGreaterThan(0)`.
- **Shared migration tests** (`packages/shared`'s `migrations.test.ts`):
  13/13 passing.
- **Desktop typecheck** (`tsc --noEmit`): clean.
- **Desktop lint**: clean.
- **i18n parity**: 23/23. **Help registry**: 38/38.
- **Pre-existing, non-deterministic noise** (not a regression): 6
  unhandled-rejection log lines from `HelpPanel.test.tsx` (a documented
  jsdom/undici cross-realm `AbortSignal` incompatibility, predating Phase
  11) appeared in one of the two full-suite runs and not the other,
  confirming they are flaky pre-existing noise rather than a real failure
  — distinguished from the genuine `SettingsPage.i18n.test.tsx` regression
  above, which persisted identically in both runs.

**Full audit**: all 12 of the session's required guarantees mapped to
specific passing tests — see
[`PHASE11_CURRENT.md`](../project-control/claude/handoffs/PHASE11_CURRENT.md#all-12-required-guarantees--confirmed-with-evidence).

## Session 7 — Automatic Backups (Stage 2, complete — actual results)

- Rust: 12 new tests in `automatic_backup.rs` (default-config matches
  recommended defaults, state JSON round-trip incl. a fresh default,
  destination-missing vs. destination-unset distinguished, epoch parsing
  from a filename, per-class retention-count mapping, retention keeps the
  newest N and deletes the oldest, retention never deletes the only valid
  backup even at a configured `0`, retention is isolated per class in a
  shared directory, retention removes orphaned `.tmp` packages from an
  interrupted backup, retention on a missing directory is a no-op not an
  error, naming-convention fixed-string regression, verification-status
  string mapping covers every variant). Full Rust suite re-run (new
  module + `lib.rs`/`Cargo.toml`-adjacent changes): **148/148 passing**
  (136 prior + 12 new). `cargo clippy --lib`: clean (one
  `clippy::result_large_err` warning closed by boxing the `Err` variant,
  not suppressed).
- TypeScript: 21 new tests in `automaticBackup.test.ts`
  (`isDailyEligible`/`isWeeklyEligible`/`nextEligibleAt` pure-function
  behavior, refresh/setConfig write-through, duplicate-trigger prevention
  via a controlled-promise second concurrent `runNow`, success re-reads
  state and never notifies, failure records + notifies incl. missing-
  destination and low-disk-space error text passed through unchanged, a
  failed-verification record carries its verification status, `running`
  clears even when the Rust call throws, `maybeRunScheduled` respecting
  both the master and per-class enabled flags and real eligibility,
  `runOnExit` respecting both `enabled` and `backupOnExitEnabled`) —
  **21/21 passing**. 12 new tests in `AutomaticBackupCard.test.tsx`
  (not-desktop fallback, disabled-state hides schedule controls while
  still showing pre-migration retention, enabled-state reveals them,
  toggling the master switch writes config and reveals the rest, folder
  picker incl. a cancelled picker never writing config, Run Now disabled
  without a destination folder, Run Now triggers a daily-classed run,
  last success/last failure shown with class labels and the failure
  reason, a retention input writes the new count through, Open Folder
  calls only the reveal command, the while-open-only limitation note
  always renders) — **12/12 passing**. 3 new tests in
  `migrationRunner.test.ts` (pre-migration retention is applied with the
  configured count after a `completed` run, retention is never called
  after a `failed` run, a retention failure never fails an otherwise-
  completed migration) — migrationRunner suite **21/21 passing** (18
  prior + 3 new).
- i18n parity: **23/23 passing** (8-locale `settings.automaticBackup.*`,
  all real translations, no placeholders).
- Help registry: full suite passing (the `settings` topic's existing
  `sections.0` extended in place again, one new `warnings.5` entry added
  across all 8 locales — no new topic).
- Desktop typecheck: clean. Desktop lint: clean.
- **Full desktop suite run this session** (`AppShell.tsx` — a global/
  shared file every route mounts — changed, meeting this project's own
  "run broader suites when shared/global behavior changes" trigger):
  **1130/1130 passing** once the one pre-existing flake is isolated —
  `HelpPanel.test.tsx`'s documented jsdom/undici `AbortSignal` cross-realm
  incompatibility (first recorded in the Stage 1 Closure session,
  predates Phase 11 entirely) reproduced 3 failures only when run inside
  the full suite; the same file passes 11/11 in isolation, confirming no
  regression was introduced this session.

**Focused tests** (per this session's own scope):
- Enabled/disabled behavior: `maybeRunScheduled` and the UI's disabled-
  state both gate on the master `enabled` flag independently of the
  per-class flags.
- Daily/weekly eligibility: pure functions tested directly against the
  24-hour/7-day boundary (`now - lastAt >= interval`), not just through
  the store.
- Duplicate-trigger prevention: a synchronous second `runNow` call while
  the first is still in flight rejects immediately (in-tab), backed by
  the Rust-side `BackupState` slot for cross-surface (manual backup, a
  second app instance) concurrency.
- Successful verification / failed verification: both reachable through
  the same Rust `run_automatic_backup_inner` code path Session 2's
  `verify_backup_report` already covers exhaustively — not re-tested at
  the status-enumeration level here, only that a failed one is deleted
  and reported.
- Missing destination / low disk space: distinct, stable error-message
  text asserted to pass through unchanged from Rust to the failure record
  the UI displays.
- Retention by backup class / only-valid-backup protection / interrupted-
  backup cleanup: all three directly unit-tested in Rust against real
  temp-directory fixtures (`apply_retention_keeps_the_newest_n_and_deletes_the_oldest`,
  `apply_retention_never_deletes_the_only_valid_backup_even_at_zero_keep`,
  `apply_retention_removes_orphaned_tmp_packages_from_an_interrupted_backup`).
- Backup-on-exit trigger: `runOnExit`'s gating tested directly; the
  actual `onCloseRequested` window-hook wiring itself is not unit-tested
  (no headless Tauri window in this test environment — the same
  environment limitation Stage 1 Closure's native-verification section
  already documented for UI-content checks) but is a thin, reviewed
  wrapper with no independent logic of its own.
- Settings states: enabled/disabled UI rendering, a configured vs.
  unconfigured destination folder, and populated vs. empty run-history
  fields all covered in `AutomaticBackupCard.test.tsx`.

## Session 8 — Data Location Manager (Stage 2, complete — actual results)

- Rust: 14 new tests in `data_location_manager.rs` (`walk_movable_files`
  excludes `.FormuLab/runs.db` and stray `.formulab-move-staging-*`
  directories, and returns empty for a missing root not an error;
  `validate_destination_at` covers empty/existing-compatible-root/
  conflicting/unwritable/same-as-current, plus insufficient free space
  blocking a move but NOT blocking "use existing" since that path copies
  nothing; `activate_staged` both places every file cleanly and rolls
  back + removes the staging directory on a mid-activation failure;
  `find_interrupted_move` detects an unresolved run and correctly ignores
  an earlier completed one while flagging a later started one;
  `restore_pointer` writes back previous pointer content or removes a
  newly-written file when none existed before; `resume_decision` covers
  every reached-journal-step combination) + 2 new tests in
  `automatic_backup.rs` (`remap_path` preserves the relative path when
  the configured destination was inside the old root, returns `None`
  when it was outside). Full Rust suite re-run: **164/164 passing** (148
  prior + 16 new). `cargo clippy --lib`: clean.
- TypeScript: 20 new tests in `ActiveDataLocationCard.test.tsx`, replacing
  the prior Session 4 file in place (read-only status behavior preserved
  and re-tested: desktop-only fallback, real path/source display,
  open-folder never calling a write/move command; a valid empty
  destination reaching a Move Data confirmation; an existing-compatible
  root reaching a Use Existing Location confirmation; a conflicting
  destination blocking both actions with its real reason shown; 
  insufficient space blocking Move Data specifically; an unwritable
  destination blocking both; a cancelled folder picker never calling
  validate; a full successful move showing files/size/safety-backup
  summary; post-move cleanup gated behind its own separate confirmation
  panel, never called without it; the automatic-backup adjustment note
  rendered when applicable; a safety-backup failure surfacing its exact
  message with the original location still shown as active; a staged
  hash-mismatch failure never rendering a success state; an activation
  failure explicitly confirming the source data untouched in its message;
  a cancelled move (`message === "cancelled"`) returning to idle with no
  failure panel; a full "use existing location" switch with no
  files-moved row shown; Restore Default requiring its confirmation panel
  before the command is ever called; the interrupted-move banner
  appearing on mount, resuming, and clearing; no banner when nothing is
  interrupted) — **20/20 passing**.
- i18n parity: **23/23 passing** (8-locale `settings.dataLocation.*`
  extended with ~45 new keys, all real translations, no placeholders).
- Help registry: full suite passing (`settings` topic's `sections.0`
  extended in place again, one new `warnings.6` entry added across all 8
  locales — still no new topic).
- Desktop typecheck: clean. Desktop lint: clean (one real
  `react-hooks/rules-of-hooks` false positive found and fixed — a
  `use`-prefixed Tauri wrapper function name triggered the hook-naming
  heuristic despite being a plain async function never called
  conditionally; renamed rather than suppressed).
- Full desktop suite: **not run** — only Settings-scoped files changed
  (`ActiveDataLocationCard.tsx`, `tauri.ts`,
  `automatic_backup.rs`/`workspace.rs`/`data_root.rs` visibility-only
  changes); no global/shared shell file changed this session. Every
  `components/settings/*` card test + `SettingsPage.i18n.test.tsx` +
  `migrationRunner.test.ts` + `automaticBackup.test.ts` re-run together:
  **141/141 passing** across 12 files.

**Focused tests** (per this session's own required list):
- Valid empty destination / existing compatible root / conflicting root /
  insufficient space / unwritable destination: all six `DestinationKind`
  outcomes reachable via a dedicated fixture, asserted by name in Rust
  (`validate_destination_at`) and by UI behavior in TypeScript (which
  action buttons appear, which are blocked, and why).
- Safety backup failure / hash mismatch: not independently reproducible
  in a Rust unit test without an `AppHandle` (the same constraint Stage 1
  Closure documented for `verify_backup_report`'s callers) — covered at
  the TypeScript boundary instead, asserting the exact Rust error text
  surfaces unchanged and no success state is ever rendered.
- Interrupted move: journal step-detection tested directly in Rust
  (`find_interrupted_move`, `resume_decision`); the recovery banner and
  its resume action tested in TypeScript against a mocked
  `checkInterruptedDataMove`/`resumeInterruptedDataMove` boundary.
- Activation failure rollback / pointer rollback / old root preserved:
  `activate_staged`'s rollback test asserts byte-for-byte that a
  partially-activated file is removed and the staging directory is gone;
  `restore_pointer`'s test asserts the exact previous-content-or-removed
  behavior a pointer rollback depends on; every move/switch code path
  writes the pointer only as its second-to-last step, after every file is
  already confirmed at its final destination path, so the source root is
  structurally never touched before that point — the TypeScript failure
  tests confirm the ORIGINAL location is still what the status panel
  displays after a failure.
- `.FormuLab/runs.db` excluded: `walk_movable_files_excludes_runs_db_and_stray_staging_dirs`
  directly asserts it is never included in what a move walks — the same
  never-touch rule Session 1's backup engine already enforces, now
  enforced a second, independent time for the move engine specifically.
- Automatic-backup destination adjustment: `remap_path`'s two tests cover
  both the inside-old-root (remapped) and outside-old-root (left alone)
  cases directly; the move-result UI test confirms the adjustment note
  renders when applicable.
- Settings states: every `DestinationKind`, every confirmation panel, the
  interrupted-move banner, and the post-move cleanup gate all covered in
  `ActiveDataLocationCard.test.tsx`.

## Session 9 — Update Checker (Stage 2, complete — actual results)

- Rust: 14 new tests in `updates.rs`, replacing the single old
  `parses_first_release_entry_from_atom` test (the Atom-feed scraper it
  covered was removed along with the rest of the old dual-path fetch) —
  `is_https_url` accepts only `https://` (case-insensitive), rejects
  `http://`/`ftp://`/empty; `enforce_size_limit` accepts exactly the cap
  and rejects one byte over it; `find_platform_asset` matches by OS+arch
  filename keywords and never claims a match for an unrecognized OS;
  `parse_release_metadata` accepts a well-formed response (asserting the
  matched asset name), honestly reports no platform match when none
  fits, rejects a missing version/missing URL/non-HTTPS URL/malformed
  JSON/oversized response each with a distinct message, treats blank
  optional fields as absent, and skips a draft-or-prerelease entry;
  `fetch_release_metadata_bytes` refuses a non-HTTPS endpoint before any
  network call. Full Rust suite re-run: **177/177 passing** (163 prior +
  14 new). `cargo clippy --lib`: clean.
- TypeScript: 30 new tests in `update.test.ts`, replacing the prior
  smaller suite in place (version-comparison tests kept, `shouldAutoCheck`
  extended for configurable frequency, everything else new) —
  `isValidSemver` accept/reject cases, `isHttpsUrl`, `isIgnoredVersion`,
  configurable-frequency launch-eligibility (a shorter frequency makes
  the same elapsed time eligible, a longer one keeps it ineligible),
  `shouldShowUpdateBadge`, and the full store (manual bypasses frequency;
  disabled and not-yet-due automatic checks are both skipped; a same-
  version response is "up to date" not an error — same-version
  rejection; an older/downgrade response is also "up to date," never
  "available" — downgrade rejection; a malformed response version is an
  "error," never silently coerced; HTTPS is enforced on the endpoint
  before ever calling through; `setEndpointUrl` accepts/rejects
  correctly; offline is detected both via `navigator.onLine` before any
  call and via classifying a Rust timeout/connect message after one; an
  oversized/malformed-response Rust error is classified as a generic
  error, not offline; platform-support fields pass through unchanged;
  `ignoreVersion`/`clearIgnoredVersion` suppress/restore `hasUpdate`
  correctly; a newer version after an ignored older one is still
  flagged; a notification fires once per version and never again for
  the same one — duplicate-notification prevention; a newer version
  after that notifies again; an ignored or non-newer version never
  notifies at all; `setFrequencyHours` clamps to a minimum of 1) —
  **30/30 passing**. 19 new tests in `UpdateCheckerCard.test.tsx`
  (desktop-only fallback; idle state with no prior check; manual check
  calls through; checking-state button disabled; up-to-date, failed-
  with-message, and offline-with-hint states; the available-version
  summary with notes and a platform-found note; a platform-missing note
  shown honestly when no asset matched; View Release opens externally
  and only externally; Ignore This Version calls through for the latest
  version; the ignored-version note + Clear Ignored Version shown and
  wired correctly; automatic-check toggle and frequency-select
  enabled/disabled/on-change; Settings-badge toggle; the "checks only,
  never installs" disclaimer always present; release notes containing
  a hostile `<img onerror>`/`<b>` string render as literal text with no
  such element ever created in the DOM) — **19/19 passing**. 2 new tests
  in `systemNotification.test.ts` (`notifyUpdateAvailable` sends with
  permission already granted, never requests permission proactively).
  i18n parity: **23/23 passing** (8-locale `settings.updates.*`, fully
  replaced key set, all real translations). Help registry suite passing
  (`settings` topic's `warnings.7` added across all 8 locales — still no
  new topic). Desktop typecheck: clean. Desktop lint: clean.
- **Full desktop suite run this session** (launch behavior and shared
  update state changed, meeting this session's own "run the full suite
  when shared/launch behavior changes" instruction): **1182/1185
  passing** once the one pre-existing flake is isolated —
  `HelpPanel.test.tsx`'s documented jsdom/undici `AbortSignal` cross-realm
  incompatibility (first recorded in the Stage 1 Closure session,
  reconfirmed in Sessions 7 and 8) reproduced 3 failures only inside the
  full suite; the same file passes 11/11 in isolation, confirming no
  regression this session introduced.

**Focused tests** (per this session's own required list):
- Newer / same / older versions: `isNewerVersion` unit tests plus the
  store's own `check()` behavior for each case — same and older both
  resolve to `"upToDate"`, never an error and never "available."
- Malformed versions: `isValidSemver` rejects `"abc"`/`"1.2"`/`"1.2.x"`/
  `"v1"`/empty directly; the store's `check()` throws a specific "invalid
  version" message when the metadata reports one.
- HTTPS enforcement: tested at three layers — Rust refuses a non-HTTPS
  endpoint before any request (`fetch_release_metadata_bytes`) and a
  non-HTTPS `html_url` field inside an otherwise-valid response
  (`parse_release_metadata`); TypeScript's `check()` refuses to call
  through at all when the configured endpoint itself isn't HTTPS.
- Timeout and offline errors: `navigator.onLine === false` short-circuits
  before any call; a Rust connect/timeout error message is classified as
  `"offline"` client-side; both paths tested directly in `update.test.ts`.
- Oversized or malformed response: Rust's own two-layer size cap
  (`Content-Length` pre-check + hard-capped read) tested via
  `enforce_size_limit` and `parse_release_metadata_rejects_an_oversized_response`;
  malformed JSON, a missing version, and a missing URL each tested with
  their own fixture and assertion on the specific rejection reason.
- Platform/architecture mismatch: `find_platform_asset`'s own tests cover
  a real match, a real non-match (macOS/aarch64 against Windows-only
  assets), and the unknown-OS-never-matches guard.
- Ignored version: full round trip tested in both `update.test.ts`
  (store-level suppression/restoration, a newer-after-ignored-older case)
  and `UpdateCheckerCard.test.tsx` (the ignored-version UI state and its
  Clear action).
- Duplicate-notification prevention: three repeated checks for the same
  version notify exactly once; a genuinely newer version afterward
  notifies again; an ignored or non-newer version never notifies at all.
- Launch-check eligibility: `shouldAutoCheck` tested directly against
  the configurable frequency (not the old fixed interval), plus the
  store's own disabled/not-due skip behavior.
- Settings states: every status (idle/checking/upToDate/updateAvailable/
  error/offline), the available-version summary, both platform-note
  variants, the ignored-version state, and both toggles/the frequency
  select all covered in `UpdateCheckerCard.test.tsx`.

## Stage 2 Closure and Verification (complete — full-suite results)

- Rust: 3 new tests in `data_location_manager.rs`
  (`a_full_stage_and_activate_sequence_leaves_the_source_root_byte_identical`,
  `is_cleanup_safe_refuses_only_when_old_root_is_the_active_root`,
  `is_cleanup_safe_compares_canonicalized_paths_not_raw_strings`), closing
  two guarantees previously confirmed only by code-signature argument.
  Full Rust suite: **180/180 passing** (177 prior + 3 new). `cargo clippy
  --lib`: clean.
- The `HelpPanel.test.tsx` jsdom/undici `AbortSignal` flake — recorded as
  a known limitation in every prior Stage 2 session — was genuinely
  root-caused and fixed this session, not documented around again. See
  `project-control/claude/handoffs/PHASE11_CURRENT.md`'s "Stage 2 Closure" section for the
  full investigation (two ruled-out fix attempts: dependency inlining,
  OS-process-per-file isolation; the actual fix:
  `vite.config.ts`'s `test.fileParallelism: false`).
- **Desktop suite** (`pnpm vitest run`, plain, no flag, no isolation
  needed): **130/130 files, 1185/1185 tests passing**. `HelpPanel.test.tsx`
  run alone, 4 consecutive times: 11/11 passing every time.
- **Shared package** (`pnpm --filter @formulab/shared vitest run`):
  **61/61 files, 1251/1251 tests passing**, including `migrations.test.ts`
  (13/13), run standalone.
- i18n parity: **23/23**. Help registry: **38/38** (`registry.test.ts`)
  plus **9/9** (`tours.test.ts`), run standalone.
- Desktop typecheck: clean. Desktop lint: clean.
- Release build (`pnpm tauri build`): fresh `formulab.exe` + MSI + NSIS
  installers built; see `project-control/claude/handoffs/PHASE11_CURRENT.md` for
  paths/hashes/signing status and native-launch verification.

## What no session in this first stage runs

Per this session's own scope: none of Sessions 1-5 run the full desktop
suite, full shared suite, full Rust suite, typecheck, lint, release
build, or installer build as a matter of course — each runs targeted
tests for what it touched, with full regression reserved for a future
closure session (matching `AGENTS.md`'s existing "closure sessions"
convention, e.g. Phase 10 Session 8).
