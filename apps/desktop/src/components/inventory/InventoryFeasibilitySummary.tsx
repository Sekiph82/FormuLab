import { useTranslation } from "react-i18next";
import { CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { FormulaInventoryFeasibility } from "@/lib/generatedFormulaInventory";

const FORMULA_STATE_ICON = {
  feasible: CheckCircle2,
  infeasible: XCircle,
  unknown: HelpCircle,
} as const;

const FORMULA_STATE_TONE = {
  feasible: "text-success",
  infeasible: "text-error",
  unknown: "text-muted",
} as const;

const LINE_STATE_ICON = {
  available: CheckCircle2,
  insufficient: XCircle,
  unknown: HelpCircle,
} as const;

const LINE_STATE_TONE = {
  available: "text-success",
  insufficient: "text-error",
  unknown: "text-muted",
} as const;

/**
 * FVL-03.004 — the one shared rendering of a `FormulaInventoryFeasibility`
 * result (formula-level badge + per-ingredient states), reused wherever
 * the new result UI shows inventory feasibility. Read-only display only —
 * this component never fetches, mutates, or reserves inventory; it only
 * renders a result already computed by `evaluateGeneratedFormulaInventory()`.
 *
 * Kept as its own component (not folded into `CostSnapshotSummary`) on
 * purpose — cost and inventory are separate dimensions (task §12), never
 * one combined display.
 */
export function InventoryFeasibilitySummary({
  feasibility,
}: {
  feasibility: FormulaInventoryFeasibility | undefined;
}) {
  const { t } = useTranslation(["session", "common"]);

  if (!feasibility) {
    return <p className="text-[11.5px] text-muted">{t("inventory.notYetAvailable")}</p>;
  }

  const FormulaIcon = FORMULA_STATE_ICON[feasibility.formulaState];

  return (
    <div>
      <div className={cn("mb-2 flex items-center gap-1.5 text-[12.5px] font-medium", FORMULA_STATE_TONE[feasibility.formulaState])}>
        <FormulaIcon size={14} aria-hidden />
        {t(`inventory.state.${feasibility.formulaState}`)}
      </div>
      <ul className="space-y-1">
        {feasibility.lines.map((line) => {
          const Icon = LINE_STATE_ICON[line.state];
          return (
            <li key={line.lineId} className="flex items-start gap-1.5 text-[11.5px]">
              <Icon size={12} className={cn("mt-0.5 shrink-0", LINE_STATE_TONE[line.state])} aria-hidden />
              <span>
                <span className="font-medium text-text">{line.displayName}</span>
                <span className="text-muted">
                  {" — "}
                  {t(`inventory.state.${line.state}`)}
                  {line.usableQuantity && line.unit && (
                    <>
                      {" · "}
                      {line.usableQuantity} {line.unit} {t("inventory.usable")}
                      {line.requiredQuantity && (
                        <> / {Number(line.requiredQuantity).toFixed(2)} {line.unit} {t("inventory.required")}</>
                      )}
                    </>
                  )}
                  {" — "}
                  {line.reason}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
