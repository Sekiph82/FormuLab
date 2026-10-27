import { z } from "zod";
import type { ReferenceFormulationQueryRecord } from "../schemas/referenceFormulationQuery";
import type { ReferenceFormulationRecord } from "../schemas/referenceFormulationRecord";
import type { ReferenceFormulationReview } from "../schemas/referenceFormulationReview";
import {
  filterEligibleReferenceFormulationCorpus,
  referenceFormulationEligibilityDecisionSchema,
} from "./referenceFormulationEligibility";

export const REFERENCE_FORMULATION_INGREDIENT_PRIOR_VERSION = "formulab-reference-formulation-ingredient-frequency-prior-v2";

const supplierMixSchema = z.object({
  supplierId: z.string().trim().min(1),
  formulaCount: z.number().int().positive(),
  familyShare: z.number().finite().min(0).max(1),
  sourceRecordIds: z.array(z.string().trim().min(1)),
}).strict();

const ingredientSchema = z.object({
  canonicalChemistryId: z.string().trim().min(1),
  formulaCount: z.number().int().positive(),
  frequency: z.number().finite().min(0).max(1),
  frequencyWeighting: z.literal("formula_weighted_corpus"),
  supplierNeutral: z.object({
    weighting: z.literal("equal_supplier"), supplierCount: z.number().int().positive(),
    interpretation: z.literal("equal_supplier_mean_of_supplier_formula_prevalence"),
    pooledFrequency: z.number().finite().min(0).max(1),
    suppliers: z.array(z.object({
      supplierId: z.string().trim().min(1), eligibleFormulaCount: z.number().int().positive(),
      ingredientFormulaCount: z.number().int().nonnegative(), frequency: z.number().finite().min(0).max(1),
      equalSupplierWeight: z.number().finite().gt(0).lte(1), sourceRecordIds: z.array(z.string().trim().min(1)),
    }).strict()),
  }).strict(),
  supplierCount: z.number().int().positive(),
  suppliers: z.array(z.object({
    supplierId: z.string().trim().min(1),
    formulaCount: z.number().int().positive(),
    familyShare: z.number().finite().min(0).max(1),
    ingredientShare: z.number().finite().min(0).max(1),
  }).strict()),
  sourceRecordIds: z.array(z.string().trim().min(1)),
}).strict().superRefine((ingredient, context) => {
  const supplierCount = ingredient.supplierNeutral.suppliers.length;
  const pooledFrequency = supplierCount === 0 ? 0 : ingredient.supplierNeutral.suppliers.reduce((sum, item) => sum + item.frequency, 0) / supplierCount;
  if (ingredient.sourceRecordIds.length !== ingredient.formulaCount
    || new Set(ingredient.sourceRecordIds).size !== ingredient.sourceRecordIds.length
    || ingredient.suppliers.length !== ingredient.supplierCount
    || new Set(ingredient.suppliers.map((supplier) => supplier.supplierId)).size !== ingredient.suppliers.length
    || ingredient.suppliers.reduce((total, supplier) => total + supplier.formulaCount, 0) !== ingredient.formulaCount
    || ingredient.suppliers.some((supplier) => supplier.ingredientShare !== supplier.formulaCount / ingredient.formulaCount)
    || supplierCount !== ingredient.supplierNeutral.supplierCount || ingredient.supplierNeutral.pooledFrequency !== pooledFrequency
    || ingredient.supplierNeutral.suppliers.some((supplier) => supplier.sourceRecordIds.length !== supplier.ingredientFormulaCount
      || new Set(supplier.sourceRecordIds).size !== supplier.ingredientFormulaCount
      || supplier.frequency !== supplier.ingredientFormulaCount / supplier.eligibleFormulaCount
      || supplier.equalSupplierWeight !== 1 / supplierCount)) {
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
  }).strict().superRefine((family, context) => {
    const supplierIds = family.suppliers.map((supplier) => supplier.supplierId).sort(compareStable);
    const familySourceIds = family.suppliers.flatMap((supplier) => supplier.sourceRecordIds);
    if (new Set(supplierIds).size !== supplierIds.length
      || family.suppliers.some((supplier) => supplier.sourceRecordIds.length !== supplier.formulaCount
        || new Set(supplier.sourceRecordIds).size !== supplier.formulaCount)
      || new Set(familySourceIds).size !== familySourceIds.length) {
      context.addIssue({ code: "custom", path: ["suppliers"], message: "Family supplier source IDs must be unique, disjoint, and match supplier formula counts." });
    }
    for (const [index, ingredient] of family.ingredients.entries()) {
      const supplierRows = ingredient.supplierNeutral.suppliers;
      const supplierNeutralIds = supplierRows.map((supplier) => supplier.supplierId).sort(compareStable);
      const presentSupplierIds = supplierRows.filter((supplier) => supplier.ingredientFormulaCount > 0).map((supplier) => supplier.supplierId).sort(compareStable);
      const ingredientSupplierIds = ingredient.suppliers.map((supplier) => supplier.supplierId).sort(compareStable);
      const flattenedSourceIds = supplierRows.flatMap((supplier) => supplier.sourceRecordIds);
      const presentSupplierRows = supplierRows.filter((supplier) => supplier.ingredientFormulaCount > 0);
      const supplierMixById = new Map(ingredient.suppliers.map((supplier) => [supplier.supplierId, supplier]));
      if (new Set(supplierIds).size !== supplierIds.length || ingredient.supplierNeutral.supplierCount !== family.supplierCount
        || new Set(supplierNeutralIds).size !== supplierNeutralIds.length || JSON.stringify(supplierNeutralIds) !== JSON.stringify(supplierIds)
        || JSON.stringify(presentSupplierIds) !== JSON.stringify(ingredientSupplierIds)
        || supplierRows.some((supplier) => family.suppliers.find((item) => item.supplierId === supplier.supplierId)?.formulaCount !== supplier.eligibleFormulaCount)
        || flattenedSourceIds.length !== new Set(flattenedSourceIds).size
        || JSON.stringify([...new Set(flattenedSourceIds)].sort(compareStable)) !== JSON.stringify([...ingredient.sourceRecordIds].sort(compareStable))
        || supplierRows.reduce((sum, supplier) => sum + supplier.ingredientFormulaCount, 0) !== ingredient.formulaCount
        || presentSupplierRows.length !== ingredient.suppliers.length
        || presentSupplierRows.some((supplier) => {
          const mix = supplierMixById.get(supplier.supplierId);
          return !mix || mix.formulaCount !== supplier.ingredientFormulaCount
            || mix.familyShare !== supplier.ingredientFormulaCount / family.eligibleFormulaCount
            || mix.ingredientShare !== supplier.ingredientFormulaCount / ingredient.formulaCount;
        })
        || supplierRows.some((supplier) => {
          const familySupplier = family.suppliers.find((item) => item.supplierId === supplier.supplierId);
          return !familySupplier || supplier.sourceRecordIds.some((sourceId) => !familySupplier.sourceRecordIds.includes(sourceId));
        })) {
        context.addIssue({ code: "custom", path: ["ingredients", index, "supplierNeutral"], message: "Supplier-neutral priors must include every supplier in the product-family sample." });
      }
    }
  })),
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
    supplierSourceIds: Map<string, Set<string>>;
    ingredients: Map<string, { sourceIds: Set<string>; supplierFormulaCounts: Map<string, number>; supplierSourceIds: Map<string, Set<string>> }>;
  }>();

  for (const query of [...eligibleById.values()].sort((left, right) => compareStable(left.sourceRecordId, right.sourceRecordId))) {
    const family = query.productFamily.candidates[0]!;
    const familyKey = normalizedKey(family.rawValue);
    let row = familyRows.get(familyKey);
    if (!row) {
      row = { label: family.rawValue, formulaIds: new Set(), supplierFormulaCounts: new Map(), supplierSourceIds: new Map(), ingredients: new Map() };
      familyRows.set(familyKey, row);
    }
    row.formulaIds.add(query.sourceRecordId);
    row.supplierFormulaCounts.set(query.supplierId, (row.supplierFormulaCounts.get(query.supplierId) ?? 0) + 1);
    const familySupplierSourceIds = row.supplierSourceIds.get(query.supplierId) ?? new Set<string>();
    familySupplierSourceIds.add(query.sourceRecordId);
    row.supplierSourceIds.set(query.supplierId, familySupplierSourceIds);

    const chemicalIdsInFormula = new Set(query.lines.flatMap((line) => line.canonicalChemistry.candidateIds));
    for (const chemicalId of chemicalIdsInFormula) {
      let ingredient = row.ingredients.get(chemicalId);
      if (!ingredient) {
        ingredient = { sourceIds: new Set(), supplierFormulaCounts: new Map(), supplierSourceIds: new Map() };
        row.ingredients.set(chemicalId, ingredient);
      }
      if (ingredient.sourceIds.has(query.sourceRecordId)) continue;
      ingredient.sourceIds.add(query.sourceRecordId);
      ingredient.supplierFormulaCounts.set(query.supplierId, (ingredient.supplierFormulaCounts.get(query.supplierId) ?? 0) + 1);
      const supplierSourceIds = ingredient.supplierSourceIds.get(query.supplierId) ?? new Set<string>();
      supplierSourceIds.add(query.sourceRecordId);
      ingredient.supplierSourceIds.set(query.supplierId, supplierSourceIds);
    }
  }

  const productFamilies = [...familyRows.entries()].sort(([left], [right]) => compareStable(left, right)).map(([productFamilyKey, row]) => {
    const eligibleFormulaCount = row.formulaIds.size;
    const suppliers = [...row.supplierFormulaCounts.entries()].sort(([left], [right]) => compareStable(left, right)).map(([supplierId, formulaCount]) => ({
      supplierId, formulaCount, familyShare: formulaCount / eligibleFormulaCount,
      sourceRecordIds: [...(row.supplierSourceIds.get(supplierId) ?? [])].sort(compareStable),
    }));
    const ingredients = [...row.ingredients.entries()].sort(([left], [right]) => compareStable(left, right)).map(([canonicalChemistryId, ingredient]) => {
      const formulaCount = ingredient.sourceIds.size;
      const ingredientSuppliers = [...ingredient.supplierFormulaCounts.entries()].sort(([left], [right]) => compareStable(left, right)).map(([supplierId, supplierFormulaCount]) => ({
        supplierId, formulaCount: supplierFormulaCount,
        familyShare: supplierFormulaCount / eligibleFormulaCount,
        ingredientShare: supplierFormulaCount / formulaCount,
      }));
      const supplierNeutralRows = [...row.supplierFormulaCounts.entries()].sort(([left], [right]) => compareStable(left, right)).map(([supplierId, eligibleSupplierFormulaCount]) => {
        const ingredientFormulaCount = ingredient.supplierFormulaCounts.get(supplierId) ?? 0;
        return {
          supplierId, eligibleFormulaCount: eligibleSupplierFormulaCount, ingredientFormulaCount,
          frequency: ingredientFormulaCount / eligibleSupplierFormulaCount, equalSupplierWeight: 1 / row.supplierFormulaCounts.size,
          sourceRecordIds: [...(ingredient.supplierSourceIds.get(supplierId) ?? [])].sort(compareStable),
        };
      });
      const supplierBalancedFrequency = supplierNeutralRows.reduce((total, supplier) => total + supplier.frequency, 0) / supplierNeutralRows.length;
      return {
        canonicalChemistryId, formulaCount, frequency: formulaCount / eligibleFormulaCount, frequencyWeighting: "formula_weighted_corpus" as const,
        supplierNeutral: {
          weighting: "equal_supplier" as const, supplierCount: supplierNeutralRows.length,
          interpretation: "equal_supplier_mean_of_supplier_formula_prevalence" as const,
          pooledFrequency: supplierBalancedFrequency, suppliers: supplierNeutralRows,
        },
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
