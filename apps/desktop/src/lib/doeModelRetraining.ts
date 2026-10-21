import {
  DEFAULT_ELIGIBILITY_POLICY,
  buildDatasetManifest,
  canonicalizeForFingerprint,
  buildFormulaVersionBundleManifest,
  eligibilityResultSchema,
  extractFormulaVersionDatasetRows,
  extractFormulaVersionDoeRows,
  extractFormulaVersionTargetRows,
  extractFormulaVersionTestResultRows,
  generateModelFeatures,
  partitionDataset,
  trainPredictiveModel,
  sha256Hex,
  type PredictiveRetrainingLineage,
  type PredictiveModelArtifact,
  type DatasetPartitionManifest,
  type DoeDesign,
  type DoeObservation,
  type DoeRun,
  type DoeStudy,
  type LaboratoryTrial,
  type PredictiveTrainingResult,
  type RawMaterial,
  type TestResult,
} from "@formulab/shared";
import { listRecords } from "./masterdata";
import { listFormulations, readFormulation } from "./formulations";
import { appendAcceptedPredictiveModel, readAcceptedPredictiveModels } from "./predictiveModelRegistry";

const PARTITION_CONFIG = { ratios: { train: 0.6, validation: 0.2, test: 0.2 }, seed: 20261021 } as const;
type DoeRetrainingResult = PredictiveTrainingResult & { registeredModelId?: string; retrainingLineage?: PredictiveRetrainingLineage };

function sourceRecordIds(rows: Array<{ sourceRecords?: Array<{ sourceEntity: string; sourceRecordId: string }> }>, sourceEntity: string): string[] {
  return [...new Set(rows.flatMap((row) => (row.sourceRecords ?? []).filter((source) => source.sourceEntity === sourceEntity).map((source) => source.sourceRecordId)))].sort();
}

export function hasAcceptedTrainingDataset(models: PredictiveModelArtifact[], input: { productFamilyCode: string; targetKey: string; datasetDigest: string }): boolean {
  return models.some((model) => model.evaluation.acceptance === "ACCEPTED" && model.productFamilyCode === input.productFamilyCode && model.targetKey === input.targetKey && model.datasetFingerprint.digest === input.datasetDigest);
}

async function trainingRunId(lineage: Pick<PredictiveRetrainingLineage, "targetKey" | "datasetFingerprint">, productFamilyCode: string): Promise<string> {
  return `retraining-${await sha256Hex(canonicalizeForFingerprint({ productFamilyCode, targetKey: lineage.targetKey, datasetFingerprint: lineage.datasetFingerprint.digest }))}`;
}

/** Retrains from FVL-05 bundles only when the triggering run and linked trial
 *  are completed and the selected response has a validated measured value.
 *  FVL-07 remains the eligibility, evaluation, and model-acceptance authority. */
export async function retrainFromCompletedDoeResponse(input: { runId: string; responseId: string }): Promise<DoeRetrainingResult> {
  const [formulations, materials, studies, designs, runs, observations, trials] = await Promise.all([
    listFormulations(),
    listRecords("materials") as Promise<RawMaterial[]>,
    listRecords("doe_studies") as Promise<DoeStudy[]>,
    listRecords("doe_designs") as Promise<DoeDesign[]>,
    listRecords("doe_runs") as Promise<DoeRun[]>,
    listRecords("doe_observations") as Promise<DoeObservation[]>,
    listRecords("laboratory_trials") as Promise<LaboratoryTrial[]>,
  ]);
  const versions = (await Promise.all(formulations.map((formulation) => readFormulation(formulation.id)))).flatMap((saved) => saved.versions);
  const triggeringRun = runs.find((run) => run.id === input.runId);
  const triggeringTrial = triggeringRun?.linkedTrialId ? trials.find((trial) => trial.id === triggeringRun.linkedTrialId) : undefined;
  const validTriggerObservations = observations.filter((observation) => observation.runId === input.runId && observation.responseId === input.responseId && observation.status === "validated" && (observation.value !== undefined || observation.textValue !== undefined));
  if (!triggeringRun || triggeringRun.status !== "completed" || !triggeringTrial || triggeringTrial.status !== "completed" || validTriggerObservations.length === 0) {
    return await insufficient(input.runId, input.responseId, 0, "DOE_EXPERIMENT_NOT_COMPLETED_WITH_VALID_RESULT", "Retraining requires a completed DOE run, its linked completed LaboratoryTrial, and at least one validated measured response.");
  }
  const triggerStudy = studies.find((study) => study.id === triggeringRun.studyId);
  const triggerDesign = designs.find((design) => design.id === triggeringRun.designId);
  const triggerVersion = versions.find((version) => version.id === (triggeringRun.linkedFormulaVersionId ?? triggeringTrial.sourceFormulaVersionId));
  const triggerFormulation = triggerVersion ? formulations.find((formulation) => formulation.id === triggerVersion.formulationId) : undefined;
  const triggerResponse = triggerDesign?.responseSnapshot.find((response) => response.id === input.responseId);
  if (!triggerStudy || !triggerDesign || !triggerVersion || !triggerFormulation || !triggerResponse || triggeringRun.linkedFormulaVersionId !== triggeringTrial.sourceFormulaVersionId || triggeringTrial.sourceDoeRunId !== triggeringRun.id || triggeringTrial.sourceDoeStudyId !== triggerStudy.id || triggeringTrial.sourceDoeDesignId !== triggerDesign.id) {
    return await insufficient(input.runId, input.responseId, validTriggerObservations.length, "DOE_EXPERIMENT_LINEAGE_INVALID", "The completed run, trial, design response, and saved formula version do not form an exact linked lineage.");
  }
  const familyVersions = versions.filter((version) => formulations.some((formulation) => formulation.id === version.formulationId && formulation.productFamilyCode === triggerFormulation.productFamilyCode));
  const familyVersionIds = familyVersions.map((version) => version.id);
  const completedRunIds = new Set(runs.filter((run) => run.status === "completed" && run.linkedTrialId && trials.some((trial) => trial.id === run.linkedTrialId && trial.status === "completed")).map((run) => run.id));
  const completedRuns = runs.filter((run) => completedRunIds.has(run.id));
  const completedObservations = observations.filter((observation) => completedRunIds.has(observation.runId) && observation.status === "validated" && (observation.value !== undefined || observation.textValue !== undefined));
  const targetDefinition = { productFamilyCode: triggerFormulation.productFamilyCode, sourceEntity: "doeObservation" as const, responseId: input.responseId };
  const compositionRows = extractFormulaVersionDatasetRows({ formulationVersionIds: familyVersionIds, formulationVersions: versions, formulations, materials });
  const doeRows = extractFormulaVersionDoeRows({ formulationVersionIds: familyVersionIds, formulationVersions: versions, formulations, doeStudies: studies, doeDesigns: designs, doeRuns: completedRuns, doeObservations: completedObservations });
  const targetRows = extractFormulaVersionTargetRows({ formulaVersionIds: familyVersionIds, compositionRows, doeRows });
  const bundles = compositionRows.map((compositionRow) => {
    const doeRow = doeRows.find((row) => row.formulaVersionId === compositionRow.formulaVersionId);
    const targetRow = targetRows.find((row) => row.formulaVersionId === compositionRow.formulaVersionId);
    return { compositionRow, ...(doeRow ? { doeRow } : {}), ...(targetRow ? { targetRow } : {}) };
  });
  const manifest = await buildDatasetManifest(await Promise.all(bundles.map(buildFormulaVersionBundleManifest)));
  const featureRows = generateModelFeatures(bundles);
  let partitionManifest: DatasetPartitionManifest;
  try {
    partitionManifest = await partitionDataset(bundles, PARTITION_CONFIG);
  } catch (error) {
    if (error instanceof Error && /independent leakage group/i.test(error.message)) {
      return await insufficient(input.runId, input.responseId, completedObservations.length, "DATASET_INSUFFICIENT_INDEPENDENT_GROUPS", error.message, manifest.dataset);
    }
    throw error;
  }
  const registry = await readAcceptedPredictiveModels();
  const targetKey = canonicalizeForFingerprint(targetDefinition);
  const measurementRecordIds = sourceRecordIds(doeRows, "doeObservation");
  const triggerMeasurementIds = validTriggerObservations.map((observation) => observation.id).filter((id) => measurementRecordIds.includes(id));
  if (triggerMeasurementIds.length === 0) return await insufficient(input.runId, input.responseId, validTriggerObservations.length, "DOE_TRIGGER_MEASUREMENT_NOT_IN_DATASET", "The triggering measured DOE observation was not present in the exact training dataset; no model was created.", manifest.dataset);
  const partitionConfig = { strategy: partitionManifest.strategy, groupingStrategy: partitionManifest.groupingStrategy, seed: partitionManifest.seed, ratios: partitionManifest.ratios };
  const lineageBase = { sourceType: "doe_observation" as const, studyId: triggerStudy.id, studyRevision: triggeringRun.studyRevision, designId: triggerDesign.id, triggeringRunId: triggeringRun.id, triggeringTrialId: triggeringTrial.id, triggerMeasurementIds, measurementRecordIds, formulaVersionIds: manifest.entries.map((entry) => entry.formulaVersionId), targetKey, datasetFingerprint: manifest.dataset, partitionConfig };
  const priorModels = registry.models.filter((model) => model.productFamilyCode === triggerFormulation.productFamilyCode && model.targetKey === targetKey).sort((a, b) => a.version - b.version);
  const previousModel = priorModels[priorModels.length - 1];
  const retrainingLineage: PredictiveRetrainingLineage = { ...lineageBase, trainingRunId: await trainingRunId(lineageBase, triggerFormulation.productFamilyCode), ...(previousModel ? { priorModel: { id: previousModel.id, version: previousModel.version, artifactChecksum: previousModel.artifactChecksum } } : {}) };
  const modelVersion = Math.max(0, ...registry.models.filter((model) => model.productFamilyCode === triggerFormulation.productFamilyCode && model.targetKey === targetKey).map((model) => model.version)) + 1;
  const trained = await trainPredictiveModel({ bundles, featureRows, partitionManifest, productFamilyCode: triggerFormulation.productFamilyCode, targetDefinition, trainingTimestamp: new Date().toISOString(), modelVersion, retrainingLineage });
  if (trained.outcome === "ACCEPTED") {
    if (hasAcceptedTrainingDataset(registry.models, { productFamilyCode: triggerFormulation.productFamilyCode, targetKey, datasetDigest: manifest.dataset.digest })) {
      return { outcome: "NOT_ACCEPTED", eligibility: trained.eligibility, reason: "The exact FVL-05 dataset fingerprint already has an accepted immutable model; no duplicate version was created.", retrainingLineage };
    }
    await appendAcceptedPredictiveModel(trained.model);
    return { ...trained, registeredModelId: trained.model.id, retrainingLineage };
  }
  return { ...trained, retrainingLineage };
}

/** FVL-06 measured-response entry point. Results are admitted only through
 *  the existing TestResult extractor and only for completed, linked DOE
 *  trials; FVL-05 fingerprints and partitions the full versioned bundle. */
export async function retrainFromCompletedDoeTestResult(input: { trialId: string; testDefinitionId: string }): Promise<DoeRetrainingResult> {
  const [formulations, materials, studies, designs, runs, observations, trials, testResults] = await Promise.all([
    listFormulations(),
    listRecords("materials") as Promise<RawMaterial[]>,
    listRecords("doe_studies") as Promise<DoeStudy[]>,
    listRecords("doe_designs") as Promise<DoeDesign[]>,
    listRecords("doe_runs") as Promise<DoeRun[]>,
    listRecords("doe_observations") as Promise<DoeObservation[]>,
    listRecords("laboratory_trials") as Promise<LaboratoryTrial[]>,
    listRecords("test_results") as Promise<TestResult[]>,
  ]);
  const versions = (await Promise.all(formulations.map((formulation) => readFormulation(formulation.id)))).flatMap((saved) => saved.versions);
  const trial = trials.find((item) => item.id === input.trialId);
  const run = trial?.sourceDoeRunId ? runs.find((item) => item.id === trial.sourceDoeRunId) : undefined;
  const matchingResults = testResults.filter((result) => result.trialId === input.trialId && result.testDefinitionId === input.testDefinitionId);
  if (!trial || trial.status !== "completed" || !run || run.status !== "completed" || run.linkedTrialId !== trial.id || matchingResults.length === 0) {
    return await insufficient(input.trialId, input.testDefinitionId, 0, "DOE_EXPERIMENT_NOT_COMPLETED_WITH_VALID_RESULT", "FVL-06 retraining requires a completed linked DOE run and LaboratoryTrial plus a measured TestResult.");
  }
  const study = studies.find((item) => item.id === run.studyId);
  const design = designs.find((item) => item.id === run.designId);
  const version = versions.find((item) => item.id === (run.linkedFormulaVersionId ?? trial.sourceFormulaVersionId));
  const formulation = version ? formulations.find((item) => item.id === version.formulationId) : undefined;
  if (!study || !design || !version || !formulation || trial.sourceFormulaVersionId !== version.id || trial.sourceDoeStudyId !== study.id || trial.sourceDoeDesignId !== design.id) {
    return await insufficient(input.trialId, input.testDefinitionId, matchingResults.length, "DOE_EXPERIMENT_LINEAGE_INVALID", "The completed DOE run, trial, TestResult, and saved formula version do not form an exact linked lineage.");
  }
  const familyVersions = versions.filter((item) => formulations.some((owner) => owner.id === item.formulationId && owner.productFamilyCode === formulation.productFamilyCode));
  const familyVersionIds = familyVersions.map((item) => item.id);
  const completedRuns = runs.filter((item) => item.status === "completed" && item.linkedTrialId && trials.some((owner) => owner.id === item.linkedTrialId && owner.status === "completed"));
  const completedRunIds = new Set(completedRuns.map((item) => item.id));
  const completedTrials = trials.filter((item) => item.status === "completed" && completedRunIds.has(item.sourceDoeRunId ?? ""));
  const completedTrialIds = new Set(completedTrials.map((item) => item.id));
  const validResults = testResults.filter((result) => completedTrialIds.has(result.trialId));
  const completedObservations = observations.filter((observation) => completedRunIds.has(observation.runId) && observation.status === "validated" && (observation.value !== undefined || observation.textValue !== undefined));
  const compositionRows = extractFormulaVersionDatasetRows({ formulationVersionIds: familyVersionIds, formulationVersions: versions, formulations, materials });
  const testResultRows = extractFormulaVersionTestResultRows({ formulationVersionIds: familyVersionIds, formulationVersions: versions, formulations, trials: completedTrials, testResults: validResults });
  const doeRows = extractFormulaVersionDoeRows({ formulationVersionIds: familyVersionIds, formulationVersions: versions, formulations, doeStudies: studies, doeDesigns: designs, doeRuns: completedRuns, doeObservations: completedObservations });
  const targetRows = extractFormulaVersionTargetRows({ formulaVersionIds: familyVersionIds, compositionRows, testResultRows, doeRows });
  const bundles = compositionRows.map((compositionRow) => {
    const testResultRow = testResultRows.find((row) => row.formulaVersionId === compositionRow.formulaVersionId);
    const doeRow = doeRows.find((row) => row.formulaVersionId === compositionRow.formulaVersionId);
    const targetRow = targetRows.find((row) => row.formulaVersionId === compositionRow.formulaVersionId);
    return { compositionRow, ...(testResultRow ? { testResultRow } : {}), ...(doeRow ? { doeRow } : {}), ...(targetRow ? { targetRow } : {}) };
  });
  const manifest = await buildDatasetManifest(await Promise.all(bundles.map(buildFormulaVersionBundleManifest)));
  const featureRows = generateModelFeatures(bundles);
  let partitionManifest: DatasetPartitionManifest;
  try {
    partitionManifest = await partitionDataset(bundles, PARTITION_CONFIG);
  } catch (error) {
    if (error instanceof Error && /independent leakage group/i.test(error.message)) {
      return await insufficient(input.trialId, input.testDefinitionId, validResults.length, "DATASET_INSUFFICIENT_INDEPENDENT_GROUPS", error.message, manifest.dataset);
    }
    throw error;
  }
  const targetDefinition = { productFamilyCode: formulation.productFamilyCode, sourceEntity: "testResult" as const, testDefinitionId: input.testDefinitionId };
  const registry = await readAcceptedPredictiveModels();
  const targetKey = canonicalizeForFingerprint(targetDefinition);
  const measurementRecordIds = sourceRecordIds(testResultRows, "testResult");
  const triggerMeasurementIds = matchingResults.map((result) => result.id).filter((id) => measurementRecordIds.includes(id));
  if (triggerMeasurementIds.length === 0) return await insufficient(input.trialId, input.testDefinitionId, matchingResults.length, "TEST_RESULT_NOT_IN_TRAINING_DATASET", "The triggering TestResult was not present in the exact training dataset; no model was created.", manifest.dataset);
  const partitionConfig = { strategy: partitionManifest.strategy, groupingStrategy: partitionManifest.groupingStrategy, seed: partitionManifest.seed, ratios: partitionManifest.ratios };
  const lineageBase = { sourceType: "test_result" as const, studyId: study.id, studyRevision: run.studyRevision, designId: design.id, triggeringRunId: run.id, triggeringTrialId: trial.id, triggerMeasurementIds, measurementRecordIds, formulaVersionIds: manifest.entries.map((entry) => entry.formulaVersionId), targetKey, datasetFingerprint: manifest.dataset, partitionConfig };
  const priorModels = registry.models.filter((model) => model.productFamilyCode === formulation.productFamilyCode && model.targetKey === targetKey).sort((a, b) => a.version - b.version);
  const previousModel = priorModels[priorModels.length - 1];
  const retrainingLineage: PredictiveRetrainingLineage = { ...lineageBase, trainingRunId: await trainingRunId(lineageBase, formulation.productFamilyCode), ...(previousModel ? { priorModel: { id: previousModel.id, version: previousModel.version, artifactChecksum: previousModel.artifactChecksum } } : {}) };
  const modelVersion = Math.max(0, ...registry.models.filter((model) => model.productFamilyCode === formulation.productFamilyCode && model.targetKey === targetKey).map((model) => model.version)) + 1;
  const trained = await trainPredictiveModel({ bundles, featureRows, partitionManifest, productFamilyCode: formulation.productFamilyCode, targetDefinition, trainingTimestamp: new Date().toISOString(), modelVersion, retrainingLineage });
  if (trained.outcome === "ACCEPTED") {
    if (hasAcceptedTrainingDataset(registry.models, { productFamilyCode: formulation.productFamilyCode, targetKey, datasetDigest: manifest.dataset.digest })) {
      return { outcome: "NOT_ACCEPTED", eligibility: trained.eligibility, reason: "The exact FVL-05 dataset fingerprint already has an accepted immutable model; no duplicate version was created.", retrainingLineage };
    }
    await appendAcceptedPredictiveModel(trained.model);
    return { ...trained, registeredModelId: trained.model.id, retrainingLineage };
  }
  return { ...trained, retrainingLineage };
}

async function insufficient(runId: string, responseId: string, observationCount: number, code: string, message: string, datasetFingerprint?: { algorithm: "sha256"; canonicalization: "formulab-canonical-json-v1"; digest: string }): Promise<PredictiveTrainingResult> {
  const targetDefinition = { productFamilyCode: "unknown", sourceEntity: "doeObservation" as const, responseId };
  const fingerprint = datasetFingerprint ?? (await buildDatasetManifest([])).dataset;
  const eligibility = eligibilityResultSchema.parse({ outcome: "INSUFFICIENT_DATA", productFamilyCode: "unknown", targetKey: canonicalizeForFingerprint(targetDefinition), datasetFingerprint: fingerprint, observedRowCount: observationCount, usableRowCount: 0, targetObservationCount: observationCount, independentGroupCount: 0, missingTargetRatio: 1, missingFeatureRatio: 1, required: DEFAULT_ELIGIBILITY_POLICY, reasons: [{ code, message: `${message} (trigger run ${runId})` }] });
  return { outcome: "INSUFFICIENT_DATA", eligibility };
}

export function retrainingAuditMetadata(result: DoeRetrainingResult): Record<string, string> {
  const lineage = result.retrainingLineage;
  return {
    targetKey: result.eligibility.targetKey,
    datasetFingerprint: result.eligibility.datasetFingerprint.digest,
    ...(lineage ? {
      trainingRunId: lineage.trainingRunId,
      sourceType: lineage.sourceType,
      studyId: lineage.studyId,
      studyRevision: String(lineage.studyRevision),
      designId: lineage.designId,
      triggeringRunId: lineage.triggeringRunId,
      triggeringTrialId: lineage.triggeringTrialId,
      triggerMeasurementIds: lineage.triggerMeasurementIds.join(","),
      measurementRecordIds: lineage.measurementRecordIds.join(","),
      formulaVersionIds: lineage.formulaVersionIds.join(","),
      partitionConfig: canonicalizeForFingerprint(lineage.partitionConfig),
      ...(lineage.priorModel ? {
        priorModelId: lineage.priorModel.id,
        priorModelVersion: String(lineage.priorModel.version),
        priorModelChecksum: lineage.priorModel.artifactChecksum,
      } : {}),
    } : {}),
  };
}
