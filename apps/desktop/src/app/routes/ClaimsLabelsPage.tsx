import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { ClaimsLabelsPanel } from "@/components/formula/ClaimsLabelsPanel";
import { useFormulationWorkspace } from "@/hooks/useFormulationWorkspace";
import { useProjectParam } from "@/hooks/useProjectParam";
import { ProjectPicker } from "@/components/workspace/ProjectContextBar";
import type { RegulatoryJurisdiction } from "@ai4s/shared";

/**
 * The Claims & Labels workspace — a first-class route (never a Formula
 * Builder tab, see docs/PRODUCT_CLAIMS.md / docs/PRODUCT_LABELS.md).
 * `ClaimsLabelsPanel` owns claims, claim evidence links, claim reviews,
 * labels, label content, artwork, label reviews, formula/claim-to-label
 * consistency, history and audit. Optional query params preserve context
 * (formula version/jurisdiction/packaging SKU/claim/label) when deep-linked
 * from Dossiers, Regulatory or Approval.
 */
export function ClaimsLabelsPage() {
  const { t } = useTranslation("session");
  const { projectId, setProject } = useProjectParam();
  const [params] = useSearchParams();
  const ws = useFormulationWorkspace(projectId);

  if (!projectId) return <ProjectPicker onPick={setProject} />;
  if (!ws.project) return <p className="px-6 py-8 text-center text-[13px] text-muted">{t("builder.loadingProject")}</p>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* eslint-disable i18next/no-literal-string -- URL query param names, not display text */}
      <ClaimsLabelsPanel
        formulation={ws.project}
        versions={ws.versions}
        auditLog={ws.auditLog}
        initialVersionId={params.get("version") ?? undefined}
        initialJurisdiction={(params.get("jurisdiction") as RegulatoryJurisdiction) ?? undefined}
        initialPackagingSkuCode={params.get("sku") ?? undefined}
        initialClaimId={params.get("claim") ?? undefined}
        initialLabelId={params.get("label") ?? undefined}
        onAuditChanged={ws.refreshAuditLog}
      />
      {/* eslint-enable i18next/no-literal-string */}
    </div>
  );
}
