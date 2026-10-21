import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { listRecords } from "@/lib/masterdata";
import { resolveVerifiedRankingSource } from "@/lib/rankingOptimization";
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
  const [searchParams] = useSearchParams();
  const sourceSessionId = searchParams.get("sourceSessionId");
  const sourceAlternativeId = searchParams.get("sourceAlternativeId");
  const sourceFormulaFingerprint = searchParams.get("sourceFormulaFingerprint");
  const rankingRecordCode = searchParams.get("rankingRecordCode");
  const { projectId, setProject } = useProjectParam();
  const sourceKey = [projectId, sourceSessionId, sourceAlternativeId, sourceFormulaFingerprint, rankingRecordCode].join("\u0000");
  const hasRankingOrigin = !!(sourceSessionId || sourceAlternativeId || sourceFormulaFingerprint || rankingRecordCode);
  const [verifiedSource, setVerifiedSource] = useState<{ key: string; status: "pending" | "ready" | "error"; sourceAlternative?: NonNullable<Awaited<ReturnType<typeof resolveVerifiedRankingSource>>>["sourceAlternative"]; message?: string }>({ key: "", status: "pending" });
  const ws = useFormulationWorkspace(projectId);

  useEffect(() => {
    let cancelled = false;
    if (!hasRankingOrigin) {
      setVerifiedSource({ key: sourceKey, status: "ready" });
      return () => { cancelled = true; };
    }
    setVerifiedSource({ key: sourceKey, status: "pending" });
    if (!projectId) {
      setVerifiedSource({ key: sourceKey, status: "error", message: "A project must be selected to verify ranking lineage." });
      return () => { cancelled = true; };
    }
    listRecords("alternative_rankings")
      .then((records) => resolveVerifiedRankingSource({ projectId, sourceSessionId, sourceAlternativeId, sourceFormulaFingerprint, rankingRecordCode, records }))
      .then((resolved) => {
        if (!resolved) throw new Error("Ranking-originated optimizer source was not resolved.");
        if (!cancelled) setVerifiedSource({ key: sourceKey, status: "ready", sourceAlternative: resolved.sourceAlternative });
      })
      .catch((error) => {
        if (!cancelled) setVerifiedSource({ key: sourceKey, status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => { cancelled = true; };
  }, [sourceKey, hasRankingOrigin, projectId, sourceSessionId, sourceAlternativeId, sourceFormulaFingerprint, rankingRecordCode]);

  if (!projectId) return <ProjectPicker onPick={setProject} />;
  if (!ws.project) return <p className="px-6 py-8 text-center text-[13px] text-muted">{t("builder.loadingProject")}</p>;

  if (hasRankingOrigin && (verifiedSource.key !== sourceKey || verifiedSource.status === "pending")) {
    return <p role="status" className="px-6 py-8 text-center text-[13px] text-muted">{t("optimizer.verifyingRankingSource")}</p>;
  }
  if (hasRankingOrigin && verifiedSource.status === "error") {
    return <p role="alert" className="px-6 py-8 text-center text-[13px] text-error">{t("optimizer.rankingSourceBlocked", { reason: verifiedSource.message })}</p>;
  }
  if (!ws.draft.value) return null;

  const active = ws.project;
  const sourceAlternative = hasRankingOrigin ? verifiedSource.sourceAlternative : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProjectContextBar project={active} versions={ws.versions} versionId={null} onChangeVersion={() => {}} onChangeProject={() => setProject(null)} showVersionSelector={false} />
      <div className="min-h-0 flex-1">
        <AdvancedOptimizerPanel
          formulation={active}
          batchKg={ws.draft.value.basisBatchKg}
          currentLines={ws.draft.value.lines}
          sourceAlternative={sourceAlternative}
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
