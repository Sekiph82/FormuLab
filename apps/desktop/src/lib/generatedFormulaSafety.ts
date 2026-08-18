/**
 * FVL-03.009 — the one seam between a generated formula card and the
 * authoritative Safety Engine (`packages/shared/src/engine/safety.ts`).
 *
 * Single-authority rule: this module never scores a hazard, never invents
 * a rule, and never decides a severity — `evaluateSafety()` (deterministic,
 * rule-driven, no model in the loop) does that entirely. This file only
 * reshapes a generated card's `formula.ingredients[]` into
 * `FormulationLine[]` (via `linesFromGeneratedFormula`, the same helper
 * FVL-03.002/.003/.004/.006/.007/.008 already reuse) and hands it to the
 * real engine. The rule set is a REQUIRED caller-supplied parameter, never
 * hardcoded here — mirrors `generatedFormulaCompatibility.ts` exactly: the
 * real authoritative rule library is the live, chemist-editable
 * `safety_rules` masterdata collection, not a frozen
 * `SEED_SAFETY_RULES` copy.
 *
 * This is the SOLE replacement for `runtime/pipeline/safety.py`'s former
 * independent final-verdict role — that module (and its own hazard
 * tables, keyed on ingredient NAME text, never a canonical materialCode)
 * has been retired from the active formulation path; see
 * `docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`'s "Safety Engine
 * boundary" section. `evaluateSafety` is pure, so — exactly like
 * Compatibility (FVL-03.008) and unlike the Optimizer/Substitution seams
 * (FVL-03.005/.006/.007) — a generated (not-yet-saved) card is evaluated
 * read-only, with no promotion/save-first step at all.
 *
 * `formulaState` follows the SAME platform-wide severity convention
 * FVL-03.008 confirmed for Compatibility (`blockingExclusionConstraints`,
 * `SubstitutionPanel.tsx`'s own `hasBlockingSafetyFinding`): only
 * `severity === "blocking"` is ever a hard block. `unresolvedMaterialCount`
 * is always exposed honestly alongside real findings — a formula with zero
 * findings but at least one unresolved ingredient is `"unknown"`, never
 * `"safe"` (a materialCode-/CAS-scoped rule could never have fired against
 * it). `classifyProductSafety()` (product-family + claims classification)
 * is deliberately NOT wired here: a generated session's free-text
 * `brief.category` has no reliable, resolvable join to a real
 * `ProductFamily` record — fabricating that join would violate this
 * platform's own "no fabricated identity" rule, so it is left out rather
 * than guessed. This mirrors Compatibility's own scope exactly (per-line
 * findings only, no project/family-level classification for a generated
 * card).
 */
import { evaluateSafety, type RawMaterial, type SafetyFinding, type SafetyRule } from "@formulab/shared";
import { linesFromGeneratedFormula } from "./formulations";

export type SafetyFormulaState = "safe" | "warning" | "blocked" | "unknown";

export interface GeneratedFormulaSafety {
  formulaState: SafetyFormulaState;
  findings: SafetyFinding[];
  /** Ingredients with no resolvable `materialCode` — excluded from every
   *  materialCode-/CAS-number-scoped rule (function- and name-keyword-
   *  scoped rules can still fire against them, per the real engine's own
   *  matching logic — this count is honest partial coverage, not "these
   *  ingredients were never checked at all"). */
  unresolvedMaterialCount: number;
  evaluatedAt: string;
}

export function evaluateGeneratedFormulaSafety(
  formula: unknown,
  materials: RawMaterial[],
  rules: SafetyRule[],
  opts: { phTarget?: string; processTempC?: string } = {},
): GeneratedFormulaSafety {
  const evaluatedAt = new Date().toISOString();
  const lines = linesFromGeneratedFormula(formula);
  const unresolvedMaterialCount = lines.filter((l) => !l.materialCode).length;

  const findings = evaluateSafety(lines, rules, {
    materials,
    phTarget: opts.phTarget,
    processTempC: opts.processTempC,
  });

  const hasBlocking = findings.some((f) => f.severity === "blocking");
  const formulaState: SafetyFormulaState = hasBlocking
    ? "blocked"
    : findings.length > 0
      ? "warning"
      : unresolvedMaterialCount > 0
        ? "unknown"
        : "safe";

  return { formulaState, findings, unresolvedMaterialCount, evaluatedAt };
}
