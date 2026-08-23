/**
 * FVL-05.004 — the extractor: turns a persisted `FormulationVersion`'s
 * linked `LaboratoryTrial` records AND the version's own canonical
 * `process_parameters` Manufacturing Procedure rows into
 * `FormulaVersionProcessRow` dataset rows for the future Historical
 * Experiment Dataset Builder.
 *
 * See `schemas/dataset.ts`'s header comment on `formulaVersionProcessRowSchema`
 * for the full AUDIT_000018 re-resolution of the Manufacturing Procedure
 * source question: `process_parameters` (`schemas/dataExchange.ts`'s
 * `processParameterSchema`) IS a persisted process-plan record independent
 * of any trial, deterministically linked by its own exact
 * `(formulaCode, formulaVersion)` natural key against
 * `Formulation.code`/`FormulationVersion.versionNumber` — never a fuzzy or
 * fabricated match. `LaboratoryTrial.processSteps` (`schemas/laboratory.ts`)
 * remains the only source for trial-scoped planned/actual data. A trial is
 * "linked" to the requested formula version only when
 * `sourceType === "saved_version"` AND `sourceFormulaVersionId` exactly
 * matches the requested version's id; a linked trial whose `projectId` does
 * not match the version's owning `Formulation.id` is a conflicting link,
 * not a usable one, and fails closed rather than being silently attributed
 * or silently dropped.
 *
 * Pure and deterministic: no persistence, no mutation of its inputs, no
 * generated ids/timestamps. Trials are ordered by `createdAt` then `id`
 * (never by input array order) so reordering the supplied trial pool never
 * changes a row's `trials` order. Within a trial, planned steps and actual
 * step observations are ordered by the persisted `stepNumber` (the domain's
 * own authoritative process order) then `id`; discrete `TrialObservation`
 * records are ordered by `observedAt` then `id`. `plannedProcedure` rows are
 * ordered by their own `stepNumber` then `code`, independent of input order.
 *
 * Every constructed row is validated against `formulaVersionProcessRowSchema`
 * before it is returned, exactly as `formulaVersionDatasetExtractor.ts`
 * does — fails closed on a malformed row, and guarantees (via zod's
 * always-rebuilding parse) that the returned row shares no mutable
 * array/object with the source records it was built from.
 *
 * `TrialProcessStep.id`/`TrialObservation.id` are embedded-array-scoped to
 * their own trial, not globally unique, so two different linked trials may
 * legitimately hold a step or observation with the same `id` — and either
 * id may itself legitimately contain any character, including a delimiter
 * like `:`. A naive `${trial.id}:${record.id}` join is therefore NOT
 * injective (`trial.id="A:B"` + `record.id="C"` collides with
 * `trial.id="A"` + `record.id="B:C"`, both producing `"A:B:C"`) — this was
 * AUDIT_000018's collision-safety finding. `encodeNestedLineageId` below
 * fixes this with `JSON.stringify([parentId, recordId])`: JSON string
 * escaping is a structural (length-delimited via quoting/escaping), not
 * fixed-delimiter, encoding — two different `(parentId, recordId)` pairs of
 * non-blank strings always serialize to two different JSON array literals,
 * for any content either id may contain, and the exact original pair is
 * always recoverable via `JSON.parse`. The row's own emitted
 * `processStepId`/observation `id` fields stay the exact, unprefixed
 * persisted value; only the lineage citation's `sourceRecordId` is encoded.
 */
import type { Formulation, FormulationVersion } from "../schemas/formulation";
import type { ProcessParameter } from "../schemas/dataExchange";
import type { LaboratoryTrial, TrialObservation, TrialProcessStep } from "../schemas/laboratory";
import {
  DATASET_SCHEMA_VERSION,
  formulaVersionProcessRowSchema,
  type FormulaVersionProcessRow,
  type ProcessStepActualObservation,
  type ProcessStepPlan,
  type ProcessTrial,
  type SourceRecordReference,
} from "../schemas/dataset";

/** Deterministic, collision-safe, recoverable encoding of a nested (trial-
 *  scoped) source-record identity into a single `sourceRecordId` string.
 *  JSON array serialization of two strings is injective — see this file's
 *  header comment for why a fixed delimiter (`:` or otherwise) is not.
 *  Exported so tests (and any future decode need) never hand-roll the
 *  format independently of this one authority. */
export function encodeNestedLineageId(parentId: string, recordId: string): string {
  return JSON.stringify([parentId, recordId]);
}

export interface FormulaVersionProcessDatasetExtractionInput {
  /** The exact formula version ids requested for extraction, in the order
   *  rows should be produced. Each is resolved against `formulationVersions`
   *  — a requested id absent from that pool fails closed rather than being
   *  silently skipped. */
  formulationVersionIds: string[];
  /** The pool of formula versions available to resolve `formulationVersionIds`
   *  against. Not all pool entries need be requested. */
  formulationVersions: FormulationVersion[];
  formulations: Formulation[];
  /** The pool of trials available to resolve each version's process plan
   *  and actual observations from. Only trials whose `sourceFormulaVersionId`
   *  exactly matches a requested version's id (and whose `sourceType` is
   *  `"saved_version"`) contribute to that version's row; every other
   *  supplied trial is legitimately irrelevant to that row and ignored. */
  trials: LaboratoryTrial[];
  /** The pool of persisted `process_parameters` (canonical Manufacturing
   *  Procedure) rows available to resolve each version's `plannedProcedure`
   *  from. Only rows whose own `(formulaCode, formulaVersion)` exactly
   *  matches a requested version's owning `Formulation.code`/
   *  `versionNumber` contribute to that version's row. Defaults to `[]` —
   *  every existing caller that never had this source keeps working. */
  processParameters?: ProcessParameter[];
}

export type FormulaVersionProcessDatasetExtractionErrorCode =
  | "formula_version_not_found"
  | "duplicate_formula_version_id"
  | "formulation_not_found"
  | "duplicate_formulation_id"
  | "duplicate_trial_id"
  | "trial_formula_link_conflict"
  | "duplicate_process_step_id"
  | "duplicate_trial_observation_id"
  | "duplicate_process_parameter_code"
  | "row_schema_validation_failed";

export class FormulaVersionProcessDatasetExtractionError extends Error {
  readonly code: FormulaVersionProcessDatasetExtractionErrorCode;
  readonly formulationVersionId: string;
  readonly trialId?: string;

  constructor(
    code: FormulaVersionProcessDatasetExtractionErrorCode,
    formulationVersionId: string,
    message: string,
    trialId?: string,
  ) {
    super(message);
    this.name = "FormulaVersionProcessDatasetExtractionError";
    this.code = code;
    this.formulationVersionId = formulationVersionId;
    this.trialId = trialId;
  }
}

/** Builds the exact-id formula version lookup, failing closed on a duplicate
 *  `FormulationVersion.id` rather than silently letting the last one win. */
function buildVersionsById(formulationVersions: FormulationVersion[]): Map<string, FormulationVersion> {
  const byId = new Map<string, FormulationVersion>();
  for (const version of formulationVersions) {
    if (byId.has(version.id)) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "duplicate_formula_version_id",
        version.id,
        `Ambiguous exact formula version identity: more than one supplied formulation version has id "${version.id}".`,
      );
    }
    byId.set(version.id, version);
  }
  return byId;
}

/** Builds the exact-id formula lookup, failing closed on a duplicate
 *  `Formulation.id` rather than silently letting the last one win. */
function buildFormulationsById(formulations: Formulation[]): Map<string, Formulation> {
  const byId = new Map<string, Formulation>();
  for (const formulation of formulations) {
    if (byId.has(formulation.id)) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "duplicate_formulation_id",
        formulation.id,
        `Ambiguous exact formulation identity: more than one supplied formulation has id "${formulation.id}".`,
      );
    }
    byId.set(formulation.id, formulation);
  }
  return byId;
}

/** Builds the exact-id trial lookup over the ENTIRE supplied pool, failing
 *  closed on a duplicate `LaboratoryTrial.id` — an ambiguous exact trial
 *  identity must never be resolved by guessing, even for a trial that turns
 *  out to be irrelevant to the versions actually requested. */
function buildTrialsById(trials: LaboratoryTrial[]): Map<string, LaboratoryTrial> {
  const byId = new Map<string, LaboratoryTrial>();
  for (const trial of trials) {
    if (byId.has(trial.id)) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "duplicate_trial_id",
        trial.id,
        `Ambiguous exact trial identity: more than one supplied laboratory trial has id "${trial.id}".`,
      );
    }
    byId.set(trial.id, trial);
  }
  return byId;
}

/** A step carries real actual-execution evidence when it moved past its
 *  default "planned, untouched" state — any actual field entered, any
 *  operator/observation/deviation note recorded, an explicit skip reason,
 *  a non-"planned" status, or `unplanned: true` (a step added mid-execution
 *  IS itself an actual-execution fact, even before any other field on it is
 *  filled in). Never a truthiness check — an explicit `"0"`/empty-but-set
 *  value must count exactly like any other entered value. */
function stepHasActualData(step: TrialProcessStep): boolean {
  return (
    step.status !== "planned" ||
    step.unplanned ||
    step.skipReason !== undefined ||
    step.actualStart !== undefined ||
    step.actualEnd !== undefined ||
    step.actualTemperatureC !== undefined ||
    step.actualMixingSpeedRpm !== undefined ||
    step.actualDurationMinutes !== undefined ||
    step.actualAdditionOrder !== undefined ||
    step.actualPh !== undefined ||
    step.actualViscosity !== undefined ||
    step.viscosityUnit !== undefined ||
    step.operator !== undefined ||
    step.observation !== undefined ||
    step.deviationNote !== undefined
  );
}

function byStepOrder(a: TrialProcessStep, b: TrialProcessStep): number {
  return a.stepNumber - b.stepNumber || a.id.localeCompare(b.id);
}

function byObservedOrder(a: TrialObservation, b: TrialObservation): number {
  return a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id);
}

function byTrialOrder(a: LaboratoryTrial, b: LaboratoryTrial): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function byProcessParameterOrder(a: ProcessParameter, b: ProcessParameter): number {
  return a.stepNumber - b.stepNumber || a.code.localeCompare(b.code);
}

/** Builds the exact-code process-parameter lookup over the ENTIRE supplied
 *  pool, failing closed on a duplicate `ProcessParameter.code` — the same
 *  fail-closed-on-ambiguous-identity convention every other pool builder in
 *  this extractor uses. */
function buildProcessParametersByCode(processParameters: ProcessParameter[]): Map<string, ProcessParameter> {
  const byCode = new Map<string, ProcessParameter>();
  for (const parameter of processParameters) {
    if (byCode.has(parameter.code)) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "duplicate_process_parameter_code",
        parameter.code,
        `Ambiguous exact process parameter identity: more than one supplied process parameter has code "${parameter.code}".`,
      );
    }
    byCode.set(parameter.code, parameter);
  }
  return byCode;
}

/** Resolves the version-level canonical Manufacturing Procedure: every
 *  `process_parameters` row whose own `(formulaCode, formulaVersion)`
 *  exactly matches this version's owning formula code and version number,
 *  ordered by `stepNumber` then `code`, independent of the supplied pool's
 *  order. Independent of trial linkage entirely. */
function resolvePlannedProcedure(
  version: FormulationVersion,
  formulation: Formulation,
  processParametersByCode: Map<string, ProcessParameter>,
): ProcessParameter[] {
  const matched: ProcessParameter[] = [];
  for (const parameter of processParametersByCode.values()) {
    if (parameter.formulaCode !== formulation.code || parameter.formulaVersion !== version.versionNumber) continue;
    matched.push(parameter);
  }
  return matched.sort(byProcessParameterOrder);
}

function toProcessStepPlan(step: TrialProcessStep): ProcessStepPlan {
  return {
    processStepId: step.id,
    stepNumber: step.stepNumber,
    phase: step.phase,
    plannedInstruction: step.plannedInstruction,
    requiredEquipment: step.requiredEquipment,
    plannedTemperatureMinC: step.plannedTemperatureMinC,
    plannedTemperatureMaxC: step.plannedTemperatureMaxC,
    plannedMixingSpeedMinRpm: step.plannedMixingSpeedMinRpm,
    plannedMixingSpeedMaxRpm: step.plannedMixingSpeedMaxRpm,
    plannedDurationMinutes: step.plannedDurationMinutes,
    plannedAdditionOrder: step.plannedAdditionOrder,
  };
}

function toProcessStepActualObservation(step: TrialProcessStep): ProcessStepActualObservation {
  return {
    processStepId: step.id,
    stepNumber: step.stepNumber,
    status: step.status,
    unplanned: step.unplanned,
    skipReason: step.skipReason,
    actualStart: step.actualStart,
    actualEnd: step.actualEnd,
    actualTemperatureC: step.actualTemperatureC,
    actualMixingSpeedRpm: step.actualMixingSpeedRpm,
    actualDurationMinutes: step.actualDurationMinutes,
    actualAdditionOrder: step.actualAdditionOrder,
    actualPh: step.actualPh,
    actualViscosity: step.actualViscosity,
    viscosityUnit: step.viscosityUnit,
    operator: step.operator,
    observation: step.observation,
    deviationNote: step.deviationNote,
  };
}

/** Resolves every trial linked to `version`, failing closed on a conflicting
 *  link (a trial whose `sourceFormulaVersionId` matches but whose
 *  `projectId` does not resolve to the version's own owning formulation) —
 *  never silently attributing or silently dropping it. Order is by
 *  `createdAt` then `id`, independent of the supplied pool's order. */
function resolveLinkedTrials(
  version: FormulationVersion,
  formulation: Formulation,
  trialsById: Map<string, LaboratoryTrial>,
): LaboratoryTrial[] {
  const linked: LaboratoryTrial[] = [];
  for (const trial of trialsById.values()) {
    if (trial.sourceType !== "saved_version" || trial.sourceFormulaVersionId !== version.id) continue;
    if (trial.projectId !== formulation.id) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "trial_formula_link_conflict",
        version.id,
        `Laboratory trial "${trial.id}" links to formula version "${version.id}" but its projectId "${trial.projectId}" does not match the version's owning formulation "${formulation.id}".`,
        trial.id,
      );
    }
    linked.push(trial);
  }
  return linked.sort(byTrialOrder);
}

/** Builds one `ProcessTrial` entry plus the exact source-record citations it
 *  contributes, failing closed on a duplicate process-step or observation
 *  identity within the same trial. */
function buildProcessTrial(
  trial: LaboratoryTrial,
  formulationVersionId: string,
): { entry: ProcessTrial; citations: SourceRecordReference[] } {
  const stepsById = new Map<string, TrialProcessStep>();
  for (const step of trial.processSteps) {
    if (stepsById.has(step.id)) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "duplicate_process_step_id",
        formulationVersionId,
        `Ambiguous exact process step identity: trial "${trial.id}" has more than one process step with id "${step.id}".`,
        trial.id,
      );
    }
    stepsById.set(step.id, step);
  }

  const observationsById = new Map<string, TrialObservation>();
  for (const observation of trial.observations) {
    if (observationsById.has(observation.id)) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "duplicate_trial_observation_id",
        formulationVersionId,
        `Ambiguous exact trial observation identity: trial "${trial.id}" has more than one observation with id "${observation.id}".`,
        trial.id,
      );
    }
    observationsById.set(observation.id, observation);
  }

  const plannedSteps = trial.processSteps.filter((step) => !step.unplanned).sort(byStepOrder);
  const actualSteps = trial.processSteps.filter(stepHasActualData).sort(byStepOrder);
  const sortedObservations = [...trial.observations].sort(byObservedOrder);

  const citations: SourceRecordReference[] = [{ sourceEntity: "laboratoryTrial", sourceRecordId: trial.id }];
  const citedStepIds = new Set<string>();
  for (const step of [...plannedSteps, ...actualSteps]) {
    if (citedStepIds.has(step.id)) continue;
    citedStepIds.add(step.id);
    // `TrialProcessStep.id` is embedded-array-scoped to its own trial, not
    // globally unique (see `schemas/laboratory.ts`'s header comment) — two
    // DIFFERENT steps on two different linked trials may legitimately share
    // the same `id`. `encodeNestedLineageId` keeps each physical record's
    // citation distinct, collision-safely, across every linked trial.
    citations.push({ sourceEntity: "trialProcessStep", sourceRecordId: encodeNestedLineageId(trial.id, step.id) });
  }
  for (const observation of sortedObservations) {
    citations.push({ sourceEntity: "trialObservation", sourceRecordId: encodeNestedLineageId(trial.id, observation.id) });
  }

  return {
    entry: {
      trialId: trial.id,
      trialCode: trial.code,
      plannedSteps: plannedSteps.map(toProcessStepPlan),
      actualStepObservations: actualSteps.map(toProcessStepActualObservation),
      observations: sortedObservations,
    },
    citations,
  };
}

function extractOne(
  version: FormulationVersion,
  formulationsById: Map<string, Formulation>,
  trialsById: Map<string, LaboratoryTrial>,
  processParametersByCode: Map<string, ProcessParameter>,
): FormulaVersionProcessRow {
  const formulation = formulationsById.get(version.formulationId);
  if (!formulation) {
    throw new FormulaVersionProcessDatasetExtractionError(
      "formulation_not_found",
      version.id,
      `FormulationVersion "${version.id}" references formulationId "${version.formulationId}", which was not found among the supplied formulations.`,
    );
  }

  const plannedProcedure = resolvePlannedProcedure(version, formulation, processParametersByCode);
  const linkedTrials = resolveLinkedTrials(version, formulation, trialsById);
  const sourceRecords: SourceRecordReference[] = [
    { sourceEntity: "formulation", sourceRecordId: formulation.id },
    { sourceEntity: "formulationVersion", sourceRecordId: version.id },
  ];
  for (const parameter of plannedProcedure) {
    sourceRecords.push({ sourceEntity: "processParameter", sourceRecordId: parameter.code });
  }
  const trials: ProcessTrial[] = [];
  for (const trial of linkedTrials) {
    const { entry, citations } = buildProcessTrial(trial, version.id);
    trials.push(entry);
    sourceRecords.push(...citations);
  }

  const row = {
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    sourceRecords,
    formulaId: formulation.id,
    formulaCode: formulation.code,
    formulaVersionId: version.id,
    formulaVersionNumber: version.versionNumber,
    plannedProcedure,
    trials,
  };

  const parsed = formulaVersionProcessRowSchema.safeParse(row);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new FormulaVersionProcessDatasetExtractionError(
      "row_schema_validation_failed",
      version.id,
      `Extracted row for formula version "${version.id}" failed schema validation: ${issues}`,
    );
  }
  return parsed.data;
}

/** Emits exactly one `FormulaVersionProcessRow` per requested formula
 *  version id, in the requested order. Throws (fails closed) on the first
 *  requested id, formula, trial pool, or trial/step/observation identity
 *  that cannot be resolved to an exact, unambiguous source record, or on the
 *  first constructed row that fails schema validation — it never silently
 *  drops or partially emits a row instead. */
export function extractFormulaVersionProcessRows(
  input: FormulaVersionProcessDatasetExtractionInput,
): FormulaVersionProcessRow[] {
  const formulationsById = buildFormulationsById(input.formulations);
  const versionsById = buildVersionsById(input.formulationVersions);
  const trialsById = buildTrialsById(input.trials);
  const processParametersByCode = buildProcessParametersByCode(input.processParameters ?? []);
  return input.formulationVersionIds.map((requestedId) => {
    const version = versionsById.get(requestedId);
    if (!version) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "formula_version_not_found",
        requestedId,
        `Requested formula version id "${requestedId}" was not found among the supplied formulation versions.`,
      );
    }
    return extractOne(version, formulationsById, trialsById, processParametersByCode);
  });
}
