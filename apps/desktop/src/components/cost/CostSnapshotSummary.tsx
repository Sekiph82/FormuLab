import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { displayMoney, type CostSnapshot } from "@formulab/shared";
import { cn } from "@/lib/cn";

/**
 * FVL-03.003 — the one shared rendering of a `CostSnapshot`'s layered
 * money grid + missing-data warnings, reused by `CostingPanel.tsx` (old
 * `/live` UI) and `FormulationResultPage.tsx` (new result UI). Reuses the
 * same `cost.*` translation keys `CostPanel.tsx` already uses for the
 * manual formula-builder's own cost display — one vocabulary, not two.
 *
 * `CostPanel.tsx` itself is not built on this component — it already has
 * its own richer SKU/line-detail tables and works correctly; this
 * component exists for the two surfaces that had no cost rendering at
 * all before this task.
 */
export function CostSnapshotSummary({
  snapshot,
  currency,
  compact,
}: {
  snapshot: CostSnapshot | undefined;
  currency: string;
  compact?: boolean;
}) {
  const { t } = useTranslation(["session", "common"]);

  if (!snapshot) {
    return <p className="text-[11.5px] text-muted">{t("cost.notYetAvailable")}</p>;
  }

  return (
    <div>
      <div
        className={cn(
          "grid gap-2",
          compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
        )}
      >
        <Money label={t("cost.rawMaterial")} value={snapshot.rawMaterialCost} currency={currency} />
        <Money label={t("cost.landed")} value={snapshot.landedMaterialCost} currency={currency} />
        {!compact && (
          <>
            <Money label={t("cost.labour")} value={snapshot.labourCost} currency={currency} />
            <Money label={t("cost.utilities")} value={snapshot.utilitiesCost} currency={currency} />
            <Money label={t("cost.qc")} value={snapshot.qcCost} currency={currency} />
            <Money label={t("cost.waste")} value={snapshot.wasteCost} currency={currency} />
            <Money label={t("cost.overhead")} value={snapshot.overheadCost} currency={currency} />
          </>
        )}
        <Money
          label={t("cost.totalManufacturing")}
          value={snapshot.totalManufacturingCost}
          currency={currency}
          emphasis
        />
        <Money label={t("cost.perKg")} value={snapshot.costPerKg} currency={currency} />
      </div>

      {snapshot.missingDataWarnings.length > 0 && (
        <div className="mt-3 rounded-card border border-warn/40 bg-warn/5 px-3 py-2">
          <h3 className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-warn">
            <AlertTriangle size={13} aria-hidden />
            {t("cost.incomplete")}
          </h3>
          <ul className="space-y-0.5 text-[11px] text-muted">
            {snapshot.missingDataWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Money({
  label,
  value,
  currency,
  emphasis,
}: {
  label: string;
  value?: string;
  currency: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-card border px-3 py-2",
        emphasis ? "border-accent/40 bg-accent/5" : "border-border",
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div
        className={cn(
          "mt-0.5 tabular-nums",
          emphasis ? "text-[14px] font-medium text-text" : "text-[13px] text-text",
        )}
      >
        {value ? displayMoney(value, currency) : "—"}
      </div>
    </div>
  );
}
