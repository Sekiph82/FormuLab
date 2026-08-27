/**
 * FVL-05.010 — the extractor: turns the three measured-response
 * FVL-05.005/.006/.007 row families (`TestResult`, `StabilityResult`,
 * `DoeObservation`) into `FormulaVersionTargetRow` target-observation
 * rows for the future Historical Experiment Dataset Builder.
 *
 * See `schemas/dataset.ts`'s header comment on `formulaVersionTargetRowSchema`
 * (immediately above `TARGET_SOURCE_ENTITIES`) for the full recovered
 * source contract: which fields are genuinely measured evidence versus
 * planned/spec/objective values that must never become labels, the exact
 * target-identity tuple, the value-representation design, and why
 * `FEATURE_SCHEMA_VERSION` bumped for this task while `DATASET_SCHEMA_VERSION`
 * did not.
 *
 * Pure and deterministic: no persistence, no mutation of its inputs, no
 * generated ids/timestamps. Every input row family is walked in the order
 * it already appears in the row (each of the three input rows was already
 * deterministically ordered by its own originating FVL-05.005/.006/.007
 * extractor — this task does not re-sort them, only reads them).
 *
 * A `compositionRow` is required per requested version — the same
 * `formulaId`/`formulaCode`/`formulaVersionNumber`/`productFamilyCode`
 * identity FVL-05.009 already trusts from it, reused here rather than
 * re-resolved. `testResultRow`/`stabilityRow`/`doeRow` are each an
 * independent OPTIONAL pool: a version with no measured evidence from a
 * given family simply contributes nothing from it — never an error.
 */
import type {
  FormulaVersionCompositionRow,
  FormulaVersionDoeRow,
  FormulaVersionStabilityRow,
  FormulaVersionTargetRow,
  FormulaVersionTestResultRow,
  SourceRecordReference,
  TargetObservation,
} from "../schemas/dataset";
import { FEATURE_SCHEMA_VERSION, formulaVersionTargetRowSchema } from "../schemas/dataset";
import type { DoeDesign, DoeResponse } from "../schemas/doe";
import type { TestMethodSnapshot } from "../schemas/laboratoryStandards";
import { normalizeQuantity } from "./formulaVersionFeatureExtractor";

export type FormulaVersionTargetExtractionErrorCode =
  | "formula_version_composition_not_found"
  | "duplicate_formula_version_composition_row"
  | "duplicate_formula_version_test_result_row"
  | "test_result_row_formula_version_conflict"
  | "duplicate_formula_version_stability_row"
  | "stability_row_formula_version_conflict"
  | "duplicate_formula_version_doe_row"
  | "doe_row_formula_version_conflict"
  | "doe_design_study_conflict"
  | "doe_design_response_snapshot_conflict"
  | "duplicate_doe_design_response_id"
  | "doe_observation_response_not_found"
  | "row_schema_validation_failed";

/** Truthful, correctly-named structured error context — the same
 *  discipline every prior FVL-05 extractor's error class follows (never
 *  one overloaded field holding whatever identity happened to be at
 *  hand). */
export interface FormulaVersionTargetExtractionErrorContext {
  formulaVersionId?: string;
  studyId?: string;
  designId?: string;
  runId?: string;
  observationId?: string;
  responseId?: string;
}

export class FormulaVersionTargetExtractionError extends Error {
  readonly code: FormulaVersionTargetExtractionErrorCode;
  readonly formulaVersionId?: string;
  readonly studyId?: string;
  readonly designId?: string;
  readonly runId?: string;
  readonly observationId?: string;
  readonly responseId?: string;

  constructor(
    code: FormulaVersionTargetExtractionErrorCode,
    message: string,
    context: FormulaVersionTargetExtractionErrorContext = {},
  ) {
    super(message);
    this.name = "FormulaVersionTargetExtractionError";
    this.code = code;
    this.formulaVersionId = context.formulaVersionId;
    this.studyId = context.studyId;
    this.designId = context.designId;
    this.runId = context.runId;
    this.observationId = context.observationId;
    this.responseId = context.responseId;
  }
}

export interface FormulaVersionTargetExtractionInput {
  /** The exact formula version ids requested for extraction, in the order
   *  rows should be produced. */
  formulaVersionIds: string[];
  /** Required pool: every requested id must resolve to exactly one
   *  composition row — the source of `formulaId`/`formulaCode`/
   *  `formulaVersionNumber`/`productFamilyCode` this extractor reuses
   *  rather than re-resolving. */
  compositionRows: FormulaVersionCompositionRow[];
  /** Each optional pool below may omit an entry for a requested version
   *  (that family simply contributes no target evidence) but may never
   *  contain MORE than one row for the same `formulaVersionId`, and any
   *  row it does supply must agree with the composition row on
   *  `formulaId` — both fail closed as a genuine ambiguity/contradiction,
   *  never silently resolved by picking one. */
  testResultRows?: FormulaVersionTestResultRow[];
  stabilityRows?: FormulaVersionStabilityRow[];
  doeRows?: FormulaVersionDoeRow[];
}

/** `TEST_RESULT_TYPES`/`STABILITY` resultType values that never carry
 *  genuine measured evidence — the absence of a judgment, not a label.
 *  `TestResult`/`StabilityResult` share the identical enum and identical
 *  disposition. */
function isUsableTestOrStabilityResult(resultType: string, passFail: string): boolean {
  if (resultType === "pass_fail") return passFail === "pass" || passFail === "fail";
  return true;
}

interface MeasuredResultLike {
  id: string;
  testDefinitionId: string;
  resultType: string;
  unit?: string;
  passFail: string;
  replicates: { replicateNumber: number; numericValue?: string; isOutlier: boolean }[];
  textValue?: string;
  categoricalValue?: string;
  booleanValue?: boolean;
}

/** Builds the `context` object for a `testResult` observation from
 *  `TestResult.sampleId`/`.instrument`/`.methodSnapshot` — see
 *  `targetObservationContextSchema`'s own header comment
 *  (`AUDIT_FVL05_GPT_000015` corrective finding B) for why these are
 *  instance context, not identity. Returns `undefined` (never an
 *  all-fields-undefined object) when none of the three fields are set —
 *  the ordinary case for the human-recorded `TrialsPanel.tsx` writer
 *  path, which sets none of them. */
function buildTestResultContext(result: {
  sampleId?: string;
  instrument?: string;
  methodSnapshot?: TestMethodSnapshot;
}): TargetObservation["context"] {
  if (result.sampleId === undefined && result.instrument === undefined && result.methodSnapshot === undefined) return undefined;
  return { sampleId: result.sampleId, instrument: result.instrument, methodSnapshot: result.methodSnapshot };
}

/** Shared walk for `TestResult` and `StabilityResult` — structurally
 *  identical `resultType`-driven value disposition (see this file's own
 *  header comment / `schemas/dataset.ts`'s target-row header comment for
 *  the full per-`resultType` mapping and why).
 *
 *  `AUDIT_FVL05_GPT_000015` corrective finding A: `ReplicateStats`
 *  (`mean`/`minimum`/`maximum`/`standardDeviation`) is NEVER emitted as a
 *  target observation — `schemas/testDefinitions.ts`'s own
 *  `replicateStatsSchema` header comment states it is "computed purely
 *  from replicates... the replicates remain the source of truth." Only
 *  the actual `replicates[]` are measured ground truth; a persisted
 *  cache of their own aggregate is not a second, independent
 *  measurement. Only the definition/context/citation shape differs
 *  between the `testResult`/`stabilityResult` callers. */
function collectMeasuredResultTarget(
  result: MeasuredResultLike,
  buildDefinition: () => TargetObservation["targetDefinition"],
  context: TargetObservation["context"],
  sourceEntity: "testResult" | "stabilityResult",
): TargetObservation[] {
  if (!isUsableTestOrStabilityResult(result.resultType, result.passFail)) return [];
  const citation: SourceRecordReference[] = [{ sourceEntity, sourceRecordId: result.id }];
  const observations: TargetObservation[] = [];
  const push = (value: TargetObservation["value"], detail: string | undefined, isOutlier: boolean) => {
    observations.push({ targetDefinition: buildDefinition(), value, detail, isOutlier, context, sourceRecords: citation });
  };

  if (result.resultType === "numeric" || result.resultType === "visual_rating") {
    for (const replicate of result.replicates) {
      const normalized = normalizeQuantity(replicate.numericValue, result.unit);
      if (normalized) push({ kind: "numeric", ...normalized }, String(replicate.replicateNumber), replicate.isOutlier);
    }
  } else if (result.resultType === "text") {
    if (result.textValue !== undefined) push({ kind: "text", text: result.textValue }, undefined, false);
  } else if (result.resultType === "categorical") {
    if (result.categoricalValue !== undefined) push({ kind: "categorical", categorical: result.categoricalValue }, undefined, false);
  } else if (result.resultType === "boolean") {
    if (result.booleanValue !== undefined) push({ kind: "boolean", boolean: result.booleanValue }, undefined, false);
  } else if (result.resultType === "pass_fail") {
    if (result.passFail === "pass" || result.passFail === "fail") {
      push({ kind: "passFail", passFail: result.passFail }, undefined, false);
    }
  }
  return observations;
}

function collectTestResultTargets(row: FormulaVersionTestResultRow, productFamilyCode: string): TargetObservation[] {
  const observations: TargetObservation[] = [];
  for (const trial of row.trials) {
    for (const result of trial.testResults) {
      observations.push(
        ...collectMeasuredResultTarget(
          result,
          () => ({
            productFamilyCode,
            sourceEntity: "testResult",
            testDefinitionId: result.testDefinitionId,
            timePoint: result.timePoint,
            storageCondition: result.storageCondition,
          }),
          buildTestResultContext(result),
          "testResult",
        ),
      );
    }
  }
  return observations;
}

function collectStabilityTargets(row: FormulaVersionStabilityRow, productFamilyCode: string): TargetObservation[] {
  const observations: TargetObservation[] = [];
  for (const study of row.studies) {
    for (const sampleResults of study.samples) {
      for (const result of sampleResults.results) {
        observations.push(
          ...collectMeasuredResultTarget(
            result,
            () => ({
              productFamilyCode,
              sourceEntity: "stabilityResult",
              testDefinitionId: result.testDefinitionId,
              conditionId: result.conditionId,
              timePointId: result.timePointId,
            }),
            undefined,
            "stabilityResult",
          ),
        );
      }
    }
  }
  return observations;
}

const DOE_NON_EVIDENCE_STATUSES = new Set(["missing", "invalid", "excluded"]);
const DOE_OUTLIER_STATUSES = new Set(["outlier_flagged", "outlier_confirmed"]);

/** One design's frozen `responseSnapshot` resolved into a unit-only
 *  dictionary. Mirrors `formulaVersionFeatureExtractor.ts`'s own
 *  `buildDoeUnitIndex`/`collectDoeEntries` corrective-cycle checks
 *  (`AUDIT_FVL05_GPT_000013`) — duplicated here rather than imported,
 *  matching this codebase's own established convention for a small,
 *  extractor-local helper (see `compareOrdinal`/`isCanonicalIsoTimestamp`
 *  across FVL-05.004-.007), and because this extractor's error class is
 *  intentionally its own, not shared with FVL-05.009's. Fails closed on a
 *  design whose own `studyId`/`studyRevision` contradicts the study
 *  wrapper it is nested under in this row, on a `responseSnapshot` child
 *  whose `studyId`/`studyRevision` contradicts the owning design, and on
 *  a duplicate response `id` within one design's own snapshot — before
 *  any of it is ever trusted as unit authority for an observation's
 *  value. */
function buildDoeResponseUnitIndex(
  design: DoeDesign,
  study: { studyId: string; studyRevision: number },
): Map<string, DoeResponse> {
  if (design.studyId !== study.studyId || design.studyRevision !== study.studyRevision) {
    throw new FormulaVersionTargetExtractionError(
      "doe_design_study_conflict",
      `DOE design "${design.id}" claims studyId "${design.studyId}"/studyRevision ${design.studyRevision}, but the study it is nested under in this row has studyId "${study.studyId}"/studyRevision ${study.studyRevision}.`,
      { designId: design.id, studyId: study.studyId },
    );
  }
  const responseUnitById = new Map<string, DoeResponse>();
  for (const response of design.responseSnapshot) {
    if (response.studyId !== design.studyId || response.studyRevision !== design.studyRevision) {
      throw new FormulaVersionTargetExtractionError(
        "doe_design_response_snapshot_conflict",
        `DOE design "${design.id}" responseSnapshot response "${response.id}" claims studyId "${response.studyId}"/studyRevision ${response.studyRevision}, but the owning design has studyId "${design.studyId}"/studyRevision ${design.studyRevision}.`,
        { designId: design.id, responseId: response.id },
      );
    }
    if (responseUnitById.has(response.id)) {
      throw new FormulaVersionTargetExtractionError(
        "duplicate_doe_design_response_id",
        `Ambiguous exact DOE response identity: DOE design "${design.id}" responseSnapshot has more than one response with id "${response.id}".`,
        { designId: design.id, responseId: response.id },
      );
    }
    responseUnitById.set(response.id, response);
  }
  return responseUnitById;
}

function collectDoeTargets(row: FormulaVersionDoeRow, productFamilyCode: string): TargetObservation[] {
  const observations: TargetObservation[] = [];
  for (const study of row.studies) {
    for (const designEntry of study.designs) {
      const responseUnitById = buildDoeResponseUnitIndex(designEntry.design, study);
      for (const runEntry of designEntry.runs) {
        for (const observation of runEntry.observations) {
          if (DOE_NON_EVIDENCE_STATUSES.has(observation.status)) continue;
          const response = responseUnitById.get(observation.responseId);
          if (!response) {
            throw new FormulaVersionTargetExtractionError(
              "doe_observation_response_not_found",
              `DOE observation "${observation.id}" references responseId "${observation.responseId}", which was not found in its run's design "${designEntry.design.id}" responseSnapshot.`,
              { observationId: observation.id, runId: runEntry.run.id, responseId: observation.responseId },
            );
          }
          const isOutlier = DOE_OUTLIER_STATUSES.has(observation.status);
          const targetDefinition = { productFamilyCode, sourceEntity: "doeObservation" as const, responseId: observation.responseId };
          const citation: SourceRecordReference[] = [{ sourceEntity: "doeObservation", sourceRecordId: observation.id }];
          const normalized = normalizeQuantity(observation.value, response.unit);
          if (normalized) {
            observations.push({ targetDefinition, value: { kind: "numeric", ...normalized }, isOutlier, sourceRecords: citation });
          }
          if (observation.textValue !== undefined) {
            observations.push({ targetDefinition, value: { kind: "text", text: observation.textValue }, isOutlier, sourceRecords: citation });
          }
        }
      }
    }
  }
  return observations;
}

/** Builds the exact `formulaVersionId` lookup for an optional row-family
 *  pool, failing closed on more than one row for the same version
 *  (ambiguous) and on a row whose `formulaId` contradicts the composition
 *  row's `formulaId` for the same version — see
 *  `formulaVersionFeatureExtractor.ts`'s identical helper for the full
 *  rationale. */
function buildOptionalRowIndex<T extends { formulaVersionId: string; formulaId: string }>(
  rows: T[] | undefined,
  compositionByVersionId: Map<string, FormulaVersionCompositionRow>,
  duplicateCode: FormulaVersionTargetExtractionErrorCode,
  conflictCode: FormulaVersionTargetExtractionErrorCode,
): Map<string, T> {
  const byVersionId = new Map<string, T>();
  for (const row of rows ?? []) {
    if (byVersionId.has(row.formulaVersionId)) {
      throw new FormulaVersionTargetExtractionError(
        duplicateCode,
        `Ambiguous exact formula version identity: more than one supplied row has formulaVersionId "${row.formulaVersionId}".`,
        { formulaVersionId: row.formulaVersionId },
      );
    }
    const composition = compositionByVersionId.get(row.formulaVersionId);
    if (composition && composition.formulaId !== row.formulaId) {
      throw new FormulaVersionTargetExtractionError(
        conflictCode,
        `Row for formula version "${row.formulaVersionId}" claims formulaId "${row.formulaId}", but the composition row for the same version has formulaId "${composition.formulaId}".`,
        { formulaVersionId: row.formulaVersionId },
      );
    }
    byVersionId.set(row.formulaVersionId, row);
  }
  return byVersionId;
}

/** Deduplicates an aggregated lineage array on the exact
 *  `(sourceEntity, parentRecordId, sourceRecordId)` triple
 *  `sourceRecordLineageSchema` itself enforces uniqueness on — see
 *  `formulaVersionFeatureExtractor.ts`'s identical helper. */
function dedupeLineage(refs: SourceRecordReference[]): SourceRecordReference[] {
  const seen = new Set<string>();
  const result: SourceRecordReference[] = [];
  for (const ref of refs) {
    const key = JSON.stringify([ref.sourceEntity, ref.parentRecordId ?? null, ref.sourceRecordId]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

function extractOne(
  compositionRow: FormulaVersionCompositionRow,
  testResultRow: FormulaVersionTestResultRow | undefined,
  stabilityRow: FormulaVersionStabilityRow | undefined,
  doeRow: FormulaVersionDoeRow | undefined,
): FormulaVersionTargetRow {
  const contributingRows = [compositionRow, testResultRow, stabilityRow, doeRow].filter(
    (row): row is NonNullable<typeof row> => row !== undefined,
  );
  const sourceRecords = dedupeLineage(contributingRows.flatMap((row) => row.sourceRecords));
  const productFamilyCode = compositionRow.productFamilyCode;

  const targetObservations: TargetObservation[] = [
    ...(testResultRow ? collectTestResultTargets(testResultRow, productFamilyCode) : []),
    ...(stabilityRow ? collectStabilityTargets(stabilityRow, productFamilyCode) : []),
    ...(doeRow ? collectDoeTargets(doeRow, productFamilyCode) : []),
  ];

  const row = {
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    sourceRecords,
    formulaId: compositionRow.formulaId,
    formulaCode: compositionRow.formulaCode,
    formulaVersionId: compositionRow.formulaVersionId,
    formulaVersionNumber: compositionRow.formulaVersionNumber,
    productFamilyCode,
    targetObservations,
  };

  const parsed = formulaVersionTargetRowSchema.safeParse(row);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new FormulaVersionTargetExtractionError(
      "row_schema_validation_failed",
      `Extracted target row for formula version "${compositionRow.formulaVersionId}" failed schema validation: ${issues}`,
      { formulaVersionId: compositionRow.formulaVersionId },
    );
  }
  return parsed.data;
}

/** Emits exactly one `FormulaVersionTargetRow` per requested formula
 *  version id, in the requested order. Throws (fails closed) on the first
 *  requested id with no composition row, an ambiguous/contradictory
 *  optional-family row, an unresolvable DOE response unit, or a
 *  constructed row that fails schema validation — never silently drops or
 *  partially emits a row instead. */
export function extractFormulaVersionTargetRows(input: FormulaVersionTargetExtractionInput): FormulaVersionTargetRow[] {
  const compositionByVersionId = new Map<string, FormulaVersionCompositionRow>();
  for (const row of input.compositionRows) {
    if (compositionByVersionId.has(row.formulaVersionId)) {
      throw new FormulaVersionTargetExtractionError(
        "duplicate_formula_version_composition_row",
        `Ambiguous exact formula version identity: more than one supplied composition row has formulaVersionId "${row.formulaVersionId}".`,
        { formulaVersionId: row.formulaVersionId },
      );
    }
    compositionByVersionId.set(row.formulaVersionId, row);
  }

  const testResultByVersionId = buildOptionalRowIndex(
    input.testResultRows,
    compositionByVersionId,
    "duplicate_formula_version_test_result_row",
    "test_result_row_formula_version_conflict",
  );
  const stabilityByVersionId = buildOptionalRowIndex(
    input.stabilityRows,
    compositionByVersionId,
    "duplicate_formula_version_stability_row",
    "stability_row_formula_version_conflict",
  );
  const doeByVersionId = buildOptionalRowIndex(
    input.doeRows,
    compositionByVersionId,
    "duplicate_formula_version_doe_row",
    "doe_row_formula_version_conflict",
  );

  return input.formulaVersionIds.map((requestedId) => {
    const compositionRow = compositionByVersionId.get(requestedId);
    if (!compositionRow) {
      throw new FormulaVersionTargetExtractionError(
        "formula_version_composition_not_found",
        `Requested formula version id "${requestedId}" was not found among the supplied composition rows.`,
        { formulaVersionId: requestedId },
      );
    }
    return extractOne(
      compositionRow,
      testResultByVersionId.get(requestedId),
      stabilityByVersionId.get(requestedId),
      doeByVersionId.get(requestedId),
    );
  });
}
