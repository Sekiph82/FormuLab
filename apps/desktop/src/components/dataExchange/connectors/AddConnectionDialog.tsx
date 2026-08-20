import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Database, FileText, Globe } from "lucide-react";
import type { ConnectorConnection, ConnectorPaginationKind, ConnectorType } from "@formulab/shared";
import { newConnection, saveConnection } from "@/lib/connectorConnections";
import { testDatabaseConnection, testRestConnection, type ConnectionTestResult } from "@/lib/connectorTest";
import { pickFile } from "@/lib/tauri";
import { Field, inputCls, Modal } from "./ui";

/** Section 4/5/6/7 — real "Add Connection" flow: choose type, configure,
 *  optionally test, save through the real persistence authority
 *  (`connectorConnections.ts`). Only FILE/DATABASE/REST_API are ever
 *  offered (CFUI3) — the same `CONNECTOR_TYPES` the engine itself
 *  defines, never an invented fourth type. */
export function AddConnectionDialog({
  actorUserId,
  editing,
  onClose,
  onCreated,
}: {
  actorUserId: string;
  /** Section 4 — when set, this dialog edits this EXISTING connection in
   *  place (same `code`/`createdAt`/`createdBy`, connector type fixed)
   *  rather than creating a new one. */
  editing?: ConnectorConnection;
  onClose: () => void;
  onCreated: (c: ConnectorConnection) => void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [type, setType] = useState<ConnectorType | null>(editing?.connectorType ?? null);
  const [name, setName] = useState(editing?.name ?? "");
  const [sourceSystemId, setSourceSystemId] = useState(editing?.sourceSystemId ?? "");
  const [connectionRef, setConnectionRef] = useState(editing?.connectionRef ?? "");
  const [saving, setSaving] = useState(false);

  // FILE
  const [fileKind, setFileKind] = useState<ConnectorConnection["fileKind"]>(editing?.fileKind ?? "csv");
  const [idField, setIdField] = useState(editing?.idField ?? "");
  const [requireExplicitId, setRequireExplicitId] = useState(editing?.requireExplicitId ?? false);

  // DATABASE — SQLite only (the one genuinely production-supported
  // driver in this build, Section 6). `database` holds the absolute
  // local file path, picked via the native file dialog — never a
  // host/port/username/password, because none exist for a local file.
  const [database, setDatabase] = useState(editing?.database ?? "");
  const [table, setTable] = useState(editing?.table ?? "");

  // REST
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? "");
  const [path, setPath] = useState(editing?.path ?? "");
  const [recordArrayPath, setRecordArrayPath] = useState(editing?.recordArrayPath ?? "");
  const [paginationKind, setPaginationKind] = useState<ConnectorPaginationKind>(editing?.paginationKind ?? "none");
  const [pageParam, setPageParam] = useState(editing?.pageParam ?? "page");
  const [pageSizeParam, setPageSizeParam] = useState(editing?.pageSizeParam ?? "pageSize");
  const [pageSizeValue, setPageSizeValue] = useState(editing?.pageSizeValue ? String(editing.pageSizeValue) : "50");
  const [offsetParam, setOffsetParam] = useState(editing?.offsetParam ?? "offset");
  const [limitParam, setLimitParam] = useState(editing?.limitParam ?? "limit");
  const [limitValue, setLimitValue] = useState(editing?.limitValue ? String(editing.limitValue) : "50");
  const [cursorParam, setCursorParam] = useState(editing?.cursorParam ?? "cursor");
  const [nextCursorPath, setNextCursorPath] = useState(editing?.nextCursorPath ?? "");
  const [maxPages, setMaxPages] = useState(editing?.maxPages ? String(editing.maxPages) : "");
  const [timeoutMs, setTimeoutMs] = useState(editing?.timeoutMs ? String(editing.timeoutMs) : "");

  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const buildConnection = (): ConnectorConnection | null => {
    if (!type || !name.trim() || !sourceSystemId.trim()) return null;
    // Section 4 — Configure edits the EXISTING record in place: same
    // code/createdAt/createdBy, connector type never changes. Otherwise a
    // genuinely new record, exactly as before.
    const base: ConnectorConnection = editing
      ? { ...editing, name: name.trim(), connectorType: type, sourceSystemId: sourceSystemId.trim() }
      : newConnection(name.trim(), type, sourceSystemId.trim(), actorUserId);
    if (type === "FILE") return { ...base, fileKind, idField: idField || undefined, requireExplicitId, connectionRef: connectionRef || undefined };
    if (type === "DATABASE")
      // `driver` is always "sqlite" — the only production-supported
      // database driver in this build; never user-editable (Section 6).
      return { ...base, driver: "sqlite", database: database || undefined, table: table || undefined, idField: idField || undefined, requireExplicitId };
    return {
      ...base,
      baseUrl: baseUrl || undefined,
      path: path || undefined,
      recordArrayPath: recordArrayPath || undefined,
      paginationKind,
      ...(paginationKind === "page" ? { pageParam, pageSizeParam, pageSizeValue: Number(pageSizeValue) || undefined } : {}),
      ...(paginationKind === "offset" ? { offsetParam, limitParam, limitValue: Number(limitValue) || undefined } : {}),
      ...(paginationKind === "cursor" ? { cursorParam, nextCursorPath: nextCursorPath || undefined } : {}),
      maxPages: maxPages ? Number(maxPages) : undefined,
      timeoutMs: timeoutMs ? Number(timeoutMs) : undefined,
      connectionRef: connectionRef || undefined,
      idField: idField || undefined,
      requireExplicitId,
    };
  };

  // Section 8/RESTP5 — an explicitly selected pagination mode must have
  // its own required fields filled before Test/Save is allowed; never
  // silently saved as an incomplete configuration that degrades to
  // "none" at extraction time.
  const paginationComplete =
    type !== "REST_API" ||
    paginationKind === "none" ||
    (paginationKind === "page" && !!pageParam.trim() && !!pageSizeParam.trim() && !!pageSizeValue.trim()) ||
    (paginationKind === "offset" && !!offsetParam.trim() && !!limitParam.trim() && !!limitValue.trim()) ||
    (paginationKind === "cursor" && !!cursorParam.trim() && !!nextCursorPath.trim());

  const onTest = async () => {
    const conn = buildConnection();
    if (!conn) return;
    setTesting(true);
    try {
      const result = conn.connectorType === "REST_API" ? await testRestConnection(conn, sourceSystemId || "entity") : conn.connectorType === "DATABASE" ? await testDatabaseConnection(conn) : { ok: true, message: t("dataExchange.connectors.addConnection.fileTestHint") };
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
      // Section 27 — honest status. A fresh Test Connection result from
      // THIS editing session wins. Otherwise: a brand-new connection
      // starts (and stays) "never_tested"; an EXISTING connection being
      // Configured without a fresh re-test is reset to "never_tested"
      // rather than risk carrying forward a stale "ready" for
      // configuration nobody actually re-verified this session — cheaper
      // and more honest than trying to diff every field for "did
      // anything connection-affecting actually change".
      const withResult: ConnectorConnection = testResult
        ? { ...conn, status: testResult.ok ? "ready" : "error", lastTestedAt: new Date().toISOString(), lastTestMessage: testResult.message }
        : editing
          ? { ...conn, status: "never_tested", lastTestedAt: undefined, lastTestMessage: undefined }
          : conn;
      await saveConnection(withResult);
      onCreated(withResult);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={editing ? t("dataExchange.connectors.addConnection.configureTitle") : t("dataExchange.connectors.addConnection.title")} onClose={onClose} wide>
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
              <p className="rounded-input border border-border-faint bg-surface-2 px-2 py-1.5 text-[11px] text-muted">{t("dataExchange.connectors.addConnection.databaseDriverNotice")}</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("dataExchange.connectors.addConnection.driver")}>
                  {/* SQLite is the only genuinely production-supported driver in
                      this build — never a free-text/selectable field. */}
                  <input value="SQLite" disabled className={inputCls} />
                </Field>
                <Field label={t("dataExchange.connectors.addConnection.sqliteFile")} hint={t("dataExchange.connectors.addConnection.sqliteFileHint")}>
                  <div className="flex gap-1">
                    <input value={database} readOnly className={inputCls} placeholder={t("dataExchange.connectors.addConnection.sqliteFileNone")} />
                    <button
                      type="button"
                      onClick={() => void pickFile(["sqlite", "db", "sqlite3"]).then((p) => p && setDatabase(p))}
                      className="shrink-0 rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2"
                    >
                      {t("dataExchange.connectors.addConnection.chooseFile")}
                    </button>
                  </div>
                </Field>
                <Field label={t("dataExchange.connectors.addConnection.table")} hint={t("dataExchange.connectors.addConnection.databaseTableHint")}>
                  <input value={table} onChange={(e) => setTable(e.target.value)} className={inputCls} />
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
                {paginationKind === "offset" && (
                  <>
                    <Field label={t("dataExchange.connectors.addConnection.offsetParam")}>
                      <input value={offsetParam} onChange={(e) => setOffsetParam(e.target.value)} className={inputCls} />
                    </Field>
                    <Field label={t("dataExchange.connectors.addConnection.limitParam")}>
                      <input value={limitParam} onChange={(e) => setLimitParam(e.target.value)} className={inputCls} />
                    </Field>
                    <Field label={t("dataExchange.connectors.addConnection.limitValue")}>
                      <input value={limitValue} onChange={(e) => setLimitValue(e.target.value)} className={inputCls} />
                    </Field>
                  </>
                )}
                {paginationKind === "cursor" && (
                  <>
                    <Field label={t("dataExchange.connectors.addConnection.cursorParam")}>
                      <input value={cursorParam} onChange={(e) => setCursorParam(e.target.value)} className={inputCls} />
                    </Field>
                    <Field label={t("dataExchange.connectors.addConnection.nextCursorPath")}>
                      <input value={nextCursorPath} onChange={(e) => setNextCursorPath(e.target.value)} className={inputCls} />
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
              <p className="text-[10px] text-muted">{t("dataExchange.connectors.addConnection.restAuthNotice")}</p>
              {!paginationComplete && (
                <p className="text-[10px] text-error">{t("dataExchange.connectors.addConnection.paginationIncomplete")}</p>
              )}
            </div>
          )}

          {testResult && (
            <p className={`rounded-input border px-2 py-1.5 text-[11px] ${testResult.ok ? "border-success/40 text-success" : "border-error/40 text-error"}`}>{testResult.message}</p>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => (editing ? onClose() : setType(null))}
              className="rounded-input border border-border px-2.5 py-1.5 text-[11px] text-muted hover:bg-surface-2"
            >
              {t("common:actions.cancel")}
            </button>
            <div className="flex gap-2">
              {type !== "FILE" && (
                <button onClick={() => void onTest()} disabled={testing || !paginationComplete} className="rounded-input border border-border px-2.5 py-1.5 text-[11px] text-text hover:bg-surface-2 disabled:opacity-50">
                  {testing ? t("dataExchange.connectors.addConnection.testing") : t("dataExchange.connectors.addConnection.testConnection")}
                </button>
              )}
              <button onClick={() => void onSave()} disabled={saving || !name.trim() || !sourceSystemId.trim() || !paginationComplete} className="rounded-input bg-accent px-3 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50">
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
