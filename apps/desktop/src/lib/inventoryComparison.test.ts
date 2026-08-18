import { describe, expect, it } from "vitest";
import type { FormulationCard } from "./formulationV2";
import type { FormulaInventoryFeasibility } from "./generatedFormulaInventory";
import type { GeneratedFormulaCompatibility } from "./generatedFormulaCompatibility";
import type { GeneratedFormulaSafety } from "./generatedFormulaSafety";
import { pickMostInventoryFeasibleVersion } from "./inventoryComparison";

function card(over: Partial<FormulationCard> & { version: string }): FormulationCard {
  return { status: "ok", formula: { ingredients: [] }, ...over };
}

function feasibility(formulaState: FormulaInventoryFeasibility["formulaState"]): FormulaInventoryFeasibility {
  return { formulaState, lines: [], evaluatedAt: "2026-08-18T00:00:00Z" };
}

function compat(formulaState: GeneratedFormulaCompatibility["formulaState"]): GeneratedFormulaCompatibility {
  return { formulaState, findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-08-18T00:00:00Z" };
}

function safety(formulaState: GeneratedFormulaSafety["formulaState"]): GeneratedFormulaSafety {
  return { formulaState, findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-08-18T00:00:00Z" };
}

describe("pickMostInventoryFeasibleVersion — FVL-03.004 Acceptance E/F", () => {
  it("Acceptance E: prefers the feasible version among otherwise-valid alternatives", () => {
    const cards = [card({ version: "v1" }), card({ version: "v2" })];
    const feasibilities = [feasibility("infeasible"), feasibility("feasible")];
    expect(pickMostInventoryFeasibleVersion(cards, feasibilities)).toBe(1);
  });

  it("Acceptance F: an invalid formula_state is never preferred even if its inventory state is feasible", () => {
    const cards = [
      card({ version: "v1", formula_state: "invalid_constraint_violation" as never }),
      card({ version: "v2" }),
    ];
    const feasibilities = [feasibility("feasible"), feasibility("unknown")];
    // v1 would look "feasible" but is hard-rule-invalid; no eligible feasible version remains.
    expect(pickMostInventoryFeasibleVersion(cards, feasibilities)).toBeUndefined();
  });

  it("returns undefined rather than recommending an unknown or infeasible version as 'best available'", () => {
    const cards = [card({ version: "v1" }), card({ version: "v2" })];
    const feasibilities = [feasibility("unknown"), feasibility("infeasible")];
    expect(pickMostInventoryFeasibleVersion(cards, feasibilities)).toBeUndefined();
  });

  it("skips a generation_failed card", () => {
    const cards = [
      card({ version: "v1", status: "generation_failed", formula: undefined }),
      card({ version: "v2" }),
    ];
    const feasibilities = [undefined, feasibility("feasible")];
    expect(pickMostInventoryFeasibleVersion(cards, feasibilities)).toBe(1);
  });
});

describe("pickMostInventoryFeasibleVersion — FVL-03.008 Acceptance F (compatibility exclusion)", () => {
  it("a compatibility-blocked formula is never preferred even with the best inventory state", () => {
    const cards = [card({ version: "v1" }), card({ version: "v2" })];
    const feasibilities = [feasibility("feasible"), feasibility("feasible")];
    const compatibilities = [compat("blocked"), compat("compatible")];
    expect(pickMostInventoryFeasibleVersion(cards, feasibilities, compatibilities)).toBe(1);
  });

  it("a compatibility WARNING (not blocked) never excludes a version from inventory eligibility", () => {
    const cards = [card({ version: "v1" })];
    const feasibilities = [feasibility("feasible")];
    const compatibilities = [compat("warning")];
    expect(pickMostInventoryFeasibleVersion(cards, feasibilities, compatibilities)).toBe(0);
  });

  it("omitting the compatibilities parameter entirely preserves the exact pre-FVL-03.008 behavior", () => {
    const cards = [card({ version: "v1" })];
    const feasibilities = [feasibility("feasible")];
    expect(pickMostInventoryFeasibleVersion(cards, feasibilities)).toBe(0);
  });
});

describe("pickMostInventoryFeasibleVersion — FVL-03.009 Acceptance F (safety exclusion)", () => {
  it("a safety-blocked formula is never preferred even with the best inventory state", () => {
    const cards = [card({ version: "v1" }), card({ version: "v2" })];
    const feasibilities = [feasibility("feasible"), feasibility("feasible")];
    const safeties = [safety("blocked"), safety("safe")];
    expect(pickMostInventoryFeasibleVersion(cards, feasibilities, undefined, safeties)).toBe(1);
  });

  it("a safety WARNING (not blocked) never excludes a version from inventory eligibility", () => {
    const cards = [card({ version: "v1" })];
    const feasibilities = [feasibility("feasible")];
    const safeties = [safety("warning")];
    expect(pickMostInventoryFeasibleVersion(cards, feasibilities, undefined, safeties)).toBe(0);
  });

  it("omitting the safeties parameter entirely preserves the exact pre-FVL-03.009 behavior", () => {
    const cards = [card({ version: "v1" })];
    const feasibilities = [feasibility("feasible")];
    expect(pickMostInventoryFeasibleVersion(cards, feasibilities)).toBe(0);
  });
});
