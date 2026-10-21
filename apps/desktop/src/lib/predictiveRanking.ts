import {
  canonicalizeForFingerprint,
  extractFormulaVersionDatasetRows,
  generateModelFeatures,
  predictPerformance,
  type Formulation,
  type FormulationVersion,
  type PredictiveModelArtifact,
  type PredictionResult,
  type RawMaterial,
} from "@formulab/shared";

export type RankingPredictionFailureStatus = "UNAVAILABLE_MODEL" | "MODEL_NOT_ACCEPTED" | "OUT_OF_DOMAIN" | "ENGINE_ERROR" | "INVALID_CONTRACT";

export type RankingPredictionResolution =
  | { status: "PREDICTED"; prediction: PredictionResult }
  | { status: RankingPredictionFailureStatus; reason: string; prediction?: PredictionResult };

export function unavailableRankingModelStatus(input: {
  rejectedModels: PredictiveModelArtifact[];
  productFamilyCode: string;
}): "MODEL_NOT_ACCEPTED" | "UNAVAILABLE_MODEL" {
  return input.rejectedModels.some((model) => model.productFamilyCode === input.productFamilyCode)
    ? "MODEL_NOT_ACCEPTED"
    : "UNAVAILABLE_MODEL";
}

/** Resolve only an exact family/target scope. A family with multiple targets
 *  stays unavailable until the caller supplies an explicit target key; the
 *  current generated-formula brief does not identify a laboratory test. */
export function resolveRankingModel(input: {
  models: PredictiveModelArtifact[];
  productFamilyCode: string;
  targetKey?: string;
}): PredictiveModelArtifact | undefined {
  const scoped = input.models.filter((model) =>
    model.productFamilyCode === input.productFamilyCode
    && (input.targetKey === undefined || model.targetKey === input.targetKey),
  );
  const targetKeys = new Set(scoped.map((model) => model.targetKey));
  if (targetKeys.size !== 1 || scoped.length === 0) return undefined;
  return [...scoped].sort((a, b) => b.version - a.version || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

/** Uses the exact saved FVL-05 FormulaVersion and its real material records to
 *  construct the canonical FVL-07 feature row, then calls its predictor. */
export async function predictSavedRankingAlternative(input: {
  model: PredictiveModelArtifact;
  formulation: Formulation;
  version: FormulationVersion;
  materials: RawMaterial[];
}): Promise<RankingPredictionResolution> {
  try {
    const [compositionRow] = extractFormulaVersionDatasetRows({
      formulationVersionIds: [input.version.id],
      formulationVersions: [input.version],
      formulations: [input.formulation],
      materials: input.materials,
    });
    if (!compositionRow || compositionRow.formulaVersionId !== input.version.id) {
      return { status: "INVALID_CONTRACT", reason: "The exact saved FormulaVersion did not resolve to one FVL-05 composition row." };
    }
    const [featureRow] = generateModelFeatures([{ compositionRow }], {
      featureContractVersion: input.model.featureContractVersion,
      interactionConfig: input.model.interactionConfig,
    });
    if (!featureRow || featureRow.formulaVersionId !== input.version.id || featureRow.formulaId !== input.formulation.id) {
      return { status: "INVALID_CONTRACT", reason: "The FVL-07 feature row lost its saved formula/version lineage." };
    }
    const prediction = await predictPerformance({ model: input.model, featureRow });
    if (prediction.formulaId !== input.formulation.id || prediction.formulaVersionId !== input.version.id
      || canonicalizeForFingerprint(prediction.targetDefinition) !== canonicalizeForFingerprint(input.model.targetDefinition)) {
      return { status: "INVALID_CONTRACT", reason: "The FVL-07 prediction does not match the exact formula, version, and target." };
    }
    return prediction.status === "PREDICTED"
      ? { status: "PREDICTED", prediction }
      : { status: prediction.status, reason: prediction.applicabilityDomain.message, prediction };
  } catch (error) {
    return { status: "INVALID_CONTRACT", reason: error instanceof Error ? error.message : String(error) };
  }
}
