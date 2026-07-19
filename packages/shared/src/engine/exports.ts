/**
 * Structured exports of one formula version.
 *
 * Every export carries the same header — which formula, which version, what
 * schema, when, whether it is approved — because a spreadsheet or a JSON
 * file leaving this app is the point at which "which version was this?"
 * stops being answerable by clicking around and starts depending on what
 * got written into the file itself.
 */
import type { CostSnapshot } from "../schemas/costing";
import type { Formulation, FormulationVersion, FormulaStatus } from "../schemas/formulation";
import { toCsv } from "./importer";

export interface VersionExportMeta {
  formulaId: string;
  formulaCode: string;
  versionId: string;
  versionLabel: string;
  schemaVersion: string;
  exportTimestamp: string;
  approvalStatus: FormulaStatus;
  costSnapshotId?: string;
  targetProductFamily: string;
  targetSkus: string[];
}

export function buildVersionExportMeta(
  formulation: Formulation,
  version: FormulationVersion,
  effectiveApprovalStatus: FormulaStatus,
  costSnapshotId?: string,
): VersionExportMeta {
  return {
    formulaId: formulation.id,
    formulaCode: formulation.code,
    versionId: version.id,
    versionLabel: version.versionLabel ?? `0.${version.versionNumber}`,
    schemaVersion: version.schemaVersion,
    exportTimestamp: new Date().toISOString(),
    approvalStatus: effectiveApprovalStatus,
    costSnapshotId,
    targetProductFamily: formulation.productFamilyCode,
    targetSkus: [...formulation.targetSkuCodes],
  };
}

/** Statuses that mean this formula has actually cleared production approval.
 *  Everything else — including `pilot_approved` — is still R&D territory as
 *  far as an export watermark is concerned. */
const PRODUCTION_CLEARED: FormulaStatus = "production_approved";

/** `null` once truly production-approved; otherwise the watermark text every
 *  non-final export must carry, so a printed or emailed copy cannot be
 *  mistaken for a cleared specification. */
export function draftWatermark(status: FormulaStatus): string | null {
  return status === PRODUCTION_CLEARED ? null : "R&D DRAFT — NOT PRODUCTION APPROVED";
}

/** The full, self-describing JSON package for one version. */
export function versionToJsonPackage(
  formulation: Formulation,
  version: FormulationVersion,
  meta: VersionExportMeta,
  costSnapshot?: CostSnapshot,
): Record<string, unknown> {
  return {
    exportMeta: meta,
    watermark: draftWatermark(meta.approvalStatus),
    formulation: {
      id: formulation.id,
      code: formulation.code,
      name: formulation.name,
      productFamilyCode: formulation.productFamilyCode,
      targetSkuCodes: formulation.targetSkuCodes,
      targetMarkets: formulation.targetMarkets,
      targetClaims: formulation.targetClaims,
    },
    version: {
      id: version.id,
      versionNumber: version.versionNumber,
      versionLabel: meta.versionLabel,
      branchName: version.branchName,
      parentVersionId: version.parentVersionId,
      status: meta.approvalStatus,
      author: version.author,
      createdAt: version.createdAt,
      changeReason: version.changeReason,
      changeNotes: version.changeNotes,
      basisBatchKg: version.basisBatchKg,
      totalsSnapshot: version.totalsSnapshot,
      lines: version.lines,
    },
    costSnapshot: costSnapshot ?? null,
  };
}

/** Formula lines as a flat CSV — a chemist can open this in Excel directly. */
export function versionLinesToCsv(version: FormulationVersion): string {
  const headers = [
    "lineNumber",
    "phase",
    "materialCode",
    "displayName",
    "tradeName",
    "inciName",
    "functions",
    "percent",
    "activeMatterPercent",
    "supplierCode",
    "unitPrice",
    "currency",
    "evidenceOrigin",
    "notes",
  ];
  const rows = version.lines.map((l) => ({
    lineNumber: l.lineNumber,
    phase: l.phase,
    materialCode: l.materialCode ?? "",
    displayName: l.displayName,
    tradeName: l.tradeName ?? "",
    inciName: l.inciName ?? "",
    functions: l.functions.join(";"),
    percent: l.percent,
    activeMatterPercent: l.activeMatterPercent ?? "",
    supplierCode: l.supplierCode ?? "",
    unitPrice: l.unitPrice ?? "",
    currency: l.currency ?? "",
    evidenceOrigin: l.provenance.origin,
    notes: l.notes ?? "",
  }));
  return toCsv(headers, rows);
}

/**
 * A simplified draft BOM in a shape an ERP import screen would recognise:
 * one row per line, item code, description and quantity per 100 kg batch.
 * Explicitly a DRAFT — this is not a specific ERP system's real import
 * format, which this project has no integration with.
 */
export function erpDraftBomCsv(version: FormulationVersion, meta: VersionExportMeta): string {
  const headers = ["itemCode", "description", "quantityPer100Kg", "unit", "phase"];
  const rows = version.lines.map((l) => ({
    itemCode: l.materialCode ?? l.id,
    description: l.displayName,
    quantityPer100Kg: l.percent,
    unit: "kg",
    phase: l.phase,
  }));
  const header = [`# ERP DRAFT BOM — ${meta.formulaCode} ${meta.versionLabel} — ${draftWatermark(meta.approvalStatus) ?? "production approved"}`];
  return [...header, toCsv(headers, rows)].join("\n");
}

/** A draft recipe/process sheet: phases in order, with each line's target
 *  quantity for the version's own basis batch size. */
export function erpDraftRecipeCsv(version: FormulationVersion, meta: VersionExportMeta): string {
  const headers = ["step", "phase", "itemCode", "description", "percent", "notes"];
  const rows = version.lines.map((l, i) => ({
    step: i + 1,
    phase: l.phase,
    itemCode: l.materialCode ?? l.id,
    description: l.displayName,
    percent: l.percent,
    notes: l.notes ?? "",
  }));
  const header = [
    `# ERP DRAFT RECIPE — ${meta.formulaCode} ${meta.versionLabel} — basis ${version.basisBatchKg} kg — ${draftWatermark(meta.approvalStatus) ?? "production approved"}`,
  ];
  return [...header, toCsv(headers, rows)].join("\n");
}
