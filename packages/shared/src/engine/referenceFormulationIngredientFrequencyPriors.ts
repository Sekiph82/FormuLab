import { z } from "zod";
import type { ReferenceFormulationQueryRecord } from "../schemas/referenceFormulationQuery";
import type { ReferenceFormulationRecord } from "../schemas/referenceFormulationRecord";
import type { ReferenceFormulationReview } from "../schemas/referenceFormulationReview";
import {
  filterEligibleReferenceFormulationCorpus,
  referenceFormulationEligibilityDecisionSchema,
} from "./referenceFormulationEligibility";

export const REFERENCE_FORMULATION_INGREDIENT_PRIOR_VERSION = "formulab-reference-formulation-ingredient-frequency-prior-v1";

const supplierMixSchema = z.object({
  supplierId: z.string().trim().min(1),
  formulaCount: z.number().int().positive(),
  familyShare: z.number().finite().min(0).max(1),
}).strict();

const ingredientSchema = z.object({
  canonicalChemistryId: z.string().trim().min(1),
  formulaCount: z.number().int().positive(),
  frequency: z.number().finite().min(0).max(1),
  supplierCount: z.number().int().positive(),
  suppliers: z.array(z.object({
    supplierId: z.string().trim().min(1),
    formulaCount: z.number().int().positive(),
    familyShare: z.number().finite().min(0).max(1),
    ingredientShare: z.number().finite().min(0).max(1),
  }).strict()),
  sourceRecordIds: z.array(z.string().trim().min(1)),
}).strict().superRefine((ingredient, context) => {
  if (ingredient.sourceRecordIds.length !== ingredient.formulaCount
    || new Set(ingredient.sourceRecordIds).size !== ingredient.sourceRecordIds.length
    || ingredient.suppliers.length !== ingredient.supplierCount
    || ingredient.suppliers.reduce((total, supplier) => total + supplier.formulaCount, 0) !== ingredient.formulaCount
    || ingredient.suppliers.some((supplier) => supplier.ingredientShare !== supplier.formulaCount / ingredient.formulaCount)) {
    context.addIssue({ code: "custom", path: ["suppliers"], message: "Ingredient counts, supplier mix and supporting source IDs must agree." });
  }
});

export const referenceFormulationIngredientFrequencyPriorsSchema = z.object({
  schemaVersion: z.literal(REFERENCE_FORMULATION_INGREDIENT_PRIOR_VERSION),
  asOf: z.string().datetime({ offset: true }),
  eligibleFormulaCount: z.number().int().nonnegative(),
  excludedFormulaCount: z.number().int().nonnegative(),
  eligibilityDecisions: z.array(referenceFormulationEligibilityDecisionSchema),
  productFamilies: z.array(z.object({
    productFamilyKey: z.string().trim().min(1),
    productFamilyLabel: z.string().trim().min(1),
    eligibleFormulaCount: z.number().int().positive(),
    supplierCount: z.number().int().positive(),
    suppliers: z.array(supplierMixSchema),
    ingredients: z.array(ingredientSchema),
  }).strict()),
}).strict().superRefine((priors, context) => {
  if (priors.eligibleFormulaCount + priors.excludedFormulaCount !== priors.eligibilityDecisions.length
    || priors.eligibleFormulaCount !== priors.eligibilityDecisions.filter((decision) => decision.eligible).length
    || priors.excludedFormulaCount !== priors.eligibilityDecisions.filter((decision) => !decision.eligible).length) {
    context.addIssue({ code: "custom", path: ["eligibilityDecisions"], message: "Corpus totals must match the recorded eligibility decisions." });
  }
  for (const [index, family] of priors.productFamilies.entries()) {
    if (family.suppliers.length !== family.supplierCount
      || family.suppliers.reduce((total, supplier) => total + supplier.formulaCount, 0) !== family.eligibleFormulaCount
      || family.suppliers.some((supplier) => supplier.familyShare !== supplier.formulaCount / family.eligibleFormulaCount)
      || family.ingredients.some((ingredient) => ingredient.formulaCount > family.eligibleFormulaCount
        || ingredient.frequency !== ingredient.formulaCount / family.eligibleFormulaCount)) {
      context.addIssue({ code: "custom", path: ["productFamilies", index], message: "Family frequencies and supplier mix must use the eligible formula sample as denominator." });
    }
  }
});

export type ReferenceFormulationIngredientFrequencyPriors = z.infer<typeof referenceFormulationIngredientFrequencyPriorsSchema>;

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedKey(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

/** Calculate deterministic formula-presence priors only from the latest human-reviewed, rights-eligible corpus snapshots. */
export function calculateReferenceFormulationIngredientFrequencyPriors(input: {
  queryRecords: ReferenceFormulationQueryRecord[];
  sourceRecords: ReferenceFormulationRecord[];
  reviews: ReferenceFormulationReview[];
  asOf: string;
}): ReferenceFormulationIngredientFrequencyPriors {
  const eligibility = filterEligibleReferenceFormulationCorpus(input);
  const eligibleById = new Map(eligibility.eligible.map((query) => [query.id, query]));
  const familyRows = new Map<string, {
    label: string;
    formulaIds: Set<string>;
    supplierFormulaCounts: Map<string, number>;
    ingredients: Map<string, { sourceIds: Set<string>; supplierFormulaCounts: Map<string, number> }>;
  }>();

  for (const query of [...eligibleById.values()].sort((left, right) => compareStable(left.sourceRecordId, right.sourceRecordId))) {
    const family = query.productFamily.candidates[0]!;
    const familyKey = normalizedKey(family.rawValue);
    let row = familyRows.get(familyKey);
    if (!row) {
      row = { label: family.rawValue, formulaIds: new Set(), supplierFormulaCounts: new Map(), ingredients: new Map() };
      familyRows.set(familyKey, row);
    }
    row.formulaIds.add(query.sourceRecordId);
    row.supplierFormulaCounts.set(query.supplierId, (row.supplierFormulaCounts.get(query.supplierId) ?? 0) + 1);

    const chemicalIdsInFormula = new Set(query.lines.flatMap((line) => line.canonicalChemistry.candidateIds));
    for (const chemicalId of chemicalIdsInFormula) {
      let ingredient = row.ingredients.get(chemicalId);
      if (!ingredient) {
        ingredient = { sourceIds: new Set(), supplierFormulaCounts: new Map() };
        row.ingredients.set(chemicalId, ingredient);
      }
      if (ingredient.sourceIds.has(query.sourceRecordId)) continue;
      ingredient.sourceIds.add(query.sourceRecordId);
      ingredient.supplierFormulaCounts.set(query.supplierId, (ingredient.supplierFormulaCounts.get(query.supplierId) ?? 0) + 1);
    }
  }

  const productFamilies = [...familyRows.entries()].sort(([left], [right]) => compareStable(left, right)).map(([productFamilyKey, row]) => {
    const eligibleFormulaCount = row.formulaIds.size;
    const suppliers = [...row.supplierFormulaCounts.entries()].sort(([left], [right]) => compareStable(left, right)).map(([supplierId, formulaCount]) => ({
      supplierId, formulaCount, familyShare: formulaCount / eligibleFormulaCount,
    }));
    const ingredients = [...row.ingredients.entries()].sort(([left], [right]) => compareStable(left, right)).map(([canonicalChemistryId, ingredient]) => {
      const formulaCount = ingredient.sourceIds.size;
      const ingredientSuppliers = [...ingredient.supplierFormulaCounts.entries()].sort(([left], [right]) => compareStable(left, right)).map(([supplierId, supplierFormulaCount]) => ({
        supplierId, formulaCount: supplierFormulaCount,
        familyShare: supplierFormulaCount / eligibleFormulaCount,
        ingredientShare: supplierFormulaCount / formulaCount,
      }));
      return {
        canonicalChemistryId, formulaCount, frequency: formulaCount / eligibleFormulaCount,
        supplierCount: ingredientSuppliers.length, suppliers: ingredientSuppliers,
        sourceRecordIds: [...ingredient.sourceIds].sort(compareStable),
      };
    });
    return { productFamilyKey, productFamilyLabel: row.label, eligibleFormulaCount, supplierCount: suppliers.length, suppliers, ingredients };
  });

  return referenceFormulationIngredientFrequencyPriorsSchema.parse({
    schemaVersion: REFERENCE_FORMULATION_INGREDIENT_PRIOR_VERSION,
    asOf: input.asOf,
    eligibleFormulaCount: eligibility.eligible.length,
    excludedFormulaCount: eligibility.excluded.length,
    eligibilityDecisions: eligibility.decisions,
    productFamilies,
  });
}
