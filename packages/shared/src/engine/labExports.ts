/**
 * Structured exports for Laboratory Trials.
 *
 * Same header convention as `engine/exports.ts`'s formula-version exports:
 * every export carries the formula project/version id, the trial id, product
 * family, target SKUs, operator/reviewer and a schema version + export
 * timestamp, plus the R&D-draft watermark unless the underlying formula is
 * truly `production_approved` — so a printed batch sheet or a spreadsheet
 * that leaves this app never loses track of which trial, which formula
 * version, and whether it was actually approved.
 */
import type { FormulaStatus } from "../schemas/formulation";
import type { LaboratoryTrial, TrialComparison } from "../schemas/laboratory";
import type { TestDefinition, TestResult } from "../schemas/testDefinitions";
import type { CorrectiveAction } from "../schemas/correctiveActions";
import { computeBatchWeightVariance, computeMaterialUsageDeviation, computeProcessStepDeviation } from "./laboratory";
import { draftWatermark } from "./exports";
import { toCsv } from "./importer";

/** The subset of `TestResult`/`StabilityResult` these report builders
 *  actually need — both schemas share this shape even though a stability
 *  result is keyed by sample/condition/time-point instead of a trial id, so
 *  one report function serves both without either importing the other's
 *  full schema type. */
export interface ResultLike {
  testDefinitionId: string;
  resultType: string;
  stats?: { count: number; mean?: string; standardDeviation?: string };
  textValue?: string;
  categoricalValue?: string;
  booleanValue?: boolean;
  passFail: string;
  unit?: string;
  replicates: unknown[];
  performedBy: string;
  performedAt: string;
  override?: unknown;
}

export interface TrialExportMeta {
  formulaProjectId: string;
  formulaVersionId?: string;
  trialId: string;
  trialCode: string;
  productFamilyId: string;
  targetPackagingSkuIds: string[];
  operator?: string;
  reviewer?: string;
  schemaVersion: string;
  exportTimestamp: string;
  approvalStatus: FormulaStatus;
}

export function buildTrialExportMeta(trial: LaboratoryTrial, approvalStatus: FormulaStatus): TrialExportMeta {
  return {
    formulaProjectId: trial.projectId,
    formulaVersionId: trial.sourceFormulaVersionId,
    trialId: trial.id,
    trialCode: trial.code,
    productFamilyId: trial.productFamilyId,
    targetPackagingSkuIds: [...trial.targetPackagingSkuIds],
    operator: trial.operator,
    reviewer: trial.reviewer,
    schemaVersion: trial.schemaVersion,
    exportTimestamp: new Date().toISOString(),
    approvalStatus,
  };
}

export interface TableExport {
  headers: string[];
  rows: Record<string, unknown>[];
}

/** The full, self-describing JSON package for one trial — the frozen formula
 *  snapshot, every embedded execution record, and the cross-referenced
 *  deviations/results/corrective actions the caller already has loaded. */
export function trialToJsonPackage(
  trial: LaboratoryTrial,
  meta: TrialExportMeta,
  related: { deviations?: TrialDeviationLike[]; results?: TestResult[]; correctiveActions?: CorrectiveAction[] } = {},
): Record<string, unknown> {
  return {
    exportMeta: meta,
    watermark: draftWatermark(meta.approvalStatus),
    trial,
    deviations: related.deviations ?? [],
    testResults: related.results ?? [],
    correctiveActions: related.correctiveActions ?? [],
  };
}

/** Minimal shape needed here — avoids importing the full `TrialDeviation`
 *  schema type just for a pass-through JSON field. */
interface TrialDeviationLike {
  id: string;
  severity: string;
  status: string;
  description: string;
}

/** A trial batch sheet: the planned formula lines with target weights only
 *  — meant to be printed and taken to the bench BEFORE weighing starts, so
 *  it never shows an "actual" column that does not exist yet. */
export function trialBatchSheetRows(trial: LaboratoryTrial): TableExport {
  const headers = ["lineNumber", "phase", "materialCode", "materialName", "targetPercent", "targetWeight", "weightUnit"];
  const rows = trial.formulaSnapshot.lines.map((l) => ({
    lineNumber: l.lineNumber,
    phase: l.phase,
    materialCode: l.materialCode ?? "",
    materialName: l.displayName,
    targetPercent: l.percent,
    targetWeight: trial.materialUsage.find((u) => u.formulaLineId === l.id)?.targetWeight ?? "",
    weightUnit: trial.materialUsage.find((u) => u.formulaLineId === l.id)?.weightUnit ?? trial.batchUnit,
  }));
  return { headers, rows };
}

/** A material weighing sheet: target vs. actual weight and computed
 *  deviation for every material line — `notEntered` is honest text, never a
 *  zero, when a material has not been weighed yet. */
export function trialWeighingSheetRows(trial: LaboratoryTrial): TableExport {
  const variance = computeBatchWeightVariance(trial.materialUsage);
  const headers = ["materialCode", "materialName", "targetWeight", "actualWeight", "percentageDeviation", "lotNumber", "coaStatus"];
  const rows = trial.materialUsage.map((u) => {
    const dev = computeMaterialUsageDeviation(u);
    return {
      materialCode: u.materialCode,
      materialName: u.materialName,
      targetWeight: u.targetWeight,
      actualWeight: u.actualWeight ?? "not entered",
      percentageDeviation: dev.percentageDeviation ?? "",
      lotNumber: u.lotNumber ?? "",
      coaStatus: u.coaStatus,
    };
  });
  return {
    headers: [...headers, "batchAllWeighed", "batchVarianceAbsolute"],
    rows: rows.map((r) => ({ ...r, batchAllWeighed: variance.allWeighed, batchVarianceAbsolute: variance.varianceAbsolute ?? "" })),
  };
}

/** A process execution sheet: planned instruction vs. actual conditions for
 *  each process step, with the deterministic deviation flags computed the
 *  same way the Process tab does — never a fabricated "as expected". */
export function trialProcessSheetRows(trial: LaboratoryTrial): TableExport {
  const headers = [
    "stepNumber",
    "phase",
    "plannedInstruction",
    "status",
    "plannedTemperatureMinC",
    "plannedTemperatureMaxC",
    "actualTemperatureC",
    "temperatureDeviationC",
    "actualPh",
    "actualDurationMinutes",
    "unplanned",
    "operator",
  ];
  const rows = trial.processSteps.map((s) => {
    const dev = computeProcessStepDeviation(s);
    return {
      stepNumber: s.stepNumber,
      phase: s.phase,
      plannedInstruction: s.plannedInstruction,
      status: s.status,
      plannedTemperatureMinC: s.plannedTemperatureMinC ?? "",
      plannedTemperatureMaxC: s.plannedTemperatureMaxC ?? "",
      actualTemperatureC: s.actualTemperatureC ?? "",
      temperatureDeviationC: dev.temperatureDeviationC ?? "",
      actualPh: s.actualPh ?? "",
      actualDurationMinutes: s.actualDurationMinutes ?? "",
      unplanned: s.unplanned,
      operator: s.operator ?? "",
    };
  });
  return { headers, rows };
}

/** A test-result report: one row per result, with replicate stats already
 *  computed and attached (never recalculated ad hoc in the export layer). */
export function testResultReportRows(results: ResultLike[], definitions: TestDefinition[]): TableExport {
  const headers = ["testCode", "testName", "resultType", "value", "unit", "passFail", "replicateCount", "mean", "standardDeviation", "performedBy", "performedAt", "overridden"];
  const rows = results.map((r) => {
    const def = definitions.find((d) => d.code === r.testDefinitionId);
    const value = r.stats?.mean ?? r.textValue ?? r.categoricalValue ?? (r.booleanValue !== undefined ? String(r.booleanValue) : "");
    return {
      testCode: r.testDefinitionId,
      testName: def?.name ?? "",
      resultType: r.resultType,
      value,
      unit: r.unit ?? "",
      passFail: r.passFail,
      replicateCount: r.stats?.count ?? r.replicates.length,
      mean: r.stats?.mean ?? "",
      standardDeviation: r.stats?.standardDeviation ?? "",
      performedBy: r.performedBy,
      performedAt: r.performedAt,
      overridden: r.override !== undefined,
    };
  });
  return { headers, rows };
}

/** A trial comparison report, built directly from `compareTrials()`'s
 *  deterministic rows/testComparisons — no re-derivation, no interpretation
 *  beyond what that engine function already produced. */
export function trialComparisonReportRows(comparison: TrialComparison): { trials: TableExport; tests: TableExport } {
  const trialHeaders = ["trialCode", "status", "materialUsageCount", "processDeviationCount", "criticalDeviationCount", "testResultCount", "passCount", "failCount", "totalRawMaterialCost"];
  const trials: TableExport = {
    headers: trialHeaders,
    rows: comparison.rows.map((r) => ({
      trialCode: r.trialCode,
      status: r.status,
      materialUsageCount: r.materialUsageCount,
      processDeviationCount: r.processDeviationCount,
      criticalDeviationCount: r.criticalDeviationCount,
      testResultCount: r.testResultCount,
      passCount: r.passCount,
      failCount: r.failCount,
      totalRawMaterialCost: r.totalRawMaterialCost ?? "",
    })),
  };
  const testHeaders = ["testCode", "meanDifference", "absoluteDifference", "percentageDifference", "standardDeviationDifference"];
  const tests: TableExport = {
    headers: testHeaders,
    rows: comparison.testComparisons.map((t) => ({
      testCode: t.testCode,
      meanDifference: t.meanDifference ?? "",
      absoluteDifference: t.absoluteDifference ?? "",
      percentageDifference: t.percentageDifference ?? "",
      standardDeviationDifference: t.standardDeviationDifference ?? "",
    })),
  };
  return { trials, tests };
}

/** A generic corrective-action report — used by both the Trials workspace
 *  and the Stability workspace, since `CorrectiveAction` is one shared model
 *  (spec §8) regardless of whether its source is a trial deviation or a
 *  stability failure. */
export function correctiveActionReportRows(actions: CorrectiveAction[]): TableExport {
  const headers = ["code", "sourceType", "sourceRecordId", "title", "actionType", "owner", "status", "dueDate", "resolution", "effective", "closedAt"];
  const rows = actions.map((a) => ({
    code: a.code,
    sourceType: a.sourceType,
    sourceRecordId: a.sourceRecordId,
    title: a.title,
    actionType: a.actionType,
    owner: a.owner,
    status: a.status,
    dueDate: a.dueDate ?? "",
    resolution: a.resolution ?? "",
    effective: a.effectivenessCheck?.effective ?? "",
    closedAt: a.closedAt ?? "",
  }));
  return { headers, rows };
}

/** A draft ERP lab-result import sheet — explicitly a DRAFT shape, not any
 *  specific ERP system's real import format (same caveat as
 *  `erpDraftBomCsv`/`erpDraftRecipeCsv` in `engine/exports.ts`). */
export function erpLabResultDraftCsv(results: ResultLike[], definitions: TestDefinition[], meta: { recordLabel: string; approvalStatus: FormulaStatus }): string {
  const headers = ["testCode", "resultValue", "unit", "passFail", "performedAt"];
  const rows = results.map((r) => {
    const def = definitions.find((d) => d.code === r.testDefinitionId);
    return {
      testCode: def?.code ?? r.testDefinitionId,
      resultValue: r.stats?.mean ?? r.textValue ?? r.categoricalValue ?? "",
      unit: r.unit ?? "",
      passFail: r.passFail,
      performedAt: r.performedAt,
    };
  });
  const header = [`# ERP DRAFT LAB RESULTS — ${meta.recordLabel} — ${draftWatermark(meta.approvalStatus) ?? "production approved"}`];
  return [...header, toCsv(headers, rows)].join("\n");
}
