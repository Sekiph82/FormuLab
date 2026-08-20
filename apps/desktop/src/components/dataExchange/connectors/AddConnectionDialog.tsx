import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Database, FileText, Globe } from "lucide-react";
import type { ConnectorConnection, ConnectorPaginationKind, ConnectorType } from "@formulab/shared";
import { newConnection, saveConnection } from "@/lib/connectorConnections";
import { testDatabaseConnection, testRestConnection, type ConnectionTestResult } from "@/lib/connectorTest";
import { Field, inputCls, Modal } from "./ui";

/** Section 4/5/6/7 — real "Add Connection" flow: choose type, configure,
 *  optionally test, save through the real persistence authority
 *  (`connectorConnections.ts`). Only FILE/DATABASE/REST_API are ever
 *  offered (CFUI3) — the same `CONNECTOR_TYPES` the engine itself
 *  defines, never an invented fourth type. */
export function AddConnectionDialog({ actorUserId, onClose, onCreated }: { actorUserId: string; onClose: () => void; onCreated: (c: ConnectorConnection) => void }) {
  const { t } = useTranslation(["session", "common"]);
  const [type, setType] = useState<ConnectorType | null>(null);
  const [name, setName] = useState("");
  const [sourceSystemId, setSourceSystemId] = useState("");
  const [connectionRef, setConnectionRef] = useState("");
  const [saving, setSaving] = useState(false);

  // FILE
  const [fileKind, setFileKind] = useState<ConnectorConnection["fileKind"]>("csv");
  const [idField, setIdField] = useState("");
  const [requireExplicitId, setRequireExplicitId] = useState(false);

  // DATABASE
  const [driver, setDriver] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [database, setDatabase] = useState("");
  const [dbSchema, setDbSchema] = useState("");
  const [table, setTable] = useState("");

  // REST
  const [baseUrl, setBaseUrl] = useState("");
  const [path, setPath] = useState("");
  const [recordArrayPath, setRecordArrayPath] = useState("");
  const [paginationKind, setPaginationKind] = useState<ConnectorPaginationKind>("none");
  const [pageParam, setPageParam] = useState("page");
  const [pageSizeParam, setPageSizeParam] = useState("pageSize");
  const [pageSizeValue, setPageSizeValue] = useState("50");
  const [maxPages, setMaxPages] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("");

  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const buildConnection = (): ConnectorConnection | null => {
    if (!type || !name.trim() || !sourceSystemId.trim()) return null;
    const base = newConnection(name.trim(), type, sourceSystemId.trim(), actorUserId);
    if (type === "FILE") return { ...base, fileKind, idField: idField || undefined, requireExplicitId, connectionRef: connectionRef || undefined };
    if (type === "DATABASE")
      return { ...base, driver: driver || undefined, host: host || undefined, port: port ? Number(port) : undefined, database: database || undefined, dbSchema: dbSchema || undefined, table: table || undefined, connectionRef: connectionRef || undefined, idField: idField || undefined, requireExplicitId };
    return {
      ...base,
      baseUrl: baseUrl || undefined,
      path: path || undefined,
      recordArrayPath: recordArrayPath || undefined,
      paginationKind,
      ...(paginationKind === "page" ? { pageParam, pageSizeParam, pageSizeValue: Number(pageSizeValue) || undefined } : {}),
      maxPages: maxPages ? Number(maxPages) : undefined,
      timeoutMs: timeoutMs ? Number(timeoutMs) : undefined,
      connectionRef: connectionRef || undefined,
      idField: idField || undefined,
      requireExplicitId,
    };
  };

  const onTest = async () => {
    const conn = buildConnection();
    if (!conn) return;
    setTesting(true);
    try {
      const result = conn.connectorType === "REST_API" ? await testRestConnection(conn, sourceSystemId || "entity") : conn.connectorType === "DATABASE" ? testDatabaseConnection() : { ok: true, message: t("dataExchange.connectors.addConnection.fileTestHint") };
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  };

  const onSave = async () => {
    const conn = buildConnection();
    if (!conn) return;
    setSaving(true);
    try {
      const withResult: ConnectorConnection = testResult
        ? { ...conn, status: testResult.ok ? "ready" : "error", lastTestedAt: new Date().toISOString(), lastTestMessage: testResult.message }
        : conn;
      await saveConnection(withResult);
      onCreated(withResult);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t("dataExchange.connectors.addConnection.title")} onClose={onClose} wide>
      {!type ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TypeCard icon={<FileText size={18} />} title={t("dataExchange.connectors.addConnection.fileTitle")} description={t("dataExchange.connectors.addConnection.fileDescription")} onClick={() => setType("FILE")} />
          <TypeCard icon={<Database size={18} />} title={t("dataExchange.connectors.addConnection.databaseTitle")} description={t("dataExchange.connectors.addConnection.databaseDescription")} onClick={() => setType("DATABASE")} />
          <TypeCard icon={<Globe size={18} />} title={t("dataExchange.connectors.addConnection.restTitle")} description={t("dataExchange.connectors.addConnection.restDescription")} onClick={() => setType("REST_API")} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("dataExchange.connectors.addConnection.connectionName")}>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </Field>
            <Field label={t("dataExchange.connectors.addConnection.sourceSystemId")}>
              <input value={sourceSystemId} onChange={(e) => setSourceSystemId(e.target.value)} className={inputCls} />
            </Field>
          </div>

          {type === "FILE" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("dataExchange.connectors.addConnection.fileKind")}>
                <select value={fileKind} onChange={(e) => setFileKind(e.target.value as ConnectorConnection["fileKind"])} className={inputCls}>
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                  <option value="xml">XML</option>
                  <option value="xlsx">XLSX</option>
                </select>
              </Field>
              <Field label={t("dataExchange.connectors.addConnection.idField")}>
                <input value={idField} onChange={(e) => setIdField(e.target.value)} className={inputCls} />
              </Field>
              <label className="col-span-2 flex items-center gap-2 text-[11px] text-text">
                <input type="checkbox" checked={requireExplicitId} onChange={(e) => setRequireExplicitId(e.target.checked)} />
                {t("dataExchange.connectors.addConnection.requireExplicitId")}
              </label>
            </div>
          )}

          {type === "DATABASE" && (
            <div className="space-y-2">
              <p className="rounded-input border border-border-faint bg-surface-2 px-2 py-1.5 text-[11px] text-muted">{t("dataExchange.connectors.addConnection.databaseLimitation")}</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("dataExchange.connectors.addConnection.driver")}>
                  <input value={driver} onChange={(e) => setDriver(e.target.value)} className={inputCls} />
                </Field>
                <Field label={t("dataExchange.connectors.addConnection.host")}>
                  <input value={host} onChange={(e) => setHost(e.target.value)} className={inputCls} />
                </Field>
                <Field label={t("dataExchange.connectors.addConnection.port")}>
                  <input value={port} onChange={(e) => setPort(e.target.value)} className={inputCls} />
                </Field>
                <Field label={t("dataExchange.connectors.addConnection.database")}>
                  <input value={database} onChange={(e) => setDatabase(e.target.value)} className={inputCls} />
                </Field>
                <Field label={t("dataExchange.connectors.addConnection.dbSchema")}>
                  <input value={dbSchema} onChange={(e) => setDbSchema(e.target.value)} className={inputCls} />
                </Field>
                <Field label={t("dataExchange.connectors.addConnection.table")}>
                  <input value={table} onChange={(e) => setTable(e.target.value)} className={inputCls} />
                </Field>
                <Field label={t("dataExchange.connectors.addConnection.connectionRef")} hint={t("dataExchange.connectors.addConnection.connectionRefHint")}>
                  <input value={connectionRef} onChange={(e) => setConnectionRef(e.target.value)} className={inputCls} />
                </Field>
              </div>
            </div>
          )}

          {type === "REST_API" && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("dataExchange.connectors.addConnection.baseUrl")}>
                  {/* eslint-disable-next-line i18next/no-literal-string -- example URL placeholder, not natural-language text */}
                  <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={inputCls} placeholder="https://api.example.com" />
                </Field>
                <Field label={t("dataExchange.connectors.addConnection.path")}>
                  {/* eslint-disable-next-line i18next/no-literal-string -- example path placeholder, not natural-language text */}
                  <input value={path} onChange={(e) => setPath(e.target.value)} className={inputCls} placeholder="/v1/materials" />
                </Field>
                <Field label={t("dataExchange.connectors.addConnection.recordArrayPath")}>
                  <input value={recordArrayPath} onChange={(e) => setRecordArrayPath(e.target.value)} className={inputCls} />
                </Field>
                <Field label={t("dataExchange.connectors.addConnection.connectionRef")} hint={t("dataExchange.connectors.addConnection.connectionRefHint")}>
                  <input value={connectionRef} onChange={(e) => setConnectionRef(e.target.value)} className={inputCls} />
                </Field>
                <Field label={t("dataExchange.connectors.addConnection.idField")}>
                  <input value={idField} onChange={(e) => setIdField(e.target.value)} className={inputCls} />
                </Field>
                <Field label={t("dataExchange.connectors.addConnection.pagination")}>
                  <select value={paginationKind} onChange={(e) => setPaginationKind(e.target.value as ConnectorPaginationKind)} className={inputCls}>
                    <option value="none">{t("dataExchange.connectors.addConnection.paginationNone")}</option>
                    <option value="page">{t("dataExchange.connectors.addConnection.paginationPage")}</option>
                    <option value="offset">{t("dataExchange.connectors.addConnection.paginationOffset")}</option>
                    <option value="cursor">{t("dataExchange.connectors.addConnection.paginationCursor")}</option>
                  </select>
                </Field>
                {paginationKind === "page" && (
                  <>
                    <Field label={t("dataExchange.connectors.addConnection.pageParam")}>
                      <input value={pageParam} onChange={(e) => setPageParam(e.target.value)} className={inputCls} />
                    </Field>
                    <Field label={t("dataExchange.connectors.addConnection.pageSizeParam")}>
                      <input value={pageSizeParam} onChange={(e) => setPageSizeParam(e.target.value)} className={inputCls} />
                    </Field>
                    <Field label={t("dataExchange.connectors.addConnection.pageSizeValue")}>
                      <input value={pageSizeValue} onChange={(e) => setPageSizeValue(e.target.value)} className={inputCls} />
                    </Field>
                  </>
                )}
                <Field label={t("dataExchange.connectors.addConnection.maxPages")}>
                  <input value={maxPages} onChange={(e) => setMaxPages(e.target.value)} className={inputCls} />
                </Field>
                <Field label={t("dataExchange.connectors.addConnection.timeoutMs")}>
                  <input value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} className={inputCls} />
                </Field>
              </div>
              <p className="text-[10px] text-muted">{t("dataExchange.connectors.addConnection.getOnlyNotice")}</p>
            </div>
          )}

          {testResult && (
            <p className={`rounded-input border px-2 py-1.5 text-[11px] ${testResult.ok ? "border-success/40 text-success" : "border-error/40 text-error"}`}>{testResult.message}</p>
          )}

          <div className="flex items-center justify-between pt-2">
            <button onClick={() => setType(null)} className="rounded-input border border-border px-2.5 py-1.5 text-[11px] text-muted hover:bg-surface-2">
              {t("common:actions.cancel")}
            </button>
            <div className="flex gap-2">
              {type !== "FILE" && (
                <button onClick={() => void onTest()} disabled={testing} className="rounded-input border border-border px-2.5 py-1.5 text-[11px] text-text hover:bg-surface-2 disabled:opacity-50">
                  {testing ? t("dataExchange.connectors.addConnection.testing") : t("dataExchange.connectors.addConnection.testConnection")}
                </button>
              )}
              <button onClick={() => void onSave()} disabled={saving || !name.trim() || !sourceSystemId.trim()} className="rounded-input bg-accent px-3 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50">
                {t("common:actions.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function TypeCard({ icon, title, description, onClick }: { icon: React.ReactNode; title: string; description: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-start gap-2 rounded-card border border-border p-3 text-left hover:border-accent hover:bg-surface-2">
      <div className="text-muted">{icon}</div>
      <div className="text-[12px] font-medium text-text">{title}</div>
      <div className="text-[11px] text-muted">{description}</div>
    </button>
  );
}
