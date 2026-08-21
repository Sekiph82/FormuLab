/**
 * Connector Management frontend — real SQLite source inspection for the
 * Source Explorer, wired to the actual `createSqliteAdapter()`/
 * `createDatabaseConnector()`/`discoverSourceSchema()` engines (Section
 * 7). Mirrors `connectorFileInspect.ts`'s own shape so Source Explorer
 * can render DATABASE results through the SAME generic Schema/Sample
 * Records/Identity cards FILE already uses, plus a DATABASE-specific
 * table/column metadata view this module also provides.
 */
import { createDatabaseConnector, discoverSourceSchema, type ConnectorConnection, type ConnectorResult, type DatabaseEntityDescription, type SourceSchema } from "@formulab/shared";
import { createSqliteAdapter } from "./connectorDatabaseSqlite";

export interface DatabaseTableOption {
  table: string;
  kind: "table" | "view";
}

/** DBUI2 — real table/view discovery against the actual database file. */
export async function listDatabaseTables(connection: ConnectorConnection): Promise<DatabaseTableOption[]> {
  if (!connection.database) return [];
  return createSqliteAdapter(connection.database).listTables();
}

/** DBUI3/DBUI4/DBUI5/DBUI6 — real PK/composite-PK/FK/type/nullable
 *  metadata for one table, exactly as the database itself reports it. */
export async function describeDatabaseTable(connection: ConnectorConnection, table: string): Promise<DatabaseEntityDescription> {
  if (!connection.database) throw new Error("No SQLite database file is configured yet.");
  return createSqliteAdapter(connection.database).describeEntity({ table });
}

export interface DatabaseInspectResult {
  ok: boolean;
  message: string;
  description?: DatabaseEntityDescription;
  schema?: SourceSchema;
  staged?: ConnectorResult;
}

/** DBUI7/DBUI8/DBUI9/DBUI10 — a real, bounded extraction (one page,
 *  `pageSize` capped) through the SAME production `createDatabaseConnector()`
 *  the Prepare Import flow itself uses, feeding the same generic
 *  `discoverSourceSchema()` FILE/REST already feed. Read-only — no
 *  source mutation occurs anywhere in this path. */
export async function inspectDatabaseTable(
  connection: ConnectorConnection,
  table: string,
  opts: { idField?: string; requireExplicitId?: boolean } = {},
): Promise<DatabaseInspectResult> {
  if (!connection.database) return { ok: false, message: "No SQLite database file is configured yet." };
  try {
    const description = await describeDatabaseTable(connection, table);
    const adapter = createSqliteAdapter(connection.database);
    const connector = createDatabaseConnector(
      connection.sourceSystemId,
      { connectionRef: "", entities: { [table]: { table } }, pageSize: 50 },
      { extractionRunId: `explore-${Date.now()}`, extractedAt: new Date().toISOString(), ...opts },
      { adapter },
    );
    const staged = await connector.extract(table);
    if (staged.errors.length > 0) return { ok: false, message: staged.errors[0].message, description };
    const schema = discoverSourceSchema(connection.sourceSystemId, [{ entity: table, records: staged.records }]);
    return { ok: true, message: `Read ${staged.records.length} row(s) from "${table}".`, description, schema, staged };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not read this table." };
  }
}
