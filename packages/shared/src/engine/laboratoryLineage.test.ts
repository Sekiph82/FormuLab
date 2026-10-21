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
      predictiveModels: [{ id: "model-1", version: 1, productFamilyCode: "family-a", datasetFingerprint: { digest: "a".repeat(64) } }],
      predictions: [{ id: "prediction-1", modelId: "model-1", modelVersion: 1, datasetFingerprint: { digest: "a".repeat(64) }, productFamilyCode: "family-a", formulaId: "formula-1", formulaVersionId: "version-1", formulaVersionNumber: 1 }],
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
});
