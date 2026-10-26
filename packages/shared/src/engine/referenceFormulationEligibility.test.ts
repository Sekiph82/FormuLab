import { describe, expect, it } from "vitest";
import {
  buildReferenceFormulationUnresolvedQueue,
  createReferenceFormulationRecord,
  createReferenceFormulationSource,
  extractReferenceFormulationIdentity,
  extractReferenceFormulationIngredientLines,
  extractReferenceFormulationProcedure,
  extractReferenceFormulationTargets,
  matchReferenceFormulationProducts,
  supplierDocumentAcquisitionSchema,
  validateReferenceFormulationArithmetic,
} from "..";
import { referenceFormulationQueryRecordSchema, type ReferenceFormulationQueryRecord } from "../schemas/referenceFormulationQuery";
import type { ReferenceFormulationReview } from "../schemas/referenceFormulationReview";
import type { ReferenceFormulationRights } from "../schemas/referenceFormulationSource";
import type { ReferenceFormulationRecord } from "../schemas/referenceFormulationRecord";
import { filterEligibleReferenceFormulationCorpus } from "./referenceFormulationEligibility";
import { calculateReferenceFormulationIngredientFrequencyPriors } from "./referenceFormulationIngredientFrequencyPriors";
import { calculateReferenceFormulationDosageDistributions } from "./referenceFormulationDosageDistributions";

const HASH = "a".repeat(64);
const AS_OF = "2026-10-26T12:00:00.000Z";

function query(input: {
  sourceRecordId?: string; normalizationId?: string; normalizationVersion?: number; supplierId?: string; chemicalId?: string;
  amountValue?: string; functionId?: string;
  familyStatus?: "unresolved" | "proposed" | "ambiguous"; chemistryStatus?: "unresolved" | "proposed" | "ambiguous";
} = {}): ReferenceFormulationQueryRecord {
  const sourceRecordId = input.sourceRecordId ?? "source-1";
  const supplierId = input.supplierId ?? "supplier-1";
  const chemicalId = input.chemicalId ?? "chemical-1";
  const normalizationId = input.normalizationId ?? "normalization-1";
  const familyStatus = input.familyStatus ?? "proposed";
  const chemistryStatus = input.chemistryStatus ?? "proposed";
  const source = sourceRecord(sourceRecordId, allowedRights, true, supplierId, input.amountValue ?? "10");
  const sourceLine = source.ingredientLines[0]!;
  const sourceLineId = sourceLine.id;
  const familyCandidate = source.identityCandidates.find((candidate) => candidate.field === "product_family");
  return referenceFormulationQueryRecordSchema.parse({
    schemaVersion: "formulab-reference-formulation-query-v1", recordKind: "reference_formulation_query",
    id: `query:${sourceRecordId}:${normalizationId}`, sourceRecordId, normalizationId,
    normalizationVersion: input.normalizationVersion ?? 1, sourceDocumentHash: HASH,
    supplierId, providerId: "provider-1", surfaceId: "surface-1",
    supplierProduct: { tradeName: "Supplier Blend" }, formulationTitle: "Hand Dishwash Formula",
    productFamily: {
      status: familyStatus,
      candidates: familyStatus === "unresolved" || !familyCandidate ? [] : [{
        rawValue: familyCandidate.rawValue,
        evidenceRefs: familyCandidate.evidence.map((evidence) => `identity:${evidence.sourceDocumentHash}:${evidence.pageNumber}:${evidence.blockIndex}`),
      }],
      reviewRequired: true,
    },
    market: "EU", language: "en", sourceRevision: { identityCandidates: [] },
    lines: [{
      sourceLineId,
      ...(sourceLine.ingredientName ? { sourceIngredientName: sourceLine.ingredientName.rawValue } : {}),
      ...(sourceLine.inciOrChemicalName ? { inciOrChemicalName: sourceLine.inciOrChemicalName.rawValue } : {}),
      ...(sourceLine.supplierProductCode ? { supplierProductCode: sourceLine.supplierProductCode.rawValue } : {}),
      sourceLineEvidenceRefs: [sourceLine.ingredientName, sourceLine.supplierProductCode, sourceLine.inciOrChemicalName]
        .filter((field) => field !== undefined)
        .map((field) => `formula:${HASH}:${field.evidence.pageNumber}:${field.evidence.blockIndex}:${field.evidence.rowIndex ?? "text"}:${field.evidence.cellIndex ?? "text"}`),
      commercialProducts: { status: "unresolved", candidateIds: [], reviewRequired: true },
      canonicalChemistry: {
        status: chemistryStatus,
        candidateIds: chemistryStatus === "unresolved" ? [] : chemistryStatus === "ambiguous" ? [chemicalId, "chemical-2"] : [chemicalId],
        reviewRequired: true,
      },
      supplierFunction: { status: "not_stated", evidenceRefs: [] },
      canonicalFunctions: input.functionId
        ? { status: "proposed", candidateIds: [input.functionId], reviewRequired: true }
        : { status: "unresolved", candidateIds: [], reviewRequired: true },
      amount: {
        ...(sourceLine.amount ? { originalValue: sourceLine.amount.rawValue } : {}),
        ...(sourceLine.unit ? { unit: sourceLine.unit.rawValue } : {}),
        ...(sourceLine.basis ? { basis: sourceLine.basis.rawValue } : {}),
        quantitySemantics: sourceLine.quantitySemantics,
        evidenceRefs: [sourceLine.amount, sourceLine.unit, sourceLine.basis].filter((field) => field !== undefined)
          .map((field) => `formula:${HASH}:${field.evidence.pageNumber}:${field.evidence.blockIndex}:${field.evidence.rowIndex ?? "text"}:${field.evidence.cellIndex ?? "text"}`),
      },
      componentContributions: [], reviewRequired: true,
    }],
    activeMatterClaims: [], processSteps: [], targets: [], reviewRequired: true,
  });
}

function review(input: {
  sourceRecordId?: string; targetType: ReferenceFormulationReview["targetType"]; targetKey: string;
  fieldPath: string; sourceValue: string; decision?: ReferenceFormulationReview["decision"];
  reviewedAt?: string; id?: string;
}): ReferenceFormulationReview {
  const sourceRecordId = input.sourceRecordId ?? "source-1";
  return {
    schemaVersion: "1.0", id: input.id ?? `review:${sourceRecordId}:${input.targetKey}:${input.reviewedAt ?? AS_OF}`,
    code: input.id ?? `review:${sourceRecordId}:${input.targetKey}:${input.reviewedAt ?? AS_OF}`,
    referenceFormulationRecordId: sourceRecordId, sourceDocumentHash: HASH,
    targetType: input.targetType, targetKey: input.targetKey, fieldPath: input.fieldPath,
    sourceValue: input.sourceValue, evidenceExcerpt: input.sourceValue,
    decision: input.decision ?? "accepted", reviewer: { userId: "human-1", displayName: "Human Reviewer" },
    reviewedAt: input.reviewedAt ?? AS_OF,
  };
}

function acceptedReviews(record = query()): ReferenceFormulationReview[] {
  const source = sourceRecord(record.sourceRecordId);
  const familyIndex = source.identityCandidates.findIndex((candidate) => candidate.field === "product_family");
  const lineId = record.lines[0]!.sourceLineId;
  return [
    review({ sourceRecordId: record.sourceRecordId, targetType: "identity", targetKey: `identity:product_family:${familyIndex}`, fieldPath: `identityCandidates[${familyIndex}].product_family`, sourceValue: "Hand Dishwash" }),
    review({ sourceRecordId: record.sourceRecordId, targetType: "ingredient", targetKey: `ingredient:${lineId}:ingredientName`, fieldPath: `ingredientLines[${lineId}].ingredientName`, sourceValue: "Surfactant A" }),
    review({
      sourceRecordId: record.sourceRecordId,
      targetType: "ingredient", targetKey: `normalization:${record.normalizationId}:line:${lineId}:canonicalChemistry:${record.lines[0]!.canonicalChemistry.candidateIds[0]}`,
      fieldPath: `normalizations[${record.normalizationId}].lines[${lineId}].canonicalChemistry`, sourceValue: record.lines[0]!.canonicalChemistry.candidateIds[0]!,
    }),
  ];
}

function acceptedDosageReviews(record: ReferenceFormulationQueryRecord): ReferenceFormulationReview[] {
  const line = record.lines[0]!;
  const amount = line.amount;
  const reviews = acceptedReviews(record);
  if (amount.originalValue) reviews.push(review({
    sourceRecordId: record.sourceRecordId, targetType: "ingredient", targetKey: `ingredient:${line.sourceLineId}:amount`,
    fieldPath: `ingredientLines[${line.sourceLineId}].amount`, sourceValue: amount.originalValue,
  }));
  if (amount.unit) reviews.push(review({
    sourceRecordId: record.sourceRecordId, targetType: "ingredient", targetKey: `ingredient:${line.sourceLineId}:unit`,
    fieldPath: `ingredientLines[${line.sourceLineId}].unit`, sourceValue: amount.unit,
  }));
  if (amount.basis) reviews.push(review({
    sourceRecordId: record.sourceRecordId, targetType: "ingredient", targetKey: `ingredient:${line.sourceLineId}:basis`,
    fieldPath: `ingredientLines[${line.sourceLineId}].basis`, sourceValue: amount.basis,
  }));
  const functionId = line.canonicalFunctions.candidateIds[0];
  if (functionId) reviews.push(review({
    sourceRecordId: record.sourceRecordId, targetType: "ingredient",
    targetKey: `normalization:${record.normalizationId}:line:${line.sourceLineId}:canonicalFunction:${functionId}`,
    fieldPath: `normalizations[${record.normalizationId}].lines[${line.sourceLineId}].canonicalFunction`, sourceValue: functionId,
  }));
  return reviews;
}

const allowedRights: ReferenceFormulationRights = {
    status: "owner_provided", redistribution: "unknown", evidenceRefs: ["owner:fixture"],
    usePermissions: { internalResearch: { status: "allowed", evidenceRefs: ["owner:research"] } },
    retentionPolicy: { status: "retain_until_revoked", evidenceRefs: ["owner:retention"] },
};

function sourceRecord(id: string, rights: ReferenceFormulationRights = allowedRights, includeFamily = true, supplierId = "supplier-1", amountValue = "10"): ReferenceFormulationRecord {
  const acquisition = supplierDocumentAcquisitionSchema.parse({
    schemaVersion: "1.0", code: `acquisition:${id}`, supplierId, providerId: "provider-1", surfaceId: "surface-1",
    documentType: "FORMULATION", acquisitionMethod: "manual_assisted",
    sourceFileSelection: { selectionId: `selection:${id}`, originalFilename: `${id}.pdf`, sourceFileSha256: HASH, selectedAt: AS_OF, selectedBy: "owner-1" },
    sourceProduct: { tradeName: "Supplier Blend" }, market: "EU", language: "en", originalFilename: `${id}.pdf`, mimeType: "application/pdf",
    sha256: HASH, byteSize: 2048, parserStatus: "completed", acquiredAt: AS_OF, createdAt: AS_OF,
  });
  const source = createReferenceFormulationSource({
    id: `source-snapshot:${id}`, acquisition, title: "Hand Dishwash Formula", parserVersion: "formulab-reference-formulation-layout-v1", rights, createdAt: AS_OF,
  });
  const pages = [{ pageNumber: 1, blocks: [
    ...(includeFamily ? [{ type: "text" as const, blockIndex: 0, text: "Product family: Hand Dishwash", source: "digital" as const }] : []),
    { type: "text" as const, blockIndex: 1, text: "Formulation title: Hand Dishwash Formula", source: "digital" as const },
    { type: "table" as const, blockIndex: 2, source: "digital" as const, rows: [["Ingredient", "Amount", "Unit", "Basis"], ["Surfactant A", amountValue, "%", "w/w"]] },
  ] }];
  const identity = extractReferenceFormulationIdentity({ acquisition, pages });
  const ingredients = extractReferenceFormulationIngredientLines({ source, pages });
  const arithmetic = validateReferenceFormulationArithmetic({ source, lines: ingredients.lines });
  const procedure = extractReferenceFormulationProcedure({ source, pages });
  const targets = extractReferenceFormulationTargets({ source, pages });
  const products: [] = [];
  const matching = matchReferenceFormulationProducts({ source, lines: ingredients.lines, products });
  const unresolved = buildReferenceFormulationUnresolvedQueue({ source, lines: ingredients.lines, matching, products });
  return createReferenceFormulationRecord({
    id, code: id, source, identityCandidates: identity.candidates, identityMetadataComparisons: identity.metadataComparisons,
    identityWarnings: identity.warnings, ingredientLines: ingredients.lines, arithmetic,
    procedureSteps: procedure.steps, procedureWarnings: procedure.warnings, targetCandidates: targets.candidates, targetWarnings: targets.warnings,
    productMatches: matching.lines, productMatchWarnings: matching.warnings, unresolvedEntries: unresolved.entries, createdAt: AS_OF,
  });
}

const allowed = (records: ReferenceFormulationQueryRecord[], reviews: ReferenceFormulationReview[]) => ({
  queryRecords: records, reviews,
  sourceRecords: [...new Set(records.map((record) => record.sourceRecordId))].map((id) => {
    const record = records.find((item) => item.sourceRecordId === id)!;
    return sourceRecord(id, allowedRights, record.productFamily.status !== "unresolved", record.supplierId, record.lines[0]?.amount.originalValue ?? "");
  }),
  asOf: AS_OF,
});

describe("reference formulation corpus eligibility", () => {
  it("admits only the latest normalized snapshot with reviewed family, line identity and chemistry mapping", () => {
    const old = query({ normalizationId: "normalization-old", normalizationVersion: 1 });
    const current = query({ normalizationId: "normalization-current", normalizationVersion: 2 });
    const result = filterEligibleReferenceFormulationCorpus(allowed([old, current], acceptedReviews(current)));
    expect(result.eligible.map((record) => record.id)).toEqual([current.id]);
    expect(result.excluded).toEqual([]);
    expect(result.decisions[0]).toMatchObject({ eligible: true, normalizationId: "normalization-current", reasons: [] });
  });

  it("fails closed for unresolved or ambiguous critical identities and incomplete human review", () => {
    const unresolvedFamily = query({ sourceRecordId: "source-family", familyStatus: "unresolved" });
    const ambiguousChemistry = query({ sourceRecordId: "source-chemistry", chemistryStatus: "ambiguous" });
    const unreviewed = query({ sourceRecordId: "source-unreviewed" });
    const result = filterEligibleReferenceFormulationCorpus(allowed([unresolvedFamily, ambiguousChemistry, unreviewed], acceptedReviews(ambiguousChemistry)));
    expect(result.eligible).toEqual([]);
    expect(result.decisions.find((item) => item.sourceRecordId === "source-family")?.reasons).toContain("missing_product_family");
    expect(result.decisions.find((item) => item.sourceRecordId === "source-chemistry")?.reasons).toContain("canonical_chemistry_ambiguous");
    expect(result.decisions.find((item) => item.sourceRecordId === "source-unreviewed")?.reasons).toEqual(expect.arrayContaining([
      "product_family_not_reviewed", "line_identity_not_reviewed", "canonical_chemistry_not_reviewed",
    ]));
  });

  it("uses the latest field decision, does not reuse approvals across normalization versions, and sorts deterministically", () => {
    const record = query({ sourceRecordId: "source-a", normalizationId: "normalization-v2", normalizationVersion: 2 });
    const reviews = acceptedReviews(record);
    const lineId = record.lines[0]!.sourceLineId;
    reviews.push(review({
      sourceRecordId: record.sourceRecordId,
      targetType: "ingredient", targetKey: `ingredient:${lineId}:ingredientName`, fieldPath: `ingredientLines[${lineId}].ingredientName`,
      sourceValue: "Surfactant A", decision: "rejected", reviewedAt: "2026-10-27T12:00:00.000Z", id: "review-latest-rejection",
    }));
    const second = query({ sourceRecordId: "source-b" });
    const result = filterEligibleReferenceFormulationCorpus(allowed([second, record], [...reviews, ...acceptedReviews(second)]));
    expect(result.eligible.map((item) => item.sourceRecordId)).toEqual(["source-b"]);
    expect(result.excluded[0]?.reasons).toContain("line_identity_not_reviewed");

    const oldApprovalOnly = filterEligibleReferenceFormulationCorpus(allowed(
      [record], acceptedReviews(query({ sourceRecordId: "source-a", normalizationId: "normalization-v1", normalizationVersion: 1 })),
    ));
    expect(oldApprovalOnly.eligible).toEqual([]);
    expect(oldApprovalOnly.excluded[0]?.reasons).toContain("canonical_chemistry_not_reviewed");
  });

  it("rejects accepted decisions whose free-form field path does not match the reviewed target", () => {
    const record = query();
    const lineId = record.lines[0]!.sourceLineId;
    const approvals = acceptedReviews(record).map((item, index) => index === 0
      ? { ...item, fieldPath: "identityCandidates[4].revision_date" }
      : index === 1
        ? { ...item, fieldPath: `ingredientLines[${lineId}].amount` }
        : { ...item, fieldPath: `normalizations[${record.normalizationId}].lines[${lineId}].canonicalFunction` });
    const result = filterEligibleReferenceFormulationCorpus(allowed([record], approvals));
    expect(result.eligible).toEqual([]);
    expect(result.excluded[0]?.reasons).toEqual(expect.arrayContaining([
      "product_family_not_reviewed", "line_identity_not_reviewed", "canonical_chemistry_not_reviewed",
    ]));
  });

  it("fails closed when explicit research-use rights or retention are missing", () => {
    const record = query();
    const rights: ReferenceFormulationRights = {
      status: "owner_provided", redistribution: "unknown", evidenceRefs: ["owner:fixture"],
      usePermissions: { internalResearch: { status: "unknown", evidenceRefs: [] } },
      retentionPolicy: { status: "unknown", evidenceRefs: [] },
    };
    const result = filterEligibleReferenceFormulationCorpus({
      queryRecords: [record], reviews: acceptedReviews(record), sourceRecords: [sourceRecord(record.sourceRecordId, rights)], asOf: AS_OF,
    });
    expect(result.eligible).toEqual([]);
    expect(result.excluded[0]?.reasons).toContain("source_use_not_permitted");
  });

  it("rejects query projections whose supplier or source-line identities were altered", () => {
    const wrongSupplier = query();
    const wrongSupplierSource = sourceRecord(wrongSupplier.sourceRecordId);
    wrongSupplier.supplierId = "different-supplier";
    expect(() => filterEligibleReferenceFormulationCorpus({
      ...allowed([wrongSupplier], acceptedReviews(wrongSupplier)), sourceRecords: [wrongSupplierSource],
    }))
      .toThrow(/supplier metadata must match/u);

    const wrongLine = query({ sourceRecordId: "source-line-mismatch" });
    const wrongLineSource = sourceRecord(wrongLine.sourceRecordId);
    wrongLine.lines[0]!.sourceIngredientName = "Different ingredient";
    expect(() => filterEligibleReferenceFormulationCorpus({
      ...allowed([wrongLine], acceptedReviews(wrongLine)), sourceRecords: [wrongLineSource],
    }))
      .toThrow(/line identity fields must exactly match/u);
  });

  it("computes formula-presence frequency and supplier mix only from eligible latest snapshots", () => {
    const oldA = query({ sourceRecordId: "formula-a", normalizationId: "normalization-a1", normalizationVersion: 1, supplierId: "supplier-a", chemicalId: "chem-a" });
    const currentA = query({ sourceRecordId: "formula-a", normalizationId: "normalization-a2", normalizationVersion: 2, supplierId: "supplier-a", chemicalId: "chem-a" });
    const formulaB = query({ sourceRecordId: "formula-b", supplierId: "supplier-a", chemicalId: "chem-a" });
    const formulaC = query({ sourceRecordId: "formula-c", supplierId: "supplier-b", chemicalId: "chem-b" });
    const unresolved = query({ sourceRecordId: "formula-d", supplierId: "supplier-b", chemistryStatus: "unresolved" });
    const reviews = [...acceptedReviews(currentA), ...acceptedReviews(formulaB), ...acceptedReviews(formulaC)];
    const result = calculateReferenceFormulationIngredientFrequencyPriors({
      ...allowed([oldA, currentA, formulaB, formulaC, unresolved], reviews),
    });

    expect(result.eligibleFormulaCount).toBe(3);
    expect(result.excludedFormulaCount).toBe(1);
    expect(result.eligibilityDecisions).toHaveLength(4);
    expect(result.productFamilies).toHaveLength(1);
    expect(result.productFamilies[0]).toMatchObject({
      productFamilyKey: "hand dishwash", eligibleFormulaCount: 3, supplierCount: 2,
      suppliers: [
        { supplierId: "supplier-a", formulaCount: 2, familyShare: 2 / 3 },
        { supplierId: "supplier-b", formulaCount: 1, familyShare: 1 / 3 },
      ],
      ingredients: [
        { canonicalChemistryId: "chem-a", formulaCount: 2, frequency: 2 / 3, sourceRecordIds: ["formula-a", "formula-b"] },
        { canonicalChemistryId: "chem-b", formulaCount: 1, frequency: 1 / 3, sourceRecordIds: ["formula-c"] },
      ],
    });
    expect(calculateReferenceFormulationIngredientFrequencyPriors({
      ...allowed([unresolved, formulaC, formulaB, currentA, oldA], reviews),
    })).toEqual(result);
  });

  it("reports reviewed percent-by-weight dosage ranges, quantiles, supplier samples and explicit exclusions", () => {
    const low = query({ sourceRecordId: "dosage-low", supplierId: "supplier-a", amountValue: "2", functionId: "nonionic_surfactant" });
    const range = query({ sourceRecordId: "dosage-range", supplierId: "supplier-a", amountValue: "4-8", functionId: "nonionic_surfactant" });
    const high = query({ sourceRecordId: "dosage-high", supplierId: "supplier-b", amountValue: "10", functionId: "nonionic_surfactant" });
    const unassignedFunction = query({ sourceRecordId: "dosage-function-unknown", supplierId: "supplier-b", amountValue: "12" });
    const unreviewedAmount = query({ sourceRecordId: "dosage-unreviewed", supplierId: "supplier-a", amountValue: "15" });
    const qs = query({ sourceRecordId: "dosage-qs", supplierId: "supplier-b", amountValue: "q.s." });
    const queries = [low, range, high, unassignedFunction, unreviewedAmount, qs];
    const reviews = [
      ...acceptedDosageReviews(low), ...acceptedDosageReviews(range), ...acceptedDosageReviews(high),
      ...acceptedDosageReviews(unassignedFunction), ...acceptedReviews(unreviewedAmount), ...acceptedDosageReviews(qs),
    ];
    const result = calculateReferenceFormulationDosageDistributions(allowed(queries, reviews));
    const reviewedFunction = result.distributions.find((sample) => sample.canonicalFunctionId === "nonionic_surfactant");
    expect(result.eligibleFormulaCount).toBe(6);
    expect(result.excludedFormulaCount).toBe(0);
    expect(result.excludedDosageSampleCount).toBe(2);
    expect(result.excludedDosageSamplesByReason).toMatchObject({
      amount_not_reviewed: 1,
      amount_not_explicit_percent_w_w: 1,
    });
    expect(reviewedFunction).toMatchObject({
      productFamilyKey: "hand dishwash", canonicalChemistryId: "chemical-1", functionAssignment: "reviewed",
      formulaCount: 3, supplierCount: 2, minimumLowerBound: 2, maximumUpperBound: 10,
      lowerBoundQuantiles: { p25: 2, p50: 4, p75: 10 },
      upperBoundQuantiles: { p25: 2, p50: 8, p75: 10 },
      suppliers: [
        { supplierId: "supplier-a", formulaCount: 2, share: 2 / 3 },
        { supplierId: "supplier-b", formulaCount: 1, share: 1 / 3 },
      ],
      sourceRecordIds: ["dosage-high", "dosage-low", "dosage-range"],
    });
    expect(result.distributions.find((sample) => sample.functionAssignment === "unassigned_or_unreviewed"))
      .toMatchObject({ formulaCount: 1, functionAssignment: "unassigned_or_unreviewed", sourceRecordIds: ["dosage-function-unknown"] });
  });
});
