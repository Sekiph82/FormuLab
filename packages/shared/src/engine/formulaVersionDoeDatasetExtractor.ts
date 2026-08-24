/**
 * FVL-05.007 — the extractor: turns a persisted `FormulationVersion`'s
 * linked `DoeStudy` records, their `DoeDesign` records, those designs'
 * `DoeRun` records, and those runs' `DoeObservation` records into
 * `FormulaVersionDoeRow` dataset rows for the future Historical Experiment
 * Dataset Builder.
 *
 * See `schemas/dataset.ts`'s header comment on `formulaVersionDoeRowSchema`
 * for the full recovered source contract: `DoeStudy` links to a formula
 * version by its own direct, always-required `baselineFormulaVersionId`
 * field (never the `sourceType`/`sourceFormulaVersionId` pattern
 * FVL-05.004/.005/.006 used); a study's owning formulation is its own
 * `formulationId` field (proven equal to `projectId` by the one real
 * writer, `DoePanel.tsx`'s `handleCreateStudy`); `DoeStudy`/`DoeDesign`/
 * `DoeRun`/`DoeObservation` are each their own real, top-level, MUTABLE
 * persisted collection, so all four have genuinely GLOBAL identities and
 * never need `parentRecordId`; `DoeFactor`/`DoeConstraint`/`DoeResponse`
 * are deliberately not accepted as separate pools because `DoeDesign`'s own
 * frozen `factorSnapshot`/`constraintSnapshot`/`responseSnapshot` is
 * already the authoritative source for interpreting a run's
 * `factorSettings`/an observation's `responseId`; `DoeAnalysis`/
 * `DoeCandidate`/`DoeReviewAction` (computed outputs / administrative
 * sign-off log) are deliberately out of scope.
 *
 * Pure and deterministic: no persistence, no mutation of its inputs, no
 * generated ids/timestamps. Studies are ordered by `createdAt` then `id`;
 * designs within a study by `generatedAt` then `id`; runs within a design
 * by `standardOrder` then `id`; observations within a run by `recordedAt`
 * then `id`. Every chronology-key timestamp (`study.createdAt`,
 * `design.generatedAt`, `observation.recordedAt`) is validated as
 * canonical `toISOString()` format before being used as a sort key,
 * failing closed on a non-conforming value — the same discipline
 * FVL-05.004/.005/.006 established. Opaque-id tie-breakers use
 * locale-independent ordinal comparison, never `localeCompare`.
 *
 * `DoeStudy.supersedesStudyId` / `DoeDesign.supersedesDesignId` referential
 * integrity: fails closed (pool-wide) on a dangling reference, a
 * self-reference, or any longer cycle — the same two-function
 * (`validate...Reference` + `findFirst...Cycle`) pattern FVL-05.005/.006
 * established for `revisesResultId`.
 *
 * Every constructed row is validated against `formulaVersionDoeRowSchema`
 * before it is returned — fails closed on a malformed row, and guarantees
 * (via zod's always-rebuilding parse) that the returned row shares no
 * mutable array/object with the source records it was built from.
 */
import type { Formulation, FormulationVersion } from "../schemas/formulation";
import type { DoeDesign, DoeObservation, DoeRun, DoeStudy } from "../schemas/doe";
import {
  DATASET_SCHEMA_VERSION,
  formulaVersionDoeRowSchema,
  type DoeDesignRuns,
  type DoeRunObservations,
  type DoeStudyRuns,
  type FormulaVersionDoeRow,
  type SourceRecordReference,
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

export interface FormulaVersionDoeDatasetExtractionInput {
  /** The exact formula version ids requested for extraction, in the order
   *  rows should be produced. Each is resolved against `formulationVersions`
   *  — a requested id absent from that pool fails closed rather than being
   *  silently skipped. */
  formulationVersionIds: string[];
  formulationVersions: FormulationVersion[];
  formulations: Formulation[];
  /** The pool of DOE studies available to resolve each version's linked
   *  studies from. Only studies whose `baselineFormulaVersionId` exactly
   *  matches a requested version's id contribute to that version's row —
   *  possibly more than one, since a study revision keeps its
   *  predecessor's baseline unless explicitly changed. */
  doeStudies: DoeStudy[];
  /** The pool of persisted DOE designs. Every design's `studyId` must
   *  resolve to a study in the `doeStudies` pool above (pool-wide,
   *  regardless of relevance to any requested version) or the whole
   *  extraction fails closed. */
  doeDesigns: DoeDesign[];
  /** The pool of persisted DOE runs. Every run's `designId` must resolve
   *  to a design in the `doeDesigns` pool above (pool-wide), and its own
   *  `studyId`/`studyRevision` must agree with that design's, or the whole
   *  extraction fails closed. */
  doeRuns: DoeRun[];
  /** The pool of persisted DOE observations. Every observation's `runId`
   *  must resolve to a run in the `doeRuns` pool above (pool-wide), its
   *  own `studyId`/`studyRevision` must agree with that run's, and its
   *  `responseId` must resolve within that run's own design's frozen
   *  `responseSnapshot`, or the whole extraction fails closed. */
  doeObservations: DoeObservation[];
}

export type FormulaVersionDoeDatasetExtractionErrorCode =
  | "formula_version_not_found"
  | "duplicate_formula_version_id"
  | "formulation_not_found"
  | "duplicate_formulation_id"
  | "duplicate_doe_study_id"
  | "doe_study_formula_link_conflict"
  | "dangling_doe_study_supersession_reference"
  | "doe_study_supersession_cycle_detected"
  | "duplicate_doe_design_id"
  | "doe_design_study_not_found"
  | "doe_design_study_conflict"
  | "dangling_doe_design_supersession_reference"
  | "doe_design_supersession_cycle_detected"
  | "duplicate_doe_run_id"
  | "doe_run_design_not_found"
  | "doe_run_design_conflict"
  | "doe_run_linked_formula_version_not_found"
  | "duplicate_doe_observation_id"
  | "doe_observation_run_not_found"
  | "doe_observation_run_conflict"
  | "doe_observation_response_not_found"
  | "invalid_timestamp_format"
  | "row_schema_validation_failed";

/** Truthful, correctly-named structured error context — never a single
 *  overloaded field holding whatever identity happened to be at hand
 *  (the FVL-05.004 `AUDIT_FVL05_GPT_000001` finding J shape, reused). */
export interface FormulaVersionDoeDatasetExtractionErrorContext {
  formulaVersionId?: string;
  formulationId?: string;
  studyId?: string;
  designId?: string;
  runId?: string;
  observationId?: string;
  responseId?: string;
}

export class FormulaVersionDoeDatasetExtractionError extends Error {
  readonly code: FormulaVersionDoeDatasetExtractionErrorCode;
  readonly formulaVersionId?: string;
  readonly formulationId?: string;
  readonly studyId?: string;
  readonly designId?: string;
  readonly runId?: string;
  readonly observationId?: string;
  readonly responseId?: string;

  constructor(
    code: FormulaVersionDoeDatasetExtractionErrorCode,
    message: string,
    context: FormulaVersionDoeDatasetExtractionErrorContext = {},
  ) {
    super(message);
    this.name = "FormulaVersionDoeDatasetExtractionError";
    this.code = code;
    this.formulaVersionId = context.formulaVersionId;
    this.formulationId = context.formulationId;
    this.studyId = context.studyId;
    this.designId = context.designId;
    this.runId = context.runId;
    this.observationId = context.observationId;
    this.responseId = context.responseId;
  }
}

/** Builds the exact-id formula version lookup, failing closed on a duplicate
 *  `FormulationVersion.id` rather than silently letting the last one win. */
function buildVersionsById(formulationVersions: FormulationVersion[]): Map<string, FormulationVersion> {
  const byId = new Map<string, FormulationVersion>();
  for (const version of formulationVersions) {
    if (byId.has(version.id)) {
      throw new FormulaVersionDoeDatasetExtractionError(
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
      throw new FormulaVersionDoeDatasetExtractionError(
        "duplicate_formulation_id",
        `Ambiguous exact formulation identity: more than one supplied formulation has id "${formulation.id}".`,
        { formulationId: formulation.id },
      );
    }
    byId.set(formulation.id, formulation);
  }
  return byId;
}

function byStudyOrder(a: DoeStudy, b: DoeStudy): number {
  return compareOrdinal(a.createdAt, b.createdAt) || compareOrdinal(a.id, b.id);
}

function byDesignOrder(a: DoeDesign, b: DoeDesign): number {
  return compareOrdinal(a.generatedAt, b.generatedAt) || compareOrdinal(a.id, b.id);
}

function byRunOrder(a: DoeRun, b: DoeRun): number {
  return a.standardOrder - b.standardOrder || compareOrdinal(a.id, b.id);
}

function byObservationOrder(a: DoeObservation, b: DoeObservation): number {
  return compareOrdinal(a.recordedAt, b.recordedAt) || compareOrdinal(a.id, b.id);
}

/** Validates one `study.supersedesStudyId` reference (immediate neighbor
 *  only — self, dangling). Self-reference is checked FIRST: it would
 *  otherwise trivially "resolve" (the target is the study itself) and pass
 *  the dangling check, masking the real problem. */
function validateStudySupersessionReference(study: DoeStudy, studiesById: Map<string, DoeStudy>): void {
  const targetId = study.supersedesStudyId;
  if (targetId === undefined) return;
  if (targetId === study.id) {
    throw new FormulaVersionDoeDatasetExtractionError(
      "doe_study_supersession_cycle_detected",
      `DOE study "${study.id}" supersedes itself — a self-reference is not a valid supersession relationship.`,
      { studyId: study.id },
    );
  }
  if (!studiesById.has(targetId)) {
    throw new FormulaVersionDoeDatasetExtractionError(
      "dangling_doe_study_supersession_reference",
      `DOE study "${study.id}" supersedes "${targetId}", which was not found among the supplied DOE studies.`,
      { studyId: study.id },
    );
  }
}

function findFirstStudySupersessionCycle(studies: DoeStudy[], studiesById: Map<string, DoeStudy>): DoeStudy | undefined {
  for (const start of studies) {
    const visited = new Set<string>();
    let current: DoeStudy | undefined = start;
    while (current) {
      if (visited.has(current.id)) return start;
      visited.add(current.id);
      const nextId = current.supersedesStudyId;
      if (nextId === undefined) break;
      current = studiesById.get(nextId);
    }
  }
  return undefined;
}

/** Builds the exact-id DOE study lookup over the ENTIRE supplied pool,
 *  failing closed on a duplicate `DoeStudy.id`, a non-canonical
 *  `createdAt`, and any dangling/self/cyclical `supersedesStudyId`
 *  reference. */
function buildStudiesById(studies: DoeStudy[]): Map<string, DoeStudy> {
  const byId = new Map<string, DoeStudy>();
  for (const study of studies) {
    if (byId.has(study.id)) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "duplicate_doe_study_id",
        `Ambiguous exact DOE study identity: more than one supplied study has id "${study.id}".`,
        { studyId: study.id },
      );
    }
    if (!isCanonicalIsoTimestamp(study.createdAt)) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "invalid_timestamp_format",
        `DOE study "${study.id}" has a createdAt value ("${study.createdAt}") that is not the canonical toISOString() format this extractor relies on for chronological ordering.`,
        { studyId: study.id },
      );
    }
    byId.set(study.id, study);
  }
  for (const study of studies) {
    validateStudySupersessionReference(study, byId);
  }
  const cycleMember = findFirstStudySupersessionCycle(studies, byId);
  if (cycleMember) {
    throw new FormulaVersionDoeDatasetExtractionError(
      "doe_study_supersession_cycle_detected",
      `DOE study "${cycleMember.id}" is part of a circular supersedesStudyId reference chain.`,
      { studyId: cycleMember.id },
    );
  }
  return byId;
}

/** Validates one `design.supersedesDesignId` reference (immediate neighbor
 *  only — self, dangling), same pattern as the study-level check above. */
function validateDesignSupersessionReference(design: DoeDesign, designsById: Map<string, DoeDesign>): void {
  const targetId = design.supersedesDesignId;
  if (targetId === undefined) return;
  if (targetId === design.id) {
    throw new FormulaVersionDoeDatasetExtractionError(
      "doe_design_supersession_cycle_detected",
      `DOE design "${design.id}" supersedes itself — a self-reference is not a valid supersession relationship.`,
      { designId: design.id },
    );
  }
  if (!designsById.has(targetId)) {
    throw new FormulaVersionDoeDatasetExtractionError(
      "dangling_doe_design_supersession_reference",
      `DOE design "${design.id}" supersedes "${targetId}", which was not found among the supplied DOE designs.`,
      { designId: design.id },
    );
  }
}

function findFirstDesignSupersessionCycle(designs: DoeDesign[], designsById: Map<string, DoeDesign>): DoeDesign | undefined {
  for (const start of designs) {
    const visited = new Set<string>();
    let current: DoeDesign | undefined = start;
    while (current) {
      if (visited.has(current.id)) return start;
      visited.add(current.id);
      const nextId = current.supersedesDesignId;
      if (nextId === undefined) break;
      current = designsById.get(nextId);
    }
  }
  return undefined;
}

/** Builds the study-id -> designs index over the ENTIRE supplied
 *  `doeDesigns` pool, failing closed on a duplicate `DoeDesign.id`, a
 *  `studyId` that does not resolve to any supplied study, a
 *  `studyRevision` that contradicts the resolved study's own `revision`
 *  (`doe_design_study_conflict`), a non-canonical `generatedAt`, and any
 *  dangling/self/cyclical `supersedesDesignId` reference. */
function buildDesignsByStudyId(
  designs: DoeDesign[],
  studiesById: Map<string, DoeStudy>,
): { designsById: Map<string, DoeDesign>; byStudyId: Map<string, DoeDesign[]> } {
  const designsById = new Map<string, DoeDesign>();
  const byStudyId = new Map<string, DoeDesign[]>();
  for (const design of designs) {
    if (designsById.has(design.id)) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "duplicate_doe_design_id",
        `Ambiguous exact DOE design identity: more than one supplied design has id "${design.id}".`,
        { designId: design.id },
      );
    }
    const study = studiesById.get(design.studyId);
    if (!study) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "doe_design_study_not_found",
        `DOE design "${design.id}" references studyId "${design.studyId}", which was not found among the supplied DOE studies.`,
        { designId: design.id, studyId: design.studyId },
      );
    }
    if (design.studyRevision !== study.revision) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "doe_design_study_conflict",
        `DOE design "${design.id}" claims studyRevision ${design.studyRevision}, but its study "${study.id}" has revision ${study.revision}.`,
        { designId: design.id, studyId: design.studyId },
      );
    }
    if (!isCanonicalIsoTimestamp(design.generatedAt)) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "invalid_timestamp_format",
        `DOE design "${design.id}" has a generatedAt value ("${design.generatedAt}") that is not the canonical toISOString() format this extractor relies on for chronological ordering.`,
        { designId: design.id, studyId: design.studyId },
      );
    }
    designsById.set(design.id, design);
    const bucket = byStudyId.get(design.studyId);
    if (bucket) {
      bucket.push(design);
    } else {
      byStudyId.set(design.studyId, [design]);
    }
  }
  for (const design of designs) {
    validateDesignSupersessionReference(design, designsById);
  }
  const cycleMember = findFirstDesignSupersessionCycle(designs, designsById);
  if (cycleMember) {
    throw new FormulaVersionDoeDatasetExtractionError(
      "doe_design_supersession_cycle_detected",
      `DOE design "${cycleMember.id}" is part of a circular supersedesDesignId reference chain.`,
      { designId: cycleMember.id },
    );
  }
  return { designsById, byStudyId };
}

/** Builds the design-id -> runs index over the ENTIRE supplied `doeRuns`
 *  pool, failing closed on a duplicate `DoeRun.id`, a `designId` that does
 *  not resolve to any supplied design, a `studyId`/`studyRevision` that
 *  contradicts the resolved design's own fields (`doe_run_design_conflict`),
 *  and a `linkedFormulaVersionId` that does not resolve to any supplied
 *  formulation version. */
function buildRunsByDesignId(
  runs: DoeRun[],
  designsById: Map<string, DoeDesign>,
  versionsById: Map<string, FormulationVersion>,
): { runsById: Map<string, DoeRun>; byDesignId: Map<string, DoeRun[]> } {
  const runsById = new Map<string, DoeRun>();
  const byDesignId = new Map<string, DoeRun[]>();
  for (const run of runs) {
    if (runsById.has(run.id)) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "duplicate_doe_run_id",
        `Ambiguous exact DOE run identity: more than one supplied run has id "${run.id}".`,
        { runId: run.id },
      );
    }
    const design = designsById.get(run.designId);
    if (!design) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "doe_run_design_not_found",
        `DOE run "${run.id}" references designId "${run.designId}", which was not found among the supplied DOE designs.`,
        { runId: run.id, designId: run.designId },
      );
    }
    if (run.studyId !== design.studyId || run.studyRevision !== design.studyRevision) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "doe_run_design_conflict",
        `DOE run "${run.id}" claims studyId "${run.studyId}"/studyRevision ${run.studyRevision}, but its design "${design.id}" has studyId "${design.studyId}"/studyRevision ${design.studyRevision}.`,
        { runId: run.id, designId: run.designId, studyId: run.studyId },
      );
    }
    if (run.linkedFormulaVersionId !== undefined && !versionsById.has(run.linkedFormulaVersionId)) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "doe_run_linked_formula_version_not_found",
        `DOE run "${run.id}" references linkedFormulaVersionId "${run.linkedFormulaVersionId}", which was not found among the supplied formulation versions.`,
        { runId: run.id, formulaVersionId: run.linkedFormulaVersionId },
      );
    }
    runsById.set(run.id, run);
    const bucket = byDesignId.get(run.designId);
    if (bucket) {
      bucket.push(run);
    } else {
      byDesignId.set(run.designId, [run]);
    }
  }
  return { runsById, byDesignId };
}

/** Builds the run-id -> observations index over the ENTIRE supplied
 *  `doeObservations` pool, failing closed on a duplicate
 *  `DoeObservation.id`, a `runId` that does not resolve to any supplied
 *  run, a `studyId`/`studyRevision` that contradicts the resolved run's own
 *  fields (`doe_observation_run_conflict`), a non-canonical `recordedAt`,
 *  and a `responseId` that does not resolve within the owning run's own
 *  design's frozen `responseSnapshot`. */
function buildObservationsByRunId(
  observations: DoeObservation[],
  runsById: Map<string, DoeRun>,
  designsById: Map<string, DoeDesign>,
): Map<string, DoeObservation[]> {
  const observationsById = new Map<string, DoeObservation>();
  const byRunId = new Map<string, DoeObservation[]>();
  for (const observation of observations) {
    if (observationsById.has(observation.id)) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "duplicate_doe_observation_id",
        `Ambiguous exact DOE observation identity: more than one supplied observation has id "${observation.id}".`,
        { observationId: observation.id },
      );
    }
    const run = runsById.get(observation.runId);
    if (!run) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "doe_observation_run_not_found",
        `DOE observation "${observation.id}" references runId "${observation.runId}", which was not found among the supplied DOE runs.`,
        { observationId: observation.id, runId: observation.runId },
      );
    }
    if (observation.studyId !== run.studyId || observation.studyRevision !== run.studyRevision) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "doe_observation_run_conflict",
        `DOE observation "${observation.id}" claims studyId "${observation.studyId}"/studyRevision ${observation.studyRevision}, but its run "${run.id}" has studyId "${run.studyId}"/studyRevision ${run.studyRevision}.`,
        { observationId: observation.id, runId: observation.runId, studyId: observation.studyId },
      );
    }
    if (!isCanonicalIsoTimestamp(observation.recordedAt)) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "invalid_timestamp_format",
        `DOE observation "${observation.id}" has a recordedAt value ("${observation.recordedAt}") that is not the canonical toISOString() format this extractor relies on for chronological ordering.`,
        { observationId: observation.id, runId: observation.runId },
      );
    }
    const design = designsById.get(run.designId)!;
    if (!design.responseSnapshot.some((response) => response.id === observation.responseId)) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "doe_observation_response_not_found",
        `DOE observation "${observation.id}" references responseId "${observation.responseId}", which was not found in its run's design "${design.id}" responseSnapshot.`,
        { observationId: observation.id, runId: observation.runId, responseId: observation.responseId },
      );
    }
    observationsById.set(observation.id, observation);
    const bucket = byRunId.get(observation.runId);
    if (bucket) {
      bucket.push(observation);
    } else {
      byRunId.set(observation.runId, [observation]);
    }
  }
  return byRunId;
}

/** Resolves every study linked to `version`, failing closed on a
 *  conflicting link (a study whose `baselineFormulaVersionId` matches but
 *  whose `formulationId` does not resolve to the version's own owning
 *  formulation) — never silently attributing or silently dropping it.
 *  Order is by `createdAt` then `id`, independent of the supplied pool's
 *  order. */
function resolveLinkedStudies(
  version: FormulationVersion,
  formulation: Formulation,
  studiesById: Map<string, DoeStudy>,
): DoeStudy[] {
  const linked: DoeStudy[] = [];
  for (const study of studiesById.values()) {
    if (study.baselineFormulaVersionId !== version.id) continue;
    if (study.formulationId !== formulation.id) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "doe_study_formula_link_conflict",
        `DOE study "${study.id}" links to formula version "${version.id}" but its formulationId "${study.formulationId}" does not match the version's owning formulation "${formulation.id}".`,
        { formulaVersionId: version.id, studyId: study.id },
      );
    }
    linked.push(study);
  }
  return linked.sort(byStudyOrder);
}

/** Builds one `DoeStudyRuns` entry plus the exact source-record citations
 *  it contributes. Study/design/run/observation citations never set
 *  `parentRecordId` — all four are genuinely global identities (their own
 *  top-level collections), not parent-scoped. */
function buildStudyRuns(
  study: DoeStudy,
  designsByStudyId: Map<string, DoeDesign[]>,
  runsByDesignId: Map<string, DoeRun[]>,
  observationsByRunId: Map<string, DoeObservation[]>,
): { entry: DoeStudyRuns; citations: SourceRecordReference[] } {
  const designs = [...(designsByStudyId.get(study.id) ?? [])].sort(byDesignOrder);
  const citations: SourceRecordReference[] = [{ sourceEntity: "doeStudy", sourceRecordId: study.id }];
  const designEntries: DoeDesignRuns[] = [];
  for (const design of designs) {
    citations.push({ sourceEntity: "doeDesign", sourceRecordId: design.id });
    const runs = [...(runsByDesignId.get(design.id) ?? [])].sort(byRunOrder);
    const runEntries: DoeRunObservations[] = [];
    for (const run of runs) {
      citations.push({ sourceEntity: "doeRun", sourceRecordId: run.id });
      const runObservations = [...(observationsByRunId.get(run.id) ?? [])].sort(byObservationOrder);
      for (const observation of runObservations) {
        citations.push({ sourceEntity: "doeObservation", sourceRecordId: observation.id });
      }
      runEntries.push({ run, observations: runObservations });
    }
    designEntries.push({ design, runs: runEntries });
  }
  return {
    entry: {
      studyId: study.id,
      studyCode: study.studyCode,
      studyRevision: study.revision,
      supersedesStudyId: study.supersedesStudyId,
      designs: designEntries,
    },
    citations,
  };
}

function extractOne(
  version: FormulationVersion,
  formulationsById: Map<string, Formulation>,
  studiesById: Map<string, DoeStudy>,
  designsByStudyId: Map<string, DoeDesign[]>,
  runsByDesignId: Map<string, DoeRun[]>,
  observationsByRunId: Map<string, DoeObservation[]>,
): FormulaVersionDoeRow {
  const formulation = formulationsById.get(version.formulationId);
  if (!formulation) {
    throw new FormulaVersionDoeDatasetExtractionError(
      "formulation_not_found",
      `FormulationVersion "${version.id}" references formulationId "${version.formulationId}", which was not found among the supplied formulations.`,
      { formulaVersionId: version.id, formulationId: version.formulationId },
    );
  }

  const linkedStudies = resolveLinkedStudies(version, formulation, studiesById);
  const sourceRecords: SourceRecordReference[] = [
    { sourceEntity: "formulation", sourceRecordId: formulation.id },
    { sourceEntity: "formulationVersion", sourceRecordId: version.id },
  ];
  const studies: DoeStudyRuns[] = [];
  for (const study of linkedStudies) {
    const { entry, citations } = buildStudyRuns(study, designsByStudyId, runsByDesignId, observationsByRunId);
    studies.push(entry);
    sourceRecords.push(...citations);
  }

  const row = {
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    sourceRecords,
    formulaId: formulation.id,
    formulaCode: formulation.code,
    formulaVersionId: version.id,
    formulaVersionNumber: version.versionNumber,
    studies,
  };

  const parsed = formulaVersionDoeRowSchema.safeParse(row);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new FormulaVersionDoeDatasetExtractionError(
      "row_schema_validation_failed",
      `Extracted row for formula version "${version.id}" failed schema validation: ${issues}`,
      { formulaVersionId: version.id },
    );
  }
  return parsed.data;
}

/** Emits exactly one `FormulaVersionDoeRow` per requested formula version
 *  id, in the requested order. Throws (fails closed) on the first
 *  requested id, formula, study/design/run/observation identity that
 *  cannot be resolved to an exact, unambiguous source record, or on the
 *  first constructed row that fails schema validation — it never silently
 *  drops or partially emits a row instead. */
export function extractFormulaVersionDoeRows(
  input: FormulaVersionDoeDatasetExtractionInput,
): FormulaVersionDoeRow[] {
  const formulationsById = buildFormulationsById(input.formulations);
  const versionsById = buildVersionsById(input.formulationVersions);
  const studiesById = buildStudiesById(input.doeStudies);
  const { designsById, byStudyId: designsByStudyId } = buildDesignsByStudyId(input.doeDesigns, studiesById);
  const { runsById, byDesignId: runsByDesignId } = buildRunsByDesignId(input.doeRuns, designsById, versionsById);
  const observationsByRunId = buildObservationsByRunId(input.doeObservations, runsById, designsById);
  return input.formulationVersionIds.map((requestedId) => {
    const version = versionsById.get(requestedId);
    if (!version) {
      throw new FormulaVersionDoeDatasetExtractionError(
        "formula_version_not_found",
        `Requested formula version id "${requestedId}" was not found among the supplied formulation versions.`,
        { formulaVersionId: requestedId },
      );
    }
    return extractOne(version, formulationsById, studiesById, designsByStudyId, runsByDesignId, observationsByRunId);
  });
}
