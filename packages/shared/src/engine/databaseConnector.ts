/**
 * FVL-04.021 — Generic READ-ONLY Database Connector.
 *
 * Generic connectivity only, never customer-specific business logic and
 * never a vendor-specific SQL dialect built in here — a configured query
 * is whatever the caller's own source system's dialect produces; this
 * layer never generates or introspects SQL itself. No SAP/Dynamics/etc.
 * business logic exists anywhere in this file.
 *
 * Credentials are never handled by this layer. `DatabaseQuerySpec.
 * connectionRef` is an OPAQUE reference to a connection profile stored
 * and resolved entirely server-side — the real Tauri-backed adapter
 * (SQL Server/PostgreSQL/MySQL/MariaDB/Oracle/SQLite/ODBC drivers) is
 * desktop-only and wired later via the injected `executeQuery`, exactly
 * the same dependency-injection discipline `fileConnector.ts`'s own
 * `readWorkbook` adapter already uses for XLSX — this shared-package
 * module never imports a database driver, and never sees a raw host,
 * port, username, or password.
 *
 * Read-only by construction, two ways: (1) the `DatabaseConnectorDeps`
 * contract exposes exactly one capability, `executeQuery` — no write/
 * update/delete method exists anywhere on it, the same discipline
 * `SourceConnector` itself already enforces (FVL-04.013). (2)
 * `assertReadOnlyQuery()` structurally refuses a query whose own
 * statement keyword is write-shaped (INSERT/UPDATE/DELETE/MERGE/DROP/
 * ALTER/CREATE/TRUNCATE/EXEC/CALL/GRANT/REVOKE) BEFORE it is ever handed
 * to the injected adapter — a guarantee on top of whatever the real
 * database user's own grants already restrict, not a substitute for
 * them.
 *
 * Every extracted row funnels through the SAME `stageRows()` staging
 * path CSV/XLSX/JSON/XML already use (`fileConnector.ts`) — one real
 * row-staging implementation, never a second one duplicated per
 * connector type.
 */
import type { ConnectorResult, SourceConnector } from "../schemas/connector";
import { connectorIdentity, stageRows, type StageOptions } from "./fileConnector";

const WRITE_KEYWORDS = ["INSERT", "UPDATE", "DELETE", "MERGE", "DROP", "ALTER", "CREATE", "TRUNCATE", "EXEC", "EXECUTE", "CALL", "GRANT", "REVOKE"] as const;

/**
 * Matches each statement's OWN LEADING keyword only, never a naive
 * substring search — a legitimate `SELECT ... WHERE description LIKE
 * '%update%'` must never be refused merely for containing the word
 * "update" inside a string literal or column name. Comments are
 * stripped first so a write keyword hidden inside `-- ...`/`/* ... *\/`
 * cannot smuggle past a naive check either (it is stripped, so it
 * cannot BECOME the leading keyword of a real statement).
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

export interface DatabaseQuerySpec {
  connectionRef: string;
  query: string;
  entity: string;
}

export interface DatabaseQueryResult {
  columns: string[];
  rows: (string | null)[][];
}

export interface DatabaseConnectorDeps {
  /** The real adapter — a desktop-only Tauri command backed by a real
   *  database driver, wired later. Executes exactly the configured
   *  query, read-only, against the connection `connectionRef` resolves
   *  to. Never receives a raw credential from this layer. */
  executeQuery: (spec: DatabaseQuerySpec) => Promise<DatabaseQueryResult>;
}

export interface DatabaseConnectorSource {
  connectionRef: string;
  /** entity name -> the exact SELECT/view this connector executes for
   *  it. One configured query per logical entity, never auto-discovered
   *  or guessed from schema introspection — a customer's own DBA
   *  decides what a "materials" or "recipes" query means for their
   *  database, this layer never infers it. */
  queries: Record<string, string>;
}

function rowsFrom(result: DatabaseQueryResult): string[][] {
  return [result.columns, ...result.rows.map((row) => row.map((cell) => cell ?? ""))];
}

function refused(sourceSystemId: string, entity: string, code: string, message: string, retryable: boolean, detail?: string): ConnectorResult {
  return {
    connector: connectorIdentity(sourceSystemId, "DATABASE"),
    entity,
    records: [],
    warnings: [],
    errors: [{ code, stage: code === "query_failed" ? "extract" : "connect", message, retryable, ...(detail ? { detail } : {}) }],
    stats: { totalRecords: 0, readRecords: 0, errorRecords: 1 },
  };
}

/**
 * Stages one query's result set into `StagedSourceRecord`s. Never called
 * with a write-shaped query (refused first); never leaks the injected
 * adapter's own raw exception text — the same sanitized-parse-error
 * discipline `stageFile()` already applies to XLSX.
 */
export async function stageDatabaseQuery(sourceSystemId: string, spec: DatabaseQuerySpec, opts: StageOptions, deps: DatabaseConnectorDeps): Promise<ConnectorResult> {
  const guard = assertReadOnlyQuery(spec.query);
  if (!guard.ok) return refused(sourceSystemId, spec.entity, "write_query_refused", guard.error, false);

  let result: DatabaseQueryResult;
  try {
    result = await deps.executeQuery(spec);
  } catch (e) {
    return refused(sourceSystemId, spec.entity, "query_failed", "The configured query could not be executed against the source database.", true, e instanceof Error ? e.constructor.name : "UnknownError");
  }
  if (result.columns.length === 0) {
    return refused(sourceSystemId, spec.entity, "empty_result", "The query returned no columns — nothing to stage.", false);
  }
  return stageRows(sourceSystemId, spec.entity, rowsFrom(result), opts, "DATABASE");
}

/**
 * A real `SourceConnector` implementation for generic databases — the
 * same shape `createFileConnector()` already implements for files, so
 * the common connector contract is something a DATABASE source
 * genuinely implements too, not merely FILE's own private concern.
 */
export function createDatabaseConnector(sourceSystemId: string, source: DatabaseConnectorSource, opts: StageOptions, deps: DatabaseConnectorDeps): SourceConnector {
  const identity = connectorIdentity(sourceSystemId, "DATABASE");
  return {
    identity,
    async discoverEntities(): Promise<string[]> {
      return Object.keys(source.queries);
    },
    async extract(entity: string): Promise<ConnectorResult> {
      const query = source.queries[entity];
      if (!query) return refused(sourceSystemId, entity, "entity_not_configured", `No query is configured for entity "${entity}".`, false);
      return stageDatabaseQuery(sourceSystemId, { connectionRef: source.connectionRef, query, entity }, opts, deps);
    },
  };
}
