import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Calculator, Loader2 } from "lucide-react";
import { costFormulation, type CostSheet } from "@/lib/formulationV2";
import { AgentMessage } from "./atoms";

/**
 * Costs the displayed formula against the customer's imported raw-material
 * prices. The arithmetic happens in Python from those prices — no model is
 * involved — so every figure here can be checked by hand.
 *
 * Collapsed until asked for: a formula is useful without a cost, and costing
 * needs a material list the user may not have imported yet.
 */
export function CostingPanel({ formula }: { formula: unknown }) {
  const { t } = useTranslation(["session", "common"]);
  const [batch, setBatch] = useState("100");
  const [sheet, setSheet] = useState<CostSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const kg = Number(batch.replace(",", ".")) || 100;
      const res = await costFormulation(formula, kg);
      if (res.status === "ok") setSheet(res);
      else setError(res.message ?? "Costing failed.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-card border border-border bg-surface-2/40 p-4">
      <div className="print-hide flex flex-wrap items-center gap-2">
        <Calculator size={15} className="text-muted" />
        <span className="text-[13px] font-medium text-text">{t("studio.costing.title")}</span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          {t("studio.costing.batch")}
          <input
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            inputMode="decimal"
            className="w-20 rounded-input border border-border bg-surface px-2 py-1 text-right text-[12px] text-text outline-none focus:border-accent"
          />
          {t("builder.kgUnit")}
        </label>
        <button
          onClick={() => void run()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Calculator size={13} />}
          {t("studio.costing.calculate")}
        </button>
      </div>

      {error && <p className="mt-3 text-[13px] text-error">{error}</p>}

      {sheet && (
        <div className="mt-3">
          <AgentMessage markdown={sheet.markdown} />
          {!sheet.complete && (
            // A partial cost must never be mistaken for the real one.
            <p className="mt-2 text-[12px] text-warn">
              {t("studio.costing.partial", {
                pct: sheet.covered_pct,
                list: sheet.unmatched.join(", "),
              })}
            </p>
          )}
        </div>
      )}
      {!sheet && !error && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          {t("studio.costing.needMaterials")}
        </p>
      )}
    </div>
  );
}
