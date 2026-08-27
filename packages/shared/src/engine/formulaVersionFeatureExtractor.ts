/**
 * FVL-05.009 — the extractor: normalizes the six already-extracted
 * FVL-05.003-.008 `FormulaVersion*Row` families into one
 * `FormulaVersionFeatureRow` per requested formula version.
 *
 * See `schemas/dataset.ts`'s header comment on `formulaVersionFeatureRowSchema`
 * (immediately above `NORMALIZED_QUANTITY_SOURCE_PATHS`) for the full
 * recovered source contract: the exact value+unit field pairs normalized,
 * the ones deliberately excluded and why, the anti-target-leakage
 * reasoning, and why neither `DATASET_SCHEMA_VERSION` nor
 * `FEATURE_SCHEMA_VERSION` bumps for this task.
 *
 * Pure and deterministic: no persistence, no mutation of its inputs
 * (`normalizeQuantity` never writes back onto a source row; every
 * `sourceRecords` array is freshly built, never a reused reference into a
 * caller's array), no generated ids/timestamps. Every input row family is
 * walked in the order it already appears in the row (each of the six input
 * rows was already deterministically ordered by its own originating
 * extractor — this task does not re-sort them, only reads them).
 *
 * A `compositionRow` is required per requested version (a version always
 * has one — `extractFormulaVersionDatasetRows` guarantees this, the same
 * way every other FVL-05 extractor treats composition as the one
 * always-present family). The other five row families are each an
 * independent OPTIONAL pool: a version with no process/test-result/
 * stability/DOE/corrective-cost data simply contributes nothing from that
 * family — never an error, never fabricated.
 */
import type {
  FormulaVersionCompositionRow,
  FormulaVersionCorrectiveCostContextRow,
  FormulaVersionDoeRow,
  FormulaVersionFeatureRow,
  FormulaVersionProcessRow,
  FormulaVersionStabilityRow,
  FormulaVersionTestResultRow,
  NormalizedQuantity,
  NormalizedQuantityCanonicalUnit,
  NormalizedQuantitySourcePath,
  SourceRecordReference,
} from "../schemas/dataset";
import { FEATURE_SCHEMA_VERSION, formulaVersionFeatureRowSchema } from "../schemas/dataset";
import type { DoeDesign, DoeFactor, DoeResponse } from "../schemas/doe";
import { dec, fmt } from "./decimal";
import { convertUnit, unitDimension } from "./unitConversion";

export type FormulaVersionFeatureExtractionErrorCode =
  | "formula_version_composition_not_found"
  | "duplicate_formula_version_composition_row"
  | "duplicate_formula_version_process_row"
  | "process_row_formula_version_conflict"
  | "duplicate_formula_version_test_result_row"
  | "test_result_row_formula_version_conflict"
  | "duplicate_formula_version_stability_row"
  | "stability_row_formula_version_conflict"
  | "duplicate_formula_version_doe_row"
  | "doe_row_formula_version_conflict"
  | "duplicate_formula_version_corrective_cost_context_row"
  | "corrective_cost_context_row_formula_version_conflict"
  | "doe_design_factor_snapshot_conflict"
  | "duplicate_doe_design_factor_code"
  | "doe_design_response_snapshot_conflict"
  | "duplicate_doe_design_response_id"
  | "doe_design_study_conflict"
  | "doe_run_factor_code_not_found"
  | "doe_observation_response_not_found"
  | "row_schema_validation_failed";

/** Truthful, correctly-named structured error context — the same
 *  discipline every prior FVL-05 extractor's error class follows (never one
 *  overloaded field holding whatever identity happened to be at hand). */
export interface FormulaVersionFeatureExtractionErrorContext {
  formulaVersionId?: string;
  studyId?: string;
  designId?: string;
  runId?: string;
  observationId?: string;
  factorCode?: string;
  responseId?: string;
}

export class FormulaVersionFeatureExtractionError extends Error {
  readonly code: FormulaVersionFeatureExtractionErrorCode;
  readonly formulaVersionId?: string;
  readonly studyId?: string;
  readonly designId?: string;
  readonly runId?: string;
  readonly observationId?: string;
  readonly factorCode?: string;
  readonly responseId?: string;

  constructor(
    code: FormulaVersionFeatureExtractionErrorCode,
    message: string,
    context: FormulaVersionFeatureExtractionErrorContext = {},
  ) {
    super(message);
    this.name = "FormulaVersionFeatureExtractionError";
    this.code = code;
    this.formulaVersionId = context.formulaVersionId;
    this.studyId = context.studyId;
    this.designId = context.designId;
    this.runId = context.runId;
    this.observationId = context.observationId;
    this.factorCode = context.factorCode;
    this.responseId = context.responseId;
  }
}

export interface FormulaVersionFeatureExtractionInput {
  /** The exact formula version ids requested for extraction, in the order
   *  rows should be produced. */
  formulaVersionIds: string[];
  /** Required pool: every requested id must resolve to exactly one
   *  composition row. */
  compositionRows: FormulaVersionCompositionRow[];
  /** Each optional pool below may omit an entry for a requested version
   *  (that family simply contributes nothing) but may never contain MORE
   *  than one row for the same `formulaVersionId`, and any row it does
   *  supply must agree with the composition row on `formulaId` — both fail
   *  closed as a genuine ambiguity/contradiction, never silently resolved
   *  by picking one. */
  processRows?: FormulaVersionProcessRow[];
  testResultRows?: FormulaVersionTestResultRow[];
  stabilityRows?: FormulaVersionStabilityRow[];
  doeRows?: FormulaVersionDoeRow[];
  correctiveCostContextRows?: FormulaVersionCorrectiveCostContextRow[];
}

/** The exact, deterministic conversion this whole task rests on — see
 *  `schemas/dataset.ts`'s own header comment for the full rationale.
 *  Exported for direct, focused unit testing independent of any row
 *  family. */
export function normalizeQuantity(
  rawValue: string | undefined,
  rawUnit: string | undefined,
): { raw: string; rawUnit?: string; canonicalUnit?: NormalizedQuantityCanonicalUnit; canonicalValue?: string; normalized: boolean } | undefined {
  if (rawValue === undefined) return undefined;
  if (rawUnit === undefined) {
    return { raw: rawValue, normalized: false };
  }
  const dimension = unitDimension(rawUnit);
  if (!dimension) {
    return { raw: rawValue, rawUnit, normalized: false };
  }
  const target = dimension === "mass" ? "g" : "ml";
  const outcome = convertUnit(Number(rawValue), rawUnit, target);
  if (outcome.error !== undefined || outcome.value === undefined || !Number.isFinite(outcome.value)) {
    // A recognized dimension that still could not be converted (e.g. a
    // decimalString whose magnitude overflows a double) is preserved raw,
    // not thrown — the same "never guess, never fabricate" discipline as
    // an unrecognized unit, just reached by a different path.
    return { raw: rawValue, rawUnit, normalized: false };
  }
  return {
    raw: rawValue,
    rawUnit,
    canonicalUnit: dimension === "mass" ? "g" : "mL",
    canonicalValue: fmt(dec(outcome.value), "quantity"),
    normalized: true,
  };
}

function pushEntry(
  entries: NormalizedQuantity[],
  path: NormalizedQuantitySourcePath,
  normalized: ReturnType<typeof normalizeQuantity>,
  sourceRecords: SourceRecordReference[],
  detail?: string,
): void {
  if (!normalized) return;
  entries.push({ path, detail, ...normalized, sourceRecords });
}

function collectCompositionEntries(row: FormulaVersionCompositionRow): NormalizedQuantity[] {
  const entries: NormalizedQuantity[] = [];
  for (const line of row.composition) {
    pushEntry(entries, "composition.line.quantity", normalizeQuantity(line.quantity, line.quantityUnit), [
      { sourceEntity: "formulationLine", sourceRecordId: line.id },
    ]);
  }
  return entries;
}

function collectProcessEntries(row: FormulaVersionProcessRow): NormalizedQuantity[] {
  const entries: NormalizedQuantity[] = [];
  for (const trial of row.trials) {
    for (const obs of trial.actualStepObservations) {
      pushEntry(entries, "process.actualStep.viscosity", normalizeQuantity(obs.actualViscosity, obs.viscosityUnit), [
        { sourceEntity: "trialProcessStep", sourceRecordId: obs.processStepId, parentRecordId: trial.trialId },
      ]);
    }
  }
  return entries;
}

const STATS_FIELDS = ["mean", "minimum", "maximum", "standardDeviation"] as const;

function collectTestResultEntries(row: FormulaVersionTestResultRow): NormalizedQuantity[] {
  const entries: NormalizedQuantity[] = [];
  for (const trial of row.trials) {
    for (const result of trial.testResults) {
      const citation: SourceRecordReference[] = [{ sourceEntity: "testResult", sourceRecordId: result.id }];
      for (const replicate of result.replicates) {
        pushEntry(
          entries,
          "testResult.replicate.numericValue",
          normalizeQuantity(replicate.numericValue, result.unit),
          citation,
          String(replicate.replicateNumber),
        );
      }
      if (result.stats) {
        for (const statField of STATS_FIELDS) {
          const path = `testResult.stats.${statField}` as NormalizedQuantitySourcePath;
          pushEntry(entries, path, normalizeQuantity(result.stats[statField], result.unit), citation);
        }
      }
    }
  }
  return entries;
}

function collectStabilityEntries(row: FormulaVersionStabilityRow): NormalizedQuantity[] {
  const entries: NormalizedQuantity[] = [];
  for (const study of row.studies) {
    for (const sampleResults of study.samples) {
      for (const result of sampleResults.results) {
        const citation: SourceRecordReference[] = [{ sourceEntity: "stabilityResult", sourceRecordId: result.id }];
        for (const replicate of result.replicates) {
          pushEntry(
            entries,
            "stabilityResult.replicate.numericValue",
            normalizeQuantity(replicate.numericValue, result.unit),
            citation,
            String(replicate.replicateNumber),
          );
        }
        if (result.stats) {
          for (const statField of STATS_FIELDS) {
            const path = `stabilityResult.stats.${statField}` as NormalizedQuantitySourcePath;
            pushEntry(entries, path, normalizeQuantity(result.stats[statField], result.unit), citation);
          }
        }
      }
    }
  }
  return entries;
}

/** One design's frozen `factorSnapshot`/`responseSnapshot` resolved into
 *  unit-only dictionaries, failing closed on the same two invariants
 *  `formulaVersionDoeDatasetExtractor.ts`'s own (unexported)
 *  `buildDesignSnapshotIndex` already guards against — re-checked here,
 *  independently, because this extractor's own contract (a `doeRow` need
 *  not have come from that extractor) cannot simply trust a caller-supplied
 *  invariant it did not itself verify:
 *
 *  CORRECTIVE CYCLE (`AUDIT_FVL05_GPT_000013`, 2026-08-27): the original
 *  implementation only checked duplicate `factorCode`/response `id` — it
 *  never verified a snapshot child's own `studyId`/`studyRevision` agree
 *  with the OWNING design's before trusting it as unit authority, so a
 *  malformed caller-supplied `FormulaVersionDoeRow` could smuggle a
 *  factor/response belonging to a DIFFERENT study revision into this
 *  design's unit resolution. Both checks now run BEFORE the duplicate
 *  check (same ordering FVL-05.007's own `buildDesignSnapshotIndex`
 *  uses), failing closed with the already-declared
 *  `doe_design_factor_snapshot_conflict`/`doe_design_response_snapshot_conflict`
 *  codes (previously declared in the error union but never thrown —
 *  dead code until this cycle). Validation-only: no persisted run/
 *  observation value is recomputed, no live DOE factor/response pool is
 *  consulted as a fallback. */
function buildDoeUnitIndex(design: DoeDesign): { factorUnitByCode: Map<string, DoeFactor>; responseUnitById: Map<string, DoeResponse> } {
  const factorUnitByCode = new Map<string, DoeFactor>();
  for (const factor of design.factorSnapshot) {
    if (factor.studyId !== design.studyId || factor.studyRevision !== design.studyRevision) {
      throw new FormulaVersionFeatureExtractionError(
        "doe_design_factor_snapshot_conflict",
        `DOE design "${design.id}" factorSnapshot factor "${factor.factorCode}" claims studyId "${factor.studyId}"/studyRevision ${factor.studyRevision}, but the owning design has studyId "${design.studyId}"/studyRevision ${design.studyRevision}.`,
        { designId: design.id, factorCode: factor.factorCode },
      );
    }
    if (factorUnitByCode.has(factor.factorCode)) {
      throw new FormulaVersionFeatureExtractionError(
        "duplicate_doe_design_factor_code",
        `Ambiguous exact DOE factor identity: DOE design "${design.id}" factorSnapshot has more than one factor with factorCode "${factor.factorCode}".`,
        { designId: design.id, factorCode: factor.factorCode },
      );
    }
    factorUnitByCode.set(factor.factorCode, factor);
  }
  const responseUnitById = new Map<string, DoeResponse>();
  for (const response of design.responseSnapshot) {
    if (response.studyId !== design.studyId || response.studyRevision !== design.studyRevision) {
      throw new FormulaVersionFeatureExtractionError(
        "doe_design_response_snapshot_conflict",
        `DOE design "${design.id}" responseSnapshot response "${response.id}" claims studyId "${response.studyId}"/studyRevision ${response.studyRevision}, but the owning design has studyId "${design.studyId}"/studyRevision ${design.studyRevision}.`,
        { designId: design.id, responseId: response.id },
      );
    }
    if (responseUnitById.has(response.id)) {
      throw new FormulaVersionFeatureExtractionError(
        "duplicate_doe_design_response_id",
        `Ambiguous exact DOE response identity: DOE design "${design.id}" responseSnapshot has more than one response with id "${response.id}".`,
        { designId: design.id, responseId: response.id },
      );
    }
    responseUnitById.set(response.id, response);
  }
  return { factorUnitByCode, responseUnitById };
}

/** Independently found during the `AUDIT_FVL05_GPT_000013` corrective
 *  re-audit (not itself named by that audit, but the same class of defect
 *  it targeted): `buildDoeUnitIndex()` now proves a factor/response
 *  snapshot child agrees with its OWNING DESIGN, but a design's own claimed
 *  `studyId`/`studyRevision` was never cross-checked against the STUDY
 *  WRAPPER it is nested under in this row (`doeStudyRunsSchema`) — the same
 *  "resolve both sides of a nested identity, fail closed on contradiction"
 *  gap one level up. `formulaVersionDoeDatasetExtractor.ts`'s own
 *  `buildDesignsByStudyId` already enforces this exact check
 *  (`doe_design_study_conflict`) when it resolves a design against a live
 *  `doeStudies`/`doeDesigns` pool; this extractor performs the equivalent
 *  check here against the row's own nested structure, since it accepts an
 *  already-assembled `FormulaVersionDoeRow` rather than resolving pools
 *  itself. Fails closed BEFORE the design is ever trusted as factor/
 *  response unit authority. */
function collectDoeEntries(row: FormulaVersionDoeRow): NormalizedQuantity[] {
  const entries: NormalizedQuantity[] = [];
  for (const study of row.studies) {
    for (const designEntry of study.designs) {
      const { design } = designEntry;
      if (design.studyId !== study.studyId || design.studyRevision !== study.studyRevision) {
        throw new FormulaVersionFeatureExtractionError(
          "doe_design_study_conflict",
          `DOE design "${design.id}" claims studyId "${design.studyId}"/studyRevision ${design.studyRevision}, but the study it is nested under in this row has studyId "${study.studyId}"/studyRevision ${study.studyRevision}.`,
          { designId: design.id, studyId: study.studyId },
        );
      }
      const { factorUnitByCode, responseUnitById } = buildDoeUnitIndex(design);
      for (const runEntry of designEntry.runs) {
        const { run, observations } = runEntry;
        for (const setting of run.factorSettings) {
          const factor = factorUnitByCode.get(setting.factorCode);
          if (!factor) {
            throw new FormulaVersionFeatureExtractionError(
              "doe_run_factor_code_not_found",
              `DOE run "${run.id}" has a factorSettings entry with factorCode "${setting.factorCode}", which was not found in its design "${designEntry.design.id}" factorSnapshot.`,
              { runId: run.id, designId: designEntry.design.id, factorCode: setting.factorCode },
            );
          }
          pushEntry(
            entries,
            "doe.factorSetting.actualValue",
            normalizeQuantity(setting.actualValue, factor.unit),
            [{ sourceEntity: "doeRun", sourceRecordId: run.id }],
            setting.factorCode,
          );
        }
        for (const observation of observations) {
          const response = responseUnitById.get(observation.responseId);
          if (!response) {
            throw new FormulaVersionFeatureExtractionError(
              "doe_observation_response_not_found",
              `DOE observation "${observation.id}" references responseId "${observation.responseId}", which was not found in its run's design "${designEntry.design.id}" responseSnapshot.`,
              { observationId: observation.id, runId: run.id, responseId: observation.responseId },
            );
          }
          pushEntry(entries, "doe.observation.value", normalizeQuantity(observation.value, response.unit), [
            { sourceEntity: "doeObservation", sourceRecordId: observation.id },
          ]);
        }
      }
    }
  }
  return entries;
}

function collectCorrectiveCostContextEntries(row: FormulaVersionCorrectiveCostContextRow): NormalizedQuantity[] {
  const entries: NormalizedQuantity[] = [];
  for (const snapshot of row.costSnapshots) {
    const citation: SourceRecordReference[] = [{ sourceEntity: "costSnapshot", sourceRecordId: snapshot.code }];
    for (const line of snapshot.lines) {
      pushEntry(entries, "costSnapshot.costLine.quantityKg", normalizeQuantity(line.quantityKg, "kg"), citation, line.lineId);
    }
    for (const skuCost of snapshot.skuCosts) {
      pushEntry(
        entries,
        "costSnapshot.skuCost.fillQuantity",
        normalizeQuantity(skuCost.fillQuantity, skuCost.fillUnit),
        citation,
        skuCost.skuCode,
      );
    }
  }
  for (const context of row.packagingContext) {
    pushEntry(
      entries,
      "packagingContext.fillQuantity",
      normalizeQuantity(context.packagingSnapshot.fillQuantity, context.packagingSnapshot.fillUnit),
      [{ sourceEntity: "stabilityStudy", sourceRecordId: context.studyId }],
      context.packagingSkuCode,
    );
  }
  return entries;
}

/** Builds the exact `formulaVersionId` lookup for an optional row-family
 *  pool, failing closed on more than one row for the same version
 *  (ambiguous — which one is authoritative is not this extractor's call to
 *  make) and on a row whose `formulaId` contradicts the composition row's
 *  `formulaId` for the same version (a genuine denormalized-field
 *  contradiction, the same discipline every prior FVL-05 extractor applies
 *  to a linked record's redundant fields). */
function buildOptionalRowIndex<T extends { formulaVersionId: string; formulaId: string }>(
  rows: T[] | undefined,
  compositionByVersionId: Map<string, FormulaVersionCompositionRow>,
  duplicateCode: FormulaVersionFeatureExtractionErrorCode,
  conflictCode: FormulaVersionFeatureExtractionErrorCode,
): Map<string, T> {
  const byVersionId = new Map<string, T>();
  for (const row of rows ?? []) {
    if (byVersionId.has(row.formulaVersionId)) {
      throw new FormulaVersionFeatureExtractionError(
        duplicateCode,
        `Ambiguous exact formula version identity: more than one supplied row has formulaVersionId "${row.formulaVersionId}".`,
        { formulaVersionId: row.formulaVersionId },
      );
    }
    const composition = compositionByVersionId.get(row.formulaVersionId);
    if (composition && composition.formulaId !== row.formulaId) {
      throw new FormulaVersionFeatureExtractionError(
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
 *  `sourceRecordLineageSchema` itself enforces uniqueness on, preserving
 *  first-seen order — the same "citations for a record referenced by more
 *  than one contributing row are deduplicated at the row level" discipline
 *  FVL-05.007/.008 already established. */
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
  processRow: FormulaVersionProcessRow | undefined,
  testResultRow: FormulaVersionTestResultRow | undefined,
  stabilityRow: FormulaVersionStabilityRow | undefined,
  doeRow: FormulaVersionDoeRow | undefined,
  correctiveCostContextRow: FormulaVersionCorrectiveCostContextRow | undefined,
): FormulaVersionFeatureRow {
  const contributingRows = [compositionRow, processRow, testResultRow, stabilityRow, doeRow, correctiveCostContextRow].filter(
    (row): row is NonNullable<typeof row> => row !== undefined,
  );
  const sourceRecords = dedupeLineage(contributingRows.flatMap((row) => row.sourceRecords));

  const normalizedQuantities: NormalizedQuantity[] = [
    ...collectCompositionEntries(compositionRow),
    ...(processRow ? collectProcessEntries(processRow) : []),
    ...(testResultRow ? collectTestResultEntries(testResultRow) : []),
    ...(stabilityRow ? collectStabilityEntries(stabilityRow) : []),
    ...(doeRow ? collectDoeEntries(doeRow) : []),
    ...(correctiveCostContextRow ? collectCorrectiveCostContextEntries(correctiveCostContextRow) : []),
  ];

  const row = {
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    sourceRecords,
    formulaId: compositionRow.formulaId,
    formulaCode: compositionRow.formulaCode,
    formulaVersionId: compositionRow.formulaVersionId,
    formulaVersionNumber: compositionRow.formulaVersionNumber,
    normalizedQuantities,
  };

  const parsed = formulaVersionFeatureRowSchema.safeParse(row);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new FormulaVersionFeatureExtractionError(
      "row_schema_validation_failed",
      `Extracted feature row for formula version "${compositionRow.formulaVersionId}" failed schema validation: ${issues}`,
      { formulaVersionId: compositionRow.formulaVersionId },
    );
  }
  return parsed.data;
}

/** Emits exactly one `FormulaVersionFeatureRow` per requested formula
 *  version id, in the requested order. Throws (fails closed) on the first
 *  requested id with no composition row, an ambiguous/contradictory
 *  optional-family row, an unresolvable DOE factor/response unit, or a
 *  constructed row that fails schema validation — never silently drops or
 *  partially emits a row instead. */
export function extractFormulaVersionFeatureRows(input: FormulaVersionFeatureExtractionInput): FormulaVersionFeatureRow[] {
  const compositionByVersionId = new Map<string, FormulaVersionCompositionRow>();
  for (const row of input.compositionRows) {
    if (compositionByVersionId.has(row.formulaVersionId)) {
      throw new FormulaVersionFeatureExtractionError(
        "duplicate_formula_version_composition_row",
        `Ambiguous exact formula version identity: more than one supplied composition row has formulaVersionId "${row.formulaVersionId}".`,
        { formulaVersionId: row.formulaVersionId },
      );
    }
    compositionByVersionId.set(row.formulaVersionId, row);
  }

  const processByVersionId = buildOptionalRowIndex(
    input.processRows,
    compositionByVersionId,
    "duplicate_formula_version_process_row",
    "process_row_formula_version_conflict",
  );
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
  const correctiveCostContextByVersionId = buildOptionalRowIndex(
    input.correctiveCostContextRows,
    compositionByVersionId,
    "duplicate_formula_version_corrective_cost_context_row",
    "corrective_cost_context_row_formula_version_conflict",
  );

  return input.formulaVersionIds.map((requestedId) => {
    const compositionRow = compositionByVersionId.get(requestedId);
    if (!compositionRow) {
      throw new FormulaVersionFeatureExtractionError(
        "formula_version_composition_not_found",
        `Requested formula version id "${requestedId}" was not found among the supplied composition rows.`,
        { formulaVersionId: requestedId },
      );
    }
    return extractOne(
      compositionRow,
      processByVersionId.get(requestedId),
      testResultByVersionId.get(requestedId),
      stabilityByVersionId.get(requestedId),
      doeByVersionId.get(requestedId),
      correctiveCostContextByVersionId.get(requestedId),
    );
  });
}
