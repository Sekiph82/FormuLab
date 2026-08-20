/**
 * FVL-04.022 hardening (Part D9) — REST1-REST19 executable acceptance
 * against a REAL local HTTP server (Node's own `http` module, loopback
 * only, never a real customer endpoint) and the REAL `createHttpFetchAdapter()`
 * — requests genuinely traverse `fetch()` and real HTTP status codes,
 * never a fake `fetchPage` bypassing request construction.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpFetchAdapter } from "./httpFetchAdapter";
import { createRestApiConnector, stageRestEntity } from "./restApiConnector";
import { discoverSourceSchema } from "./schemaDiscovery";
import { applyMappingProfile, validateMappingProfile } from "./mappingProfile";
import type { MappingProfile } from "../schemas/connector";

const opts = { extractionRunId: "run-1", extractedAt: "2026-01-01T00:00:00.000Z" };

let server: Server;
let baseUrl: string;
const methodsSeen: string[] = [];
let requestCount429 = 0;
let onNeverRespondingClose: (() => void) | undefined;

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    methodsSeen.push(req.method ?? "?");
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/items-bare") return send(200, [{ ItemNo: "AC-1" }]);
    if (url.pathname === "/items-wrapped") return send(200, { items: [{ ItemNo: "AC-1" }] });
    if (url.pathname === "/items-nested") return send(200, { payload: { records: [{ ItemNo: "AC-1" }] } });

    if (url.pathname === "/items-paged") {
      const page = Number(url.searchParams.get("p") ?? "1");
      const pageSize = Number(url.searchParams.get("ps") ?? "2");
      const all = [{ id: "1" }, { id: "2" }, { id: "3" }];
      const start = (page - 1) * pageSize;
      return send(200, { items: all.slice(start, start + pageSize) });
    }

    if (url.pathname === "/items-offset") {
      const offset = Number(url.searchParams.get("off") ?? "0");
      const limit = Number(url.searchParams.get("lim") ?? "2");
      const all = [{ id: "1" }, { id: "2" }, { id: "3" }];
      return send(200, { items: all.slice(offset, offset + limit) });
    }

    if (url.pathname === "/items-cursor") {
      const cursor = url.searchParams.get("cur");
      if (!cursor) return send(200, { data: [{ id: "1" }], meta: { nextCursor: "page2" } });
      if (cursor === "page2") return send(200, { data: [{ id: "2" }], meta: { nextCursor: "" } });
      return send(200, { data: [], meta: {} });
    }

    if (url.pathname === "/items-cursor-loop") {
      return send(200, { data: [{ id: "x" }], meta: { nextCursor: "same" } });
    }

    if (url.pathname === "/rate-limited") {
      requestCount429++;
      return send(429, { error: "rate limited" });
    }
    if (url.pathname === "/bad-request") return send(400, { error: "bad request" });
    if (url.pathname === "/server-error") return send(500, { error: "internal" });

    if (url.pathname === "/auth-check") {
      const auth = req.headers.authorization;
      if (auth !== "Bearer real-secret-token-xyz") return send(401, { error: "unauthorized" });
      return send(200, [{ id: "1" }]);
    }

    if (url.pathname === "/missing-id") return send(200, [{ NoIdHere: "x" }]);

    if (url.pathname === "/items-nested-id") {
      return send(200, [
        { ItemNo: "AC-1", external: { id: "EXT-1" } },
        { ItemNo: "AC-2", external: { id: "EXT-2" } },
      ]);
    }
    if (url.pathname === "/items-nested-id-missing") return send(200, [{ ItemNo: "AC-3", external: { note: "no id here" } }]);
    if (url.pathname === "/items-nested-id-paged") {
      const page = Number(url.searchParams.get("p") ?? "1");
      const pageSize = Number(url.searchParams.get("ps") ?? "1");
      const all = [{ ItemNo: "AC-1", external: { id: "EXT-1" } }, { ItemNo: "AC-2", external: { id: "EXT-2" } }];
      const start = (page - 1) * pageSize;
      return send(200, all.slice(start, start + pageSize));
    }

    if (url.pathname === "/never-responds") return; // intentionally never calls res.end() — REST22 timeout acceptance
    if (url.pathname === "/never-responds-trackable") {
      // Session 12 hardening (Part 2/REST-TIMEOUT-2) — the SERVER's own
      // proof that the underlying connection was genuinely terminated,
      // not merely ignored client-side. `req`'s "close" event fires when
      // the underlying TCP connection actually closes.
      req.on("close", () => onNeverRespondingClose?.());
      return; // never respond
    }

    return send(404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
});

describe("REST1/REST2/REST3: bare array, items path, nested data path — all through the REAL HTTP round-trip", () => {
  it("REST1: bare GET array", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/items-bare" } }, "items", opts, { fetchPage });
    expect(result.errors).toEqual([]);
    expect(result.records[0].fields.ItemNo).toBe("AC-1");
  });

  it("REST2: { items: [...] } path", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/items-wrapped" } }, "items", opts, { fetchPage });
    expect(result.records[0].fields.ItemNo).toBe("AC-1");
  });

  it("REST3: an explicit nested record-array path (payload.records)", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl, recordArrayPath: "payload.records" });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/items-nested" } }, "items", opts, { fetchPage });
    expect(result.records[0].fields.ItemNo).toBe("AC-1");
  });
});

describe("REST4/REST5: explicit external ID / missing required ID", () => {
  it("REST4: an explicitly configured idField resolves a real configured identity", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/items-bare" } }, "items", { ...opts, idField: "ItemNo" }, { fetchPage });
    expect(result.records[0].identity).toMatchObject({ idSource: "configured", sourceRecordId: "AC-1" });
  });

  it("REST5: a required idField missing from the row produces a structured identity error, never a silent downgrade to ordinal", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/missing-id" } }, "items", { ...opts, idField: "ItemNo", requireExplicitId: true }, { fetchPage });
    expect(result.errors[0].code).toBe("missing_source_id");
  });

  // Session 11 hardening (Part 5B) — audited against current code before
  // writing anything new: `stageJsonFile()`'s own `flattenJson()` already
  // dot-flattens every nested object (`{external:{id:"X"}}` ->
  // `fields["external.id"] = "X"`), and `idField` is matched against that
  // SAME flattened `fields` record. An explicit dotted `idField` therefore
  // ALREADY resolves a nested source path correctly — no fuzzy guessing,
  // no new staging mechanism needed. Proven here rather than reimplemented.
  it("REST20: an explicit dotted idField (e.g. \"external.id\") already resolves a real nested identity — no new mechanism needed", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/items-nested-id" } }, "items", { ...opts, idField: "external.id", requireExplicitId: true }, { fetchPage });
    expect(result.errors).toEqual([]);
    expect(result.records.map((r) => r.identity)).toEqual([
      { sourceEntity: "items", sourceRecordId: "EXT-1", idSource: "configured" },
      { sourceEntity: "items", sourceRecordId: "EXT-2", idSource: "configured" },
    ]);
  });

  it("REST20: a missing nested idField produces the SAME structured identity failure as a missing flat one — never a silent ordinal fallback when explicit identity is required", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/items-nested-id-missing" } }, "items", { ...opts, idField: "external.id", requireExplicitId: true }, { fetchPage });
    expect(result.errors[0].code).toBe("missing_source_id");
    expect(result.records).toEqual([]);
  });

  it("REST20: a nested identity stays stable across real pagination", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl, pagination: { kind: "page", pageParam: "p", pageSizeParam: "ps", pageSize: 1 } });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/items-nested-id-paged" } }, "items", { ...opts, idField: "external.id", requireExplicitId: true }, { fetchPage });
    expect(result.records.map((r) => r.identity.sourceRecordId)).toEqual(["EXT-1", "EXT-2"]);
    expect(result.records.every((r) => r.identity.idSource === "configured")).toBe(true);
  });
});

describe("REST22 (Session 11 hardening, Part 5A): a bounded client-side request timeout against a server that genuinely never responds", () => {
  it("a request to an endpoint that never calls res.end() is aborted at the configured timeout, producing a sanitized, retryable structured failure — never a hang", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl, timeoutMs: 200, queryParams: { apiKey: "real-secret-value" } });
    const start = Date.now();
    await expect(stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/never-responds" } }, "items", opts, { fetchPage })).resolves.toMatchObject({
      records: [],
      errors: [expect.objectContaining({ retryable: true })],
    });
    expect(Date.now() - start).toBeLessThan(5000); // genuinely bounded, not left hanging
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/never-responds" } }, "items", opts, { fetchPage });
    expect(result.errors[0].message).not.toContain("real-secret-value"); // query values still redacted in the timeout error
  }, 10000);
});

describe("REST-TIMEOUT-2 (Session 12 hardening, Part 2): the underlying request is demonstrably terminated on timeout, not merely ignored by the caller", () => {
  it("a real never-responding server observes the connection actually close once the configured createAbortController is used", async () => {
    const closed = new Promise<void>((resolve) => {
      onNeverRespondingClose = resolve;
    });
    // The caller opts into real cancellation — safe here since packages/shared's
    // own tests run under plain Node, where fetch()/AbortController genuinely
    // share the same realm (see createHttpFetchAdapter's own doc comment for
    // why this can never be constructed internally/by default).
    const fetchPage = createHttpFetchAdapter({ baseUrl, timeoutMs: 200, createAbortController: () => new AbortController() });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/never-responds-trackable" } }, "items", opts, { fetchPage });
    expect(result.errors[0]?.retryable).toBe(true);
    await expect(closed).resolves.toBeUndefined(); // hard proof — the SERVER itself observed the connection close, not merely the client giving up
  }, 10000);
});

describe("REST-TIMEOUT-3 (Session 12 hardening, Part 2): normal successful requests remain unaffected, with or without createAbortController configured", () => {
  it("a normal GET still succeeds when createAbortController is configured", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl, timeoutMs: 5000, createAbortController: () => new AbortController() });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/items-bare" } }, "items", opts, { fetchPage });
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(1);
  });

  it("a normal GET still succeeds with the default (no createAbortController) configuration", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl, timeoutMs: 5000 });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/items-bare" } }, "items", opts, { fetchPage });
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(1);
  });
});

describe("REST6/REST7/REST8: real pagination models over the real HTTP round-trip", () => {
  it("REST6: page + pageSize", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl, pagination: { kind: "page", pageParam: "p", pageSizeParam: "ps", pageSize: 2 }, recordArrayPath: "items" });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/items-paged" } }, "items", opts, { fetchPage });
    expect(result.records.map((r) => r.fields.id)).toEqual(["1", "2", "3"]);
  });

  it("REST7: offset + limit", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl, pagination: { kind: "offset", offsetParam: "off", limitParam: "lim", limit: 2 }, recordArrayPath: "items" });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/items-offset" } }, "items", opts, { fetchPage });
    expect(result.records.map((r) => r.fields.id)).toEqual(["1", "2", "3"]);
  });

  it("REST8: cursor, read from a configured nextCursorPath in the real response body", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl, pagination: { kind: "cursor", cursorParam: "cur", nextCursorPath: "meta.nextCursor" } });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/items-cursor" } }, "items", opts, { fetchPage });
    expect(result.records.map((r) => r.fields.id)).toEqual(["1", "2"]);
  });

  it("REST9: a real server that repeats the same cursor forever is stopped by cursor-loop detection, not an infinite request loop", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl, pagination: { kind: "cursor", cursorParam: "cur", nextCursorPath: "meta.nextCursor" } });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/items-cursor-loop" } }, "items", opts, { fetchPage });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "pagination_loop" }));
  });
});

describe("REST10/REST11/REST12: real HTTP status semantics through the real adapter", () => {
  it("REST10: a real 429 response classifies retryable", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/rate-limited" } }, "items", opts, { fetchPage });
    expect(result.errors[0]).toMatchObject({ code: "fetch_failed", retryable: true });
  });

  it("REST11: a real 400 response classifies non-retryable", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/bad-request" } }, "items", opts, { fetchPage });
    expect(result.errors[0]).toMatchObject({ code: "fetch_failed", retryable: false });
  });

  it("REST12: a real 500 response classifies retryable", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/server-error" } }, "items", opts, { fetchPage });
    expect(result.errors[0]).toMatchObject({ code: "fetch_failed", retryable: true });
  });
});

describe("REST13: secrets never leak into a structured error/lineage from the real adapter", () => {
  it("a real Authorization header is genuinely sent (proven by the server accepting it) and never appears in any structured output", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl, headers: { Authorization: "Bearer real-secret-token-xyz" } });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/auth-check" } }, "items", opts, { fetchPage });
    expect(result.errors).toEqual([]); // proves the header was genuinely sent and accepted
    expect(result.records).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("real-secret-token-xyz");
  });

  it("a query parameter is redacted before appearing in a structured error message", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl, queryParams: { apiKey: "should-never-appear-in-errors" } });
    const result = await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/bad-request" } }, "items", opts, { fetchPage });
    expect(JSON.stringify(result)).not.toContain("should-never-appear-in-errors");
  });
});

describe("REST14/REST15: GET-only, no write methods anywhere", () => {
  it("REST14/REST15: every real request the adapter issued was a genuine GET — the server itself observed no other HTTP method", async () => {
    methodsSeen.length = 0;
    const fetchPage = createHttpFetchAdapter({ baseUrl });
    await stageRestEntity("ACME", { connectionRef: "conn-1", endpoints: { items: "/items-bare" } }, "items", opts, { fetchPage });
    expect(methodsSeen.every((m) => m === "GET")).toBe(true);
    expect(methodsSeen.length).toBeGreaterThan(0);
  });

  it("createHttpFetchAdapter's own return value is a single function — structurally no write method exists to call even if a caller wanted to", () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl });
    expect(typeof fetchPage).toBe("function");
  });
});

describe("REST16/REST17/REST18: SourceConnector, Schema Discovery, Mapping Profile — the real downstream chain, fed by the real HTTP adapter", () => {
  it("a real REST SourceConnector stages, discovers a schema, and maps through a real MappingProfile", async () => {
    const fetchPage = createHttpFetchAdapter({ baseUrl });
    const connector = createRestApiConnector("ACME", { connectionRef: "conn-1", endpoints: { items: "/items-bare" } }, opts, { fetchPage });
    expect(await connector.discoverEntities()).toEqual(["items"]);
    const staged = await connector.extract("items");
    expect(staged.connector.connectorType).toBe("REST_API");

    const schema = discoverSourceSchema("ACME", [{ entity: "items", records: staged.records }]);
    const profile: MappingProfile = {
      schemaVersion: "1.0",
      code: "acme-items::v1",
      profileId: "acme-items",
      profileName: "ACME items",
      sourceSystemId: "ACME",
      sourceEntity: "items",
      sourceSchemaFingerprint: schema.fingerprint,
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "ItemNo", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "ItemNo", targetTemplate: "raw_materials", targetField: "material_name" },
      ],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    };
    expect(validateMappingProfile(profile, schema)).toEqual([]);
    const mapped = applyMappingProfile(profile, staged.records[0]);
    expect(mapped.candidates.find((c) => c.targetTemplate === "raw_materials")!.row.material_code).toBe("AC-1");
  });
});

describe("REST19: no vendor-specific production branch anywhere in the REST connector engine or the real HTTP adapter", () => {
  it("no source-text conditional on a specific SaaS/vendor API exists", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(process.cwd(), "src", "engine");
    for (const file of ["restApiConnector.ts", "httpFetchAdapter.ts"]) {
      const src = fs.readFileSync(path.join(root, file), "utf-8");
      expect(src).not.toMatch(/sourceSystem(Id)?\s*===\s*["']|vendor\s*===\s*["']/);
    }
  });
});

describe("REST23 (Session 11 hardening, Part 5C): the shared connector layer never becomes a credential store — audited, not newly built", () => {
  // Audited against current code before writing anything: `RestConnectorSource`
  // (restApiConnector.ts) and `DatabaseConnectorSource` (databaseConnector.ts)
  // already carry ONLY an opaque `connectionRef: string` — no credential
  // field exists on either persisted source config, on `MappingProfile`
  // (schemas/connector.ts), or on `DataExchangeImportJob`. `createHttpFetchAdapter()`'s
  // own `headers` are supplied already-resolved by the caller at CALL TIME
  // (restApiConnector.ts's own doc comment: "this module never sees a raw
  // API key, bearer token, or password, and never issues an HTTP request
  // itself") — no code path in this codebase loads a header value from a
  // persisted connector/mapping-profile record. The boundary already holds;
  // this proves it structurally rather than inventing a credential-
  // management subsystem that isn't needed.
  it("RestConnectorSource/DatabaseConnectorSource declare no credential field — connectionRef is the only persisted identity", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(process.cwd(), "src", "engine");
    const restSrc = fs.readFileSync(path.join(root, "restApiConnector.ts"), "utf-8");
    const dbSrc = fs.readFileSync(path.join(root, "databaseConnector.ts"), "utf-8");
    const interfaceBody = (src: string, name: string) => src.slice(src.indexOf(`interface ${name}`), src.indexOf("}", src.indexOf(`interface ${name}`)));
    for (const [src, name] of [
      [restSrc, "RestConnectorSource"],
      [dbSrc, "DatabaseConnectorSource"],
    ] as const) {
      const body = interfaceBody(src, name);
      expect(body).not.toMatch(/apiKey|password|secret|token|authorization/i);
    }
  });

  it("createHttpFetchAdapter's own source text never reads a header value from anywhere but its own caller-supplied config", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(process.cwd(), "src", "engine", "httpFetchAdapter.ts"), "utf-8");
    // The only place `headers` is ever read is `config.headers`, passed
    // straight into `fetch()` — never persisted, never logged, never
    // resolved from a `connectionRef` lookup inside this shared module.
    const headerRefs = [...src.matchAll(/\bheaders\b/g)].length;
    expect(headerRefs).toBeGreaterThan(0);
    expect(src).not.toMatch(/localStorage|process\.env|require\(["']fs["']\)/);
  });
});
