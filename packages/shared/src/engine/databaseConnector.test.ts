/**
 * FVL-04.021 — Generic READ-ONLY Database Connector acceptance.
 */
import { describe, expect, it, vi } from "vitest";
import { assertReadOnlyQuery, createDatabaseConnector, stageDatabaseQuery, type DatabaseQueryResult } from "./databaseConnector";

const opts = { extractionRunId: "run-1", extractedAt: "2026-01-01T00:00:00.000Z" };

describe("assertReadOnlyQuery — structural write refusal, never a naive substring match", () => {
  it("a genuine SELECT passes", () => {
    expect(assertReadOnlyQuery("SELECT id, name FROM materials")).toEqual({ ok: true });
  });

  it("INSERT/UPDATE/DELETE/MERGE/DROP/ALTER/CREATE/TRUNCATE/EXEC/CALL/GRANT/REVOKE are all refused", () => {
    for (const stmt of [
      "INSERT INTO materials (id) VALUES (1)",
      "UPDATE materials SET name = 'x'",
      "DELETE FROM materials",
      "MERGE INTO materials USING src ON materials.id = src.id",
      "DROP TABLE materials",
      "ALTER TABLE materials ADD COLUMN x INT",
      "CREATE TABLE x (id INT)",
      "TRUNCATE TABLE materials",
      "EXEC sp_do_something",
      "EXECUTE sp_do_something",
      "CALL some_procedure()",
      "GRANT SELECT ON materials TO someone",
      "REVOKE SELECT ON materials FROM someone",
    ]) {
      const result = assertReadOnlyQuery(stmt);
      expect(result.ok, `expected "${stmt}" to be refused`).toBe(false);
    }
  });

  it("a SELECT whose WHERE clause literally contains a write keyword as a string is NOT refused — never a naive substring search", () => {
    expect(assertReadOnlyQuery("SELECT id FROM audit_log WHERE description LIKE '%update%'")).toEqual({ ok: true });
    expect(assertReadOnlyQuery("SELECT id FROM materials WHERE notes = 'please delete duplicates'")).toEqual({ ok: true });
  });

  it("a write keyword hidden inside a comment cannot smuggle a write statement past the check — the leading keyword after stripping comments is what's checked", () => {
    // The query's own EXECUTABLE leading keyword is SELECT; the comment
    // text is irrelevant either way, but this proves comments are
    // stripped before matching, not naively substring-scanned.
    expect(assertReadOnlyQuery("-- INSERT is mentioned here only in a comment\nSELECT id FROM materials")).toEqual({ ok: true });
  });

  it("an empty query is refused", () => {
    expect(assertReadOnlyQuery("   ")).toEqual({ ok: false, error: "The query is empty." });
  });

  it("a multi-statement query with a write statement anywhere in it is refused", () => {
    const result = assertReadOnlyQuery("SELECT id FROM materials; DELETE FROM materials");
    expect(result.ok).toBe(false);
  });
});

describe("stageDatabaseQuery — real staging through the SAME stageRows() path, never a second implementation", () => {
  it("stages real rows from an injected executeQuery adapter, with connector.connectorType genuinely DATABASE", async () => {
    const executeQuery = vi.fn(async (): Promise<DatabaseQueryResult> => ({
      columns: ["MaterialID", "MaterialName"],
      rows: [["883729", "Decyl Glucoside"], ["883730", "Cocamidopropyl Betaine"]],
    }));
    const result = await stageDatabaseQuery("CHT_LIMS", { connectionRef: "conn-1", query: "SELECT MaterialID, MaterialName FROM materials", entity: "materials" }, opts, { executeQuery });
    expect(result.errors).toEqual([]);
    expect(result.connector.connectorType).toBe("DATABASE");
    expect(result.records).toHaveLength(2);
    expect(result.records[0].fields.MaterialID).toBe("883729");
    expect(result.records[0].fields.MaterialName).toBe("Decyl Glucoside");
  });

  it("a write-shaped query never reaches the injected adapter at all", async () => {
    const executeQuery = vi.fn(async (): Promise<DatabaseQueryResult> => ({ columns: [], rows: [] }));
    const result = await stageDatabaseQuery("CHT_LIMS", { connectionRef: "conn-1", query: "DELETE FROM materials", entity: "materials" }, opts, { executeQuery });
    expect(result.errors[0]).toMatchObject({ code: "write_query_refused", stage: "connect" });
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("an adapter that throws produces a sanitized structured error, never the raw exception's own message", async () => {
    const executeQuery = vi.fn(async (): Promise<DatabaseQueryResult> => {
      throw new Error("connection string: Server=10.0.0.5;Uid=admin;Pwd=SuperSecret123");
    });
    const result = await stageDatabaseQuery("CHT_LIMS", { connectionRef: "conn-1", query: "SELECT id FROM materials", entity: "materials" }, opts, { executeQuery });
    expect(result.errors[0]).toMatchObject({ code: "query_failed", stage: "extract", retryable: true, detail: "Error" });
    expect(JSON.stringify(result)).not.toContain("SuperSecret123");
  });

  it("a result with no columns is refused as empty, never silently staged as zero records with no explanation", async () => {
    const executeQuery = vi.fn(async (): Promise<DatabaseQueryResult> => ({ columns: [], rows: [] }));
    const result = await stageDatabaseQuery("CHT_LIMS", { connectionRef: "conn-1", query: "SELECT id FROM materials", entity: "materials" }, opts, { executeQuery });
    expect(result.errors[0]).toMatchObject({ code: "empty_result" });
  });

  it("a genuinely empty result set (real columns, zero rows) is not an error", async () => {
    const executeQuery = vi.fn(async (): Promise<DatabaseQueryResult> => ({ columns: ["id"], rows: [] }));
    const result = await stageDatabaseQuery("CHT_LIMS", { connectionRef: "conn-1", query: "SELECT id FROM materials", entity: "materials" }, opts, { executeQuery });
    expect(result.errors).toEqual([]);
    expect(result.records).toEqual([]);
  });
});

describe("createDatabaseConnector — a real SourceConnector implementation, the same shape createFileConnector() already implements", () => {
  it("discoverEntities returns exactly the configured entity names, never introspected/guessed", async () => {
    const connector = createDatabaseConnector("CHT_LIMS", { connectionRef: "conn-1", queries: { materials: "SELECT * FROM materials", suppliers: "SELECT * FROM vendors" } }, opts, { executeQuery: vi.fn() });
    expect(await connector.discoverEntities()).toEqual(["materials", "suppliers"]);
  });

  it("extract() for an unconfigured entity is refused structured, never a thrown exception", async () => {
    const connector = createDatabaseConnector("CHT_LIMS", { connectionRef: "conn-1", queries: { materials: "SELECT * FROM materials" } }, opts, { executeQuery: vi.fn() });
    const result = await connector.extract("suppliers");
    expect(result.errors[0]).toMatchObject({ code: "entity_not_configured" });
  });

  it("extract() for a configured entity executes its own query and stages the result", async () => {
    const executeQuery = vi.fn(async (spec: { entity: string }): Promise<DatabaseQueryResult> =>
      spec.entity === "materials" ? { columns: ["Chemical_ID"], rows: [["1"]] } : { columns: [], rows: [] },
    );
    const connector = createDatabaseConnector("CHT_LIMS", { connectionRef: "conn-1", queries: { materials: "SELECT Chemical_ID FROM materials" } }, opts, { executeQuery });
    const result = await connector.extract("materials");
    expect(result.records).toHaveLength(1);
    expect(executeQuery).toHaveBeenCalledWith(expect.objectContaining({ connectionRef: "conn-1", entity: "materials", query: "SELECT Chemical_ID FROM materials" }));
  });

  it("the connector's own identity carries no credential — connectionRef is the only connection-related field on the whole contract", () => {
    const connector = createDatabaseConnector("CHT_LIMS", { connectionRef: "conn-1", queries: {} }, opts, { executeQuery: vi.fn() });
    expect(connector.identity).toMatchObject({ connectorType: "DATABASE", sourceSystemId: "CHT_LIMS" });
    expect(JSON.stringify(connector.identity)).not.toMatch(/password|host|port|user/i);
  });
});
