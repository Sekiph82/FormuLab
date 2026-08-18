import type { CostSnapshot } from "@formulab/shared";
import type { FormulationCard } from "./formulationV2";
import type { GeneratedFormulaCompatibility } from "./generatedFormulaCompatibility";
import type { GeneratedFormulaSafety } from "./generatedFormulaSafety";
import type { GeneratedFormulaRegulatory } from "./generatedFormulaRegulatory";

/**
 * FVL-03.003 — which generated alternative is the cheapest one that's
 * actually usable. Real cost comparison must never let an invalid formula
 * win on price, and must never crown an INCOMPLETE cost total "cheapest"
 * — an incomplete total is a lower bound (missing lines are excluded from
 * it, `cost.ts`'s own documented behavior), so comparing lower bounds
 * across formulas would be misleading.
 *
 * Eligible = the same "not invalid" convention `FormulationResultPage`
 * already uses for its status badge (`formula_state.startsWith("invalid")`)
 * AND a cost snapshot with zero `missingDataWarnings`.
 *
 * FVL-03.008/.009/.010: `compatibilities`/`safeties`/`regulatories` are
 * optional so every pre-existing call site keeps working unchanged; when
 * passed, a version whose authoritative Compatibility, Safety, or
 * Regulatory Engine verdict is `"blocked"` can never be crowned cheapest
 * merely because its price is attractive (task §9/§12) — a warning or
 * unknown state does NOT exclude a version, matching the real platform's
 * own "only a real hard finding is a hard block" semantics (confirmed by
 * `blockingExclusionConstraints`/`SubstitutionPanel.tsx`'s
 * `hasBlockingCompatibilityFinding`/`hasBlockingSafetyFinding`, and — for
 * Regulatory specifically — `evaluateGeneratedFormulaRegulatory`'s own
 * reservation of `"blocked"` for a real `non_compliant` finding, never a
 * `missing_data`/`human_review_required` one).
 */
export function pickCheapestValidVersion(
  cards: FormulationCard[],
  snapshots: (CostSnapshot | undefined)[],
  compatibilities?: (GeneratedFormulaCompatibility | undefined)[],
  safeties?: (GeneratedFormulaSafety | undefined)[],
  regulatories?: (GeneratedFormulaRegulatory | undefined)[],
): number | undefined {
  let best: number | undefined;
  let bestTotal: number | undefined;
  cards.forEach((card, i) => {
    if (card.status === "generation_failed") return;
    if (card.formula_state?.startsWith("invalid")) return;
    if (compatibilities?.[i]?.formulaState === "blocked") return;
    if (safeties?.[i]?.formulaState === "blocked") return;
    if (regulatories?.[i]?.formulaState === "blocked") return;
    const snapshot = snapshots[i];
    if (!snapshot || snapshot.missingDataWarnings.length > 0) return;
    if (!snapshot.totalManufacturingCost) return;
    const total = Number(snapshot.totalManufacturingCost);
    if (!Number.isFinite(total)) return;
    if (bestTotal === undefined || total < bestTotal) {
      best = i;
      bestTotal = total;
    }
  });
  return best;
}
