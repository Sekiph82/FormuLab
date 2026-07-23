import { useTranslation } from "react-i18next";
import { StabilityPanel } from "@/components/formula/StabilityPanel";
import { useFormulationWorkspace } from "@/hooks/useFormulationWorkspace";
import { useProjectParam } from "@/hooks/useProjectParam";
import { ProjectContextBar, ProjectPicker } from "@/components/workspace/ProjectContextBar";

/**
 * The Stability workspace — studies, protocols, conditions, time points,
 * samples, results, trends, failures, applicability and corrective actions
 * all already live inside StabilityPanel; this page just gives it its own
 * place instead of a tab buried in the Formula Builder. See
 * docs/WORKSPACES.md.
 */
export function StabilityPage() {
  const { t } = useTranslation("session");
  const { projectId, versionId, setProject, setVersion } = useProjectParam();
  const ws = useFormulationWorkspace(projectId);

  if (!projectId) return <ProjectPicker onPick={setProject} />;
  if (!ws.project) return <p className="px-6 py-8 text-center text-[13px] text-muted">{t("builder.loadingProject")}</p>;

  const active = ws.project;
  const selectedVersion = versionId ? ws.versions.find((v) => v.id === versionId) : ws.baseVersion;
  const lines = selectedVersion?.lines ?? ws.draft.value?.lines ?? [];
  const basisBatchKg = selectedVersion?.basisBatchKg ?? ws.draft.value?.basisBatchKg ?? "100";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProjectContextBar project={active} versions={ws.versions} versionId={versionId} onChangeVersion={setVersion} onChangeProject={() => setProject(null)} />
      <div className="min-h-0 flex-1">
        <StabilityPanel
          formulation={active}
          currentLines={lines}
          basisBatchKg={basisBatchKg}
          baseVersion={ws.baseVersion}
          approvalStatus={ws.baseVersionApprovalStatus}
          packagingBoms={ws.packagingBoms}
          onApplyDraft={ws.onApplyCorrectiveActionDraft}
        />
      </div>
    </div>
  );
}
