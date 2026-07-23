/**
 * Derives the REAL facts `approvalReadiness.ts`'s `LabReadinessInput`/
 * `StabilityReadinessInput` need, from persisted laboratory and stability
 * records — spec §3.1/§3.2/§4. `assessApprovalReadiness` itself still never
 * reads a trial or a study; this module is the boundary that turns
 * `laboratory_trials`/`test_results`/`trial_deviations`/`corrective_actions`/
 * `stability_studies`/`stability_samples`/`stability_results`/
 * `stability_failures` into the plain booleans that module already
 * consumes, so the desktop UI never has to hand-supply a placeholder.
 *
 * Only a trial/study linked to the EXACT formula version being approved
 * satisfies readiness by default — `equivalentVersionIds` is an explicit,
 * documented opt-in for an organization that wants to accept evidence from
 * a named equivalent version instead.
 */
import { hasOpenCriticalDeviation } from "./laboratory";
import { hasOpenCriticalFailure } from "./stability";
import { isTestDefinitionApplicable, resolveApplicableTestDefinitions } from "./testApplicability";
import type { LabApprovalPolicy, LabReadinessInput, StabilityApprovalPolicy, StabilityReadinessInput } from "./approvalReadiness";
import type { LaboratoryTrial, TrialDeviation } from "../schemas/laboratory";
import type { StabilityFailure, StabilityResult, StabilitySample, StabilityStudy, StabilityTimePoint } from "../schemas/stability";
import type { TestDefinition, TestResult } from "../schemas/testDefinitions";
import type { CorrectiveAction } from "../schemas/correctiveActions";

const UNRESOLVED_CORRECTIVE_STATUSES = ["open", "in_progress", "awaiting_verification", "ineffective"] as const;

export interface DeriveLabReadinessInput {
  policy: LabApprovalPolicy;
  formulaVersionId: string;
  trials: LaboratoryTrial[];
  testDefinitions: TestDefinition[];
  testResults: TestResult[];
  deviations: TrialDeviation[];
  correctiveActions: CorrectiveAction[];
  /** Documented opt-in only — default behavior is the exact version alone. */
  equivalentVersionIds?: string[];
}

export function deriveLabReadiness(input: DeriveLabReadinessInput): LabReadinessInput {
  const acceptableVersionIds = new Set([input.formulaVersionId, ...(input.equivalentVersionIds ?? [])]);
  const relevantTrials = input.trials.filter((t) => t.sourceFormulaVersionId && acceptableVersionIds.has(t.sourceFormulaVersionId));
  const relevantTrialIds = new Set(relevantTrials.map((t) => t.id));

  const completedTrials = relevantTrials.filter((t) => t.status === "completed");
  const hasCompletedTrial = completedTrials.length > 0;

  const relevantResults = input.testResults.filter((r) => relevantTrialIds.has(r.trialId));

  let allRequiredTestsCompleted = hasCompletedTrial;
  let allCriticalTestsPassed = hasCompletedTrial;
  for (const trial of completedTrials) {
    const requirements = trial.testRequirementSnapshot
      ? trial.testRequirementSnapshot.entries
      : resolveApplicableTestDefinitions(input.testDefinitions, { productFamilyId: trial.productFamilyId, context: "trial" }).map((r) => ({
          testDefinitionId: r.definition.code,
          criticalTestFlag: r.definition.criticalTestFlag,
          required: r.required,
        }));
    const trialResults = relevantResults.filter((r) => r.trialId === trial.id);
    for (const req of requirements) {
      if (!req.required) continue;
      const result = trialResults.find((r) => r.testDefinitionId === req.testDefinitionId);
      if (!result || result.passFail === "not_evaluated") allRequiredTestsCompleted = false;
      if (req.criticalTestFlag && (!result || result.passFail !== "pass")) allCriticalTestsPassed = false;
    }
  }

  const relevantDeviations = input.deviations.filter((d) => relevantTrialIds.has(d.trialId));
  const hasUnresolvedCriticalDeviation = hasOpenCriticalDeviation(relevantDeviations);

  const criticalDeviationIds = new Set(relevantDeviations.filter((d) => d.severity === "critical").map((d) => d.id));
  const hasUnresolvedCriticalCorrectiveAction = input.correctiveActions.some(
    (a) =>
      (a.sourceType === "trial_deviation" || a.sourceType === "trial_failure") &&
      relevantTrialIds.has(a.sourceRecordId) &&
      a.deviationOrFailureId !== undefined &&
      criticalDeviationIds.has(a.deviationOrFailureId) &&
      (UNRESOLVED_CORRECTIVE_STATUSES as readonly string[]).includes(a.status),
  );

  return {
    policy: input.policy,
    hasCompletedTrial,
    allRequiredTestsCompleted,
    allCriticalTestsPassed,
    hasUnresolvedCriticalDeviation,
    hasUnresolvedCriticalCorrectiveAction,
  };
}

export const PACKAGING_COMPATIBILITY_STATUSES = ["passed", "failed", "incomplete", "not_required", "unknown"] as const;
export type PackagingCompatibilityStatus = (typeof PACKAGING_COMPATIBILITY_STATUSES)[number];

const PACKAGING_CAPABILITIES = ["packaging_compatibility", "seal_integrity", "leak_test"] as const;
const PACKAGING_FAILURE_TYPES = ["packaging_failure", "leakage", "seal_failure"] as const;

function latestRevisions(results: StabilityResult[]): StabilityResult[] {
  const superseded = new Set(results.map((r) => r.revisesResultId).filter((id): id is string => !!id));
  return results.filter((r) => !superseded.has(r.id));
}

export interface DerivePackagingCompatibilityInput {
  productFamilyId: string;
  packagingSkuCode: string;
  formulaVersionId: string;
  studies: StabilityStudy[];
  results: StabilityResult[];
  failures: StabilityFailure[];
  testDefinitions: TestDefinition[];
  equivalentVersionIds?: string[];
}

/**
 * Result-derived, never a manually supplied boolean — spec §4. `unknown`
 * (no relevant study exists yet, so there is no protocol to check against)
 * is returned distinctly from `not_required` (no packaging-capability test
 * applies at all) and never collapsed into `passed`.
 */
export function derivePackagingCompatibilityReadiness(input: DerivePackagingCompatibilityInput): PackagingCompatibilityStatus {
  const applicableDefs = input.testDefinitions.filter(
    (d) =>
      (PACKAGING_CAPABILITIES as readonly string[]).includes(d.testCapability ?? "general") &&
      isTestDefinitionApplicable(d, {
        productFamilyId: input.productFamilyId,
        context: "stability",
        packagingSkuCodes: [input.packagingSkuCode],
      }),
  );
  if (applicableDefs.length === 0) return "not_required";

  const acceptableVersionIds = new Set([input.formulaVersionId, ...(input.equivalentVersionIds ?? [])]);
  const relevantStudies = input.studies.filter(
    (s) => s.sourceFormulaVersionId && acceptableVersionIds.has(s.sourceFormulaVersionId) && s.packagingSkuCode === input.packagingSkuCode,
  );
  if (relevantStudies.length === 0) return "unknown";

  const relevantStudyIds = new Set(relevantStudies.map((s) => s.id));
  const applicableDefIds = new Set(applicableDefs.map((d) => d.code));
  const relevantResults = latestRevisions(input.results.filter((r) => relevantStudyIds.has(r.studyId) && applicableDefIds.has(r.testDefinitionId)));

  const unresolvedPackagingFailure = input.failures.some(
    (f) => relevantStudyIds.has(f.studyId) && (PACKAGING_FAILURE_TYPES as readonly string[]).includes(f.type) && f.investigationStatus !== "closed",
  );
  if (unresolvedPackagingFailure) return "failed";
  if (relevantResults.some((r) => r.passFail === "fail")) return "failed";
  if (relevantResults.length === 0 || relevantResults.some((r) => r.passFail === "not_evaluated")) return "incomplete";
  return "passed";
}

export interface DeriveStabilityReadinessInput {
  policy: StabilityApprovalPolicy;
  formulaVersionId: string;
  productFamilyId: string;
  packagingSkuCode?: string;
  studies: StabilityStudy[];
  samples: StabilitySample[];
  results: StabilityResult[];
  failures: StabilityFailure[];
  timePoints: StabilityTimePoint[];
  testDefinitions: TestDefinition[];
  equivalentVersionIds?: string[];
}

export interface StabilityReadinessDerivation extends StabilityReadinessInput {
  packagingCompatibilityStatus: PackagingCompatibilityStatus;
}

export function deriveStabilityReadiness(input: DeriveStabilityReadinessInput): StabilityReadinessDerivation {
  const acceptableVersionIds = new Set([input.formulaVersionId, ...(input.equivalentVersionIds ?? [])]);
  const relevantStudies = input.studies.filter(
    (s) =>
      s.sourceFormulaVersionId &&
      acceptableVersionIds.has(s.sourceFormulaVersionId) &&
      (!input.packagingSkuCode || s.packagingSkuCode === input.packagingSkuCode),
  );
  const relevantStudyIds = new Set(relevantStudies.map((s) => s.id));

  const hasActiveOrCompletedStudy = relevantStudies.some((s) => s.status === "active" || s.status === "completed");

  const relevantResults = input.results.filter((r) => relevantStudyIds.has(r.studyId));
  const relevantSamples = input.samples.filter((s) => relevantStudyIds.has(s.studyId));

  const initialTimePointIds = new Set(input.timePoints.filter((tp) => tp.daysFromStart === 0).map((tp) => tp.id));
  const initialResults = latestRevisions(relevantResults.filter((r) => initialTimePointIds.has(r.timePointId)));
  const initialTestsPassed = initialResults.length > 0 && initialResults.every((r) => r.passFail === "pass");

  const completedTimePointCount = new Set(relevantSamples.filter((s) => s.status === "completed").map((s) => s.timePointId)).size;

  const hasUnresolvedCriticalFailure = hasOpenCriticalFailure(input.failures.filter((f) => relevantStudyIds.has(f.studyId)));

  const packagingCompatibilityStatus = input.packagingSkuCode
    ? derivePackagingCompatibilityReadiness({
        productFamilyId: input.productFamilyId,
        packagingSkuCode: input.packagingSkuCode,
        formulaVersionId: input.formulaVersionId,
        studies: input.studies,
        results: input.results,
        failures: input.failures,
        testDefinitions: input.testDefinitions,
        equivalentVersionIds: input.equivalentVersionIds,
      })
    : "not_required";
  const packagingCompatibilityPassed = packagingCompatibilityStatus === "passed" || packagingCompatibilityStatus === "not_required";

  return {
    policy: input.policy,
    hasActiveOrCompletedStudy,
    initialTestsPassed,
    completedTimePointCount,
    hasUnresolvedCriticalFailure,
    packagingCompatibilityPassed,
    packagingCompatibilityStatus,
  };
}
