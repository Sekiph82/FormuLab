import { describe, expect, it } from "vitest";
import { retrieveNearestReferenceFormulations, type ReferenceFormulationFormulaSimilarityFeatures } from "..";

function formula(input: {
  sourceRecordId: string; family?: string; categorical?: Array<{ key: string; group: "product_family" | "canonical_chemistry" | "process" | "target"; value: string }>;
  dosage?: { lower: number; upper: number };
}): ReferenceFormulationFormulaSimilarityFeatures {
  const family = input.family ?? "hand dishwash";
  const categoricalFeatures = [
    { featureKey: `family:${family}`, dimensionKey: "product_family", group: "product_family" as const, value: family, evidenceRefs: [`family:${input.sourceRecordId}`] },
    ...(input.categorical ?? []).map((feature) => ({
      featureKey: `${feature.key}:${feature.value}`, dimensionKey: feature.key, group: feature.group, value: feature.value,
      evidenceRefs: [`${feature.key}:${feature.value}:${input.sourceRecordId}`],
    })),
  ];
  const quantitativeFeatures = input.dosage ? [{
    featureKey: "dosage:chemical-a:surfactant", dimensionKey: "dosage:chemical-a:surfactant", group: "dosage" as const, canonicalChemistryId: "chemical-a",
    canonicalFunctionId: "surfactant", lowerBound: input.dosage.lower, upperBound: input.dosage.upper, unit: "% w/w" as const,
    evidenceRefs: [`dosage:${input.sourceRecordId}`],
  }] : [];
  const evidenceRefs = [...new Set([...categoricalFeatures.flatMap((feature) => feature.evidenceRefs), ...quantitativeFeatures.flatMap((feature) => feature.evidenceRefs)])].sort();
  return {
    sourceRecordId: input.sourceRecordId, queryRecordId: `query:${input.sourceRecordId}`, sourceDocumentHash: input.sourceRecordId.charCodeAt(0).toString(16).padStart(64, "0"),
    productFamilyKey: family, productFamilyLabel: family, categoricalFeatures, quantitativeFeatures, evidenceRefs,
    interpretation: "reviewed_reference_similarity_features_only",
  };
}

describe("reference formulation nearest references", () => {
  it("ranks same-family references with group-balanced distances and source evidence", () => {
    const query = formula({ sourceRecordId: "a-query", categorical: [
      { key: "canonical_chemistry", group: "canonical_chemistry", value: "chemical-a" },
      { key: "process:action", group: "process", value: "mix" },
    ], dosage: { lower: 10, upper: 10 } });
    const best = formula({ sourceRecordId: "b-best", categorical: [
      { key: "canonical_chemistry", group: "canonical_chemistry", value: "chemical-a" },
      { key: "process:action", group: "process", value: "mix" },
    ], dosage: { lower: 9, upper: 11 } });
    const next = formula({ sourceRecordId: "c-next", categorical: [
      { key: "canonical_chemistry", group: "canonical_chemistry", value: "different-chemical" },
      { key: "process:action", group: "process", value: "heat" },
    ], dosage: { lower: 30, upper: 30 } });
    const newerRevision = { ...best, sourceRecordId: "z-best-revision-v2", sourceDocumentHash: "f".repeat(64) };
    const differentFamily = formula({ sourceRecordId: "d-other", family: "shampoo", categorical: [{ key: "canonical_chemistry", group: "canonical_chemistry", value: "chemical-a" }] });
    const noOverlap = formula({ sourceRecordId: "e-no-overlap", categorical: [{ key: "other_dimension", group: "canonical_chemistry", value: "other" }] });

    const result = retrieveNearestReferenceFormulations({ query, references: [next, differentFamily, best, newerRevision, query, noOverlap], limit: 1 });
    expect(result).toMatchObject({
      querySourceRecordId: "a-query", productFamilyKey: "hand dishwash", requestedLimit: 1, candidateCount: 6,
      interpretation: "empirical_reference_similarity_not_validation_or_compatibility",
      minimumFeatureCoverage: 0.5, excludedDifferentFamilyCount: 1, excludedSelfCount: 1, excludedInsufficientCoverageCount: 1, comparableCandidateCount: 3,
      references: [{ sourceRecordId: "b-best", distance: 0, similarity: 1, featureCoverage: 1, comparedFeatureCount: 3,
        contributingFeatures: expect.arrayContaining([
          expect.objectContaining({ featureKey: "dosage:chemical-a:surfactant", relation: "overlapping_ranges", distance: 0 }),
        ]), evidenceRefs: expect.arrayContaining(["dosage:a-query", "dosage:b-best"]) }],
    });
    expect(result.references[0]?.sourceDocumentHash).toBe(best.sourceDocumentHash);
    expect(result.references[0]?.sourceDocumentHash).not.toBe(newerRevision.sourceDocumentHash);
    expect(retrieveNearestReferenceFormulations({ query, references: [noOverlap, query, best, differentFamily, next] })).toEqual(
      retrieveNearestReferenceFormulations({ query, references: [next, differentFamily, best, query, noOverlap] }));
    expect(JSON.stringify(result)).not.toContain("supplierId");
    expect(result.references).toHaveLength(1);
    expect(() => retrieveNearestReferenceFormulations({ query, references: [best, best] })).toThrow(/at most once/);
  });

  it("reports nonzero, group-balanced distance and validates limits", () => {
    const query = formula({ sourceRecordId: "a-query", categorical: [
      { key: "canonical_chemistry", group: "canonical_chemistry", value: "chemical-a" },
      { key: "process:action", group: "process", value: "mix" },
    ], dosage: { lower: 10, upper: 10 } });
    const candidate = formula({ sourceRecordId: "b-candidate", categorical: [
      { key: "canonical_chemistry", group: "canonical_chemistry", value: "different-chemical" },
      { key: "process:action", group: "process", value: "heat" },
    ], dosage: { lower: 30, upper: 30 } });
    const result = retrieveNearestReferenceFormulations({ query, references: [candidate] });
    expect(result.references[0]!.distance).toBeCloseTo(0.7333333333);
    expect(result.references[0]!.similarity).toBeCloseTo(0.2666666667);
    expect(() => retrieveNearestReferenceFormulations({ query, references: [candidate], limit: 0 })).toThrow(/integer from 1 to 100/);
    const familyOnly = formula({ sourceRecordId: "z-family-only" });
    expect(() => retrieveNearestReferenceFormulations({ query: familyOnly, references: [candidate], minimumFeatureCoverage: 0 })).toThrow(/discriminative feature/);
  });

  it("excludes same-document and exact-formula leakage, and near duplicates only in evaluation mode", () => {
    const query = formula({ sourceRecordId: "a-query", categorical: [
      { key: "canonical_chemistry", group: "canonical_chemistry", value: "chemical-a" },
    ], dosage: { lower: 10, upper: 10 } });
    const originalDosage = query.quantitativeFeatures[0]!;
    query.quantitativeFeatures = [
      { ...originalDosage, featureKey: "dosage:chemical-a:function-one", dimensionKey: "dosage:chemical-a:function-one",
        canonicalFunctionId: "function-one", lowerBound: 0.1, upperBound: 0.1, evidenceRefs: ["dosage:query:function-one"] },
      { ...originalDosage, featureKey: "dosage:chemical-a:function-two", dimensionKey: "dosage:chemical-a:function-two",
        canonicalFunctionId: "function-two", lowerBound: 0.2, upperBound: 0.2, evidenceRefs: ["dosage:query:function-two"] },
    ];
    query.evidenceRefs = [...new Set([...query.evidenceRefs, ...query.quantitativeFeatures.flatMap((feature) => feature.evidenceRefs)])].sort();
    const copy = (sourceRecordId: string): ReferenceFormulationFormulaSimilarityFeatures => ({
      ...structuredClone(query), sourceRecordId, queryRecordId: `query:${sourceRecordId}`,
      sourceDocumentHash: sourceRecordId.charCodeAt(0).toString(16).padStart(64, "0"),
    });
    const sameHash = { ...copy("b-same-hash"), sourceDocumentHash: query.sourceDocumentHash };
    const exactFormula = copy("c-exact-formula");
    exactFormula.quantitativeFeatures = [{ ...originalDosage, featureKey: "dosage:chemical-a:different-reviewed-function",
      dimensionKey: "dosage:chemical-a:different-reviewed-function", canonicalFunctionId: "different-reviewed-function",
      lowerBound: 0.3, upperBound: 0.3, evidenceRefs: ["dosage:exact:different-function"] }];
    exactFormula.evidenceRefs = [...new Set([...exactFormula.evidenceRefs, ...exactFormula.quantitativeFeatures[0]!.evidenceRefs])].sort();
    const documentAndExact = retrieveNearestReferenceFormulations({ query, references: [sameHash, exactFormula] });
    expect(documentAndExact).toMatchObject({ candidateCount: 2, excludedSameDocumentHashCount: 1, excludedExactFormulaCount: 1, references: [] });

    const denseQuery = formula({ sourceRecordId: "d-dense-query" });
    denseQuery.categoricalFeatures = [denseQuery.categoricalFeatures[0]!, ...Array.from({ length: 10 }, (_, index) => ({
      featureKey: `chemistry:chemical-${index}`, dimensionKey: "canonical_chemistry" as const,
      group: "canonical_chemistry" as const, value: `chemical-${index}`, evidenceRefs: [`chemistry:${index}:query`],
    }))];
    denseQuery.quantitativeFeatures = Array.from({ length: 10 }, (_, index) => ({
      featureKey: `dosage:chemical-${index}:unassigned`, dimensionKey: `dosage:chemical-${index}:unassigned`, group: "dosage" as const,
      canonicalChemistryId: `chemical-${index}`, lowerBound: 10, upperBound: 10, unit: "% w/w" as const, evidenceRefs: [`dosage:${index}:query`],
    }));
    denseQuery.evidenceRefs = [...new Set([...denseQuery.categoricalFeatures.flatMap((feature) => feature.evidenceRefs), ...denseQuery.quantitativeFeatures.flatMap((feature) => feature.evidenceRefs)])].sort();
    const nearDuplicate = copy("e-near-duplicate");
    nearDuplicate.productFamilyKey = denseQuery.productFamilyKey;
    nearDuplicate.categoricalFeatures = [denseQuery.categoricalFeatures[0]!, ...denseQuery.categoricalFeatures.slice(1).map((feature) => ({ ...feature, evidenceRefs: [`${feature.featureKey}:near`] })), {
      featureKey: "chemistry:chemical-extra", dimensionKey: "canonical_chemistry", group: "canonical_chemistry", value: "chemical-extra", evidenceRefs: ["chemistry:extra:near"],
    }];
    nearDuplicate.quantitativeFeatures = [...denseQuery.quantitativeFeatures.map((feature) => ({ ...feature, upperBound: 10.5, evidenceRefs: [`${feature.featureKey}:near`] })), {
      featureKey: "dosage:chemical-extra:unassigned", dimensionKey: "dosage:chemical-extra:unassigned", group: "dosage",
      canonicalChemistryId: "chemical-extra", lowerBound: 1, upperBound: 1, unit: "% w/w", evidenceRefs: ["dosage:extra:near"],
    }];
    nearDuplicate.evidenceRefs = [...new Set([...nearDuplicate.categoricalFeatures.flatMap((feature) => feature.evidenceRefs), ...nearDuplicate.quantitativeFeatures.flatMap((feature) => feature.evidenceRefs)])].sort();
    const discovery = retrieveNearestReferenceFormulations({ query: denseQuery, references: [nearDuplicate] });
    expect(discovery.excludedNearDuplicateCount).toBe(0);
    const evaluation = retrieveNearestReferenceFormulations({ query: denseQuery, references: [nearDuplicate], evaluationMode: true });
    expect(evaluation).toMatchObject({ evaluationMode: true, nearDuplicateDosageDimensionOverlapThreshold: 0.9, excludedNearDuplicateCount: 1, references: [] });
  });
});
