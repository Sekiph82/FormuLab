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

## Session 2 — Backup Verification

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

## Session 3 — Schema Migration Framework

**Focused tests**:
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

## Session 4 — Active Data Location Clarification

**Focused tests**:
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
