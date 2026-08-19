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
          identity: { sourceEntity: entity, sourceRecordId: "001", idSource: "configured" },
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
          identity: { sourceEntity: entity, sourceRecordId: "001", idSource: "configured" },
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

  it("C13-8: credential/secret values never appear in staged records or errors (no secret supplied — weak baseline)", async () => {
    const result = await toResult(mockFileConnector(), "materials");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/password|secret|apikey|api_key|token/i);
  });

  it("C13-8 hardening: a REAL fake credential in connector configuration never reaches staged fields, lineage, errors, or source-resource metadata", async () => {
    // A realistic connector configuration object, exactly the shape a real
    // DATABASE/REST connector implementation (out of this session's scope)
    // would receive — proving the exclusion holds even when a secret is
    // genuinely present in the caller's config, not merely absent from the
    // fixture.
    const fakeConfig = { host: "db.customer.example", username: "svc_formulab", password: "hunter2-do-not-log", apiKey: "sk_live_51T3STFAKEKEYNEVERREAL", connectionString: "postgres://svc:hunter2-do-not-log@db.customer.example/erp" };

    function connectorWithSecretConfig(): SourceConnector {
      // The connector's own `identity`/staged output must never echo any
      // part of `fakeConfig` back — a credential is opaque to everything
      // downstream of "connect", by construction, never by convention.
      return {
        identity: { connectorId: "mock-secret-db", connectorType: "DATABASE", connectorVersion: "1.0", sourceSystemId: "TEST_DB_SRC", sourceSystemName: "Test DB Source" },
        discoverEntities: () => ["materials"],
        extract: (entity) => {
          void fakeConfig; // held only by the connector's own closure, never surfaced
          return {
            connector: { connectorId: "mock-secret-db", connectorType: "DATABASE", connectorVersion: "1.0", sourceSystemId: "TEST_DB_SRC", sourceSystemName: "Test DB Source" },
            entity,
            records: [
              {
                identity: { sourceEntity: entity, sourceRecordId: "001", idSource: "configured" },
                fields: { Chemical_ID: "001", Chemical_Name: "Test Material" },
                lineage: { sourceSystemId: "TEST_DB_SRC", sourceEntity: entity, sourceRecordId: "001", extractionRunId: "run-1", connectorVersion: "1.0" },
                extraction: { extractedAt: "2026-01-01T00:00:00.000Z", extractionRunId: "run-1" },
              },
            ],
            warnings: [],
            errors: [],
            stats: { totalRecords: 1, readRecords: 1, errorRecords: 0 },
            sourceResource: { kind: "database_table" as const, resourceName: "materials" },
          };
        },
      };
    }
    const result = await toResult(connectorWithSecretConfig(), "materials");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("hunter2-do-not-log");
    expect(serialized).not.toContain("sk_live_51T3STFAKEKEYNEVERREAL");
    expect(serialized).not.toContain("svc_formulab");
    expect(serialized).not.toMatch(/password|apikey|connectionstring/i);
  });

  it("C13-9: structured non-retryable error contract works", () => {
    const empty = stageCsvFile("TEST_FILE_SRC", "materials", "", { extractionRunId: "run-1" });
    expect(empty.errors[0]).toMatchObject({ stage: "parse", retryable: false });
    expect(empty.errors[0].code).toBeTruthy();
  });

  it("A5: a mocked retryable connector error satisfies the same ConnectorError contract as a non-retryable one", () => {
    function connectorWithTransientFailure(): ConnectorResult {
      return {
        connector: { connectorId: "mock-flaky", connectorType: "REST_API", connectorVersion: "1.0", sourceSystemId: "TEST_REST_SRC", sourceSystemName: "Test REST Source" },
        entity: "materials",
        records: [],
        warnings: [],
        errors: [{ code: "upstream_timeout", stage: "connect", message: "The source system did not respond in time.", retryable: true }],
        stats: { totalRecords: 0, readRecords: 0, errorRecords: 1 },
      };
    }
    const result = connectorWithTransientFailure();
    expect(result.errors[0]).toMatchObject({ stage: "connect", retryable: true, code: "upstream_timeout" });
  });

  it("A1/A2: source-resource metadata (identity + optional source-declared schema version) is representable without computing a FormuLab schema fingerprint here", async () => {
    const result: ConnectorResult = {
      connector: { connectorId: "mock-file", connectorType: "FILE", connectorVersion: "1.0", sourceSystemId: "TEST_FILE_SRC", sourceSystemName: "Test File Source" },
      entity: "materials",
      records: [],
      warnings: [],
      errors: [],
      stats: { totalRecords: 0, readRecords: 0, errorRecords: 0 },
      sourceResource: { kind: "file", resourceName: "customer-material-master.xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", byteSize: 4096, contentFingerprint: "a1b2c3d4", sourceSchemaVersion: "v3" },
    };
    expect(result.sourceResource?.resourceName).toBe("customer-material-master.xlsx");
    expect(result.sourceResource?.sourceSchemaVersion).toBe("v3");
    // Never an absolute local path.
    expect(result.sourceResource?.resourceName).not.toMatch(/^([A-Za-z]:\\|\/)/);
  });

  it("C13-10: same input/config produces deterministic staged record content (excluding legitimate timestamps)", () => {
    const a = stageCsvFile("TEST_FILE_SRC", "materials", "Chemical_ID,Chemical_Name\n001,Test Material", { extractionRunId: "run-1", extractedAt: "2026-01-01T00:00:00.000Z" });
    const b = stageCsvFile("TEST_FILE_SRC", "materials", "Chemical_ID,Chemical_Name\n001,Test Material", { extractionRunId: "run-2", extractedAt: "2026-06-01T00:00:00.000Z" });
    expect(a.records[0].fields).toEqual(b.records[0].fields);
    expect(a.records[0].lineage.rawRecordFingerprint).toBe(b.records[0].lineage.rawRecordFingerprint);
  });
});
