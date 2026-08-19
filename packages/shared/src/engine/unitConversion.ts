/**
 * FVL-04.018 hardening (F1/F2) — the ONE generic, deterministic authority
 * for simple same-dimension physical unit conversion (mass<->mass,
 * volume<->volume) in this codebase. A repository-wide audit
 * (`MASS_UNITS`/`VOLUME_UNITS`/`convertUnit`/"unit conversion"/density)
 * found no pre-existing generic authority — `engine/cost.ts` has its own
 * inline mass/volume-via-density arithmetic, but that is deliberately
 * DIFFERENT: business-specific costing logic that needs a material's own
 * density to cross from volume to mass for pricing purposes, not a general
 * conversion utility. This module is created once, here, and
 * `engine/transformation.ts` is the only consumer — its own former local
 * `MASS_UNITS`/`VOLUME_UNITS` tables are deleted, not duplicated.
 *
 * Responsibility boundary (kept deliberately narrow):
 *   - This module: generic, density-free dimensional conversion (g<->kg,
 *     mL<->L, etc).
 *   - `engine/cost.ts`: costing- and density-specific business logic
 *     (volume-to-mass via a material's own recorded density). Untouched by
 *     this module; never migrated here.
 *   - `engine/inventoryAvailability.ts`: inventory availability semantics.
 *     Untouched.
 *
 * Cross-dimension conversion (L -> kg, mL -> g) is always refused here —
 * no guessed density, ever. A caller that legitimately needs a
 * density-aware conversion must use the existing authoritative path in
 * `cost.ts`, not this module.
 */

const MASS_UNITS: Record<string, number> = { mg: 0.001, g: 1, kg: 1000 };
const VOLUME_UNITS: Record<string, number> = { ml: 1, l: 1000 };

export type UnitDimension = "mass" | "volume";

export function unitDimension(unit: string): UnitDimension | undefined {
  const u = unit.trim().toLowerCase();
  if (u in MASS_UNITS) return "mass";
  if (u in VOLUME_UNITS) return "volume";
  return undefined;
}

export function isKnownUnit(unit: string): boolean {
  return unitDimension(unit) !== undefined;
}

export interface UnitConversionOutcome {
  value?: number;
  error?: "unknown_unit" | "incompatible_unit_conversion" | "not_a_number";
}

/** Converts `quantity` from `from` to `to`. Refuses silently across
 *  dimensions — `error: "incompatible_unit_conversion"` — rather than
 *  guessing a density. Refuses an unrecognized unit token outright. */
export function convertUnit(quantity: number, from: string, to: string): UnitConversionOutcome {
  if (!Number.isFinite(quantity)) return { error: "not_a_number" };
  const fromDim = unitDimension(from);
  const toDim = unitDimension(to);
  if (!fromDim || !toDim) return { error: "unknown_unit" };
  if (fromDim !== toDim) return { error: "incompatible_unit_conversion" };
  const table = fromDim === "mass" ? MASS_UNITS : VOLUME_UNITS;
  const base = quantity * table[from.trim().toLowerCase()];
  return { value: base / table[to.trim().toLowerCase()] };
}
