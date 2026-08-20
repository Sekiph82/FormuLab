import { describe, expect, it } from "vitest";
import { databaseSourceFromConnection, httpFetchConfigFromConnection, restSourceFromConnection } from "./connectorConnection";
import type { ConnectorConnection } from "../schemas/connector";

function baseConnection(overrides: Partial<ConnectorConnection>): ConnectorConnection {
  return {
    schemaVersion: "1.0",
    code: "connconn-1",
    name: "Test Connection",
    connectorType: "REST_API",
    sourceSystemId: "ACME",
    status: "never_tested",
    mappingProfileCount: 0,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "local",
    ...overrides,
  };
}

describe("restSourceFromConnection", () => {
  it("builds a real RestConnectorSource from a REST_API connection", () => {
    const conn = baseConnection({ connectorType: "REST_API", path: "/v1/materials", connectionRef: "ref-1", maxPages: 5 });
    expect(restSourceFromConnection(conn, "materials")).toEqual({ connectionRef: "ref-1", endpoints: { materials: "/v1/materials" }, maxPages: 5 });
  });

  it("throws for a non-REST_API connection type", () => {
    const conn = baseConnection({ connectorType: "FILE" });
    expect(() => restSourceFromConnection(conn, "materials")).toThrow(/not a REST_API connection/);
  });

  it("throws when no path is configured", () => {
    const conn = baseConnection({ connectorType: "REST_API" });
    expect(() => restSourceFromConnection(conn, "materials")).toThrow(/no configured endpoint path/);
  });
});

describe("httpFetchConfigFromConnection", () => {
  it("builds a real HttpFetchAdapterConfig with page pagination", () => {
    const conn = baseConnection({ connectorType: "REST_API", baseUrl: "https://api.example.com", recordArrayPath: "items", paginationKind: "page", pageParam: "page", pageSizeParam: "size", pageSizeValue: 20, timeoutMs: 5000 });
    expect(httpFetchConfigFromConnection(conn)).toEqual({
      baseUrl: "https://api.example.com",
      recordArrayPath: "items",
      pagination: { kind: "page", pageParam: "page", pageSizeParam: "size", pageSize: 20 },
      timeoutMs: 5000,
    });
  });

  it("defaults to no pagination when incompletely configured", () => {
    const conn = baseConnection({ connectorType: "REST_API", baseUrl: "https://api.example.com", paginationKind: "page" });
    expect(httpFetchConfigFromConnection(conn).pagination).toEqual({ kind: "none" });
  });

  it("throws when no base URL is configured", () => {
    const conn = baseConnection({ connectorType: "REST_API" });
    expect(() => httpFetchConfigFromConnection(conn)).toThrow(/no configured base URL/);
  });
});

describe("databaseSourceFromConnection", () => {
  it("builds a real DatabaseConnectorSource", () => {
    const conn = baseConnection({ connectorType: "DATABASE", table: "erp_materials", dbSchema: "dbo", connectionRef: "ref-2" });
    expect(databaseSourceFromConnection(conn, "materials")).toEqual({ connectionRef: "ref-2", entities: { materials: { table: "erp_materials", schema: "dbo" } } });
  });

  it("throws for a non-DATABASE connection type", () => {
    const conn = baseConnection({ connectorType: "REST_API" });
    expect(() => databaseSourceFromConnection(conn, "materials")).toThrow(/not a DATABASE connection/);
  });

  it("throws when no table is configured", () => {
    const conn = baseConnection({ connectorType: "DATABASE" });
    expect(() => databaseSourceFromConnection(conn, "materials")).toThrow(/no configured table/);
  });
});
