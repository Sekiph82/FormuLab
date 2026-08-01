# Phase 11 Schema Migration Architecture

Session 0 (assessment and planning only). This document's central
finding: **a real migration mechanism already exists**
(`packages/shared/src/engine/migrations.ts`, documented in
`docs/MIGRATIONS.md`) and is currently unused by any collection. Session
3 must extend and wire this mechanism, not invent a second one.

## What already exists (read directly, not inferred)

`packages/shared/src/engine/migrations.ts:21-120`:
- `SchemaMigration<T>` — `{ fromVersion, toVersion, migrate: (record: T) => T }`,
  pure, must not mutate its input.
- `MigrationRegistry = Record<string, SchemaMigration[]>` — keyed by
  collection name.
- `registerMigration(registry, collection, migration)` — throws on a
  duplicate `fromVersion` for the same collection (`migrations.ts:49-53`).
- `migrateRecord(registry, collection, record)` — walks the chain from
  the record's current `schemaVersion` forward until no further step
  applies; throws if a step claims to advance but doesn't
  (`migrations.ts:88-96`, prevents an infinite loop).
- `migrateCollection(registry, collection, rows)` — maps
  `migrateRecord` over every row, reports `anyMigrated` so a caller can
  decide whether to persist the upgraded rows.
- **Never reads or writes a file itself** — persistence stays the
  caller's job (`migrations.ts:103-107`, `docs/MIGRATIONS.md:53-57`).
- **Nothing is registered today** — every one of the 90 master
  collections (`masterdata.rs:122`) launched at `schemaVersion: "1.0"`
  with no prior version to migrate from (`docs/MIGRATIONS.md:59-76`).
  Existing collections are unaffected by the runner's mere existence —
  opting one in is a deliberate, future, per-collection change.
- Real tests already exist and pass against a synthetic example
  (`packages/shared/src/engine/migrations.test.ts`) — chain-walking,
  duplicate-detection, non-advancing-migration-throws.

## Gaps this session identifies (what Session 3 actually needs to add)

1. **No global application-data schema version.** Only per-record
   `schemaVersion` literals exist (`z.literal("1.0")`, confirmed by grep
   across all 24 schema files that declare one). There is nothing today
   that answers "is this whole data root current" in one read — only
   "is this one record current."
2. **Nothing calls `migrateRecord`/`migrateCollection` automatically.**
   `masterdata.rs`'s `list_master_records`/`upsert_master_records`
   (`masterdata.rs:448-513`) read/write raw `serde_json::Value` rows with
   no migration pass at all — a record from a future schema version and
   a record from a past one are both accepted identically today.
3. **No migration journal.** Nothing records that a migration ran, when,
   against which collection, or whether it completed — a prerequisite
   for "interrupted-migration recovery."
4. **No pre-migration verified-backup requirement.** Nothing currently
   forces a backup (verified or otherwise) to exist before a migration
   mutates data — because nothing currently mutates data via a
   migration at all.
5. **No future-version rejection at the storage layer.** Since every
   collection is pinned to a `z.literal`, a record claiming a *future*
   `schemaVersion` would currently fail Zod parsing wherever a caller
   actually validates against the schema (most engine functions do) —
   but `masterdata.rs`'s raw JSON read path (item 2) would still load
   and hand back that row uninterpreted, since Rust never runs the Zod
   schema at all. Whether that constitutes "acceptance" or "silent
   pass-through" is exactly the kind of ambiguity a real global-version
   check needs to close.
6. **No intermediate-version sequencing beyond single-collection
   chains.** The existing runner correctly sequences
   `1.0 -> 1.1 -> 1.2` for one collection, but has no concept of
   cross-collection ordering (e.g., "migrate `regulatory_rules` before
   `regulatory_reviews` because the latter snapshots the former's
   version") — no evidence such an ordering dependency exists yet, so
   this is recorded as a future-proofing question, not a confirmed
   requirement.

## Design (extends, does not replace, `migrations.ts`)

- **Global application-data schema version**: a new, single value (e.g.
  `data/master/_meta.json` or a dedicated top-level file under
  `project_root()`, exact location decided in Session 3 after checking
  for naming collisions against the 90 existing collection files) —
  recording the highest `schemaVersion` any registered collection has
  reached, so "is this data root current" is one file read, not 90.
- **Ordered migration registry**: reuse `MigrationRegistry` as-is;
  Session 3 adds actual `registerMigration` calls the first time a real
  schema change needs one (still none today) plus the wiring described
  below.
- **Migration identifier**: not present in the current `SchemaMigration`
  shape (only `fromVersion`/`toVersion`/`migrate` — no `id` field).
  Session 3 should add an explicit `id: string` for journal entries to
  reference, since `fromVersion -> toVersion` alone is ambiguous if two
  different migrations both claim the same version pair (the current
  duplicate-detection only catches duplicate `fromVersion`, not
  duplicate `(fromVersion, toVersion)` under a different `id`).
- **Preconditions / validation operation**: not present today
  (`SchemaMigration` has only `migrate`, no separate `validate` or
  `precondition` hook). Session 3 should add an optional `validate:
  (record: T) => boolean` run after `migrate`, distinct from `migrate`
  itself, so a migration can assert its own output rather than trusting
  the transform blindly — consistent with this session's instruction not
  to plan destructive mutation without a verification step.
- **Idempotency**: `migrateRecord` is already naturally idempotent for a
  record already at its target version (returns unchanged, `applied: []`)
  — no new work needed here, only a test asserting it explicitly for
  each real migration once one exists.
- **Migration journal**: new — a `data/master/_migration_journal.jsonl`
  (append-only, matching the existing `audit.jsonl`/`runs.jsonl`
  convention already used elsewhere) recording
  `{ timestamp, collection, migrationId, fromVersion, toVersion, recordCount, status }`
  per run, `status` in `{started, completed, failed}`.
- **Interrupted-migration recovery**: on next launch, if the journal's
  last entry for a collection is `started` with no matching `completed`/
  `failed`, treat that collection as **not migrated** and re-run from
  its pre-migration verified backup (see next point) rather than
  resuming a partial in-place mutation — matches this session's
  instruction against in-place destructive mutation without a recovery
  point.
- **Required pre-migration verified backup**: any migration that touches
  files on disk must first produce a backup (via the mechanism in
  `docs/PHASE11_BACKUP_RESTORE_ARCHITECTURE.md`) and run it through
  Backup Verification before proceeding — a migration never runs against
  unverified state.
- **Future-version rejection**: a record whose `schemaVersion` is higher
  than any registered `toVersion` for its collection must be refused by
  the (new) storage-layer wiring, surfaced as a clear "this data was
  written by a newer version of FormuLab" error rather than silently
  loaded — closing gap 5 above.
- **Non-reversible migration declaration**: add an optional
  `reversible: boolean` (default `false`) to `SchemaMigration` so a
  destructive transform (e.g. dropping a field) can declare itself
  unwind-only-via-backup, distinct from one that could offer an inverse.
  No migration needs this yet — declared as a forward-looking field.
- **Restore behavior after migration failure**: falls through to the
  interrupted-migration-recovery path above — restore the pre-migration
  verified backup, never leave a collection half-migrated as live state.
- **Dry-run behavior**: `migrateCollection` already supports this
  naturally (it never writes anything itself, per `docs/MIGRATIONS.md`'s
  own description) — a dry run is simply calling it and inspecting
  `anyMigrated`/the returned rows without the caller persisting them.
  Session 3 should expose this as an explicit CLI/diagnostic-visible
  mode rather than relying on callers to know this side-effect-free
  property already holds.
- **Fixture strategy for prior real formats**: per this session's
  instruction not to invent historical schemas unsupported by source or
  git history — since every real collection has only ever existed at
  `"1.0"` (confirmed: no collection's schema file shows a second
  literal or a union of versions), there is currently **no real prior
  format to build a fixture from**. The first genuine migration fixture
  will be authored when the first real schema change actually happens;
  until then, `migrations.test.ts`'s existing synthetic example remains
  the only exercised case, and that is accurate, not a gap to backfill.

## Session 3 implementation notes (what actually shipped)

Everything in this section is real, built, and tested — not a plan.

- **Engine change** (`packages/shared/src/engine/migrations.ts`):
  `SchemaMigration<T>` gained `id: string`, `description: string`,
  `reversible: boolean` (all required — every future real migration must
  declare them), and `validate?: (record: T) => boolean` (optional).
  `migrateRecord` runs `validate` immediately after `migrate` and throws
  a step-identified error on `false`, using the exact same "throw, don't
  silently continue" convention the pre-existing non-advancing-version
  guard already used. `applied` log entries are now `"<id>: <from> ->
  <to>"` instead of bare `"<from> -> <to>"`.
- **Global schema version**: `data/master/schema_meta.json`, Rust-owned
  (`migration.rs`'s `read_schema_meta`/`write_schema_meta`), write-then-
  rename like every other persisted file in this codebase. Absent file =
  implicitly current (`GLOBAL_SCHEMA_VERSION`, `"1.0"`, re-exported from
  `backup.rs` — one constant, not two).
- **Compatibility check**: `migration::schema_version_status(declared,
  supported)` — a dedicated `major.minor` comparator, NOT a reuse of
  `backup.rs`'s `major.minor.patch` app-version comparator, because
  schema versions and app versions are genuinely different-shaped
  strings in this codebase (`"1.0"` vs `"0.4.0"`) and forcing one parser
  to handle both would either silently mis-parse or need format-sniffing
  neither version scheme asks for.
- **Migration registry**: `apps/desktop/src/lib/migrationRunner.ts`'s
  `MIGRATION_REGISTRY` is empty, exactly as planned — confirmed again
  this session that no collection has ever shipped at anything but
  `"1.0"`.
- **Plan computation**: `computeMigrationPlan()` calls the new
  `list_master_collections` (masterdata.rs, exposes the real 90-entry
  allow-list) and only ever calls `listRecords` for a collection the
  registry actually names — today, none. `planForCollection` walks the
  registry chain by version string alone (no row access), matching the
  architecture originally sketched.
- **Dry run**: `dryRunMigration()` — read-only, `migrateCollection` is
  already side-effect-free, comparison is a plain `JSON.stringify` diff
  per row. Never calls `writeMasterCollectionRaw`; a dedicated test
  asserts this directly.
- **Pre-migration backup**: `create_pre_migration_backup` (Rust) calls
  `backup::try_create_backup` (widened to `pub(crate)` for this reuse)
  directly, writing into app-private storage
  (`app_private_dir(app, "backups")`), never a user-facing save dialog —
  the same pattern Session 1's restore safety-backup already established.
  The orchestrator then calls the existing `verifyBackup` command
  unchanged; any status other than `valid`/`validWithWarnings` aborts
  before touching a single collection.
- **The append-only write problem, solved**: `upsert_master_records`
  refuses to overwrite an existing key in an append-only collection by
  design (Session 0 finding). A real migration would need to rewrite
  existing rows in place, which that refusal structurally blocks.
  Resolved with `write_master_collection_raw` (masterdata.rs) — a
  migration-only whole-file overwrite, safe specifically because the
  runner never reaches it without a verified backup already in hand.
  Documented in the function's own doc comment as a trust boundary: it
  is not itself access-controlled beyond "only the migration runner calls
  it today."
- **Journal steps** (`MigrationJournalEntry.step`): `run_started` (with
  the backup path attached) → per-collection `collection_started`/
  `collection_completed` → `run_completed`; or
  `collection_failed` → `rolled_back` → `run_failed` on any error.
  `rejected_future_version` is journaled on its own before any backup is
  made. `findInterruptedRun` (TypeScript) / `find_interrupted_run` (Rust)
  both implement the same "started with no terminal entry" check,
  independently unit-tested on each side (not shared code across the
  language boundary, since there is no mechanism to share it).
- **Rollback**: on any thrown error inside the per-collection loop (a
  broken `migrate`, a failed `validate`, a write failure),
  `runMigration` calls the existing `restoreBackup` with the pre-migration
  backup path, journals `rolled_back` (or skips straight to `run_failed`
  if the restore itself throws — the backup file's path is still
  returned to the caller for manual recovery, never silently dropped).
- **UI**: `SchemaMigrationCard` (Settings → General) — current version,
  pending count, Dry Run / Run Migration, a rejected-future-version
  banner, a completed/failed result panel, and an interrupted-migration
  recovery banner checked on mount via `checkForInterruptedMigration`.
  Never migrates without an explicit click.

## What Session 3 must not do

- Must not register a migration for any of the 90 existing collections
  speculatively — none has a version change to migrate from.
- Must not invent a schema history that git/source does not show.
- Must not wire automatic migration-on-every-read into `masterdata.rs`
  without the journal + pre-migration backup + validation pieces above
  landing first — automatic silent mutation of on-disk data without a
  recovery point is exactly what this session's instructions prohibit.
