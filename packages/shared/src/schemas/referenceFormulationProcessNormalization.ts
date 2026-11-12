import { z } from "zod";
import {
  REFERENCE_FORMULATION_PROCESS_ACTIONS,
  referenceFormulationProcedureStepSchema,
  type ReferenceFormulationProcedureStep,
} from "../engine/referenceFormulationProcedureExtraction";
import { referenceFormulationRecordSchema, type ReferenceFormulationRecord } from "./referenceFormulationRecord";

export const REFERENCE_FORMULATION_PROCESS_NORMALIZATION_VERSION = "formulab-reference-formulation-process-normalization-v1";

const processPhaseCandidatesSchema = z.object({
  status: z.enum(["unresolved", "proposed", "ambiguous"]),
  candidateValues: z.array(z.object({
    rawValue: z.string().trim().min(1),
    evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  }).strict()),
}).strict().superRefine((value, context) => {
  if (new Set(value.candidateValues.map((candidate) => candidate.rawValue.toLocaleLowerCase("en-US"))).size !== value.candidateValues.length) {
    context.addIssue({ code: "custom", path: ["candidateValues"], message: "Process phase candidates must be unique." });
  }
  if ((value.status === "unresolved") !== (value.candidateValues.length === 0)
    || (value.status === "proposed" && value.candidateValues.length !== 1)
    || (value.status === "ambiguous" && value.candidateValues.length < 2)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Phase candidate status must match its candidate list." });
  }
});

const normalizedProcessConditionSchema = z.object({
  kind: z.enum(["temperature", "time", "speed", "ph", "appearance", "homogeneity"]),
  rawValue: z.string().trim().min(1),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  reviewRequired: z.literal(true),
}).strict();

export const referenceFormulationNormalizedProcessStepSchema = z.object({
  sourceProcedureStepId: z.string().trim().min(1),
  sequenceOrder: z.number().int().positive(),
  printedStepNumber: z.string().trim().min(1).optional(),
  originalInstruction: z.string().trim().min(1).max(4000),
  actionCandidates: z.array(z.enum(REFERENCE_FORMULATION_PROCESS_ACTIONS)).min(1),
  phaseCandidates: processPhaseCandidatesSchema,
  conditions: z.array(normalizedProcessConditionSchema),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  reviewRequired: z.literal(true),
}).strict();

export const referenceFormulationProcessNormalizationSchema = z.object({
  normalizerVersion: z.literal(REFERENCE_FORMULATION_PROCESS_NORMALIZATION_VERSION),
  sourceStatus: z.enum(["available", "no_steps_extracted"]),
  steps: z.array(referenceFormulationNormalizedProcessStepSchema),
  sourceWarnings: z.array(z.enum(["procedure_section_not_detected", "no_procedure_steps", "ambiguous_procedure_columns", "ocr_process_requires_review"])),
  reviewRequired: z.literal(true),
}).strict().superRefine((value, context) => {
  if ((value.sourceStatus === "no_steps_extracted") !== (value.steps.length === 0)) {
    context.addIssue({ code: "custom", path: ["sourceStatus"], message: "Process status must reflect whether source steps were extracted." });
  }
  const sourceStepIds = value.steps.map((step) => step.sourceProcedureStepId);
  if (new Set(sourceStepIds).size !== sourceStepIds.length) {
    context.addIssue({ code: "custom", path: ["steps"], message: "A source procedure step may appear only once." });
  }
  if (value.steps.some((step, index) => step.sequenceOrder !== index + 1)) {
    context.addIssue({ code: "custom", path: ["steps"], message: "Normalized process steps must preserve source sequence order." });
  }
});

export type ReferenceFormulationProcessNormalization = z.infer<typeof referenceFormulationProcessNormalizationSchema>;

function processEvidenceRef(step: ReferenceFormulationProcedureStep, evidence = step.evidence): string {
  return `formula:${evidence.sourceDocumentHash}:${evidence.pageNumber}:${evidence.blockIndex}:${evidence.rowIndex ?? "text"}:${evidence.cellIndex ?? "text"}`;
}

function phaseCandidates(step: ReferenceFormulationProcedureStep): ReferenceFormulationProcessNormalization["steps"][number]["phaseCandidates"] {
  const candidates = new Map<string, { rawValue: string; evidenceRefs: string[] }>();
  const addCandidate = (rawValue: string, evidenceRef: string) => {
    const key = rawValue.toLocaleLowerCase("en-US");
    const existing = candidates.get(key);
    if (existing) {
      if (!existing.evidenceRefs.includes(evidenceRef)) existing.evidenceRefs.push(evidenceRef);
    } else candidates.set(key, { rawValue, evidenceRefs: [evidenceRef] });
  };
  if (step.phase) addCandidate(step.phase.rawValue, processEvidenceRef(step, step.phase.evidence));
  for (const match of step.rawInstruction.matchAll(/\bphase\s+([A-Za-z0-9][A-Za-z0-9_-]*)/gi)) {
    addCandidate(match[1]!, processEvidenceRef(step));
  }
  const values = [...candidates.values()];
  return {
    status: values.length === 0 ? "unresolved" : values.length === 1 ? "proposed" : "ambiguous",
    candidateValues: values,
  };
}

export function createReferenceFormulationProcessNormalization(source: ReferenceFormulationRecord): ReferenceFormulationProcessNormalization {
  const steps = source.procedureSteps.map((step) => referenceFormulationProcedureStepSchema.parse({
    ...step,
    evidence: step.evidence,
  })).map((step) => ({
    sourceProcedureStepId: step.id,
    sequenceOrder: step.sequenceOrder,
    ...(step.printedStepNumber ? { printedStepNumber: step.printedStepNumber } : {}),
    originalInstruction: step.rawInstruction,
    actionCandidates: [...step.actions],
    phaseCandidates: phaseCandidates(step),
    conditions: step.conditions.map((condition) => ({
      kind: condition.kind,
      rawValue: condition.rawValue,
      evidenceRefs: [processEvidenceRef(step, condition.evidence)],
      reviewRequired: true as const,
    })),
    evidenceRefs: [processEvidenceRef(step)],
    reviewRequired: true as const,
  }));
  return referenceFormulationProcessNormalizationSchema.parse({
    normalizerVersion: REFERENCE_FORMULATION_PROCESS_NORMALIZATION_VERSION,
    sourceStatus: steps.length === 0 ? "no_steps_extracted" : "available",
    steps,
    sourceWarnings: source.procedureWarnings,
    reviewRequired: true,
  });
}

export function validateReferenceFormulationProcessNormalizationAgainstSource(
  processInput: ReferenceFormulationProcessNormalization,
  sourceInput: ReferenceFormulationRecord,
): ReferenceFormulationProcessNormalization {
  const value = referenceFormulationProcessNormalizationSchema.parse(processInput);
  const source = referenceFormulationRecordSchema.parse(sourceInput);
  const expected = createReferenceFormulationProcessNormalization(source);
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new Error("Normalized process steps, facts, citations and warnings must match the immutable source procedure snapshot.");
  }
  return value;
}
