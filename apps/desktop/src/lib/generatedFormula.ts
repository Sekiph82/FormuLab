/**
 * Phase 14 — the real shape `runtime/pipeline/pipeline.py::run()` returns
 * for one generated candidate (`card.formula`, wire-typed `unknown` in
 * `formulationV2.ts` since the Rust/Python boundary doesn't validate it).
 * Named and typed here once so the request/result screens don't each
 * re-guess the shape.
 */
export interface GeneratedReference {
  author?: string;
  year?: string;
  doi?: string;
  title?: string;
}

export interface GeneratedIngredient {
  inci?: string;
  function?: string;
  weight_pct?: string;
}

export interface GeneratedFormula {
  name?: string;
  purpose?: string;
  references?: GeneratedReference[];
  ingredients?: GeneratedIngredient[];
  how_it_works?: { title?: string; text?: string }[];
  avoid?: { item?: string; reason?: string }[];
  usage?: string[];
  warnings?: string[];
}

/** Narrow the wire-typed `unknown` `card.formula` to `GeneratedFormula`
 *  without trusting its shape blindly — every field access downstream
 *  already tolerates `undefined`, this only rules out non-object values. */
export function asGeneratedFormula(formula: unknown): GeneratedFormula | undefined {
  if (!formula || typeof formula !== "object") return undefined;
  return formula as GeneratedFormula;
}

/** Total active-matter contribution is not computed by the pipeline today
 *  (`weight_pct` is a free-form string, e.g. "q.s. 100" or "5.50") — this
 *  parses only the ones that are genuinely a plain number, never guesses a
 *  value for "q.s." or a range. Returns `undefined` when nothing in the
 *  formula is numerically parseable, so the caller can show "not
 *  available" honestly instead of a fabricated 0. */
export function parsePercent(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = /-?\d+(\.\d+)?/.exec(raw);
  if (!match) return undefined;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : undefined;
}

export function totalWeightPct(formula: GeneratedFormula | undefined): number | undefined {
  const values = (formula?.ingredients ?? []).map((i) => parsePercent(i.weight_pct)).filter((n): n is number => n !== undefined);
  if (values.length === 0) return undefined;
  return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
}

/** A stable per-ingredient id for selection/evidence-panel keying —
 *  `formulaVersionId + ingredientId + concentration`, architecture doc §9's
 *  context key. INCI name + row index (not just INCI name, since a formula
 *  can legitimately repeat a function/name shape, and index keeps it
 *  unambiguous within one version). */
export function ingredientId(index: number, ingredient: GeneratedIngredient): string {
  return `${index}:${(ingredient.inci ?? "ingredient").toLowerCase().replace(/\s+/g, "-")}`;
}
