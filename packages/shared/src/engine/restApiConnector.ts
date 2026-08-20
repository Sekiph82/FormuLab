/**
 * FVL-04.022 — REST API Connector Contract.
 *
 * Generic REST extraction through the SAME connector contract every
 * other connector type already implements (`SourceConnector`,
 * FVL-04.013) — endpoint/entity configuration, pagination, an
 * authentication REFERENCE (never a raw credential), incremental
 * cursors where the source exposes one, structured error/retry
 * semantics, source identity, and raw-response lineage via the
 * existing `SourceLineage`/`ExtractionMetadata` shapes. No vendor-
 * specific API implementation exists here — `RestConnectorSource.
 * endpoints` is caller-configured paths only, never a hardcoded
 * SAP/Dynamics/etc. integration.
 *
 * Auth is deliberately NOT modeled as a request-shaping concern in this
 * shared-package layer: `connectionRef` is an opaque reference to a
 * connection profile (API key / Basic / OAuth2 client-credentials —
 * whichever mechanism a later implementation actually needs) resolved
 * and applied entirely server-side by the desktop-only `fetchPage`
 * adapter, the same dependency-injection discipline `fileConnector.ts`'s
 * `readWorkbook` and `databaseConnector.ts`'s `executeQuery` already
 * use — this module never sees a raw API key, bearer token, or
 * password, and never issues an HTTP request itself.
 *
 * Every page's body is staged through the SAME `stageJsonFile()`
 * flattening/staging logic the generic FILE connector's own JSON
 * support already uses (bare-array or `{items:[...]}` shapes) — one
 * real JSON-staging implementation, never a second one duplicated for
 * REST.
 */
import type { ConnectorError, ConnectorResult, SourceConnector, StagedSourceRecord } from "../schemas/connector";
import { connectorIdentity, stageJsonFile, type StageOptions } from "./fileConnector";

export interface RestRequestSpec {
  connectionRef: string;
  entity: string;
  /** The configured endpoint path for this entity, e.g.
   *  `"/api/v1/materials"` — caller-configured, never guessed. */
  path: string;
  /** Opaque pagination/incremental cursor from a prior page. Never
   *  string-concatenated into a URL by this layer — applying it
   *  correctly (a query param, a header, an offset) is the injected
   *  adapter's own job, since that convention is entirely API-specific. */
  cursor?: string;
}

export interface RestResponsePage {
  /** The raw JSON response body TEXT for this page — reuses
   *  `stageJsonFile()`'s existing shape detection, never a second one. */
  bodyText: string;
  /** Opaque cursor for the NEXT page, or `undefined` when this was the
   *  last page. Never derived/guessed by this layer. */
  nextCursor?: string;
}

export interface RestConnectorDeps {
  /** The real adapter — see `createHttpFetchAdapter()` for the genuine
   *  GET-only `fetch()`-backed implementation, or a test double. Auth is
   *  already applied from `connectionRef` before this function is ever
   *  called; this layer never sees a raw credential. An adapter SHOULD
   *  throw `HttpStatusError` for a real non-2xx HTTP response so
   *  `stageRestEntity` can classify retryable-vs-not correctly (D7) —
   *  any other thrown error is treated as a network-level failure and
   *  conservatively assumed retryable. */
  fetchPage: (spec: RestRequestSpec) => Promise<RestResponsePage>;
}

/**
 * FVL-04.022 hardening (Part D7) — thrown by a real HTTP adapter to
 * carry the ACTUAL response status so `stageRestEntity` classifies
 * retryable-vs-not correctly, instead of every adapter failure being
 * uniformly (and often wrongly) marked retryable. `retryableForStatus()`
 * is the one real authority for the classification table — 200s never
 * reach here at all (a real 2xx response is not an error); 400/401/403/
 * 404 are non-retryable (a different request would be needed, retrying
 * the identical one cannot succeed); 408/429/5xx are retryable
 * (transient — a timeout, rate limit, or server-side hiccup). */
export class HttpStatusError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
    this.retryable = retryableForStatus(status);
  }
}

export function retryableForStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  return false;
}

export interface RestConnectorSource {
  connectionRef: string;
  /** entity name -> the configured endpoint path for it. */
  endpoints: Record<string, string>;
  /** Safety cap on pages fetched per `extract()` call — a misbehaving
   *  (or malicious) API that never stops returning a `nextCursor` must
   *  not keep this connector paging forever. Default 500. */
  maxPages?: number;
}

const DEFAULT_MAX_PAGES = 500;

function refused(sourceSystemId: string, entity: string, code: string, message: string, retryable: boolean, detail?: string): ConnectorResult {
  return {
    connector: connectorIdentity(sourceSystemId, "REST_API"),
    entity,
    records: [],
    warnings: [],
    errors: [{ code, stage: "extract", message, retryable, ...(detail ? { detail } : {}) }],
    stats: { totalRecords: 0, readRecords: 0, errorRecords: 1 },
  };
}

/**
 * Fetches and stages every page for one entity, following `nextCursor`
 * until the adapter reports none (or `maxPages` is reached). Never
 * leaks a raw adapter exception's own text — the same sanitized-error
 * discipline `stageFile()`/`databaseConnector.ts` already apply.
 */
export async function stageRestEntity(sourceSystemId: string, source: RestConnectorSource, entity: string, opts: StageOptions, deps: RestConnectorDeps): Promise<ConnectorResult> {
  const path = source.endpoints[entity];
  if (!path) return refused(sourceSystemId, entity, "entity_not_configured", `No endpoint is configured for entity "${entity}".`, false);

  const maxPages = source.maxPages ?? DEFAULT_MAX_PAGES;
  const records: StagedSourceRecord[] = [];
  const errors: ConnectorError[] = [];
  const warnings: ConnectorError[] = [];
  let cursor: string | undefined;
  let pagesFetched = 0;
  let totalRecords = 0;
  // FVL-04.022 hardening (Part D6) — a set of every cursor value already
  // consumed. If an adapter's own `nextCursor` ever repeats a cursor
  // this loop already used, that is a genuine pagination bug/loop, never
  // relied on `maxPages` alone to eventually catch it.
  const seenCursors = new Set<string>();

  for (;;) {
    let page: RestResponsePage;
    try {
      page = await deps.fetchPage({ connectionRef: source.connectionRef, entity, path, cursor });
    } catch (e) {
      const retryable = e instanceof HttpStatusError ? e.retryable : true;
      const detail = e instanceof HttpStatusError ? `HTTP ${e.status}` : e instanceof Error ? e.constructor.name : "UnknownError";
      return refused(sourceSystemId, entity, "fetch_failed", "The configured REST endpoint could not be reached or returned a genuine failure.", retryable, detail);
    }
    pagesFetched++;

    const pageResult = stageJsonFile(sourceSystemId, entity, page.bodyText, { ...opts, extractionRunId: opts.extractionRunId }, "REST_API");
    // Offset every subsequent page's ordinal-fallback identity so two
    // pages never collide on the same staging-only ordinal position —
    // real identity (a configured `idField` upstream of this layer,
    // applied by `toStaged` via `opts`) is unaffected either way.
    records.push(...pageResult.records);
    errors.push(...pageResult.errors);
    warnings.push(...pageResult.warnings);
    totalRecords += pageResult.stats.totalRecords;

    if (!page.nextCursor) break;
    if (seenCursors.has(page.nextCursor)) {
      warnings.push({ code: "pagination_loop", stage: "extract", message: `The source repeated a cursor value ("${page.nextCursor}") already used earlier in this extraction — stopped to avoid an infinite loop. Records fetched so far are included.`, retryable: false });
      break;
    }
    seenCursors.add(page.nextCursor);
    if (pagesFetched >= maxPages) {
      warnings.push({ code: "pagination_limit_reached", stage: "extract", message: `Stopped after ${maxPages} pages — the source still reported more data available. Records fetched so far are included; nothing beyond the limit was retried or fabricated.`, retryable: true });
      break;
    }
    cursor = page.nextCursor;
  }

  // Each page was staged independently, so a record with no configured
  // `idField` got an ORDINAL identity relative to its OWN page (position
  // 1, 2, 3... within that page's array) — page 2's first record would
  // collide with page 1's first record on the same ordinal
  // `sourceRecordId` otherwise. Multi-page REST extraction is
  // conceptually ONE staging run split across HTTP pages, so when no
  // `idField` was configured, ordinal identities are renumbered here to
  // be unique across the WHOLE merged batch — a record with a real
  // configured external ID (`idSource: "configured"`) is never touched.
  if (!opts.idField) {
    records.forEach((record, i) => {
      if (record.identity.idSource !== "ordinal") return;
      const renumbered = String(i + 1);
      record.identity.sourceRecordId = renumbered;
      record.lineage.sourceRecordId = renumbered;
    });
  }

  return {
    connector: connectorIdentity(sourceSystemId, "REST_API"),
    entity,
    records,
    warnings,
    errors,
    stats: { totalRecords, readRecords: records.length, errorRecords: errors.length },
  };
}

/**
 * A real `SourceConnector` implementation for generic REST APIs — the
 * same shape `createFileConnector()`/`createDatabaseConnector()` already
 * implement.
 */
export function createRestApiConnector(sourceSystemId: string, source: RestConnectorSource, opts: StageOptions, deps: RestConnectorDeps): SourceConnector {
  const identity = connectorIdentity(sourceSystemId, "REST_API");
  return {
    identity,
    async discoverEntities(): Promise<string[]> {
      return Object.keys(source.endpoints);
    },
    async extract(entity: string): Promise<ConnectorResult> {
      return stageRestEntity(sourceSystemId, source, entity, opts, deps);
    },
  };
}
