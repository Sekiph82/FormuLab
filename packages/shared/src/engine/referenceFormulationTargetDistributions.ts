import Decimal from "decimal.js";
import { z } from "zod";
import type { ReferenceFormulationQueryRecord } from "../schemas/referenceFormulationQuery";
import type { ReferenceFormulationRecord } from "../schemas/referenceFormulationRecord";
import { validateReferenceFormulationTargetNormalizationAgainstSource } from "../schemas/referenceFormulationTargetNormalization";
import { referenceFormulationReviewSchema, type ReferenceFormulationReview } from "../schemas/referenceFormulationReview";
import { filterEligibleReferenceFormulationCorpus, referenceFormulationEligibilityDecisionSchema } from "./referenceFormulationEligibility";

export const REFERENCE_FORMULATION_TARGET_DISTRIBUTION_VERSION = "formulab-reference-formulation-target-distributions-v1";
const supplierSchema = z.object({ supplierId: z.string().trim().min(1), formulaCount: z.number().int().positive(), share: z.number().finite().min(0).max(1) }).strict();
const numericDistributionSchema = z.object({
  productFamilyKey: z.string().trim().min(1), productFamilyLabel: z.string().trim().min(1), property: z.enum(["ph", "viscosity", "density"]),
  resultSemantics: z.enum(["target", "typical_result", "unspecified"]), canonicalUnit: z.string().trim().min(1), measurementContext: z.string().trim().min(1),
  formulaCount: z.number().int().positive(), supplierCount: z.number().int().positive(),
  minimumLowerBound: z.number().finite(), maximumUpperBound: z.number().finite(),
  lowerBoundQuantiles: z.object({ p25: z.number().finite(), p50: z.number().finite(), p75: z.number().finite() }).strict(),
  upperBoundQuantiles: z.object({ p25: z.number().finite(), p50: z.number().finite(), p75: z.number().finite() }).strict(),
  suppliers: z.array(supplierSchema), sourceRecordIds: z.array(z.string().trim().min(1)), evidenceRefs: z.array(z.string().trim().min(1)),
  interpretation: z.literal("reviewed_reference_property_distribution"),
}).strict().superRefine((value, context) => {
  if (value.sourceRecordIds.length !== value.formulaCount || new Set(value.sourceRecordIds).size !== value.formulaCount
    || value.suppliers.length !== value.supplierCount || value.suppliers.reduce((sum, item) => sum + item.formulaCount, 0) !== value.formulaCount
    || value.suppliers.some((item) => item.share !== item.formulaCount / value.formulaCount) || value.minimumLowerBound > value.maximumUpperBound) {
    context.addIssue({ code: "custom", path: ["formulaCount"], message: "Target distribution counts, suppliers and bounds must agree." });
  }
});
const categoryDistributionSchema = z.object({
  productFamilyKey: z.string().trim().min(1), productFamilyLabel: z.string().trim().min(1), property: z.literal("appearance"),
  resultSemantics: z.enum(["target", "typical_result", "unspecified"]), measurementContext: z.string().trim().min(1),
  formulaCount: z.number().int().positive(), supplierCount: z.number().int().positive(),
  categories: z.array(z.object({ value: z.string().trim().min(1), formulaCount: z.number().int().positive(), supplierCount: z.number().int().positive(), suppliers: z.array(supplierSchema), sourceRecordIds: z.array(z.string().trim().min(1)), evidenceRefs: z.array(z.string().trim().min(1)) }).strict()),
  suppliers: z.array(supplierSchema), sourceRecordIds: z.array(z.string().trim().min(1)), evidenceRefs: z.array(z.string().trim().min(1)),
  interpretation: z.literal("reviewed_reference_property_distribution"),
}).strict().superRefine((value, context) => {
  if (value.sourceRecordIds.length !== value.formulaCount || new Set(value.sourceRecordIds).size !== value.formulaCount
    || value.suppliers.length !== value.supplierCount || value.suppliers.reduce((sum, item) => sum + item.formulaCount, 0) !== value.formulaCount
    || value.suppliers.some((item) => item.share !== item.formulaCount / value.formulaCount)
    || value.categories.reduce((sum, item) => sum + item.formulaCount, 0) < value.formulaCount) {
    context.addIssue({ code: "custom", path: ["formulaCount"], message: "Categorical target counts, suppliers and source IDs must agree." });
  }
});
const exclusionReasonSchema = z.enum(["target_not_reviewed", "approximate_or_unparsed", "unsupported_unit", "duplicate_property_context"]);
export const referenceFormulationTargetDistributionsSchema = z.object({
  schemaVersion: z.literal(REFERENCE_FORMULATION_TARGET_DISTRIBUTION_VERSION), asOf: z.string().datetime({ offset: true }),
  eligibleFormulaCount: z.number().int().nonnegative(), excludedFormulaCount: z.number().int().nonnegative(), excludedTargetCount: z.number().int().nonnegative(),
  excludedTargetsByReason: z.partialRecord(exclusionReasonSchema, z.number().int().positive()),
  eligibilityDecisions: z.array(referenceFormulationEligibilityDecisionSchema), distributions: z.array(z.union([numericDistributionSchema, categoryDistributionSchema])),
}).strict().superRefine((value, context) => {
  if (value.eligibleFormulaCount + value.excludedFormulaCount !== value.eligibilityDecisions.length
    || Object.values(value.excludedTargetsByReason).reduce((sum, count) => sum + count, 0) !== value.excludedTargetCount) {
    context.addIssue({ code: "custom", path: ["eligibilityDecisions"], message: "Target-distribution totals must match eligibility and excluded evidence." });
  }
});
export type ReferenceFormulationTargetDistributions = z.infer<typeof referenceFormulationTargetDistributionsSchema>;

type NumericObservation = { lower: Decimal; upper: Decimal; supplierId: string; sourceRecordId: string; evidenceRefs: string[] };
type CategoryObservation = { value: string; supplierId: string; sourceRecordId: string; evidenceRefs: string[] };
type NumericBuilder = { productFamilyLabel: string; property: "ph" | "viscosity" | "density"; resultSemantics: ReferenceFormulationQueryRecord["targets"][number]["resultSemantics"]; canonicalUnit: string; measurementContext: string; observations: Map<string, NumericObservation> };
type CategoryBuilder = { productFamilyLabel: string; resultSemantics: ReferenceFormulationQueryRecord["targets"][number]["resultSemantics"]; measurementContext: string; observations: Map<string, CategoryObservation> };
type ParsedNumeric = { lower: Decimal; upper: Decimal; canonicalUnit: string; context: string };
type ExclusionReason = z.infer<typeof exclusionReasonSchema>;
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function familyKey(value: string): string { return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US"); }
function quantile(values: number[], p: number): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!; }
function normalizedContext(value: string): string {
  const context = value.normalize("NFKC").trim().replace(/\s*°\s*/gu, "°").replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
  return context || "not stated";
}
function reviewIndex(input: ReferenceFormulationReview[]): Map<string, ReferenceFormulationReview> {
  const parsed = input.map((item) => referenceFormulationReviewSchema.parse(item));
  if (new Set(parsed.map((item) => item.id)).size !== parsed.length) throw new Error("Target distribution input cannot contain duplicate review event IDs.");
  const latest = new Map<string, ReferenceFormulationReview>();
  for (const item of parsed) {
    const key = `${item.referenceFormulationRecordId}\u0000${item.targetKey}`;
    const prior = latest.get(key);
    if (!prior || Date.parse(item.reviewedAt) > Date.parse(prior.reviewedAt) || (Date.parse(item.reviewedAt) === Date.parse(prior.reviewedAt) && compare(item.id, prior.id) > 0)) latest.set(key, item);
  }
  return latest;
}
function accepted(input: { latest: Map<string, ReferenceFormulationReview>; query: ReferenceFormulationQueryRecord; target: ReferenceFormulationQueryRecord["targets"][number] }): boolean {
  const review = input.latest.get(`${input.query.sourceRecordId}\u0000target:${input.target.sourceTargetId}`);
  return review?.targetType === "target" && review.fieldPath === `targetCandidates[${input.target.sourceTargetId}].${input.target.property}`
    && review.sourceDocumentHash === input.query.sourceDocumentHash && review.decision === "accepted" && review.sourceValue === input.target.originalValue;
}
const NUMBER = "[+-]?(?:\\d+(?:[.,]\\d*)?|[.,]\\d+)";
function parseNumeric(property: "ph" | "viscosity" | "density", raw: string): ParsedNumeric | undefined {
  const match = new RegExp(`^\\s*(?<lower>${NUMBER})(?:\\s*(?:-|–|—|\\bto\\b)\\s*(?<upper>${NUMBER}))?\\s*(?<tail>[\\s\\S]*)$`, "iu").exec(raw);
  if (!match?.groups) return undefined;
  // Without a verified source locale, three-digit comma or dot groups can be
  // either decimals or thousands separators, so do not guess their magnitude.
  if (/(?<!\d)\d{1,3}[.,]\d{3}(?!\d)/u.test(raw)) return undefined;
  const decimal = (value: string) => new Decimal(value.replace(",", "."));
  const lower = decimal(match.groups.lower!);
  const upper = match.groups.upper ? decimal(match.groups.upper) : lower;
  if (lower.greaterThan(upper) || (property !== "ph" && (lower.isNegative() || lower.isZero()))) return undefined;
  let tail = match.groups.tail!.trim();
  let canonicalUnit = "pH";
  if (property === "ph") {
    if (tail && !/^(?:at|@|\(|measured\b|target\b)/iu.test(tail)) return undefined;
    if (lower.isNegative() || upper.greaterThan(14)) return undefined;
  } else if (property === "viscosity") {
    const unit = /^(mPa\s*(?:[·.]\s*)?s|cP(?:s)?|centipoise|cSt|centistokes)(?=$|\s|[,;])/iu.exec(tail);
    if (!unit) return undefined;
    const spelling = unit[1]!.toLocaleLowerCase("en-US").replace(/[\s·.]/gu, "");
    canonicalUnit = spelling.startsWith("cst") || spelling.startsWith("centistoke") ? "cSt" : "mPa·s";
    if (canonicalUnit === "mPa·s" && !spelling.startsWith("mpas")) {
      return { lower: lower.times(1), upper: upper.times(1), canonicalUnit, context: normalizedContext(tail.slice(unit[0].length)) };
    }
    tail = tail.slice(unit[0].length);
  } else {
    const unit = /^(g\s*\/\s*ml|g\s*\/\s*cm(?:3|³)|kg\s*\/\s*l|kg\s*\/\s*m(?:3|³)|specific gravity|relative density|sg)(?=\s|$)/iu.exec(tail);
    if (!unit) return undefined;
    const spelling = unit[1]!.toLocaleLowerCase("en-US").replace(/\s+/gu, "").replace("³", "3");
    canonicalUnit = ["specificgravity", "relativedensity", "sg"].includes(spelling) ? "relative density" : "g/mL";
    const factor = spelling === "kg/m3" ? new Decimal("0.001") : new Decimal(1);
    tail = tail.slice(unit[0].length);
    return { lower: lower.times(factor), upper: upper.times(factor), canonicalUnit, context: normalizedContext(tail) };
  }
  return { lower, upper, canonicalUnit, context: normalizedContext(tail) };
}

/** Aggregate only accepted, source-exact target/result evidence; preserve measurement context and never update production formula targets. */
export function calculateReferenceFormulationTargetDistributions(input: {
  queryRecords: ReferenceFormulationQueryRecord[]; sourceRecords: ReferenceFormulationRecord[]; reviews: ReferenceFormulationReview[]; asOf: string;
}): ReferenceFormulationTargetDistributions {
  const eligibility = filterEligibleReferenceFormulationCorpus(input);
  const sourceById = new Map(input.sourceRecords.map((source) => [source.id, source]));
  const latest = reviewIndex(input.reviews);
  const numeric = new Map<string, NumericBuilder>();
  const categorical = new Map<string, CategoryBuilder>();
  const exclusions = new Map<ExclusionReason, number>();
  const excluded = (reason: ExclusionReason) => exclusions.set(reason, (exclusions.get(reason) ?? 0) + 1);
  for (const query of eligibility.eligible) {
    const source = sourceById.get(query.sourceRecordId)!;
    const expected = validateReferenceFormulationTargetNormalizationAgainstSource({
      normalizerVersion: "formulab-reference-formulation-target-normalization-v1", sourceStatus: query.targets.length ? "available" : "no_candidates",
      targets: query.targets, sourceWarnings: source.targetWarnings, reviewRequired: true,
    }, source).targets;
    if (JSON.stringify(query.targets) !== JSON.stringify(expected)) throw new Error("Target query values, semantics, measurement context and citations must match the immutable source snapshot.");
    const family = query.productFamily.candidates[0]!;
    const familyId = familyKey(family.rawValue);
    const keys = new Map<string, number>();
    for (const target of query.targets) {
      if (!accepted({ latest, query, target })) { excluded("target_not_reviewed"); continue; }
      if (target.property === "appearance") {
        if (target.valueShape !== "point_or_exact") { excluded("approximate_or_unparsed"); continue; }
        const context = normalizedContext("");
        const value = target.originalValue.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
        const key = [familyId, target.property, target.resultSemantics, context].join("\u0000");
        const seen = keys.get(key) ?? 0; keys.set(key, seen + 1);
        let builder = categorical.get(key);
        if (!builder) { builder = { productFamilyLabel: family.rawValue, resultSemantics: target.resultSemantics, measurementContext: context, observations: new Map() }; categorical.set(key, builder); }
        if (seen) {
          excluded("duplicate_property_context");
          if (seen === 1) excluded("duplicate_property_context");
          builder.observations.delete(query.sourceRecordId);
          continue;
        }
        builder.observations.set(query.sourceRecordId, { value, supplierId: query.supplierId, sourceRecordId: query.sourceRecordId, evidenceRefs: target.evidenceRefs });
        continue;
      }
      if (target.property === "other") { excluded("approximate_or_unparsed"); continue; }
      if (target.valueShape !== "point_or_exact" && target.valueShape !== "range") { excluded("approximate_or_unparsed"); continue; }
      const parsed = parseNumeric(target.property, target.originalValue);
      if (!parsed) { excluded("unsupported_unit"); continue; }
      const key = [familyId, target.property, target.resultSemantics, parsed.canonicalUnit, parsed.context].join("\u0000");
      const seen = keys.get(key) ?? 0; keys.set(key, seen + 1);
      let builder = numeric.get(key);
      if (!builder) { builder = { productFamilyLabel: family.rawValue, property: target.property, resultSemantics: target.resultSemantics, canonicalUnit: parsed.canonicalUnit, measurementContext: parsed.context, observations: new Map() }; numeric.set(key, builder); }
      if (seen) {
        excluded("duplicate_property_context");
        if (seen === 1) excluded("duplicate_property_context");
        builder.observations.delete(query.sourceRecordId);
        continue;
      }
      builder.observations.set(query.sourceRecordId, { ...parsed, supplierId: query.supplierId, sourceRecordId: query.sourceRecordId, evidenceRefs: target.evidenceRefs });
    }
  }
  const suppliers = (observations: Array<{ supplierId: string }>) => {
    const counts = new Map<string, number>();
    for (const observation of observations) counts.set(observation.supplierId, (counts.get(observation.supplierId) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => compare(a, b)).map(([supplierId, formulaCount]) => ({ supplierId, formulaCount, share: formulaCount / observations.length }));
  };
  const numericDistributions = [...numeric.entries()].filter(([, builder]) => builder.observations.size > 0).sort(([a], [b]) => compare(a, b)).map(([key, builder]) => {
    const observations = [...builder.observations.values()].sort((a, b) => compare(a.sourceRecordId, b.sourceRecordId));
    const lowers = observations.map((item) => item.lower.toNumber()); const uppers = observations.map((item) => item.upper.toNumber());
    return {
      productFamilyKey: key.split("\u0000")[0]!, productFamilyLabel: builder.productFamilyLabel, property: builder.property,
      resultSemantics: builder.resultSemantics, canonicalUnit: builder.canonicalUnit, measurementContext: builder.measurementContext,
      formulaCount: observations.length, supplierCount: new Set(observations.map((item) => item.supplierId)).size,
      minimumLowerBound: Math.min(...lowers), maximumUpperBound: Math.max(...uppers),
      lowerBoundQuantiles: { p25: quantile(lowers, .25), p50: quantile(lowers, .5), p75: quantile(lowers, .75) },
      upperBoundQuantiles: { p25: quantile(uppers, .25), p50: quantile(uppers, .5), p75: quantile(uppers, .75) },
      suppliers: suppliers(observations), sourceRecordIds: observations.map((item) => item.sourceRecordId),
      evidenceRefs: [...new Set(observations.flatMap((item) => item.evidenceRefs))].sort(compare), interpretation: "reviewed_reference_property_distribution" as const,
    };
  });
  const categoryDistributions = [...categorical.entries()].filter(([, builder]) => builder.observations.size > 0).sort(([a], [b]) => compare(a, b)).map(([key, builder]) => {
    const observations = [...builder.observations.values()].sort((a, b) => compare(a.sourceRecordId, b.sourceRecordId));
    const categories = new Map<string, CategoryObservation[]>();
    for (const item of observations) categories.set(item.value, [...(categories.get(item.value) ?? []), item]);
    return {
      productFamilyKey: key.split("\u0000")[0]!, productFamilyLabel: builder.productFamilyLabel, property: "appearance" as const,
      resultSemantics: builder.resultSemantics, measurementContext: builder.measurementContext, formulaCount: observations.length,
      supplierCount: new Set(observations.map((item) => item.supplierId)).size, suppliers: suppliers(observations),
      sourceRecordIds: observations.map((item) => item.sourceRecordId), evidenceRefs: [...new Set(observations.flatMap((item) => item.evidenceRefs))].sort(compare),
      categories: [...categories.entries()].sort(([a], [b]) => compare(a, b)).map(([value, items]) => ({
        value, formulaCount: items.length, supplierCount: new Set(items.map((item) => item.supplierId)).size, suppliers: suppliers(items),
        sourceRecordIds: items.map((item) => item.sourceRecordId), evidenceRefs: [...new Set(items.flatMap((item) => item.evidenceRefs))].sort(compare),
      })), interpretation: "reviewed_reference_property_distribution" as const,
    };
  });
  const excludedTargetCount = [...exclusions.values()].reduce((sum, count) => sum + count, 0);
  return referenceFormulationTargetDistributionsSchema.parse({
    schemaVersion: REFERENCE_FORMULATION_TARGET_DISTRIBUTION_VERSION, asOf: input.asOf,
    eligibleFormulaCount: eligibility.eligible.length, excludedFormulaCount: eligibility.excluded.length, excludedTargetCount,
    excludedTargetsByReason: Object.fromEntries(exclusions), eligibilityDecisions: eligibility.decisions,
    distributions: [...numericDistributions, ...categoryDistributions],
  });
}
