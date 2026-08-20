/**
 * FVL-04.022 — REST API Connector Contract acceptance.
 */
import { describe, expect, it, vi } from "vitest";
import { createRestApiConnector, HttpStatusError, retryableForStatus, stageRestEntity, type RestResponsePage } from "./restApiConnector";

const opts = { extractionRunId: "run-1", extractedAt: "2026-01-01T00:00:00.000Z" };

describe("stageRestEntity — single page, real JSON staging reused from stageJsonFile", () => {
  it("stages a bare array-of-objects page, connector.connectorType genuinely REST_API", async () => {
    const fetchPage = vi.fn(async (): Promise<RestResponsePage> => ({ bodyText: JSON.stringify([{ ItemNo: "AC-1", Description: "Test item" }]) }));
    const result = await stageRestEntity("ACME_ERP", { connectionRef: "conn-1", endpoints: { items: "/api/v1/items" } }, "items", opts, { fetchPage });
    expect(result.errors).toEqual([]);
    expect(result.connector.connectorType).toBe("REST_API");
    expect(result.records).toHaveLength(1);
    expect(result.records[0].fields.ItemNo).toBe("AC-1");
  });

  it("stages a { items: [...] } page shape too, reusing the same bare-array/wrapped detection", async () => {
    const fetchPage = vi.fn(async (): Promise<RestResponsePage> => ({ bodyText: JSON.stringify({ items: [{ ItemNo: "AC-2" }] }) }));
    const result = await stageRestEntity("ACME_ERP", { connectionRef: "conn-1", endpoints: { items: "/api/v1/items" } }, "items", opts, { fetchPage });
    expect(result.records[0].fields.ItemNo).toBe("AC-2");
  });
});

describe("stageRestEntity — pagination follows nextCursor until the adapter reports none", () => {
  it("fetches every page in sequence, passing the prior page's own cursor forward, never a fabricated one", async () => {
    const calls: (string | undefined)[] = [];
    const fetchPage = vi.fn(async (spec: { cursor?: string }): Promise<RestResponsePage> => {
      calls.push(spec.cursor);
      if (spec.cursor === undefined) return { bodyText: JSON.stringify([{ id: "1" }]), nextCursor: "page-2" };
      if (spec.cursor === "page-2") return { bodyText: JSON.stringify([{ id: "2" }]), nextCursor: "page-3" };
      return { bodyText: JSON.stringify([{ id: "3" }]) };
    });
    const result = await stageRestEntity("ACME_ERP", { connectionRef: "conn-1", endpoints: { items: "/api/v1/items" } }, "items", opts, { fetchPage });
    expect(calls).toEqual([undefined, "page-2", "page-3"]);
    expect(result.records).toHaveLength(3);
    expect(result.records.map((r) => r.fields.id)).toEqual(["1", "2", "3"]);
  });

  it("a maxPages cap stops pagination and reports a real warning, never silently drops it or fabricates data beyond the cap", async () => {
    let page = 0;
    const fetchPage = vi.fn(async (): Promise<RestResponsePage> => {
      page++;
      return { bodyText: JSON.stringify([{ id: String(page) }]), nextCursor: `cursor-${page}` };
    });
    const result = await stageRestEntity("ACME_ERP", { connectionRef: "conn-1", endpoints: { items: "/api/v1/items" }, maxPages: 3 }, "items", opts, { fetchPage });
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result.records).toHaveLength(3);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "pagination_limit_reached" }));
  });

  it("without a configured idField, ordinal identities across pages are renumbered to be unique for the WHOLE merged batch — never colliding page-to-page", async () => {
    const fetchPage = vi.fn(async (spec: { cursor?: string }): Promise<RestResponsePage> => {
      if (spec.cursor === undefined) return { bodyText: JSON.stringify([{ name: "a" }, { name: "b" }]), nextCursor: "p2" };
      return { bodyText: JSON.stringify([{ name: "c" }]) };
    });
    const result = await stageRestEntity("ACME_ERP", { connectionRef: "conn-1", endpoints: { items: "/api/v1/items" } }, "items", opts, { fetchPage });
    const ids = result.records.map((r) => r.identity.sourceRecordId);
    expect(new Set(ids).size).toBe(3); // no collision — all three unique
    expect(ids).toEqual(["1", "2", "3"]);
  });

  it("with a configured idField, real configured identities are left untouched by the renumbering step", async () => {
    const fetchPage = vi.fn(async (spec: { cursor?: string }): Promise<RestResponsePage> => {
      if (spec.cursor === undefined) return { bodyText: JSON.stringify([{ ItemNo: "X-1" }]), nextCursor: "p2" };
      return { bodyText: JSON.stringify([{ ItemNo: "X-2" }]) };
    });
    const result = await stageRestEntity("ACME_ERP", { connectionRef: "conn-1", endpoints: { items: "/api/v1/items" } }, "items", { ...opts, idField: "ItemNo" }, { fetchPage });
    expect(result.records.map((r) => r.identity.sourceRecordId)).toEqual(["X-1", "X-2"]);
    expect(result.records.every((r) => r.identity.idSource === "configured")).toBe(true);
  });
});

describe("stageRestEntity — structured failure, never a leaked adapter exception", () => {
  it("an unconfigured entity is refused structured, never a thrown exception", async () => {
    const result = await stageRestEntity("ACME_ERP", { connectionRef: "conn-1", endpoints: { items: "/api/v1/items" } }, "suppliers", opts, { fetchPage: vi.fn() });
    expect(result.errors[0]).toMatchObject({ code: "entity_not_configured" });
  });

  it("an adapter that throws produces a sanitized structured error, never the raw exception's own message", async () => {
    const fetchPage = vi.fn(async (): Promise<RestResponsePage> => {
      throw new Error("Authorization: Bearer sk-supersecret-token-12345");
    });
    const result = await stageRestEntity("ACME_ERP", { connectionRef: "conn-1", endpoints: { items: "/api/v1/items" } }, "items", opts, { fetchPage });
    expect(result.errors[0]).toMatchObject({ code: "fetch_failed", retryable: true, detail: "Error" });
    expect(JSON.stringify(result)).not.toContain("supersecret");
  });
});

describe("createRestApiConnector — a real SourceConnector implementation, the same shape createFileConnector()/createDatabaseConnector() already implement", () => {
  it("discoverEntities returns exactly the configured entity names", async () => {
    const connector = createRestApiConnector("ACME_ERP", { connectionRef: "conn-1", endpoints: { items: "/api/v1/items", suppliers: "/api/v1/vendors" } }, opts, { fetchPage: vi.fn() });
    expect(await connector.discoverEntities()).toEqual(["items", "suppliers"]);
  });

  it("extract() delegates to stageRestEntity for the requested entity", async () => {
    const fetchPage = vi.fn(async (): Promise<RestResponsePage> => ({ bodyText: JSON.stringify([{ id: "1" }]) }));
    const connector = createRestApiConnector("ACME_ERP", { connectionRef: "conn-1", endpoints: { items: "/api/v1/items" } }, opts, { fetchPage });
    const result = await connector.extract("items");
    expect(result.records).toHaveLength(1);
    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({ connectionRef: "conn-1", entity: "items", path: "/api/v1/items" }));
  });

  it("the connector's own identity carries no credential — connectionRef is the only connection-related field on the whole contract", () => {
    const connector = createRestApiConnector("ACME_ERP", { connectionRef: "conn-1", endpoints: {} }, opts, { fetchPage: vi.fn() });
    expect(connector.identity).toMatchObject({ connectorType: "REST_API", sourceSystemId: "ACME_ERP" });
    expect(JSON.stringify(connector.identity)).not.toMatch(/password|token|key|secret|bearer/i);
  });
});

describe("FVL-04.022 hardening Part D6 — cursor loop detection", () => {
  it("REST9: a repeated nextCursor stops the loop with a pagination_loop warning, never an infinite loop", async () => {
    const fetchPage = vi.fn(async (spec: { cursor?: string }): Promise<RestResponsePage> => {
      if (spec.cursor === undefined) return { bodyText: JSON.stringify([{ id: "1" }]), nextCursor: "c2" };
      // Every subsequent call reports the SAME cursor again — a genuine
      // pagination bug in a real API.
      return { bodyText: JSON.stringify([{ id: "2" }]), nextCursor: "c2" };
    });
    const result = await stageRestEntity("ACME_ERP", { connectionRef: "conn-1", endpoints: { items: "/api/v1/items" } }, "items", opts, { fetchPage });
    expect(fetchPage).toHaveBeenCalledTimes(2); // stopped on the SECOND repeat of c2, not spun forever
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "pagination_loop" }));
    expect(result.records).toHaveLength(2);
  });
});

describe("FVL-04.022 hardening Part D7 — HTTP status retryable classification", () => {
  it("REST10: 429 is retryable", () => {
    expect(retryableForStatus(429)).toBe(true);
  });
  it("REST11: 400 is non-retryable", () => {
    expect(retryableForStatus(400)).toBe(false);
  });
  it("401/403/404 are non-retryable", () => {
    expect(retryableForStatus(401)).toBe(false);
    expect(retryableForStatus(403)).toBe(false);
    expect(retryableForStatus(404)).toBe(false);
  });
  it("REST12: 500/502/503/504 are retryable", () => {
    expect(retryableForStatus(500)).toBe(true);
    expect(retryableForStatus(502)).toBe(true);
    expect(retryableForStatus(503)).toBe(true);
    expect(retryableForStatus(504)).toBe(true);
  });
  it("408 (timeout) is retryable", () => {
    expect(retryableForStatus(408)).toBe(true);
  });

  it("an adapter throwing HttpStatusError propagates the real retryable classification into the connector's own structured error", async () => {
    const fetchPage = vi.fn(async (): Promise<RestResponsePage> => {
      throw new HttpStatusError(429, "Too Many Requests");
    });
    const result = await stageRestEntity("ACME_ERP", { connectionRef: "conn-1", endpoints: { items: "/api/v1/items" } }, "items", opts, { fetchPage });
    expect(result.errors[0]).toMatchObject({ code: "fetch_failed", retryable: true, detail: "HTTP 429" });
  });

  it("an adapter throwing HttpStatusError for a 400 propagates non-retryable", async () => {
    const fetchPage = vi.fn(async (): Promise<RestResponsePage> => {
      throw new HttpStatusError(400, "Bad Request");
    });
    const result = await stageRestEntity("ACME_ERP", { connectionRef: "conn-1", endpoints: { items: "/api/v1/items" } }, "items", opts, { fetchPage });
    expect(result.errors[0]).toMatchObject({ code: "fetch_failed", retryable: false, detail: "HTTP 400" });
  });
});
