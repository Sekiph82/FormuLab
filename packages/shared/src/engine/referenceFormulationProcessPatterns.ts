import { z } from "zod";
import type { ReferenceFormulationQueryRecord } from "../schemas/referenceFormulationQuery";
import type { ReferenceFormulationRecord } from "../schemas/referenceFormulationRecord";
import { createReferenceFormulationProcessNormalization } from "../schemas/referenceFormulationProcessNormalization";
import { referenceFormulationReviewSchema, type ReferenceFormulationReview } from "../schemas/referenceFormulationReview";
import { filterEligibleReferenceFormulationCorpus, referenceFormulationEligibilityDecisionSchema } from "./referenceFormulationEligibility";

export const REFERENCE_FORMULATION_PROCESS_PATTERNS_VERSION = "formulab-reference-formulation-process-patterns-v2";
const supplierSchema = z.object({
  supplierId: z.string().trim().min(1), formulaCount: z.number().int().positive(), share: z.number().finite().min(0).max(1),
  sourceRecordIds: z.array(z.string().trim().min(1)).min(1),
}).strict();
const patternSchema = z.object({
  productFamilyKey: z.string().trim().min(1), productFamilyLabel: z.string().trim().min(1),
  patternKind: z.enum(["action", "action_sequence", "phase", "condition"]), patternId: z.string().trim().min(1), sourceValue: z.string().trim().min(1), sourceValues: z.array(z.string().trim().min(1)).min(1),
  formulaCount: z.number().int().positive(), eligibleProcessFormulaCount: z.number().int().positive(), frequency: z.number().finite().min(0).max(1),
  occurrenceCount: z.number().int().positive(), supplierCount: z.number().int().positive(), suppliers: z.array(supplierSchema),
  minimumSequenceOrder: z.number().int().positive(), maximumSequenceOrder: z.number().int().positive(),
  sourceRecordIds: z.array(z.string().trim().min(1)), evidenceRefs: z.array(z.string().trim().min(1)),
  interpretation: z.literal("reviewed_supplier_process_pattern"),
}).strict().superRefine((pattern, context) => {
  if (pattern.formulaCount > pattern.eligibleProcessFormulaCount || pattern.frequency !== pattern.formulaCount / pattern.eligibleProcessFormulaCount
    || pattern.occurrenceCount < pattern.formulaCount || pattern.sourceRecordIds.length !== pattern.formulaCount
    || new Set(pattern.sourceRecordIds).size !== pattern.formulaCount || pattern.suppliers.length !== pattern.supplierCount
    || pattern.suppliers.reduce((sum, item) => sum + item.formulaCount, 0) !== pattern.formulaCount
    || pattern.suppliers.some((item) => item.share !== item.formulaCount / pattern.formulaCount
      || item.sourceRecordIds.length !== item.formulaCount || new Set(item.sourceRecordIds).size !== item.sourceRecordIds.length)
    || new Set(pattern.suppliers.flatMap((item) => item.sourceRecordIds)).size !== pattern.formulaCount
    || JSON.stringify(pattern.suppliers.flatMap((item) => item.sourceRecordIds).sort(compare)) !== JSON.stringify([...pattern.sourceRecordIds].sort(compare))
    || pattern.minimumSequenceOrder > pattern.maximumSequenceOrder) {
    context.addIssue({ code: "custom", path: ["formulaCount"], message: "Process pattern samples, supplier counts, source IDs and sequence bounds must agree." });
  }
});

export const referenceFormulationProcessPatternsSchema = z.object({
  schemaVersion: z.literal(REFERENCE_FORMULATION_PROCESS_PATTERNS_VERSION), asOf: z.string().datetime({ offset: true }),
  eligibleFormulaCount: z.number().int().nonnegative(), excludedFormulaCount: z.number().int().nonnegative(),
  eligibleProcessFormulaCount: z.number().int().nonnegative(), excludedProcessEvidenceCount: z.number().int().nonnegative(),
  eligibilityDecisions: z.array(referenceFormulationEligibilityDecisionSchema),
  eligibleSourceRecordIdsByProductFamily: z.record(z.string().trim().min(1), z.array(z.string().trim().min(1))),
  eligibleProcessSourceRecordIdsByProductFamily: z.record(z.string().trim().min(1), z.array(z.string().trim().min(1))),
  eligibleProcessSupplierSourceRecordIdsByProductFamily: z.record(z.string().trim().min(1), z.record(z.string().trim().min(1), z.array(z.string().trim().min(1)))),
  patterns: z.array(patternSchema),
  interpretation: z.literal("supplier_reference_process_only"),
}).strict().superRefine((value, context) => {
  if (value.eligibleFormulaCount + value.excludedFormulaCount !== value.eligibilityDecisions.length
    || value.eligibleFormulaCount !== value.eligibilityDecisions.filter((item) => item.eligible).length
    || value.excludedFormulaCount !== value.eligibilityDecisions.filter((item) => !item.eligible).length
    || value.eligibleProcessFormulaCount > value.eligibleFormulaCount
    || new Set(Object.values(value.eligibleSourceRecordIdsByProductFamily).flat()).size !== value.eligibleFormulaCount
    || JSON.stringify(Object.values(value.eligibleSourceRecordIdsByProductFamily).flat().sort(compare))
      !== JSON.stringify(value.eligibilityDecisions.filter((item) => item.eligible).map((item) => item.sourceRecordId).sort(compare))
    || Object.values(value.eligibleSourceRecordIdsByProductFamily).some((ids) => new Set(ids).size !== ids.length)) {
    context.addIssue({ code: "custom", path: ["eligibilityDecisions"], message: "Process-pattern denominators must match reviewed corpus eligibility." });
  }
  const processSourceIds = Object.values(value.eligibleProcessSourceRecordIdsByProductFamily).flat();
  const processSupplierSourceIds = Object.values(value.eligibleProcessSupplierSourceRecordIdsByProductFamily).flatMap((suppliers) => Object.values(suppliers).flat());
  if (processSourceIds.length !== value.eligibleProcessFormulaCount || new Set(processSourceIds).size !== processSourceIds.length
    || Object.entries(value.eligibleProcessSourceRecordIdsByProductFamily).some(([familyKey, ids]) => new Set(ids).size !== ids.length
      || ids.some((id) => !value.eligibleSourceRecordIdsByProductFamily[familyKey]?.includes(id)))
    || Object.values(value.eligibleProcessSupplierSourceRecordIdsByProductFamily).some((suppliers) =>
      Object.values(suppliers).some((ids) => ids.length === 0 || new Set(ids).size !== ids.length))
    || new Set(processSupplierSourceIds).size !== processSupplierSourceIds.length
    || JSON.stringify([...processSupplierSourceIds].sort(compare)) !== JSON.stringify([...processSourceIds].sort(compare))
    || value.patterns.some((pattern) => pattern.eligibleProcessFormulaCount !== (value.eligibleProcessSourceRecordIdsByProductFamily[pattern.productFamilyKey]?.length ?? 0)
      || pattern.sourceRecordIds.some((id) => !value.eligibleProcessSourceRecordIdsByProductFamily[pattern.productFamilyKey]?.includes(id))
      || pattern.suppliers.some((supplier) => supplier.sourceRecordIds.some((id) =>
        !value.eligibleProcessSupplierSourceRecordIdsByProductFamily[pattern.productFamilyKey]?.[supplier.supplierId]?.includes(id))))) {
    context.addIssue({ code: "custom", path: ["patterns"], message: "Process samples must retain exact eligible family and supplier source evidence." });
  }
});
export type ReferenceFormulationProcessPatterns = z.infer<typeof referenceFormulationProcessPatternsSchema>;

type Occurrence = { sourceRecordId: string; supplierId: string; sequenceOrder: number; evidenceRefs: string[] };
type Builder = { familyLabel: string; patternKind: "action" | "action_sequence" | "phase" | "condition"; patternId: string; sourceValue: string; sourceValues: Set<string>; occurrences: Map<string, Occurrence[]> };
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function familyKey(value: string): string { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"); }

function latestReviews(input: ReferenceFormulationReview[]): Map<string, ReferenceFormulationReview> {
  const parsed = input.map((item) => referenceFormulationReviewSchema.parse(item));
  if (new Set(parsed.map((item) => item.id)).size !== parsed.length) throw new Error("Process-pattern input cannot contain duplicate review event IDs.");
  const result = new Map<string, ReferenceFormulationReview>();
  for (const item of parsed) {
    const key = `${item.referenceFormulationRecordId}\u0000${item.targetKey}`;
    const old = result.get(key);
    if (!old || Date.parse(item.reviewedAt) > Date.parse(old.reviewedAt) || (Date.parse(item.reviewedAt) === Date.parse(old.reviewedAt) && compare(item.id, old.id) > 0)) result.set(key, item);
  }
  return result;
}

function acceptedInstruction(input: { latest: Map<string, ReferenceFormulationReview>; query: ReferenceFormulationQueryRecord; step: ReferenceFormulationQueryRecord["processSteps"][number] }): boolean {
  const key = `procedure:${input.step.sourceProcedureStepId}:instruction`;
  const item = input.latest.get(`${input.query.sourceRecordId}\u0000${key}`);
  return item?.targetType === "procedure" && item.fieldPath === `procedureSteps[${input.step.sourceProcedureStepId}].rawInstruction`
    && item.sourceDocumentHash === input.query.sourceDocumentHash && item.decision === "accepted" && item.sourceValue === input.step.originalInstruction;
}

function acceptedCondition(input: { latest: Map<string, ReferenceFormulationReview>; query: ReferenceFormulationQueryRecord; step: ReferenceFormulationQueryRecord["processSteps"][number]; index: number }): boolean {
  const condition = input.step.conditions[input.index]!;
  const key = `procedure:${input.step.sourceProcedureStepId}:condition:${input.index}`;
  const item = input.latest.get(`${input.query.sourceRecordId}\u0000${key}`);
  return item?.targetType === "procedure" && item.fieldPath === `procedureSteps[${input.step.sourceProcedureStepId}].conditions[${input.index}]`
    && item.sourceDocumentHash === input.query.sourceDocumentHash && item.decision === "accepted" && item.sourceValue === condition.rawValue;
}

function acceptedPhase(input: { latest: Map<string, ReferenceFormulationReview>; query: ReferenceFormulationQueryRecord; step: ReferenceFormulationQueryRecord["processSteps"][number]; rawValue: string }): boolean {
  const key = `procedure:${input.step.sourceProcedureStepId}:phase`;
  const item = input.latest.get(`${input.query.sourceRecordId}\u0000${key}`);
  return item?.targetType === "procedure" && item.fieldPath === `procedureSteps[${input.step.sourceProcedureStepId}].phase`
    && item.sourceDocumentHash === input.query.sourceDocumentHash && item.decision === "accepted" && item.sourceValue === input.rawValue;
}

function normalizeCondition(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s*°\s*/gu, "°").replace(/(\d),(\d)/gu, "$1.$2").replace(/\s+/gu, " ");
}

const ACTION_VERBS: Record<string, string> = {
  addition: "add|added|adding|introduce|introducing|charge|charged|charging|incorporate|incorporating",
  dissolve: "dissolve|dissolved|dissolving|solubilize|solubilizing",
  mix: "mix|mixed|mixing|stir|stirred|stirring|agitate|agitated|agitating|homogenize|homogenized|homogenizing|disperse|dispersed|dispersing|blend|blended|blending",
  hold: "hold|held|holding|maintain|maintained|maintaining|keep|kept",
  heat: "heat|heated|heating|warm|warmed|warming",
  cool: "cool|cooled|cooling",
  adjust_ph: "adjust[^.;,]{0,32}p\\s*h|neutralize|neutralized|neutralizing|neutralise|neutralised|neutralising",
  thicken: "thicken|thickened|thickening|thickener|increase\\s+viscosity",
  appearance_check: "check\\s+appearance|inspect\\s+appearance|verify\\s+clarity",
  finish: "finish|finished|finishing|finalize|finalized|finalise|finalised|complete|completed",
};

function reviewedActionCandidates(step: ReferenceFormulationQueryRecord["processSteps"][number]): string[] {
  return [...new Set(step.actionCandidates.filter((action) => {
    if (action === "other") return false;
    const verbs = ACTION_VERBS[action];
    return !verbs || !new RegExp(`\\b(?:do\\s+not|don't|never|avoid|without)\\s+(?:[\\w-]+\\s+){0,5}(?:${verbs})\\b`, "iu").test(step.originalInstruction);
  }))];
}

/** Count reviewed, source-exact process patterns; missing steps, phases, or conditions are never inferred. */
export function calculateReferenceFormulationProcessPatterns(input: {
  queryRecords: ReferenceFormulationQueryRecord[]; sourceRecords: ReferenceFormulationRecord[]; reviews: ReferenceFormulationReview[]; asOf: string;
}): ReferenceFormulationProcessPatterns {
  const eligibility = filterEligibleReferenceFormulationCorpus(input);
  const sourceById = new Map(input.sourceRecords.map((source) => [source.id, source]));
  const latest = latestReviews(input.reviews);
  const builders = new Map<string, Builder>();
  const eligibleSourceRecordIdsByFamily = new Map<string, string[]>();
  const eligibleProcessByFamily = new Map<string, number>();
  const eligibleProcessSourceIdsByFamily = new Map<string, string[]>();
  const eligibleProcessSupplierSourceIdsByFamily = new Map<string, Map<string, string[]>>();
  let eligibleProcessFormulaCount = 0;
  let excludedProcessEvidenceCount = 0;
  const add = (query: ReferenceFormulationQueryRecord, kind: Builder["patternKind"], id: string, value: string, order: number, refs: string[]) => {
    const family = query.productFamily.candidates[0]!;
    const fkey = familyKey(family.rawValue);
    const key = [fkey, kind, id].join("\u0000");
    let builder = builders.get(key);
    if (!builder) { builder = { familyLabel: family.rawValue, patternKind: kind, patternId: id, sourceValue: value, sourceValues: new Set(), occurrences: new Map() }; builders.set(key, builder); }
    builder.sourceValues.add(value);
    const occurrences = builder.occurrences.get(query.sourceRecordId) ?? [];
    occurrences.push({ sourceRecordId: query.sourceRecordId, supplierId: query.supplierId, sequenceOrder: order, evidenceRefs: refs });
    builder.occurrences.set(query.sourceRecordId, occurrences);
  };

  for (const query of eligibility.eligible) {
    const familyId = familyKey(query.productFamily.candidates[0]!.rawValue);
    const familySourceIds = eligibleSourceRecordIdsByFamily.get(familyId) ?? [];
    familySourceIds.push(query.sourceRecordId);
    eligibleSourceRecordIdsByFamily.set(familyId, familySourceIds);
    const source = sourceById.get(query.sourceRecordId)!;
    const expected = createReferenceFormulationProcessNormalization(source).steps;
    if (JSON.stringify(query.processSteps) !== JSON.stringify(expected)) throw new Error("Process-pattern query steps must match the immutable source procedure snapshot.");
    let hasReviewedProcess = false;
    for (const step of query.processSteps) {
      if (!acceptedInstruction({ latest, query, step })) { excludedProcessEvidenceCount += 1; continue; }
      hasReviewedProcess = true;
      const instructionRef = step.evidenceRefs[0]!;
      const actions = reviewedActionCandidates(step);
      for (const action of actions) add(query, "action", action, action, step.sequenceOrder, [instructionRef]);
      const sourceStep = source.procedureSteps.find((item) => item.id === step.sourceProcedureStepId)!;
      if (step.phaseCandidates.status === "proposed" && step.phaseCandidates.candidateValues.length === 1) {
        const phase = step.phaseCandidates.candidateValues[0]!;
        const explicitPhase = sourceStep.phase;
        const phaseAccepted = explicitPhase
          ? phase.rawValue === explicitPhase.rawValue && acceptedPhase({ latest, query, step, rawValue: explicitPhase.rawValue })
          : phase.evidenceRefs.every((ref) => step.evidenceRefs.includes(ref));
        if (phaseAccepted) add(query, "phase", phase.rawValue.normalize("NFKC").trim().toLocaleLowerCase("en-US"), phase.rawValue, step.sequenceOrder, phase.evidenceRefs);
      }
      for (const [index, condition] of step.conditions.entries()) {
        if (!acceptedCondition({ latest, query, step, index })) { excludedProcessEvidenceCount += 1; continue; }
        add(query, "condition", `${condition.kind}:${normalizeCondition(condition.rawValue)}`,
          condition.rawValue, step.sequenceOrder, condition.evidenceRefs);
      }
    }
    const reviewedSteps = query.processSteps.filter((step) => acceptedInstruction({ latest, query, step })).sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    for (let i = 0; i < reviewedSteps.length; i += 1) {
      const earlier = reviewedSteps[i]!;
      const earlierActions = reviewedActionCandidates(earlier);
      for (let j = i + 1; j < reviewedSteps.length; j += 1) {
        const later = reviewedSteps[j]!;
        const laterActions = reviewedActionCandidates(later);
        for (const firstAction of earlierActions) for (const secondAction of laterActions) {
          const id = `${firstAction}->${secondAction}`;
          add(query, "action_sequence", id, `${firstAction} → ${secondAction}`, earlier.sequenceOrder, [...earlier.evidenceRefs, ...later.evidenceRefs]);
        }
      }
    }
    if (hasReviewedProcess) {
      eligibleProcessFormulaCount += 1;
      eligibleProcessByFamily.set(familyId, (eligibleProcessByFamily.get(familyId) ?? 0) + 1);
      const processSourceIds = eligibleProcessSourceIdsByFamily.get(familyId) ?? [];
      processSourceIds.push(query.sourceRecordId);
      eligibleProcessSourceIdsByFamily.set(familyId, processSourceIds);
      const familySuppliers = eligibleProcessSupplierSourceIdsByFamily.get(familyId) ?? new Map<string, string[]>();
      const supplierSourceIds = familySuppliers.get(query.supplierId) ?? [];
      supplierSourceIds.push(query.sourceRecordId);
      familySuppliers.set(query.supplierId, supplierSourceIds);
      eligibleProcessSupplierSourceIdsByFamily.set(familyId, familySuppliers);
    }
  }

  const patterns = [...builders.entries()].sort(([a], [b]) => compare(a, b)).map(([key, builder]) => {
    const formulaObservations = [...builder.occurrences.entries()].sort(([a], [b]) => compare(a, b));
    const suppliers = new Map<string, number>();
    const sequenceOrders: number[] = [];
    for (const [, occurrences] of formulaObservations) {
      suppliers.set(occurrences[0]!.supplierId, (suppliers.get(occurrences[0]!.supplierId) ?? 0) + 1);
      sequenceOrders.push(...occurrences.map((item) => item.sequenceOrder));
    }
    const familyId = key.split("\u0000")[0]!;
    const sourceValues = [...builder.sourceValues].sort(compare);
    const formulaCount = formulaObservations.length;
    const denominator = eligibleProcessByFamily.get(familyId) ?? 0;
    return {
      productFamilyKey: familyId, productFamilyLabel: builder.familyLabel, patternKind: builder.patternKind, patternId: builder.patternId,
      sourceValue: sourceValues[0]!, sourceValues, formulaCount, eligibleProcessFormulaCount: denominator, frequency: formulaCount / denominator,
      occurrenceCount: sequenceOrders.length, supplierCount: suppliers.size,
      suppliers: [...suppliers.entries()].sort(([a], [b]) => compare(a, b)).map(([supplierId, count]) => ({
        supplierId, formulaCount: count, share: count / formulaCount,
        sourceRecordIds: formulaObservations.filter(([, occurrences]) => occurrences[0]!.supplierId === supplierId).map(([id]) => id),
      })),
      minimumSequenceOrder: Math.min(...sequenceOrders), maximumSequenceOrder: Math.max(...sequenceOrders),
      sourceRecordIds: formulaObservations.map(([id]) => id), evidenceRefs: [...new Set(formulaObservations.flatMap(([, items]) => items.flatMap((item) => item.evidenceRefs)))].sort(compare),
      interpretation: "reviewed_supplier_process_pattern" as const,
    };
  });
  return referenceFormulationProcessPatternsSchema.parse({
    schemaVersion: REFERENCE_FORMULATION_PROCESS_PATTERNS_VERSION, asOf: input.asOf,
    eligibleFormulaCount: eligibility.eligible.length, excludedFormulaCount: eligibility.excluded.length,
    eligibleProcessFormulaCount, excludedProcessEvidenceCount, eligibilityDecisions: eligibility.decisions,
    eligibleSourceRecordIdsByProductFamily: Object.fromEntries([...eligibleSourceRecordIdsByFamily.entries()]
      .sort(([left], [right]) => compare(left, right)).map(([key, ids]) => [key, ids.sort(compare)])),
    eligibleProcessSourceRecordIdsByProductFamily: Object.fromEntries([...eligibleProcessSourceIdsByFamily.entries()]
      .sort(([left], [right]) => compare(left, right)).map(([key, ids]) => [key, ids.sort(compare)])),
    eligibleProcessSupplierSourceRecordIdsByProductFamily: Object.fromEntries([...eligibleProcessSupplierSourceIdsByFamily.entries()]
      .sort(([left], [right]) => compare(left, right)).map(([key, suppliers]) => [key, Object.fromEntries([...suppliers.entries()]
        .sort(([left], [right]) => compare(left, right)).map(([supplierId, ids]) => [supplierId, ids.sort(compare)]))])),
    patterns,
    interpretation: "supplier_reference_process_only",
  });
}
