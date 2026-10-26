import { z } from "zod";
import {
  referenceFormulationTargetCandidateSchema,
  type ReferenceFormulationTargetCandidate,
  type ReferenceFormulationTargetWarning,
} from "../engine/referenceFormulationTargetExtraction";
import { referenceFormulationRecordSchema, type ReferenceFormulationRecord } from "./referenceFormulationRecord";

export const REFERENCE_FORMULATION_TARGET_NORMALIZATION_VERSION = "formulab-reference-formulation-target-normalization-v1";

export const referenceFormulationNormalizedTargetSchema = z.object({
  sourceTargetId: z.string().trim().min(1),
  property: z.enum(["ph", "viscosity", "density", "appearance", "other"]),
  originalLabel: z.string().trim().min(1),
  originalValue: z.string().trim().min(1).max(2000),
  valueShape: z.enum(["point_or_exact", "range", "approximate", "approximate_range", "unparsed"]),
  resultSemantics: z.enum(["target", "typical_result", "unspecified"]),
  sourceContext: z.string().trim().min(1),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  reviewRequired: z.literal(true),
}).strict();

export const referenceFormulationTargetNormalizationSchema = z.object({
  normalizerVersion: z.literal(REFERENCE_FORMULATION_TARGET_NORMALIZATION_VERSION),
  sourceStatus: z.enum(["available", "no_candidates"]),
  targets: z.array(referenceFormulationNormalizedTargetSchema),
  sourceWarnings: z.array(z.enum([
    "no_target_result_section", "no_target_result_candidates", "ambiguous_property_columns", "ocr_target_results_require_review",
  ])),
  reviewRequired: z.literal(true),
}).strict().superRefine((value, context) => {
  if ((value.sourceStatus === "no_candidates") !== (value.targets.length === 0)) {
    context.addIssue({ code: "custom", path: ["sourceStatus"], message: "Target status must reflect the source candidate list." });
  }
  const ids = value.targets.map((target) => target.sourceTargetId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["targets"], message: "A source target candidate may appear only once." });
  }
});

export type ReferenceFormulationTargetNormalization = z.infer<typeof referenceFormulationTargetNormalizationSchema>;

function targetEvidenceRef(candidate: ReferenceFormulationTargetCandidate): string {
  const evidence = candidate.evidence;
  return `formula:${evidence.sourceDocumentHash}:${evidence.pageNumber}:${evidence.blockIndex}:${evidence.rowIndex ?? "text"}:${evidence.cellIndex ?? "text"}`;
}

function normalizeTarget(candidate: ReferenceFormulationTargetCandidate): ReferenceFormulationTargetNormalization["targets"][number] {
  return {
    sourceTargetId: candidate.id,
    property: candidate.field,
    originalLabel: candidate.rawPropertyLabel,
    originalValue: candidate.rawValue,
    valueShape: candidate.valueShape,
    resultSemantics: candidate.resultSemantics,
    sourceContext: candidate.evidence.excerpt,
    evidenceRefs: [targetEvidenceRef(candidate)],
    reviewRequired: true,
  };
}

export function createReferenceFormulationTargetNormalization(source: ReferenceFormulationRecord): ReferenceFormulationTargetNormalization {
  const targets = source.targetCandidates.map((candidate) => normalizeTarget(referenceFormulationTargetCandidateSchema.parse(candidate)));
  return referenceFormulationTargetNormalizationSchema.parse({
    normalizerVersion: REFERENCE_FORMULATION_TARGET_NORMALIZATION_VERSION,
    sourceStatus: targets.length === 0 ? "no_candidates" : "available",
    targets,
    sourceWarnings: [...source.targetWarnings] as ReferenceFormulationTargetWarning[],
    reviewRequired: true,
  });
}

export function validateReferenceFormulationTargetNormalizationAgainstSource(
  targetInput: ReferenceFormulationTargetNormalization,
  sourceInput: ReferenceFormulationRecord,
): ReferenceFormulationTargetNormalization {
  const value = referenceFormulationTargetNormalizationSchema.parse(targetInput);
  const source = referenceFormulationRecordSchema.parse(sourceInput);
  const expected = createReferenceFormulationTargetNormalization(source);
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new Error("Normalized target properties, semantics, context and citations must match the immutable source target snapshot.");
  }
  return value;
}
