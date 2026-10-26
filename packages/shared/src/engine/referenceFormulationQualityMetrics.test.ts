import { describe, expect, it } from "vitest";
import {
  createReferenceFormulationRecord,
  createReferenceFormulationSource,
  extractReferenceFormulationIdentity,
  extractReferenceFormulationIngredientLines,
  extractReferenceFormulationProcedure,
  extractReferenceFormulationTargets,
  matchReferenceFormulationProducts,
  referenceFormulationQueryRecordSchema,
  supplierDocumentAcquisitionSchema,
  validateReferenceFormulationArithmetic,
  buildReferenceFormulationUnresolvedQueue,
  type ReferenceFormulationQueryRecord,
} from "..";
import {
  calculateReferenceFormulationCorpusQualityMetrics,
  referenceFormulationCorpusQualityMetricsSchema,
} from "./referenceFormulationQualityMetrics";

const HASH = "a".repeat(64);
const AS_OF = "2026-10-26T08:00:00.000Z";

function sourceRecord() {
  const acquisition = supplierDocumentAcquisitionSchema.parse({
    schemaVersion: "1.0", code: "supplierdoc-quality-1", supplierId: "supplier-croda", providerId: "croda-public", surfaceId: "formulation-library",
    documentType: "FORMULATION", acquisitionMethod: "manual_assisted",
    sourceFileSelection: { selectionId: "selection-quality", originalFilename: "formula.pdf", sourceFileSha256: HASH, selectedAt: AS_OF, selectedBy: "owner-1" },
    sourceProduct: { tradeName: "Example formula" }, market: "EU", language: "en", originalFilename: "formula.pdf", mimeType: "application/pdf",
    sha256: HASH, byteSize: 2048, parserStatus: "completed", revisionDate: "2025-10-26", acquiredAt: AS_OF, createdAt: AS_OF,
  });
  const source = createReferenceFormulationSource({
    id: "source-quality-1", acquisition, title: "Example Hand Dishwash Formula", parserVersion: "formulab-reference-formulation-layout-v1",
    rights: { status: "unknown", redistribution: "unknown", evidenceRefs: [] }, createdAt: AS_OF,
  });
  const pages = [{ pageNumber: 1, blocks: [
    { type: "heading" as const, blockIndex: 0, text: "Formula Composition", source: "digital" as const },
    { type: "table" as const, blockIndex: 1, source: "digital" as const, rows: [["Ingredient", "Amount", "Unit", "Basis", "Function"], ["Known Product", "4.0", "%", "w/w", "Surfactant"]] },
    { type: "heading" as const, blockIndex: 2, text: "Procedure", source: "digital" as const },
    { type: "text" as const, blockIndex: 3, text: "Add and mix until clear.", source: "digital" as const },
    { type: "heading" as const, blockIndex: 4, text: "Target Values", source: "digital" as const },
    { type: "text" as const, blockIndex: 5, text: "pH: 5.0–5.5", source: "digital" as const },
  ] }];
  const identity = extractReferenceFormulationIdentity({ acquisition, pages });
  const ingredient = extractReferenceFormulationIngredientLines({ source, pages });
  ingredient.lines[0]!.ingredientName!.evidence.confidence = 0.9;
  ingredient.lines[0]!.amount!.evidence.confidence = 0.7;
  const arithmetic = validateReferenceFormulationArithmetic({ source, lines: ingredient.lines });
  const procedure = extractReferenceFormulationProcedure({ source, pages });
  const targets = extractReferenceFormulationTargets({ source, pages });
  const products: [] = [];
  const matches = matchReferenceFormulationProducts({ source, lines: ingredient.lines, products });
  const unresolved = buildReferenceFormulationUnresolvedQueue({ source, lines: ingredient.lines, matching: matches, products });
  return createReferenceFormulationRecord({
    id: "source-quality-1", code: "source-quality-1", source,
    identityCandidates: identity.candidates, identityMetadataComparisons: identity.metadataComparisons, identityWarnings: identity.warnings,
    ingredientLines: ingredient.lines, arithmetic, procedureSteps: procedure.steps, procedureWarnings: procedure.warnings,
    targetCandidates: targets.candidates, targetWarnings: targets.warnings,
    productMatches: matches.lines, productMatchWarnings: matches.warnings, unresolvedEntries: unresolved.entries, createdAt: AS_OF,
  });
}

function queryRecord(input: {
  id: string;
  sourceRecordId: string;
  supplierId?: string;
  familyStatus?: "unresolved" | "proposed" | "ambiguous";
  productStatus?: "unresolved" | "proposed" | "ambiguous";
  chemistryStatus?: "unresolved" | "proposed" | "ambiguous";
  normalizationVersion?: number;
}): ReferenceFormulationQueryRecord {
  const familyStatus = input.familyStatus ?? "proposed";
  const productStatus = input.productStatus ?? "proposed";
  const chemistryStatus = input.chemistryStatus ?? "proposed";
  return referenceFormulationQueryRecordSchema.parse({
    schemaVersion: "formulab-reference-formulation-query-v1", recordKind: "reference_formulation_query", id: input.id,
    sourceRecordId: input.sourceRecordId, normalizationId: `normalization-${input.id}`, normalizationVersion: input.normalizationVersion ?? 1,
    sourceDocumentHash: HASH, supplierId: input.supplierId ?? "supplier-croda", providerId: "croda-public", surfaceId: "formulation-library",
    supplierProduct: { tradeName: "Example formula" }, formulationTitle: "Example Hand Dishwash Formula",
    productFamily: { status: familyStatus, candidates: familyStatus === "unresolved" ? [] : [{ rawValue: "Hand Dishwash", evidenceRefs: ["identity:family"] }], reviewRequired: true },
    market: "EU", language: "en", sourceRevision: { revisionIdentifier: "Rev 1", identityCandidates: [] },
    lines: [{
      sourceLineId: `line-${input.sourceRecordId}`, sourceIngredientName: "Known Product", sourceLineEvidenceRefs: ["formula:line"],
      commercialProducts: { status: productStatus, candidateIds: productStatus === "unresolved" ? [] : productStatus === "ambiguous" ? ["commercial-product-1", "commercial-product-2"] : ["commercial-product-1"], reviewRequired: true },
      canonicalChemistry: { status: chemistryStatus, candidateIds: chemistryStatus === "unresolved" ? [] : chemistryStatus === "ambiguous" ? ["chemical-1", "chemical-2"] : ["chemical-1"], reviewRequired: true },
      supplierFunction: { status: "not_stated", evidenceRefs: [] },
      canonicalFunctions: { status: "unresolved", candidateIds: [], reviewRequired: true },
      amount: { originalValue: "4.0", unit: "%", basis: "w/w", quantitySemantics: "explicit_amount", evidenceRefs: ["formula:amount"] },
      componentContributions: [], reviewRequired: true,
    }],
    activeMatterClaims: [], processSteps: [], targets: [], reviewRequired: true,
  });
}

function review(source: ReturnType<typeof sourceRecord>, decision: "accepted" | "needs_review", reviewedAt: string) {
  const line = source.ingredientLines[0]!;
  return {
    schemaVersion: "1.0" as const, id: `review-${decision}`, code: `review-${decision}`,
    referenceFormulationRecordId: source.id, sourceDocumentHash: source.sourceDocumentHash,
    targetType: "ingredient" as const, targetKey: `ingredient:${line.id}:ingredientName`,
    fieldPath: `ingredientLines[${line.id}].ingredientName`, sourceValue: line.ingredientName!.rawValue,
    evidenceExcerpt: line.rawRow.join(" | "), decision, reviewer: { userId: "reviewer-1", displayName: "Reviewer" }, reviewedAt,
  };
}

describe("reference formulation corpus quality metrics", () => {
  it("reports family/supplier coverage, candidate resolution, evidence, confidence, age and latest review completion", () => {
    const source = sourceRecord();
    const current = queryRecord({ id: "query-current", sourceRecordId: source.id, normalizationVersion: 2 });
    current.processSteps.push({
      sourceProcedureStepId: "procedure-step-1", sequenceOrder: 1, originalInstruction: "Add and mix.",
      actionCandidates: ["addition"], phaseCandidates: { status: "unresolved", candidateValues: [] },
      conditions: [{ kind: "time", rawValue: "5 min", evidenceRefs: ["formula:time"], reviewRequired: true }],
      evidenceRefs: ["formula:procedure"], reviewRequired: true,
    });
    current.targets.push({
      sourceTargetId: "target-1", property: "ph", originalLabel: "pH", originalValue: "5.0–5.5",
      valueShape: "range", resultSemantics: "target", sourceContext: "pH: 5.0–5.5",
      evidenceRefs: ["formula:target"], reviewRequired: true,
    });
    const prior = queryRecord({ id: "query-prior", sourceRecordId: source.id, normalizationVersion: 1, productStatus: "unresolved" });
    const latest = { ...current, id: "query-latest", normalizationId: "normalization-latest", normalizationVersion: 3 };
    const report = calculateReferenceFormulationCorpusQualityMetrics({
      queryRecords: [prior, current, latest], sourceRecords: [source],
      reviews: [review(source, "accepted", "2026-10-25T08:00:00.000Z"), review(source, "needs_review", "2026-10-26T07:00:00.000Z")],
      asOf: AS_OF,
    });

    expect(report).toMatchObject({
      corpus: { formulaCount: 1, targetFormulaCount: 2000, targetReached: false },
      productFamilyCoverage: { numerator: 1, denominator: 1, rate: 1 },
      supplierDistribution: [{ supplierId: "supplier-croda", formulaCount: 1, share: 1 }],
      lineResolution: { lineCount: 1, resolvedLineCount: 1, resolvedLineRate: 1 },
      evidenceCoverage: { evidenceBackedLineCount: 1, evidenceBackedLineRate: 1 },
      parserConfidence: { confidenceSampleCount: 2, evidenceItemCount: expect.any(Number), mean: 0.8 },
      revisionAge: { datedFormulaCount: 1, meanDays: 365.3333333333333, medianDays: 365.3333333333333, maxDays: 365.3333333333333 },
      reviewCompletion: { completedItemCount: 0, needsReviewItemCount: 1, fullyReviewedFormulaCount: 0 },
      normalizationCandidateCountPendingReview: 3,
      normalizationProcessStepReviewRequiredCount: 1,
      normalizationProcessConditionReviewRequiredCount: 1,
      normalizationTargetReviewRequiredCount: 1,
    });
    expect(report.reviewCompletion.scope).toMatch(/Source extraction field review only/u);
    expect(() => referenceFormulationCorpusQualityMetricsSchema.parse({
      ...report, productFamilyCoverage: { ...report.productFamilyCoverage, rate: 0.5 },
    })).toThrow(/Quality rate must agree/);
    expect(() => referenceFormulationCorpusQualityMetricsSchema.parse({
      ...report, lineResolution: { ...report.lineResolution, resolvedLineRate: 0.5 },
    })).toThrow(/rates and nullable averages must match their sample counts/);
    expect(() => referenceFormulationCorpusQualityMetricsSchema.parse({
      ...report, parserConfidence: { ...report.parserConfidence, confidenceTotal: 0.1 },
    })).toThrow(/rates and nullable averages/);
    expect(() => referenceFormulationCorpusQualityMetricsSchema.parse({
      ...report, reviewCompletion: { ...report.reviewCompletion, completionRate: 1 },
    })).toThrow(/rates and nullable averages/);

    const amountOnly = structuredClone(current);
    amountOnly.lines[0]!.sourceLineEvidenceRefs = [];
    const amountOnlyReport = calculateReferenceFormulationCorpusQualityMetrics({
      queryRecords: [amountOnly], sourceRecords: [source], reviews: [], asOf: AS_OF,
    });
    expect(amountOnlyReport.evidenceCoverage).toMatchObject({ lineCount: 1, evidenceBackedLineCount: 1, evidenceBackedLineRate: 1 });
  });

  it("separates ambiguous and unresolved lines and returns null rates for empty denominators", () => {
    const source = sourceRecord();
    const mixed = queryRecord({ id: "query-mixed", sourceRecordId: source.id, productStatus: "ambiguous" });
    mixed.lines.push({
      ...mixed.lines[0]!,
      sourceLineId: "line-unresolved",
      canonicalChemistry: { status: "unresolved", candidateIds: [], reviewRequired: true },
    });
    const report = calculateReferenceFormulationCorpusQualityMetrics({
      queryRecords: [mixed],
      sourceRecords: [source], reviews: [], asOf: AS_OF,
    });
    expect(report.lineResolution).toMatchObject({ lineCount: 2, ambiguousLineCount: 1, resolvedLineCount: 0, unresolvedLineCount: 1 });
    expect(calculateReferenceFormulationCorpusQualityMetrics({ queryRecords: [], sourceRecords: [], reviews: [], asOf: AS_OF }))
      .toMatchObject({ productFamilyCoverage: { rate: null }, lineResolution: { resolvedLineRate: null }, evidenceCoverage: { evidenceBackedLineRate: null }, parserConfidence: { mean: null, confidenceCoverageRate: null }, revisionAge: { meanDays: null }, reviewCompletion: { completionRate: null, fullyReviewedFormulaRate: null } });
  });

  it("rejects dangling source identities and duplicate source-normalization versions", () => {
    const source = sourceRecord();
    const query = queryRecord({ id: "query-1", sourceRecordId: source.id });
    expect(() => calculateReferenceFormulationCorpusQualityMetrics({ queryRecords: [query], sourceRecords: [], reviews: [], asOf: AS_OF }))
      .toThrow(/matching immutable source record/);
    const duplicateVersion = { ...query, id: "query-duplicate", normalizationId: "normalization-duplicate" };
    expect(() => calculateReferenceFormulationCorpusQualityMetrics({ queryRecords: [query, duplicateVersion], sourceRecords: [source], reviews: [], asOf: AS_OF }))
      .toThrow(/competing query snapshots/);
  });

  it("does not guess ambiguous numeric revision-date formats", () => {
    const source = sourceRecord();
    source.source.revisionDate = "01/02/2025";
    const report = calculateReferenceFormulationCorpusQualityMetrics({
      queryRecords: [queryRecord({ id: "query-date", sourceRecordId: source.id })], sourceRecords: [source], reviews: [], asOf: AS_OF,
    });
    expect(report.revisionAge).toMatchObject({ datedFormulaCount: 0, unparseableRevisionDateCount: 1, missingRevisionDateCount: 0, meanDays: null });
  });
});
