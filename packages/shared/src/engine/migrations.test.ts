import { describe, expect, it } from "vitest";
import {
  migrateCollection,
  migrateRecord,
  registerMigration,
  type MigrationRegistry,
} from "./migrations";

interface Widget {
  schemaVersion: string;
  code: string;
  color?: string;
  colour?: string;
}

function freshRegistry(): MigrationRegistry {
  return {};
}

describe("registerMigration / migrateRecord", () => {
  it("leaves an already-current record untouched", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      fromVersion: "1.0",
      toVersion: "1.1",
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1", colour: r.color, color: undefined }),
    });
    const current: Widget = { schemaVersion: "1.1", code: "w1", colour: "red" };
    const { record, applied } = migrateRecord(registry, "widgets", current);
    expect(record).toEqual(current);
    expect(applied).toEqual([]);
  });

  it("is a no-op for a collection with nothing registered", () => {
    const registry = freshRegistry();
    const record = { schemaVersion: "9.9", code: "x" };
    const result = migrateRecord(registry, "unregistered_collection", record);
    expect(result.record).toEqual(record);
    expect(result.applied).toEqual([]);
  });

  it("applies a single registered step", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      fromVersion: "1.0",
      toVersion: "1.1",
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1", colour: r.color }),
    });
    const old: Widget = { schemaVersion: "1.0", code: "w1", color: "blue" };
    const { record, applied } = migrateRecord(registry, "widgets", old);
    expect(record.schemaVersion).toBe("1.1");
    expect(record.colour).toBe("blue");
    expect(applied).toEqual(["1.0 -> 1.1"]);
  });

  it("walks a chain of steps in order", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      fromVersion: "1.0",
      toVersion: "1.1",
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1" }),
    });
    registerMigration(registry, "widgets", {
      fromVersion: "1.1",
      toVersion: "1.2",
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.2", colour: "upgraded" }),
    });
    const old: Widget = { schemaVersion: "1.0", code: "w1" };
    const { record, applied } = migrateRecord(registry, "widgets", old);
    expect(record.schemaVersion).toBe("1.2");
    expect(record.colour).toBe("upgraded");
    expect(applied).toEqual(["1.0 -> 1.1", "1.1 -> 1.2"]);
  });

  it("stops at whichever version has no further registered step", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      fromVersion: "1.0",
      toVersion: "1.1",
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1" }),
    });
    // No 1.1 -> 1.2 step registered.
    const old: Widget = { schemaVersion: "1.0", code: "w1" };
    const { record, applied } = migrateRecord(registry, "widgets", old);
    expect(record.schemaVersion).toBe("1.1");
    expect(applied).toEqual(["1.0 -> 1.1"]);
  });

  it("throws on a duplicate fromVersion for the same collection", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      fromVersion: "1.0",
      toVersion: "1.1",
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1" }),
    });
    expect(() =>
      registerMigration(registry, "widgets", {
        fromVersion: "1.0",
        toVersion: "1.1-alt",
        migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1-alt" }),
      }),
    ).toThrow(/duplicate migration/);
  });

  it("throws rather than looping forever on a migration that does not advance the version", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      fromVersion: "1.0",
      toVersion: "1.0",
      migrate: (r: Widget) => ({ ...r }),
    });
    const old: Widget = { schemaVersion: "1.0", code: "w1" };
    expect(() => migrateRecord(registry, "widgets", old)).toThrow(/did not advance schemaVersion/);
  });

  it("registering the same collection under a different name does not affect it", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      fromVersion: "1.0",
      toVersion: "1.1",
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1" }),
    });
    const record = { schemaVersion: "1.0", code: "g1" };
    const result = migrateRecord(registry, "gadgets", record);
    expect(result.applied).toEqual([]);
    expect(result.record).toEqual(record);
  });
});

describe("migrateCollection", () => {
  it("migrates every row and reports whether anything changed", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      fromVersion: "1.0",
      toVersion: "1.1",
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1" }),
    });
    const rows: Widget[] = [
      { schemaVersion: "1.0", code: "w1" },
      { schemaVersion: "1.1", code: "w2" },
    ];
    const { rows: migrated, anyMigrated } = migrateCollection(registry, "widgets", rows);
    expect(anyMigrated).toBe(true);
    expect(migrated[0].schemaVersion).toBe("1.1");
    expect(migrated[1].schemaVersion).toBe("1.1");
  });

  it("reports anyMigrated: false when every row was already current", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      fromVersion: "1.0",
      toVersion: "1.1",
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1" }),
    });
    const rows: Widget[] = [{ schemaVersion: "1.1", code: "w1" }];
    const { anyMigrated } = migrateCollection(registry, "widgets", rows);
    expect(anyMigrated).toBe(false);
  });
});
