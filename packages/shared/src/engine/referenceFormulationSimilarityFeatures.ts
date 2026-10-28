import Decimal from "decimal.js";
import { z } from "zod";
import { parseExplicitMassPercentageRange } from "../schemas/singleComponentResolver";
import type { ReferenceFormulationQueryRecord } from "../schemas/referenceFormulationQuery";
import type { ReferenceFormulationRecord } from "../schemas/referenceFormulationRecord";
import { createReferenceFormulationProcessNormalization } from "../schemas/referenceFormulationProcessNormalization";
import { validateReferenceFormulationTargetNormalizationAgainstSource } from "../schemas/referenceFormulationTargetNormalization";
import { referenceFormulationReviewSchema, type ReferenceFormulationReview } from "../schemas/referenceFormulationReview";
import { calculateReferenceFormulationContributionDistributions } from "./referenceFormulationContributionDistributions";
import { filterEligibleReferenceFormulationCorpus, referenceFormulationEligibilityDecisionSchema } from "./referenceFormulationEligibility";

export const REFERENCE_FORMULATION_SIMILARITY_FEATURES_VERSION = "formulab-reference-formulation-similarity-features-v2";
const categoricalFeatureSchema = z.object({
  featureKey: z.string().trim().min(1), dimensionKey: z.string().trim().min(1),
  group: z.enum(["product_family", "canonical_chemistry", "canonical_function", "process", "target"]),
  value: z.string().trim().min(1), evidenceRefs: z.array(z.string().trim().min(1)).min(1),
}).strict();
const quantitativeFeatureSchema = z.object({
  featureKey: z.string().trim().min(1), dimensionKey: z.string().trim().min(1), group: z.enum(["dosage", "component_contribution"]),
  canonicalChemistryId: z.string().trim().min(1), canonicalFunctionId: z.string().trim().min(1).optional(),
  lowerBound: z.number().finite().min(0).max(100), upperBound: z.number().finite().min(0).max(100),
  unit: z.literal("% w/w"), evidenceRefs: z.array(z.string().trim().min(1)).min(1),
}).strict().superRefine((feature, context) => {
  if (feature.lowerBound > feature.upperBound) context.addIssue({ code: "custom", path: ["upperBound"], message: "Similarity feature range bounds must be ascending." });
});
export const referenceFormulationFormulaSimilarityFeaturesSchema = z.object({
  sourceRecordId: z.string().trim().min(1), queryRecordId: z.string().trim().min(1), sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  productFamilyKey: z.string().trim().min(1), productFamilyLabel: z.string().trim().min(1),
  categoricalFeatures: z.array(categoricalFeatureSchema), quantitativeFeatures: z.array(quantitativeFeatureSchema),
  evidenceRefs: z.array(z.string().trim().min(1)), interpretation: z.literal("reviewed_reference_similarity_features_only"),
}).strict().superRefine((formula, context) => {
  if (new Set(formula.categoricalFeatures.map((feature) => feature.featureKey)).size !== formula.categoricalFeatures.length
    || new Set(formula.quantitativeFeatures.map((feature) => feature.featureKey)).size !== formula.quantitativeFeatures.length
    || new Set(formula.quantitativeFeatures.map((feature) => feature.dimensionKey)).size !== formula.quantitativeFeatures.length
    || formula.categoricalFeatures.some((feature) => feature.evidenceRefs.some((ref) => !formula.evidenceRefs.includes(ref)))
    || formula.quantitativeFeatures.some((feature) => feature.evidenceRefs.some((ref) => !formula.evidenceRefs.includes(ref)))) {
    context.addIssue({ code: "custom", path: ["evidenceRefs"], message: "Similarity features must have unique keys and retain every cited source reference." });
  }
});
export type ReferenceFormulationFormulaSimilarityFeatures = z.infer<typeof referenceFormulationFormulaSimilarityFeaturesSchema>;
export const referenceFormulationSimilarityFeaturesSchema = z.object({
  schemaVersion: z.literal(REFERENCE_FORMULATION_SIMILARITY_FEATURES_VERSION), asOf: z.string().datetime({ offset: true }),
  eligibleFormulaCount: z.number().int().nonnegative(), excludedFormulaCount: z.number().int().nonnegative(),
  eligibilityDecisions: z.array(referenceFormulationEligibilityDecisionSchema), formulas: z.array(referenceFormulationFormulaSimilarityFeaturesSchema),
  interpretation: z.literal("supplier_neutral_reviewed_reference_features_not_similarity_scores"),
}).strict().superRefine((value, context) => {
  if (value.eligibleFormulaCount !== value.formulas.length || value.eligibleFormulaCount + value.excludedFormulaCount !== value.eligibilityDecisions.length
    || value.eligibleFormulaCount !== value.eligibilityDecisions.filter((item) => item.eligible).length
    || value.excludedFormulaCount !== value.eligibilityDecisions.filter((item) => !item.eligible).length
    || new Set(value.formulas.map((formula) => formula.sourceRecordId)).size !== value.formulas.length) {
    context.addIssue({ code: "custom", path: ["formulas"], message: "Similarity feature formulas must match eligible source records exactly once." });
  }
});
export type ReferenceFormulationSimilarityFeatures = z.infer<typeof referenceFormulationSimilarityFeaturesSchema>;

function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function familyKey(value: string): string { return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US"); }
function normalized(value: string): string { return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US"); }

function latestReviews(input: ReferenceFormulationReview[]): Map<string, ReferenceFormulationReview> {
  const parsed = input.map((item) => referenceFormulationReviewSchema.parse(item));
  if (new Set(parsed.map((item) => item.id)).size !== parsed.length) throw new Error("Similarity input cannot contain duplicate review event IDs.");
  const latest = new Map<string, ReferenceFormulationReview>();
  for (const item of parsed) {
    const key = `${item.referenceFormulationRecordId}\u0000${item.targetKey}`;
    const prior = latest.get(key);
    if (!prior || Date.parse(item.reviewedAt) > Date.parse(prior.reviewedAt) || (Date.parse(item.reviewedAt) === Date.parse(prior.reviewedAt) && compare(item.id, prior.id) > 0)) latest.set(key, item);
  }
  return latest;
}

function accepted(input: { latest: Map<string, ReferenceFormulationReview>; query: ReferenceFormulationQueryRecord; targetKey: string; fieldPath: string; sourceValue: string; targetType: ReferenceFormulationReview["targetType"] }): boolean {
  const review = input.latest.get(`${input.query.sourceRecordId}\u0000${input.targetKey}`);
  return review?.targetType === input.targetType && review.fieldPath === input.fieldPath && review.sourceDocumentHash === input.query.sourceDocumentHash
    && review.decision === "accepted" && review.sourceValue === input.sourceValue;
}

const ACTION_VERBS: Record<string, string> = {
  addition: "add|added|adding|introduce|introducing|charge|charged|charging|incorporate|incorporating",
  dissolve: "dissolve|dissolved|dissolving|solubilize|solubilizing",
  mix: "mix|mixed|mixing|stir|stirred|stirring|agitate|agitated|agitating|homogenize|homogenized|homogenizing|disperse|dispersed|dispersing|blend|blended|blending",
  hold: "hold|held|holding|maintain|maintained|maintaining|keep|kept", heat: "heat|heated|heating|warm|warmed|warming", cool: "cool|cooled|cooling",
  adjust_ph: "adjust[^.;,]{0,32}p\\s*h|neutralize|neutralized|neutralizing|neutralise|neutralised|neutralising",
  thicken: "thicken|thickened|thickening|thickener|increase\\s+viscosity", appearance_check: "check\\s+appearance|inspect\\s+appearance|verify\\s+clarity",
  finish: "finish|finished|finishing|finalize|finalized|finalise|finalised|complete|completed",
};
function reviewedActions(step: ReferenceFormulationQueryRecord["processSteps"][number]): string[] {
  return [...new Set(step.actionCandidates.filter((action) => action !== "other" && (!ACTION_VERBS[action]
    || !new RegExp(`\\b(?:do\\s+not|don't|never|avoid|without)\\s+(?:[\\w-]+\\s+){0,5}(?:${ACTION_VERBS[action]})\\b`, "iu").test(step.originalInstruction))))];
}

/** Build source-bound feature vectors only from currently eligible, explicitly reviewed snapshots. Supplier identity is provenance, never a similarity feature. */
export function createReferenceFormulationSimilarityFeatures(input: {
  queryRecords: ReferenceFormulationQueryRecord[]; sourceRecords: ReferenceFormulationRecord[]; reviews: ReferenceFormulationReview[]; asOf: string;
}): ReferenceFormulationSimilarityFeatures {
  const eligibility = filterEligibleReferenceFormulationCorpus(input);
  const sourceById = new Map(input.sourceRecords.map((source) => [source.id, source]));
  const latest = latestReviews(input.reviews);
  const contributionDistributions = calculateReferenceFormulationContributionDistributions(input);
  const contributionEligible = new Set(contributionDistributions.distributions.filter((item) => item.quantityKind === "component_contribution")
    .flatMap((item) => item.sourceRecordIds.map((sourceId) => `${item.productFamilyKey}\u0000${item.canonicalChemistryId}\u0000${sourceId}`)));

  const formulas = eligibility.eligible.map((query) => {
    const source = sourceById.get(query.sourceRecordId)!;
    const processSteps = createReferenceFormulationProcessNormalization(source).steps;
    if (JSON.stringify(query.processSteps) !== JSON.stringify(processSteps)) throw new Error("Similarity process features must match the immutable source procedure snapshot.");
    validateReferenceFormulationTargetNormalizationAgainstSource({
      normalizerVersion: "formulab-reference-formulation-target-normalization-v1", sourceStatus: query.targets.length ? "available" : "no_candidates",
      targets: query.targets, sourceWarnings: source.targetWarnings, reviewRequired: true,
    }, source);
    const family = query.productFamily.candidates[0]!;
    const categorical = new Map<string, { featureKey: string; dimensionKey: string; group: "product_family" | "canonical_chemistry" | "canonical_function" | "process" | "target"; value: string; evidenceRefs: Set<string> }>();
    const quantitative: Array<z.infer<typeof quantitativeFeatureSchema>> = [];
    const dosageGroups = new Map<string, { chemistryId: string; functionId?: string; lower: Decimal; upper: Decimal; refs: Set<string>; valid: boolean }>();
    const contributionGroups = new Map<string, { lower: Decimal; upper: Decimal; refs: Set<string> }>();
    const addCategorical = (group: "product_family" | "canonical_chemistry" | "canonical_function" | "process" | "target", featureKey: string, dimensionKey: string, value: string, refs: string[]) => {
      const existing = categorical.get(featureKey);
      if (existing) for (const ref of refs) existing.evidenceRefs.add(ref);
      else categorical.set(featureKey, { featureKey, dimensionKey, group, value, evidenceRefs: new Set(refs) });
    };
    addCategorical("product_family", `family:${familyKey(family.rawValue)}`, "product_family", familyKey(family.rawValue), family.evidenceRefs);

    for (const line of query.lines) {
      for (const chemistryId of line.canonicalChemistry.candidateIds) addCategorical("canonical_chemistry", `chemistry:${chemistryId}`, "canonical_chemistry", chemistryId, line.sourceLineEvidenceRefs);
      if (line.canonicalFunctions.status === "proposed" && line.canonicalFunctions.candidateIds.length === 1) {
        const functionId = line.canonicalFunctions.candidateIds[0]!;
        const targetKey = `normalization:${query.normalizationId}:line:${line.sourceLineId}:canonicalFunction:${functionId}`;
        const fieldPath = `normalizations[${query.normalizationId}].lines[${line.sourceLineId}].canonicalFunction`;
        if (accepted({ latest, query, targetKey, fieldPath, sourceValue: functionId, targetType: "ingredient" })) {
          const refs = [...line.sourceLineEvidenceRefs, ...line.supplierFunction.evidenceRefs];
          addCategorical("canonical_function", `function:${functionId}`, "canonical_function", functionId, refs);
        }
      }
      const chemistryId = line.canonicalChemistry.candidateIds[0];
      const functionId = line.canonicalFunctions.status === "proposed" && line.canonicalFunctions.candidateIds.length === 1
        && accepted({ latest, query, targetKey: `normalization:${query.normalizationId}:line:${line.sourceLineId}:canonicalFunction:${line.canonicalFunctions.candidateIds[0]}`,
          fieldPath: `normalizations[${query.normalizationId}].lines[${line.sourceLineId}].canonicalFunction`, sourceValue: line.canonicalFunctions.candidateIds[0]!, targetType: "ingredient" })
        ? line.canonicalFunctions.candidateIds[0] : undefined;
      const amount = line.amount;
      const amountAccepted = Boolean(amount.originalValue && amount.unit && amount.basis
        && accepted({ latest, query, targetKey: `ingredient:${line.sourceLineId}:amount`, fieldPath: `ingredientLines[${line.sourceLineId}].amount`, sourceValue: amount.originalValue, targetType: "ingredient" })
        && accepted({ latest, query, targetKey: `ingredient:${line.sourceLineId}:unit`, fieldPath: `ingredientLines[${line.sourceLineId}].unit`, sourceValue: amount.unit, targetType: "ingredient" })
        && accepted({ latest, query, targetKey: `ingredient:${line.sourceLineId}:basis`, fieldPath: `ingredientLines[${line.sourceLineId}].basis`, sourceValue: amount.basis, targetType: "ingredient" }));
      const amountRange = amountAccepted && amount.quantitySemantics === "explicit_amount"
        && ["%", "percent", "percentage", "wt%", "wt.%"].includes((amount.unit ?? "").trim().toLocaleLowerCase("en-US"))
        && ["w/w", "weight/weight", "mass/mass", "by weight"].includes((amount.basis ?? "").trim().toLocaleLowerCase("en-US"))
        ? parseExplicitMassPercentageRange(`${amount.originalValue} % w/w`) : undefined;
      if (chemistryId) {
        const groupKey = `${chemistryId}\u0000${functionId ?? "unassigned"}`;
        let group = dosageGroups.get(groupKey);
        if (!group) { group = { chemistryId, ...(functionId ? { functionId } : {}), lower: new Decimal(0), upper: new Decimal(0), refs: new Set(), valid: true }; dosageGroups.set(groupKey, group); }
        if (!amountRange) group.valid = false;
        else {
          group.lower = group.lower.plus(amountRange.lowerBound); group.upper = group.upper.plus(amountRange.upperBound);
          for (const ref of amount.evidenceRefs) group.refs.add(ref);
        }
      }

      for (const contribution of line.componentContributions) {
        const componentId = contribution.canonicalChemistry.candidateIds[0];
        const eligibleKey = componentId ? `${familyKey(family.rawValue)}\u0000${componentId}\u0000${query.sourceRecordId}` : "";
        if (!componentId || !contributionEligible.has(eligibleKey) || !contribution.componentContributionPercentRange) continue;
        const targetKey = `normalization:${query.normalizationId}:contribution:${contribution.contributionId}:canonicalChemistry:${componentId}`;
        const fieldPath = `normalizations[${query.normalizationId}].lines[${line.sourceLineId}].componentContributions[${contribution.contributionId}].canonicalChemistry`;
        if (!accepted({ latest, query, targetKey, fieldPath, sourceValue: componentId, targetType: "ingredient" })) continue;
        const sds = contribution.sourceSds;
        const evidenceRefs = [...new Set([...contribution.formulaAmount.evidenceRefs, ...sds.evidenceRefs])].sort(compare);
        const group = contributionGroups.get(componentId) ?? { lower: new Decimal(0), upper: new Decimal(0), refs: new Set<string>() };
        group.lower = group.lower.plus(contribution.componentContributionPercentRange.lowerBound);
        group.upper = group.upper.plus(contribution.componentContributionPercentRange.upperBound);
        for (const ref of evidenceRefs) group.refs.add(ref);
        contributionGroups.set(componentId, group);
      }
    }

    for (const group of [...dosageGroups.values()].sort((a, b) => compare(`${a.chemistryId}\u0000${a.functionId ?? "unassigned"}`, `${b.chemistryId}\u0000${b.functionId ?? "unassigned"}`))) {
      if (!group.valid || !group.refs.size) continue;
      const dimensionKey = `dosage:${group.chemistryId}:${group.functionId ?? "unassigned"}`;
      quantitative.push(quantitativeFeatureSchema.parse({ featureKey: dimensionKey, dimensionKey, group: "dosage", canonicalChemistryId: group.chemistryId,
        ...(group.functionId ? { canonicalFunctionId: group.functionId } : {}), lowerBound: group.lower.toNumber(), upperBound: group.upper.toNumber(), unit: "% w/w", evidenceRefs: [...group.refs].sort(compare) }));
    }
    for (const [chemistryId, group] of [...contributionGroups.entries()].sort(([a], [b]) => compare(a, b))) {
      const dimensionKey = `component_contribution:${chemistryId}`;
      quantitative.push(quantitativeFeatureSchema.parse({ featureKey: dimensionKey, dimensionKey, group: "component_contribution", canonicalChemistryId: chemistryId,
        lowerBound: group.lower.toNumber(), upperBound: group.upper.toNumber(), unit: "% w/w", evidenceRefs: [...group.refs].sort(compare) }));
    }

    const reviewedActionSteps: Array<{ step: ReferenceFormulationQueryRecord["processSteps"][number]; actions: string[] }> = [];
    for (const step of query.processSteps) {
      const instructionKey = `procedure:${step.sourceProcedureStepId}:instruction`;
      const instructionPath = `procedureSteps[${step.sourceProcedureStepId}].rawInstruction`;
      if (!accepted({ latest, query, targetKey: instructionKey, fieldPath: instructionPath, sourceValue: step.originalInstruction, targetType: "procedure" })) continue;
      const stepRef = step.evidenceRefs[0]!;
      const actions = reviewedActions(step);
      for (const action of actions) addCategorical("process", `process:action:${action}`, "process:action", action, [stepRef]);
      reviewedActionSteps.push({ step, actions });
      const sourceStep = source.procedureSteps.find((item) => item.id === step.sourceProcedureStepId)!;
      if (step.phaseCandidates.status === "proposed" && step.phaseCandidates.candidateValues.length === 1) {
        const phase = step.phaseCandidates.candidateValues[0]!;
        const phaseAccepted = (!sourceStep.phase || phase.rawValue === sourceStep.phase.rawValue)
          && accepted({ latest, query, targetKey: `procedure:${step.sourceProcedureStepId}:phase`,
            fieldPath: `procedureSteps[${step.sourceProcedureStepId}].phase`, sourceValue: phase.rawValue, targetType: "procedure" });
        if (phaseAccepted) addCategorical("process", `process:phase:${normalized(phase.rawValue)}`, "process:phase", `phase:${normalized(phase.rawValue)}`, phase.evidenceRefs);
      }
      for (const [index, condition] of step.conditions.entries()) {
        if (accepted({ latest, query, targetKey: `procedure:${step.sourceProcedureStepId}:condition:${index}`,
          fieldPath: `procedureSteps[${step.sourceProcedureStepId}].conditions[${index}]`, sourceValue: condition.rawValue, targetType: "procedure" })) {
          addCategorical("process", `process:condition:${condition.kind}:${normalized(condition.rawValue)}`, `process:condition:${condition.kind}`,
            `condition:${condition.kind}:${normalized(condition.rawValue)}`, condition.evidenceRefs);
        }
      }
    }
    for (let i = 0; i < reviewedActionSteps.length; i += 1) for (let j = i + 1; j < reviewedActionSteps.length; j += 1) {
      const earlier = reviewedActionSteps[i]!; const later = reviewedActionSteps[j]!;
      for (const firstAction of earlier.actions) for (const secondAction of later.actions) {
        const key = `process:sequence:${firstAction}->${secondAction}`;
        addCategorical("process", key, "process:sequence", `${firstAction}->${secondAction}`, [...earlier.step.evidenceRefs, ...later.step.evidenceRefs]);
      }
    }
    for (const target of query.targets) {
      if (target.property === "other" || (target.valueShape !== "point_or_exact" && target.valueShape !== "range")) continue;
      if (!accepted({ latest, query, targetKey: `target:${target.sourceTargetId}`, fieldPath: `targetCandidates[${target.sourceTargetId}].${target.property}`,
        sourceValue: target.originalValue, targetType: "target" })) continue;
      const value = `${target.property}:${target.resultSemantics}:${normalized(target.sourceContext)}:${normalized(target.originalValue)}`;
      const dimensionKey = `target:${target.property}:${target.resultSemantics}:${normalized(target.sourceContext)}`;
      addCategorical("target", `target:${target.property}:${target.resultSemantics}:${normalized(target.originalValue)}:${normalized(target.sourceContext)}`, dimensionKey, value, target.evidenceRefs);
    }

    const categoricalFeatures = [...categorical.values()].map((feature) => ({ ...feature, evidenceRefs: [...feature.evidenceRefs].sort(compare) }))
      .sort((left, right) => compare(left.featureKey, right.featureKey));
    const quantitativeFeatures = quantitative.sort((left, right) => compare(left.featureKey, right.featureKey));
    const evidenceRefs = [...new Set([...categoricalFeatures.flatMap((feature) => feature.evidenceRefs), ...quantitativeFeatures.flatMap((feature) => feature.evidenceRefs)])].sort(compare);
    return {
      sourceRecordId: query.sourceRecordId, queryRecordId: query.id, sourceDocumentHash: query.sourceDocumentHash,
      productFamilyKey: familyKey(family.rawValue), productFamilyLabel: family.rawValue, categoricalFeatures, quantitativeFeatures,
      evidenceRefs, interpretation: "reviewed_reference_similarity_features_only" as const,
    };
  }).sort((left, right) => compare(left.sourceRecordId, right.sourceRecordId));
  return referenceFormulationSimilarityFeaturesSchema.parse({
    schemaVersion: REFERENCE_FORMULATION_SIMILARITY_FEATURES_VERSION, asOf: input.asOf,
    eligibleFormulaCount: eligibility.eligible.length, excludedFormulaCount: eligibility.excluded.length,
    eligibilityDecisions: eligibility.decisions, formulas,
    interpretation: "supplier_neutral_reviewed_reference_features_not_similarity_scores",
  });
}
