import { useTranslation } from "react-i18next";
import { CheckCircle2, HelpCircle, Wand2, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { shouldOfferSubstitution, type FormulaInventoryFeasibility } from "@/lib/generatedFormulaInventory";

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
  onFindSubstitute,
  substitutingIndex,
}: {
  feasibility: FormulaInventoryFeasibility | undefined;
  /** FVL-03.006 — index into `feasibility.lines` (== the generated formula's
   *  own ingredient order, since both are built from the same
   *  `formula.ingredients` array). Optional: a caller with no promotion/
   *  substitution seam wired (e.g. a future non-generated context) simply
   *  omits it and gets the FVL-03.004 read-only display unchanged. */
  onFindSubstitute?: (lineIndex: number) => void;
  /** Index of the line whose promotion/navigation is in flight, so only
   *  that one button shows a busy state — never every button at once. */
  substitutingIndex?: number | null;
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
        {feasibility.lines.map((line, i) => {
          const Icon = LINE_STATE_ICON[line.state];
          const offerSubstitution = onFindSubstitute && shouldOfferSubstitution(line);
          return (
            <li key={line.lineId} className="flex items-start gap-1.5 text-[11.5px]">
              <Icon size={12} className={cn("mt-0.5 shrink-0", LINE_STATE_TONE[line.state])} aria-hidden />
              <span className="min-w-0 flex-1">
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
              {offerSubstitution && (
                <button
                  onClick={() => onFindSubstitute(i)}
                  disabled={substitutingIndex === i}
                  className="ml-1 flex shrink-0 items-center gap-1 rounded-input border border-accent px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10 disabled:opacity-40"
                >
                  <Wand2 size={11} aria-hidden />
                  {substitutingIndex === i ? t("inventory.finding") : t("inventory.findSubstitute")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
