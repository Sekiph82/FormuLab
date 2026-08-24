/**
 * FVL-05.006 — the extractor: turns a persisted `FormulationVersion`'s
 * linked `StabilityStudy` records, their `StabilitySample` records, and
 * those samples' `StabilityResult` records into `FormulaVersionStabilityRow`
 * dataset rows for the future Historical Experiment Dataset Builder.
 *
 * See `schemas/dataset.ts`'s header comment on
 * `formulaVersionStabilityRowSchema` for the full recovered source
 * contract: `StabilityStudy` links to a formula version by the exact same
 * `sourceType`/`sourceFormulaVersionId` pattern `LaboratoryTrial` uses
 * (FVL-05.004/.005); `StabilityStudy`/`StabilitySample`/`StabilityResult`
 * are each their own real, top-level persisted collection (the last
 * append-only), so all three have genuinely GLOBAL identities and never
 * need `parentRecordId`; `StabilityTrend` (computed, no persisted
 * collection) and `StabilityFailure` (a separate incident-tracking
 * collection) are deliberately out of scope. A study is "linked" to the
 * requested formula version by the same rule FVL-05.004/.005 established:
 * `sourceType === "saved_version"` AND `sourceFormulaVersionId` exactly
 * matches the requested version's id; a linked study whose `projectId`
 * does not resolve to the version's owning formulation is a conflicting
 * link and fails closed.
 *
 * Pure and deterministic: no persistence, no mutation of its inputs, no
 * generated ids/timestamps. Studies are ordered by `createdAt` then `id`;
 * samples within a study by `createdAt` then `id`; results within a
 * sample by `performedAt` then `id`. Every chronology-key timestamp
 * (`study.createdAt`, `sample.createdAt`, `result.performedAt`) is
 * validated as canonical `toISOString()` format before being used as a
 * sort key, failing closed on a non-conforming value — the same
 * discipline FVL-05.004/.005 established. Opaque-id tie-breakers use
 * locale-independent ordinal comparison, never `localeCompare`.
 *
 * `revisesResultId` referential integrity (`StabilityResult` has no
 * `retestOf` field — only `TestResult` does): fails closed on a dangling
 * reference, a cross-SAMPLE reference (the natural scope analog to
 * FVL-05.005's same-trial rule, recovered from `StabilitySample`'s own
 * "tested once then disposed" contract), a self-reference, or any longer
 * cycle — see `schemas/dataset.ts`'s header comment for the full
 * recovered-semantics rationale (the same authoritative source,
 * `engine/resultHistory.ts`, explicitly covers both `TestResult` and
 * `StabilityResult`).
 *
 * Every constructed row is validated against
 * `formulaVersionStabilityRowSchema` before it is returned — fails
 * closed on a malformed row, and guarantees (via zod's always-rebuilding
 * parse) that the returned row shares no mutable array/object with the
 * source records it was built from.
 */
import type { Formulation, FormulationVersion } from "../schemas/formulation";
import type { StabilityResult, StabilitySample, StabilityStudy } from "../schemas/stability";
import {
  DATASET_SCHEMA_VERSION,
  formulaVersionStabilityRowSchema,
  type FormulaVersionStabilityRow,
  type SourceRecordReference,
  type StabilitySampleResults,
  type StabilityStudySamples,
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

export interface FormulaVersionStabilityDatasetExtractionInput {
  /** The exact formula version ids requested for extraction, in the order
   *  rows should be produced. Each is resolved against `formulationVersions`
   *  — a requested id absent from that pool fails closed rather than being
   *  silently skipped. */
  formulationVersionIds: string[];
  formulationVersions: FormulationVersion[];
  formulations: Formulation[];
  /** The pool of stability studies available to resolve each version's
   *  linked studies from. Only studies whose `sourceFormulaVersionId`
   *  exactly matches a requested version's id (and whose `sourceType` is
   *  `"saved_version"`) contribute to that version's row. */
  stabilityStudies: StabilityStudy[];
  /** The pool of persisted stability samples. Every sample's `studyId`
   *  must resolve to a study in the `stabilityStudies` pool above
   *  (pool-wide, regardless of relevance to any requested version) or the
   *  whole extraction fails closed. */
  stabilitySamples: StabilitySample[];
  /** The pool of persisted stability results. Every result's `sampleId`
   *  must resolve to a sample in the `stabilitySamples` pool above
   *  (pool-wide), and its own `studyId`/`conditionId`/`timePointId` must
   *  agree with that sample's, or the whole extraction fails closed. */
  stabilityResults: StabilityResult[];
}

export type FormulaVersionStabilityDatasetExtractionErrorCode =
  | "formula_version_not_found"
  | "duplicate_formula_version_id"
  | "formulation_not_found"
  | "duplicate_formulation_id"
  | "duplicate_stability_study_id"
  | "invalid_saved_version_study_link"
  | "study_formula_link_conflict"
  | "duplicate_stability_sample_id"
  | "stability_sample_study_not_found"
  | "duplicate_stability_result_id"
  | "stability_result_sample_not_found"
  | "stability_result_sample_conflict"
  | "stability_result_revision_cycle_detected"
  | "dangling_stability_result_revision_reference"
  | "cross_sample_stability_result_revision_reference"
  | "invalid_timestamp_format"
  | "row_schema_validation_failed";

/** Truthful, correctly-named structured error context — never a single
 *  overloaded field holding whatever identity happened to be at hand
 *  (the FVL-05.004 `AUDIT_FVL05_GPT_000001` finding J shape, reused). */
export interface FormulaVersionStabilityDatasetExtractionErrorContext {
  formulaVersionId?: string;
  formulationId?: string;
  studyId?: string;
  sampleId?: string;
  resultId?: string;
}

export class FormulaVersionStabilityDatasetExtractionError extends Error {
  readonly code: FormulaVersionStabilityDatasetExtractionErrorCode;
  readonly formulaVersionId?: string;
  readonly formulationId?: string;
  readonly studyId?: string;
  readonly sampleId?: string;
  readonly resultId?: string;

  constructor(
    code: FormulaVersionStabilityDatasetExtractionErrorCode,
    message: string,
    context: FormulaVersionStabilityDatasetExtractionErrorContext = {},
  ) {
    super(message);
    this.name = "FormulaVersionStabilityDatasetExtractionError";
    this.code = code;
    this.formulaVersionId = context.formulaVersionId;
    this.formulationId = context.formulationId;
    this.studyId = context.studyId;
    this.sampleId = context.sampleId;
    this.resultId = context.resultId;
  }
}

/** Builds the exact-id formula version lookup, failing closed on a duplicate
 *  `FormulationVersion.id` rather than silently letting the last one win. */
function buildVersionsById(formulationVersions: FormulationVersion[]): Map<string, FormulationVersion> {
  const byId = new Map<string, FormulationVersion>();
  for (const version of formulationVersions) {
    if (byId.has(version.id)) {
      throw new FormulaVersionStabilityDatasetExtractionError(
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
      throw new FormulaVersionStabilityDatasetExtractionError(
        "duplicate_formulation_id",
        `Ambiguous exact formulation identity: more than one supplied formulation has id "${formulation.id}".`,
        { formulationId: formulation.id },
      );
    }
    byId.set(formulation.id, formulation);
  }
  return byId;
}

function byStudyOrder(a: StabilityStudy, b: StabilityStudy): number {
  return compareOrdinal(a.createdAt, b.createdAt) || compareOrdinal(a.id, b.id);
}

function bySampleOrder(a: StabilitySample, b: StabilitySample): number {
  return compareOrdinal(a.createdAt, b.createdAt) || compareOrdinal(a.id, b.id);
}

function byResultOrder(a: StabilityResult, b: StabilityResult): number {
  return compareOrdinal(a.performedAt, b.performedAt) || compareOrdinal(a.id, b.id);
}

/** Builds the exact-id stability-study lookup over the ENTIRE supplied
 *  pool, failing closed on a duplicate `StabilityStudy.id`, on a
 *  `"saved_version"` study with a missing/blank `sourceFormulaVersionId`
 *  (the exact same contradictory-link check `formulaVersionProcessDatasetExtractor.ts`'s
 *  `buildTrialsById` established for `LaboratoryTrial`), and on a
 *  non-canonical `createdAt`. */
function buildStudiesById(studies: StabilityStudy[]): Map<string, StabilityStudy> {
  const byId = new Map<string, StabilityStudy>();
  for (const study of studies) {
    if (byId.has(study.id)) {
      throw new FormulaVersionStabilityDatasetExtractionError(
        "duplicate_stability_study_id",
        `Ambiguous exact stability study identity: more than one supplied study has id "${study.id}".`,
        { studyId: study.id },
      );
    }
    if (study.sourceType === "saved_version" && (study.sourceFormulaVersionId === undefined || study.sourceFormulaVersionId.trim() === "")) {
      throw new FormulaVersionStabilityDatasetExtractionError(
        "invalid_saved_version_study_link",
        `Stability study "${study.id}" has sourceType "saved_version" but no (or a blank) sourceFormulaVersionId — this is a contradictory, malformed saved-version link.`,
        { studyId: study.id },
      );
    }
    if (!isCanonicalIsoTimestamp(study.createdAt)) {
      throw new FormulaVersionStabilityDatasetExtractionError(
        "invalid_timestamp_format",
        `Stability study "${study.id}" has a createdAt value ("${study.createdAt}") that is not the canonical toISOString() format this extractor relies on for chronological ordering.`,
        { studyId: study.id },
      );
    }
    byId.set(study.id, study);
  }
  return byId;
}

/** Builds the study-id -> samples index over the ENTIRE supplied
 *  `stabilitySamples` pool, failing closed on a duplicate
 *  `StabilitySample.id`, a `studyId` that does not resolve to any
 *  supplied study, and a non-canonical `createdAt`. */
function buildSamplesByStudyId(
  stabilitySamples: StabilitySample[],
  studiesById: Map<string, StabilityStudy>,
): { samplesById: Map<string, StabilitySample>; byStudyId: Map<string, StabilitySample[]> } {
  const samplesById = new Map<string, StabilitySample>();
  const byStudyId = new Map<string, StabilitySample[]>();
  for (const sample of stabilitySamples) {
    if (samplesById.has(sample.id)) {
      throw new FormulaVersionStabilityDatasetExtractionError(
        "duplicate_stability_sample_id",
        `Ambiguous exact stability sample identity: more than one supplied sample has id "${sample.id}".`,
        { sampleId: sample.id },
      );
    }
    if (!studiesById.has(sample.studyId)) {
      throw new FormulaVersionStabilityDatasetExtractionError(
        "stability_sample_study_not_found",
        `Stability sample "${sample.id}" references studyId "${sample.studyId}", which was not found among the supplied stability studies.`,
        { sampleId: sample.id, studyId: sample.studyId },
      );
    }
    if (!isCanonicalIsoTimestamp(sample.createdAt)) {
      throw new FormulaVersionStabilityDatasetExtractionError(
        "invalid_timestamp_format",
        `Stability sample "${sample.id}" has a createdAt value ("${sample.createdAt}") that is not the canonical toISOString() format this extractor relies on for chronological ordering.`,
        { sampleId: sample.id, studyId: sample.studyId },
      );
    }
    samplesById.set(sample.id, sample);
    const bucket = byStudyId.get(sample.studyId);
    if (bucket) {
      bucket.push(sample);
    } else {
      byStudyId.set(sample.studyId, [sample]);
    }
  }
  return { samplesById, byStudyId };
}

/** Validates one `result.revisesResultId` reference (immediate neighbor
 *  only — self, dangling, cross-sample). Self-reference is checked FIRST:
 *  it would otherwise trivially "resolve" (the target is the result
 *  itself) and pass the dangling/cross-sample checks, masking the real
 *  problem. */
function validateResultRevisionReference(result: StabilityResult, resultsById: Map<string, StabilityResult>): void {
  const targetId = result.revisesResultId;
  if (targetId === undefined) return;

  if (targetId === result.id) {
    throw new FormulaVersionStabilityDatasetExtractionError(
      "stability_result_revision_cycle_detected",
      `Stability result "${result.id}" revises itself — a self-reference is not a valid revision relationship.`,
      { resultId: result.id, sampleId: result.sampleId },
    );
  }

  const target = resultsById.get(targetId);
  if (!target) {
    throw new FormulaVersionStabilityDatasetExtractionError(
      "dangling_stability_result_revision_reference",
      `Stability result "${result.id}" revises "${targetId}", which was not found among the supplied stability results.`,
      { resultId: result.id, sampleId: result.sampleId },
    );
  }

  if (target.sampleId !== result.sampleId) {
    throw new FormulaVersionStabilityDatasetExtractionError(
      "cross_sample_stability_result_revision_reference",
      `Stability result "${result.id}" (sample "${result.sampleId}") revises "${targetId}", which belongs to a different sample ("${target.sampleId}").`,
      { resultId: result.id, sampleId: result.sampleId },
    );
  }
}

/** Walks the `revisesResultId` chain from every result, returning the
 *  first result found to be part of a cycle (length >= 2 — a direct
 *  self-reference is already rejected by `validateResultRevisionReference`
 *  before this ever runs). */
function findFirstResultRevisionCycle(
  stabilityResults: StabilityResult[],
  resultsById: Map<string, StabilityResult>,
): StabilityResult | undefined {
  for (const start of stabilityResults) {
    const visited = new Set<string>();
    let current: StabilityResult | undefined = start;
    while (current) {
      if (visited.has(current.id)) return start;
      visited.add(current.id);
      const nextId = current.revisesResultId;
      if (nextId === undefined) break;
      current = resultsById.get(nextId);
    }
  }
  return undefined;
}

/** Builds the sample-id -> results index over the ENTIRE supplied
 *  `stabilityResults` pool. Pass 1: fails closed on a duplicate
 *  `StabilityResult.id`, a `sampleId` that does not resolve to any
 *  supplied sample, a redundant-field contradiction against that
 *  sample's own `studyId`/`conditionId`/`timePointId`, and a
 *  non-canonical `performedAt`. Pass 2: validates every
 *  `revisesResultId` immediate reference. Pass 3: detects any longer
 *  reference cycle. */
function buildResultsBySampleId(
  stabilityResults: StabilityResult[],
  samplesById: Map<string, StabilitySample>,
): Map<string, StabilityResult[]> {
  const resultsById = new Map<string, StabilityResult>();
  const byResultSampleId = new Map<string, StabilityResult[]>();
  for (const result of stabilityResults) {
    if (resultsById.has(result.id)) {
      throw new FormulaVersionStabilityDatasetExtractionError(
        "duplicate_stability_result_id",
        `Ambiguous exact stability result identity: more than one supplied result has id "${result.id}".`,
        { resultId: result.id },
      );
    }
    const sample = samplesById.get(result.sampleId);
    if (!sample) {
      throw new FormulaVersionStabilityDatasetExtractionError(
        "stability_result_sample_not_found",
        `Stability result "${result.id}" references sampleId "${result.sampleId}", which was not found among the supplied stability samples.`,
        { resultId: result.id, sampleId: result.sampleId },
      );
    }
    if (result.studyId !== sample.studyId) {
      throw new FormulaVersionStabilityDatasetExtractionError(
        "stability_result_sample_conflict",
        `Stability result "${result.id}" claims studyId "${result.studyId}", but its sample "${sample.id}" belongs to studyId "${sample.studyId}".`,
        { resultId: result.id, sampleId: result.sampleId, studyId: result.studyId },
      );
    }
    if (result.conditionId !== sample.conditionId) {
      throw new FormulaVersionStabilityDatasetExtractionError(
        "stability_result_sample_conflict",
        `Stability result "${result.id}" claims conditionId "${result.conditionId}", but its sample "${sample.id}" has conditionId "${sample.conditionId}".`,
        { resultId: result.id, sampleId: result.sampleId },
      );
    }
    if (result.timePointId !== sample.timePointId) {
      throw new FormulaVersionStabilityDatasetExtractionError(
        "stability_result_sample_conflict",
        `Stability result "${result.id}" claims timePointId "${result.timePointId}", but its sample "${sample.id}" has timePointId "${sample.timePointId}".`,
        { resultId: result.id, sampleId: result.sampleId },
      );
    }
    if (!isCanonicalIsoTimestamp(result.performedAt)) {
      throw new FormulaVersionStabilityDatasetExtractionError(
        "invalid_timestamp_format",
        `Stability result "${result.id}" has a performedAt value ("${result.performedAt}") that is not the canonical toISOString() format this extractor relies on for chronological ordering.`,
        { resultId: result.id, sampleId: result.sampleId },
      );
    }
    resultsById.set(result.id, result);
    const bucket = byResultSampleId.get(result.sampleId);
    if (bucket) {
      bucket.push(result);
    } else {
      byResultSampleId.set(result.sampleId, [result]);
    }
  }

  for (const result of stabilityResults) {
    validateResultRevisionReference(result, resultsById);
  }

  const cycleMember = findFirstResultRevisionCycle(stabilityResults, resultsById);
  if (cycleMember) {
    throw new FormulaVersionStabilityDatasetExtractionError(
      "stability_result_revision_cycle_detected",
      `Stability result "${cycleMember.id}" is part of a circular revisesResultId reference chain.`,
      { resultId: cycleMember.id, sampleId: cycleMember.sampleId },
    );
  }

  return byResultSampleId;
}

/** Resolves every study linked to `version`, failing closed on a
 *  conflicting link (a study whose `sourceFormulaVersionId` matches but
 *  whose `projectId` does not resolve to the version's own owning
 *  formulation) — never silently attributing or silently dropping it.
 *  Order is by `createdAt` then `id`, independent of the supplied pool's
 *  order. */
function resolveLinkedStudies(
  version: FormulationVersion,
  formulation: Formulation,
  studiesById: Map<string, StabilityStudy>,
): StabilityStudy[] {
  const linked: StabilityStudy[] = [];
  for (const study of studiesById.values()) {
    if (study.sourceType !== "saved_version" || study.sourceFormulaVersionId !== version.id) continue;
    if (study.projectId !== formulation.id) {
      throw new FormulaVersionStabilityDatasetExtractionError(
        "study_formula_link_conflict",
        `Stability study "${study.id}" links to formula version "${version.id}" but its projectId "${study.projectId}" does not match the version's owning formulation "${formulation.id}".`,
        { formulaVersionId: version.id, studyId: study.id },
      );
    }
    linked.push(study);
  }
  return linked.sort(byStudyOrder);
}

/** Builds one `StabilityStudySamples` entry plus the exact source-record
 *  citations it contributes. Neither sample nor result citations ever
 *  set `parentRecordId` — both `StabilitySample.id` and
 *  `StabilityResult.id` are genuinely global identities (their own
 *  top-level collections), not parent-scoped. */
function buildStudySamples(
  study: StabilityStudy,
  samplesByStudyId: Map<string, StabilitySample[]>,
  resultsBySampleId: Map<string, StabilityResult[]>,
): { entry: StabilityStudySamples; citations: SourceRecordReference[] } {
  const samples = [...(samplesByStudyId.get(study.id) ?? [])].sort(bySampleOrder);
  const citations: SourceRecordReference[] = [{ sourceEntity: "stabilityStudy", sourceRecordId: study.id }];
  const sampleEntries: StabilitySampleResults[] = [];
  for (const sample of samples) {
    citations.push({ sourceEntity: "stabilitySample", sourceRecordId: sample.id });
    const results = [...(resultsBySampleId.get(sample.id) ?? [])].sort(byResultOrder);
    for (const result of results) {
      citations.push({ sourceEntity: "stabilityResult", sourceRecordId: result.id });
    }
    sampleEntries.push({ sample, results });
  }
  return {
    entry: { studyId: study.id, studyCode: study.code, samples: sampleEntries },
    citations,
  };
}

function extractOne(
  version: FormulationVersion,
  formulationsById: Map<string, Formulation>,
  studiesById: Map<string, StabilityStudy>,
  samplesByStudyId: Map<string, StabilitySample[]>,
  resultsBySampleId: Map<string, StabilityResult[]>,
): FormulaVersionStabilityRow {
  const formulation = formulationsById.get(version.formulationId);
  if (!formulation) {
    throw new FormulaVersionStabilityDatasetExtractionError(
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
  const studies: StabilityStudySamples[] = [];
  for (const study of linkedStudies) {
    const { entry, citations } = buildStudySamples(study, samplesByStudyId, resultsBySampleId);
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

  const parsed = formulaVersionStabilityRowSchema.safeParse(row);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new FormulaVersionStabilityDatasetExtractionError(
      "row_schema_validation_failed",
      `Extracted row for formula version "${version.id}" failed schema validation: ${issues}`,
      { formulaVersionId: version.id },
    );
  }
  return parsed.data;
}

/** Emits exactly one `FormulaVersionStabilityRow` per requested formula
 *  version id, in the requested order. Throws (fails closed) on the first
 *  requested id, formula, study/sample/result identity that cannot be
 *  resolved to an exact, unambiguous source record, or on the first
 *  constructed row that fails schema validation — it never silently
 *  drops or partially emits a row instead. */
export function extractFormulaVersionStabilityRows(
  input: FormulaVersionStabilityDatasetExtractionInput,
): FormulaVersionStabilityRow[] {
  const formulationsById = buildFormulationsById(input.formulations);
  const versionsById = buildVersionsById(input.formulationVersions);
  const studiesById = buildStudiesById(input.stabilityStudies);
  const { samplesById, byStudyId: samplesByStudyId } = buildSamplesByStudyId(input.stabilitySamples, studiesById);
  const resultsBySampleId = buildResultsBySampleId(input.stabilityResults, samplesById);
  return input.formulationVersionIds.map((requestedId) => {
    const version = versionsById.get(requestedId);
    if (!version) {
      throw new FormulaVersionStabilityDatasetExtractionError(
        "formula_version_not_found",
        `Requested formula version id "${requestedId}" was not found among the supplied formulation versions.`,
        { formulaVersionId: requestedId },
      );
    }
    return extractOne(version, formulationsById, studiesById, samplesByStudyId, resultsBySampleId);
  });
}
