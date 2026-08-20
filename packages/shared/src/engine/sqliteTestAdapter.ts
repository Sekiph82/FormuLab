/**
 * FVL-04.021 hardening (Part C3) — a genuinely working DISPOSABLE
 * `DatabaseAdapter` implementation (`databaseConnector.ts`), backed by
 * sql.js (an in-memory WASM build of real SQLite — no native driver, no
 * compiled addon, works identically on every CI/dev platform this
 * repository already targets). This is TEST/ACCEPTANCE infrastructure
 * only: it proves the `DatabaseAdapter` contract is genuinely
 * implementable end-to-end against a real relational engine (schema
 * introspection, declared types, PK/FK metadata including composite
 * keys, real paging) — it does not prove every vendor SQL dialect, and
 * it must never be wired into a real customer connection.
 *
 * `createSqliteTestAdapter(setupSql)` runs `setupSql` ONCE, synchronously,
 * to build disposable fixture tables/rows — that is the ONLY place this
 * module ever executes non-SELECT SQL, and it is entirely internal to
 * fixture construction. The returned `adapter` object itself exposes
 * only the four read-only `DatabaseAdapter` methods; every SQL statement
 * `readPage()`/`describeEntity()`/`listTables()` construct internally is
 * hardcoded to a SELECT/PRAGMA shape built from structured selector
 * fields — there is no code path through the adapter's own public
 * surface that can execute INSERT/UPDATE/DELETE/DDL (C7).
 */
import initSqlJsFactory, { type Database, type SqlJsStatic } from "sql.js";
import type { DatabaseAdapter, DatabaseEntityDescription, DatabaseForeignKeyMetadata, DatabasePageRequest, DatabasePageResult, DatabaseTableRef } from "./databaseConnector";

let sqlJsPromise: Promise<SqlJsStatic> | undefined;
function loadSqlJs(): Promise<SqlJsStatic> {
  sqlJsPromise ??= initSqlJsFactory();
  return sqlJsPromise;
}

/** Wraps an identifier in double quotes, doubling any internal quote —
 *  the standard SQL identifier-escaping rule. Safe here because every
 *  identifier this adapter ever quotes comes from ITS OWN structured
 *  config (`DatabaseTableSelector`/`DatabaseSafeFilter`) or from the
 *  database's own `sqlite_master`/`PRAGMA` output — never raw
 *  customer-supplied free text concatenated into a query string. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function opToSql(op: "eq" | "gt" | "gte" | "lt" | "lte"): string {
  switch (op) {
    case "eq":
      return "=";
    case "gt":
      return ">";
    case "gte":
      return ">=";
    case "lt":
      return "<";
    case "lte":
      return "<=";
  }
}

export interface SqliteTestAdapterHandle {
  adapter: DatabaseAdapter;
  /** For a test's own fixture assertions ONLY (e.g. counting rows
   *  outside the adapter's own read path) — never used by production
   *  connector code, which only ever sees `adapter`. */
  close: () => void;
}

/** `setupSql` may contain multiple `;`-separated statements (CREATE
 *  TABLE, INSERT, ...) — building disposable fixtures, the one
 *  permitted non-SELECT use in this whole module. */
export async function createSqliteTestAdapter(setupSql: string): Promise<SqliteTestAdapterHandle> {
  const SQL = await loadSqlJs();
  const db: Database = new SQL.Database();
  db.run(setupSql);

  const adapter: DatabaseAdapter = {
    async listSchemas() {
      // SQLite has one implicit schema ("main") unless a caller ATTACHes
      // another database file — genuinely reported, never fabricated
      // multi-schema support this adapter doesn't have.
      return ["main"];
    },

    async listTables(): Promise<(DatabaseTableRef & { kind: "table" | "view" })[]> {
      const res = db.exec("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'");
      if (res.length === 0) return [];
      return res[0].values.map(([name, type]) => ({ table: String(name), kind: type === "view" ? ("view" as const) : ("table" as const) }));
    },

    async describeEntity(ref: DatabaseTableRef): Promise<DatabaseEntityDescription> {
      const infoRes = db.exec(`PRAGMA table_info(${quoteIdent(ref.table)})`);
      const columns = infoRes.length
        ? infoRes[0].values.map((row) => {
            const pkOrdinal = Number(row[5]);
            return {
              name: String(row[1]),
              declaredType: String(row[2]),
              nullable: Number(row[3]) === 0,
              isPrimaryKey: pkOrdinal > 0,
              ...(pkOrdinal > 0 ? { primaryKeyOrdinal: pkOrdinal } : {}),
            };
          })
        : [];

      const fkRes = db.exec(`PRAGMA foreign_key_list(${quoteIdent(ref.table)})`);
      const foreignKeys: DatabaseForeignKeyMetadata[] = [];
      if (fkRes.length) {
        // Real SQLite reports one row PER COLUMN of a composite FK, all
        // sharing the same `id` — grouped back into one
        // DatabaseForeignKeyMetadata per real foreign key, never one
        // per column.
        const byId = new Map<number, { toTable: string; from: string[]; to: string[] }>();
        for (const row of fkRes[0].values) {
          const id = Number(row[0]);
          const toTable = String(row[2]);
          const from = String(row[3]);
          const to = String(row[4]);
          const entry = byId.get(id) ?? { toTable, from: [], to: [] };
          entry.from.push(from);
          entry.to.push(to);
          byId.set(id, entry);
        }
        for (const entry of byId.values()) foreignKeys.push({ fromColumns: entry.from, toTable: entry.toTable, toColumns: entry.to });
      }

      const kindRes = db.exec("SELECT type FROM sqlite_master WHERE name = ?", [ref.table]);
      const kind = kindRes.length && kindRes[0].values[0]?.[0] === "view" ? "view" : "table";

      return { table: ref.table, kind, columns, foreignKeys };
    },

    async readPage(request: DatabasePageRequest): Promise<DatabasePageResult> {
      const { selector, pageSize } = request;
      const offset = request.cursor ? Number(request.cursor) : 0;
      const columnsSql = selector.columns && selector.columns.length > 0 ? selector.columns.map(quoteIdent).join(", ") : "*";
      let sql = `SELECT ${columnsSql} FROM ${quoteIdent(selector.table)}`;
      const params: (string | number)[] = [];
      if (selector.filter) {
        sql += ` WHERE ${quoteIdent(selector.filter.column)} ${opToSql(selector.filter.op)} ?`;
        params.push(selector.filter.value);
      }
      // Request one extra row so real "is there another page" can be
      // answered exactly — never a heuristic guess from "did we get a
      // full page" (which is ambiguous exactly on a source whose total
      // row count is a multiple of pageSize).
      sql += " LIMIT ? OFFSET ?";
      params.push(pageSize + 1, offset);

      const stmt = db.prepare(sql);
      stmt.bind(params);
      const rawRows: Record<string, unknown>[] = [];
      let columns: string[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        if (columns.length === 0) columns = Object.keys(row);
        rawRows.push(row);
      }
      stmt.free();

      const hasNextPage = rawRows.length > pageSize;
      const pageRows = (hasNextPage ? rawRows.slice(0, pageSize) : rawRows).map((row) => columns.map((c) => (row[c] === null || row[c] === undefined ? null : String(row[c]))));

      return { columns, rows: pageRows, ...(hasNextPage ? { nextCursor: String(offset + pageSize) } : {}) };
    },
  };

  return { adapter, close: () => db.close() };
}
