import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { GeneratedFormulaRegulatory } from "@/lib/generatedFormulaRegulatory";

const FORMULA_STATE_ICON = {
  compliant: CheckCircle2,
  warning: AlertTriangle,
  blocked: XCircle,
  unknown: HelpCircle,
} as const;

const FORMULA_STATE_TONE = {
  compliant: "text-success",
  warning: "text-warning",
  blocked: "text-error",
  unknown: "text-muted",
} as const;

const STATUS_TONE = {
  compliant_with_rule: "text-success",
  not_applicable: "text-muted",
  non_compliant: "text-error",
  human_review_required: "text-warning",
  missing_data: "text-warning",
  unknown: "text-muted",
} as const;

/**
 * FVL-03.010 — a thin, read-only presenter for a `GeneratedFormulaRegulatory`
 * result. Renders the authoritative `evaluateRegulatory()` output as-is;
 * decides nothing itself (no rule matching, no status precedence) — a
 * display component, not a second Regulatory Engine. Named distinctly
 * from `RegulatoryPanel.tsx` (the project-bound, saved-version panel with
 * jurisdiction selection, dossiers, claims, and a review/audit workflow)
 * since this one evaluates a generated, not-yet-necessarily-saved card
 * read-only, with no persistence step at all — mirrors
 * `GeneratedSafetySummary.tsx`/`GeneratedCompatibilitySummary.tsx`
 * exactly. Every finding's own `verificationStatus` is always shown
 * alongside its status — a `not_verified` rule's finding must never read
 * as though it were a confirmed legal conclusion.
 */
export function GeneratedRegulatorySummary({
  regulatory,
}: {
  regulatory: GeneratedFormulaRegulatory | undefined;
}) {
  const { t } = useTranslation(["session", "common"]);

  if (!regulatory) {
    return <p className="text-[11.5px] text-muted">{t("regulatory.generated.notYetAvailable")}</p>;
  }

  const FormulaIcon = FORMULA_STATE_ICON[regulatory.formulaState];

  return (
    <div>
      <div className={cn("mb-2 flex items-center gap-1.5 text-[12.5px] font-medium", FORMULA_STATE_TONE[regulatory.formulaState])}>
        <FormulaIcon size={14} aria-hidden />
        {t(`regulatory.generated.state.${regulatory.formulaState}`)}
        {regulatory.jurisdiction && <span className="text-muted"> — {regulatory.jurisdiction}</span>}
      </div>

      {!regulatory.jurisdiction && (
        <p className="mb-2 text-[11.5px] text-muted">
          {t("regulatory.generated.marketUnresolved", { market: regulatory.requestedMarket || t("regulatory.generated.marketUnspecified") })}
        </p>
      )}

      {regulatory.jurisdiction && regulatory.unresolvedMaterialCount > 0 && (
        <p className="mb-2 text-[11px] text-muted">
          {t("regulatory.generated.unresolvedMaterialCount", { count: regulatory.unresolvedMaterialCount })}
        </p>
      )}

      {regulatory.jurisdiction && (
        regulatory.findings.length === 0 ? (
          <p className="text-[11.5px] text-muted">{t("regulatory.generated.empty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {regulatory.findings.map((f) => (
              <li key={f.id} className="text-[11.5px]">
                <span className={cn("font-medium", STATUS_TONE[f.status])}>{t(`regulatory.generated.status.${f.status}`)}</span>
                <span className="text-muted"> · {t(`regulatory.generated.verification.${f.verificationStatus}`)}</span>
                <span className="text-muted"> — {f.reason}</span>
                <div className="ml-2 mt-0.5 text-[10.5px] text-muted">
                  <span>{f.ruleCode}</span>
                  {f.affectedMaterialCodes.length > 0 && <span> · {f.affectedMaterialCodes.join(", ")}</span>}
                  {f.affectedClaim && <span> · {f.affectedClaim}</span>}
                  {f.requiredAction && <div>{f.requiredAction}</div>}
                </div>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
