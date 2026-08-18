import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { GeneratedFormulaCompatibility } from "@/lib/generatedFormulaCompatibility";

const FORMULA_STATE_ICON = {
  compatible: CheckCircle2,
  warning: AlertTriangle,
  blocked: XCircle,
  unknown: HelpCircle,
} as const;

const FORMULA_STATE_TONE = {
  compatible: "text-success",
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
 * FVL-03.008 — a thin, read-only presenter for a `GeneratedFormulaCompatibility`
 * result. Renders the authoritative `evaluateCompatibility()` output as-is;
 * decides nothing itself (no severity math, no rule matching) — a display
 * component, not a second Compatibility Engine. Named distinctly from
 * `CompatibilityPanel.tsx` (the project-bound, saved-version panel with pH/
 * temperature inputs and a save-snapshot action) since this one evaluates a
 * generated, not-yet-necessarily-saved card read-only, with no persistence
 * step at all. FVL-03.011: each finding's real `ruleId`/`materialIds` are
 * now shown, not just carried in data — closing a real provenance-
 * visibility gap (the rule id existed on the finding all along but was
 * previously used only as a React `key`, never rendered), so a
 * "compatibility finding → compatibility rule" trace is actually visible
 * on screen, not merely present in the object.
 */
export function GeneratedCompatibilitySummary({
  compatibility,
}: {
  compatibility: GeneratedFormulaCompatibility | undefined;
}) {
  const { t } = useTranslation(["session", "common"]);

  if (!compatibility) {
    return <p className="text-[11.5px] text-muted">{t("compatibility.notYetAvailable")}</p>;
  }

  const FormulaIcon = FORMULA_STATE_ICON[compatibility.formulaState];

  return (
    <div>
      <div className={cn("mb-2 flex items-center gap-1.5 text-[12.5px] font-medium", FORMULA_STATE_TONE[compatibility.formulaState])}>
        <FormulaIcon size={14} aria-hidden />
        {t(`compatibility.state.${compatibility.formulaState}`)}
      </div>

      {compatibility.unresolvedMaterialCount > 0 && (
        <p className="mb-2 text-[11px] text-muted">
          {t("compatibility.unresolvedMaterialCount", { count: compatibility.unresolvedMaterialCount })}
        </p>
      )}

      {compatibility.findings.length === 0 ? (
        <p className="text-[11.5px] text-muted">{t("compatibility.empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {compatibility.findings.map((f) => (
            <li key={f.id} className="text-[11.5px]">
              <span className={cn("font-medium", SEVERITY_TONE[f.severity])}>{t(`compatibility.severity.${f.severity}`)}</span>
              {f.dataIncomplete && <span className="text-muted"> · {t("compatibility.unknown")}</span>}
              <span className="text-muted"> — {f.message}</span>
              <div className="ml-2 mt-0.5 text-[10.5px] text-muted">
                <span>{f.ruleId}</span>
                {f.materialIds.length > 0 && <span> · {f.materialIds.join(", ")}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
