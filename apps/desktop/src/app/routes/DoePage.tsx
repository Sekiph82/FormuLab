import { useTranslation } from "react-i18next";
import { DoePanel } from "@/components/formula/DoePanel";
import { useFormulationWorkspace } from "@/hooks/useFormulationWorkspace";
import { useProjectParam } from "@/hooks/useProjectParam";
import { ProjectPicker } from "@/components/workspace/ProjectContextBar";

/**
 * The Design of Experiments workspace — a first-class route (never a
 * Formula Builder tab, see docs/DESIGN_OF_EXPERIMENTS.md). `DoePanel` owns
 * studies, factors/constraints/responses, design generation, runs,
 * observations, statistical analysis and candidates. Applying a candidate
 * only ever updates the current WORKING DRAFT's material quantities
 * through the same draft-composition path Optimization/Substitution use —
 * never a saved version.
 */
export function DoePage() {
  const { t } = useTranslation("session");
  const { projectId, setProject } = useProjectParam();
  const ws = useFormulationWorkspace(projectId);

  if (!projectId) return <ProjectPicker onPick={setProject} />;
  if (!ws.project) return <p className="px-6 py-8 text-center text-[13px] text-muted">{t("builder.loadingProject")}</p>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DoePanel
        formulation={ws.project}
        versions={ws.versions}
        auditLog={ws.auditLog}
        onApplyCandidateLines={(materialQuantities) => {
          if (!ws.draft.value) return;
          const byMaterialId = new Map(materialQuantities.map((m) => [m.materialId, m.quantity]));
          const lines = ws.draft.value.lines.map((line) => (line.materialId && byMaterialId.has(line.materialId) ? { ...line, percent: byMaterialId.get(line.materialId)! } : line));
          // Applying a candidate only ever updates the working draft's
          // composition — the human still saves a new version explicitly
          // through the existing Formulation workflow when ready.
          ws.onLinesChange(lines, { checkpoint: true });
        }}
        onAuditChanged={ws.refreshAuditLog}
      />
    </div>
  );
}
