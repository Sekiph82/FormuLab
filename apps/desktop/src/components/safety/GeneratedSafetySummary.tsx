import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { GeneratedFormulaSafety } from "@/lib/generatedFormulaSafety";

const FORMULA_STATE_ICON = {
  safe: CheckCircle2,
  warning: AlertTriangle,
  blocked: XCircle,
  unknown: HelpCircle,
} as const;

const FORMULA_STATE_TONE = {
  safe: "text-success",
  warning: "text-warning",
  blocked: "text-error",
  unknown: "text-muted",
} as const;

const SEVERITY_TONE = {
  blocking: "text-error",
  error: "text-error",
  warning: "text-warning",
  info: "text-muted",
} as const;

/**
 * FVL-03.009 — a thin, read-only presenter for a `GeneratedFormulaSafety`
 * result. Renders the authoritative `evaluateSafety()` output as-is;
 * decides nothing itself (no hazard scoring, no rule matching) — a display
 * component, not a second Safety Engine. Named distinctly from
 * `SafetyPanel.tsx` (the project-bound, saved-version panel with pH/
 * temperature inputs, GHS pictograms, and a resolution/audit workflow)
 * since this one evaluates a generated, not-yet-necessarily-saved card
 * read-only, with no persistence step at all — mirrors
 * `GeneratedCompatibilitySummary.tsx` exactly.
 */
export function GeneratedSafetySummary({
  safety,
}: {
  safety: GeneratedFormulaSafety | undefined;
}) {
  const { t } = useTranslation(["session", "common"]);

  if (!safety) {
    return <p className="text-[11.5px] text-muted">{t("safety.notYetAvailable")}</p>;
  }

  const FormulaIcon = FORMULA_STATE_ICON[safety.formulaState];

  return (
    <div>
      <div className={cn("mb-2 flex items-center gap-1.5 text-[12.5px] font-medium", FORMULA_STATE_TONE[safety.formulaState])}>
        <FormulaIcon size={14} aria-hidden />
        {t(`safety.state.${safety.formulaState}`)}
      </div>

      {safety.unresolvedMaterialCount > 0 && (
        <p className="mb-2 text-[11px] text-muted">
          {t("safety.unresolvedMaterialCount", { count: safety.unresolvedMaterialCount })}
        </p>
      )}

      {safety.findings.length === 0 ? (
        <p className="text-[11.5px] text-muted">{t("safety.empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {safety.findings.map((f) => (
            <li key={f.id} className="text-[11.5px]">
              <span className={cn("font-medium", SEVERITY_TONE[f.severity])}>{t(`safety.severity.${f.severity}`)}</span>
              {f.humanReviewRequired && <span className="text-warning"> · {t("safety.findingRequiresHumanReview")}</span>}
              <span className="text-muted"> — {f.message}</span>
              {(f.requiredPpe.length > 0 || f.requiredEngineeringControls.length > 0) && (
                <div className="ml-2 mt-0.5 text-[10.5px] text-muted">
                  {f.requiredPpe.length > 0 && <div>{t("safety.requiredPpe")}: {f.requiredPpe.join(", ")}</div>}
                  {f.requiredEngineeringControls.length > 0 && (
                    <div>{t("safety.requiredControls")}: {f.requiredEngineeringControls.join(", ")}</div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
