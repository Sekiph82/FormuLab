import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { DossierPanel } from "@/components/formula/DossierPanel";
import { useFormulationWorkspace } from "@/hooks/useFormulationWorkspace";
import { useProjectParam } from "@/hooks/useProjectParam";
import { ProjectPicker } from "@/components/workspace/ProjectContextBar";
import type { RegulatoryJurisdiction } from "@ai4s/shared";

/**
 * The Dossiers workspace — a first-class route (never a Formula Builder
 * tab, see docs/REGULATORY_DOSSIERS.md). `DossierPanel` owns the list,
 * creation flow, and every dossier-detail sub-section (Overview/Evidence
 * Matrix/Requirements/Evidence Library/Reviews/Submissions/History/Audit).
 * Optional `version`/`jurisdiction`/`sku`/`dossier` query params let the
 * Regulatory workspace deep-link into a prefilled create flow or an
 * existing dossier's detail view.
 */
export function DossiersPage() {
  const { t } = useTranslation("session");
  const { projectId, setProject } = useProjectParam();
  const [params] = useSearchParams();
  const ws = useFormulationWorkspace(projectId);

  if (!projectId) return <ProjectPicker onPick={setProject} />;
  if (!ws.project) return <p className="px-6 py-8 text-center text-[13px] text-muted">{t("builder.loadingProject")}</p>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* eslint-disable i18next/no-literal-string -- URL query param names, not display text */}
      <DossierPanel
        formulation={ws.project}
        versions={ws.versions}
        auditLog={ws.auditLog}
        initialVersionId={params.get("version") ?? undefined}
        initialJurisdiction={(params.get("jurisdiction") as RegulatoryJurisdiction) ?? undefined}
        initialPackagingSkuCode={params.get("sku") ?? undefined}
        initialDossierId={params.get("dossier") ?? undefined}
        onAuditChanged={ws.refreshAuditLog}
      />
      {/* eslint-enable i18next/no-literal-string */}
    </div>
  );
}
