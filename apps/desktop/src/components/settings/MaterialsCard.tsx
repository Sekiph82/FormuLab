import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { pickFile } from "@/lib/tauri";
import {
  importMaterials,
  listMaterials,
  type ImportResult,
  type MaterialsDoc,
} from "@/lib/formulationV2";
import { Section } from "./Section";

/**
 * The customer's raw-material price list. Importing it is what turns a formula
 * into a costed formula: the pipeline proposes ingredients, and the costing
 * step prices them from THIS list, so the numbers are the customer's own.
 *
 * Column names are matched loosely (English and Turkish supplier headers), and
 * anything not understood is reported rather than guessed at.
 */
export function MaterialsCard() {
  const { t } = useTranslation("settings");
  const [doc, setDoc] = useState<MaterialsDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const refresh = useCallback(() => {
    void listMaterials()
      .then(setDoc)
      .catch(() => setDoc(null));
  }, []);
  useEffect(refresh, [refresh]);

  const onImport = async () => {
    const path = await pickFile(["csv", "tsv", "txt"]).catch(() => null);
    if (!path) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await importMaterials(path);
      setResult(res);
      refresh();
    } catch (e) {
      setResult({ status: "error", message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const count = doc?.materials?.length ?? 0;
  const priced = doc?.materials?.filter((m) => m.price != null).length ?? 0;

  return (
    <Section title={t("materials.title")} hint={t("materials.hint")}>
      <div className="flex items-center gap-3">
        <button
          onClick={() => void onImport()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-input border border-border bg-surface px-3 py-1.5 text-[13px] text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {t("materials.import")}
        </button>
        {count > 0 && (
          <span className="flex items-center gap-1.5 text-[13px] text-muted">
            <FileSpreadsheet size={14} />
            {t("materials.summary", { count, priced, currency: doc?.currency || "?" })}
          </span>
        )}
      </div>

      {result?.status === "error" && (
        <p className="mt-2 text-[13px] text-error">{result.message}</p>
      )}
      {!!result?.warnings?.length && (
        <ul className="mt-2 list-disc pl-5 text-[12px] text-muted">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {!!doc?.mixed_currencies?.length && (
        // Summing prices in different currencies would produce a meaningless
        // total, so this is surfaced rather than quietly added up.
        <p className="mt-2 text-[12px] text-warn">
          {t("materials.mixedCurrency", { list: doc.mixed_currencies.join(", ") })}
        </p>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        {t("materials.columns")}
      </p>
    </Section>
  );
}
