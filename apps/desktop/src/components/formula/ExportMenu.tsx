import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import {
  buildVersionExportMeta,
  erpDraftBomCsv,
  erpDraftRecipeCsv,
  versionLinesToCsv,
  versionToJsonPackage,
  type CostSnapshot,
  type Formulation,
  type FormulationVersion,
  type PackagingBom,
} from "@ai4s/shared";
import { buildXlsxBlob } from "@/lib/xlsx";

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadText(filename: string, text: string, mime: string) {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

/**
 * Structured exports of a single saved version: JSON package, CSV formula,
 * Excel formula sheet, cost snapshot, packaging BOM and two ERP-draft
 * sheets. Every export carries the version/formula/schema/approval header
 * and, unless the formula is truly `production_approved`, an R&D-draft
 * watermark — see `engine/exports.ts`, which does the actual shaping; this
 * component only turns each result into a downloadable file.
 */
export function ExportMenu({
  formulation,
  version,
  effectiveStatus,
  costSnapshot,
  packagingBom,
}: {
  formulation: Formulation;
  version: FormulationVersion;
  effectiveStatus: FormulationVersion["status"];
  costSnapshot?: CostSnapshot;
  packagingBom?: PackagingBom;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);
  const close = () => setOpen(false);

  const meta = buildVersionExportMeta(formulation, version, effectiveStatus, costSnapshot?.code);
  const base = `${formulation.code}-${meta.versionLabel}`;

  const exportJson = () => {
    const pkg = versionToJsonPackage(formulation, version, meta, costSnapshot);
    downloadText(`${base}.json`, JSON.stringify(pkg, null, 2), "application/json");
    close();
  };

  const exportCsv = () => {
    downloadText(`${base}-formula.csv`, versionLinesToCsv(version), "text/csv;charset=utf-8");
    close();
  };

  const exportXlsx = async () => {
    const headers = ["lineNumber", "phase", "materialCode", "displayName", "percent", "activeMatterPercent", "functions"];
    const rows = version.lines.map((l) => ({
      lineNumber: l.lineNumber,
      phase: l.phase,
      materialCode: l.materialCode ?? "",
      displayName: l.displayName,
      percent: l.percent,
      activeMatterPercent: l.activeMatterPercent ?? "",
      functions: l.functions.join("; "),
    }));
    downloadBlob(`${base}-formula.xlsx`, await buildXlsxBlob(headers, rows, "Formula"));
    close();
  };

  const exportCostSnapshot = () => {
    if (!costSnapshot) return;
    downloadText(`${base}-cost-snapshot.json`, JSON.stringify(costSnapshot, null, 2), "application/json");
    close();
  };

  const exportPackagingBom = () => {
    if (!packagingBom) return;
    downloadText(`${base}-packaging-bom.json`, JSON.stringify(packagingBom, null, 2), "application/json");
    close();
  };

  const exportErpBom = () => {
    downloadText(`${base}-erp-draft-bom.csv`, erpDraftBomCsv(version, meta), "text/csv;charset=utf-8");
    close();
  };

  const exportErpRecipe = () => {
    downloadText(`${base}-erp-draft-recipe.csv`, erpDraftRecipeCsv(version, meta), "text/csv;charset=utf-8");
    close();
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text"
      >
        <Download size={12} /> {t("builder.export.button")}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-card border border-border bg-surface py-1 shadow-lg">
          <MenuItem onClick={exportJson}>{t("builder.export.json")}</MenuItem>
          <MenuItem onClick={exportCsv}>{t("builder.export.csv")}</MenuItem>
          <MenuItem onClick={() => void exportXlsx()}>{t("builder.export.xlsx")}</MenuItem>
          <MenuItem onClick={exportCostSnapshot} disabled={!costSnapshot}>
            {t("builder.export.costSnapshot")}
          </MenuItem>
          <MenuItem onClick={exportPackagingBom} disabled={!packagingBom}>
            {t("builder.export.packagingBom")}
          </MenuItem>
          <MenuItem onClick={exportErpBom}>{t("builder.export.erpBom")}</MenuItem>
          <MenuItem onClick={exportErpRecipe}>{t("builder.export.erpRecipe")}</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="block w-full px-3 py-1.5 text-left text-[12px] text-text hover:bg-surface-2 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
