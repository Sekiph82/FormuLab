import { z } from "zod";
import {
  referenceFormulationQueryRecordSchema,
  type ReferenceFormulationQueryRecord,
} from "../schemas/referenceFormulationQuery";
import {
  referenceFormulationRecordSchema,
  type ReferenceFormulationRecord,
} from "../schemas/referenceFormulationRecord";
import { createReferenceFormulationProcessNormalization } from "../schemas/referenceFormulationProcessNormalization";

export const REFERENCE_FORMULATION_REALISM_EVALUATION_VERSION = "formulab-reference-formulation-realism-evaluation-v1";

const evidenceLineSchema = z.object({
  sourceLineId: z.string().trim().min(1),
  ingredientLabel: z.string().trim().min(1).optional(),
  amount: z.object({
    originalValue: z.string().trim().min(1).optional(),
    unit: z.string().trim().min(1).optional(),
    basis: z.string().trim().min(1).optional(),
    evidenceRefs: z.array(z.string().trim().min(1)),
  }).strict(),
  canonicalChemistry: z.object({
    status: z.enum(["unresolved", "proposed", "ambiguous"]),
    candidateIds: z.array(z.string().trim().min(1)),
    reviewRequired: z.literal(true),
  }).strict(),
  sourceEvidenceRefs: z.array(z.string().trim().min(1)),
  reviewRequired: z.literal(true),
}).strict();

const processStepSchema = z.object({
  sequenceOrder: z.number().int().positive(),
  originalInstruction: z.string().trim().min(1),
  actionCandidates: z.array(z.string().trim().min(1)),
  conditions: z.array(z.object({
    kind: z.enum(["temperature", "time", "speed", "ph", "appearance", "homogeneity"]),
    originalValue: z.string().trim().min(1),
    evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  }).strict()),
  evidenceRefs: z.array(z.string().trim().min(1)),
  reviewRequired: z.literal(true),
}).strict();

const reviewFlagSchema = z.enum([
  "no_ingredient_lines",
  "line_identity_evidence_missing",
  "dosage_evidence_missing",
  "arithmetic_not_source_confirmed",
  "no_process_steps",
  "process_evidence_missing",
]);

const evaluationFormulaSchema = z.object({
  sourceRecordId: z.string().trim().min(1),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  supplierId: z.string().trim().min(1),
  formulationTitle: z.string().trim().min(1),
  productFamily: z.object({
    value: z.string().trim().min(1),
    evidenceRefs: z.array(z.string().trim().min(1)).min(1),
    reviewRequired: z.literal(true),
  }).strict(),
  ingredientLines: z.array(evidenceLineSchema),
  dosageStructure: z.object({
    arithmeticStatus: z.enum(["calculated_only", "incomplete", "source_total_not_comparable", "consistent", "overlap", "inconsistent", "no_ingredient_rows"]),
    sourceDeclaredTotal: z.object({
      originalValue: z.string().trim().min(1),
      unit: z.string().trim().min(1).optional(),
      basis: z.string().trim().min(1).optional(),
      evidenceRefs: z.array(z.string().trim().min(1)).min(1),
    }).strict().optional(),
    calculatedTotal: z.object({
      kind: z.enum(["exact", "range"]),
      lowerBound: z.string().regex(/^\d+(?:\.\d+)?$/u),
      upperBound: z.string().regex(/^\d+(?:\.\d+)?$/u),
      unit: z.literal("% w/w"),
    }).strict().optional(),
    warnings: z.array(z.string()),
    interpretation: z.literal("Source arithmetic and cited dosage evidence only; no dose recommendation or efficacy inference."),
  }).strict(),
  processEvidence: z.object({
    sourceStatus: z.enum(["available", "no_steps_extracted"]),
    steps: z.array(processStepSchema),
    warnings: z.array(z.string()),
  }).strict(),
  reviewReadiness: z.enum(["review_ready", "review_ready_with_gaps"]),
  reviewFlags: z.array(reviewFlagSchema),
  sourceReviewStatus: z.literal("unreviewed"),
  humanReviewPerformed: z.literal(false),
  labPerformanceEvaluated: z.literal(false),
}).strict().superRefine((formula, context) => {
  if ((formula.reviewReadiness === "review_ready") !== (formula.reviewFlags.length === 0)) {
    context.addIssue({ code: "custom", path: ["reviewFlags"], message: "Review readiness must reflect all explicitly listed source-evidence gaps." });
  }
  if ((formula.processEvidence.sourceStatus === "no_steps_extracted") !== (formula.processEvidence.steps.length === 0)) {
    context.addIssue({ code: "custom", path: ["processEvidence"], message: "Process evidence status must match the extracted step list." });
  }
});

export const referenceFormulationRealismEvaluationSchema = z.object({
  schemaVersion: z.literal(REFERENCE_FORMULATION_REALISM_EVALUATION_VERSION),
  evaluationId: z.literal("synthetic-reference-formulation-realism-v1"),
  datasetKind: z.literal("synthetic_structural_fixtures"),
  heldOutFormulaCount: z.number().int().min(3),
  supplierCount: z.number().int().min(3),
  productFamilyCount: z.number().int().min(3),
  formulasReadyForChemistReview: z.number().int().nonnegative(),
  formulasWithEvidenceGaps: z.number().int().nonnegative(),
  formulas: z.array(evaluationFormulaSchema).min(3),
  humanReviewPerformed: z.literal(false),
  labPerformanceEvaluated: z.literal(false),
  disclaimer: z.literal("Synthetic structural evaluation only. Supplier IDs, formulas and citations are test fixtures; no real supplier product, human review, chemical plausibility, or laboratory performance is asserted."),
}).strict().superRefine((evaluation, context) => {
  if (evaluation.heldOutFormulaCount !== evaluation.formulas.length
    || evaluation.supplierCount !== new Set(evaluation.formulas.map((formula) => formula.supplierId)).size
    || evaluation.productFamilyCount !== new Set(evaluation.formulas.map((formula) => formula.productFamily.value)).size
    || evaluation.formulasReadyForChemistReview !== evaluation.formulas.filter((formula) => formula.reviewReadiness === "review_ready").length
    || evaluation.formulasWithEvidenceGaps !== evaluation.formulas.filter((formula) => formula.reviewReadiness === "review_ready_with_gaps").length) {
    context.addIssue({ code: "custom", path: ["heldOutFormulaCount"], message: "Synthetic evaluation counts must match the held-out formula report rows." });
  }
});

export type ReferenceFormulationRealismEvaluation = z.infer<typeof referenceFormulationRealismEvaluationSchema>;

function formulaEvidenceRef(hash: string, evidence: {
  pageNumber: number;
  blockIndex: number;
  rowIndex?: number;
  cellIndex?: number;
}): string {
  return `formula:${hash}:${evidence.pageNumber}:${evidence.blockIndex}:${evidence.rowIndex ?? "text"}:${evidence.cellIndex ?? "text"}`;
}

/** Summarize held-out synthetic records for human review without asserting chemistry or performance. */
export function buildSyntheticReferenceFormulationRealismEvaluation(input: {
  heldOutSourceRecords: ReferenceFormulationRecord[];
  heldOutQueryRecords: ReferenceFormulationQueryRecord[];
  trainingSourceRecordIds: string[];
}): ReferenceFormulationRealismEvaluation {
  const sources = input.heldOutSourceRecords.map((record) => referenceFormulationRecordSchema.parse(record));
  const queries = input.heldOutQueryRecords.map((record) => referenceFormulationQueryRecordSchema.parse(record));
  if (new Set(sources.map((source) => source.id)).size !== sources.length
    || new Set(queries.map((query) => query.id)).size !== queries.length
    || new Set(input.trainingSourceRecordIds).size !== input.trainingSourceRecordIds.length) {
    throw new Error("Synthetic realism evaluation requires unique source, query and training identities.");
  }
  if (sources.length !== queries.length || sources.length < 3) {
    throw new Error("Synthetic realism evaluation requires at least three one-to-one held-out source/query records.");
  }
  const trainingIds = new Set(input.trainingSourceRecordIds);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  for (const query of queries) {
    const source = sourceById.get(query.sourceRecordId);
    if (!source || trainingIds.has(query.sourceRecordId)
      || source.sourceDocumentHash !== query.sourceDocumentHash
      || source.source.supplierId !== query.supplierId
      || source.source.title !== query.formulationTitle) {
      throw new Error("Held-out source/query lineage must match and must not overlap the training source IDs.");
    }
    const sourceFamilyMap = new Map<string, { rawValue: string; evidenceRefs: string[] }>();
    for (const candidate of source.identityCandidates.filter((item) => item.field === "product_family")) {
      const key = candidate.rawValue.normalize("NFKC").trim().toLocaleLowerCase("en-US");
      const evidenceRefs = candidate.evidence.map((evidence) => `identity:${evidence.sourceDocumentHash}:${evidence.pageNumber}:${evidence.blockIndex}`);
      const existing = sourceFamilyMap.get(key);
      if (existing) existing.evidenceRefs = [...new Set([...existing.evidenceRefs, ...evidenceRefs])];
      else sourceFamilyMap.set(key, { rawValue: candidate.rawValue, evidenceRefs });
    }
    const sourceFamilies = [...sourceFamilyMap.values()];
    const queryLineIds = query.lines.map((line) => line.sourceLineId).sort();
    const sourceLineIds = source.ingredientLines.map((line) => line.id).sort();
    const expectedProcess = createReferenceFormulationProcessNormalization(source).steps;
    if (!/^synthetic-supplier-\d{2,}$/u.test(source.source.supplierId)
      || query.productFamily.status !== "proposed"
      || query.productFamily.candidates.length !== 1
      || !/^Synthetic\s/u.test(query.productFamily.candidates[0]!.rawValue)
      || JSON.stringify(query.productFamily.candidates) !== JSON.stringify(sourceFamilies)
      || JSON.stringify(queryLineIds) !== JSON.stringify(sourceLineIds)) {
      throw new Error("Synthetic evaluation accepts only explicitly labeled fixture suppliers and product families.");
    }
    if (JSON.stringify(query.processSteps) !== JSON.stringify(expectedProcess)) {
      throw new Error("Synthetic evaluation process steps and citations must match the immutable source procedure snapshot.");
    }
    const sourceLines = new Map(source.ingredientLines.map((line) => [line.id, line]));
    for (const line of query.lines) {
      const sourceLine = sourceLines.get(line.sourceLineId)!;
      const expectedIdentityRefs = [sourceLine.ingredientName, sourceLine.supplierProductCode, sourceLine.inciOrChemicalName]
        .filter((field) => field !== undefined)
        .map((field) => formulaEvidenceRef(source.sourceDocumentHash, field.evidence));
      const expectedAmountRefs = [sourceLine.amount, sourceLine.unit, sourceLine.basis]
        .filter((field) => field !== undefined)
        .map((field) => formulaEvidenceRef(source.sourceDocumentHash, field.evidence));
      if (line.sourceIngredientName !== sourceLine.ingredientName?.rawValue
        || line.supplierProductCode !== sourceLine.supplierProductCode?.rawValue
        || line.inciOrChemicalName !== sourceLine.inciOrChemicalName?.rawValue
        || JSON.stringify(line.sourceLineEvidenceRefs) !== JSON.stringify(expectedIdentityRefs)
        || line.amount.originalValue !== sourceLine.amount?.rawValue
        || line.amount.unit !== sourceLine.unit?.rawValue
        || line.amount.basis !== sourceLine.basis?.rawValue
        || line.amount.quantitySemantics !== sourceLine.quantitySemantics
        || JSON.stringify(line.amount.evidenceRefs) !== JSON.stringify(expectedAmountRefs)) {
        throw new Error("Synthetic evaluation query lines must exactly match their cited immutable source rows.");
      }
    }
  }
  if (queries.some((query) => !sourceById.has(query.sourceRecordId))
    || new Set(queries.map((query) => query.sourceRecordId)).size !== queries.length) {
    throw new Error("Every held-out source record must have exactly one query snapshot.");
  }
  const supplierCount = new Set(queries.map((query) => query.supplierId)).size;
  const productFamilyCount = new Set(queries.map((query) => query.productFamily.candidates[0]!.rawValue)).size;
  if (supplierCount < 3 || productFamilyCount < 3) {
    throw new Error("Synthetic realism evaluation requires at least three fixture suppliers and product families.");
  }

  const formulas = queries.sort((left, right) => left.supplierId.localeCompare(right.supplierId, "en")
    || left.sourceRecordId.localeCompare(right.sourceRecordId, "en")).map((query) => {
    const source = sourceById.get(query.sourceRecordId)!;
    const family = query.productFamily.candidates[0]!;
    const reviewFlags = new Set<z.infer<typeof reviewFlagSchema>>();
    if (query.lines.length === 0) reviewFlags.add("no_ingredient_lines");
    if (query.lines.some((line) => line.sourceLineEvidenceRefs.length === 0)) reviewFlags.add("line_identity_evidence_missing");
    if (query.lines.some((line) => line.amount.evidenceRefs.length === 0 || !line.amount.originalValue)) reviewFlags.add("dosage_evidence_missing");
    if (source.arithmetic.arithmeticStatus !== "consistent") reviewFlags.add("arithmetic_not_source_confirmed");
    if (query.processSteps.length === 0) reviewFlags.add("no_process_steps");
    if (query.processSteps.some((step) => step.evidenceRefs.length === 0 || step.conditions.some((condition) => condition.evidenceRefs.length === 0))) {
      reviewFlags.add("process_evidence_missing");
    }
    const flags = [...reviewFlags].sort();
    return evaluationFormulaSchema.parse({
      sourceRecordId: source.id,
      sourceDocumentHash: source.sourceDocumentHash,
      supplierId: source.source.supplierId,
      formulationTitle: source.source.title,
      productFamily: { value: family.rawValue, evidenceRefs: family.evidenceRefs, reviewRequired: true },
      ingredientLines: query.lines.map((line) => ({
        sourceLineId: line.sourceLineId,
        ...(line.sourceIngredientName ? { ingredientLabel: line.sourceIngredientName } : {}),
        amount: {
          ...(line.amount.originalValue ? { originalValue: line.amount.originalValue } : {}),
          ...(line.amount.unit ? { unit: line.amount.unit } : {}),
          ...(line.amount.basis ? { basis: line.amount.basis } : {}),
          evidenceRefs: line.amount.evidenceRefs,
        },
        canonicalChemistry: { ...line.canonicalChemistry, reviewRequired: true as const },
        sourceEvidenceRefs: line.sourceLineEvidenceRefs,
        reviewRequired: true as const,
      })),
      dosageStructure: {
        arithmeticStatus: source.arithmetic.arithmeticStatus,
        ...(source.arithmetic.sourceDeclaredTotal ? { sourceDeclaredTotal: {
          originalValue: source.arithmetic.sourceDeclaredTotal.rawValue,
          ...(source.arithmetic.sourceDeclaredTotal.unit ? { unit: source.arithmetic.sourceDeclaredTotal.unit } : {}),
          ...(source.arithmetic.sourceDeclaredTotal.basis ? { basis: source.arithmetic.sourceDeclaredTotal.basis } : {}),
          evidenceRefs: [`formula:${source.sourceDocumentHash}:${source.arithmetic.sourceDeclaredTotal.evidence.pageNumber}:${source.arithmetic.sourceDeclaredTotal.evidence.blockIndex}:text:text`],
        } } : {}),
        ...(source.arithmetic.calculatedTotal ? { calculatedTotal: source.arithmetic.calculatedTotal } : {}),
        warnings: [...source.arithmetic.warnings],
        interpretation: "Source arithmetic and cited dosage evidence only; no dose recommendation or efficacy inference.",
      },
      processEvidence: {
        sourceStatus: query.processSteps.length === 0 ? "no_steps_extracted" : "available",
        steps: query.processSteps.map((step) => ({
          sequenceOrder: step.sequenceOrder,
          originalInstruction: step.originalInstruction,
          actionCandidates: step.actionCandidates,
          conditions: step.conditions.map((condition) => ({ kind: condition.kind, originalValue: condition.rawValue, evidenceRefs: condition.evidenceRefs })),
          evidenceRefs: step.evidenceRefs,
          reviewRequired: true as const,
        })),
        warnings: [...source.procedureWarnings],
      },
      reviewReadiness: flags.length === 0 ? "review_ready" : "review_ready_with_gaps",
      reviewFlags: flags,
      sourceReviewStatus: source.reviewStatus,
      humanReviewPerformed: false,
      labPerformanceEvaluated: false,
    });
  });

  return referenceFormulationRealismEvaluationSchema.parse({
    schemaVersion: REFERENCE_FORMULATION_REALISM_EVALUATION_VERSION,
    evaluationId: "synthetic-reference-formulation-realism-v1",
    datasetKind: "synthetic_structural_fixtures",
    heldOutFormulaCount: formulas.length,
    supplierCount,
    productFamilyCount,
    formulasReadyForChemistReview: formulas.filter((formula) => formula.reviewReadiness === "review_ready").length,
    formulasWithEvidenceGaps: formulas.filter((formula) => formula.reviewReadiness === "review_ready_with_gaps").length,
    formulas,
    humanReviewPerformed: false,
    labPerformanceEvaluated: false,
    disclaimer: "Synthetic structural evaluation only. Supplier IDs, formulas and citations are test fixtures; no real supplier product, human review, chemical plausibility, or laboratory performance is asserted.",
  });
}
