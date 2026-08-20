/**
 * FVL-04.021 hardening (Part C3/C8) — DB1-DB18 executable acceptance
 * against a REAL disposable database (sql.js/WASM SQLite, in-memory,
 * never a real customer database). Proves the `DatabaseAdapter`
 * contract is genuinely implementable end-to-end, not merely a mocked
 * interface — see `databaseConnector.test.ts` for the mock-based unit
 * coverage of the engine logic itself.
 */
import { describe, expect, it } from "vitest";
import { createSqliteTestAdapter } from "./sqliteTestAdapter";
import { createDatabaseConnector, stageDatabaseEntity } from "./databaseConnector";
import { discoverSourceSchema } from "./schemaDiscovery";
import { applyMappingProfile, validateMappingProfile } from "./mappingProfile";
import type { MappingProfile } from "../schemas/connector";

const opts = { extractionRunId: "run-1", extractedAt: "2026-01-01T00:00:00.000Z" };

const SETUP_SQL = `
  CREATE TABLE erp_materials (
    material_id TEXT PRIMARY KEY,
    material_name TEXT NOT NULL,
    unit_price REAL,
    active INTEGER
  );
  INSERT INTO erp_materials VALUES ('M-1', 'Decyl Glucoside', 3.20, 1);
  INSERT INTO erp_materials VALUES ('M-2', 'Cocamidopropyl Betaine', 4.10, 1);

  CREATE TABLE erp_material_supplier (
    material_id TEXT NOT NULL,
    supplier_id TEXT NOT NULL,
    supplier_price REAL,
    PRIMARY KEY (material_id, supplier_id),
    FOREIGN KEY (material_id) REFERENCES erp_materials(material_id)
  );
  INSERT INTO erp_material_supplier VALUES ('M-1', 'S-1', 3.00);
  INSERT INTO erp_material_supplier VALUES ('M-1', 'S-2', 3.15);

  CREATE TABLE erp_log_events (
    message TEXT
  );
  INSERT INTO erp_log_events VALUES ('event 1');
  INSERT INTO erp_log_events VALUES ('event 2');
`;

describe("DB1: listTables — real schema introspection, never a hardcoded/guessed list", async () => {
  const { adapter } = await createSqliteTestAdapter(SETUP_SQL);
  it("reports every real table genuinely created in the disposable database", async () => {
    const tables = await adapter.listTables();
    expect(tables.map((t) => t.table).sort()).toEqual(["erp_log_events", "erp_material_supplier", "erp_materials"]);
    expect(tables.every((t) => t.kind === "table")).toBe(true);
  });
});

describe("DB2/DB3/DB4/DB5: describeEntity — real declared types, nullability, PK, composite PK, FK", async () => {
  const { adapter } = await createSqliteTestAdapter(SETUP_SQL);

  it("DB2/DB3: columns and their real declared SQLite types/nullability", async () => {
    const desc = await adapter.describeEntity({ table: "erp_materials" });
    expect(desc.columns.find((c) => c.name === "material_name")).toMatchObject({ declaredType: "TEXT", nullable: false });
    expect(desc.columns.find((c) => c.name === "unit_price")).toMatchObject({ declaredType: "REAL", nullable: true });
  });

  it("DB4: single-column primary key reported", async () => {
    const desc = await adapter.describeEntity({ table: "erp_materials" });
    const pk = desc.columns.filter((c) => c.isPrimaryKey);
    expect(pk.map((c) => c.name)).toEqual(["material_id"]);
  });

  it("DB4: composite primary key reported with real ordinal position", async () => {
    const desc = await adapter.describeEntity({ table: "erp_material_supplier" });
    const pk = desc.columns.filter((c) => c.isPrimaryKey).sort((a, b) => (a.primaryKeyOrdinal ?? 0) - (b.primaryKeyOrdinal ?? 0));
    expect(pk.map((c) => c.name)).toEqual(["material_id", "supplier_id"]);
    expect(pk.map((c) => c.primaryKeyOrdinal)).toEqual([1, 2]);
  });

  it("DB5: real foreign key metadata reported", async () => {
    const desc = await adapter.describeEntity({ table: "erp_material_supplier" });
    expect(desc.foreignKeys).toEqual([{ fromColumns: ["material_id"], toTable: "erp_materials", toColumns: ["material_id"] }]);
  });

  it("a table with genuinely no primary key reports zero PK columns, never fabricated", async () => {
    const desc = await adapter.describeEntity({ table: "erp_log_events" });
    expect(desc.columns.every((c) => !c.isPrimaryKey)).toBe(true);
  });
});

describe("DB6/DB7: readPage — real rows, real paging boundary, never ambiguous on an exact page-size multiple", async () => {
  const { adapter } = await createSqliteTestAdapter(SETUP_SQL);

  it("DB6: reads real rows", async () => {
    const page = await adapter.readPage({ selector: { table: "erp_materials" }, pageSize: 10 });
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeUndefined();
  });

  it("DB7: a source with EXACTLY pageSize rows correctly reports no next page — the classic off-by-one ambiguity a naive 'got a full page' heuristic would get wrong", async () => {
    const page = await adapter.readPage({ selector: { table: "erp_materials" }, pageSize: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeUndefined();
  });

  it("DB7: a source with MORE rows than pageSize correctly reports a next cursor, and the second page is genuinely different rows", async () => {
    const page1 = await adapter.readPage({ selector: { table: "erp_materials" }, pageSize: 1 });
    expect(page1.rows).toHaveLength(1);
    expect(page1.nextCursor).toBeDefined();
    const page2 = await adapter.readPage({ selector: { table: "erp_materials" }, pageSize: 1, cursor: page1.nextCursor });
    expect(page2.rows).toHaveLength(1);
    expect(page2.rows[0]).not.toEqual(page1.rows[0]);
    expect(page2.nextCursor).toBeUndefined();
  });

  it("a structured filter genuinely filters — proven against real data, never a fake array", async () => {
    const page = await adapter.readPage({ selector: { table: "erp_materials", filter: { column: "material_id", op: "eq", value: "M-2" } }, pageSize: 10 });
    expect(page.rows).toEqual([["M-2", "Cocamidopropyl Betaine", "4.1", "1"]]);
  });
});

describe("DB8/DB9: stageDatabaseEntity through the REAL adapter — composite-PK identity, no-PK ordinal fallback", async () => {
  const { adapter } = await createSqliteTestAdapter(SETUP_SQL);

  it("DB8: a composite PK produces a deterministic configured identity from real database rows", async () => {
    const result = await stageDatabaseEntity("ERP", { connectionRef: "conn-1", entities: { rel: { table: "erp_material_supplier" } } }, "rel", opts, { adapter });
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records.every((r) => r.identity.idSource === "configured")).toBe(true);
    expect(new Set(result.records.map((r) => r.identity.sourceRecordId)).size).toBe(2);
  });

  it("DB9: a table with no PK falls back to ordinal identity against real database rows", async () => {
    const result = await stageDatabaseEntity("ERP", { connectionRef: "conn-1", entities: { logs: { table: "erp_log_events" } } }, "logs", opts, { adapter });
    expect(result.records.every((r) => r.identity.idSource === "ordinal")).toBe(true);
  });
});

describe("DB12: no SQL injection route through a structured filter value — a value containing SQL text is bound as a literal, never concatenated/executed", async () => {
  const { adapter } = await createSqliteTestAdapter(SETUP_SQL);

  it("a filter value containing a real SQL injection payload matches nothing (bound as a literal string) and never drops the table", async () => {
    const page = await adapter.readPage({ selector: { table: "erp_materials", filter: { column: "material_id", op: "eq", value: "M-1'; DROP TABLE erp_materials; --" } }, pageSize: 10 });
    expect(page.rows).toEqual([]);
    // The table must still exist and still contain its real rows.
    const stillThere = await adapter.readPage({ selector: { table: "erp_materials" }, pageSize: 10 });
    expect(stillThere.rows).toHaveLength(2);
  });
});

describe("DB13: driver errors are caught and sanitized by stageDatabaseEntity, never a leaked raw exception, against a REAL adapter failure", async () => {
  const { adapter } = await createSqliteTestAdapter(SETUP_SQL);

  it("reading a table that does not exist fails structured — real SQLite PRAGMA table_info() reports zero columns rather than erroring, so the failure genuinely surfaces at the readPage stage instead, still caught and sanitized", async () => {
    const result = await stageDatabaseEntity("ERP", { connectionRef: "conn-1", entities: { ghost: { table: "erp_does_not_exist" } } }, "ghost", opts, { adapter });
    expect(result.errors[0].code).toBe("read_failed");
    expect(result.errors[0].retryable).toBe(true);
    expect(result.records).toEqual([]);
  });
});

describe("DB15/DB16/DB17: SourceConnector, Schema Discovery, Mapping Profile — the REAL downstream chain, fed by the real sql.js adapter", async () => {
  const { adapter } = await createSqliteTestAdapter(SETUP_SQL);

  it("a real DATABASE SourceConnector stages, discovers a schema, and maps through a real MappingProfile", async () => {
    const connector = createDatabaseConnector("ERP", { connectionRef: "conn-1", entities: { materials: { table: "erp_materials" } } }, opts, { adapter });
    expect(await connector.discoverEntities()).toEqual(["materials"]);
    const staged = await connector.extract("materials");
    expect(staged.connector.connectorType).toBe("DATABASE");
    expect(staged.records).toHaveLength(2);

    const schema = discoverSourceSchema("ERP", [{ entity: "materials", records: staged.records }]);
    expect(schema.entities[0].fields.map((f) => f.path).sort()).toEqual(["active", "material_id", "material_name", "unit_price"]);

    const profile: MappingProfile = {
      schemaVersion: "1.0",
      code: "erp-materials::v1",
      profileId: "erp-materials",
      profileName: "ERP materials",
      sourceSystemId: "ERP",
      sourceEntity: "materials",
      sourceSchemaFingerprint: schema.fingerprint,
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "material_id", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "material_name", targetTemplate: "raw_materials", targetField: "material_name" },
      ],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    };
    expect(validateMappingProfile(profile, schema)).toEqual([]);
    const mapped = applyMappingProfile(profile, staged.records[0]);
    const candidate = mapped.candidates.find((c) => c.targetTemplate === "raw_materials")!;
    expect(candidate.row).toMatchObject({ material_code: "M-1", material_name: "Decyl Glucoside" });
  });
});

describe("DB18: no vendor-specific production branch anywhere in the DB connector engine or this test adapter", async () => {
  it("no source-text conditional on a specific database vendor exists", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(process.cwd(), "src", "engine");
    for (const file of ["databaseConnector.ts", "sqliteTestAdapter.ts"]) {
      const src = fs.readFileSync(path.join(root, file), "utf-8");
      expect(src).not.toMatch(/vendor\s*===\s*["']|dialect\s*===\s*["']|(postgres|mysql|oracle|mssql|sqlserver)\s*===/i);
    }
  });
});
