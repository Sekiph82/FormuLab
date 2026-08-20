import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DataExchangeImportJob, DataExchangeImportRowResult } from "@formulab/shared";
import { listRecords } from "@/lib/masterdata";
import { Badge, Card, Empty, Table } from "./ui";

/** Section 18 — real Import Runs history, over the EXISTING
 *  `data_exchange_import_jobs`/`data_exchange_import_row_results`
 *  collections — never a second Import History store. Scoped to
 *  connector-sourced jobs (`fileType === "connector"`); a plain CSV/XLSX
 *  upload's own history is already shown in Data Exchange's existing
 *  "Import History" section — never duplicated here. */
export function ImportRunsScreen() {
  const { t } = useTranslation(["session", "common"]);
  const [jobs, setJobs] = useState<DataExchangeImportJob[]>([]);
  const [rowResults, setRowResults] = useState<DataExchangeImportRowResult[]>([]);
  const [detailJobId, setDetailJobId] = useState<string | null>(null);

  useEffect(() => {
    void listRecords("data_exchange_import_jobs").then((rows) => setJobs(rows.filter((j) => j.fileType === "connector").sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1))));
    void listRecords("data_exchange_import_row_results").then(setRowResults);
  }, []);

  const detailJob = jobs.find((j) => j.id === detailJobId);
  const detailRows = detailJobId ? rowResults.filter((r) => r.jobId === detailJobId) : [];

  return (
    <Card title={t("dataExchange.connectors.tabs.runs")}>
      {jobs.length === 0 ? (
        <Empty text={t("dataExchange.connectors.runs.empty")} />
      ) : (
        <Table
          headers={[
            t("dataExchange.connectors.runs.timestamp"),
            t("dataExchange.connectors.runs.sourceSystem"),
            t("dataExchange.connectors.runs.connectorType"),
            t("dataExchange.connectors.runs.mappingProfile"),
            t("dataExchange.connectors.runs.rows"),
            t("dataExchange.connectors.runs.status"),
          ]}
          rows={jobs.map((j) => ({
            key: j.id,
            cells: [
              <button key="ts" onClick={() => setDetailJobId(j.id)} className="font-medium text-text hover:underline">
                {new Date(j.startedAt).toLocaleString()}
              </button>,
              j.sourceSystemId ?? "—",
              j.connectorType ?? "—",
              j.mappingProfileCode ?? "—",
              String(j.totalRows),
              <JobStatusBadge key="status" status={j.status} />,
            ],
          }))}
        />
      )}

      {detailJob && (
        <div className="mt-3 space-y-2 rounded-input border border-border-faint bg-surface-2 p-3 text-[11px]">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-muted">{t("dataExchange.connectors.runs.sourceSystem")}</dt>
            <dd className="text-text">{detailJob.sourceSystemId}</dd>
            <dt className="text-muted">{t("dataExchange.connectors.runs.connectorType")}</dt>
            <dd className="text-text">{detailJob.connectorType}</dd>
            <dt className="text-muted">{t("dataExchange.connectors.runs.mappingProfile")}</dt>
            <dd className="text-text">
              {detailJob.mappingProfileCode} ({detailJob.mappingProfileVersion})
            </dd>
            <dt className="text-muted">{t("dataExchange.connectors.runs.schemaFingerprint")}</dt>
            <dd className="truncate text-text">{detailJob.sourceSchemaFingerprint}</dd>
            <dt className="text-muted">{t("dataExchange.connectors.runs.extractionRunId")}</dt>
            <dd className="text-text">{detailJob.extractionRunId}</dd>
            <dt className="text-muted">{t("dataExchange.connectors.runs.creates")}</dt>
            <dd className="text-text">{detailJob.createdRows}</dd>
            <dt className="text-muted">{t("dataExchange.connectors.runs.updates")}</dt>
            <dd className="text-text">{detailJob.updatedRows}</dd>
            <dt className="text-muted">{t("dataExchange.connectors.runs.unchanged")}</dt>
            <dd className="text-text">{detailJob.unchangedRows}</dd>
            <dt className="text-muted">{t("dataExchange.connectors.runs.failures")}</dt>
            <dd className="text-text">{detailJob.invalidRows}</dd>
          </dl>
          {detailRows.length > 0 && (
            <Table
              headers={[t("dataExchange.connectors.mapping.targetTemplate"), t("dataExchange.connectors.runs.targetCollection"), t("dataExchange.connectors.runs.targetRecordId"), t("dataExchange.connectors.runs.status")]}
              rows={detailRows.map((r) => ({ key: r.id, cells: [r.naturalKey ?? "—", r.targetCollection ?? "—", r.targetRecordId ?? "—", r.state] }))}
            />
          )}
        </div>
      )}
    </Card>
  );
}

function JobStatusBadge({ status }: { status: DataExchangeImportJob["status"] }) {
  if (status === "completed") return <Badge tone="ok">{status}</Badge>;
  if (status === "failed") return <Badge tone="error">{status}</Badge>;
  return <Badge tone="warn">{status}</Badge>;
}
