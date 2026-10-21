import { describe, expect, it } from "vitest";
import {
  DATASET_SCHEMA_VERSION,
  FEATURE_SCHEMA_VERSION,
  canonicalizeForFingerprint,
  buildDatasetManifest,
  buildFormulaVersionBundleManifest,
  extractFormulaVersionDatasetRows,
  formulaVersionDoeRowSchema,
  formulaVersionProcessRowSchema,
  formulaVersionTestResultRowSchema,
  generateModelFeatures,
  partitionDataset,
  predictPerformance,
  predictionDecisionGate,
  createPredictiveModelRegistry,
  parsePredictiveModelRegistry,
  registerPredictiveModel,
  serializePredictiveModelRegistry,
  trainPredictiveModel,
  predictiveModelArtifactSchema,
  sha256Hex,
  evaluatePredictiveEligibility,
  type FormulaVersionBundleInput,
  type Formulation,
  type FormulationLine,
  type FormulationVersion,
  type RawMaterial,
  type TargetDefinition,
  type FormulaVersionTargetRow,
} from "../index";

function line(id: string, percent: string): FormulationLine {
  return {
    id,
    lineNumber: 1,
    phase: "A",
    displayName: "Surfactant",
    materialCode: "RM-001",
    percent,
    isQsToHundred: false,
    functions: ["anionic_surfactant"],
    provenance: { origin: "chemist_override", evidenceClaimIds: [] },
  };
}

function formulation(id: string, family = "SHAMPOO"): Formulation {
  return {
    schemaVersion: "1.0", id, code: id, name: `Formula ${id}`,
    productFamilyCode: family, targetSkuCodes: [], targetMarkets: ["KE"], targetClaims: [],
    targetBatchKg: "100", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archived: false,
  };
}

function version(id: string, percent: string): FormulationVersion {
  return {
    schemaVersion: "1.0", id: `VER-${id}`, formulationId: `FORM-${id}`, versionNumber: 1,
    status: "concept", author: "local", createdAt: "2026-01-02T00:00:00.000Z",
    lines: [line(`LINE-${id}`, percent)], basisBatchKg: "100", sourceRunIds: [],
    regulatoryFindingIds: [], compatibilityFindingIds: [], safetyFindingIds: [], approvalRecordIds: [],
  };
}

function material(): RawMaterial {
  return {
    schemaVersion: "1.0", code: "RM-001", displayName: "Surfactant", casNumbers: [], ecNumbers: [],
    functions: ["anionic_surfactant"], documents: [], regulatoryStatuses: [], hazardClassifications: [],
    allergens: [], incompatibilities: [], substituteCodes: [], activeMatterPercent: "70", activeMatterState: "known",
    density: "1.05", active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const targetDefinition: TargetDefinition = { productFamilyCode: "SHAMPOO", sourceEntity: "testResult", testDefinitionId: "VISCOSITY" };

function targetRow(id: string, value: number, family = "SHAMPOO"): FormulaVersionTargetRow {
  return {
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    sourceRecords: [{ sourceEntity: "testResult", sourceRecordId: `TEST-${id}` }],
    formulaId: `FORM-${id}`, formulaCode: `FORM-${id}`, formulaVersionId: `VER-${id}`, formulaVersionNumber: 1,
    productFamilyCode: family,
    targetObservations: [{
      targetDefinition: { ...targetDefinition, productFamilyCode: family },
      value: { kind: "numeric", raw: String(value), normalized: false },
      isOutlier: false,
      sourceRecords: [{ sourceEntity: "testResult", sourceRecordId: `TEST-${id}` }],
    }],
  };
}

function contextRows(compositionRow: FormulaVersionBundleInput["compositionRow"]) {
  const identity = {
    formulaId: compositionRow.formulaId, formulaCode: compositionRow.formulaCode,
    formulaVersionId: compositionRow.formulaVersionId, formulaVersionNumber: compositionRow.formulaVersionNumber,
  };
  const processRow = formulaVersionProcessRowSchema.parse({
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    sourceRecords: [
      { sourceEntity: "formulationVersion", sourceRecordId: compositionRow.formulaVersionId },
      { sourceEntity: "processParameter", sourceRecordId: "PROCESS-001" },
      { sourceEntity: "laboratoryTrial", sourceRecordId: "TRIAL-001" },
    ],
    ...identity,
    plannedProcedure: [{ schemaVersion: "1.0", code: "PROCESS-001", formulaCode: compositionRow.formulaCode, formulaVersion: compositionRow.formulaVersionNumber, stepNumber: 1, phase: "A", equipmentType: "mixer", temperatureTarget: "50", mixingSpeedTarget: "200", mixingTimeMinutes: "20", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
    trials: [{
      trialId: "TRIAL-001", trialCode: "TRIAL-CODE-001",
      plannedSteps: [{ processStepId: "STEP-001", stepNumber: 1, phase: "A", plannedInstruction: "Mix", requiredEquipment: [], plannedTemperatureMinC: "45", plannedTemperatureMaxC: "55" }],
      actualStepObservations: [{ processStepId: "STEP-001", stepNumber: 1, status: "completed", actualTemperatureC: "49", actualMixingSpeedRpm: "180", actualDurationMinutes: "19", actualPh: "5.5", actualViscosity: "2000", viscosityUnit: "mPa.s" }],
      observations: [],
    }],
  });
  const doeRow = formulaVersionDoeRowSchema.parse({
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    sourceRecords: [
      { sourceEntity: "formulationVersion", sourceRecordId: compositionRow.formulaVersionId },
      { sourceEntity: "doeStudy", sourceRecordId: "DOE-001" },
      { sourceEntity: "doeDesign", sourceRecordId: "DESIGN-001" },
      { sourceEntity: "doeRun", sourceRecordId: "RUN-001" },
    ],
    ...identity,
    studies: [{
      studyId: "DOE-001", studyCode: "DOE-CODE-001", studyRevision: 1,
      designs: [{
        design: {
          schemaVersion: "1.0", id: "DESIGN-001", studyId: "DOE-001", studyRevision: 1, designType: "full_factorial",
          factorSnapshot: [{ schemaVersion: "1.0", id: "FACTOR-001", studyId: "DOE-001", studyRevision: 1, factorCode: "TEMP", name: "Process temperature", factorType: "continuous", sourceType: "temperature", unit: "°C", lowValue: "40", centerValue: "50", highValue: "60", categoricalLevels: [], transformation: "none", precision: 2, isMixtureComponent: false, isProcessFactor: true, isControlled: true, createdAt: "2026-01-01T00:00:00.000Z" }],
          constraintSnapshot: [], responseSnapshot: [{ schemaVersion: "1.0", id: "RESPONSE-001", studyId: "DOE-001", studyRevision: 1, responseCode: "VISC", name: "Viscosity", responseType: "continuous", objective: "observe_only", weight: "1", desirabilityShape: "linear", createdAt: "2026-01-01T00:00:00.000Z" }],
          generationSettings: {}, seed: 1, runCount: 1, replicateCount: 0, centerPointCount: 0, blockCount: 1, generatedBy: "test", generatedAt: "2026-01-01T00:00:00.000Z",
          diagnostics: { runCount: 1, degreesOfFreedom: 0, duplicateRunCount: 0, estimableTerms: [], aliasedTerms: [], isOrthogonal: true, isBalanced: true, centerPointCount: 0, replicateCount: 0, constraintViolationCount: 0, warnings: [] },
        },
        runs: [{
          run: { schemaVersion: "1.0", id: "RUN-001", studyId: "DOE-001", studyRevision: 1, designId: "DESIGN-001", runNumber: 1, standardOrder: 1, randomizedOrder: 1, block: 1, replicate: 1, isCenterPoint: false, factorSettings: [{ factorCode: "TEMP", codedValue: "0", actualValue: "50" }], status: "completed", createdAt: "2026-01-01T00:00:00.000Z" },
          observations: [{ schemaVersion: "1.0", id: "OBS-001", studyId: "DOE-001", studyRevision: 1, runId: "RUN-001", responseId: "RESPONSE-001", value: "999", status: "recorded", recordedBy: "test", recordedAt: "2026-01-01T00:00:00.000Z" }],
        }],
      }],
    }],
  });
  return { processRow, doeRow };
}

async function makePipeline(size = 60, family = "SHAMPOO", labelledSize = size, percentAt: (index: number) => string = (index) => String(index + 1)) {
  const versions = Array.from({ length: size }, (_, index) => version(`${family}-${String(index + 1).padStart(3, "0")}`, percentAt(index)));
  const formulations = versions.map((item) => formulation(item.formulationId, family));
  const compositionRows = extractFormulaVersionDatasetRows({ formulationVersions: versions, formulations, materials: [material()], formulationVersionIds: versions.map((item) => item.id) });
  const bundles: FormulaVersionBundleInput[] = compositionRows.map((compositionRow, index) => ({
    compositionRow,
    targetRow: targetRow(`${family}-${String(index + 1).padStart(3, "0")}`, 2 * (index + 1) + 1, family),
  }));
  for (let index = labelledSize; index < bundles.length; index += 1) bundles[index]!.targetRow!.targetObservations = [];
  const featureRows = generateModelFeatures(bundles);
  const partitionManifest = await partitionDataset(bundles, { ratios: { train: 0.6, validation: 0.2, test: 0.2 }, seed: 1729 });
  const bundleManifests = await Promise.all(bundles.map(buildFormulaVersionBundleManifest));
  return { bundles, featureRows, partitionManifest, bundleManifests };
}

describe("FVL-07 predictive performance engine", () => {
  it("generates deterministic, provenance-linked composition and property features with configured interactions", async () => {
    const pipeline = await makePipeline(4);
    const config = { version: "interactions-v1", interactions: [{ id: "composition-active", leftFeature: "material.RM-001.activeMatterPercent", rightFeature: "composition.material.RM-001.percent" }] };
    const first = generateModelFeatures(pipeline.bundles, { interactionConfig: config });
    const second = generateModelFeatures([...pipeline.bundles].reverse(), { interactionConfig: { ...config, interactions: [...config.interactions].reverse().map((item) => ({ ...item, leftFeature: item.rightFeature, rightFeature: item.leftFeature })) } });
    expect(second).toEqual(first);
    expect(first[0]!.features.find((item) => item.name === "material.weighted.activeMatterPercent")).toMatchObject({ numericValue: 70, unit: "%" });
    const composition = first[0]!.features.find((item) => item.name === "composition.material.RM-001.percent")!;
    expect(composition.sourceRecords).toContainEqual({ sourceEntity: "rawMaterial", sourceRecordId: "RM-001" });
    expect(first[0]!.features.some((item) => item.name.startsWith("interaction.interactions-v1."))).toBe(true);
    expect(first[0]!.interactionConfig).toEqual({ version: config.version, interactions: [{ id: "composition-active", leftFeature: "composition.material.RM-001.percent", rightFeature: "material.RM-001.activeMatterPercent" }] });
    expect(first[0]!.datasetSchemaVersion).toBe(DATASET_SCHEMA_VERSION);
    expect(first[0]!.features.find((item) => item.name === "material.RM-001.physicalForm")).toBeUndefined();
    const changedTargets = structuredClone(pipeline.bundles);
    changedTargets[0]!.targetRow!.targetObservations[0]!.value = { kind: "numeric", raw: "999999", normalized: false };
    expect(generateModelFeatures(changedTargets, { interactionConfig: config })).toEqual(first);
    expect(generateModelFeatures(pipeline.bundles)[0]!.features.some((item) => item.name.startsWith("interaction."))).toBe(false);

    const context = contextRows(pipeline.bundles[0]!.compositionRow);
    const withContext = { ...pipeline.bundles[0]!, ...context };
    const contextFeatures = generateModelFeatures([withContext])[0]!.features;
    expect(contextFeatures).toContainEqual(expect.objectContaining({ name: "process.plan.step.1.temperatureTargetC", numericValue: 50, unit: "°C" }));
    expect(contextFeatures).toContainEqual(expect.objectContaining({ name: "process.actual.step.1.temperatureC", numericValue: 49, unit: "°C" }));
    expect(contextFeatures).toContainEqual(expect.objectContaining({ name: "testContext.doeFactor.TEMP.°C", numericValue: 50, unit: "°C" }));
    expect(contextFeatures.some((item) => item.name.includes("actualPh") || item.name.includes("actualViscosity") || item.name.startsWith("doe.observation"))).toBe(false);
    const changedDoe = structuredClone(withContext);
    changedDoe.doeRow!.studies[0]!.designs[0]!.runs[0]!.observations[0]!.value = "-500";
    expect(generateModelFeatures([changedDoe])[0]!.features).toEqual(contextFeatures);
  });

  it("returns a structured insufficient-data result and never registers a model below policy", async () => {
    const pipeline = await makePipeline(6);
    const result = await evaluatePredictiveEligibility({ ...pipeline, productFamilyCode: "SHAMPOO", targetDefinition });
    expect(result.outcome).toBe("INSUFFICIENT_DATA");
    expect(result.reasons.map(({ code }) => code)).toContain("DATASET_ROWS_BELOW_MINIMUM");
    const training = await trainPredictiveModel({ ...pipeline, productFamilyCode: "SHAMPOO", targetDefinition, trainingTimestamp: "2026-10-20T12:00:00.000Z" });
    expect(training.outcome).toBe("INSUFFICIENT_DATA");
    expect(training.model).toBeUndefined();
  });

  it("passes explicit size and missingness boundaries without treating zero as missing", async () => {
    const boundary = await makePipeline(50, "SHAMPOO", 38, (index) => index === 0 ? "0" : String(index + 1));
    const result = await evaluatePredictiveEligibility({ ...boundary, productFamilyCode: "SHAMPOO", targetDefinition });
    expect(result.outcome).toBe("ELIGIBLE");
    expect(result.observedRowCount).toBe(50);
    expect(result.targetObservationCount).toBe(38);
    expect(result.missingTargetRatio).toBeCloseTo(0.24);
    expect(boundary.featureRows.find((row) => row.formulaVersionId === "VER-SHAMPOO-001")?.features.find((item) => item.name === "composition.material.RM-001.percent")).toMatchObject({ kind: "numeric", numericValue: 0 });

    const sparse = structuredClone(boundary);
    sparse.featureRows.forEach((row, index) => { if (index < 16) row.features = row.features.filter((item) => item.name === "productFamily"); });
    const sparseResult = await evaluatePredictiveEligibility({ ...sparse, productFamilyCode: "SHAMPOO", targetDefinition });
    expect(sparseResult.outcome).toBe("INSUFFICIENT_DATA");
    expect(sparseResult.reasons.map(({ code }) => code)).toContain("FEATURE_MISSINGNESS_EXCEEDS_POLICY");

    const falseValues = await makePipeline();
    falseValues.bundles.forEach((bundle) => { bundle.targetRow!.targetObservations[0]!.value = { kind: "boolean", boolean: false }; });
    const falsePartition = await partitionDataset(falseValues.bundles, { ratios: { train: 0.6, validation: 0.2, test: 0.2 }, seed: 1729 });
    const falseEligibility = await evaluatePredictiveEligibility({ ...falseValues, partitionManifest: falsePartition, productFamilyCode: "SHAMPOO", targetDefinition });
    expect(falseEligibility.outcome).toBe("ELIGIBLE");
    expect(falseEligibility.targetObservationCount).toBe(60);
  });

  it("uses FVL-05 partitions for baseline comparison, accepts only held-out improvement, and round-trips immutable registry artifacts", async () => {
    const pipeline = await makePipeline();
    const training = await trainPredictiveModel({ ...pipeline, productFamilyCode: "SHAMPOO", targetDefinition, trainingTimestamp: "2026-10-20T12:00:00.000Z" });
    expect(training.outcome).toBe("ACCEPTED");
    if (training.outcome !== "ACCEPTED") return;
    const model = training.model;
    const repeatedTraining = await trainPredictiveModel({ ...pipeline, productFamilyCode: "SHAMPOO", targetDefinition, trainingTimestamp: "2026-10-20T12:00:00.000Z" });
    expect(repeatedTraining).toEqual(training);
    expect(model.datasetFingerprint).toEqual(pipeline.partitionManifest.dataset);
    expect(model.partitionConfig.seed).toBe(1729);
    expect(model.tuningPerformed).toBe(false);
    expect(model.hyperparameters.tuningPerformed).toBe(false);
    expect(model.acceptancePolicyVersion).toBe("1.0");
    expect(model.algorithm).toBe("univariate_linear_regression");
    expect(model.evaluation.validation.metric).toBe("mae");
    expect(model.evaluation.validation.value).toBeLessThan(model.evaluation.baselineValidation.value);
    expect(model.evaluation.test.value).toBeLessThan(model.evaluation.baselineTest.value);
    expect(model.featureProvenance[0]!.sourceRecords.length).toBeGreaterThan(0);
    const legacyPayload: Record<string, unknown> = { ...model, schemaVersion: "1.0" };
    delete legacyPayload.artifactChecksum;
    const legacyModel = predictiveModelArtifactSchema.parse({ ...legacyPayload, artifactChecksum: await sha256Hex(canonicalizeForFingerprint(legacyPayload)) });
    expect(legacyModel.schemaVersion).toBe("1.0");
    expect(legacyModel.retrainingLineage).toBeUndefined();
    const emptyRegistry = await createPredictiveModelRegistry();
    const registry = await registerPredictiveModel(emptyRegistry, model);
    const roundTrip = await parsePredictiveModelRegistry(await serializePredictiveModelRegistry(registry));
    expect(roundTrip).toEqual(registry);
    await expect(registerPredictiveModel(registry, model)).rejects.toThrow("append-only");
    const versionTwo = await trainPredictiveModel({ ...pipeline, productFamilyCode: "SHAMPOO", targetDefinition, trainingTimestamp: "2026-10-21T12:00:00.000Z", modelVersion: 2 });
    expect(versionTwo.outcome).toBe("ACCEPTED");
    const historicalPrediction = await predictPerformance({ model, featureRow: pipeline.featureRows[0]! });
    if (versionTwo.outcome === "ACCEPTED") {
      expect((await registerPredictiveModel(registry, versionTwo.model)).models.map(({ version }) => version)).toEqual([1, 2]);
      const newerPrediction = await predictPerformance({ model: versionTwo.model, featureRow: pipeline.featureRows[0]! });
      expect(historicalPrediction).toMatchObject({ modelId: model.id, modelVersion: 1, modelChecksum: model.artifactChecksum });
      expect(newerPrediction).toMatchObject({ modelId: versionTwo.model.id, modelVersion: 2, modelChecksum: versionTwo.model.artifactChecksum });
      expect(historicalPrediction.modelChecksum).not.toBe(newerPrediction.modelChecksum);
    }
    const tampered = { ...model, modelParameters: { ...model.modelParameters, ...(model.modelParameters.kind === "linear" ? { slope: model.modelParameters.slope + 1 } : {}) } };
    await expect(parsePredictiveModelRegistry(JSON.stringify({ schemaVersion: "1.0", models: [tampered] }))).rejects.toThrow("checksum-valid");
  });

  it("accepts retraining lineage only when measurements, formula versions, target and fingerprint match the exact training bundles", async () => {
    const pipeline = await makePipeline();
    pipeline.bundles.forEach((bundle, index) => {
      const measurementId = bundle.targetRow!.targetObservations[0]!.sourceRecords[0]!.sourceRecordId;
      const trialId = `TRIAL-${index + 1}`;
      bundle.testResultRow = formulaVersionTestResultRowSchema.parse({
        datasetSchemaVersion: DATASET_SCHEMA_VERSION,
        sourceRecords: [{ sourceEntity: "testResult", sourceRecordId: measurementId }],
        formulaId: bundle.compositionRow.formulaId,
        formulaCode: bundle.compositionRow.formulaCode,
        formulaVersionId: bundle.compositionRow.formulaVersionId,
        formulaVersionNumber: bundle.compositionRow.formulaVersionNumber,
        trials: [{ trialId, trialCode: trialId, testResults: [{
          schemaVersion: "1.0", id: measurementId, trialId, testDefinitionId: "VISCOSITY", resultType: "numeric", unit: "cP",
          replicates: [{ replicateNumber: 1, numericValue: String(index + 1) }], attachments: [], passFail: "not_evaluated",
          performedBy: "test", performedAt: "2026-10-21T12:00:00.000Z", createdAt: "2026-10-21T12:00:00.000Z", updatedAt: "2026-10-21T12:00:00.000Z",
        }] }],
      });
    });
    pipeline.partitionManifest = await partitionDataset(pipeline.bundles, { ratios: { train: 0.6, validation: 0.2, test: 0.2 }, seed: 1729 });
    const manifests = await Promise.all(pipeline.bundles.map(buildFormulaVersionBundleManifest));
    const fingerprint = (await buildDatasetManifest(manifests)).dataset;
    const targetKey = canonicalizeForFingerprint(targetDefinition);
    const lineageBase = {
      sourceType: "test_result" as const,
      studyId: "DOE-1", studyRevision: 1, designId: "DESIGN-1", triggeringRunId: "RUN-1", triggeringTrialId: "TRIAL-1",
      triggerMeasurementIds: ["TEST-SHAMPOO-001"],
      measurementRecordIds: pipeline.bundles.map((bundle) => bundle.testResultRow!.sourceRecords[0]!.sourceRecordId).sort(),
      formulaVersionIds: pipeline.bundles.map((bundle) => bundle.compositionRow.formulaVersionId).sort(), targetKey,
      datasetFingerprint: fingerprint,
      partitionConfig: { strategy: pipeline.partitionManifest.strategy, groupingStrategy: pipeline.partitionManifest.groupingStrategy, seed: pipeline.partitionManifest.seed, ratios: pipeline.partitionManifest.ratios },
    };
    const trainingRunId = `retraining-${await sha256Hex(canonicalizeForFingerprint({ productFamilyCode: "SHAMPOO", targetKey, datasetFingerprint: fingerprint.digest }))}`;
    const sourceMeasurementSnapshot = structuredClone(pipeline.bundles);
    const accepted = await trainPredictiveModel({ ...pipeline, productFamilyCode: "SHAMPOO", targetDefinition, trainingTimestamp: "2026-10-21T12:00:00.000Z", retrainingLineage: { ...lineageBase, trainingRunId } });
    expect(accepted.outcome).toBe("ACCEPTED");
    if (accepted.outcome !== "ACCEPTED") return;
    expect(pipeline.bundles).toEqual(sourceMeasurementSnapshot);
    expect(accepted.model.retrainingLineage).toMatchObject({ trainingRunId, datasetFingerprint: fingerprint, measurementRecordIds: lineageBase.measurementRecordIds });

    const priorModelSnapshot = structuredClone(accepted.model);
    pipeline.bundles[0]!.testResultRow!.trials[0]!.testResults[0]!.replicates[0]!.numericValue = "999";
    pipeline.partitionManifest = await partitionDataset(pipeline.bundles, { ratios: { train: 0.6, validation: 0.2, test: 0.2 }, seed: 1729 });
    const nextManifests = await Promise.all(pipeline.bundles.map(buildFormulaVersionBundleManifest));
    const nextFingerprint = (await buildDatasetManifest(nextManifests)).dataset;
    const nextTrainingRunId = `retraining-${await sha256Hex(canonicalizeForFingerprint({ productFamilyCode: "SHAMPOO", targetKey, datasetFingerprint: nextFingerprint.digest }))}`;
    const retrained = await trainPredictiveModel({ ...pipeline, productFamilyCode: "SHAMPOO", targetDefinition, trainingTimestamp: "2026-10-22T12:00:00.000Z", modelVersion: 2, retrainingLineage: {
      ...lineageBase,
      trainingRunId: nextTrainingRunId,
      measurementRecordIds: lineageBase.measurementRecordIds,
      formulaVersionIds: lineageBase.formulaVersionIds,
      datasetFingerprint: nextFingerprint,
      partitionConfig: { strategy: pipeline.partitionManifest.strategy, groupingStrategy: pipeline.partitionManifest.groupingStrategy, seed: pipeline.partitionManifest.seed, ratios: pipeline.partitionManifest.ratios },
      priorModel: { id: accepted.model.id, version: accepted.model.version, artifactChecksum: accepted.model.artifactChecksum },
    } });
    expect(retrained.outcome).toBe("ACCEPTED");
    if (retrained.outcome === "ACCEPTED") expect(retrained.model.retrainingLineage?.priorModel).toEqual({ id: accepted.model.id, version: accepted.model.version, artifactChecksum: accepted.model.artifactChecksum });
    expect(accepted.model).toEqual(priorModelSnapshot);

    const invalid = await trainPredictiveModel({ ...pipeline, productFamilyCode: "SHAMPOO", targetDefinition, trainingTimestamp: "2026-10-21T12:00:00.000Z", retrainingLineage: { ...lineageBase, trainingRunId, measurementRecordIds: ["STALE-RESULT"] } });
    expect(invalid.outcome).toBe("INVALID_DATA");
    if (invalid.outcome === "INVALID_DATA") expect(invalid.reason).toMatch(/exact source measurements/);
  });

  it("returns a non-accepted result when a candidate does not improve the required baseline", async () => {
    const pipeline = await makePipeline();
    pipeline.bundles.forEach((bundle) => { bundle.targetRow!.targetObservations[0]!.value = { kind: "numeric", raw: "25", normalized: false }; });
    const partitionManifest = await partitionDataset(pipeline.bundles, { ratios: { train: 0.6, validation: 0.2, test: 0.2 }, seed: 1729 });
    const result = await trainPredictiveModel({ ...pipeline, partitionManifest, productFamilyCode: "SHAMPOO", targetDefinition, trainingTimestamp: "2026-10-20T12:00:00.000Z" });
    expect(result.outcome).toBe("NOT_ACCEPTED");
    if (result.outcome === "NOT_ACCEPTED" && result.evaluation) {
      expect(result.evaluation.validation.value).toBe(result.evaluation.baselineValidation.value);
      expect(result.evaluation.test.value).toBe(result.evaluation.baselineTest.value);
      expect(result.model).toBeUndefined();
    }
  });

  it("compares categorical targets to a majority-class baseline and isolates family/target models", async () => {
    const shampoo = await makePipeline(60, "SHAMPOO");
    shampoo.bundles.forEach((bundle, index) => bundle.targetRow!.targetObservations.push({
      targetDefinition: { ...targetDefinition, testDefinitionId: "PERFORMANCE-GRADE" },
      value: { kind: "passFail", passFail: index < 30 ? "pass" : "fail" },
      isOutlier: false,
      sourceRecords: [{ sourceEntity: "testResult", sourceRecordId: `GRADE-${index + 1}` }],
    }));
    const laundry = await makePipeline(60, "LAUNDRY");
    const bundles = [...shampoo.bundles, ...laundry.bundles];
    const featureRows = [...generateModelFeatures(shampoo.bundles), ...generateModelFeatures(laundry.bundles)];
    const partitionManifest = await partitionDataset(bundles, { ratios: { train: 0.6, validation: 0.2, test: 0.2 }, seed: 20261020 });
    expect(await partitionDataset(bundles, { ratios: { train: 0.6, validation: 0.2, test: 0.2 }, seed: 20261020 })).toEqual(partitionManifest);
    const shampooNumeric = await trainPredictiveModel({ bundles, featureRows, partitionManifest, productFamilyCode: "SHAMPOO", targetDefinition, trainingTimestamp: "2026-10-20T12:00:00.000Z" });
    const shampooClass = await trainPredictiveModel({ bundles, featureRows, partitionManifest, productFamilyCode: "SHAMPOO", targetDefinition: { ...targetDefinition, testDefinitionId: "PERFORMANCE-GRADE" }, trainingTimestamp: "2026-10-20T12:00:00.000Z" });
    const laundryNumeric = await trainPredictiveModel({ bundles, featureRows, partitionManifest, productFamilyCode: "LAUNDRY", targetDefinition: { ...targetDefinition, productFamilyCode: "LAUNDRY" }, trainingTimestamp: "2026-10-20T12:00:00.000Z" });
    expect(shampooNumeric.outcome, JSON.stringify(shampooNumeric)).toBe("ACCEPTED");
    expect(shampooClass.outcome).toBe("ACCEPTED");
    expect(laundryNumeric.outcome).toBe("ACCEPTED");
    if (shampooClass.outcome === "ACCEPTED") {
      expect(shampooClass.model.targetKind).toBe("categorical");
      expect(shampooClass.model.evaluation.baselineValidation.metric).toBe("accuracy");
      expect(shampooClass.model.algorithm).toBe("nearest_centroid_classifier");
    }
    if (shampooNumeric.outcome === "ACCEPTED" && laundryNumeric.outcome === "ACCEPTED" && shampooClass.outcome === "ACCEPTED") {
      expect(new Set([shampooNumeric.model.id, shampooClass.model.id, laundryNumeric.model.id]).size).toBe(3);
      expect(laundryNumeric.model.productFamilyCode).toBe("LAUNDRY");
      expect(laundryNumeric.model.targetKey).not.toBe(shampooNumeric.model.targetKey);
      expect(shampooClass.model.targetKey).not.toBe(shampooNumeric.model.targetKey);
    }
  });

  it("serves exact formula/version lineage and refuses out-of-domain inputs without fabricating uncertainty", async () => {
    const pipeline = await makePipeline();
    const trained = await trainPredictiveModel({ ...pipeline, productFamilyCode: "SHAMPOO", targetDefinition, trainingTimestamp: "2026-10-20T12:00:00.000Z" });
    expect(trained.outcome).toBe("ACCEPTED");
    if (trained.outcome !== "ACCEPTED") return;
    const modelSnapshot = structuredClone(trained.model);
    const sourceBundleSnapshot = structuredClone(pipeline.bundles);
    const featureRowSnapshot = structuredClone(pipeline.featureRows);
    const featureName = trained.model.applicabilityDomain.featureName;
    const inDomainRow = pipeline.featureRows.find((row) => {
      const value = row.features.find((item) => item.name === featureName)?.numericValue;
      return value !== undefined && value >= trained.model.applicabilityDomain.minNumeric! && value <= trained.model.applicabilityDomain.maxNumeric!;
    })!;
    const inDomain = await predictPerformance({ model: trained.model, featureRow: inDomainRow });
    expect(inDomain).toMatchObject({
      status: "PREDICTED", formulaId: inDomainRow.formulaId, formulaVersionId: inDomainRow.formulaVersionId, advisoryOnly: true,
      modelId: trained.model.id, modelVersion: trained.model.version, modelChecksum: trained.model.artifactChecksum,
      modelArtifactSchemaVersion: trained.model.schemaVersion, datasetFingerprint: trained.model.datasetFingerprint,
      datasetSchemaVersion: trained.model.datasetSchemaVersion, featureSchemaVersion: trained.model.featureSchemaVersion,
      modelFeatureSchemaVersion: trained.model.modelFeatureSchemaVersion, featureContractVersion: trained.model.featureContractVersion,
      trainingContractVersion: trained.model.trainingContractVersion, acceptancePolicyVersion: trained.model.acceptancePolicyVersion,
      applicabilityDomainSnapshot: trained.model.applicabilityDomain, applicabilityDomain: { inDomain: true },
    });
    expect(inDomain.uncertainty).toBeUndefined();
    for (const boundary of [trained.model.applicabilityDomain.minNumeric!, trained.model.applicabilityDomain.maxNumeric!]) {
      const row = pipeline.featureRows.find((candidate) => candidate.features.find((item) => item.name === featureName)?.numericValue === boundary)!;
      expect((await predictPerformance({ model: trained.model, featureRow: row })).status).toBe("PREDICTED");
    }
    const laundryFeature = (await makePipeline(3, "LAUNDRY")).featureRows[0]!;
    await expect(predictPerformance({ model: trained.model, featureRow: laundryFeature })).rejects.toThrow("product family");
    const { artifactChecksum: _checksum, ...unacceptedBase } = trained.model;
    const unacceptedPayload = { ...unacceptedBase, evaluation: { ...unacceptedBase.evaluation, acceptance: "NOT_ACCEPTED" as const } };
    const unaccepted = { ...unacceptedPayload, artifactChecksum: await sha256Hex(canonicalizeForFingerprint(unacceptedPayload)) };
    const notAccepted = await predictPerformance({ model: unaccepted, featureRow: inDomainRow });
    expect(notAccepted.status).toBe("MODEL_NOT_ACCEPTED");
    expect(notAccepted).not.toHaveProperty("predictedNumericValue");
    const highVersion = version("SHAMPOO-999", "999");
    const highComposition = extractFormulaVersionDatasetRows({ formulationVersions: [highVersion], formulations: [formulation(highVersion.formulationId)], materials: [material()], formulationVersionIds: [highVersion.id] })[0]!;
    const highFeature = generateModelFeatures([{ compositionRow: highComposition, targetRow: targetRow("SHAMPOO-999", 1999) }])[0]!;
    const ood = await predictPerformance({ model: trained.model, featureRow: highFeature });
    expect(ood).toMatchObject({ status: "OUT_OF_DOMAIN", applicabilityDomain: { inDomain: false, reasonCode: "NUMERIC_RANGE_EXCEEDED" } });
    expect(ood).not.toHaveProperty("predictedNumericValue");
    expect(trained.model).toEqual(modelSnapshot);
    expect(pipeline.bundles).toEqual(sourceBundleSnapshot);
    expect(pipeline.featureRows).toEqual(featureRowSnapshot);
  });

  it("keeps Safety and Regulatory FAIL authoritative even when prediction is present", () => {
    const prediction = { status: "PREDICTED", modelId: "M1", modelVersion: 1, modelChecksum: "a".repeat(64), modelArtifactSchemaVersion: "1.0", datasetFingerprint: { algorithm: "sha256", canonicalization: "formulab-canonical-json-v1", digest: "a".repeat(64) }, datasetSchemaVersion: "1.0", featureSchemaVersion: "1.0", modelFeatureSchemaVersion: "1.0", featureContractVersion: "1.0", trainingContractVersion: "1.0", acceptancePolicyVersion: "1.0", productFamilyCode: "SHAMPOO", formulaId: "F1", formulaVersionId: "V1", formulaVersionNumber: 1, targetDefinition, predictedNumericValue: 999, applicabilityDomainSnapshot: { version: "1.0", featureName: "x", categories: [] as string[] }, applicabilityDomain: { policyVersion: "1.0", inDomain: true, reasonCode: "IN_DOMAIN", message: "within range" }, advisoryOnly: true } as const;
    expect(predictionDecisionGate({ prediction, safetyVerdict: "FAIL", regulatoryVerdict: "PASS" })).toMatchObject({ eligibleForConsideration: false, safetyVerdict: "FAIL", reasonCodes: ["SAFETY_FAIL"] });
    expect(predictionDecisionGate({ prediction, safetyVerdict: "PASS", regulatoryVerdict: "FAIL" })).toMatchObject({ eligibleForConsideration: false, regulatoryVerdict: "FAIL", reasonCodes: ["REGULATORY_FAIL"] });
    expect(predictionDecisionGate({ prediction: { ...prediction, status: "OUT_OF_DOMAIN" }, safetyVerdict: "PASS", regulatoryVerdict: "PASS" }).eligibleForConsideration).toBe(false);
    expect(predictionDecisionGate({ prediction, safetyVerdict: "UNKNOWN", regulatoryVerdict: "PASS" })).toMatchObject({ eligibleForConsideration: false, reasonCodes: ["SAFETY_NOT_PASS"] });
    expect(predictionDecisionGate({ prediction: { ...prediction, status: "OUT_OF_DOMAIN" }, safetyVerdict: "FAIL", regulatoryVerdict: "FAIL" })).toMatchObject({ safetyVerdict: "FAIL", regulatoryVerdict: "FAIL", eligibleForConsideration: false });
    expect(Object.keys(prediction)).not.toContain("approval");
  });
});
