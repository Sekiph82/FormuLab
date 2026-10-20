import { describe, expect, it } from "vitest";
import { costSnapshotSchema } from "@formulab/shared";
import { buildAlternativeRankingCandidates } from "./alternativeRanking";
import type { FormulationCard } from "./formulationV2";

function card(version: string, overrides: Partial<FormulationCard> = {}): FormulationCard {
  return {
    version,
    formula: { ingredients: [{ inci: "Material", weight_pct: "10" }] },
    formula_state: "complete",
    evidence_links: [],
    manufacturing: { ready: true, not_ready_reason: "", steps: [], critical_parameters: [], equipment: [], batch_scale: "laboratory" },
    ...overrides,
  };
}

function cost(code: string, costPerKg: string) {
  return costSnapshotSchema.parse({
    schemaVersion: "1.0", code, formulationId: "session-1", versionId: code, currency: "KES", batchKg: "100", calculatedAt: "2026-10-20T12:00:00.000Z",
    priceRecordCodes: ["PRICE-1"], exchangeRateCodes: [], packagingComponentCodes: [], lines: [], costPerKg, totalManufacturingCost: String(Number(costPerKg) * 100), missingDataWarnings: [],
  });
}

describe("FVL-08 result-page authority adapter", () => {
  it("copies canonical engine snapshots into separate dimensions and preserves absent prediction", async () => {
    const candidates = await buildAlternativeRankingCandidates({
      sessionId: "session-1",
      cards: [card("v1")],
      costSnapshots: [cost("v1-cost", "2.50")],
      availability: [{ formulaState: "feasible", lines: [], evaluatedAt: "2026-10-20T12:00:00.000Z" }],
      compatibility: [{ formulaState: "compatible", findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-10-20T12:00:00.000Z" }],
      safety: [{ formulaState: "safe", findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-10-20T12:00:00.000Z" }],
      regulatory: [{ formulaState: "compliant", requestedMarket: "Kenya", jurisdiction: "KE", findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-10-20T12:00:00.000Z" }],
    });
    const row = candidates[0]!;
    expect(row.formulaStatus).toBe("VALID");
    expect(row.dimensions.performance).toEqual({ status: "UNAVAILABLE_MODEL" });
    expect(row.dimensions.cost).toMatchObject({ status: "AVAILABLE", costPerKg: 2.5, currency: "KES", sourceSnapshot: { authority: "FormuLab Cost Engine", snapshot: { priceRecordCodes: ["PRICE-1"] } } });
    expect(row.dimensions.availability).toMatchObject({ status: "FEASIBLE", sourceSnapshot: { authority: "FormuLab Inventory Availability Engine" } });
    expect(row.dimensions.compatibility.status).toBe("PASS");
    expect(row.dimensions.safety.status).toBe("PASS");
    expect(row.dimensions.regulatory.status).toBe("PASS");
    expect(row.dimensions.manufacturing.status).toBe("READY");
    expect(row.dimensions.evidence).toMatchObject({ status: "NO_LINKED_EVIDENCE", ingredientCount: 1, linkedIngredientCount: 0 });
  });

  it("maps authoritative FAIL and UNKNOWN states without converting either to PASS", async () => {
    const [row] = await buildAlternativeRankingCandidates({
      sessionId: "session-1", cards: [card("v1")], costSnapshots: [undefined], availability: [undefined],
      compatibility: [undefined],
      safety: [{ formulaState: "blocked", findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-10-20T12:00:00.000Z" }],
      regulatory: [{ formulaState: "unknown", requestedMarket: "Atlantis", findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-10-20T12:00:00.000Z" }],
    });
    expect(row!.dimensions.compatibility.status).toBe("UNKNOWN");
    expect(row!.dimensions.safety.status).toBe("FAIL");
    expect(row!.dimensions.regulatory.status).toBe("UNKNOWN");
    expect(row!.dimensions.cost.status).toBe("MISSING");
    expect(row!.dimensions.availability.status).toBe("UNKNOWN");
  });

  it("captures generated formula identity without inventing a saved FormulationVersion id", async () => {
    const [row] = await buildAlternativeRankingCandidates({
      sessionId: "session-1", cards: [card("v1", { formula_state: undefined })], costSnapshots: [undefined], availability: [undefined],
      compatibility: [undefined], safety: [undefined], regulatory: [undefined],
    });
    expect(row!.alternativeId).toBe("session-1:v1");
    expect(row!.versionLabel).toBe("v1");
    expect(row!.sourceFormulationVersionId).toBeUndefined();
    expect(row!.formulaFingerprint?.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(row!.formulaStatus).toBe("INCOMPLETE");
  });
});
