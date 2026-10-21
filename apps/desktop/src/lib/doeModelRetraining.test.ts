import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DoeDesign, DoeFactor, DoeObservation, DoeRun, DoeStudy, Formulation, FormulationVersion, LaboratoryTrial, TestResult } from "@formulab/shared";

const store = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]>, append: vi.fn() }));
vi.mock("./masterdata", () => ({ listRecords: (collection: string) => Promise.resolve(store.rows[collection] ?? []) }));
vi.mock("./formulations", () => ({
  listFormulations: () => Promise.resolve(store.rows.formulations ?? []),
  readFormulation: (id: string) => Promise.resolve({ formulation: (store.rows.formulations ?? []).find((item) => (item as Formulation).id === id), versions: store.rows.formulation_versions ?? [] }),
}));
vi.mock("./predictiveModelRegistry", () => ({ readAcceptedPredictiveModels: async () => ({ models: [] }), appendAcceptedPredictiveModel: (...args: unknown[]) => store.append(...args) }));
import { retrainFromCompletedDoeResponse, retrainFromCompletedDoeTestResult } from "./doeModelRetraining";

const formulation: Formulation = { schemaVersion: "1.0", id: "formula-1", code: "F-1", name: "Formula", productFamilyCode: "SHAMPOO", targetSkuCodes: [], targetMarkets: [], targetClaims: [], targetBatchKg: "100", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archived: false };
const version: FormulationVersion = { schemaVersion: "1.0", id: "version-1", formulationId: "formula-1", versionNumber: 1, status: "pilot_approved", author: "alice", createdAt: "2026-01-01T00:00:00.000Z", lines: [], basisBatchKg: "100", sourceRunIds: [], regulatoryFindingIds: [], compatibilityFindingIds: [], safetyFindingIds: [], approvalRecordIds: [] };
const study: DoeStudy = { schemaVersion: "1.0", id: "study-1", studyCode: "DOE-1", title: "Study", projectId: "formula-1", formulationId: "formula-1", baselineFormulaVersionId: "version-1", status: "completed", designType: "full_factorial", randomizationEnabled: true, blockingEnabled: false, replicatePolicy: "none", centerPointPolicy: "none", revision: 1, createdBy: "alice", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const factor: DoeFactor = { schemaVersion: "1.0", id: "factor-a", studyId: "study-1", studyRevision: 1, factorCode: "A", name: "A", factorType: "continuous", sourceType: "process_parameter", sourceEntityId: "A", lowValue: "0", centerValue: "1", highValue: "2", categoricalLevels: [], transformation: "none", precision: 2, isMixtureComponent: false, isProcessFactor: true, isControlled: true, createdAt: "2026-01-01T00:00:00.000Z" };
const response = { schemaVersion: "1.0", id: "response-1", studyId: "study-1", studyRevision: 1, responseCode: "Y", name: "Response", responseType: "continuous", objective: "maximize", weight: "1", desirabilityShape: "linear", unit: "cP", createdAt: "2026-01-01T00:00:00.000Z" } as const;
const design: DoeDesign = { schemaVersion: "1.0", id: "design-1", studyId: "study-1", studyRevision: 1, designType: "full_factorial", factorSnapshot: [factor], constraintSnapshot: [], responseSnapshot: [response], generationSettings: {}, seed: 7, runCount: 1, replicateCount: 0, centerPointCount: 0, blockCount: 1, generatedBy: "alice", generatedAt: "2026-01-01T00:00:00.000Z", diagnostics: { runCount: 1, degreesOfFreedom: 0, duplicateRunCount: 0, estimableTerms: [], aliasedTerms: [], isOrthogonal: true, isBalanced: true, centerPointCount: 0, replicateCount: 0, constraintViolationCount: 0, warnings: [] } };
const trial = { schemaVersion: "1.0", id: "trial-1", code: "DOE-1-R1", projectId: "formula-1", sourceType: "saved_version", sourceFormulaVersionId: "version-1", formulaSnapshot: { lines: [], basisBatchKg: "100", capturedAt: "2026-01-01T00:00:00.000Z" }, productFamilyId: "SHAMPOO", targetPackagingSkuIds: [], title: "Trial", batchSize: "100", batchUnit: "kg", status: "completed", priority: "normal", equipmentIds: [], materialUsage: [], processSteps: [], observations: [], hasOpenCriticalDeviation: false, createdAt: "2026-01-01T00:00:00.000Z", createdBy: "alice", updatedAt: "2026-01-01T00:00:00.000Z", sourceDoeStudyId: "study-1", sourceDoeDesignId: "design-1", sourceDoeRunId: "run-1" } as LaboratoryTrial;
const run: DoeRun = { schemaVersion: "1.0", id: "run-1", studyId: "study-1", studyRevision: 1, designId: "design-1", runNumber: 1, standardOrder: 1, randomizedOrder: 1, block: 1, replicate: 1, isCenterPoint: false, factorSettings: [{ factorCode: "A", codedValue: "0", actualValue: "1" }], status: "completed", linkedTrialId: "trial-1", linkedFormulaVersionId: "version-1", createdAt: "2026-01-01T00:00:00.000Z" };
const observation: DoeObservation = { schemaVersion: "1.0", id: "observation-1", studyId: "study-1", studyRevision: 1, runId: "run-1", responseId: "response-1", value: "1400", status: "validated", recordedBy: "alice", recordedAt: "2026-01-02T00:00:00.000Z" };
const testResult: TestResult = { schemaVersion: "1.0", id: "test-result-1", trialId: "trial-1", formulaVersionId: "version-1", testDefinitionId: "VISCOSITY", resultType: "numeric", replicates: [{ replicateNumber: 1, numericValue: "1400", isOutlier: false }], passFail: "not_evaluated", attachments: [], performedBy: "alice", performedAt: "2026-01-02T00:00:00.000Z", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
  store.rows = {
    formulations: [formulation], formulation_versions: [version], materials: [],
    doe_studies: [study], doe_designs: [design], doe_runs: [run], doe_observations: [observation], laboratory_trials: [trial], test_results: [testResult],
  };
});

describe("FVL-09 completed DOE result retraining", () => {
  it("returns the structured FVL-07 insufficient-data result when one completed lineage group cannot be partitioned", async () => {
    const result = await retrainFromCompletedDoeResponse({ runId: "run-1", responseId: "response-1" });
    expect(result.outcome).toBe("INSUFFICIENT_DATA");
    if (result.outcome === "INSUFFICIENT_DATA") {
      expect(result.eligibility.outcome).toBe("INSUFFICIENT_DATA");
      expect(result.eligibility.reasons[0]?.code).toBe("DATASET_INSUFFICIENT_INDEPENDENT_GROUPS");
      expect(result.eligibility.datasetFingerprint.digest).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(store.append).not.toHaveBeenCalled();
  });

  it.each([
    ["run", { ...run, status: "in_progress" }],
    ["trial", run],
  ] as const)("does not train when the %s is incomplete", async (kind, currentRun) => {
    store.rows.doe_runs = [currentRun];
    if (kind === "trial") store.rows.laboratory_trials = [{ ...trial, status: "planned" }];
    const result = await retrainFromCompletedDoeResponse({ runId: "run-1", responseId: "response-1" });
    expect(result.outcome).toBe("INSUFFICIENT_DATA");
    expect(store.append).not.toHaveBeenCalled();
  });

  it("does not use unvalidated or valueless observations as training labels", async () => {
    store.rows.doe_observations = [{ ...observation, value: undefined, status: "recorded" }];
    const result = await retrainFromCompletedDoeResponse({ runId: "run-1", responseId: "response-1" });
    expect(result.outcome).toBe("INSUFFICIENT_DATA");
    expect(store.append).not.toHaveBeenCalled();
  });

  it("uses completed FVL-06 TestResults through the FVL-05 extractors and keeps a single-group model unaccepted", async () => {
    const result = await retrainFromCompletedDoeTestResult({ trialId: "trial-1", testDefinitionId: "VISCOSITY" });
    expect(result.outcome).toBe("INSUFFICIENT_DATA");
    if (result.outcome === "INSUFFICIENT_DATA") expect(result.eligibility.reasons[0]?.code).toBe("DATASET_INSUFFICIENT_INDEPENDENT_GROUPS");
    expect(store.append).not.toHaveBeenCalled();
  });
});
