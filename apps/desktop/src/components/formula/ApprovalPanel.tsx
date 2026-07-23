/**
 * The desktop approval action — spec closure for the gap
 * docs/APPROVAL_READINESS.md disclosed: `assessApprovalReadiness` was
 * implemented and tested but no screen ever called it. This is that screen.
 *
 * Every readiness source is real, derived from persisted records (never a
 * placeholder boolean): formula validation/compatibility/safety findings are
 * computed live against the selected version's own lines, exactly the same
 * way the Compatibility/Safety tabs compute them; laboratory and stability
 * readiness are derived by `deriveLabReadiness`/`deriveStabilityReadiness`
 * from the real `laboratory_trials`/`test_results`/`trial_deviations`/
 * `corrective_actions`/`stability_studies`/`stability_samples`/
 * `stability_results`/`stability_failures` collections.
 *
 * The cost-snapshot requirement is NOT one of `assessApprovalReadiness`'s
 * built-in blocker sources (that module's `ApprovalBlockerSource` union is
 * fixed and already covered by 38 passing tests this phase deliberately did
 * not touch) — it is enforced here, one layer up, as an additional
 * workflow-level gate folded into `effectiveReady`/the persisted readiness
 * snapshot's `blockers` array under a synthetic `"cost"` source. See
 * docs/APPROVAL_WORKFLOW.md.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ExternalLink, Shield, XCircle } from "lucide-react";
import {
  APPROVAL_AUTHORITY,
  APPROVAL_ROLES,
  assessApprovalReadiness,
  attemptApprovalTransition,
  buildKenyaCatalog,
  classifyProductSafety,
  deriveLabReadiness,
  deriveStabilityReadiness,
  effectiveStatus,
  evaluateCompatibility,
  evaluateSafety,
  newId,
  policyApplies,
  templateForFamily,
  toLabApprovalPolicy,
  toStabilityApprovalPolicy,
  validateFormula,
  SEED_COMPATIBILITY_RULES,
  SEED_SAFETY_RULES,
  SEED_STABILITY_TIME_POINTS,
  SEED_TEST_DEFINITIONS,
  type Actor,
  type ApprovalBlocker,
  type ApprovalPolicy,
  type ApprovalReadiness,
  type ApprovalRecord,
  type ApprovalRole,
  type ApprovalWarning,
  type AuditEvent,
  type CorrectiveAction,
  type CostSnapshot,
  type Formulation,
  type FormulationVersion,
  type FormulaStatus,
  type LaboratoryTrial,
  type OptimizationRun,
  type RawMaterial,
  type SafetyResolution,
  type StabilityFailure,
  type StabilityResult,
  type StabilitySample,
  type StabilityStudy,
  type SubstitutionRun,
  type TestDefinition,
  type TestResult,
  type TrialDeviation,
} from "@ai4s/shared";
import { appendAudit, auditEvent, listApprovalRecords, saveApprovalRecord } from "@/lib/formulations";
import { listRecords, listRecordsSeeded, upsertRecords } from "@/lib/masterdata";
import { cn } from "@/lib/cn";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

type NavTarget = "builder" | "compatibility" | "safety" | "optimizer" | "trials" | "tests" | "stability" | "correctiveActions" | "cost";

/** A blocker/warning as the panel renders it — a superset of the engine's
 *  own `ApprovalBlockerSource`, because the cost-snapshot gate (below) is a
 *  workflow-level rule, not one of `assessApprovalReadiness`'s built-in
 *  sources. */
interface DisplayFinding {
  id: string;
  source: string;
  message: string;
  lineId?: string;
  code?: string;
}

const SOURCE_NAV: Record<string, NavTarget> = {
  validation: "builder",
  compatibility: "compatibility",
  safety: "safety",
  human_review: "safety",
  optimization: "optimizer",
  substitution: "builder",
  laboratory: "trials",
  stability: "stability",
  cost: "cost",
};

const CODE_NAV_OVERRIDE: Record<string, NavTarget> = {
  critical_corrective_action_open: "correctiveActions",
  critical_test_failed: "tests",
  trial_not_completed: "tests",
};

export function ApprovalPanel({
  formulation,
  versions,
  baseVersion,
  auditLog,
  onFocusLine,
  onNavigate,
  onAuditChanged,
}: {
  formulation: Formulation;
  versions: FormulationVersion[];
  baseVersion?: FormulationVersion;
  auditLog: AuditEvent[];
  onFocusLine: (lineId: string) => void;
  onNavigate: (tab: NavTarget) => void;
  onAuditChanged: () => Promise<void>;
}) {
  const { t: tRaw } = useTranslation(["session", "common"]);
  const t = tRaw as SimpleT;

  const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>(baseVersion?.id ?? versions[0]?.id);
  useEffect(() => {
    if (!selectedVersionId && (baseVersion || versions[0])) {
      setSelectedVersionId(baseVersion?.id ?? versions[0]?.id);
    }
  }, [baseVersion, versions, selectedVersionId]);
  const selectedVersion = versions.find((v) => v.id === selectedVersionId) ?? baseVersion;

  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [compatibilityRules, setCompatibilityRules] = useState(SEED_COMPATIBILITY_RULES);
  const [safetyRules, setSafetyRules] = useState(SEED_SAFETY_RULES);
  const [safetyResolutions, setSafetyResolutions] = useState<SafetyResolution[]>([]);
  const [trials, setTrials] = useState<LaboratoryTrial[]>([]);
  const [testDefinitions, setTestDefinitions] = useState<TestDefinition[]>(SEED_TEST_DEFINITIONS);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [deviations, setDeviations] = useState<TrialDeviation[]>([]);
  const [correctiveActions, setCorrectiveActions] = useState<CorrectiveAction[]>([]);
  const [studies, setStudies] = useState<StabilityStudy[]>([]);
  const [samples, setSamples] = useState<StabilitySample[]>([]);
  const [stabilityResults, setStabilityResults] = useState<StabilityResult[]>([]);
  const [failures, setFailures] = useState<StabilityFailure[]>([]);
  const [costSnapshots, setCostSnapshots] = useState<CostSnapshot[]>([]);
  const [optimizationRuns, setOptimizationRuns] = useState<OptimizationRun[]>([]);
  const [substitutionRuns, setSubstitutionRuns] = useState<SubstitutionRun[]>([]);
  const [policies, setPolicies] = useState<ApprovalPolicy[]>([]);
  const [approvalRecords, setApprovalRecords] = useState<ApprovalRecord[]>([]);

  const load = useCallback(async () => {
    const [m, cr, sr, sres, tr, td, tres, dev, ca, st, sam, stres, fail, cs, opt, sub, pol, rec] = await Promise.all([
      listRecords("materials"),
      listRecordsSeeded("compatibility_rules", SEED_COMPATIBILITY_RULES),
      listRecordsSeeded("safety_rules", SEED_SAFETY_RULES),
      listRecords("safety_resolutions"),
      listRecords("laboratory_trials"),
      listRecordsSeeded("test_definitions", SEED_TEST_DEFINITIONS),
      listRecords("test_results"),
      listRecords("trial_deviations"),
      listRecords("corrective_actions"),
      listRecords("stability_studies"),
      listRecords("stability_samples"),
      listRecords("stability_results"),
      listRecords("stability_failures"),
      listRecords("cost_snapshots"),
      listRecords("optimization_runs"),
      listRecords("substitution_runs"),
      listRecordsSeeded("approval_policies", [DISABLED_EXAMPLE_POLICY]),
      listApprovalRecords(formulation.id),
    ]);
    setMaterials(m);
    setCompatibilityRules(cr);
    setSafetyRules(sr);
    setSafetyResolutions(sres.filter((r) => r.formulationId === formulation.id));
    setTrials(tr.filter((x) => x.projectId === formulation.id));
    setTestDefinitions(td);
    setTestResults(tres);
    setDeviations(dev);
    setCorrectiveActions(ca.filter((x) => x.projectId === formulation.id));
    setStudies(st.filter((x) => x.projectId === formulation.id));
    setSamples(sam);
    setStabilityResults(stres);
    setFailures(fail);
    setCostSnapshots(cs);
    setOptimizationRuns(opt);
    setSubstitutionRuns(sub);
    setPolicies(pol);
    setApprovalRecords(rec);
  }, [formulation.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const catalog = useMemo(() => buildKenyaCatalog(), []);
  const family = catalog.families.find((f) => f.code === formulation.productFamilyCode);
  const packagingSkuCode = formulation.targetSkuCodes[0];

  const currentStatus: FormulaStatus = selectedVersion ? effectiveStatus(selectedVersion, auditLog) : "concept";
  // Mirrors the two edges into `HUMAN_ONLY_STATUSES` in the status graph
  // (`ALLOWED_NEXT`, schemas/status.ts) — `pilot_candidate -> pilot_approved`
  // and `pilot_approved -> production_approved` are the only two, so this is
  // duplicated here rather than importing a private table.
  const targetOptions = useMemo<FormulaStatus[]>(() => {
    if (currentStatus === "pilot_candidate") return ["pilot_approved"];
    if (currentStatus === "pilot_approved") return ["production_approved"];
    return [];
  }, [currentStatus]);
  const [targetStatus, setTargetStatus] = useState<FormulaStatus>("pilot_approved");
  useEffect(() => {
    if (targetOptions.length && !targetOptions.includes(targetStatus)) setTargetStatus(targetOptions[0]);
  }, [targetOptions, targetStatus]);

  const applicablePolicies = policies.filter(
    (p) => p.active && p.targetStatus === targetStatus && policyApplies(p, formulation.productFamilyCode, packagingSkuCode),
  );
  const [policyId, setPolicyId] = useState<string>("");
  const activePolicy = applicablePolicies.find((p) => p.id === policyId) ?? applicablePolicies[0];
  const [managingPolicies, setManagingPolicies] = useState(false);

  const [reviewerRole, setReviewerRole] = useState<ApprovalRole>("chemist");
  const [reviewerDisplayName, setReviewerDisplayName] = useState("");
  const [reviewerUserId, setReviewerUserId] = useState("local");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!opened && selectedVersion) {
      setOpened(true);
      void appendAudit(auditEvent(formulation.id, "approval.dialog_opened", { versionId: selectedVersion.id, detail: targetStatus }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVersion?.id]);

  const lines = useMemo(() => selectedVersion?.lines ?? [], [selectedVersion]);
  const template = templateForFamily(formulation.productFamilyCode);

  const validationFindings = useMemo(
    () =>
      validateFormula(lines, {
        requiresPreservative: template?.requiresPreservative,
        requiresPhAdjuster: template?.requiresPhAdjuster,
      }),
    [lines, template?.requiresPreservative, template?.requiresPhAdjuster],
  );

  const compatibilityFindings = useMemo(
    () => evaluateCompatibility(lines, compatibilityRules, { materials, productDomain: family?.domain }),
    [lines, compatibilityRules, materials, family?.domain],
  );
  const safetyFindings = useMemo(() => evaluateSafety(lines, safetyRules, { materials }), [lines, safetyRules, materials]);
  const classification = family ? classifyProductSafety(family, formulation.targetClaims) : "human_review_required";
  const humanReviewAcknowledged = safetyResolutions.some((r) => r.findingId === `classification:${classification}`);
  const resolvedFindingIds = safetyResolutions.map((r) => r.findingId);

  const appliedOptimizationRunCode = selectedVersion?.appliedOptimizationRunCode;
  const appliedOptimizationRun = useMemo(
    () =>
      appliedOptimizationRunCode
        ? { code: appliedOptimizationRunCode, status: optimizationRuns.find((r) => r.code === appliedOptimizationRunCode)?.result.status }
        : undefined,
    [appliedOptimizationRunCode, optimizationRuns],
  );
  const appliedSubstitutionRunCode = selectedVersion?.appliedSubstitutionRunCode;
  const appliedSubstitutionRun = useMemo(() => {
    if (!appliedSubstitutionRunCode) return undefined;
    const run = substitutionRuns.find((r) => r.code === appliedSubstitutionRunCode);
    const candidate = run?.result.candidates.find((c) => c.id === run.selectedCandidateId);
    return {
      code: appliedSubstitutionRunCode,
      status: run?.result.status,
      selectedCandidateId: run?.selectedCandidateId,
      selectedCandidateBlocked: candidate ? candidate.hasBlockingCompatibilityFinding || candidate.hasBlockingSafetyFinding : undefined,
    };
  }, [appliedSubstitutionRunCode, substitutionRuns]);

  const labReadiness = selectedVersion
    ? deriveLabReadiness({
        policy: activePolicy ? toLabApprovalPolicy(activePolicy) : {},
        formulaVersionId: selectedVersion.id,
        trials,
        testDefinitions,
        testResults,
        deviations,
        correctiveActions,
      })
    : undefined;

  const stabilityDerivation = selectedVersion
    ? deriveStabilityReadiness({
        policy: activePolicy ? toStabilityApprovalPolicy(activePolicy) : {},
        formulaVersionId: selectedVersion.id,
        productFamilyId: formulation.productFamilyCode,
        packagingSkuCode,
        studies,
        samples,
        results: stabilityResults,
        failures,
        timePoints: SEED_STABILITY_TIME_POINTS,
        testDefinitions,
      })
    : undefined;

  const readiness: ApprovalReadiness = useMemo(
    () =>
      assessApprovalReadiness({
        validationFindings,
        compatibilityFindings,
        safetyFindings,
        productClassification: classification,
        resolvedFindingIds,
        humanReviewAcknowledged,
        appliedOptimizationRun,
        appliedSubstitutionRun,
        labReadiness,
        stabilityReadiness: stabilityDerivation,
      }),
    [validationFindings, compatibilityFindings, safetyFindings, classification, resolvedFindingIds, humanReviewAcknowledged, appliedOptimizationRun, appliedSubstitutionRun, labReadiness, stabilityDerivation],
  );

  const hasCostSnapshot = !!selectedVersion && costSnapshots.some((c) => c.versionId === selectedVersion.id);
  const costRequired = !!activePolicy?.requireCostSnapshot;
  const costBlocker: DisplayFinding | undefined =
    costRequired && !hasCostSnapshot
      ? { id: "cost:missing_snapshot", source: "cost", code: "missing_cost_snapshot", message: t("approval.blockers.missingCostSnapshot") }
      : undefined;

  const allBlockers: DisplayFinding[] = [...readiness.blockers, ...(costBlocker ? [costBlocker] : [])];
  const allWarnings: (ApprovalWarning | DisplayFinding)[] = readiness.warnings;
  const effectiveReady = readiness.ready && !costBlocker;

  const canApprove = !!selectedVersion && targetOptions.includes(targetStatus) && APPROVAL_AUTHORITY[targetStatus].includes(reviewerRole);

  const buildReadinessSnapshot = () => ({ ready: effectiveReady, blockers: allBlockers, warnings: readiness.warnings });

  const navigate = (finding: DisplayFinding) => {
    if (finding.lineId) onFocusLine(finding.lineId);
    const target = (finding.code && CODE_NAV_OVERRIDE[finding.code]) || SOURCE_NAV[finding.source] || "builder";
    onNavigate(target);
  };

  const savePolicy = async (policy: ApprovalPolicy, isNew: boolean) => {
    await upsertRecords("approval_policies", [policy]);
    setPolicies((prev) => (prev.some((p) => p.id === policy.id) ? prev.map((p) => (p.id === policy.id ? policy : p)) : [...prev, policy]));
    setPolicyId(policy.id);
    await appendAudit(auditEvent(formulation.id, "approval.policy_changed", { detail: isNew ? `created ${policy.name}` : `updated ${policy.name}` }));
  };

  const record = async (decision: ApprovalRecord["decision"]) => {
    if (!selectedVersion) return;
    setBusy(true);
    setError(null);
    try {
      const actor: Actor = { kind: "human", role: reviewerRole, userId: reviewerUserId.trim() || "local" };
      const snapshot = buildReadinessSnapshot();
      const approvalId = newId("approval");
      const now = new Date().toISOString();

      if (decision === "approved") {
        const result = attemptApprovalTransition(
          currentStatus,
          targetStatus as "pilot_approved" | "production_approved",
          actor,
          { ready: snapshot.ready, blockers: snapshot.blockers as ApprovalBlocker[], warnings: snapshot.warnings },
          { hasApprovalRecord: true },
        );
        if (!result.allowed || !result.action) {
          await saveApprovalRecord(
            buildApprovalRecord(approvalId, "blocked", formulation.id, selectedVersion.id, currentStatus, targetStatus, actor, reviewerDisplayName, reason || result.message || "blocked", snapshot, now),
          );
          await appendAudit(auditEvent(formulation.id, "approval.blocked", { versionId: selectedVersion.id, detail: result.message }));
          setError(result.message ?? t("approval.blockedGeneric"));
          return;
        }
        await saveApprovalRecord(
          buildApprovalRecord(approvalId, "approved", formulation.id, selectedVersion.id, currentStatus, targetStatus, actor, reviewerDisplayName, reason, snapshot, now),
        );
        await appendAudit(auditEvent(formulation.id, result.action, { versionId: selectedVersion.id, detail: reason }));
        await appendAudit(auditEvent(formulation.id, "approval.granted", { versionId: selectedVersion.id, detail: approvalId }));
      } else {
        await saveApprovalRecord(
          buildApprovalRecord(approvalId, decision, formulation.id, selectedVersion.id, currentStatus, targetStatus, actor, reviewerDisplayName, reason, snapshot, now),
        );
        await appendAudit(auditEvent(formulation.id, `approval.${decision}`, { versionId: selectedVersion.id, detail: reason }));
      }

      setReason("");
      await load();
      await onAuditChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!selectedVersion) {
    return <p className="px-6 py-8 text-center text-[13px] text-muted">{t("approval.noVersion")}</p>;
  }

  return (
    <div className="h-full overflow-auto px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Shield size={15} className="text-accent" />
        <h3 className="text-[13px] font-medium text-text">{t("approval.heading")}</h3>
        <div className="flex-1" />
        <select
          value={selectedVersionId}
          onChange={(e) => setSelectedVersionId(e.target.value)}
          className="rounded-input border border-border bg-surface px-2 py-1 text-[11px] text-text"
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.versionLabel ?? `0.${v.versionNumber}`} — {effectiveStatus(v, auditLog)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div role="alert" className="mb-3 rounded-input bg-error/10 px-3 py-2 text-[12px] text-error">
          {error}
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3 rounded-card border border-border p-3 text-[12px] sm:grid-cols-4">
        <Field label={t("approval.currentStatus")} value={currentStatus} />
        <div>
          <div className="mb-1 text-[10px] text-muted">{t("approval.requestedStatus")}</div>
          <select
            value={targetStatus}
            onChange={(e) => setTargetStatus(e.target.value as FormulaStatus)}
            disabled={targetOptions.length === 0}
            className="w-full rounded-input border border-border bg-surface px-2 py-1 text-[11px] text-text disabled:opacity-40"
          >
            {(targetOptions.length ? targetOptions : [currentStatus]).map((s) => (
              <option key={s} value={s}>
                {t(`approval.status.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="mb-1 text-[10px] text-muted">{t("approval.policy")}</div>
          <select
            value={activePolicy?.id ?? ""}
            onChange={(e) => setPolicyId(e.target.value)}
            className="w-full rounded-input border border-border bg-surface px-2 py-1 text-[11px] text-text"
          >
            <option value="">{t("approval.noPolicy")}</option>
            {applicablePolicies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button onClick={() => setManagingPolicies((v) => !v)} className="mt-1 text-[10px] text-accent hover:underline">
            {t("approval.managePolicies")}
          </button>
        </div>
        <div>
          <div className="mb-1 text-[10px] text-muted">{t("approval.readiness")}</div>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium",
              effectiveReady ? "bg-success/10 text-success" : "bg-error/10 text-error",
            )}
          >
            {effectiveReady ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
            {effectiveReady ? t("approval.ready") : t("approval.notReady")}
          </span>
        </div>
      </div>

      {managingPolicies && (
        <Section title={t("approval.managePolicies")}>
          <PolicyEditor
            targetStatus={targetStatus}
            existing={applicablePolicies}
            onSave={savePolicy}
            t={t}
          />
        </Section>
      )}

      <Section title={t("approval.blockersHeading", { count: allBlockers.length })}>
        {allBlockers.length === 0 ? (
          <p className="text-[11px] text-muted">{t("approval.noBlockers")}</p>
        ) : (
          <ul className="space-y-1.5">
            {allBlockers.map((b) => (
              <li key={b.id} className="flex items-start gap-2 rounded-input border border-error/30 bg-error/5 px-2 py-1.5 text-[11px] text-text">
                <span className="mt-0.5 rounded bg-error/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-error">{b.source}</span>
                <span className="flex-1">{b.message}</span>
                <button onClick={() => navigate(b)} className="flex shrink-0 items-center gap-1 text-[10px] text-accent hover:underline">
                  {t("approval.goTo")} <ExternalLink size={10} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("approval.warningsHeading", { count: allWarnings.length })}>
        {allWarnings.length === 0 ? (
          <p className="text-[11px] text-muted">{t("approval.noWarnings")}</p>
        ) : (
          <ul className="space-y-1">
            {allWarnings.map((w) => (
              <li key={w.id} className="rounded-input border border-warn/30 bg-warn/5 px-2 py-1.5 text-[11px] text-text">
                {w.message}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {labReadiness && (
          <SummaryCard title={t("approval.laboratorySummary")}>
            <SummaryRow label={t("approval.hasCompletedTrial")} ok={labReadiness.hasCompletedTrial} />
            <SummaryRow label={t("approval.allRequiredTestsCompleted")} ok={labReadiness.allRequiredTestsCompleted} />
            <SummaryRow label={t("approval.allCriticalTestsPassed")} ok={labReadiness.allCriticalTestsPassed} />
            <SummaryRow label={t("approval.noOpenCriticalDeviation")} ok={!labReadiness.hasUnresolvedCriticalDeviation} />
            <SummaryRow label={t("approval.noOpenCriticalCorrectiveAction")} ok={!labReadiness.hasUnresolvedCriticalCorrectiveAction} />
          </SummaryCard>
        )}
        {stabilityDerivation && (
          <SummaryCard title={t("approval.stabilitySummary")}>
            <SummaryRow label={t("approval.hasActiveOrCompletedStudy")} ok={stabilityDerivation.hasActiveOrCompletedStudy} />
            <SummaryRow label={t("approval.initialTestsPassed")} ok={stabilityDerivation.initialTestsPassed} />
            <div className="flex justify-between text-[11px]">
              <span className="text-muted">{t("approval.completedTimePointCount")}</span>
              <span className="text-text">{stabilityDerivation.completedTimePointCount}</span>
            </div>
            <SummaryRow label={t("approval.noOpenCriticalStabilityFailure")} ok={!stabilityDerivation.hasUnresolvedCriticalFailure} />
            <div className="flex justify-between text-[11px]">
              <span className="text-muted">{t("approval.packagingCompatibility")}</span>
              <span className={cn("font-medium", stabilityDerivation.packagingCompatibilityStatus === "passed" ? "text-success" : stabilityDerivation.packagingCompatibilityStatus === "not_required" ? "text-muted" : "text-error")}>
                {t(`approval.packagingStatus.${stabilityDerivation.packagingCompatibilityStatus}`)}
              </span>
            </div>
          </SummaryCard>
        )}
        <SummaryCard title={t("approval.validationCompatibilitySafetySummary")}>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted">{t("approval.compatibilityFindings")}</span>
            <span className="text-text">{compatibilityFindings.length}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted">{t("approval.safetyFindings")}</span>
            <span className="text-text">{safetyFindings.length}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted">{t("approval.classification")}</span>
            <span className="text-text">{classification}</span>
          </div>
        </SummaryCard>
        <SummaryCard title={t("approval.costSummary")}>
          <SummaryRow label={t("approval.costSnapshotPresent")} ok={hasCostSnapshot} muted={!costRequired} />
        </SummaryCard>
      </div>

      <Section title={t("approval.decisionHeading")}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[10px] text-muted">{t("approval.reviewerRole")}</span>
            <select value={reviewerRole} onChange={(e) => setReviewerRole(e.target.value as ApprovalRole)} className="w-full rounded-input border border-border bg-surface px-2 py-1 text-[11px] text-text">
              {APPROVAL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] text-muted">{t("approval.reviewerDisplayName")}</span>
            <input value={reviewerDisplayName} onChange={(e) => setReviewerDisplayName(e.target.value)} className="w-full rounded-input border border-border bg-surface px-2 py-1 text-[11px] text-text" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] text-muted">{t("approval.reviewerUserId")}</span>
            <input value={reviewerUserId} onChange={(e) => setReviewerUserId(e.target.value)} className="w-full rounded-input border border-border bg-surface px-2 py-1 text-[11px] text-text" />
          </label>
        </div>
        <label className="mt-2 block">
          <span className="mb-1 block text-[10px] text-muted">{t("approval.reason")}</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full rounded-input border border-border bg-surface px-2 py-1 text-[11px] text-text" />
        </label>
        {!APPROVAL_AUTHORITY[targetStatus].includes(reviewerRole) && (
          <p className="mt-1 text-[10px] text-error">{t("approval.roleNotAuthorized")}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() => void record("approved")}
            disabled={busy || !effectiveReady || !reviewerDisplayName.trim() || !reason.trim() || !canApprove}
            className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {t("approval.approveButton", { status: t(`approval.status.${targetStatus}`) })}
          </button>
          <button
            onClick={() => void record("rejected")}
            disabled={busy || !reviewerDisplayName.trim() || !reason.trim()}
            className="rounded-input border border-error/40 px-3 py-1.5 text-xs text-error hover:bg-error/10 disabled:opacity-40"
          >
            {t("approval.rejectButton")}
          </button>
          <button
            onClick={() => void record("cancelled")}
            disabled={busy}
            className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 disabled:opacity-40"
          >
            {t("approval.cancelButton")}
          </button>
        </div>
      </Section>

      <Section title={t("approval.historyHeading")}>
        {approvalRecords.length === 0 ? (
          <p className="text-[11px] text-muted">{t("approval.noHistory")}</p>
        ) : (
          <ul className="space-y-1.5">
            {[...approvalRecords]
              .sort((a, b) => b.approvedAt.localeCompare(a.approvedAt))
              .map((r) => (
                <li key={r.id} className="rounded-input border border-border px-2 py-1.5 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", r.decision === "approved" ? "bg-success/10 text-success" : r.decision === "blocked" ? "bg-error/10 text-error" : "bg-surface-2 text-muted")}>
                      {r.decision}
                    </span>
                    <span className="text-text">{r.requestedStatus ?? r.status}</span>
                    <span className="text-muted">{r.approvedBy}</span>
                    <span className="text-muted">{new Date(r.approvedAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-0.5 text-muted">{r.justification}</p>
                </li>
              ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

const DISABLED_EXAMPLE_POLICY: ApprovalPolicy = {
  schemaVersion: "1.0",
  id: "policy-example-pilot-lab-gate",
  name: "Example: require a completed trial before pilot approval (disabled)",
  productFamilyCodes: [],
  packagingSkuCodes: [],
  targetStatus: "pilot_approved",
  verificationStatus: "not_verified",
  active: false,
  requireCompletedTrial: true,
  requireAllRequiredTestsCompleted: true,
  requireAllCriticalTestsPassed: true,
  requireNoUnresolvedCriticalDeviation: true,
  requireNoUnresolvedCriticalCorrectiveAction: true,
  requireActiveStudy: false,
  requireInitialTestsPassed: false,
  requireNoUnresolvedCriticalFailure: false,
  requirePackagingCompatibilityPassed: false,
  requireCostSnapshot: false,
  createdBy: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function buildApprovalRecord(
  id: string,
  decision: ApprovalRecord["decision"],
  formulationId: string,
  versionId: string,
  previousStatus: FormulaStatus,
  requestedStatus: FormulaStatus,
  actor: Actor & { kind: "human" },
  reviewerDisplayName: string,
  justification: string,
  snapshot: { ready: boolean; blockers: DisplayFinding[]; warnings: ApprovalWarning[] },
  now: string,
): ApprovalRecord {
  return {
    schemaVersion: "1.0",
    id,
    formulationId,
    versionId,
    status: decision === "approved" ? requestedStatus : previousStatus,
    decision,
    previousStatus,
    requestedStatus,
    approvedBy: reviewerDisplayName.trim() || actor.userId,
    approvedByRole: actor.role,
    approvedAt: now,
    reviewerUserId: actor.userId,
    reviewerRole: actor.role,
    justification: justification.trim() || `${decision} without a stated reason`,
    readinessSnapshot: snapshot,
    createdAt: now,
  };
}

const POLICY_TOGGLES: { key: keyof ApprovalPolicy; labelKey: string }[] = [
  { key: "requireCompletedTrial", labelKey: "approval.hasCompletedTrial" },
  { key: "requireAllRequiredTestsCompleted", labelKey: "approval.allRequiredTestsCompleted" },
  { key: "requireAllCriticalTestsPassed", labelKey: "approval.allCriticalTestsPassed" },
  { key: "requireNoUnresolvedCriticalDeviation", labelKey: "approval.noOpenCriticalDeviation" },
  { key: "requireNoUnresolvedCriticalCorrectiveAction", labelKey: "approval.noOpenCriticalCorrectiveAction" },
  { key: "requireActiveStudy", labelKey: "approval.hasActiveOrCompletedStudy" },
  { key: "requireInitialTestsPassed", labelKey: "approval.initialTestsPassed" },
  { key: "requireNoUnresolvedCriticalFailure", labelKey: "approval.noOpenCriticalStabilityFailure" },
  { key: "requirePackagingCompatibilityPassed", labelKey: "approval.packagingCompatibility" },
  { key: "requireCostSnapshot", labelKey: "approval.costSnapshotPresent" },
];

function PolicyEditor({
  targetStatus,
  existing,
  onSave,
  t,
}: {
  targetStatus: FormulaStatus;
  existing: ApprovalPolicy[];
  onSave: (policy: ApprovalPolicy, isNew: boolean) => Promise<void>;
  t: SimpleT;
}) {
  const [name, setName] = useState("");
  const [toggles, setToggles] = useState<Partial<Record<keyof ApprovalPolicy, boolean>>>({});
  const [active, setActive] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    const now = new Date().toISOString();
    const policy: ApprovalPolicy = {
      schemaVersion: "1.0",
      id: newId("policy"),
      name: name.trim(),
      productFamilyCodes: [],
      packagingSkuCodes: [],
      targetStatus: targetStatus as "pilot_approved" | "production_approved",
      verificationStatus: "not_verified",
      active,
      requireCompletedTrial: !!toggles.requireCompletedTrial,
      requireAllRequiredTestsCompleted: !!toggles.requireAllRequiredTestsCompleted,
      requireAllCriticalTestsPassed: !!toggles.requireAllCriticalTestsPassed,
      requireNoUnresolvedCriticalDeviation: !!toggles.requireNoUnresolvedCriticalDeviation,
      requireNoUnresolvedCriticalCorrectiveAction: !!toggles.requireNoUnresolvedCriticalCorrectiveAction,
      requireActiveStudy: !!toggles.requireActiveStudy,
      requireInitialTestsPassed: !!toggles.requireInitialTestsPassed,
      requireNoUnresolvedCriticalFailure: !!toggles.requireNoUnresolvedCriticalFailure,
      requirePackagingCompatibilityPassed: !!toggles.requirePackagingCompatibilityPassed,
      requireCostSnapshot: !!toggles.requireCostSnapshot,
      createdBy: "local",
      createdAt: now,
      updatedAt: now,
    };
    await onSave(policy, true);
    setName("");
    setToggles({});
    setActive(false);
  };

  return (
    <div>
      {existing.length > 0 && (
        <ul className="mb-2 space-y-1">
          {existing.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-input border border-border-faint px-2 py-1 text-[11px]">
              <span className="text-text">{p.name}</span>
              <span className={cn("rounded px-1 py-0.5 text-[10px]", p.active ? "bg-success/10 text-success" : "bg-surface-2 text-muted")}>
                {p.active ? t("approval.ready") : t("approval.notReady")}
              </span>
              <button
                onClick={() => void onSave({ ...p, active: !p.active, updatedBy: "local", updatedAt: new Date().toISOString() }, false)}
                className="ml-auto text-accent hover:underline"
              >
                {t(p.active ? "approval.deactivatePolicy" : "approval.activatePolicy")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("approval.policy")} className="min-w-0 flex-1 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]" />
        <label className="flex items-center gap-1 text-[10px] text-muted">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t("approval.ready")}
        </label>
        <button onClick={() => void create()} disabled={!name.trim()} className="rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40">
          {t("common:actions.add")}
        </button>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1 sm:grid-cols-3">
        {POLICY_TOGGLES.map(({ key, labelKey }) => (
          <label key={key} className="flex items-center gap-1 text-[10px] text-muted">
            <input
              type="checkbox"
              checked={!!toggles[key]}
              onChange={(e) => setToggles((prev) => ({ ...prev, [key]: e.target.checked }))}
            />
            {t(labelKey)}
          </label>
        ))}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] text-muted">{label}</div>
      <div className="text-[12px] font-medium text-text">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-card border border-border p-3">
      <h4 className="mb-2 text-[11px] font-medium text-muted">{title}</h4>
      {children}
    </div>
  );
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-border p-2.5">
      <h5 className="mb-1.5 text-[10px] font-medium text-muted">{title}</h5>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function SummaryRow({ label, ok, muted }: { label: string; ok: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted">{label}</span>
      {muted ? (
        <span className="text-muted">—</span>
      ) : ok ? (
        <CheckCircle2 size={13} className="text-success" />
      ) : (
        <XCircle size={13} className="text-error" />
      )}
    </div>
  );
}
