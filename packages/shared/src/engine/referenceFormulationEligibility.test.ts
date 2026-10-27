import { describe, expect, it } from "vitest";
import {
  buildReferenceFormulationUnresolvedQueue,
  calculateReferenceFormulationContributionDistributions,
  calculateReferenceFormulationProcessPatterns,
  createReferenceFormulationSimilarityFeatures,
  calculateReferenceFormulationTargetDistributions,
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
import { calculateReferenceFormulationDosageDistributions, referenceFormulationDosageDistributionsSchema } from "./referenceFormulationDosageDistributions";
import { calculateReferenceFormulationCooccurrence } from "./referenceFormulationCooccurrence";
import { createReferenceFormulationProcessNormalization } from "../schemas/referenceFormulationProcessNormalization";
import { createReferenceFormulationTargetNormalization } from "../schemas/referenceFormulationTargetNormalization";
import { referenceFormulationIngredientFrequencyPriorsSchema } from "./referenceFormulationIngredientFrequencyPriors";

const HASH = "a".repeat(64);
const AS_OF = "2026-10-26T12:00:00.000Z";

function query(input: {
  sourceRecordId?: string; normalizationId?: string; normalizationVersion?: number; supplierId?: string; chemicalId?: string;
  amountValue?: string; functionId?: string; functionIds?: string[]; ingredientNames?: string[]; chemicalIds?: string[];
  processInstructions?: string[];
  processPhases?: Array<string | undefined>;
  targetValues?: Array<{ label: string; value: string; section?: "target" | "typical" | "unspecified" }>;
  familyStatus?: "unresolved" | "proposed" | "ambiguous"; chemistryStatus?: "unresolved" | "proposed" | "ambiguous";
} = {}): ReferenceFormulationQueryRecord {
  const sourceRecordId = input.sourceRecordId ?? "source-1";
  const supplierId = input.supplierId ?? "supplier-1";
  const normalizationId = input.normalizationId ?? "normalization-1";
  const familyStatus = input.familyStatus ?? "proposed";
  const chemistryStatus = input.chemistryStatus ?? "proposed";
  const source = sourceRecord(sourceRecordId, allowedRights, true, supplierId, input.amountValue ?? "10", input.ingredientNames, input.processInstructions, input.processPhases, input.targetValues);
  const processSteps = createReferenceFormulationProcessNormalization(source).steps;
  const familyCandidate = source.identityCandidates.find((candidate) => candidate.field === "product_family");
  const lines = source.ingredientLines.map((sourceLine, index) => {
    const sourceLineId = sourceLine.id;
    const chemistryId = input.chemicalIds?.[index] ?? input.chemicalId ?? "chemical-1";
    const functionId = input.functionIds?.[index] ?? input.functionId;
    return {
      sourceLineId,
      ...(sourceLine.ingredientName ? { sourceIngredientName: sourceLine.ingredientName.rawValue } : {}),
      ...(sourceLine.inciOrChemicalName ? { inciOrChemicalName: sourceLine.inciOrChemicalName.rawValue } : {}),
      ...(sourceLine.supplierProductCode ? { supplierProductCode: sourceLine.supplierProductCode.rawValue } : {}),
      sourceLineEvidenceRefs: [sourceLine.ingredientName, sourceLine.supplierProductCode, sourceLine.inciOrChemicalName]
        .filter((field) => field !== undefined)
        .map((field) => `formula:${HASH}:${field.evidence.pageNumber}:${field.evidence.blockIndex}:${field.evidence.rowIndex ?? "text"}:${field.evidence.cellIndex ?? "text"}`),
      commercialProducts: { status: "unresolved" as const, candidateIds: [], reviewRequired: true as const },
      canonicalChemistry: {
        status: chemistryStatus,
        candidateIds: chemistryStatus === "unresolved" ? [] : chemistryStatus === "ambiguous" ? [chemistryId, "chemical-2"] : [chemistryId],
        reviewRequired: true as const,
      },
      supplierFunction: { status: "not_stated" as const, evidenceRefs: [] },
      canonicalFunctions: functionId
        ? { status: "proposed" as const, candidateIds: [functionId], reviewRequired: true as const }
        : { status: "unresolved" as const, candidateIds: [], reviewRequired: true as const },
      amount: {
        ...(sourceLine.amount ? { originalValue: sourceLine.amount.rawValue } : {}),
        ...(sourceLine.unit ? { unit: sourceLine.unit.rawValue } : {}),
        ...(sourceLine.basis ? { basis: sourceLine.basis.rawValue } : {}),
        quantitySemantics: sourceLine.quantitySemantics,
        evidenceRefs: [sourceLine.amount, sourceLine.unit, sourceLine.basis].filter((field) => field !== undefined)
          .map((field) => `formula:${HASH}:${field.evidence.pageNumber}:${field.evidence.blockIndex}:${field.evidence.rowIndex ?? "text"}:${field.evidence.cellIndex ?? "text"}`),
      },
      componentContributions: [], reviewRequired: true as const,
    };
  });
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
    lines,
    activeMatterClaims: [], processSteps, targets: createReferenceFormulationTargetNormalization(source).targets, reviewRequired: true,
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
  return [review({ sourceRecordId: record.sourceRecordId, targetType: "identity", targetKey: `identity:product_family:${familyIndex}`, fieldPath: `identityCandidates[${familyIndex}].product_family`, sourceValue: "Hand Dishwash" }),
    ...record.lines.flatMap((line) => {
      const lineId = line.sourceLineId;
      const identityField = line.sourceIngredientName ? "ingredientName" : line.inciOrChemicalName ? "inciOrChemicalName" : "supplierProductCode";
      const identityValue = line.sourceIngredientName ?? line.inciOrChemicalName ?? line.supplierProductCode!;
      const chemistryId = line.canonicalChemistry.candidateIds[0]!;
      return [
        review({ sourceRecordId: record.sourceRecordId, targetType: "ingredient", targetKey: `ingredient:${lineId}:${identityField}`, fieldPath: `ingredientLines[${lineId}].${identityField}`, sourceValue: identityValue }),
        review({
          sourceRecordId: record.sourceRecordId, targetType: "ingredient", targetKey: `normalization:${record.normalizationId}:line:${lineId}:canonicalChemistry:${chemistryId}`,
          fieldPath: `normalizations[${record.normalizationId}].lines[${lineId}].canonicalChemistry`, sourceValue: chemistryId,
        }),
      ];
    })];
}

function acceptedDosageReviews(record: ReferenceFormulationQueryRecord): ReferenceFormulationReview[] {
  const reviews = acceptedReviews(record);
  for (const line of record.lines) {
    const amount = line.amount;
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
  }
  return reviews;
}

function acceptedFunctionReviews(record: ReferenceFormulationQueryRecord): ReferenceFormulationReview[] {
  return [...acceptedReviews(record), ...record.lines.flatMap((line) => line.canonicalFunctions.candidateIds.map((functionId) => review({
    sourceRecordId: record.sourceRecordId, targetType: "ingredient",
    targetKey: `normalization:${record.normalizationId}:line:${line.sourceLineId}:canonicalFunction:${functionId}`,
    fieldPath: `normalizations[${record.normalizationId}].lines[${line.sourceLineId}].canonicalFunction`, sourceValue: functionId,
  })))];
}

function acceptedProcessReviews(record: ReferenceFormulationQueryRecord): ReferenceFormulationReview[] {
  return record.processSteps.flatMap((step) => [review({
    sourceRecordId: record.sourceRecordId, targetType: "procedure", targetKey: `procedure:${step.sourceProcedureStepId}:instruction`,
    fieldPath: `procedureSteps[${step.sourceProcedureStepId}].rawInstruction`, sourceValue: step.originalInstruction,
  }), ...(step.phaseCandidates.candidateValues.some((candidate) => candidate.evidenceRefs.some((ref) => !step.evidenceRefs.includes(ref)))
    ? [review({ sourceRecordId: record.sourceRecordId, targetType: "procedure", targetKey: `procedure:${step.sourceProcedureStepId}:phase`,
      fieldPath: `procedureSteps[${step.sourceProcedureStepId}].phase`, sourceValue: step.phaseCandidates.candidateValues[0]!.rawValue })] : []),
  ...step.conditions.map((condition, index) => review({
    sourceRecordId: record.sourceRecordId, targetType: "procedure", targetKey: `procedure:${step.sourceProcedureStepId}:condition:${index}`,
    fieldPath: `procedureSteps[${step.sourceProcedureStepId}].conditions[${index}]`, sourceValue: condition.rawValue,
  }))]);
}

function acceptedTargetReviews(record: ReferenceFormulationQueryRecord): ReferenceFormulationReview[] {
  return record.targets.map((target) => review({
    sourceRecordId: record.sourceRecordId, targetType: "target", targetKey: `target:${target.sourceTargetId}`,
    fieldPath: `targetCandidates[${target.sourceTargetId}].${target.property}`, sourceValue: target.originalValue,
  }));
}

const allowedRights: ReferenceFormulationRights = {
    status: "owner_provided", redistribution: "unknown", evidenceRefs: ["owner:fixture"],
    usePermissions: { internalResearch: { status: "allowed", evidenceRefs: ["owner:research"] } },
    retentionPolicy: { status: "retain_until_revoked", evidenceRefs: ["owner:retention"] },
};

function sourceRecord(id: string, rights: ReferenceFormulationRights = allowedRights, includeFamily = true, supplierId = "supplier-1", amountValue = "10", ingredientNames = ["Surfactant A"], processInstructions: string[] = [], processPhases?: Array<string | undefined>, targetValues: Array<{ label: string; value: string; section?: "target" | "typical" | "unspecified" }> = []): ReferenceFormulationRecord {
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
    { type: "table" as const, blockIndex: 2, source: "digital" as const, rows: [["Ingredient", "Amount", "Unit", "Basis"], ...ingredientNames.map((name) => [name, amountValue, "%", "w/w"])] },
    ...(processInstructions.length && processPhases
      ? [{ type: "table" as const, blockIndex: 3, source: "digital" as const, rows: [["Step", "Phase", "Procedure"], ...processInstructions.map((text, index) => [`${index + 1}`, processPhases[index] ?? "", text])] }]
      : processInstructions.map((text, index) => ({ type: "text" as const, blockIndex: 3 + index, text: `Procedure: ${text}`, source: "digital" as const }))),
    ...targetValues.flatMap((target, index) => [
      { type: "heading" as const, blockIndex: 20 + index * 2, text: target.section === "typical" ? "Typical Results" : target.section === "unspecified" ? "Product Properties" : "Target Values", source: "digital" as const },
      { type: "text" as const, blockIndex: 21 + index * 2, text: `${target.label}: ${target.value}`, source: "digital" as const },
    ]),
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
    const ingredientNames = record.lines.map((line) => line.sourceIngredientName ?? line.inciOrChemicalName ?? line.supplierProductCode ?? "Unknown source line");
    const processPhases = record.processSteps.map((step) => {
      const candidate = step.phaseCandidates.candidateValues[0];
      return candidate && candidate.evidenceRefs.some((ref) => !step.evidenceRefs.includes(ref)) ? candidate.rawValue : undefined;
    });
    const targetValues = record.targets.map((target) => ({
      label: target.originalLabel, value: target.originalValue,
      section: target.resultSemantics === "typical_result" ? "typical" as const : target.resultSemantics === "unspecified" ? "unspecified" as const : "target" as const,
    }));
    return sourceRecord(id, allowedRights, record.productFamily.status !== "unresolved", record.supplierId, record.lines[0]?.amount.originalValue ?? "", ingredientNames,
      record.processSteps.map((step) => step.originalInstruction), processPhases.some(Boolean) ? processPhases : undefined, targetValues);
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
        { supplierId: "supplier-a", formulaCount: 2, familyShare: 2 / 3, sourceRecordIds: ["formula-a", "formula-b"] },
        { supplierId: "supplier-b", formulaCount: 1, familyShare: 1 / 3, sourceRecordIds: ["formula-c"] },
      ],
      ingredients: [
        { canonicalChemistryId: "chem-a", formulaCount: 2, frequency: 2 / 3, frequencyWeighting: "formula_weighted_corpus", sourceRecordIds: ["formula-a", "formula-b"], supplierNeutral: {
          weighting: "equal_supplier", supplierCount: 2, interpretation: "equal_supplier_mean_of_supplier_formula_prevalence", pooledFrequency: 0.5,
          suppliers: [
            { supplierId: "supplier-a", eligibleFormulaCount: 2, ingredientFormulaCount: 2, frequency: 1, equalSupplierWeight: 0.5, sourceRecordIds: ["formula-a", "formula-b"] },
            { supplierId: "supplier-b", eligibleFormulaCount: 1, ingredientFormulaCount: 0, frequency: 0, equalSupplierWeight: 0.5, sourceRecordIds: [] },
          ],
        } },
        { canonicalChemistryId: "chem-b", formulaCount: 1, frequency: 1 / 3, sourceRecordIds: ["formula-c"] },
      ],
    });
    const mismatchedSupplierEvidence = structuredClone(result);
    mismatchedSupplierEvidence.productFamilies[0]!.ingredients[0]!.supplierNeutral.suppliers[1]!.sourceRecordIds.push("formula-a");
    expect(() => referenceFormulationIngredientFrequencyPriorsSchema.parse(mismatchedSupplierEvidence)).toThrow();
    const duplicatedSupplier = structuredClone(result);
    duplicatedSupplier.productFamilies[0]!.suppliers[1]!.supplierId = "supplier-a";
    expect(() => referenceFormulationIngredientFrequencyPriorsSchema.parse(duplicatedSupplier)).toThrow();
    const omittedPresentSupplier = structuredClone(result);
    omittedPresentSupplier.productFamilies[0]!.ingredients[0]!.suppliers[0]!.supplierId = "supplier-b";
    expect(() => referenceFormulationIngredientFrequencyPriorsSchema.parse(omittedPresentSupplier)).toThrow();
    const supplierOwnershipMismatch = structuredClone(result);
    const chemB = supplierOwnershipMismatch.productFamilies[0]!.ingredients[1]!;
    chemB.sourceRecordIds = ["formula-a"];
    chemB.supplierNeutral.suppliers[1]!.sourceRecordIds = ["formula-a"];
    expect(() => referenceFormulationIngredientFrequencyPriorsSchema.parse(supplierOwnershipMismatch)).toThrow();
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
    expect(result.eligibleSourceRecordIdsByProductFamily).toEqual({ "hand dishwash": queries.map((item) => item.sourceRecordId).sort() });
    expect(() => referenceFormulationDosageDistributionsSchema.parse({
      ...result,
      distributions: result.distributions.map((sample) => ({ ...sample, productFamilyKey: "shampoo" })),
    })).toThrow();
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

  it("reports reviewed material and function co-occurrence as empirical appearance only", () => {
    const first = query({ sourceRecordId: "co-formula-a", supplierId: "supplier-a", ingredientNames: ["Surfactant A", "Preservative B"], chemicalIds: ["chem-a", "chem-b"], functionIds: ["nonionic_surfactant", "preservative"] });
    const second = query({ sourceRecordId: "co-formula-b", supplierId: "supplier-b", ingredientNames: ["Surfactant A", "Preservative B"], chemicalIds: ["chem-a", "chem-b"], functionIds: ["nonionic_surfactant", "preservative"] });
    const third = query({ sourceRecordId: "co-formula-c", supplierId: "supplier-a", chemicalId: "chem-a" });
    const result = calculateReferenceFormulationCooccurrence({
      ...allowed([first, second, third], [...acceptedFunctionReviews(first), ...acceptedFunctionReviews(second), ...acceptedReviews(third)]),
    });

    expect(result).toMatchObject({ eligibleFormulaCount: 3, excludedFormulaCount: 0, interpretation: "empirical_cooccurrence_only", compatibilityEvidence: false });
    expect(result.cooccurrences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pairKind: "material_pair", scope: "same_formula", firstId: "chem-a", secondId: "chem-b",
        formulaCount: 2, eligibleFormulaCount: 3, frequency: 2 / 3,
        suppliers: expect.arrayContaining([
          expect.objectContaining({ supplierId: "supplier-a", formulaCount: 1, share: 0.5, sourceRecordIds: ["co-formula-a"] }),
          expect.objectContaining({ supplierId: "supplier-b", formulaCount: 1, share: 0.5, sourceRecordIds: ["co-formula-b"] }),
        ]), sourceRecordIds: ["co-formula-a", "co-formula-b"], compatibilityEvidence: false,
      }),
      expect.objectContaining({ pairKind: "function_pair", firstId: "nonionic_surfactant", secondId: "preservative", formulaCount: 2, compatibilityEvidence: false }),
      expect.objectContaining({ pairKind: "material_function_pair", firstId: "chem-a", secondId: "nonionic_surfactant", formulaCount: 2, compatibilityEvidence: false }),
    ]));
    expect(calculateReferenceFormulationCooccurrence({
      ...allowed([third, second, first], [...acceptedFunctionReviews(first), ...acceptedFunctionReviews(second), ...acceptedReviews(third)]),
    })).toEqual(result);
  });

  it("groups component pairs by exact SDS product evidence and excludes unknown compositions", () => {
    const record = query({ sourceRecordId: "co-components", ingredientNames: ["Surfactant A", "Surfactant B"] });
    record.lines[0]!.commercialProducts = { status: "ambiguous", candidateIds: ["product-a", "product-b"], reviewRequired: true };
    record.lines[1]!.commercialProducts = { status: "proposed", candidateIds: ["product-b"], reviewRequired: true };
    const contribution = (contributionId: string, productId: string, chemistryId: string, hash: string) => ({
      contributionId, status: "unknown" as const, commercialProductId: productId,
      formulaAmount: { interpretation: "unknown" as const, evidenceRefs: [] },
      sourceSds: {
        status: "available" as const, evidenceId: `evidence:${productId}`, acquisitionCode: `acquisition:${productId}`,
        commercialProductId: productId, documentHash: hash, sectionNumber: 3 as const,
        sourceComponentId: `component:${contributionId}`, disclosure: "disclosed" as const,
        interpretation: "unknown" as const, evidenceRefs: [`sds:${hash}:3`],
      },
      canonicalChemistry: { status: "proposed" as const, candidateIds: [chemistryId], reviewRequired: true as const },
      unknownReasons: ["formula_amount_missing" as const, "sds_concentration_missing" as const], reviewRequired: true as const,
    });
    record.lines[0]!.componentContributions = [
      contribution("component-a", "product-a", "component-chem-a", "b".repeat(64)),
      contribution("component-b", "product-b", "component-chem-b", "c".repeat(64)),
      contribution("component-c", "product-a", "component-chem-c", "b".repeat(64)),
    ];
    record.lines[1]!.componentContributions = [contribution("component-d", "product-b", "component-chem-d", "d".repeat(64))];
    const componentReviews = record.lines.flatMap((line) => line.componentContributions.map((item) => review({
      sourceRecordId: record.sourceRecordId, targetType: "ingredient",
      targetKey: `normalization:${record.normalizationId}:contribution:${item.contributionId}:canonicalChemistry:${item.canonicalChemistry.candidateIds[0]}`,
      fieldPath: `normalizations[${record.normalizationId}].lines[${line.sourceLineId}].componentContributions[${item.contributionId}].canonicalChemistry`,
      sourceValue: item.canonicalChemistry.candidateIds[0]!,
    })));
    const result = calculateReferenceFormulationCooccurrence({ ...allowed([record], [...acceptedReviews(record), ...componentReviews]) });
    expect(result.excludedComponentCandidateCount).toBe(0);
    expect(result.cooccurrences.filter((pair) => pair.pairKind === "composition_component_pair")).toMatchObject([{
      pairKind: "composition_component_pair", scope: "same_sds_product_composition",
      denominatorScope: "eligible_component_formulas_in_family", firstId: "component-chem-a", secondId: "component-chem-c",
      formulaCount: 1, eligibleFormulaCount: 1, frequency: 1, compatibilityEvidence: false,
    }]);
  });

  it("computes active and disclosed component contribution ranges only after exact source review", () => {
    const active = query({ sourceRecordId: "contribution-active", supplierId: "supplier-a" });
    active.activeMatterClaims = [{ originalValue: "10-15% w/w", percentRange: { lowerBound: 10, upperBound: 15 }, evidenceRefs: [`formula:${HASH}:1:1:text:text`], reviewRequired: true }];
    const activeReview = review({
      sourceRecordId: active.sourceRecordId, targetType: "target", targetKey: "active_matter_claim:0:percentRange",
      fieldPath: "activeMatterClaims[0].percentRange", sourceValue: "10-15% w/w",
    });
    const unsupportedActive = query({ sourceRecordId: "contribution-active-unsupported", supplierId: "supplier-a" });
    unsupportedActive.activeMatterClaims = [{ originalValue: "12%", percentRange: { lowerBound: 12, upperBound: 12 }, evidenceRefs: [`formula:${HASH}:1:1:text:text`], reviewRequired: true }];
    const unsupportedActiveReview = review({
      sourceRecordId: unsupportedActive.sourceRecordId, targetType: "target", targetKey: "active_matter_claim:0:percentRange",
      fieldPath: "activeMatterClaims[0].percentRange", sourceValue: "12%",
    });
    const component = query({ sourceRecordId: "contribution-component", supplierId: "supplier-b" });
    component.lines[0]!.commercialProducts = { status: "proposed", candidateIds: ["product-a"], reviewRequired: true };
    component.lines[0]!.componentContributions = [{
      contributionId: "contribution-1", status: "exact", commercialProductId: "product-a",
      canonicalChemistry: { status: "proposed", candidateIds: ["component-chem-a"], reviewRequired: true },
      formulaAmount: {
        originalValue: "10", unit: "%", basis: "w/w", interpretation: "exact", percentRange: { lowerBound: 10, upperBound: 10 },
        evidenceRefs: [...component.lines[0]!.sourceLineEvidenceRefs, ...component.lines[0]!.amount.evidenceRefs],
      },
      componentContributionPercentRange: { lowerBound: 5, upperBound: 5 },
      sourceSds: {
        status: "available", evidenceId: "sds-evidence-1", acquisitionCode: "sds-acquisition-1", commercialProductId: "product-a",
        documentHash: "b".repeat(64), sectionNumber: 3, sourceComponentId: "sds-component-1", disclosure: "disclosed",
        sourceFactId: "sds-fact-1", originalValue: "50% w/w", interpretation: "exact", fractionRange: { lowerBound: 0.5, upperBound: 0.5 },
        evidenceRefs: ["pdf:section3:component-1:fact-1"],
      },
      unknownReasons: [], reviewRequired: true,
    }];
    component.lines[0]!.componentContributions.push({
      contributionId: "contribution-unknown-same-chemistry", status: "unknown", commercialProductId: "product-a",
      canonicalChemistry: { status: "proposed", candidateIds: ["component-chem-a"], reviewRequired: true },
      formulaAmount: { interpretation: "unknown", evidenceRefs: [] },
      sourceSds: { status: "missing", interpretation: "unknown", evidenceRefs: [] },
      unknownReasons: ["formula_amount_missing", "sds_evidence_missing"], reviewRequired: true,
    });
    const componentId = "component-chem-a";
    const componentReview = review({
      sourceRecordId: component.sourceRecordId, targetType: "ingredient",
      targetKey: `normalization:${component.normalizationId}:contribution:contribution-1:canonicalChemistry:${componentId}`,
      fieldPath: `normalizations[${component.normalizationId}].lines[${component.lines[0]!.sourceLineId}].componentContributions[contribution-1].canonicalChemistry`,
      sourceValue: componentId,
    });
    const cleanComponent = query({ sourceRecordId: "contribution-component-clean", supplierId: "supplier-c" });
    cleanComponent.lines[0]!.commercialProducts = { status: "proposed", candidateIds: ["product-a"], reviewRequired: true };
    cleanComponent.lines[0]!.componentContributions = [structuredClone(component.lines[0]!.componentContributions[0]!)];
    cleanComponent.lines[0]!.componentContributions[0]!.contributionId = "contribution-clean";
    const cleanComponentReview = review({
      sourceRecordId: cleanComponent.sourceRecordId, targetType: "ingredient",
      targetKey: `normalization:${cleanComponent.normalizationId}:contribution:contribution-clean:canonicalChemistry:${componentId}`,
      fieldPath: `normalizations[${cleanComponent.normalizationId}].lines[${cleanComponent.lines[0]!.sourceLineId}].componentContributions[contribution-clean].canonicalChemistry`,
      sourceValue: componentId,
    });
    const unknownComponent = query({ sourceRecordId: "contribution-component-unknown", supplierId: "supplier-b" });
    unknownComponent.lines[0]!.commercialProducts = { status: "ambiguous", candidateIds: ["product-unknown", "different-product"], reviewRequired: true };
    unknownComponent.lines[0]!.componentContributions = [{
      contributionId: "contribution-unknown", status: "unknown", commercialProductId: "product-unknown",
      canonicalChemistry: { status: "proposed", candidateIds: ["component-chem-unknown"], reviewRequired: true },
      formulaAmount: { interpretation: "unknown", evidenceRefs: [] },
      sourceSds: { status: "missing", interpretation: "unknown", evidenceRefs: [] },
      unknownReasons: ["formula_amount_missing", "sds_evidence_missing"], reviewRequired: true,
    }];
    const mismatchedProductContribution = structuredClone(component.lines[0]!.componentContributions[0]!);
    mismatchedProductContribution.contributionId = "contribution-product-mismatch";
    mismatchedProductContribution.commercialProductId = "product-unknown";
    mismatchedProductContribution.canonicalChemistry.candidateIds = ["component-chem-mismatch"];
    mismatchedProductContribution.sourceSds.commercialProductId = "different-product";
    unknownComponent.lines[0]!.componentContributions.push(mismatchedProductContribution);
    const mismatchReview = review({
      sourceRecordId: unknownComponent.sourceRecordId, targetType: "ingredient",
      targetKey: `normalization:${unknownComponent.normalizationId}:contribution:contribution-product-mismatch:canonicalChemistry:component-chem-mismatch`,
      fieldPath: `normalizations[${unknownComponent.normalizationId}].lines[${unknownComponent.lines[0]!.sourceLineId}].componentContributions[contribution-product-mismatch].canonicalChemistry`,
      sourceValue: "component-chem-mismatch",
    });
    const reviews = [
      ...acceptedDosageReviews(component), ...acceptedDosageReviews(cleanComponent), ...acceptedDosageReviews(unknownComponent),
      ...acceptedReviews(active), ...acceptedReviews(unsupportedActive), activeReview, unsupportedActiveReview, componentReview, cleanComponentReview, mismatchReview,
    ];
    const result = calculateReferenceFormulationContributionDistributions({ ...allowed([active, unsupportedActive, component, cleanComponent, unknownComponent], reviews) });

    expect(result).toMatchObject({ eligibleFormulaCount: 5, excludedFormulaCount: 0, excludedSampleCount: 4,
      excludedSamplesByReason: { active_claim_percent_not_supported: 1, component_evidence_incomplete: 1, component_not_quantified: 2 } });
    expect(result.eligibleSourceRecordIdsByProductFamily).toEqual({
      "hand dishwash": ["contribution-active", "contribution-active-unsupported", "contribution-component", "contribution-component-clean", "contribution-component-unknown"],
    });
    expect(result.distributions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        quantityKind: "active_matter_claim", formulaCount: 1, minimumLowerBound: 10, maximumUpperBound: 15,
        suppliers: [{ supplierId: "supplier-a", formulaCount: 1, share: 1, sourceRecordIds: ["contribution-active"] }],
        sourceRecordIds: ["contribution-active"], evidenceRefs: [`formula:${HASH}:1:1:text:text`],
      }),
      expect.objectContaining({
        quantityKind: "component_contribution", canonicalChemistryId: componentId, formulaCount: 1,
        minimumLowerBound: 5, maximumUpperBound: 5,
        suppliers: [{ supplierId: "supplier-c", formulaCount: 1, share: 1, sourceRecordIds: ["contribution-component-clean"] }],
        sourceRecordIds: ["contribution-component-clean"],
      }),
    ]));
  });

  it("counts only accepted source-exact process actions, phases and condition values", () => {
    const first = query({ sourceRecordId: "process-a", supplierId: "supplier-a", processInstructions: [
      "Add water and mix in Phase A at 40°C for 10 min.", "Adjust pH to 5.5 and finish.",
    ], processPhases: ["A", undefined] });
    const second = query({ sourceRecordId: "process-b", supplierId: "supplier-b", processInstructions: [
      "Add water and mix in Phase A at 40 °C for 10 min.", "Thicken until homogeneous.",
    ] });
    const third = query({ sourceRecordId: "process-c", supplierId: "supplier-c", processInstructions: [
      "Adjust pH to 5.5.", "Add water and mix in Phase A at 40°C for 10 min.",
    ] });
    const negative = query({ sourceRecordId: "process-negated", supplierId: "supplier-d", processInstructions: ["Avoid adding fragrance or stirring; do not heat."] });
    expect(first.processSteps).toHaveLength(2);
    expect(second.processSteps).toHaveLength(2);
    expect(first.processSteps[0]!.phaseCandidates.candidateValues[0]!.evidenceRefs).toHaveLength(2);
    const result = calculateReferenceFormulationProcessPatterns({
      ...allowed([first, second, third, negative], [
        ...acceptedReviews(first), ...acceptedReviews(second), ...acceptedReviews(third), ...acceptedReviews(negative),
        ...acceptedProcessReviews(first), ...acceptedProcessReviews(second), ...acceptedProcessReviews(third), ...acceptedProcessReviews(negative),
      ]),
    });

    expect(result).toMatchObject({ eligibleFormulaCount: 4, excludedFormulaCount: 0, eligibleProcessFormulaCount: 4, excludedProcessEvidenceCount: 0,
      interpretation: "supplier_reference_process_only" });
    expect(result.patterns.find((pattern) => pattern.patternKind === "action" && pattern.patternId === "mix"))
      .toMatchObject({ formulaCount: 3, eligibleProcessFormulaCount: 4, frequency: 3 / 4, sourceRecordIds: ["process-a", "process-b", "process-c"] });
    expect(result.patterns.find((pattern) => pattern.patternKind === "action" && pattern.patternId === "adjust_ph"))
      .toMatchObject({ formulaCount: 2, frequency: 1 / 2, sourceRecordIds: ["process-a", "process-c"] });
    expect(result.patterns.find((pattern) => pattern.patternKind === "action_sequence" && pattern.patternId === "addition->adjust_ph"))
      .toMatchObject({ formulaCount: 1, sourceRecordIds: ["process-a"] });
    expect(result.patterns.find((pattern) => pattern.patternKind === "action_sequence" && pattern.patternId === "adjust_ph->addition"))
      .toMatchObject({ formulaCount: 1, sourceRecordIds: ["process-c"] });
    expect(result.patterns.find((pattern) => pattern.patternKind === "phase" && pattern.patternId === "a"))
      .toMatchObject({ sourceValue: "A", formulaCount: 3, frequency: 3 / 4 });
    expect(result.patterns.find((pattern) => pattern.patternKind === "condition" && pattern.patternId === "temperature:40°c"))
      .toMatchObject({ sourceValue: "40 °C", sourceValues: ["40 °C", "40°C"], formulaCount: 3, frequency: 3 / 4 });
    expect(result.patterns.some((pattern) => pattern.patternKind === "action" && ["addition", "mix", "heat"].includes(pattern.patternId) && pattern.sourceRecordIds.includes("process-negated"))).toBe(false);
    expect(calculateReferenceFormulationProcessPatterns({
      ...allowed([negative, third, first, second], [
        ...acceptedReviews(first), ...acceptedReviews(second), ...acceptedReviews(third), ...acceptedReviews(negative),
        ...acceptedProcessReviews(first), ...acceptedProcessReviews(second), ...acceptedProcessReviews(third), ...acceptedProcessReviews(negative),
      ]),
    })).toEqual(result);

    const noReviews = calculateReferenceFormulationProcessPatterns({ ...allowed([first], acceptedReviews(first)) });
    expect(noReviews).toMatchObject({ eligibleProcessFormulaCount: 0, excludedProcessEvidenceCount: first.processSteps.length });
    expect(noReviews.patterns).toEqual([]);
  });

  it("computes source-reviewed target distributions with unit and measurement-context separation", () => {
    const first = query({ sourceRecordId: "target-a", supplierId: "supplier-a", targetValues: [
      { label: "pH", value: "5.0–5.5" }, { label: "Viscosity", value: "200 cP at 20°C" },
      { label: "Density", value: "1.00 g/mL at 25°C" }, { label: "Appearance", value: "Clear liquid" },
      { label: "Viscosity", value: "about 210 cP at 20°C" }, { label: "Viscosity", value: "220 cPfoo at 20°C" },
      { label: "Viscosity", value: "230 cP/s at 20°C" },
      { label: "Density", value: "1,000 kg/m³ at 25°C" }, { label: "Density", value: "1.000 kg/m³ at 25°C" },
    ] });
    const second = query({ sourceRecordId: "target-b", supplierId: "supplier-b", targetValues: [
      { label: "pH", value: "5.2" }, { label: "Viscosity", value: "250 mPa·s at 20 °C" },
      { label: "Density", value: "1000 kg/m³ at 25 °C" }, { label: "Appearance", value: "Pale yellow liquid" },
    ] });
    const reviews = [...acceptedReviews(first), ...acceptedReviews(second), ...acceptedTargetReviews(first), ...acceptedTargetReviews(second)];
    const result = calculateReferenceFormulationTargetDistributions({ ...allowed([first, second], reviews) });
    expect(result).toMatchObject({ eligibleFormulaCount: 2, excludedFormulaCount: 0, excludedTargetCount: 5,
      excludedTargetsByReason: { approximate_or_unparsed: 1, unsupported_unit: 4 } });
    expect(result.distributions.find((item) => item.property === "ph" && "canonicalUnit" in item))
      .toMatchObject({ formulaCount: 2, canonicalUnit: "pH", measurementContext: "not stated", minimumLowerBound: 5, maximumUpperBound: 5.5, sourceRecordIds: ["target-a", "target-b"] });
    expect(result.distributions.find((item) => item.property === "viscosity" && "canonicalUnit" in item))
      .toMatchObject({ formulaCount: 2, canonicalUnit: "mPa·s", measurementContext: "at 20°c", minimumLowerBound: 200, maximumUpperBound: 250 });
    expect(result.distributions.find((item) => item.property === "density" && "canonicalUnit" in item))
      .toMatchObject({ formulaCount: 2, canonicalUnit: "g/mL", measurementContext: "at 25°c", minimumLowerBound: 1, maximumUpperBound: 1 });
    expect(result.distributions.find((item) => item.property === "appearance" && "categories" in item))
      .toMatchObject({ formulaCount: 2, categories: [{ value: "clear liquid", formulaCount: 1 }, { value: "pale yellow liquid", formulaCount: 1 }] });
    const withoutTargetReviews = calculateReferenceFormulationTargetDistributions({ ...allowed([first], acceptedReviews(first)) });
    expect(withoutTargetReviews).toMatchObject({ excludedTargetCount: 9, excludedTargetsByReason: { target_not_reviewed: 9 }, distributions: [] });
    const duplicate = query({ sourceRecordId: "target-duplicate", targetValues: [
      { label: "pH", value: "5.0" }, { label: "pH", value: "5.5" },
    ] });
    const duplicateResult = calculateReferenceFormulationTargetDistributions({
      ...allowed([duplicate], [...acceptedReviews(duplicate), ...acceptedTargetReviews(duplicate)]),
    });
    expect(duplicateResult).toMatchObject({ excludedTargetCount: 2, excludedTargetsByReason: { duplicate_property_context: 2 }, distributions: [] });
  });

  it("builds supplier-neutral similarity features from reviewed chemistry, function, dosage, process and targets", () => {
    const record = query({ sourceRecordId: "similarity-a", supplierId: "supplier-private-a", functionId: "nonionic_surfactant",
      processInstructions: ["Add water and mix in Phase A.", "Adjust pH to 5.0 and finish."],
      targetValues: [{ label: "pH", value: "5.0–5.5" }] });
    const line = record.lines[0]!;
    line.commercialProducts = { status: "proposed", candidateIds: ["product-a"], reviewRequired: true };
    line.componentContributions = [{
      contributionId: "similarity-contribution", status: "exact", commercialProductId: "product-a",
      canonicalChemistry: { status: "proposed", candidateIds: ["component-chemistry-a"], reviewRequired: true },
      formulaAmount: { originalValue: "10", unit: "%", basis: "w/w", interpretation: "exact",
        percentRange: { lowerBound: 10, upperBound: 10 }, evidenceRefs: [...line.sourceLineEvidenceRefs, ...line.amount.evidenceRefs] },
      componentContributionPercentRange: { lowerBound: 5, upperBound: 5 },
      sourceSds: { status: "available", evidenceId: "similarity-sds-evidence", acquisitionCode: "similarity-sds-acquisition",
        commercialProductId: "product-a", documentHash: "b".repeat(64), sectionNumber: 3, sourceComponentId: "sds-component-a",
        disclosure: "disclosed", sourceFactId: "sds-fact-a", originalValue: "50% w/w", interpretation: "exact",
        fractionRange: { lowerBound: 0.5, upperBound: 0.5 }, evidenceRefs: ["pdf:section3:similarity-component:fact-a"] },
      unknownReasons: [], reviewRequired: true,
    }];
    const contributionReview = review({ sourceRecordId: record.sourceRecordId, targetType: "ingredient",
      targetKey: `normalization:${record.normalizationId}:contribution:similarity-contribution:canonicalChemistry:component-chemistry-a`,
      fieldPath: `normalizations[${record.normalizationId}].lines[${line.sourceLineId}].componentContributions[similarity-contribution].canonicalChemistry`,
      sourceValue: "component-chemistry-a" });
    const phaseReviews = record.processSteps.flatMap((step) => step.phaseCandidates.candidateValues.map((phase) => review({
      sourceRecordId: record.sourceRecordId, targetType: "procedure", targetKey: `procedure:${step.sourceProcedureStepId}:phase`,
      fieldPath: `procedureSteps[${step.sourceProcedureStepId}].phase`, sourceValue: phase.rawValue,
    })));
    const reviews = [...acceptedDosageReviews(record), ...acceptedProcessReviews(record), ...phaseReviews, ...acceptedTargetReviews(record), contributionReview];
    const result = createReferenceFormulationSimilarityFeatures({ ...allowed([record], reviews) });
    expect(result).toMatchObject({
      eligibleFormulaCount: 1, excludedFormulaCount: 0,
      interpretation: "supplier_neutral_reviewed_reference_features_not_similarity_scores",
      formulas: [{
        sourceRecordId: "similarity-a", productFamilyKey: "hand dishwash",
        categoricalFeatures: expect.arrayContaining([
          expect.objectContaining({ group: "product_family", value: "hand dishwash" }),
          expect.objectContaining({ group: "canonical_chemistry", value: "chemical-1" }),
          expect.objectContaining({ group: "canonical_function", value: "nonionic_surfactant" }),
          expect.objectContaining({ group: "process", value: "addition" }),
          expect.objectContaining({ group: "process", value: "mix" }),
          expect.objectContaining({ group: "process", value: "phase:a" }),
          expect.objectContaining({ group: "process", value: "mix->adjust_ph" }),
          expect.objectContaining({ group: "target", value: expect.stringContaining("ph:target") }),
        ]),
        quantitativeFeatures: expect.arrayContaining([
          expect.objectContaining({ group: "dosage", canonicalChemistryId: "chemical-1", lowerBound: 10, upperBound: 10, unit: "% w/w" }),
          expect.objectContaining({ group: "component_contribution", canonicalChemistryId: "component-chemistry-a", lowerBound: 5, upperBound: 5, unit: "% w/w" }),
        ]),
      }],
    });
    expect(JSON.stringify(result)).not.toContain("supplier-private-a");
    expect(createReferenceFormulationSimilarityFeatures({ ...allowed([record], [...reviews].reverse()) })).toEqual(result);
    const noFieldReviews = createReferenceFormulationSimilarityFeatures({ ...allowed([record], acceptedReviews(record)) });
    expect(noFieldReviews.formulas[0]!.quantitativeFeatures).toEqual([]);
    expect(noFieldReviews.formulas[0]!.categoricalFeatures.some((feature) => feature.group === "process" || feature.group === "target")).toBe(false);
    const noPhaseReviews = createReferenceFormulationSimilarityFeatures({
      ...allowed([record], reviews.filter((item) => !item.targetKey.endsWith(":phase"))),
    });
    expect(noPhaseReviews.formulas[0]!.categoricalFeatures.some((feature) => feature.featureKey.startsWith("process:phase:"))).toBe(false);
  });
});
