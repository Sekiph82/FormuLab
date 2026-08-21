/**
 * Connector Management frontend — the real, production `DatabaseAdapter`
 * (`packages/shared/src/engine/databaseConnector.ts`) for SQLite, backed
 * by the Rust `connector_sqlite` Tauri commands (`rusqlite`, opened
 * `SQLITE_OPEN_READ_ONLY`). This is the ONLY `DatabaseAdapter`
 * implementation ever wired into a real customer connection —
 * `packages/shared/src/engine/sqliteTestAdapter.ts` remains test/
 * acceptance-only, untouched, never imported here.
 *
 * SQLite is genuinely the only production database driver this build
 * supports (see `docs/CONNECTOR_MANAGEMENT_FRONTEND.md`): no other
 * vendor's driver crate is a dependency of this Tauri crate. The UI must
 * never offer a driver this adapter cannot back.
 */
import { isTauri } from "./tauri";
import type {
  DatabaseAdapter,
  DatabaseEntityDescription,
  DatabasePageRequest,
  DatabasePageResult,
  DatabaseTableRef,
} from "@formulab/shared";

interface SqliteTableRefWire {
  table: string;
  kind: string;
}
interface SqliteColumnMetadataWire {
  name: string;
  declaredType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  primaryKeyOrdinal?: number;
}
interface SqliteEntityDescriptionWire {
  table: string;
  kind: string;
  columns: SqliteColumnMetadataWire[];
  foreignKeys: { fromColumns: string[]; toTable: string; toColumns: string[] }[];
}
interface SqlitePageResultWire {
  columns: string[];
  rows: (string | null)[][];
  nextCursor?: string;
}

async function invokeSqlite<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error("The SQLite database adapter is only available in the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

/** Real, production `DatabaseAdapter` — `path` is the absolute local file
 *  path to the `.sqlite`/`.db` file (never a credential; a file-system
 *  location the operator picked, exactly like a FILE connection's own
 *  file selection). */
export function createSqliteAdapter(path: string): DatabaseAdapter {
  return {
    async listSchemas(): Promise<string[]> {
      // SQLite has no schema concept of its own (beyond ATTACHed
      // databases, which this adapter does not support) — genuinely one
      // implicit schema, never fabricated.
      return [];
    },
    async listTables(): Promise<(DatabaseTableRef & { kind: "table" | "view" })[]> {
      const rows = await invokeSqlite<SqliteTableRefWire[]>("connector_sqlite_list_tables", { path });
      return rows.map((r) => ({ table: r.table, kind: r.kind === "view" ? "view" : "table" }));
    },
    async describeEntity(ref: DatabaseTableRef): Promise<DatabaseEntityDescription> {
      const desc = await invokeSqlite<SqliteEntityDescriptionWire>("connector_sqlite_describe_table", { path, table: ref.table });
      return {
        table: desc.table,
        kind: desc.kind === "view" ? "view" : "table",
        columns: desc.columns.map((c) => ({
          name: c.name,
          declaredType: c.declaredType,
          nullable: c.nullable,
          isPrimaryKey: c.isPrimaryKey,
          ...(c.primaryKeyOrdinal !== undefined ? { primaryKeyOrdinal: c.primaryKeyOrdinal } : {}),
        })),
        foreignKeys: desc.foreignKeys.map((fk) => ({ fromColumns: fk.fromColumns, toTable: fk.toTable, toColumns: fk.toColumns })),
      };
    },
    async readPage(request: DatabasePageRequest): Promise<DatabasePageResult> {
      const result = await invokeSqlite<SqlitePageResultWire>("connector_sqlite_read_page", {
        path,
        table: request.selector.table,
        columns: request.selector.columns ?? null,
        filter: request.selector.filter ?? null,
        pageSize: request.pageSize,
        cursor: request.cursor ?? null,
      });
      return { columns: result.columns, rows: result.rows, ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
    },
  };
}
