import { describe, expect, it } from "vitest";
import { generateCandidates, type GenerationInput } from "./candidateGenerator";
import type { RawMaterial } from "../schemas/materials";
import type { IngredientDeclarationLine, ReverseConstraintSet, TargetProductProfile } from "../schemas/reverseFormulation";
import type { AnalyticalAnalysis } from "./analyticalInference";
import type { IngredientMappingResult } from "./ingredientMapper";

function material(overrides: Partial<RawMaterial> = {}): RawMaterial {
  return {
    schemaVersion: "1.0",
    code: "MAT-001",
    displayName: "Water",
    casNumbers: [],
    ecNumbers: [],
    functions: ["solvent"],
    activeMatterState: "missing",
    documents: [],
    regulatoryStatuses: [],
    hazardClassifications: [],
    allergens: [],
    incompatibilities: [],
    substituteCodes: [],
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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

const CONSTRAINTS: ReverseConstraintSet = {
  id: "cs-1",
  code: "CS-1",
  name: "Constraints",
  studyId: "study-1",
  requiredMaterials: [],
  preferredMaterials: [],
  excludedMaterials: [],
  requiredFunctions: [],
  minimumPercentages: {},
  maximumPercentages: {},
};

function baseInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  const mat = material();
  const mapping: IngredientMappingResult = {
    material: mat,
    confidence: 0.9,
    reason: "exact match",
    alternatives: [],
  };
  return {
    mappedIngredients: [{ line: declLine(), mapping }],
    analysis: EMPTY_ANALYSIS,
    target: TARGET,
    constraints: CONSTRAINTS,
    availableMaterials: [mat],
    ...overrides,
  };
}

describe("generateCandidates", () => {
  it("returns an explicit empty-formula fallback rather than fabricating a candidate for no mapped ingredients", () => {
    const candidates = generateCandidates(baseInput({ mappedIngredients: [] }));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].formula).toEqual([]);
    expect(candidates[0].matchScore).toBe(0);
  });

  it("is deterministic: identical input produces identical output", () => {
    const input = baseInput();
    const first = generateCandidates(input);
    const second = generateCandidates(input);
    expect(second).toEqual(first);
  });

  it("assigns non-negative percentages that do not exceed 100 per line", () => {
    const candidates = generateCandidates(baseInput());
    for (const c of candidates) {
      for (const line of c.formula) {
        expect(line.percentage).toBeGreaterThanOrEqual(0);
        expect(line.percentage).toBeLessThanOrEqual(100);
      }
    }
  });

  it("handles a multi-word, duplicate-order-safe declaration without throwing", () => {
    const mat2 = material({ code: "MAT-002", displayName: "Cocamidopropyl Betaine", functions: ["amphoteric_surfactant"] });
    const input = baseInput({
      mappedIngredients: [
        { line: declLine(), mapping: { material: material(), confidence: 0.9, reason: "x", alternatives: [] } },
        {
          line: declLine({ id: "line-2", declaredName: "Cocamidopropyl Betaine", declaredOrder: 1 }),
          mapping: { material: mat2, confidence: 0.8, reason: "y", alternatives: [] },
        },
      ],
      availableMaterials: [material(), mat2],
    });
    expect(() => generateCandidates(input)).not.toThrow();
  });
});
