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
  /** The generator's candidate key — the key of this ingredient in the card's
   *  `ingredient_origins` and `evidence_links`. Absent on older sessions. */
  key?: string;
  function?: string;
  weight_pct?: string;
  /** FVL-03.011 — the real canonical `RawMaterial.code` this ingredient
   *  resolved to (see `formulations.ts::linesFromGeneratedFormula()`),
   *  when the generator matched a candidate to the Material Master.
   *  Absent means genuinely unresolved — never fabricated. */
  material_code?: string;
  supplier_product_card_evidence?: Array<{
    productCardId: string;
    cardVersion: number;
    supplierName?: string;
    supplierItemCode?: string;
    tradeName?: string;
    grade?: string;
    market: string;
    language: string;
    identityStatus: string;
    conflicts: Array<{ fieldCode: string; claimIds: string[]; status: "review_required" }>;
    claimComparisons: Array<{ claimId: string; field: string; currentValue: unknown }>;
    interpretation: string;
    claims: Array<{
      claimId: string;
      fieldCode: string;
      rawValue: string;
      normalizedValue?: string;
      originalUnit?: string;
      normalizedUnit?: string;
      qualifier: string;
      basis: string;
      documentType: "SDS" | "TDS";
      documentHash: string;
      sourceEvidenceId: string;
      acquisitionCode: string;
      originalFilename?: string;
      sourceRevision?: string;
      reviewId: string;
      reviewedBy: string;
      reviewedAt: string;
      citations: Array<{ pageNumber: number; excerpt: string; documentHash: string; lineNumber?: number }>;
    }>;
  }>;
}

/** How reviewed supplier field formulas (imported formula PDFs) supported one
 *  ingredient: `engine.py` `reference_formulation_evidence`. */
export interface ReferenceFormulationEvidence {
  ingredient_key?: string;
  canonical_chemistry_id?: string;
  product_family_key?: string;
  formula_count: number;
  eligible_formula_count: number;
  supplier_count: number;
  source_record_ids?: string[];
  source_formulas?: {
    id: string; title?: string; supplierId?: string; originalFilename?: string;
    printedName?: string; printedAmount?: string; pageNumber?: number | null;
  }[];
  dosage_guidance?: { formula_count: number; typical_range_percent: { lower: number; upper: number } };
}

export interface GeneratedFormula {
  name?: string;
  purpose?: string;
  references?: GeneratedReference[];
  ingredients?: GeneratedIngredient[];
  reference_formulation_evidence?: ReferenceFormulationEvidence[];
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

/** The card's own key for an ingredient. The generator's `key` when the session
 *  has it; for an older session the display name, or else the INCI a trade name
 *  prints in brackets ("Ucare Polymer JR 400 (Polyquaternium-10)" ->
 *  "polyquaternium-10") when only that key is in `known`. */
export function cardIngredientKey(ingredient: GeneratedIngredient, known?: Record<string, unknown>): string {
  if (ingredient.key) return ingredient.key;
  const display = normalizeIngredientKey(ingredient.inci);
  if (!known || display in known) return display;
  const inner = normalizeIngredientKey(/\(([^()]+)\)\s*$/u.exec(ingredient.inci ?? "")?.[1]);
  return inner && inner in known ? inner : display;
}

/** The field-formula evidence the generator recorded for this ingredient key. */
export function referenceEvidenceFor(formula: GeneratedFormula | undefined, key: string): ReferenceFormulationEvidence | undefined {
  return formula?.reference_formulation_evidence?.find((item) =>
    (item.ingredient_key ?? item.canonical_chemistry_id?.split(":").slice(1).join(":")) === key);
}
