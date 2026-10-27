import { z } from "zod";
import {
  referenceFormulationIngredientFrequencyPriorsSchema,
  type ReferenceFormulationIngredientFrequencyPriors,
} from "./referenceFormulationIngredientFrequencyPriors";
import {
  referenceFormulationNearestReferencesSchema,
  type ReferenceFormulationNearestReferences,
} from "./referenceFormulationNearestReferences";
import {
  referenceFormulationDosageDistributionsSchema,
  type ReferenceFormulationDosageDistributions,
} from "./referenceFormulationDosageDistributions";
import type { GenerationInput } from "./candidateGenerator";

export const REFERENCE_FORMULATION_GENERATION_CONTEXT_VERSION = "formulab-reference-formulation-generation-context-v2";
const ingredientPriorSchema = z.object({
  canonicalChemistryId: z.string().trim().min(1),
  formulaCount: z.number().int().positive(),
  eligibleFormulaCount: z.number().int().positive(),
  formulaWeightedFrequency: z.number().finite().min(0).max(1),
  supplierNeutralFrequency: z.number().finite().min(0).max(1),
  supplierCount: z.number().int().positive(),
  sourceRecordIds: z.array(z.string().trim().min(1)).min(1),
  supplierMix: z.array(z.object({
    supplierId: z.string().trim().min(1), eligibleFormulaCount: z.number().int().positive(),
    ingredientFormulaCount: z.number().int().nonnegative(), frequency: z.number().finite().min(0).max(1),
    sourceRecordIds: z.array(z.string().trim().min(1)),
  }).strict()),
}).strict().superRefine((ingredient, context) => {
  const supplierSourceIds = ingredient.supplierMix.flatMap((supplier) => supplier.sourceRecordIds);
  const supplierNeutralFrequency = ingredient.supplierMix.length
    ? ingredient.supplierMix.reduce((sum, supplier) => sum + supplier.frequency, 0) / ingredient.supplierMix.length : 0;
  if (ingredient.sourceRecordIds.length !== ingredient.formulaCount
    || new Set(ingredient.sourceRecordIds).size !== ingredient.sourceRecordIds.length
    || ingredient.supplierMix.length !== ingredient.supplierCount
    || ingredient.formulaWeightedFrequency !== ingredient.formulaCount / ingredient.eligibleFormulaCount
    || ingredient.supplierNeutralFrequency !== supplierNeutralFrequency
    || ingredient.supplierMix.reduce((sum, supplier) => sum + supplier.ingredientFormulaCount, 0) !== ingredient.formulaCount
    || new Set(ingredient.supplierMix.map((supplier) => supplier.supplierId)).size !== ingredient.supplierMix.length
    || new Set(supplierSourceIds).size !== supplierSourceIds.length
    || JSON.stringify([...supplierSourceIds].sort()) !== JSON.stringify([...ingredient.sourceRecordIds].sort())
    || ingredient.supplierMix.some((supplier) => supplier.frequency !== supplier.ingredientFormulaCount / supplier.eligibleFormulaCount
      || supplier.sourceRecordIds.length !== supplier.ingredientFormulaCount)) {
    context.addIssue({ code: "custom", path: ["supplierMix"], message: "Generation prior counts must preserve reviewed, supplier-neutral source evidence." });
  }
});
const nearestReferenceContextSchema = z.object({
  sourceRecordId: z.string().trim().min(1), sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  distance: z.number().finite().min(0).max(1), similarity: z.number().finite().min(0).max(1), featureCoverage: z.number().finite().min(0).max(1),
  contributingFeatureKeys: z.array(z.string().trim().min(1)).min(1), evidenceRefs: z.array(z.string().trim().min(1)).min(1),
}).strict().superRefine((reference, context) => {
  if (Math.abs(reference.similarity - (1 - reference.distance)) > 1e-12) {
    context.addIssue({ code: "custom", path: ["similarity"], message: "Reference similarity must be exactly complementary to its distance." });
  }
});
const dosageGuidanceSchema = z.object({
  asOf: z.string().datetime({ offset: true }),
  canonicalChemistryId: z.string().trim().min(1),
  canonicalFunctionId: z.string().trim().min(1).optional(),
  functionAssignment: z.enum(["reviewed", "unassigned_or_unreviewed"]),
  formulaCount: z.number().int().positive(),
  supplierCount: z.number().int().positive(),
  observedRangePercent: z.object({ lower: z.number().finite().min(0).max(100), upper: z.number().finite().min(0).max(100) }).strict(),
  typicalRangePercent: z.object({ lower: z.number().finite().min(0).max(100), upper: z.number().finite().min(0).max(100) }).strict(),
  medianRangePercent: z.object({ lower: z.number().finite().min(0).max(100), upper: z.number().finite().min(0).max(100) }).strict(),
  suppliers: z.array(z.object({
    supplierId: z.string().trim().min(1), formulaCount: z.number().int().positive(), share: z.number().finite().min(0).max(1),
    sourceRecordIds: z.array(z.string().trim().min(1)).min(1),
  }).strict()).min(1),
  sourceRecordIds: z.array(z.string().trim().min(1)).min(1),
}).strict().superRefine((guidance, context) => {
  if ((guidance.functionAssignment === "reviewed") !== (guidance.canonicalFunctionId !== undefined)
    || guidance.observedRangePercent.lower > guidance.observedRangePercent.upper
    || guidance.typicalRangePercent.lower > guidance.typicalRangePercent.upper
    || guidance.typicalRangePercent.lower < guidance.observedRangePercent.lower
    || guidance.typicalRangePercent.upper > guidance.observedRangePercent.upper
    || guidance.medianRangePercent.lower > guidance.medianRangePercent.upper
    || guidance.medianRangePercent.lower < guidance.typicalRangePercent.lower
    || guidance.medianRangePercent.lower > guidance.typicalRangePercent.upper
    || guidance.medianRangePercent.upper < guidance.typicalRangePercent.lower
    || guidance.medianRangePercent.upper > guidance.typicalRangePercent.upper
    || guidance.sourceRecordIds.length !== guidance.formulaCount
    || new Set(guidance.sourceRecordIds).size !== guidance.sourceRecordIds.length
    || guidance.suppliers.reduce((sum, supplier) => sum + supplier.formulaCount, 0) !== guidance.formulaCount
    || guidance.suppliers.some((supplier) => supplier.share !== supplier.formulaCount / guidance.formulaCount
      || supplier.sourceRecordIds.length !== supplier.formulaCount || new Set(supplier.sourceRecordIds).size !== supplier.sourceRecordIds.length)
    || JSON.stringify(guidance.suppliers.flatMap((supplier) => supplier.sourceRecordIds).sort()) !== JSON.stringify([...guidance.sourceRecordIds].sort())
    || new Set(guidance.suppliers.map((supplier) => supplier.supplierId)).size !== guidance.suppliers.length) {
    context.addIssue({ code: "custom", path: ["sourceRecordIds"], message: "Dosage guidance must preserve its observed bounds, formula counts, supplier mix and unique source evidence." });
  }
});
export const referenceFormulationGenerationContextSchema = z.object({
  schemaVersion: z.literal(REFERENCE_FORMULATION_GENERATION_CONTEXT_VERSION),
  available: z.boolean(),
  unavailableReason: z.enum(["no_eligible_family_prior"]).optional(),
  productFamilyKey: z.string().trim().min(1),
  asOf: z.string().datetime({ offset: true }),
  eligibleFormulaCount: z.number().int().nonnegative(),
  supplierCount: z.number().int().nonnegative(),
  ingredientPriors: z.array(ingredientPriorSchema),
  nearestReferences: z.array(nearestReferenceContextSchema),
  dosageGuidance: z.array(dosageGuidanceSchema),
  dosageGuidanceAvailable: z.boolean(),
  dosageGuidanceUnavailableReason: z.enum(["no_reviewed_family_dosage"]).optional(),
  interpretation: z.literal("advisory_supplier_neutral_reference_context_not_truth_or_approval"),
}).strict().superRefine((contextValue, context) => {
  if ((contextValue.available && contextValue.unavailableReason !== undefined)
    || (contextValue.available && (contextValue.eligibleFormulaCount === 0 || contextValue.supplierCount === 0))
    || (!contextValue.available && (contextValue.unavailableReason === undefined || contextValue.eligibleFormulaCount !== 0
      || contextValue.supplierCount !== 0 || contextValue.ingredientPriors.length !== 0 || contextValue.nearestReferences.length !== 0))
    || new Set(contextValue.ingredientPriors.map((prior) => prior.canonicalChemistryId)).size !== contextValue.ingredientPriors.length
    || contextValue.ingredientPriors.some((prior) => prior.eligibleFormulaCount !== contextValue.eligibleFormulaCount
      || prior.supplierCount !== contextValue.supplierCount
      || prior.supplierMix.reduce((sum, supplier) => sum + supplier.eligibleFormulaCount, 0) !== contextValue.eligibleFormulaCount)
    || new Set(contextValue.nearestReferences.map((reference) => reference.sourceRecordId)).size !== contextValue.nearestReferences.length
    || (contextValue.dosageGuidanceAvailable !== (contextValue.dosageGuidance.length > 0))
    || (contextValue.dosageGuidanceAvailable === (contextValue.dosageGuidanceUnavailableReason !== undefined))
    || new Set(contextValue.dosageGuidance.map((guidance) => `${guidance.canonicalChemistryId}\u0000${guidance.canonicalFunctionId ?? ""}`)).size !== contextValue.dosageGuidance.length
    || contextValue.dosageGuidance.some((guidance) => {
      const prior = contextValue.ingredientPriors.find((item) => item.canonicalChemistryId === guidance.canonicalChemistryId);
      return !prior || guidance.sourceRecordIds.some((sourceRecordId) => !prior.sourceRecordIds.includes(sourceRecordId))
        || guidance.suppliers.some((supplier) => {
          const priorSupplier = prior.supplierMix.find((item) => item.supplierId === supplier.supplierId);
          return !priorSupplier || supplier.sourceRecordIds.some((sourceRecordId) => !priorSupplier.sourceRecordIds.includes(sourceRecordId));
        });
    })) {
    context.addIssue({ code: "custom", path: ["ingredientPriors"], message: "Generator reference context must be complete, unique, and accurately marked available or unavailable." });
  }
});
export type ReferenceFormulationGenerationContext = z.infer<typeof referenceFormulationGenerationContextSchema>;

/** Adapt accepted corpus prior and nearest-reference results into an explicit optional context for the existing generator. */
export function createReferenceFormulationGenerationContext(input: {
  productFamilyKey: string;
  ingredientPriors: ReferenceFormulationIngredientFrequencyPriors;
  nearestReferences: ReferenceFormulationNearestReferences;
  dosageDistributions?: ReferenceFormulationDosageDistributions;
}): ReferenceFormulationGenerationContext {
  const productFamilyKey = input.productFamilyKey.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
  if (!productFamilyKey) throw new Error("A canonical product family key is required for generator reference context.");
  const priors = referenceFormulationIngredientFrequencyPriorsSchema.parse(input.ingredientPriors);
  const nearest = referenceFormulationNearestReferencesSchema.parse(input.nearestReferences);
  const dosage = input.dosageDistributions
    ? referenceFormulationDosageDistributionsSchema.parse(input.dosageDistributions)
    : undefined;
  if (nearest.productFamilyKey !== productFamilyKey) throw new Error("Nearest references must be retrieved for the requested canonical product family.");
  const family = priors.productFamilies.find((item) => item.productFamilyKey === productFamilyKey);
  const eligibleDosageSourceIdsByFamily = dosage?.eligibleSourceRecordIdsByProductFamily ?? {};
  if (dosage && family) {
    const dosageFamilySourceIds = eligibleDosageSourceIdsByFamily[productFamilyKey] ?? [];
    const priorFamilySourceIds = family.suppliers.flatMap((supplier) => supplier.sourceRecordIds).sort();
    if (JSON.stringify([...dosageFamilySourceIds].sort()) !== JSON.stringify(priorFamilySourceIds)) {
      throw new Error("Dosage and ingredient guidance must use the same eligible reviewed family corpus.");
    }
  }
  const dosageGuidance = (family ? dosage?.distributions ?? [] : [])
    .map((sample) => {
      const eligibleDosageSourceIds = new Set(eligibleDosageSourceIdsByFamily[sample.productFamilyKey] ?? []);
      if (sample.sourceRecordIds.some((sourceRecordId) => !eligibleDosageSourceIds.has(sourceRecordId))) {
        throw new Error("Dosage guidance must be bound to eligible reviewed reference source records.");
      }
      if (sample.productFamilyKey !== productFamilyKey) return undefined;
      return {
        asOf: dosage!.asOf,
        canonicalChemistryId: sample.canonicalChemistryId,
        ...(sample.canonicalFunctionId ? { canonicalFunctionId: sample.canonicalFunctionId } : {}),
        functionAssignment: sample.functionAssignment,
        formulaCount: sample.formulaCount,
        supplierCount: sample.supplierCount,
        observedRangePercent: { lower: sample.minimumLowerBound, upper: sample.maximumUpperBound },
        typicalRangePercent: { lower: sample.lowerBoundQuantiles.p25, upper: sample.upperBoundQuantiles.p75 },
        medianRangePercent: { lower: sample.lowerBoundQuantiles.p50, upper: sample.upperBoundQuantiles.p50 },
        suppliers: sample.suppliers,
        sourceRecordIds: sample.sourceRecordIds,
      };
    }).filter((sample): sample is NonNullable<typeof sample> => sample !== undefined);
  const dosageGuidanceAvailable = dosageGuidance.length > 0;
  if (!family) {
    return referenceFormulationGenerationContextSchema.parse({
      schemaVersion: REFERENCE_FORMULATION_GENERATION_CONTEXT_VERSION, available: false, unavailableReason: "no_eligible_family_prior",
      productFamilyKey, asOf: priors.asOf, eligibleFormulaCount: 0, supplierCount: 0, ingredientPriors: [], nearestReferences: [],
      dosageGuidance, dosageGuidanceAvailable, ...(!dosageGuidanceAvailable ? { dosageGuidanceUnavailableReason: "no_reviewed_family_dosage" as const } : {}),
      interpretation: "advisory_supplier_neutral_reference_context_not_truth_or_approval",
    });
  }
  return referenceFormulationGenerationContextSchema.parse({
    schemaVersion: REFERENCE_FORMULATION_GENERATION_CONTEXT_VERSION, available: true, productFamilyKey, asOf: priors.asOf,
    eligibleFormulaCount: family.eligibleFormulaCount, supplierCount: family.supplierCount,
    ingredientPriors: family.ingredients.map((ingredient) => ({
      canonicalChemistryId: ingredient.canonicalChemistryId, formulaCount: ingredient.formulaCount,
      eligibleFormulaCount: family.eligibleFormulaCount,
      formulaWeightedFrequency: ingredient.frequency, supplierNeutralFrequency: ingredient.supplierNeutral.pooledFrequency,
      supplierCount: ingredient.supplierNeutral.supplierCount, sourceRecordIds: ingredient.sourceRecordIds,
      supplierMix: ingredient.supplierNeutral.suppliers.map((supplier) => ({
        supplierId: supplier.supplierId, eligibleFormulaCount: supplier.eligibleFormulaCount,
        ingredientFormulaCount: supplier.ingredientFormulaCount, frequency: supplier.frequency, sourceRecordIds: supplier.sourceRecordIds,
      })),
    })),
    nearestReferences: nearest.references.map((reference) => ({
      sourceRecordId: reference.sourceRecordId, sourceDocumentHash: reference.sourceDocumentHash,
      distance: reference.distance, similarity: reference.similarity, featureCoverage: reference.featureCoverage,
      contributingFeatureKeys: reference.contributingFeatures.map((feature) => feature.featureKey), evidenceRefs: reference.evidenceRefs,
    })),
    dosageGuidance, dosageGuidanceAvailable, ...(!dosageGuidanceAvailable ? { dosageGuidanceUnavailableReason: "no_reviewed_family_dosage" as const } : {}),
    interpretation: "advisory_supplier_neutral_reference_context_not_truth_or_approval",
  });
}

/** Attach validated reference context without mutating the caller's generation input or creating a second generator. */
export function adaptGenerationInputWithReferenceContext(
  input: GenerationInput,
  referenceContext: ReferenceFormulationGenerationContext,
): GenerationInput {
  return { ...input, referenceContext: referenceFormulationGenerationContextSchema.parse(referenceContext) };
}
