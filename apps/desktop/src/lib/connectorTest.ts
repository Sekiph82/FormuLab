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
  type SourceSchema,
} from "@formulab/shared";

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  schema?: SourceSchema;
  sampleRecordCount?: number;
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
    return { ok: true, message: `Connected — ${result.records.length} record(s) read from this page.`, schema, sampleRecordCount: result.records.length };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Connection failed." };
  }
}

/**
 * Honest, non-fabricated result: no production `DatabaseAdapter` exists
 * in this build. Never pretends success — see the module doc comment.
 */
export function testDatabaseConnection(): ConnectionTestResult {
  return {
    ok: false,
    message: "No database driver is available in this build yet. The connection configuration is saved for when a real driver is wired — see docs/CONNECTOR_MANAGEMENT_FRONTEND.md.",
  };
}
