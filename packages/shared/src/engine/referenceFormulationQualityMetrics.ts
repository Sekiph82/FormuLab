import { z } from "zod";
import {
  referenceFormulationQueryRecordSchema,
  type ReferenceFormulationQueryRecord,
} from "../schemas/referenceFormulationQuery";
import {
  referenceFormulationRecordSchema,
  type ReferenceFormulationRecord,
} from "../schemas/referenceFormulationRecord";
import {
  referenceFormulationReviewSchema,
  type ReferenceFormulationReview,
} from "../schemas/referenceFormulationReview";

export const REFERENCE_FORMULATION_CORPUS_TARGET_SIZE = 2_000;
export const REFERENCE_FORMULATION_QUALITY_METRICS_VERSION = "formulab-reference-formulation-quality-v1";

const ratioSchema = z.object({
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative(),
  rate: z.number().finite().min(0).max(1).nullable(),
}).strict().superRefine((value, context) => {
  if (value.numerator > value.denominator || (value.denominator === 0) !== (value.rate === null)
    || (value.denominator > 0 && value.rate !== value.numerator / value.denominator)) {
    context.addIssue({ code: "custom", path: ["rate"], message: "Quality rate must agree with its denominator and numerator." });
  }
});

export const referenceFormulationCorpusQualityMetricsSchema = z.object({
  schemaVersion: z.literal(REFERENCE_FORMULATION_QUALITY_METRICS_VERSION),
  asOf: z.string().datetime({ offset: true }),
  corpus: z.object({
    targetFormulaCount: z.literal(REFERENCE_FORMULATION_CORPUS_TARGET_SIZE),
    formulaCount: z.number().int().nonnegative(),
    targetReached: z.boolean(),
    progressRate: z.number().finite().min(0).max(1),
  }).strict(),
  productFamilyCoverage: ratioSchema,
  supplierDistribution: z.array(z.object({
    supplierId: z.string().trim().min(1),
    formulaCount: z.number().int().positive(),
    share: z.number().finite().min(0).max(1),
  }).strict()),
  lineResolution: z.object({
    lineCount: z.number().int().nonnegative(),
    resolvedLineCount: z.number().int().nonnegative(),
    unresolvedLineCount: z.number().int().nonnegative(),
    ambiguousLineCount: z.number().int().nonnegative(),
    resolvedLineRate: z.number().finite().min(0).max(1).nullable(),
    unresolvedLineRate: z.number().finite().min(0).max(1).nullable(),
    resolutionMeaning: z.literal("Both commercial-product and canonical-chemistry fields have one review-required candidate; this is not human approval."),
  }).strict().superRefine((value, context) => {
    if (value.resolvedLineCount + value.unresolvedLineCount + value.ambiguousLineCount !== value.lineCount
      || (value.lineCount === 0) !== (value.resolvedLineRate === null && value.unresolvedLineRate === null)) {
      context.addIssue({ code: "custom", path: ["lineCount"], message: "Line resolution counts must partition all lines and rates must match the denominator." });
    }
  }),
  evidenceCoverage: z.object({
    evidenceBackedLineCount: z.number().int().nonnegative(),
    lineCount: z.number().int().nonnegative(),
    evidenceBackedLineRate: z.number().finite().min(0).max(1).nullable(),
  }).strict(),
  parserConfidence: z.object({
    mean: z.number().finite().min(0).max(1).nullable(),
    confidenceTotal: z.number().finite().nonnegative(),
    confidenceSampleCount: z.number().int().nonnegative(),
    evidenceItemCount: z.number().int().nonnegative(),
    confidenceCoverageRate: z.number().finite().min(0).max(1).nullable(),
  }).strict(),
  revisionAge: z.object({
    datedFormulaCount: z.number().int().nonnegative(),
    missingRevisionDateCount: z.number().int().nonnegative(),
    unparseableRevisionDateCount: z.number().int().nonnegative(),
    futureRevisionDateCount: z.number().int().nonnegative(),
    totalDays: z.number().finite().nonnegative(),
    meanDays: z.number().finite().nonnegative().nullable(),
    medianDays: z.number().finite().nonnegative().nullable(),
    maxDays: z.number().finite().nonnegative().nullable(),
  }).strict(),
  reviewCompletion: z.object({
    scope: z.literal("Source extraction field review only; normalization candidates, process steps, conditions and targets remain review-required and are counted separately."),
    reviewableItemCount: z.number().int().nonnegative(),
    completedItemCount: z.number().int().nonnegative(),
    needsReviewItemCount: z.number().int().nonnegative(),
    unreviewedItemCount: z.number().int().nonnegative(),
    completionRate: z.number().finite().min(0).max(1).nullable(),
    fullyReviewedFormulaCount: z.number().int().nonnegative(),
    formulaCount: z.number().int().nonnegative(),
    fullyReviewedFormulaRate: z.number().finite().min(0).max(1).nullable(),
  }).strict(),
  normalizationCandidateCountPendingReview: z.number().int().nonnegative(),
  normalizationProcessStepReviewRequiredCount: z.number().int().nonnegative(),
  normalizationProcessConditionReviewRequiredCount: z.number().int().nonnegative(),
  normalizationTargetReviewRequiredCount: z.number().int().nonnegative(),
}).strict().superRefine((metrics, context) => {
  const formulas = metrics.corpus.formulaCount;
  const lines = metrics.lineResolution.lineCount;
  const supplierTotal = metrics.supplierDistribution.reduce((total, item) => total + item.formulaCount, 0);
  if (metrics.corpus.targetReached !== (formulas >= REFERENCE_FORMULATION_CORPUS_TARGET_SIZE)
    || metrics.corpus.progressRate !== Math.min(1, formulas / REFERENCE_FORMULATION_CORPUS_TARGET_SIZE)) {
    context.addIssue({ code: "custom", path: ["corpus"], message: "Corpus target status and progress must match the formula count." });
  }
  if (metrics.productFamilyCoverage.denominator !== formulas || supplierTotal !== formulas
    || metrics.revisionAge.datedFormulaCount + metrics.revisionAge.missingRevisionDateCount
      + metrics.revisionAge.unparseableRevisionDateCount + metrics.revisionAge.futureRevisionDateCount !== formulas
    || metrics.reviewCompletion.formulaCount !== formulas) {
    context.addIssue({ code: "custom", path: ["corpus", "formulaCount"], message: "Formula-level quality denominators must match the corpus size." });
  }
  if (metrics.evidenceCoverage.lineCount !== lines
    || metrics.evidenceCoverage.evidenceBackedLineCount > lines
    || metrics.parserConfidence.confidenceSampleCount > metrics.parserConfidence.evidenceItemCount
    || metrics.parserConfidence.confidenceTotal > metrics.parserConfidence.confidenceSampleCount
    || metrics.reviewCompletion.completedItemCount + metrics.reviewCompletion.needsReviewItemCount
      + metrics.reviewCompletion.unreviewedItemCount !== metrics.reviewCompletion.reviewableItemCount
    || metrics.reviewCompletion.fullyReviewedFormulaCount > formulas) {
    context.addIssue({ code: "custom", path: ["evidenceCoverage"], message: "Line, confidence and review totals must remain internally consistent." });
  }
  if ((lines === 0) !== (metrics.lineResolution.resolvedLineRate === null && metrics.lineResolution.unresolvedLineRate === null)
    || (lines > 0 && (metrics.lineResolution.resolvedLineRate !== metrics.lineResolution.resolvedLineCount / lines
      || metrics.lineResolution.unresolvedLineRate !== metrics.lineResolution.unresolvedLineCount / lines))
    || (lines === 0) !== (metrics.evidenceCoverage.evidenceBackedLineRate === null)
    || (lines > 0 && metrics.evidenceCoverage.evidenceBackedLineRate !== metrics.evidenceCoverage.evidenceBackedLineCount / lines)
    || (metrics.parserConfidence.evidenceItemCount === 0) !== (metrics.parserConfidence.confidenceCoverageRate === null)
    || (metrics.parserConfidence.evidenceItemCount > 0 && metrics.parserConfidence.confidenceCoverageRate
      !== metrics.parserConfidence.confidenceSampleCount / metrics.parserConfidence.evidenceItemCount)
    || (metrics.parserConfidence.confidenceSampleCount === 0) !== (metrics.parserConfidence.mean === null)
    || (metrics.parserConfidence.confidenceSampleCount > 0 && metrics.parserConfidence.mean
      !== metrics.parserConfidence.confidenceTotal / metrics.parserConfidence.confidenceSampleCount)
    || (metrics.reviewCompletion.reviewableItemCount === 0) !== (metrics.reviewCompletion.completionRate === null)
    || (metrics.reviewCompletion.reviewableItemCount > 0 && metrics.reviewCompletion.completionRate
      !== metrics.reviewCompletion.completedItemCount / metrics.reviewCompletion.reviewableItemCount)
    || (formulas === 0) !== (metrics.reviewCompletion.fullyReviewedFormulaRate === null)) {
    context.addIssue({ code: "custom", path: ["parserConfidence"], message: "Quality rates and nullable averages must match their sample counts." });
  }
  if ((metrics.revisionAge.datedFormulaCount === 0) !== (metrics.revisionAge.meanDays === null)
    || (metrics.revisionAge.datedFormulaCount > 0
      && metrics.revisionAge.meanDays !== metrics.revisionAge.totalDays / metrics.revisionAge.datedFormulaCount)) {
    context.addIssue({ code: "custom", path: ["revisionAge"], message: "Mean revision age must match its dated-formula count and total." });
  }
  if ((formulas > 0 && metrics.reviewCompletion.fullyReviewedFormulaRate !== metrics.reviewCompletion.fullyReviewedFormulaCount / formulas)
    || metrics.supplierDistribution.some((supplier) => supplier.share !== supplier.formulaCount / formulas)) {
    context.addIssue({ code: "custom", path: ["reviewCompletion"], message: "Supplier shares and review completion rates must match their counts." });
  }
});

export type ReferenceFormulationCorpusQualityMetrics = z.infer<typeof referenceFormulationCorpusQualityMetricsSchema>;

function ratio(numerator: number, denominator: number): z.infer<typeof ratioSchema> {
  return { numerator, denominator, rate: denominator === 0 ? null : numerator / denominator };
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type EvidenceWithConfidence = { confidence?: number };

function sourceEvidence(record: ReferenceFormulationRecord): EvidenceWithConfidence[] {
  const evidence: EvidenceWithConfidence[] = [];
  for (const candidate of record.identityCandidates) evidence.push(...candidate.evidence);
  for (const line of record.ingredientLines) {
    for (const field of [line.ingredientName, line.supplierProductCode, line.inciOrChemicalName, line.function, line.phase, line.amount, line.unit, line.basis]) {
      if (field) evidence.push(field.evidence);
    }
  }
  if (record.arithmetic.sourceDeclaredTotal) evidence.push(record.arithmetic.sourceDeclaredTotal.evidence);
  for (const step of record.procedureSteps) {
    evidence.push(step.evidence);
    if (step.phase) evidence.push(step.phase.evidence);
    for (const condition of step.conditions) evidence.push(condition.evidence);
  }
  for (const target of record.targetCandidates) evidence.push(target.evidence);
  return evidence;
}

function expectedReviewTargets(record: ReferenceFormulationRecord): string[] {
  const targets = record.identityCandidates.map((candidate, index) => `identity:${candidate.field}:${index}`);
  const ingredientFields = ["ingredientName", "supplierProductCode", "inciOrChemicalName", "function", "phase", "amount", "unit", "basis"] as const;
  for (const line of record.ingredientLines) {
    for (const field of ingredientFields) if (line[field]) targets.push(`ingredient:${line.id}:${field}`);
  }
  for (const step of record.procedureSteps) {
    targets.push(`procedure:${step.id}:instruction`);
    step.conditions.forEach((_, index) => targets.push(`procedure:${step.id}:condition:${index}`));
  }
  for (const target of record.targetCandidates) targets.push(`target:${target.id}`);
  return targets;
}

function dateMillis(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function revisionDateMillis(value: string): number | undefined {
  const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T(.+))?$/u);
  if (iso) {
    if (iso[4]) return dateMillis(value);
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const date = new Date(timestamp);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? timestamp : undefined;
  }
  const months: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
    oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
  };
  const monthDayYear = value.trim().match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/u);
  const dayMonthYear = value.trim().match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/u);
  const compactDayMonthYear = value.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/iu);
  const month = monthDayYear ? months[monthDayYear[1]!.toLocaleLowerCase("en-US")]
    : dayMonthYear ? months[dayMonthYear[2]!.toLocaleLowerCase("en-US")]
      : compactDayMonthYear ? months[compactDayMonthYear[2]!.toLocaleLowerCase("en-US")] : undefined;
  const day = monthDayYear ? Number(monthDayYear[2]) : dayMonthYear ? Number(dayMonthYear[1])
    : compactDayMonthYear ? Number(compactDayMonthYear[1]) : undefined;
  const year = monthDayYear ? Number(monthDayYear[3]) : dayMonthYear ? Number(dayMonthYear[3])
    : compactDayMonthYear ? Number(compactDayMonthYear[3]) : undefined;
  if (month === undefined || day === undefined || year === undefined) return undefined;
  const timestamp = Date.UTC(year, month, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day ? timestamp : undefined;
}

function selectLatestQueries(inputs: ReferenceFormulationQueryRecord[]): ReferenceFormulationQueryRecord[] {
  const records = inputs.map((input) => referenceFormulationQueryRecordSchema.parse(input));
  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error("Corpus quality input cannot contain duplicate query record IDs.");
  }
  const versions = new Set<string>();
  for (const record of records) {
    const key = `${record.sourceRecordId}\u0000${record.normalizationVersion}`;
    if (versions.has(key)) throw new Error("Corpus quality input cannot contain competing query snapshots at one normalization version.");
    versions.add(key);
  }
  const latest = new Map<string, ReferenceFormulationQueryRecord>();
  for (const record of records.sort((left, right) => compareStable(left.sourceRecordId, right.sourceRecordId)
    || left.normalizationVersion - right.normalizationVersion || compareStable(left.id, right.id))) {
    const prior = latest.get(record.sourceRecordId);
    if (!prior || record.normalizationVersion > prior.normalizationVersion) latest.set(record.sourceRecordId, record);
  }
  return [...latest.values()].sort((left, right) => compareStable(left.sourceRecordId, right.sourceRecordId));
}

/** Calculate deterministic corpus health without turning unresolved candidates or missing confidence into approved facts. */
export function calculateReferenceFormulationCorpusQualityMetrics(input: {
  queryRecords: ReferenceFormulationQueryRecord[];
  sourceRecords: ReferenceFormulationRecord[];
  reviews: ReferenceFormulationReview[];
  asOf: string;
}): ReferenceFormulationCorpusQualityMetrics {
  const asOfMs = dateMillis(input.asOf);
  if (asOfMs === undefined) throw new Error("Corpus quality metrics require a valid as-of timestamp.");
  const asOf = z.string().datetime({ offset: true }).parse(input.asOf);
  const queries = selectLatestQueries(input.queryRecords);
  const sources = input.sourceRecords.map((record) => referenceFormulationRecordSchema.parse(record));
  const sourceById = new Map(sources.map((record) => [record.id, record]));
  if (sourceById.size !== sources.length) throw new Error("Corpus quality input cannot contain duplicate source record IDs.");
  for (const query of queries) {
    const source = sourceById.get(query.sourceRecordId);
    if (!source || source.sourceDocumentHash.toLowerCase() !== query.sourceDocumentHash.toLowerCase()) {
      throw new Error("Every query snapshot must link to the matching immutable source record and hash.");
    }
  }

  const reviews = input.reviews.map((review) => referenceFormulationReviewSchema.parse(review));
  if (new Set(reviews.map((review) => review.id)).size !== reviews.length) {
    throw new Error("Corpus review input cannot contain duplicate review event IDs.");
  }
  const latestReviews = new Map<string, ReferenceFormulationReview>();
  for (const review of reviews) {
    const source = sourceById.get(review.referenceFormulationRecordId);
    if (!source || source.sourceDocumentHash.toLowerCase() !== review.sourceDocumentHash.toLowerCase()) {
      throw new Error("Corpus review evidence must link to a known immutable source record and hash.");
    }
    const key = `${review.referenceFormulationRecordId}\u0000${review.targetKey}`;
    const prior = latestReviews.get(key);
    const reviewedAt = dateMillis(review.reviewedAt)!;
    const priorReviewedAt = prior ? dateMillis(prior.reviewedAt)! : undefined;
    if (!prior || reviewedAt > priorReviewedAt! || (reviewedAt === priorReviewedAt && review.id > prior.id)) {
      latestReviews.set(key, review);
    }
  }

  let familyCovered = 0;
  const supplierCounts = new Map<string, number>();
  const revisionAges: number[] = [];
  let missingRevisionDateCount = 0;
  let unparseableRevisionDateCount = 0;
  let futureRevisionDateCount = 0;
  let evidenceBackedLineCount = 0;
  let lineCount = 0;
  let resolvedLineCount = 0;
  let unresolvedLineCount = 0;
  let ambiguousLineCount = 0;
  const confidenceValues: number[] = [];
  let evidenceItemCount = 0;
  let reviewableItemCount = 0;
  let completedItemCount = 0;
  let needsReviewItemCount = 0;
  let fullyReviewedFormulaCount = 0;
  let normalizationCandidateCountPendingReview = 0;
  let normalizationProcessStepReviewRequiredCount = 0;
  let normalizationProcessConditionReviewRequiredCount = 0;
  let normalizationTargetReviewRequiredCount = 0;

  for (const query of queries) {
    supplierCounts.set(query.supplierId, (supplierCounts.get(query.supplierId) ?? 0) + 1);
    if (query.productFamily.status !== "unresolved") familyCovered += 1;
    const source = sourceById.get(query.sourceRecordId)!;
    if (query.productFamily.status !== "unresolved") normalizationCandidateCountPendingReview += query.productFamily.candidates.length;
    normalizationProcessStepReviewRequiredCount += query.processSteps.length;
    normalizationProcessConditionReviewRequiredCount += query.processSteps.reduce((total, step) => total + step.conditions.length, 0);
    normalizationTargetReviewRequiredCount += query.targets.length;
    const revisionValue = source.source.revisionDate ?? source.source.publicationDate;
    if (!revisionValue) missingRevisionDateCount += 1;
    else {
      const revisionMs = revisionDateMillis(revisionValue);
      if (revisionMs === undefined) unparseableRevisionDateCount += 1;
      else if (revisionMs > asOfMs) futureRevisionDateCount += 1;
      else revisionAges.push((asOfMs - revisionMs) / 86_400_000);
    }
    for (const line of query.lines) {
      lineCount += 1;
      const hasLineEvidence = line.sourceLineEvidenceRefs.length > 0 || line.supplierFunction.evidenceRefs.length > 0
        || line.amount.evidenceRefs.length > 0
        || line.componentContributions.some((contribution) => contribution.formulaAmount.evidenceRefs.length > 0
          || contribution.sourceSds.evidenceRefs.length > 0);
      if (hasLineEvidence) evidenceBackedLineCount += 1;
      if (line.commercialProducts.status === "proposed" && line.canonicalChemistry.status === "proposed") resolvedLineCount += 1;
      else if (line.commercialProducts.status === "unresolved" || line.canonicalChemistry.status === "unresolved") unresolvedLineCount += 1;
      else ambiguousLineCount += 1;
      normalizationCandidateCountPendingReview += line.commercialProducts.candidateIds.length
        + line.canonicalChemistry.candidateIds.length + line.canonicalFunctions.candidateIds.length;
      for (const contribution of line.componentContributions) {
        normalizationCandidateCountPendingReview += contribution.canonicalChemistry.candidateIds.length
          + (contribution.commercialProductId ? 1 : 0);
      }
    }
    for (const evidence of sourceEvidence(source)) {
      evidenceItemCount += 1;
      if (evidence.confidence !== undefined) confidenceValues.push(evidence.confidence);
    }

    const targets = expectedReviewTargets(source);
    let allComplete = targets.length > 0;
    for (const targetKey of targets) {
      reviewableItemCount += 1;
      const review = latestReviews.get(`${source.id}\u0000${targetKey}`);
      if (review?.decision === "accepted" || review?.decision === "edited" || review?.decision === "rejected") completedItemCount += 1;
      else {
        allComplete = false;
        if (review?.decision === "needs_review") needsReviewItemCount += 1;
      }
    }
    if (allComplete) fullyReviewedFormulaCount += 1;
  }

  const formulaCount = queries.length;
  const supplierDistribution = [...supplierCounts.entries()]
    .map(([supplierId, count]) => ({ supplierId, formulaCount: count, share: formulaCount ? count / formulaCount : 0 }))
    .sort((left, right) => right.formulaCount - left.formulaCount || compareStable(left.supplierId, right.supplierId));
  const reviewableItemDenominator = reviewableItemCount;
  const unreviewedItemCount = reviewableItemCount - completedItemCount - needsReviewItemCount;
  return referenceFormulationCorpusQualityMetricsSchema.parse({
    schemaVersion: REFERENCE_FORMULATION_QUALITY_METRICS_VERSION,
    asOf,
    corpus: {
      targetFormulaCount: REFERENCE_FORMULATION_CORPUS_TARGET_SIZE,
      formulaCount,
      targetReached: formulaCount >= REFERENCE_FORMULATION_CORPUS_TARGET_SIZE,
      progressRate: Math.min(1, formulaCount / REFERENCE_FORMULATION_CORPUS_TARGET_SIZE),
    },
    productFamilyCoverage: ratio(familyCovered, formulaCount),
    supplierDistribution,
    lineResolution: {
      lineCount, resolvedLineCount, unresolvedLineCount, ambiguousLineCount,
      resolvedLineRate: lineCount ? resolvedLineCount / lineCount : null,
      unresolvedLineRate: lineCount ? unresolvedLineCount / lineCount : null,
      resolutionMeaning: "Both commercial-product and canonical-chemistry fields have one review-required candidate; this is not human approval.",
    },
    evidenceCoverage: {
      evidenceBackedLineCount,
      lineCount,
      evidenceBackedLineRate: lineCount ? evidenceBackedLineCount / lineCount : null,
    },
    parserConfidence: {
      mean: average(confidenceValues),
      confidenceTotal: confidenceValues.reduce((total, confidence) => total + confidence, 0),
      confidenceSampleCount: confidenceValues.length,
      evidenceItemCount,
      confidenceCoverageRate: evidenceItemCount ? confidenceValues.length / evidenceItemCount : null,
    },
    revisionAge: {
      datedFormulaCount: revisionAges.length,
      missingRevisionDateCount,
      unparseableRevisionDateCount,
      futureRevisionDateCount,
      totalDays: revisionAges.reduce((total, days) => total + days, 0),
      meanDays: average(revisionAges),
      medianDays: median(revisionAges),
      maxDays: revisionAges.length ? Math.max(...revisionAges) : null,
    },
    reviewCompletion: {
      scope: "Source extraction field review only; normalization candidates, process steps, conditions and targets remain review-required and are counted separately.",
      reviewableItemCount,
      completedItemCount,
      needsReviewItemCount,
      unreviewedItemCount,
      completionRate: reviewableItemDenominator ? completedItemCount / reviewableItemDenominator : null,
      fullyReviewedFormulaCount,
      formulaCount,
      fullyReviewedFormulaRate: formulaCount ? fullyReviewedFormulaCount / formulaCount : null,
    },
    normalizationCandidateCountPendingReview,
    normalizationProcessStepReviewRequiredCount,
    normalizationProcessConditionReviewRequiredCount,
    normalizationTargetReviewRequiredCount,
  });
}
