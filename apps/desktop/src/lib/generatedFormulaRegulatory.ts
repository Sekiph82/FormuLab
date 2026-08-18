/**
 * FVL-03.010 — the one seam between a generated formula card and the
 * authoritative Regulatory Engine (`packages/shared/src/engine/
 * regulatoryRules.ts::evaluateRegulatory`).
 *
 * Single-authority rule: this module never matches a rule, never decides
 * a compliance status, and never invents a jurisdiction/category taxonomy
 * — `evaluateRegulatory()` (deterministic, rule-driven, no model in the
 * loop) does that entirely. This file only (a) reshapes a generated
 * card's `formula.ingredients[]` into `FormulationLine[]` (via
 * `linesFromGeneratedFormula`, the same helper every prior FVL-03 session
 * reuses), (b) resolves the brief's free-text `market` into a real
 * `RegulatoryJurisdiction` code via a small deterministic alias table
 * (the exact same text normalization `runtime/pipeline/regulatory.py`'s
 * own retired `resolve_market()` did — legitimate input preprocessing,
 * never a second rule catalog or verdict), and (c) hands the result to
 * the real engine. The rule set is a REQUIRED caller-supplied parameter,
 * never hardcoded — the real authoritative rule library is the live,
 * chemist-editable `regulatory_rules` masterdata collection
 * (`RegulatoryPanel.tsx::listRecordsSeeded("regulatory_rules",
 * SEED_REGULATORY_RULES)`), not the bare `SEED_REGULATORY_RULES`
 * constant. Nothing here is persisted — `evaluateRegulatory` is pure, so
 * a generated (not-yet-saved) card can be evaluated read-only with no
 * promotion/save-first step, same as Compatibility/Safety.
 *
 * `category` is deliberately always `"human_review_required"` — the same
 * scope decision FVL-03.008/.009 already made for
 * `classifyProductCompatibility`-adjacent/`classifyProductSafety`: a
 * generated session's free-text `brief.category` has no reliable join to
 * a real `ProductFamily` record, and `classifyProductRegulatory()`
 * requires one. Fabricating that join would violate the standing
 * no-fabricated-identity rule. `"human_review_required"` is not an
 * invented fallback — it is the REAL engine's own admission-of-
 * uncertainty category value (`classifyProductRegulatory` itself returns
 * it when a domain has no configured mapping), reused honestly rather
 * than guessed. The practical effect is honest, not degraded: a rule
 * scoped to a specific `productCategories` list never fires for a
 * generated formula (this installation cannot confirm the real category
 * yet), while a rule with no category restriction (label/language/
 * market-identifier requirements, which apply to every category) still
 * evaluates normally — exactly the same honest under-coverage every
 * other unresolved-identity case in this platform already produces.
 *
 * `formulaState` reuses the real engine's own status vocabulary
 * (`REGULATORY_FINDING_STATUSES`) and its own established blocking
 * convention — `NON_BLOCKING_FINDING_STATUSES` — for the "clean" bucket,
 * matching `regulatoryApproval.ts::hasBlockingFinding`'s own use of it
 * (not invented here). `"blocked"` is reserved specifically for a real
 * `non_compliant` finding — the literal trigger every FVL-03.010
 * acceptance case describes ("a formula violates a rule") — never for a
 * `missing_data`/`human_review_required` finding, which is an honest
 * "needs review" signal, not a proven violation; almost every generated
 * formula in a covered jurisdiction will carry at least one
 * `missing_data` finding for an unconfirmed product-level requirement
 * (label elements, language, market identifier) since a generated,
 * unsaved session never has a named human's `manuallyConfirmedRuleIds`
 * — that is real, honest incompleteness, not a hard failure, and must
 * not silently exclude a formula from cost/inventory eligibility the way
 * a genuine `non_compliant` violation does.
 *
 * Zero findings is NEVER reported as `"compliant"` — deliberately
 * preserving the exact policy `regulatory.py`'s own module docstring
 * stated before its retirement ("Coverage itself, even with zero matched
 * findings, is always surfaced — never silently implying a clean
 * COMPLIANT from nothing having matched"): this installation's real rule
 * catalog is inherently sparse per jurisdiction, so an empty finding list
 * much more often means "no rule in this installation's data happens to
 * cover this yet" than "this product is confirmed clean." `"unknown"` is
 * used for both an unresolved market and a resolved-but-empty result.
 */
import { evaluateRegulatory, NON_BLOCKING_FINDING_STATUSES, type RawMaterial, type RegulatoryFinding, type RegulatoryJurisdiction, type RegulatoryRule } from "@formulab/shared";
import { linesFromGeneratedFormula } from "./formulations";

export type RegulatoryFormulaState = "compliant" | "warning" | "blocked" | "unknown";

export interface GeneratedFormulaRegulatory {
  formulaState: RegulatoryFormulaState;
  /** The jurisdiction the brief's own `market` text resolved to, or
   *  `undefined` when it did not match any known market alias — never
   *  guessed. */
  jurisdiction?: RegulatoryJurisdiction;
  /** The raw, unresolved market text from the brief, for honest display
   *  when `jurisdiction` is `undefined`. */
  requestedMarket: string;
  findings: RegulatoryFinding[];
  unresolvedMaterialCount: number;
  evaluatedAt: string;
}

/** Deterministic text normalization only — the same real-world aliases
 *  `regulatory.py::_MARKET_ALIASES` already used, ported directly, never
 *  a general "infer any market" mechanism. An unrecognized market string
 *  resolves to `undefined`, never a guessed jurisdiction. */
const MARKET_ALIASES: Record<string, RegulatoryJurisdiction> = {
  kenya: "KE", ke: "KE",
  uganda: "UG", ug: "UG",
  tanzania: "TZ", tz: "TZ",
  rwanda: "RW", rw: "RW",
  burundi: "BI", bi: "BI",
  "south sudan": "SS", southsudan: "SS", ss: "SS",
  eac: "EAC", "east africa": "EAC", "east african community": "EAC",
};

export function resolveRegulatoryMarket(market: string | undefined): RegulatoryJurisdiction | undefined {
  const key = (market ?? "").trim().toLowerCase();
  return MARKET_ALIASES[key];
}

export function evaluateGeneratedFormulaRegulatory(
  formula: unknown,
  materials: RawMaterial[],
  rules: RegulatoryRule[],
  opts: { market?: string; claims?: string } = {},
): GeneratedFormulaRegulatory {
  const evaluatedAt = new Date().toISOString();
  const lines = linesFromGeneratedFormula(formula);
  const unresolvedMaterialCount = lines.filter((l) => !l.materialCode).length;
  const requestedMarket = (opts.market ?? "").trim();
  const jurisdiction = resolveRegulatoryMarket(requestedMarket);

  if (!jurisdiction) {
    return { formulaState: "unknown", jurisdiction: undefined, requestedMarket, findings: [], unresolvedMaterialCount, evaluatedAt };
  }

  const claims = (opts.claims ?? "").split(",").map((c) => c.trim()).filter(Boolean);

  const findings = evaluateRegulatory(lines, rules, {
    jurisdiction,
    category: "human_review_required",
    materials,
    claims,
  });

  const hasNonCompliant = findings.some((f) => f.status === "non_compliant");
  const allClean = findings.length > 0 && findings.every((f) => NON_BLOCKING_FINDING_STATUSES.includes(f.status));

  const formulaState: RegulatoryFormulaState = hasNonCompliant
    ? "blocked"
    : findings.length === 0
      ? "unknown"
      : allClean
        ? "compliant"
        : "warning";

  return { formulaState, jurisdiction, requestedMarket, findings, unresolvedMaterialCount, evaluatedAt };
}
