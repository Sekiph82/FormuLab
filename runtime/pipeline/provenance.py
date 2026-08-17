"""Phase 14 Session 4 (generation provenance, ingredient-origin
classification, deterministic mass-balance validation, a transparent
formulation quality gate) + Phase 15 zero-LLM round (generation-provenance
model extended for a deterministic engine).

**Real formula-generation path, re-audited for the Phase 15 zero-LLM
round.** As of that round: `NewFormulationRequestPage.tsx`/
`FormulationWorkspaceV2.tsx` -> `formulationV2.ts::generateFormulation()`
-> Tauri `generate_formulation` (`formulation_v2.rs`) -> `run_cli.py`
(stdin/stdout bridge) -> `pipeline.py::run()` -> `engine.py`'s deterministic
candidate-pool/role/concentration/solver pipeline — ONE real code path,
and it contains no model call anywhere in it (audited directly: `engine.py`
imports nothing from `llm.py`, and `pipeline.py` no longer imports `llm`
at all — see the mandatory `test_pipeline.py::
test_llm_call_is_never_reached_by_the_deterministic_path` regression
guard, which patches `llm.call` to raise and asserts the full pipeline
still runs to completion). `llm.py::call()` remains in the repository —
`Session 3/4`'s own historical sessions were genuinely produced by it, and
this codebase never rewrites history — but it is legacy/unrelated
compatibility code as of this round, reachable from nothing the normal
formulation-generation path executes. No provider/model credential, API
key, or internet model endpoint is required, checked, or read anywhere in
`engine.py`'s own path; a machine with none of those configured runs
formulation generation identically to one that has them (see
`build_deterministic_provenance` below).

**API keys are never logged**, unchanged from Session 4's own audit
(reproduced here since `llm.py`/its API-key handling still exist in the
repository as legacy code, even though the normal path no longer reaches
them): `formulation_v2.rs` piped the request over stdin only, never through
a logging macro; `llm.py::call()` used the key only in the outbound HTTP
`Authorization` header; `diagnostics.rs::redact_text()` independently masks
any long token-like string as a second layer.
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
    """Persisted once per session — never ambiguous about who/what produced
    a formula.

    `engine_type`: `"llm"` (historical only — every session generated
    before the Phase 15 zero-LLM round; this codebase never rewrites that
    history) or `"deterministic"` (every session generated from this round
    onward, by `engine.py`, with no model call anywhere in the path).
    `"imported_formula"` remains reserved for a future import flow that
    does not exist yet.

    `source`: `"real_model_call"` (historical `"llm"` sessions only) or
    `"formulab_deterministic_engine"` (every `"deterministic"` session).

    `provider`/`model` are REQUIRED for an `"llm"`-engine session and
    intentionally blank (`""`) for a `"deterministic"` one — a deterministic
    session has no provider/model to report, and leaving the fields blank
    rather than omitting them keeps every `GenerationProvenance` on disk the
    same shape regardless of which engine produced it."""

    engine_type: str
    source: str
    provider: str = ""
    model: str = ""
    generated_at: str = ""
    """ISO 8601 UTC timestamp of the successful generation."""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def build_generation_provenance(provider: str, model: str) -> GenerationProvenance:
    """LEGACY — the `"llm"`-engine variant. No longer called anywhere in
    `pipeline.py`'s normal formulation-generation path as of the Phase 15
    zero-LLM round (that path is `build_deterministic_provenance` below);
    kept only because it documents the shape every historical `"llm"`
    session's own `generation_provenance.json` already has on disk, and
    because `llm.py` itself remains in the repository for legacy/unrelated
    compatibility (see that module's own docstring). Contains no secret:
    `provider`/`model` are plain identifiers, never the API key."""
    return GenerationProvenance(
        engine_type="llm", source="real_model_call", provider=provider, model=model,
        generated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


def build_deterministic_provenance() -> GenerationProvenance:
    """The real generation-provenance value for every session produced by
    the Phase 15 zero-LLM deterministic engine (`engine.py`). No
    provider/model credential is required, checked, or reported — a
    deterministic session never contacts any model endpoint, local or
    remote, so there is nothing to name."""
    return GenerationProvenance(
        engine_type="deterministic", source="formulab_deterministic_engine",
        provider="", model="",
        generated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


# ----------------------------------------------------------- ingredient origin

class IngredientOrigin:
    """String constants, not an Enum — a formula ingredient can legitimately
    carry MORE THAN ONE origin at once (e.g. both `DETERMINISTIC_RULE` and
    `SCIENTIFIC_EVIDENCE`), so callers work with a `List[str]`, not a single
    value.

    `SUPPLIER_DATA` is real and live as of the Phase 15 zero-LLM round:
    `pipeline.run()` now accepts a `materials_dir` and, when the user has
    imported a priced raw-material list (`materials.py`), `engine.py`'s own
    candidate-pool builder matches formula ingredients against it directly
    — no LLM guess stands between a real supplier row and this origin.

    `INTERNAL_FORMULAB_DATA` stays reserved, still not emitted: no curated,
    lab-validated internal concentration-history database exists anywhere
    in this codebase. Classifying an ingredient into it without a real data
    source behind it would be exactly the fabrication this whole model
    exists to prevent.

    `AI_FORMULATION_INFERENCE` is HISTORICAL ONLY as of the Phase 15
    zero-LLM round: `classify_ingredient_origin` below (the LLM-era
    classifier) can still emit it when re-describing an old `"llm"`-engine
    session, but the deterministic engine (`engine.py`) never invents an
    ingredient outside its own traceable candidate pool, so it structurally
    cannot produce this origin for a new `"deterministic"`-engine session —
    every ingredient in a new deterministic formula carries at least one of
    `SCIENTIFIC_EVIDENCE`/`SUPPLIER_DATA`/`DETERMINISTIC_RULE`/
    `USER_REQUIRED` instead. Old sessions that already have
    `ai_formulation_inference` on disk are never rewritten."""

    SCIENTIFIC_EVIDENCE = "scientific_evidence"
    SUPPLIER_DATA = "supplier_data"
    INTERNAL_FORMULAB_DATA = "internal_formulab_data"  # reserved — no live source exists
    DETERMINISTIC_RULE = "deterministic_rule"
    USER_REQUIRED = "user_required"
    AI_FORMULATION_INFERENCE = "ai_formulation_inference"  # historical (llm-engine sessions) only


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
    "formulation_incomplete": "The deterministic engine could not resolve every required functional role or concentration for this strategy — see `missing_roles`/`unresolved_requirements` on the card.",
}


def assess_quality(
    formula: Dict[str, Any],
    violations: List[str],
    version_links: List[Dict[str, Any]],
    mass_balance: MassBalance,
    corpus_qualifying_count: Optional[int] = None,
    corpus_target_count: int = 15,
    formula_state: Optional[str] = None,
) -> List[QualityGateFinding]:
    findings: List[QualityGateFinding] = []
    ingredients = formula.get("ingredients") or []
    linked_keys = {l.get("ingredient_key") for l in version_links}

    if formula_state and formula_state not in ("complete", "complete_with_validation_required"):
        findings.append(QualityGateFinding("formulation_incomplete", "warning", QUALITY_GATE_FACTORS["formulation_incomplete"]))

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

# Single authoritative source of truth for the full-text acquisition policy
# (2026-08-17 correction: 15 remains the preferred target, but is no longer
# an absolute prerequisite for generating formulas — see
# `research_corpus_status()` below). Every other module reads these two
# constants rather than repeating the numbers 15/10.
RESEARCH_FULL_TEXT_TARGET = 15
RESEARCH_FULL_TEXT_MINIMUM = 10

CORPUS_FULL = "full"
CORPUS_PARTIAL = "partial"
CORPUS_INSUFFICIENT = "insufficient"


def research_corpus_status(full_text_count: int) -> str:
    """`full` at/above the preferred target, `partial` between the real
    minimum and the target (formulation generation allowed, shortfall
    disclosed), `insufficient` below the real minimum (formulation
    generation blocked). Never a fourth, silently-invented state."""
    if full_text_count >= RESEARCH_FULL_TEXT_TARGET:
        return CORPUS_FULL
    if full_text_count >= RESEARCH_FULL_TEXT_MINIMUM:
        return CORPUS_PARTIAL
    return CORPUS_INSUFFICIENT


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
    full_text_gate_met: bool = False
    """Phase 14 Session 6 correction gate — real, separate from
    `qualifying_count >= target_count`: whether `literature_cache.gather()`
    actually obtained `target_count` genuinely downloaded, legally
    accessible full texts (searching deeper into the candidate pool when
    the first pass came up short — see that function's own comment).
    `False` is an honest, real outcome, not an error; the corpus itself
    still keeps every relevant document, full text or not (Session 4's
    own guarantee, unchanged)."""
    status: str = CORPUS_INSUFFICIENT
    """2026-08-17 correction: `research_corpus_status(full_text_count)` —
    `full`/`partial`/`insufficient`. Only `insufficient` blocks formulation
    synthesis in a real run; `partial` is disclosed but never blocking on
    its own."""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def summarize_research_corpus(
    papers: List[Dict[str, Any]],
    evidence_records: List[Any],
    target_count: int = RESEARCH_FULL_TEXT_TARGET,
    raw_candidate_count: Optional[int] = None,
    full_text_gate_met: Optional[bool] = None,
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
        full_text_gate_met=full_text_gate_met if full_text_gate_met is not None else (full_text >= target_count),
        status=research_corpus_status(full_text),
    )
