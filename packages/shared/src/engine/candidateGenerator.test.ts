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

const WITH_ANALYSIS: AnalyticalAnalysis = {
  totalAnalytes: 2,
  totalConcentration: 12,
  averageConcentration: 6,
  analytesByType: { Na: [6], Cl: [6] },
  estimatedPh: 7,
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

function mapping(overrides: Partial<IngredientMappingResult> = {}): IngredientMappingResult {
  return {
    material: material(),
    confidence: 0.9,
    reason: "exact match",
    alternatives: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  const mat = material();
  return {
    mappedIngredients: [{ line: declLine(), mapping: mapping({ material: mat }) }],
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

  it("is deterministic: identical input produces identical candidates and ordering", () => {
    const input = baseInput();
    const first = generateCandidates(input);
    const second = generateCandidates(input);
    expect(second).toEqual(first);
  });

  it("assigns finite, non-negative percentages that do not exceed 100 per line", () => {
    const candidates = generateCandidates(baseInput());
    for (const c of candidates) {
      for (const line of c.formula) {
        expect(Number.isFinite(line.percentage)).toBe(true);
        expect(line.percentage).toBeGreaterThanOrEqual(0);
        expect(line.percentage).toBeLessThanOrEqual(100);
      }
    }
  });

  it("respects the expected total: the declared-order candidate sums to 100%", () => {
    const candidates = generateCandidates(baseInput());
    const total = candidates[0].formula.reduce((sum, l) => sum + l.percentage, 0);
    expect(total).toBeCloseTo(100, 1);
  });

  it("does not convert a blank concentration hint to a literal 0% when budget remains", () => {
    const mat2 = material({ code: "MAT-002", displayName: "Cocamidopropyl Betaine", functions: ["amphoteric_surfactant"] });
    const input = baseInput({
      mappedIngredients: [
        { line: declLine({ concentrationHint: undefined }), mapping: mapping({ material: material() }) },
        {
          line: declLine({ id: "line-2", declaredName: "Cocamidopropyl Betaine", declaredOrder: 1, concentrationHint: "" }),
          mapping: mapping({ material: mat2 }),
        },
      ],
      availableMaterials: [material(), mat2],
    });
    const [candidate] = generateCandidates(input);
    for (const line of candidate.formula) {
      expect(line.percentage).toBeGreaterThan(0);
    }
  });

  it("keeps unmapped ingredients explicit: an unmatched line contributes nothing to the formula", () => {
    const mat2 = material({ code: "MAT-002", displayName: "Fragrance", functions: ["fragrance"] });
    const input = baseInput({
      mappedIngredients: [
        { line: declLine(), mapping: mapping({ material: material() }) },
        {
          line: declLine({ id: "line-2", declaredName: "Unknown Compound", declaredOrder: 1 }),
          mapping: { material: null, confidence: 0, reason: "No matching candidates found.", alternatives: [] },
        },
      ],
      availableMaterials: [material(), mat2],
    });
    const [candidate] = generateCandidates(input);
    expect(candidate.formula.every(l => l.materialId === "MAT-001")).toBe(true);
  });

  it("does not fabricate a candidate when analytical data is absent, and does not claim an analytical basis", () => {
    const candidates = generateCandidates(baseInput({ analysis: EMPTY_ANALYSIS }));
    for (const c of candidates) {
      expect(c.notes.join(" ")).not.toMatch(/analytical data/i);
    }
  });

  it("drops a duplicate/equivalent candidate deterministically instead of listing it twice", () => {
    const input = baseInput({ analysis: WITH_ANALYSIS });
    const candidates = generateCandidates(input);
    const signatures = candidates.map(c =>
      c.formula.map(l => `${l.materialId}:${l.percentage}`).sort().join("|")
    );
    expect(new Set(signatures).size).toBe(signatures.length);
    // Deterministic across repeated calls with the same input.
    expect(generateCandidates(input)).toEqual(candidates);
  });

  it("rejects an impossible candidate safely when constraints exclude every available material", () => {
    const input = baseInput({
      constraints: { ...CONSTRAINTS, excludedMaterials: ["MAT-001"] },
    });
    const candidates = generateCandidates(input);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].formula).toEqual([]);
    expect(candidates[0].notes.join(" ")).toMatch(/excluded/i);
  });

  it("rejects a candidate that cannot satisfy a required material safely, instead of returning a misleading formula", () => {
    const input = baseInput({
      constraints: { ...CONSTRAINTS, requiredMaterials: ["MAT-DOES-NOT-EXIST"] },
    });
    const candidates = generateCandidates(input);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].formula).toEqual([]);
  });

  it("handles a multi-word, duplicate-order-safe declaration without throwing", () => {
    const mat2 = material({ code: "MAT-002", displayName: "Cocamidopropyl Betaine", functions: ["amphoteric_surfactant"] });
    const input = baseInput({
      mappedIngredients: [
        { line: declLine(), mapping: mapping({ material: material() }) },
        {
          line: declLine({ id: "line-2", declaredName: "Cocamidopropyl Betaine", declaredOrder: 1 }),
          mapping: mapping({ material: mat2, confidence: 0.8 }),
        },
      ],
      availableMaterials: [material(), mat2],
    });
    expect(() => generateCandidates(input)).not.toThrow();
  });
});
