// FormuLab v2 — direct pipeline bridge (no OpenCode).
//
// Thin wrappers over the Rust `generate_formulation` / `*_session` commands plus
// a tiny localStorage-backed store for the chosen provider, model, and API key.
// Self-contained so it runs independently of the (to-be-removed) OpenCode stack.

import { isTauri } from "./tauri";

export interface FormulationBrief {
  target: string;
  category?: string;
  audience?: string;
  market?: string;
  max_cost?: string;
  performance?: string;
  materials?: string;
  /** Set when resubmitting after a human_review_required response, so the
   *  safety gate can record who reviewed a hazardous/regulated/medical
   *  classification before literature discovery proceeds. */
  human_review_acknowledged?: boolean;
  human_review_by?: string;
  // Phase 14 — "New Formulation Request" screen's structured fields
  // (docs/PHASE14_FRONTEND_UI_SPECIFICATION.md). `generate_formulation`'s
  // Rust command forwards the whole `brief` object to Python as opaque
  // JSON (`GenerateRequest.brief: serde_json::Value`); `pipeline.py::run()`
  // -> `rules.py::derive_constraints` now DOES enforce a subset of these
  // deterministically (wired in the UI-repair round that followed this
  // screen's initial build): `excludedIngredients` reaches the hard
  // avoid-list (and therefore `validate()`'s post-generation check, not
  // just the LLM prompt); `preferredIngredients` reaches the soft prefer
  // list; `claims`/`targetProductType` are folded into the same trigger-
  // phrase text `target`/`category`/`performance` already are, so e.g. a
  // "sulfate-free" claim entered ONLY in the Claims field (not restated in
  // the natural-language request) still fires the sensitive-ingredient
  // exclusion; `targetPhMin`/`targetPhMax`, when both set, override the
  // category-derived target pH range. `targetViscosity`/`targetActiveMatter`/
  // `targetCostLevel`/`packagingType`/`estimatedBatchSize`/
  // `availableEquipment`/`availableRawMaterials` still have no deterministic-
  // rule equivalent — they reach the LLM as "PRODUCT BRIEF" context only
  // (soft influence), same as before. See `rules.py::derive_constraints`'s
  // own doc comment for the authoritative, code-level list.
  targetProductType?: string;
  excludedIngredients?: string;
  preferredIngredients?: string;
  targetPhMin?: string;
  targetPhMax?: string;
  targetViscosity?: string;
  targetActiveMatter?: string;
  targetCostLevel?: string;
  claims?: string;
  packagingType?: string;
  estimatedBatchSize?: string;
  availableEquipment?: string;
  availableRawMaterials?: string;
}

/** Mirrors PRODUCT_SAFETY_CLASSIFICATIONS in packages/shared/src/schemas/safety.ts. */
export type SafetyClassification =
  | "ordinary_consumer_product"
  | "industrial_cleaning_product"
  | "hazardous_lawful_product"
  | "regulated_disinfectant"
  | "medical_or_health_related_product"
  | "restricted_request"
  | "prohibited_request"
  | "human_review_required";

/** Phase 14 Session 3 — `strategy.py::VersionStrategy.to_dict()`'s exact
 *  shape. Always Python-derived, matched to its card by index — never
 *  something the LLM could fabricate or omit. Absent on a pre-Session-3
 *  session's cards.json (optional, never assumed present). */
export interface VersionStrategy {
  formula_version_id: string;
  label: string;
  strategy_type: string;
  title: string;
  rationale: string;
  primary_priorities: string[];
  secondary_priorities: string[];
  tradeoffs_accepted: string[];
  tradeoffs_forbidden: string[];
}

/** `strategy.py::VersionScore.to_dict()` — every factor named; `total` is
 *  always exactly their weighted sum, never an opaque number. Absent
 *  (`undefined`) when the pipeline itself judged a score not credibly
 *  computable — the UI must show "not yet available", never fabricate one. */
export interface VersionScore {
  hard_constraint_compliance: number;
  evidence_strength: number;
  formulation_completeness: number;
  evidence_gap_penalty: number;
  total: number;
}

/** One `evidence.py::EvidenceRecord.to_dict()`, with `formula_version_id`
 *  set by `strategy.py::link_evidence_to_version()` — real, traceable
 *  provenance for this SPECIFIC version's use of this SPECIFIC ingredient,
 *  never assumed to apply equally across versions (architecture doc §7). */
export interface EvidenceLink {
  formula_version_id: string;
  ingredient_key: string;
  ingredient_raw: string;
  evidence_class: "A" | "B" | "C" | "D" | "E";
  source_depth: "full_text" | "abstract_only" | "metadata_only";
  paper_doi: string;
  paper_title: string;
  paper_year: string;
  paper_authors: string;
  paper_venue: string;
  unique_source_count: number;
  provenance_sources: string[];
  evidence_text: string;
  concentration?: { value: number; value_max: number | null; unit: string; basis: string } | null;
  outcome?: string;
}

/** `"evidence_supported"` a linked record reports a comparable concentration;
 *  `"evidence_context_only"` evidence exists for the ingredient but not a
 *  comparable concentration; `"formulab_inference"` no linked evidence at
 *  all — the model's own choice, never mislabeled as literature-backed
 *  (`strategy.py::concentration_alignment()`). Keyed by the SAME
 *  normalized ingredient key `EvidenceLink.ingredient_key` uses. */
export type ConcentrationAlignment = Record<string, "evidence_supported" | "evidence_context_only" | "formulab_inference">;

/** `provenance.py::GenerationProvenance.to_dict()`. As of the Phase 15
 *  zero-LLM round every NEW session has `engine_type: "deterministic"`,
 *  `source: "formulab_deterministic_engine"`, and blank `provider`/`model`
 *  (no credential is used or reported). A session generated before that
 *  round still reads back `engine_type: "llm"`, `source:
 *  "real_model_call"`, and a real provider/model — old sessions are never
 *  rewritten, see `provenance.py`'s own module docstring. */
export interface GenerationProvenance {
  engine_type: "deterministic" | "llm" | string;
  source: string;
  provider: string;
  model: string;
  generated_at: string;
}

/** `provenance.py::MassBalance.to_dict()` — the deterministic,
 *  authoritative mass-balance calculation. Prefer this over any client-side
 *  recomputation from `formula.ingredients` when present (this IS the fix
 *  for the "129.5% w/w accounted for" bug: q.s.-to-100 is closed, not
 *  double-counted). Absent on a pre-Session-4 session. */
export interface MassBalance {
  explicit_subtotal: number;
  qs_ingredient_keys: string[];
  qs_amount: number | null;
  final_total: number | null;
  status: "complete" | "incomplete" | "invalid_over_100" | "ambiguous_multiple_qs" | "invalid_negative_qs" | "malformed";
  issues: string[];
}

/** `provenance.py::IngredientOrigin` values — an ingredient can legitimately
 *  carry more than one. As of the Phase 15 zero-LLM round, a NEW
 *  deterministic session's ingredients carry only `scientific_evidence`/
 *  `supplier_data`/`deterministic_rule`/`user_required` — never
 *  `ai_formulation_inference` (the deterministic engine cannot invent an
 *  ingredient outside its own traceable candidate pool). A session
 *  generated before that round can still show `ai_formulation_inference` —
 *  old sessions are never rewritten. `internal_formulab_data` stays
 *  reserved (no curated, lab-validated internal concentration-history
 *  database exists). Keyed by `formulationV2.ts`'s own
 *  `normalizeIngredientKey()`. */
export type IngredientOriginMap = Record<string, string[]>;

/** `engine.py`'s own explicit completeness states — never treat every
 *  generated candidate as a successful formulation (§10). */
export type FormulaState =
  | "complete"
  | "complete_with_validation_required"
  | "incomplete_missing_evidence"
  | "incomplete_missing_material"
  | "incomplete_missing_functional_role"
  | "invalid_constraint_violation"
  | "invalid_mass_balance";

export interface MissingRole {
  role: string;
  level: string;
  reason: string;
}

/** `evidence.py::ComparableConcentrationStats.to_dict()` — built ONLY from
 *  strictly comparable evidence (same ingredient, same unit+basis, >= 2
 *  unique studies). `null`/absent means "Insufficient comparable evidence",
 *  never a fabricated range. Keyed by normalized ingredient key. */
export interface ComparableStats {
  observed_min: number;
  observed_max: number;
  median: number;
  unique_study_count: number;
  unit: string;
  basis: string;
  confidence: "low" | "medium" | "high";
}
export type ComparableStatsMap = Record<string, ComparableStats | null>;

/** `provenance.py::QualityGateFinding.to_dict()` — `factor` is always one of
 *  the named, documented keys in `provenance.QUALITY_GATE_FACTORS`; never a
 *  hard reject, only a transparent warning/info note. */
export interface QualityGateFinding {
  factor: string;
  severity: "warning" | "info";
  message: string;
}

/** `provenance.py::ResearchCorpusSummary.to_dict()` — the research corpus
 *  (unique relevant documents) and structured evidence (extracted
 *  findings) are deliberately separate counts, never interchangeable
 *  (architecture doc §5). */
export interface ResearchCorpusSummary {
  raw_candidate_count: number;
  qualifying_count: number;
  target_count: number;
  full_text_count: number;
  abstract_only_count: number;
  metadata_only_count: number;
  evidence_record_count: number;
  unique_evidence_study_count: number;
  /** Phase 14 Session 6 correction gate — real and separate from
   *  `qualifying_count >= target_count`: whether `target_count` full
   *  texts were actually obtained after searching deeper into the
   *  candidate pool. `false` is an honest outcome, not an error. */
  full_text_gate_met?: boolean;
  /** 2026-08-17 correction — `provenance.py::research_corpus_status()`.
   *  `"full"` (>= 15 full texts) is normal generation; `"partial"` (10-14)
   *  still generates formulas with the shortfall disclosed; `"insufficient"`
   *  (< 10) blocks generation entirely (`GenerateResult.status ===
   *  "research_corpus_incomplete"`, no card ever reaches the UI). */
  /** Absent on a pre-2026-08-17 session (never retroactively computed —
   *  historical sessions stay readable, they just carry no status). */
  status?: "full" | "partial" | "insufficient";
  /** FormuLab v1 correction (FVL-03) — complete scientific formulations
   *  extracted from this card's own retrieved literature (never the same
   *  number as `evidence_record_count` — a whole architecture vs. a
   *  single ingredient mention). */
  scientific_formulation_count?: number;
  scientific_formulation_with_outcomes_count?: number;
}

/** Preferred full-text target = 15, minimum corpus allowed for
 *  formulation = 10 — mirrors `provenance.RESEARCH_FULL_TEXT_TARGET`/
 *  `RESEARCH_FULL_TEXT_MINIMUM`, the one authoritative source of truth. */
export const RESEARCH_FULL_TEXT_TARGET = 15;
export const RESEARCH_FULL_TEXT_MINIMUM = 10;

/** `manufacturing.py::ProcessStep.to_dict()` — one manufacturing step for
 *  this formula version. `basis` is always one of `"scientific_evidence"`/
 *  `"supplier_data"`/`"internal_formulab_data"`/`"deterministic_rule"` —
 *  never an AI/unknown origin. `temperature_c`/`time_minutes` are `null`
 *  and `mixing_method` reads "Not established — laboratory validation
 *  required" whenever no real process data backs them — never an invented
 *  number. */
export interface ProcessStep {
  order: number;
  phase: string;
  role: string;
  ingredients: string[];
  instruction: string;
  equipment: string;
  mixing_method: string;
  temperature_c: number | null;
  time_minutes: number | null;
  endpoint: string;
  basis: string;
  evidence_doi: string;
  confidence: "established" | "not_established";
}

/** `manufacturing.py::CriticalParameter.to_dict()`. `param_type` is either
 *  `"target"` or `"critical_limit"` — a target is never automatically
 *  treated as a hard boundary (§25). */
export interface CriticalParameter {
  parameter: string;
  param_type: "target" | "critical_limit";
  range_or_limit: string;
  source_type: string;
  why_it_matters: string;
  consequence_if_violated: string;
  confidence: "established" | "not_established";
  evidence_doi: string;
}

/** `manufacturing.py::EquipmentRecommendation.to_dict()`. */
export interface EquipmentRecommendation {
  equipment: string;
  purpose: string;
  requirement_level: "required" | "preferred" | "optional";
  suggested_capacity: string;
  key_capabilities: string[];
  used_in_steps: string[];
  available_in_facility: "yes" | "missing" | "partially_suitable" | "not_specified";
  basis: string;
  confidence: "established" | "not_established";
}

/** `manufacturing.py::ManufacturingPlan.to_dict()`. `ready: false` means
 *  this formula version's own state was invalid (bad mass balance or a
 *  hard-constraint violation) and process planning was correctly skipped
 *  rather than planned around a nonsensical formula (§31) —
 *  `not_ready_reason` explains why; every other field is empty in that
 *  case, never a partial or fabricated plan. */
export interface ManufacturingPlan {
  ready: boolean;
  not_ready_reason: string;
  steps: ProcessStep[];
  critical_parameters: CriticalParameter[];
  equipment: EquipmentRecommendation[];
  batch_scale: "laboratory" | "pilot" | "production" | "not_specified";
}

/** `safety.py::SafetyFinding.to_dict()`. */
export interface SafetyFinding {
  subject_type: "ingredient" | "formula" | "process_step";
  subject: string;
  status: "PASS" | "PASS_WITH_CONDITIONS" | "FAIL" | "DATA_INCOMPLETE";
  rule_id: string;
  source_type: string;
  condition: string;
  actual_value: string;
  rationale: string;
  required_action: string;
}

/** `safety.py::SafetyResult.to_dict()`. Computed independently per
 *  version — a V1 PASS never implies a V2 PASS (§20). */
export interface SafetyResult {
  overall_status: "PASS" | "PASS_WITH_CONDITIONS" | "FAIL" | "DATA_INCOMPLETE";
  findings: SafetyFinding[];
}

/** `regulatory.py::RegulatoryFinding.to_dict()`. */
export interface RegulatoryFinding {
  subject_type: "ingredient" | "formula" | "claim" | "label";
  subject: string;
  status: "COMPLIANT" | "COMPLIANT_WITH_CONDITIONS" | "NON_COMPLIANT" | "DATA_INCOMPLETE";
  rule_id: string;
  jurisdiction: string;
  condition: string;
  actual_value: string;
  rationale: string;
  required_action: string;
}

/** `regulatory.py::ClaimFinding.to_dict()` — §16's own three-way
 *  distinction: a formulation-composition check, a market-specific
 *  regulatory-eligibility check, or a claim that can never be satisfied by
 *  composition alone and always requires real substantiation. */
export interface ClaimFinding {
  claim: string;
  check_type: "formulation_condition" | "regulatory_eligibility" | "substantiation_required";
  status: "COMPLIANT" | "COMPLIANT_WITH_CONDITIONS" | "NON_COMPLIANT" | "DATA_INCOMPLETE";
  rationale: string;
}

/** `regulatory.py::RegulatoryResult.to_dict()`. `coverage: "unsupported"`
 *  means this installation has NO real rule data for the requested market
 *  — `overall_status` is always `DATA_INCOMPLETE` in that case, never
 *  `COMPLIANT` (§13/§18). */
export interface RegulatoryResult {
  target_market: string;
  jurisdiction: string;
  coverage: "partial" | "unsupported";
  overall_status: "COMPLIANT" | "COMPLIANT_WITH_CONDITIONS" | "NON_COMPLIANT" | "DATA_INCOMPLETE";
  findings: RegulatoryFinding[];
  claims: ClaimFinding[];
  missing_coverage_note: string;
}

/** `validation_plan.py::ValidationCheck.to_dict()`. A recommended real
 *  check, never a claimed result. */
export interface ValidationCheck {
  check: string;
  rule_id: string;
  reason: string;
}

/** `traceability.py::TraceEvent.to_dict()` — the real, structured
 *  ingredient selection/rejection decision trace (§3/§4/§5). */
export interface TraceEvent {
  decision_id: string;
  formula_version_id: string;
  decision_type: "ingredient_selected" | "ingredient_rejected" | "role_coverage";
  subject_type: "ingredient" | "role";
  subject: string;
  result: "selected" | "rejected" | "covered" | "missing";
  rationale: string;
  source_type: string;
  source_ids: string[];
  rule_id: string;
  evidence_ids: string[];
  input_values: Record<string, unknown>;
  output_values: Record<string, unknown>;
  status: string;
  validation_required: boolean;
}

/** One real, structured evidence gap — assembled from data this card
 *  already computed (`missing_roles`/`quality_gate`/corpus counts/safety-
 *  regulatory DATA_INCOMPLETE findings), never generic filler text. */
export interface EvidenceGap {
  category: string;
  gap: string;
}

export interface FormulationCard {
  version: string; // "v1", "v2", …
  /** "ok" | "generation_failed" — absent on a pre-Session-3 session (treat
   *  as "ok" when `formula` is present, matching the old, still-supported
   *  shape). A failed slot has NO `formula`/`markdown` — never a fabricated
   *  placeholder formula. */
  status?: "ok" | "generation_failed";
  /** Only present when `status === "generation_failed"`. */
  failure_reason?: string;
  markdown?: string;
  formula?: unknown;
  violations?: string[];
  strategy?: VersionStrategy;
  evidence_links?: EvidenceLink[];
  concentration_alignment?: ConcentrationAlignment;
  score?: VersionScore | null;
  generation_provenance?: GenerationProvenance;
  mass_balance?: MassBalance;
  ingredient_origins?: IngredientOriginMap;
  comparable_stats?: ComparableStatsMap;
  quality_gate?: QualityGateFinding[];
  research_corpus?: ResearchCorpusSummary;
  formula_state?: FormulaState;
  missing_roles?: MissingRole[];
  unresolved_requirements?: string[];
  manufacturing?: ManufacturingPlan;
  safety?: SafetyResult;
  regulatory?: RegulatoryResult;
  validation_plan?: ValidationCheck[];
  trace_events?: TraceEvent[];
  evidence_gaps?: EvidenceGap[];
  architecture_basis?: ArchitectureBasis;
}

/** FormuLab v1 correction (FVL-03) — `engine.py::_classify_architecture()`,
 *  a whole-formula-level, real, computed architecture-provenance summary.
 *  Never a per-ingredient origin (see `IngredientOriginMap` for that). */
export interface ArchitectureBasis {
  origin: "scientific_formulation" | "scientific_formulation_adapted" | "supplier_formulation"
    | "internal_validated_formula" | "evidence_assembled" | "deterministic_rule";
  /** Populated only when `origin === "deterministic_rule"` — explains
   *  WHY no scientific architecture was used, real and specific, never
   *  generic filler text. */
  reason: string;
  source_paper_doi: string;
  source_title: string;
  /** The source table's own real column label, e.g. `"F4"`. */
  source_formulation_id: string;
  retained: number;
  modified: number;
  added: number;
  removed: number;
}

/** `scientific_formulation.py::FormulationIngredientRow.to_dict()`. */
export interface FormulationIngredientRow {
  source_name: string;
  value: number | null;
  value_text: string;
  unit: string;
  qs: boolean;
  order: number;
  normalized_key: string | null;
  material_id: string | null;
  identity_status: "resolved_known_ingredient" | "resolved_supplier_material" | "unresolved_material_identity";
}

/** `scientific_formulation.py::ScientificFormulationRecord.to_dict()` —
 *  one COMPLETE formulation architecture from a real paper's own table
 *  (e.g. one `F4` column), never a single ingredient mention. */
export interface ScientificFormulationRecord {
  id: string;
  canonical_paper_id: string;
  doi: string;
  source_title: string;
  source_year: string;
  source_authors: string;
  table_reference: string;
  source_formulation_id: string;
  product_type: string;
  formulation_title: string;
  ingredients: FormulationIngredientRow[];
  total_declared: string;
  evidence_class: "A" | "B" | "C" | "D" | "E";
  extraction_confidence: "high" | "low";
  missing_fields: string[];
  unresolved_rows: string[];
}

/** `scientific_formulation.py::ExperimentalOutcome.to_dict()` — a real,
 *  source-reported measurement tied to ONE specific source formulation. */
export interface ExperimentalOutcome {
  source_formulation_id: string;
  metric: string;
  value: number | null;
  unit: string;
  condition: string;
  raw_text: string;
}

/** `pipeline.py`'s own `scientific_formulation_summary` — session-wide,
 *  which scientific formulations were actually used vs. rejected, and
 *  why. Assembled from the cards already computed, never a second pass. */
export interface ScientificFormulationSummary {
  extracted_count: number;
  with_outcomes_count: number;
  architectures_used: { doi: string; source_title: string; source_formulation_id: string }[];
  architectures_rejected: { doi: string; source_title: string; source_formulation_id: string }[];
  all_selected_versions_rule_only: boolean;
  rule_only_despite_applicable_scientific_formulation: boolean;
}

export interface GenerateResult {
  status: "ok" | "ok_partial_research" | "refused" | "error" | "human_review_required" | "research_corpus_incomplete";
  message?: string;
  cards?: FormulationCard[];
  slug?: string;
  papers?: number;
  session_id?: string;
  session_dir?: string;
  /** Present on "refused" and "human_review_required" — the deterministic
   *  pre-generation safety classification the request was given. */
  classification?: SafetyClassification;
  /** Present on "research_corpus_incomplete" (Session 6 correction gate §9)
   *  — `provenance.py::ResearchCorpusSummary.to_dict()`, so the caller can
   *  show the real shortfall (X/15 full text) rather than just a message. */
  research_corpus?: Record<string, unknown>;
  scientific_formulation_summary?: ScientificFormulationSummary;
  /** FormuLab v1 (FVL-02) — `pipeline.py::run()`'s own real, honest 3-7
   *  formula-count contract. `requested_formula_count` is the caller's own
   *  `n`; `actual_formula_count` is `cards.length` — they may differ (a
   *  genuine shortfall), never silently padded to match. `alternative_
   *  shortfall`/`shortfall_reason` are only meaningful when actual <
   *  requested; `shortfall_reason` states the REAL cause (too few
   *  applicable strategies, or no defensible architecture remained for a
   *  slot) — never "no version selected it" alone. Present on `"ok"`/
   *  `"ok_partial_research"` only. */
  requested_formula_count?: number;
  actual_formula_count?: number;
  alternative_shortfall?: number;
  shortfall_reason?: string;
  /** FormuLab v1 (FVL-02.009) — DISTINCT from `status` above (which is
   *  entirely about research-corpus completeness, e.g. `"ok_partial_
   *  research"`). `"sufficient"` when `actual_formula_count >= 3`;
   *  `"insufficient_formula_alternatives"` when it fell below that real
   *  minimum — the alternatives that WERE produced are still returned
   *  as-is either way, never discarded, never padded. The two signals
   *  can be true simultaneously (e.g. `status: "ok_partial_research"` +
   *  `formula_alternatives_status: "insufficient_formula_alternatives"`)
   *  — neither ever overwrites the other. */
  formula_alternatives_status?: "sufficient" | "insufficient_formula_alternatives";
}

/** FormuLab v1 (FVL-02) — the one authoritative source of truth for the
 *  requestable formula-alternative count on the frontend, mirroring
 *  `engine.py`'s own `MIN_FORMULA_ALTERNATIVES`/`MAX_FORMULA_ALTERNATIVES`/
 *  `DEFAULT_FORMULA_ALTERNATIVES`. Every UI surface that offers this
 *  choice (`NewFormulationRequestPage`) reads these instead of repeating
 *  the numbers 3/7/3. */
export const MIN_FORMULA_ALTERNATIVES = 3;
export const MAX_FORMULA_ALTERNATIVES = 7;
export const DEFAULT_FORMULA_ALTERNATIVES = 3;
export const FORMULA_ALTERNATIVE_COUNTS = Array.from(
  { length: MAX_FORMULA_ALTERNATIVES - MIN_FORMULA_ALTERNATIVES + 1 },
  (_, i) => MIN_FORMULA_ALTERNATIVES + i,
);

export interface SessionSummary {
  id: string;
  created: number;
  brief: FormulationBrief | null;
  card_count: number;
}

/** Phase 14 Session 4 — one entry from the session's real
 *  `literature/papers.json` (`literature_cache.gather()`'s own corpus,
 *  post-dedup — the Evidence & Sources tab's real research corpus, never
 *  the same number as an evidence-record count). Always present for a
 *  session that reached literature retrieval; `[]` for one that didn't
 *  (or a pre-Session-4 session). */
export interface LiteratureDocument {
  source_db: string;
  title: string;
  year: string | number;
  authors: string;
  venue: string;
  doi: string;
  is_oa: boolean;
  oa_url: string;
  cited_by: number;
  pdf_file?: string;
  fulltext?: string;
  unique_source_count?: number;
  /** Which real hybrid provider(s) DISCOVERED this paper's metadata —
   *  distinct from `resolved_via` below (Phase 14 Session 6 correction
   *  gate: discovery and full-text resolution are separate real stages,
   *  never conflated). */
  provenance_sources?: string[];
  /** Which real mechanism actually produced the usable full-text URL —
   *  `"unpaywall"` when the OA-location resolver found it, or the
   *  discovering provider's own name when its own `oa_url` worked
   *  directly. Absent when no full text was obtained. */
  resolved_via?: string;
}

export interface SessionDetail {
  status: "ok";
  id: string;
  brief: FormulationBrief | null;
  cards: FormulationCard[];
  literature?: LiteratureDocument[];
  scientific_formulations?: {
    formulations: ScientificFormulationRecord[];
    outcomes: ExperimentalOutcome[];
    summary: ScientificFormulationSummary | null;
  };
  read_only: true;
}

// ---------------------------------------------------------------- providers ---

// The providers the pipeline's llm.py speaks. `free` flags a usable free tier.
// `models` are sensible defaults; the model field stays editable so any model id
// works without maintaining an exhaustive catalog.
export interface ProviderDef {
  id: string;
  label: string;
  free: boolean;
  keyUrl?: string;
  models: string[];
}

export const PROVIDERS: ProviderDef[] = [
  { id: "gemini", label: "Google Gemini", free: true,
    keyUrl: "https://aistudio.google.com/apikey",
    models: ["gemini-3.1-flash-lite", "gemini-3.1-flash", "gemini-3.1-pro"] },
  { id: "groq", label: "Groq", free: true,
    keyUrl: "https://console.groq.com/keys",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"] },
  { id: "openrouter", label: "OpenRouter", free: true,
    keyUrl: "https://openrouter.ai/keys",
    models: ["deepseek/deepseek-chat", "google/gemini-2.5-flash", "meta-llama/llama-3.3-70b-instruct"] },
  { id: "deepseek", label: "DeepSeek", free: false,
    keyUrl: "https://platform.deepseek.com/api_keys",
    models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "openai", label: "OpenAI", free: false,
    keyUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-5-mini", "gpt-5", "gpt-4o-mini"] },
  { id: "mistral", label: "Mistral", free: true,
    keyUrl: "https://console.mistral.ai/api-keys",
    models: ["mistral-small-latest", "mistral-large-latest"] },
  { id: "cerebras", label: "Cerebras", free: true,
    keyUrl: "https://cloud.cerebras.ai",
    models: ["llama-3.3-70b"] },
  { id: "together", label: "Together", free: false,
    keyUrl: "https://api.together.xyz/settings/api-keys",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"] },
  { id: "ollama", label: "Ollama (local)", free: true,
    models: ["llama3.1", "qwen2.5"] },
];

// -------------------------------------------------------------- key storage ---

const LS = {
  provider: "formulab.v2.provider",
  model: "formulab.v2.model",
  key: (provider: string) => `formulab.v2.key.${provider}`,
};

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
}

export function loadProviderConfig(): ProviderConfig {
  if (typeof window === "undefined") {
    return { provider: "gemini", model: "gemini-3.1-flash-lite", apiKey: "" };
  }
  const provider = window.localStorage.getItem(LS.provider) || "gemini";
  const def = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];
  const model = window.localStorage.getItem(LS.model) || def.models[0];
  const apiKey = window.localStorage.getItem(LS.key(provider)) || "";
  return { provider, model, apiKey };
}

export function saveProviderConfig(cfg: ProviderConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS.provider, cfg.provider);
  window.localStorage.setItem(LS.model, cfg.model);
  // Key is stored per-provider so switching providers keeps each key.
  window.localStorage.setItem(LS.key(cfg.provider), cfg.apiKey);
}

export function loadKeyFor(provider: string): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(LS.key(provider)) || "";
}

// ------------------------------------------------------------------ invoke ----

/** Phase 13 Session 4A: every command in this file now requires a valid
 *  session (`authz::current_actor_app`) — `token` is attached here, once,
 *  same pattern `formulations.ts`/`masterdata.ts`'s `call()` helpers use. */
async function call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error("not-desktop");
  const { invoke } = await import("@tauri-apps/api/core");
  const { currentSessionToken } = await import("./sessionToken");
  return invoke<T>(cmd, { token: currentSessionToken(), ...args });
}

export async function generateFormulation(
  brief: FormulationBrief,
  cfg: ProviderConfig,
  n: number = DEFAULT_FORMULA_ALTERNATIVES,
): Promise<GenerateResult> {
  return call<GenerateResult>("generate_formulation", {
    request: {
      brief,
      provider: cfg.provider,
      model: cfg.model,
      api_key: cfg.apiKey,
      n,
    },
  });
}

/**
 * Fired on `window` whenever the saved-session set changes (a run succeeded, a
 * session was deleted). The sidebar listens so its history list refreshes
 * without the workspace needing a reference to it.
 */
export const SESSIONS_CHANGED_EVENT = "formulab:sessions-changed";

export function notifySessionsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSIONS_CHANGED_EVENT));
  }
}

export async function listSessions(): Promise<SessionSummary[]> {
  if (!isTauri) return [];
  return call<SessionSummary[]>("list_sessions", {});
}

export async function readSession(id: string): Promise<SessionDetail> {
  return call<SessionDetail>("read_session", { id });
}

export async function deleteSession(id: string): Promise<void> {
  return call<void>("delete_session", { id });
}

// ------------------------------------------------------- materials + costing ---

export interface Material {
  material_id: string;
  name: string;
  inci: string;
  price: number | null;
  currency: string;
  unit: string;
  supplier: string;
  /** An ERP item code once this app is fed by one; empty until then. */
  external_ref: string;
}

export interface MaterialsDoc {
  status: "ok";
  schema_version: number;
  updated: string;
  currency: string;
  mixed_currencies?: string[];
  materials: Material[];
}

export interface ImportResult {
  status: "ok" | "error";
  message?: string;
  count?: number;
  priced?: number;
  currency?: string;
  warnings?: string[];
  mixed_currencies?: string[];
}

export interface CostLine {
  ingredient: string;
  weight_pct: number;
  qs: boolean;
  kg: number;
  unit_price: number | null;
  cost: number | null;
  supplier: string;
  note?: string;
}

export interface CostSheet {
  status: "ok" | "error";
  message?: string;
  batch_kg: number;
  currency: string;
  lines: CostLine[];
  total_cost: number;
  cost_per_kg: number;
  covered_pct: number;
  complete: boolean;
  unmatched: string[];
  markdown: string;
}

/** Import a raw-material price list the user picked (CSV/TSV). */
export async function importMaterials(path: string): Promise<ImportResult> {
  return call<ImportResult>("import_materials", { path });
}

export async function listMaterials(): Promise<MaterialsDoc> {
  return call<MaterialsDoc>("list_materials", {});
}

/** Cost one formula against the imported materials. Arithmetic, not a model. */
export async function costFormulation(
  formula: unknown,
  batchKg: number,
): Promise<CostSheet> {
  return call<CostSheet>("cost_formulation", { formula, batchKg });
}
