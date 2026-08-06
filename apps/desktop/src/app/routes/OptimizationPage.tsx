import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { AdvancedOptimizerPanel } from "@/components/formula/AdvancedOptimizerPanel";
import { useFormulationWorkspace } from "@/hooks/useFormulationWorkspace";
import { useProjectParam } from "@/hooks/useProjectParam";
import { ProjectContextBar, ProjectPicker } from "@/components/workspace/ProjectContextBar";

/**
 * The Optimization workspace — optimizer runs, substitution runs,
 * constraints, objectives, candidate formulas, comparison and
 * apply-to-draft actions, all via the existing AdvancedOptimizerPanel.
 * Previously the "Optimizer" tab inside FormulasPage.tsx's Formula Builder
 * strip; math unchanged, only presentation moved. Distinct from the
 * standalone what-if calculator at /optimizer, which is not project-bound
 * and stays exactly where it was. See docs/WORKSPACES.md.
 */
export function OptimizationPage() {
  const { t } = useTranslation("session");
  const navigate = useNavigate();
  const { projectId, setProject } = useProjectParam();
  const ws = useFormulationWorkspace(projectId);

  if (!projectId) return <ProjectPicker onPick={setProject} />;
  if (!ws.project) return <p className="px-6 py-8 text-center text-[13px] text-muted">{t("builder.loadingProject")}</p>;
  if (!ws.draft.value) return null;

  const active = ws.project;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProjectContextBar project={active} versions={ws.versions} versionId={null} onChangeVersion={() => {}} onChangeProject={() => setProject(null)} showVersionSelector={false} />
      <div className="min-h-0 flex-1">
        <AdvancedOptimizerPanel
          formulation={active}
          batchKg={ws.draft.value.basisBatchKg}
          currentLines={ws.draft.value.lines}
          onApplyResult={(lines, runCode) => {
            ws.onApplyOptimizationResult(lines, runCode);
            navigate(`/formulation?project=${projectId}`);
          }}
        />
      </div>
      <p className="print-hide shrink-0 border-t border-border-faint px-4 py-1.5 text-[10px] text-muted">
        {t("builder.standaloneOptimizerHint")}{" "}
        <Link to="/optimizer" className="text-accent hover:underline">
          {t("builder.standaloneOptimizerLink")}
        </Link>
      </p>
    </div>
  );
}
