import { describe, expect, it } from "vitest";
import type { CostSnapshot } from "@formulab/shared";
import type { FormulationCard } from "./formulationV2";
import type { GeneratedFormulaCompatibility } from "./generatedFormulaCompatibility";
import { pickCheapestValidVersion } from "./costComparison";

function compat(over: Partial<GeneratedFormulaCompatibility> & { formulaState: GeneratedFormulaCompatibility["formulaState"] }): GeneratedFormulaCompatibility {
  return { findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-08-18T00:00:00Z", ...over };
}

function card(over: Partial<FormulationCard> & { version: string }): FormulationCard {
  return { status: "ok", formula: { ingredients: [] }, ...over };
}

function snapshot(over: Partial<CostSnapshot> & { totalManufacturingCost?: string }): CostSnapshot {
  return {
    schemaVersion: "1.0",
    code: "live",
    formulationId: "sess-1",
    versionId: over.versionId ?? "v1",
    currency: "KES",
    batchKg: "100",
    calculatedAt: "2026-07-19T00:00:00Z",
    calculatedBy: "local",
    priceRecordCodes: [],
    exchangeRateCodes: [],
    packagingComponentCodes: [],
    lines: [],
    skuCosts: [],
    missingDataWarnings: [],
    ...over,
  };
}

describe("pickCheapestValidVersion — FVL-03.003 Acceptance E/F", () => {
  it("Acceptance E: picks the cheaper of two otherwise-valid alternatives", () => {
    const cards = [card({ version: "v1" }), card({ version: "v2" })];
    const snapshots = [
      snapshot({ totalManufacturingCost: "50" }),
      snapshot({ totalManufacturingCost: "30" }),
    ];
    expect(pickCheapestValidVersion(cards, snapshots)).toBe(1);
  });

  it("Acceptance F: the cheapest candidate never wins if its formula_state is invalid", () => {
    const cards = [
      card({ version: "v1", formula_state: "invalid_constraint_violation" as never }),
      card({ version: "v2" }),
    ];
    const snapshots = [
      snapshot({ totalManufacturingCost: "10" }), // cheapest, but invalid
      snapshot({ totalManufacturingCost: "40" }),
    ];
    expect(pickCheapestValidVersion(cards, snapshots)).toBe(1);
  });

  it("returns undefined when no version is both valid and completely costed", () => {
    const cards = [card({ version: "v1", formula_state: "invalid_mass_balance" as never })];
    const snapshots = [snapshot({ totalManufacturingCost: "10" })];
    expect(pickCheapestValidVersion(cards, snapshots)).toBeUndefined();
  });

  it("never crowns an incomplete cost total 'cheapest' even if its lower bound looks smallest", () => {
    const cards = [card({ version: "v1" }), card({ version: "v2" })];
    const snapshots = [
      snapshot({ totalManufacturingCost: "5", missingDataWarnings: ["no price for X"] }),
      snapshot({ totalManufacturingCost: "40" }),
    ];
    expect(pickCheapestValidVersion(cards, snapshots)).toBe(1);
  });

  it("skips a generation_failed card entirely", () => {
    const cards = [
      card({ version: "v1", status: "generation_failed", formula: undefined }),
      card({ version: "v2" }),
    ];
    const snapshots = [undefined, snapshot({ totalManufacturingCost: "40" })];
    expect(pickCheapestValidVersion(cards, snapshots)).toBe(1);
  });
});

describe("pickCheapestValidVersion — FVL-03.008 Acceptance E (compatibility exclusion)", () => {
  it("a compatibility-blocked formula is never crowned cheapest, even when it's the real cheapest price", () => {
    const cards = [card({ version: "v1" }), card({ version: "v2" })];
    const snapshots = [
      snapshot({ totalManufacturingCost: "10" }), // cheapest, but compatibility-blocked
      snapshot({ totalManufacturingCost: "40" }),
    ];
    const compatibilities = [compat({ formulaState: "blocked" }), compat({ formulaState: "compatible" })];
    expect(pickCheapestValidVersion(cards, snapshots, compatibilities)).toBe(1);
  });

  it("a compatibility WARNING (not blocked) never excludes a version from cheapest-valid", () => {
    const cards = [card({ version: "v1" })];
    const snapshots = [snapshot({ totalManufacturingCost: "10" })];
    const compatibilities = [compat({ formulaState: "warning" })];
    expect(pickCheapestValidVersion(cards, snapshots, compatibilities)).toBe(0);
  });

  it("a compatibility UNKNOWN state never excludes a version from cheapest-valid", () => {
    const cards = [card({ version: "v1" })];
    const snapshots = [snapshot({ totalManufacturingCost: "10" })];
    const compatibilities = [compat({ formulaState: "unknown" })];
    expect(pickCheapestValidVersion(cards, snapshots, compatibilities)).toBe(0);
  });

  it("omitting the compatibilities parameter entirely preserves the exact pre-FVL-03.008 behavior", () => {
    const cards = [card({ version: "v1" })];
    const snapshots = [snapshot({ totalManufacturingCost: "10" })];
    expect(pickCheapestValidVersion(cards, snapshots)).toBe(0);
  });
});
