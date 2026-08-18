/**
 * FVL-03.008 — the one seam between a generated formula card and the
 * authoritative Compatibility Engine (`packages/shared/src/engine/
 * compatibility.ts`).
 *
 * Single-authority rule: this module never scores a pairwise
 * incompatibility, never invents a rule, and never decides a severity —
 * `evaluateCompatibility()` (deterministic, rule-driven, no model in the
 * loop) does that entirely. This file only reshapes a generated card's
 * `formula.ingredients[]` into `FormulationLine[]` (via
 * `linesFromGeneratedFormula`, same helper FVL-03.002/.003/.004/.006/.007
 * already reuse) and hands them to the real engine. The rule set is a
 * REQUIRED caller-supplied parameter, never hardcoded here — the real
 * authoritative rule library is the live, chemist-editable
 * `compatibility_rules` masterdata collection
 * (`CompatibilityPanel.tsx::listRecordsSeeded("compatibility_rules",
 * SEED_COMPATIBILITY_RULES)`), not the bare `SEED_COMPATIBILITY_RULES`
 * constant — a caller that has not loaded the live collection must not
 * silently fall back to the seed defaults and evaluate against a stale
 * rule set. Canonical Material Master records are the same ones every
 * other real caller already uses — never a second rule set, never a
 * pipeline-local reimplementation. Nothing here is persisted —
 * `evaluateCompatibility` is pure, so a generated (not-yet-saved) card can
 * be evaluated read-only with no promotion/save-first step at all (unlike
 * FVL-03.005/.006/.007, whose target engines required a real
 * projectId/formulaVersionId).
 *
 * `formulaState` follows the platform's own existing, already-battle-
 * tested severity convention — confirmed by audit, not invented here:
 * `blockingExclusionConstraints` (`engine/optimization.ts`) and
 * `SubstitutionPanel.tsx`'s own `hasBlockingCompatibilityFinding` both
 * already treat ONLY `severity === "blocking"` as a hard block; `info`/
 * `warning`/`error` are all real, visible, non-blocking findings. A
 * formula with zero findings but at least one ingredient the engine could
 * not identity-match to a canonical `materialCode` is reported `"unknown"`
 * — never `"compatible"` — because a materialCode-/CAS-scoped rule could
 * never have fired against it (task's own "do not silently assume
 * compatible" requirement). `unresolvedMaterialCount` is always exposed
 * separately and honestly, whatever the state, so a formula with both real
 * findings AND partial coverage never has one fact hide the other.
 */
import { evaluateCompatibility, type CompatibilityFinding, type CompatibilityRule, type RawMaterial } from "@formulab/shared";
import { linesFromGeneratedFormula } from "./formulations";

export type CompatibilityFormulaState = "compatible" | "warning" | "blocked" | "unknown";

export interface GeneratedFormulaCompatibility {
  formulaState: CompatibilityFormulaState;
  findings: CompatibilityFinding[];
  /** Ingredients with no resolvable `materialCode` — excluded from every
   *  materialCode-/CAS-number-scoped rule (function- and name-keyword-
   *  scoped rules can still fire against them, per the real engine's own
   *  matching logic — this count is honest partial coverage, not "these
   *  ingredients were never checked at all"). */
  unresolvedMaterialCount: number;
  evaluatedAt: string;
}

export function evaluateGeneratedFormulaCompatibility(
  formula: unknown,
  materials: RawMaterial[],
  rules: CompatibilityRule[],
  opts: { phTarget?: string; processTempC?: string } = {},
): GeneratedFormulaCompatibility {
  const evaluatedAt = new Date().toISOString();
  const lines = linesFromGeneratedFormula(formula);
  const unresolvedMaterialCount = lines.filter((l) => !l.materialCode).length;

  const findings = evaluateCompatibility(lines, rules, {
    materials,
    phTarget: opts.phTarget,
    processTempC: opts.processTempC,
  });

  const hasBlocking = findings.some((f) => f.severity === "blocking");
  const formulaState: CompatibilityFormulaState = hasBlocking
    ? "blocked"
    : findings.length > 0
      ? "warning"
      : unresolvedMaterialCount > 0
        ? "unknown"
        : "compatible";

  return { formulaState, findings, unresolvedMaterialCount, evaluatedAt };
}
