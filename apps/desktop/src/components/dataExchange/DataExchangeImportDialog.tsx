import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Upload } from "lucide-react";
import {
  newId,
  parseCsv,
  previewDataExchangeImport,
  resolveColumnReferenceField,
  dataExchangeTemplateCsv,
  type ApprovalRole,
  type DataExchangeTemplateDefinition,
  type DataExchangePreview,
  type DataExchangeImportJob,
  type DataExchangeImportRowResult,
} from "@formulab/shared";
import { readWorkbookRows, rejectUnsupportedWorkbook } from "@/lib/xlsx";
import { commitDataExchangeRows, isTemplateCommitSupported, type DataExchangeRowCommitOutcome } from "@/lib/dataExchangeCommit";
import { buildReferenceResolver, loadExisting, loadExistingFormulaBom } from "@/lib/dataExchangeExisting";
import { upsertRecords, nowIso } from "@/lib/masterdata";
import { cn } from "@/lib/cn";
import { DisabledActionButton } from "@/components/help/DisabledActionButton";
import type { DisabledReason } from "@/lib/help/disabledReason";

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function existingFor(templateCode: string) {
  if (templateCode === "formula_bom") return loadExistingFormulaBom();
  return loadExisting(templateCode);
}

/**
 * Upload -> parse -> validate -> preview -> confirm -> commit, for any one
 * Data Exchange template. Same shape as the existing master-data
 * `ImportDialog.tsx` (upload, pill summary, error/warning lists, partial
 * checkbox) but built on the richer 9-state row classification and the
 * generic per-template commit dispatcher — nothing here is written until
 * the user explicitly confirms, and atomic mode (the default) refuses to
 * write anything at all if any row failed, unless partial mode is chosen.
 */
export function DataExchangeImportDialog({
  template,
  actorRole,
  actorUserId,
  onCancel,
  onCommitted,
}: {
  template: DataExchangeTemplateDefinition;
  actorRole: ApprovalRole;
  actorUserId: string;
  onCancel: () => void;
  onCommitted: (job: DataExchangeImportJob) => void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [filename, setFilename] = useState("");
  const [fileType, setFileType] = useState<"csv" | "xlsx">("csv");
  const [fileSize, setFileSize] = useState(0);
  const [fileHash, setFileHash] = useState("");
  const [preview, setPreview] = useState<DataExchangePreview | null>(null);
  const [allowPartial, setAllowPartial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<{ job: DataExchangeImportJob; outcomes: DataExchangeRowCommitOutcome[] } | null>(null);
  // The in-flight job row created the moment a preview succeeds (or fails
  // for a non-authorization reason) — so Import History shows every real
  // attempt, not just the ones a user goes on to confirm. Never created for
  // an authorization refusal: "no persistence/audit event after failed
  // authorization" per the Phase 6 spec.
  const [draftJob, setDraftJob] = useState<DataExchangeImportJob | null>(null);

  const onFile = async (file: File) => {
    setFileError(null);
    setCommitted(null);
    setDraftJob(null);
    setFilename(file.name);
    const isXlsx = /\.xlsx$/i.test(file.name);
    setFileType(isXlsx ? "xlsx" : "csv");
    const rejected = isXlsx ? rejectUnsupportedWorkbook(file.name) : null;
    if (rejected) {
      setFileError(rejected);
      setPreview(null);
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      setFileSize(bytes.byteLength);
      // A hash is recorded for the job's audit trail, but its absence must
      // never block reading/validating the file itself — Web Crypto isn't
      // guaranteed available in every runtime this ships to.
      const hash = await sha256Hex(bytes).catch(() => "");
      setFileHash(hash);
      const rows = isXlsx ? await readWorkbookRows(bytes) : parseCsv(new TextDecoder("utf-8").decode(bytes));
      const existing = await existingFor(template.templateCode);
      // Session 7 hardening (Part J): real code_reference existence
      // validation, wired to the same existing-record authority
      // `existingFor()` already uses for create-vs-update classification —
      // previously this preview call passed no `resolveReference` at all,
      // so a row referencing a nonexistent supplier/material silently
      // "passed" only because the check was never performed.
      //
      // Session 8 hardening (Part 3): FIELD-aware, not merely
      // template-aware — a column's own configured `referenceField` (or,
      // absent that, the target's unambiguous single natural-key field) is
      // resolved through `resolveColumnReferenceField()`, the SAME
      // function `previewDataExchangeImport()` itself uses, so the
      // resolver is built for exactly the fields the validator will
      // actually check. A column whose reference is genuinely
      // misconfigured (a composite target natural key with no explicit
      // `referenceField`) is skipped here — the validator reports that
      // row a structured configuration error on its own, never a silently
      // "passing" reference.
      const referenceRequirements = template.columns
        .filter((c) => c.dataType === "code_reference" && c.referenceTemplate)
        .map((c) => {
          const resolved = resolveColumnReferenceField(c);
          return "field" in resolved ? { referenceTemplate: c.referenceTemplate!, referenceField: resolved.field } : null;
        })
        .filter((r): r is { referenceTemplate: string; referenceField: string } => r !== null);
      const resolveReference = await buildReferenceResolver(referenceRequirements);
      const p = previewDataExchangeImport(template, rows, {
        actorRole,
        fileSizeBytes: bytes.byteLength,
        existingNaturalKeys: existing.naturalKeys,
        resolveReference,
      });
      setPreview(p);
      if (!p.authorizationDenied) {
        const supported = isTemplateCommitSupported(template.templateCode);
        const job: DataExchangeImportJob = {
          schemaVersion: "1.0",
          id: newId("dxjob"),
          templateCode: template.templateCode,
          templateSchemaVersion: template.schemaVersion,
          fileName: file.name,
          fileType: isXlsx ? "xlsx" : "csv",
          fileSize: bytes.byteLength,
          sha256: hash,
          status: p.fatalError ? "validation_failed" : !supported ? "unsupported" : "awaiting_confirmation",
          mode: "atomic",
          totalRows: p.totalRows,
          validRows: p.validRows,
          invalidRows: p.invalidRows + p.referenceErrors + p.duplicates,
          createdRows: 0,
          updatedRows: 0,
          unchangedRows: p.unchanged,
          duplicateRows: p.duplicates,
          warningRows: p.warnings,
          startedBy: actorUserId,
          startedAt: nowIso(),
          notes: p.fatalError,
        };
        await upsertRecords("data_exchange_import_jobs", [job]);
        setDraftJob(job);
      }
    } catch {
      setFileError(t("dataExchange.import.fileUnreadable"));
      setPreview(null);
    }
    setAllowPartial(false);
  };

  const cancel = () => {
    if (draftJob && !committed) {
      void upsertRecords("data_exchange_import_jobs", [{ ...draftJob, status: "cancelled", completedAt: nowIso() }]);
    }
    onCancel();
  };

  const supported = isTemplateCommitSupported(template.templateCode);
  const rows = preview?.rows ?? [];
  const errorRows = rows.filter((r) => r.state === "invalid" || r.state === "reference_missing" || r.state === "duplicate");
  const warningRows = rows.filter((r) => r.state === "warning");
  const committableStates = new Set(["valid_create", "valid_update", "unchanged", "warning"]);
  const committableRows = rows.filter((r) => committableStates.has(r.state));
  const canCommit =
    supported && !!preview && !preview.fatalError && committableRows.length > 0 && (errorRows.length === 0 || allowPartial);

  // Built from the exact conditions `canCommit` already checks — never a
  // separately invented reason.
  const commitDisabledReason: DisabledReason | null = busy
    ? { code: "data_exchange_commit_busy", messageKey: "dataExchange.reasons.commitBusy", resolvable: true }
    : !supported
      ? { code: "data_exchange_template_unsupported", messageKey: "dataExchange.reasons.templateUnsupported", relatedTopicId: "dataExchange", resolvable: false }
      : !preview || preview.fatalError
        ? { code: "data_exchange_no_preview", messageKey: "dataExchange.reasons.noValidPreview", relatedTopicId: "dataExchange", resolvable: true }
        : committableRows.length === 0
          ? { code: "data_exchange_nothing_committable", messageKey: "dataExchange.reasons.nothingCommittable", relatedTopicId: "dataExchange", resolvable: true }
          : errorRows.length > 0 && !allowPartial
            ? {
                code: "data_exchange_has_errors",
                messageKey: "dataExchange.reasons.hasErrors",
                messageValues: { count: errorRows.length },
                prerequisite: t("dataExchange.reasons.allowPartialPrerequisite"),
                relatedTopicId: "dataExchange",
                resolvable: true,
              }
            : null;

  const commit = async () => {
    if (!canCommit || !preview || !supported) return;
    setBusy(true);
    try {
      const toCommit = allowPartial ? committableRows : rows.filter((r) => committableStates.has(r.state));
      const outcomes = await commitDataExchangeRows(template, toCommit, { actorUserId, actorRole });
      const created = outcomes.filter((o) => o.outcome === "created").length;
      const updated = outcomes.filter((o) => o.outcome === "updated").length;
      const unchanged = outcomes.filter((o) => o.outcome === "unchanged").length;
      const failed = outcomes.filter((o) => o.outcome === "failed").length;
      const job: DataExchangeImportJob = {
        schemaVersion: "1.0",
        id: draftJob?.id ?? newId("dxjob"),
        templateCode: template.templateCode,
        templateSchemaVersion: template.schemaVersion,
        fileName: filename,
        fileType,
        fileSize,
        sha256: fileHash,
        status: failed > 0 ? (created + updated > 0 ? "completed_with_warnings" : "failed") : "completed",
        mode: allowPartial ? "partial" : "atomic",
        totalRows: preview.totalRows,
        validRows: preview.validRows,
        invalidRows: preview.invalidRows + preview.referenceErrors + preview.duplicates,
        createdRows: created,
        updatedRows: updated,
        unchangedRows: unchanged,
        duplicateRows: preview.duplicates,
        warningRows: preview.warnings,
        startedBy: actorUserId,
        startedAt: draftJob?.startedAt ?? nowIso(),
        committedBy: actorUserId,
        committedAt: nowIso(),
        completedAt: nowIso(),
        notes: failed > 0 ? `${failed} row(s) failed to commit.` : undefined,
      };
      await upsertRecords("data_exchange_import_jobs", [job]);
      const rowResults: DataExchangeImportRowResult[] = outcomes.map((o) => ({
        schemaVersion: "1.0",
        id: newId("dxrow"),
        jobId: job.id,
        rowNumber: o.rowNumber,
        naturalKey: o.naturalKey,
        state: o.outcome === "failed" ? "invalid" : o.outcome === "unchanged" ? "unchanged" : "valid_create",
        messages: o.message ? [o.message] : [],
        targetCollection: o.targetCollection,
        targetRecordId: o.targetRecordId,
      }));
      await upsertRecords("data_exchange_import_row_results", rowResults);
      setCommitted({ job, outcomes });
      onCommitted(job);
    } finally {
      setBusy(false);
    }
  };

  const downloadErrorReport = () => {
    const errorRowsForReport = [...errorRows, ...warningRows];
    const csvRows = errorRowsForReport.map((r) => ({
      row_number: r.rowNumber,
      template_code: template.templateCode,
      column: "",
      provided_value: r.naturalKey,
      error_code: r.state,
      severity: r.state === "warning" ? "warning" : "error",
      message: r.messages.join(" | "),
      suggested_action: r.state === "duplicate" ? "Remove the repeated row." : r.state === "reference_missing" ? "Fix the referenced code, or import the referenced template first." : "Correct the value and re-upload.",
    }));
    const csv = dataExchangeTemplateCsv(
      {
        ...template,
        columns: [
          { key: "row_number", header: "row_number", description: "", dataType: "integer", required: true, nullable: false, importable: false, exportable: true },
          { key: "template_code", header: "template_code", description: "", dataType: "string", required: true, nullable: false, importable: false, exportable: true },
          { key: "column", header: "column", description: "", dataType: "string", required: false, nullable: true, importable: false, exportable: true },
          { key: "provided_value", header: "provided_value", description: "", dataType: "string", required: false, nullable: true, importable: false, exportable: true },
          { key: "error_code", header: "error_code", description: "", dataType: "string", required: true, nullable: false, importable: false, exportable: true },
          { key: "severity", header: "severity", description: "", dataType: "string", required: true, nullable: false, importable: false, exportable: true },
          { key: "message", header: "message", description: "", dataType: "string", required: false, nullable: true, importable: false, exportable: true },
          { key: "suggested_action", header: "suggested_action", description: "", dataType: "string", required: false, nullable: true, importable: false, exportable: true },
        ],
      },
      csvRows,
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${template.templateCode}_error_report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" role="dialog" aria-modal="true" aria-label={t("dataExchange.import.title", { template: template.title })}>
      <div className="my-auto w-[54rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
        <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">{t("dataExchange.import.title", { template: template.title })}</h2>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4">
          <label className={cn("flex cursor-pointer items-center justify-center gap-2 rounded-input border border-dashed border-border", "px-4 py-6 text-[12px] text-muted hover:bg-surface-2")}>
            <Upload size={14} aria-hidden />
            {filename || t("dataExchange.import.chooseFile")}
            <input
              type="file"
              accept=".csv,text/csv,text/plain,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </label>

          {fileError && (
            <div role="alert" className="flex items-center gap-1.5 rounded-input border border-error/40 bg-error/5 px-3 py-2 text-[12px] text-error">
              <AlertTriangle size={13} aria-hidden />
              {fileError}
            </div>
          )}

          {preview?.fatalError && (
            <div role="alert" className="flex items-center gap-1.5 rounded-input border border-error/40 bg-error/5 px-3 py-2 text-[12px] text-error">
              <AlertTriangle size={13} aria-hidden />
              {preview.fatalError}
            </div>
          )}

          {preview && !preview.fatalError && !supported && (
            <div role="alert" className="flex items-center gap-1.5 rounded-input border border-warn/40 bg-warn/5 px-3 py-2 text-[12px] text-warn">
              <AlertTriangle size={13} aria-hidden />
              {t("dataExchange.import.unsupported", { template: template.title })}
            </div>
          )}

          {preview && !preview.fatalError && (
            <>
              <div className="flex flex-wrap gap-2 text-[12px]">
                <Pill tone="ok" label={t("dataExchange.preview.create")} value={preview.newRecords} />
                <Pill tone="ok" label={t("dataExchange.preview.update")} value={preview.updates} />
                <Pill tone="neutral" label={t("dataExchange.preview.unchanged")} value={preview.unchanged} />
                <Pill tone="warn" label={t("dataExchange.preview.duplicate")} value={preview.duplicates} />
                <Pill tone="warn" label={t("dataExchange.preview.warning")} value={preview.warnings} />
                <Pill tone="error" label={t("dataExchange.preview.invalid")} value={preview.invalidRows} />
                <Pill tone="error" label={t("dataExchange.preview.referenceMissing")} value={preview.referenceErrors} />
              </div>

              {preview.unmappedHeaders.length > 0 && (
                <p className="text-[11px] text-muted">{t("dataExchange.import.unmapped", { headers: preview.unmappedHeaders.join(", ") })}</p>
              )}

              {(errorRows.length > 0 || warningRows.length > 0) && (
                <div className="rounded-input border border-border px-3 py-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[12px] font-medium text-text">{t("dataExchange.import.rowIssues", { count: errorRows.length + warningRows.length })}</span>
                    <button onClick={downloadErrorReport} className="rounded-input border border-border px-2 py-0.5 text-[11px] text-muted hover:bg-surface-2">
                      {t("dataExchange.import.downloadErrorReport")}
                    </button>
                  </div>
                  <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[11px] text-muted">
                    {[...errorRows, ...warningRows].slice(0, 100).map((r, i) => (
                      <li key={i}>
                        {t("dataExchange.import.rowLabel", { row: r.rowNumber })} · {r.naturalKey} · <span className={r.state === "warning" ? "text-warn" : "text-error"}>{r.state}</span>: {r.messages.join(" ")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {committableRows.length > 0 && (
                <details open className="rounded-input border border-border px-3 py-2">
                  <summary className="cursor-pointer text-[12px] text-muted">{t("dataExchange.import.previewRows", { count: committableRows.length })}</summary>
                  <div className="mt-2 max-h-48 overflow-auto">
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="text-left text-muted">
                          <th className="px-1.5 py-1 font-medium">{t("dataExchange.import.columnRow")}</th>
                          <th className="px-1.5 py-1 font-medium">{t("dataExchange.import.columnKey")}</th>
                          <th className="px-1.5 py-1 font-medium">{t("dataExchange.import.columnState")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {committableRows.slice(0, 50).map((r) => (
                          <tr key={r.rowNumber} className="border-t border-border-faint">
                            <td className="px-1.5 py-1 text-text">{r.rowNumber}</td>
                            <td className="px-1.5 py-1 text-text">{r.naturalKey}</td>
                            <td className="px-1.5 py-1 text-text">{r.state}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              {errorRows.length > 0 && (
                <label className="flex items-start gap-2 text-[12px] text-text">
                  <input type="checkbox" checked={allowPartial} onChange={(e) => setAllowPartial(e.target.checked)} className="mt-0.5" />
                  <span>{t("dataExchange.import.partialImport", { good: committableRows.length, bad: errorRows.length })}</span>
                </label>
              )}
            </>
          )}

          {committed && (
            <div className="rounded-input border border-ok/40 bg-ok/5 px-3 py-2 text-[12px] text-text">
              {t("dataExchange.import.committed", { created: committed.outcomes.filter((o) => o.outcome === "created").length, updated: committed.outcomes.filter((o) => o.outcome === "updated").length, status: committed.job.status })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={cancel} className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text">
            {t("common:actions.cancel")}
          </button>
          {!committed && (
            <DisabledActionButton
              reason={commitDisabledReason}
              onClick={() => void commit()}
              ns="session"
              className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
            >
              {busy ? t("dataExchange.import.importing") : !supported && preview && !preview.fatalError ? t("dataExchange.import.notSupported") : t("dataExchange.import.commit")}
            </DisabledActionButton>
          )}
        </div>
      </div>
    </div>
  );
}

function Pill({ tone, label, value }: { tone: "ok" | "warn" | "error" | "neutral"; label: string; value: number }) {
  return (
    <span
      className={cn(
        "rounded-input px-2 py-1 tabular-nums",
        tone === "ok" && "bg-ok/10 text-ok",
        tone === "warn" && "bg-warn/10 text-warn",
        tone === "error" && "bg-error/10 text-error",
        tone === "neutral" && "bg-surface-2 text-muted",
      )}
    >
      {label} <strong>{value}</strong>
    </span>
  );
}
