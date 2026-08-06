import { describe, expect, it } from "vitest";
import { scoreReverseFormulaCandidate, computeTargetMatchScore } from "./scoringModel";
import type { ReverseFormulaCandidate, TargetProductProfile } from "../schemas/reverseFormulation";
import type { AnalyticalAnalysis } from "./analyticalInference";
import type { IngredientMappingResult } from "./ingredientMapper";
import type { IngredientDeclarationLine } from "../schemas/reverseFormulation";

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

function declLine(overrides: Partial<IngredientDeclarationLine> = {}): IngredientDeclarationLine {
  return {
    id: "line-1",
    benchmarkProductId: "bp-1",
    rawText: "Water",
    normalizedText: "water",
    declaredOrder: 0,
    declaredName: "Water",
    mappingStatus: "mapped",
    mappedMaterialIds: ["MAT-001"],
    ...overrides,
  };
}

const ALL_SCORE_DIMENSIONS = ["evidence", "order", "analytical", "properties", "performance", "cost", "regulatory"];

describe("scoreReverseFormulaCandidate", () => {
  it("does not reward missing evidence: unassessed dimensions stay neutral, not fabricated confidence", () => {
    const result = scoreReverseFormulaCandidate(candidate(), [], EMPTY_ANALYSIS, TARGET, new Map());
    expect(result.scores.order).toBe(0.5);
    expect(result.scores.performance).toBe(0.5);
    expect(result.scores.regulatory).toBe(0.5);
    expect(result.explanations.regulatory).not.toMatch(/no restricted substances detected/i);
  });

  it("gives missing evidence no positive default advantage: zero mappings score zero evidence, not neutral", () => {
    const result = scoreReverseFormulaCandidate(candidate(), [], EMPTY_ANALYSIS, TARGET, new Map());
    expect(result.scores.evidence).toBe(0);
  });

  it("clearly describes unevaluated dimensions as unevaluated, and never fabricates regulatory/safety/performance claims", () => {
    const result = scoreReverseFormulaCandidate(candidate(), [], EMPTY_ANALYSIS, TARGET, new Map());
    expect(result.explanations.order).toMatch(/not evaluated/i);
    expect(result.explanations.performance).toMatch(/not evaluated/i);
    expect(result.explanations.regulatory).toMatch(/not evaluated/i);
    expect(result.evaluatedDimensions).not.toContain("order");
    expect(result.evaluatedDimensions).not.toContain("performance");
    expect(result.evaluatedDimensions).not.toContain("regulatory");
  });

  it("keeps every dimension score, and the overall score, within [0, 1]", () => {
    const result = scoreReverseFormulaCandidate(candidate(), [], EMPTY_ANALYSIS, TARGET, new Map());
    for (const key of ALL_SCORE_DIMENSIONS) {
      expect(result.scores[key]).toBeGreaterThanOrEqual(0);
      expect(result.scores[key]).toBeLessThanOrEqual(1);
    }
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(1);
  });

  it("cannot reach a perfect score without actual supporting evidence across dimensions (order/performance/regulatory have no model)", () => {
    // Maximum possible evidence: full mapping coverage & confidence, matching
    // properties, on-target cost, matching analytical pH.
    const richCandidate = candidate({
      formulaLines: [{ materialId: "MAT-001", percentage: 100 }],
      predictedProperties: { pH: 7 },
      estimatedCost: 1,
    });
    const mappings: Array<{ line: IngredientDeclarationLine; mapping: IngredientMappingResult }> = [
      { line: declLine(), mapping: { material: null, confidence: 1, reason: "exact", alternatives: [] } },
    ];
    const target: TargetProductProfile = { ...TARGET, pHMin: 6, pHMax: 8, costTargetPerKg: 2 };
    const analysis: AnalyticalAnalysis = { ...EMPTY_ANALYSIS, totalAnalytes: 1, estimatedPh: 7 };
    const result = scoreReverseFormulaCandidate(richCandidate, mappings, analysis, target, new Map());
    expect(result.overallScore).toBeLessThan(1);
  });

  it("keeps the overall score bounded to [0, 1]", () => {
    const result = scoreReverseFormulaCandidate(candidate(), [], EMPTY_ANALYSIS, TARGET, new Map());
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(1);
  });

  it("is deterministic for identical input: identical scores and explanations", () => {
    const c = candidate();
    const first = scoreReverseFormulaCandidate(c, [], EMPTY_ANALYSIS, TARGET, new Map());
    const second = scoreReverseFormulaCandidate(c, [], EMPTY_ANALYSIS, TARGET, new Map());
    expect(second).toEqual(first);
  });

  it("keeps lower confidence distinguishable from a lower score: sparse evidence yields a different confidence than score", () => {
    const result = scoreReverseFormulaCandidate(candidate(), [], EMPTY_ANALYSIS, TARGET, new Map());
    // Only the "evidence" dimension carries real (if zero) evidence here.
    expect(result.evidenceConfidence).toBeCloseTo(1 / ALL_SCORE_DIMENSIONS.length, 5);
    expect(result.evidenceConfidence).not.toBe(result.overallScore);
  });

  it("keeps a high-confidence, poorly-matching candidate distinguishable from a low-confidence one: confidence tracks evaluation coverage, not the score value", () => {
    const poorMatchCandidate = candidate({
      predictedProperties: { pH: 2 }, // far outside target range
      estimatedCost: 100, // far over budget
    });
    const mappings: Array<{ line: IngredientDeclarationLine; mapping: IngredientMappingResult }> = [
      { line: declLine(), mapping: { material: null, confidence: 0.01, reason: "weak", alternatives: [] } },
    ];
    const target: TargetProductProfile = { ...TARGET, pHMin: 6, pHMax: 8, costTargetPerKg: 1 };
    const analysis: AnalyticalAnalysis = { ...EMPTY_ANALYSIS, totalAnalytes: 1, estimatedPh: 7 };
    const result = scoreReverseFormulaCandidate(poorMatchCandidate, mappings, analysis, target, new Map());
    // Evidence, analytical, properties, and cost were all actually evaluated...
    expect(result.evaluatedDimensions).toEqual(expect.arrayContaining(["evidence", "analytical", "properties", "cost"]));
    // ...but the match was bad, so the score should be well below the confidence.
    expect(result.overallScore).toBeLessThan(result.evidenceConfidence);
  });
});

describe("computeTargetMatchScore", () => {
  it("does not divide by zero on a zero-width target range: exact match scores 1, any miss scores 0", () => {
    const target: TargetProductProfile = { ...TARGET, pHMin: 7, pHMax: 7 };
    expect(computeTargetMatchScore({ pH: 7 }, target)).toBe(1);
    const missed = computeTargetMatchScore({ pH: 7.5 }, target);
    expect(Number.isFinite(missed)).toBe(true);
    expect(missed).toBe(0);
  });

  it("returns a neutral 0.5 when nothing is comparable, never a fabricated pass or fail", () => {
    expect(computeTargetMatchScore({}, TARGET)).toBe(0.5);
  });

  it("ignores a non-finite estimated value instead of propagating NaN", () => {
    const target: TargetProductProfile = { ...TARGET, pHMin: 6, pHMax: 8 };
    const score = computeTargetMatchScore({ pH: NaN }, target);
    expect(Number.isFinite(score)).toBe(true);
  });
});
