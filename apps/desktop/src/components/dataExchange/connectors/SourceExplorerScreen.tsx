import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectorConnection, ConnectorResult, SourceSchema } from "@formulab/shared";
import { discoverFileEntities, inspectFile } from "@/lib/connectorFileInspect";
import { testDatabaseConnection, testRestConnection } from "@/lib/connectorTest";
import { Badge, Card, Empty, Field, inputCls, Table } from "./ui";

/** Section 8/9/10 — real Source Explorer: FILE and REST_API genuinely
 *  execute through the actual connector engines (`connectorFileInspect.ts`/
 *  `connectorTest.ts`); DATABASE honestly reports the current
 *  no-production-driver limitation. Renders ONLY what
 *  `discoverSourceSchema()`/the real staged records already returned —
 *  never a second, React-local schema-discovery algorithm. */
export function SourceExplorerScreen({ connection }: { connection: ConnectorConnection | null }) {
  const { t } = useTranslation(["session", "common"]);
  const [entity, setEntity] = useState("");
  const [sheetOptions, setSheetOptions] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [schema, setSchema] = useState<SourceSchema | null>(null);
  const [staged, setStaged] = useState<ConnectorResult | null>(null);

  if (!connection) {
    return (
      <Card title={t("dataExchange.connectors.tabs.explorer")}>
        <Empty text={t("dataExchange.connectors.explorer.selectConnection")} />
      </Card>
    );
  }

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
    } finally {
      setBusy(false);
    }
  };

  const onTestDatabase = () => {
    const result = testDatabaseConnection();
    setMessage({ ok: result.ok, text: result.message });
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
          <div className="mt-3">
            <button onClick={onTestDatabase} className="rounded-input bg-accent px-2.5 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90">
              {t("dataExchange.connectors.explorer.testAndDiscover")}
            </button>
          </div>
        )}

        {message && <p className={`mt-2 rounded-input border px-2 py-1.5 text-[11px] ${message.ok ? "border-success/40 text-success" : "border-error/40 text-error"}`}>{message.text}</p>}
      </Card>

      {schema?.entities[0] && (
        <Card title={t("dataExchange.connectors.explorer.schema")}>
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
