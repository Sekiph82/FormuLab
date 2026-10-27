import { z } from "zod";
import {
  REFERENCE_FORMULATION_SIMILARITY_FEATURES_VERSION,
  referenceFormulationFormulaSimilarityFeaturesSchema,
  type ReferenceFormulationFormulaSimilarityFeatures,
} from "./referenceFormulationSimilarityFeatures";

export const REFERENCE_FORMULATION_NEAREST_REFERENCES_VERSION = "formulab-reference-formulation-nearest-references-v1";
const comparedFeatureSchema = z.object({
  featureKey: z.string().trim().min(1),
  queryFeatureKeys: z.array(z.string().trim().min(1)).min(1),
  referenceFeatureKeys: z.array(z.string().trim().min(1)).min(1),
  group: z.enum(["product_family", "canonical_chemistry", "canonical_function", "process", "target", "dosage", "component_contribution"]),
  distance: z.number().finite().min(0).max(1),
  relation: z.enum(["exact", "different", "overlapping_ranges", "separated_ranges"]),
  queryEvidenceRefs: z.array(z.string().trim().min(1)).min(1),
  referenceEvidenceRefs: z.array(z.string().trim().min(1)).min(1),
}).strict();
const nearestReferenceSchema = z.object({
  sourceRecordId: z.string().trim().min(1),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  distance: z.number().finite().min(0).max(1),
  similarity: z.number().finite().min(0).max(1),
  featureCoverage: z.number().finite().min(0).max(1),
  comparedFeatureCount: z.number().int().positive(),
  queryFeatureCount: z.number().int().positive(),
  contributingFeatures: z.array(comparedFeatureSchema).min(1),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
}).strict().superRefine((result, context) => {
  if (Math.abs(result.similarity - (1 - result.distance)) > 1e-12
    || result.comparedFeatureCount !== result.contributingFeatures.length
    || Math.abs(result.featureCoverage - result.comparedFeatureCount / result.queryFeatureCount) > 1e-12
    || new Set(result.contributingFeatures.map((feature) => feature.featureKey)).size !== result.contributingFeatures.length
    || result.contributingFeatures.some((feature) => feature.queryEvidenceRefs.some((ref) => !result.evidenceRefs.includes(ref))
      || feature.referenceEvidenceRefs.some((ref) => !result.evidenceRefs.includes(ref)))) {
    context.addIssue({ code: "custom", path: ["contributingFeatures"], message: "Nearest-reference distances, coverage, and evidence links must agree." });
  }
});

export const referenceFormulationNearestReferencesSchema = z.object({
  schemaVersion: z.literal(REFERENCE_FORMULATION_NEAREST_REFERENCES_VERSION),
  featureSchemaVersion: z.literal(REFERENCE_FORMULATION_SIMILARITY_FEATURES_VERSION),
  metric: z.literal("supplier_neutral_group_balanced_gower_v1"),
  interpretation: z.literal("empirical_reference_similarity_not_validation_or_compatibility"),
  querySourceRecordId: z.string().trim().min(1),
  productFamilyKey: z.string().trim().min(1),
  requestedLimit: z.number().int().min(1).max(100),
  minimumFeatureCoverage: z.number().finite().min(0).max(1),
  candidateCount: z.number().int().nonnegative(),
  excludedDifferentFamilyCount: z.number().int().nonnegative(),
  excludedSelfCount: z.number().int().nonnegative(),
  excludedInsufficientCoverageCount: z.number().int().nonnegative(),
  comparableCandidateCount: z.number().int().nonnegative(),
  references: z.array(nearestReferenceSchema),
}).strict().superRefine((result, context) => {
  if (result.candidateCount !== result.excludedDifferentFamilyCount + result.excludedSelfCount
    + result.excludedInsufficientCoverageCount + result.comparableCandidateCount
    || result.references.length > result.comparableCandidateCount || result.references.length > result.requestedLimit
    || result.references.some((reference) => reference.sourceRecordId === result.querySourceRecordId)
    || new Set(result.references.map((reference) => reference.sourceRecordId)).size !== result.references.length
    || result.references.some((reference, index) => index > 0 && (
      reference.distance < result.references[index - 1]!.distance
      || (reference.distance === result.references[index - 1]!.distance
        && reference.sourceRecordId < result.references[index - 1]!.sourceRecordId)
    ))) {
    context.addIssue({ code: "custom", path: ["references"], message: "Nearest-reference results must be complete, unique, non-self, and deterministically ranked." });
  }
});
export type ReferenceFormulationNearestReferences = z.infer<typeof referenceFormulationNearestReferencesSchema>;

type CategoricalFeature = ReferenceFormulationFormulaSimilarityFeatures["categoricalFeatures"][number];
type QuantitativeFeature = ReferenceFormulationFormulaSimilarityFeatures["quantitativeFeatures"][number];
type Feature = CategoricalFeature | QuantitativeFeature;
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

function featureDistance(query: Feature[], reference: Feature[]): { distance: number; relation: z.infer<typeof comparedFeatureSchema>["relation"] } | undefined {
  if (!query.length || !reference.length || query[0]!.group !== reference[0]!.group) return undefined;
  if ("value" in query[0]! && "value" in reference[0]!) {
    const queryValues = new Set((query as CategoricalFeature[]).map((feature) => feature.value));
    const referenceValues = new Set((reference as CategoricalFeature[]).map((feature) => feature.value));
    const union = new Set([...queryValues, ...referenceValues]);
    const intersectionCount = [...queryValues].filter((value) => referenceValues.has(value)).length;
    const distance = 1 - intersectionCount / union.size;
    return distance === 0 ? { distance, relation: "exact" } : { distance, relation: "different" };
  }
  if (!("lowerBound" in query[0]! && "lowerBound" in reference[0]!)) return undefined;
  const queryRange = query[0] as QuantitativeFeature;
  const referenceRange = reference[0] as QuantitativeFeature;
  const gap = Math.max(0, Math.max(queryRange.lowerBound, referenceRange.lowerBound) - Math.min(queryRange.upperBound, referenceRange.upperBound));
  return gap === 0
    ? { distance: 0, relation: "overlapping_ranges" }
    : { distance: Math.min(1, gap / 100), relation: "separated_ranges" };
}

/** Retrieve source-linked nearest references without using supplier identity or treating empirical similarity as validation. */
export function retrieveNearestReferenceFormulations(input: {
  query: ReferenceFormulationFormulaSimilarityFeatures;
  references: ReferenceFormulationFormulaSimilarityFeatures[];
  limit?: number; minimumFeatureCoverage?: number;
}): ReferenceFormulationNearestReferences {
  const query = referenceFormulationFormulaSimilarityFeaturesSchema.parse(input.query);
  const references = input.references.map((item) => referenceFormulationFormulaSimilarityFeaturesSchema.parse(item));
  const limit = input.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Nearest-reference limit must be an integer from 1 to 100.");
  const minimumFeatureCoverage = input.minimumFeatureCoverage ?? 0.5;
  if (!Number.isFinite(minimumFeatureCoverage) || minimumFeatureCoverage < 0 || minimumFeatureCoverage > 1) {
    throw new Error("Nearest-reference minimum feature coverage must be between 0 and 1.");
  }
  if (new Set(references.map((item) => item.sourceRecordId)).size !== references.length) {
    throw new Error("Nearest-reference candidates must contain each source formula at most once.");
  }
  const candidateCount = references.length;
  let excludedDifferentFamilyCount = 0;
  let excludedSelfCount = 0;
  let excludedInsufficientCoverageCount = 0;
  // Product family is an eligibility gate, not a similarity dimension: it is constant for every scored candidate.
  const queryFeatures: Feature[] = [...query.categoricalFeatures, ...query.quantitativeFeatures]
    .filter((feature) => feature.dimensionKey !== "product_family");
  if (queryFeatures.length === 0) throw new Error("Nearest-reference query requires at least one discriminative feature beyond product family.");
  const groupByDimension = (features: Feature[]) => {
    const groups = new Map<string, Feature[]>();
    for (const feature of features) groups.set(feature.dimensionKey, [...(groups.get(feature.dimensionKey) ?? []), feature]);
    return groups;
  };
  const queryByDimension = groupByDimension(queryFeatures);
  const ranked: Array<z.infer<typeof nearestReferenceSchema>> = [];

  for (const reference of references) {
    if (reference.sourceRecordId === query.sourceRecordId) { excludedSelfCount += 1; continue; }
    if (reference.productFamilyKey !== query.productFamilyKey) { excludedDifferentFamilyCount += 1; continue; }
    const referenceFeatures: Feature[] = [...reference.categoricalFeatures, ...reference.quantitativeFeatures];
    const referenceByDimension = groupByDimension(referenceFeatures);
    const contributingFeatures: Array<z.infer<typeof comparedFeatureSchema>> = [];
    for (const dimensionKey of [...queryByDimension.keys()].filter((key) => referenceByDimension.has(key)).sort(compareText)) {
      const queryGroup = queryByDimension.get(dimensionKey)!;
      const referenceGroup = referenceByDimension.get(dimensionKey)!;
      const measured = featureDistance(queryGroup, referenceGroup);
      if (!measured) continue;
      contributingFeatures.push(comparedFeatureSchema.parse({
        featureKey: dimensionKey, queryFeatureKeys: queryGroup.map((feature) => feature.featureKey).sort(compareText),
        referenceFeatureKeys: referenceGroup.map((feature) => feature.featureKey).sort(compareText), group: queryGroup[0]!.group, ...measured,
        queryEvidenceRefs: queryGroup.flatMap((feature) => feature.evidenceRefs), referenceEvidenceRefs: referenceGroup.flatMap((feature) => feature.evidenceRefs),
      }));
    }
    const featureCoverage = queryByDimension.size ? contributingFeatures.length / queryByDimension.size : 0;
    if (featureCoverage < minimumFeatureCoverage) { excludedInsufficientCoverageCount += 1; continue; }

    const byGroup = new Map<string, number[]>();
    for (const feature of contributingFeatures) byGroup.set(feature.group, [...(byGroup.get(feature.group) ?? []), feature.distance]);
    const groupMeans = [...byGroup.values()].map((distances) => distances.reduce((total, value) => total + value, 0) / distances.length);
    const distance = groupMeans.reduce((total, value) => total + value, 0) / groupMeans.length;
    const evidenceRefs = [...new Set(contributingFeatures.flatMap((feature) => [...feature.queryEvidenceRefs, ...feature.referenceEvidenceRefs]))].sort(compareText);
    ranked.push(nearestReferenceSchema.parse({
      sourceRecordId: reference.sourceRecordId, sourceDocumentHash: reference.sourceDocumentHash,
      distance, similarity: 1 - distance, featureCoverage,
      comparedFeatureCount: contributingFeatures.length, queryFeatureCount: queryByDimension.size,
      contributingFeatures, evidenceRefs,
    }));
  }

  ranked.sort((a, b) => a.distance - b.distance || compareText(a.sourceRecordId, b.sourceRecordId));
  return referenceFormulationNearestReferencesSchema.parse({
    schemaVersion: REFERENCE_FORMULATION_NEAREST_REFERENCES_VERSION,
    featureSchemaVersion: REFERENCE_FORMULATION_SIMILARITY_FEATURES_VERSION,
    metric: "supplier_neutral_group_balanced_gower_v1",
    interpretation: "empirical_reference_similarity_not_validation_or_compatibility",
    querySourceRecordId: query.sourceRecordId,
    productFamilyKey: query.productFamilyKey, requestedLimit: limit, minimumFeatureCoverage, candidateCount,
    excludedDifferentFamilyCount, excludedSelfCount, excludedInsufficientCoverageCount,
    comparableCandidateCount: ranked.length,
    references: ranked.slice(0, limit),
  });
}
