import { describe, expect, it } from "vitest";
import {
  FEATURE_SCHEMA_VERSION,
  extractFormulaVersionDatasetRows,
  formulaVersionTargetRowSchema,
  generateModelFeatures,
  partitionDataset,
  trainPredictiveModel,
  type Formulation,
  type FormulationLine,
  type FormulationVersion,
  type RawMaterial,
  type TargetDefinition,
  type FormulaVersionBundleInput,
} from "@formulab/shared";
import { predictSavedRankingAlternative, resolveRankingModel, unavailableRankingModelStatus } from "./predictiveRanking";

const target: TargetDefinition = { productFamilyCode: "SHAMPOO", sourceEntity: "testResult", testDefinitionId: "VISCOSITY" };

function formulation(id: string): Formulation {
  return { schemaVersion: "1.0", id, code: `CODE-${id}`, name: `Formula ${id}`, productFamilyCode: "SHAMPOO", targetSkuCodes: [], targetMarkets: ["KE"], targetClaims: [], targetBatchKg: "100", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archived: false };
}

function version(id: string, percent: string, formulationId: string): FormulationVersion {
  const line: FormulationLine = { id: `LINE-${id}`, lineNumber: 1, phase: "A", materialCode: "RM-1", displayName: "Surfactant", percent, isQsToHundred: false, functions: ["anionic_surfactant"], provenance: { origin: "chemist_override", evidenceClaimIds: [] } };
  return { schemaVersion: "1.0", id, formulationId, versionNumber: 1, status: "concept", author: "test", createdAt: "2026-01-02T00:00:00.000Z", lines: [line], basisBatchKg: "100", sourceRunIds: [], regulatoryFindingIds: [], compatibilityFindingIds: [], safetyFindingIds: [], approvalRecordIds: [] };
}

const material: RawMaterial = { schemaVersion: "1.0", code: "RM-1", displayName: "Surfactant", casNumbers: [], ecNumbers: [], functions: ["anionic_surfactant"], documents: [], regulatoryStatuses: [], hazardClassifications: [], allergens: [], incompatibilities: [], substituteCodes: [], activeMatterPercent: "70", activeMatterState: "known", active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

async function acceptedModel() {
  const versions = Array.from({ length: 60 }, (_, i) => version(`VER-${i + 1}`, String(i + 1), `FORM-${i + 1}`));
  const formulations = versions.map((item) => formulation(item.formulationId));
  const compositionRows = extractFormulaVersionDatasetRows({ formulationVersionIds: versions.map(({ id }) => id), formulationVersions: versions, formulations, materials: [material] });
  const bundles: FormulaVersionBundleInput[] = compositionRows.map((compositionRow, i) => ({
    compositionRow,
    targetRow: formulaVersionTargetRowSchema.parse({
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      sourceRecords: [{ sourceEntity: "testResult", sourceRecordId: `TEST-${i + 1}` }],
      formulaId: compositionRow.formulaId, formulaCode: compositionRow.formulaCode,
      formulaVersionId: compositionRow.formulaVersionId, formulaVersionNumber: compositionRow.formulaVersionNumber,
      productFamilyCode: "SHAMPOO",
      targetObservations: [{ targetDefinition: target, value: { kind: "numeric", raw: String(2 * (i + 1) + 1), normalized: false }, isOutlier: false, sourceRecords: [{ sourceEntity: "testResult", sourceRecordId: `TEST-${i + 1}` }] }],
    }),
  }));
  const featureRows = generateModelFeatures(bundles);
  const partitionManifest = await partitionDataset(bundles, { ratios: { train: 0.6, validation: 0.2, test: 0.2 }, seed: 1729 });
  const trained = await trainPredictiveModel({ bundles, featureRows, partitionManifest, productFamilyCode: "SHAMPOO", targetDefinition: target, trainingTimestamp: "2026-10-21T12:00:00.000Z" });
  if (trained.outcome !== "ACCEPTED") throw new Error(`Expected accepted model fixture; got ${trained.outcome}.`);
  return trained.model;
}

describe("FVL-08 production FVL-07 prediction adapter", () => {
  it("uses accepted family/target-scoped models and refuses ambiguous target selection", async () => {
    const model = await acceptedModel();
    expect(resolveRankingModel({ models: [model], productFamilyCode: "SHAMPOO" })?.id).toBe(model.id);
    expect(resolveRankingModel({ models: [model], productFamilyCode: "LAUNDRY" })).toBeUndefined();
    expect(resolveRankingModel({ models: [model, { ...model, id: "model-target-2", targetKey: `${model.targetKey}:other`, targetDefinition: { ...target, testDefinitionId: "OTHER" } }], productFamilyCode: "SHAMPOO" })).toBeUndefined();
    expect(unavailableRankingModelStatus({ rejectedModels: [], productFamilyCode: "SHAMPOO" })).toBe("UNAVAILABLE_MODEL");
    expect(unavailableRankingModelStatus({ rejectedModels: [{ ...model, evaluation: { ...model.evaluation, acceptance: "NOT_ACCEPTED" } }], productFamilyCode: "SHAMPOO" })).toBe("MODEL_NOT_ACCEPTED");
  });

  it("routes an exact saved FormulaVersion through FVL-05 features and FVL-07 predictPerformance with lineage", async () => {
    const model = await acceptedModel();
    const form = formulation("FORM-LIVE");
    const savedVersion = version("VER-LIVE", "25", form.id);
    const resolution = await predictSavedRankingAlternative({ model, formulation: form, version: savedVersion, materials: [material] });
    expect(resolution.status).toBe("PREDICTED");
    if (resolution.status !== "PREDICTED") return;
    expect(resolution.prediction).toMatchObject({ status: "PREDICTED", formulaId: form.id, formulaVersionId: savedVersion.id, formulaVersionNumber: 1, productFamilyCode: "SHAMPOO", targetDefinition: target, advisoryOnly: true });
    expect(resolution.prediction.predictedNumericValue).toEqual(expect.any(Number));
    expect(resolution.prediction.uncertainty).toBeUndefined();
  });

  it("preserves OOD and never substitutes a number", async () => {
    const model = await acceptedModel();
    const form = formulation("FORM-OOD");
    const resolution = await predictSavedRankingAlternative({ model, formulation: form, version: version("VER-OOD", "1000", form.id), materials: [material] });
    expect(resolution.status).toBe("OUT_OF_DOMAIN");
    if (resolution.status !== "OUT_OF_DOMAIN") return;
    expect(resolution.prediction?.predictedNumericValue).toBeUndefined();
  });

  it("turns a missing exact material contract into an explicit nonnumeric failure", async () => {
    const model = await acceptedModel();
    const form = formulation("FORM-MISSING");
    const resolution = await predictSavedRankingAlternative({ model, formulation: form, version: version("VER-MISSING", "25", form.id), materials: [] });
    expect(resolution).toMatchObject({ status: "INVALID_CONTRACT" });
  });
});
