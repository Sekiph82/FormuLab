import { describe, expect, it } from "vitest";
import type { CostSnapshot } from "@formulab/shared";
import type { FormulationCard } from "./formulationV2";
import { pickCheapestValidVersion } from "./costComparison";

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
