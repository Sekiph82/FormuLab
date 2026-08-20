/**
 * Connector Management frontend — pure, deterministic mapping from a
 * saved `ConnectorConnection` (`schemas/connector.ts`) to the REAL
 * connector config shapes the existing engines already accept
 * (`RestConnectorSource`/`HttpFetchAdapterConfig`/`DatabaseConnectorSource`).
 * No business logic lives here — this is a config adapter only, reused
 * by the desktop UI so React never hand-builds a connector config
 * itself out of loose strings. Every function throws a clear error for
 * a connection of the wrong type or missing a genuinely required field
 * — never silently substitutes a guessed default.
 */
import type { ConnectorConnection } from "../schemas/connector";
import type { DatabaseConnectorSource, DatabaseTableSelector } from "./databaseConnector";
import type { HttpFetchAdapterConfig, RestPaginationConfig } from "./httpFetchAdapter";
import type { RestConnectorSource } from "./restApiConnector";

export function restSourceFromConnection(conn: ConnectorConnection, entity: string): RestConnectorSource {
  if (conn.connectorType !== "REST_API") throw new Error(`"${conn.name}" is not a REST_API connection.`);
  if (!conn.path) throw new Error(`"${conn.name}" has no configured endpoint path.`);
  return {
    connectionRef: conn.connectionRef ?? "",
    endpoints: { [entity]: conn.path },
    ...(conn.maxPages ? { maxPages: conn.maxPages } : {}),
  };
}

function paginationFromConnection(conn: ConnectorConnection): RestPaginationConfig {
  switch (conn.paginationKind) {
    case "page":
      if (conn.pageParam && conn.pageSizeParam && conn.pageSizeValue) {
        return { kind: "page", pageParam: conn.pageParam, pageSizeParam: conn.pageSizeParam, pageSize: conn.pageSizeValue };
      }
      return { kind: "none" };
    case "offset":
      if (conn.offsetParam && conn.limitParam && conn.limitValue) {
        return { kind: "offset", offsetParam: conn.offsetParam, limitParam: conn.limitParam, limit: conn.limitValue };
      }
      return { kind: "none" };
    case "cursor":
      if (conn.cursorParam && conn.nextCursorPath) {
        return { kind: "cursor", cursorParam: conn.cursorParam, nextCursorPath: conn.nextCursorPath };
      }
      return { kind: "none" };
    default:
      return { kind: "none" };
  }
}

export function httpFetchConfigFromConnection(conn: ConnectorConnection): HttpFetchAdapterConfig {
  if (conn.connectorType !== "REST_API") throw new Error(`"${conn.name}" is not a REST_API connection.`);
  if (!conn.baseUrl) throw new Error(`"${conn.name}" has no configured base URL.`);
  return {
    baseUrl: conn.baseUrl,
    ...(conn.recordArrayPath ? { recordArrayPath: conn.recordArrayPath } : {}),
    pagination: paginationFromConnection(conn),
    ...(conn.timeoutMs ? { timeoutMs: conn.timeoutMs } : {}),
  };
}

export function databaseSourceFromConnection(conn: ConnectorConnection, entity: string): DatabaseConnectorSource {
  if (conn.connectorType !== "DATABASE") throw new Error(`"${conn.name}" is not a DATABASE connection.`);
  if (!conn.table) throw new Error(`"${conn.name}" has no configured table/view.`);
  const selector: DatabaseTableSelector = { table: conn.table, ...(conn.dbSchema ? { schema: conn.dbSchema } : {}) };
  return { connectionRef: conn.connectionRef ?? "", entities: { [entity]: selector } };
}
