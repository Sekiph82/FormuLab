import { describe, expect, it } from "vitest";
import { isQsIngredient, normalizeIngredientKey, parsePercent, totalWeightPct } from "./generatedFormula";

describe("isQsIngredient", () => {
  it.each(["q.s. 100", "q.s 100", "QS 100", "qs to 100", "Q.S."])("recognizes %s", (raw) => {
    expect(isQsIngredient(raw)).toBe(true);
  });

  it("does not treat an ordinary percentage as q.s.", () => {
    expect(isQsIngredient("5.50")).toBe(false);
    expect(isQsIngredient("10.0")).toBe(false);
  });
});

describe("parsePercent", () => {
  it("never treats the literal 100 inside q.s. 100 as a real percentage", () => {
    // The exact bug this session's brief names: a naive regex match on
    // "q.s. 100" finds "100" and returns it as if water were 100% on top
    // of everything else.
    expect(parsePercent("q.s. 100")).toBeUndefined();
  });

  it("parses an explicit percentage normally", () => {
    expect(parsePercent("5.50")).toBe(5.5);
  });

  it("returns undefined for an unparseable value", () => {
    expect(parsePercent("a lot")).toBeUndefined();
    expect(parsePercent(undefined)).toBeUndefined();
  });
});

describe("totalWeightPct — the 129.5% w/w bug fix", () => {
  it("never sums q.s. 100 as an additional 100% on top of explicit ingredients", () => {
    const formula = {
      ingredients: [
        { inci: "Water (Aqua)", function: "Solvent", weight_pct: "q.s. 100" },
        { inci: "Sodium Laureth Sulfate", function: "Surfactant", weight_pct: "20.0" },
        { inci: "Cocamidopropyl Betaine", function: "Co-surfactant", weight_pct: "9.5" },
      ],
    };
    // Previously this returned 129.5 (100 + 20 + 9.5) — the exact bug.
    expect(totalWeightPct(formula)).toBe(29.5);
    expect(totalWeightPct(formula)).not.toBe(129.5);
  });

  it("returns the real explicit subtotal when there is no q.s. ingredient", () => {
    const formula = { ingredients: [{ inci: "A", weight_pct: "60" }, { inci: "B", weight_pct: "40" }] };
    expect(totalWeightPct(formula)).toBe(100);
  });

  it("returns undefined when nothing is numerically parseable", () => {
    const formula = { ingredients: [{ inci: "Water (Aqua)", weight_pct: "q.s. 100" }] };
    expect(totalWeightPct(formula)).toBeUndefined();
  });
});

describe("normalizeIngredientKey", () => {
  it("mirrors evidence.py::normalize_ingredient_key() exactly", () => {
    expect(normalizeIngredientKey("Sodium Lauryl Sulfate")).toBe("sodium-lauryl-sulfate");
    expect(normalizeIngredientKey("Sodium Laureth Sulfate")).toBe("sodium-laureth-sulfate");
    expect(normalizeIngredientKey("Water (Aqua)")).toBe("water-aqua");
  });

  it("never merges chemically distinct sulfates", () => {
    expect(normalizeIngredientKey("Sodium Lauryl Sulfate")).not.toBe(normalizeIngredientKey("Sodium Laureth Sulfate"));
  });
});
