import { z } from "zod";
import type { ReferenceFormulationQueryRecord } from "../schemas/referenceFormulationQuery";
import type { ReferenceFormulationRecord } from "../schemas/referenceFormulationRecord";
import { referenceFormulationReviewSchema, type ReferenceFormulationReview } from "../schemas/referenceFormulationReview";
import {
  filterEligibleReferenceFormulationCorpus,
  referenceFormulationEligibilityDecisionSchema,
} from "./referenceFormulationEligibility";

export const REFERENCE_FORMULATION_COOCCURRENCE_VERSION = "formulab-reference-formulation-cooccurrence-v2";

const cooccurrenceSchema = z.object({
  productFamilyKey: z.string().trim().min(1),
  productFamilyLabel: z.string().trim().min(1),
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
  }).strict()),
  sourceRecordIds: z.array(z.string().trim().min(1)),
  interpretation: z.literal("empirical_cooccurrence_only"),
  compatibilityEvidence: z.literal(false),
}).strict().superRefine((value, context) => {
  if (value.firstId === value.secondId || value.formulaCount > value.eligibleFormulaCount
    || value.frequency !== value.formulaCount / value.eligibleFormulaCount
    || value.sourceRecordIds.length !== value.formulaCount
    || new Set(value.sourceRecordIds).size !== value.sourceRecordIds.length
    || value.suppliers.length !== value.supplierCount
    || value.suppliers.reduce((total, supplier) => total + supplier.formulaCount, 0) !== value.formulaCount
    || value.suppliers.some((supplier) => supplier.share !== supplier.formulaCount / value.formulaCount
      || supplier.sourceRecordIds.length !== supplier.formulaCount || new Set(supplier.sourceRecordIds).size !== supplier.sourceRecordIds.length)
    || JSON.stringify(value.suppliers.flatMap((supplier) => supplier.sourceRecordIds).sort(stableCompare)) !== JSON.stringify([...value.sourceRecordIds].sort(stableCompare))
    || (value.pairKind === "composition_component_pair") !== (value.scope === "same_sds_product_composition")
    || (value.pairKind === "composition_component_pair") !== (value.denominatorScope === "eligible_component_formulas_in_family")) {
    context.addIssue({ code: "custom", path: ["frequency"], message: "Co-occurrence must use distinct pair members, unique formula evidence and consistent supplier/sample arithmetic." });
  }
});

export const referenceFormulationCooccurrenceResultSchema = z.object({
  schemaVersion: z.literal(REFERENCE_FORMULATION_COOCCURRENCE_VERSION),
  asOf: z.string().datetime({ offset: true }),
  eligibleFormulaCount: z.number().int().nonnegative(),
  excludedFormulaCount: z.number().int().nonnegative(),
  excludedComponentCandidateCount: z.number().int().nonnegative(),
  eligibilityDecisions: z.array(referenceFormulationEligibilityDecisionSchema),
  eligibleSourceRecordIdsByProductFamily: z.record(z.string().trim().min(1), z.array(z.string().trim().min(1))),
  cooccurrences: z.array(cooccurrenceSchema),
  interpretation: z.literal("empirical_cooccurrence_only"),
  compatibilityEvidence: z.literal(false),
}).strict().superRefine((result, context) => {
  if (result.eligibleFormulaCount + result.excludedFormulaCount !== result.eligibilityDecisions.length
    || result.eligibleFormulaCount !== result.eligibilityDecisions.filter((decision) => decision.eligible).length
    || result.excludedFormulaCount !== result.eligibilityDecisions.filter((decision) => !decision.eligible).length
    || new Set(Object.values(result.eligibleSourceRecordIdsByProductFamily).flat()).size !== result.eligibleFormulaCount
    || JSON.stringify(Object.values(result.eligibleSourceRecordIdsByProductFamily).flat().sort(stableCompare))
      !== JSON.stringify(result.eligibilityDecisions.filter((decision) => decision.eligible).map((decision) => decision.sourceRecordId).sort(stableCompare))
    || Object.values(result.eligibleSourceRecordIdsByProductFamily).some((sourceIds) => new Set(sourceIds).size !== sourceIds.length)
    || result.cooccurrences.some((pair) => pair.sourceRecordIds.some((sourceRecordId) =>
      !result.eligibleSourceRecordIdsByProductFamily[pair.productFamilyKey]?.includes(sourceRecordId)))) {
    context.addIssue({ code: "custom", path: ["eligibilityDecisions"], message: "Co-occurrence sample counts must match the eligibility decisions." });
  }
});

export type ReferenceFormulationCooccurrenceResult = z.infer<typeof referenceFormulationCooccurrenceResultSchema>;

type PairKind = ReferenceFormulationCooccurrenceResult["cooccurrences"][number]["pairKind"];
type PairScope = ReferenceFormulationCooccurrenceResult["cooccurrences"][number]["scope"];
type PairObservation = { sourceRecordId: string; supplierId: string };
type PairBuilder = { pairKind: PairKind; scope: PairScope; denominatorScope: "eligible_formulas_in_family" | "eligible_component_formulas_in_family"; familyLabel: string; firstId: string; secondId: string; observations: Map<string, PairObservation> };

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeFamily(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function latestReviews(input: ReferenceFormulationReview[]): Map<string, ReferenceFormulationReview> {
  const reviews = input.map((review) => referenceFormulationReviewSchema.parse(review));
  if (new Set(reviews.map((review) => review.id)).size !== reviews.length) throw new Error("Co-occurrence input cannot contain duplicate review event IDs.");
  const latest = new Map<string, ReferenceFormulationReview>();
  for (const review of reviews) {
    const key = `${review.referenceFormulationRecordId}\u0000${review.targetKey}`;
    const prior = latest.get(key);
    if (!prior || Date.parse(review.reviewedAt) > Date.parse(prior.reviewedAt)
      || (Date.parse(review.reviewedAt) === Date.parse(prior.reviewedAt) && stableCompare(review.id, prior.id) > 0)) latest.set(key, review);
  }
  return latest;
}

function reviewedCandidate(input: {
  latest: Map<string, ReferenceFormulationReview>;
  query: ReferenceFormulationQueryRecord;
  targetKey: string;
  fieldPath: string;
  candidateId: string;
}): boolean {
  const review = input.latest.get(`${input.query.sourceRecordId}\u0000${input.targetKey}`);
  return review?.targetType === "ingredient" && review.fieldPath === input.fieldPath
    && review.sourceDocumentHash === input.query.sourceDocumentHash
    && review.decision === "accepted" && review.sourceValue === input.candidateId;
}

function reviewedFunctions(input: {
  query: ReferenceFormulationQueryRecord;
  latest: Map<string, ReferenceFormulationReview>;
}): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const line of input.query.lines) {
    if (line.canonicalFunctions.status !== "proposed" || line.canonicalFunctions.candidateIds.length !== 1) continue;
    const candidateId = line.canonicalFunctions.candidateIds[0]!;
    const targetKey = `normalization:${input.query.normalizationId}:line:${line.sourceLineId}:canonicalFunction:${candidateId}`;
    if (reviewedCandidate({
      latest: input.latest, query: input.query, targetKey,
      fieldPath: `normalizations[${input.query.normalizationId}].lines[${line.sourceLineId}].canonicalFunction`, candidateId,
    })) result.set(line.sourceLineId, [candidateId]);
  }
  return result;
}

function canonicalComponentGroups(input: {
  query: ReferenceFormulationQueryRecord;
  line: ReferenceFormulationQueryRecord["lines"][number];
  latest: Map<string, ReferenceFormulationReview>;
}): { groups: Map<string, Set<string>>; excludedCount: number } {
  const groups = new Map<string, Set<string>>();
  let excludedCount = 0;
  for (const contribution of input.line.componentContributions) {
    const sds = contribution.sourceSds;
    const candidateIds = contribution.canonicalChemistry.candidateIds;
    if (sds.status !== "available" || sds.disclosure !== "disclosed" || !sds.sourceComponentId
      || !sds.commercialProductId || !sds.acquisitionCode || !sds.documentHash || sds.sectionNumber !== 3
      || contribution.canonicalChemistry.status !== "proposed" || candidateIds.length !== 1) {
      excludedCount += candidateIds.length || 1;
      continue;
    }
    const candidateId = candidateIds[0]!;
    const targetKey = `normalization:${input.query.normalizationId}:contribution:${contribution.contributionId}:canonicalChemistry:${candidateId}`;
    const fieldPath = `normalizations[${input.query.normalizationId}].lines[${input.line.sourceLineId}].componentContributions[${contribution.contributionId}].canonicalChemistry`;
    if (!reviewedCandidate({ latest: input.latest, query: input.query, targetKey, fieldPath, candidateId })) {
      excludedCount += 1;
      continue;
    }
    const groupKey = [sds.commercialProductId, sds.acquisitionCode, sds.documentHash, sds.sectionNumber].join("\u0000");
    const ids = groups.get(groupKey) ?? new Set<string>();
    ids.add(candidateId);
    groups.set(groupKey, ids);
  }
  return { groups, excludedCount };
}

function addPairs(input: {
  builders: Map<string, PairBuilder>;
  pairKind: PairKind;
  scope: PairScope;
  familyKey: string;
  familyLabel: string;
  sourceRecordId: string;
  supplierId: string;
  values: Array<[string, string]>;
}): void {
  for (const [rawFirst, rawSecond] of input.values) {
    if (rawFirst === rawSecond) continue;
    const [firstId, secondId] = rawFirst < rawSecond ? [rawFirst, rawSecond] : [rawSecond, rawFirst];
    const pairKey = [input.familyKey, input.pairKind, input.scope, firstId, secondId].join("\u0000");
    let builder = input.builders.get(pairKey);
    if (!builder) {
      builder = {
        pairKind: input.pairKind, scope: input.scope,
        denominatorScope: input.pairKind === "composition_component_pair" ? "eligible_component_formulas_in_family" : "eligible_formulas_in_family",
        familyLabel: input.familyLabel, firstId, secondId, observations: new Map(),
      };
      input.builders.set(pairKey, builder);
    }
    builder.observations.set(input.sourceRecordId, { sourceRecordId: input.sourceRecordId, supplierId: input.supplierId });
  }
}

/** Empirical co-occurrence counts are evidence of joint appearance only and never imply compatibility. */
export function calculateReferenceFormulationCooccurrence(input: {
  queryRecords: ReferenceFormulationQueryRecord[];
  sourceRecords: ReferenceFormulationRecord[];
  reviews: ReferenceFormulationReview[];
  asOf: string;
}): ReferenceFormulationCooccurrenceResult {
  const eligibility = filterEligibleReferenceFormulationCorpus(input);
  const latest = latestReviews(input.reviews);
  const eligibleFormulaCounts = new Map<string, number>();
  const eligibleComponentFormulaCounts = new Map<string, number>();
  const eligibleSourceRecordIdsByProductFamily = new Map<string, string[]>();
  for (const query of eligibility.eligible) {
    const family = normalizeFamily(query.productFamily.candidates[0]!.rawValue);
    eligibleFormulaCounts.set(family, (eligibleFormulaCounts.get(family) ?? 0) + 1);
    const sourceIds = eligibleSourceRecordIdsByProductFamily.get(family) ?? [];
    sourceIds.push(query.sourceRecordId);
    eligibleSourceRecordIdsByProductFamily.set(family, sourceIds);
  }

  const builders = new Map<string, PairBuilder>();
  let excludedComponentCandidateCount = 0;
  for (const query of eligibility.eligible) {
    const family = query.productFamily.candidates[0]!;
    const familyKey = normalizeFamily(family.rawValue);
    const functions = reviewedFunctions({ query, latest });
    const materials = [...new Set(query.lines.flatMap((line) => line.canonicalChemistry.candidateIds))].sort(stableCompare);
    const functionIds = [...new Set([...functions.values()].flat())].sort(stableCompare);
    addPairs({ builders, pairKind: "material_pair", scope: "same_formula", familyKey, familyLabel: family.rawValue,
      sourceRecordId: query.sourceRecordId, supplierId: query.supplierId,
      values: materials.flatMap((first, index) => materials.slice(index + 1).map((second) => [first, second] as [string, string])) });
    addPairs({ builders, pairKind: "function_pair", scope: "same_formula", familyKey, familyLabel: family.rawValue,
      sourceRecordId: query.sourceRecordId, supplierId: query.supplierId,
      values: functionIds.flatMap((first, index) => functionIds.slice(index + 1).map((second) => [first, second] as [string, string])) });

    const materialFunctionPairs = query.lines.flatMap((line) => {
      const functionIdsForLine = functions.get(line.sourceLineId) ?? [];
      return line.canonicalChemistry.candidateIds.flatMap((material) => functionIdsForLine.map((functionId) => [material, functionId] as [string, string]));
    });
    addPairs({ builders, pairKind: "material_function_pair", scope: "same_formula", familyKey, familyLabel: family.rawValue,
      sourceRecordId: query.sourceRecordId, supplierId: query.supplierId, values: materialFunctionPairs });

    let hasEligibleComponentComposition = false;
    for (const line of query.lines) {
      const components = canonicalComponentGroups({ query, line, latest });
      excludedComponentCandidateCount += components.excludedCount;
      if (components.groups.size) hasEligibleComponentComposition = true;
      for (const componentIds of components.groups.values()) {
        const ids = [...componentIds].sort(stableCompare);
        addPairs({ builders, pairKind: "composition_component_pair", scope: "same_sds_product_composition", familyKey, familyLabel: family.rawValue,
          sourceRecordId: query.sourceRecordId, supplierId: query.supplierId,
          values: ids.flatMap((first, index) => ids.slice(index + 1).map((second) => [first, second] as [string, string])) });
      }
    }
    if (hasEligibleComponentComposition) eligibleComponentFormulaCounts.set(familyKey, (eligibleComponentFormulaCounts.get(familyKey) ?? 0) + 1);
  }

  const cooccurrences = [...builders.entries()].sort(([left], [right]) => stableCompare(left, right)).map(([key, pair]) => {
    const familyKey = key.split("\u0000")[0]!;
    const observations = [...pair.observations.values()].sort((left, right) => stableCompare(left.sourceRecordId, right.sourceRecordId));
    const supplierCounts = new Map<string, number>();
    for (const observation of observations) supplierCounts.set(observation.supplierId, (supplierCounts.get(observation.supplierId) ?? 0) + 1);
    const formulaCount = observations.length;
    const denominatorScope = pair.denominatorScope;
    const eligibleFormulaCount = (denominatorScope === "eligible_component_formulas_in_family" ? eligibleComponentFormulaCounts : eligibleFormulaCounts).get(familyKey) ?? 0;
    return {
      productFamilyKey: familyKey, productFamilyLabel: pair.familyLabel, pairKind: pair.pairKind, scope: pair.scope, denominatorScope,
      firstId: pair.firstId, secondId: pair.secondId, formulaCount, eligibleFormulaCount,
      frequency: formulaCount / (eligibleFormulaCount || 1), supplierCount: supplierCounts.size,
      suppliers: [...supplierCounts.entries()].sort(([left], [right]) => stableCompare(left, right)).map(([supplierId, count]) => ({
        supplierId, formulaCount: count, share: count / formulaCount,
        sourceRecordIds: observations.filter((observation) => observation.supplierId === supplierId).map((observation) => observation.sourceRecordId),
      })),
      sourceRecordIds: observations.map((observation) => observation.sourceRecordId),
      interpretation: "empirical_cooccurrence_only" as const, compatibilityEvidence: false as const,
    };
  });

  return referenceFormulationCooccurrenceResultSchema.parse({
    schemaVersion: REFERENCE_FORMULATION_COOCCURRENCE_VERSION, asOf: input.asOf,
    eligibleFormulaCount: eligibility.eligible.length, excludedFormulaCount: eligibility.excluded.length,
    excludedComponentCandidateCount, eligibilityDecisions: eligibility.decisions, cooccurrences,
    eligibleSourceRecordIdsByProductFamily: Object.fromEntries([...eligibleSourceRecordIdsByProductFamily.entries()]
      .sort(([left], [right]) => stableCompare(left, right))
      .map(([familyKey, sourceIds]) => [familyKey, sourceIds.sort(stableCompare)])),
    interpretation: "empirical_cooccurrence_only", compatibilityEvidence: false,
  });
}
