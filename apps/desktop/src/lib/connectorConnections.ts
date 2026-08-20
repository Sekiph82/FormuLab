/**
 * Connector Management frontend — persistence for saved `ConnectorConnection`
 * configurations, over the existing masterdata bridge (the same thin
 * read/write pattern `connectorPersistence.ts` already uses for mapping
 * profiles/crosswalks). No business logic lives here: connection records
 * are pure configuration, never a live connector instance and never a
 * credential — see `schemas/connector.ts`'s own doc comment on
 * `connectorConnectionSchema`.
 */
import { newId, type ConnectorConnection, type ConnectorType } from "@formulab/shared";
import { deleteRecord, listRecords, nowIso, upsertRecords } from "./masterdata";

export async function loadConnections(): Promise<ConnectorConnection[]> {
  const rows = await listRecords("connector_connections");
  return [...rows].sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
}

export function newConnection(
  name: string,
  connectorType: ConnectorType,
  sourceSystemId: string,
  createdBy: string,
): ConnectorConnection {
  const now = nowIso();
  return {
    schemaVersion: "1.0",
    code: newId("connconn"),
    name,
    connectorType,
    sourceSystemId,
    status: "never_tested",
    mappingProfileCount: 0,
    archived: false,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
}

export async function saveConnection(connection: ConnectorConnection): Promise<void> {
  await upsertRecords("connector_connections", [{ ...connection, updatedAt: nowIso() }]);
}

/** Real delete — `connector_connections` is a mutable collection (see
 *  `masterdata.rs`), so this genuinely removes the record. Never called
 *  for a connection with committed import history; the UI only offers
 *  this action when that is true (see `ConnectionsScreen.tsx`). */
export async function deleteConnection(code: string): Promise<void> {
  await deleteRecord("connector_connections", code);
}

/** A safe, real duplicate: a NEW connection record with a fresh code,
 *  copying every configuration field but resetting test/status state —
 *  the copy has never itself been tested, and mapping-profile counts
 *  belong to the ORIGINAL connection's own real usage, never copied. */
export async function duplicateConnection(source: ConnectorConnection, createdBy: string): Promise<ConnectorConnection> {
  const now = nowIso();
  const copy: ConnectorConnection = {
    ...source,
    code: newId("connconn"),
    name: `${source.name} (copy)`,
    status: "never_tested",
    lastTestedAt: undefined,
    lastTestMessage: undefined,
    mappingProfileCount: 0,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
  await saveConnection(copy);
  return copy;
}

export async function setConnectionArchived(connection: ConnectorConnection, archived: boolean): Promise<void> {
  await saveConnection({ ...connection, archived });
}

/** Real, non-fabricated Import Run count for a connection — derived from
 *  the EXISTING `data_exchange_import_jobs` provenance fields
 *  (`sourceSystemId`/`connectorType`), never a second history store. */
export async function importRunCountFor(connection: ConnectorConnection): Promise<number> {
  const jobs = await listRecords("data_exchange_import_jobs");
  return jobs.filter((j) => j.sourceSystemId === connection.sourceSystemId && j.connectorType === connection.connectorType).length;
}

export async function lastImportTimestampFor(connection: ConnectorConnection): Promise<string | undefined> {
  const jobs = await listRecords("data_exchange_import_jobs");
  const matching = jobs.filter((j) => j.sourceSystemId === connection.sourceSystemId && j.connectorType === connection.connectorType);
  if (matching.length === 0) return undefined;
  return matching.reduce((latest, j) => ((j.completedAt ?? j.startedAt) > latest ? (j.completedAt ?? j.startedAt) : latest), "");
}

/** Real Mapping Profile count for a connection — derived from the
 *  EXISTING `mapping_profiles` collection by `sourceSystemId`, never a
 *  second count stored redundantly on the connection record itself
 *  (the persisted `mappingProfileCount` field exists only as a fast
 *  display cache updated here, never an independent source of truth). */
export async function mappingProfileCountFor(sourceSystemId: string): Promise<number> {
  const profiles = await listRecords("mapping_profiles");
  return profiles.filter((p) => p.sourceSystemId === sourceSystemId).length;
}
