import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Upload } from "lucide-react";
import { previewImport, type FieldSpec, type ImportPreview } from "@ai4s/shared";
import { cn } from "@/lib/cn";

/**
 * Import a CSV, with a preview between reading the file and writing anything.
 *
 * The preview is the point. A spreadsheet from a supplier is full of surprises —
 * a decimal comma, a merged header, a blank code — and committing it blind
 * means discovering the damage afterwards, in the material library everyone
 * depends on. Nothing is written until the user has seen what would change.
 */
export function ImportDialog({
  title,
  fields,
  existingCodes,
  onCancel,
  onCommit,
}: {
  title: string;
  fields: FieldSpec[];
  existingCodes: string[];
  onCancel: () => void;
  onCommit: (records: Record<string, unknown>[]) => Promise<void> | void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [preview, setPreview] = useState<ImportPreview<Record<string, unknown>> | null>(null);
  const [filename, setFilename] = useState("");
  const [allowPartial, setAllowPartial] = useState(false);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    const text = await file.text();
    setFilename(file.name);
    setPreview(previewImport(text, fields, existingCodes));
    setAllowPartial(false);
  };

  const errors = preview?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = preview?.issues.filter((i) => i.severity === "warning") ?? [];
  // Rows that failed are never written. A partial import takes the good rows
  // only, and only when the user has explicitly chosen to.
  const canCommit =
    !!preview && preview.valid.length > 0 && (preview.invalidRows.length === 0 || allowPartial);

  const commit = async () => {
    if (!canCommit || !preview) return;
    setBusy(true);
    try {
      await onCommit(preview.valid);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t("materials.import")}
    >
      <div className="my-auto w-[46rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
        <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">
          {t("materials.importTitle", { what: title })}
        </h2>

        <div className="space-y-3 px-5 py-4">
          <label
            className={cn(
              "flex cursor-pointer items-center justify-center gap-2 rounded-input border border-dashed border-border",
              "px-4 py-6 text-[12px] text-muted hover:bg-surface-2",
            )}
          >
            <Upload size={14} aria-hidden />
            {filename || t("materials.chooseFile")}
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </label>

          {preview && (
            <>
              <div className="flex flex-wrap gap-2 text-[12px]">
                <Pill tone="ok" label={t("materials.willCreate")} value={preview.creates.length} />
                <Pill tone="warn" label={t("materials.willUpdate")} value={preview.updates.length} />
                <Pill tone="error" label={t("materials.willSkip")} value={preview.invalidRows.length} />
              </div>

              {preview.unmappedHeaders.length > 0 && (
                <p className="text-[11px] text-muted">
                  {t("materials.unmapped", { headers: preview.unmappedHeaders.join(", ") })}
                </p>
              )}

              {errors.length > 0 && (
                <div className="rounded-input border border-error/40 bg-error/5 px-3 py-2">
                  <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-error">
                    <AlertTriangle size={13} aria-hidden />
                    {t("materials.errorCount", { count: errors.length })}
                  </div>
                  <ul className="max-h-32 space-y-0.5 overflow-y-auto text-[11px] text-muted">
                    {errors.slice(0, 50).map((i, n) => (
                      <li key={n}>
                        {t("materials.rowLabel", { row: i.row })}
                        {i.column ? ` · ${i.column}` : ""}: {i.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {warnings.length > 0 && (
                <details className="rounded-input border border-border px-3 py-2">
                  <summary className="cursor-pointer text-[12px] text-muted">
                    {t("materials.warningCount", { count: warnings.length })}
                  </summary>
                  <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-[11px] text-muted">
                    {warnings.slice(0, 50).map((i, n) => (
                      <li key={n}>
                        {t("materials.rowLabel", { row: i.row })}: {i.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {preview.valid.length > 0 && (
                <details open className="rounded-input border border-border px-3 py-2">
                  <summary className="cursor-pointer text-[12px] text-muted">
                    {t("materials.previewRows", { count: preview.valid.length })}
                  </summary>
                  <div className="mt-2 max-h-48 overflow-auto">
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="text-left text-muted">
                          {Object.keys(preview.valid[0]).map((k) => (
                            <th key={k} className="px-1.5 py-1 font-medium">
                              {k}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.valid.slice(0, 25).map((row, i) => (
                          <tr key={i} className="border-t border-border-faint">
                            {Object.keys(preview.valid[0]).map((k) => (
                              <td key={k} className="px-1.5 py-1 text-text">
                                {Array.isArray(row[k]) ? (row[k] as string[]).join("; ") : String(row[k] ?? "")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              {preview.invalidRows.length > 0 && (
                <label className="flex items-start gap-2 text-[12px] text-text">
                  <input
                    type="checkbox"
                    checked={allowPartial}
                    onChange={(e) => setAllowPartial(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    {t("materials.partialImport", {
                      good: preview.valid.length,
                      bad: preview.invalidRows.length,
                    })}
                  </span>
                </label>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text"
          >
            {t("common:actions.cancel")}
          </button>
          <button
            onClick={commit}
            disabled={!canCommit || busy}
            className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {busy ? t("materials.importing") : t("materials.commit")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Pill({
  tone,
  label,
  value,
}: {
  tone: "ok" | "warn" | "error";
  label: string;
  value: number;
}) {
  return (
    <span
      className={cn(
        "rounded-input px-2 py-1 tabular-nums",
        tone === "ok" && "bg-ok/10 text-ok",
        tone === "warn" && "bg-warn/10 text-warn",
        tone === "error" && "bg-error/10 text-error",
      )}
    >
      {label} <strong>{value}</strong>
    </span>
  );
}
