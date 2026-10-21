import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCEPTANCE_POLICY_VERSION, APPLICABILITY_POLICY_VERSION, canonicalizeForFingerprint, DATASET_SCHEMA_VERSION, FEATURE_SCHEMA_VERSION, MODEL_FEATURE_CONTRACT_VERSION, MODEL_FEATURE_SCHEMA_VERSION, PREDICTIVE_MODEL_SCHEMA_VERSION, sha256Hex, TRAINING_CONTRACT_VERSION, type PredictiveModelArtifact } from "@formulab/shared";

const store = vi.hoisted(() => ({ models: [] as unknown[], upsert: vi.fn() }));
vi.mock("./masterdata", () => ({
  listRecords: async () => store.models,
  upsertRecords: (...args: unknown[]) => store.upsert(...args),
}));

import { appendAcceptedPredictiveModel, readAcceptedPredictiveModels } from "./predictiveModelRegistry";

async function acceptedArtifact(): Promise<PredictiveModelArtifact> {
  const targetDefinition = { productFamilyCode: "SHAMPOO", sourceEntity: "testResult" as const, testDefinitionId: "VISCOSITY" };
  const targetKey = canonicalizeForFingerprint(targetDefinition);
  const datasetFingerprint = { algorithm: "sha256" as const, canonicalization: "formulab-canonical-json-v1" as const, digest: "a".repeat(64) };
  const partitionConfig = { strategy: "grouped_greedy_hash", groupingStrategy: "formulaId+experimental-lineage-closure-v1", seed: 7, ratios: { train: 0.6, validation: 0.2, test: 0.2 } };
  const payload = {
    schemaVersion: PREDICTIVE_MODEL_SCHEMA_VERSION, id: "model-retraining-1", version: 1, productFamilyCode: "SHAMPOO", targetDefinition, targetKey, targetKind: "numeric" as const, targetUnit: "cP",
    datasetFingerprint, datasetSchemaVersion: DATASET_SCHEMA_VERSION, featureSchemaVersion: FEATURE_SCHEMA_VERSION, modelFeatureSchemaVersion: MODEL_FEATURE_SCHEMA_VERSION, featureContractVersion: MODEL_FEATURE_CONTRACT_VERSION,
    trainingContractVersion: TRAINING_CONTRACT_VERSION, acceptancePolicyVersion: ACCEPTANCE_POLICY_VERSION, trainingTimestamp: "2026-10-22T12:00:00.000Z",
    algorithm: "univariate_linear_regression" as const, algorithmVersion: "1.0", hyperparameters: { tuningPerformed: false }, tuningPerformed: false,
    partitionConfig, evaluation: {
      validation: { metric: "mae" as const, value: 1, sampleCount: 10 }, test: { metric: "mae" as const, value: 1, sampleCount: 10 },
      baselineValidation: { metric: "mae" as const, value: 2, sampleCount: 10 }, baselineTest: { metric: "mae" as const, value: 2, sampleCount: 10 }, acceptance: "ACCEPTED" as const, requiredRelativeImprovement: 0.05,
    },
    trainingCounts: { train: 30, validation: 10, test: 10 }, applicabilityDomain: { version: APPLICABILITY_POLICY_VERSION, featureName: "composition", minNumeric: 0, maxNumeric: 100, categories: [] },
    modelParameters: { kind: "linear" as const, featureName: "composition", intercept: 0, slope: 1 },
    featureProvenance: [{ name: "composition", sourceRecords: [{ sourceEntity: "formulationVersion", sourceRecordId: "version-1" }] }],
    retrainingLineage: {
      trainingRunId: "training-run-1", sourceType: "test_result" as const, studyId: "study-1", studyRevision: 1, designId: "design-1", triggeringRunId: "run-1", triggeringTrialId: "trial-1",
      triggerMeasurementIds: ["result-1"], measurementRecordIds: ["result-1"], formulaVersionIds: ["version-1"], targetKey, datasetFingerprint, partitionConfig,
    },
  };
  return { ...payload, artifactChecksum: await sha256Hex(canonicalizeForFingerprint(payload)) };
}

describe("predictive model persistence failure and duplicate acceptance", () => {
  beforeEach(() => {
    store.models = [];
    store.upsert.mockReset();
    store.upsert.mockImplementation(async (_collection: string, records: unknown[]) => {
      store.models = [...store.models, ...records];
      return { inserted: records.length, updated: 0, total: store.models.length };
    });
  });

  it("leaves no split-brain model after a failed append and safely retries the same immutable artifact", async () => {
    const model = await acceptedArtifact();
    store.upsert.mockRejectedValueOnce(new Error("simulated atomic file replace failure"));

    await expect(appendAcceptedPredictiveModel(model)).rejects.toThrow("simulated atomic file replace failure");
    expect(store.models).toEqual([]);
    expect((await readAcceptedPredictiveModels()).models).toEqual([]);

    await appendAcceptedPredictiveModel(model);
    const accepted = await readAcceptedPredictiveModels();
    expect(accepted.models).toEqual([model]);
    expect(accepted.models[0]?.retrainingLineage).toEqual(model.retrainingLineage);
  });

  it("rejects a duplicate append without rewriting or duplicating immutable model history", async () => {
    const model = await acceptedArtifact();
    await appendAcceptedPredictiveModel(model);
    const before = structuredClone(store.models);
    await expect(appendAcceptedPredictiveModel(model)).rejects.toThrow("append-only");
    expect(store.models).toEqual(before);
    expect(store.upsert).toHaveBeenCalledTimes(1);
  });
});
