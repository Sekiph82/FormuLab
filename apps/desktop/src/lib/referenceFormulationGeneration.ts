import {
  calculateReferenceFormulationCooccurrence,
  calculateReferenceFormulationContributionDistributions,
  calculateReferenceFormulationDosageDistributions,
  calculateReferenceFormulationIngredientFrequencyPriors,
  calculateReferenceFormulationProcessPatterns,
  createReferenceFormulationGenerationContext,
  referenceFormulationNearestReferencesSchema,
  referenceFormulationReviewSchema,
  REFERENCE_FORMULATION_NEAREST_REFERENCES_VERSION,
  REFERENCE_FORMULATION_SIMILARITY_FEATURES_VERSION,
  type ReferenceFormulationGenerationContext,
} from "@formulab/shared";
import { listRecords } from "./masterdata";
import { rebuildReferenceFormulationCorpusIndex } from "./referenceFormulationNormalizations";
import { listReferenceFormulations } from "./referenceFormulations";

function familyKey(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

/** Build local reference guidance only from the existing reviewed corpus and its exact source identities. */
export async function loadReferenceFormulationGenerationContext(productFamilyCode: string): Promise<ReferenceFormulationGenerationContext> {
  const productFamilyKey = familyKey(productFamilyCode);
  if (!productFamilyKey) throw new Error("A product-family code is required for reference guidance.");
  const [{ queryRecords }, sourceRecords, reviewRows] = await Promise.all([
    rebuildReferenceFormulationCorpusIndex(),
    listReferenceFormulations(),
    listRecords("reference_formulation_reviews"),
  ]);
  const reviews = reviewRows.map((row) => referenceFormulationReviewSchema.parse(row));
  const evidenceTimestamps = [
    ...sourceRecords.map((source) => source.createdAt),
    ...reviews.map((review) => review.reviewedAt),
  ].filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value))).sort();
  const asOf = evidenceTimestamps[evidenceTimestamps.length - 1] ?? "1970-01-01T00:00:00.000Z";
  const metricsInput = { queryRecords, sourceRecords, reviews, asOf };
  const ingredientPriors = calculateReferenceFormulationIngredientFrequencyPriors(metricsInput);
  const dosageDistributions = calculateReferenceFormulationDosageDistributions(metricsInput);
  const cooccurrence = calculateReferenceFormulationCooccurrence(metricsInput);
  const contributionDistributions = calculateReferenceFormulationContributionDistributions(metricsInput);
  const processPatterns = calculateReferenceFormulationProcessPatterns(metricsInput);

  // Similarity needs a distinct, evidence-linked query feature vector. The
  // reverse-formulation screen does not yet retain accepted canonical identity
  // snapshots for its generated query, so this is explicitly an empty search
  // receipt instead of a fabricated nearest-reference result.
  const nearestReferences = referenceFormulationNearestReferencesSchema.parse({
    schemaVersion: REFERENCE_FORMULATION_NEAREST_REFERENCES_VERSION,
    featureSchemaVersion: REFERENCE_FORMULATION_SIMILARITY_FEATURES_VERSION,
    metric: "supplier_neutral_group_balanced_gower_v1",
    interpretation: "empirical_reference_similarity_not_validation_or_compatibility",
    evaluationMode: false,
    nearDuplicateChemistryJaccardThreshold: 0.9,
    nearDuplicateDosageDimensionOverlapThreshold: 0.9,
    nearDuplicateMaximumDosageGapPercentPoints: 1,
    querySourceRecordId: `unresolved-candidate-query:${productFamilyKey}`,
    productFamilyKey,
    requestedLimit: 10,
    minimumFeatureCoverage: 0.5,
    candidateCount: 0,
    excludedDifferentFamilyCount: 0,
    excludedSelfCount: 0,
    excludedSameDocumentHashCount: 0,
    excludedExactFormulaCount: 0,
    excludedNearDuplicateCount: 0,
    excludedInsufficientCoverageCount: 0,
    comparableCandidateCount: 0,
    references: [],
  });

  return createReferenceFormulationGenerationContext({
    productFamilyKey,
    ingredientPriors,
    nearestReferences,
    dosageDistributions,
    cooccurrence,
    contributionDistributions,
    processPatterns,
  });
}
