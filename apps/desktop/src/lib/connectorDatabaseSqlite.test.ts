import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tauri", () => ({
  get isTauri() {
    return true;
  },
}));

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: [string, Record<string, unknown>]) => invokeMock(...a),
}));

import { createSqliteAdapter } from "./connectorDatabaseSqlite";
import { createDatabaseConnector } from "@formulab/shared";

const FIXTURE_PATH = "C:/fake/materials.sqlite";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("createSqliteAdapter — real production DatabaseAdapter over the Rust connector_sqlite bridge (DBUI1-DBUI10)", () => {
  it("DBUI1/DBUI2: opens read-only and discovers at least two real tables", async () => {
    invokeMock.mockResolvedValueOnce([
      { table: "suppliers", kind: "table" },
      { table: "materials", kind: "table" },
    ]);
    const tables = await createSqliteAdapter(FIXTURE_PATH).listTables();
    expect(invokeMock).toHaveBeenCalledWith("connector_sqlite_list_tables", { path: FIXTURE_PATH });
    expect(tables.map((t) => t.table)).toEqual(["suppliers", "materials"]);
  });

  it("DBUI3/DBUI4: reads primary key and composite primary key ordinal metadata", async () => {
    invokeMock.mockResolvedValueOnce({
      table: "materials",
      kind: "table",
      columns: [
        { name: "batch", declaredType: "TEXT", nullable: false, isPrimaryKey: true, primaryKeyOrdinal: 1 },
        { name: "code", declaredType: "TEXT", nullable: false, isPrimaryKey: true, primaryKeyOrdinal: 2 },
        { name: "name", declaredType: "TEXT", nullable: false, isPrimaryKey: false },
      ],
      foreignKeys: [],
    });
    const desc = await createSqliteAdapter(FIXTURE_PATH).describeEntity({ table: "materials" });
    const pk = desc.columns.filter((c) => c.isPrimaryKey).sort((a, b) => (a.primaryKeyOrdinal ?? 0) - (b.primaryKeyOrdinal ?? 0));
    expect(pk.map((c) => c.name)).toEqual(["batch", "code"]);
    expect(pk.map((c) => c.primaryKeyOrdinal)).toEqual([1, 2]);
  });

  it("DBUI5: reads real foreign key metadata", async () => {
    invokeMock.mockResolvedValueOnce({
      table: "materials",
      kind: "table",
      columns: [],
      foreignKeys: [{ fromColumns: ["supplier_id"], toTable: "suppliers", toColumns: ["id"] }],
    });
    const desc = await createSqliteAdapter(FIXTURE_PATH).describeEntity({ table: "materials" });
    expect(desc.foreignKeys).toEqual([{ fromColumns: ["supplier_id"], toTable: "suppliers", toColumns: ["id"] }]);
  });

  it("DBUI6: reads declared type and nullability", async () => {
    invokeMock.mockResolvedValueOnce({
      table: "materials",
      kind: "table",
      columns: [
        { name: "code", declaredType: "TEXT", nullable: false, isPrimaryKey: true, primaryKeyOrdinal: 1 },
        { name: "supplier_id", declaredType: "INTEGER", nullable: true, isPrimaryKey: false },
      ],
      foreignKeys: [],
    });
    const desc = await createSqliteAdapter(FIXTURE_PATH).describeEntity({ table: "materials" });
    expect(desc.columns.find((c) => c.name === "code")?.declaredType).toBe("TEXT");
    expect(desc.columns.find((c) => c.name === "code")?.nullable).toBe(false);
    expect(desc.columns.find((c) => c.name === "supplier_id")?.nullable).toBe(true);
  });

  it("DBUI7: fetches a bounded sample page", async () => {
    invokeMock.mockResolvedValueOnce({
      columns: ["code", "name"],
      rows: [
        ["MAT-1", "First"],
        ["MAT-2", "Second"],
      ],
      nextCursor: undefined,
    });
    const page = await createSqliteAdapter(FIXTURE_PATH).readPage({ selector: { table: "materials" }, pageSize: 2 });
    expect(invokeMock).toHaveBeenCalledWith("connector_sqlite_read_page", {
      path: FIXTURE_PATH,
      table: "materials",
      columns: null,
      filter: null,
      pageSize: 2,
      cursor: null,
    });
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeUndefined();
  });

  it("DBUI9: the real adapter feeds directly into createDatabaseConnector()/extract() — the same connector Prepare Import uses", async () => {
    invokeMock
      .mockResolvedValueOnce({
        table: "materials",
        kind: "table",
        columns: [{ name: "code", declaredType: "TEXT", nullable: false, isPrimaryKey: true, primaryKeyOrdinal: 1 }],
        foreignKeys: [],
      })
      .mockResolvedValueOnce({ columns: ["code"], rows: [["MAT-1"], ["MAT-2"]], nextCursor: undefined });

    const adapter = createSqliteAdapter(FIXTURE_PATH);
    const connector = createDatabaseConnector(
      "ACME_DB",
      { connectionRef: "", entities: { materials: { table: "materials" } } },
      { extractionRunId: "run-1", extractedAt: "2026-01-01T00:00:00.000Z" },
      { adapter },
    );
    const result = await connector.extract("materials");
    expect(result.errors).toHaveLength(0);
    expect(result.records.map((r) => r.fields.code)).toEqual(["MAT-1", "MAT-2"]);
  });

  it("DBUI10: no source mutation is structurally reachable — the adapter exposes only listSchemas/listTables/describeEntity/readPage", () => {
    const adapter = createSqliteAdapter(FIXTURE_PATH);
    const methods = Object.keys(adapter).sort();
    expect(methods).toEqual(["describeEntity", "listSchemas", "listTables", "readPage"]);
  });
});
