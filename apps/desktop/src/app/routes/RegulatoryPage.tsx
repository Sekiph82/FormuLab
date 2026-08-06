import { useTranslation } from "react-i18next";
import { RegulatoryPanel } from "@/components/formula/RegulatoryPanel";
import { useFormulationWorkspace } from "@/hooks/useFormulationWorkspace";
import { useProjectParam } from "@/hooks/useProjectParam";
import { ProjectPicker } from "@/components/workspace/ProjectContextBar";

/**
 * The Regulatory workspace. `RegulatoryPanel` already owns its own version/
 * jurisdiction/packaging-SKU/reviewer-role selectors and grouped sections
 * (market summary, classification, findings, evidence confirmations, rules,
 * rule verification, import/export, review equivalence, review history) —
 * this page just gives it a first-class place instead of a tab inside the
 * Formula Builder. See docs/WORKSPACES.md.
 */
export function RegulatoryPage() {
  const { t } = useTranslation(["session", "nav"]);
  const { projectId, setProject } = useProjectParam();
  const ws = useFormulationWorkspace(projectId);

  if (!projectId) return <ProjectPicker onPick={setProject} />;
  if (!ws.project) return <p className="px-6 py-8 text-center text-[13px] text-muted">{t("session:builder.loadingProject")}</p>;
  if (!ws.draft.value) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="print-hide flex shrink-0 items-center gap-2 border-b border-border-faint px-4 py-1.5">
        <button onClick={() => setProject(null)} className="text-[11px] text-muted hover:text-text">
          ← {t("nav:workspace.changeProject")}
        </button>
        <span className="text-[11px] text-muted">{ws.project.name}</span>
      </div>
      <div className="min-h-0 flex-1">
        <RegulatoryPanel formulation={ws.project} currentLines={ws.draft.value.lines} materials={ws.materials} versions={ws.versions} />
      </div>
    </div>
  );
}
