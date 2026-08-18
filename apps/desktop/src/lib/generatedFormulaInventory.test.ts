import { describe, expect, it } from "vitest";
import type { InventoryRecord, RawMaterial } from "@formulab/shared";
import { evaluateGeneratedFormulaInventory, shouldOfferSubstitution } from "./generatedFormulaInventory";
import { costGeneratedFormula } from "./generatedFormulaCost";

const NOW = "2026-08-18";

function lot(over: Partial<InventoryRecord> & { code: string; materialCode: string; quantity: string }): InventoryRecord {
  return {
    schemaVersion: "1.0",
    warehouse: "main",
    unit: "kg",
    reservedQuantity: "0",
    coaStatus: "pending",
    quarantined: false,
    released: true,
    updatedAt: NOW,
    ...over,
  };
}

function formula(ingredients: Record<string, unknown>[]) {
  return { ingredients };
}

describe("evaluateGeneratedFormulaInventory — FVL-03.004", () => {
  it("Acceptance A: sufficient inventory -> AVAILABLE, formula FEASIBLE", () => {
    const f = formula([
      { inci: "Glycerin", name: "Glycerin", weight_pct: "5.0", material_code: "RM-001" },
    ]);
    const records = [lot({ code: "INV-1", materialCode: "RM-001", quantity: "1000" })];
    const result = evaluateGeneratedFormulaInventory(f, "100", records);
    expect(result.lines[0].state).toBe("available");
    expect(result.formulaState).toBe("feasible");
  });

  it("Acceptance B: usable inventory below required amount -> INSUFFICIENT, formula INFEASIBLE", () => {
    const f = formula([
      { inci: "Glycerin", name: "Glycerin", weight_pct: "50.0", material_code: "RM-001" },
    ]);
    // required = 50% of 100kg = 50kg; only 10kg usable
    const records = [lot({ code: "INV-1", materialCode: "RM-001", quantity: "10" })];
    const result = evaluateGeneratedFormulaInventory(f, "100", records);
    expect(result.lines[0].state).toBe("insufficient");
    expect(result.formulaState).toBe("infeasible");
  });

  it("Acceptance C: material exists but has no InventoryRecord -> UNKNOWN, never zero, never available", () => {
    const f = formula([
      { inci: "Glycerin", name: "Glycerin", weight_pct: "5.0", material_code: "RM-001" },
    ]);
    const result = evaluateGeneratedFormulaInventory(f, "100", []);
    expect(result.lines[0].state).toBe("unknown");
    expect(result.formulaState).toBe("unknown");
  });

  it("Acceptance D: a same-name decoy material with stock cannot hijack a different material_code's join", () => {
    const f = formula([
      { inci: "Glycerin", name: "Glycerin", weight_pct: "5.0", material_code: "RM-CORRECT" },
    ]);
    const records = [
      // stock exists only under a DIFFERENT code sharing no relationship
      // with RM-CORRECT other than an operator typing the same display name.
      lot({ code: "INV-1", materialCode: "RM-DECOY", quantity: "1000" }),
    ];
    const result = evaluateGeneratedFormulaInventory(f, "100", records);
    expect(result.lines[0].state).toBe("unknown");
    expect(result.lines[0].reason).toBe("no inventory record for this material");
  });

  it("an ingredient with no material_code stays unknown, never text-matched", () => {
    const f = formula([
      { inci: "Fragrance", name: "Fragrance", weight_pct: "0.5" },
    ]);
    const records = [lot({ code: "INV-1", materialCode: "RM-001", quantity: "1000" })];
    const result = evaluateGeneratedFormulaInventory(f, "100", records);
    expect(result.lines[0].state).toBe("unknown");
    expect(result.lines[0].reason).toBe("ingredient not resolved to a canonical material");
  });

  it("Acceptance G: unusable batch size never fabricates a required quantity — stays UNKNOWN even with real stock", () => {
    const f = formula([
      { inci: "Glycerin", name: "Glycerin", weight_pct: "5.0", material_code: "RM-001" },
    ]);
    const records = [lot({ code: "INV-1", materialCode: "RM-001", quantity: "1000" })];
    const result = evaluateGeneratedFormulaInventory(f, "not a number", records);
    expect(result.lines[0].state).toBe("unknown");
    expect(result.lines[0].requiredQuantity).toBeUndefined();
    expect(result.formulaState).toBe("unknown");
  });

  it("formula-level precedence: any insufficient line makes the whole formula infeasible, even alongside available lines", () => {
    const f = formula([
      { inci: "A", name: "A", weight_pct: "1.0", material_code: "RM-A" },
      { inci: "B", name: "B", weight_pct: "50.0", material_code: "RM-B" },
    ]);
    const records = [
      lot({ code: "INV-A", materialCode: "RM-A", quantity: "1000" }),
      lot({ code: "INV-B", materialCode: "RM-B", quantity: "1" }),
    ];
    const result = evaluateGeneratedFormulaInventory(f, "100", records);
    expect(result.formulaState).toBe("infeasible");
  });

  it("formula-level precedence: unknown-but-none-insufficient makes the formula unknown, not feasible", () => {
    const f = formula([
      { inci: "A", name: "A", weight_pct: "1.0", material_code: "RM-A" },
      { inci: "B", name: "B", weight_pct: "1.0" },
    ]);
    const records = [lot({ code: "INV-A", materialCode: "RM-A", quantity: "1000" })];
    const result = evaluateGeneratedFormulaInventory(f, "100", records);
    expect(result.formulaState).toBe("unknown");
  });

  it("Acceptance I: cost and inventory are separate dimensions — a real cost total and an INFEASIBLE inventory state coexist, neither influences the other", () => {
    const f = formula([
      { inci: "Glycerin", name: "Glycerin", weight_pct: "50.0", material_code: "RM-001" },
    ]);
    const material: RawMaterial = {
      schemaVersion: "1.0", code: "RM-001", displayName: "Glycerin", casNumbers: [],
      ecNumbers: [], documents: [], regulatoryStatuses: [], hazardClassifications: [],
      allergens: [], incompatibilities: [], substituteCodes: [], functions: [],
      activeMatterState: "missing", active: true, createdAt: NOW, updatedAt: NOW,
    };
    const price = {
      schemaVersion: "1.0" as const, code: "MP-1", materialCode: "RM-001", price: "5",
      currency: "KES", priceUnit: "kg", effectiveFrom: "2026-01-01",
      allocationBasis: "per_kg" as const, verification: "quoted" as const,
      recordedAt: NOW, recordedBy: "test",
    };
    // Priced, but insufficient stock for the requested batch (50kg needed, 1kg usable).
    const inventoryRecords = [lot({ code: "INV-1", materialCode: "RM-001", quantity: "1" })];

    const cost = costGeneratedFormula("sess-1", "v1", f, "100", "KES", {
      materials: [material], prices: [price], rates: [],
    });
    const inventory = evaluateGeneratedFormulaInventory(f, "100", inventoryRecords);

    expect(cost.rawMaterialCost).toBeTruthy();
    expect(cost.missingDataWarnings.some((w) => /price|exchange rate/i.test(w))).toBe(false);
    expect(inventory.formulaState).toBe("infeasible");
  });
});

describe("shouldOfferSubstitution — FVL-03.006 trigger boundary", () => {
  it("Acceptance A: unresolved ingredient (no materialCode) is a real trigger", () => {
    const f = formula([{ inci: "Fragrance", name: "Fragrance", weight_pct: "0.5" }]);
    const result = evaluateGeneratedFormulaInventory(f, "100", []);
    expect(shouldOfferSubstitution(result.lines[0])).toBe(true);
  });

  it("Acceptance B: resolved but definitively insufficient inventory is a real trigger", () => {
    const f = formula([{ inci: "Glycerin", name: "Glycerin", weight_pct: "50.0", material_code: "RM-001" }]);
    const records = [lot({ code: "INV-1", materialCode: "RM-001", quantity: "10" })];
    const result = evaluateGeneratedFormulaInventory(f, "100", records);
    expect(shouldOfferSubstitution(result.lines[0])).toBe(true);
  });

  it("Acceptance C: a resolved material with genuinely UNKNOWN inventory (no record) is never auto-triggered", () => {
    const f = formula([{ inci: "Glycerin", name: "Glycerin", weight_pct: "5.0", material_code: "RM-001" }]);
    const result = evaluateGeneratedFormulaInventory(f, "100", []);
    expect(result.lines[0].state).toBe("unknown");
    expect(shouldOfferSubstitution(result.lines[0])).toBe(false);
  });

  it("UNKNOWN from mixed-unit inventory (materialCode resolved) is never auto-triggered", () => {
    const f = formula([{ inci: "Glycerin", name: "Glycerin", weight_pct: "5.0", material_code: "RM-001" }]);
    const records = [
      lot({ code: "INV-1", materialCode: "RM-001", quantity: "10", unit: "kg" }),
      lot({ code: "INV-2", materialCode: "RM-001", quantity: "10", unit: "l" }),
    ];
    const result = evaluateGeneratedFormulaInventory(f, "100", records);
    expect(result.lines[0].state).toBe("unknown");
    expect(shouldOfferSubstitution(result.lines[0])).toBe(false);
  });

  it("UNKNOWN from an unusable batch size (materialCode resolved, real stock) is never auto-triggered", () => {
    const f = formula([{ inci: "Glycerin", name: "Glycerin", weight_pct: "5.0", material_code: "RM-001" }]);
    const records = [lot({ code: "INV-1", materialCode: "RM-001", quantity: "1000" })];
    const result = evaluateGeneratedFormulaInventory(f, "not a number", records);
    expect(result.lines[0].state).toBe("unknown");
    expect(shouldOfferSubstitution(result.lines[0])).toBe(false);
  });

  it("a fully available, resolved ingredient is never triggered", () => {
    const f = formula([{ inci: "Glycerin", name: "Glycerin", weight_pct: "5.0", material_code: "RM-001" }]);
    const records = [lot({ code: "INV-1", materialCode: "RM-001", quantity: "1000" })];
    const result = evaluateGeneratedFormulaInventory(f, "100", records);
    expect(result.lines[0].state).toBe("available");
    expect(shouldOfferSubstitution(result.lines[0])).toBe(false);
  });
});
