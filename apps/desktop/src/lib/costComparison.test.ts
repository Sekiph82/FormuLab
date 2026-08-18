import { describe, expect, it } from "vitest";
import type { CostSnapshot } from "@formulab/shared";
import type { FormulationCard } from "./formulationV2";
import type { GeneratedFormulaCompatibility } from "./generatedFormulaCompatibility";
import type { GeneratedFormulaSafety } from "./generatedFormulaSafety";
import type { GeneratedFormulaRegulatory } from "./generatedFormulaRegulatory";
import { pickCheapestValidVersion } from "./costComparison";

function compat(over: Partial<GeneratedFormulaCompatibility> & { formulaState: GeneratedFormulaCompatibility["formulaState"] }): GeneratedFormulaCompatibility {
  return { findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-08-18T00:00:00Z", ...over };
}

function safety(over: Partial<GeneratedFormulaSafety> & { formulaState: GeneratedFormulaSafety["formulaState"] }): GeneratedFormulaSafety {
  return { findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-08-18T00:00:00Z", ...over };
}

function regulatory(over: Partial<GeneratedFormulaRegulatory> & { formulaState: GeneratedFormulaRegulatory["formulaState"] }): GeneratedFormulaRegulatory {
  return { requestedMarket: "kenya", jurisdiction: "KE", findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-08-18T00:00:00Z", ...over };
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

describe("pickCheapestValidVersion — FVL-03.009 Acceptance E (safety exclusion)", () => {
  it("a safety-blocked formula is never crowned cheapest, even when it's the real cheapest price", () => {
    const cards = [card({ version: "v1" }), card({ version: "v2" })];
    const snapshots = [
      snapshot({ totalManufacturingCost: "10" }), // cheapest, but safety-blocked
      snapshot({ totalManufacturingCost: "40" }),
    ];
    const safeties = [safety({ formulaState: "blocked" }), safety({ formulaState: "safe" })];
    expect(pickCheapestValidVersion(cards, snapshots, undefined, safeties)).toBe(1);
  });

  it("a safety WARNING (not blocked) never excludes a version from cheapest-valid", () => {
    const cards = [card({ version: "v1" })];
    const snapshots = [snapshot({ totalManufacturingCost: "10" })];
    const safeties = [safety({ formulaState: "warning" })];
    expect(pickCheapestValidVersion(cards, snapshots, undefined, safeties)).toBe(0);
  });

  it("a safety UNKNOWN state never excludes a version from cheapest-valid", () => {
    const cards = [card({ version: "v1" })];
    const snapshots = [snapshot({ totalManufacturingCost: "10" })];
    const safeties = [safety({ formulaState: "unknown" })];
    expect(pickCheapestValidVersion(cards, snapshots, undefined, safeties)).toBe(0);
  });

  it("omitting the safeties parameter entirely preserves the exact pre-FVL-03.009 behavior", () => {
    const cards = [card({ version: "v1" })];
    const snapshots = [snapshot({ totalManufacturingCost: "10" })];
    expect(pickCheapestValidVersion(cards, snapshots)).toBe(0);
  });

  it("compatibility-blocked AND safety-blocked are both independent exclusion gates", () => {
    const cards = [card({ version: "v1" }), card({ version: "v2" }), card({ version: "v3" })];
    const snapshots = [
      snapshot({ totalManufacturingCost: "5" }),
      snapshot({ totalManufacturingCost: "10" }),
      snapshot({ totalManufacturingCost: "40" }),
    ];
    const compatibilities = [compat({ formulaState: "blocked" }), compat({ formulaState: "compatible" }), compat({ formulaState: "compatible" })];
    const safeties = [safety({ formulaState: "safe" }), safety({ formulaState: "blocked" }), safety({ formulaState: "safe" })];
    expect(pickCheapestValidVersion(cards, snapshots, compatibilities, safeties)).toBe(2);
  });
});

describe("pickCheapestValidVersion — FVL-03.010 Acceptance E (regulatory exclusion)", () => {
  it("a regulatory-blocked formula is never crowned cheapest, even when it's the real cheapest price", () => {
    const cards = [card({ version: "v1" }), card({ version: "v2" })];
    const snapshots = [
      snapshot({ totalManufacturingCost: "10" }), // cheapest, but regulatory-blocked
      snapshot({ totalManufacturingCost: "40" }),
    ];
    const regulatories = [regulatory({ formulaState: "blocked" }), regulatory({ formulaState: "compliant" })];
    expect(pickCheapestValidVersion(cards, snapshots, undefined, undefined, regulatories)).toBe(1);
  });

  it("a regulatory WARNING (missing_data, not a real violation) never excludes a version from cheapest-valid", () => {
    const cards = [card({ version: "v1" })];
    const snapshots = [snapshot({ totalManufacturingCost: "10" })];
    const regulatories = [regulatory({ formulaState: "warning" })];
    expect(pickCheapestValidVersion(cards, snapshots, undefined, undefined, regulatories)).toBe(0);
  });

  it("a regulatory UNKNOWN state (unresolved market or sparse coverage) never excludes a version from cheapest-valid", () => {
    const cards = [card({ version: "v1" })];
    const snapshots = [snapshot({ totalManufacturingCost: "10" })];
    const regulatories = [regulatory({ formulaState: "unknown", jurisdiction: undefined })];
    expect(pickCheapestValidVersion(cards, snapshots, undefined, undefined, regulatories)).toBe(0);
  });

  it("omitting the regulatories parameter entirely preserves the exact pre-FVL-03.010 behavior", () => {
    const cards = [card({ version: "v1" })];
    const snapshots = [snapshot({ totalManufacturingCost: "10" })];
    expect(pickCheapestValidVersion(cards, snapshots)).toBe(0);
  });

  it("compatibility-blocked, safety-blocked, and regulatory-blocked are three independent exclusion gates", () => {
    const cards = [card({ version: "v1" }), card({ version: "v2" }), card({ version: "v3" }), card({ version: "v4" })];
    const snapshots = [
      snapshot({ totalManufacturingCost: "5" }),
      snapshot({ totalManufacturingCost: "8" }),
      snapshot({ totalManufacturingCost: "12" }),
      snapshot({ totalManufacturingCost: "40" }),
    ];
    const compatibilities = [compat({ formulaState: "blocked" }), compat({ formulaState: "compatible" }), compat({ formulaState: "compatible" }), compat({ formulaState: "compatible" })];
    const safeties = [safety({ formulaState: "safe" }), safety({ formulaState: "blocked" }), safety({ formulaState: "safe" }), safety({ formulaState: "safe" })];
    const regulatories = [regulatory({ formulaState: "compliant" }), regulatory({ formulaState: "compliant" }), regulatory({ formulaState: "blocked" }), regulatory({ formulaState: "compliant" })];
    expect(pickCheapestValidVersion(cards, snapshots, compatibilities, safeties, regulatories)).toBe(3);
  });
});
