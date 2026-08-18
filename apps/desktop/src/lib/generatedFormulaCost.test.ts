import { describe, expect, it } from "vitest";
import { buildCostSnapshot } from "@formulab/shared";
import type { ExchangeRate, MaterialPrice, RawMaterial, FormulationLine } from "@formulab/shared";
import { costGeneratedFormula } from "./generatedFormulaCost";

const NOW = "2026-07-19T00:00:00Z";

function material(over: Partial<RawMaterial> & { code: string }): RawMaterial {
  return {
    schemaVersion: "1.0",
    displayName: over.code,
    casNumbers: [],
    ecNumbers: [],
    documents: [],
    regulatoryStatuses: [],
    hazardClassifications: [],
    allergens: [],
    incompatibilities: [],
    substituteCodes: [],
    functions: [],
    activeMatterState: "missing",
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function price(over: Partial<MaterialPrice> & { code: string; materialCode: string }): MaterialPrice {
  return {
    schemaVersion: "1.0",
    price: "100",
    currency: "KES",
    priceUnit: "kg",
    effectiveFrom: "2026-01-01",
    allocationBasis: "per_kg",
    verification: "quoted",
    recordedAt: NOW,
    recordedBy: "test",
    ...over,
  };
}

const RATE: ExchangeRate = {
  schemaVersion: "1.0",
  code: "fx-usd-kes",
  baseCurrency: "USD",
  quoteCurrency: "KES",
  rate: "130",
  effectiveFrom: "2026-01-01",
  source: "test fixture",
  entryMethod: "manual",
  verification: "verified",
  recordedAt: NOW,
};

function generatedFormula(ingredients: Record<string, unknown>[]) {
  return { ingredients };
}

describe("costGeneratedFormula — FVL-03.003 wiring (proves the wiring, not the engine)", () => {
  it("produces the exact same CostSnapshot as calling buildCostSnapshot() directly with the equivalent lines", () => {
    const formula = generatedFormula([
      { inci: "Phenoxyethanol", name: "Phenoxyethanol", weight_pct: "0.8",
        function: "preservative", material_code: "RM-001" },
    ]);
    const materials = [material({ code: "RM-001" })];
    const prices = [price({ code: "MP-1", materialCode: "RM-001", price: "5", currency: "KES" })];

    const viaWiring = costGeneratedFormula("sess-1", "v1", formula, "100", "KES", {
      materials, prices, rates: [],
    });

    const equivalentLines: FormulationLine[] = [
      {
        id: viaWiring.lines[0].lineId, lineNumber: 1, phase: "A",
        materialCode: "RM-001", displayName: "Phenoxyethanol", inciName: "Phenoxyethanol",
        percent: "0.8", isQsToHundred: false, functions: [],
        provenance: { origin: "model_estimate", evidenceClaimIds: [] },
      },
    ];
    const direct = buildCostSnapshot(
      "sess-1", "v1",
      { lines: equivalentLines, batchKg: "100", currency: "KES", asOf: viaWiring.calculatedAt, materials, prices, rates: [] },
      { code: "live" },
    );

    expect(viaWiring.rawMaterialCost).toBe(direct.rawMaterialCost);
    expect(viaWiring.totalManufacturingCost).toBe(direct.totalManufacturingCost);
    expect(viaWiring.missingDataWarnings).toEqual(direct.missingDataWarnings);
  });

  it("joins by the exact material_code — never by matching a similar ingredient name", () => {
    const formula = generatedFormula([
      { inci: "Sodium Benzoate", name: "Sodium Benzoate", weight_pct: "0.5",
        function: "preservative", material_code: "RM-CORRECT" },
    ]);
    const materials = [
      material({ code: "RM-CORRECT" }),
      material({ code: "RM-DECOY", displayName: "Sodium Benzoate" }),
    ];
    // A price only exists for the DECOY code — a text-similarity join
    // would find it via the shared display name; a materialCode join
    // must not.
    const prices = [price({ code: "MP-decoy", materialCode: "RM-DECOY", price: "9" })];

    const snapshot = costGeneratedFormula("sess-1", "v1", formula, "100", "KES", {
      materials, prices, rates: [],
    });

    expect(snapshot.lines[0].missingReason).toBe("no_price");
    expect(snapshot.missingDataWarnings.length).toBeGreaterThan(0);
  });

  it("leaves an ingredient with no material_code unresolved rather than costing it against the wrong material", () => {
    const formula = generatedFormula([
      { inci: "Mystery Extract", name: "Mystery Extract", weight_pct: "1.0", function: "active" },
    ]);
    const materials = [material({ code: "RM-001", displayName: "Mystery Extract" })];
    const prices = [price({ code: "MP-1", materialCode: "RM-001", price: "20" })];

    const snapshot = costGeneratedFormula("sess-1", "v1", formula, "100", "KES", {
      materials, prices, rates: [],
    });

    expect(snapshot.lines[0].materialCode).toBeUndefined();
    expect(snapshot.lines[0].missingReason).toBe("no_price");
  });

  it("Acceptance B — mixed currency with a real exchange rate present costs correctly", () => {
    const formula = generatedFormula([
      { inci: "Glycerin", name: "Glycerin", weight_pct: "3.0", function: "humectant", material_code: "RM-001" },
    ]);
    const materials = [material({ code: "RM-001" })];
    const prices = [price({ code: "MP-1", materialCode: "RM-001", price: "2", currency: "USD" })];

    const snapshot = costGeneratedFormula("sess-1", "v1", formula, "100", "KES", {
      materials, prices, rates: [RATE],
    });

    // No missing-price/missing-FX warning — the only warning present is
    // the expected, unrelated "no factory profile selected" one (this
    // test passes no `profile`, matching a not-yet-saved generated card).
    expect(snapshot.lines[0].missingReason).toBeUndefined();
    expect(snapshot.missingDataWarnings.some((w) => /price|exchange rate/i.test(w))).toBe(false);
    expect(snapshot.rawMaterialCost).toBeTruthy();
  });

  it("Acceptance C — a missing price keeps the formula's cost incomplete, never assumes zero", () => {
    const formula = generatedFormula([
      { inci: "Unpriced Thing", name: "Unpriced Thing", weight_pct: "1.0", function: "active", material_code: "RM-UNPRICED" },
    ]);
    const materials = [material({ code: "RM-UNPRICED" })];

    const snapshot = costGeneratedFormula("sess-1", "v1", formula, "100", "KES", {
      materials, prices: [], rates: [],
    });

    expect(snapshot.missingDataWarnings.length).toBeGreaterThan(0);
    expect(snapshot.lines[0].missingReason).toBe("no_price");
  });

  it("Acceptance D — a missing exchange rate keeps the result incomplete, never assumes 1:1", () => {
    const formula = generatedFormula([
      { inci: "Foreign Priced", name: "Foreign Priced", weight_pct: "1.0", function: "active", material_code: "RM-001" },
    ]);
    const materials = [material({ code: "RM-001" })];
    const prices = [price({ code: "MP-1", materialCode: "RM-001", price: "5", currency: "EUR" })];

    const snapshot = costGeneratedFormula("sess-1", "v1", formula, "100", "KES", {
      materials, prices, rates: [], // no EUR->KES rate on file
    });

    expect(snapshot.lines[0].missingReason).toBe("no_exchange_rate");
    expect(snapshot.missingDataWarnings.length).toBeGreaterThan(0);
  });
});
