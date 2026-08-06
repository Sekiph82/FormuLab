import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Beaker, ClipboardList, Wrench } from "lucide-react";
import { TrialsPanel } from "@/components/formula/TrialsPanel";
import { TestDefinitionsPanel } from "@/components/formula/TestDefinitionsPanel";
import { CorrectiveActionsPanel } from "@/components/formula/CorrectiveActionsPanel";
import { useFormulationWorkspace } from "@/hooks/useFormulationWorkspace";
import { useProjectParam } from "@/hooks/useProjectParam";
import { ProjectContextBar, ProjectPicker } from "@/components/workspace/ProjectContextBar";
import { cn } from "@/lib/cn";

type Section = "trials" | "tests" | "correctiveActions";
// Bound before the JSX: a section key written inline in an onClick reads as
// display text to the i18next lint rule, and these are route-ish
// identifiers, not labels.
const SECTION_TRIALS: Section = "trials";
const SECTION_TESTS: Section = "tests";
const SECTION_CORRECTIVE_ACTIONS: Section = "correctiveActions";

/**
 * The Laboratory workspace — trials (with test results, result history,
 * deviations and attachments all inside TrialsPanel already), the global
 * test-definition catalog, and corrective actions. Previously three
 * separate horizontal tabs buried inside FormulasPage.tsx's crowded Formula
 * Builder strip. See docs/WORKSPACES.md.
 */
export function LaboratoryPage() {
  const { t } = useTranslation(["session", "nav"]);
  const { projectId, versionId, setProject, setVersion } = useProjectParam();
  const ws = useFormulationWorkspace(projectId);
  const [searchParams] = useSearchParams();
  const [section, setSection] = useState<Section>("trials");

  useEffect(() => {
    const requested = searchParams.get("section");
    if (requested === "trials" || requested === "tests" || requested === "correctiveActions") setSection(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, searchParams.get("section")]);

  if (!projectId) return <ProjectPicker onPick={setProject} />;
  if (!ws.project) return <p className="px-6 py-8 text-center text-[13px] text-muted">{t("session:builder.loadingProject")}</p>;

  const active = ws.project;
  const selectedVersion = versionId ? ws.versions.find((v) => v.id === versionId) : ws.baseVersion;
  const lines = selectedVersion?.lines ?? ws.draft.value?.lines ?? [];
  const basisBatchKg = selectedVersion?.basisBatchKg ?? ws.draft.value?.basisBatchKg ?? "100";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProjectContextBar project={active} versions={ws.versions} versionId={versionId} onChangeVersion={setVersion} onChangeProject={() => setProject(null)} />
      <div className="print-hide flex shrink-0 gap-1 border-b border-border-faint px-4 pt-2">
        <SectionTab active={section === "trials"} onClick={() => setSection(SECTION_TRIALS)} icon={<Beaker size={13} />}>
          {t("session:builder.tabTrials")}
        </SectionTab>
        <SectionTab active={section === "tests"} onClick={() => setSection(SECTION_TESTS)} icon={<ClipboardList size={13} />}>
          {t("session:builder.tabTests")}
        </SectionTab>
        <SectionTab active={section === "correctiveActions"} onClick={() => setSection(SECTION_CORRECTIVE_ACTIONS)} icon={<Wrench size={13} />}>
          {t("session:builder.tabCorrectiveActions")}
        </SectionTab>
      </div>
      <div className="min-h-0 flex-1">
        {section === "trials" && (
          <TrialsPanel
            formulation={active}
            currentLines={lines}
            basisBatchKg={basisBatchKg}
            baseVersion={ws.baseVersion}
            approvalStatus={ws.baseVersionApprovalStatus}
            onApplyDraft={ws.onApplyCorrectiveActionDraft}
          />
        )}
        {section === "tests" && <TestDefinitionsPanel />}
        {section === "correctiveActions" && (
          <CorrectiveActionsPanel
            formulation={active}
            baseVersion={ws.baseVersion}
            approvalStatus={ws.baseVersionApprovalStatus}
            onApplyDraft={(note) => ws.baseVersion && ws.onApplyCorrectiveActionDraft(ws.baseVersion.lines.map((l) => ({ ...l })), ws.baseVersion.basisBatchKg, note)}
          />
        )}
      </div>
    </div>
  );
}

function SectionTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-t-input border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
