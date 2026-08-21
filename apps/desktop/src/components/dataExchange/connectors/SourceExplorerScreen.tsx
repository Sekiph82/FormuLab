import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectorConnection, ConnectorResult, DatabaseEntityDescription, SourceSchema } from "@formulab/shared";
import { discoverFileEntities, inspectFile } from "@/lib/connectorFileInspect";
import { describeDatabaseTable, inspectDatabaseTable, listDatabaseTables, type DatabaseTableOption } from "@/lib/connectorDatabaseInspect";
import { testRestConnection } from "@/lib/connectorTest";
import { saveConnection } from "@/lib/connectorConnections";
import { Badge, Card, Empty, Field, inputCls, Table } from "./ui";

/** Section 8/9/10 — real Source Explorer: FILE, REST_API, and DATABASE
 *  (SQLite) all genuinely execute through the actual connector engines
 *  (`connectorFileInspect.ts`/`connectorTest.ts`/`connectorDatabaseInspect.ts`).
 *  Renders ONLY what `discoverSourceSchema()`/the real staged records/the
 *  real `describeEntity()` metadata already returned — never a second,
 *  React-local schema-discovery algorithm. */
export function SourceExplorerScreen({
  connection,
  onInspected,
  onCreateMappingProfile,
}: {
  connection: ConnectorConnection | null;
  /** Section 11 — publishes a successful inspection's real schema/entity
   *  upward so Mapping Profiles can consume it, without a second
   *  persistence store for transient inspection state. */
  onInspected?: (entity: string, schema: SourceSchema, staged: ConnectorResult | null) => void;
  onCreateMappingProfile?: () => void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [entity, setEntity] = useState("");
  const [sheetOptions, setSheetOptions] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [schema, setSchema] = useState<SourceSchema | null>(null);
  const [staged, setStaged] = useState<ConnectorResult | null>(null);
  const [dbTables, setDbTables] = useState<DatabaseTableOption[]>([]);
  const [dbTable, setDbTable] = useState("");
  const [dbDescription, setDbDescription] = useState<DatabaseEntityDescription | null>(null);

  useEffect(() => {
    setDbTables([]);
    setDbTable("");
    setDbDescription(null);
    if (connection?.connectorType !== "DATABASE" || !connection.database) return;
    void listDatabaseTables(connection).then((tables) => {
      setDbTables(tables);
      setDbTable(connection.table && tables.some((t) => t.table === connection.table) ? connection.table : (tables[0]?.table ?? ""));
    });
    // Re-list whenever the connection identity or its configured file
    // changes — never on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection?.code, connection?.database]);

  if (!connection) {
    return (
      <Card title={t("dataExchange.connectors.tabs.explorer")}>
        <Empty text={t("dataExchange.connectors.explorer.selectConnection")} />
      </Card>
    );
  }

  // Section 28/STATUS1-STATUS3 — a real Source Explorer inspection is
  // itself a real connection test; its outcome persists to the SAVED
  // connection record (never left at a stale "Never tested" after a
  // genuine successful/failed round trip). Best-effort: a persistence
  // failure here must never block the inspection result already shown.
  const persistTestResult = async (ok: boolean, resultMessage: string) => {
    try {
      await saveConnection({ ...connection, status: ok ? "ready" : "error", lastTestedAt: new Date().toISOString(), lastTestMessage: resultMessage });
    } catch {
      /* best-effort status persistence — the inspection result itself already rendered */
    }
  };

  const onFilePicked = async (picked: File) => {
    setFile(picked);
    setMessage(null);
    if (connection.fileKind === "xlsx") {
      const sheets = await discoverFileEntities(picked, "xlsx");
      setSheetOptions(sheets);
      setEntity(sheets[0] ?? "");
    } else {
      setSheetOptions([]);
      setEntity("");
    }
  };

  const onInspectFile = async () => {
    if (!file || !connection.fileKind) return;
    setBusy(true);
    try {
      const result = await inspectFile(connection.sourceSystemId, file, connection.fileKind, { entity: entity || undefined, idField: connection.idField, requireExplicitId: connection.requireExplicitId });
      setMessage({ ok: result.ok, text: result.message });
      setSchema(result.schema ?? null);
      setStaged(result.staged ?? null);
      // The REAL discovered entity name (`result.schema.entities[0].entity`)
      // — never the local `entity` UI state, which for a plain (non-XLSX)
      // file stays empty and would otherwise mismatch the filename-derived
      // entity `inspectFile()`/`createFileConnector()` actually used,
      // permanently failing `validateMappingProfile()`'s own
      // `source_entity_not_found` check for any profile prefilled from it.
      if (result.schema) onInspected?.(result.schema.entities[0]?.entity ?? entity, result.schema, result.staged ?? null);
      await persistTestResult(result.ok, result.message);
    } finally {
      setBusy(false);
    }
  };

  const onTestRest = async () => {
    setBusy(true);
    try {
      const result = await testRestConnection(connection, entity || connection.sourceSystemId);
      setMessage({ ok: result.ok, text: result.message });
      setSchema(result.schema ?? null);
      setStaged(result.staged ?? null);
      if (result.schema) onInspected?.(entity || connection.sourceSystemId, result.schema, result.staged ?? null);
      await persistTestResult(result.ok, result.message);
    } finally {
      setBusy(false);
    }
  };

  const onInspectDatabase = async () => {
    if (!dbTable) return;
    setBusy(true);
    try {
      const desc = await describeDatabaseTable(connection, dbTable);
      setDbDescription(desc);
      const result = await inspectDatabaseTable(connection, dbTable, { idField: connection.idField, requireExplicitId: connection.requireExplicitId });
      setMessage({ ok: result.ok, text: result.message });
      setSchema(result.schema ?? null);
      setStaged(result.staged ?? null);
      if (result.schema) onInspected?.(dbTable, result.schema, result.staged ?? null);
      await persistTestResult(result.ok, result.message);
    } catch (e) {
      const failureMessage = e instanceof Error ? e.message : "Could not read this table.";
      setMessage({ ok: false, text: failureMessage });
      setDbDescription(null);
      await persistTestResult(false, failureMessage);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card title={t("dataExchange.connectors.explorer.header")}>
        <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
          <Info label={connection.name} sub={connection.connectorType} />
          <Info label={connection.sourceSystemId} sub={t("dataExchange.connectors.connections.sourceSystem")} />
          {schema && <Info label={schema.fingerprint.slice(0, 16)} sub={t("dataExchange.connectors.explorer.schemaFingerprint")} />}
          {staged?.records[0]?.extraction.extractedAt && <Info label={new Date(staged.records[0].extraction.extractedAt).toLocaleString()} sub={t("dataExchange.connectors.explorer.extractedAt")} />}
        </div>

        {connection.connectorType === "FILE" && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label={t("dataExchange.connectors.explorer.selectFile")}>
              <input
                type="file"
                aria-label={t("dataExchange.connectors.explorer.uploadFile")}
                onChange={(e) => e.target.files?.[0] && void onFilePicked(e.target.files[0])}
                className="text-[11px]"
              />
            </Field>
            {sheetOptions.length > 0 && (
              <Field label={t("dataExchange.connectors.explorer.sheet")}>
                <select value={entity} onChange={(e) => setEntity(e.target.value)} className={inputCls}>
                  {sheetOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <button onClick={() => void onInspectFile()} disabled={!file || busy} className="rounded-input bg-accent px-2.5 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50">
              {t("dataExchange.connectors.explorer.testAndDiscover")}
            </button>
          </div>
        )}

        {connection.connectorType === "REST_API" && (
          <div className="mt-3 flex items-end gap-2">
            <Field label={t("dataExchange.connectors.explorer.entity")}>
              <input value={entity} onChange={(e) => setEntity(e.target.value)} className={inputCls} placeholder={connection.sourceSystemId} />
            </Field>
            <button onClick={() => void onTestRest()} disabled={busy} className="rounded-input bg-accent px-2.5 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50">
              {t("dataExchange.connectors.explorer.testAndDiscover")}
            </button>
          </div>
        )}

        {connection.connectorType === "DATABASE" && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {!connection.database ? (
              <p className="text-[11px] text-warning">{t("dataExchange.connectors.addConnection.sqliteFileNone")}</p>
            ) : (
              <>
                <Field label={t("dataExchange.connectors.explorer.tables")}>
                  <select value={dbTable} onChange={(e) => setDbTable(e.target.value)} className={inputCls}>
                    {dbTables.length === 0 && <option value="">—</option>}
                    {dbTables.map((tbl) => (
                      <option key={tbl.table} value={tbl.table}>
                        {tbl.table} ({tbl.kind})
                      </option>
                    ))}
                  </select>
                </Field>
                <button onClick={() => void onInspectDatabase()} disabled={!dbTable || busy} className="rounded-input bg-accent px-2.5 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50">
                  {t("dataExchange.connectors.explorer.testAndDiscover")}
                </button>
              </>
            )}
          </div>
        )}

        {message && <p className={`mt-2 rounded-input border px-2 py-1.5 text-[11px] ${message.ok ? "border-success/40 text-success" : "border-error/40 text-error"}`}>{message.text}</p>}
      </Card>

      {dbDescription && (
        <Card title={t("dataExchange.connectors.explorer.columns")}>
          <Table
            headers={[
              t("dataExchange.connectors.explorer.field"),
              t("dataExchange.connectors.explorer.declaredType"),
              t("dataExchange.connectors.explorer.nullable"),
              t("dataExchange.connectors.explorer.primaryKey"),
              t("dataExchange.connectors.explorer.foreignKey"),
            ]}
            rows={dbDescription.columns.map((c) => {
              const fk = dbDescription.foreignKeys.find((f) => f.fromColumns.includes(c.name));
              return {
                key: c.name,
                cells: [
                  c.name,
                  c.declaredType || "—",
                  // eslint-disable-next-line i18next/no-literal-string -- check/dash glyphs, not natural-language text
                  c.nullable ? "✓" : "—",
                  // eslint-disable-next-line i18next/no-literal-string -- check/dash glyphs, not natural-language text
                  c.isPrimaryKey ? `✓${c.primaryKeyOrdinal ? ` (${c.primaryKeyOrdinal})` : ""}` : "—",
                  fk ? `${fk.toTable}.${fk.toColumns.join(", ")}` : "—",
                ],
              };
            })}
          />
        </Card>
      )}

      {schema?.entities[0] && (
        <Card
          title={t("dataExchange.connectors.explorer.schema")}
          actions={
            onCreateMappingProfile && (
              <button onClick={onCreateMappingProfile} className="rounded-input bg-accent px-2.5 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90">
                {t("dataExchange.connectors.explorer.createMappingProfile")}
              </button>
            )
          }
        >
          <Table
            headers={[
              t("dataExchange.connectors.explorer.field"),
              t("dataExchange.connectors.explorer.type"),
              t("dataExchange.connectors.explorer.nullable"),
              t("dataExchange.connectors.explorer.identityRole"),
              t("dataExchange.connectors.explorer.unitHint"),
            ]}
            rows={schema.entities[0].fields.map((f) => ({
              key: f.path,
              // eslint-disable-next-line i18next/no-literal-string -- check/dash glyphs, not natural-language text
              cells: [f.path, f.observedTypes.join(", "), f.nullable ? "✓" : "—", f.externalIdStatus ?? "—", f.unitHint ?? f.unitColumnHint ?? "—"],
            }))}
          />
        </Card>
      )}

      {staged && staged.records.length > 0 && (
        <Card title={t("dataExchange.connectors.explorer.sampleRecords")}>
          <Table
            headers={Object.keys(staged.records[0].fields)}
            rows={staged.records.slice(0, 10).map((r, i) => ({ key: String(i), cells: Object.values(r.fields).map((v) => v ?? "—") }))}
          />
        </Card>
      )}

      {staged && (
        <Card title={t("dataExchange.connectors.explorer.identity")}>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {staged.records[0]?.identity.idSource === "configured" ? (
              <Badge tone="ok">{t("dataExchange.connectors.explorer.configuredExternalId")}</Badge>
            ) : (
              <Badge tone="warn">{t("dataExchange.connectors.explorer.ordinalIdentity")}</Badge>
            )}
          </div>
          {staged.records[0]?.identity.idSource !== "configured" && <p className="mt-2 text-[11px] text-warning">{t("dataExchange.connectors.explorer.ordinalWarning")}</p>}
        </Card>
      )}

      {schema?.entities[0] && (
        <Card title={t("dataExchange.connectors.explorer.relationships")}>
          {schema.entities[0].relationshipHints.length === 0 ? (
            <Empty text={t("dataExchange.connectors.explorer.noRelationships")} />
          ) : (
            <ul className="space-y-1 text-[11px] text-muted">
              {schema.entities[0].relationshipHints.map((h) => (
                <li key={h.fieldPath}>
                  <span className="font-medium text-text">{h.fieldPath}</span> — {h.reason}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

function Info({ label, sub }: { label: string; sub: string }) {
  return (
    <div>
      <div className="text-[12px] font-medium text-text">{label}</div>
      <div className="text-[10px] text-muted">{sub}</div>
    </div>
  );
}
