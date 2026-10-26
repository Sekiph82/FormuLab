import { z } from "zod";
import type { ReferenceFormulationRecord } from "./referenceFormulationRecord";

export const REFERENCE_FORMULATION_NORMALIZATION_VERSION = "formulab-reference-formulation-normalization-v1";

export const referenceFormulationNormalizationCandidatesSchema = z.object({
  status: z.enum(["unresolved", "proposed", "ambiguous"]),
  candidateIds: z.array(z.string().trim().min(1)),
}).strict().superRefine((value, context) => {
  if (new Set(value.candidateIds).size !== value.candidateIds.length) {
    context.addIssue({ code: "custom", path: ["candidateIds"], message: "Normalization candidate IDs must be unique." });
  }
  if ((value.status === "unresolved") !== (value.candidateIds.length === 0)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Unresolved status requires no candidates; proposed or ambiguous status requires candidates." });
  }
  if (value.status === "proposed" && value.candidateIds.length !== 1) {
    context.addIssue({ code: "custom", path: ["candidateIds"], message: "A proposed normalization must have exactly one unaccepted candidate." });
  }
  if (value.status === "ambiguous" && value.candidateIds.length < 2) {
    context.addIssue({ code: "custom", path: ["candidateIds"], message: "Ambiguous normalization requires at least two candidates." });
  }
});

export const referenceFormulationNormalizedLineSchema = z.object({
  sourceLineId: z.string().trim().min(1),
  /** Candidate link only; this does not confirm or approve a supplier product identity. */
  commercialProduct: referenceFormulationNormalizationCandidatesSchema,
  /** Candidate link only; composition, contribution, and function are modeled separately. */
  canonicalChemistry: referenceFormulationNormalizationCandidatesSchema,
}).strict();

export const referenceFormulationNormalizationVersionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  recordKind: z.literal("reference_formulation_normalization"),
  id: z.string().trim().min(1),
  code: z.string().trim().min(1),
  referenceFormulationRecordId: z.string().trim().min(1),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  normalizerVersion: z.literal(REFERENCE_FORMULATION_NORMALIZATION_VERSION),
  version: z.number().int().positive(),
  supersedesNormalizationId: z.string().trim().min(1).optional(),
  lines: z.array(referenceFormulationNormalizedLineSchema),
  createdAt: z.string().datetime({ offset: true }),
}).strict().superRefine((record, context) => {
  if (record.id !== record.code) {
    context.addIssue({ code: "custom", path: ["code"], message: "Normalization code must equal its immutable version ID." });
  }
  if ((record.version === 1) === (record.supersedesNormalizationId !== undefined)) {
    context.addIssue({ code: "custom", path: ["supersedesNormalizationId"], message: "Version 1 has no predecessor; later versions must name the prior normalization." });
  }
  const ids = record.lines.map((line) => line.sourceLineId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["lines"], message: "A source ingredient line may appear only once in a normalization version." });
  }
});

export type ReferenceFormulationNormalizationCandidates = z.infer<typeof referenceFormulationNormalizationCandidatesSchema>;
export type ReferenceFormulationNormalizedLine = z.infer<typeof referenceFormulationNormalizedLineSchema>;
export type ReferenceFormulationNormalizationVersion = z.infer<typeof referenceFormulationNormalizationVersionSchema>;

/** Create a new normalization version that points to, and never edits, the source's original lines. */
export function createReferenceFormulationNormalizationVersion(input: {
  id: string;
  source: ReferenceFormulationRecord;
  version: number;
  supersedesNormalizationId?: string;
  canonicalChemicalCandidates?: Record<string, string[]>;
  createdAt: string;
}): ReferenceFormulationNormalizationVersion {
  const productMatches = new Map(input.source.productMatches.map((match) => [
    match.ingredientLineId,
    match.candidates.map((candidate) => candidate.commercialProductId),
  ]));
  const canonicalCandidates = input.canonicalChemicalCandidates ?? {};
  const sourceLineIds = new Set(input.source.ingredientLines.map((line) => line.id));
  const unknownLineIds = Object.keys(canonicalCandidates).filter((id) => !sourceLineIds.has(id));
  if (unknownLineIds.length > 0) throw new Error(`Canonical chemistry candidates reference unknown source line(s): ${unknownLineIds.join(", ")}`);

  const candidates = (ids: string[]): ReferenceFormulationNormalizationCandidates => {
    const uniqueIds = [...new Set(ids)];
    return referenceFormulationNormalizationCandidatesSchema.parse({
      status: uniqueIds.length === 0 ? "unresolved" : uniqueIds.length === 1 ? "proposed" : "ambiguous",
      candidateIds: uniqueIds,
    });
  };
  return referenceFormulationNormalizationVersionSchema.parse({
    schemaVersion: "1.0",
    recordKind: "reference_formulation_normalization",
    id: input.id,
    code: input.id,
    referenceFormulationRecordId: input.source.id,
    sourceDocumentHash: input.source.sourceDocumentHash,
    normalizerVersion: REFERENCE_FORMULATION_NORMALIZATION_VERSION,
    version: input.version,
    ...(input.supersedesNormalizationId ? { supersedesNormalizationId: input.supersedesNormalizationId } : {}),
    lines: input.source.ingredientLines.map((line) => ({
      sourceLineId: line.id,
      commercialProduct: candidates(productMatches.get(line.id) ?? []),
      canonicalChemistry: candidates(canonicalCandidates[line.id] ?? []),
    })),
    createdAt: input.createdAt,
  });
}
