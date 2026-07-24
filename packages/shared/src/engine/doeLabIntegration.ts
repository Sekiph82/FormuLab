/**
 * Laboratory integration for DOE (spec Phase 5 §9/§10): turning a DOE run's
 * factor settings into a real formula composition, deterministically, from
 * the study's exact baseline saved version — never guessed, never applied
 * to a different version than the one the study was bound to.
 *
 * This module only computes the resulting composition; it never creates or
 * mutates a `LaboratoryTrial` or `FormulationDraft` itself — the caller
 * (the DOE workspace) does that through the existing Laboratory/Formulation
 * persistence paths, exactly as it does for every other trial/draft today.
 */
import type { DoeFactor, DoeFactorSetting } from "../schemas/doe";
import type { FormulationLine } from "../schemas/formulation";

export interface DoeRunCompositionResult {
  lines: FormulationLine[];
  /** Process-parameter factor settings that have no corresponding formula
   *  line (mixing speed/time, temperature, pH target, …) — surfaced so the
   *  caller can display them alongside the composition rather than silently
   *  dropping them. */
  processSettings: { key: string; value: string; unit?: string }[];
  /** Non-fatal notes, e.g. a factor referencing a material id that is not
   *  present in the baseline's lines (the factor is skipped, not fabricated
   *  as a new line — a human decides whether to add that material). */
  warnings: string[];
}

/** Applies a run's (or a candidate's) factor settings onto a baseline
 *  formula's lines: `formula_material` factors overwrite the matching
 *  line's `percent`; every other factor becomes a process setting. Fixed
 *  ingredients (lines with no matching factor) are left exactly as they
 *  were in the baseline — never dropped, never re-percented implicitly. */
export function applyDoeFactorsToLines(baselineLines: readonly FormulationLine[], factorSettings: readonly DoeFactorSetting[], factors: readonly DoeFactor[]): DoeRunCompositionResult {
  const warnings: string[] = [];
  const processSettings: { key: string; value: string; unit?: string }[] = [];
  const byMaterialId = new Map<string, string>();

  for (const setting of factorSettings) {
    const factor = factors.find((f) => f.factorCode === setting.factorCode);
    if (!factor) continue;
    if (factor.sourceType === "formula_material" && factor.sourceEntityId) {
      if (!baselineLines.some((l) => l.materialId === factor.sourceEntityId)) {
        warnings.push(`Factor "${factor.factorCode}" references material "${factor.sourceEntityId}", which is not a line in the baseline formula — it was not added automatically.`);
        continue;
      }
      byMaterialId.set(factor.sourceEntityId, setting.actualValue);
    } else if (factor.sourceType !== "formula_total") {
      processSettings.push({ key: factor.sourceEntityId ?? factor.factorCode, value: setting.actualValue, unit: factor.unit });
    }
  }

  const lines = baselineLines.map((line) => (line.materialId && byMaterialId.has(line.materialId) ? { ...line, percent: byMaterialId.get(line.materialId)! } : { ...line }));

  const totalPercent = lines.reduce((sum, l) => sum + Number(l.percent || "0"), 0);
  if (Number.isFinite(totalPercent) && Math.abs(totalPercent - 100) > 0.5) {
    warnings.push(`This run's composition totals ${totalPercent.toFixed(2)}% — review q.s./total lines before recording it as a trial.`);
  }

  return { lines, processSettings, warnings };
}
