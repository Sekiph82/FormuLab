/**
 * Structured exports for Stability Studies.
 *
 * Same header discipline as `engine/labExports.ts`'s trial exports: every
 * export carries the formula project/version id, the study id, product
 * family, target packaging SKU, owner and a schema version + export
 * timestamp, plus the R&D-draft watermark unless the underlying formula is
 * truly `production_approved`.
 */
import type { FormulaStatus } from "../schemas/formulation";
import type { StabilityFailure, StabilitySample, StabilityStudy } from "../schemas/stability";
import { draftWatermark } from "./exports";
import type { TableExport } from "./labExports";

export interface StabilityExportMeta {
  formulaProjectId: string;
  formulaVersionId?: string;
  studyId: string;
  studyCode: string;
  productFamilyId: string;
  packagingSkuCode: string;
  owner: string;
  schemaVersion: string;
  exportTimestamp: string;
  approvalStatus: FormulaStatus;
}

export function buildStabilityExportMeta(study: StabilityStudy, approvalStatus: FormulaStatus): StabilityExportMeta {
  return {
    formulaProjectId: study.projectId,
    formulaVersionId: study.sourceFormulaVersionId,
    studyId: study.id,
    studyCode: study.code,
    productFamilyId: study.productFamilyId,
    packagingSkuCode: study.packagingSkuCode,
    owner: study.owner,
    schemaVersion: study.schemaVersion,
    exportTimestamp: new Date().toISOString(),
    approvalStatus,
  };
}

/** The full, self-describing JSON protocol package for a study — the frozen
 *  formula and packaging snapshots plus the condition/time-point/test
 *  references it runs against. Conditions and time points are exported by id
 *  reference only (the study does not embed copies of them — see
 *  `schemas/stability.ts`), so the caller passes in the resolved labels. */
export function stabilityProtocolJson(
  study: StabilityStudy,
  meta: StabilityExportMeta,
  resolved: { conditions?: { id: string; code: string; label: string }[]; timePoints?: { id: string; code: string; label: string; daysFromStart: number }[] } = {},
): Record<string, unknown> {
  return {
    exportMeta: meta,
    watermark: draftWatermark(meta.approvalStatus),
    study: {
      code: study.code,
      title: study.title,
      protocol: study.protocol ?? null,
      status: study.status,
      startDate: study.startDate ?? null,
      formulaSnapshot: study.formulaSnapshot,
      packagingSnapshot: study.packagingSnapshot,
      replicatesPerPullPoint: study.replicatesPerPullPoint,
    },
    conditions: resolved.conditions ?? study.conditionIds.map((id) => ({ id })),
    timePoints: resolved.timePoints ?? study.timePointIds.map((id) => ({ id })),
    requiredTestDefinitionIds: study.requiredTestDefinitionIds,
  };
}

/** A sample plan — one row per pull-point sample this study has generated,
 *  the deterministic due-date schedule a lab technician actually works from. */
export function samplePlanCsvRows(samples: StabilitySample[]): TableExport {
  const headers = ["sampleCode", "conditionId", "timePointId", "replicateNumber", "status", "dueDate", "storageLocation"];
  const rows = samples.map((s) => ({
    sampleCode: s.sampleCode,
    conditionId: s.conditionId,
    timePointId: s.timePointId,
    replicateNumber: s.replicateNumber,
    status: s.status,
    dueDate: s.dueDate ?? "",
    storageLocation: s.storageLocation ?? "",
  }));
  return { headers, rows };
}

/** A time-point report — one row per sample at a given time point (or every
 *  time point, when `timePointId` is omitted), with its own result count so
 *  a reviewer can see completeness at a glance without opening each sample. */
export function timePointReportRows(samples: StabilitySample[], resultCounts: Map<string, number>, timePointId?: string): TableExport {
  const filtered = timePointId ? samples.filter((s) => s.timePointId === timePointId) : samples;
  const headers = ["sampleCode", "conditionId", "timePointId", "status", "dueDate", "resultCount"];
  const rows = filtered.map((s) => ({
    sampleCode: s.sampleCode,
    conditionId: s.conditionId,
    timePointId: s.timePointId,
    status: s.status,
    dueDate: s.dueDate ?? "",
    resultCount: resultCounts.get(s.id) ?? 0,
  }));
  return { headers, rows };
}

/** A study summary report: counts only, nothing derived beyond what the
 *  caller's own records already say — no shelf-life claim, no pass/fail
 *  verdict on the study as a whole. */
export function stabilitySummaryReportRows(study: StabilityStudy, samples: StabilitySample[], failures: StabilityFailure[]): TableExport {
  const byStatus = new Map<string, number>();
  for (const s of samples) byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
  const openCritical = failures.filter((f) => f.severity === "critical" && f.investigationStatus !== "closed").length;

  const headers = ["studyCode", "status", "totalSamples", "openCriticalFailures", "totalFailures", ...[...byStatus.keys()].map((k) => `samples_${k}`)];
  const row: Record<string, unknown> = {
    studyCode: study.code,
    status: study.status,
    totalSamples: samples.length,
    openCriticalFailures: openCritical,
    totalFailures: failures.length,
  };
  for (const [status, count] of byStatus) row[`samples_${status}`] = count;
  return { headers, rows: [row] };
}

/** The shared corrective-action report, re-exported here so stability UI
 *  code does not need to import from `engine/labExports.ts` directly for a
 *  model that is not lab-specific — see `engine/correctiveActions.ts`. */
export { correctiveActionReportRows } from "./labExports";
export type { TableExport } from "./labExports";
