/**
 * FVL-05.004 — the extractor: turns a persisted `FormulationVersion`'s
 * linked `LaboratoryTrial` records AND the version's own canonical
 * `process_parameters` Manufacturing Procedure rows into
 * `FormulaVersionProcessRow` dataset rows for the future Historical
 * Experiment Dataset Builder.
 *
 * See `schemas/dataset.ts`'s header comment on `formulaVersionProcessRowSchema`
 * for the full Manufacturing Procedure source resolution and the
 * 2026-08-23 independent-audit reopen findings (A-J). Summary of what
 * changed in this file for that reopen:
 *
 * - FINDING B: `buildProcessParametersByNaturalKey` fails closed when two
 *   supplied `process_parameters` rows share the authoritative
 *   `(formulaCode, formulaVersion, stepNumber)` natural key with different
 *   `code`s — the real commit path derives `code` FROM that natural key
 *   (`dataExchangeCommit.ts`'s `commitProcessParameters`:
 *   `` `${formula_code}-v${formula_version}-step${step_number}` ``), so
 *   this can only happen via a non-conforming supplied pool, never a
 *   legitimately committed one — but this extractor must not trust that.
 * - FINDING C: nested trial-scoped lineage citations now use the additive
 *   `parentRecordId` field on `sourceRecordReferenceSchema` instead of a
 *   synthesized `sourceRecordId` — `sourceRecordId` stays the exact,
 *   unmodified persisted child id (see `schemas/dataset.ts`).
 * - FINDING D: `buildTrialsById` fails closed on a `"saved_version"` trial
 *   with a missing/blank `sourceFormulaVersionId`.
 * - FINDING E: `buildProcessTrial` fails closed on a `TrialObservation`
 *   whose `processStepId` does not resolve to a step in the same trial.
 * - FINDING F: `attachments` now flow into `actualStepObservations`;
 *   `stepHasActualData` treats a non-empty `attachments` array as
 *   actual-execution evidence.
 * - FINDING H: `buildFormulationsById` also fails closed when two
 *   different formulation ids in the supplied pool share the same `code`
 *   (`Formulation.code` is not enforced globally unique by
 *   `formulations.rs`'s `save_formulation`).
 * - FINDING I: all opaque-id/code comparisons use `compareOrdinal`
 *   (UTF-16 code-unit order — deterministic, not locale/ICU-dependent)
 *   instead of `localeCompare`; `trial.createdAt`/`observation.observedAt`
 *   are validated as canonical `Date.prototype.toISOString()`-format
 *   timestamps before being used as a chronological sort key, failing
 *   closed on a non-conforming value rather than silently lexically
 *   mis-ordering history.
 * - FINDING J: `FormulaVersionProcessDatasetExtractionError` now carries a
 *   `context` object with correctly-named optional identity fields
 *   instead of overloading a single `formulationVersionId` property with
 *   values that were not actually a formula-version id (e.g. a
 *   formulation id, a trial id, a process-parameter code).
 *
 * A trial is "linked" to the requested formula version only when
 * `sourceType === "saved_version"` AND `sourceFormulaVersionId` exactly
 * matches the requested version's id; a linked trial whose `projectId`
 * does not match the version's owning `Formulation.id` is a conflicting
 * link, not a usable one, and fails closed rather than being silently
 * attributed or silently dropped.
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

/** FINDING I: locale/ICU-independent ordinal comparison for opaque ids and
 *  codes. `String.prototype.localeCompare` is collation-aware — its result
 *  can vary by locale/ICU version/environment, which is not an acceptable
 *  property for a "deterministic ordering" guarantee. `<`/`>` on strings
 *  compares UTF-16 code units directly, with no locale involvement. */
function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** FINDING I: validates that `value` is EXACTLY the canonical
 *  `Date.prototype.toISOString()` format (`YYYY-MM-DDTHH:mm:ss.sssZ`,
 *  fixed-width, zero-padded, UTC) — the app-wide timestamp-writer
 *  convention (`masterdata.ts`'s `nowIso()` is a bare `toISOString()`
 *  call), but NOT a constraint the canonical `laboratoryTrialSchema`/
 *  `trialObservationSchema` (`createdAt`/`observedAt`: bare `z.string()`)
 *  actually enforces. Lexical/ordinal comparison of this exact format IS
 *  chronological order; a round-trip check (`new Date(value).toISOString()
 *  === value`) is a robust way to confirm a string genuinely has that
 *  shape, since any deviation in padding/precision/timezone fails to
 *  round-trip identically. */
function isCanonicalIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
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
  | "duplicate_formulation_code"
  | "duplicate_trial_id"
  | "invalid_saved_version_trial_link"
  | "trial_formula_link_conflict"
  | "duplicate_process_step_id"
  | "duplicate_trial_observation_id"
  | "dangling_observation_process_step_id"
  | "duplicate_process_parameter_code"
  | "duplicate_process_parameter_natural_key"
  | "invalid_timestamp_format"
  | "row_schema_validation_failed";

/** FINDING J: truthful, correctly-named structured error context — never a
 *  single overloaded `formulationVersionId` field holding whatever identity
 *  happened to be at hand. Every field is optional; only the ones that are
 *  actually true of a given failure are set. */
export interface FormulaVersionProcessDatasetExtractionErrorContext {
  formulaVersionId?: string;
  formulationId?: string;
  formulaCode?: string;
  trialId?: string;
  processStepId?: string;
  trialObservationId?: string;
  processParameterCode?: string;
}

export class FormulaVersionProcessDatasetExtractionError extends Error {
  readonly code: FormulaVersionProcessDatasetExtractionErrorCode;
  readonly formulaVersionId?: string;
  readonly formulationId?: string;
  readonly formulaCode?: string;
  readonly trialId?: string;
  readonly processStepId?: string;
  readonly trialObservationId?: string;
  readonly processParameterCode?: string;

  constructor(
    code: FormulaVersionProcessDatasetExtractionErrorCode,
    message: string,
    context: FormulaVersionProcessDatasetExtractionErrorContext = {},
  ) {
    super(message);
    this.name = "FormulaVersionProcessDatasetExtractionError";
    this.code = code;
    this.formulaVersionId = context.formulaVersionId;
    this.formulationId = context.formulationId;
    this.formulaCode = context.formulaCode;
    this.trialId = context.trialId;
    this.processStepId = context.processStepId;
    this.trialObservationId = context.trialObservationId;
    this.processParameterCode = context.processParameterCode;
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
        `Ambiguous exact formula version identity: more than one supplied formulation version has id "${version.id}".`,
        { formulaVersionId: version.id },
      );
    }
    byId.set(version.id, version);
  }
  return byId;
}

/** Builds the exact-id formula lookup, failing closed on a duplicate
 *  `Formulation.id` (never silently letting the last one win) AND on a
 *  duplicate `Formulation.code` across two different ids (FINDING H:
 *  `code` is not enforced globally unique by `formulations.rs`'s
 *  `save_formulation`, which keys storage by `id` only — a code collision
 *  makes the `process_parameters` plan-key namespace genuinely ambiguous,
 *  so it must fail closed here rather than silently picking one). */
function buildFormulationsById(formulations: Formulation[]): Map<string, Formulation> {
  const byId = new Map<string, Formulation>();
  const idByCode = new Map<string, string>();
  for (const formulation of formulations) {
    if (byId.has(formulation.id)) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "duplicate_formulation_id",
        `Ambiguous exact formulation identity: more than one supplied formulation has id "${formulation.id}".`,
        { formulationId: formulation.id },
      );
    }
    const priorIdForCode = idByCode.get(formulation.code);
    if (priorIdForCode !== undefined && priorIdForCode !== formulation.id) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "duplicate_formulation_code",
        `Ambiguous formula-code namespace: formulations "${priorIdForCode}" and "${formulation.id}" both use code "${formulation.code}".`,
        { formulationId: formulation.id, formulaCode: formulation.code },
      );
    }
    idByCode.set(formulation.code, formulation.id);
    byId.set(formulation.id, formulation);
  }
  return byId;
}

/** Builds the exact-id trial lookup over the ENTIRE supplied pool, failing
 *  closed on a duplicate `LaboratoryTrial.id` — an ambiguous exact trial
 *  identity must never be resolved by guessing, even for a trial that turns
 *  out to be irrelevant to the versions actually requested. FINDING D: also
 *  fails closed, pool-wide, on a `"saved_version"` trial with a missing or
 *  blank `sourceFormulaVersionId` — `schemas/laboratory.ts` documents this
 *  as required (comment only, not Zod-enforced); silently treating such a
 *  trial as merely "not linked to any requested version" would hide a real
 *  data-integrity problem instead of surfacing it. */
function buildTrialsById(trials: LaboratoryTrial[]): Map<string, LaboratoryTrial> {
  const byId = new Map<string, LaboratoryTrial>();
  for (const trial of trials) {
    if (byId.has(trial.id)) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "duplicate_trial_id",
        `Ambiguous exact trial identity: more than one supplied laboratory trial has id "${trial.id}".`,
        { trialId: trial.id },
      );
    }
    if (trial.sourceType === "saved_version" && (trial.sourceFormulaVersionId === undefined || trial.sourceFormulaVersionId.trim() === "")) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "invalid_saved_version_trial_link",
        `Laboratory trial "${trial.id}" has sourceType "saved_version" but no (or a blank) sourceFormulaVersionId — this is a contradictory, malformed saved-version link.`,
        { trialId: trial.id },
      );
    }
    if (!isCanonicalIsoTimestamp(trial.createdAt)) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "invalid_timestamp_format",
        `Laboratory trial "${trial.id}" has a createdAt value ("${trial.createdAt}") that is not the canonical toISOString() format this extractor relies on for chronological ordering.`,
        { trialId: trial.id },
      );
    }
    byId.set(trial.id, trial);
  }
  return byId;
}

/** A step carries real actual-execution evidence when it moved past its
 *  default "planned, untouched" state — any actual field entered, any
 *  operator/observation/deviation note recorded, an explicit skip reason,
 *  a non-"planned" status, an attachment (FINDING F), or `unplanned: true`
 *  (a step added mid-execution IS itself an actual-execution fact, even
 *  before any other field on it is filled in). Never a truthiness check —
 *  an explicit `"0"`/empty-but-set value must count exactly like any other
 *  entered value. */
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
    step.deviationNote !== undefined ||
    step.attachments.length > 0
  );
}

function byStepOrder(a: TrialProcessStep, b: TrialProcessStep): number {
  return a.stepNumber - b.stepNumber || compareOrdinal(a.id, b.id);
}

function byObservedOrder(a: TrialObservation, b: TrialObservation): number {
  return compareOrdinal(a.observedAt, b.observedAt) || compareOrdinal(a.id, b.id);
}

function byTrialOrder(a: LaboratoryTrial, b: LaboratoryTrial): number {
  return compareOrdinal(a.createdAt, b.createdAt) || compareOrdinal(a.id, b.id);
}

function byProcessParameterOrder(a: ProcessParameter, b: ProcessParameter): number {
  return a.stepNumber - b.stepNumber || compareOrdinal(a.code, b.code);
}

/** FINDING B: the authoritative natural-key encoding for a `process_parameters`
 *  row, per the Data Exchange registry's own documented natural key
 *  `(formula_code, formula_version, step_number)`. `JSON.stringify` over the
 *  tuple, the same collision-safe-structural-encoding principle used
 *  elsewhere in this file's history — `formulaCode` is an arbitrary string
 *  that could itself contain any delimiter, so a fixed-delimiter join is
 *  not safe here either. */
function encodeProcessParameterNaturalKey(formulaCode: string, formulaVersion: number, stepNumber: number): string {
  return JSON.stringify([formulaCode, formulaVersion, stepNumber]);
}

/** Builds the exact-code process-parameter lookup over the ENTIRE supplied
 *  pool, failing closed on a duplicate `ProcessParameter.code` (the same
 *  fail-closed-on-ambiguous-identity convention every other pool builder in
 *  this extractor uses) AND on a duplicate AUTHORITATIVE natural key
 *  `(formulaCode, formulaVersion, stepNumber)` across two different codes
 *  (FINDING B) — the real commit path derives `code` FROM that natural key,
 *  so two legitimately committed rows can never collide on the natural key
 *  with different codes; a supplied pool that does so is non-conforming
 *  and must not silently produce two "authoritative" process steps for the
 *  same step number. */
function buildProcessParametersByCode(processParameters: ProcessParameter[]): Map<string, ProcessParameter> {
  const byCode = new Map<string, ProcessParameter>();
  const codeByNaturalKey = new Map<string, string>();
  for (const parameter of processParameters) {
    if (byCode.has(parameter.code)) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "duplicate_process_parameter_code",
        `Ambiguous exact process parameter identity: more than one supplied process parameter has code "${parameter.code}".`,
        { processParameterCode: parameter.code },
      );
    }
    const naturalKey = encodeProcessParameterNaturalKey(parameter.formulaCode, parameter.formulaVersion, parameter.stepNumber);
    const priorCodeForNaturalKey = codeByNaturalKey.get(naturalKey);
    if (priorCodeForNaturalKey !== undefined && priorCodeForNaturalKey !== parameter.code) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "duplicate_process_parameter_natural_key",
        `Ambiguous process step identity: process parameters "${priorCodeForNaturalKey}" and "${parameter.code}" both claim natural key (formulaCode="${parameter.formulaCode}", formulaVersion=${parameter.formulaVersion}, stepNumber=${parameter.stepNumber}) — the registry's authoritative natural key must resolve to exactly one record.`,
        { processParameterCode: parameter.code, formulaCode: parameter.formulaCode },
      );
    }
    codeByNaturalKey.set(naturalKey, parameter.code);
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
    attachments: step.attachments,
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
        `Laboratory trial "${trial.id}" links to formula version "${version.id}" but its projectId "${trial.projectId}" does not match the version's owning formulation "${formulation.id}".`,
        { formulaVersionId: version.id, trialId: trial.id },
      );
    }
    linked.push(trial);
  }
  return linked.sort(byTrialOrder);
}

/** Builds one `ProcessTrial` entry plus the exact source-record citations it
 *  contributes, failing closed on a duplicate process-step or observation
 *  identity within the same trial, on an observation's dangling
 *  `processStepId` (FINDING E), and on a non-canonical `observedAt`
 *  timestamp (FINDING I). */
function buildProcessTrial(trial: LaboratoryTrial): { entry: ProcessTrial; citations: SourceRecordReference[] } {
  const stepsById = new Map<string, TrialProcessStep>();
  for (const step of trial.processSteps) {
    if (stepsById.has(step.id)) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "duplicate_process_step_id",
        `Ambiguous exact process step identity: trial "${trial.id}" has more than one process step with id "${step.id}".`,
        { trialId: trial.id, processStepId: step.id },
      );
    }
    stepsById.set(step.id, step);
  }

  const observationsById = new Map<string, TrialObservation>();
  for (const observation of trial.observations) {
    if (observationsById.has(observation.id)) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "duplicate_trial_observation_id",
        `Ambiguous exact trial observation identity: trial "${trial.id}" has more than one observation with id "${observation.id}".`,
        { trialId: trial.id, trialObservationId: observation.id },
      );
    }
    observationsById.set(observation.id, observation);
    if (observation.processStepId !== undefined && !stepsById.has(observation.processStepId)) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "dangling_observation_process_step_id",
        `Trial observation "${observation.id}" in trial "${trial.id}" references processStepId "${observation.processStepId}", which does not exist among that trial's own process steps.`,
        { trialId: trial.id, trialObservationId: observation.id, processStepId: observation.processStepId },
      );
    }
    if (!isCanonicalIsoTimestamp(observation.observedAt)) {
      throw new FormulaVersionProcessDatasetExtractionError(
        "invalid_timestamp_format",
        `Trial observation "${observation.id}" in trial "${trial.id}" has an observedAt value ("${observation.observedAt}") that is not the canonical toISOString() format this extractor relies on for chronological ordering.`,
        { trialId: trial.id, trialObservationId: observation.id },
      );
    }
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
    // the same `id`. FINDING C: `sourceRecordId` stays the exact,
    // unmodified persisted step id; `parentRecordId` (the owning trial's
    // globally-unique id) is what keeps each physical record's citation
    // distinct across every linked trial — never folded into one string.
    citations.push({ sourceEntity: "trialProcessStep", sourceRecordId: step.id, parentRecordId: trial.id });
  }
  for (const observation of sortedObservations) {
    citations.push({ sourceEntity: "trialObservation", sourceRecordId: observation.id, parentRecordId: trial.id });
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
      `FormulationVersion "${version.id}" references formulationId "${version.formulationId}", which was not found among the supplied formulations.`,
      { formulaVersionId: version.id, formulationId: version.formulationId },
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
    const { entry, citations } = buildProcessTrial(trial);
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
      `Extracted row for formula version "${version.id}" failed schema validation: ${issues}`,
      { formulaVersionId: version.id },
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
        `Requested formula version id "${requestedId}" was not found among the supplied formulation versions.`,
        { formulaVersionId: requestedId },
      );
    }
    return extractOne(version, formulationsById, trialsById, processParametersByCode);
  });
}
