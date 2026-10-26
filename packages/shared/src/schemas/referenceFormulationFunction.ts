import { z } from "zod";
import { MATERIAL_FUNCTIONS } from "./primitives";
import { referenceFormulationRecordSchema, type ReferenceFormulationRecord } from "./referenceFormulationRecord";

export const supplierFunctionEvidenceSchema = z.object({
  status: z.enum(["not_stated", "stated"]),
  originalValue: z.string().trim().min(1).optional(),
  evidenceRefs: z.array(z.string().trim().min(1)),
}).strict().superRefine((value, context) => {
  if (value.status === "stated" && (!value.originalValue || value.evidenceRefs.length === 0)) {
    context.addIssue({ code: "custom", path: ["evidenceRefs"], message: "Supplier-stated functions must retain the original wording and source citation." });
  }
  if (value.status === "not_stated" && (value.originalValue !== undefined || value.evidenceRefs.length > 0)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Unstated supplier functions cannot carry inferred wording or citations." });
  }
});

export const canonicalFunctionCandidatesSchema = z.object({
  status: z.enum(["unresolved", "proposed", "ambiguous"]),
  candidateIds: z.array(z.enum(MATERIAL_FUNCTIONS)),
}).strict().superRefine((value, context) => {
  if (new Set(value.candidateIds).size !== value.candidateIds.length) {
    context.addIssue({ code: "custom", path: ["candidateIds"], message: "Canonical function candidates must be unique." });
  }
  if ((value.status === "unresolved") !== (value.candidateIds.length === 0)
    || (value.status === "proposed" && value.candidateIds.length !== 1)
    || (value.status === "ambiguous" && value.candidateIds.length < 2)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Canonical function candidate status must match its candidate list; candidates remain unaccepted." });
  }
});

/** Supplier wording and canonical function candidates stay separate and review-required. */
export const referenceFormulationFunctionNormalizationSchema = z.object({
  supplierFunction: supplierFunctionEvidenceSchema,
  canonicalFunction: canonicalFunctionCandidatesSchema,
  reviewRequired: z.literal(true),
}).strict().superRefine((value, context) => {
  if (value.supplierFunction.status === "not_stated" && value.canonicalFunction.candidateIds.length > 0) {
    context.addIssue({ code: "custom", path: ["canonicalFunction"], message: "Canonical function candidates require explicit supplier-function evidence in this normalization task." });
  }
});

export type ReferenceFormulationFunctionNormalization = z.infer<typeof referenceFormulationFunctionNormalizationSchema>;

function supplierFunctionEvidenceRefs(line: ReferenceFormulationRecord["ingredientLines"][number]): string[] {
  if (!line.function) return [];
  const evidence = line.function.evidence;
  return [`formula:${evidence.sourceDocumentHash}:${evidence.pageNumber}:${evidence.blockIndex}:${evidence.rowIndex}:${evidence.cellIndex}`];
}

export function createReferenceFormulationFunctionNormalization(input: {
  source: ReferenceFormulationRecord;
  sourceFormulaLineId: string;
  canonicalFunctionCandidates?: Array<(typeof MATERIAL_FUNCTIONS)[number]>;
}): ReferenceFormulationFunctionNormalization {
  const source = input.source;
  const line = source.ingredientLines.find((candidate) => candidate.id === input.sourceFormulaLineId);
  if (!line) throw new Error("Function normalization source formula line was not found.");
  const candidateIds = [...new Set(input.canonicalFunctionCandidates ?? [])];
  return referenceFormulationFunctionNormalizationSchema.parse({
    supplierFunction: line.function
      ? { status: "stated", originalValue: line.function.rawValue, evidenceRefs: supplierFunctionEvidenceRefs(line) }
      : { status: "not_stated", evidenceRefs: [] },
    canonicalFunction: {
      status: candidateIds.length === 0 ? "unresolved" : candidateIds.length === 1 ? "proposed" : "ambiguous",
      candidateIds,
    },
    reviewRequired: true,
  });
}

export function validateReferenceFormulationFunctionNormalizationAgainstSource(
  functionInput: ReferenceFormulationFunctionNormalization,
  sourceInput: ReferenceFormulationRecord,
  sourceFormulaLineId: string,
): ReferenceFormulationFunctionNormalization {
  const value = referenceFormulationFunctionNormalizationSchema.parse(functionInput);
  const source = referenceFormulationRecordSchema.parse(sourceInput);
  const line = source.ingredientLines.find((candidate) => candidate.id === sourceFormulaLineId);
  if (!line) throw new Error("Function normalization source formula line was not found.");
  const expected = createReferenceFormulationFunctionNormalization({ source, sourceFormulaLineId });
  if (JSON.stringify(value.supplierFunction) !== JSON.stringify(expected.supplierFunction)) {
    throw new Error("Supplier function wording and citations must match the immutable source formula line.");
  }
  return value;
}
