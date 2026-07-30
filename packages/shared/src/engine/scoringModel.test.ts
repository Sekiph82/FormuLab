import { describe, expect, it } from "vitest";
import { scoreReverseFormulaCandidate } from "./scoringModel";
import type { ReverseFormulaCandidate, TargetProductProfile } from "../schemas/reverseFormulation";
import type { AnalyticalAnalysis } from "./analyticalInference";

const EMPTY_ANALYSIS: AnalyticalAnalysis = {
  totalAnalytes: 0,
  totalConcentration: 0,
  averageConcentration: 0,
  analytesByType: {},
  estimatedPh: null,
  estimatedActiveMatter: null,
  notes: [],
};

const TARGET: TargetProductProfile = {
  id: "target-1",
  code: "TGT-1",
  name: "Target",
  productFamilyCode: "liquid_detergent",
  jurisdictions: [],
};

function candidate(overrides: Partial<ReverseFormulaCandidate> = {}): ReverseFormulaCandidate {
  return {
    id: "cand-1",
    studyId: "study-1",
    candidateCode: "CAND-1",
    name: "Candidate 1",
    revision: 0,
    generationMethod: "declared_hints",
    status: "generated",
    formulaLines: [{ materialId: "MAT-001", percentage: 100 }],
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "system",
    ...overrides,
  };
}

describe("scoreReverseFormulaCandidate", () => {
  it("does not reward missing evidence: unassessed dimensions stay neutral, not fabricated confidence", () => {
    const result = scoreReverseFormulaCandidate(candidate(), [], EMPTY_ANALYSIS, TARGET, new Map());
    // Order, performance, and regulatory are not actually evaluated here — they
    // must report the honest neutral score, never a high fabricated confidence.
    expect(result.scores.order).toBe(0.5);
    expect(result.scores.performance).toBe(0.5);
    expect(result.scores.regulatory).toBe(0.5);
    expect(result.explanations.regulatory).not.toMatch(/no restricted substances detected/i);
  });

  it("keeps the overall score bounded to [0, 1]", () => {
    const result = scoreReverseFormulaCandidate(candidate(), [], EMPTY_ANALYSIS, TARGET, new Map());
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(1);
  });

  it("is deterministic for identical input", () => {
    const c = candidate();
    const first = scoreReverseFormulaCandidate(c, [], EMPTY_ANALYSIS, TARGET, new Map());
    const second = scoreReverseFormulaCandidate(c, [], EMPTY_ANALYSIS, TARGET, new Map());
    expect(second).toEqual(first);
  });
});
