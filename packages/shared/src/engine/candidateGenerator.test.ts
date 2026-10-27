import { describe, expect, it, vi } from "vitest";
import { generateCandidates, type GenerationInput } from "./candidateGenerator";
import {
  adaptGenerationInputWithReferenceContext,
  createReferenceFormulationGenerationContext,
  retrieveNearestReferenceFormulations,
  referenceFormulationGenerationContextSchema,
  type ReferenceFormulationIngredientFrequencyPriors,
} from "..";
import type { RawMaterial } from "../schemas/materials";
import type { IngredientDeclarationLine, ReverseConstraintSet, TargetProductProfile } from "../schemas/reverseFormulation";
import type { AnalyticalAnalysis } from "./analyticalInference";
import type { IngredientMappingResult } from "./ingredientMapper";
import { recordIdentityFieldReview } from "../schemas/identityFieldReview";

function material(overrides: Partial<RawMaterial> = {}): RawMaterial {
  return {
    schemaVersion: "1.0",
    code: "MAT-001",
    displayName: "Water",
    casNumbers: [],
    ecNumbers: [],
    functions: ["solvent"],
    activeMatterState: "missing",
    documents: [],
    regulatoryStatuses: [],
    hazardClassifications: [],
    allergens: [],
    incompatibilities: [],
    substituteCodes: [],
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function declLine(overrides: Partial<IngredientDeclarationLine> = {}): IngredientDeclarationLine {
  return {
    id: "line-1",
    benchmarkProductId: "bp-1",
    rawText: "Water",
    normalizedText: "water",
    declaredOrder: 0,
    declaredName: "Water",
    mappingStatus: "mapped",
    mappedMaterialIds: ["MAT-001"],
    ...overrides,
  };
}

const EMPTY_ANALYSIS: AnalyticalAnalysis = {
  totalAnalytes: 0,
  totalConcentration: 0,
  averageConcentration: 0,
  analytesByType: {},
  estimatedPh: null,
  estimatedActiveMatter: null,
  notes: [],
};

const WITH_ANALYSIS: AnalyticalAnalysis = {
  totalAnalytes: 2,
  totalConcentration: 12,
  averageConcentration: 6,
  analytesByType: { Na: [6], Cl: [6] },
  estimatedPh: 7,
  estimatedActiveMatter: null,
  notes: [],
};

const TARGET: TargetProductProfile = {
  id: "target-1",
  code: "TGT-1",
  name: "Target",
  productFamilyCode: "liquid_detergent",
  jurisdictions: [],
};

const CONSTRAINTS: ReverseConstraintSet = {
  id: "cs-1",
  code: "CS-1",
  name: "Constraints",
  studyId: "study-1",
  requiredMaterials: [],
  preferredMaterials: [],
  excludedMaterials: [],
  requiredFunctions: [],
  minimumPercentages: {},
  maximumPercentages: {},
};

function mapping(overrides: Partial<IngredientMappingResult> = {}): IngredientMappingResult {
  return {
    material: material(),
    confidence: 0.9,
    reason: "exact match",
    alternatives: [],
    ...overrides,
  };
}

function canonicalIdentityReview(materialCode: string, canonicalChemistryId: string) {
  return recordIdentityFieldReview({
    id: `identity-review-${materialCode}-${canonicalChemistryId}`,
    commercialProductId: `commercial-${materialCode}`,
    sourceEvidenceId: `identity-evidence-${materialCode}`,
    targetRecordId: materialCode,
    field: "canonical_identity",
    decision: "accepted",
    proposedValueSnapshot: JSON.stringify({ canonicalChemistryId }),
    evidenceRefs: [`identity:${materialCode}:${canonicalChemistryId}`],
    reviewedAt: "2026-10-26T12:00:00.000Z",
  }, { kind: "human", role: "raw_material", userId: "reviewer-1" });
}

function baseInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  const mat = material();
  return {
    mappedIngredients: [{ line: declLine(), mapping: mapping({ material: mat }) }],
    analysis: EMPTY_ANALYSIS,
    target: TARGET,
    constraints: CONSTRAINTS,
    availableMaterials: [mat],
    ...overrides,
  };
}

describe("generateCandidates", () => {
  it("generates deterministically with reviewed reference context when network and LLM services are unavailable", () => {
    const referenceContext = referenceFormulationGenerationContextSchema.parse({
      schemaVersion: "formulab-reference-formulation-generation-context-v3", available: true, productFamilyKey: "hand dishwash",
      asOf: "2026-10-26T12:00:00.000Z", eligibleFormulaCount: 1, supplierCount: 1,
      eligibleSourceRecordIds: ["reference-1"],
      ingredientPriors: [{ canonicalChemistryId: "chemical-a", formulaCount: 1, eligibleFormulaCount: 1,
        formulaWeightedFrequency: 1, supplierNeutralFrequency: 1, supplierCount: 1, sourceRecordIds: ["reference-1"],
        supplierMix: [{ supplierId: "supplier-a", eligibleFormulaCount: 1, ingredientFormulaCount: 1, frequency: 1, sourceRecordIds: ["reference-1"] }] }],
      nearestReferences: [], cooccurrenceGuidance: [], cooccurrenceGuidanceAvailable: false,
      cooccurrenceGuidanceUnavailableReason: "no_reviewed_family_cooccurrence",
      dosageGuidance: [], dosageGuidanceAvailable: false,
      dosageGuidanceUnavailableReason: "no_reviewed_family_dosage",
      interpretation: "advisory_supplier_neutral_reference_context_not_truth_or_approval",
    });
    const input = adaptGenerationInputWithReferenceContext(baseInput(), referenceContext);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let first: ReturnType<typeof generateCandidates>;
    let second: ReturnType<typeof generateCandidates>;
    try {
      first = generateCandidates(input);
      second = generateCandidates(input);
    } finally {
      fetchSpy.mockRestore();
    }
    expect(input.referenceContext?.available).toBe(true);
    expect(first!).toEqual(second!);
    expect(first![0]!.formula.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("attaches eligible supplier-neutral priors and nearest references without replacing the deterministic generator", () => {
    const asOf = "2026-10-26T12:00:00.000Z";
    const ingredientPriors: ReferenceFormulationIngredientFrequencyPriors = {
      schemaVersion: "formulab-reference-formulation-ingredient-frequency-prior-v2",
      asOf, eligibleFormulaCount: 2, excludedFormulaCount: 0,
      eligibilityDecisions: ["reference-1", "reference-2"].map((sourceRecordId, index) => ({
        sourceRecordId, queryRecordId: `query-${index + 1}`, normalizationId: `normalization-${index + 1}`, eligible: true, reasons: [],
      })),
      productFamilies: [{
        productFamilyKey: "hand dishwash", productFamilyLabel: "Hand Dishwash", eligibleFormulaCount: 2, supplierCount: 2,
        suppliers: [
          { supplierId: "supplier-a", formulaCount: 1, familyShare: 0.5, sourceRecordIds: ["reference-1"] },
          { supplierId: "supplier-b", formulaCount: 1, familyShare: 0.5, sourceRecordIds: ["reference-2"] },
        ],
        ingredients: [{
          canonicalChemistryId: "chemical-a", formulaCount: 1, frequency: 0.5, frequencyWeighting: "formula_weighted_corpus",
          supplierNeutral: { weighting: "equal_supplier", supplierCount: 2, interpretation: "equal_supplier_mean_of_supplier_formula_prevalence", pooledFrequency: 0.5,
            suppliers: [
              { supplierId: "supplier-a", eligibleFormulaCount: 1, ingredientFormulaCount: 1, frequency: 1, equalSupplierWeight: 0.5, sourceRecordIds: ["reference-1"] },
              { supplierId: "supplier-b", eligibleFormulaCount: 1, ingredientFormulaCount: 0, frequency: 0, equalSupplierWeight: 0.5, sourceRecordIds: [] },
            ] },
          supplierCount: 1,
          suppliers: [{ supplierId: "supplier-a", formulaCount: 1, familyShare: 0.5, ingredientShare: 1 }],
          sourceRecordIds: ["reference-1"],
        }],
      }],
    };
    const formulaFeatures = (sourceRecordId: string, fill: string) => {
      const family = { featureKey: "family:hand dishwash", dimensionKey: "product_family", group: "product_family" as const, value: "hand dishwash", evidenceRefs: [`family:${sourceRecordId}`] };
      const chemistry = { featureKey: `chemistry:${fill}`, dimensionKey: "canonical_chemistry", group: "canonical_chemistry" as const, value: fill, evidenceRefs: [`chemistry:${sourceRecordId}`] };
      return {
        sourceRecordId, queryRecordId: `query:${sourceRecordId}`, sourceDocumentHash: sourceRecordId === "new-request" ? "a".repeat(64) : "b".repeat(64),
        productFamilyKey: "hand dishwash", productFamilyLabel: "Hand Dishwash", categoricalFeatures: [family, chemistry], quantitativeFeatures: [],
        evidenceRefs: [...family.evidenceRefs, ...chemistry.evidenceRefs].sort(), interpretation: "reviewed_reference_similarity_features_only" as const,
      };
    };
    const query = formulaFeatures("new-request", "chemical-a");
    const nearestReferences = retrieveNearestReferenceFormulations({
      query, references: [formulaFeatures("reference-1", "chemical-a")],
    });
    const dosageDistributions = {
      schemaVersion: "formulab-reference-formulation-dosage-distribution-v2" as const,
      asOf,
      eligibleFormulaCount: 2,
      excludedFormulaCount: 0,
      excludedDosageSampleCount: 0,
      excludedDosageSamplesByReason: {},
      eligibilityDecisions: ["reference-1", "reference-2"].map((sourceRecordId, index) => ({
        sourceRecordId, queryRecordId: `query-${index + 1}`, normalizationId: `normalization-${index + 1}`, eligible: true, reasons: [] as [],
      })),
      eligibleSourceRecordIdsByProductFamily: { "hand dishwash": ["reference-1", "reference-2"] },
      distributions: [{
        productFamilyKey: "hand dishwash", productFamilyLabel: "Hand Dishwash", canonicalChemistryId: "chemical-a",
        functionAssignment: "unassigned_or_unreviewed" as const, formulaCount: 1, supplierCount: 1,
        minimumLowerBound: 1, maximumUpperBound: 9,
        lowerBoundQuantiles: { p25: 2, p50: 3, p75: 4 }, upperBoundQuantiles: { p25: 4, p50: 5, p75: 8 },
        suppliers: [{ supplierId: "supplier-a", formulaCount: 1, share: 1, sourceRecordIds: ["reference-1"] }], sourceRecordIds: ["reference-1"],
      }],
    };
    const cooccurrence = {
      schemaVersion: "formulab-reference-formulation-cooccurrence-v2" as const,
      asOf,
      eligibleFormulaCount: 2,
      excludedFormulaCount: 0,
      excludedComponentCandidateCount: 0,
      eligibilityDecisions: ["reference-1", "reference-2"].map((sourceRecordId, index) => ({
        sourceRecordId, queryRecordId: `query-${index + 1}`, normalizationId: `normalization-${index + 1}`, eligible: true, reasons: [] as [],
      })),
      eligibleSourceRecordIdsByProductFamily: { "hand dishwash": ["reference-1", "reference-2"] },
      cooccurrences: [{
        productFamilyKey: "hand dishwash", productFamilyLabel: "Hand Dishwash", pairKind: "material_function_pair" as const,
        scope: "same_formula" as const, denominatorScope: "eligible_formulas_in_family" as const,
        firstId: "chemical-a", secondId: "nonionic_surfactant", formulaCount: 1, eligibleFormulaCount: 2, frequency: 0.5,
        supplierCount: 1, suppliers: [{ supplierId: "supplier-a", formulaCount: 1, share: 1, sourceRecordIds: ["reference-1"] }],
        sourceRecordIds: ["reference-1"], interpretation: "empirical_cooccurrence_only" as const, compatibilityEvidence: false as const,
      }],
      interpretation: "empirical_cooccurrence_only" as const,
      compatibilityEvidence: false as const,
    };
    const context = createReferenceFormulationGenerationContext({ productFamilyKey: "hand dishwash", ingredientPriors, nearestReferences, dosageDistributions, cooccurrence });
    const original = baseInput();
    const adapted = adaptGenerationInputWithReferenceContext(original, context);

    expect(context).toMatchObject({ available: true, eligibleFormulaCount: 2, supplierCount: 2,
      ingredientPriors: [{ canonicalChemistryId: "chemical-a", formulaWeightedFrequency: 0.5, supplierNeutralFrequency: 0.5,
        supplierMix: [{ supplierId: "supplier-a", frequency: 1 }, { supplierId: "supplier-b", frequency: 0 }] }],
      nearestReferences: [{ sourceRecordId: "reference-1", distance: 0, evidenceRefs: expect.arrayContaining(["chemistry:new-request", "chemistry:reference-1"]) }],
      dosageGuidanceAvailable: true, dosageGuidance: [{ canonicalChemistryId: "chemical-a", formulaCount: 1, supplierCount: 1,
        typicalRangePercent: { lower: 2, upper: 8 }, observedRangePercent: { lower: 1, upper: 9 },
        medianRangePercent: { lower: 3, upper: 5 }, asOf, sourceRecordIds: ["reference-1"] }],
      cooccurrenceGuidanceAvailable: true,
      cooccurrenceGuidance: [{ pairKind: "material_function_pair", firstId: "chemical-a", secondId: "nonionic_surfactant",
        formulaCount: 1, eligibleFormulaCount: 2, frequency: 0.5, sourceRecordIds: ["reference-1"] }],
      interpretation: "advisory_supplier_neutral_reference_context_not_truth_or_approval" });
    expect(original.referenceContext).toBeUndefined();
    expect(adapted.referenceContext).toEqual(context);
    expect(generateCandidates(adapted)).toEqual(generateCandidates(original));
    expect(() => referenceFormulationGenerationContextSchema.parse({ ...context,
      ingredientPriors: [{ ...context.ingredientPriors[0]!, supplierNeutralFrequency: 0.9 }] })).toThrow(/supplier-neutral source evidence/);
    expect(() => referenceFormulationGenerationContextSchema.parse({ ...context,
      ingredientPriors: [{ ...context.ingredientPriors[0]!, formulaWeightedFrequency: 0.9 }] })).toThrow(/supplier-neutral source evidence/);
    expect(() => referenceFormulationGenerationContextSchema.parse({ ...context,
      ingredientPriors: [{ ...context.ingredientPriors[0]!, supplierMix: [
        { ...context.ingredientPriors[0]!.supplierMix[0]!, eligibleFormulaCount: 2, frequency: 0.5 },
        context.ingredientPriors[0]!.supplierMix[1]!,
      ] }] })).toThrow(/complete, unique/);
    expect(() => referenceFormulationGenerationContextSchema.parse({ ...context,
      nearestReferences: [{ ...context.nearestReferences[0]!, similarity: 0.4 }] })).toThrow(/complementary/);
    expect(() => createReferenceFormulationGenerationContext({ productFamilyKey: "shampoo", ingredientPriors, nearestReferences })).toThrow(/requested canonical product family/);
    const unavailable = createReferenceFormulationGenerationContext({
      productFamilyKey: "hand dishwash",
      ingredientPriors: { ...ingredientPriors, eligibleFormulaCount: 0, eligibilityDecisions: [], productFamilies: [] },
      nearestReferences,
    });
    expect(unavailable).toMatchObject({ available: false, unavailableReason: "no_eligible_family_prior", eligibleFormulaCount: 0, ingredientPriors: [], nearestReferences: [] });
    expect(() => createReferenceFormulationGenerationContext({ productFamilyKey: "hand dishwash", ingredientPriors, nearestReferences,
      dosageDistributions: { ...dosageDistributions, distributions: [{ ...dosageDistributions.distributions[0]!, sourceRecordIds: ["not-eligible"] }] },
    })).toThrow();
    expect(() => createReferenceFormulationGenerationContext({ productFamilyKey: "hand dishwash", ingredientPriors, nearestReferences,
      dosageDistributions: { ...dosageDistributions, distributions: [{ ...dosageDistributions.distributions[0]!, productFamilyKey: "shampoo" }] },
    })).toThrow();
    const separateCorpusDosage = {
      ...dosageDistributions,
      eligibilityDecisions: ["other-reference-1", "other-reference-2"].map((sourceRecordId, index) => ({
        sourceRecordId, queryRecordId: `other-query-${index + 1}`, normalizationId: `other-normalization-${index + 1}`, eligible: true, reasons: [] as [],
      })),
      eligibleSourceRecordIdsByProductFamily: { "hand dishwash": ["other-reference-1", "other-reference-2"] },
      distributions: [{ ...dosageDistributions.distributions[0]!,
        sourceRecordIds: ["other-reference-1"],
        suppliers: [{ supplierId: "supplier-a", formulaCount: 1, share: 1, sourceRecordIds: ["other-reference-1"] }],
      }],
    };
    expect(() => createReferenceFormulationGenerationContext({ productFamilyKey: "hand dishwash", ingredientPriors, nearestReferences,
      dosageDistributions: separateCorpusDosage,
    })).toThrow(/same eligible reviewed family corpus/);
    const separateCorpusCooccurrence = {
      ...cooccurrence,
      eligibilityDecisions: ["other-reference-1", "other-reference-2"].map((sourceRecordId, index) => ({
        sourceRecordId, queryRecordId: `other-query-${index + 1}`, normalizationId: `other-normalization-${index + 1}`, eligible: true, reasons: [] as [],
      })),
      eligibleSourceRecordIdsByProductFamily: { "hand dishwash": ["other-reference-1", "other-reference-2"] },
      cooccurrences: [{ ...cooccurrence.cooccurrences[0]!, sourceRecordIds: ["other-reference-1"],
        suppliers: [{ supplierId: "supplier-a", formulaCount: 1, share: 1, sourceRecordIds: ["other-reference-1"] }] }],
    };
    expect(() => createReferenceFormulationGenerationContext({ productFamilyKey: "hand dishwash", ingredientPriors, nearestReferences,
      cooccurrence: separateCorpusCooccurrence,
    })).toThrow(/same eligible reviewed family corpus/);
    expect(() => createReferenceFormulationGenerationContext({ productFamilyKey: "hand dishwash", ingredientPriors, nearestReferences,
      dosageDistributions: { ...dosageDistributions, distributions: [{
        ...dosageDistributions.distributions[0]!,
        suppliers: [{ supplierId: "supplier-b", formulaCount: 1, share: 1, sourceRecordIds: ["reference-1"] }],
      }] },
    })).toThrow();
  });

  it("surfaces exact-identity empirical dosage as source-linked advisory context without changing formula percentages", () => {
    const original = baseInput();
    const input: GenerationInput = {
      ...original,
      canonicalProductFamilyKey: "hand dishwash",
      mappedIngredients: [{ ...original.mappedIngredients[0]!, canonicalIdentityReview: canonicalIdentityReview("MAT-001", "chemical-a") }],
      referenceContext: {
        schemaVersion: "formulab-reference-formulation-generation-context-v3",
        available: true,
        productFamilyKey: "hand dishwash",
        asOf: "2026-10-26T12:00:00.000Z",
        eligibleFormulaCount: 1,
        eligibleSourceRecordIds: ["reference-1"],
        supplierCount: 1,
        ingredientPriors: [{
          canonicalChemistryId: "chemical-a", formulaCount: 1, eligibleFormulaCount: 1,
          formulaWeightedFrequency: 1, supplierNeutralFrequency: 1, supplierCount: 1, sourceRecordIds: ["reference-1"],
          supplierMix: [{ supplierId: "supplier-a", eligibleFormulaCount: 1, ingredientFormulaCount: 1, frequency: 1, sourceRecordIds: ["reference-1"] }],
        }],
        nearestReferences: [],
        cooccurrenceGuidance: [{
          asOf: "2026-10-26T12:00:00.000Z", pairKind: "material_function_pair", scope: "same_formula",
          denominatorScope: "eligible_formulas_in_family", firstId: "chemical-a", secondId: "nonionic_surfactant",
          formulaCount: 1, eligibleFormulaCount: 1, frequency: 1, supplierCount: 1,
          suppliers: [{ supplierId: "supplier-a", formulaCount: 1, share: 1, sourceRecordIds: ["reference-1"] }],
          sourceRecordIds: ["reference-1"], interpretation: "empirical_cooccurrence_only", compatibilityEvidence: false,
        }],
        cooccurrenceGuidanceAvailable: true,
        dosageGuidance: [{
          asOf: "2026-10-26T12:00:00.000Z",
          canonicalChemistryId: "chemical-a", functionAssignment: "unassigned_or_unreviewed", formulaCount: 1, supplierCount: 1,
          observedRangePercent: { lower: 2, upper: 8 }, typicalRangePercent: { lower: 3, upper: 7 },
          medianRangePercent: { lower: 4, upper: 5 },
          suppliers: [{ supplierId: "supplier-a", formulaCount: 1, share: 1, sourceRecordIds: ["reference-1"] }], sourceRecordIds: ["reference-1"],
        }],
        dosageGuidanceAvailable: true,
        interpretation: "advisory_supplier_neutral_reference_context_not_truth_or_approval",
      },
    };
    const [withGuidance] = generateCandidates(input);
    const [withoutGuidance] = generateCandidates(original);

    expect(withGuidance!.formula).toEqual(withoutGuidance!.formula);
    expect(withGuidance!.dosageGuidance).toEqual([expect.objectContaining({
      materialId: "MAT-001", canonicalChemistryId: "chemical-a", functionAssignment: "unassigned_or_unreviewed", candidatePercent: 100,
      typicalRangePercent: { lower: 3, upper: 7 }, observedRangePercent: { lower: 2, upper: 8 },
      position: "above_typical_range", formulaCount: 1, supplierCount: 1, sourceRecordIds: ["reference-1"],
    })]);
    expect(withGuidance!.ingredientGuidance).toEqual([expect.objectContaining({
      materialId: "MAT-001", canonicalChemistryId: "chemical-a", formulaCount: 1, eligibleFormulaCount: 1,
      formulaWeightedFrequency: 1, supplierNeutralFrequency: 1, sourceRecordIds: ["reference-1"],
    })]);
    expect(withGuidance!.cooccurrenceGuidance).toEqual([expect.objectContaining({
      materialId: "MAT-001", canonicalChemistryId: "chemical-a", pairKind: "material_function_pair",
      otherId: "nonionic_surfactant", frequency: 1, sourceRecordIds: ["reference-1"],
    })]);
    expect(withGuidance!.notes.some((note) => /advisory only; not a hard constraint, safety approval, or validated recommendation/i.test(note))).toBe(true);
    const unlinked = generateCandidates({ ...input, mappedIngredients: original.mappedIngredients })[0]!;
    expect(unlinked.dosageGuidance).toBeUndefined();
    expect(unlinked.ingredientGuidance).toBeUndefined();
    expect(unlinked.cooccurrenceGuidance).toBeUndefined();
    expect(unlinked.formula).toEqual(withoutGuidance!.formula);
    const wrongFamily = generateCandidates({ ...input, canonicalProductFamilyKey: "shampoo" })[0]!;
    expect(wrongFamily.dosageGuidance).toBeUndefined();
    expect(wrongFamily.ingredientGuidance).toBeUndefined();
    expect(wrongFamily.cooccurrenceGuidance).toBeUndefined();
    expect(wrongFamily.formula).toEqual(withoutGuidance!.formula);
    const reviewForDifferentMaterial = generateCandidates({ ...input, mappedIngredients: [{
      ...input.mappedIngredients[0]!, canonicalIdentityReview: canonicalIdentityReview("MAT-OTHER", "chemical-a"),
    }] })[0]!;
    expect(reviewForDifferentMaterial.dosageGuidance).toBeUndefined();
    expect(reviewForDifferentMaterial.formula).toEqual(withoutGuidance!.formula);
    const functionSpecificContext = {
      ...input.referenceContext!,
      dosageGuidance: [{ ...input.referenceContext!.dosageGuidance[0]!,
        functionAssignment: "reviewed" as const, canonicalFunctionId: "anionic_surfactant" }],
    };
    const unresolvedFunction = generateCandidates({ ...input, referenceContext: functionSpecificContext })[0]!;
    expect(unresolvedFunction.dosageGuidance).toBeUndefined();
    expect(unresolvedFunction.formula).toEqual(withoutGuidance!.formula);
    const tamperedContext = {
      ...input.referenceContext!,
      dosageGuidance: [{ ...input.referenceContext!.dosageGuidance[0]!, formulaCount: 2 }],
    };
    expect(() => generateCandidates({ ...input, referenceContext: tamperedContext })).toThrow();
    const unsupportedChemistryContext = {
      ...input.referenceContext!,
      dosageGuidance: [{ ...input.referenceContext!.dosageGuidance[0]!, canonicalChemistryId: "chemical-unmatched" }],
    };
    expect(() => generateCandidates({ ...input, referenceContext: unsupportedChemistryContext })).toThrow();
  });

  it("returns an explicit empty-formula fallback rather than fabricating a candidate for no mapped ingredients", () => {
    const candidates = generateCandidates(baseInput({ mappedIngredients: [] }));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].formula).toEqual([]);
    expect(candidates[0].matchScore).toBe(0);
  });

  it("is deterministic: identical input produces identical candidates and ordering", () => {
    const input = baseInput();
    const first = generateCandidates(input);
    const second = generateCandidates(input);
    expect(second).toEqual(first);
  });

  it("assigns finite, non-negative percentages that do not exceed 100 per line", () => {
    const candidates = generateCandidates(baseInput());
    for (const c of candidates) {
      for (const line of c.formula) {
        expect(Number.isFinite(line.percentage)).toBe(true);
        expect(line.percentage).toBeGreaterThanOrEqual(0);
        expect(line.percentage).toBeLessThanOrEqual(100);
      }
    }
  });

  it("respects the expected total: the declared-order candidate sums to 100%", () => {
    const candidates = generateCandidates(baseInput());
    const total = candidates[0].formula.reduce((sum, l) => sum + l.percentage, 0);
    expect(total).toBeCloseTo(100, 1);
  });

  it("does not convert a blank concentration hint to a literal 0% when budget remains", () => {
    const mat2 = material({ code: "MAT-002", displayName: "Cocamidopropyl Betaine", functions: ["amphoteric_surfactant"] });
    const input = baseInput({
      mappedIngredients: [
        { line: declLine({ concentrationHint: undefined }), mapping: mapping({ material: material() }) },
        {
          line: declLine({ id: "line-2", declaredName: "Cocamidopropyl Betaine", declaredOrder: 1, concentrationHint: "" }),
          mapping: mapping({ material: mat2 }),
        },
      ],
      availableMaterials: [material(), mat2],
    });
    const [candidate] = generateCandidates(input);
    for (const line of candidate.formula) {
      expect(line.percentage).toBeGreaterThan(0);
    }
  });

  it("keeps unmapped ingredients explicit: an unmatched line contributes nothing to the formula", () => {
    const mat2 = material({ code: "MAT-002", displayName: "Fragrance", functions: ["fragrance"] });
    const input = baseInput({
      mappedIngredients: [
        { line: declLine(), mapping: mapping({ material: material() }) },
        {
          line: declLine({ id: "line-2", declaredName: "Unknown Compound", declaredOrder: 1 }),
          mapping: { material: null, confidence: 0, reason: "No matching candidates found.", alternatives: [] },
        },
      ],
      availableMaterials: [material(), mat2],
    });
    const [candidate] = generateCandidates(input);
    expect(candidate.formula.every(l => l.materialId === "MAT-001")).toBe(true);
  });

  it("does not fabricate a candidate when analytical data is absent, and does not claim an analytical basis", () => {
    const candidates = generateCandidates(baseInput({ analysis: EMPTY_ANALYSIS }));
    for (const c of candidates) {
      expect(c.notes.join(" ")).not.toMatch(/analytical data/i);
    }
  });

  it("drops a duplicate/equivalent candidate deterministically instead of listing it twice", () => {
    const input = baseInput({ analysis: WITH_ANALYSIS });
    const candidates = generateCandidates(input);
    const signatures = candidates.map(c =>
      c.formula.map(l => `${l.materialId}:${l.percentage}`).sort().join("|")
    );
    expect(new Set(signatures).size).toBe(signatures.length);
    // Deterministic across repeated calls with the same input.
    expect(generateCandidates(input)).toEqual(candidates);
  });

  it("rejects an impossible candidate safely when constraints exclude every available material", () => {
    const input = baseInput({
      constraints: { ...CONSTRAINTS, excludedMaterials: ["MAT-001"] },
    });
    const candidates = generateCandidates(input);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].formula).toEqual([]);
    expect(candidates[0].notes.join(" ")).toMatch(/excluded/i);
  });

  it("rejects a candidate that cannot satisfy a required material safely, instead of returning a misleading formula", () => {
    const input = baseInput({
      constraints: { ...CONSTRAINTS, requiredMaterials: ["MAT-DOES-NOT-EXIST"] },
    });
    const candidates = generateCandidates(input);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].formula).toEqual([]);
  });

  it("handles a multi-word, duplicate-order-safe declaration without throwing", () => {
    const mat2 = material({ code: "MAT-002", displayName: "Cocamidopropyl Betaine", functions: ["amphoteric_surfactant"] });
    const input = baseInput({
      mappedIngredients: [
        { line: declLine(), mapping: mapping({ material: material() }) },
        {
          line: declLine({ id: "line-2", declaredName: "Cocamidopropyl Betaine", declaredOrder: 1 }),
          mapping: mapping({ material: mat2, confidence: 0.8 }),
        },
      ],
      availableMaterials: [material(), mat2],
    });
    expect(() => generateCandidates(input)).not.toThrow();
  });
});
