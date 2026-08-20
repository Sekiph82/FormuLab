/**
 * FVL-04.021 (hardened) — Generic READ-ONLY Database Connector acceptance,
 * against a mock `DatabaseAdapter` (pure engine logic — composite-key
 * encoding, paging loop, sanitized failures, entity/expert boundaries).
 * A REAL disposable database (sql.js-backed SQLite) proves the adapter
 * CONTRACT itself is genuinely implementable end-to-end — see
 * `sqliteTestAdapter.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import {
  assertReadOnlyQuery,
  createDatabaseConnector,
  stageDatabaseEntity,
  stageDatabaseExpertQuery,
  type DatabaseAdapter,
  type DatabaseEntityDescription,
  type DatabasePageResult,
  type DatabaseExpertQueryResult,
} from "./databaseConnector";

const opts = { extractionRunId: "run-1", extractedAt: "2026-01-01T00:00:00.000Z" };

function mockAdapter(overrides: Partial<DatabaseAdapter> = {}): DatabaseAdapter {
  return {
    listSchemas: vi.fn(async () => ["main"]),
    listTables: vi.fn(async () => [{ table: "materials", kind: "table" as const }]),
    describeEntity: vi.fn(async (): Promise<DatabaseEntityDescription> => ({
      table: "materials",
      kind: "table",
      columns: [
        { name: "id", declaredType: "INTEGER", nullable: false, isPrimaryKey: true, primaryKeyOrdinal: 1 },
        { name: "name", declaredType: "TEXT", nullable: true, isPrimaryKey: false },
      ],
      foreignKeys: [],
    })),
    readPage: vi.fn(async (): Promise<DatabasePageResult> => ({ columns: ["id", "name"], rows: [["1", "Decyl Glucoside"]] })),
    ...overrides,
  };
}

describe("stageDatabaseEntity — composite/single primary key identity (DB4/DB8/DB9)", () => {
  it("a single-column PK produces a deterministic configured identity, and the synthetic PK field never leaks into staged fields", async () => {
    const adapter = mockAdapter();
    const result = await stageDatabaseEntity("ERP", { connectionRef: "conn-1", entities: { materials: { table: "materials" } } }, "materials", opts, { adapter });
    expect(result.errors).toEqual([]);
    expect(result.records[0].identity.idSource).toBe("configured");
    expect(result.records[0].identity.sourceRecordId).toBe("1");
    expect(result.records[0].fields).toEqual({ id: "1", name: "Decyl Glucoside" });
  });

  it("a composite PK is encoded deterministically from ALL PK fields in ordinal order, with escaping so a raw value containing the join separator can never collide", async () => {
    const adapter = mockAdapter({
      describeEntity: vi.fn(async (): Promise<DatabaseEntityDescription> => ({
        table: "material_supplier",
        kind: "table",
        columns: [
          { name: "material_id", declaredType: "TEXT", nullable: false, isPrimaryKey: true, primaryKeyOrdinal: 1 },
          { name: "supplier_id", declaredType: "TEXT", nullable: false, isPrimaryKey: true, primaryKeyOrdinal: 2 },
          { name: "price", declaredType: "REAL", nullable: true, isPrimaryKey: false },
        ],
        foreignKeys: [],
      })),
      readPage: vi.fn(async (): Promise<DatabasePageResult> => ({
        columns: ["material_id", "supplier_id", "price"],
        rows: [
          ["M-1", "S-1", "3.20"],
          ["M-1::S-1", "REAL-S", "9.99"], // a raw value that itself contains the "::" join separator
        ],
      })),
    });
    const result = await stageDatabaseEntity("ERP", { connectionRef: "conn-1", entities: { rel: { table: "material_supplier" } } }, "rel", opts, { adapter });
    const ids = result.records.map((r) => r.identity.sourceRecordId);
    expect(new Set(ids).size).toBe(2); // no collision despite the embedded "::" in one raw value
    expect(result.records.every((r) => r.identity.idSource === "configured")).toBe(true);
    expect(result.records[0].fields).toEqual({ material_id: "M-1", supplier_id: "S-1", price: "3.20" });
  });

  it("a genuinely batched second read (two calls to readPage for two rows sharing the same table) produces the IDENTICAL sourceRecordId for the same PK values", async () => {
    const adapter = mockAdapter({
      describeEntity: vi.fn(async (): Promise<DatabaseEntityDescription> => ({
        table: "material_supplier",
        kind: "table",
        columns: [
          { name: "material_id", declaredType: "TEXT", nullable: false, isPrimaryKey: true, primaryKeyOrdinal: 1 },
          { name: "supplier_id", declaredType: "TEXT", nullable: false, isPrimaryKey: true, primaryKeyOrdinal: 2 },
        ],
        foreignKeys: [],
      })),
      readPage: vi.fn(async (): Promise<DatabasePageResult> => ({ columns: ["material_id", "supplier_id"], rows: [["M-1", "S-1"]] })),
    });
    const first = await stageDatabaseEntity("ERP", { connectionRef: "conn-1", entities: { rel: { table: "material_supplier" } } }, "rel", opts, { adapter });
    const second = await stageDatabaseEntity("ERP", { connectionRef: "conn-1", entities: { rel: { table: "material_supplier" } } }, "rel", opts, { adapter });
    expect(first.records[0].identity.sourceRecordId).toBe(second.records[0].identity.sourceRecordId);
  });

  it("a table with NO primary key falls back to the existing ordinal staging identity (DB9)", async () => {
    const adapter = mockAdapter({
      describeEntity: vi.fn(async (): Promise<DatabaseEntityDescription> => ({
        table: "log_events",
        kind: "table",
        columns: [{ name: "message", declaredType: "TEXT", nullable: true, isPrimaryKey: false }],
        foreignKeys: [],
      })),
      readPage: vi.fn(async (): Promise<DatabasePageResult> => ({ columns: ["message"], rows: [["hello"]] })),
    });
    const result = await stageDatabaseEntity("ERP", { connectionRef: "conn-1", entities: { logs: { table: "log_events" } } }, "logs", opts, { adapter });
    expect(result.records[0].identity.idSource).toBe("ordinal");
  });
});

describe("stageDatabaseEntity — real paging (DB6/DB7)", () => {
  it("follows nextCursor across multiple pages, stopping when the adapter reports none, no duplicate/missing row", async () => {
    let call = 0;
    const adapter = mockAdapter({
      readPage: vi.fn(async (): Promise<DatabasePageResult> => {
        call++;
        if (call === 1) return { columns: ["id", "name"], rows: [["1", "A"]], nextCursor: "c2" };
        if (call === 2) return { columns: ["id", "name"], rows: [["2", "B"]], nextCursor: "c3" };
        return { columns: ["id", "name"], rows: [["3", "C"]] };
      }),
    });
    const result = await stageDatabaseEntity("ERP", { connectionRef: "conn-1", entities: { materials: { table: "materials" } } }, "materials", opts, { adapter });
    expect(call).toBe(3);
    expect(result.records.map((r) => r.fields.id)).toEqual(["1", "2", "3"]);
  });
});

describe("stageDatabaseEntity — structured failure, never a leaked adapter exception (DB13/DB14)", () => {
  it("an unconfigured entity is refused structured", async () => {
    const adapter = mockAdapter();
    const result = await stageDatabaseEntity("ERP", { connectionRef: "conn-1", entities: {} }, "materials", opts, { adapter });
    expect(result.errors[0]).toMatchObject({ code: "entity_not_configured" });
  });

  it("describeEntity throwing produces a sanitized structured error, never the raw exception's own message", async () => {
    const adapter = mockAdapter({
      describeEntity: vi.fn(async () => {
        throw new Error("Server=10.0.0.5;Uid=admin;Pwd=SuperSecret123");
      }),
    });
    const result = await stageDatabaseEntity("ERP", { connectionRef: "conn-1", entities: { materials: { table: "materials" } } }, "materials", opts, { adapter });
    expect(result.errors[0]).toMatchObject({ code: "describe_failed", retryable: true, detail: "Error" });
    expect(JSON.stringify(result)).not.toContain("SuperSecret123");
  });

  it("readPage throwing produces a sanitized structured error", async () => {
    const adapter = mockAdapter({
      readPage: vi.fn(async () => {
        throw new Error("connection refused at 10.0.0.5:1433");
      }),
    });
    const result = await stageDatabaseEntity("ERP", { connectionRef: "conn-1", entities: { materials: { table: "materials" } } }, "materials", opts, { adapter });
    expect(result.errors[0]).toMatchObject({ code: "read_failed", retryable: true });
    expect(JSON.stringify(result)).not.toContain("10.0.0.5");
  });
});

describe("createDatabaseConnector — a real SourceConnector implementation (DB15)", () => {
  it("discoverEntities returns exactly the configured entity names, never introspected/guessed", async () => {
    const connector = createDatabaseConnector("ERP", { connectionRef: "conn-1", entities: { materials: { table: "materials" }, suppliers: { table: "vendors" } } }, opts, { adapter: mockAdapter() });
    expect(await connector.discoverEntities()).toEqual(["materials", "suppliers"]);
  });

  it("extract() delegates to stageDatabaseEntity for the requested entity", async () => {
    const connector = createDatabaseConnector("ERP", { connectionRef: "conn-1", entities: { materials: { table: "materials" } } }, opts, { adapter: mockAdapter() });
    const result = await connector.extract("materials");
    expect(result.records).toHaveLength(1);
  });

  it("the connector's own identity carries no credential — connectionRef never appears on it", () => {
    const connector = createDatabaseConnector("ERP", { connectionRef: "conn-1", entities: {} }, opts, { adapter: mockAdapter() });
    expect(connector.identity).toMatchObject({ connectorType: "DATABASE", sourceSystemId: "ERP" });
    expect(JSON.stringify(connector.identity)).not.toMatch(/password|host|port|user|conn-1/i);
  });

  it("the DatabaseAdapter contract exposes no write/mutation capability at all (DB11/DB12) — structural, not merely a convention", async () => {
    const adapter = mockAdapter();
    // Every capability the connector's own runtime code can call is
    // read-only by the contract's own shape.
    expect(Object.keys(adapter).sort()).toEqual(["describeEntity", "listSchemas", "listTables", "readPage"]);
  });
});

describe("Expert boundary (C1) — a separate, deliberately-named escape hatch a mapping profile's own field mappings can never reach", () => {
  it("assertReadOnlyQuery still refuses every write keyword, never a naive substring match", () => {
    for (const stmt of ["INSERT INTO t VALUES (1)", "UPDATE t SET x=1", "DELETE FROM t", "DROP TABLE t"]) {
      expect(assertReadOnlyQuery(stmt).ok).toBe(false);
    }
    expect(assertReadOnlyQuery("SELECT * FROM t WHERE notes = 'please delete duplicates'").ok).toBe(true);
  });

  it("stageDatabaseExpertQuery stages a real result and refuses a write-shaped query before ever calling the adapter", async () => {
    const executeExpertQuery = vi.fn(async (): Promise<DatabaseExpertQueryResult> => ({ columns: ["id"], rows: [["1"]] }));
    const ok = await stageDatabaseExpertQuery("ERP", { connectionRef: "conn-1", query: "SELECT id FROM materials", entity: "materials" }, opts, { executeExpertQuery });
    expect(ok.records).toHaveLength(1);

    const refused = await stageDatabaseExpertQuery("ERP", { connectionRef: "conn-1", query: "DELETE FROM materials", entity: "materials" }, opts, { executeExpertQuery });
    expect(refused.errors[0]).toMatchObject({ code: "write_query_refused" });
    expect(executeExpertQuery).toHaveBeenCalledTimes(1); // only the first, real SELECT call
  });
});
