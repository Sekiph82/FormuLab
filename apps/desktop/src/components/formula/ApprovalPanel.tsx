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
  activeEquivalencesFor,
  assessApprovalReadiness,
  assessRegulatoryReadiness,
  attemptApprovalTransition,
  buildKenyaCatalog,
  classifyProductRegulatory,
  classifyProductSafety,
  clonePolicy,
  declareEquivalence,
  deriveLabReadiness,
  deriveRegulatoryReadiness,
  deriveStabilityReadiness,
  editPolicy,
  evaluateRegulatory,
  effectiveStatus,
  equivalentVersionIdsFor,
  evaluateCompatibility,
  evaluateSafety,
  initialPolicyRevision,
  newId,
  policyApplies,
  resolvePolicyPrecedence,
  restorePolicyRevision,
  retirePolicy,
  revokeEquivalence,
  setPolicyActive,
  templateForFamily,
  toLabApprovalPolicy,
  toRegulatoryApprovalPolicy,
  toStabilityApprovalPolicy,
  validateFormula,
  SEED_COMPATIBILITY_RULES,
  SEED_REGULATORY_RULES,
  SEED_SAFETY_RULES,
  SEED_STABILITY_TIME_POINTS,
  SEED_TEST_DEFINITIONS,
  type Actor,
  type ApprovalBlocker,
  type ApprovalPolicy,
  type ApprovalPolicyRevision,
  type ApprovalReadiness,
  type ApprovalRecord,
  type ApprovalRole,
  type ApprovalWarning,
  type AuditEvent,
  type CorrectiveAction,
  type CostSnapshot,
  type EvidenceReuseScope,
  type Formulation,
  type FormulationVersion,
  type FormulaStatus,
  type FormulaVersionEquivalence,
  type LaboratoryTrial,
  type OptimizationRun,
  type RawMaterial,
  type RegulatoryReview,
  type RegulatoryRule,
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
import { PolicyEditor } from "./PolicyEditor";
import { EquivalenceWorkflow } from "./EquivalenceWorkflow";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

type NavTarget = "builder" | "compatibility" | "safety" | "optimizer" | "trials" | "tests" | "stability" | "correctiveActions" | "cost" | "regulatory";

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
  regulatory: "regulatory",
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
  const [policyRevisions, setPolicyRevisions] = useState<ApprovalPolicyRevision[]>([]);
  const [equivalences, setEquivalences] = useState<FormulaVersionEquivalence[]>([]);
  const [approvalRecords, setApprovalRecords] = useState<ApprovalRecord[]>([]);
  const [regulatoryRules, setRegulatoryRules] = useState<RegulatoryRule[]>(SEED_REGULATORY_RULES);
  const [regulatoryReviews, setRegulatoryReviews] = useState<RegulatoryReview[]>([]);

  const load = useCallback(async () => {
    const [m, cr, sr, sres, tr, td, tres, dev, ca, st, sam, stres, fail, cs, opt, sub, pol, polrev, equiv, rec, regr, regrev] = await Promise.all([
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
      listRecords("approval_policy_revisions"),
      listRecords("formula_version_equivalences"),
      listApprovalRecords(formulation.id),
      listRecordsSeeded("regulatory_rules", SEED_REGULATORY_RULES),
      listRecords("regulatory_reviews"),
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
    setPolicyRevisions(polrev);
    setEquivalences(equiv.filter((e) => e.formulationId === formulation.id));
    setCostSnapshots(cs);
    setOptimizationRuns(opt);
    setSubstitutionRuns(sub);
    setPolicies(pol);
    setApprovalRecords(rec);
    setRegulatoryRules(regr);
    setRegulatoryReviews(regrev.filter((r) => r.formulationId === formulation.id));
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
    (p) => p.active && !p.retired && p.targetStatus === targetStatus && policyApplies(p, formulation.productFamilyCode, packagingSkuCode),
  );
  const [policyId, setPolicyId] = useState<string>("");
  const explicitPolicy = policies.find((p) => p.id === policyId && applicablePolicies.some((ap) => ap.id === p.id));
  const policyResolution = useMemo(
    () => resolvePolicyPrecedence(policies, targetStatus as "pilot_approved" | "production_approved", formulation.productFamilyCode, packagingSkuCode),
    [policies, targetStatus, formulation.productFamilyCode, packagingSkuCode],
  );
  // An explicit selector choice always wins; absent one, deterministic
  // precedence resolves it, or — when resolution is genuinely ambiguous —
  // no policy is applied and a structured conflict blocker is shown
  // instead of silently merging or guessing (spec §1.2).
  const activePolicy = explicitPolicy ?? policyResolution.resolved;
  const policyConflict = !explicitPolicy ? policyResolution.conflict : undefined;
  const [managingPolicies, setManagingPolicies] = useState(false);
  const [managingEquivalence, setManagingEquivalence] = useState(false);

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

  /** For the equivalence workflow's comparison view — the same live
   *  evaluation used for the selected version, run against an arbitrary
   *  candidate version's own lines. */
  const findingCountsForVersion = (version: FormulationVersion) => ({
    compatibility: evaluateCompatibility(version.lines, compatibilityRules, { materials, productDomain: family?.domain }).length,
    safety: evaluateSafety(version.lines, safetyRules, { materials }).length,
  });
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

  const labEquivalentVersionIds = selectedVersion ? equivalentVersionIdsFor(selectedVersion.id, "laboratory", equivalences) : [];
  const stabilityEquivalentVersionIds = selectedVersion ? equivalentVersionIdsFor(selectedVersion.id, "stability", equivalences) : [];
  const activeEquivalences = selectedVersion ? activeEquivalencesFor(selectedVersion.id, equivalences) : [];

  const labReadiness = selectedVersion
    ? deriveLabReadiness({
        policy: activePolicy ? toLabApprovalPolicy(activePolicy) : {},
        formulaVersionId: selectedVersion.id,
        trials,
        testDefinitions,
        testResults,
        deviations,
        correctiveActions,
        equivalentVersionIds: labEquivalentVersionIds,
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
        equivalentVersionIds: stabilityEquivalentVersionIds,
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
  const conflictBlocker: DisplayFinding | undefined = policyConflict
    ? { id: "policy:conflict", source: "policy", code: "policy_conflict", message: policyConflict.reason }
    : undefined;

  // Regulatory readiness — same one-layer-up pattern as the cost-snapshot
  // gate above: `assessApprovalReadiness` doesn't know about regulatory
  // rules, so this panel derives the facts from real persisted
  // rules/findings/reviews and folds the result into the same blocker
  // list. Scoped to the formulation's primary target market (first entry
  // in `targetMarkets`, defaulting to Kenya) — a multi-market product's
  // other jurisdictions are reviewed via the dedicated Regulatory tab,
  // which lets picking any of the seven.
  const primaryJurisdiction = (formulation.targetMarkets[0] as "KE" | "UG" | "TZ" | "RW" | "BI" | "SS" | "EAC" | undefined) ?? "KE";
  const regulatoryClassification = family ? classifyProductRegulatory({ family, claims: formulation.targetClaims, market: primaryJurisdiction }) : undefined;
  const regulatoryFindings = useMemo(
    () =>
      regulatoryClassification
        ? evaluateRegulatory(lines, regulatoryRules, { jurisdiction: primaryJurisdiction, category: regulatoryClassification.category, materials, claims: formulation.targetClaims })
        : [],
    [lines, regulatoryRules, primaryJurisdiction, regulatoryClassification, materials, formulation.targetClaims],
  );
  // The Regulatory tab (RegulatoryPanel.tsx) records a review against
  // "working_draft" always — it has no concept of which specific saved
  // formula version is being approved, only "the current formulation, in
  // this jurisdiction." So this gate matches by jurisdiction alone, not
  // by version id; a recorded review is treated as covering whichever
  // version is currently up for approval. Known simplification — see
  // docs/REGULATORY_ENGINE.md.
  const regulatoryReadinessInput = deriveRegulatoryReadiness({
    policy: activePolicy ? toRegulatoryApprovalPolicy(activePolicy) : {},
    classified: !!regulatoryClassification && !regulatoryClassification.uncertain,
    findings: regulatoryFindings,
    rules: regulatoryRules,
    reviews: regulatoryReviews,
    versionId: "working_draft",
    jurisdiction: primaryJurisdiction,
  });
  const regulatoryAssessment = assessRegulatoryReadiness(regulatoryReadinessInput);
  const regulatoryBlockers: DisplayFinding[] = regulatoryAssessment.blockers.map((b) => ({ id: b.id, source: "regulatory", code: b.code, message: b.message }));

  const allBlockers: DisplayFinding[] = [...readiness.blockers, ...(costBlocker ? [costBlocker] : []), ...(conflictBlocker ? [conflictBlocker] : []), ...regulatoryBlockers];
  const allWarnings: (ApprovalWarning | DisplayFinding)[] = readiness.warnings;
  const effectiveReady = readiness.ready && !costBlocker && !conflictBlocker && regulatoryAssessment.ready;

  const canApprove = !!selectedVersion && targetOptions.includes(targetStatus) && APPROVAL_AUTHORITY[targetStatus].includes(reviewerRole);

  const buildReadinessSnapshot = () => ({ ready: effectiveReady, blockers: allBlockers, warnings: readiness.warnings });

  const navigate = (finding: DisplayFinding) => {
    if (finding.source === "policy") {
      setManagingPolicies(true);
      return;
    }
    if (finding.lineId) onFocusLine(finding.lineId);
    const target = (finding.code && CODE_NAV_OVERRIDE[finding.code]) || SOURCE_NAV[finding.source] || "builder";
    onNavigate(target);
  };

  const policyActor: Actor = { kind: "human", role: reviewerRole, userId: reviewerUserId.trim() || "local" };

  const persistPolicyChange = async ({ policy, revision }: { policy: ApprovalPolicy; revision: ApprovalPolicyRevision }) => {
    await upsertRecords("approval_policies", [policy]);
    await upsertRecords("approval_policy_revisions", [revision]);
    setPolicies((prev) => (prev.some((p) => p.id === policy.id) ? prev.map((p) => (p.id === policy.id ? policy : p)) : [...prev, policy]));
    setPolicyRevisions((prev) => [...prev, revision]);
    setPolicyId(policy.id);
    await appendAudit(
      auditEvent(formulation.id, "approval.policy_changed", {
        detail: `${revision.changeType} "${policy.name}" (revision ${revision.revisionNumber})`,
        metadata: { policyId: policy.id, revisionId: revision.id, changeType: revision.changeType, changedBy: revision.changedBy },
      }),
    );
  };

  const handleCreatePolicy = (policy: ApprovalPolicy) => persistPolicyChange({ policy, revision: initialPolicyRevision(policy, policyActor) });
  const handleEditPolicy = (current: ApprovalPolicy, updates: Partial<ApprovalPolicy>, reason: string) =>
    persistPolicyChange(editPolicy(current, updates, policyActor, reason));
  const handleToggleActive = (current: ApprovalPolicy, active: boolean) => persistPolicyChange(setPolicyActive(current, active, policyActor));
  const handleRetirePolicy = (current: ApprovalPolicy, reason: string) => persistPolicyChange(retirePolicy(current, policyActor, reason));
  const handleClonePolicy = (source: ApprovalPolicy, newName: string) => persistPolicyChange(clonePolicy(source, policyActor, newName));
  const handleRestoreRevision = (current: ApprovalPolicy, revision: ApprovalPolicyRevision) =>
    persistPolicyChange(restorePolicyRevision(current, revision, policyActor));

  const handleDeclareEquivalence = async (equivalentVersionId: string, scope: EvidenceReuseScope, justification: string) => {
    if (!selectedVersion) return;
    const eq = declareEquivalence(
      { formulationId: formulation.id, sourceVersionId: selectedVersion.id, equivalentVersionId, evidenceReuseScope: scope, justification },
      policyActor,
    );
    await upsertRecords("formula_version_equivalences", [eq]);
    setEquivalences((prev) => [...prev, eq]);
    await appendAudit(
      auditEvent(formulation.id, "equivalence.declared", {
        versionId: eq.sourceVersionId,
        detail: `${eq.equivalentVersionId} (${eq.evidenceReuseScope})`,
        metadata: { equivalenceId: eq.id, equivalentVersionId: eq.equivalentVersionId, scope: eq.evidenceReuseScope },
      }),
    );
  };

  const handleRevokeEquivalence = async (eq: FormulaVersionEquivalence, reason: string) => {
    const revocation = revokeEquivalence(eq, policyActor, reason);
    await upsertRecords("formula_version_equivalences", [revocation]);
    setEquivalences((prev) => [...prev, revocation]);
    await appendAudit(
      auditEvent(formulation.id, "equivalence.revoked", {
        versionId: eq.sourceVersionId,
        detail: reason,
        metadata: { equivalenceId: eq.id, revocationId: revocation.id },
      }),
    );
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
            aria-label={t("approval.policy")}
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
          <div className="mt-1 flex gap-2">
            <button onClick={() => setManagingPolicies((v) => !v)} className="text-[10px] text-accent hover:underline">
              {t("approval.managePolicies")}
            </button>
            <button onClick={() => setManagingEquivalence((v) => !v)} className="text-[10px] text-accent hover:underline">
              {t("approval.equivalenceHeading")}
              {activeEquivalences.length > 0 && ` (${activeEquivalences.length})`}
            </button>
          </div>
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
            policies={policies}
            revisions={policyRevisions}
            productFamilyOptions={catalog.families.map((f) => f.code)}
            packagingSkuOptions={formulation.targetSkuCodes}
            onCreate={handleCreatePolicy}
            onEdit={handleEditPolicy}
            onToggleActive={handleToggleActive}
            onRetire={handleRetirePolicy}
            onClone={handleClonePolicy}
            onRestoreRevision={handleRestoreRevision}
            t={t}
          />
        </Section>
      )}

      {managingEquivalence && selectedVersion && (
        <Section title={t("approval.equivalenceHeading")}>
          <EquivalenceWorkflow
            versions={versions}
            sourceVersion={selectedVersion}
            activeEquivalences={activeEquivalences}
            findingCounts={findingCountsForVersion}
            onDeclare={handleDeclareEquivalence}
            onRevoke={handleRevokeEquivalence}
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
            {labEquivalentVersionIds.length > 0 && (
              <p className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">{t("approval.evidenceFromEquivalent", { versions: labEquivalentVersionIds.join(", ") })}</p>
            )}
            <SummaryRow label={t("approval.hasCompletedTrial")} ok={labReadiness.hasCompletedTrial} />
            <SummaryRow label={t("approval.allRequiredTestsCompleted")} ok={labReadiness.allRequiredTestsCompleted} />
            <SummaryRow label={t("approval.allCriticalTestsPassed")} ok={labReadiness.allCriticalTestsPassed} />
            <SummaryRow label={t("approval.noOpenCriticalDeviation")} ok={!labReadiness.hasUnresolvedCriticalDeviation} />
            <SummaryRow label={t("approval.noOpenCriticalCorrectiveAction")} ok={!labReadiness.hasUnresolvedCriticalCorrectiveAction} />
          </SummaryCard>
        )}
        {stabilityDerivation && (
          <SummaryCard title={t("approval.stabilitySummary")}>
            {stabilityEquivalentVersionIds.length > 0 && (
              <p className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">{t("approval.evidenceFromEquivalent", { versions: stabilityEquivalentVersionIds.join(", ") })}</p>
            )}
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
        <SummaryCard title={t("regulatory.approvalSummaryHeading")}>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted">{t("regulatory.approvalSummaryJurisdiction")}</span>
            <span className="text-text">{t(`regulatory.jurisdiction.${primaryJurisdiction}`)}</span>
          </div>
          {regulatoryClassification && (
            <div className="flex justify-between text-[11px]">
              <span className="text-muted">{t("regulatory.approvalSummaryCategory")}</span>
              <span className="text-text">{t(`regulatory.category.${regulatoryClassification.category}`)}</span>
            </div>
          )}
          <div className="flex justify-between text-[11px]">
            <span className="text-muted">{t("regulatory.approvalSummaryFindings")}</span>
            <span className="text-text">{regulatoryFindings.length}</span>
          </div>
          <SummaryRow
            label={t("regulatory.approvalSummaryNoBlockingFinding")}
            ok={!regulatoryReadinessInput.hasBlockingFinding}
            muted={!activePolicy?.requireNoBlockingRegulatoryFinding}
          />
          <SummaryRow
            label={t("regulatory.approvalSummaryHumanReview")}
            ok={regulatoryReadinessInput.humanReviewCompleted}
            muted={!activePolicy?.requireHumanRegulatoryReviewCompleted}
          />
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
  retired: false,
  revisionNumber: 1,
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
  requireRegulatoryClassificationCompleted: false,
  requireNoBlockingRegulatoryFinding: false,
  requireAllMandatoryDocumentsPresent: false,
  requireAllMandatoryEvidencePresent: false,
  requireAllRequiredClaimsReviewed: false,
  requireHumanRegulatoryReviewCompleted: false,
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
