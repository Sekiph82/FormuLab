/**
 * The minimum reliable local migration runner this platform needs today.
 *
 * Every persisted record already carries a `schemaVersion` field (every
 * schema in `schemas/` sets one), but nothing previously walked a record
 * from an old version forward — a schema change meant either a manual,
 * ad hoc conversion script or quietly leaving old records unreadable. This
 * module is that walk: register a chain of small, one-step migrations per
 * collection, and `migrateRecord` applies whichever steps a given record
 * still needs, in order, stopping at the current version.
 *
 * Deliberately NOT a general schema-registry or an auto-migrating store —
 * see docs/MIGRATIONS.md for what is out of scope (the full 38-section
 * migration roadmap is not attempted here, only what the optimizer and
 * substitution collections need to be readable going forward). Existing
 * collections (materials, formulations, compatibility/safety rules, ...)
 * are unaffected: they are not registered here, so `migrateRecord` is a
 * no-op for them until someone deliberately opts a collection in.
 */

export interface SchemaMigration<T = Record<string, unknown>> {
  /** The exact `schemaVersion` a record must have for this step to apply. */
  fromVersion: string;
  toVersion: string;
  /** Pure: takes a record at `fromVersion`, returns one at `toVersion`.
   *  Must not mutate its input — callers may hold a reference to the
   *  original record (e.g. for a diff or a backup) across the call. */
  migrate: (record: T) => T;
}

export type MigrationRegistry = Record<string, SchemaMigration[]>;

/** Add one migration step for `collection`. Steps are looked up by
 *  `fromVersion` at run time, so registration order does not matter, but
 *  registering two steps with the same `fromVersion` for one collection is a
 *  programming error (ambiguous which one should run) and throws
 *  immediately rather than silently picking one. */
export function registerMigration(
  registry: MigrationRegistry,
  collection: string,
  migration: SchemaMigration,
): void {
  const steps = (registry[collection] ??= []);
  if (steps.some((s) => s.fromVersion === migration.fromVersion)) {
    throw new Error(
      `duplicate migration for "${collection}" from version "${migration.fromVersion}"`,
    );
  }
  steps.push(migration);
}

export interface MigrationResult<T = Record<string, unknown>> {
  record: T;
  /** `fromVersion -> toVersion` labels, in the order applied. Empty when the
   *  record was already current (including when the collection has no
   *  migrations registered at all). */
  applied: string[];
}

/**
 * Walk `record` forward through `collection`'s registered chain until no
 * further step applies. Never loops forever: each step must strictly
 * advance `schemaVersion` (checked below), and a record whose current
 * version has no registered next step is returned as-is — this is the
 * common case (already current), not an error.
 *
 * Throws only when a step's own `migrate` claims to advance the version but
 * doesn't (a broken migration), which would otherwise spin forever.
 */
export function migrateRecord<T extends { schemaVersion: string }>(
  registry: MigrationRegistry,
  collection: string,
  record: T,
): MigrationResult<T> {
  const steps = registry[collection];
  if (!steps || steps.length === 0) {
    return { record, applied: [] };
  }
  const applied: string[] = [];
  let current: T = record;
  // Bounded by the chain length so a cyclic registration can't hang a caller.
  const guard = steps.length + 1;
  for (let i = 0; i < guard; i++) {
    const step = steps.find((s) => s.fromVersion === current.schemaVersion);
    if (!step) break;
    const next = step.migrate(current) as T;
    if (next.schemaVersion === current.schemaVersion) {
      throw new Error(
        `migration for "${collection}" from "${step.fromVersion}" did not advance schemaVersion`,
      );
    }
    applied.push(`${step.fromVersion} -> ${next.schemaVersion}`);
    current = next;
  }
  return { record: current, applied };
}

/** Convenience for a whole collection read from disk: migrate every row,
 *  and report which ones actually changed so a caller can decide whether to
 *  write the upgraded rows back (this module never writes anything itself —
 *  persistence stays the caller's responsibility, matching every other
 *  engine module in this package). */
export function migrateCollection<T extends { schemaVersion: string }>(
  registry: MigrationRegistry,
  collection: string,
  rows: readonly T[],
): { rows: T[]; anyMigrated: boolean } {
  let anyMigrated = false;
  const migrated = rows.map((row) => {
    const { record, applied } = migrateRecord(registry, collection, row);
    if (applied.length > 0) anyMigrated = true;
    return record;
  });
  return { rows: migrated, anyMigrated };
}
