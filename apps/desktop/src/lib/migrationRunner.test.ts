import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerMigration, type MigrationRegistry } from "@formulab/shared";
import type { BackupManifest, RestoreResult, VerificationReport } from "./tauri";

const bridge = {
  isTauri: true,
  verifyBackup: vi.fn<(source: string) => Promise<VerificationReport>>(),
  restoreBackup: vi.fn<(source: string) => Promise<RestoreResult>>(),
};

const masterdataBridge = {
  listMasterCollections: vi.fn<() => Promise<Array<[string, boolean]>>>(),
  listRecords: vi.fn<(collection: string) => Promise<unknown[]>>(),
  writeMasterCollectionRaw: vi.fn<(collection: string, records: unknown[]) => Promise<void>>(),
};

vi.mock("./tauri", () => ({
  get isTauri() {
    return bridge.isTauri;
  },
  verifyBackup: (...a: [string]) => bridge.verifyBackup(...a),
  restoreBackup: (...a: [string]) => bridge.restoreBackup(...a),
}));

vi.mock("./masterdata", () => ({
  listMasterCollections: () => masterdataBridge.listMasterCollections(),
  listRecords: (...a: [string]) => masterdataBridge.listRecords(...a),
  writeMasterCollectionRaw: (...a: [string, unknown[]]) => masterdataBridge.writeMasterCollectionRaw(...a),
}));

import {
  appendMigrationJournal,
  checkForInterruptedMigration,
  checkSchemaCompatibility,
  computeMigrationPlan,
  createPreMigrationBackup,
  dryRunMigration,
  findInterruptedRun,
  planForCollection,
  readMigrationJournal,
  readSchemaMeta,
  runMigration,
  writeSchemaMeta,
  type MigrationJournalEntry,
} from "./migrationRunner";

interface Widget {
  schemaVersion: string;
  code: string;
}

function widgetRegistry(): MigrationRegistry {
  const registry: MigrationRegistry = {};
  registerMigration<Widget>(registry, "widgets", {
    id: "widgets-1.0-to-1.1",
    fromVersion: "1.0",
    toVersion: "1.1",
    description: "Bump to 1.1.",
    reversible: true,
    migrate: (r) => ({ ...r, schemaVersion: "1.1" }),
  });
  registerMigration<Widget>(registry, "widgets", {
    id: "widgets-1.1-to-1.2",
    fromVersion: "1.1",
    toVersion: "1.2",
    description: "Bump to 1.2.",
    reversible: true,
    migrate: (r) => ({ ...r, schemaVersion: "1.2" }),
  });
  return registry;
}

const journalCalls: MigrationJournalEntry[] = [];

// The Rust side of the journal/schema-meta/backup commands is exercised in
// `apps/desktop/src-tauri/src/migration.rs`'s own tests; here, `isTauri` is
// forced true so this module's orchestration logic runs against mocked
// masterdata/tauri boundaries, matching the rest of this repo's
// real-component/mocked-Tauri-boundary discipline.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "append_migration_journal") {
      journalCalls.push(args?.entry as MigrationJournalEntry);
      return undefined;
    }
    if (cmd === "read_migration_journal") return [...journalCalls];
    if (cmd === "read_schema_meta") return { globalSchemaVersion: "1.0", updatedAt: 0 };
    if (cmd === "write_schema_meta") return { globalSchemaVersion: args?.version, updatedAt: 1 };
    if (cmd === "check_schema_compatibility") {
      return { currentVersion: "1.0", supportedVersion: "1.0", status: "current" };
    }
    if (cmd === "create_pre_migration_backup") return "C:\\backups\\pre-migration-1.formulab-backup";
    throw new Error(`unexpected invoke: ${cmd}`);
  }),
}));

function manifest(): BackupManifest {
  return {
    backupFormatVersion: "1.0",
    formulabAppVersion: "0.4.0",
    createdAt: 1_800_000_000,
    dataRoot: {
      resolvedProjectRoot: "C:\\test",
      resolvedWorkspaceRoot: "C:\\test",
      resolvedBaseRoot: "C:\\test",
      formulabRootOverrideActive: false,
      activeWorkspaceOverrideActive: false,
    },
    schemaVersions: { _global: "1.0" },
    included: [],
    excluded: [],
    fileInventory: [],
    totalBytes: 0,
    warnings: [],
    compatibility: { minSupportedAppVersion: "0.4.0", maxKnownAppVersion: "0.4.0" },
  };
}

beforeEach(() => {
  bridge.isTauri = true;
  bridge.verifyBackup.mockReset();
  bridge.restoreBackup.mockReset();
  masterdataBridge.listMasterCollections.mockReset();
  masterdataBridge.listRecords.mockReset();
  masterdataBridge.writeMasterCollectionRaw.mockReset();
  journalCalls.length = 0;
  bridge.verifyBackup.mockResolvedValue({ status: "valid", manifest: manifest(), errors: [], warnings: [] });
});

describe("planForCollection", () => {
  it("is null when nothing is registered for the collection", () => {
    expect(planForCollection({}, "widgets", "1.0")).toBeNull();
  });

  it("walks an ordered multi-step chain", () => {
    const plan = planForCollection(widgetRegistry(), "widgets", "1.0");
    expect(plan).toEqual({
      collection: "widgets",
      currentVersion: "1.0",
      targetVersion: "1.2",
      stepIds: ["widgets-1.0-to-1.1", "widgets-1.1-to-1.2"],
    });
  });

  it("stops at a missing intermediate migration rather than erroring", () => {
    const registry = widgetRegistry();
    registry.widgets = [registry.widgets[0]]; // only 1.0 -> 1.1, no 1.1 -> 1.2
    const plan = planForCollection(registry, "widgets", "1.0");
    expect(plan?.targetVersion).toBe("1.1");
    expect(plan?.stepIds).toEqual(["widgets-1.0-to-1.1"]);
  });

  it("is null when the collection is already at its current version (no-op)", () => {
    const plan = planForCollection(widgetRegistry(), "widgets", "1.2");
    expect(plan).toBeNull();
  });
});

describe("computeMigrationPlan", () => {
  it("never reads a collection that has nothing registered", async () => {
    masterdataBridge.listMasterCollections.mockResolvedValue([
      ["widgets", false],
      ["materials", false],
    ]);
    masterdataBridge.listRecords.mockResolvedValue([{ schemaVersion: "1.0", code: "w1" }]);
    const registry: MigrationRegistry = { widgets: widgetRegistry().widgets };
    const plan = await computeMigrationPlan(registry);
    expect(plan.steps.map((s) => s.collection)).toEqual(["widgets"]);
    expect(masterdataBridge.listRecords).toHaveBeenCalledTimes(1);
    expect(masterdataBridge.listRecords).toHaveBeenCalledWith("widgets");
  });
});

describe("dryRunMigration", () => {
  it("reports rows that would change without writing anything back", async () => {
    masterdataBridge.listMasterCollections.mockResolvedValue([["widgets", false]]);
    masterdataBridge.listRecords.mockResolvedValue([
      { schemaVersion: "1.0", code: "w1" },
      { schemaVersion: "1.2", code: "w2" },
    ]);
    const result = await dryRunMigration(widgetRegistry());
    expect(result.collections).toHaveLength(1);
    expect(result.collections[0].rowsInspected).toBe(2);
    expect(result.collections[0].rowsThatWouldChange).toBe(1);
    expect(masterdataBridge.writeMasterCollectionRaw).not.toHaveBeenCalled();
  });
});

describe("runMigration", () => {
  it("is a no-op when nothing is pending (current version)", async () => {
    masterdataBridge.listMasterCollections.mockResolvedValue([["widgets", false]]);
    const status = await runMigration({});
    expect(status).toEqual({ kind: "no_pending" });
    expect(masterdataBridge.writeMasterCollectionRaw).not.toHaveBeenCalled();
  });

  it("rejects a future, unsupported data schema version without touching any collection", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as ReturnType<typeof vi.fn>).mockImplementationOnce(async (cmd: string) => {
      if (cmd === "check_schema_compatibility") {
        return { currentVersion: "9.9", supportedVersion: "1.0", status: "futureUnsupported" };
      }
      throw new Error("unreachable");
    });
    const status = await runMigration(widgetRegistry());
    expect(status.kind).toBe("rejected_future_version");
    expect(masterdataBridge.listMasterCollections).not.toHaveBeenCalled();
    expect(journalCalls.some((e) => e.step === "rejected_future_version")).toBe(true);
  });

  it("requires a verified backup before migrating any collection", async () => {
    masterdataBridge.listMasterCollections.mockResolvedValue([["widgets", false]]);
    masterdataBridge.listRecords.mockResolvedValue([{ schemaVersion: "1.0", code: "w1" }]);
    const order: string[] = [];
    bridge.verifyBackup.mockImplementation(async () => {
      order.push("verify");
      return { status: "valid", manifest: manifest(), errors: [], warnings: [] };
    });
    masterdataBridge.writeMasterCollectionRaw.mockImplementation(async () => {
      order.push("write");
    });
    await runMigration(widgetRegistry());
    expect(order).toEqual(["verify", "write"]);
    expect(bridge.verifyBackup).toHaveBeenCalledWith("C:\\backups\\pre-migration-1.formulab-backup");
  });

  it("journals run_started, collection steps, and run_completed in order", async () => {
    masterdataBridge.listMasterCollections.mockResolvedValue([["widgets", false]]);
    masterdataBridge.listRecords.mockResolvedValue([{ schemaVersion: "1.0", code: "w1" }]);
    await runMigration(widgetRegistry());
    const steps = journalCalls.map((e) => e.step);
    expect(steps).toEqual(["run_started", "collection_started", "collection_completed", "run_completed"]);
  });

  it("rolls back and journals failure when a step's validate hook fails", async () => {
    masterdataBridge.listMasterCollections.mockResolvedValue([["widgets", false]]);
    masterdataBridge.listRecords.mockResolvedValue([{ schemaVersion: "1.0", code: "w1" }]);
    bridge.restoreBackup.mockResolvedValue({
      manifest: manifest(),
      safetyBackupPath: "C:\\backups\\pre-restore.formulab-backup",
      restoredPaths: [],
      warnings: [],
    });
    const registry: MigrationRegistry = {};
    registerMigration<Widget>(registry, "widgets", {
      id: "widgets-broken",
      fromVersion: "1.0",
      toVersion: "1.1",
      description: "Deliberately fails validation in this test.",
      reversible: true,
      migrate: (r) => ({ ...r, schemaVersion: "1.1" }),
      validate: () => false,
    });
    const status = await runMigration(registry);
    expect(status.kind).toBe("failed");
    if (status.kind === "failed") {
      expect(status.rolledBack).toBe(true);
      expect(status.message).toMatch(/failed its own post-migration validation/);
    }
    expect(bridge.restoreBackup).toHaveBeenCalledWith("C:\\backups\\pre-migration-1.formulab-backup");
    expect(masterdataBridge.writeMasterCollectionRaw).not.toHaveBeenCalled();
    const steps = journalCalls.map((e) => e.step);
    expect(steps).toEqual(["run_started", "collection_started", "collection_failed", "rolled_back", "run_failed"]);
  });

  it("rejects an unverifiable pre-migration backup before touching any collection", async () => {
    masterdataBridge.listMasterCollections.mockResolvedValue([["widgets", false]]);
    masterdataBridge.listRecords.mockResolvedValue([{ schemaVersion: "1.0", code: "w1" }]);
    bridge.verifyBackup.mockResolvedValue({ status: "corrupted", manifest: manifest(), errors: [], warnings: [] });
    await expect(runMigration(widgetRegistry())).rejects.toThrow(/failed verification/);
    expect(masterdataBridge.writeMasterCollectionRaw).not.toHaveBeenCalled();
  });

  it("is idempotent on a rerun — the second run finds nothing pending", async () => {
    // Simulate persisted state: listRecords reflects whatever was last
    // written via writeMasterCollectionRaw, exactly like the real Rust
    // store would after a successful write.
    let stored: Widget[] = [{ schemaVersion: "1.0", code: "w1" }];
    masterdataBridge.listMasterCollections.mockResolvedValue([["widgets", false]]);
    masterdataBridge.listRecords.mockImplementation(async () => stored);
    masterdataBridge.writeMasterCollectionRaw.mockImplementation(async (_collection, records) => {
      stored = records as Widget[];
    });

    const first = await runMigration(widgetRegistry());
    expect(first.kind).toBe("completed");
    expect(stored[0].schemaVersion).toBe("1.2");

    const second = await runMigration(widgetRegistry());
    expect(second).toEqual({ kind: "no_pending" });
    expect(masterdataBridge.writeMasterCollectionRaw).toHaveBeenCalledTimes(1);
  });
});

describe("interrupted-migration detection", () => {
  it("finds a started run with no completion", () => {
    const entries: MigrationJournalEntry[] = [
      { runId: "run-1", ts: 1, step: "run_started", backupPath: "C:\\b.formulab-backup" },
    ];
    expect(findInterruptedRun(entries)).toBe("run-1");
  });

  it("is null once a matching run_completed/run_failed/rolled_back follows", () => {
    const base: MigrationJournalEntry = { runId: "run-1", ts: 1, step: "run_started" };
    expect(findInterruptedRun([base, { ...base, ts: 2, step: "run_completed" }])).toBeNull();
    expect(findInterruptedRun([base, { ...base, ts: 2, step: "run_failed" }])).toBeNull();
    expect(findInterruptedRun([base, { ...base, ts: 2, step: "rolled_back" }])).toBeNull();
  });

  it("checkForInterruptedMigration surfaces the run id and its backup path", async () => {
    journalCalls.push({
      runId: "run-2",
      ts: 1,
      step: "run_started",
      backupPath: "C:\\backups\\pre-migration-2.formulab-backup",
    });
    const found = await checkForInterruptedMigration();
    expect(found).toEqual({ runId: "run-2", backupPath: "C:\\backups\\pre-migration-2.formulab-backup" });
  });

  it("checkForInterruptedMigration is null when the journal is empty or clean", async () => {
    expect(await checkForInterruptedMigration()).toBeNull();
  });
});

describe("thin command wrappers", () => {
  it("readSchemaMeta/writeSchemaMeta/checkSchemaCompatibility/journal/backup all call through", async () => {
    expect(await readSchemaMeta()).toEqual({ globalSchemaVersion: "1.0", updatedAt: 0 });
    expect(await writeSchemaMeta("1.1")).toEqual({ globalSchemaVersion: "1.1", updatedAt: 1 });
    expect(await checkSchemaCompatibility()).toEqual({
      currentVersion: "1.0",
      supportedVersion: "1.0",
      status: "current",
    });
    await appendMigrationJournal({ runId: "r", ts: 1, step: "run_started" });
    expect(await readMigrationJournal()).toHaveLength(1);
    expect(await createPreMigrationBackup()).toBe("C:\\backups\\pre-migration-1.formulab-backup");
  });
});
