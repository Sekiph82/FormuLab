import { describe, expect, it } from "vitest";
import { mapIngredientToMaterial } from "./ingredientMapper";
import type { RawMaterial } from "../schemas/materials";
import type { IngredientDeclarationLine } from "../schemas/reverseFormulation";

function material(overrides: Partial<RawMaterial> = {}): RawMaterial {
  return {
    schemaVersion: "1.0",
    code: "MAT-001",
    displayName: "Sodium Lauryl Sulfate",
    casNumbers: [],
    ecNumbers: [],
    functions: ["anionic_surfactant"],
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

function line(overrides: Partial<IngredientDeclarationLine> = {}): IngredientDeclarationLine {
  return {
    id: "line-1",
    benchmarkProductId: "bp-1",
    rawText: "Sodium Lauryl Sulfate",
    normalizedText: "sodium lauryl sulfate",
    declaredOrder: 0,
    declaredName: "Sodium Lauryl Sulfate",
    mappingStatus: "unmapped",
    mappedMaterialIds: [],
    ...overrides,
  };
}

describe("mapIngredientToMaterial", () => {
  it("returns null with zero confidence when the catalog is empty", () => {
    const result = mapIngredientToMaterial(line(), []);
    expect(result.material).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("returns null with zero confidence for an unknown ingredient name", () => {
    const result = mapIngredientToMaterial(
      line({ declaredName: "Completely Unknown Compound Xyz" }),
      [material({ displayName: "Sodium Lauryl Sulfate" })]
    );
    expect(result.material).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("matches on exact INCI with high confidence", () => {
    const result = mapIngredientToMaterial(
      line({ declaredName: "Sodium Laureth Sulfate", INCI: "Sodium Laureth Sulfate" }),
      [material({ inciName: "Sodium Laureth Sulfate" })]
    );
    expect(result.material?.code).toBe("MAT-001");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("matches multi-word declared names by name similarity, capped below full certainty", () => {
    const result = mapIngredientToMaterial(
      line({ declaredName: "Cocamidopropyl Betaine Concentrate" }),
      [material({ displayName: "Cocamidopropyl Betaine Concentrate" })]
    );
    expect(result.material?.code).toBe("MAT-001");
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });

  it("is deterministic for identical input", () => {
    const materials = [material({ displayName: "Water", inciName: "Aqua" })];
    const l = line({ declaredName: "Water", INCI: "Aqua" });
    const first = mapIngredientToMaterial(l, materials);
    const second = mapIngredientToMaterial(l, materials);
    expect(second).toEqual(first);
  });
});
