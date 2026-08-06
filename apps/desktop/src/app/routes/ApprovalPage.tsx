import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ApprovalPanel } from "@/components/formula/ApprovalPanel";
import { useFormulationWorkspace } from "@/hooks/useFormulationWorkspace";
import { useProjectParam } from "@/hooks/useProjectParam";
import { ProjectPicker } from "@/components/workspace/ProjectContextBar";

type NavTarget = "builder" | "compatibility" | "safety" | "optimizer" | "trials" | "tests" | "stability" | "correctiveActions" | "cost" | "regulatory";

/**
 * Pure route-mapping for an Approval blocker's `NavTarget` — extracted so it
 * can be unit-tested without mounting the full ApprovalPanel (spec 4.12:
 * "From Approval, open the exact failed laboratory or stability
 * requirement"). Always carries the project id forward; never guesses one.
 */
export function mapApprovalNavTargetToPath(target: NavTarget, projectId: string): string {
  switch (target) {
    case "builder":
    case "compatibility":
    case "safety":
    case "cost":
      return `/formulation?project=${projectId}&tab=${target}`;
    case "optimizer":
      return `/optimization?project=${projectId}`;
    case "trials":
    case "tests":
    case "correctiveActions":
      return `/laboratory?project=${projectId}&section=${target}`;
    case "stability":
      return `/stability?project=${projectId}`;
    case "regulatory":
      return `/regulatory?project=${projectId}`;
  }
}

/**
 * The Approval workspace — readiness overview, blockers, warnings, approval
 * policies, policy revisions, formula-version equivalence, regulatory
 * review reuse, decision history and approval snapshots, all via the
 * existing ApprovalPanel. Cross-module navigation (a blocker naming
 * "compatibility" or "stability") now crosses real routes instead of
 * switching an internal tab, preserving project/version context — spec
 * 4.12/4.8. See docs/NAVIGATION_AND_CONTEXT.md.
 */
export function ApprovalPage() {
  const { t } = useTranslation("session");
  const navigate = useNavigate();
  const { projectId, setProject } = useProjectParam();
  const ws = useFormulationWorkspace(projectId);

  if (!projectId) return <ProjectPicker onPick={setProject} />;
  if (!ws.project) return <p className="px-6 py-8 text-center text-[13px] text-muted">{t("builder.loadingProject")}</p>;

  const active = ws.project;
  const onNavigate = (target: NavTarget) => navigate(mapApprovalNavTargetToPath(target, projectId));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ApprovalPanel
        formulation={active}
        versions={ws.versions}
        baseVersion={ws.baseVersion}
        auditLog={ws.auditLog}
        onFocusLine={(lineId) => navigate(`/formulation?project=${projectId}&tab=builder&focusLine=${lineId}`)}
        onNavigate={onNavigate}
        onAuditChanged={ws.refreshAuditLog}
      />
    </div>
  );
}
