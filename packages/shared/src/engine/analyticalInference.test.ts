import { describe, expect, it } from "vitest";
import { analyzeAnalyticalResults, inferFunctionFromAnalyte } from "./analyticalInference";
import { MATERIAL_FUNCTIONS } from "../schemas/primitives";
import type { AnalyticalCompositionResult } from "../schemas/reverseFormulation";

function result(overrides: Partial<AnalyticalCompositionResult> = {}): AnalyticalCompositionResult {
  return {
    id: "res-1",
    benchmarkProductId: "bp-1",
    analysisType: "elemental",
    analyte: "Na",
    value: "12.5",
    unit: "%",
    verificationStatus: "unverified",
    ...overrides,
  };
}

describe("analyzeAnalyticalResults", () => {
  it("does not fabricate values for empty input: counts are zero, estimates stay null", () => {
    const analysis = analyzeAnalyticalResults([]);
    expect(analysis.totalAnalytes).toBe(0);
    expect(analysis.estimatedPh).toBeNull();
    expect(analysis.estimatedActiveMatter).toBeNull();
  });

  it("parses the decimal-string value field correctly", () => {
    const analysis = analyzeAnalyticalResults([result({ value: "7.00" })]);
    expect(analysis.totalConcentration).toBeCloseTo(7.0);
  });
});

describe("inferFunctionFromAnalyte", () => {
  it("falls back to a low-confidence, empty-function result for an unknown analyte", () => {
    const inf = inferFunctionFromAnalyte(result({ analyte: "Unobtainium", value: "1" }));
    expect(inf.inferredFunctions).toEqual([]);
    expect(inf.confidence).toBeLessThan(0.5);
  });

  it("only ever infers functions from the shared MaterialFunction vocabulary", () => {
    const inf = inferFunctionFromAnalyte(result({ analyte: "Cl", value: "3" }));
    for (const fn of inf.inferredFunctions) {
      expect(MATERIAL_FUNCTIONS).toContain(fn);
    }
  });

  it("keeps measured value and inferred confidence distinguishable", () => {
    const inf = inferFunctionFromAnalyte(result({ analyte: "Na", value: "10" }));
    expect(inf.value).toBe(10);
    expect(inf.confidence).toBeLessThan(1);
  });
});
