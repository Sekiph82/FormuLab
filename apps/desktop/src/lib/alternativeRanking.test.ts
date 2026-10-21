import { describe, expect, it } from "vitest";
import { alternativeRankingRecordSchema, createAlternativeRankingRecord, rankAlternatives, verifyAlternativeRankingRecord, type PredictionResult } from "@formulab/shared";
import type { RawMaterial, MaterialPrice } from "@formulab/shared";
import { buildAlternativeRankingCandidates } from "./alternativeRanking";
import { costGeneratedFormula } from "./generatedFormulaCost";
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

describe("FVL-08 result-page authority adapter", () => {
  it("copies canonical engine snapshots into separate dimensions and preserves absent prediction", async () => {
    const material: RawMaterial = { schemaVersion: "1.0", code: "RM-1", displayName: "Material", casNumbers: [], ecNumbers: [], functions: [], documents: [], regulatoryStatuses: [], hazardClassifications: [], allergens: [], incompatibilities: [], substituteCodes: [], activeMatterState: "missing", active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const price: MaterialPrice = { schemaVersion: "1.0", code: "PRICE-1", materialCode: "RM-1", price: "25", currency: "KES", priceUnit: "kg", effectiveFrom: "2026-01-01", allocationBasis: "per_kg", verification: "quoted", recordedAt: "2026-01-01T00:00:00.000Z", recordedBy: "test" };
    const costSnapshot = costGeneratedFormula("session-1", "v1", { ingredients: [{ inci: "Material", material_code: "RM-1", weight_pct: "10" }] }, "100", "KES", { materials: [material], prices: [price], rates: [] });
    const candidates = await buildAlternativeRankingCandidates({
      sessionId: "session-1",
      cards: [card("v1")],
      costSnapshots: [costSnapshot],
      availability: [{ formulaState: "feasible", lines: [], evaluatedAt: "2026-10-20T12:00:00.000Z" }],
      compatibility: [{ formulaState: "compatible", findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-10-20T12:00:00.000Z" }],
      safety: [{ formulaState: "safe", findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-10-20T12:00:00.000Z" }],
      regulatory: [{ formulaState: "compliant", requestedMarket: "Kenya", jurisdiction: "KE", findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-10-20T12:00:00.000Z" }],
    });
    const row = candidates[0]!;
    expect(row.formulaStatus).toBe("VALID");
    expect(row.dimensions.performance).toEqual({ status: "UNAVAILABLE_MODEL" });
    expect(row.dimensions.cost).toMatchObject({ status: "INCOMPLETE", costPerKg: 2.5, currency: "KES", sourceSnapshot: { authority: "FormuLab Cost Engine", snapshot: { priceRecordCodes: ["PRICE-1"] } } });
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

  it("preserves predicted, OOD, non-accepted, unavailable and contract-error statuses through immutable persistence", async () => {
    const base = {
      modelId: "model-1", modelVersion: 1,
      modelChecksum: "c".repeat(64), modelArtifactSchemaVersion: "1.0" as const,
      datasetFingerprint: { algorithm: "sha256" as const, canonicalization: "formulab-canonical-json-v1" as const, digest: "b".repeat(64) },
      datasetSchemaVersion: "1.0", featureSchemaVersion: "1.0", modelFeatureSchemaVersion: "1.0", featureContractVersion: "1.0", trainingContractVersion: "1.0", acceptancePolicyVersion: "1.0",
      productFamilyCode: "SHAMPOO", formulaId: "FORM-1", formulaVersionId: "VERSION-1", formulaVersionNumber: 1,
      targetDefinition: { productFamilyCode: "SHAMPOO", sourceEntity: "testResult" as const, testDefinitionId: "VISCOSITY" },
      applicabilityDomainSnapshot: { version: "1.0" as const, featureName: "solids", unit: "%", minNumeric: 10, maxNumeric: 80, categories: [] },
      targetUnit: "mPa.s", advisoryOnly: true as const,
    };
    const result = (status: PredictionResult["status"], inDomain: boolean, value?: number): PredictionResult => ({
      ...base, status, applicabilityDomain: { policyVersion: "1.0", inDomain, reasonCode: inDomain ? "IN_DOMAIN" : "NUMERIC_RANGE_EXCEEDED", message: inDomain ? "in domain" : "outside model range" },
      ...(value !== undefined ? { predictedNumericValue: value } : {}),
    });
    const cards = ["predicted", "ood", "not-accepted", "unavailable", "contract-error"].map((version) => card(version));
    const resolutions = new Map<string, PredictionResult>([
      ["predicted", result("PREDICTED", true, 42)],
      ["ood", result("OUT_OF_DOMAIN", false)],
      ["not-accepted", result("MODEL_NOT_ACCEPTED", true)],
    ]);
    const [predicted, ood, notAccepted, unavailable, contractError] = await buildAlternativeRankingCandidates({
      sessionId: "session-1", cards, costSnapshots: cards.map(() => undefined), availability: cards.map(() => undefined),
      compatibility: cards.map(() => undefined), safety: cards.map(() => undefined), regulatory: cards.map(() => undefined),
      predictions: resolutions,
      predictionFailures: new Map([
        ["unavailable", { status: "UNAVAILABLE_MODEL", reason: "No matching accepted model." }],
        ["contract-error", { status: "INVALID_CONTRACT", reason: "Exact formula-version identity missing." }],
      ]),
    });
    expect(predicted!.dimensions.performance).toMatchObject({ status: "PREDICTED", numericValue: 42, targetKey: "VISCOSITY", modelId: "model-1", modelVersion: 1 });
    expect(ood!.dimensions.performance).toMatchObject({ status: "OUT_OF_DOMAIN" });
    expect(ood!.dimensions.performance).not.toHaveProperty("numericValue");
    expect(notAccepted!.dimensions.performance.status).toBe("MODEL_NOT_ACCEPTED");
    expect(notAccepted!.dimensions.performance).not.toHaveProperty("numericValue");
    expect(unavailable!.dimensions.performance.status).toBe("UNAVAILABLE_MODEL");
    expect(contractError!.dimensions.performance).toMatchObject({ status: "INVALID_CONTRACT", sourceSnapshot: { reason: "Exact formula-version identity missing." } });

    const record = await createAlternativeRankingRecord({ code: "rank-statuses", sessionId: "session-1", capturedAt: "2026-10-21T12:00:00.000Z", context: { batchKg: "100", currency: "KES" }, rankings: rankAlternatives([predicted!, ood!, notAccepted!, unavailable!, contractError!]) });
    const roundTripped = alternativeRankingRecordSchema.parse(JSON.parse(JSON.stringify(record)));
    expect(await verifyAlternativeRankingRecord(roundTripped)).toBe(true);
    expect(roundTripped.rankings.map(({ candidate: item }) => item.dimensions.performance.status)).toEqual(expect.arrayContaining(["PREDICTED", "OUT_OF_DOMAIN", "MODEL_NOT_ACCEPTED", "UNAVAILABLE_MODEL", "INVALID_CONTRACT"]));
  });
});
