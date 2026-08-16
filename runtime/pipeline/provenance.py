"""Phase 14 Session 4 — generation provenance, ingredient-origin
classification, deterministic mass-balance validation, and a transparent
formulation quality gate.

**Real formula-generation path, audited this session (not guessed)**:
`NewFormulationRequestPage.tsx`/`FormulationWorkspaceV2.tsx` ->
`formulationV2.ts::generateFormulation()` -> Tauri `generate_formulation`
(`formulation_v2.rs`) -> `run_cli.py` (stdin/stdout bridge) ->
`pipeline.py::run()` -> `llm.py::call()` — ONE real code path, no mock/test
double anywhere in it (`run_cli.py` never overrides `pipeline.run()`'s
`llm_call` parameter, which defaults to the real `llm.call`; every
`mock_llm`/test double in this codebase lives only inside `test_*.py`
files, never imported by production code). `llm.py::call()` makes one real
HTTP request to whichever provider the user configured in Settings
(`loadProviderConfig()`, `apps/desktop/src/lib/formulationV2.ts` —
localStorage-backed, never sent anywhere but the provider's own API and
this pipeline). No local model exists other than the optional Ollama
provider (`http://127.0.0.1:11434`, no key required, only used if the user
selects it and a local Ollama server is actually running). No automatic
fallback exists between providers — a failed call returns
`{"status": "error", ...}`, never a silently-substituted result. The
frontend itself blocks submission when no API key is set for a non-Ollama
provider (`NewFormulationRequestPage.tsx::submit()`), so the pipeline is
never invoked at all in that case — there is no "no provider configured"
code path inside `pipeline.py`/`run_cli.py` to audit, because the frontend
already prevents reaching it.

**API keys are never logged.** `formulation_v2.rs` pipes the request
(including `api_key`) to the Python process over stdin only, never through
any logging macro. `pipeline.py`'s own `log()` calls carry only query
counts, source names, evidence counts, and strategy titles — never the key
or raw prompt text. `llm.py::call()` uses the key only in the
`Authorization` header of the outbound HTTP request. Diagnostics export
(`diagnostics.rs::redact_text()`) independently masks any long token-like
string before any log content ever leaves the machine, as a second layer.
"""

from __future__ import annotations

import re
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

from evidence import normalize_ingredient_key

SCHEMA_VERSION = 1


# ------------------------------------------------------ generation provenance

@dataclass(frozen=True)
class GenerationProvenance:
    """Persisted once per session (one real model call produces every
    version, per Session 3's own architecture decision) — never ambiguous
    about who/what produced a formula."""

    engine_type: str
    """`"llm"` — the only real value in production today. `"deterministic_
    logic"`/`"imported_formula"` are reserved values for a future
    generation path this session does not build (no deterministic-only or
    import flow exists yet) — modeled honestly as reserved, not invented as
    if already real."""
    source: str
    """`"real_model_call"` — the only real value today, set only after
    `llm_call` actually returns successfully. Never set to a value implying
    a mock/deterministic/imported origin when the real model path ran."""
    provider: str
    model: str
    generated_at: str
    """ISO 8601 UTC timestamp of the successful model call."""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def build_generation_provenance(provider: str, model: str) -> GenerationProvenance:
    """Called only immediately after `llm_call` succeeds — never
    speculatively, never before the real call is confirmed to have
    happened. Contains no secret: `provider`/`model` are plain identifiers
    (e.g. "gemini"/"gemini-3.1-flash"), never the API key."""
    return GenerationProvenance(
        engine_type="llm", source="real_model_call", provider=provider, model=model,
        generated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


# ----------------------------------------------------------- ingredient origin

class IngredientOrigin:
    """String constants, not an Enum — a formula ingredient can legitimately
    carry MORE THAN ONE origin at once (e.g. both `DETERMINISTIC_RULE` and
    `SCIENTIFIC_EVIDENCE`), so callers work with a `List[str]`, not a single
    value. `SUPPLIER_DATA`/`INTERNAL_FORMULAB_DATA` are real, documented
    categories in this model but NOT YET WIRED into generation this
    session — `pipeline.py::run()` has no live connection to the user's
    priced materials list (`materials.py`, a separate Tauri command/data
    directory never passed into `pipeline.run()`) or to any supplier
    technical-data source. Classifying an ingredient into either of those
    two categories without a real, live data source behind it would be
    exactly the fabrication this whole model exists to prevent — so
    `classify_ingredient_origin` below never emits them. Real, disclosed
    scope boundary; wiring a live masterdata/supplier connection into
    generation is future work."""

    SCIENTIFIC_EVIDENCE = "scientific_evidence"
    SUPPLIER_DATA = "supplier_data"  # reserved — not live this session
    INTERNAL_FORMULAB_DATA = "internal_formulab_data"  # reserved — not live this session
    DETERMINISTIC_RULE = "deterministic_rule"
    USER_REQUIRED = "user_required"
    AI_FORMULATION_INFERENCE = "ai_formulation_inference"


def _split_terms(raw: str) -> List[str]:
    return [t.strip() for t in re.split(r"[,;/]", raw or "") if t.strip()]


def classify_ingredient_origin(
    ingredient_name: str,
    brief: Dict[str, Any],
    constraints: Dict[str, Any],
    version_links: List[Dict[str, Any]],
) -> List[str]:
    """Every real, currently-wired signal this pipeline actually has,
    checked in this order (a real ingredient commonly carries more than
    one): linked structured evidence (Session 2/3's own
    `link_evidence_to_version` output) -> `rules.py::derive_constraints`'s
    own deterministic `prefer`/`require_functions` lists (the SAME
    mechanism `_system_prompt`'s "Prefer where suitable" line already
    instructs the model with) -> the user's own `preferredIngredients`
    free-text field. An ingredient matching NONE of these real signals is
    honestly `AI_FORMULATION_INFERENCE` — the model's own choice, never
    mislabeled as anything else."""
    key = normalize_ingredient_key(ingredient_name)
    origins: List[str] = []

    if any(l.get("ingredient_key") == key for l in version_links):
        origins.append(IngredientOrigin.SCIENTIFIC_EVIDENCE)

    # `preferredIngredients` checked FIRST and excluded from the deterministic-
    # rule check below: `rules.py::derive_constraints` folds the user's own
    # preferred-ingredients text directly into `constraints["prefer"]"
    # alongside its own auto-derived groups (e.g. MILD_SURFACTANTS for a
    # sensitive request) — without this exclusion, a user-typed preference
    # would be double- and misleadingly labeled DETERMINISTIC_RULE too, as
    # if an independent scientific rule (not just an echo of the user's own
    # request) had separately selected it.
    user_preferred = {normalize_ingredient_key(t) for t in _split_terms(str(brief.get("preferredIngredients", "")))}
    is_user_preferred = key in user_preferred or any(t and (t in key or key in t) for t in user_preferred)
    if is_user_preferred:
        origins.append(IngredientOrigin.USER_REQUIRED)

    prefer_keys = {normalize_ingredient_key(p) for p in (constraints.get("prefer") or [])}
    if key in prefer_keys and not is_user_preferred:
        origins.append(IngredientOrigin.DETERMINISTIC_RULE)

    if not origins:
        origins.append(IngredientOrigin.AI_FORMULATION_INFERENCE)
    return origins


# --------------------------------------------------------------- mass balance

@dataclass(frozen=True)
class MassBalance:
    """Deterministic, never LLM arithmetic — computed once, in Python, from
    the model's own reported `weight_pct` strings, and used as the single
    source of truth (Rust/frontend must read this, not recompute their own
    total from formula text — the exact "129.5%" bug this session's own
    brief names came from a second, buggy recomputation on the frontend
    treating "q.s. 100" as a literal 100% contribution on top of everything
    else)."""

    explicit_subtotal: float
    qs_ingredient_keys: List[str]
    qs_amount: Optional[float]
    final_total: Optional[float]
    status: str
    """`"complete"` (closes to ~100% or a single q.s. correctly closes it),
    `"incomplete"` (no q.s., total under 100%), `"invalid_over_100"` (no
    q.s., explicit total already exceeds 100%), `"ambiguous_multiple_qs"`
    (more than one q.s.-to-100 ingredient — cannot be resolved
    automatically), `"invalid_negative_qs"` (explicit ingredients alone
    already exceed 100% even before the q.s. ingredient), `"malformed"`
    (a weight_pct string that is neither a parseable number nor q.s.)."""
    issues: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


_QS_PATTERN = re.compile(r"\bq\.?\s*s\.?\b", re.I)
_PCT_PATTERN = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*%?\s*$")


def compute_mass_balance(ingredients: List[Dict[str, Any]]) -> MassBalance:
    explicit_total = 0.0
    qs_keys: List[str] = []
    malformed: List[str] = []

    for ing in ingredients:
        raw = str(ing.get("weight_pct", "")).strip()
        name = ing.get("inci", "") or raw
        if _QS_PATTERN.search(raw):
            qs_keys.append(name)
            continue
        m = _PCT_PATTERN.match(raw)
        if not m:
            malformed.append(name)
            continue
        explicit_total += float(m.group(1))

    explicit_total = round(explicit_total, 4)

    if malformed:
        return MassBalance(
            explicit_subtotal=explicit_total, qs_ingredient_keys=qs_keys, qs_amount=None, final_total=None,
            status="malformed",
            issues=[f"could not parse a weight percentage for: {', '.join(malformed)}"],
        )

    if len(qs_keys) > 1:
        return MassBalance(
            explicit_subtotal=explicit_total, qs_ingredient_keys=qs_keys, qs_amount=None, final_total=None,
            status="ambiguous_multiple_qs",
            issues=[f"more than one q.s.-to-100 ingredient ({', '.join(qs_keys)}) — cannot be resolved automatically"],
        )

    if len(qs_keys) == 1:
        qs_amount = round(100.0 - explicit_total, 4)
        if qs_amount < 0:
            return MassBalance(
                explicit_subtotal=explicit_total, qs_ingredient_keys=qs_keys, qs_amount=qs_amount, final_total=None,
                status="invalid_negative_qs",
                issues=[f"explicitly-quantified ingredients already total {explicit_total}%, "
                        f"before the q.s. ingredient — a formula cannot exceed 100%"],
            )
        return MassBalance(
            explicit_subtotal=explicit_total, qs_ingredient_keys=qs_keys, qs_amount=qs_amount, final_total=100.0,
            status="complete", issues=[],
        )

    # No q.s. ingredient at all — the explicit total IS the final total.
    if explicit_total > 100.5:
        return MassBalance(
            explicit_subtotal=explicit_total, qs_ingredient_keys=[], qs_amount=None, final_total=explicit_total,
            status="invalid_over_100",
            issues=[f"explicitly-quantified ingredients total {explicit_total}%, over 100%, with no q.s. ingredient to absorb it"],
        )
    if explicit_total < 99.5:
        return MassBalance(
            explicit_subtotal=explicit_total, qs_ingredient_keys=[], qs_amount=None, final_total=explicit_total,
            status="incomplete",
            issues=[f"ingredients total {explicit_total}%, short of 100%, with no q.s. ingredient to close the formula"],
        )
    return MassBalance(
        explicit_subtotal=explicit_total, qs_ingredient_keys=[], qs_amount=None, final_total=explicit_total,
        status="complete", issues=[],
    )


# ------------------------------------------------------------ quality gate --

@dataclass(frozen=True)
class QualityGateFinding:
    factor: str
    severity: str
    """`"warning"` or `"info"` — never a hard rejection; a formula is not
    automatically discarded merely because every ingredient lacks a journal
    paper (this session's own explicit instruction)."""
    message: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# Every factor this gate can raise, named and documented up front — no
# hidden/undocumented threshold anywhere in `assess_quality` below.
QUALITY_GATE_FACTORS: Dict[str, str] = {
    "critical_active_no_evidence": "An ingredient whose function names it an active has no linked scientific evidence at all.",
    "unusual_concentration_no_evidence": "A non-trivial ingredient concentration (>= 1% w/w) has no evidence support — FormuLab inference only.",
    "mass_balance_invalid": "The formula's deterministic mass balance did not close to 100% (see `mass_balance.status`).",
    "hard_constraint_violation": "The formula contains a deterministically excluded ingredient (`rules.py::validate`).",
    "insufficient_research_corpus": "Fewer than the target 15 unique relevant research documents were genuinely available for this request.",
    "low_evidence_coverage": "Fewer than half of this formula's ingredients have any linked evidence, of any class.",
}


def assess_quality(
    formula: Dict[str, Any],
    violations: List[str],
    version_links: List[Dict[str, Any]],
    mass_balance: MassBalance,
    corpus_qualifying_count: Optional[int] = None,
    corpus_target_count: int = 15,
) -> List[QualityGateFinding]:
    findings: List[QualityGateFinding] = []
    ingredients = formula.get("ingredients") or []
    linked_keys = {l.get("ingredient_key") for l in version_links}

    if mass_balance.status != "complete":
        findings.append(QualityGateFinding("mass_balance_invalid", "warning", QUALITY_GATE_FACTORS["mass_balance_invalid"]))

    if violations:
        findings.append(QualityGateFinding("hard_constraint_violation", "warning", QUALITY_GATE_FACTORS["hard_constraint_violation"]))

    if corpus_qualifying_count is not None and corpus_qualifying_count < corpus_target_count:
        findings.append(QualityGateFinding(
            "insufficient_research_corpus", "info",
            f"{corpus_qualifying_count} of {corpus_target_count} target unique research documents were found.",
        ))

    for ing in ingredients:
        key = normalize_ingredient_key(ing.get("inci", ""))
        function = str(ing.get("function", "")).lower()
        if "active" in function and key not in linked_keys:
            findings.append(QualityGateFinding(
                "critical_active_no_evidence", "warning",
                f"{ing.get('inci', 'This ingredient')} is labeled as an active with no linked scientific evidence.",
            ))
        raw = str(ing.get("weight_pct", ""))
        m = _PCT_PATTERN.match(raw.strip())
        if m and float(m.group(1)) >= 1.0 and key not in linked_keys:
            findings.append(QualityGateFinding(
                "unusual_concentration_no_evidence", "info",
                f"{ing.get('inci', 'This ingredient')} at {raw} has no evidence support for that concentration.",
            ))

    if ingredients:
        coverage = sum(1 for i in ingredients if normalize_ingredient_key(i.get("inci", "")) in linked_keys) / len(ingredients)
        if coverage < 0.5:
            findings.append(QualityGateFinding(
                "low_evidence_coverage", "info",
                f"Only {coverage:.0%} of this formula's ingredients have linked evidence.",
            ))

    return findings


# -------------------------------------------------------- corpus summary ---

@dataclass(frozen=True)
class ResearchCorpusSummary:
    """Phase 14 Session 4 §5's own explicit requirement: the research
    corpus (unique relevant documents) and structured evidence (extracted
    findings) are NOT interchangeable numbers — this dataclass keeps every
    count named and separate rather than collapsing them into one
    "sources" figure."""

    raw_candidate_count: int
    qualifying_count: int
    target_count: int
    full_text_count: int
    abstract_only_count: int
    metadata_only_count: int
    evidence_record_count: int
    unique_evidence_study_count: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def summarize_research_corpus(
    papers: List[Dict[str, Any]],
    evidence_records: List[Any],
    target_count: int = 15,
    raw_candidate_count: Optional[int] = None,
) -> ResearchCorpusSummary:
    full_text = sum(1 for p in papers if p.get("pdf_file"))
    abstract_only = sum(1 for p in papers if not p.get("pdf_file") and p.get("abstract"))
    metadata_only = len(papers) - full_text - abstract_only
    from evidence import study_count  # local import: keeps evidence.py free of a reverse dependency on this module
    return ResearchCorpusSummary(
        raw_candidate_count=raw_candidate_count if raw_candidate_count is not None else len(papers),
        qualifying_count=len(papers),
        target_count=target_count,
        full_text_count=full_text,
        abstract_only_count=abstract_only,
        metadata_only_count=metadata_only,
        evidence_record_count=len(evidence_records),
        unique_evidence_study_count=study_count(evidence_records),
    )
