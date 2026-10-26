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
import { evaluateReferenceFormulationSourceUse } from "./referenceFormulationSupplierRights";

export const referenceFormulationEligibilityDecisionSchema = z.object({
  sourceRecordId: z.string().trim().min(1),
  queryRecordId: z.string().trim().min(1),
  normalizationId: z.string().trim().min(1),
  eligible: z.boolean(),
  reasons: z.array(z.enum([
    "missing_product_family",
    "source_use_not_permitted",
    "ambiguous_product_family",
    "product_family_not_reviewed",
    "missing_ingredient_lines",
    "missing_line_identity",
    "line_identity_not_reviewed",
    "canonical_chemistry_unresolved",
    "canonical_chemistry_ambiguous",
    "canonical_chemistry_not_reviewed",
  ])),
}).strict().superRefine((decision, context) => {
  if (decision.eligible !== (decision.reasons.length === 0)
    || new Set(decision.reasons).size !== decision.reasons.length) {
    context.addIssue({ code: "custom", path: ["reasons"], message: "Eligibility must agree with a unique, empty-or-nonempty reason list." });
  }
});

export type ReferenceFormulationEligibilityDecision = z.infer<typeof referenceFormulationEligibilityDecisionSchema>;

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function formulaEvidenceRef(hash: string, evidence: { pageNumber: number; blockIndex: number; rowIndex?: number; cellIndex?: number }): string {
  return `formula:${hash}:${evidence.pageNumber}:${evidence.blockIndex}:${evidence.rowIndex ?? "text"}:${evidence.cellIndex ?? "text"}`;
}

function assertQueryMatchesSource(source: ReferenceFormulationRecord, query: ReferenceFormulationQueryRecord): void {
  const sourceSnapshot = source.source;
  const expectedProduct = {
    ...(sourceSnapshot.sourceProduct.tradeName ? { tradeName: sourceSnapshot.sourceProduct.tradeName } : {}),
    ...(sourceSnapshot.sourceProduct.grade ? { grade: sourceSnapshot.sourceProduct.grade } : {}),
    ...(sourceSnapshot.sourceProduct.supplierItemCode ? { supplierItemCode: sourceSnapshot.sourceProduct.supplierItemCode } : {}),
  };
  if (source.id !== query.sourceRecordId || source.sourceDocumentHash !== query.sourceDocumentHash
    || sourceSnapshot.supplierId !== query.supplierId || sourceSnapshot.providerId !== query.providerId
    || sourceSnapshot.surfaceId !== query.surfaceId || sourceSnapshot.title !== query.formulationTitle
    || sourceSnapshot.formulationCode !== query.formulationCode || sourceSnapshot.market !== query.market
    || sourceSnapshot.language !== query.language || JSON.stringify(expectedProduct) !== JSON.stringify(query.supplierProduct)) {
    throw new Error("Eligibility query identity and supplier metadata must match its immutable source snapshot.");
  }

  const sourceFamilies = source.identityCandidates.filter((candidate) => candidate.field === "product_family");
  const expectedFamilies = new Map<string, { rawValue: string; evidenceRefs: string[] }>();
  for (const candidate of sourceFamilies) {
    const key = candidate.rawValue.normalize("NFKC").trim().toLocaleLowerCase("en-US");
    const evidenceRefs = candidate.evidence.map((evidence) => `identity:${evidence.sourceDocumentHash}:${evidence.pageNumber}:${evidence.blockIndex}`);
    const current = expectedFamilies.get(key);
    if (current) current.evidenceRefs = [...new Set([...current.evidenceRefs, ...evidenceRefs])];
    else expectedFamilies.set(key, { rawValue: candidate.rawValue, evidenceRefs });
  }
  const actualFamilies = new Map(query.productFamily.candidates.map((candidate) => [
    candidate.rawValue.normalize("NFKC").trim().toLocaleLowerCase("en-US"), candidate,
  ]));
  if (actualFamilies.size !== expectedFamilies.size || [...expectedFamilies].some(([key, candidate]) => {
    const actual = actualFamilies.get(key);
    return !actual || actual.rawValue !== candidate.rawValue || JSON.stringify(actual.evidenceRefs) !== JSON.stringify(candidate.evidenceRefs);
  })) {
    throw new Error("Eligibility query product-family candidates and citations must match immutable source identity evidence.");
  }

  const sourceLines = new Map(source.ingredientLines.map((line) => [line.id, line]));
  if (sourceLines.size !== source.ingredientLines.length || query.lines.length !== sourceLines.size) {
    throw new Error("Eligibility query lines must contain every immutable source ingredient line exactly once.");
  }
  for (const line of query.lines) {
    const sourceLine = sourceLines.get(line.sourceLineId);
    if (!sourceLine
      || line.sourceIngredientName !== sourceLine.ingredientName?.rawValue
      || line.inciOrChemicalName !== sourceLine.inciOrChemicalName?.rawValue
      || line.supplierProductCode !== sourceLine.supplierProductCode?.rawValue
      || line.amount.originalValue !== sourceLine.amount?.rawValue
      || line.amount.unit !== sourceLine.unit?.rawValue
      || line.amount.basis !== sourceLine.basis?.rawValue
      || line.amount.quantitySemantics !== sourceLine.quantitySemantics) {
      throw new Error("Eligibility query line identity fields must exactly match their immutable source line.");
    }
    const expectedEvidenceRefs = [sourceLine.ingredientName, sourceLine.supplierProductCode, sourceLine.inciOrChemicalName]
      .filter((field) => field !== undefined)
      .map((field) => formulaEvidenceRef(source.sourceDocumentHash, field.evidence));
    if (JSON.stringify(line.sourceLineEvidenceRefs) !== JSON.stringify(expectedEvidenceRefs)) {
      throw new Error("Eligibility query line citations must exactly match immutable source field evidence.");
    }
    const expectedAmountEvidenceRefs = [sourceLine.amount, sourceLine.unit, sourceLine.basis]
      .filter((field) => field !== undefined)
      .map((field) => formulaEvidenceRef(source.sourceDocumentHash, field.evidence));
    if (JSON.stringify(line.amount.evidenceRefs) !== JSON.stringify(expectedAmountEvidenceRefs)) {
      throw new Error("Eligibility query dosage citations must exactly match immutable amount, unit and basis evidence.");
    }
  }
}

function latestReviews(reviewsInput: ReferenceFormulationReview[]): Map<string, ReferenceFormulationReview> {
  const reviews = reviewsInput.map((review) => referenceFormulationReviewSchema.parse(review));
  if (new Set(reviews.map((review) => review.id)).size !== reviews.length) {
    throw new Error("Eligibility input cannot contain duplicate review event IDs.");
  }
  const latest = new Map<string, ReferenceFormulationReview>();
  for (const review of reviews) {
    const key = `${review.referenceFormulationRecordId}\u0000${review.targetKey}`;
    const current = latest.get(key);
    if (!current || Date.parse(review.reviewedAt) > Date.parse(current.reviewedAt)
      || (Date.parse(review.reviewedAt) === Date.parse(current.reviewedAt) && compareStable(review.id, current.id) > 0)) {
      latest.set(key, review);
    }
  }
  return latest;
}

function hasAcceptedReview(input: {
  latest: Map<string, ReferenceFormulationReview>;
  query: ReferenceFormulationQueryRecord;
  targetType: ReferenceFormulationReview["targetType"];
  targetKeys: string[];
  fieldPaths: Record<string, string>;
  sourceValues: string[];
}): boolean {
  return input.targetKeys.some((targetKey) => {
    const review = input.latest.get(`${input.query.sourceRecordId}\u0000${targetKey}`);
    return review?.targetType === input.targetType
      && review.sourceDocumentHash === input.query.sourceDocumentHash
      && review.decision === "accepted"
      && review.fieldPath === input.fieldPaths[targetKey]
      && input.sourceValues.includes(review.sourceValue);
  });
}

function hasAcceptedProductFamilyReview(input: {
  latest: Map<string, ReferenceFormulationReview>;
  query: ReferenceFormulationQueryRecord;
  source: ReferenceFormulationRecord;
  sourceValue: string;
}): boolean {
  return [...input.latest.values()].some((review) => {
    const index = review.targetKey.match(/^identity:product_family:(\d+)$/u)?.[1];
    const candidate = index === undefined ? undefined : input.source.identityCandidates[Number(index)];
    return review.referenceFormulationRecordId === input.query.sourceRecordId
      && index !== undefined
      && candidate?.field === "product_family"
      && candidate.rawValue === input.sourceValue
      && review.fieldPath === `identityCandidates[${index}].product_family`
      && review.targetType === "identity"
      && review.sourceDocumentHash === input.query.sourceDocumentHash
      && review.decision === "accepted"
      && review.sourceValue === input.sourceValue;
  });
}

/**
 * Gate reference-formulation intelligence on human-reviewed identity evidence.
 * Only the latest normalization for each source can qualify. Normalization
 * approvals use the explicit target key
 * `normalization:<normalizationId>:line:<sourceLineId>:canonicalChemistry:<candidateId>`.
 */
export function filterEligibleReferenceFormulationCorpus(input: {
  queryRecords: ReferenceFormulationQueryRecord[];
  reviews: ReferenceFormulationReview[];
  sourceRecords: ReferenceFormulationRecord[];
  asOf: string;
}): {
  eligible: ReferenceFormulationQueryRecord[];
  excluded: ReferenceFormulationEligibilityDecision[];
  decisions: ReferenceFormulationEligibilityDecision[];
} {
  const records = input.queryRecords.map((record) => referenceFormulationQueryRecordSchema.parse(record));
  const sources = input.sourceRecords.map((record) => referenceFormulationRecordSchema.parse(record));
  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error("Eligibility input cannot contain duplicate query record IDs.");
  }
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  if (sourceById.size !== sources.length) throw new Error("Eligibility input cannot contain duplicate immutable source record IDs.");
  const reviews = latestReviews(input.reviews);
  const latestBySource = new Map<string, ReferenceFormulationQueryRecord>();
  for (const record of records) {
    const source = sourceById.get(record.sourceRecordId);
    if (!source || source.sourceDocumentHash !== record.sourceDocumentHash) {
      throw new Error("Every eligibility query must link to its matching immutable source record and document hash.");
    }
    assertQueryMatchesSource(source, record);
    const prior = latestBySource.get(record.sourceRecordId);
    if (prior && prior.sourceDocumentHash !== record.sourceDocumentHash) {
      throw new Error("A source formulation cannot have query snapshots for different document hashes.");
    }
    if (!prior || record.normalizationVersion > prior.normalizationVersion) latestBySource.set(record.sourceRecordId, record);
    else if (record.normalizationVersion === prior.normalizationVersion && record.id !== prior.id) {
      throw new Error("A source formulation cannot have competing query snapshots for one normalization version.");
    }
  }

  const decisions = [...latestBySource.values()].sort((left, right) => compareStable(left.sourceRecordId, right.sourceRecordId)).map((query) => {
    const reasons = new Set<ReferenceFormulationEligibilityDecision["reasons"][number]>();
    const source = sourceById.get(query.sourceRecordId)!;
    if (!evaluateReferenceFormulationSourceUse({ rights: source.source.rights, use: "internalResearch", asOf: input.asOf }).allowed) {
      reasons.add("source_use_not_permitted");
    }
    const families = query.productFamily.candidates;
    const sourceFamilies = source.identityCandidates.filter((candidate) => candidate.field === "product_family");
    if (families.length === 0) reasons.add("missing_product_family");
    else if (families.length !== 1 || query.productFamily.status !== "proposed"
      || sourceFamilies.length === 0
      || !sourceFamilies.some((candidate) => candidate.rawValue === families[0]!.rawValue)) reasons.add("ambiguous_product_family");
    else if (!hasAcceptedProductFamilyReview({ latest: reviews, query, source, sourceValue: families[0]!.rawValue })) {
      reasons.add("product_family_not_reviewed");
    }

    if (query.lines.length === 0) reasons.add("missing_ingredient_lines");
    for (const line of query.lines) {
      const sourceLine = source.ingredientLines.find((candidate) => candidate.id === line.sourceLineId);
      const lineIdentityValues = [line.sourceIngredientName, line.inciOrChemicalName, line.supplierProductCode]
        .filter((value): value is string => value !== undefined);
      if (!sourceLine || lineIdentityValues.length === 0 || line.sourceLineEvidenceRefs.length === 0) reasons.add("missing_line_identity");
      else if (!hasAcceptedReview({
        latest: reviews, query, targetType: "ingredient",
        targetKeys: [
          `ingredient:${line.sourceLineId}:ingredientName`,
          `ingredient:${line.sourceLineId}:inciOrChemicalName`,
          `ingredient:${line.sourceLineId}:supplierProductCode`,
        ],
        fieldPaths: {
          [`ingredient:${line.sourceLineId}:ingredientName`]: `ingredientLines[${line.sourceLineId}].ingredientName`,
          [`ingredient:${line.sourceLineId}:inciOrChemicalName`]: `ingredientLines[${line.sourceLineId}].inciOrChemicalName`,
          [`ingredient:${line.sourceLineId}:supplierProductCode`]: `ingredientLines[${line.sourceLineId}].supplierProductCode`,
        },
        sourceValues: [sourceLine.ingredientName?.rawValue, sourceLine.inciOrChemicalName?.rawValue, sourceLine.supplierProductCode?.rawValue]
          .filter((value): value is string => value !== undefined)
          .filter((value) => lineIdentityValues.includes(value)),
      })) reasons.add("line_identity_not_reviewed");

      if (line.canonicalChemistry.status === "unresolved") reasons.add("canonical_chemistry_unresolved");
      else if (line.canonicalChemistry.status !== "proposed" || line.canonicalChemistry.candidateIds.length !== 1) {
        reasons.add("canonical_chemistry_ambiguous");
      } else {
        const candidateId = line.canonicalChemistry.candidateIds[0]!;
        const targetKey = `normalization:${query.normalizationId}:line:${line.sourceLineId}:canonicalChemistry:${candidateId}`;
        if (!hasAcceptedReview({
          latest: reviews, query, targetType: "ingredient", targetKeys: [targetKey],
          fieldPaths: { [targetKey]: `normalizations[${query.normalizationId}].lines[${line.sourceLineId}].canonicalChemistry` },
          sourceValues: [candidateId],
        })) {
          reasons.add("canonical_chemistry_not_reviewed");
        }
      }
    }

    return referenceFormulationEligibilityDecisionSchema.parse({
      sourceRecordId: query.sourceRecordId, queryRecordId: query.id, normalizationId: query.normalizationId,
      eligible: reasons.size === 0, reasons: [...reasons],
    });
  });
  const eligibleIds = new Set(decisions.filter((decision) => decision.eligible).map((decision) => decision.queryRecordId));
  const latestRecords = [...latestBySource.values()].sort((left, right) => compareStable(left.sourceRecordId, right.sourceRecordId));
  return {
    eligible: latestRecords.filter((record) => eligibleIds.has(record.id)),
    excluded: decisions.filter((decision) => !decision.eligible),
    decisions,
  };
}
