/**
 * FVL-03.004 — the one seam between a generated formula card and
 * canonical inventory feasibility. Client-side, read-only, mirrors
 * `generatedFormulaCost.ts`'s architecture exactly (same reason: Python
 * cannot call into this package — `run_cli.py` is a one-shot subprocess
 * with no back-channel — so real evaluation happens here, after
 * generation, never inside the deterministic engine itself).
 *
 * Single-authority rule: this module never derives a usable quantity
 * itself — every quantity fact comes from
 * `evaluateMaterialAvailability()` (`@formulab/shared`). This file only
 * reshapes a generated card into per-ingredient states and rolls them up
 * into one formula-level state. Never mutates inventory, never reserves,
 * never decrements stock — read-only by construction (no `upsertRecords`
 * call exists anywhere in this file).
 */
import { evaluateMaterialAvailability, type InventoryRecord } from "@formulab/shared";
import { linesFromGeneratedFormula } from "./formulations";

export type IngredientAvailabilityState = "available" | "insufficient" | "unknown";
export type FormulaInventoryState = "feasible" | "infeasible" | "unknown";

export interface IngredientAvailabilityLine {
  lineId: string;
  displayName: string;
  materialCode?: string;
  state: IngredientAvailabilityState;
  usableQuantity?: string;
  requiredQuantity?: string;
  unit?: string;
  reason: string;
}

export interface FormulaInventoryFeasibility {
  formulaState: FormulaInventoryState;
  lines: IngredientAvailabilityLine[];
  evaluatedAt: string;
}

export function evaluateGeneratedFormulaInventory(
  formula: unknown,
  batchKg: string,
  inventoryRecords: InventoryRecord[],
): FormulaInventoryFeasibility {
  const evaluatedAt = new Date().toISOString();
  const lines = linesFromGeneratedFormula(formula);
  const batchQty = Number(batchKg);
  const batchIsUsable = Number.isFinite(batchQty) && batchQty > 0;

  const result: IngredientAvailabilityLine[] = lines.map((line) => {
    if (!line.materialCode) {
      return {
        lineId: line.id,
        displayName: line.displayName,
        state: "unknown",
        reason: "ingredient not resolved to a canonical material",
      };
    }

    const availability = evaluateMaterialAvailability(inventoryRecords, line.materialCode, evaluatedAt);

    if (!availability.hasRecords) {
      return {
        lineId: line.id,
        displayName: line.displayName,
        materialCode: line.materialCode,
        state: "unknown",
        reason: "no inventory record for this material",
      };
    }

    if (availability.usableQuantity === undefined) {
      return {
        lineId: line.id,
        displayName: line.displayName,
        materialCode: line.materialCode,
        state: "unknown",
        reason: "inventory quantities use inconsistent units",
      };
    }

    if (!batchIsUsable) {
      return {
        lineId: line.id,
        displayName: line.displayName,
        materialCode: line.materialCode,
        state: "unknown",
        usableQuantity: availability.usableQuantity.toString(),
        unit: availability.unit,
        reason: "batch size is not a usable number, so required quantity cannot be compared",
      };
    }

    const requiredQty = (Number(line.percent) / 100) * batchQty;
    const state: IngredientAvailabilityState =
      availability.usableQuantity.greaterThanOrEqualTo(requiredQty) ? "available" : "insufficient";

    return {
      lineId: line.id,
      displayName: line.displayName,
      materialCode: line.materialCode,
      state,
      usableQuantity: availability.usableQuantity.toString(),
      requiredQuantity: String(requiredQty),
      unit: availability.unit,
      reason:
        state === "available"
          ? "usable inventory covers the required quantity for this batch"
          : "usable inventory is below the required quantity for this batch",
    };
  });

  const formulaState: FormulaInventoryState = result.some((l) => l.state === "insufficient")
    ? "infeasible"
    : result.some((l) => l.state === "unknown")
      ? "unknown"
      : "feasible";

  return { formulaState, lines: result, evaluatedAt };
}
