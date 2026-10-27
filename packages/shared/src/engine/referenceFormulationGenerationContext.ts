import { z } from "zod";
import {
  referenceFormulationIngredientFrequencyPriorsSchema,
  type ReferenceFormulationIngredientFrequencyPriors,
} from "./referenceFormulationIngredientFrequencyPriors";
import {
  referenceFormulationNearestReferencesSchema,
  type ReferenceFormulationNearestReferences,
} from "./referenceFormulationNearestReferences";
import type { GenerationInput } from "./candidateGenerator";

export const REFERENCE_FORMULATION_GENERATION_CONTEXT_VERSION = "formulab-reference-formulation-generation-context-v1";
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
    || new Set(contextValue.nearestReferences.map((reference) => reference.sourceRecordId)).size !== contextValue.nearestReferences.length) {
    context.addIssue({ code: "custom", path: ["ingredientPriors"], message: "Generator reference context must be complete, unique, and accurately marked available or unavailable." });
  }
});
export type ReferenceFormulationGenerationContext = z.infer<typeof referenceFormulationGenerationContextSchema>;

/** Adapt accepted corpus prior and nearest-reference results into an explicit optional context for the existing generator. */
export function createReferenceFormulationGenerationContext(input: {
  productFamilyKey: string;
  ingredientPriors: ReferenceFormulationIngredientFrequencyPriors;
  nearestReferences: ReferenceFormulationNearestReferences;
}): ReferenceFormulationGenerationContext {
  const productFamilyKey = input.productFamilyKey.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
  if (!productFamilyKey) throw new Error("A canonical product family key is required for generator reference context.");
  const priors = referenceFormulationIngredientFrequencyPriorsSchema.parse(input.ingredientPriors);
  const nearest = referenceFormulationNearestReferencesSchema.parse(input.nearestReferences);
  if (nearest.productFamilyKey !== productFamilyKey) throw new Error("Nearest references must be retrieved for the requested canonical product family.");
  const family = priors.productFamilies.find((item) => item.productFamilyKey === productFamilyKey);
  if (!family) {
    return referenceFormulationGenerationContextSchema.parse({
      schemaVersion: REFERENCE_FORMULATION_GENERATION_CONTEXT_VERSION, available: false, unavailableReason: "no_eligible_family_prior",
      productFamilyKey, asOf: priors.asOf, eligibleFormulaCount: 0, supplierCount: 0, ingredientPriors: [], nearestReferences: [],
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
