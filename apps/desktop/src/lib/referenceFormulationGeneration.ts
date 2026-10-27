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
  filterEligibleReferenceFormulationCorpus,
  type ReferenceFormulationEligibilityDecision,
  type ReferenceFormulationQueryRecord,
  type ReferenceFormulationSupportQuality,
  type ReferenceFormulationGenerationContext,
} from "@formulab/shared";
import { listRecords } from "./masterdata";
import { rebuildReferenceFormulationCorpusIndex } from "./referenceFormulationNormalizations";
import { listReferenceFormulations } from "./referenceFormulations";

function familyKey(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

const identityResolutionReasons = new Set<ReferenceFormulationEligibilityDecision["reasons"][number]>([
  "missing_product_family", "ambiguous_product_family", "product_family_not_reviewed", "missing_ingredient_lines", "missing_line_identity",
  "line_identity_not_reviewed", "canonical_chemistry_unresolved", "canonical_chemistry_ambiguous",
  "canonical_chemistry_not_reviewed",
]);

/** Deterministic corpus quality summary; thresholds are labels, never an AI confidence estimate. */
export function summarizeReferenceFormulationSupport(input: {
  queryRecords: ReferenceFormulationQueryRecord[];
  decisions: ReferenceFormulationEligibilityDecision[];
  context: Pick<ReferenceFormulationGenerationContext, "eligibleFormulaCount" | "supplierCount">;
  productFamilyKey: string;
}): ReferenceFormulationSupportQuality {
  const productFamilyKey = familyKey(input.productFamilyKey);
  const queryById = new Map(input.queryRecords.map((query) => [query.id, query]));
  const familyDecisions = input.decisions.filter((decision) => {
    const query = queryById.get(decision.queryRecordId);
    return query?.productFamily.candidates.some((family) => familyKey(family.rawValue) === productFamilyKey);
  });
  const familyFormulaCount = familyDecisions.length;
  const identityResolvedFormulaCount = familyDecisions.filter((decision) =>
    !decision.reasons.some((reason) => identityResolutionReasons.has(reason)),
  ).length;
  const familyQueries = familyDecisions.map((decision) => queryById.get(decision.queryRecordId)!).filter(Boolean);
  const ingredientLineCount = familyQueries.reduce((sum, query) => sum + query.lines.length, 0);
  const sourceCitedIngredientLineCount = familyQueries.reduce(
    (sum, query) => sum + query.lines.filter((line) => line.sourceLineEvidenceRefs.length > 0).length,
    0,
  );
  const percent = (numerator: number, denominator: number) => denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;
  const identityResolutionPercent = percent(identityResolvedFormulaCount, familyFormulaCount);
  const sourceCitationCoveragePercent = percent(sourceCitedIngredientLineCount, ingredientLineCount);
  const eligibleFormulaCount = input.context.eligibleFormulaCount;
  const supplierCount = input.context.supplierCount;
  const status = eligibleFormulaCount >= 10 && supplierCount >= 3 && identityResolutionPercent >= 80 && sourceCitationCoveragePercent >= 90
    ? "BROAD"
    : eligibleFormulaCount >= 3 && supplierCount >= 2 && identityResolutionPercent >= 60 && sourceCitationCoveragePercent >= 75
      ? "MODERATE"
      : eligibleFormulaCount > 0 ? "SPARSE" : "UNAVAILABLE";
  return {
    status,
    policyVersion: "formulab-reference-support-quality-v1",
    familyFormulaCount,
    eligibleFormulaCount,
    supplierCount,
    identityResolvedFormulaCount,
    identityResolutionPercent,
    ingredientLineCount,
    sourceCitedIngredientLineCount,
    sourceCitationCoveragePercent,
    interpretation: "deterministic_reviewed_corpus_sample_resolution_and_source_coverage_not_ai_confidence_or_validation",
  };
}

/** Build local reference guidance only from the existing reviewed corpus and its exact source identities. */
export async function loadReferenceFormulationGenerationContext(productFamilyCode: string): Promise<{
  context: ReferenceFormulationGenerationContext;
  supportQuality: ReferenceFormulationSupportQuality;
}> {
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
  const eligibility = filterEligibleReferenceFormulationCorpus(metricsInput);

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

  const context = createReferenceFormulationGenerationContext({
    productFamilyKey,
    ingredientPriors,
    nearestReferences,
    dosageDistributions,
    cooccurrence,
    contributionDistributions,
    processPatterns,
  });
  return {
    context,
    supportQuality: summarizeReferenceFormulationSupport({
      queryRecords,
      decisions: eligibility.decisions,
      context,
      productFamilyKey,
    }),
  };
}
