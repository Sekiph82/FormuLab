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
}

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
}

export interface GenerateResult {
  status: "ok" | "refused" | "error" | "human_review_required";
  message?: string;
  cards?: FormulationCard[];
  slug?: string;
  papers?: number;
  session_id?: string;
  session_dir?: string;
  /** Present on "refused" and "human_review_required" — the deterministic
   *  pre-generation safety classification the request was given. */
  classification?: SafetyClassification;
}

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
  provenance_sources?: string[];
}

export interface SessionDetail {
  status: "ok";
  id: string;
  brief: FormulationBrief | null;
  cards: FormulationCard[];
  literature?: LiteratureDocument[];
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
  n = 3,
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
