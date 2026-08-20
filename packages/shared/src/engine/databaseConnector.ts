/**
 * FVL-04.021 (hardened) — Generic READ-ONLY Database Connector.
 *
 * Generic connectivity only, never customer-specific business logic and
 * never a vendor-specific SQL dialect built in here. No SAP/Dynamics/etc.
 * business logic exists anywhere in this file.
 *
 * Session 9's own first pass exposed arbitrary configured SQL TEXT as
 * the primary, only model, relying entirely on keyword refusal
 * (`assertReadOnlyQuery()`) to keep it read-only. That is real defense,
 * but it is the wrong PRIMARY contract: a migration Mapping Profile
 * should never own free-form executable SQL as its normal source of
 * truth. The primary model now is a CONTROLLED source description —
 * `connectionRef` + `schema`/`table` + optional explicit `columns` +
 * an optional structured, non-executable filter — the same discipline
 * `fileConnector.ts`'s own `FileConnectorSource`/`RestConnectorSource`
 * already use (declarative configuration, never a customer-authored
 * expression). Raw SQL text is NOT eliminated (some real customer
 * migrations genuinely need a pre-approved SELECT/view a DBA already
 * wrote) but it now lives behind a DELIBERATELY separate, differently-
 * named "expert" boundary (`DatabaseExpertQuerySpec`/
 * `stageDatabaseExpertQuery`) that a mapping profile's own generic
 * field-mapping expressions can never reach — it is a connector-config
 * escape hatch, not the generic model every customer migration uses.
 *
 * Credentials are never handled by this layer. `connectionRef` is an
 * OPAQUE reference to a connection profile stored and resolved entirely
 * server-side — the real Tauri-backed driver adapter
 * (SQL Server/PostgreSQL/MySQL/MariaDB/Oracle/SQLite/ODBC) is
 * desktop-only and wired later via the injected `DatabaseAdapter`,
 * exactly the same dependency-injection discipline `fileConnector.ts`'s
 * own `readWorkbook` adapter already uses for XLSX — this shared-package
 * module never imports a database driver, and never sees a raw host,
 * port, username, or password. A genuinely working DISPOSABLE adapter
 * (`packages/shared/src/engine/sqliteTestAdapter.ts`, sql.js-backed, an
 * in-memory WASM SQLite engine — no native driver, no real customer
 * database ever touched) proves the CONTRACT itself is real, not merely
 * an unimplemented interface; it is test-only infrastructure, never
 * claimed to prove every vendor dialect.
 *
 * Read-only by construction, several ways: (1) `DatabaseAdapter` exposes
 * exactly four read capabilities (`listSchemas`/`listTables`/
 * `describeEntity`/`readPage`) — no write/update/delete method exists
 * anywhere on the contract, the same discipline `SourceConnector` itself
 * already enforces (FVL-04.013). (2) the primary `DatabaseConnectorSource`
 * model has no field through which a customer mapping could express a
 * write statement at all — there is nothing to "refuse" because nothing
 * executable is ever accepted. (3) the expert escape hatch keeps
 * `assertReadOnlyQuery()`'s structural keyword refusal for the one case
 * raw SQL text is still accepted.
 *
 * Every extracted row funnels through the SAME `stageRows()` staging
 * path CSV/XLSX/JSON/XML already use (`fileConnector.ts`) — one real
 * row-staging implementation, never a second one duplicated per
 * connector type.
 */
import type { ConnectorResult, SourceConnector } from "../schemas/connector";
import { connectorIdentity, stageRows, type StageOptions } from "./fileConnector";

// ======================================================= Part C2 =====
// The adapter contract: what a real driver-backed implementation must
// provide. `describeEntity()` reports ONLY what the adapter can
// genuinely determine from the real source — never inventing PK/FK/type
// metadata a driver doesn't actually expose.

export interface DatabaseColumnMetadata {
  name: string;
  /** The database's OWN declared type string (e.g. "INTEGER", "VARCHAR(50)",
   *  "TIMESTAMP") — never normalized/guessed into a FormuLab type here;
   *  that translation is the mapping profile's own later job. */
  declaredType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  /** 1-based position within a composite primary key (matching SQLite's
   *  own `PRAGMA table_info` `pk` column convention) — `undefined` when
   *  `isPrimaryKey` is false. */
  primaryKeyOrdinal?: number;
}

export interface DatabaseForeignKeyMetadata {
  fromColumns: string[];
  toSchema?: string;
  toTable: string;
  toColumns: string[];
}

export interface DatabaseEntityDescription {
  schema?: string;
  table: string;
  kind: "table" | "view";
  columns: DatabaseColumnMetadata[];
  foreignKeys: DatabaseForeignKeyMetadata[];
}

export interface DatabaseTableRef {
  schema?: string;
  table: string;
}

/** A deliberately narrow, non-executable filter — a column, a
 *  comparison operator, and a literal value. There is no way to express
 *  a raw expression, a subquery, or SQL injection through this shape;
 *  the adapter is responsible for parameterizing it safely against its
 *  own real driver, never string-concatenating it. */
export interface DatabaseSafeFilter {
  column: string;
  op: "eq" | "gt" | "gte" | "lt" | "lte";
  value: string;
}

export interface DatabaseTableSelector extends DatabaseTableRef {
  /** Explicit column selection — omitted means every column the
   *  adapter's own `describeEntity()` reports for this table. Never a
   *  customer-authored `SELECT *` string. */
  columns?: string[];
  filter?: DatabaseSafeFilter;
}

export interface DatabasePageRequest {
  selector: DatabaseTableSelector;
  pageSize: number;
  /** Opaque pagination cursor from a prior page — the adapter's own
   *  concern how to apply it (keyset on the primary key, offset,
   *  whatever the real driver supports), never guessed or
   *  string-concatenated by this layer. */
  cursor?: string;
}

export interface DatabasePageResult {
  columns: string[];
  rows: (string | null)[][];
  /** Opaque cursor for the next page, or `undefined` when this was the
   *  last page. */
  nextCursor?: string;
}

export interface DatabaseAdapter {
  listSchemas(): Promise<string[]>;
  listTables(schema?: string): Promise<(DatabaseTableRef & { kind: "table" | "view" })[]>;
  describeEntity(ref: DatabaseTableRef): Promise<DatabaseEntityDescription>;
  readPage(request: DatabasePageRequest): Promise<DatabasePageResult>;
}

export interface DatabaseConnectorDeps {
  adapter: DatabaseAdapter;
}

export interface DatabaseConnectorSource {
  connectionRef: string;
  /** entity name -> the table/view this connector reads for it — a
   *  controlled selector, never raw SQL. One selector per logical
   *  entity, never auto-discovered from schema introspection at
   *  extraction time; introspection (`describeEntity()`) informs a
   *  human/mapping-profile author, it does not drive extraction
   *  automatically. */
  entities: Record<string, DatabaseTableSelector>;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 500;
/** Mirrors `restApiConnector.ts`'s own safety cap discipline — a
 *  misbehaving adapter that never stops returning a `nextCursor` must
 *  not page this connector forever. */
const DEFAULT_MAX_PAGES = 500;

function refused(sourceSystemId: string, entity: string, code: string, message: string, retryable: boolean, detail?: string): ConnectorResult {
  return {
    connector: connectorIdentity(sourceSystemId, "DATABASE"),
    entity,
    records: [],
    warnings: [],
    errors: [{ code, stage: code === "read_failed" || code === "describe_failed" ? "extract" : "connect", message, retryable, ...(detail ? { detail } : {}) }],
    stats: { totalRecords: 0, readRecords: 0, errorRecords: 1 },
  };
}

/** Deterministic, unambiguous composite-key encoding (C4): each PK
 *  value is `encodeURIComponent`-escaped before joining, so a literal
 *  `"::"` can never appear INSIDE an escaped value (`encodeURIComponent`
 *  turns `:` into `%3A`) — two different PK tuples can never collide on
 *  the same encoded string merely because a raw value happened to
 *  contain the join separator. */
function encodeCompositeKey(values: string[]): string {
  return values.map((v) => encodeURIComponent(v)).join("::");
}

const SYNTHETIC_PK_FIELD = "__db_composite_pk__";

/**
 * Stages one entity's full extraction (following every page until the
 * adapter reports none), using the entity's own real primary-key
 * columns (via `describeEntity()`) to build a deterministic explicit
 * `sourceRecordId` for a composite key (C4), or falling back to the
 * existing ordinal staging identity when the table genuinely has no
 * primary key (C5) — never guessed, never invented.
 */
export async function stageDatabaseEntity(sourceSystemId: string, source: DatabaseConnectorSource, entity: string, opts: StageOptions, deps: DatabaseConnectorDeps): Promise<ConnectorResult> {
  const selector = source.entities[entity];
  if (!selector) return refused(sourceSystemId, entity, "entity_not_configured", `No table/view is configured for entity "${entity}".`, false);

  let description: DatabaseEntityDescription;
  try {
    description = await deps.adapter.describeEntity(selector);
  } catch (e) {
    return refused(sourceSystemId, entity, "describe_failed", "The configured table/view could not be described against the source database.", true, e instanceof Error ? e.constructor.name : "UnknownError");
  }
  const pkColumns = description.columns
    .filter((c) => c.isPrimaryKey)
    .sort((a, b) => (a.primaryKeyOrdinal ?? 0) - (b.primaryKeyOrdinal ?? 0))
    .map((c) => c.name);

  const pageSize = source.pageSize ?? DEFAULT_PAGE_SIZE;
  const allRows: string[][] = [];
  let headers: string[] | undefined;
  let cursor: string | undefined;
  let pagesFetched = 0;
  const warnings: { code: string; stage: "extract"; message: string; retryable: boolean }[] = [];

  for (;;) {
    let page: DatabasePageResult;
    try {
      page = await deps.adapter.readPage({ selector, pageSize, cursor });
    } catch (e) {
      return refused(sourceSystemId, entity, "read_failed", "The configured table/view could not be read from the source database.", true, e instanceof Error ? e.constructor.name : "UnknownError");
    }
    pagesFetched++;
    if (!headers) headers = page.columns;
    for (const row of page.rows) allRows.push(row.map((c) => c ?? ""));

    if (!page.nextCursor) break;
    if (pagesFetched >= DEFAULT_MAX_PAGES) {
      warnings.push({ code: "pagination_limit_reached", stage: "extract", message: `Stopped after ${DEFAULT_MAX_PAGES} pages — the source still reported more data available. Rows fetched so far are included; nothing beyond the limit was retried or fabricated.`, retryable: true });
      break;
    }
    cursor = page.nextCursor;
  }

  if (!headers) return refused(sourceSystemId, entity, "empty_result", "The table/view returned no columns — nothing to stage.", false);

  let rows: string[][];
  let idField: string | undefined;
  if (pkColumns.length > 0) {
    const pkIndexes = pkColumns.map((pk) => headers!.indexOf(pk));
    if (pkIndexes.every((i) => i >= 0)) {
      headers = [...headers, SYNTHETIC_PK_FIELD];
      rows = allRows.map((row) => [...row, encodeCompositeKey(pkIndexes.map((i) => row[i]))]);
      idField = SYNTHETIC_PK_FIELD;
    } else {
      rows = allRows;
    }
  } else {
    rows = allRows;
  }

  const staged = stageRows(sourceSystemId, entity, [headers, ...rows], { ...opts, idField: idField ?? opts.idField }, "DATABASE");
  // The synthetic composite-key column is staging plumbing only — never
  // a real source field a mapping profile should see or map from.
  if (idField) for (const record of staged.records) delete record.fields[SYNTHETIC_PK_FIELD];
  return { ...staged, warnings: [...staged.warnings, ...warnings] };
}

/**
 * A real `SourceConnector` implementation for generic databases — the
 * same shape `createFileConnector()`/`createRestApiConnector()` already
 * implement.
 */
export function createDatabaseConnector(sourceSystemId: string, source: DatabaseConnectorSource, opts: StageOptions, deps: DatabaseConnectorDeps): SourceConnector {
  const identity = connectorIdentity(sourceSystemId, "DATABASE");
  return {
    identity,
    async discoverEntities(): Promise<string[]> {
      return Object.keys(source.entities);
    },
    async extract(entity: string): Promise<ConnectorResult> {
      return stageDatabaseEntity(sourceSystemId, source, entity, opts, deps);
    },
  };
}

// =================================================== Expert boundary ===
// C1's own allowance: "If advanced pre-approved SELECT query support
// must remain: keep it behind a deliberately named expert/read-only
// adapter boundary, not as the only generic DB model." This is that
// boundary — a SEPARATE type family a mapping profile's own generic
// field-mapping configuration can never reach, reserved for a
// connector-level, human-approved, pre-written SELECT (e.g. a DBA's own
// reporting view a customer explicitly wants used as one entity's
// source). Never customer mapping expressions; never executed unless a
// human explicitly configured this exact query string at connector
// setup time.

const WRITE_KEYWORDS = ["INSERT", "UPDATE", "DELETE", "MERGE", "DROP", "ALTER", "CREATE", "TRUNCATE", "EXEC", "EXECUTE", "CALL", "GRANT", "REVOKE"] as const;

/**
 * Matches each statement's OWN LEADING keyword only, never a naive
 * substring search — a legitimate `SELECT ... WHERE description LIKE
 * '%update%'` must never be refused merely for containing the word
 * "update" inside a string literal or column name. Comments are
 * stripped first so a write keyword hidden inside `-- ...`/`/* ... *\/`
 * cannot smuggle past a naive check either.
 */
export function assertReadOnlyQuery(query: string): { ok: true } | { ok: false; error: string } {
  const stripped = query.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (stripped.length === 0) return { ok: false, error: "The query is empty." };
  const statements = stripped.split(";").map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    const firstWord = stmt.match(/^([A-Za-z]+)/)?.[1]?.toUpperCase();
    if (firstWord && (WRITE_KEYWORDS as readonly string[]).includes(firstWord)) {
      return { ok: false, error: `"${firstWord}" is a write statement — this connector is read-only by construction and refuses to execute it.` };
    }
  }
  return { ok: true };
}

export interface DatabaseExpertQuerySpec {
  connectionRef: string;
  query: string;
  entity: string;
}

export interface DatabaseExpertQueryResult {
  columns: string[];
  rows: (string | null)[][];
}

export interface DatabaseExpertQueryDeps {
  executeExpertQuery: (spec: DatabaseExpertQuerySpec) => Promise<DatabaseExpertQueryResult>;
}

function expertRowsFrom(result: DatabaseExpertQueryResult): string[][] {
  return [result.columns, ...result.rows.map((row) => row.map((cell) => cell ?? ""))];
}

export async function stageDatabaseExpertQuery(sourceSystemId: string, spec: DatabaseExpertQuerySpec, opts: StageOptions, deps: DatabaseExpertQueryDeps): Promise<ConnectorResult> {
  const guard = assertReadOnlyQuery(spec.query);
  if (!guard.ok) return refused(sourceSystemId, spec.entity, "write_query_refused", guard.error, false);

  let result: DatabaseExpertQueryResult;
  try {
    result = await deps.executeExpertQuery(spec);
  } catch (e) {
    return refused(sourceSystemId, spec.entity, "read_failed", "The configured query could not be executed against the source database.", true, e instanceof Error ? e.constructor.name : "UnknownError");
  }
  if (result.columns.length === 0) return refused(sourceSystemId, spec.entity, "empty_result", "The query returned no columns — nothing to stage.", false);
  return stageRows(sourceSystemId, spec.entity, expertRowsFrom(result), opts, "DATABASE");
}
