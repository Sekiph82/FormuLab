/**
 * FVL-05.008 — the extractor: turns a persisted `FormulationVersion`'s
 * linked `CorrectiveAction` records, `CostSnapshot` records, and
 * (via linked `StabilityStudy` records) frozen `PackagingSystemSnapshot`
 * context into `FormulaVersionCorrectiveCostContextRow` dataset rows for
 * the future Historical Experiment Dataset Builder.
 *
 * See `schemas/dataset.ts`'s header comment on
 * `formulaVersionCorrectiveCostContextRowSchema` for the full recovered
 * source contract: `CorrectiveAction.sourceRecordId` is, per its own
 * schema comment, always "the trial or stability study id this action
 * belongs to" — resolved against the union of the supplied
 * `laboratoryTrials`/`stabilityStudies` pools regardless of `sourceType`
 * label (only `trial_deviation` and `stability_failure` have real writer
 * evidence; `trial_failure`/`manual` are unused enum values with no
 * different resolution rule invented for them); `CostSnapshot` links to a
 * formula version DIRECTLY via its own `formulationId`/`versionId`
 * fields, and has no separate `id` — `code` is its exact identity;
 * `StabilityStudy.packagingSnapshot` (resolved the same way FVL-05.006's
 * study-linkage already works) is the one genuinely historical
 * (capture-once) packaging record in the repository, extracted here
 * because FVL-05.006 deliberately did not embed it. Environmental/test
 * conditions are independently confirmed already fully represented by
 * prior FVL-05.005/.006/.007 rows and are deliberately NOT duplicated
 * here.
 *
 * Pure and deterministic: no persistence, no mutation of its inputs, no
 * generated ids/timestamps. Corrective actions are ordered by `createdAt`
 * then `id`; cost snapshots by `calculatedAt` then `code`; packaging
 * context entries by the owning study's `createdAt` then `id`. Every
 * chronology-key timestamp is validated as canonical `toISOString()`
 * format before being used as a sort key, failing closed on a
 * non-conforming value — the same discipline every prior FVL-05
 * extractor established. Opaque-id tie-breakers use locale-independent
 * ordinal comparison, never `localeCompare`.
 *
 * Every constructed row is validated against
 * `formulaVersionCorrectiveCostContextRowSchema` before it is returned —
 * fails closed on a malformed row, and guarantees (via zod's
 * always-rebuilding parse) that the returned row shares no mutable
 * array/object with the source records it was built from.
 *
 * CORRECTIVE CYCLE (`AUDIT_FVL05_GPT_000011`): `CorrectiveAction.
 * sourceRecordId` resolution now checks BOTH the `laboratoryTrials` and
 * `stabilityStudies` pools before choosing a target, rather than
 * accepting the first (trial) match and only falling back to the study
 * pool when no trial matched. `LaboratoryTrial.id` and `StabilityStudy.
 * id` are opaque global identifiers in two SEPARATE top-level
 * collections — nothing in the FVL-05 lineage/extractor contract
 * establishes a cross-collection uniqueness guarantee between them, so a
 * supplied pool can legitimately contain a trial and a study sharing the
 * same exact id string. Order-of-lookup precedence (silently preferring
 * "trial" because it happened to be checked first) is not an exact,
 * unambiguous resolution — it now fails closed
 * (`corrective_action_source_record_ambiguous`) when a `sourceRecordId`
 * resolves in BOTH pools simultaneously. `sourceType` is deliberately
 * still NOT used as a tie-breaking discriminator: the original FVL-05.008
 * source recovery concluded `sourceRecordId` resolution is unconditional
 * on `sourceType` (no writer evidence ties a specific `sourceType` value
 * to exactly one target namespace), and no new source evidence in this
 * corrective cycle disproves that — inventing a `sourceType`-based
 * disambiguation rule now would be exactly the "paper over the ambiguity"
 * the governing audit explicitly forbade.
 */
import type { CorrectiveAction } from "../schemas/correctiveActions";
import type { CostSnapshot } from "../schemas/costing";
import type { Formulation, FormulationVersion } from "../schemas/formulation";
import type { LaboratoryTrial } from "../schemas/laboratory";
import type { StabilityStudy } from "../schemas/stability";
import {
  DATASET_SCHEMA_VERSION,
  formulaVersionCorrectiveCostContextRowSchema,
  type FormulaVersionCorrectiveCostContextRow,
  type SourceRecordReference,
  type StabilityStudyPackagingContext,
} from "../schemas/dataset";

/** Locale/ICU-independent ordinal comparison for opaque ids — see
 *  `formulaVersionProcessDatasetExtractor.ts`'s identical helper for the
 *  full rationale. */
function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Validates that `value` is EXACTLY the canonical
 *  `Date.prototype.toISOString()` format — see
 *  `formulaVersionProcessDatasetExtractor.ts`'s identical helper for the
 *  full rationale. */
function isCanonicalIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export interface FormulaVersionCorrectiveCostContextDatasetExtractionInput {
  /** The exact formula version ids requested for extraction, in the order
   *  rows should be produced. Each is resolved against `formulationVersions`
   *  — a requested id absent from that pool fails closed rather than being
   *  silently skipped. */
  formulationVersionIds: string[];
  formulationVersions: FormulationVersion[];
  formulations: Formulation[];
  /** The pool of persisted corrective actions. Every action's
   *  `sourceRecordId` must resolve to a record in `laboratoryTrials` or
   *  `stabilityStudies` below (pool-wide, regardless of relevance to any
   *  requested version) or the whole extraction fails closed. */
  correctiveActions: CorrectiveAction[];
  /** Resolution-only pool for `CorrectiveAction.sourceRecordId` — never
   *  embedded in the row (out of this task's own title scope). */
  laboratoryTrials: LaboratoryTrial[];
  /** Resolution pool for `CorrectiveAction.sourceRecordId` AND the source
   *  of this row's packaging/context (`StabilityStudy.packagingSnapshot`). */
  stabilityStudies: StabilityStudy[];
  /** The pool of persisted, immutable cost snapshots. */
  costSnapshots: CostSnapshot[];
}

export type FormulaVersionCorrectiveCostContextDatasetExtractionErrorCode =
  | "formula_version_not_found"
  | "duplicate_formula_version_id"
  | "formulation_not_found"
  | "duplicate_formulation_id"
  | "duplicate_laboratory_trial_id"
  | "duplicate_stability_study_id"
  | "laboratory_trial_formula_link_conflict"
  | "stability_study_formula_link_conflict"
  | "duplicate_corrective_action_id"
  | "corrective_action_source_record_not_found"
  | "corrective_action_source_record_ambiguous"
  | "corrective_action_formula_link_conflict"
  | "duplicate_cost_snapshot_code"
  | "cost_snapshot_formula_link_conflict"
  | "invalid_timestamp_format"
  | "row_schema_validation_failed";

/** Truthful, correctly-named structured error context — never a single
 *  overloaded field holding whatever identity happened to be at hand
 *  (the FVL-05.004 `AUDIT_FVL05_GPT_000001` finding J shape, reused). */
export interface FormulaVersionCorrectiveCostContextDatasetExtractionErrorContext {
  formulaVersionId?: string;
  formulationId?: string;
  trialId?: string;
  studyId?: string;
  actionId?: string;
  costSnapshotCode?: string;
}

export class FormulaVersionCorrectiveCostContextDatasetExtractionError extends Error {
  readonly code: FormulaVersionCorrectiveCostContextDatasetExtractionErrorCode;
  readonly formulaVersionId?: string;
  readonly formulationId?: string;
  readonly trialId?: string;
  readonly studyId?: string;
  readonly actionId?: string;
  readonly costSnapshotCode?: string;

  constructor(
    code: FormulaVersionCorrectiveCostContextDatasetExtractionErrorCode,
    message: string,
    context: FormulaVersionCorrectiveCostContextDatasetExtractionErrorContext = {},
  ) {
    super(message);
    this.name = "FormulaVersionCorrectiveCostContextDatasetExtractionError";
    this.code = code;
    this.formulaVersionId = context.formulaVersionId;
    this.formulationId = context.formulationId;
    this.trialId = context.trialId;
    this.studyId = context.studyId;
    this.actionId = context.actionId;
    this.costSnapshotCode = context.costSnapshotCode;
  }
}

/** Builds the exact-id formula version lookup, failing closed on a duplicate
 *  `FormulationVersion.id` rather than silently letting the last one win. */
function buildVersionsById(formulationVersions: FormulationVersion[]): Map<string, FormulationVersion> {
  const byId = new Map<string, FormulationVersion>();
  for (const version of formulationVersions) {
    if (byId.has(version.id)) {
      throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
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
 *  `Formulation.id` rather than silently letting the last one win. */
function buildFormulationsById(formulations: Formulation[]): Map<string, Formulation> {
  const byId = new Map<string, Formulation>();
  for (const formulation of formulations) {
    if (byId.has(formulation.id)) {
      throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
        "duplicate_formulation_id",
        `Ambiguous exact formulation identity: more than one supplied formulation has id "${formulation.id}".`,
        { formulationId: formulation.id },
      );
    }
    byId.set(formulation.id, formulation);
  }
  return byId;
}

/** Builds the exact-id trial lookup, failing closed on a duplicate
 *  `LaboratoryTrial.id`. Resolution-only — `LaboratoryTrial` is never
 *  embedded in the row. */
function buildTrialsById(trials: LaboratoryTrial[]): Map<string, LaboratoryTrial> {
  const byId = new Map<string, LaboratoryTrial>();
  for (const trial of trials) {
    if (byId.has(trial.id)) {
      throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
        "duplicate_laboratory_trial_id",
        `Ambiguous exact laboratory trial identity: more than one supplied trial has id "${trial.id}".`,
        { trialId: trial.id },
      );
    }
    byId.set(trial.id, trial);
  }
  return byId;
}

/** Builds the exact-id stability study lookup, failing closed on a
 *  duplicate `StabilityStudy.id` and a non-canonical `createdAt` (needed
 *  for deterministic packaging-context ordering). */
function buildStudiesById(studies: StabilityStudy[]): Map<string, StabilityStudy> {
  const byId = new Map<string, StabilityStudy>();
  for (const study of studies) {
    if (byId.has(study.id)) {
      throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
        "duplicate_stability_study_id",
        `Ambiguous exact stability study identity: more than one supplied study has id "${study.id}".`,
        { studyId: study.id },
      );
    }
    if (!isCanonicalIsoTimestamp(study.createdAt)) {
      throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
        "invalid_timestamp_format",
        `Stability study "${study.id}" has a createdAt value ("${study.createdAt}") that is not the canonical toISOString() format this extractor relies on for chronological ordering.`,
        { studyId: study.id },
      );
    }
    byId.set(study.id, study);
  }
  return byId;
}

type CorrectiveActionResolution = { kind: "trial"; record: LaboratoryTrial } | { kind: "study"; record: StabilityStudy };

/** Builds the exact-id corrective-action lookup over the ENTIRE supplied
 *  pool, failing closed on a duplicate `CorrectiveAction.id`, a
 *  non-canonical `createdAt`, a `sourceRecordId` that resolves to NEITHER
 *  the supplied `laboratoryTrials` nor `stabilityStudies` pool, and —
 *  corrective-cycle addition (`AUDIT_FVL05_GPT_000011`) — a
 *  `sourceRecordId` that resolves in BOTH pools simultaneously (a
 *  genuine cross-collection id collision; `LaboratoryTrial.id`/
 *  `StabilityStudy.id` have no shared-uniqueness guarantee, so this must
 *  be checked explicitly rather than accepting whichever pool happens to
 *  be looked up first). Per `CorrectiveAction.sourceRecordId`'s own
 *  unconditional schema comment ("the trial or stability study id this
 *  action belongs to"), this resolution is attempted regardless of
 *  `sourceType` — `sourceType` is NOT used to break a collision, since no
 *  writer evidence proves it selects a target namespace. Returns the
 *  resolution alongside each action so the per-version filter never
 *  re-scans both pools. */
function buildActionResolutions(
  actions: CorrectiveAction[],
  trialsById: Map<string, LaboratoryTrial>,
  studiesById: Map<string, StabilityStudy>,
): Map<string, CorrectiveActionResolution> {
  const seen = new Set<string>();
  const resolutions = new Map<string, CorrectiveActionResolution>();
  for (const action of actions) {
    if (seen.has(action.id)) {
      throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
        "duplicate_corrective_action_id",
        `Ambiguous exact corrective action identity: more than one supplied action has id "${action.id}".`,
        { actionId: action.id },
      );
    }
    seen.add(action.id);
    if (!isCanonicalIsoTimestamp(action.createdAt)) {
      throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
        "invalid_timestamp_format",
        `Corrective action "${action.id}" has a createdAt value ("${action.createdAt}") that is not the canonical toISOString() format this extractor relies on for chronological ordering.`,
        { actionId: action.id },
      );
    }
    const trial = trialsById.get(action.sourceRecordId);
    const study = studiesById.get(action.sourceRecordId);
    if (trial && study) {
      throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
        "corrective_action_source_record_ambiguous",
        `Corrective action "${action.id}" references sourceRecordId "${action.sourceRecordId}", which exists in BOTH the supplied laboratory trials and stability studies pools — resolution would be order-of-lookup precedence, not exact and unambiguous.`,
        { actionId: action.id },
      );
    }
    if (trial) {
      resolutions.set(action.id, { kind: "trial", record: trial });
      continue;
    }
    if (study) {
      resolutions.set(action.id, { kind: "study", record: study });
      continue;
    }
    throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
      "corrective_action_source_record_not_found",
      `Corrective action "${action.id}" references sourceRecordId "${action.sourceRecordId}", which was not found among the supplied laboratory trials or stability studies.`,
      { actionId: action.id },
    );
  }
  return resolutions;
}

/** Builds the exact-code cost-snapshot lookup, failing closed on a
 *  duplicate `CostSnapshot.code` (its only identity — no separate `id`
 *  field exists) and a non-canonical `calculatedAt`. */
function buildSnapshotsByCode(snapshots: CostSnapshot[]): Map<string, CostSnapshot> {
  const byCode = new Map<string, CostSnapshot>();
  for (const snapshot of snapshots) {
    if (byCode.has(snapshot.code)) {
      throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
        "duplicate_cost_snapshot_code",
        `Ambiguous exact cost snapshot identity: more than one supplied snapshot has code "${snapshot.code}".`,
        { costSnapshotCode: snapshot.code },
      );
    }
    if (!isCanonicalIsoTimestamp(snapshot.calculatedAt)) {
      throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
        "invalid_timestamp_format",
        `Cost snapshot "${snapshot.code}" has a calculatedAt value ("${snapshot.calculatedAt}") that is not the canonical toISOString() format this extractor relies on for chronological ordering.`,
        { costSnapshotCode: snapshot.code },
      );
    }
    byCode.set(snapshot.code, snapshot);
  }
  return byCode;
}

/** Resolves every `LaboratoryTrial` linked to `version` (exact same
 *  `sourceType === "saved_version"` + `sourceFormulaVersionId` rule
 *  FVL-05.004/.005 established), failing closed on a conflicting link
 *  (`projectId` not resolving to the version's owning formulation). */
function resolveLinkedTrials(
  version: FormulationVersion,
  formulation: Formulation,
  trialsById: Map<string, LaboratoryTrial>,
): Set<string> {
  const linked = new Set<string>();
  for (const trial of trialsById.values()) {
    if (trial.sourceType !== "saved_version" || trial.sourceFormulaVersionId !== version.id) continue;
    if (trial.projectId !== formulation.id) {
      throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
        "laboratory_trial_formula_link_conflict",
        `Laboratory trial "${trial.id}" links to formula version "${version.id}" but its projectId "${trial.projectId}" does not match the version's owning formulation "${formulation.id}".`,
        { formulaVersionId: version.id, trialId: trial.id },
      );
    }
    linked.add(trial.id);
  }
  return linked;
}

/** Resolves every `StabilityStudy` linked to `version` (exact same rule
 *  FVL-05.006 established), failing closed on a conflicting link, and
 *  returns them sorted by `createdAt` then `id` (the packaging-context
 *  domain order). */
function resolveLinkedStudies(
  version: FormulationVersion,
  formulation: Formulation,
  studiesById: Map<string, StabilityStudy>,
): StabilityStudy[] {
  const linked: StabilityStudy[] = [];
  for (const study of studiesById.values()) {
    if (study.sourceType !== "saved_version" || study.sourceFormulaVersionId !== version.id) continue;
    if (study.projectId !== formulation.id) {
      throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
        "stability_study_formula_link_conflict",
        `Stability study "${study.id}" links to formula version "${version.id}" but its projectId "${study.projectId}" does not match the version's owning formulation "${formulation.id}".`,
        { formulaVersionId: version.id, studyId: study.id },
      );
    }
    linked.push(study);
  }
  return linked.sort((a, b) => compareOrdinal(a.createdAt, b.createdAt) || compareOrdinal(a.id, b.id));
}

function extractOne(
  version: FormulationVersion,
  formulationsById: Map<string, Formulation>,
  trialsById: Map<string, LaboratoryTrial>,
  studiesById: Map<string, StabilityStudy>,
  actionResolutions: Map<string, CorrectiveActionResolution>,
  correctiveActions: CorrectiveAction[],
  costSnapshots: CostSnapshot[],
): FormulaVersionCorrectiveCostContextRow {
  const formulation = formulationsById.get(version.formulationId);
  if (!formulation) {
    throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
      "formulation_not_found",
      `FormulationVersion "${version.id}" references formulationId "${version.formulationId}", which was not found among the supplied formulations.`,
      { formulaVersionId: version.id, formulationId: version.formulationId },
    );
  }

  const sourceRecords: SourceRecordReference[] = [
    { sourceEntity: "formulation", sourceRecordId: formulation.id },
    { sourceEntity: "formulationVersion", sourceRecordId: version.id },
  ];

  const linkedTrialIds = resolveLinkedTrials(version, formulation, trialsById);
  const linkedStudies = resolveLinkedStudies(version, formulation, studiesById);
  const linkedStudyIds = new Set(linkedStudies.map((study) => study.id));

  /** A trial/study resolved by more than one corrective action, or also
   *  contributing packaging context below, must be cited exactly once at
   *  the row level — `sourceRecordLineageSchema` rejects an exact
   *  duplicate `(sourceEntity, sourceRecordId)` pair, the same dedup
   *  discipline FVL-05.006 established for shared condition/time-point
   *  citations. */
  const citedTrialIds = new Set<string>();
  const citedStudyIds = new Set<string>();

  const linkedActions: CorrectiveAction[] = [];
  for (const action of correctiveActions) {
    const resolution = actionResolutions.get(action.id)!;
    const isLinked = resolution.kind === "trial" ? linkedTrialIds.has(resolution.record.id) : linkedStudyIds.has(resolution.record.id);
    if (!isLinked) continue;
    if (action.projectId !== formulation.id) {
      throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
        "corrective_action_formula_link_conflict",
        `Corrective action "${action.id}" resolves to a ${resolution.kind} linked to formula version "${version.id}" but its own projectId "${action.projectId}" does not match the version's owning formulation "${formulation.id}".`,
        { formulaVersionId: version.id, actionId: action.id },
      );
    }
    linkedActions.push(action);
    const citedIds = resolution.kind === "trial" ? citedTrialIds : citedStudyIds;
    if (!citedIds.has(resolution.record.id)) {
      citedIds.add(resolution.record.id);
      sourceRecords.push({ sourceEntity: resolution.kind === "trial" ? "laboratoryTrial" : "stabilityStudy", sourceRecordId: resolution.record.id });
    }
    sourceRecords.push({ sourceEntity: "correctiveAction", sourceRecordId: action.id });
  }
  linkedActions.sort((a, b) => compareOrdinal(a.createdAt, b.createdAt) || compareOrdinal(a.id, b.id));

  const linkedSnapshots: CostSnapshot[] = [];
  for (const snapshot of costSnapshots) {
    if (snapshot.versionId !== version.id) continue;
    if (snapshot.formulationId !== formulation.id) {
      throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
        "cost_snapshot_formula_link_conflict",
        `Cost snapshot "${snapshot.code}" links to formula version "${version.id}" but its formulationId "${snapshot.formulationId}" does not match the version's owning formulation "${formulation.id}".`,
        { formulaVersionId: version.id, costSnapshotCode: snapshot.code },
      );
    }
    linkedSnapshots.push(snapshot);
    sourceRecords.push({ sourceEntity: "costSnapshot", sourceRecordId: snapshot.code });
  }
  linkedSnapshots.sort((a, b) => compareOrdinal(a.calculatedAt, b.calculatedAt) || compareOrdinal(a.code, b.code));

  const packagingContext: StabilityStudyPackagingContext[] = linkedStudies.map((study) => {
    if (!citedStudyIds.has(study.id)) {
      citedStudyIds.add(study.id);
      sourceRecords.push({ sourceEntity: "stabilityStudy", sourceRecordId: study.id });
    }
    return {
      studyId: study.id,
      studyCode: study.code,
      packagingSkuCode: study.packagingSkuCode,
      packagingSnapshot: study.packagingSnapshot,
    };
  });

  const row = {
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    sourceRecords,
    formulaId: formulation.id,
    formulaCode: formulation.code,
    formulaVersionId: version.id,
    formulaVersionNumber: version.versionNumber,
    correctiveActions: linkedActions,
    costSnapshots: linkedSnapshots,
    packagingContext,
  };

  const parsed = formulaVersionCorrectiveCostContextRowSchema.safeParse(row);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
      "row_schema_validation_failed",
      `Extracted row for formula version "${version.id}" failed schema validation: ${issues}`,
      { formulaVersionId: version.id },
    );
  }
  return parsed.data;
}

/** Emits exactly one `FormulaVersionCorrectiveCostContextRow` per
 *  requested formula version id, in the requested order. Throws (fails
 *  closed) on the first requested id, formula, trial/study/action/
 *  snapshot identity that cannot be resolved to an exact, unambiguous
 *  source record, or on the first constructed row that fails schema
 *  validation — it never silently drops or partially emits a row
 *  instead. */
export function extractFormulaVersionCorrectiveCostContextRows(
  input: FormulaVersionCorrectiveCostContextDatasetExtractionInput,
): FormulaVersionCorrectiveCostContextRow[] {
  const formulationsById = buildFormulationsById(input.formulations);
  const versionsById = buildVersionsById(input.formulationVersions);
  const trialsById = buildTrialsById(input.laboratoryTrials);
  const studiesById = buildStudiesById(input.stabilityStudies);
  const actionResolutions = buildActionResolutions(input.correctiveActions, trialsById, studiesById);
  const snapshotsByCode = buildSnapshotsByCode(input.costSnapshots);
  const costSnapshots = [...snapshotsByCode.values()];
  return input.formulationVersionIds.map((requestedId) => {
    const version = versionsById.get(requestedId);
    if (!version) {
      throw new FormulaVersionCorrectiveCostContextDatasetExtractionError(
        "formula_version_not_found",
        `Requested formula version id "${requestedId}" was not found among the supplied formulation versions.`,
        { formulaVersionId: requestedId },
      );
    }
    return extractOne(version, formulationsById, trialsById, studiesById, actionResolutions, input.correctiveActions, costSnapshots);
  });
}
