/**
 * FVL-04.022 hardening (Part D) — a real, GET-only HTTP adapter
 * implementing `RestConnectorDeps.fetchPage` (`restApiConnector.ts`)
 * with actual `fetch()` requests, declarative pagination models, and
 * real HTTP status classification. This is the concrete adapter the
 * REST connector's own seam was always meant to be filled by — Session
 * 9's `fetchPage` was a real, useful injection point, but nothing ever
 * implemented it against a genuine HTTP request/response; every
 * acceptance test injected a hand-built `RestResponsePage` directly,
 * bypassing request construction and status handling entirely.
 *
 * GET-only, structurally: the `fetch()` call below hardcodes
 * `method: "GET"` — there is no configuration field anywhere on
 * `HttpFetchAdapterConfig` through which a caller could request POST/
 * PUT/PATCH/DELETE, and this module exports no second function that
 * could issue one either (D1).
 *
 * Auth headers are supplied already-resolved via `config.headers` —
 * this module never resolves `connectionRef` itself (that stays the
 * desktop-only caller's job, exactly like every other connector
 * adapter in this codebase) and never persists/logs a header value.
 * `sanitizeUrl()` strips query parameter VALUES before a URL is ever
 * included in a structured error (D8) — even though this generic
 * model keeps secrets out of query params by design, a misconfigured
 * connector could still put something sensitive-looking there, and the
 * error path never trusts that assumption.
 */
import { HttpStatusError, type RestRequestSpec, type RestResponsePage } from "./restApiConnector";

export type RestPaginationConfig =
  | { kind: "none" }
  | { kind: "page"; pageParam: string; pageSizeParam: string; pageSize: number; startPage?: number }
  | { kind: "offset"; offsetParam: string; limitParam: string; limit: number }
  | { kind: "cursor"; cursorParam: string; nextCursorPath: string };

export interface HttpFetchAdapterConfig {
  baseUrl: string;
  /** Already-resolved request headers (auth included) — this adapter
   *  never resolves `connectionRef` itself. */
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  pagination?: RestPaginationConfig;
  /** Dot path to the record array within the response body — e.g.
   *  `"payload.records"`. Omitted: the bare-array/`items`/`data`
   *  detection `stageJsonFile()` already performs handles it generically
   *  once the body reaches staging; this path is used HERE only to
   *  determine the page/offset "did we get a full page" heuristic and,
   *  for `cursor` pagination, to extract `nextCursorPath`. */
  recordArrayPath?: string;
  /** Session 11 hardening (Part 5A) — milliseconds before a request is
   *  aborted client-side via `AbortController`. A hung source (or a
   *  connection that silently drops) must never block extraction
   *  forever. Default 30000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30000;

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function getByPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), value);
}

function recordArrayFrom(parsed: unknown, path?: string): unknown[] {
  if (path) {
    const at = getByPath(parsed, path);
    return Array.isArray(at) ? at : [];
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    for (const v of Object.values(parsed as Record<string, unknown>)) if (Array.isArray(v)) return v;
  }
  return [];
}

/** Strips query parameter VALUES (keeps parameter NAMES, for
 *  debuggability) before a URL is ever included in a structured error —
 *  D8's own "sanitize URLs before including them in errors/lineage". */
function sanitizeUrl(url: URL): string {
  const clean = new URL(url.toString());
  for (const key of [...clean.searchParams.keys()]) clean.searchParams.set(key, "[redacted]");
  return clean.toString();
}

function buildUrl(spec: RestRequestSpec, config: HttpFetchAdapterConfig, pageState: { page?: number; offset?: number }): URL {
  const url = new URL(spec.path, config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`);
  for (const [k, v] of Object.entries(config.queryParams ?? {})) url.searchParams.set(k, v);
  const pagination = config.pagination ?? { kind: "none" as const };
  if (pagination.kind === "page" && pageState.page !== undefined) {
    url.searchParams.set(pagination.pageParam, String(pageState.page));
    url.searchParams.set(pagination.pageSizeParam, String(pagination.pageSize));
  } else if (pagination.kind === "offset" && pageState.offset !== undefined) {
    url.searchParams.set(pagination.offsetParam, String(pageState.offset));
    url.searchParams.set(pagination.limitParam, String(pagination.limit));
  } else if (pagination.kind === "cursor" && spec.cursor !== undefined) {
    url.searchParams.set(pagination.cursorParam, spec.cursor);
  }
  return url;
}

/**
 * `spec.cursor` (the connector's own opaque pagination token, threaded
 * through `RestRequestSpec` unchanged) carries EITHER a page number
 * (`"page" pagination), an offset (`"offset"` pagination), or the raw
 * next-cursor value the source itself returned (`"cursor"` pagination)
 * — this adapter is the only thing that knows which, based on its own
 * `config.pagination.kind`; the generic connector layer never interprets
 * `cursor`'s meaning itself (`restApiConnector.ts`'s own doc comment).
 */
export function createHttpFetchAdapter(config: HttpFetchAdapterConfig): (spec: RestRequestSpec) => Promise<RestResponsePage> {
  const pagination = config.pagination ?? { kind: "none" as const };

  return async function fetchPage(spec: RestRequestSpec): Promise<RestResponsePage> {
    const pageState: { page?: number; offset?: number } = {};
    if (pagination.kind === "page") pageState.page = spec.cursor !== undefined ? Number(spec.cursor) : (pagination.startPage ?? 1);
    if (pagination.kind === "offset") pageState.offset = spec.cursor !== undefined ? Number(spec.cursor) : 0;

    const url = buildUrl(spec, config, pageState);

    // Session 11 hardening (Part 5A) — a hung/dropped source can never
    // block extraction forever. `HttpStatusError(408, ...)` reuses the
    // EXISTING retryable classification (`retryableForStatus(408)` is
    // already true) rather than inventing a second retry-signal shape.
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      // GET-only — hardcoded, never configurable. No request body is
      // ever sent; a source mutation method (POST/PUT/PATCH/DELETE) has
      // no code path anywhere in this adapter.
      response = await fetch(url, { method: "GET", headers: config.headers, signal: controller.signal });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new HttpStatusError(408, `Request to ${sanitizeUrl(url)} timed out after ${timeoutMs}ms`);
      }
      throw new Error(`Network error reaching ${sanitizeUrl(url)}: ${e instanceof Error ? e.constructor.name : "UnknownError"}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new HttpStatusError(response.status, `HTTP ${response.status} from ${sanitizeUrl(url)}`);
    }

    const rawBodyText = await response.text();
    // D3 — an explicit `recordArrayPath` extracts exactly that array and
    // returns it as a bare-array body, so the EXISTING `stageJsonFile()`
    // detection (bare array / `items` / `data`) handles it generically —
    // never a second nested-path staging implementation, and never a
    // guess at arbitrary nesting beyond the one path the caller
    // explicitly configured.
    const bodyText = config.recordArrayPath ? JSON.stringify(recordArrayFrom(safeParse(rawBodyText), config.recordArrayPath)) : rawBodyText;

    let nextCursor: string | undefined;
    if (pagination.kind === "page") {
      const count = recordArrayFrom(safeParse(rawBodyText), config.recordArrayPath).length;
      // Heuristic, disclosed: a page returning fewer records than the
      // configured page size is treated as the last page — the same
      // convention most real page/pageSize REST APIs actually use. A
      // source whose total count happens to be an exact multiple of
      // pageSize will issue one extra (empty) request; that request
      // returns 0 records and correctly stops there, never fabricating
      // data or looping.
      if (count >= pagination.pageSize) nextCursor = String((pageState.page ?? pagination.startPage ?? 1) + 1);
    } else if (pagination.kind === "offset") {
      const count = recordArrayFrom(safeParse(rawBodyText), config.recordArrayPath).length;
      if (count >= pagination.limit) nextCursor = String((pageState.offset ?? 0) + pagination.limit);
    } else if (pagination.kind === "cursor") {
      const parsed = safeParse(rawBodyText);
      if (parsed !== undefined) {
        const next = getByPath(parsed, pagination.nextCursorPath);
        if (typeof next === "string" && next.length > 0) nextCursor = next;
      } else {
        nextCursor = undefined;
      }
    }

    return { bodyText, ...(nextCursor ? { nextCursor } : {}) };
  };
}
