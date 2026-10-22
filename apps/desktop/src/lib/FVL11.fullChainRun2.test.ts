import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DoeDesign, DoeFactor, DoeObservation, DoeResponse, DoeRun, DoeStudy, Formulation, FormulationVersion, LaboratoryTrial, RawMaterial, TestResult } from "@formulab/shared";
import { createDoeRunFromAcceptedCandidate, evaluateDoeCandidateAcquisition, rankDoeCandidatesByAcquisition } from "@formulab/shared";

const store = vi.hoisted(() => ({
  formulations: [] as Formulation[],
  versions: [] as FormulationVersion[],
  rows: {} as Record<string, unknown[]>,
  models: [] as unknown[],
}));

vi.mock("./masterdata", () => ({
  listRecords: async (collection: string) => store.rows[collection] ?? [],
}));
vi.mock("./formulations", () => ({
  listFormulations: async () => store.formulations,
  readFormulation: async (id: string) => ({
    formulation: store.formulations.find((item) => item.id === id),
    versions: store.versions.filter((item) => item.formulationId === id),
  }),
}));
vi.mock("./predictiveModelRegistry", () => ({
  readAcceptedPredictiveModels: async () => ({ models: store.models }),
  appendAcceptedPredictiveModel: async (model: unknown) => { store.models.push(model); },
}));

import { retrainFromCompletedDoeTestResult } from "./doeModelRetraining";

const ACTOR = { kind: "human" as const, role: "researcher" as const, userId: "synthetic-acceptance-chemist" };
const MATERIAL: RawMaterial = {
  schemaVersion: "1.0", code: "RM-SYNTHETIC", displayName: "Synthetic acceptance surfactant", casNumbers: [], ecNumbers: [],
  functions: ["anionic_surfactant"], documents: [], regulatoryStatuses: [], hazardClassifications: [], allergens: [],
  incompatibilities: [], substituteCodes: [], activeMatterPercent: "70", activeMatterState: "known", active: true,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};
const WATER: RawMaterial = {
  schemaVersion: "1.0", code: "RM-SYNTHETIC-WATER", displayName: "Synthetic acceptance water", casNumbers: [], ecNumbers: [],
  functions: ["solvent"], documents: [], regulatoryStatuses: [], hazardClassifications: [], allergens: [],
  incompatibilities: [], substituteCodes: [], activeMatterPercent: "100", activeMatterState: "known", active: true,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

function createFixture(count: number) {
  const formulations: Formulation[] = [];
  const versions: FormulationVersion[] = [];
  const trials: LaboratoryTrial[] = [];
  const runs: DoeRun[] = [];
  const observations: DoeObservation[] = [];
  const studies: DoeStudy[] = [];
  const designs: DoeDesign[] = [];
  const factors: DoeFactor[] = [];
  const responses: DoeResponse[] = [];
  const testResults: TestResult[] = [];
  for (let index = 1; index <= count; index += 1) {
    const formulaId = `synthetic-formula-${index}`;
    const versionId = `synthetic-version-${index}`;
    const runId = `synthetic-run-${index}`;
    const trialId = `synthetic-trial-${index}`;
    const studyId = `synthetic-study-${index}`;
    const designId = `synthetic-design-${index}`;
    const factorId = `synthetic-factor-${index}`;
    const responseId = `synthetic-response-${index}`;
    formulations.push({
      schemaVersion: "1.0", id: formulaId, code: `SYN-${index}`, name: `Synthetic formula ${index}`,
      productFamilyCode: "SHAMPOO", targetSkuCodes: [], targetMarkets: [], targetClaims: [], targetBatchKg: "100",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archived: false,
    });
    versions.push({
      schemaVersion: "1.0", id: versionId, formulationId: formulaId, versionNumber: 1, status: "concept", author: "synthetic-test-fixture",
      createdAt: "2026-01-01T00:00:00.000Z",
      lines: [
        { id: `line-${index}`, lineNumber: 1, phase: "A", materialId: MATERIAL.code, materialCode: MATERIAL.code,
          displayName: MATERIAL.displayName, percent: String(20 + index / 2), isQsToHundred: false, functions: ["anionic_surfactant"],
          provenance: { origin: "chemist_override", evidenceClaimIds: [] } },
        { id: `water-line-${index}`, lineNumber: 2, phase: "A", materialId: WATER.code, materialCode: WATER.code,
          displayName: WATER.displayName, percent: String(80 - index / 2), isQsToHundred: false, functions: ["solvent"],
          provenance: { origin: "chemist_override", evidenceClaimIds: [] } },
      ],
      basisBatchKg: "100", sourceRunIds: [], regulatoryFindingIds: [], compatibilityFindingIds: [], safetyFindingIds: [], approvalRecordIds: [],
    });
    runs.push({
      schemaVersion: "1.0", id: runId, studyId, studyRevision: 1, designId,
      runNumber: index, standardOrder: index, randomizedOrder: index, block: 1, replicate: 1, isCenterPoint: false,
      factorSettings: [{ factorCode: "PROCESS_TEMP", codedValue: (-1 + (2 * (index - 1)) / 60).toFixed(4), actualValue: String(20 + index) }],
      status: "completed", linkedTrialId: trialId, linkedFormulaVersionId: versionId, createdAt: "2026-01-01T00:00:00.000Z",
    });
    trials.push({
      schemaVersion: "1.0", id: trialId, code: `SYN-DOE-${index}`, projectId: formulaId, sourceType: "saved_version",
      sourceFormulaVersionId: versionId, formulaSnapshot: { lines: [], basisBatchKg: "100", capturedAt: "2026-01-01T00:00:00.000Z" },
      productFamilyId: "SHAMPOO", targetPackagingSkuIds: [], title: `Synthetic trial ${index}`, batchSize: "100", batchUnit: "kg",
      status: "completed", priority: "normal", equipmentIds: [], materialUsage: [], processSteps: [], observations: [],
      hasOpenCriticalDeviation: false, createdAt: "2026-01-01T00:00:00.000Z", createdBy: "synthetic-test-fixture", updatedAt: "2026-01-01T00:00:00.000Z",
      sourceDoeStudyId: studyId, sourceDoeDesignId: designId, sourceDoeRunId: runId,
    });
    observations.push({
      schemaVersion: "1.0", id: `synthetic-measurement-${index}`, studyId, studyRevision: 1,
      runId, responseId, value: String(2 * index + 1), status: "validated",
      recordedBy: "synthetic-test-fixture", recordedAt: "2026-01-01T00:00:00.000Z",
    });
    factors.push({
      schemaVersion: "1.0", id: factorId, studyId, studyRevision: 1, factorCode: "PROCESS_TEMP", name: "Synthetic process temperature",
      factorType: "continuous", sourceType: "process_parameter", sourceEntityId: "temperature", lowValue: "20", centerValue: "50", highValue: "80",
      categoricalLevels: [], transformation: "none", precision: 2, isMixtureComponent: false, isProcessFactor: true, isControlled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    responses.push({
      schemaVersion: "1.0", id: responseId, studyId, studyRevision: 1, responseCode: "VISCOSITY", name: "Synthetic viscosity response",
      responseType: "continuous", objective: "maximize", weight: "1", desirabilityShape: "linear", unit: "cP", createdAt: "2026-01-01T00:00:00.000Z",
    });
    studies.push({
      schemaVersion: "1.0", id: studyId, studyCode: `SYN-DOE-${index}`, title: `Synthetic acceptance study ${index}`,
      projectId: formulaId, formulationId: formulaId, baselineFormulaVersionId: versionId, status: "completed", designType: "full_factorial",
      randomizationEnabled: true, blockingEnabled: false, replicatePolicy: "none", centerPointPolicy: "none", revision: 1,
      createdBy: "synthetic-test-fixture", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    });
    designs.push({
      schemaVersion: "1.0", id: designId, studyId, studyRevision: 1, designType: "full_factorial", factorSnapshot: [factors[index - 1]!],
      constraintSnapshot: [], responseSnapshot: [responses[index - 1]!], generationSettings: {}, seed: 1729 + index,
      runCount: 1, replicateCount: 0, centerPointCount: 0, blockCount: 1, generatedBy: "synthetic-test-fixture", generatedAt: "2026-01-01T00:00:00.000Z",
      diagnostics: { runCount: 1, degreesOfFreedom: 0, duplicateRunCount: 0, estimableTerms: [], aliasedTerms: [], isOrthogonal: true, isBalanced: true, centerPointCount: 0, replicateCount: 0, constraintViolationCount: 0, warnings: [] },
    });
    testResults.push({
      schemaVersion: "1.0", id: `synthetic-test-result-${index}`, trialId, formulaVersionId: versionId, testDefinitionId: "VISCOSITY",
      resultType: "numeric", replicates: [{ replicateNumber: 1, numericValue: String(2 * index + 1), isOutlier: false }], passFail: "not_evaluated",
      attachments: [], performedBy: "synthetic-test-fixture", performedAt: "2026-01-02T00:00:00.000Z", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
    });
  }
  return { formulations, versions, trials, runs, observations, studies, designs, factors, responses, testResults };
}

beforeEach(() => {
  store.formulations = [];
  store.versions = [];
  store.models = [];
  store.rows = {};
});

describe("FVL-11.003 full-chain acceptance run 2 — synthetic fixtures only", () => {
  it("selects a measured-space DOE candidate, creates a human-accepted lab lineage, then retrains an immutable model", async () => {
    const fixture = createFixture(61);
    store.formulations = fixture.formulations.slice(0, 60);
    store.versions = fixture.versions.slice(0, 60);
    store.rows = {
      materials: [MATERIAL, WATER], doe_studies: fixture.studies.slice(0, 60), doe_designs: fixture.designs.slice(0, 60), doe_runs: fixture.runs.slice(0, 60),
      doe_observations: fixture.observations.slice(0, 60), laboratory_trials: fixture.trials.slice(0, 60), test_results: fixture.testResults.slice(0, 60),
    };

    const firstModel = await retrainFromCompletedDoeTestResult({ trialId: "synthetic-trial-60", testDefinitionId: "VISCOSITY" });
    expect(firstModel.outcome).toBe("ACCEPTED");
    if (firstModel.outcome !== "ACCEPTED") return;
    expect(firstModel.registeredModelId).toBe(firstModel.model.id);
    expect(firstModel.retrainingLineage?.triggeringRunId).toBe("synthetic-run-60");
    expect(firstModel.model.evaluation.acceptance).toBe("ACCEPTED");
    expect(firstModel.model.retrainingLineage?.measurementRecordIds).toHaveLength(60);

    const candidateStudy = fixture.studies[60]!;
    const candidateDesign = fixture.designs[60]!;
    const candidateFactor = fixture.factors[60]!;
    const proposalInputs = [0.5, 1].map((codedValue) => ({
      factorSettings: [{ factorCode: candidateFactor.factorCode, codedValue: String(codedValue), actualValue: String(50 + 30 * codedValue) }],
      predictedResponses: [],
    }));
    const acquisitionRanked = rankDoeCandidatesByAcquisition(proposalInputs.map((candidate) => ({
      ...candidate,
      acquisition: evaluateDoeCandidateAcquisition({ candidate, factors: [candidateFactor], runs: fixture.runs.slice(0, 60), observations: fixture.observations.slice(0, 60) }),
    })));
    expect(acquisitionRanked[0]?.factorSettings[0]?.codedValue).toBe("1");
    expect(acquisitionRanked[0]?.acquisition?.status).toBe("AVAILABLE");

    const candidate = {
      schemaVersion: "1.0" as const, id: "synthetic-active-learning-candidate", studyId: candidateStudy.id, studyRevision: candidateStudy.revision,
      analysisIds: ["synthetic-analysis"], factorSettings: acquisitionRanked[0]!.factorSettings, predictedResponses: [], desirability: 0.8,
      constraintStatus: [], rank: 1, status: "selected" as const, recommendationPolicyVersion: "doe-recommendation/v1" as const,
      createdBy: ACTOR.userId, createdAt: "2026-01-02T00:00:00.000Z",
      experimentSpace: { policyVersion: "doe-experiment-space/v1" as const, designId: candidateDesign.id, sourceFormulaVersionId: candidateStudy.baselineFormulaVersionId, seed: candidateDesign.seed, candidateCount: 2, manipulatedFactorCodes: [candidateFactor.factorCode], unchangedFormulaLineIds: [] },
      feasibility: { policyVersion: "doe-feasibility/v1" as const, evaluatedAt: "2026-01-02T00:00:00.000Z", status: "FEASIBLE" as const, reasons: [] },
      hardExclusions: { policyVersion: "doe-hard-exclusions/v1" as const, safety: { status: "PASS" as const, findingIds: [], reasons: [] }, regulatory: { status: "PASS" as const, findingIds: [], reasons: [] } },
      acquisition: acquisitionRanked[0]!.acquisition,
    };
    const plannedRun = createDoeRunFromAcceptedCandidate({ candidate, study: candidateStudy, design: candidateDesign, existingRuns: [], acceptedAt: "2026-01-02T00:00:00.000Z" }, ACTOR);
    expect(plannedRun).toMatchObject({ status: "planned", recommendationId: candidate.id, recommendationAcceptedBy: ACTOR.userId, recommendationAcceptedAt: "2026-01-02T00:00:00.000Z" });
    const plannedTrial: LaboratoryTrial = {
      schemaVersion: "1.0", id: "synthetic-active-learning-trial", code: "SYN-DOE-61", projectId: candidateStudy.formulationId,
      sourceType: "saved_version", sourceFormulaVersionId: candidateStudy.baselineFormulaVersionId,
      formulaSnapshot: { lines: [], basisBatchKg: "100", capturedAt: "2026-01-02T00:00:00.000Z" }, productFamilyId: "SHAMPOO",
      targetPackagingSkuIds: [], title: "Synthetic active-learning trial", batchSize: "100", batchUnit: "kg", status: "planned", priority: "normal",
      equipmentIds: [], materialUsage: [], processSteps: [], observations: [], hasOpenCriticalDeviation: false,
      createdAt: "2026-01-02T00:00:00.000Z", createdBy: ACTOR.userId, updatedAt: "2026-01-02T00:00:00.000Z",
      sourceDoeStudyId: candidateStudy.id, sourceDoeDesignId: candidateDesign.id, sourceDoeRunId: plannedRun.id,
    };
    expect(plannedTrial).toMatchObject({ status: "planned", sourceDoeRunId: plannedRun.id, sourceFormulaVersionId: candidateStudy.baselineFormulaVersionId });
    const syntheticTrial: LaboratoryTrial = { ...plannedTrial, status: "completed", updatedAt: "2026-01-03T00:00:00.000Z" };
    const completedRun: DoeRun = { ...plannedRun, status: "completed", linkedTrialId: syntheticTrial.id, linkedFormulaVersionId: syntheticTrial.sourceFormulaVersionId };
    const syntheticMeasurement: DoeObservation = {
      schemaVersion: "1.0", id: "synthetic-active-learning-measurement", studyId: candidateStudy.id, studyRevision: candidateStudy.revision,
      runId: completedRun.id, responseId: fixture.responses[60]!.id, value: "123", status: "validated", recordedBy: ACTOR.userId,
      recordedAt: "2026-01-03T00:00:00.000Z",
    };
    store.rows.doe_studies = [...fixture.studies];
    store.rows.doe_designs = [...fixture.designs];
    store.rows.doe_runs = [...fixture.runs.slice(0, 60), completedRun];
    store.rows.laboratory_trials = [...fixture.trials.slice(0, 60), syntheticTrial];
    store.rows.doe_observations = [...fixture.observations.slice(0, 60), syntheticMeasurement];
    store.rows.test_results = [...fixture.testResults.slice(0, 60), {
      schemaVersion: "1.0", id: "synthetic-active-learning-test-result", trialId: syntheticTrial.id, formulaVersionId: syntheticTrial.sourceFormulaVersionId,
      testDefinitionId: "VISCOSITY", resultType: "numeric", replicates: [{ replicateNumber: 1, numericValue: "123", isOutlier: false }],
      passFail: "not_evaluated", attachments: [], performedBy: ACTOR.userId, performedAt: "2026-01-03T00:00:00.000Z",
      createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z",
    } satisfies TestResult];

    store.formulations = fixture.formulations;
    store.versions = fixture.versions;
    const retrained = await retrainFromCompletedDoeTestResult({ trialId: syntheticTrial.id, testDefinitionId: "VISCOSITY" });
    expect(retrained.outcome).toBe("ACCEPTED");
    if (retrained.outcome !== "ACCEPTED") return;
    expect(retrained.model.version).toBe(2);
    expect(retrained.model.retrainingLineage).toMatchObject({
      triggeringRunId: completedRun.id, triggeringTrialId: syntheticTrial.id,
      triggerMeasurementIds: ["synthetic-active-learning-test-result"], sourceType: "test_result",
      priorModel: { id: firstModel.model.id, version: firstModel.model.version, artifactChecksum: firstModel.model.artifactChecksum },
    });
    expect(retrained.model.retrainingLineage?.measurementRecordIds).toHaveLength(61);
    expect(store.models).toHaveLength(2);
  });
});
