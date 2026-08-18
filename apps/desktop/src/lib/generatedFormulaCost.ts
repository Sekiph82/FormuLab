/**
 * FVL-03.003 — the one seam between a generated formula card and the
 * authoritative Cost Engine (`packages/shared/src/engine/cost.ts`).
 *
 * Single-authority rule: this function does not compute a price, a landed
 * cost, or an exchange rate. It only reshapes a generated card's
 * `formula.ingredients[]` into `FormulationLine[]` (via
 * `linesFromGeneratedFormula`, which now carries `material_code` — see
 * FVL-03.002) and hands them to `buildCostSnapshot()`, exactly the same
 * function `CostPanel.tsx` already calls for a manually-built formula. The
 * result is never persisted here (`opts.code: "live"`, matching
 * `CostPanel.tsx`'s own non-persisted "live" snapshot convention) — a
 * generated session card has no real `formulationId`/`versionId` until a
 * human explicitly saves it as a `Formulation`.
 */
import {
  buildCostSnapshot,
  type CostSnapshot,
  type ExchangeRate,
  type FactoryCostProfile,
  type MaterialPrice,
  type RawMaterial,
} from "@formulab/shared";
import { linesFromGeneratedFormula } from "./formulations";

export interface GeneratedFormulaCostData {
  materials: RawMaterial[];
  prices: MaterialPrice[];
  rates: ExchangeRate[];
  profile?: FactoryCostProfile;
}

export function costGeneratedFormula(
  sessionId: string,
  version: string,
  formula: unknown,
  batchKg: string,
  currency: string,
  data: GeneratedFormulaCostData,
): CostSnapshot {
  const lines = linesFromGeneratedFormula(formula);
  return buildCostSnapshot(
    sessionId,
    version,
    {
      lines,
      batchKg,
      currency,
      asOf: new Date().toISOString(),
      materials: data.materials,
      prices: data.prices,
      rates: data.rates,
      profile: data.profile,
    },
    { code: "live" },
  );
}
