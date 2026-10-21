import { describe, expect, it } from "vitest";
import { buildLaboratoryLineage } from "./laboratoryLineage";

describe("buildLaboratoryLineage", () => {
  it("resolves the chain through exact immutable IDs and exposes metadata", () => {
    const lineage = buildLaboratoryLineage({
      generationSessions: [{ id: "session-1", status: "completed", createdAt: "2026-01-01" }],
      formulations: [{ id: "formula-1", code: "F-1" }],
      formulationVersions: [{ id: "version-1", formulationId: "formula-1", versionNumber: 1 }],
      doeStudies: [{ id: "study-1", baselineFormulaVersionId: "version-1" }],
      doeDesigns: [{ id: "design-1", studyId: "study-1" }],
      doeRuns: [{ id: "run-1", studyId: "study-1", designId: "design-1", linkedFormulaVersionId: "version-1", linkedTrialId: "trial-1" }],
      laboratoryTrials: [{ id: "trial-1", code: "LT-1", sourceDoeRunId: "run-1", sourceFormulaVersionId: "version-1", status: "completed" }],
      testResults: [{ id: "result-1", trialId: "trial-1", formulaVersionId: "version-1" }],
      datasets: [{ entries: [{ formulaVersionId: "version-1" }], dataset: { digest: "a".repeat(64) } }],
      predictiveModels: [{ id: "model-1", version: 1, artifactChecksum: "c".repeat(64), schemaVersion: "1.0", productFamilyCode: "family-a", datasetFingerprint: { digest: "a".repeat(64) }, datasetSchemaVersion: "1.0", featureSchemaVersion: "1.0", modelFeatureSchemaVersion: "1.0", featureContractVersion: "fc1", trainingContractVersion: "tc1", acceptancePolicyVersion: "ap1", applicabilityDomain: { version: "1.0", featureName: "x", categories: [] } }],
      predictions: [{ id: "prediction-1", modelId: "model-1", modelVersion: 1, modelChecksum: "c".repeat(64), modelArtifactSchemaVersion: "1.0", datasetFingerprint: { digest: "a".repeat(64) }, datasetSchemaVersion: "1.0", featureSchemaVersion: "1.0", modelFeatureSchemaVersion: "1.0", featureContractVersion: "fc1", trainingContractVersion: "tc1", acceptancePolicyVersion: "ap1", applicabilityDomainSnapshot: { version: "1.0", featureName: "x", categories: [] }, productFamilyCode: "family-a", formulaId: "formula-1", formulaVersionId: "version-1", formulaVersionNumber: 1 }],
      rankings: [{ code: "ranking-1", sessionId: "session-1", rankings: [{ candidate: { candidateId: "alternative-1", sourceFormulationVersionId: "version-1", dimensions: { performance: { sourceSnapshot: { modelId: "model-1" } } } } }] }],
      optimizationRuns: [{ code: "optimization-1", formulaVersionId: "version-1", sourceAlternative: { rankingRecordCode: "ranking-1" } }],
    });

    expect(lineage.brokenReferences).toEqual([]);
    expect(lineage.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "test_result:result-1", to: "laboratory_trial:trial-1", relationship: "laboratory_trial", status: "resolved" }),
      expect.objectContaining({ from: "predictive_model:model-1", to: `dataset:${"a".repeat(64)}`, relationship: "training_dataset", status: "resolved" }),
      expect.objectContaining({ from: "optimization_run:optimization-1", to: "ranking:ranking-1", relationship: "ranking_snapshot", status: "resolved" }),
    ]));
    expect(lineage.nodes).toContainEqual(expect.objectContaining({ entityType: "laboratory_trial", id: "trial-1", code: "LT-1", status: "completed" }));
  });

  it("fails closed on broken references and never retargets to a newer record", () => {
    const lineage = buildLaboratoryLineage({
      formulationVersions: [
        { id: "version-old", formulationId: "formula-1", versionNumber: 1 },
        { id: "version-new", formulationId: "formula-1", versionNumber: 2 },
      ],
      laboratoryTrials: [{ id: "trial-1", sourceFormulaVersionId: "version-missing" }],
      testResults: [{ id: "result-1", trialId: "trial-missing", formulaVersionId: "version-old" }],
      predictions: [{ id: "prediction-1", modelId: "model-missing", modelVersion: 1, formulaVersionId: "version-old" }],
    });

    expect(lineage.brokenReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "laboratory_trial:trial-1", to: "formulation_version:version-missing", status: "missing" }),
      expect.objectContaining({ from: "test_result:result-1", to: "laboratory_trial:trial-missing", status: "missing" }),
      expect.objectContaining({ from: "prediction:prediction-1", to: "predictive_model:model-missing", status: "missing" }),
    ]));
    expect(lineage.edges.some(edge => edge.to === "formulation_version:version-new")).toBe(false);
  });

  it("marks contradictory immutable version snapshots invalid", () => {
    const lineage = buildLaboratoryLineage({
      formulations: [{ id: "formula-1" }],
      formulationVersions: [{ id: "version-1", formulationId: "formula-1", versionNumber: 1 }],
      datasets: [{ entries: [], dataset: { digest: "a".repeat(64) } }],
      predictiveModels: [{ id: "model-1", version: 2, productFamilyCode: "family-a", datasetFingerprint: { digest: "a".repeat(64) } }],
      predictions: [{ id: "prediction-1", modelId: "model-1", modelVersion: 1, datasetFingerprint: { digest: "a".repeat(64) }, productFamilyCode: "family-a", formulaId: "formula-1", formulaVersionId: "version-1", formulaVersionNumber: 2 }],
    });

    expect(lineage.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relationship: "exact_model", status: "invalid" }),
      expect.objectContaining({ relationship: "formula_version", status: "invalid" }),
    ]));
    expect(lineage.brokenReferences).toHaveLength(2);
  });

  it("connects a corrective-action-derived draft to its recorded source without healing missing links", () => {
    const lineage = buildLaboratoryLineage({
      correctiveActions: [{ id: "ca-1", sourceType: "trial_deviation", sourceRecordId: "trial-1", createdDraftId: "formula-1" }],
      formulations: [{ id: "formula-1" }],
      formulationVersions: [{ id: "version-1", formulationId: "formula-1", versionNumber: 1 }],
      laboratoryTrials: [{ id: "trial-1", sourceFormulaVersionId: "version-1" }],
      testResults: [{ id: "result-1", trialId: "trial-1", formulaVersionId: "version-1" }],
      formulationDrafts: [{ formulationId: "formula-1", origin: { kind: "corrective_action", correctiveActionId: "ca-1", sourceType: "trial_deviation", sourceRecordId: "trial-1", sourceTestResultId: "result-1", sourceFormulaVersionId: "version-1" } }],
    });

    expect(lineage.brokenReferences).toEqual([]);
    expect(lineage.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "formulation_draft:formula-1", to: "corrective_action:ca-1", status: "resolved" }),
      expect.objectContaining({ from: "formulation_draft:formula-1", to: "test_result:result-1", status: "resolved" }),
      expect.objectContaining({ from: "formulation_draft:formula-1", to: "formulation_version:version-1", status: "resolved" }),
    ]));
  });

  it("links a promoted Phase-14 formula version to its exact generation session and alternative fingerprint", () => {
    const lineage = buildLaboratoryLineage({
      generationSessions: [{ id: "session-1" }],
      formulations: [{ id: "formula-1" }],
      formulationVersions: [{ id: "version-1", formulationId: "formula-1", versionNumber: 1, generatedSource: { sessionId: "session-1", alternativeId: "v2", formulaFingerprint: { algorithm: "sha256", canonicalization: "formulab-canonical-json-v1", digest: "a".repeat(64) } } }],
    });

    expect(lineage.brokenReferences).toEqual([]);
    expect(lineage.edges).toContainEqual(expect.objectContaining({ from: "formulation_version:version-1", to: "generation_session:session-1", relationship: "generated_from_session", status: "resolved" }));
  });

  it("projects retraining evidence, prior model and fingerprint without healing missing references", () => {
    const lineage = buildLaboratoryLineage({
      formulationVersions: [{ id: "version-1", versionNumber: 1 }],
      doeRuns: [{ id: "run-1", linkedTrialId: "trial-1" }],
      laboratoryTrials: [{ id: "trial-1", sourceDoeRunId: "run-1" }],
      testResults: [{ id: "result-1", trialId: "trial-1", formulaVersionId: "version-1" }],
      predictiveModels: [
        { id: "model-v1", version: 1, artifactChecksum: "a".repeat(64), datasetFingerprint: { digest: "1".repeat(64) } },
        { id: "model-v2", version: 2, artifactChecksum: "b".repeat(64), datasetFingerprint: { digest: "2".repeat(64) }, datasetSchemaVersion: "1.0", trainingTimestamp: "2026-10-21T12:00:00.000Z", retrainingLineage: {
          sourceType: "test_result", measurementRecordIds: ["result-1", "missing-result"], triggerMeasurementIds: ["result-1"], formulaVersionIds: ["version-1"],
          triggeringRunId: "run-1", triggeringTrialId: "trial-1", priorModel: { id: "model-v1", version: 1, artifactChecksum: "a".repeat(64) },
        } },
      ],
      datasets: [{ id: "dataset-one", dataset: { digest: "1".repeat(64) } }],
    });

    expect(lineage.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "predictive_model:model-v2", to: "test_result:result-1", relationship: "trained_from_measurement", status: "resolved" }),
      expect.objectContaining({ from: "predictive_model:model-v2", to: "test_result:missing-result", relationship: "trained_from_measurement", status: "missing" }),
      expect.objectContaining({ from: "predictive_model:model-v2", to: "formulation_version:version-1", relationship: "trained_from_formula_version", status: "resolved" }),
      expect.objectContaining({ from: "predictive_model:model-v2", to: "laboratory_trial:trial-1", relationship: "triggering_trial", status: "resolved" }),
      expect.objectContaining({ from: "predictive_model:model-v2", to: "predictive_model:model-v1", relationship: "retrained_from", status: "resolved" }),
      expect.objectContaining({ from: "predictive_model:model-v2", to: `dataset:${"2".repeat(64)}`, relationship: "training_dataset", status: "resolved" }),
    ]));
    expect(lineage.brokenReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ to: "test_result:missing-result", status: "missing" }),
    ]));
    expect(lineage.nodes).toContainEqual(expect.objectContaining({ entityType: "dataset", id: "2".repeat(64), status: "fingerprint_reference" }));
  });

  it("accepts a bounded full-chain fixture while preserving every source and the historical prediction model", () => {
    const firstFingerprint = { algorithm: "sha256", canonicalization: "formulab-canonical-json-v1", digest: "1".repeat(64) };
    const retrainingFingerprint = { ...firstFingerprint, digest: "2".repeat(64) };
    const firstModel = { id: "model-v1", version: 1, schemaVersion: "1.1", artifactChecksum: "a".repeat(64), productFamilyCode: "SHAMPOO", targetKey: "viscosity", targetDefinition: { sourceEntity: "testResult" }, datasetFingerprint: firstFingerprint, datasetSchemaVersion: "1.0", featureSchemaVersion: "1.0", modelFeatureSchemaVersion: "1.0", featureContractVersion: "1.0", trainingContractVersion: "1.0", acceptancePolicyVersion: "1.0", applicabilityDomain: { version: "1.0", featureName: "composition", categories: [] } };
    const records = {
      generationSessions: [{ id: "session-1", status: "completed", createdAt: "2026-10-22T08:00:00.000Z" }],
      formulations: [{ id: "formula-1", code: "F-1" }],
      formulationVersions: [{ id: "version-1", formulationId: "formula-1", versionNumber: 1, generatedSource: { sessionId: "session-1", alternativeId: "v1", formulaFingerprint: firstFingerprint } }],
      formulationDrafts: [{ formulationId: "formula-1", origin: { kind: "doe_candidate", candidateId: "candidate-1", studyId: "study-1", studyRevision: 1, designId: "design-1", sourceFormulaVersionId: "version-1", factorSettings: [{ factorCode: "A", actualValue: "20" }], appliedAt: "2026-10-22T08:10:00.000Z" } }],
      doeStudies: [{ id: "study-1", revision: 1, baselineFormulaVersionId: "version-1" }],
      doeDesigns: [{ id: "design-1", studyId: "study-1" }],
      doeCandidates: [{ id: "candidate-1", studyId: "study-1", status: "selected", experimentSpace: { designId: "design-1", sourceFormulaVersionId: "version-1" } }],
      doeRuns: [{ id: "run-2", studyId: "study-1", designId: "design-1", recommendationId: "candidate-1", recommendationAcceptedBy: "alice", linkedTrialId: "trial-1", linkedFormulaVersionId: "version-1", status: "completed" }],
      laboratoryTrials: [{ id: "trial-1", sourceFormulaVersionId: "version-1", sourceDoeRunId: "run-2", sourceDoeStudyId: "study-1", sourceDoeDesignId: "design-1", status: "completed" }],
      testResults: [{ id: "result-1", trialId: "trial-1", formulaVersionId: "version-1", resultType: "numeric", replicates: [{ numericValue: "1450" }] }],
      datasets: [
        { id: "dataset-v1", dataset: firstFingerprint, entries: [{ formulaVersionId: "version-1" }] },
        { id: "dataset-v2", dataset: retrainingFingerprint, entries: [{ formulaVersionId: "version-1" }] },
      ],
      predictiveModels: [firstModel, { ...firstModel, id: "model-v2", version: 2, artifactChecksum: "b".repeat(64), datasetFingerprint: retrainingFingerprint, retrainingLineage: { sourceType: "test_result", measurementRecordIds: ["result-1"], triggerMeasurementIds: ["result-1"], formulaVersionIds: ["version-1"], triggeringRunId: "run-2", triggeringTrialId: "trial-1", priorModel: { id: "model-v1", version: 1, artifactChecksum: "a".repeat(64) } } }],
      rankings: [{ code: "ranking-1", sessionId: "session-1", capturedAt: "2026-10-22T08:30:00.000Z", rankings: [{ candidate: { candidateId: "alternative-1", sourceFormulationVersionId: "version-1", dimensions: { performance: { status: "PREDICTED", sourceSnapshot: { modelId: "model-v1", prediction: { status: "PREDICTED", modelId: "model-v1", modelVersion: 1, modelChecksum: "a".repeat(64), modelArtifactSchemaVersion: "1.1", productFamilyCode: "SHAMPOO", datasetFingerprint: firstFingerprint, datasetSchemaVersion: "1.0", featureSchemaVersion: "1.0", modelFeatureSchemaVersion: "1.0", featureContractVersion: "1.0", trainingContractVersion: "1.0", acceptancePolicyVersion: "1.0", applicabilityDomainSnapshot: firstModel.applicabilityDomain, formulaId: "formula-1", formulaVersionId: "version-1", formulaVersionNumber: 1 } } } } } }] }],
      optimizationRuns: [{ code: "optimization-1", formulaVersionId: "version-1", sourceAlternative: { rankingRecordCode: "ranking-1" } }],
    };
    const before = structuredClone(records);
    const lineage = buildLaboratoryLineage(records);

    expect(lineage.brokenReferences).toEqual([]);
    expect(lineage.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "formulation_version:version-1", to: "generation_session:session-1", status: "resolved" }),
      expect.objectContaining({ from: "formulation_draft:formula-1", to: "doe_candidate:candidate-1", status: "resolved" }),
      expect.objectContaining({ from: "doe_run:run-2", to: "doe_candidate:candidate-1", relationship: "recommendation", status: "resolved" }),
      expect.objectContaining({ from: "test_result:result-1", to: "laboratory_trial:trial-1", status: "resolved" }),
      expect.objectContaining({ from: "predictive_model:model-v2", to: "test_result:result-1", relationship: "trained_from_measurement", status: "resolved" }),
      expect.objectContaining({ from: "predictive_model:model-v2", to: "predictive_model:model-v1", relationship: "retrained_from", status: "resolved" }),
      expect.objectContaining({ from: "prediction_snapshot:ranking-1/alternative-1/performance", to: "predictive_model:model-v1", relationship: "exact_model", status: "resolved" }),
      expect.objectContaining({ from: "optimization_run:optimization-1", to: "ranking:ranking-1", status: "resolved" }),
    ]));
    expect(lineage.edges.some((edge) => edge.from === "prediction_snapshot:ranking-1/alternative-1/performance" && edge.to === "predictive_model:model-v2")).toBe(false);
    expect(records).toEqual(before);
    expect(records.doeCandidates[0]?.status).toBe("selected");
    expect(records.laboratoryTrials[0]?.status).toBe("completed");
    expect(records.testResults[0]?.replicates[0]?.numericValue).toBe("1450");
  });
});
