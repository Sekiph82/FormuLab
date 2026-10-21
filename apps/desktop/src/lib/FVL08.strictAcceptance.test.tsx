import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FEATURE_SCHEMA_VERSION,
  extractFormulaVersionDatasetRows,
  formulaVersionTargetRowSchema,
  generateModelFeatures,
  partitionDataset,
  rankAlternatives,
  trainPredictiveModel,
  type Formulation,
  type FormulationLine,
  type FormulationVersion,
  type FormulaVersionBundleInput,
  type RawMaterial,
  type TargetDefinition,
} from "@formulab/shared";

const store = vi.hoisted(() => ({
  formulations: [] as unknown[],
  versions: [] as unknown[],
  rankings: [] as unknown[],
  runs: [] as unknown[],
  materials: [] as unknown[],
  prices: [] as unknown[],
  solver: vi.fn(),
}));

vi.mock("@/lib/formulations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/formulations")>();
  return {
    ...actual,
    listFormulations: async () => store.formulations,
    readFormulation: async (id: string) => ({
      formulation: store.formulations.find((item) => (item as Formulation).id === id),
      versions: store.versions.filter((item) => (item as FormulationVersion).formulationId === id),
    }),
    saveFormulation: async (item: Formulation) => { store.formulations.push(item); return item; },
    saveFormulationVersion: async (item: FormulationVersion) => { store.versions.push(item); return item; },
  };
});

vi.mock("@/lib/masterdata", () => ({
  listRecords: async (collection: string) => collection === "alternative_rankings" ? store.rankings
    : collection === "optimization_runs" ? store.runs
      : collection === "materials" ? store.materials
        : collection === "material_prices" ? store.prices : [],
  listRecordsSeeded: async (collection: string) => collection === "materials" ? store.materials : [],
  upsertRecords: async (collection: string, records: unknown[]) => {
    if (collection === "alternative_rankings") store.rankings.push(...records);
    if (collection === "optimization_runs") store.runs.push(...records);
    return { inserted: records.length, updated: 0, total: records.length };
  },
}));

vi.mock("@/lib/tauri", () => ({
  runAdvancedFormulationOptimize: (input: unknown) => store.solver(input),
  cancelAdvancedFormulationOptimize: async () => undefined,
}));

import { AdvancedOptimizerPanel } from "@/components/formula/AdvancedOptimizerPanel";
import { buildAlternativeRankingCandidates } from "./alternativeRanking";
import { costGeneratedFormula } from "./generatedFormulaCost";
import { ensureRankingPredictionSource } from "./rankingPredictionSource";
import { predictSavedRankingAlternative } from "./predictiveRanking";
import { ensureCurrentRankingSnapshot, resolveVerifiedRankingSource } from "./rankingOptimization";
import type { FormulationCard, SessionDetail } from "./formulationV2";

const TARGET: TargetDefinition = { productFamilyCode: "SHAMPOO", sourceEntity: "testResult", testDefinitionId: "VISCOSITY" };
const MATERIAL: RawMaterial = {
  schemaVersion: "1.0", code: "RM-1", displayName: "Surfactant", casNumbers: [], ecNumbers: [],
  functions: ["anionic_surfactant"], documents: [], regulatoryStatuses: [], hazardClassifications: [],
  allergens: [], incompatibilities: [], substituteCodes: [], activeMatterPercent: "70", activeMatterState: "known",
  active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

function sourceFormulation(id: string): Formulation {
  return {
    schemaVersion: "1.0", id, code: `CODE-${id}`, name: `Formula ${id}`, productFamilyCode: "SHAMPOO",
    targetSkuCodes: [], targetMarkets: ["KE"], targetClaims: [], targetBatchKg: "100",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archived: false,
  };
}

function sourceVersion(id: string, percent: string, formulationId: string): FormulationVersion {
  const line: FormulationLine = {
    id: `LINE-${id}`, lineNumber: 1, phase: "A", materialCode: "RM-1", displayName: "Surfactant", percent,
    isQsToHundred: false, functions: ["anionic_surfactant"],
    provenance: { origin: "chemist_override", evidenceClaimIds: [] },
  };
  return {
    schemaVersion: "1.0", id, formulationId, versionNumber: 1, status: "concept", author: "test",
    createdAt: "2026-01-02T00:00:00.000Z", lines: [line], basisBatchKg: "100", sourceRunIds: [],
    regulatoryFindingIds: [], compatibilityFindingIds: [], safetyFindingIds: [], approvalRecordIds: [],
  };
}

async function trainAcceptedModel() {
  const versions = Array.from({ length: 60 }, (_, index) => sourceVersion(`TRAIN-${index + 1}`, String(index + 1), `TRAIN-FORM-${index + 1}`));
  const formulations = versions.map((version) => sourceFormulation(version.formulationId));
  const compositionRows = extractFormulaVersionDatasetRows({
    formulationVersionIds: versions.map(({ id }) => id), formulationVersions: versions, formulations, materials: [MATERIAL],
  });
  const bundles: FormulaVersionBundleInput[] = compositionRows.map((compositionRow, index) => ({
    compositionRow,
    targetRow: formulaVersionTargetRowSchema.parse({
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      sourceRecords: [{ sourceEntity: "testResult", sourceRecordId: `TEST-${index + 1}` }],
      formulaId: compositionRow.formulaId, formulaCode: compositionRow.formulaCode,
      formulaVersionId: compositionRow.formulaVersionId, formulaVersionNumber: compositionRow.formulaVersionNumber,
      productFamilyCode: "SHAMPOO",
      targetObservations: [{ targetDefinition: TARGET, value: { kind: "numeric", raw: String(2 * (index + 1) + 1), normalized: false }, isOutlier: false, sourceRecords: [{ sourceEntity: "testResult", sourceRecordId: `TEST-${index + 1}` }] }],
    }),
  }));
  const featureRows = generateModelFeatures(bundles);
  const partitionManifest = await partitionDataset(bundles, { ratios: { train: 0.6, validation: 0.2, test: 0.2 }, seed: 1729 });
  const trained = await trainPredictiveModel({ bundles, featureRows, partitionManifest, productFamilyCode: "SHAMPOO", targetDefinition: TARGET, trainingTimestamp: "2026-10-21T12:00:00.000Z" });
  if (trained.outcome !== "ACCEPTED") throw new Error(`Expected accepted FVL-07 model fixture, got ${trained.outcome}.`);
  return trained.model;
}

describe("FVL-08 strict production acceptance", () => {
  beforeEach(() => {
    store.formulations = [];
    store.versions = [];
    store.rankings = [];
    store.runs = [];
    store.materials = [MATERIAL];
    store.prices = [{ schemaVersion: "1.0", code: "PRICE-1", materialCode: "RM-1", price: "25", currency: "KES", priceUnit: "kg", effectiveFrom: "2026-01-01", allocationBasis: "per_kg", verification: "quoted", recordedAt: "2026-01-01", recordedBy: "test" }];
    store.solver.mockReset();
    store.solver.mockResolvedValue({
      status: "optimal", formulaLines: [], totals: { totalPercent: "100.0000", totalActiveMatterPercent: "0.0000" },
      objectiveResults: [], constraintResults: [], propertyResults: [], warnings: [],
      solverMetadata: { isMixedInteger: false, solveTimeMs: 1 }, runId: "strict-acceptance-run",
    });
  });

  it("carries a real generated formula, Cost Engine snapshot and accepted FVL-07 prediction through immutable audit into the canonical optimizer run", async () => {
    const model = await trainAcceptedModel();
    const session = {
      status: "ok", id: "session-strict-1", brief: { target: "Shampoo viscosity", category: "SHAMPOO" },
      cards: [], read_only: true,
    } as unknown as SessionDetail;
    const card = {
      version: "v1", status: "ok", formula_state: "complete",
      formula: { name: "Strict acceptance shampoo", ingredients: [{ inci: "Surfactant", material_code: "RM-1", function: "Primary surfactant", weight_pct: "25" }] },
      evidence_links: [],
    } as unknown as FormulationCard;

    // Production source bridge creates and saves the exact immutable version from the generated card.
    const saved = await ensureRankingPredictionSource({ session, card, batchKg: "100", materials: [MATERIAL] });
    expect(store.formulations).toHaveLength(1);
    expect(store.versions).toHaveLength(1);
    expect(saved.version.formulationId).toBe(saved.formulation.id);
    expect(saved.version.approvalRecordIds).toEqual([]);

    const costSnapshot = costGeneratedFormula(session.id, card.version, card.formula, "100", "KES", {
      materials: [MATERIAL], prices: store.prices as never[], rates: [],
    });
    const prediction = await predictSavedRankingAlternative({ model, ...saved, materials: [MATERIAL] });
    expect(prediction.status).toBe("PREDICTED");
    if (prediction.status !== "PREDICTED") throw new Error("Accepted model did not produce an eligible prediction.");

    const [candidate] = await buildAlternativeRankingCandidates({
      sessionId: session.id, cards: [card], costSnapshots: [costSnapshot], availability: [undefined],
      compatibility: [{ formulaState: "compatible", findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-10-21T12:00:00.000Z" }],
      safety: [{ formulaState: "safe", findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-10-21T12:00:00.000Z" }],
      regulatory: [{ formulaState: "compliant", requestedMarket: "Kenya", jurisdiction: "KE", findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-10-21T12:00:00.000Z" }],
      predictions: new Map([[card.version, prediction.prediction]]),
      sourceFormulationVersionIds: new Map([[card.version, saved.version.id]]),
    });
    expect(candidate?.sourceFormulationVersionId).toBe(saved.version.id);
    expect(candidate?.dimensions.cost).toMatchObject({ status: "INCOMPLETE", sourceSnapshot: { authority: "FormuLab Cost Engine", snapshot: costSnapshot } });
    expect(candidate?.dimensions.performance).toMatchObject({ status: "PREDICTED", modelId: model.id, modelVersion: model.version });
    const rankings = rankAlternatives([candidate!]);
    expect(rankings[0]?.disposition).toBe("ELIGIBLE");

    const record = await ensureCurrentRankingSnapshot({
      sessionId: session.id, context: { batchKg: "100", currency: "KES" }, rankings, existingRecords: [],
      createCode: () => "strict-ranking-1", now: () => "2026-10-21T12:00:00.000Z",
      append: async (item) => { store.rankings.push(item); }, readBack: async () => store.rankings,
    });
    const verified = await resolveVerifiedRankingSource({
      sourceSessionId: session.id, sourceAlternativeId: candidate!.alternativeId,
      sourceFormulaFingerprint: candidate!.formulaFingerprint?.digest ?? null, rankingRecordCode: record.code, records: store.rankings,
    });
    expect(verified?.sourceAlternative.rankingRecordCode).toBe(record.code);

    render(
      <AdvancedOptimizerPanel
        formulation={saved.formulation}
        batchKg="100"
        currentLines={saved.version.lines}
        onApplyResult={vi.fn()}
        sourceAlternative={verified!.sourceAlternative}
      />,
    );
    await screen.findByText(/Advanced Optimizer source/);
    await userEvent.click(screen.getByRole("button", { name: /Run optimization/ }));
    await waitFor(() => expect(store.solver).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(store.runs).toHaveLength(1));
    expect(store.runs[0]).toMatchObject({ sourceAlternative: verified!.sourceAlternative });
    expect((store.runs[0] as { sourceAlternative: { rankingRecordCode: string } }).sourceAlternative.rankingRecordCode).toBe(record.code);
    expect(store.versions[0]).toMatchObject({ approvalRecordIds: [] });
  });
});
