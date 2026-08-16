"""Phase 14 Session 3 — evidence-grounded multi-alternative formulation
synthesis: request-aware strategy derivation, per-version evidence linking,
cross-version diversity validation, and an explainable, decomposable
version score.

**Architecture decision: one model call, strategy-explicit prompt — not one
call per version.** Section 8's brief offers both options and asks for a
documented choice. Chosen: keep `pipeline.py::run()`'s existing single-
request/response call (this pipeline's own stated design principle: "No
sidecar, no SSE, no tool loop: a single request/response"), but make the
prompt dramatically more structured — each of the `n` requested formulas is
now bound, BY INDEX, to one of `derive_strategies()`'s own pre-derived,
request-aware strategies, with that strategy's own priorities/tradeoffs
spelled out inline (see `pipeline.py::_system_prompt`'s strategy section).
Reasons this beats `n` separate calls: (1) preserves the existing
single-call cost/latency profile — `n` isolated calls would multiply LLM
cost/latency by `n` for a benefit the diversity validator below already
delivers a cheaper way; (2) preserves backward compatibility with the
existing `llm_call` single-call contract and every test built on it,
matching "do not break backward compatibility unnecessarily"; (3) a
post-generation `diversity_report()` is REQUIRED either way — even isolated
calls can converge on similar chemistry when the underlying evidence only
supports one defensible chemistry family — so the real safety net is the
same regardless of call architecture, making the extra cost of `n` calls
not worth it. Strategy metadata attached to each card comes from Python's
own `derive_strategies()` output, matched by index — NEVER trusted from the
model's own response — so `card["strategy"]` is always a real, deterministic
object, not something the model could fabricate or omit.

**No repair/retry architecture exists in this pipeline today** (checked
directly: `pipeline.py` has never had one). Not built this session — a
missing or malformed formula slot is marked `status: "generation_failed"`
with a real reason, never silently retried or replaced with a fabricated
success (§10/§16's own requirement).
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

from evidence import EvidenceClass, EvidenceRecord, normalize_ingredient_key
from rules import CHELATORS, FRAGRANCE, HARSH_PRESERVATIVES, MILD_SURFACTANTS, SULFATES

SCHEMA_VERSION = 1


# ------------------------------------------------------------ strategies ---

@dataclass(frozen=True)
class VersionStrategy:
    """One version's explicit, request-derived synthesis brief. Never
    invented by the model — always built by `derive_strategies()` in Python
    and matched to a generated formula by index, so `formulaVersionId +
    strategy` is always a real, traceable pairing."""

    formula_version_id: str
    """e.g. "v1" — matches the card's own `version` field exactly."""
    label: str
    """e.g. "V1" — the short display label."""
    strategy_type: str
    """A stable key, e.g. "balanced", "cost_optimized", "sensitive_skin" —
    never a free-text label a UI would need to parse."""
    title: str
    """Short display title, e.g. "Cost Optimized"."""
    rationale: str
    """Why THIS strategy applies to THIS request — references the actual
    brief/constraint signal that selected it, never a generic template."""
    primary_priorities: List[str]
    secondary_priorities: List[str]
    tradeoffs_accepted: List[str]
    """What this strategy is willing to sacrifice."""
    tradeoffs_forbidden: List[str]
    """What this strategy must NOT sacrifice — always includes every hard
    constraint (excluded ingredients, required functions) regardless of
    strategy, since no strategy may override a deterministic rule (§19)."""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class _StrategyDef:
    strategy_type: str
    title: str
    primary_priorities: List[str]
    secondary_priorities: List[str]
    tradeoffs_accepted: List[str]
    tradeoffs_forbidden: List[str]
    applies: Any  # Callable[[brief, constraints], Optional[str]] -> rationale or None


def _applies_balanced(brief: Dict[str, Any], constraints: Dict[str, Any]) -> Optional[str]:
    return "Always offered as the baseline strategy — the best overall balance across every requested constraint, with no single dimension sacrificed."


def _applies_cost_optimized(brief: Dict[str, Any], constraints: Dict[str, Any]) -> Optional[str]:
    cost = str(brief.get("targetCostLevel", "")).lower()
    if cost == "premium":
        return None  # a premium request is not asking to minimize cost
    if cost == "economy":
        return "The request explicitly targets an economy cost level."
    return "No premium cost level was requested, so a cost-optimized alternative is a genuinely useful comparison."


def _applies_premium_sensory(brief: Dict[str, Any], constraints: Dict[str, Any]) -> Optional[str]:
    cost = str(brief.get("targetCostLevel", "")).lower()
    claims = str(brief.get("claims", "")).lower()
    if cost == "premium" or "premium" in claims or "luxury" in claims:
        return "The request targets a premium cost level or an explicit premium/luxury claim."
    return None


def _applies_sensitive_skin(brief: Dict[str, Any], constraints: Dict[str, Any]) -> Optional[str]:
    if constraints.get("sensitive"):
        return "The request's own deterministic constraints already flag this as sensitive/mildness-driven (rules.py::derive_constraints)."
    return None


def _applies_natural_origin(brief: Dict[str, Any], constraints: Dict[str, Any]) -> Optional[str]:
    text = f"{brief.get('claims','')} {brief.get('preferredIngredients','')} {brief.get('target','')}".lower()
    if any(k in text for k in ("natural", "organic", "plant-based", "botanical", "vegan")):
        return "The request's claims or preferred ingredients explicitly mention a natural/organic/plant-based direction."
    return None


def _applies_regulatory_conservative(brief: Dict[str, Any], constraints: Dict[str, Any]) -> Optional[str]:
    market = str(brief.get("market", "")).strip()
    performance = str(brief.get("performance", "")).lower()
    claims = str(brief.get("claims", "")).lower()
    if market and (any(k in claims for k in ("antibacterial", "antifungal", "medicated", "therapeutic"))
                   or any(k in performance for k in ("antibacterial", "antifungal", "medicated"))):
        return f"A named target market ({market}) combined with an antimicrobial/therapeutic-adjacent claim benefits from a conservative, easier-to-clear regulatory alternative."
    return None


def _applies_simplified_manufacturing(brief: Dict[str, Any], constraints: Dict[str, Any]) -> Optional[str]:
    equip = str(brief.get("availableEquipment", "")).strip().lower()
    batch = str(brief.get("estimatedBatchSize", "")).strip().lower()
    if equip and not any(k in equip for k in ("homogenizer", "high shear", "high-shear", "rotor-stator", "vacuum")):
        return f"The user's own stated available equipment ({brief.get('availableEquipment')}) does not include high-shear/vacuum processing, so a lower-process-complexity alternative is genuinely relevant."
    if batch and any(k in batch for k in ("small", "pilot", "trial", "sample")):
        return f"A small/pilot batch size ({brief.get('estimatedBatchSize')}) favors a simpler, lower-setup-cost process."
    return None


def _applies_low_raw_material_count(brief: Dict[str, Any], constraints: Dict[str, Any]) -> Optional[str]:
    materials = str(brief.get("availableRawMaterials", "")).strip()
    if materials and len(re.split(r"[,;]", materials)) <= 8:
        return f"The user's own stated available raw materials list is short ({brief.get('availableRawMaterials')}), so a low-raw-material-count alternative is genuinely constrained-relevant, not arbitrary."
    return None


def _applies_max_performance(brief: Dict[str, Any], constraints: Dict[str, Any]) -> Optional[str]:
    # A near-universal fallback (like Balanced), deliberately placed LAST in
    # the library so it only fills a remaining slot after every more
    # specific, request-signal-driven strategy above has had first claim —
    # this is what keeps most requests at a real 3-strategy set without
    # inventing a strategy that ISN'T legitimately applicable: prioritizing
    # the request's own stated performance goal, accepting extra cost/
    # complexity, is always a real, defensible alternative to offer.
    return "Prioritizes the request's own primary performance goal above cost/simplicity, within every hard constraint — always a legitimate alternative to offer."


# Priority order when more than one non-balanced strategy applies —
# deterministic, so the same brief always yields the same strategy set.
_LIBRARY: List[_StrategyDef] = [
    _StrategyDef("balanced", "Balanced / Recommended",
                 ["Overall balance of performance, mildness, cost, and evidence coverage"],
                 [], [], [], _applies_balanced),
    _StrategyDef("sensitive_skin", "Sensitive Skin / Mildness Focused",
                 ["Minimize irritation potential", "Mild surfactant/preservative systems"],
                 ["Maintain acceptable cleansing/performance"],
                 ["May cost more per unit of active", "May use a milder, less aggressive cleansing system"],
                 [], _applies_sensitive_skin),
    _StrategyDef("cost_optimized", "Cost Optimized",
                 ["Minimize raw-material cost"], ["Preserve every hard constraint and required function"],
                 ["May use a lower-cost surfactant/active system where evidence still supports it"],
                 [], _applies_cost_optimized),
    _StrategyDef("premium_sensory", "Premium Sensory",
                 ["Sensory quality (feel, foam, fragrance-compatible base)", "Perceived premium positioning"],
                 ["Formulation robustness"],
                 ["Higher raw-material cost is acceptable"],
                 [], _applies_premium_sensory),
    _StrategyDef("natural_origin", "Natural-Origin Focused",
                 ["Maximize naturally-derived/plant-based ingredient share"],
                 ["Preserve required performance/preservation functions"],
                 ["May accept a less conventional preservative/surfactant system where evidence supports a natural alternative"],
                 [], _applies_natural_origin),
    _StrategyDef("regulatory_conservative", "Regulatory Conservative",
                 ["Minimize regulatory/claim-substantiation risk for the named market"],
                 ["Use only well-established, widely-cleared ingredient/claim combinations"],
                 ["May understate an aggressive performance claim to stay conservative"],
                 [], _applies_regulatory_conservative),
    _StrategyDef("simplified_manufacturing", "Simplified Manufacturing",
                 ["Minimize process complexity given the user's own stated equipment"],
                 ["Fewer processing stages/temperature-sensitive steps"],
                 ["May accept a simpler, less elegant rheology/emulsification system"],
                 [], _applies_simplified_manufacturing),
    _StrategyDef("low_raw_material_count", "Low Raw-Material Count",
                 ["Minimize the number of distinct raw materials used"],
                 ["Prefer multi-functional ingredients"],
                 ["May accept a less finely-tuned sensory/performance profile"],
                 [], _applies_low_raw_material_count),
    _StrategyDef("max_performance", "Maximum Performance",
                 ["Maximize the request's own primary performance goal"],
                 ["Accept higher active-ingredient concentration where evidence supports it"],
                 ["Higher cost and/or process complexity is acceptable"],
                 [], _applies_max_performance),
]

# Every strategy inherits the same non-negotiable floor regardless of type —
# no strategy may ever be asked to trade away a hard constraint (§19).
_UNIVERSAL_FORBIDDEN = [
    "Any excluded/hard-avoid ingredient",
    "Any deterministic safety or regulatory hard rule",
    "Any required function the brief's constraints mandate",
]


def derive_strategies(brief: Dict[str, Any], constraints: Dict[str, Any], n: int = 3) -> List[VersionStrategy]:
    """Request-aware, deterministic — the same brief always yields the same
    strategy set, and a DIFFERENT brief genuinely yields a different one
    (never a hardcoded fixed three). "Balanced" is always included first
    when `n >= 1`; the remaining `n - 1` slots go to whichever OTHER
    strategies' `applies()` check actually fires for this specific brief,
    in the library's fixed priority order — so a request with no sensitive/
    natural/regulatory/equipment signal at all still gets `n` DISTINCT,
    genuinely-applicable strategies, falling back through Cost Optimized and
    finally Maximum Performance (both near-universal, legitimate
    alternatives, deliberately placed last so a real request-specific signal
    always wins the slot first when one exists). Never a strategy invented
    without a real triggering signal — if fewer than `n` strategies
    genuinely apply, fewer are returned (§4's own explicit instruction:
    say so rather than invent one).
    """
    chosen: List[VersionStrategy] = []
    used_types: set = set()

    def add(defn: _StrategyDef, rationale: str) -> None:
        idx = len(chosen) + 1
        chosen.append(VersionStrategy(
            formula_version_id=f"v{idx}", label=f"V{idx}", strategy_type=defn.strategy_type,
            title=defn.title, rationale=rationale,
            primary_priorities=list(defn.primary_priorities),
            secondary_priorities=list(defn.secondary_priorities),
            tradeoffs_accepted=list(defn.tradeoffs_accepted),
            tradeoffs_forbidden=list(defn.tradeoffs_forbidden) + _UNIVERSAL_FORBIDDEN,
        ))
        used_types.add(defn.strategy_type)

    balanced = _LIBRARY[0]
    add(balanced, _applies_balanced(brief, constraints))

    for defn in _LIBRARY[1:]:
        if len(chosen) >= n:
            break
        if defn.strategy_type in used_types:
            continue
        rationale = defn.applies(brief, constraints)
        if rationale:
            add(defn, rationale)

    return chosen[:n]


# ------------------------------------------------------- diversity check ---

@dataclass(frozen=True)
class DiversityReport:
    """Every factor named — never an opaque single similarity number.
    `pairs` holds one entry per compared version pair, each itself
    decomposed (`ingredient_overlap`, `concentration_similarity`,
    `primary_surfactant_match`)."""

    pairs: List[Dict[str, Any]]
    sufficiently_diverse: bool
    explanation: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


_SURFACTANT_KEYS = {normalize_ingredient_key(n) for group in (SULFATES, MILD_SURFACTANTS) for n in group}


def _ingredient_set(formula: Dict[str, Any]) -> set:
    return {normalize_ingredient_key(i.get("inci", "")) for i in (formula.get("ingredients") or []) if i.get("inci")}


def _concentration_map(formula: Dict[str, Any]) -> Dict[str, float]:
    """Only ingredients with a genuinely parseable single numeric %
    (skips "q.s. 100" and ranges) — never a fabricated value for the rest."""
    out: Dict[str, float] = {}
    for i in formula.get("ingredients") or []:
        key = normalize_ingredient_key(i.get("inci", ""))
        raw = str(i.get("weight_pct", ""))
        m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*%?\s*", raw)
        if key and m:
            out[key] = float(m.group(1))
    return out


def _primary_surfactant(formula: Dict[str, Any]) -> str:
    for i in formula.get("ingredients") or []:
        key = normalize_ingredient_key(i.get("inci", ""))
        if key in _SURFACTANT_KEYS:
            return key
    return ""


def _pair_diversity(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    set_a, set_b = _ingredient_set(a["formula"]), _ingredient_set(b["formula"])
    union = set_a | set_b
    overlap = len(set_a & set_b) / len(union) if union else 1.0

    conc_a, conc_b = _concentration_map(a["formula"]), _concentration_map(b["formula"])
    shared = set(conc_a) & set(conc_b)
    if shared:
        deltas = [abs(conc_a[k] - conc_b[k]) / max(conc_a[k], conc_b[k], 1e-6) for k in shared]
        conc_similarity = 1.0 - min(1.0, sum(deltas) / len(deltas))
    else:
        conc_similarity = 0.0  # nothing shared to compare -> treat as not similar

    surf_a, surf_b = _primary_surfactant(a["formula"]), _primary_surfactant(b["formula"])
    surfactant_match = bool(surf_a and surf_a == surf_b)

    return {
        "a": a["version"], "b": b["version"],
        "ingredient_overlap": round(overlap, 3),
        "concentration_similarity": round(conc_similarity, 3),
        "primary_surfactant_match": surfactant_match,
    }


# A pair counts as "insufficiently diverse" only when BOTH the ingredient
# set AND the concentration profile are near-identical — matching §4's own
# explicit exception: identical chemistry with LEGITIMATE strategy
# differences elsewhere (cost framing, process, sensory) must not be
# flagged just for sharing a surfactant system evidence constrains them to.
_OVERLAP_THRESHOLD = 0.85
_CONC_SIMILARITY_THRESHOLD = 0.9


def diversity_report(cards: List[Dict[str, Any]]) -> DiversityReport:
    """Compares only cards with real formulas (`status == "ok"`) — a
    failed/missing version contributes nothing to compare."""
    ok_cards = [c for c in cards if c.get("status") == "ok" and c.get("formula")]
    pairs = []
    flags = []
    for i in range(len(ok_cards)):
        for j in range(i + 1, len(ok_cards)):
            pair = _pair_diversity(ok_cards[i], ok_cards[j])
            pairs.append(pair)
            if pair["ingredient_overlap"] >= _OVERLAP_THRESHOLD and pair["concentration_similarity"] >= _CONC_SIMILARITY_THRESHOLD:
                flags.append(f"{pair['a']} and {pair['b']} are nearly identical "
                             f"(ingredient overlap {pair['ingredient_overlap']:.0%}, "
                             f"concentration similarity {pair['concentration_similarity']:.0%})")
    if len(ok_cards) < 2:
        return DiversityReport(pairs=pairs, sufficiently_diverse=True,
                                explanation="Fewer than two successful versions — nothing to compare.")
    if flags:
        return DiversityReport(pairs=pairs, sufficiently_diverse=False,
                                explanation="; ".join(flags))
    return DiversityReport(pairs=pairs, sufficiently_diverse=True,
                            explanation="Every version pair differs meaningfully in ingredient set and/or concentration profile.")


# ---------------------------------------------------- version evidence ----

def link_evidence_to_version(
    version_id: str, formula: Dict[str, Any], ranked_evidence: List[EvidenceRecord],
) -> List[Dict[str, Any]]:
    """Which of the already-ranked evidence records are actually about an
    ingredient THIS version's own formula uses — the real, per-version
    association §7 requires (`formulaVersionId + ingredient + concentration`).
    Returns plain dicts (a copy of each matching record with
    `formula_version_id` set to this version) — the SAME record can be
    linked to more than one version if more than one version happens to use
    that ingredient (real and expected, not a bug: a shared ingredient
    genuinely has the same supporting literature in both places)."""
    formula_keys = {normalize_ingredient_key(i.get("inci", "")) for i in (formula.get("ingredients") or [])}
    links = []
    for r in ranked_evidence:
        if r.ingredient_key in formula_keys:
            d = r.to_dict()
            d["formula_version_id"] = version_id
            links.append(d)
    return links


def concentration_alignment(formula: Dict[str, Any], version_links: List[Dict[str, Any]]) -> Dict[str, str]:
    """Per-ingredient: `"evidence_supported"` (a linked record reports a
    concentration within 30% relative of the model's chosen value — a
    deliberately loose tolerance, since this is alignment-checking, not
    exact-match verification), `"evidence_context_only"` (evidence exists
    for the ingredient but not for a comparable concentration),
    `"formulab_inference"` (no linked evidence at all for this ingredient —
    the model's own choice, never mislabeled as literature-backed)."""
    by_ingredient: Dict[str, List[Dict[str, Any]]] = {}
    for link in version_links:
        by_ingredient.setdefault(link["ingredient_key"], []).append(link)

    out: Dict[str, str] = {}
    for ing in formula.get("ingredients") or []:
        key = normalize_ingredient_key(ing.get("inci", ""))
        raw = str(ing.get("weight_pct", ""))
        m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*%?\s*", raw)
        chosen = float(m.group(1)) if m else None
        records = by_ingredient.get(key, [])
        if not records:
            out[key] = "formulab_inference"
            continue
        if chosen is None:
            out[key] = "evidence_context_only"
            continue
        aligned = False
        for r in records:
            conc = r.get("concentration")
            if not conc:
                continue
            reported = conc.get("value")
            if reported is None:
                continue
            if abs(chosen - reported) <= max(reported, chosen, 1e-6) * 0.3:
                aligned = True
                break
        out[key] = "evidence_supported" if aligned else "evidence_context_only"
    return out


# --------------------------------------------------------------- scoring ---

_EVIDENCE_CLASS_WEIGHT = {EvidenceClass.A: 1.0, EvidenceClass.B: 0.7, EvidenceClass.C: 0.4,
                          EvidenceClass.D: 0.25, EvidenceClass.E: 0.1}


@dataclass(frozen=True)
class VersionScore:
    """Every factor named; `total` is always exactly their weighted sum
    (asserted by a direct test) — never an opaque number, and never
    conflated with deterministic safety/regulatory PASS/FAIL (§19), which
    stays entirely separate (`violations` on the card itself)."""

    hard_constraint_compliance: float
    evidence_strength: float
    formulation_completeness: float
    evidence_gap_penalty: float
    total: float

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def compute_version_score(
    formula: Dict[str, Any], violations: List[str], version_links: List[Dict[str, Any]],
) -> Optional[VersionScore]:
    """`None` ("not yet available") when there isn't enough real data to
    score credibly — never a forced number merely because the UI has a
    slot for one (§12's own explicit instruction)."""
    ingredients = formula.get("ingredients") or []
    if not ingredients:
        return None

    hard_constraint_compliance = 0.0 if violations else 1.0

    class_by_key: Dict[str, EvidenceClass] = {}
    for link in version_links:
        cls = EvidenceClass(link["evidence_class"])
        key = link["ingredient_key"]
        if key not in class_by_key or _EVIDENCE_CLASS_WEIGHT[cls] > _EVIDENCE_CLASS_WEIGHT[class_by_key[key]]:
            class_by_key[key] = cls
    covered = sum(1 for i in ingredients if normalize_ingredient_key(i.get("inci", "")) in class_by_key)
    evidence_strength = (
        sum(_EVIDENCE_CLASS_WEIGHT[class_by_key[normalize_ingredient_key(i.get("inci", ""))]]
            for i in ingredients if normalize_ingredient_key(i.get("inci", "")) in class_by_key)
        / len(ingredients)
    )
    evidence_gap_penalty = 1.0 - (covered / len(ingredients))

    total_pct = 0.0
    for i in ingredients:
        raw = str(i.get("weight_pct", ""))
        m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*%?\s*", raw)
        if m:
            total_pct += float(m.group(1))
    has_qs = any("q.s" in str(i.get("weight_pct", "")).lower() for i in ingredients)
    formulation_completeness = 1.0 if (has_qs or 95.0 <= total_pct <= 105.0) else 0.5

    total = round(
        0.4 * hard_constraint_compliance + 0.3 * evidence_strength
        + 0.2 * formulation_completeness - 0.1 * evidence_gap_penalty,
        4,
    )
    total = max(0.0, min(1.0, total))
    return VersionScore(
        hard_constraint_compliance=round(hard_constraint_compliance, 4),
        evidence_strength=round(evidence_strength, 4),
        formulation_completeness=round(formulation_completeness, 4),
        evidence_gap_penalty=round(evidence_gap_penalty, 4),
        total=total,
    )


# ------------------------------------------------------------ prompt text --

def build_strategy_prompt_section(strategies: List[VersionStrategy]) -> str:
    """The VERSION STRATEGY block (§8) — one numbered brief per requested
    formula, index-matched so `formulas[i]` in the model's JSON response
    corresponds to `strategies[i]`. Attached ADDITIONALLY to the existing
    system prompt (`pipeline.py::_system_prompt`), never replacing the
    existing hard-rules/evidence framing."""
    lines = ["VERSION STRATEGIES — produce formulas[0..N-1] in this EXACT order, "
             "one per strategy below (formulas[0] implements strategy 1, etc.):"]
    for i, s in enumerate(strategies, 1):
        lines.append(
            f"\n{i}. {s.title} ({s.strategy_type})\n"
            f"   Rationale: {s.rationale}\n"
            f"   Primary priorities: {', '.join(s.primary_priorities) or 'none'}\n"
            f"   Secondary priorities: {', '.join(s.secondary_priorities) or 'none'}\n"
            f"   Acceptable tradeoffs: {', '.join(s.tradeoffs_accepted) or 'none'}\n"
            f"   MUST NOT sacrifice: {', '.join(s.tradeoffs_forbidden)}"
        )
    lines.append(
        "\nEach strategy must be a GENUINELY different decision, not the same formula with "
        "renamed labels or trivial % tweaks — differ in at least one of: primary surfactant "
        "system, active-ingredient strategy, preservative system, emollient/humectant system, "
        "or concentration allocation, wherever the evidence and hard rules genuinely allow it. "
        "If the evidence only supports one defensible chemistry family for a given system, keep "
        "that chemistry and create the strategy's real difference elsewhere (e.g. concentration, "
        "supporting actives, process) rather than inventing an inferior alternative."
    )
    return "\n".join(lines)
