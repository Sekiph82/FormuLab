import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createDatabaseConnector,
  createFileConnector,
  createHttpFetchAdapter,
  createRestApiConnector,
  databaseSourceFromConnection,
  httpFetchConfigFromConnection,
  restSourceFromConnection,
  type ApprovalRole,
  type ConnectorConnection,
  type MappingProfile,
  type SourceConnector,
} from "@formulab/shared";
import { confirmConnectorImport, prepareConnectorImport, type PreparedConnectorImport } from "@/lib/connectorImportBridge";
import { createSqliteAdapter } from "@/lib/connectorDatabaseSqlite";
import { readWorkbookAllSheets } from "@/lib/xlsx";
import { loadMappingProfiles } from "@/lib/connectorPersistence";
import { Badge, Card, Empty, Field, inputCls } from "./ui";

// Section 18 audit — the full real `ReimportState` vocabulary
// (`packages/shared/src/engine/dataExchangeIncremental.ts`'s
// `REIMPORT_STATES`) is nine states. Five are per-row blocking states a
// row can genuinely carry (below). `SCHEMA_CHANGED` is included here for
// EXHAUSTIVE typed correctness even though `classifyReimport()` never
// actually returns it as a row's own `reimportState` — a schema mismatch
// aborts the ENTIRE prepare before any row classification runs
// (`connectorImportBridge.ts`'s own early-return `blockingIssues.push`,
// already rendered generically below) — so this entry is structurally
// unreachable as a row state, not a missing capability. `SOURCE_MISSING`
// is a separate, non-blocking, non-row-state finding rendered in its own
// card further down — it is deliberately NOT in this set.
const BLOCKING_STATES = new Set(["CANONICAL_LOCAL_CONFLICT", "CANONICAL_MISSING", "CROSSWALK_CONFLICT", "MAPPING_PROFILE_CHANGED", "SCHEMA_CHANGED"]);

/** Section 15/16/17 — the real Prepare/Review/Commit flow. This
 *  component NEVER reimplements staging/schema/mapping/conflict logic —
 *  it only builds a real `SourceConnector` from the selected
 *  `ConnectorConnection` (the SAME config adapters `connectorTest.ts`
 *  uses) and calls the actual `prepareConnectorImport()`/
 *  `confirmConnectorImport()` (`connectorImportBridge.ts`). Only the
 *  exact `PreparedConnectorImport` prepare returned may ever be
 *  confirmed — never reconstructed from UI state (Section 17). */
export function PrepareReviewScreen({ connection, actorUserId, actorRole }: { connection: ConnectorConnection | null; actorUserId: string; actorRole: ApprovalRole }) {
  const { t } = useTranslation(["session", "common"]);
  const [profiles, setProfiles] = useState<MappingProfile[]>([]);
  const [profileCode, setProfileCode] = useState("");
  const [entity, setEntity] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // Section 21 — one canonical-entity input PER distinct target template
  // the profile actually fans out to, never reduced to just the first
  // (`fieldMappings[0]`) target template.
  const [canonicalEntityByTemplate, setCanonicalEntityByTemplate] = useState<Record<string, string>>({});
  const [prepared, setPrepared] = useState<PreparedConnectorImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState(false);

  useEffect(() => {
    if (!connection) return;
    void loadMappingProfiles().then((rows) => setProfiles(rows.filter((p) => p.sourceSystemId === connection.sourceSystemId)));
  }, [connection]);

  const profile = profiles.find((p) => p.code === profileCode);
  // Section 21 — every distinct target template this profile's field
  // mappings actually reach, not just the first one.
  const targetTemplates = useMemo(() => [...new Set(profile?.fieldMappings.map((m) => m.targetTemplate) ?? [])], [profile]);

  if (!connection) {
    return (
      <Card title={t("dataExchange.connectors.review.heading")}>
        <Empty text={t("dataExchange.connectors.review.selectPrompt")} />
      </Card>
    );
  }

  const buildConnector = async (): Promise<SourceConnector> => {
    const opts = { extractionRunId: `run-${Date.now()}`, extractedAt: new Date().toISOString(), idField: connection.idField, requireExplicitId: connection.requireExplicitId };
    if (connection.connectorType === "REST_API") {
      const fetchPage = createHttpFetchAdapter(httpFetchConfigFromConnection(connection));
      return createRestApiConnector(connection.sourceSystemId, restSourceFromConnection(connection, entity), opts, { fetchPage });
    }
    if (connection.connectorType === "DATABASE") {
      if (!connection.database) throw new Error(t("dataExchange.connectors.addConnection.sqliteFileNone"));
      const adapter = createSqliteAdapter(connection.database);
      return createDatabaseConnector(connection.sourceSystemId, databaseSourceFromConnection(connection, entity), opts, { adapter });
    }
    if (!file) throw new Error(t("dataExchange.connectors.explorer.selectFile"));
    if (connection.fileKind === "xlsx") {
      return createFileConnector(connection.sourceSystemId, { fileName: file.name, fileKind: "xlsx", bytes: await file.arrayBuffer(), entity: entity || undefined }, opts, { readWorkbook: readWorkbookAllSheets });
    }
    return createFileConnector(connection.sourceSystemId, { fileName: file.name, fileKind: connection.fileKind ?? "csv", text: await file.text(), entity: entity || undefined }, opts);
  };

  const onPrepare = async () => {
    if (!profile) return;
    setBusy(true);
    setError(null);
    setCommitted(false);
    try {
      const connector = await buildConnector();
      const crosswalkTargets = Object.fromEntries(
        targetTemplates.filter((tpl) => canonicalEntityByTemplate[tpl]?.trim()).map((tpl) => [tpl, { canonicalEntity: canonicalEntityByTemplate[tpl].trim() }]),
      );
      const result = await prepareConnectorImport({
        connector,
        entity: entity || connection.sourceSystemId,
        profile,
        ...(Object.keys(crosswalkTargets).length > 0 ? { crosswalkTargets } : {}),
      });
      setPrepared(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onCommit = async () => {
    if (!prepared) return;
    setBusy(true);
    setError(null);
    try {
      await confirmConnectorImport(prepared, { actorUserId, actorRole });
      setCommitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Section 17 — a rejected (stale/conflict) confirm must never
      // silently retry; the operator must explicitly re-prepare.
      setPrepared(null);
    } finally {
      setBusy(false);
    }
  };

  const allRows = prepared?.templates.flatMap((tpl) => tpl.rows.map((r) => ({ ...r, targetTemplate: tpl.targetTemplate }))) ?? [];
  const problemRows = allRows.filter((r) => BLOCKING_STATES.has(r.reimportState));
  const missingFromSource = prepared?.templates.flatMap((tpl) => tpl.missingFromSource) ?? [];
  const canCommit = !!prepared && prepared.blockingIssues.length === 0 && !committed;

  return (
    <div className="space-y-3">
      <Card title={t("dataExchange.connectors.review.prepareImport")}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label={t("dataExchange.connectors.explorer.entity")}>
            <input value={entity} onChange={(e) => setEntity(e.target.value)} className={inputCls} placeholder={connection.sourceSystemId} />
          </Field>
          <Field label={t("dataExchange.connectors.mapping.editorTitle")}>
            <select value={profileCode} onChange={(e) => setProfileCode(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {profiles.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.code}
                </option>
              ))}
            </select>
          </Field>
          {connection.connectorType === "FILE" && (
            <Field label={t("dataExchange.connectors.explorer.selectFile")}>
              <input type="file" aria-label={t("dataExchange.connectors.explorer.uploadFile")} onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} className="text-[11px]" />
            </Field>
          )}
          {targetTemplates.map((tpl) => (
            <Field key={tpl} label={`${t("dataExchange.connectors.crosswalks.canonicalEntity")} (${tpl})`}>
              <input
                value={canonicalEntityByTemplate[tpl] ?? ""}
                onChange={(e) => setCanonicalEntityByTemplate((prev) => ({ ...prev, [tpl]: e.target.value }))}
                className={inputCls}
                // eslint-disable-next-line i18next/no-literal-string -- example canonical entity name placeholder, not natural-language text
                placeholder="RawMaterial"
              />
            </Field>
          ))}
        </div>
        <button onClick={() => void onPrepare()} disabled={busy || !profile || (connection.connectorType === "FILE" && !file)} className="mt-3 rounded-input bg-accent px-3 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50">
          {t("dataExchange.connectors.review.prepareImport")}
        </button>
        {error && <p className="mt-2 rounded-input border border-error/40 px-2 py-1.5 text-[11px] text-error">{error}</p>}
        {committed && <p className="mt-2 rounded-input border border-success/40 px-2 py-1.5 text-[11px] text-success">{t("dataExchange.connectors.review.committed")}</p>}
      </Card>

      {prepared && (
        <Card title={t("dataExchange.connectors.review.summary")}>
          <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-5">
            <Info label={String(prepared.stagedCount)} sub={t("dataExchange.connectors.review.stagedRows")} />
            <Info label={String(prepared.mappedCount)} sub={t("dataExchange.connectors.review.mappedRows")} />
            <Info label={String(prepared.warnings.length)} sub={t("dataExchange.connectors.review.warnings")} />
            <Info label={String(prepared.blockingIssues.length)} sub={t("dataExchange.connectors.review.blockingIssues")} />
            <Info label={prepared.commitOrder.join(" → ") || "—"} sub={t("dataExchange.connectors.mapping.targetTemplates")} />
          </div>

          {prepared.blockingIssues.length > 0 && (
            <ul className="mt-3 space-y-1 text-[11px] text-error">
              {prepared.blockingIssues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}

          <div className="mt-3">
            <button onClick={() => void onCommit()} disabled={!canCommit || busy} className="rounded-input bg-accent px-3 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50">
              {t("dataExchange.connectors.review.commit")}
            </button>
          </div>
        </Card>
      )}

      {problemRows.length > 0 && (
        <Card title={t("dataExchange.connectors.review.conflictHeading")}>
          <div className="space-y-2">
            {problemRows.map((row, i) => (
              <div key={i} className="rounded-input border border-error/40 px-2 py-1.5 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="error">{row.reimportState}</Badge>
                  <span className="font-medium text-text">{row.targetTemplate}</span>
                  <span className="text-muted">{row.preview.naturalKey}</span>
                  <span className="text-muted">
                    {t("dataExchange.connectors.review.sourceIdentity")}: {row.sourceRecordId}
                  </span>
                </div>
                <p className="mt-1 text-muted">{t("dataExchange.connectors.review.resolutionNotice")}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {missingFromSource.length > 0 && (
        <Card title={t("dataExchange.connectors.review.sourceMissing")}>
          <p className="mb-2 text-[11px] font-medium text-warning">{t("dataExchange.connectors.review.sourceMissingNotice")}</p>
          <ul className="space-y-1 text-[11px] text-muted">
            {missingFromSource.map((m) => (
              <li key={m.naturalKey} className="rounded-input border border-warning/30 px-2 py-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-text">
                  <span className="font-medium">{m.naturalKey}</span>
                  <span>
                    {t("dataExchange.connectors.review.targetTemplate")}: {m.targetCollection ?? "—"}
                  </span>
                  <span>
                    {t("dataExchange.connectors.runs.targetRecordId")}: {m.targetRecordId ?? "—"}
                  </span>
                  <span>
                    {t("dataExchange.connectors.review.lastSeenJob")}: {m.lastSeenJobId}
                  </span>
                </div>
              </li>
            ))}
          </ul>
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
