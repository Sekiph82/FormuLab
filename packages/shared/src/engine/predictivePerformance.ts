import Decimal from "decimal.js";
import { z } from "zod";
import type { FormulaVersionBundleInput } from "./datasetManifestBuilder";
import { buildDatasetManifest, buildFormulaVersionBundleManifest, canonicalizeForFingerprint, sha256Hex } from "./datasetManifestBuilder";
import {
  APPLICABILITY_POLICY_VERSION,
  DEFAULT_ELIGIBILITY_POLICY,
  MODEL_FEATURE_SCHEMA_VERSION,
  MODEL_FEATURE_CONTRACT_VERSION,
  PREDICTIVE_MODEL_SCHEMA_VERSION,
  TRAINING_CONTRACT_VERSION,
  eligibilityPolicySchema,
  eligibilityResultSchema,
  interactionConfigSchema,
  modelFeatureRowWithInteractionsSchema,
  predictiveModelArtifactSchema,
  predictiveModelRegistrySchema,
  predictionResultSchema,
  type EligibilityPolicy,
  type EligibilityResult,
  type EvaluationMetrics,
  type InteractionConfig,
  type ModelFeature,
  type ModelFeatureRowWithInteractions,
  type PredictiveModelArtifact,
  type PredictiveModelRegistry,
  type PredictionResult,
} from "../schemas/predictiveModel";
import { FEATURE_SCHEMA_VERSION, targetDefinitionSchema, type TargetDefinition, type TargetObservation, type SourceRecordReference } from "../schemas/dataset";
import { datasetPartitionManifestSchema, type DatasetPartitionManifest, type PartitionName } from "../schemas/datasetPartition";
import { digestSchema, type Digest } from "../schemas/datasetManifest";

export interface ModelFeatureExtractionOptions {
  interactionConfig?: InteractionConfig;
  featureContractVersion?: string;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUniqueLineage(refs: SourceRecordReference[]): SourceRecordReference[] {
  const byKey = new Map<string, SourceRecordReference>();
  for (const ref of refs) byKey.set(canonicalizeForFingerprint(ref), ref);
  return [...byKey.entries()].sort(([a], [b]) => compareOrdinal(a, b)).map(([, ref]) => ref);
}

function numberValue(raw: string): number | undefined {
  const parsed = new Decimal(raw);
  const value = parsed.toNumber();
  return Number.isFinite(value) ? value : undefined;
}

function numericFeature(name: string, raw: string | number, sourceRecords: SourceRecordReference[], unit?: string): ModelFeature | undefined {
  const value = typeof raw === "number" ? raw : numberValue(raw);
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return { name, kind: "numeric", numericValue: value, ...(unit ? { unit } : {}), sourceRecords: sortedUniqueLineage(sourceRecords) };
}

function categoricalFeature(name: string, value: string, sourceRecords: SourceRecordReference[]): ModelFeature {
  return { name, kind: "categorical", categoricalValue: value, sourceRecords: sortedUniqueLineage(sourceRecords) };
}

const MATERIAL_PROPERTIES = [
  ["activeMatterPercent", "%"], ["solidsPercent", "%"], ["waterPercent", "%"], ["density", "kg/L"],
  ["hlb", undefined], ["phMin", undefined], ["phMax", undefined], ["recommendedMinPercent", "%"],
  ["recommendedMaxPercent", "%"], ["technicalMaxPercent", "%"], ["shelfLifeMonths", "month"],
] as const;

function aggregateWeightedMaterialProperty(bundle: FormulaVersionBundleInput, key: (typeof MATERIAL_PROPERTIES)[number][0]): string | undefined {
  if (bundle.compositionRow.composition.length === 0) return undefined;
  const materials = new Map(bundle.compositionRow.materials.map((material) => [material.code, material]));
  let numerator = new Decimal(0);
  let denominator = new Decimal(0);
  for (const line of bundle.compositionRow.composition) {
    const weight = new Decimal(line.percent);
    if (weight.isZero()) continue;
    if (!line.materialCode) return undefined;
    const material = materials.get(line.materialCode);
    const value = material?.[key];
    if (value === undefined) return undefined;
    numerator = numerator.plus(weight.times(value));
    denominator = denominator.plus(weight);
  }
  if (denominator.isZero()) return "0";
  return numerator.dividedBy(denominator).toString();
}

function addProcessFeatures(bundle: FormulaVersionBundleInput, features: ModelFeature[]): void {
  const row = bundle.processRow;
  if (!row) return;
  const refs = row.sourceRecords;
  for (const step of row.plannedProcedure) {
    const prefix = `process.plan.step.${step.stepNumber}`;
    const candidates = [
      ["temperatureTargetC", step.temperatureTarget, "°C"],
      ["mixingSpeedTargetRpm", step.mixingSpeedTarget, "rpm"],
      ["mixingTimeMinutes", step.mixingTimeMinutes, "min"],
      ["holdTimeMinutes", step.holdTimeMinutes, "min"],
    ] as const;
    for (const [name, value, unit] of candidates) {
      if (value === undefined) continue;
      const feature = numericFeature(`${prefix}.${name}`, value, refs, unit);
      if (feature) features.push(feature);
    }
    if (step.phase !== undefined) features.push(categoricalFeature(`${prefix}.phase`, step.phase, refs));
    if (step.equipmentType !== undefined) features.push(categoricalFeature(`${prefix}.equipmentType`, step.equipmentType, refs));
  }
  const stepById = new Map(row.trials.flatMap((trial) => trial.plannedSteps.map((step) => [step.processStepId, step.stepNumber] as const)));
  for (const trial of row.trials) {
    const trialRef = { sourceEntity: "laboratoryTrial", sourceRecordId: trial.trialId };
    for (const actual of trial.actualStepObservations) {
      const stepNumber = stepById.get(actual.processStepId) ?? actual.stepNumber;
      const prefix = `process.actual.step.${stepNumber}`;
      const actualFields = [
        ["temperatureC", actual.actualTemperatureC, "°C"],
        ["mixingSpeedRpm", actual.actualMixingSpeedRpm, "rpm"],
        ["durationMinutes", actual.actualDurationMinutes, "min"],
      ] as const;
      for (const [name, value, unit] of actualFields) {
        if (value === undefined) continue;
        const feature = numericFeature(`${prefix}.${name}`, value, [...refs, trialRef], unit);
        if (feature) features.push(feature);
      }
    }
  }
}

function addDoeContextFeatures(bundle: FormulaVersionBundleInput, features: ModelFeature[]): void {
  for (const study of bundle.doeRow?.studies ?? []) {
    for (const designEntry of study.designs) {
      const factorUnits = new Map(designEntry.design.factorSnapshot.map((factor) => [factor.factorCode, factor.unit]));
      for (const runEntry of designEntry.runs) {
        for (const setting of runEntry.run.factorSettings) {
          const unit = factorUnits.get(setting.factorCode);
          const name = `testContext.doeFactor.${setting.factorCode}${unit ? `.${unit}` : ""}`;
          const feature = numericFeature(name, setting.actualValue, [
            { sourceEntity: "doeStudy", sourceRecordId: study.studyId },
            { sourceEntity: "doeDesign", sourceRecordId: designEntry.design.id },
            { sourceEntity: "doeRun", sourceRecordId: runEntry.run.id },
          ], unit);
          if (feature) features.push(feature);
        }
      }
    }
  }
}

function addInteractions(features: ModelFeature[], config: InteractionConfig | undefined): ModelFeature[] {
  if (!config) return features;
  const byName = new Map(features.map((feature) => [feature.name, feature]));
  const added: ModelFeature[] = [];
  const definitions = [...config.interactions].sort((a, b) => compareOrdinal(a.id, b.id));
  for (const item of definitions) {
    const operands = [item.leftFeature, item.rightFeature].sort(compareOrdinal);
    const left = byName.get(operands[0]!);
    const right = byName.get(operands[1]!);
    if (!left || !right || left.kind !== "numeric" || right.kind !== "numeric") continue;
    const feature = numericFeature(`interaction.${config.version}.${item.id}`, left.numericValue! * right.numericValue!, [...left.sourceRecords, ...right.sourceRecords]);
    if (feature) added.push(feature);
  }
  return [...features, ...added].sort((a, b) => compareOrdinal(a.name, b.name));
}

function normalizeInteractionConfig(config: InteractionConfig | undefined): InteractionConfig | undefined {
  if (!config) return undefined;
  return {
    version: config.version,
    interactions: [...config.interactions].map((item) => {
      const [leftFeature, rightFeature] = [item.leftFeature, item.rightFeature].sort(compareOrdinal);
      return { id: item.id, leftFeature: leftFeature!, rightFeature: rightFeature! };
    }).sort((a, b) => compareOrdinal(a.id, b.id)),
  };
}

/** Builds predictor-only features from the exact FVL-05 bundle snapshots; target rows are never read. */
export function generateModelFeatures(
  bundles: FormulaVersionBundleInput[],
  options: ModelFeatureExtractionOptions = {},
): ModelFeatureRowWithInteractions[] {
  const interactionConfig = options.interactionConfig ? interactionConfigSchema.parse(options.interactionConfig) : undefined;
  const normalizedInteractions = normalizeInteractionConfig(interactionConfig);
  const rawRows = bundles.map((bundle) => {
    const composition = bundle.compositionRow;
    const features: ModelFeature[] = [categoricalFeature("productFamily", composition.productFamilyCode, composition.sourceRecords)];
    const properties = new Map(MATERIAL_PROPERTIES.map(([key, unit]) => [key, unit]));
    const materials = new Map(composition.materials.map((material) => [material.code, material]));
    const compositionTotals = new Map<string, Decimal>();
    for (const line of composition.composition) {
      if (!line.materialCode) continue;
      const current = compositionTotals.get(line.materialCode) ?? new Decimal(0);
      compositionTotals.set(line.materialCode, current.plus(line.percent));
    }
    for (const [code, total] of [...compositionTotals.entries()].sort(([a], [b]) => compareOrdinal(a, b))) {
      features.push(numericFeature(`composition.material.${code}.percent`, total.toString(), composition.sourceRecords, "%")!);
      const material = materials.get(code);
      if (!material) continue;
      for (const [key, unit] of properties) {
        const value = material[key];
        if (value === undefined) continue;
        const feature = numericFeature(`material.${code}.${key}`, value, composition.sourceRecords, unit);
        if (feature) features.push(feature);
      }
      if (material.physicalForm) features.push(categoricalFeature(`material.${code}.physicalForm`, material.physicalForm, composition.sourceRecords));
      if (material.ionicCharacter) features.push(categoricalFeature(`material.${code}.ionicCharacter`, material.ionicCharacter, composition.sourceRecords));
      for (const fn of [...material.functions].sort(compareOrdinal)) features.push(numericFeature(`material.${code}.function.${fn}`, 1, composition.sourceRecords)!);
    }
    // Preserve phase semantics for an ingredient used in more than one phase.
    const phaseTotals = new Map<string, Decimal>();
    for (const line of composition.composition) {
      if (!line.materialCode) continue;
      const key = `${line.materialCode}\u0000${line.phase}`;
      phaseTotals.set(key, (phaseTotals.get(key) ?? new Decimal(0)).plus(line.percent));
    }
    for (const [key, total] of [...phaseTotals.entries()].sort(([a], [b]) => compareOrdinal(a, b))) {
      const [code, phase] = key.split("\u0000");
      features.push(numericFeature(`composition.material.${code}.phase.${phase}.percent`, total.toString(), composition.sourceRecords, "%")!);
    }
    for (const [key, unit] of properties) {
      const aggregate = aggregateWeightedMaterialProperty(bundle, key);
      if (aggregate !== undefined) {
        const feature = numericFeature(`material.weighted.${key}`, aggregate, composition.sourceRecords, unit);
        if (feature) features.push(feature);
      }
    }
    addProcessFeatures(bundle, features);
    addDoeContextFeatures(bundle, features);
    const finalFeatures = addInteractions(features, normalizedInteractions).sort((a, b) => compareOrdinal(a.name, b.name));
    return modelFeatureRowWithInteractionsSchema.parse({
      modelFeatureSchemaVersion: MODEL_FEATURE_SCHEMA_VERSION,
      datasetSchemaVersion: composition.datasetSchemaVersion,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      featureContractVersion: options.featureContractVersion ?? MODEL_FEATURE_CONTRACT_VERSION,
      ...(normalizedInteractions ? { interactionConfig: normalizedInteractions } : {}),
      formulaId: composition.formulaId,
      formulaVersionId: composition.formulaVersionId,
      formulaVersionNumber: composition.formulaVersionNumber,
      productFamilyCode: composition.productFamilyCode,
      features: finalFeatures,
    });
  });
  return rawRows.sort((a, b) => compareOrdinal(a.formulaVersionId, b.formulaVersionId));
}

export interface EligibilityInput {
  bundles: FormulaVersionBundleInput[];
  featureRows: ModelFeatureRowWithInteractions[];
  partitionManifest: DatasetPartitionManifest;
  productFamilyCode: string;
  targetDefinition: TargetDefinition;
  policy?: EligibilityPolicy;
}

interface TrainingSample {
  formulaId: string;
  formulaVersionId: string;
  groupId: string;
  partition: PartitionName;
  features: Map<string, ModelFeature>;
  observation: TargetObservation;
}

function targetKeyFor(targetDefinition: TargetDefinition): string {
  return canonicalizeForFingerprint(targetDefinition);
}

function samplesFor(
  input: EligibilityInput,
  familyBundles: FormulaVersionBundleInput[],
): { samples: TrainingSample[]; featureNames: string[]; missingTargetRatio: number; missingFeatureRatio: number } {
  const targetKey = targetKeyFor(input.targetDefinition);
    const featureByVersion = new Map(input.featureRows.map((row) => [row.formulaVersionId, row]));
  const partitionByVersion = new Map(input.partitionManifest.entries.map((entry) => [entry.formulaVersionId, entry]));
  const samples: TrainingSample[] = [];
  let rowsWithTarget = 0;
  for (const bundle of familyBundles) {
    const versionId = bundle.compositionRow.formulaVersionId;
    const feature = featureByVersion.get(versionId);
    const assignment = partitionByVersion.get(versionId);
    if (!feature || !assignment) continue;
    const group = input.partitionManifest.groups.find((item) => item.groupId === assignment.groupId);
    if (!group) continue;
    const observations = (bundle.targetRow?.targetObservations ?? []).filter((obs) => targetKeyFor(obs.targetDefinition) === targetKey);
    if (observations.length > 0) rowsWithTarget += 1;
    for (const observation of observations) {
      samples.push({
        formulaId: bundle.compositionRow.formulaId,
        formulaVersionId: versionId,
        groupId: assignment.groupId,
        partition: assignment.partition,
        features: new Map(feature.features.map((item) => [item.name, item])),
        observation,
      });
    }
  }
  const featureNames = [...new Set(samples.flatMap((sample) => [...sample.features.keys()].filter((name) => name !== "productFamily")))].sort(compareOrdinal);
  const missingRatios = featureNames.map((name) => samples.length === 0 ? 1 : samples.filter((sample) => !sample.features.has(name)).length / samples.length);
  const allFamilyRows = familyBundles.length;
  const missingTargetRatio = allFamilyRows === 0 ? 1 : (allFamilyRows - rowsWithTarget) / allFamilyRows;
  // Candidate features are evaluated independently. Report the least-missing
  // usable predictor; rows with a missing value for a selected feature are
  // excluded explicitly by training, never imputed.
  const missingFeatureRatio = missingRatios.length === 0 ? 1 : Math.min(...missingRatios);
  return { samples, featureNames, missingTargetRatio, missingFeatureRatio };
}

function makeEligibilityResult(input: EligibilityInput): EligibilityResult {
  const policy = eligibilityPolicySchema.parse(input.policy ?? DEFAULT_ELIGIBILITY_POLICY);
  const target = targetDefinitionSchema.parse(input.targetDefinition);
  const partition = datasetPartitionManifestSchema.parse(input.partitionManifest);
  const familyBundles = input.bundles.filter((bundle) => bundle.compositionRow.productFamilyCode === input.productFamilyCode);
  const { samples, featureNames, missingTargetRatio, missingFeatureRatio } = samplesFor(input, familyBundles);
  const usableVersions = new Set(samples.filter((sample) => sample.features.size > 1).map((sample) => sample.formulaVersionId));
  const independentGroups = new Set(samples.map((sample) => sample.groupId));
  const reasons: EligibilityResult["reasons"] = [];
  if (familyBundles.length < policy.minDatasetRows) reasons.push({ code: "DATASET_ROWS_BELOW_MINIMUM", message: `Observed ${familyBundles.length} dataset row(s); at least ${policy.minDatasetRows} are required.` });
  if (samples.length < policy.minTargetObservations) reasons.push({ code: "TARGET_OBSERVATIONS_BELOW_MINIMUM", message: `Observed ${samples.length} matching target observation(s); at least ${policy.minTargetObservations} are required.` });
  if (independentGroups.size < policy.minIndependentGroups) reasons.push({ code: "INDEPENDENT_GROUPS_BELOW_MINIMUM", message: `Observed ${independentGroups.size} independent partition group(s); at least ${policy.minIndependentGroups} are required.` });
  const trainRows = new Set(samples.filter((sample) => sample.partition === "train").map((sample) => sample.formulaVersionId)).size;
  if (trainRows < policy.minTrainRows) reasons.push({ code: "TRAIN_ROWS_BELOW_MINIMUM", message: `Observed ${trainRows} train row(s); at least ${policy.minTrainRows} are required.` });
  if (missingTargetRatio > policy.maxTargetMissingRatio) reasons.push({ code: "TARGET_MISSINGNESS_EXCEEDS_POLICY", message: `Target missingness ${(missingTargetRatio * 100).toFixed(1)}% exceeds the ${policy.maxTargetMissingRatio * 100}% policy limit.` });
  if (missingFeatureRatio > policy.maxFeatureMissingRatio) reasons.push({ code: "FEATURE_MISSINGNESS_EXCEEDS_POLICY", message: `Predictor missingness ${(missingFeatureRatio * 100).toFixed(1)}% exceeds the ${policy.maxFeatureMissingRatio * 100}% policy limit.` });
  if (featureNames.length === 0) reasons.push({ code: "NO_PREDICTOR_FEATURES", message: "No non-target predictor feature is available for this family and target." });
  const result = {
    outcome: reasons.length === 0 ? "ELIGIBLE" as const : "INSUFFICIENT_DATA" as const,
    productFamilyCode: input.productFamilyCode,
    targetKey: targetKeyFor(target),
    datasetFingerprint: partition.dataset,
    observedRowCount: familyBundles.length,
    usableRowCount: usableVersions.size,
    targetObservationCount: samples.length,
    independentGroupCount: independentGroups.size,
    missingTargetRatio,
    missingFeatureRatio,
    required: policy,
    reasons,
  };
  return eligibilityResultSchema.parse(result);
}

/** Deterministic per-family/per-target gate. Counts independent partition groups, not replicates as independent experiments. */
export async function evaluatePredictiveEligibility(input: EligibilityInput): Promise<EligibilityResult> {
  try {
    const target = targetDefinitionSchema.parse(input.targetDefinition);
    if (target.productFamilyCode !== input.productFamilyCode) throw new Error("Target product family must exactly match the requested model family.");
    const partition = datasetPartitionManifestSchema.parse(input.partitionManifest);
    const policy = eligibilityPolicySchema.parse(input.policy ?? DEFAULT_ELIGIBILITY_POLICY);
    const bundleManifests = await Promise.all(input.bundles.map(buildFormulaVersionBundleManifest));
    const dataset = await buildDatasetManifest(bundleManifests);
    for (const bundle of input.bundles) {
      const family = bundle.compositionRow.productFamilyCode;
      if (bundle.targetRow && (bundle.targetRow.productFamilyCode !== family || bundle.targetRow.targetObservations.some((observation) => observation.targetDefinition.productFamilyCode !== family))) {
        throw new Error(`Target row product family contradicts the exact composition family for formula version "${bundle.compositionRow.formulaVersionId}".`);
      }
    }
    if (canonicalizeForFingerprint(dataset.dataset) !== canonicalizeForFingerprint(partition.dataset)) throw new Error("FVL-05 partition fingerprint does not match the exact supplied dataset bundles.");
    if (partition.entries.length !== dataset.entries.length) throw new Error("FVL-05 partition entries do not cover the exact dataset membership.");
    const partitionEntries = new Map<string, DatasetPartitionManifest["entries"][number]>();
    for (const entry of partition.entries) {
      if (partitionEntries.has(entry.formulaVersionId)) throw new Error(`FVL-05 partition contains duplicate formula version "${entry.formulaVersionId}".`);
      partitionEntries.set(entry.formulaVersionId, entry);
    }
    for (const entry of dataset.entries) {
      const assignment = partitionEntries.get(entry.formulaVersionId);
      if (!assignment || canonicalizeForFingerprint(assignment.bundle) !== canonicalizeForFingerprint(entry.bundle)) throw new Error(`FVL-05 partition does not cite the exact bundle for formula version "${entry.formulaVersionId}".`);
    }
    const currentFeatureRows = input.featureRows.filter((row) => row.productFamilyCode === input.productFamilyCode);
    const featuresByVersion = new Map<string, ModelFeatureRowWithInteractions>();
    for (const feature of currentFeatureRows) {
      const parsed = modelFeatureRowWithInteractionsSchema.parse(feature);
      if (parsed.featureSchemaVersion !== partition.featureSchemaVersion || parsed.datasetSchemaVersion !== partition.datasetSchemaVersion) throw new Error(`Feature row "${feature.formulaVersionId}" schema versions do not match the FVL-05 partition manifest.`);
      if (featuresByVersion.has(parsed.formulaVersionId)) throw new Error(`Duplicate model feature row for formula version "${parsed.formulaVersionId}".`);
      featuresByVersion.set(parsed.formulaVersionId, parsed);
    }
    const familyBundles = input.bundles.filter((bundle) => bundle.compositionRow.productFamilyCode === input.productFamilyCode);
    for (const bundle of familyBundles) {
      const composition = bundle.compositionRow;
      const feature = featuresByVersion.get(composition.formulaVersionId);
      if (!feature || feature.formulaId !== composition.formulaId || feature.formulaVersionNumber !== composition.formulaVersionNumber) throw new Error(`Model feature row is missing or conflicts with composition identity for formula version "${composition.formulaVersionId}".`);
    }
    return makeEligibilityResult({ ...input, targetDefinition: target, policy });
  } catch (error) {
    const targetKey = (() => { try { return targetKeyFor(input.targetDefinition); } catch { return "invalid-target"; } })();
    const fallbackDigest = { algorithm: "sha256" as const, canonicalization: "formulab-canonical-json-v1" as const, digest: "0".repeat(64) };
    const digestCandidate = digestSchema.safeParse(input.partitionManifest?.dataset);
    const parsedDigest = digestCandidate.success ? digestCandidate.data : fallbackDigest;
    const result = {
      outcome: "INVALID_DATA" as const,
      productFamilyCode: input.productFamilyCode || "unknown",
      targetKey,
      datasetFingerprint: parsedDigest ?? fallbackDigest,
      observedRowCount: 0,
      usableRowCount: 0,
      targetObservationCount: 0,
      independentGroupCount: 0,
      missingTargetRatio: 1,
      missingFeatureRatio: 1,
      required: (() => { const parsed = eligibilityPolicySchema.safeParse(input.policy ?? DEFAULT_ELIGIBILITY_POLICY); return parsed.success ? parsed.data : DEFAULT_ELIGIBILITY_POLICY; })(),
      reasons: [{ code: "INVALID_DATA_OR_CONTRACT", message: error instanceof Error ? error.message : String(error) }],
    };
    return eligibilityResultSchema.parse(result);
  }
}

export type PredictiveTrainingResult =
  | { outcome: "INSUFFICIENT_DATA"; eligibility: EligibilityResult; model?: undefined }
  | { outcome: "INVALID_DATA"; eligibility: EligibilityResult; model?: undefined; reason: string }
  | { outcome: "NOT_ACCEPTED"; eligibility: EligibilityResult; evaluation?: { validation: EvaluationMetrics; baselineValidation: EvaluationMetrics; test: EvaluationMetrics; baselineTest: EvaluationMetrics }; reason: string; model?: undefined }
  | { outcome: "ACCEPTED"; eligibility: EligibilityResult; model: PredictiveModelArtifact };

export interface PredictiveTrainingInput extends EligibilityInput {
  trainingTimestamp: string;
  featureContractVersion?: string;
  interactionConfig?: InteractionConfig;
  requiredRelativeImprovement?: number;
  modelVersion?: number;
}

interface ScoredSample { sample: TrainingSample; x: number | string; y: number | string }

function targetValue(observation: TargetObservation): { kind: "numeric" | "categorical"; value: number | string; unit?: string } | undefined {
  switch (observation.value.kind) {
    case "numeric": {
      const value = Number(observation.value.canonicalValue ?? observation.value.raw);
      if (!Number.isFinite(value)) return undefined;
      return { kind: "numeric", value, ...(observation.value.canonicalUnit ?? observation.value.rawUnit ? { unit: observation.value.canonicalUnit ?? observation.value.rawUnit } : {}) };
    }
    case "categorical": return { kind: "categorical", value: observation.value.categorical };
    case "text": return { kind: "categorical", value: observation.value.text };
    case "boolean": return { kind: "categorical", value: String(observation.value.boolean) };
    case "passFail": return { kind: "categorical", value: observation.value.passFail };
  }
}

function metricFor(values: Array<{ actual: number | string; predicted: number | string }>, numeric: boolean): EvaluationMetrics {
  if (values.length === 0) throw new Error("Evaluation partition is empty for the selected predictor feature.");
  if (numeric) {
    const mae = values.reduce((sum, item) => sum + Math.abs(Number(item.actual) - Number(item.predicted)), 0) / values.length;
    return { metric: "mae", value: mae, sampleCount: values.length };
  }
  const correct = values.filter((item) => item.actual === item.predicted).length;
  return { metric: "accuracy", value: correct / values.length, sampleCount: values.length };
}

function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function majority(values: string[]): string {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || compareOrdinal(a[0], b[0]))[0]![0];
}

function relativeImprovement(baseline: number, candidate: number, metric: "mae" | "accuracy"): number {
  if (metric === "mae") return baseline === 0 ? (candidate < 0 ? 1 : 0) : (baseline - candidate) / Math.abs(baseline);
  return baseline === 1 ? (candidate > baseline ? 1 : 0) : (candidate - baseline) / Math.max(1 - baseline, Number.EPSILON);
}

function trainOneFeature(samples: ScoredSample[], numericTarget: boolean) {
  const train = samples.filter(({ sample }) => sample.partition === "train");
  const validation = samples.filter(({ sample }) => sample.partition === "validation");
  const test = samples.filter(({ sample }) => sample.partition === "test");
  if (train.length < 2 || validation.length < 1 || test.length < 1) return undefined;
  if (numericTarget) {
    if (train.some(({ x, y }) => typeof x !== "number" || typeof y !== "number")) return undefined;
    const xs = train.map(({ x }) => x as number);
    const ys = train.map(({ y }) => y as number);
    const xMean = mean(xs), yMean = mean(ys);
    const variance = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
    if (variance <= Number.EPSILON) return undefined;
    const slope = xs.reduce((sum, x, index) => sum + (x - xMean) * (ys[index]! - yMean), 0) / variance;
    const intercept = yMean - slope * xMean;
    const baselineValue = yMean;
    const predicted = (rows: ScoredSample[], fn: (x: number) => number) => rows.map(({ x, y }) => ({ actual: y, predicted: fn(x as number) }));
    return {
      algorithm: "univariate_linear_regression" as const,
      modelParameters: { kind: "linear" as const, featureName: train[0]!.sample.features.get("__selected")?.name ?? "" , intercept, slope },
      validation: metricFor(predicted(validation, (x) => intercept + slope * x), true),
      test: metricFor(predicted(test, (x) => intercept + slope * x), true),
      baselineValidation: metricFor(predicted(validation, () => baselineValue), true),
      baselineTest: metricFor(predicted(test, () => baselineValue), true),
      trainCount: train.length, validationCount: validation.length, testCount: test.length,
      domain: { minNumeric: Math.min(...xs), maxNumeric: Math.max(...xs), categories: [] as string[] },
    };
  }
  if (train.some(({ x, y }) => typeof y !== "string")) return undefined;
  const labels = train.map(({ y }) => y as string);
  const fallback = majority(labels);
  const numericFeature = train.every(({ x }) => typeof x === "number");
  const categories = [...new Set(train.map(({ x }) => String(x)))].sort(compareOrdinal);
  const baselinePredict = (rows: ScoredSample[]) => rows.map(({ y }) => ({ actual: y, predicted: fallback }));
  if (numericFeature) {
    const centroids = new Map<string, number[]>();
    train.forEach(({ x, y }) => centroids.set(y as string, [...(centroids.get(y as string) ?? []), x as number]));
    const centers = Object.fromEntries([...centroids.entries()].map(([label, values]) => [label, mean(values)]));
    const predict = (x: number) => Object.entries(centers).sort((a, b) => Math.abs(x - a[1]) - Math.abs(x - b[1]) || compareOrdinal(a[0], b[0]))[0]![0];
    return {
      algorithm: "nearest_centroid_classifier" as const,
      modelParameters: { kind: "numeric_centroids" as const, featureName: "", centroids: centers },
      validation: metricFor(validation.map(({ x, y }) => ({ actual: y, predicted: predict(x as number) })), false),
      test: metricFor(test.map(({ x, y }) => ({ actual: y, predicted: predict(x as number) })), false),
      baselineValidation: metricFor(baselinePredict(validation), false),
      baselineTest: metricFor(baselinePredict(test), false),
      trainCount: train.length, validationCount: validation.length, testCount: test.length,
      domain: { minNumeric: Math.min(...train.map(({ x }) => x as number)), maxNumeric: Math.max(...train.map(({ x }) => x as number)), categories },
    };
  }
  const categoryPredictions: Record<string, string> = {};
  for (const category of categories) categoryPredictions[category] = majority(train.filter(({ x }) => String(x) === category).map(({ y }) => y as string));
  const predict = (x: string) => categoryPredictions[x] ?? fallback;
  return {
    algorithm: "categorical_lookup_classifier" as const,
    modelParameters: { kind: "categorical_lookup" as const, featureName: "", categoryPredictions, fallback },
    validation: metricFor(validation.map(({ x, y }) => ({ actual: y, predicted: predict(String(x)) })), false),
    test: metricFor(test.map(({ x, y }) => ({ actual: y, predicted: predict(String(x)) })), false),
    baselineValidation: metricFor(baselinePredict(validation), false),
    baselineTest: metricFor(baselinePredict(test), false),
    trainCount: train.length, validationCount: validation.length, testCount: test.length,
    domain: { categories, minNumeric: undefined, maxNumeric: undefined },
  };
}

function selectSamples(input: PredictiveTrainingInput, familyBundles: FormulaVersionBundleInput[]): { samples: TrainingSample[]; featureNames: string[]; missingTargetRatio: number; missingFeatureRatio: number } {
  const base = samplesFor(input, familyBundles);
  return base;
}

export async function trainPredictiveModel(input: PredictiveTrainingInput): Promise<PredictiveTrainingResult> {
  const eligibility = await evaluatePredictiveEligibility(input);
  if (eligibility.outcome === "INVALID_DATA") return { outcome: "INVALID_DATA", eligibility, reason: eligibility.reasons[0]?.message ?? "Invalid dataset contract." };
  if (eligibility.outcome !== "ELIGIBLE") return { outcome: "INSUFFICIENT_DATA", eligibility };
  if (!Number.isSafeInteger(input.modelVersion ?? 1) || (input.modelVersion ?? 1) < 1) return { outcome: "INVALID_DATA", eligibility, reason: "modelVersion must be a positive safe integer." };
  const familyBundles = input.bundles.filter((bundle) => bundle.compositionRow.productFamilyCode === input.productFamilyCode);
  const expectedFeatureContract = input.featureContractVersion ?? MODEL_FEATURE_CONTRACT_VERSION;
  const expectedInteractions = normalizeInteractionConfig(input.interactionConfig);
  for (const row of input.featureRows.filter((item) => item.productFamilyCode === input.productFamilyCode)) {
    if (row.featureContractVersion !== expectedFeatureContract || canonicalizeForFingerprint(row.interactionConfig) !== canonicalizeForFingerprint(expectedInteractions)) {
      return { outcome: "INVALID_DATA", eligibility, reason: `Feature row "${row.formulaVersionId}" does not match the declared feature/interaction contract.` };
    }
  }
  const { samples, featureNames } = selectSamples(input, familyBundles);
  if (samples.some((sample) => sample.observation.value.kind === "numeric" && targetValue(sample.observation) === undefined)) return { outcome: "INVALID_DATA", eligibility, reason: "A numeric target cannot be represented as a finite model value." };
  if (samples.length === 0) return { outcome: "INSUFFICIENT_DATA", eligibility };
  const policy = eligibilityPolicySchema.parse(input.policy ?? DEFAULT_ELIGIBILITY_POLICY);
  const acceptableFeatures = featureNames.filter((featureName) => {
    const missingRatio = samples.length === 0 ? 1 : samples.filter((sample) => !sample.features.has(featureName)).length / samples.length;
    return missingRatio <= policy.maxFeatureMissingRatio;
  });
  const scored = samples.flatMap((sample) => {
    const y = targetValue(sample.observation);
    if (!y) return [];
    return acceptableFeatures.flatMap((name) => {
      const feature = sample.features.get(name);
      if (!feature) return [];
      const x = feature.kind === "numeric" ? feature.numericValue! : feature.categoricalValue!;
      return [{ sample: { ...sample, features: new Map([...sample.features, ["__selected", feature]]) }, x, y: y.value, targetUnit: y.unit }];
    });
  });
  const targetKinds = new Set(scored.map((item) => typeof item.y === "number" ? "numeric" : "categorical"));
  const targetUnits = new Set(scored.map((item) => item.targetUnit ?? ""));
  if (targetKinds.size !== 1 || targetUnits.size > 1) {
    return { outcome: "INVALID_DATA", eligibility: { ...eligibility, outcome: "INVALID_DATA", reasons: [{ code: "INCONSISTENT_TARGET_TYPE_OR_UNIT", message: "Target observations mix incompatible value kinds or numeric units." }] }, reason: "Target observations mix incompatible value kinds or numeric units." };
  }
  const numericTarget = targetKinds.has("numeric");
  const candidates = acceptableFeatures.flatMap((featureName) => {
    const candidateRows = scored.filter((item) => item.sample.features.get("__selected")?.name === featureName);
    const result = trainOneFeature(candidateRows, numericTarget);
    if (!result) return [];
    result.modelParameters.featureName = featureName;
    return [{ featureName, result }];
  });
  if (candidates.length === 0) return { outcome: "NOT_ACCEPTED", eligibility, reason: "No predictor feature has sufficient train, validation and test observations." };
  const metricName = numericTarget ? "mae" : "accuracy";
  candidates.sort((a, b) => {
    const left = a.result.validation.value, right = b.result.validation.value;
    return (numericTarget ? left - right : right - left) || compareOrdinal(a.featureName, b.featureName);
  });
  const selected = candidates[0]!;
  const validationGain = relativeImprovement(selected.result.baselineValidation.value, selected.result.validation.value, metricName);
  const testGain = relativeImprovement(selected.result.baselineTest.value, selected.result.test.value, metricName);
  const requiredRelativeImprovement = input.requiredRelativeImprovement ?? 0.05;
  if (!Number.isFinite(requiredRelativeImprovement) || requiredRelativeImprovement < 0 || requiredRelativeImprovement > 1) return { outcome: "INVALID_DATA", eligibility, reason: "requiredRelativeImprovement must be between 0 and 1." };
  const parsedTimestamp = z.string().datetime({ offset: true }).safeParse(input.trainingTimestamp);
  if (!parsedTimestamp.success) return { outcome: "INVALID_DATA", eligibility, reason: "trainingTimestamp must be an ISO 8601 timestamp with an explicit UTC offset." };
  if (validationGain < requiredRelativeImprovement || testGain < requiredRelativeImprovement) {
    return { outcome: "NOT_ACCEPTED", eligibility, evaluation: { validation: selected.result.validation, baselineValidation: selected.result.baselineValidation, test: selected.result.test, baselineTest: selected.result.baselineTest }, reason: `Candidate improvement did not meet the ${requiredRelativeImprovement} acceptance threshold on both validation and held-out test data.` };
  }
  const definition = targetDefinitionSchema.parse(input.targetDefinition);
  const targetKey = targetKeyFor(definition);
  const bundleManifests = await Promise.all(input.bundles.map(buildFormulaVersionBundleManifest));
  const datasetManifest = await buildDatasetManifest(bundleManifests);
  if (canonicalizeForFingerprint(datasetManifest.dataset) !== canonicalizeForFingerprint(input.partitionManifest.dataset)) return { outcome: "INVALID_DATA", eligibility, reason: "FVL-05 partition fingerprint does not match the exact training bundle set." };
  const selectedSamples = scored.filter((item) => item.sample.features.get("__selected")?.name === selected.featureName);
  const versionMap = new Map(input.featureRows.map((row) => [row.formulaVersionId, row]));
  const refsByFeature = new Map<string, SourceRecordReference[]>();
  selectedSamples.forEach(({ sample }) => {
    const feature = versionMap.get(sample.formulaVersionId)?.features.find((entry) => entry.name === selected.featureName);
    if (feature) refsByFeature.set(feature.name, [...(refsByFeature.get(feature.name) ?? []), ...feature.sourceRecords]);
  });
  const featureProvenance = [...refsByFeature.entries()].map(([name, refs]) => ({ name, sourceRecords: sortedUniqueLineage(refs) }));
  const algorithm = selected.result.algorithm;
  const trainingAt = new Date(parsedTimestamp.data).toISOString();
  const partition = input.partitionManifest;
  const idMaterial = canonicalizeForFingerprint({
    dataset: eligibility.datasetFingerprint, targetKey, productFamilyCode: input.productFamilyCode, algorithm,
    featureName: selected.featureName, trainingAt, modelVersion: input.modelVersion ?? 1,
    partition: { strategy: partition.strategy, groupingStrategy: partition.groupingStrategy, seed: partition.seed, ratios: partition.ratios },
    featureContractVersion: expectedFeatureContract, interactionConfig: expectedInteractions,
  });
  const id = `model-${(await sha256Hex(idMaterial)).slice(0, 24)}`;
  const artifactBase = {
    schemaVersion: PREDICTIVE_MODEL_SCHEMA_VERSION,
    id,
    version: input.modelVersion ?? 1,
    productFamilyCode: input.productFamilyCode,
    targetDefinition: definition,
    targetKey,
    targetKind: numericTarget ? "numeric" as const : "categorical" as const,
    ...(targetUnits.values().next().value ? { targetUnit: targetUnits.values().next().value } : {}),
    datasetFingerprint: eligibility.datasetFingerprint,
    datasetSchemaVersion: partition.datasetSchemaVersion,
    featureSchemaVersion: partition.featureSchemaVersion,
    modelFeatureSchemaVersion: MODEL_FEATURE_SCHEMA_VERSION,
    featureContractVersion: expectedFeatureContract,
    trainingContractVersion: TRAINING_CONTRACT_VERSION,
    trainingTimestamp: trainingAt,
    algorithm,
    algorithmVersion: "1.0",
    hyperparameters: { tuningPerformed: false, ...selected.result.modelParameters },
    tuningPerformed: false,
    partitionConfig: { strategy: partition.strategy, groupingStrategy: partition.groupingStrategy, seed: partition.seed, ratios: partition.ratios },
    evaluation: { validation: selected.result.validation, test: selected.result.test, baselineValidation: selected.result.baselineValidation, baselineTest: selected.result.baselineTest, acceptance: "ACCEPTED" as const, requiredRelativeImprovement },
    trainingCounts: { train: selected.result.trainCount, validation: selected.result.validationCount, test: selected.result.testCount },
    applicabilityDomain: { version: APPLICABILITY_POLICY_VERSION, featureName: selected.featureName, unit: selectedSamples[0]?.sample.features.get(selected.featureName)?.unit, ...selected.result.domain },
    ...(expectedInteractions ? { interactionConfig: expectedInteractions } : {}),
    modelParameters: selected.result.modelParameters,
    featureProvenance,
  };
  const artifactChecksum = await sha256Hex(canonicalizeForFingerprint(artifactBase));
  const model = predictiveModelArtifactSchema.parse({ ...artifactBase, artifactChecksum });
  return { outcome: "ACCEPTED", eligibility, model };
}

function artifactPayload(model: PredictiveModelArtifact): Record<string, unknown> {
  const { artifactChecksum: _checksum, ...payload } = model;
  return payload;
}

export async function verifyPredictiveModelChecksum(model: PredictiveModelArtifact): Promise<boolean> {
  return (await sha256Hex(canonicalizeForFingerprint(artifactPayload(model)))) === model.artifactChecksum;
}

export async function createPredictiveModelRegistry(models: PredictiveModelArtifact[] = []): Promise<PredictiveModelRegistry> {
  for (const model of models) {
    if (model.evaluation.acceptance !== "ACCEPTED" || !(await verifyPredictiveModelChecksum(model))) throw new Error(`Model "${model.id}" is not an accepted, checksum-valid immutable artifact.`);
  }
  const keys = new Set<string>();
  const ids = new Set<string>();
  const versionsByScope = new Map<string, number[]>();
  for (const model of models) {
    const key = `${model.productFamilyCode}\u0000${model.targetKey}\u0000${model.version}`;
    if (keys.has(key)) throw new Error(`Duplicate predictive model identity "${key}".`);
    if (ids.has(model.id)) throw new Error(`Duplicate predictive model artifact id "${model.id}".`);
    keys.add(key);
    ids.add(model.id);
    const scope = `${model.productFamilyCode}\u0000${model.targetKey}`;
    versionsByScope.set(scope, [...(versionsByScope.get(scope) ?? []), model.version]);
  }
  for (const [scope, versions] of versionsByScope) {
    versions.sort((a, b) => a - b);
    if (versions.some((version, index) => version !== index + 1)) throw new Error(`Predictive model versions for "${scope}" must be contiguous starting at 1.`);
  }
  return predictiveModelRegistrySchema.parse({ schemaVersion: "1.0", models: [...models] });
}

/** Append-only registration: an existing artifact ID/version can never be replaced. */
export async function registerPredictiveModel(registry: PredictiveModelRegistry, model: PredictiveModelArtifact): Promise<PredictiveModelRegistry> {
  const current = await createPredictiveModelRegistry(registry.models);
  if (model.evaluation.acceptance !== "ACCEPTED" || !(await verifyPredictiveModelChecksum(model))) throw new Error(`Model "${model.id}" is not an accepted, checksum-valid artifact.`);
  const sameTarget = current.models.filter((item) => item.productFamilyCode === model.productFamilyCode && item.targetKey === model.targetKey);
  const nextVersion = Math.max(0, ...sameTarget.map((item) => item.version)) + 1;
  if (current.models.some((item) => item.id === model.id) || model.version !== nextVersion) {
    throw new Error(`Predictive model registry is append-only; next version for "${model.productFamilyCode}/${model.targetKey}" is ${nextVersion}.`);
  }
  return predictiveModelRegistrySchema.parse({ ...current, models: [...current.models, model] });
}

export async function serializePredictiveModelRegistry(registry: PredictiveModelRegistry): Promise<string> {
  const checked = await createPredictiveModelRegistry(registry.models);
  return JSON.stringify(checked, null, 2);
}

export async function parsePredictiveModelRegistry(serialized: string): Promise<PredictiveModelRegistry> {
  return createPredictiveModelRegistry(predictiveModelRegistrySchema.parse(JSON.parse(serialized)).models);
}

export interface PredictionInput {
  model: PredictiveModelArtifact;
  featureRow: ModelFeatureRowWithInteractions;
}

export async function predictPerformance(input: PredictionInput): Promise<PredictionResult> {
  const model = predictiveModelArtifactSchema.parse(input.model);
  const featureRow = modelFeatureRowWithInteractionsSchema.parse(input.featureRow);
  if (!(await verifyPredictiveModelChecksum(model))) throw new Error(`Model "${model.id}" checksum verification failed.`);
  if (featureRow.productFamilyCode !== model.productFamilyCode) throw new Error("Prediction product family does not match the model's exact family scope.");
  if (featureRow.datasetSchemaVersion !== model.datasetSchemaVersion || featureRow.featureSchemaVersion !== model.featureSchemaVersion || featureRow.modelFeatureSchemaVersion !== model.modelFeatureSchemaVersion || featureRow.featureContractVersion !== model.featureContractVersion || canonicalizeForFingerprint(featureRow.interactionConfig) !== canonicalizeForFingerprint(model.interactionConfig)) throw new Error("Prediction feature schema/interaction contract does not match the registered model contract.");
  const feature = featureRow.features.find((item) => item.name === model.applicabilityDomain.featureName);
  if (feature && feature.unit !== model.applicabilityDomain.unit) throw new Error(`Prediction feature unit does not match registered unit for "${feature.name}".`);
  const targetUnit = model.targetUnit;
  let inDomain = feature !== undefined;
  let reasonCode = "IN_DOMAIN";
  let message = "Predictor is within the model's observed training range.";
  if (!feature) {
    inDomain = false; reasonCode = "FEATURE_MISSING"; message = `Required model feature "${model.applicabilityDomain.featureName}" is missing.`;
  } else if (feature.kind === "numeric") {
    const { minNumeric, maxNumeric } = model.applicabilityDomain;
    if (minNumeric === undefined || maxNumeric === undefined || feature.numericValue! < minNumeric || feature.numericValue! > maxNumeric) {
      inDomain = false; reasonCode = "NUMERIC_RANGE_EXCEEDED"; message = `Feature "${feature.name}" is outside the training range.`;
    }
  } else if (!model.applicabilityDomain.categories.includes(feature.categoricalValue!)) {
    inDomain = false; reasonCode = "UNSEEN_CATEGORY"; message = `Category for feature "${feature.name}" was not observed during training.`;
  }
  let predictedNumericValue: number | undefined;
  let predictedCategory: string | undefined;
  if (inDomain && model.evaluation.acceptance === "ACCEPTED") {
    if (model.modelParameters.kind === "linear") predictedNumericValue = model.modelParameters.intercept + model.modelParameters.slope * feature!.numericValue!;
    else if (model.modelParameters.kind === "numeric_centroids") {
      const x = feature!.numericValue!;
      predictedCategory = Object.entries(model.modelParameters.centroids).sort((a, b) => Math.abs(x - a[1]) - Math.abs(x - b[1]) || compareOrdinal(a[0], b[0]))[0]![0];
    } else predictedCategory = model.modelParameters.categoryPredictions[feature!.categoricalValue!] ?? model.modelParameters.fallback;
  }
  if (inDomain && model.evaluation.acceptance !== "ACCEPTED") {
    reasonCode = "MODEL_NOT_ACCEPTED";
    message = "This model did not meet the declared acceptance policy.";
  }
  const result = {
    status: !inDomain ? "OUT_OF_DOMAIN" as const : model.evaluation.acceptance !== "ACCEPTED" ? "MODEL_NOT_ACCEPTED" as const : "PREDICTED" as const,
    modelId: model.id,
    modelVersion: model.version,
    datasetFingerprint: model.datasetFingerprint,
    productFamilyCode: featureRow.productFamilyCode,
    formulaId: featureRow.formulaId,
    formulaVersionId: featureRow.formulaVersionId,
    formulaVersionNumber: featureRow.formulaVersionNumber,
    targetDefinition: model.targetDefinition,
    ...(targetUnit ? { targetUnit } : {}),
    ...(predictedNumericValue !== undefined ? { predictedNumericValue } : {}),
    ...(predictedCategory !== undefined ? { predictedCategory } : {}),
    applicabilityDomain: { policyVersion: APPLICABILITY_POLICY_VERSION, inDomain, reasonCode, message },
    advisoryOnly: true as const,
  };
  return predictionResultSchema.parse(result);
}

/** Safety and Regulatory verdicts stay owned by FVL-03; this helper only gates use of an advisory prediction. */
export function predictionDecisionGate(input: { prediction: PredictionResult; safetyVerdict: "PASS" | "FAIL" | "UNKNOWN"; regulatoryVerdict: "PASS" | "FAIL" | "UNKNOWN" }): { eligibleForConsideration: boolean; safetyVerdict: "PASS" | "FAIL" | "UNKNOWN"; regulatoryVerdict: "PASS" | "FAIL" | "UNKNOWN"; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  if (input.safetyVerdict === "FAIL") reasonCodes.push("SAFETY_FAIL");
  if (input.regulatoryVerdict === "FAIL") reasonCodes.push("REGULATORY_FAIL");
  if (input.prediction.status !== "PREDICTED") reasonCodes.push("PREDICTION_NOT_VALIDATED");
  return { eligibleForConsideration: reasonCodes.length === 0, safetyVerdict: input.safetyVerdict, regulatoryVerdict: input.regulatoryVerdict, reasonCodes };
}
