/**
 * Connector Management frontend — real "Test Connection" / "Discover
 * Schema" actions, wired to the ACTUAL connector engines (never a
 * simulated success). FILE and REST_API genuinely execute; DATABASE
 * honestly reports the current limitation rather than faking a result
 * — see `docs/CONNECTOR_MANAGEMENT_FRONTEND.md` for why: the
 * `DatabaseAdapter` contract is real and tested, but no production
 * driver implementation exists anywhere in this desktop app today (the
 * only real implementation, `sqliteTestAdapter.ts`, is explicitly
 * documented as test/acceptance-only and must never back a real
 * customer connection).
 */
import {
  createHttpFetchAdapter,
  createRestApiConnector,
  discoverSourceSchema,
  httpFetchConfigFromConnection,
  restSourceFromConnection,
  type ConnectorConnection,
  type ConnectorResult,
  type SourceSchema,
} from "@formulab/shared";
import { createSqliteAdapter } from "./connectorDatabaseSqlite";

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  schema?: SourceSchema;
  sampleRecordCount?: number;
  /** Section 9 — the real bounded staged result from this one-page
   *  round trip (never a second, larger fetch) — lets Source Explorer
   *  render actual sample records/identity for REST the same way it
   *  already does for FILE, instead of only a record count. */
  staged?: ConnectorResult;
}

/**
 * A real GET-only round trip through the SAME production adapter
 * (`createHttpFetchAdapter()`) the connector bridge itself uses — one
 * page only, bounded, never a full extraction. Errors surface exactly
 * the sanitized `ConnectorError` messages the engine already produces
 * (never a raw exception, never a header/query-value leak).
 */
export async function testRestConnection(connection: ConnectorConnection, entity: string): Promise<ConnectionTestResult> {
  try {
    const fetchPage = createHttpFetchAdapter(httpFetchConfigFromConnection(connection));
    const connector = createRestApiConnector(connection.sourceSystemId, restSourceFromConnection(connection, entity), { extractionRunId: `test-${Date.now()}`, extractedAt: new Date().toISOString() }, { fetchPage });
    const result = await connector.extract(entity);
    if (result.errors.length > 0) {
      return { ok: false, message: result.errors[0].message };
    }
    const schema = discoverSourceSchema(connection.sourceSystemId, [{ entity, records: result.records }]);
    return { ok: true, message: `Connected — ${result.records.length} record(s) read from this page.`, schema, sampleRecordCount: result.records.length, staged: result };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Connection failed." };
  }
}

/**
 * Section 6/7 — a REAL, production round trip: opens the connection's
 * configured SQLite file read-only through `createSqliteAdapter()` (the
 * ONLY real `DatabaseAdapter` implementation wired into a customer
 * connection) and lists its real tables/views. Never fabricates success
 * — a missing/invalid file, or one this process cannot open read-only,
 * surfaces the adapter's own real error message.
 */
export async function testDatabaseConnection(connection: ConnectorConnection): Promise<ConnectionTestResult> {
  if (!connection.database) {
    return { ok: false, message: "No SQLite database file is configured yet — choose one first." };
  }
  try {
    const tables = await createSqliteAdapter(connection.database).listTables();
    if (tables.length === 0) return { ok: true, message: "Connected — this database has no tables or views yet." };
    return { ok: true, message: `Connected — ${tables.length} table(s)/view(s) found.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not open this SQLite database." };
  }
}
