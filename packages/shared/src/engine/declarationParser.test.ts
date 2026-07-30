import { describe, expect, it } from "vitest";
import { parseIngredientDeclaration } from "./declarationParser";

describe("parseIngredientDeclaration", () => {
  it("returns an empty array for blank or empty input", () => {
    expect(parseIngredientDeclaration("")).toEqual([]);
    expect(parseIngredientDeclaration("   ")).toEqual([]);
  });

  it("returns an empty array for malformed input (only separators)", () => {
    expect(parseIngredientDeclaration(" , ;  , ")).toEqual([]);
  });

  it("splits on comma/semicolon/'and' and preserves multi-word names in declared order", () => {
    const lines = parseIngredientDeclaration(
      "Sodium Lauryl Sulfate, Cocamidopropyl Betaine; Water and Citric Acid"
    );
    expect(lines.map((l) => l.declaredName)).toEqual([
      "Sodium Lauryl Sulfate",
      "Cocamidopropyl Betaine",
      "Water",
      "Citric Acid",
    ]);
    expect(lines.map((l) => l.declaredOrder)).toEqual([0, 1, 2, 3]);
  });

  it("strips parenthetical content and lowercases the normalized name", () => {
    const [line] = parseIngredientDeclaration("Sodium Benzoate (as preservative)");
    expect(line.declaredName).toBe("Sodium Benzoate");
    expect(line.normalizedText).toBe("sodium benzoate");
  });

  it("preserves duplicate ingredient names as separate lines rather than deduping", () => {
    const lines = parseIngredientDeclaration("Water, Water");
    expect(lines).toHaveLength(2);
    expect(lines[0].declaredOrder).not.toBe(lines[1].declaredOrder);
  });

  it("leaves mapping/inference fields undefined for a fresh parse", () => {
    const [line] = parseIngredientDeclaration("Water");
    expect(line.INCI).toBeUndefined();
    expect(line.CAS).toBeUndefined();
    expect(line.concentrationHint).toBeUndefined();
  });
});
