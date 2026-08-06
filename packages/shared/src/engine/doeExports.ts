/**
 * Structured import/export for Design of Experiments (spec Phase 5 §17).
 *
 * Export formats: DOE study JSON (full protocol package), factor/constraint
 * CSV/Excel, design-matrix CSV/Excel, run-sheet CSV/Excel, observations
 * CSV/Excel, analysis-results JSON, coefficients/ANOVA CSV/Excel,
 * candidate-list CSV/Excel.
 *
 * Import: factors, constraints and observations reuse the same
 * `previewImport`/`FieldSpec` engine every other CSV import in this codebase
 * uses — same preview-before-commit, row-level-error, duplicate-handling
 * behavior, so a DOE import behaves exactly like every other import in the
 * app. Deliberately NOT offered: importing an "analysis result" as a native
 * `DoeAnalysis` — spec §17: "imported analysis results must never be
 * accepted as native analysis; always recompute from stored observations
 * natively." An analysis JSON export can only ever be exported for
 * inspection, never re-imported as a finished fit.
 */
import type {
  DoeAnalysis,
  DoeCandidate,
  DoeConstraint,
  DoeDesign,
  DoeFactor,
  DoeObservation,
  DoeResponse,
  DoeRun,
  DoeStudy,
} from "../schemas/doe";
import { type FieldSpec, type ImportPreview, parseCsv, previewImport, previewImportRows } from "./importer";
import type { TableExport } from "./labExports";

// ---------------------------------------------------------------------------
// Study JSON export
// ---------------------------------------------------------------------------

export interface DoeStudyExportMeta {
  studyId: string;
  studyCode: string;
  formulationId: string;
  baselineFormulaVersionId: string;
  schemaVersion: string;
  exportTimestamp: string;
}

export function buildDoeStudyExportMeta(study: DoeStudy): DoeStudyExportMeta {
  return {
    studyId: study.id,
    studyCode: study.studyCode,
    formulationId: study.formulationId,
    baselineFormulaVersionId: study.baselineFormulaVersionId,
    schemaVersion: study.schemaVersion,
    exportTimestamp: new Date().toISOString(),
  };
}

/** The full, self-describing JSON package for one study: definition,
 *  factors/constraints/responses, and (if generated) the design and its
 *  runs — everything needed to understand what was studied and how,
 *  without needing to cross-reference other collections. */
export function doeStudyJsonPackage(
  study: DoeStudy,
  meta: DoeStudyExportMeta,
  factors: readonly DoeFactor[],
  constraints: readonly DoeConstraint[],
  responses: readonly DoeResponse[],
  design?: DoeDesign,
  runs: readonly DoeRun[] = [],
): Record<string, unknown> {
  return {
    exportMeta: meta,
    study: {
      studyCode: study.studyCode,
      title: study.title,
      description: study.description ?? null,
      status: study.status,
      designType: study.designType,
      revision: study.revision,
      randomizationEnabled: study.randomizationEnabled,
      blockingEnabled: study.blockingEnabled,
    },
    factors,
    constraints,
    responses,
    design: design
      ? {
          designType: design.designType,
          seed: design.seed,
          runCount: design.runCount,
          replicateCount: design.replicateCount,
          centerPointCount: design.centerPointCount,
          blockCount: design.blockCount,
          diagnostics: design.diagnostics,
        }
      : null,
    runs: runs.map((r) => ({ runNumber: r.runNumber, standardOrder: r.standardOrder, randomizedOrder: r.randomizedOrder, block: r.block, replicate: r.replicate, isCenterPoint: r.isCenterPoint, factorSettings: r.factorSettings, status: r.status })),
  };
}

// ---------------------------------------------------------------------------
// Factor / constraint / response CSV export
// ---------------------------------------------------------------------------

export function doeFactorsCsvRows(factors: readonly DoeFactor[]): TableExport {
  const headers = ["factorCode", "name", "factorType", "sourceType", "sourceEntityId", "unit", "lowValue", "centerValue", "highValue", "categoricalLevels", "precision", "isMixtureComponent"];
  const rows = factors.map((f) => ({
    factorCode: f.factorCode,
    name: f.name,
    factorType: f.factorType,
    sourceType: f.sourceType,
    sourceEntityId: f.sourceEntityId ?? "",
    unit: f.unit ?? "",
    lowValue: f.lowValue ?? "",
    centerValue: f.centerValue ?? "",
    highValue: f.highValue ?? "",
    categoricalLevels: f.categoricalLevels.join(";"),
    precision: f.precision,
    isMixtureComponent: f.isMixtureComponent,
  }));
  return { headers, rows };
}

export function doeConstraintsCsvRows(constraints: readonly DoeConstraint[]): TableExport {
  const headers = ["constraintType", "expression", "severity", "description", "appliesTo"];
  const rows = constraints.map((c) => ({
    constraintType: c.constraintType,
    expression: c.expression,
    severity: c.severity,
    description: c.description ?? "",
    appliesTo: c.appliesTo.join(";"),
  }));
  return { headers, rows };
}

export function doeResponsesCsvRows(responses: readonly DoeResponse[]): TableExport {
  const headers = ["responseCode", "name", "responseType", "objective", "unit", "targetValue", "lowerLimit", "upperLimit", "weight"];
  const rows = responses.map((r) => ({
    responseCode: r.responseCode,
    name: r.name,
    responseType: r.responseType,
    objective: r.objective,
    unit: r.unit ?? "",
    targetValue: r.targetValue ?? "",
    lowerLimit: r.lowerLimit ?? "",
    upperLimit: r.upperLimit ?? "",
    weight: r.weight,
  }));
  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Design matrix / run sheet CSV export
// ---------------------------------------------------------------------------

/** Coded design matrix: one row per run, one column per factor's coded
 *  value — the classical DOE "design matrix" a statistician reviews. */
export function doeDesignMatrixCsvRows(design: DoeDesign, runs: readonly DoeRun[]): TableExport {
  const factorCodes = design.factorSnapshot.map((f) => f.factorCode);
  const headers = ["standardOrder", "randomizedOrder", "block", "replicate", "isCenterPoint", ...factorCodes];
  const rows = [...runs]
    .sort((a, b) => a.standardOrder - b.standardOrder)
    .map((r) => {
      const row: Record<string, unknown> = {
        standardOrder: r.standardOrder,
        randomizedOrder: r.randomizedOrder,
        block: r.block,
        replicate: r.replicate,
        isCenterPoint: r.isCenterPoint,
      };
      for (const code of factorCodes) row[code] = r.factorSettings.find((s) => s.factorCode === code)?.codedValue ?? "";
      return row;
    });
  return { headers, rows };
}

/** Run sheet: the sheet a lab technician actually works from — randomized
 *  execution order, real engineering-unit values, and current status. */
export function doeRunSheetCsvRows(design: DoeDesign, runs: readonly DoeRun[]): TableExport {
  const factorCodes = design.factorSnapshot.map((f) => f.factorCode);
  const headers = ["randomizedOrder", "standardOrder", "block", "status", "linkedTrialId", ...factorCodes];
  const rows = [...runs]
    .sort((a, b) => a.randomizedOrder - b.randomizedOrder)
    .map((r) => {
      const row: Record<string, unknown> = {
        randomizedOrder: r.randomizedOrder,
        standardOrder: r.standardOrder,
        block: r.block,
        status: r.status,
        linkedTrialId: r.linkedTrialId ?? "",
      };
      for (const code of factorCodes) row[code] = r.factorSettings.find((s) => s.factorCode === code)?.actualValue ?? "";
      return row;
    });
  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Observations CSV export/import
// ---------------------------------------------------------------------------

export function doeObservationsCsvRows(runs: readonly DoeRun[], responses: readonly DoeResponse[], observations: readonly DoeObservation[]): TableExport {
  const headers = ["runId", "runNumber", "responseCode", "value", "status", "exclusionReason"];
  const rows: Record<string, unknown>[] = [];
  for (const run of runs) {
    for (const response of responses) {
      const obs = observations.find((o) => o.runId === run.id && o.responseId === response.id);
      rows.push({
        runId: run.id,
        runNumber: run.runNumber,
        responseCode: response.responseCode,
        value: obs?.value ?? "",
        status: obs?.status ?? "missing",
        exclusionReason: obs?.exclusionReason ?? "",
      });
    }
  }
  return { headers, rows };
}

export interface DoeObservationImportRow {
  runId: string;
  responseCode: string;
  value: string;
  status?: string;
  [key: string]: unknown;
}

const OBSERVATION_IMPORT_SPECS: FieldSpec[] = [
  { field: "code", aliases: ["key", "rowKey"], required: false },
  { field: "runId", aliases: ["run", "run_id"], required: true },
  { field: "responseCode", aliases: ["response", "response_code"], required: true },
  { field: "value", aliases: ["result", "observedValue"], required: false },
  { field: "status", aliases: [], required: false },
];

/** Previews an observations CSV/Excel import: row-level validation exactly
 *  like every other import in this codebase (via `previewImport`). An
 *  imported observation is written with whatever status the file specifies
 *  (default `recorded`) but — per spec §17 — the caller must still route it
 *  through the same human-validation step as a manually-typed one; import
 *  never bypasses that. The synthetic `code` (runId+responseCode) exists
 *  only to give `previewImport` a dedup key within the file itself. */
export function previewDoeObservationImport(text: string, existingRunResponsePairs: readonly string[] = []): ImportPreview<DoeObservationImportRow & { code: string }> {
  const rows = withCompositeCodeColumn(parseCsv(text));
  return previewImportRows<DoeObservationImportRow & { code: string }>(rows, OBSERVATION_IMPORT_SPECS, [...existingRunResponsePairs], { codeField: "code" });
}

/** `previewImport`'s dedup key is a single field; an observation is keyed by
 *  (runId, responseCode) together, so prepend that composite key as its own
 *  `code` column rather than trying to force the generic engine's
 *  single-field key to fit two columns. */
function withCompositeCodeColumn(rows: string[][]): string[][] {
  if (rows.length === 0) return rows;
  const header = rows[0];
  const runIdx = header.findIndex((h) => /^run(_?id)?$/i.test(h.trim()));
  const respIdx = header.findIndex((h) => /^response(_?code)?$/i.test(h.trim()));
  if (runIdx === -1 || respIdx === -1) return rows;
  return [["code", ...header], ...rows.slice(1).map((r) => [`${r[runIdx] ?? ""}:${r[respIdx] ?? ""}`, ...r])];
}

// ---------------------------------------------------------------------------
// Factor / constraint / response CSV import
// ---------------------------------------------------------------------------

const FACTOR_IMPORT_SPECS: FieldSpec[] = [
  { field: "code", aliases: ["factorCode", "factor_code"], required: true },
  { field: "name", aliases: [], required: true },
  { field: "factorType", aliases: ["type"], required: true },
  { field: "sourceType", aliases: [], required: true },
  { field: "sourceEntityId", aliases: ["materialId", "source"], required: false },
  { field: "unit", aliases: [], required: false },
  { field: "lowValue", aliases: ["low"], required: false, kind: "decimal" },
  { field: "centerValue", aliases: ["center"], required: false, kind: "decimal" },
  { field: "highValue", aliases: ["high"], required: false, kind: "decimal" },
  { field: "categoricalLevels", aliases: ["levels"], required: false, kind: "list" },
];

export function previewDoeFactorImport(text: string, existingFactorCodes: readonly string[] = []) {
  return previewImport(text, FACTOR_IMPORT_SPECS, [...existingFactorCodes]);
}

const CONSTRAINT_IMPORT_SPECS: FieldSpec[] = [
  { field: "code", aliases: ["constraintId", "id"], required: true },
  { field: "constraintType", aliases: ["type"], required: true },
  { field: "expression", aliases: [], required: true },
  { field: "severity", aliases: [], required: false },
  { field: "description", aliases: [], required: false },
];

export function previewDoeConstraintImport(text: string, existingConstraintIds: readonly string[] = []) {
  return previewImport(text, CONSTRAINT_IMPORT_SPECS, [...existingConstraintIds]);
}

// ---------------------------------------------------------------------------
// Analysis-results JSON export (export only — never re-importable as native)
// ---------------------------------------------------------------------------

export function doeAnalysisJsonPackage(analysis: DoeAnalysis, response: DoeResponse): Record<string, unknown> {
  return {
    exportMeta: { analysisId: analysis.id, responseId: analysis.responseId, exportTimestamp: new Date().toISOString() },
    note: "Export only. An analysis JSON export can never be re-imported as a native analysis — every native analysis is always recomputed from stored observations.",
    responseCode: response.responseCode,
    analysisType: analysis.analysisType,
    includedRunIds: analysis.includedRunIds,
    excludedRunIds: analysis.excludedRunIds,
    modelTerms: analysis.modelTerms,
    coefficients: analysis.coefficients,
    effectEstimates: analysis.effectEstimates,
    anova: analysis.anova,
    fitMetrics: analysis.fitMetrics,
    warnings: analysis.warnings,
  };
}

export function doeCoefficientsCsvRows(analysis: DoeAnalysis): TableExport {
  const headers = ["term", "estimate", "standardError", "tStatistic", "pValue", "confidenceIntervalLow", "confidenceIntervalHigh"];
  const rows = analysis.coefficients.map((c) => ({
    term: c.term,
    estimate: c.estimate,
    standardError: c.standardError ?? "",
    tStatistic: c.tStatistic ?? "",
    pValue: c.pValue ?? "",
    confidenceIntervalLow: c.confidenceIntervalLow ?? "",
    confidenceIntervalHigh: c.confidenceIntervalHigh ?? "",
  }));
  return { headers, rows };
}

export function doeAnovaCsvRows(analysis: DoeAnalysis): TableExport {
  const headers = ["source", "sumOfSquares", "degreesOfFreedom", "meanSquare", "fStatistic", "pValue"];
  const rows = analysis.anova.map((a) => ({
    source: a.source,
    sumOfSquares: a.sumOfSquares,
    degreesOfFreedom: a.degreesOfFreedom,
    meanSquare: a.meanSquare ?? "",
    fStatistic: a.fStatistic ?? "",
    pValue: a.pValue ?? "",
  }));
  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Candidate-list CSV export
// ---------------------------------------------------------------------------

export function doeCandidateListCsvRows(candidates: readonly DoeCandidate[], responses: readonly DoeResponse[]): TableExport {
  const responseNameById = new Map(responses.map((r) => [r.id, r.name]));
  const headers = ["rank", "desirability", "status", "factorSettings", "predictedResponses"];
  const rows = candidates.map((c) => ({
    rank: c.rank,
    desirability: c.desirability,
    status: c.status,
    factorSettings: c.factorSettings.map((s) => `${s.factorCode}=${s.actualValue}`).join(";"),
    predictedResponses: c.predictedResponses.map((p) => `${responseNameById.get(p.responseId) ?? p.responseId}=${p.predictedValue.toFixed(4)}${p.isExtrapolated ? "(extrapolated)" : ""}`).join(";"),
  }));
  return { headers, rows };
}
