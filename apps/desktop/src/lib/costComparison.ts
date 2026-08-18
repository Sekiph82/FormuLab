import type { CostSnapshot } from "@formulab/shared";
import type { FormulationCard } from "./formulationV2";

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
 */
export function pickCheapestValidVersion(
  cards: FormulationCard[],
  snapshots: (CostSnapshot | undefined)[],
): number | undefined {
  let best: number | undefined;
  let bestTotal: number | undefined;
  cards.forEach((card, i) => {
    if (card.status === "generation_failed") return;
    if (card.formula_state?.startsWith("invalid")) return;
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
