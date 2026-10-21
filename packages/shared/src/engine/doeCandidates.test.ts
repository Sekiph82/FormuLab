import { describe, expect, it } from "vitest";
import type { Actor } from "../schemas/status";
import type { DoeCandidate, DoeConstraint, DoeDesign, DoeFactor, DoeObservation, DoeResponse, DoeRun, DoeStudy } from "../schemas/doe";
import { doeCandidateSchema } from "../schemas/doe";
import type { FormulationVersion } from "../schemas/formulation";
import type { InventoryRecord, MaterialPrice, RawMaterial } from "../schemas/materials";
import type { SafetyRule } from "../schemas/safety";
import type { RegulatoryRule } from "../schemas/regulatory";
import {
  applyDoeCandidateToDraft,
  assertDoeCandidateHumanSelected,
  calculateOverallDesirability,
  calculateResponseDesirability,
  createDoeCandidates,
  createDoeRunFromAcceptedCandidate,
  defineDoeExperimentSpace,
  evaluateDoeCandidateFeasibility,
  evaluateDoeCandidateHardExclusions,
  evaluateDoeCandidateAcquisition,
  diversifyDoeCandidates,
  evaluateDoeCandidateMaterialCost,
  isDoeCandidateEligibleForSelection,
  rankDoeCandidatesByAcquisition,
  rankDoeCandidates,
  searchDoeCandidateSpace,
  validateDoeCandidate,
  type AnalysisForPrediction,
} from "./doeCandidates";

const HUMAN: Actor = { kind: "human", role: "researcher", userId: "alice" };

function factor(overrides: Partial<DoeFactor> & Pick<DoeFactor, "factorCode">): DoeFactor {
  return {
    schemaVersion: "1.0",
    id: `factor-${overrides.factorCode}`,
    studyId: "study-1",
    studyRevision: 1,
    name: overrides.factorCode,
    factorType: "continuous",
    sourceType: "process_parameter",
    sourceEntityId: overrides.factorCode,
    lowValue: "10",
    centerValue: "15",
    highValue: "20",
    categoricalLevels: [],
    transformation: "none",
    precision: 2,
    isMixtureComponent: false,
    isProcessFactor: true,
    isControlled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function response(overrides: Partial<DoeResponse> = {}): DoeResponse {
  return {
    schemaVersion: "1.0",
    id: overrides.id ?? "response-1",
    studyId: "study-1",
    studyRevision: 1,
    responseCode: "Y",
    name: "Y",
    responseType: "continuous",
    objective: "maximize",
    weight: "1",
    desirabilityShape: "linear",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("calculateResponseDesirability", () => {
  it("maximize: 0 at/below lower limit, 1 at/above upper limit, linear between", () => {
    const r = response({ objective: "maximize", lowerLimit: "0", upperLimit: "10" });
    expect(calculateResponseDesirability(r, -5)).toBe(0);
    expect(calculateResponseDesirability(r, 0)).toBe(0);
    expect(calculateResponseDesirability(r, 10)).toBe(1);
    expect(calculateResponseDesirability(r, 15)).toBe(1);
    expect(calculateResponseDesirability(r, 5)).toBeCloseTo(0.5, 6);
  });

  it("minimize is the mirror of maximize", () => {
    const r = response({ objective: "minimize", lowerLimit: "0", upperLimit: "10" });
    expect(calculateResponseDesirability(r, 0)).toBe(1);
    expect(calculateResponseDesirability(r, 10)).toBe(0);
    expect(calculateResponseDesirability(r, 5)).toBeCloseTo(0.5, 6);
  });

  it("target: 1 exactly at target, 0 outside the tolerance band, triangular between", () => {
    const r = response({ objective: "target", lowerLimit: "0", targetValue: "5", upperLimit: "10" });
    expect(calculateResponseDesirability(r, 5)).toBe(1);
    expect(calculateResponseDesirability(r, 0)).toBe(0);
    expect(calculateResponseDesirability(r, 10)).toBe(0);
    expect(calculateResponseDesirability(r, 2.5)).toBeCloseTo(0.5, 6);
    expect(calculateResponseDesirability(r, 7.5)).toBeCloseTo(0.5, 6);
  });

  it("within_range: 1 inside inclusive bounds, 0 outside, no tapering", () => {
    const r = response({ objective: "within_range", lowerLimit: "4", upperLimit: "6" });
    expect(calculateResponseDesirability(r, 5)).toBe(1);
    expect(calculateResponseDesirability(r, 4)).toBe(1);
    expect(calculateResponseDesirability(r, 6)).toBe(1);
    expect(calculateResponseDesirability(r, 6.1)).toBe(0);
  });

  it("observe_only is always fully desirable", () => {
    const r = response({ objective: "observe_only" });
    expect(calculateResponseDesirability(r, -1000)).toBe(1);
    expect(calculateResponseDesirability(r, 1000)).toBe(1);
  });

  it("concave/convex shapes bend the linear ramp as expected", () => {
    const linear = response({ objective: "maximize", lowerLimit: "0", upperLimit: "10", desirabilityShape: "linear" });
    const concave = response({ objective: "maximize", lowerLimit: "0", upperLimit: "10", desirabilityShape: "concave" });
    const convex = response({ objective: "maximize", lowerLimit: "0", upperLimit: "10", desirabilityShape: "convex" });
    expect(calculateResponseDesirability(concave, 2.5)).toBeGreaterThan(calculateResponseDesirability(linear, 2.5));
    expect(calculateResponseDesirability(convex, 2.5)).toBeLessThan(calculateResponseDesirability(linear, 2.5));
  });
});

describe("calculateOverallDesirability", () => {
  it("computes the weighted geometric mean across responses", () => {
    const r1 = response({ id: "r1", objective: "maximize", lowerLimit: "0", upperLimit: "10", weight: "1" });
    const r2 = response({ id: "r2", objective: "maximize", lowerLimit: "0", upperLimit: "10", weight: "1" });
    const predicted = new Map([["r1", 10], ["r2", 10]]);
    expect(calculateOverallDesirability([r1, r2], predicted)).toBeCloseTo(1, 6);
  });

  it("any response scoring 0 sinks the overall desirability to 0", () => {
    const r1 = response({ id: "r1", objective: "maximize", lowerLimit: "0", upperLimit: "10" });
    const r2 = response({ id: "r2", objective: "within_range", lowerLimit: "4", upperLimit: "6" });
    const predicted = new Map([["r1", 10], ["r2", 100]]); // r2 way outside range -> 0
    expect(calculateOverallDesirability([r1, r2], predicted)).toBe(0);
  });

  it("ignores observe_only responses in the weighting", () => {
    const r1 = response({ id: "r1", objective: "maximize", lowerLimit: "0", upperLimit: "10" });
    const r2 = response({ id: "r2", objective: "observe_only" });
    const predicted = new Map([["r1", 10], ["r2", -99999]]);
    expect(calculateOverallDesirability([r1, r2], predicted)).toBeCloseTo(1, 6);
  });

  it("a heavier weight pulls the geometric mean toward that response's score", () => {
    // r1 is perfect (d=1), r2 is nearly worst (d=0.0001, not exactly 0 so the
    // hard-zero rule doesn't just force the whole thing to 0). Weighting r1
    // ten times more heavily should pull the overall score up compared to
    // weighting both responses equally.
    const predicted = new Map([["r1", 10], ["r2", 0.001]]);
    const equalWeight = calculateOverallDesirability(
      [response({ id: "r1", objective: "maximize", lowerLimit: "0", upperLimit: "10", weight: "1" }), response({ id: "r2", objective: "maximize", lowerLimit: "0", upperLimit: "10", weight: "1" })],
      predicted,
    );
    const heavyWeightOnR1 = calculateOverallDesirability(
      [response({ id: "r1", objective: "maximize", lowerLimit: "0", upperLimit: "10", weight: "10" }), response({ id: "r2", objective: "maximize", lowerLimit: "0", upperLimit: "10", weight: "1" })],
      predicted,
    );
    expect(heavyWeightOnR1).toBeGreaterThan(equalWeight);
  });
});

describe("searchDoeCandidateSpace", () => {
  const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
  const response1 = response({ id: "r1", objective: "maximize", lowerLimit: "10", upperLimit: "20" });
  const analyses: AnalysisForPrediction[] = [
    { responseId: "r1", analysisId: "analysis-1", terms: ["intercept", "A", "B"], coefficients: [15, 2, 1], observedCodedRanges: { A: { min: -1, max: 1 }, B: { min: -1, max: 1 } } },
  ];

  it("is reproducible for the same seed", () => {
    const input = { factors, constraints: [], responses: [response1], analyses, seed: 42, candidateCount: 20 };
    const first = searchDoeCandidateSpace(input);
    const second = searchDoeCandidateSpace(input);
    expect(first).toEqual(second);
  });

  it("produces a different set for a different seed", () => {
    const base = { factors, constraints: [], responses: [response1], analyses, candidateCount: 20 };
    const a = searchDoeCandidateSpace({ ...base, seed: 1 });
    const b = searchDoeCandidateSpace({ ...base, seed: 2 });
    expect(a).not.toEqual(b);
  });

  it("keeps every non-mixture numeric factor's coded value within the design's [-1, 1] space", () => {
    const results = searchDoeCandidateSpace({ factors, constraints: [], responses: [response1], analyses, seed: 5, candidateCount: 50 });
    for (const c of results) {
      for (const s of c.factorSettings) {
        expect(Number(s.codedValue)).toBeGreaterThanOrEqual(-1);
        expect(Number(s.codedValue)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("drops every candidate that violates a hard constraint", () => {
    const constraint: DoeConstraint = { schemaVersion: "1.0", id: "c1", studyId: "s", studyRevision: 1, constraintType: "upper_bound", expression: "A <= -0.99", severity: "hard", appliesTo: ["A"], createdBy: "alice", createdAt: "now" };
    const results = searchDoeCandidateSpace({ factors, constraints: [constraint], responses: [response1], analyses, seed: 5, candidateCount: 50 });
    for (const c of results) {
      const aValue = Number(c.factorSettings.find((s) => s.factorCode === "A")!.codedValue);
      expect(aValue).toBeLessThanOrEqual(-0.99 + 1e-6);
    }
  });

  it("mixture-component candidates always sum to exactly 1 (before per-factor rounding)", () => {
    const mixtureFactors = [factor({ factorCode: "X", isMixtureComponent: true }), factor({ factorCode: "Y", isMixtureComponent: true }), factor({ factorCode: "Z", isMixtureComponent: true })];
    const results = searchDoeCandidateSpace({ factors: mixtureFactors, constraints: [], responses: [], analyses: [], seed: 3, candidateCount: 30 });
    for (const c of results) {
      // codedValue carries the exact, unrounded fraction; actualValue is
      // rounded to the factor's display precision and so may drift slightly.
      const codedSum = c.factorSettings.reduce((s, setting) => s + Number(setting.codedValue), 0);
      expect(codedSum).toBeCloseTo(1, 6);
      const actualSum = c.factorSettings.reduce((s, setting) => s + Number(setting.actualValue), 0);
      expect(Math.abs(actualSum - 1)).toBeLessThan(0.05);
    }
  });

  it("every prediction cites the analysis it came from", () => {
    const results = searchDoeCandidateSpace({ factors, constraints: [], responses: [response1], analyses, seed: 9, candidateCount: 5 });
    for (const c of results) {
      for (const p of c.predictedResponses) expect(p.analysisId).toBe("analysis-1");
    }
  });

  it("rejects empty or unbounded candidate requests instead of inventing a space", () => {
    expect(() => searchDoeCandidateSpace({ factors: [], constraints: [], responses: [], analyses: [], seed: 1 })).toThrow(/at least one DOE factor/i);
    expect(() => searchDoeCandidateSpace({ factors, constraints: [], responses: [], analyses: [], seed: 1, candidateCount: 501 })).toThrow(/from 1 to 500/i);
  });
});

describe("defineDoeExperimentSpace", () => {
  const materialFactor = factor({ factorCode: "A", sourceType: "formula_material", sourceEntityId: "material-a" });
  const study: DoeStudy = {
    schemaVersion: "1.0", id: "study-1", studyCode: "DOE-1", title: "Study", projectId: "project-1",
    formulationId: "formula-1", baselineFormulaVersionId: "version-1", status: "analyzed", designType: "full_factorial",
    randomizationEnabled: true, blockingEnabled: false, replicatePolicy: "none", centerPointPolicy: "none", revision: 1,
    createdBy: "alice", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const design: DoeDesign = {
    schemaVersion: "1.0", id: "design-1", studyId: "study-1", studyRevision: 1, designType: "full_factorial",
    factorSnapshot: [materialFactor], constraintSnapshot: [], responseSnapshot: [], generationSettings: {}, seed: 42,
    runCount: 2, replicateCount: 0, centerPointCount: 0, blockCount: 1, generatedBy: "alice", generatedAt: "2026-01-01T00:00:00.000Z",
    diagnostics: { runCount: 2, degreesOfFreedom: 1, duplicateRunCount: 0, estimableTerms: [], aliasedTerms: [], isOrthogonal: true, isBalanced: true, centerPointCount: 0, replicateCount: 0, constraintViolationCount: 0, warnings: [] },
  };
  const baseline: FormulationVersion = {
    schemaVersion: "1.0", id: "version-1", formulationId: "formula-1", versionNumber: 1, status: "pilot_approved", author: "alice",
    createdAt: "2026-01-01T00:00:00.000Z", lines: [
      { id: "line-a", lineNumber: 1, phase: "A", displayName: "Material A", materialId: "material-a", percent: "10", functions: [], isQsToHundred: false, provenance: { origin: "chemist_override", evidenceClaimIds: [] } },
      { id: "line-water", lineNumber: 2, phase: "A", displayName: "Water", materialId: "water", percent: "90", functions: [], isQsToHundred: false, provenance: { origin: "chemist_override", evidenceClaimIds: [] } },
    ], basisBatchKg: "100", sourceRunIds: [], regulatoryFindingIds: [], compatibilityFindingIds: [], safetyFindingIds: [], approvalRecordIds: [],
  };
  const input = { study, design, baselineFormulaVersion: baseline, factors: [materialFactor], constraints: [] as DoeConstraint[], responses: [] as DoeResponse[], seed: 42 };

  it("defines a reproducible bounded space with exact DOE/formula lineage and unchanged formula lines", () => {
    const first = defineDoeExperimentSpace(input);
    expect(first).toEqual(defineDoeExperimentSpace(input));
    expect(first).toMatchObject({ policyVersion: "doe-experiment-space/v1", studyId: "study-1", studyRevision: 1, designId: "design-1", sourceFormulaVersionId: "version-1", seed: 42, candidateCount: 200, manipulatedFactorCodes: ["A"], unchangedFormulaLineIds: ["line-water"] });
  });

  it("refuses stale, mismatched, empty, and invalid-range spaces", () => {
    expect(() => defineDoeExperimentSpace({ ...input, seed: 8 })).toThrow(/match the frozen DOE design seed/i);
    expect(() => defineDoeExperimentSpace({ ...input, study: { ...study, revision: 2 } })).toThrow(/current study revision/i);
    expect(() => defineDoeExperimentSpace({ ...input, factors: [] })).toThrow(/at least one DOE factor/i);
    const invalidRangeFactor = factor({ ...materialFactor, lowValue: undefined, highValue: undefined });
    expect(() => defineDoeExperimentSpace({ ...input, design: { ...design, factorSnapshot: [invalidRangeFactor] }, factors: [invalidRangeFactor] })).toThrow(/finite, ordered/i);
    expect(() => defineDoeExperimentSpace({ ...input, candidateCount: 501 })).toThrow(/from 1 to 500/i);
  });
});

describe("evaluateDoeCandidateFeasibility", () => {
  const baseline: FormulationVersion = {
    schemaVersion: "1.0", id: "version-1", formulationId: "formula-1", versionNumber: 1, status: "pilot_approved", author: "alice",
    createdAt: "2026-01-01T00:00:00.000Z", basisBatchKg: "100", sourceRunIds: [], regulatoryFindingIds: [], compatibilityFindingIds: [], safetyFindingIds: [], approvalRecordIds: [],
    lines: [
      { id: "line-a", lineNumber: 1, phase: "A", displayName: "Material A", materialId: "material-a", materialCode: "MAT-A", percent: "10", functions: [], isQsToHundred: false, provenance: { origin: "chemist_override", evidenceClaimIds: [] } },
      { id: "line-water", lineNumber: 2, phase: "A", displayName: "Water", materialId: "water", materialCode: "WATER", percent: "90", functions: [], isQsToHundred: false, provenance: { origin: "chemist_override", evidenceClaimIds: [] } },
    ],
  };
  const inventory = (materialCode: string, quantity: string): InventoryRecord => ({
    schemaVersion: "1.0", code: `INV-${materialCode}`, materialCode, warehouse: "main", quantity, unit: "kg", reservedQuantity: "0",
    coaStatus: "not_required", quarantined: false, released: true, updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const candidate = { factorSettings: [{ factorCode: "A", codedValue: "1", actualValue: "20" }], constraintStatus: [] };

  it("uses the canonical inventory authority for a feasible candidate", () => {
    const result = evaluateDoeCandidateFeasibility({ candidate, baselineFormulaVersion: baseline, factors: [factor({ factorCode: "A", sourceType: "formula_material", sourceEntityId: "material-a", isProcessFactor: false })], constraints: [], inventoryRecords: [inventory("MAT-A", "25"), inventory("WATER", "100")], evaluatedAt: "2026-01-01T00:00:00.000Z" });
    expect(result.status).toBe("FEASIBLE");
    expect(result.reasons).toEqual([]);
  });

  it("keeps missing inventory and process limits UNKNOWN and insufficient stock INFEASIBLE", () => {
    const noInventory = evaluateDoeCandidateFeasibility({ candidate, baselineFormulaVersion: baseline, factors: [factor({ factorCode: "A", sourceType: "formula_material", sourceEntityId: "material-a", isProcessFactor: false })], constraints: [], inventoryRecords: [inventory("WATER", "100")], evaluatedAt: "2026-01-01T00:00:00.000Z" });
    expect(noInventory.status).toBe("UNKNOWN");
    expect(noInventory.reasons.some((reason) => reason.code === "MATERIAL_AVAILABILITY_UNKNOWN")).toBe(true);

    const insufficient = evaluateDoeCandidateFeasibility({ candidate, baselineFormulaVersion: baseline, factors: [factor({ factorCode: "A", sourceType: "formula_material", sourceEntityId: "material-a", isProcessFactor: false })], constraints: [], inventoryRecords: [inventory("MAT-A", "1"), inventory("WATER", "100")], evaluatedAt: "2026-01-01T00:00:00.000Z" });
    expect(insufficient.status).toBe("INFEASIBLE");
    expect(insufficient.reasons.some((reason) => reason.code === "INSUFFICIENT_MATERIAL")).toBe(true);

    const processFactor = factor({ factorCode: "TEMP", sourceType: "temperature", isProcessFactor: true });
    const missingManufacturing = evaluateDoeCandidateFeasibility({ candidate: { factorSettings: [{ factorCode: "TEMP", codedValue: "1", actualValue: "20" }], constraintStatus: [] }, baselineFormulaVersion: baseline, factors: [processFactor], constraints: [], inventoryRecords: [inventory("MAT-A", "20"), inventory("WATER", "100")], evaluatedAt: "2026-01-01T00:00:00.000Z" });
    expect(missingManufacturing.status).toBe("UNKNOWN");
    expect(missingManufacturing.reasons.some((reason) => reason.code === "MANUFACTURING_LIMITS_UNAVAILABLE")).toBe(true);
  });

  it("preserves hard DOE constraint failures as machine-readable rejection reasons", () => {
    const constraint: DoeConstraint = { schemaVersion: "1.0", id: "process-limit-1", studyId: "study-1", studyRevision: 1, constraintType: "process_limit", expression: "A <= 30", severity: "hard", appliesTo: ["A"], createdBy: "alice", createdAt: "2026-01-01T00:00:00.000Z" };
    const result = evaluateDoeCandidateFeasibility({ candidate: { ...candidate, constraintStatus: [{ constraintId: constraint.id, satisfied: false, severity: "hard", message: "Temperature exceeds the declared limit." }] }, baselineFormulaVersion: baseline, factors: [], constraints: [constraint], inventoryRecords: [inventory("MAT-A", "20"), inventory("WATER", "100")], evaluatedAt: "2026-01-01T00:00:00.000Z" });
    expect(result.status).toBe("INFEASIBLE");
    expect(result.reasons).toContainEqual(expect.objectContaining({ code: "DOE_HARD_CONSTRAINT_FAILED", sourceId: constraint.id, message: "Temperature exceeds the declared limit." }));
  });
});

describe("evaluateDoeCandidateHardExclusions", () => {
  const lineBaseline: FormulationVersion = {
    schemaVersion: "1.0", id: "version-1", formulationId: "formula-1", versionNumber: 1, status: "pilot_approved", author: "alice",
    createdAt: "2026-01-01T00:00:00.000Z", basisBatchKg: "100", sourceRunIds: [], regulatoryFindingIds: [], compatibilityFindingIds: [], safetyFindingIds: [], approvalRecordIds: [],
    lines: [{ id: "line-a", lineNumber: 1, phase: "A", displayName: "Material A", materialId: "material-a", materialCode: "MAT-A", percent: "10", functions: [], isQsToHundred: false, provenance: { origin: "chemist_override", evidenceClaimIds: [] } }],
  };
  const material: RawMaterial = {
    schemaVersion: "1.0", code: "MAT-A", displayName: "Material A", casNumbers: [], ecNumbers: [], functions: [], activeMatterState: "known",
    documents: [], regulatoryStatuses: [], hazardClassifications: [], allergens: [], incompatibilities: [], substituteCodes: [], active: true,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const safetyRule: SafetyRule = {
    schemaVersion: "1.0", id: "safety-rule-1", version: "1", name: "Block material", status: "verified", severity: "blocking", category: "test",
    ruleType: "forbidden_combination", conditions: [{ materialCodesAny: ["MAT-A"] }], message: "This material combination is blocked.", requiredPpe: [], requiredEngineeringControls: [],
    sourceReferences: ["test-source"], verificationStatus: "verified", alwaysRequiresHumanReview: false, active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const regulatoryRule: RegulatoryRule = {
    schemaVersion: "1.0", id: "reg-rule-1", code: "KE-TEST-1", name: "Prohibit material", jurisdiction: "KE", authority: "test", ruleType: "ingredient_prohibition",
    productCategories: [], requirement: "This material is prohibited.", severity: "blocking", status: "verified", conditions: [{ materialCodesAny: ["MAT-A"] }], claimKeywordsAny: [],
    requiredEvidenceTypes: [], requiredLabelElements: [], requiredWarnings: [], requiredDocumentTypes: [], requiredTestTypes: [], requiredPackagingElements: [], requiredLanguages: [],
    requiresRegistration: false, requiresNotification: false, requiresResponsiblePartyInMarket: false, requiresMarketSpecificIdentifier: false, version: 1, verificationStatus: "verified",
    humanReviewStatus: "review_required", active: true, createdBy: "alice", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("preserves authoritative Safety and Regulatory FAIL as hard exclusions", () => {
    const result = evaluateDoeCandidateHardExclusions({ candidate: { factorSettings: [] }, baselineFormulaVersion: lineBaseline, factors: [], materials: [material], safetyRules: [safetyRule], regulatoryRules: [regulatoryRule], jurisdictions: ["KE"] });
    expect(result.safety.status).toBe("FAIL");
    expect(result.safety.findingIds).toContain(`safety-finding:${safetyRule.id}:line-a:0`);
    expect(result.regulatory.status).toBe("FAIL");
    expect(result.regulatory.findingIds[0]).toContain(regulatoryRule.id);
  });

  it("does not turn absent or unverified Safety/Regulatory evidence into PASS", () => {
    const absent = evaluateDoeCandidateHardExclusions({ candidate: { factorSettings: [] }, baselineFormulaVersion: lineBaseline, factors: [], materials: [material], safetyRules: [], regulatoryRules: [], jurisdictions: ["KE"] });
    expect(absent.safety.status).toBe("UNKNOWN");
    expect(absent.regulatory.status).toBe("UNKNOWN");

    const unverified = evaluateDoeCandidateHardExclusions({ candidate: { factorSettings: [] }, baselineFormulaVersion: lineBaseline, factors: [], materials: [material], safetyRules: [{ ...safetyRule, status: "draft", verificationStatus: "not_verified" }], regulatoryRules: [{ ...regulatoryRule, status: "draft", verificationStatus: "not_verified" }], jurisdictions: ["KE"] });
    expect(unverified.safety.status).not.toBe("PASS");
    expect(unverified.regulatory.status).not.toBe("PASS");
  });

  it("keeps a high-scoring candidate out of the shortlist on any failed or unknown authority", () => {
    const highScoringCandidate = {
      feasibility: { policyVersion: "doe-feasibility/v1" as const, evaluatedAt: "2026-01-01T00:00:00.000Z", status: "FEASIBLE" as const, reasons: [] },
      hardExclusions: { policyVersion: "doe-hard-exclusions/v1" as const, safety: { status: "FAIL" as const, findingIds: ["safety-fail"], reasons: ["blocked"] }, regulatory: { status: "PASS" as const, findingIds: ["reg-ok"], reasons: [] } },
      acquisition: { policyVersion: "doe-acquisition/v1" as const, method: "nearest_measured_run_distance" as const, status: "AVAILABLE" as const, value: 2, sourceRunIds: ["run-1"] },
      desirability: 1,
      predictedResponses: [{ responseId: "response-1", predictedValue: 999, isExtrapolated: false, analysisId: "analysis-1" }],
    };
    expect(isDoeCandidateEligibleForSelection(highScoringCandidate)).toBe(false);
    expect(isDoeCandidateEligibleForSelection({ ...highScoringCandidate, hardExclusions: { ...highScoringCandidate.hardExclusions, safety: { status: "PASS", findingIds: [], reasons: [] }, regulatory: { status: "UNKNOWN", findingIds: [], reasons: ["missing"] } } })).toBe(false);
    expect(isDoeCandidateEligibleForSelection({ ...highScoringCandidate, hardExclusions: { ...highScoringCandidate.hardExclusions, safety: { status: "PASS", findingIds: [], reasons: [] } } })).toBe(true);
  });
});

describe("evaluateDoeCandidateAcquisition", () => {
  const studyRuns = (overrides: Partial<DoeRun> = {}): DoeRun => ({
    schemaVersion: "1.0", id: "run-1", studyId: "study-1", studyRevision: 1, designId: "design-1", runNumber: 1, standardOrder: 1, randomizedOrder: 1, block: 1, replicate: 1, isCenterPoint: false,
    factorSettings: [{ factorCode: "A", codedValue: "-1", actualValue: "10" }], status: "completed", createdAt: "2026-01-01T00:00:00.000Z", ...overrides,
  });
  const observation = (runId: string, overrides: Partial<DoeObservation> = {}): DoeObservation => ({
    schemaVersion: "1.0", id: `obs-${runId}`, studyId: "study-1", studyRevision: 1, runId, responseId: "response-1", value: "10", status: "validated",
    recordedBy: "alice", recordedAt: "2026-01-01T00:00:00.000Z", ...overrides,
  });

  it("uses nearest completed measured-run distance as the versioned fallback, without calling it uncertainty", () => {
    const factorA = factor({ factorCode: "A", isProcessFactor: false });
    const candidate = { factorSettings: [{ factorCode: "A", codedValue: "1", actualValue: "20" }], predictedResponses: [] };
    const result = evaluateDoeCandidateAcquisition({ candidate, factors: [factorA], runs: [studyRuns()], observations: [observation("run-1")] });
    expect(result).toMatchObject({ policyVersion: "doe-acquisition/v1", method: "nearest_measured_run_distance", status: "AVAILABLE", value: 2, sourceRunIds: ["run-1"] });
    expect(result.reason).toMatch(/not model uncertainty/i);
  });

  it("returns unavailable for missing measurements, incompatible factor lineage, and OOD predictions", () => {
    const factorA = factor({ factorCode: "A", isProcessFactor: false });
    const candidate = { factorSettings: [{ factorCode: "A", codedValue: "1", actualValue: "20" }], predictedResponses: [] };
    expect(evaluateDoeCandidateAcquisition({ candidate, factors: [factorA], runs: [studyRuns()], observations: [] }).status).toBe("UNAVAILABLE");
    expect(evaluateDoeCandidateAcquisition({ candidate: { ...candidate, predictedResponses: [{ responseId: "r1", predictedValue: 1, isExtrapolated: true, analysisId: "a1" }] }, factors: [factorA], runs: [studyRuns()], observations: [observation("run-1")] }).status).toBe("UNAVAILABLE");
    expect(evaluateDoeCandidateAcquisition({ candidate, factors: [factorA], runs: [studyRuns({ factorSettings: [] })], observations: [observation("run-1")] }).status).toBe("UNAVAILABLE");
  });

  it("ranks by acquisition distance deterministically and preserves ties and unavailable order", () => {
    const make = (value?: number) => ({ acquisition: value === undefined
      ? { policyVersion: "doe-acquisition/v1" as const, method: "nearest_measured_run_distance" as const, status: "UNAVAILABLE" as const, sourceRunIds: [], reason: "no evidence" }
      : { policyVersion: "doe-acquisition/v1" as const, method: "nearest_measured_run_distance" as const, status: "AVAILABLE" as const, value, sourceRunIds: ["run-1"] } });
    const input = [make(0.5), make(1), make(1), make()];
    const first = rankDoeCandidatesByAcquisition(input);
    expect(first.map((candidate) => candidate.acquisition?.status === "AVAILABLE" ? candidate.acquisition.value : null)).toEqual([1, 1, 0.5, null]);
    expect(rankDoeCandidatesByAcquisition(input)).toEqual(first);
    expect(first.map((candidate) => candidate.rank)).toEqual([1, 2, 3, 4]);
  });
});

describe("diversifyDoeCandidates", () => {
  const candidate = (id: string, value: string) => ({ id, factorSettings: [{ factorCode: "A", codedValue: value }] });

  it("uses explicit coded-factor maximin distance and deterministically moves near duplicates behind diverse points", () => {
    const ranked = diversifyDoeCandidates([candidate("seed", "0"), candidate("near", "0.02"), candidate("far", "1")]);
    expect(ranked.map((item) => item.id)).toEqual(["seed", "far", "near"]);
    expect(ranked[1].diversity).toMatchObject({ policyVersion: "doe-diversity/v1", status: "AVAILABLE", distanceToSelected: 1, nearestSelectedCandidateIds: ["seed"] });
    expect(ranked[2].diversity.reason).toMatch(/below configured minimum/i);
  });

  it("does not fabricate diversity when factor lineage is missing and rejects invalid configuration", () => {
    expect(diversifyDoeCandidates([{ id: "missing", factorSettings: [] }])[0].diversity.status).toBe("UNAVAILABLE");
    expect(() => diversifyDoeCandidates([candidate("one", "0")], { minimumDistance: -1 })).toThrow(/finite and non-negative/i);
  });
});

describe("human selection gate", () => {
  const evidence = {
    feasibility: { policyVersion: "doe-feasibility/v1" as const, evaluatedAt: "2026-01-01T00:00:00.000Z", status: "FEASIBLE" as const, reasons: [] },
    hardExclusions: { policyVersion: "doe-hard-exclusions/v1" as const, safety: { status: "PASS" as const, findingIds: [], reasons: [] }, regulatory: { status: "PASS" as const, findingIds: [], reasons: [] } },
    acquisition: { policyVersion: "doe-acquisition/v1" as const, method: "nearest_measured_run_distance" as const, status: "AVAILABLE" as const, value: 1, sourceRunIds: ["run-1"] },
  };
  it("blocks an unselected recommendation and permits only an eligible human-selected candidate", () => {
    expect(() => assertDoeCandidateHumanSelected({ ...evidence, status: "proposed" }, HUMAN)).toThrow(/explicit human selection/i);
    expect(() => assertDoeCandidateHumanSelected({ ...evidence, status: "selected", feasibility: { ...evidence.feasibility, status: "UNKNOWN" } }, HUMAN)).toThrow(/confirmed feasibility/i);
    expect(() => assertDoeCandidateHumanSelected({ ...evidence, status: "selected" }, HUMAN)).not.toThrow();
  });
});

describe("accepted recommendation DOE run linkage", () => {
  const study: DoeStudy = {
    schemaVersion: "1.0", id: "study-1", studyCode: "DOE-1", title: "Study", projectId: "project-1", formulationId: "formula-1", baselineFormulaVersionId: "version-1", status: "analysis_ready", designType: "full_factorial", randomizationEnabled: true, blockingEnabled: false, replicatePolicy: "none", centerPointPolicy: "none", revision: 1, createdBy: "alice", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const design: DoeDesign = {
    schemaVersion: "1.0", id: "design-1", studyId: "study-1", studyRevision: 1, designType: "full_factorial", factorSnapshot: [], constraintSnapshot: [], responseSnapshot: [], generationSettings: {}, seed: 11, runCount: 1, replicateCount: 0, centerPointCount: 0, blockCount: 1, generatedBy: "alice", generatedAt: "2026-01-01T00:00:00.000Z", diagnostics: { runCount: 1, degreesOfFreedom: 0, duplicateRunCount: 0, estimableTerms: [], aliasedTerms: [], isOrthogonal: true, isBalanced: true, centerPointCount: 0, replicateCount: 0, constraintViolationCount: 0, warnings: [] },
  };
  const recommendation: DoeCandidate = {
    schemaVersion: "1.0", id: "candidate-1", studyId: "study-1", studyRevision: 1, analysisIds: ["analysis-1"], factorSettings: [{ factorCode: "A", codedValue: "1", actualValue: "20" }], predictedResponses: [], desirability: 0.8, constraintStatus: [], rank: 1, status: "selected", recommendationPolicyVersion: "doe-recommendation/v1", createdBy: "alice", createdAt: "2026-01-01T00:00:00.000Z",
    experimentSpace: { policyVersion: "doe-experiment-space/v1", designId: "design-1", sourceFormulaVersionId: "version-1", seed: 11, candidateCount: 4, manipulatedFactorCodes: ["A"], unchangedFormulaLineIds: [] },
    feasibility: { policyVersion: "doe-feasibility/v1", evaluatedAt: "2026-01-01T00:00:00.000Z", status: "FEASIBLE", reasons: [] },
    hardExclusions: { policyVersion: "doe-hard-exclusions/v1", safety: { status: "PASS", findingIds: [], reasons: [] }, regulatory: { status: "PASS", findingIds: [], reasons: [] } },
    acquisition: { policyVersion: "doe-acquisition/v1", method: "nearest_measured_run_distance", status: "AVAILABLE", value: 1, sourceRunIds: ["run-1"] },
  };

  it("creates a planned real DOE run only after human selection and preserves recommendation/formula/run lineage", () => {
    expect(() => createDoeRunFromAcceptedCandidate({ candidate: { ...recommendation, status: "proposed" }, study, design, existingRuns: [] }, HUMAN)).toThrow(/explicit human selection/i);
    const result = createDoeRunFromAcceptedCandidate({ candidate: recommendation, study, design, existingRuns: [{ schemaVersion: "1.0", id: "run-5", studyId: "study-1", studyRevision: 1, designId: "design-1", runNumber: 5, standardOrder: 5, randomizedOrder: 5, block: 1, replicate: 1, isCenterPoint: false, factorSettings: [], status: "completed", createdAt: "2026-01-01T00:00:00.000Z" }], acceptedAt: "2026-01-02T00:00:00.000Z" }, HUMAN);
    expect(result).toMatchObject({ studyId: "study-1", studyRevision: 1, designId: "design-1", runNumber: 6, status: "planned", recommendationId: "candidate-1", recommendationPolicyVersion: "doe-recommendation/v1", recommendationAcceptedBy: "alice", recommendationAcceptedAt: "2026-01-02T00:00:00.000Z", factorSettings: recommendation.factorSettings });
    expect(result.linkedTrialId).toBeUndefined();
  });
});

describe("evaluateDoeCandidateMaterialCost", () => {
  const baseline: FormulationVersion = {
    schemaVersion: "1.0", id: "version-1", formulationId: "formula-1", versionNumber: 1, status: "pilot_approved", author: "alice", createdAt: "2026-01-01T00:00:00.000Z", basisBatchKg: "100",
    lines: [
      { id: "line-a", lineNumber: 1, phase: "A", displayName: "A", materialId: "material-a", materialCode: "MAT-A", percent: "10", functions: [], isQsToHundred: false, provenance: { origin: "chemist_override", evidenceClaimIds: [] } },
      { id: "line-water", lineNumber: 2, phase: "A", displayName: "Water", materialId: "water", materialCode: "WATER", percent: "90", functions: [], isQsToHundred: false, provenance: { origin: "chemist_override", evidenceClaimIds: [] } },
    ], sourceRunIds: [], regulatoryFindingIds: [], compatibilityFindingIds: [], safetyFindingIds: [], approvalRecordIds: [],
  };
  const materials: RawMaterial[] = ["MAT-A", "WATER"].map((code) => ({ schemaVersion: "1.0", code, displayName: code, casNumbers: [], ecNumbers: [], functions: [], activeMatterState: "missing", documents: [], regulatoryStatuses: [], hazardClassifications: [], allergens: [], incompatibilities: [], substituteCodes: [], active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }));
  const prices: MaterialPrice[] = [
    { schemaVersion: "1.0", code: "price-a", materialCode: "MAT-A", price: "100", currency: "KES", priceUnit: "kg", effectiveFrom: "2026-01-01", allocationBasis: "per_kg", verification: "quoted", recordedAt: "2026-01-01T00:00:00.000Z", recordedBy: "alice" },
    { schemaVersion: "1.0", code: "price-water", materialCode: "WATER", price: "1", currency: "KES", priceUnit: "kg", effectiveFrom: "2026-01-01", allocationBasis: "per_kg", verification: "quoted", recordedAt: "2026-01-01T00:00:00.000Z", recordedBy: "alice" },
  ];

  it("uses the canonical Cost Engine for a complete raw-material estimate and leaves missing price data unavailable", () => {
    const candidate = { factorSettings: [{ factorCode: "A", codedValue: "0", actualValue: "10" }] };
    const factors = [factor({ factorCode: "A", sourceType: "formula_material", sourceEntityId: "material-a", isProcessFactor: false })];
    const result = evaluateDoeCandidateMaterialCost({ candidate, baselineFormulaVersion: baseline, factors, materials, prices, rates: [], currency: "KES", evaluatedAt: "2026-01-02T00:00:00.000Z" });
    expect(result).toMatchObject({ policyVersion: "doe-estimated-material-cost/v1", status: "AVAILABLE", amount: 1090, currency: "KES", source: "FormuLab Cost Engine", priceRecordCodes: ["price-a", "price-water"] });
    expect(result.reason).toMatch(/raw-material-only/i);
    expect(evaluateDoeCandidateMaterialCost({ candidate, baselineFormulaVersion: baseline, factors, materials, prices: [prices[0]], rates: [], currency: "KES", evaluatedAt: "2026-01-02T00:00:00.000Z" })).toMatchObject({ status: "UNAVAILABLE" });
  });
});

describe("rankDoeCandidates", () => {
  it("sorts descending by desirability and assigns sequential ranks", () => {
    const raw = [
      { factorSettings: [], predictedResponses: [], desirability: 0.5, constraintStatus: [] },
      { factorSettings: [], predictedResponses: [], desirability: 0.9, constraintStatus: [] },
      { factorSettings: [], predictedResponses: [], desirability: 0.1, constraintStatus: [] },
    ];
    const ranked = rankDoeCandidates(raw);
    expect(ranked.map((c) => c.desirability)).toEqual([0.9, 0.5, 0.1]);
    expect(ranked.map((c) => c.rank)).toEqual([1, 2, 3]);
  });
});

describe("validateDoeCandidate", () => {
  it("is invalid when a hard constraint is unsatisfied", () => {
    const result = validateDoeCandidate({ constraintStatus: [{ constraintId: "c1", satisfied: false, severity: "hard" }] });
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
  });

  it("is valid when only soft constraints are unsatisfied", () => {
    const result = validateDoeCandidate({ constraintStatus: [{ constraintId: "c1", satisfied: false, severity: "soft" }] });
    expect(result.valid).toBe(true);
  });
});

describe("createDoeCandidates", () => {
  it("persists ranked candidates as proposed DoeCandidate records", () => {
    const ranked = [{ factorSettings: [], predictedResponses: [], desirability: 0.8, constraintStatus: [], rank: 1 }];
    const candidates = createDoeCandidates({ studyId: "study-1", studyRevision: 1, analysisIds: ["analysis-1"], ranked }, HUMAN);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].status).toBe("proposed");
    expect(candidates[0].rank).toBe(1);
    expect(candidates[0].createdBy).toBe("alice");
  });

  it("refuses a non-human actor", () => {
    const ranked = [{ factorSettings: [], predictedResponses: [], desirability: 0.8, constraintStatus: [], rank: 1 }];
    expect(() => createDoeCandidates({ studyId: "study-1", studyRevision: 1, analysisIds: [], ranked }, { kind: "import" } as Actor)).toThrow();
  });

  it("keeps an unperformed recommendation proposed and rejects a validated recommendation status", () => {
    const [candidate] = createDoeCandidates({
      studyId: "study-1",
      studyRevision: 1,
      analysisIds: ["analysis-1"],
      ranked: [{ factorSettings: [], predictedResponses: [], desirability: 0.8, constraintStatus: [], rank: 1 }],
    }, HUMAN);

    expect(candidate.status).toBe("proposed");
    expect(doeCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(doeCandidateSchema.safeParse({ ...candidate, status: "validated" }).success).toBe(false);
  });
});

describe("applyDoeCandidateToDraft", () => {
  it("maps formula_material factors to material quantities and other factors to process settings", () => {
    const factors = [
      factor({ factorCode: "SLES", sourceType: "formula_material", sourceEntityId: "material-sles" }),
      factor({ factorCode: "MixSpeed", sourceType: "mixing_speed", sourceEntityId: "mixing_speed", unit: "rpm" }),
      factor({ factorCode: "Total", sourceType: "formula_total" }),
    ];
    const candidate: DoeCandidate = {
      schemaVersion: "1.0",
      id: "candidate-1",
      studyId: "study-1",
      studyRevision: 1,
      analysisIds: ["analysis-1"],
      factorSettings: [
        { factorCode: "SLES", codedValue: "1", actualValue: "12.5" },
        { factorCode: "MixSpeed", codedValue: "0.5", actualValue: "450" },
        { factorCode: "Total", codedValue: "0", actualValue: "100" },
      ],
      predictedResponses: [],
      desirability: 0.9,
      constraintStatus: [],
      rank: 1,
      status: "proposed",
      createdBy: "alice",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const design: DoeDesign = { id: "design-1" } as DoeDesign;
    const application = applyDoeCandidateToDraft(candidate, factors, design);
    expect(application.materialQuantities).toEqual([{ materialId: "material-sles", quantity: "12.5" }]);
    expect(application.processSettings).toEqual([{ key: "mixing_speed", value: "450", unit: "rpm" }]);
    expect(application.lineage).toEqual({ candidateId: "candidate-1", analysisIds: ["analysis-1"], studyId: "study-1", designId: "design-1" });
  });
});
