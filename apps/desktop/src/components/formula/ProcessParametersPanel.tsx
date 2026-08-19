import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardList } from "lucide-react";
import type { ProcessParameter } from "@formulab/shared";
import { listRecords } from "@/lib/masterdata";

/**
 * FVL-04.009 — the real Manufacturing Procedure consumer for canonical/
 * imported `process_parameters`. A generated formulation card's own
 * `ManufacturingProcedureTab` (FormulationResultPage.tsx) is a separate,
 * session/evidence-derived PROPOSAL — it never reads this collection and
 * this panel never reads a generated card. This panel is read-only by
 * design: `process_parameters` rows are written only through Data Exchange
 * import or a future dedicated editor, never through this viewer.
 */
export function ProcessParametersPanel({ formulaCode, formulaVersion }: { formulaCode: string; formulaVersion?: number }) {
  const { t } = useTranslation(["session", "common"]);
  const [steps, setSteps] = useState<ProcessParameter[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listRecords("process_parameters").then((rows) => {
      if (cancelled) return;
      const filtered = (rows as unknown as ProcessParameter[])
        .filter((r) => r.formulaCode === formulaCode && (formulaVersion === undefined || r.formulaVersion === formulaVersion))
        .sort((a, b) => a.stepNumber - b.stepNumber);
      setSteps(filtered);
    });
    return () => {
      cancelled = true;
    };
  }, [formulaCode, formulaVersion]);

  if (steps.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-3 text-center text-muted">
        <ClipboardList size={20} />
        <p className="text-[12px]">{t("process.empty")}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto px-4 py-3">
      <h3 className="mb-3 text-[13px] font-medium text-text">{t("process.heading")}</h3>
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-left text-muted">
            <th className="px-2 py-1.5 text-right font-medium">{t("process.step")}</th>
            <th className="px-2 py-1.5 font-medium">{t("process.name")}</th>
            <th className="px-2 py-1.5 font-medium">{t("process.phase")}</th>
            <th className="px-2 py-1.5 font-medium">{t("process.equipment")}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t("process.temperature")}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t("process.mixingSpeed")}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t("process.holdTime")}</th>
            <th className="px-2 py-1.5 font-medium">{t("process.critical")}</th>
            <th className="px-2 py-1.5 font-medium">{t("process.instruction")}</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s) => (
            <tr key={s.code} className="border-b border-border-faint">
              <td className="px-2 py-1.5 text-right tabular-nums text-text">{s.stepNumber}</td>
              <td className="px-2 py-1.5 text-text">{s.stepName ?? "—"}</td>
              <td className="px-2 py-1.5 text-muted">{s.phase ?? "—"}</td>
              <td className="px-2 py-1.5 text-muted">{s.equipmentType ?? "—"}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                {[s.temperatureMin, s.temperatureTarget, s.temperatureMax].some(Boolean)
                  ? `${s.temperatureMin ?? "—"} / ${s.temperatureTarget ?? "—"} / ${s.temperatureMax ?? "—"}`
                  : "—"}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                {[s.mixingSpeedMin, s.mixingSpeedTarget, s.mixingSpeedMax].some(Boolean)
                  ? `${s.mixingSpeedMin ?? "—"} / ${s.mixingSpeedTarget ?? "—"} / ${s.mixingSpeedMax ?? "—"}`
                  : "—"}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted">{s.holdTimeMinutes ?? "—"}</td>
              <td className="px-2 py-1.5 text-muted">{s.criticalParameter ? t("process.criticalYes") : "—"}</td>
              <td className="px-2 py-1.5 text-muted">{s.instruction ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
