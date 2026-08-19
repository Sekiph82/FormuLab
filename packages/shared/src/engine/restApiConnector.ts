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
  /** The real adapter — a desktop-only HTTP client wired later, with
   *  auth already applied from `connectionRef`. Never receives a raw
   *  credential from this layer. */
  fetchPage: (spec: RestRequestSpec) => Promise<RestResponsePage>;
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

  for (;;) {
    let page: RestResponsePage;
    try {
      page = await deps.fetchPage({ connectionRef: source.connectionRef, entity, path, cursor });
    } catch (e) {
      return refused(sourceSystemId, entity, "fetch_failed", "The configured REST endpoint could not be reached or returned a genuine failure.", true, e instanceof Error ? e.constructor.name : "UnknownError");
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
