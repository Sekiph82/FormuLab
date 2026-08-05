/**
 * Phase 11 Session 3 — schema migration framework.
 *
 * Orchestrates a schema migration end to end: read the current global
 * schema version, reject an unsupported future one, compute an ordered
 * plan, require a verified pre-migration backup, migrate and persist one
 * collection at a time with a journal entry per step, validate, and roll
 * back to that backup on any failure.
 *
 * Reuses the existing migration engine
 * (`packages/shared/src/engine/migrations.ts` — `migrateCollection`) for
 * every per-record transform, and the existing backup system
 * (`createPreMigrationBackup`/`verifyBackup`/`restoreBackup`, all Tauri
 * commands already used by Sessions 1-2) for the recovery point. This
 * module adds no second backup mechanism and no second migration engine —
 * only the orchestration between them.
 *
 * `MIGRATION_REGISTRY` ships EMPTY by design: no collection has ever
 * shipped at a `schemaVersion` other than `"1.0"` (confirmed across
 * Sessions 0-2). Do not register a migration here speculatively — a real
 * one is added only when a real schema change happens. Every code path
 * below is exercised in `migrationRunner.test.ts` against a synthetic,
 * test-only registry, not this real empty one.
 */
import { migrateCollection, type MigrationRegistry } from "@formulab/shared";
import { applyPreMigrationRetention, isTauri, readAutomaticBackupState, restoreBackup, verifyBackup } from "./tauri";
import { listMasterCollections, listRecords, writeMasterCollectionRaw, type Collection } from "./masterdata";

/** Must match `backup::GLOBAL_SCHEMA_VERSION` (`apps/desktop/src-tauri/src/backup.rs`) —
 *  the two cannot literally share a constant across the Rust/TypeScript
 *  boundary, so this is a doc-linked, not compiler-linked, invariant. */
export const GLOBAL_SCHEMA_VERSION = "1.0";

/** No collection has ever needed one — see the module doc comment. */
export const MIGRATION_REGISTRY: MigrationRegistry = {};

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri) throw new Error("not-desktop");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export interface SchemaMeta {
  globalSchemaVersion: string;
  updatedAt: number;
}

export type SchemaCompatibilityStatus = "current" | "upgradable" | "futureUnsupported";

export interface SchemaCompatibility {
  currentVersion: string;
  supportedVersion: string;
  status: SchemaCompatibilityStatus;
}

export type MigrationJournalStep =
  | "run_started"
  | "collection_started"
  | "collection_completed"
  | "collection_failed"
  | "run_completed"
  | "run_failed"
  | "rolled_back"
  | "rejected_future_version";

export interface MigrationJournalEntry {
  runId: string;
  ts: number;
  step: MigrationJournalStep;
  collection?: string;
  fromVersion?: string;
  toVersion?: string;
  message?: string;
  backupPath?: string;
}

export async function readSchemaMeta(): Promise<SchemaMeta> {
  if (!isTauri) return { globalSchemaVersion: GLOBAL_SCHEMA_VERSION, updatedAt: 0 };
  return call<SchemaMeta>("read_schema_meta");
}

export async function writeSchemaMeta(version: string): Promise<SchemaMeta> {
  return call<SchemaMeta>("write_schema_meta", { version });
}

export async function checkSchemaCompatibility(): Promise<SchemaCompatibility> {
  if (!isTauri) {
    return { currentVersion: GLOBAL_SCHEMA_VERSION, supportedVersion: GLOBAL_SCHEMA_VERSION, status: "current" };
  }
  return call<SchemaCompatibility>("check_schema_compatibility");
}

export async function appendMigrationJournal(entry: MigrationJournalEntry): Promise<void> {
  await call("append_migration_journal", { entry });
}

export async function readMigrationJournal(): Promise<MigrationJournalEntry[]> {
  if (!isTauri) return [];
  return call<MigrationJournalEntry[]>("read_migration_journal");
}

export async function createPreMigrationBackup(): Promise<string> {
  return call<string>("create_pre_migration_backup");
}

/**
 * Phase 11 Session 7 — bounds the previously-unlimited app-private
 * pre-migration backup directory (Session 3's `create_pre_migration_backup`
 * had no retention at all) to the configured `retentionPreMigration` count
 * (default 2, from the automatic-backup settings — the retention count
 * applies regardless of whether the "automatic backups" toggle itself is
 * on, since a pre-migration backup is mandatory per migration run, not
 * part of that schedule). Best-effort: retention is housekeeping, and a
 * failure here must never fail an otherwise-completed migration.
 */
async function pruneOldPreMigrationBackups(): Promise<void> {
  try {
    const { config } = await readAutomaticBackupState();
    await applyPreMigrationRetention(config.retentionPreMigration);
  } catch {
    // Best-effort — see doc comment above.
  }
}

// ------------------------------------------------------------- planning ---

export interface CollectionPlanStep {
  collection: string;
  currentVersion: string;
  targetVersion: string;
  /** Migration ids applied in order — empty means nothing pending. */
  stepIds: string[];
}

export interface MigrationPlan {
  steps: CollectionPlanStep[];
}

function firstRowVersion(rows: readonly { schemaVersion?: string }[]): string {
  return rows[0]?.schemaVersion ?? GLOBAL_SCHEMA_VERSION;
}

/** Walks the registry's chain for one collection by version string only —
 *  never touches a row. Returns `null` when nothing is pending (either no
 *  steps registered for this collection, or the collection is already at
 *  a version with no further registered step). */
export function planForCollection(
  registry: MigrationRegistry,
  collection: string,
  currentVersion: string,
): CollectionPlanStep | null {
  const steps = registry[collection];
  if (!steps || steps.length === 0) return null;
  const stepIds: string[] = [];
  let version = currentVersion;
  const guard = steps.length + 1;
  for (let i = 0; i < guard; i++) {
    const step = steps.find((s) => s.fromVersion === version);
    if (!step) break;
    stepIds.push(step.id);
    version = step.toVersion;
  }
  if (stepIds.length === 0) return null;
  return { collection, currentVersion, targetVersion: version, stepIds };
}

/** Reads every registered collection's current version (from its first
 *  row) and builds the ordered plan. A collection with nothing registered
 *  is never even read — this only touches collections the registry
 *  actually names, which today is none. */
export async function computeMigrationPlan(registry: MigrationRegistry = MIGRATION_REGISTRY): Promise<MigrationPlan> {
  const collections = await listMasterCollections();
  const steps: CollectionPlanStep[] = [];
  for (const [name] of collections) {
    if (!registry[name] || registry[name].length === 0) continue;
    const rows = (await listRecords(name as Collection)) as unknown as { schemaVersion?: string }[];
    const step = planForCollection(registry, name, firstRowVersion(rows));
    if (step) steps.push(step);
  }
  return { steps };
}

// -------------------------------------------------------------- dry run ---

export interface DryRunCollectionResult extends CollectionPlanStep {
  rowsInspected: number;
  rowsThatWouldChange: number;
}

export interface DryRunResult {
  currentGlobalVersion: string;
  supportedVersion: string;
  collections: DryRunCollectionResult[];
}

/** Never writes anything — `migrateCollection` is already side-effect-free
 *  (see `packages/shared/src/engine/migrations.ts`), and this only ever
 *  reads collections through `listRecords`, never `writeMasterCollectionRaw`. */
export async function dryRunMigration(registry: MigrationRegistry = MIGRATION_REGISTRY): Promise<DryRunResult> {
  const compat = await checkSchemaCompatibility();
  const plan = await computeMigrationPlan(registry);
  const collections: DryRunCollectionResult[] = [];
  for (const step of plan.steps) {
    const rows = (await listRecords(step.collection as Collection)) as unknown as { schemaVersion: string }[];
    const { rows: migrated } = migrateCollection(registry, step.collection, rows);
    let changed = 0;
    for (let i = 0; i < rows.length; i++) {
      if (JSON.stringify(migrated[i]) !== JSON.stringify(rows[i])) changed += 1;
    }
    collections.push({ ...step, rowsInspected: rows.length, rowsThatWouldChange: changed });
  }
  return { currentGlobalVersion: compat.currentVersion, supportedVersion: compat.supportedVersion, collections };
}

// -------------------------------------------------------------- run ---

function newRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export type MigrationRunStatus =
  | { kind: "no_pending" }
  | { kind: "rejected_future_version"; currentVersion: string; supportedVersion: string }
  | { kind: "completed"; runId: string; migratedCollections: string[]; newVersion: string }
  | { kind: "failed"; runId: string; message: string; backupPath: string; rolledBack: boolean };

/**
 * Full migration run. Step order (matches
 * docs/PHASE11_MIGRATION_ARCHITECTURE.md and this session's brief):
 * read current version -> reject unsupported future version -> compute
 * plan -> require a verified pre-migration backup -> journal + migrate +
 * persist + journal, one collection at a time -> write the new global
 * version -> journal completion. Any failure rolls back to the
 * pre-migration backup via the existing `restoreBackup` and journals the
 * failure — this run never leaves master data half-migrated as live state.
 */
export async function runMigration(registry: MigrationRegistry = MIGRATION_REGISTRY): Promise<MigrationRunStatus> {
  const compat = await checkSchemaCompatibility();
  if (compat.status === "futureUnsupported") {
    const runId = newRunId();
    await appendMigrationJournal({
      runId,
      ts: Date.now(),
      step: "rejected_future_version",
      message: `data schema version ${compat.currentVersion} is newer than this build supports (${compat.supportedVersion})`,
    });
    return { kind: "rejected_future_version", currentVersion: compat.currentVersion, supportedVersion: compat.supportedVersion };
  }

  const plan = await computeMigrationPlan(registry);
  if (plan.steps.length === 0) {
    return { kind: "no_pending" };
  }

  const runId = newRunId();
  const backupPath = await createPreMigrationBackup();
  const verification = await verifyBackup(backupPath);
  if (verification.status === "corrupted" || verification.status === "unsafe" || verification.status === "incompatible") {
    await appendMigrationJournal({
      runId,
      ts: Date.now(),
      step: "run_failed",
      message: `pre-migration backup failed verification: ${verification.status}`,
      backupPath,
    });
    throw new Error(`pre-migration backup failed verification: ${verification.status}`);
  }

  await appendMigrationJournal({ runId, ts: Date.now(), step: "run_started", backupPath });

  const migratedCollections: string[] = [];
  try {
    for (const step of plan.steps) {
      await appendMigrationJournal({
        runId,
        ts: Date.now(),
        step: "collection_started",
        collection: step.collection,
        fromVersion: step.currentVersion,
        toVersion: step.targetVersion,
      });
      const rows = (await listRecords(step.collection as Collection)) as unknown as { schemaVersion: string }[];
      // Throws on a broken migration (non-advancing version) or a failed
      // `validate` hook — caught below, triggering rollback.
      const { rows: migrated } = migrateCollection(registry, step.collection, rows);
      await writeMasterCollectionRaw(step.collection as Collection, migrated);
      migratedCollections.push(step.collection);
      await appendMigrationJournal({
        runId,
        ts: Date.now(),
        step: "collection_completed",
        collection: step.collection,
        fromVersion: step.currentVersion,
        toVersion: step.targetVersion,
      });
    }

    const newVersion = plan.steps.reduce((v, s) => (s.targetVersion > v ? s.targetVersion : v), compat.supportedVersion);
    await writeSchemaMeta(newVersion);
    await appendMigrationJournal({ runId, ts: Date.now(), step: "run_completed", toVersion: newVersion });
    // Only after a clean completion — a failed run's own pre-migration
    // backup (below) is exactly what a user or `recoverInterruptedMigration`
    // may still need to restore from.
    await pruneOldPreMigrationBackups();
    return { kind: "completed", runId, migratedCollections, newVersion };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await appendMigrationJournal({ runId, ts: Date.now(), step: "collection_failed", message, backupPath });

    let rolledBack = false;
    try {
      await restoreBackup(backupPath);
      rolledBack = true;
      await appendMigrationJournal({ runId, ts: Date.now(), step: "rolled_back", backupPath });
    } catch {
      // Rollback itself failed — the pre-migration backup file still
      // exists on disk (its path is in this run's journal entries and in
      // the returned status) for manual recovery; never silently hidden.
    }
    await appendMigrationJournal({ runId, ts: Date.now(), step: "run_failed", message, backupPath });
    return { kind: "failed", runId, message, backupPath, rolledBack };
  }
}

// ------------------------------------------------------- interrupted runs ---

/** The journal's last `run_started` with no matching
 *  `run_completed`/`run_failed`/`rolled_back` after it — an interrupted
 *  run (the app quit or crashed mid-migration). */
export function findInterruptedRun(entries: readonly MigrationJournalEntry[]): string | null {
  let started: string | null = null;
  for (const e of entries) {
    if (e.step === "run_started") started = e.runId;
    else if ((e.step === "run_completed" || e.step === "run_failed" || e.step === "rolled_back") && started === e.runId) {
      started = null;
    }
  }
  return started;
}

export interface InterruptedMigration {
  runId: string;
  backupPath?: string;
}

export async function checkForInterruptedMigration(): Promise<InterruptedMigration | null> {
  const entries = await readMigrationJournal();
  const runId = findInterruptedRun(entries);
  if (!runId) return null;
  const startEntry = entries.find((e) => e.runId === runId && e.step === "run_started");
  return { runId, backupPath: startEntry?.backupPath };
}

/** Recovery for an interrupted run found on next launch: restore the
 *  pre-migration backup that run recorded, then journal the recovery so a
 *  second launch never re-detects the same run as interrupted. */
export async function recoverInterruptedMigration(runId: string, backupPath: string): Promise<void> {
  await restoreBackup(backupPath);
  await appendMigrationJournal({
    runId,
    ts: Date.now(),
    step: "rolled_back",
    backupPath,
    message: "recovered from an interrupted migration detected on launch",
  });
}
