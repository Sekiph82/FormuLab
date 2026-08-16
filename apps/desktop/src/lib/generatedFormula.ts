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

/** A "q.s. to 100" ingredient — same recognition rule
 *  `provenance.py::compute_mass_balance()`'s `_QS_PATTERN` uses on the
 *  Python side (kept in sync by hand; mirrors "q.s"/"qs" case- and
 *  spacing-insensitively). "q.s. to 100" means "water closes the formula
 *  to 100%", never "100% water on top of everything else" — the exact
 *  "129.5% w/w accounted for" bug this session's own brief names came from
 *  `parsePercent` NOT having this check at all and matching the literal
 *  "100" inside "q.s. 100" as if it were a real, additional 100%
 *  contribution. */
export function isQsIngredient(raw: string | undefined): boolean {
  return /\bq\.?\s*s\.?\b/i.test(raw ?? "");
}

/** Total active-matter contribution is not computed by the pipeline today
 *  (`weight_pct` is a free-form string, e.g. "q.s. 100" or "5.50") — this
 *  parses only the ones that are genuinely a plain, EXPLICITLY-quantified
 *  number, never a q.s. entry and never guesses a value for a range.
 *  Returns `undefined` when nothing in the formula is numerically
 *  parseable, so the caller can show "not available" honestly instead of a
 *  fabricated 0. */
export function parsePercent(raw: string | undefined): number | undefined {
  if (!raw || isQsIngredient(raw)) return undefined;
  const match = /-?\d+(\.\d+)?/.exec(raw);
  if (!match) return undefined;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : undefined;
}

/** The EXPLICIT subtotal only — a q.s. ingredient's own share is not
 *  counted here (it closes the formula TO 100%, it is not an additional
 *  quantity on top of the rest). For the authoritative, deterministic
 *  final total/status, prefer `card.mass_balance`
 *  (`runtime/pipeline/provenance.py::compute_mass_balance()`, Phase 14
 *  Session 4) when the session has one — this is a client-side fallback
 *  for a pre-Session-4 session that doesn't. */
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

/** Phase 14 Session 3 — the EXACT same normalization
 *  `evidence.py::normalize_ingredient_key()` uses, so a formula ingredient's
 *  `inci` string matches the `ingredient_key` Python already computed for
 *  `EvidenceLink`/`ConcentrationAlignment` entries. Deliberately mirrors the
 *  Python regex character-for-character (`[^a-z0-9]+` -> "-", trimmed) —
 *  keep both in sync if either changes. */
export function normalizeIngredientKey(raw: string | undefined): string {
  return (raw ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
