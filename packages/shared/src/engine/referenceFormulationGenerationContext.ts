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
import {
  referenceFormulationCooccurrenceResultSchema,
  type ReferenceFormulationCooccurrenceResult,
} from "./referenceFormulationCooccurrence";
import {
  referenceFormulationContributionDistributionsSchema,
  type ReferenceFormulationContributionDistributions,
} from "./referenceFormulationContributionDistributions";
import type { GenerationInput } from "./candidateGenerator";

export const REFERENCE_FORMULATION_GENERATION_CONTEXT_VERSION = "formulab-reference-formulation-generation-context-v4";
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
const cooccurrenceGuidanceSchema = z.object({
  asOf: z.string().datetime({ offset: true }),
  pairKind: z.enum(["material_pair", "function_pair", "material_function_pair", "composition_component_pair"]),
  scope: z.enum(["same_formula", "same_sds_product_composition"]),
  denominatorScope: z.enum(["eligible_formulas_in_family", "eligible_component_formulas_in_family"]),
  firstId: z.string().trim().min(1),
  secondId: z.string().trim().min(1),
  formulaCount: z.number().int().positive(),
  eligibleFormulaCount: z.number().int().positive(),
  frequency: z.number().finite().min(0).max(1),
  supplierCount: z.number().int().positive(),
  suppliers: z.array(z.object({
    supplierId: z.string().trim().min(1), formulaCount: z.number().int().positive(), share: z.number().finite().min(0).max(1),
    sourceRecordIds: z.array(z.string().trim().min(1)).min(1),
  }).strict()).min(1),
  sourceRecordIds: z.array(z.string().trim().min(1)).min(1),
  interpretation: z.literal("empirical_cooccurrence_only"),
  compatibilityEvidence: z.literal(false),
}).strict().superRefine((pair, context) => {
  if (pair.firstId === pair.secondId || pair.formulaCount > pair.eligibleFormulaCount
    || pair.frequency !== pair.formulaCount / pair.eligibleFormulaCount
    || pair.sourceRecordIds.length !== pair.formulaCount || new Set(pair.sourceRecordIds).size !== pair.sourceRecordIds.length
    || pair.suppliers.reduce((sum, supplier) => sum + supplier.formulaCount, 0) !== pair.formulaCount
    || pair.suppliers.some((supplier) => supplier.share !== supplier.formulaCount / pair.formulaCount
      || supplier.sourceRecordIds.length !== supplier.formulaCount || new Set(supplier.sourceRecordIds).size !== supplier.sourceRecordIds.length)
    || JSON.stringify(pair.suppliers.flatMap((supplier) => supplier.sourceRecordIds).sort()) !== JSON.stringify([...pair.sourceRecordIds].sort())
    || (pair.pairKind === "composition_component_pair") !== (pair.scope === "same_sds_product_composition")
    || (pair.pairKind === "composition_component_pair") !== (pair.denominatorScope === "eligible_component_formulas_in_family")) {
    context.addIssue({ code: "custom", path: ["sourceRecordIds"], message: "Co-occurrence guidance must preserve its exact denominator and supplier-attributed source evidence." });
  }
});
const contributionGuidanceSchema = z.object({
  asOf: z.string().datetime({ offset: true }),
  quantityKind: z.enum(["active_matter_claim", "component_contribution"]),
  canonicalChemistryId: z.string().trim().min(1).optional(),
  formulaCount: z.number().int().positive(),
  supplierCount: z.number().int().positive(),
  minimumLowerBound: z.number().finite().min(0).max(100),
  maximumUpperBound: z.number().finite().min(0).max(100),
  lowerBoundQuantiles: z.object({ p25: z.number().finite().min(0).max(100), p50: z.number().finite().min(0).max(100), p75: z.number().finite().min(0).max(100) }).strict(),
  upperBoundQuantiles: z.object({ p25: z.number().finite().min(0).max(100), p50: z.number().finite().min(0).max(100), p75: z.number().finite().min(0).max(100) }).strict(),
  suppliers: z.array(z.object({
    supplierId: z.string().trim().min(1), formulaCount: z.number().int().positive(), share: z.number().finite().min(0).max(1),
    sourceRecordIds: z.array(z.string().trim().min(1)).min(1),
  }).strict()).min(1),
  sourceRecordIds: z.array(z.string().trim().min(1)).min(1),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  interpretation: z.literal("reviewed_source_bounded_distribution"),
}).strict().superRefine((sample, context) => {
  const supplierSourceIds = sample.suppliers.flatMap((supplier) => supplier.sourceRecordIds);
  if ((sample.quantityKind === "component_contribution") !== (sample.canonicalChemistryId !== undefined)
    || sample.suppliers.length !== sample.supplierCount
    || sample.suppliers.reduce((sum, supplier) => sum + supplier.formulaCount, 0) !== sample.formulaCount
    || sample.suppliers.some((supplier) => supplier.share !== supplier.formulaCount / sample.formulaCount
      || supplier.sourceRecordIds.length !== supplier.formulaCount || new Set(supplier.sourceRecordIds).size !== supplier.sourceRecordIds.length)
    || sample.sourceRecordIds.length !== sample.formulaCount || new Set(sample.sourceRecordIds).size !== sample.sourceRecordIds.length
    || new Set(supplierSourceIds).size !== supplierSourceIds.length
    || JSON.stringify([...supplierSourceIds].sort()) !== JSON.stringify([...sample.sourceRecordIds].sort())
    || sample.minimumLowerBound > sample.maximumUpperBound
    || sample.lowerBoundQuantiles.p25 > sample.lowerBoundQuantiles.p50 || sample.lowerBoundQuantiles.p50 > sample.lowerBoundQuantiles.p75
    || sample.upperBoundQuantiles.p25 > sample.upperBoundQuantiles.p50 || sample.upperBoundQuantiles.p50 > sample.upperBoundQuantiles.p75
    || [sample.lowerBoundQuantiles.p25, sample.lowerBoundQuantiles.p50, sample.lowerBoundQuantiles.p75,
      sample.upperBoundQuantiles.p25, sample.upperBoundQuantiles.p50, sample.upperBoundQuantiles.p75]
      .some((value) => value < sample.minimumLowerBound || value > sample.maximumUpperBound)
    || sample.lowerBoundQuantiles.p25 > sample.upperBoundQuantiles.p25
    || sample.lowerBoundQuantiles.p50 > sample.upperBoundQuantiles.p50
    || sample.lowerBoundQuantiles.p75 > sample.upperBoundQuantiles.p75) {
    context.addIssue({ code: "custom", path: ["sourceRecordIds"], message: "Contribution guidance must preserve reviewed bounds, exact supplier source samples and quantity identity." });
  }
});
export const referenceFormulationGenerationContextSchema = z.object({
  schemaVersion: z.literal(REFERENCE_FORMULATION_GENERATION_CONTEXT_VERSION),
  available: z.boolean(),
  unavailableReason: z.enum(["no_eligible_family_prior"]).optional(),
  productFamilyKey: z.string().trim().min(1),
  asOf: z.string().datetime({ offset: true }),
  eligibleFormulaCount: z.number().int().nonnegative(),
  eligibleSourceRecordIds: z.array(z.string().trim().min(1)),
  eligibleSupplierSourceRecordIds: z.record(z.string().trim().min(1), z.array(z.string().trim().min(1))),
  supplierCount: z.number().int().nonnegative(),
  ingredientPriors: z.array(ingredientPriorSchema),
  nearestReferences: z.array(nearestReferenceContextSchema),
  cooccurrenceGuidance: z.array(cooccurrenceGuidanceSchema),
  cooccurrenceGuidanceAvailable: z.boolean(),
  cooccurrenceGuidanceUnavailableReason: z.enum(["no_reviewed_family_cooccurrence"]).optional(),
  contributionGuidance: z.array(contributionGuidanceSchema),
  contributionGuidanceAvailable: z.boolean(),
  contributionGuidanceUnavailableReason: z.enum(["no_reviewed_family_contributions"]).optional(),
  dosageGuidance: z.array(dosageGuidanceSchema),
  dosageGuidanceAvailable: z.boolean(),
  dosageGuidanceUnavailableReason: z.enum(["no_reviewed_family_dosage"]).optional(),
  interpretation: z.literal("advisory_supplier_neutral_reference_context_not_truth_or_approval"),
}).strict().superRefine((contextValue, context) => {
  if ((contextValue.available && contextValue.unavailableReason !== undefined)
    || (contextValue.available && (contextValue.eligibleFormulaCount === 0 || contextValue.supplierCount === 0))
    || (!contextValue.available && (contextValue.unavailableReason === undefined || contextValue.eligibleFormulaCount !== 0
      || contextValue.eligibleSourceRecordIds.length !== 0 || contextValue.supplierCount !== 0 || contextValue.ingredientPriors.length !== 0 || contextValue.nearestReferences.length !== 0))
    || (!contextValue.available && Object.keys(contextValue.eligibleSupplierSourceRecordIds).length !== 0)
    || (contextValue.available && (contextValue.eligibleSourceRecordIds.length !== contextValue.eligibleFormulaCount
      || new Set(contextValue.eligibleSourceRecordIds).size !== contextValue.eligibleSourceRecordIds.length))
    || (contextValue.available && (Object.keys(contextValue.eligibleSupplierSourceRecordIds).length !== contextValue.supplierCount
      || new Set(Object.values(contextValue.eligibleSupplierSourceRecordIds).flat()).size !== contextValue.eligibleFormulaCount
      || JSON.stringify(Object.values(contextValue.eligibleSupplierSourceRecordIds).flat().sort()) !== JSON.stringify([...contextValue.eligibleSourceRecordIds].sort())
      || Object.values(contextValue.eligibleSupplierSourceRecordIds).some((ids) => ids.length === 0 || new Set(ids).size !== ids.length)))
    || new Set(contextValue.ingredientPriors.map((prior) => prior.canonicalChemistryId)).size !== contextValue.ingredientPriors.length
    || contextValue.ingredientPriors.some((prior) => prior.eligibleFormulaCount !== contextValue.eligibleFormulaCount
      || prior.supplierCount !== contextValue.supplierCount
      || prior.supplierMix.reduce((sum, supplier) => sum + supplier.eligibleFormulaCount, 0) !== contextValue.eligibleFormulaCount
      || prior.supplierMix.some((supplier) => supplier.eligibleFormulaCount !== contextValue.eligibleSupplierSourceRecordIds[supplier.supplierId]?.length
        || supplier.sourceRecordIds.some((sourceId) => !contextValue.eligibleSupplierSourceRecordIds[supplier.supplierId]?.includes(sourceId))))
    || new Set(contextValue.nearestReferences.map((reference) => reference.sourceRecordId)).size !== contextValue.nearestReferences.length
    || (contextValue.dosageGuidanceAvailable !== (contextValue.dosageGuidance.length > 0))
    || (contextValue.dosageGuidanceAvailable === (contextValue.dosageGuidanceUnavailableReason !== undefined))
    || new Set(contextValue.dosageGuidance.map((guidance) => `${guidance.canonicalChemistryId}\u0000${guidance.canonicalFunctionId ?? ""}`)).size !== contextValue.dosageGuidance.length
    || (contextValue.cooccurrenceGuidanceAvailable !== (contextValue.cooccurrenceGuidance.length > 0))
    || (contextValue.cooccurrenceGuidanceAvailable === (contextValue.cooccurrenceGuidanceUnavailableReason !== undefined))
    || contextValue.cooccurrenceGuidance.some((pair) => pair.denominatorScope === "eligible_formulas_in_family"
      ? pair.eligibleFormulaCount !== contextValue.eligibleFormulaCount
      : pair.eligibleFormulaCount > contextValue.eligibleFormulaCount)
    || contextValue.cooccurrenceGuidance.some((pair) => pair.sourceRecordIds.some((sourceRecordId) => !contextValue.eligibleSourceRecordIds.includes(sourceRecordId)))
    || (contextValue.contributionGuidanceAvailable !== (contextValue.contributionGuidance.length > 0))
    || (contextValue.contributionGuidanceAvailable === (contextValue.contributionGuidanceUnavailableReason !== undefined))
    || contextValue.contributionGuidance.some((sample) => sample.sourceRecordIds.some((sourceId) => !contextValue.eligibleSourceRecordIds.includes(sourceId))
      || sample.formulaCount > (contextValue.eligibleSupplierSourceRecordIds
        ? Object.values(contextValue.eligibleSupplierSourceRecordIds).flat().length : 0)
      || sample.suppliers.some((supplier) => !contextValue.eligibleSupplierSourceRecordIds[supplier.supplierId]
        || supplier.sourceRecordIds.some((sourceId) => !contextValue.eligibleSupplierSourceRecordIds[supplier.supplierId]!.includes(sourceId))))
    || contextValue.cooccurrenceGuidance.some((pair) => {
      const materialIds = pair.pairKind === "material_pair" ? [pair.firstId, pair.secondId]
        : pair.pairKind === "material_function_pair" ? [pair.firstId, pair.secondId].filter((id) => contextValue.ingredientPriors.some((prior) => prior.canonicalChemistryId === id))
          : [];
      if (pair.pairKind === "material_pair" && materialIds.length !== 2) return true;
      if (pair.pairKind === "material_function_pair" && materialIds.length !== 1) return true;
      return materialIds.some((chemistryId) => {
        const prior = contextValue.ingredientPriors.find((item) => item.canonicalChemistryId === chemistryId);
        return !prior || pair.sourceRecordIds.some((sourceRecordId) => !prior.sourceRecordIds.includes(sourceRecordId))
          || pair.suppliers.some((supplier) => {
            const priorSupplier = prior.supplierMix.find((item) => item.supplierId === supplier.supplierId);
            return !priorSupplier || supplier.sourceRecordIds.some((sourceRecordId) => !priorSupplier.sourceRecordIds.includes(sourceRecordId));
          });
      });
    })
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
  cooccurrence?: ReferenceFormulationCooccurrenceResult;
  contributionDistributions?: ReferenceFormulationContributionDistributions;
}): ReferenceFormulationGenerationContext {
  const productFamilyKey = input.productFamilyKey.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
  if (!productFamilyKey) throw new Error("A canonical product family key is required for generator reference context.");
  const priors = referenceFormulationIngredientFrequencyPriorsSchema.parse(input.ingredientPriors);
  const nearest = referenceFormulationNearestReferencesSchema.parse(input.nearestReferences);
  const dosage = input.dosageDistributions
    ? referenceFormulationDosageDistributionsSchema.parse(input.dosageDistributions)
    : undefined;
  const cooccurrence = input.cooccurrence
    ? referenceFormulationCooccurrenceResultSchema.parse(input.cooccurrence)
    : undefined;
  const contributions = input.contributionDistributions
    ? referenceFormulationContributionDistributionsSchema.parse(input.contributionDistributions)
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
  const familySourceRecordIds = family?.suppliers.flatMap((supplier) => supplier.sourceRecordIds).sort() ?? [];
  if (cooccurrence && family) {
    const cooccurrenceFamilySourceIds = cooccurrence.eligibleSourceRecordIdsByProductFamily[productFamilyKey] ?? [];
    if (JSON.stringify([...cooccurrenceFamilySourceIds].sort()) !== JSON.stringify(familySourceRecordIds)) {
      throw new Error("Co-occurrence and ingredient guidance must use the same eligible reviewed family corpus.");
    }
  }
  const familyEligibleSourceIds = contributions?.eligibleSourceRecordIdsByProductFamily[productFamilyKey] ?? [];
  if (contributions && family && JSON.stringify([...familyEligibleSourceIds].sort()) !== JSON.stringify(familySourceRecordIds)) {
    throw new Error("Contribution and ingredient guidance must use the same eligible reviewed family corpus.");
  }
  const contributionGuidance = (family ? contributions?.distributions ?? [] : [])
    .filter((sample) => sample.productFamilyKey === productFamilyKey)
    .map((sample) => ({
      asOf: contributions!.asOf,
      quantityKind: sample.quantityKind,
      ...(sample.canonicalChemistryId ? { canonicalChemistryId: sample.canonicalChemistryId } : {}),
      formulaCount: sample.formulaCount,
      supplierCount: sample.supplierCount,
      minimumLowerBound: sample.minimumLowerBound,
      maximumUpperBound: sample.maximumUpperBound,
      lowerBoundQuantiles: sample.lowerBoundQuantiles,
      upperBoundQuantiles: sample.upperBoundQuantiles,
      suppliers: sample.suppliers,
      sourceRecordIds: sample.sourceRecordIds,
      evidenceRefs: sample.evidenceRefs,
      interpretation: sample.interpretation,
    }));
  const contributionGuidanceAvailable = contributionGuidance.length > 0;
  const cooccurrenceGuidance = (family ? cooccurrence?.cooccurrences ?? [] : [])
    .filter((pair) => pair.productFamilyKey === productFamilyKey)
    .map((pair) => ({
      asOf: cooccurrence!.asOf,
      pairKind: pair.pairKind,
      scope: pair.scope,
      denominatorScope: pair.denominatorScope,
      firstId: pair.firstId,
      secondId: pair.secondId,
      formulaCount: pair.formulaCount,
      eligibleFormulaCount: pair.eligibleFormulaCount,
      frequency: pair.frequency,
      supplierCount: pair.supplierCount,
      suppliers: pair.suppliers,
      sourceRecordIds: pair.sourceRecordIds,
      interpretation: pair.interpretation,
      compatibilityEvidence: pair.compatibilityEvidence,
    }));
  const cooccurrenceGuidanceAvailable = cooccurrenceGuidance.length > 0;
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
      productFamilyKey, asOf: priors.asOf, eligibleFormulaCount: 0, eligibleSourceRecordIds: [], eligibleSupplierSourceRecordIds: {}, supplierCount: 0, ingredientPriors: [], nearestReferences: [],
      cooccurrenceGuidance, cooccurrenceGuidanceAvailable,
      ...(!cooccurrenceGuidanceAvailable ? { cooccurrenceGuidanceUnavailableReason: "no_reviewed_family_cooccurrence" as const } : {}),
      contributionGuidance, contributionGuidanceAvailable,
      ...(!contributionGuidanceAvailable ? { contributionGuidanceUnavailableReason: "no_reviewed_family_contributions" as const } : {}),
      dosageGuidance, dosageGuidanceAvailable, ...(!dosageGuidanceAvailable ? { dosageGuidanceUnavailableReason: "no_reviewed_family_dosage" as const } : {}),
      interpretation: "advisory_supplier_neutral_reference_context_not_truth_or_approval",
    });
  }
  return referenceFormulationGenerationContextSchema.parse({
    schemaVersion: REFERENCE_FORMULATION_GENERATION_CONTEXT_VERSION, available: true, productFamilyKey, asOf: priors.asOf,
    eligibleFormulaCount: family.eligibleFormulaCount, eligibleSourceRecordIds: familySourceRecordIds,
    eligibleSupplierSourceRecordIds: Object.fromEntries(family.suppliers.map((supplier) => [supplier.supplierId, supplier.sourceRecordIds])), supplierCount: family.supplierCount,
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
    cooccurrenceGuidance, cooccurrenceGuidanceAvailable,
    ...(!cooccurrenceGuidanceAvailable ? { cooccurrenceGuidanceUnavailableReason: "no_reviewed_family_cooccurrence" as const } : {}),
    contributionGuidance, contributionGuidanceAvailable,
    ...(!contributionGuidanceAvailable ? { contributionGuidanceUnavailableReason: "no_reviewed_family_contributions" as const } : {}),
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
