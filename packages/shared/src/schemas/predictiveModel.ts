import { z } from "zod";
import { DATASET_SCHEMA_VERSION, FEATURE_SCHEMA_VERSION, sourceRecordLineageSchema, targetDefinitionSchema } from "./dataset";
import { digestSchema } from "./datasetManifest";

export const MODEL_FEATURE_SCHEMA_VERSION = "1.0" as const;
export const MODEL_FEATURE_CONTRACT_VERSION = "1.0" as const;
export const PREDICTIVE_MODEL_SCHEMA_VERSION = "1.0" as const;
export const TRAINING_CONTRACT_VERSION = "1.0" as const;
export const ACCEPTANCE_POLICY_VERSION = "1.0" as const;
export const ELIGIBILITY_POLICY_VERSION = "1.0" as const;
export const APPLICABILITY_POLICY_VERSION = "1.0" as const;

export const modelFeatureSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["numeric", "categorical"]),
  numericValue: z.number().finite().optional(),
  categoricalValue: z.string().optional(),
  unit: z.string().optional(),
  sourceRecords: sourceRecordLineageSchema,
}).superRefine((feature, ctx) => {
  if (feature.kind === "numeric" && (feature.numericValue === undefined || feature.categoricalValue !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Numeric features require only numericValue." });
  }
  if (feature.kind === "categorical" && (feature.categoricalValue === undefined || feature.numericValue !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Categorical features require only categoricalValue." });
  }
});
export type ModelFeature = z.infer<typeof modelFeatureSchema>;

export const modelFeatureRowSchema = z.object({
  modelFeatureSchemaVersion: z.literal(MODEL_FEATURE_SCHEMA_VERSION),
  datasetSchemaVersion: z.literal(DATASET_SCHEMA_VERSION),
  featureSchemaVersion: z.literal(FEATURE_SCHEMA_VERSION),
  featureContractVersion: z.string().min(1),
  formulaId: z.string().min(1),
  formulaVersionId: z.string().min(1),
  formulaVersionNumber: z.number().int().positive(),
  productFamilyCode: z.string().min(1),
  features: z.array(modelFeatureSchema),
}).superRefine((row, ctx) => {
  const seen = new Set<string>();
  row.features.forEach((feature, index) => {
    if (seen.has(feature.name)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["features", index, "name"], message: `Duplicate feature name "${feature.name}".` });
    seen.add(feature.name);
  });
});
export type ModelFeatureRow = z.infer<typeof modelFeatureRowSchema>;

export const interactionDefinitionSchema = z.object({
  id: z.string().min(1),
  leftFeature: z.string().min(1),
  rightFeature: z.string().min(1),
});
export type InteractionDefinition = z.infer<typeof interactionDefinitionSchema>;

export const interactionConfigSchema = z.object({
  version: z.string().min(1),
  interactions: z.array(interactionDefinitionSchema),
}).superRefine((config, ctx) => {
  const seen = new Set<string>();
  config.interactions.forEach((interaction, index) => {
    if (seen.has(interaction.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["interactions", index, "id"], message: `Duplicate interaction id "${interaction.id}".` });
    seen.add(interaction.id);
  });
});
export type InteractionConfig = z.infer<typeof interactionConfigSchema>;

export const modelFeatureRowWithInteractionsSchema = modelFeatureRowSchema.extend({ interactionConfig: interactionConfigSchema.optional() });
export type ModelFeatureRowWithInteractions = z.infer<typeof modelFeatureRowWithInteractionsSchema>;

export const eligibilityPolicySchema = z.object({
  version: z.literal(ELIGIBILITY_POLICY_VERSION),
  minDatasetRows: z.number().int().positive(),
  minTargetObservations: z.number().int().positive(),
  minIndependentGroups: z.number().int().min(3),
  minTrainRows: z.number().int().positive(),
  maxTargetMissingRatio: z.number().min(0).max(1),
  maxFeatureMissingRatio: z.number().min(0).max(1),
});
export type EligibilityPolicy = z.infer<typeof eligibilityPolicySchema>;

/** 50 dataset rows leave a 60/20/20 FVL-05 split with room for 18 labeled
 * train versions after the declared 25% missing-target ceiling; 30 target
 * observations and 20 independent lineage groups prevent replicate-heavy
 * records from satisfying the gate alone. */
export const DEFAULT_ELIGIBILITY_POLICY: EligibilityPolicy = {
  version: ELIGIBILITY_POLICY_VERSION,
  minDatasetRows: 50,
  minTargetObservations: 30,
  minIndependentGroups: 20,
  minTrainRows: 18,
  maxTargetMissingRatio: 0.25,
  maxFeatureMissingRatio: 0.25,
};

export const eligibilityReasonSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const eligibilityResultSchema = z.object({
  outcome: z.enum(["ELIGIBLE", "INSUFFICIENT_DATA", "INVALID_DATA"]),
  productFamilyCode: z.string().min(1),
  targetKey: z.string().min(1),
  datasetFingerprint: digestSchema,
  observedRowCount: z.number().int().nonnegative(),
  usableRowCount: z.number().int().nonnegative(),
  targetObservationCount: z.number().int().nonnegative(),
  independentGroupCount: z.number().int().nonnegative(),
  missingTargetRatio: z.number().min(0).max(1),
  missingFeatureRatio: z.number().min(0).max(1),
  required: eligibilityPolicySchema,
  reasons: z.array(eligibilityReasonSchema),
});
export type EligibilityResult = z.infer<typeof eligibilityResultSchema>;

export const evaluationMetricsSchema = z.object({
  metric: z.enum(["mae", "accuracy"]),
  value: z.number().finite(),
  sampleCount: z.number().int().positive(),
});
export type EvaluationMetrics = z.infer<typeof evaluationMetricsSchema>;

export const predictiveAlgorithmSchema = z.enum([
  "mean_baseline",
  "majority_class_baseline",
  "univariate_linear_regression",
  "nearest_centroid_classifier",
  "categorical_lookup_classifier",
]);
export type PredictiveAlgorithm = z.infer<typeof predictiveAlgorithmSchema>;

export const predictiveModelArtifactSchema = z.object({
  schemaVersion: z.literal(PREDICTIVE_MODEL_SCHEMA_VERSION),
  id: z.string().min(1),
  version: z.number().int().positive(),
  productFamilyCode: z.string().min(1),
  targetDefinition: targetDefinitionSchema,
  targetKey: z.string().min(1),
  targetKind: z.enum(["numeric", "categorical"]),
  targetUnit: z.string().optional(),
  datasetFingerprint: digestSchema,
  datasetSchemaVersion: z.string().min(1),
  featureSchemaVersion: z.literal(FEATURE_SCHEMA_VERSION),
  modelFeatureSchemaVersion: z.literal(MODEL_FEATURE_SCHEMA_VERSION),
  featureContractVersion: z.string().min(1),
  trainingContractVersion: z.literal(TRAINING_CONTRACT_VERSION),
  acceptancePolicyVersion: z.literal(ACCEPTANCE_POLICY_VERSION),
  trainingTimestamp: z.string().datetime({ offset: true }),
  algorithm: predictiveAlgorithmSchema,
  algorithmVersion: z.string().min(1),
  hyperparameters: z.record(z.string(), z.unknown()),
  tuningPerformed: z.boolean(),
  partitionConfig: z.object({ strategy: z.string().min(1), groupingStrategy: z.string().min(1), seed: z.number().int().safe(), ratios: z.object({ train: z.number(), validation: z.number(), test: z.number() }) }),
  evaluation: z.object({
    validation: evaluationMetricsSchema,
    test: evaluationMetricsSchema,
    baselineValidation: evaluationMetricsSchema,
    baselineTest: evaluationMetricsSchema,
    acceptance: z.enum(["ACCEPTED", "NOT_ACCEPTED"]),
    requiredRelativeImprovement: z.number().min(0).max(1),
  }),
  trainingCounts: z.object({ train: z.number().int().positive(), validation: z.number().int().positive(), test: z.number().int().positive() }),
  applicabilityDomain: z.object({ version: z.literal(APPLICABILITY_POLICY_VERSION), featureName: z.string().min(1), unit: z.string().optional(), minNumeric: z.number().finite().optional(), maxNumeric: z.number().finite().optional(), categories: z.array(z.string()) }),
  modelParameters: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("linear"), featureName: z.string().min(1), intercept: z.number().finite(), slope: z.number().finite() }),
    z.object({ kind: z.literal("numeric_centroids"), featureName: z.string().min(1), centroids: z.record(z.string(), z.number().finite()) }),
    z.object({ kind: z.literal("categorical_lookup"), featureName: z.string().min(1), categoryPredictions: z.record(z.string(), z.string()), fallback: z.string().min(1) }),
  ]),
  interactionConfig: interactionConfigSchema.optional(),
  featureProvenance: z.array(z.object({ name: z.string().min(1), sourceRecords: sourceRecordLineageSchema })),
  artifactChecksum: z.string().regex(/^[0-9a-f]{64}$/),
}).superRefine((model, ctx) => {
  if (model.tuningPerformed && model.hyperparameters.tuningTrials === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["hyperparameters", "tuningTrials"], message: "Tuned models must record evaluated tuning trials." });
  }
});
export type PredictiveModelArtifact = z.infer<typeof predictiveModelArtifactSchema>;

export const predictiveModelRegistrySchema = z.object({
  schemaVersion: z.literal("1.0"),
  models: z.array(predictiveModelArtifactSchema),
});
export type PredictiveModelRegistry = z.infer<typeof predictiveModelRegistrySchema>;

export const predictionResultSchema = z.object({
  status: z.enum(["PREDICTED", "OUT_OF_DOMAIN", "MODEL_NOT_ACCEPTED"]),
  modelId: z.string().min(1),
  modelVersion: z.number().int().positive(),
  datasetFingerprint: digestSchema,
  productFamilyCode: z.string().min(1),
  formulaId: z.string().min(1),
  formulaVersionId: z.string().min(1),
  formulaVersionNumber: z.number().int().positive(),
  targetDefinition: targetDefinitionSchema,
  targetUnit: z.string().optional(),
  predictedNumericValue: z.number().finite().optional(),
  predictedCategory: z.string().optional(),
  uncertainty: z.undefined().optional(),
  applicabilityDomain: z.object({ policyVersion: z.literal(APPLICABILITY_POLICY_VERSION), inDomain: z.boolean(), reasonCode: z.string().min(1), message: z.string().min(1) }),
  advisoryOnly: z.literal(true),
});
export type PredictionResult = z.infer<typeof predictionResultSchema>;
