import Decimal from "decimal.js";
import { z } from "zod";
import { parseExplicitMassPercentageRange } from "../schemas/singleComponentResolver";
import type { ReferenceFormulationQueryRecord } from "../schemas/referenceFormulationQuery";
import type { ReferenceFormulationRecord } from "../schemas/referenceFormulationRecord";
import { referenceFormulationReviewSchema, type ReferenceFormulationReview } from "../schemas/referenceFormulationReview";
import {
  filterEligibleReferenceFormulationCorpus,
  referenceFormulationEligibilityDecisionSchema,
} from "./referenceFormulationEligibility";

export const REFERENCE_FORMULATION_DOSAGE_DISTRIBUTION_VERSION = "formulab-reference-formulation-dosage-distribution-v2";

const supplierSampleSchema = z.object({
  supplierId: z.string().trim().min(1),
  formulaCount: z.number().int().positive(),
  share: z.number().finite().min(0).max(1),
  sourceRecordIds: z.array(z.string().trim().min(1)).min(1),
}).strict();

const quantilesSchema = z.object({ p25: z.number().finite().min(0).max(100), p50: z.number().finite().min(0).max(100), p75: z.number().finite().min(0).max(100) }).strict()
  .superRefine((value, context) => {
    if (value.p25 > value.p50 || value.p50 > value.p75) context.addIssue({ code: "custom", path: ["p50"], message: "Dosage quantiles must be monotonic." });
  });

const dosageSampleSchema = z.object({
  productFamilyKey: z.string().trim().min(1),
  productFamilyLabel: z.string().trim().min(1),
  canonicalChemistryId: z.string().trim().min(1),
  canonicalFunctionId: z.string().trim().min(1).optional(),
  functionAssignment: z.enum(["reviewed", "unassigned_or_unreviewed"]),
  formulaCount: z.number().int().positive(),
  supplierCount: z.number().int().positive(),
  minimumLowerBound: z.number().finite().min(0).max(100),
  maximumUpperBound: z.number().finite().min(0).max(100),
  lowerBoundQuantiles: quantilesSchema,
  upperBoundQuantiles: quantilesSchema,
  suppliers: z.array(supplierSampleSchema),
  sourceRecordIds: z.array(z.string().trim().min(1)),
}).strict().superRefine((sample, context) => {
  if (sample.sourceRecordIds.length !== sample.formulaCount
    || new Set(sample.sourceRecordIds).size !== sample.sourceRecordIds.length
    || sample.suppliers.length !== sample.supplierCount
    || sample.suppliers.reduce((total, supplier) => total + supplier.formulaCount, 0) !== sample.formulaCount
    || sample.suppliers.some((supplier) => supplier.share !== supplier.formulaCount / sample.formulaCount
      || supplier.sourceRecordIds.length !== supplier.formulaCount || new Set(supplier.sourceRecordIds).size !== supplier.sourceRecordIds.length)
    || JSON.stringify(sample.suppliers.flatMap((supplier) => supplier.sourceRecordIds).sort(stableCompare)) !== JSON.stringify([...sample.sourceRecordIds].sort(stableCompare))) {
    context.addIssue({ code: "custom", path: ["suppliers"], message: "Dosage sample counts, supplier mix and supporting source IDs must agree." });
  }
  if (sample.minimumLowerBound > sample.maximumUpperBound
    || sample.lowerBoundQuantiles.p50 < sample.minimumLowerBound
    || sample.upperBoundQuantiles.p50 > sample.maximumUpperBound
    || (sample.functionAssignment === "reviewed") !== (sample.canonicalFunctionId !== undefined)) {
    context.addIssue({ code: "custom", path: ["minimumLowerBound"], message: "Dosage bounds and quantiles must remain inside the observed range." });
  }
});

export const referenceFormulationDosageDistributionsSchema = z.object({
  schemaVersion: z.literal(REFERENCE_FORMULATION_DOSAGE_DISTRIBUTION_VERSION),
  asOf: z.string().datetime({ offset: true }),
  eligibleFormulaCount: z.number().int().nonnegative(),
  excludedFormulaCount: z.number().int().nonnegative(),
  excludedDosageSampleCount: z.number().int().nonnegative(),
  excludedDosageSamplesByReason: z.partialRecord(z.enum(["amount_not_reviewed", "unit_not_reviewed", "basis_not_reviewed", "amount_not_explicit_percent_w_w", "formula_amount_not_parseable"]), z.number().int().positive()),
  eligibilityDecisions: z.array(referenceFormulationEligibilityDecisionSchema),
  eligibleSourceRecordIdsByProductFamily: z.record(z.string().trim().min(1), z.array(z.string().trim().min(1))),
  distributions: z.array(dosageSampleSchema),
}).strict().superRefine((result, context) => {
  const excluded = Object.values(result.excludedDosageSamplesByReason).reduce((sum, count) => sum + count, 0);
  const familySourceIds = Object.values(result.eligibleSourceRecordIdsByProductFamily).flat();
  const eligibleDecisionSourceIds = result.eligibilityDecisions.filter((decision) => decision.eligible).map((decision) => decision.sourceRecordId);
  if (result.eligibleFormulaCount + result.excludedFormulaCount !== result.eligibilityDecisions.length
    || result.eligibleFormulaCount !== result.eligibilityDecisions.filter((decision) => decision.eligible).length
    || result.excludedFormulaCount !== result.eligibilityDecisions.filter((decision) => !decision.eligible).length
    || excluded !== result.excludedDosageSampleCount
    || new Set(familySourceIds).size !== familySourceIds.length
    || new Set(eligibleDecisionSourceIds).size !== eligibleDecisionSourceIds.length
    || JSON.stringify([...familySourceIds].sort()) !== JSON.stringify([...eligibleDecisionSourceIds].sort())
    || Object.values(result.eligibleSourceRecordIdsByProductFamily).some((sourceIds) => new Set(sourceIds).size !== sourceIds.length)
    || result.distributions.some((distribution) => distribution.sourceRecordIds.some((sourceRecordId) =>
      !result.eligibleSourceRecordIdsByProductFamily[distribution.productFamilyKey]?.includes(sourceRecordId)))) {
    context.addIssue({ code: "custom", path: ["eligibilityDecisions"], message: "Dosage totals must match eligibility and sample-exclusion evidence." });
  }
});

export type ReferenceFormulationDosageDistributions = z.infer<typeof referenceFormulationDosageDistributionsSchema>;

type ExclusionReason = keyof ReferenceFormulationDosageDistributions["excludedDosageSamplesByReason"];
type Observation = { lower: Decimal; upper: Decimal; supplierId: string; sourceRecordId: string };
type SampleBuilder = {
  familyLabel: string;
  chemicalId: string;
  functionId?: string;
  observations: Map<string, Observation>;
};

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function familyKey(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function quantile(values: number[], probability: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(probability * sorted.length) - 1);
  return sorted[index]!;
}

function rangeForLine(line: ReferenceFormulationQueryRecord["lines"][number]): { lower: Decimal; upper: Decimal } | ExclusionReason {
  const { amount } = line;
  if (amount.quantitySemantics !== "explicit_amount" || !amount.originalValue) return "amount_not_explicit_percent_w_w";
  if (!amount.unit || !amount.basis) return "amount_not_explicit_percent_w_w";
  const unit = amount.unit.trim().toLocaleLowerCase("en-US");
  const basis = amount.basis.trim().toLocaleLowerCase("en-US");
  if (!["%", "percent", "percentage", "wt%", "wt.%"].includes(unit)
    || !["w/w", "weight/weight", "mass/mass", "by weight"].includes(basis)) return "amount_not_explicit_percent_w_w";
  const parsed = parseExplicitMassPercentageRange(`${amount.originalValue.trim().replace(/%\s*$/u, "")} % w/w`);
  if (!parsed) return "formula_amount_not_parseable";
  return { lower: new Decimal(parsed.lowerBound), upper: new Decimal(parsed.upperBound) };
}

function latestReviewIndex(reviewsInput: ReferenceFormulationReview[]): Map<string, ReferenceFormulationReview> {
  const reviews = reviewsInput.map((review) => referenceFormulationReviewSchema.parse(review));
  if (new Set(reviews.map((review) => review.id)).size !== reviews.length) throw new Error("Dosage input cannot contain duplicate review event IDs.");
  const latest = new Map<string, ReferenceFormulationReview>();
  for (const review of reviews) {
    const key = `${review.referenceFormulationRecordId}\u0000${review.targetKey}`;
    const previous = latest.get(key);
    if (!previous || Date.parse(review.reviewedAt) > Date.parse(previous.reviewedAt)
      || (Date.parse(review.reviewedAt) === Date.parse(previous.reviewedAt) && stableCompare(review.id, previous.id) > 0)) latest.set(key, review);
  }
  return latest;
}

function acceptedField(input: {
  latest: Map<string, ReferenceFormulationReview>;
  query: ReferenceFormulationQueryRecord;
  targetKey: string;
  fieldPath: string;
  sourceValue: string;
}): boolean {
  const review = input.latest.get(`${input.query.sourceRecordId}\u0000${input.targetKey}`);
  return review?.targetType === "ingredient" && review.fieldPath === input.fieldPath
    && review.sourceDocumentHash === input.query.sourceDocumentHash && review.decision === "accepted"
    && review.sourceValue === input.sourceValue;
}

function reviewedFunctionId(input: {
  latest: Map<string, ReferenceFormulationReview>;
  query: ReferenceFormulationQueryRecord;
  line: ReferenceFormulationQueryRecord["lines"][number];
}): string | undefined {
  if (input.line.canonicalFunctions.status !== "proposed" || input.line.canonicalFunctions.candidateIds.length !== 1) return undefined;
  const candidateId = input.line.canonicalFunctions.candidateIds[0]!;
  const targetKey = `normalization:${input.query.normalizationId}:line:${input.line.sourceLineId}:canonicalFunction:${candidateId}`;
  return acceptedField({
    latest: input.latest, query: input.query, targetKey,
    fieldPath: `normalizations[${input.query.normalizationId}].lines[${input.line.sourceLineId}].canonicalFunction`,
    sourceValue: candidateId,
  }) ? candidateId : undefined;
}

function reviewedAmount(input: {
  latest: Map<string, ReferenceFormulationReview>;
  query: ReferenceFormulationQueryRecord;
  line: ReferenceFormulationQueryRecord["lines"][number];
}): ExclusionReason | undefined {
  const { line, query, latest } = input;
  const id = line.sourceLineId;
  const amount = line.amount.originalValue;
  if (!amount || !acceptedField({ latest, query, targetKey: `ingredient:${id}:amount`, fieldPath: `ingredientLines[${id}].amount`, sourceValue: amount })) return "amount_not_reviewed";
  if (!line.amount.unit || !acceptedField({ latest, query, targetKey: `ingredient:${id}:unit`, fieldPath: `ingredientLines[${id}].unit`, sourceValue: line.amount.unit })) return "unit_not_reviewed";
  if (!line.amount.basis || !acceptedField({ latest, query, targetKey: `ingredient:${id}:basis`, fieldPath: `ingredientLines[${id}].basis`, sourceValue: line.amount.basis })) return "basis_not_reviewed";
  return undefined;
}

/** Calculate source-bounded dosage distributions from explicitly reviewed formula amounts; no absent value is filled with zero. */
export function calculateReferenceFormulationDosageDistributions(input: {
  queryRecords: ReferenceFormulationQueryRecord[];
  sourceRecords: ReferenceFormulationRecord[];
  reviews: ReferenceFormulationReview[];
  asOf: string;
}): ReferenceFormulationDosageDistributions {
  const eligibility = filterEligibleReferenceFormulationCorpus(input);
  const latestReviews = latestReviewIndex(input.reviews);
  const builders = new Map<string, SampleBuilder>();
  const exclusions = new Map<ExclusionReason, number>();
  const eligibleSourceRecordIdsByProductFamily = new Map<string, string[]>();
  const exclude = (reason: ExclusionReason) => exclusions.set(reason, (exclusions.get(reason) ?? 0) + 1);

  for (const query of eligibility.eligible) {
    const family = query.productFamily.candidates[0]!;
    const productFamilyKey = familyKey(family.rawValue);
    const familySourceIds = eligibleSourceRecordIdsByProductFamily.get(productFamilyKey) ?? [];
    familySourceIds.push(query.sourceRecordId);
    eligibleSourceRecordIdsByProductFamily.set(productFamilyKey, familySourceIds);
    const groups = new Map<string, { chemicalId: string; functionId?: string; lines: typeof query.lines }>();
    for (const line of query.lines) {
      const chemicalId = line.canonicalChemistry.candidateIds[0]!;
      const functionId = reviewedFunctionId({ latest: latestReviews, query, line });
      const key = `${productFamilyKey}\u0000${chemicalId}\u0000${functionId ?? ""}`;
      const group = groups.get(key);
      if (group) group.lines.push(line);
      else groups.set(key, { chemicalId, ...(functionId ? { functionId } : {}), lines: [line] });
    }

    for (const [key, group] of groups) {
      let builder = builders.get(key);
      if (!builder) {
        builder = { familyLabel: family.rawValue, chemicalId: group.chemicalId, ...(group.functionId ? { functionId: group.functionId } : {}), observations: new Map() };
        builders.set(key, builder);
      }
      let failure: ExclusionReason | undefined;
      let lower = new Decimal(0);
      let upper = new Decimal(0);
      for (const line of group.lines) {
        failure = reviewedAmount({ latest: latestReviews, query, line });
        if (failure) break;
        const range = rangeForLine(line);
        if (typeof range === "string") { failure = range; break; }
        lower = lower.plus(range.lower);
        upper = upper.plus(range.upper);
      }
      if (failure) { exclude(failure); continue; }
      builder.observations.set(query.sourceRecordId, { lower, upper, supplierId: query.supplierId, sourceRecordId: query.sourceRecordId });
    }
  }

  const distributions = [...builders.entries()].sort(([left], [right]) => stableCompare(left, right)).flatMap(([key, builder]) => {
    const [productFamilyKey] = key.split("\u0000");
    const observations = [...builder.observations.values()].sort((left, right) => stableCompare(left.sourceRecordId, right.sourceRecordId));
    if (observations.length === 0) return [];
    const lower = observations.map((observation) => observation.lower.toNumber());
    const upper = observations.map((observation) => observation.upper.toNumber());
    const supplierSourceIds = new Map<string, string[]>();
    for (const observation of observations) {
      const sourceIds = supplierSourceIds.get(observation.supplierId) ?? [];
      sourceIds.push(observation.sourceRecordId);
      supplierSourceIds.set(observation.supplierId, sourceIds);
    }
    return [{
      productFamilyKey: productFamilyKey!, productFamilyLabel: builder.familyLabel, canonicalChemistryId: builder.chemicalId,
      ...(builder.functionId ? { canonicalFunctionId: builder.functionId } : {}),
      functionAssignment: builder.functionId ? "reviewed" as const : "unassigned_or_unreviewed" as const,
      formulaCount: observations.length, supplierCount: supplierSourceIds.size,
      minimumLowerBound: Math.min(...lower), maximumUpperBound: Math.max(...upper),
      lowerBoundQuantiles: { p25: quantile(lower, 0.25), p50: quantile(lower, 0.5), p75: quantile(lower, 0.75) },
      upperBoundQuantiles: { p25: quantile(upper, 0.25), p50: quantile(upper, 0.5), p75: quantile(upper, 0.75) },
      suppliers: [...supplierSourceIds.entries()].sort(([left], [right]) => stableCompare(left, right)).map(([supplierId, sourceRecordIds]) => ({
        supplierId, formulaCount: sourceRecordIds.length, share: sourceRecordIds.length / observations.length,
        sourceRecordIds: sourceRecordIds.sort(stableCompare),
      })),
      sourceRecordIds: observations.map((observation) => observation.sourceRecordId),
    }];
  });

  const excludedDosageSampleCount = [...exclusions.values()].reduce((sum, count) => sum + count, 0);
  const excludedDosageSamplesByReason = Object.fromEntries([...exclusions.entries()].sort(([left], [right]) => stableCompare(left, right))) as unknown as ReferenceFormulationDosageDistributions["excludedDosageSamplesByReason"];
  return {
    schemaVersion: REFERENCE_FORMULATION_DOSAGE_DISTRIBUTION_VERSION,
    asOf: input.asOf,
    eligibleFormulaCount: eligibility.eligible.length,
    excludedFormulaCount: eligibility.excluded.length,
    excludedDosageSampleCount,
    excludedDosageSamplesByReason,
    eligibilityDecisions: eligibility.decisions,
    eligibleSourceRecordIdsByProductFamily: Object.fromEntries([...eligibleSourceRecordIdsByProductFamily.entries()]
      .sort(([left], [right]) => stableCompare(left, right))
      .map(([familyKeyValue, sourceIds]) => [familyKeyValue, sourceIds.sort(stableCompare)])),
    distributions,
  };
}
