import type { FormulaInventoryFeasibility } from "./generatedFormulaInventory";
import type { FormulationCard } from "./formulationV2";

/**
 * FVL-03.004 — which already-generated alternative is the most
 * inventory-feasible one, among versions a hard rule hasn't already
 * disqualified. This is where "prefer a feasible candidate" (task §10)
 * is satisfied — at the VERSION level, the same way `pickCheapestValidVersion`
 * prefers the cheaper of already-generated alternatives, never by
 * mutating which ingredient `engine.py` picks for a role during
 * generation (Python stays inventory-blind by design).
 *
 * Eligible = the same "not invalid" convention `pickCheapestValidVersion`
 * already uses, restricted to versions whose inventory state is actually
 * `"feasible"` — mirrors `pickCheapestValidVersion`'s own choice to
 * return `undefined` rather than recommend a lower-confidence result
 * (there, an incomplete cost; here, an unknown or infeasible inventory
 * state) when nothing fully qualifies. An infeasible or merely-unknown
 * version is never returned as "the best available anyway."
 * Deliberately no further tie-break (e.g. by cost) — that would collapse
 * two separate dimensions into one opaque score, which task §12
 * explicitly forbids; a real multi-dimensional ranking is FVL-08's job.
 */
export function pickMostInventoryFeasibleVersion(
  cards: FormulationCard[],
  feasibilities: (FormulaInventoryFeasibility | undefined)[],
): number | undefined {
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (card.status === "generation_failed") continue;
    if (card.formula_state?.startsWith("invalid")) continue;
    if (feasibilities[i]?.formulaState === "feasible") return i;
  }
  return undefined;
}
