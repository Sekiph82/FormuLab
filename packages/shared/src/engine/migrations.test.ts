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
      id: "widgets-1.0-to-1.1",
      fromVersion: "1.0",
      toVersion: "1.1",
      description: "Rename color to colour.",
      reversible: true,
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
      id: "widgets-1.0-to-1.1",
      fromVersion: "1.0",
      toVersion: "1.1",
      description: "Rename color to colour.",
      reversible: true,
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1", colour: r.color }),
    });
    const old: Widget = { schemaVersion: "1.0", code: "w1", color: "blue" };
    const { record, applied } = migrateRecord(registry, "widgets", old);
    expect(record.schemaVersion).toBe("1.1");
    expect(record.colour).toBe("blue");
    expect(applied).toEqual(["widgets-1.0-to-1.1: 1.0 -> 1.1"]);
  });

  it("walks a chain of steps in order", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      id: "widgets-1.0-to-1.1",
      fromVersion: "1.0",
      toVersion: "1.1",
      description: "Bump to 1.1.",
      reversible: true,
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1" }),
    });
    registerMigration(registry, "widgets", {
      id: "widgets-1.1-to-1.2",
      fromVersion: "1.1",
      toVersion: "1.2",
      description: "Bump to 1.2 and mark upgraded.",
      reversible: false,
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.2", colour: "upgraded" }),
    });
    const old: Widget = { schemaVersion: "1.0", code: "w1" };
    const { record, applied } = migrateRecord(registry, "widgets", old);
    expect(record.schemaVersion).toBe("1.2");
    expect(record.colour).toBe("upgraded");
    expect(applied).toEqual(["widgets-1.0-to-1.1: 1.0 -> 1.1", "widgets-1.1-to-1.2: 1.1 -> 1.2"]);
  });

  it("stops at whichever version has no further registered step", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      id: "widgets-1.0-to-1.1",
      fromVersion: "1.0",
      toVersion: "1.1",
      description: "Bump to 1.1.",
      reversible: true,
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1" }),
    });
    // No 1.1 -> 1.2 step registered.
    const old: Widget = { schemaVersion: "1.0", code: "w1" };
    const { record, applied } = migrateRecord(registry, "widgets", old);
    expect(record.schemaVersion).toBe("1.1");
    expect(applied).toEqual(["widgets-1.0-to-1.1: 1.0 -> 1.1"]);
  });

  it("throws on a duplicate fromVersion for the same collection", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      id: "widgets-1.0-to-1.1",
      fromVersion: "1.0",
      toVersion: "1.1",
      description: "Bump to 1.1.",
      reversible: true,
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1" }),
    });
    expect(() =>
      registerMigration(registry, "widgets", {
        id: "widgets-1.0-to-1.1-alt",
        fromVersion: "1.0",
        toVersion: "1.1-alt",
        description: "A second, conflicting step from the same version.",
        reversible: true,
        migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1-alt" }),
      }),
    ).toThrow(/duplicate migration/);
  });

  it("throws rather than looping forever on a migration that does not advance the version", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      id: "widgets-noop",
      fromVersion: "1.0",
      toVersion: "1.0",
      description: "Deliberately broken: claims to migrate but does not.",
      reversible: true,
      migrate: (r: Widget) => ({ ...r }),
    });
    const old: Widget = { schemaVersion: "1.0", code: "w1" };
    expect(() => migrateRecord(registry, "widgets", old)).toThrow(
      /migration "widgets-noop" for "widgets" from "1.0" did not advance schemaVersion/,
    );
  });

  it("runs the optional validate hook and passes through when it returns true", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      id: "widgets-1.0-to-1.1",
      fromVersion: "1.0",
      toVersion: "1.1",
      description: "Bump to 1.1.",
      reversible: true,
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1", colour: r.color }),
      validate: (r: Widget) => r.colour !== undefined,
    });
    const old: Widget = { schemaVersion: "1.0", code: "w1", color: "blue" };
    const { record } = migrateRecord(registry, "widgets", old);
    expect(record.schemaVersion).toBe("1.1");
  });

  it("throws when the validate hook returns false, naming the failing step", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      id: "widgets-broken-validate",
      fromVersion: "1.0",
      toVersion: "1.1",
      description: "Bump to 1.1 (validation deliberately always fails in this test).",
      reversible: true,
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1" }),
      validate: () => false,
    });
    const old: Widget = { schemaVersion: "1.0", code: "w1" };
    expect(() => migrateRecord(registry, "widgets", old)).toThrow(
      /migration "widgets-broken-validate" for "widgets" failed its own post-migration validation/,
    );
  });

  it("registering the same collection under a different name does not affect it", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      id: "widgets-1.0-to-1.1",
      fromVersion: "1.0",
      toVersion: "1.1",
      description: "Bump to 1.1.",
      reversible: true,
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
      id: "widgets-1.0-to-1.1",
      fromVersion: "1.0",
      toVersion: "1.1",
      description: "Bump to 1.1.",
      reversible: true,
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
      id: "widgets-1.0-to-1.1",
      fromVersion: "1.0",
      toVersion: "1.1",
      description: "Bump to 1.1.",
      reversible: true,
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1" }),
    });
    const rows: Widget[] = [{ schemaVersion: "1.1", code: "w1" }];
    const { anyMigrated } = migrateCollection(registry, "widgets", rows);
    expect(anyMigrated).toBe(false);
  });

  it("never persists anything itself — a dry run is just not writing back the result", () => {
    const registry = freshRegistry();
    registerMigration(registry, "widgets", {
      id: "widgets-1.0-to-1.1",
      fromVersion: "1.0",
      toVersion: "1.1",
      description: "Bump to 1.1.",
      reversible: true,
      migrate: (r: Widget) => ({ ...r, schemaVersion: "1.1" }),
    });
    const original: Widget[] = [{ schemaVersion: "1.0", code: "w1" }];
    const snapshot = JSON.parse(JSON.stringify(original));
    migrateCollection(registry, "widgets", original);
    expect(original).toEqual(snapshot);
  });
});
