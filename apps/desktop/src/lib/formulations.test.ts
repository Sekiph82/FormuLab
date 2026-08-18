import { describe, expect, it } from "vitest";
import { linesFromGeneratedFormula } from "./formulations";

describe("linesFromGeneratedFormula — FVL-03.003 materialCode wiring", () => {
  it("carries a canonical material_code through to FormulationLine.materialCode", () => {
    const formula = {
      ingredients: [
        { inci: "Phenoxyethanol", name: "Phenoxyethanol", weight_pct: "0.8",
          function: "preservative", material_code: "RM-001" },
      ],
    };
    const lines = linesFromGeneratedFormula(formula);
    expect(lines).toHaveLength(1);
    expect(lines[0].materialCode).toBe("RM-001");
  });

  it("leaves materialCode undefined when the generated ingredient has none", () => {
    const formula = {
      ingredients: [
        { inci: "Fragrance", name: "Fragrance", weight_pct: "0.5", function: "fragrance" },
      ],
    };
    const lines = linesFromGeneratedFormula(formula);
    expect(lines[0].materialCode).toBeUndefined();
  });
});
