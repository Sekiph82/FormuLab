import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Beaker, ClipboardList, GitBranch, Wrench } from "lucide-react";
import { TrialsPanel } from "@/components/formula/TrialsPanel";
import { LaboratoryLineagePanel } from "@/components/formula/LaboratoryLineagePanel";
import { TestDefinitionsPanel } from "@/components/formula/TestDefinitionsPanel";
import { CorrectiveActionsPanel } from "@/components/formula/CorrectiveActionsPanel";
import { useFormulationWorkspace } from "@/hooks/useFormulationWorkspace";
import { useProjectParam } from "@/hooks/useProjectParam";
import { ProjectContextBar, ProjectPicker } from "@/components/workspace/ProjectContextBar";
import { cn } from "@/lib/cn";
import { listRecords } from "@/lib/masterdata";
import { readAcceptedPredictiveModels } from "@/lib/predictiveModelRegistry";
import { listSessions } from "@/lib/formulationV2";
import type { LaboratoryLineageRecordSet } from "@formulab/shared";

type Section = "trials" | "tests" | "correctiveActions" | "lineage";
// Bound before the JSX: a section key written inline in an onClick reads as
// display text to the i18next lint rule, and these are route-ish
// identifiers, not labels.
const SECTION_TRIALS: Section = "trials";
const SECTION_TESTS: Section = "tests";
const SECTION_CORRECTIVE_ACTIONS: Section = "correctiveActions";
const SECTION_LINEAGE: Section = "lineage";

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
  const [lineageRecords, setLineageRecords] = useState<LaboratoryLineageRecordSet>({});
  const [lineageLoading, setLineageLoading] = useState(false);
  const [lineageLoadError, setLineageLoadError] = useState(false);

  useEffect(() => {
    const requested = searchParams.get("section");
    if (requested === "trials" || requested === "tests" || requested === "correctiveActions" || requested === "lineage") setSection(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, searchParams.get("section")]);

  useEffect(() => {
    const active = ws.project;
    if (!active) return;
    let cancelled = false;
    setLineageLoading(true);
    setLineageLoadError(false);
    void (async () => {
      const [trials, results, actions, studies, designs, runs, observations, analyses, candidates, stabilityStudies, optimizationRuns, rankings, models, sessions] = await Promise.all([
        listRecords("laboratory_trials"), listRecords("test_results"), listRecords("corrective_actions"), listRecords("doe_studies"),
        listRecords("doe_designs"), listRecords("doe_runs"), listRecords("doe_observations"), listRecords("doe_analyses"),
        listRecords("doe_candidates"), listRecords("stability_studies"), listRecords("optimization_runs"), listRecords("alternative_rankings"),
        readAcceptedPredictiveModels(), listSessions(),
      ]);
      if (cancelled) return;
      const projectTrials = trials.filter((trial) => trial.projectId === active.id);
      const trialIds = new Set(projectTrials.map((trial) => trial.id));
      const projectStudies = studies.filter((study) => study.formulationId === active.id || study.projectId === active.id);
      const studyIds = new Set(projectStudies.map((study) => study.id));
      const projectDesigns = designs.filter((design) => studyIds.has(design.studyId));
      const designIds = new Set(projectDesigns.map((design) => design.id));
      const projectRuns = runs.filter((run) => studyIds.has(run.studyId) || designIds.has(run.designId));
      const runIds = new Set(projectRuns.map((run) => run.id));
      const versionIds = new Set(ws.versions.map((version) => version.id));
      const projectRankings = rankings.filter((record) => record.rankings.some(({ candidate }) => candidate.sourceFormulationVersionId ? versionIds.has(candidate.sourceFormulationVersionId) : false));
      const rankingCodes = new Set(projectRankings.map((record) => record.code));
      const generatedSessionIds = new Set(ws.versions.flatMap((version) => version.generatedSource ? [version.generatedSource.sessionId] : []));
      setLineageRecords({
        generationSessions: sessions.filter((session) => generatedSessionIds.has(session.id)),
        formulations: [active],
        formulationVersions: ws.versions,
        doeStudies: projectStudies,
        doeDesigns: projectDesigns,
        doeAnalyses: analyses.filter((analysis) => studyIds.has(analysis.studyId)),
        doeCandidates: candidates.filter((candidate) => studyIds.has(candidate.studyId)),
        doeRuns: projectRuns,
        doeObservations: observations.filter((observation) => runIds.has(observation.runId)),
        laboratoryTrials: projectTrials,
        testResults: results.filter((result) => trialIds.has(result.trialId)),
        correctiveActions: (actions as Array<{ projectId?: string }>).filter((action) => action.projectId === active.id),
        stabilityStudies: (stabilityStudies as Array<{ sourceFormulaVersionId?: string; projectId?: string; formulationId?: string }>).filter((study) => study.sourceFormulaVersionId ? versionIds.has(study.sourceFormulaVersionId) : study.projectId === active.id || study.formulationId === active.id),
        predictiveModels: [...models.models, ...models.rejectedModels].filter((model) => model.productFamilyCode === active.productFamilyCode),
        rankings: projectRankings,
        optimizationRuns: optimizationRuns.filter((run) => (run.formulaVersionId ? versionIds.has(run.formulaVersionId) : false) || rankingCodes.has(run.sourceAlternative?.rankingRecordCode ?? "")),
      });
      setLineageLoading(false);
    })().catch(() => {
      if (!cancelled) {
        setLineageRecords({ formulations: [active], formulationVersions: ws.versions });
        setLineageLoadError(true);
        setLineageLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [ws.project, ws.versions]);

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
        <SectionTab active={section === "lineage"} onClick={() => setSection(SECTION_LINEAGE)} icon={<GitBranch size={13} />}>
          {t("session:builder.tabLineage")}
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
            versions={ws.versions}
            approvalStatus={ws.baseVersionApprovalStatus}
            onApplyDraft={(note, origin, sourceVersion) => sourceVersion && ws.onApplyCorrectiveActionDraft(sourceVersion.lines.map((l) => ({ ...l })), sourceVersion.basisBatchKg, note, origin)}
          />
        )}
        {section === "lineage" && <LaboratoryLineagePanel records={{ ...lineageRecords, formulationDrafts: ws.draft.value ? [ws.draft.value] : [] }} auditEvents={ws.auditLog} onSelectVersion={setVersion} loading={lineageLoading} loadError={lineageLoadError} />}
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
