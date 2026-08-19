/**
 * FVL-04.013 — External Source Connector Contract acceptance (C13-1..10).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ConnectorResult, SourceConnector } from "../schemas/connector";
import { stageCsvFile } from "./fileConnector";

function mockFileConnector(): SourceConnector {
  return {
    identity: { connectorId: "mock-file", connectorType: "FILE", connectorVersion: "1.0", sourceSystemId: "TEST_FILE_SRC", sourceSystemName: "Test File Source" },
    discoverEntities: () => ["materials"],
    extract: (entity) => stageCsvFile("TEST_FILE_SRC", entity, "Chemical_ID,Chemical_Name\n001,Test Material", { extractionRunId: "run-1", extractedAt: "2026-01-01T00:00:00.000Z" }),
  };
}

function mockDatabaseConnector(): SourceConnector {
  return {
    identity: { connectorId: "mock-db", connectorType: "DATABASE", connectorVersion: "1.0", sourceSystemId: "TEST_DB_SRC", sourceSystemName: "Test DB Source" },
    discoverEntities: () => ["materials"],
    extract: (entity) => ({
      connector: { connectorId: "mock-db", connectorType: "DATABASE", connectorVersion: "1.0", sourceSystemId: "TEST_DB_SRC", sourceSystemName: "Test DB Source" },
      entity,
      records: [
        {
          identity: { sourceEntity: entity, sourceRecordId: "001" },
          fields: { Chemical_ID: "001", Chemical_Name: "Test Material" },
          lineage: { sourceSystemId: "TEST_DB_SRC", sourceEntity: entity, sourceRecordId: "001", extractionRunId: "run-1", connectorVersion: "1.0" },
          extraction: { extractedAt: "2026-01-01T00:00:00.000Z", extractionRunId: "run-1" },
        },
      ],
      warnings: [],
      errors: [],
      stats: { totalRecords: 1, readRecords: 1, errorRecords: 0 },
    }),
  };
}

function mockRestConnector(): SourceConnector {
  return {
    identity: { connectorId: "mock-rest", connectorType: "REST_API", connectorVersion: "1.0", sourceSystemId: "TEST_REST_SRC", sourceSystemName: "Test REST Source" },
    discoverEntities: async () => ["materials"],
    extract: async (entity) => ({
      connector: { connectorId: "mock-rest", connectorType: "REST_API", connectorVersion: "1.0", sourceSystemId: "TEST_REST_SRC", sourceSystemName: "Test REST Source" },
      entity,
      records: [
        {
          identity: { sourceEntity: entity, sourceRecordId: "001" },
          fields: { Chemical_ID: "001", Chemical_Name: "Test Material" },
          lineage: { sourceSystemId: "TEST_REST_SRC", sourceEntity: entity, sourceRecordId: "001", extractionRunId: "run-1", connectorVersion: "1.0" },
          extraction: { extractedAt: "2026-01-01T00:00:00.000Z", extractionRunId: "run-1" },
        },
      ],
      warnings: [],
      errors: [],
      stats: { totalRecords: 1, readRecords: 1, errorRecords: 0 },
    }),
  };
}

async function toResult(c: SourceConnector, entity: string): Promise<ConnectorResult> {
  return c.extract(entity);
}

describe("SourceConnector — common contract (FVL-04.013)", () => {
  it("C13-1: a mock FILE connector satisfies the common contract", async () => {
    const c = mockFileConnector();
    expect(c.identity.connectorType).toBe("FILE");
    const result = await toResult(c, "materials");
    expect(result.records[0].fields.Chemical_ID).toBe("001");
  });

  it("C13-2: a mock DATABASE connector shape satisfies the SAME contract with no core semantic change", async () => {
    const c = mockDatabaseConnector();
    expect(c.identity.connectorType).toBe("DATABASE");
    const result = await toResult(c, "materials");
    expect(result.records[0].identity.sourceRecordId).toBe("001");
    expect(result.records[0].lineage.sourceSystemId).toBe("TEST_DB_SRC");
  });

  it("C13-3: a mock REST connector shape satisfies the SAME contract", async () => {
    const c = mockRestConnector();
    expect(c.identity.connectorType).toBe("REST_API");
    const result = await toResult(c, "materials");
    expect(result.records[0].fields.Chemical_ID).toBe("001");
  });

  it("C13-4: source system/entity/record IDs survive extraction", async () => {
    const result = await toResult(mockDatabaseConnector(), "materials");
    const rec = result.records[0];
    expect(rec.lineage.sourceSystemId).toBe("TEST_DB_SRC");
    expect(rec.identity.sourceEntity).toBe("materials");
    expect(rec.identity.sourceRecordId).toBe("001");
  });

  it("C13-5: connector version survives lineage", async () => {
    const result = await toResult(mockFileConnector(), "materials");
    expect(result.records[0].lineage.connectorVersion).toBe("1.0");
  });

  it("C13-6: source timestamps survive when available", async () => {
    const result = await toResult(mockFileConnector(), "materials");
    expect(result.records[0].extraction.extractedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("C13-7: no write operation exists on the contract — verified by source-text scan, not just by omission from the mock", () => {
    const contractPath = fileURLToPath(new URL("../schemas/connector.ts", import.meta.url));
    const src = readFileSync(contractPath, "utf-8");
    const interfaceMatch = /export interface SourceConnector \{[\s\S]*?\n\}/.exec(src);
    expect(interfaceMatch).toBeTruthy();
    const body = interfaceMatch![0];
    for (const forbidden of ["write(", "update(", "delete(", "patch(", "put(", "executeMutation("]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("C13-8: credential/secret values never appear in staged records or errors", async () => {
    const result = await toResult(mockFileConnector(), "materials");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/password|secret|apikey|api_key|token/i);
  });

  it("C13-9: structured retryable vs non-retryable error contract works", () => {
    const empty = stageCsvFile("TEST_FILE_SRC", "materials", "", { extractionRunId: "run-1" });
    expect(empty.errors[0]).toMatchObject({ stage: "parse", retryable: false });
    expect(empty.errors[0].code).toBeTruthy();
  });

  it("C13-10: same input/config produces deterministic staged record content (excluding legitimate timestamps)", () => {
    const a = stageCsvFile("TEST_FILE_SRC", "materials", "Chemical_ID,Chemical_Name\n001,Test Material", { extractionRunId: "run-1", extractedAt: "2026-01-01T00:00:00.000Z" });
    const b = stageCsvFile("TEST_FILE_SRC", "materials", "Chemical_ID,Chemical_Name\n001,Test Material", { extractionRunId: "run-2", extractedAt: "2026-06-01T00:00:00.000Z" });
    expect(a.records[0].fields).toEqual(b.records[0].fields);
    expect(a.records[0].lineage.rawRecordFingerprint).toBe(b.records[0].lineage.rawRecordFingerprint);
  });
});
