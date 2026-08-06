import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileSpreadsheet, History, Upload } from "lucide-react";
import {
  listDataExchangeTemplates,
  dataExchangeBlankCsv,
  dataExchangeExampleCsv,
  dataExchangeTemplateCsv,
  dataExchangeCsvFileName,
  newId,
  type ApprovalRole,
  type DataExchangeImportJob,
  type DataExchangeTemplateDefinition,
} from "@formulab/shared";
import { APPROVAL_ROLES } from "@formulab/shared";
import { buildDataExchangeWorkbookBlob, dataExchangeXlsxFileName } from "@/lib/dataExchangeXlsx";
import { loadExisting, loadExistingFormulaBom } from "@/lib/dataExchangeExisting";
import { listRecords, upsertRecords, nowIso } from "@/lib/masterdata";
import { DataExchangeImportDialog } from "@/components/dataExchange/DataExchangeImportDialog";
import { cn } from "@/lib/cn";

type Section = "templates" | "exports" | "imports" | "validation" | "history" | "schemas" | "help";
const SECTIONS: Section[] = ["templates", "exports", "imports", "validation", "history", "schemas", "help"];

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function existingRowsFor(templateCode: string) {
  if (templateCode === "formula_bom") return (await loadExistingFormulaBom()).rows;
  return (await loadExisting(templateCode)).rows;
}

/**
 * The Data Exchange Center — a standalone, project-less workspace (like
 * Administration): download/fill/validate/preview/import/export structured
 * data through the 24 mandated CSV/Excel templates. No import commits
 * before an explicit preview and confirmation — see
 * `DataExchangeImportDialog`.
 */
export function DataExchangePage() {
  const { t } = useTranslation(["session", "common"]);
  const [section, setSection] = useState<Section>("templates");
  const [actorRole, setActorRole] = useState<ApprovalRole>("administrator");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [uploadTemplate, setUploadTemplate] = useState<DataExchangeTemplateDefinition | null>(null);
  const [jobs, setJobs] = useState<DataExchangeImportJob[]>([]);
  const [exportLog, setExportLog] = useState<{ id: string; templateCode: string; kind: string; fileType: string; at: string }[]>([]);
  const [busyExport, setBusyExport] = useState<string | null>(null);

  const templates = useMemo(() => listDataExchangeTemplates(), []);
  const modules = useMemo(() => ["all", ...Array.from(new Set(templates.map((t2) => t2.module)))], [templates]);
  const visibleTemplates = moduleFilter === "all" ? templates : templates.filter((t2) => t2.module === moduleFilter);

  const refreshJobs = () => {
    void listRecords("data_exchange_import_jobs").then((rows) => setJobs([...rows].sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1))));
  };
  useEffect(refreshJobs, []);

  const recordExport = async (template: DataExchangeTemplateDefinition, kind: "blank" | "example" | "current_data", fileType: "csv" | "xlsx") => {
    const job = {
      schemaVersion: "1.0" as const,
      id: newId("dxexport"),
      templateCode: template.templateCode,
      templateSchemaVersion: template.schemaVersion,
      exportType: kind,
      fileType,
      rowCount: 0,
      requestedBy: actorRole,
      requestedAt: nowIso(),
    };
    await upsertRecords("data_exchange_export_jobs", [job]);
    setExportLog((log) => [{ id: job.id, templateCode: template.templateCode, kind, fileType, at: job.requestedAt }, ...log].slice(0, 100));
  };

  const downloadBlankCsv = (template: DataExchangeTemplateDefinition) => {
    downloadBlob(dataExchangeCsvFileName(template, "blank"), new Blob([dataExchangeBlankCsv(template)], { type: "text/csv;charset=utf-8" }));
    void recordExport(template, "blank", "csv");
  };
  const downloadExampleCsv = (template: DataExchangeTemplateDefinition) => {
    downloadBlob(dataExchangeCsvFileName(template, "example"), new Blob([dataExchangeExampleCsv(template)], { type: "text/csv;charset=utf-8" }));
    void recordExport(template, "example", "csv");
  };
  const downloadBlankXlsx = async (template: DataExchangeTemplateDefinition) => {
    setBusyExport(`${template.templateCode}:blank:xlsx`);
    try {
      downloadBlob(dataExchangeXlsxFileName(template, "blank"), await buildDataExchangeWorkbookBlob(template, []));
      await recordExport(template, "blank", "xlsx");
    } finally {
      setBusyExport(null);
    }
  };
  const downloadExampleXlsx = async (template: DataExchangeTemplateDefinition) => {
    setBusyExport(`${template.templateCode}:example:xlsx`);
    try {
      downloadBlob(dataExchangeXlsxFileName(template, "example"), await buildDataExchangeWorkbookBlob(template, template.exampleRows));
      await recordExport(template, "example", "xlsx");
    } finally {
      setBusyExport(null);
    }
  };
  const downloadCurrentCsv = async (template: DataExchangeTemplateDefinition) => {
    setBusyExport(`${template.templateCode}:current:csv`);
    try {
      const rows = await existingRowsFor(template.templateCode);
      downloadBlob(dataExchangeCsvFileName(template, "current-data"), new Blob([dataExchangeTemplateCsv(template, rows)], { type: "text/csv;charset=utf-8" }));
      await recordExport(template, "current_data", "csv");
    } finally {
      setBusyExport(null);
    }
  };
  const downloadCurrentXlsx = async (template: DataExchangeTemplateDefinition) => {
    setBusyExport(`${template.templateCode}:current:xlsx`);
    try {
      const rows = await existingRowsFor(template.templateCode);
      downloadBlob(dataExchangeXlsxFileName(template, "current-data"), await buildDataExchangeWorkbookBlob(template, rows));
      await recordExport(template, "current_data", "xlsx");
    } finally {
      setBusyExport(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        <h1 className="text-[13px] font-medium text-text">{t("dataExchange.heading")}</h1>
        <nav className="flex flex-wrap gap-1">
          {SECTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={cn("rounded-input px-2.5 py-1 text-xs", section === s ? "bg-surface-2 font-medium text-text" : "text-muted hover:text-text")}
            >
              {t(`dataExchange.sections.${s}`)}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-[12px] text-muted">
          {t("dataExchange.actorRole")}
          <select value={actorRole} onChange={(e) => setActorRole(e.target.value as ApprovalRole)} className="rounded-input border border-border bg-surface px-1.5 py-0.5 text-text">
            {APPROVAL_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {section === "templates" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {modules.map((m) => (
                <button
                  key={m}
                  onClick={() => setModuleFilter(m)}
                  className={cn("rounded-input px-2 py-1 text-[11px]", moduleFilter === m ? "bg-surface-2 font-medium text-text" : "text-muted hover:text-text")}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleTemplates.map((template) => (
                <TemplateCard
                  key={template.templateCode}
                  template={template}
                  busyExport={busyExport}
                  onDownloadBlankCsv={() => downloadBlankCsv(template)}
                  onDownloadExampleCsv={() => downloadExampleCsv(template)}
                  onDownloadBlankXlsx={() => void downloadBlankXlsx(template)}
                  onDownloadExampleXlsx={() => void downloadExampleXlsx(template)}
                  onDownloadCurrentCsv={() => void downloadCurrentCsv(template)}
                  onDownloadCurrentXlsx={() => void downloadCurrentXlsx(template)}
                  onUpload={() => setUploadTemplate(template)}
                />
              ))}
            </div>
          </div>
        )}

        {section === "exports" && (
          <Section title={t("dataExchange.sections.exports")}>
            {exportLog.length === 0 ? (
              <Empty text={t("dataExchange.exports.empty")} />
            ) : (
              <Table
                headers={[t("dataExchange.history.date"), t("dataExchange.history.template"), t("dataExchange.exports.kind"), t("dataExchange.history.fileType")]}
                rows={exportLog.map((e) => [new Date(e.at).toLocaleString(), e.templateCode, e.kind, e.fileType])}
              />
            )}
          </Section>
        )}

        {section === "imports" && (
          <Section title={t("dataExchange.sections.imports")}>
            <p className="mb-3 text-[12px] text-muted">{t("dataExchange.imports.description")}</p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {templates.map((template) => (
                <button
                  key={template.templateCode}
                  onClick={() => setUploadTemplate(template)}
                  className="flex items-center gap-2 rounded-input border border-border px-3 py-2 text-left text-[12px] hover:bg-surface-2"
                >
                  <Upload size={13} className="text-muted" />
                  <span className="text-text">{template.title}</span>
                </button>
              ))}
            </div>
          </Section>
        )}

        {section === "validation" && (
          <Section title={t("dataExchange.sections.validation")}>
            <Empty text={t("dataExchange.validation.empty")} />
          </Section>
        )}

        {section === "history" && (
          <Section title={t("dataExchange.sections.history")}>
            {jobs.length === 0 ? (
              <Empty text={t("dataExchange.history.empty")} />
            ) : (
              <Table
                headers={[t("dataExchange.history.date"), t("dataExchange.history.template"), t("dataExchange.history.file"), t("dataExchange.history.status"), t("dataExchange.history.created"), t("dataExchange.history.updated"), t("dataExchange.history.errors")]}
                rows={jobs.map((j) => [new Date(j.startedAt).toLocaleString(), j.templateCode, j.fileName, j.status, String(j.createdRows), String(j.updatedRows), String(j.invalidRows)])}
              />
            )}
          </Section>
        )}

        {section === "schemas" && (
          <Section title={t("dataExchange.sections.schemas")}>
            <Table
              headers={[t("dataExchange.schemas.template"), t("dataExchange.schemas.version"), t("dataExchange.schemas.naturalKey"), t("dataExchange.schemas.duplicatePolicy")]}
              rows={templates.map((t2) => [t2.title, t2.schemaVersion, t2.naturalKey.join(", "), t2.duplicatePolicy])}
            />
          </Section>
        )}

        {section === "help" && (
          <Section title={t("dataExchange.sections.help")}>
            <div className="max-w-2xl space-y-2 text-[12px] text-muted">
              <p>{t("dataExchange.help.intro")}</p>
              <p>{t("dataExchange.help.rowStates")}</p>
              <p>{t("dataExchange.help.security")}</p>
              <p>{t("dataExchange.help.authorization")}</p>
            </div>
          </Section>
        )}
      </div>

      {uploadTemplate && (
        <DataExchangeImportDialog
          key={uploadTemplate.templateCode}
          template={uploadTemplate}
          actorRole={actorRole}
          // eslint-disable-next-line i18next/no-literal-string -- internal actor id, not display text
          actorUserId="local"
          onCancel={() => {
            setUploadTemplate(null);
            refreshJobs();
          }}
          onCommitted={() => {
            refreshJobs();
          }}
        />
      )}
    </div>
  );
}

function TemplateCard({
  template,
  busyExport,
  onDownloadBlankCsv,
  onDownloadExampleCsv,
  onDownloadBlankXlsx,
  onDownloadExampleXlsx,
  onDownloadCurrentCsv,
  onDownloadCurrentXlsx,
  onUpload,
}: {
  template: DataExchangeTemplateDefinition;
  busyExport: string | null;
  onDownloadBlankCsv: () => void;
  onDownloadExampleCsv: () => void;
  onDownloadBlankXlsx: () => void;
  onDownloadExampleXlsx: () => void;
  onDownloadCurrentCsv: () => void;
  onDownloadCurrentXlsx: () => void;
  onUpload: () => void;
}) {
  const { t } = useTranslation("session");
  const [showDocs, setShowDocs] = useState(false);
  const requiredCount = template.columns.filter((c) => c.required).length;

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[13px] font-medium text-text">{template.title}</div>
          <div className="text-[11px] text-muted">{template.description}</div>
        </div>
        <FileSpreadsheet size={16} className="shrink-0 text-muted" />
      </div>
      <div className="flex flex-wrap gap-1 text-[10px] text-muted">
        <span className="rounded bg-surface-2 px-1.5 py-0.5">{template.module}</span>
        {/* eslint-disable-next-line i18next/no-literal-string -- schema version label, not natural-language text */}
        <span className="rounded bg-surface-2 px-1.5 py-0.5">v{template.schemaVersion}</span>
        {/* eslint-disable-next-line i18next/no-literal-string -- format label, not natural-language text */}
        <span className="rounded bg-surface-2 px-1.5 py-0.5">CSV + Excel</span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5">
          {t("dataExchange.card.requiredFields", { count: requiredCount })}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        <button onClick={onDownloadBlankCsv} className="flex items-center justify-center gap-1 rounded-input border border-border px-2 py-1 text-muted hover:bg-surface-2">
          <Download size={11} /> {t("dataExchange.card.blankCsv")}
        </button>
        <button onClick={onDownloadBlankXlsx} disabled={busyExport === `${template.templateCode}:blank:xlsx`} className="flex items-center justify-center gap-1 rounded-input border border-border px-2 py-1 text-muted hover:bg-surface-2 disabled:opacity-50">
          <Download size={11} /> {t("dataExchange.card.blankExcel")}
        </button>
        <button onClick={onDownloadExampleCsv} className="flex items-center justify-center gap-1 rounded-input border border-border px-2 py-1 text-muted hover:bg-surface-2">
          <Download size={11} /> {t("dataExchange.card.exampleCsv")}
        </button>
        <button onClick={onDownloadExampleXlsx} disabled={busyExport === `${template.templateCode}:example:xlsx`} className="flex items-center justify-center gap-1 rounded-input border border-border px-2 py-1 text-muted hover:bg-surface-2 disabled:opacity-50">
          <Download size={11} /> {t("dataExchange.card.exampleExcel")}
        </button>
        <button onClick={onDownloadCurrentCsv} disabled={busyExport === `${template.templateCode}:current:csv`} className="flex items-center justify-center gap-1 rounded-input border border-border px-2 py-1 text-muted hover:bg-surface-2 disabled:opacity-50">
          <Download size={11} /> {t("dataExchange.card.currentCsv")}
        </button>
        <button onClick={onDownloadCurrentXlsx} disabled={busyExport === `${template.templateCode}:current:xlsx`} className="flex items-center justify-center gap-1 rounded-input border border-border px-2 py-1 text-muted hover:bg-surface-2 disabled:opacity-50">
          <Download size={11} /> {t("dataExchange.card.currentExcel")}
        </button>
      </div>
      <div className="flex gap-1.5">
        <button onClick={onUpload} className="flex flex-1 items-center justify-center gap-1 rounded-input bg-accent px-2 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90">
          <Upload size={12} /> {t("dataExchange.card.upload")}
        </button>
        <button onClick={() => setShowDocs((v) => !v)} className="rounded-input border border-border px-2 py-1.5 text-[11px] text-muted hover:bg-surface-2">
          {t("dataExchange.card.fields")}
        </button>
      </div>
      {showDocs && (
        <div className="max-h-40 overflow-y-auto rounded-input border border-border-faint bg-surface-2 p-2 text-[10.5px] text-muted">
          {/* eslint-disable i18next/no-literal-string -- column key/data type are technical identifiers from the registry, not natural-language UI text */}
          <ul className="space-y-0.5">
            {template.columns.map((c) => (
              <li key={c.key}>
                <span className={c.required ? "font-medium text-text" : "text-text"}>{c.key}</span> ({c.dataType}
                {c.required ? `, ${t("dataExchange.card.requiredFieldFlag")}` : ""}) — {c.description}
              </li>
            ))}
          </ul>
          {/* eslint-enable i18next/no-literal-string */}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h3 className="mb-3 text-[13px] font-semibold text-text">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center text-[12px] text-muted">
      <History size={20} />
      {text}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-left text-muted">
            {headers.map((h) => (
              <th key={h} className="px-1.5 py-1 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border-faint">
              {row.map((cell, j) => (
                <td key={j} className="px-1.5 py-1 text-text">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

