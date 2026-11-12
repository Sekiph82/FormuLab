import Decimal from "decimal.js";
import { z } from "zod";
import { parseExplicitMassPercentageRange } from "../schemas/singleComponentResolver";
import type { ReferenceFormulationQueryRecord } from "../schemas/referenceFormulationQuery";
import type { ReferenceFormulationRecord } from "../schemas/referenceFormulationRecord";
import { referenceFormulationReviewSchema, type ReferenceFormulationReview } from "../schemas/referenceFormulationReview";
import { filterEligibleReferenceFormulationCorpus, referenceFormulationEligibilityDecisionSchema } from "./referenceFormulationEligibility";

export const REFERENCE_FORMULATION_CONTRIBUTION_DISTRIBUTION_VERSION = "formulab-reference-formulation-contribution-distribution-v2";

const distributionSchema = z.object({
  productFamilyKey: z.string().trim().min(1),
  productFamilyLabel: z.string().trim().min(1),
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
  }).strict()),
  sourceRecordIds: z.array(z.string().trim().min(1)),
  evidenceRefs: z.array(z.string().trim().min(1)),
  interpretation: z.literal("reviewed_source_bounded_distribution"),
}).strict().superRefine((sample, context) => {
  if (sample.sourceRecordIds.length !== sample.formulaCount || new Set(sample.sourceRecordIds).size !== sample.sourceRecordIds.length
    || sample.suppliers.length !== sample.supplierCount
    || sample.suppliers.reduce((total, supplier) => total + supplier.formulaCount, 0) !== sample.formulaCount
    || sample.suppliers.some((supplier) => supplier.share !== supplier.formulaCount / sample.formulaCount
      || supplier.sourceRecordIds.length !== supplier.formulaCount || new Set(supplier.sourceRecordIds).size !== supplier.sourceRecordIds.length)
    || JSON.stringify(sample.suppliers.flatMap((supplier) => supplier.sourceRecordIds).sort(stableCompare))
      !== JSON.stringify([...sample.sourceRecordIds].sort(stableCompare))
    || (sample.quantityKind === "component_contribution") !== (sample.canonicalChemistryId !== undefined)
    || sample.minimumLowerBound > sample.maximumUpperBound
    || [sample.lowerBoundQuantiles.p25, sample.lowerBoundQuantiles.p50, sample.lowerBoundQuantiles.p75,
      sample.upperBoundQuantiles.p25, sample.upperBoundQuantiles.p50, sample.upperBoundQuantiles.p75]
      .some((value) => value < sample.minimumLowerBound || value > sample.maximumUpperBound)
    || sample.lowerBoundQuantiles.p25 > sample.upperBoundQuantiles.p25
    || sample.lowerBoundQuantiles.p50 > sample.upperBoundQuantiles.p50
    || sample.lowerBoundQuantiles.p75 > sample.upperBoundQuantiles.p75) {
    context.addIssue({ code: "custom", path: ["formulaCount"], message: "Contribution distribution counts, evidence, kind and bounds must agree." });
  }
});

const exclusionReasonSchema = z.enum([
  "active_claim_not_unique", "active_claim_not_reviewed", "active_claim_percent_not_supported",
  "component_not_quantified", "component_evidence_incomplete", "component_not_reviewed", "component_amount_not_reviewed",
]);

export const referenceFormulationContributionDistributionsSchema = z.object({
  schemaVersion: z.literal(REFERENCE_FORMULATION_CONTRIBUTION_DISTRIBUTION_VERSION),
  asOf: z.string().datetime({ offset: true }),
  eligibleFormulaCount: z.number().int().nonnegative(),
  excludedFormulaCount: z.number().int().nonnegative(),
  excludedSampleCount: z.number().int().nonnegative(),
  excludedSamplesByReason: z.partialRecord(exclusionReasonSchema, z.number().int().positive()),
  eligibilityDecisions: z.array(referenceFormulationEligibilityDecisionSchema),
  eligibleSourceRecordIdsByProductFamily: z.record(z.string().trim().min(1), z.array(z.string().trim().min(1))),
  distributions: z.array(distributionSchema),
}).strict().superRefine((result, context) => {
  const exclusions = Object.values(result.excludedSamplesByReason).reduce((sum, count) => sum + count, 0);
  const eligibleFamilySourceIds = Object.values(result.eligibleSourceRecordIdsByProductFamily).flat();
  const eligibleDecisionSourceIds = result.eligibilityDecisions.filter((decision) => decision.eligible).map((decision) => decision.sourceRecordId);
  if (result.eligibleFormulaCount + result.excludedFormulaCount !== result.eligibilityDecisions.length
    || exclusions !== result.excludedSampleCount
    || new Set(eligibleFamilySourceIds).size !== eligibleFamilySourceIds.length
    || JSON.stringify([...eligibleFamilySourceIds].sort(stableCompare)) !== JSON.stringify([...eligibleDecisionSourceIds].sort(stableCompare))
    || Object.values(result.eligibleSourceRecordIdsByProductFamily).some((ids) => new Set(ids).size !== ids.length)
    || result.distributions.some((sample) => sample.sourceRecordIds.some((sourceId) => !result.eligibleSourceRecordIdsByProductFamily[sample.productFamilyKey]?.includes(sourceId)))) {
    context.addIssue({ code: "custom", path: ["eligibilityDecisions"], message: "Contribution distribution totals must match eligibility and exclusion evidence." });
  }
});

export type ReferenceFormulationContributionDistributions = z.infer<typeof referenceFormulationContributionDistributionsSchema>;
type Range = { lower: Decimal; upper: Decimal };
type Observation = Range & { supplierId: string; sourceRecordId: string; evidenceRefs: string[] };
type Builder = { familyLabel: string; quantityKind: "active_matter_claim" | "component_contribution"; chemicalId?: string; observations: Map<string, Observation> };
type ExclusionReason = z.infer<typeof exclusionReasonSchema>;

function stableCompare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function familyKey(value: string): string { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"); }
function quantile(values: number[], p: number): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!; }

function reviewIndex(input: ReferenceFormulationReview[]): Map<string, ReferenceFormulationReview> {
  const parsed = input.map((item) => referenceFormulationReviewSchema.parse(item));
  if (new Set(parsed.map((item) => item.id)).size !== parsed.length) throw new Error("Contribution distribution input cannot contain duplicate review event IDs.");
  const latest = new Map<string, ReferenceFormulationReview>();
  for (const item of parsed) {
    const key = `${item.referenceFormulationRecordId}\u0000${item.targetKey}`;
    const prior = latest.get(key);
    if (!prior || Date.parse(item.reviewedAt) > Date.parse(prior.reviewedAt)
      || (Date.parse(item.reviewedAt) === Date.parse(prior.reviewedAt) && stableCompare(item.id, prior.id) > 0)) latest.set(key, item);
  }
  return latest;
}

function accepted(input: { latest: Map<string, ReferenceFormulationReview>; query: ReferenceFormulationQueryRecord; targetKey: string; fieldPath: string; sourceValue: string; targetType?: ReferenceFormulationReview["targetType"] }): boolean {
  const item = input.latest.get(`${input.query.sourceRecordId}\u0000${input.targetKey}`);
  return item?.targetType === (input.targetType ?? "ingredient") && item.fieldPath === input.fieldPath && item.sourceDocumentHash === input.query.sourceDocumentHash
    && item.decision === "accepted" && item.sourceValue === input.sourceValue;
}

function addObservation(builders: Map<string, Builder>, input: { key: string; familyLabel: string; quantityKind: Builder["quantityKind"]; chemicalId?: string; query: ReferenceFormulationQueryRecord; range: Range; evidenceRefs: string[] }): void {
  let builder = builders.get(input.key);
  if (!builder) {
    builder = { familyLabel: input.familyLabel, quantityKind: input.quantityKind, ...(input.chemicalId ? { chemicalId: input.chemicalId } : {}), observations: new Map() };
    builders.set(input.key, builder);
  }
  const existing = builder.observations.get(input.query.sourceRecordId);
  if (!existing) builder.observations.set(input.query.sourceRecordId, {
    ...input.range, supplierId: input.query.supplierId, sourceRecordId: input.query.sourceRecordId, evidenceRefs: [...new Set(input.evidenceRefs)].sort(stableCompare),
  });
  else {
    existing.lower = existing.lower.plus(input.range.lower);
    existing.upper = existing.upper.plus(input.range.upper);
    existing.evidenceRefs = [...new Set([...existing.evidenceRefs, ...input.evidenceRefs])].sort(stableCompare);
  }
}

/** Compute source-bounded active-matter and disclosed component contributions separately; never infer from SDS concentration alone. */
export function calculateReferenceFormulationContributionDistributions(input: {
  queryRecords: ReferenceFormulationQueryRecord[];
  sourceRecords: ReferenceFormulationRecord[];
  reviews: ReferenceFormulationReview[];
  asOf: string;
}): ReferenceFormulationContributionDistributions {
  const eligibility = filterEligibleReferenceFormulationCorpus(input);
  const latest = reviewIndex(input.reviews);
  const builders = new Map<string, Builder>();
  const exclusions = new Map<ExclusionReason, number>();
  const eligibleSourceRecordIdsByProductFamily = new Map<string, string[]>();
  const exclude = (reason: ExclusionReason) => exclusions.set(reason, (exclusions.get(reason) ?? 0) + 1);

  for (const query of eligibility.eligible) {
    const family = query.productFamily.candidates[0]!;
    const familyId = familyKey(family.rawValue);
    const familySourceIds = eligibleSourceRecordIdsByProductFamily.get(familyId) ?? [];
    familySourceIds.push(query.sourceRecordId);
    eligibleSourceRecordIdsByProductFamily.set(familyId, familySourceIds);
    if (query.activeMatterClaims.length > 0) {
      if (query.activeMatterClaims.length !== 1) exclude("active_claim_not_unique");
      else {
        const claim = query.activeMatterClaims[0]!;
        const index = 0;
        const targetKey = `active_matter_claim:${index}:percentRange`;
        const fieldPath = `activeMatterClaims[${index}].percentRange`;
        if (!claim.percentRange || !accepted({ latest, query, targetKey, fieldPath, sourceValue: claim.originalValue, targetType: "target" })) exclude("active_claim_not_reviewed");
        else {
          const parsed = parseExplicitMassPercentageRange(claim.originalValue);
          if (!parsed || parsed.lowerBound !== claim.percentRange.lowerBound || parsed.upperBound !== claim.percentRange.upperBound
            || claim.evidenceRefs.some((ref) => !ref.startsWith(`formula:${query.sourceDocumentHash}:`))) exclude("active_claim_percent_not_supported");
          else addObservation(builders, {
            key: `${familyId}\u0000active_matter_claim`, familyLabel: family.rawValue, quantityKind: "active_matter_claim", query,
            range: { lower: new Decimal(parsed.lowerBound), upper: new Decimal(parsed.upperBound) }, evidenceRefs: claim.evidenceRefs,
          });
        }
      }
    }

    const componentGroups = new Map<string, { distributionKey: string; chemicalId: string; range: Range; evidenceRefs: string[]; valid: boolean; reason?: ExclusionReason }>();
    const rejectedChemistryIds = new Set<string>();
    for (const line of query.lines) {
      for (const contribution of line.componentContributions) {
        const chemistryId = contribution.canonicalChemistry.candidateIds[0];
        const contributionKey = `normalization:${query.normalizationId}:contribution:${contribution.contributionId}:canonicalChemistry:${chemistryId ?? ""}`;
        const contributionPath = `normalizations[${query.normalizationId}].lines[${line.sourceLineId}].componentContributions[${contribution.contributionId}].canonicalChemistry`;
        const amountAccepted = Boolean(line.amount.originalValue && line.amount.unit && line.amount.basis
          && accepted({ latest, query, targetKey: `ingredient:${line.sourceLineId}:amount`, fieldPath: `ingredientLines[${line.sourceLineId}].amount`, sourceValue: line.amount.originalValue })
          && accepted({ latest, query, targetKey: `ingredient:${line.sourceLineId}:unit`, fieldPath: `ingredientLines[${line.sourceLineId}].unit`, sourceValue: line.amount.unit })
          && accepted({ latest, query, targetKey: `ingredient:${line.sourceLineId}:basis`, fieldPath: `ingredientLines[${line.sourceLineId}].basis`, sourceValue: line.amount.basis }));
        const sds = contribution.sourceSds;
        const formulaRange = line.amount.originalValue && line.amount.unit && line.amount.basis
          ? parseExplicitMassPercentageRange(`${line.amount.originalValue} ${line.amount.unit} ${line.amount.basis}`) : undefined;
        const sdsRange = sds.originalValue ? parseExplicitMassPercentageRange(sds.originalValue) : undefined;
        const evidenceComplete = contribution.status !== "unknown" && contribution.componentContributionPercentRange !== undefined
          && line.amount.quantitySemantics === "explicit_amount" && ["%", "percent", "percentage", "wt%", "wt.%"].includes((line.amount.unit ?? "").trim().toLocaleLowerCase("en-US"))
          && ["w/w", "weight/weight", "mass/mass", "by weight"].includes((line.amount.basis ?? "").trim().toLocaleLowerCase("en-US"))
          && formulaRange !== undefined && contribution.formulaAmount.originalValue === line.amount.originalValue
          && contribution.formulaAmount.unit === line.amount.unit && contribution.formulaAmount.basis === line.amount.basis
          && line.amount.evidenceRefs.every((ref) => contribution.formulaAmount.evidenceRefs.includes(ref))
          && contribution.formulaAmount.evidenceRefs.every((ref) => ref.startsWith(`formula:${query.sourceDocumentHash}:`))
          && contribution.formulaAmount.percentRange?.lowerBound === formulaRange.lowerBound
          && contribution.formulaAmount.percentRange.upperBound === formulaRange.upperBound
          && sds.status === "available" && sds.sectionNumber === 3 && sds.disclosure === "disclosed" && Boolean(sds.sourceComponentId && sds.sourceFactId && sds.originalValue && sds.commercialProductId && sds.documentHash)
          && sds.evidenceRefs.length > 0 && sdsRange !== undefined
          && sds.fractionRange?.lowerBound === sdsRange.lowerBound / 100 && sds.fractionRange.upperBound === sdsRange.upperBound / 100
          && contribution.commercialProductId === sds.commercialProductId
          && line.commercialProducts.candidateIds.includes(sds.commercialProductId ?? "")
          && sds.interpretation !== "unknown" && Boolean(sds.fractionRange)
          && contribution.formulaAmount.interpretation !== "unknown" && Boolean(contribution.formulaAmount.percentRange)
          && chemistryId !== undefined && contribution.canonicalChemistry.status === "proposed"
          && accepted({ latest, query, targetKey: contributionKey, fieldPath: contributionPath, sourceValue: chemistryId });
        if (!evidenceComplete) {
          const reason: ExclusionReason = !amountAccepted ? "component_amount_not_reviewed"
            : contribution.status === "unknown" || !contribution.componentContributionPercentRange ? "component_not_quantified"
              : chemistryId && !accepted({ latest, query, targetKey: contributionKey, fieldPath: contributionPath, sourceValue: chemistryId }) ? "component_not_reviewed" : "component_evidence_incomplete";
          const exclusionKey = `${familyId}\u0000${line.sourceLineId}\u0000${contribution.contributionId}`;
          componentGroups.set(exclusionKey, { distributionKey: `${familyId}\u0000${chemistryId ?? ""}`, chemicalId: chemistryId ?? "", range: { lower: new Decimal(0), upper: new Decimal(0) }, evidenceRefs: [], valid: false, reason });
          if (chemistryId) rejectedChemistryIds.add(`${familyId}\u0000${chemistryId}`);
          continue;
        }
        const productId = sds.commercialProductId!;
        const sourceIdentity = [productId, sds.acquisitionCode, sds.documentHash, sds.sourceComponentId, sds.sourceFactId].join("\u0000");
        const key = `${familyId}\u0000${chemistryId}`;
        const bounds = contribution.componentContributionPercentRange!;
        const range = { lower: new Decimal(bounds.lowerBound), upper: new Decimal(bounds.upperBound) };
        const current = componentGroups.get(`${key}\u0000${sourceIdentity}`);
        if (current) { current.range.lower = current.range.lower.plus(range.lower); current.range.upper = current.range.upper.plus(range.upper); }
        else componentGroups.set(`${key}\u0000${sourceIdentity}`, {
          distributionKey: key, chemicalId: chemistryId!, range, evidenceRefs: [...contribution.formulaAmount.evidenceRefs, ...sds.evidenceRefs], valid: true,
        });
      }
    }
    const componentTotals = new Map<string, { chemicalId: string; range: Range; evidenceRefs: string[] }>();
    for (const group of componentGroups.values()) {
      if (!group.valid) { exclude(group.reason!); continue; }
      const chemicalKey = group.distributionKey;
      const total = componentTotals.get(chemicalKey);
      if (total) {
        total.range.lower = total.range.lower.plus(group.range.lower);
        total.range.upper = total.range.upper.plus(group.range.upper);
        total.evidenceRefs.push(...group.evidenceRefs);
      } else componentTotals.set(chemicalKey, { chemicalId: group.chemicalId, range: group.range, evidenceRefs: [...group.evidenceRefs] });
    }
    for (const [key, total] of componentTotals) {
      if (rejectedChemistryIds.has(key)) continue;
      if (total.range.lower.isNegative() || total.range.upper.gt(100) || total.range.lower.gt(total.range.upper)) {
        exclude("component_evidence_incomplete");
        continue;
      }
      addObservation(builders, {
        key, familyLabel: family.rawValue, quantityKind: "component_contribution", chemicalId: total.chemicalId, query,
        range: total.range, evidenceRefs: total.evidenceRefs,
      });
    }
  }

  const distributions = [...builders.entries()].sort(([a], [b]) => stableCompare(a, b)).flatMap(([key, builder]) => {
    const familyId = key.split("\u0000")[0]!;
    const observations = [...builder.observations.values()].sort((a, b) => stableCompare(a.sourceRecordId, b.sourceRecordId));
    if (!observations.length) return [];
    const lower = observations.map((item) => item.lower.toNumber());
    const upper = observations.map((item) => item.upper.toNumber());
    const suppliers = new Map<string, number>();
    for (const observation of observations) suppliers.set(observation.supplierId, (suppliers.get(observation.supplierId) ?? 0) + 1);
    return [{
      productFamilyKey: familyId, productFamilyLabel: builder.familyLabel, quantityKind: builder.quantityKind,
      ...(builder.chemicalId ? { canonicalChemistryId: builder.chemicalId } : {}), formulaCount: observations.length, supplierCount: suppliers.size,
      minimumLowerBound: Math.min(...lower), maximumUpperBound: Math.max(...upper),
      lowerBoundQuantiles: { p25: quantile(lower, 0.25), p50: quantile(lower, 0.5), p75: quantile(lower, 0.75) },
      upperBoundQuantiles: { p25: quantile(upper, 0.25), p50: quantile(upper, 0.5), p75: quantile(upper, 0.75) },
      suppliers: [...suppliers.entries()].sort(([a], [b]) => stableCompare(a, b)).map(([supplierId, formulaCount]) => ({
        supplierId, formulaCount, share: formulaCount / observations.length,
        sourceRecordIds: observations.filter((item) => item.supplierId === supplierId).map((item) => item.sourceRecordId),
      })),
      sourceRecordIds: observations.map((item) => item.sourceRecordId), evidenceRefs: [...new Set(observations.flatMap((item) => item.evidenceRefs))].sort(stableCompare),
      interpretation: "reviewed_source_bounded_distribution" as const,
    }];
  });
  const excludedSamplesByReason = Object.fromEntries([...exclusions.entries()].sort(([a], [b]) => stableCompare(a, b))) as ReferenceFormulationContributionDistributions["excludedSamplesByReason"];
  return referenceFormulationContributionDistributionsSchema.parse({
    schemaVersion: REFERENCE_FORMULATION_CONTRIBUTION_DISTRIBUTION_VERSION, asOf: input.asOf,
    eligibleFormulaCount: eligibility.eligible.length, excludedFormulaCount: eligibility.excluded.length,
    excludedSampleCount: [...exclusions.values()].reduce((sum, value) => sum + value, 0), excludedSamplesByReason,
    eligibilityDecisions: eligibility.decisions,
    eligibleSourceRecordIdsByProductFamily: Object.fromEntries([...eligibleSourceRecordIdsByProductFamily.entries()]
      .sort(([left], [right]) => stableCompare(left, right)).map(([key, ids]) => [key, ids.sort(stableCompare)])),
    distributions,
  });
}
