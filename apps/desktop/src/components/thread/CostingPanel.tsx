import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calculator } from "lucide-react";
import { costGeneratedFormula } from "@/lib/generatedFormulaCost";
import { useMasterCostData } from "@/hooks/useMasterCostData";
import { CostSnapshotSummary } from "@/components/cost/CostSnapshotSummary";

const CURRENCIES = ["KES", "USD", "EUR", "GBP", "TRY"];

/**
 * FVL-03.003: costs the displayed formula against the authoritative Cost
 * Engine (`packages/shared/src/engine/cost.ts`, via `costGeneratedFormula()`)
 * — real landed cost, exchange rates, missing-data honesty, the same
 * engine `CostPanel.tsx`'s manual formula builder already uses. No model
 * is involved, and as of this task no separate Python arithmetic either;
 * one authority, both UIs.
 *
 * Recalculates live as the batch size or currency changes — pure local
 * computation now, no subprocess round-trip, so there's nothing to wait
 * on.
 */
export function CostingPanel({ formula }: { formula: unknown }) {
  const { t } = useTranslation(["session", "common"]);
  const [batch, setBatch] = useState("100");
  const [currency, setCurrency] = useState("KES");
  const { materials, prices, rates, loading } = useMasterCostData();

  const snapshot = useMemo(() => {
    if (loading) return undefined;
    return costGeneratedFormula("live-session", "draft", formula, batch, currency, {
      materials,
      prices,
      rates,
    });
  }, [formula, batch, currency, materials, prices, rates, loading]);

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
            aria-label={t("studio.costing.batch")}
            className="w-20 rounded-input border border-border bg-surface px-2 py-1 text-right text-[12px] text-text outline-none focus:border-accent"
          />
          {t("builder.kgUnit")}
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          {t("cost.currency")}
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            aria-label={t("cost.currency")}
            className="rounded-input border border-border bg-surface px-2 py-1 text-[12px] text-text outline-none focus:border-accent"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3">
        <CostSnapshotSummary snapshot={snapshot} currency={currency} compact />
      </div>
    </div>
  );
}
