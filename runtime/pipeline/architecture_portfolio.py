"""FormuLab v1 (FVL-02) — global scientific-architecture portfolio
selection.

**The bug this closes.** The prior round (FVL-03) seeded EVERY generated
version's own candidate pool from the SAME, full `scientific_formulations`
list, letting whichever formulation's shared support ingredients (glycerin,
EDTA, pH adjuster — present identically across every `F<n>` in a paper)
win the SAME role every time, regardless of which version was being built.
Combined with the real fact — discovered while building this module,
proven against the actual reference PDF — that `F1`/`F2`/`F3`/`F4` in that
paper are CONCENTRATION-ONLY variants of the identical architecture (same
ten ingredients, same roles, only the % differs; only `F5` genuinely
drops the primary-surfactant system), independent per-version selection
had no way to know F1-F4 are the same real architecture and F5 is a
different one — it just kept re-picking whichever formulation ranked
highest by raw ingredient-overlap count, which was always F1 (first in
extraction order, ties broken by encounter order).

**The fix.** Build the WHOLE candidate universe once — one
`ArchitectureCandidate` per real scientific formulation record, plus one
generic "evidence/rule fallback" candidate — score every one on named,
persisted factors (never one opaque number), then run a single
deterministic greedy PORTFOLIO selector across all requested slots at
once, with a real diversity penalty for an architecture FINGERPRINT
(which real ingredient fills which major functional role) already used
by an earlier slot. F1-F4 above collapse to ONE real fingerprint and so
compete as ONE slot's worth of opportunity, honestly — never fabricated
as three "different" alternatives.

Zero LLM. Zero ML. Every ranking factor here is either a structural fact
(role coverage, hard-constraint fit) or DIRECT literal evidence
(`ExperimentalOutcome.value`/`raw_text`) — never an inferred judgement
about which numeric value is "better" for a metric this module does not
have a real domain rule for.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, FrozenSet, List, Optional, Tuple

SCHEMA_VERSION = 1

ORIGIN_SCIENTIFIC = "scientific_formulation"
ORIGIN_FALLBACK = "evidence_rule_fallback"

ELIGIBLE = "eligible"
REJECTED = "rejected"
INSUFFICIENT_INFORMATION = "insufficient_information"

# A candidate whose adjusted score falls below this is never selected even
# to fill a remaining slot — an honest shortfall beats a token candidate.
_MIN_DEFENSIBLE_SCORE = 0.20

# How hard an already-used-source-formulation candidate is penalized for a
# LATER slot, and how hard high fingerprint overlap with ANY already-
# selected candidate is penalized — named, not folded silently into the
# base score, so `select_portfolio`'s own trace stays explainable.
_SAME_SOURCE_PENALTY = 0.55
_FULL_FINGERPRINT_OVERLAP_PENALTY = 0.45

# Deterministic, narrow request-relevance keyword map — a real, disclosed,
# non-exhaustive mapping from request text to the outcome METRIC family it
# makes relevant, never an inferred/guessed relevance.
_REQUEST_RELEVANT_METRIC_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    "antifungal": ("dandruff", "antifungal", "malassezia", "antimicrobial", "anti-dandruff"),
    "foam_volume_ml": ("foam", "high-foam", "foaming", "lather"),
    "viscosity_cp": ("viscosity", "thick", "thickness", "rheology"),
    "cleaning_action_pct": ("clean", "cleaning", "detergency", "grease"),
    "solids_pct": ("solids",),
    "surface_tension_dy_cm": ("surface tension",),
    "ph": ("ph",),
}

_SOURCE_SELECTED_RE = re.compile(
    r"\bF\s*(\d+)\b[^.]{0,80}\b(?:was\s+)?(?:selected|chosen|optimi[sz]ed|best)\b"
    r"|\b(?:selected|chosen|optimal|best)\b[^.]{0,80}\bF\s*(\d+)\b",
    re.I,
)


@dataclass(frozen=True)
class ArchitectureCandidate:
    architecture_candidate_id: str
    architecture_origin: str  # ORIGIN_SCIENTIFIC | ORIGIN_FALLBACK
    canonical_paper_id: str
    doi: str
    source_title: str
    source_formulation_id: str

    # §12 — named, persisted, never collapsed into one unexplained score.
    # `functional_completeness` is the REQUEST-FEASIBLE figure (§2/§3: what
    # this architecture can still cover after removing anything the current
    # request/hard constraints forbid) — this is what `total_score` uses.
    # `functional_completeness_source` is the un-adjusted structural figure
    # (what the scientific paper's own formulation actually covers). They
    # are never the same field: collapsing them is the exact bug this model
    # exists to prevent (a forbidden ingredient must not erase the fact
    # that the SOURCE architecture had a real functional system there).
    product_relevance: float
    functional_completeness: float
    functional_completeness_source: float
    constraint_fit: float
    scientific_directness: float
    evidence_coverage: float
    experimental_support: float
    material_resolvability: float
    adaptation_penalty: float
    uncertainty_penalty: float
    total_score: float

    hard_violation: bool
    adaptation_required: bool
    source_selected: bool
    unresolved_material_count: int
    experimental_factors: Dict[str, float]
    fingerprint: Tuple[str, ...]
    """Sorted `"role:key"` pairs for `eligible_roles_after_constraints` —
    the real, REQUEST-FEASIBLE major-functional-system identity this
    candidate would contribute once forbidden ingredients are removed.
    Two candidates with an IDENTICAL fingerprint are the same real
    architecture regardless of concentration differences (§17/§19)."""
    source_fingerprint: Tuple[str, ...]
    """Sorted `"role:key"` pairs for `structurally_present_roles` — the
    SOURCE paper's own architecture, unaffected by the current request's
    constraints (§6/§7: a forbidden ingredient never vanishes from the
    source's own structural identity, only from what can still be built)."""
    structurally_present_roles: Dict[str, str]
    """`{role: key}` for every major-system role this source formulation
    actually resolves to, INCLUDING roles filled by a forbidden ingredient."""
    eligible_roles_after_constraints: Dict[str, str]
    """`structurally_present_roles` minus any role whose only resolving
    ingredient is on the current request's avoid/hard-restriction set."""
    violating_roles: Tuple[str, ...]
    violating_ingredients: Tuple[Dict[str, str], ...]
    """One `{"role", "key", "reason"}` entry per structurally-present
    ingredient this request forbids — never silently dropped (§2)."""
    eligibility: str  # ELIGIBLE | REJECTED | INSUFFICIENT_INFORMATION
    rejection_reason: str
    record: Optional[Dict[str, Any]] = None
    """The raw `ScientificFormulationRecord.to_dict()` this candidate
    came from — `None` for the fallback candidate."""

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["fingerprint"] = list(self.fingerprint)
        d["source_fingerprint"] = list(self.source_fingerprint)
        d["violating_roles"] = list(self.violating_roles)
        d["violating_ingredients"] = list(self.violating_ingredients)
        return d


@dataclass(frozen=True)
class PortfolioAssignment:
    slot_index: int
    candidate: Optional[ArchitectureCandidate]
    """`None` only for a slot the portfolio genuinely could not fill —
    never happens in practice while the fallback candidate is eligible;
    kept `Optional` so a real, honest shortfall is representable."""
    diversity_penalty_applied: float
    rationale: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "slot_index": self.slot_index,
            "candidate_id": self.candidate.architecture_candidate_id if self.candidate else None,
            "diversity_penalty_applied": self.diversity_penalty_applied,
            "rationale": self.rationale,
        }


# --------------------------------------------------------- fingerprint ---


def _fingerprint(ingredient_role_keys: Dict[str, str]) -> Tuple[str, ...]:
    """`{role: key}` for this candidate's own resolved MAJOR_SYSTEM_ROLES
    ingredients -> a sorted, hashable identity. Concentration never enters
    this — two formulations with the same role->key mapping ARE the same
    real architecture (§17/§19's own explicit instruction)."""
    return tuple(sorted(f"{role}:{key}" for role, key in ingredient_role_keys.items()))


def _fingerprint_overlap(a: Tuple[str, ...], b: Tuple[str, ...]) -> float:
    if not a or not b:
        return 0.0
    sa, sb = set(a), set(b)
    return len(sa & sb) / len(sa | sb)


# ------------------------------------------------------- candidate build ---


def _request_relevant_metrics(brief: Dict[str, Any]) -> List[str]:
    hay = f"{brief.get('target', '')} {brief.get('claims', '')} {brief.get('performance', '')}".lower()
    return [metric for metric, kws in _REQUEST_RELEVANT_METRIC_KEYWORDS.items() if any(k in hay for k in kws)]


def _experimental_support(
    source_formulation_id: str, outcomes: List[Dict[str, Any]], relevant_metrics: List[str],
) -> Tuple[float, Dict[str, float]]:
    """Presence of real, request-relevant reported evidence — never an
    inferred "higher/lower is better" judgement this module has no real
    domain rule for. A candidate with reported data for a request-relevant
    dimension scores higher than one with none for that dimension; the
    exact numeric values stay visible in `experimental_factors`, never
    silently ranked against each other."""
    if not relevant_metrics:
        return 0.0, {}
    own = [o for o in outcomes if o.get("source_formulation_id") == source_formulation_id]
    factors: Dict[str, float] = {}
    hits = 0
    for metric in relevant_metrics:
        matching = [o for o in own if o.get("metric") == metric or metric in str(o.get("raw_text", "")).lower()]
        factors[metric] = 1.0 if matching else 0.0
        if matching:
            hits += 1
    return (hits / len(relevant_metrics) if relevant_metrics else 0.0), factors


def _detect_source_selected(source_formulation_id: str, pdf_lines: List[str]) -> bool:
    if not source_formulation_id or not pdf_lines:
        return False
    label_num = re.sub(r"\D", "", source_formulation_id)
    if not label_num:
        return False
    for line in pdf_lines:
        for m in _SOURCE_SELECTED_RE.finditer(line):
            found = m.group(1) or m.group(2)
            if found == label_num:
                return True
    return False


def build_candidates(
    scientific_formulations: List[Dict[str, Any]],
    scientific_outcomes: List[Dict[str, Any]],
    role_map: Dict[str, List[str]],
    role_requirements: Dict[str, str],
    avoid_keys: set,
    brief: Dict[str, Any],
    major_system_roles: set,
    pdf_lines_by_doi: Optional[Dict[str, List[str]]] = None,
    fallback_completeness: Optional[float] = None,
) -> List[ArchitectureCandidate]:
    """`fallback_completeness` — FormuLab v1 (FVL-02) §6/§7: the REAL
    fraction of required roles the current request's own generic evidence/
    supplier/deterministic-rule candidate universe can cover, computed by
    the caller via `engine.covered_roles()` against an already-built,
    scientific-formulation-free pool. `None` only in a caller/test that has
    no such pool available, in which case a disclosed, cruder fallback
    (whether ANY role is even named at all) is used instead — never a
    silent assumption of full completeness."""
    """One `ArchitectureCandidate` per real `ScientificFormulationRecord`,
    plus exactly one generic fallback candidate (the existing evidence/
    rule candidate pool always available regardless of literature) — never
    a candidate for a role/architecture this module cannot justify from
    real data."""
    relevant_metrics = _request_relevant_metrics(brief)
    required_roles = {r for r, level in role_requirements.items() if level == "required"}
    all_named_roles = set(role_requirements.keys())
    candidates: List[ArchitectureCandidate] = []

    for sf in scientific_formulations:
        rows = sf.get("ingredients", [])
        # §2/§3 — SOURCE structural coverage (`structurally_present_roles`)
        # is computed first, from the paper's own composition table alone,
        # with NO knowledge of the current request's avoid list. Only
        # AFTER that is `eligible_roles_after_constraints` derived by
        # removing whatever the request forbids. A forbidden ingredient
        # must never be silently absent from the source figure — that
        # collapse is the exact bug this rewrite fixes.
        structurally_present_roles: Dict[str, str] = {}
        violating_roles: List[str] = []
        violating_ingredients: List[Dict[str, str]] = []
        resolved_count = 0
        for row in rows:
            key = row.get("normalized_key")
            if key:
                resolved_count += 1
            if not key:
                continue
            for role in role_map.get(key, []):
                if role in major_system_roles and role not in structurally_present_roles:
                    structurally_present_roles[role] = key
                    if key in avoid_keys:
                        violating_roles.append(role)
                        violating_ingredients.append({
                            "role": role, "key": key,
                            "reason": "matches a deterministically excluded ingredient "
                                      "(user exclusion or hard rule)",
                        })
        hard_violation = bool(violating_ingredients)
        eligible_roles_after_constraints = {
            role: key for role, key in structurally_present_roles.items() if role not in violating_roles
        }
        unresolved = len(rows) - resolved_count
        covered_required_source = len(required_roles & set(structurally_present_roles.keys()))
        functional_completeness_source = (
            (covered_required_source / len(required_roles)) if required_roles else 1.0
        )
        covered_required = len(required_roles & set(eligible_roles_after_constraints.keys()))
        functional_completeness = (covered_required / len(required_roles)) if required_roles else 1.0
        material_resolvability = (resolved_count / len(rows)) if rows else 0.0
        class_weight = {"A": 1.0, "B": 0.75, "C": 0.5, "D": 0.3, "E": 0.15}
        evidence_coverage = class_weight.get(sf.get("evidence_class", "E"), 0.15)
        confidence_penalty = 0.0 if sf.get("extraction_confidence") == "high" else 0.15
        pdf_lines = (pdf_lines_by_doi or {}).get(sf.get("doi", ""), [])
        source_selected = _detect_source_selected(sf.get("source_formulation_id", ""), pdf_lines)
        exp_support, exp_factors = _experimental_support(
            sf.get("source_formulation_id", ""), scientific_outcomes, relevant_metrics,
        )
        adaptation_required = hard_violation
        adaptation_penalty = 0.15 if hard_violation else 0.0
        uncertainty_penalty = confidence_penalty + (0.1 if unresolved > len(rows) / 2 else 0.0)

        # §4 — INSUFFICIENT_INFORMATION is reserved for a source that truly
        # has no structural information for any required role — evaluated
        # from the SOURCE figure, never the after-constraints one. A
        # formulation whose only required-role ingredient happens to be
        # forbidden by the current request is still a real, structurally
        # complete-enough architecture (ELIGIBLE, `adaptation_required`).
        eligibility = ELIGIBLE
        reason = ""
        if functional_completeness_source == 0.0 and required_roles:
            eligibility = INSUFFICIENT_INFORMATION
            reason = ("This formulation contributes no resolved ingredient to any required "
                      "functional role — its own composition rows have no known material "
                      "identity for a required role.")

        total = (
            0.30 * functional_completeness
            + 0.20 * (0.0 if hard_violation else 1.0)
            + 0.15 * evidence_coverage
            + 0.15 * exp_support
            + 0.10 * material_resolvability
            + (0.08 if source_selected else 0.0)
            - adaptation_penalty
            - uncertainty_penalty
        )
        candidates.append(ArchitectureCandidate(
            architecture_candidate_id=sf.get("id", f"{sf.get('canonical_paper_id','')}:{sf.get('source_formulation_id','')}"),
            architecture_origin=ORIGIN_SCIENTIFIC,
            canonical_paper_id=sf.get("canonical_paper_id", ""), doi=sf.get("doi", ""),
            source_title=sf.get("source_title", ""), source_formulation_id=sf.get("source_formulation_id", ""),
            product_relevance=1.0,  # already corpus-relevance-filtered upstream by literature_cache/evidence
            functional_completeness=functional_completeness,
            functional_completeness_source=functional_completeness_source,
            constraint_fit=(0.0 if hard_violation else 1.0),
            scientific_directness=1.0, evidence_coverage=evidence_coverage, experimental_support=exp_support,
            material_resolvability=material_resolvability, adaptation_penalty=adaptation_penalty,
            uncertainty_penalty=uncertainty_penalty, total_score=round(total, 4),
            hard_violation=hard_violation, adaptation_required=adaptation_required, source_selected=source_selected,
            unresolved_material_count=unresolved, experimental_factors=exp_factors,
            fingerprint=_fingerprint(eligible_roles_after_constraints),
            source_fingerprint=_fingerprint(structurally_present_roles),
            structurally_present_roles=structurally_present_roles,
            eligible_roles_after_constraints=eligible_roles_after_constraints,
            violating_roles=tuple(violating_roles), violating_ingredients=tuple(violating_ingredients),
            eligibility=eligibility, rejection_reason=reason,
            record=sf,
        ))

    # The one, always-available fallback: the existing evidence/deterministic-
    # rule candidate pool this engine already had before FVL-03. Its own
    # "fingerprint" is empty (it carries no fixed major-system identity of
    # its own — the real solver decides that per version) so it is never
    # diversity-penalized against a scientific candidate's fingerprint, and
    # never source-penalized since it has no single source formulation.
    if fallback_completeness is None:
        fallback_completeness = 1.0 if all_named_roles else 0.5
    candidates.append(ArchitectureCandidate(
        architecture_candidate_id="fallback:evidence_rule",
        architecture_origin=ORIGIN_FALLBACK,
        canonical_paper_id="", doi="", source_title="", source_formulation_id="",
        product_relevance=1.0, functional_completeness=fallback_completeness,
        functional_completeness_source=fallback_completeness, constraint_fit=1.0,
        scientific_directness=0.0, evidence_coverage=0.4, experimental_support=0.0,
        material_resolvability=1.0, adaptation_penalty=0.0, uncertainty_penalty=0.0,
        total_score=round(0.30 * fallback_completeness + 0.20 + 0.15 * 0.4 + 0.10, 4),
        hard_violation=False, adaptation_required=False, source_selected=False, unresolved_material_count=0,
        experimental_factors={}, fingerprint=(), source_fingerprint=(),
        structurally_present_roles={}, eligible_roles_after_constraints={},
        violating_roles=(), violating_ingredients=(),
        eligibility=ELIGIBLE, rejection_reason="",
        record=None,
    ))
    return candidates


# ------------------------------------------------------------ portfolio ---


def select_portfolio(
    candidates: List[ArchitectureCandidate], slot_count: int,
) -> Tuple[List[PortfolioAssignment], List[Dict[str, Any]]]:
    """Deterministic greedy portfolio selection across ALL slots at once
    — never independent per-slot selection, which is the exact bug this
    module exists to fix. Returns `(assignments, rejected)`; `rejected`
    names every scientific candidate never assigned, with the real reason
    (never "no version selected it")."""
    eligible = [c for c in candidates if c.eligibility == ELIGIBLE]
    fallback = next((c for c in eligible if c.architecture_origin == ORIGIN_FALLBACK), None)
    scientific = [c for c in eligible if c.architecture_origin == ORIGIN_SCIENTIFIC]

    assignments: List[PortfolioAssignment] = []
    used_sources: List[Tuple[str, str]] = []
    used_fingerprints: List[Tuple[str, ...]] = []
    reasons: Dict[str, str] = {}

    def adjusted_score(c: ArchitectureCandidate) -> Tuple[float, float]:
        penalty = 0.0
        source_key = (c.canonical_paper_id, c.source_formulation_id)
        if source_key in used_sources:
            penalty += _SAME_SOURCE_PENALTY
        # §9/§17 — diversity is judged on the SOURCE structural identity
        # (`source_fingerprint`), never the post-constraint one: a request
        # that happens to forbid the only differentiating ingredient must
        # not make otherwise-identical concentration-only variants (F1-F4
        # in the reference paper) look artificially diverse just because
        # their post-constraint fingerprints all went empty together.
        best_overlap = max(
            (_fingerprint_overlap(c.source_fingerprint, f) for f in used_fingerprints), default=0.0,
        )
        penalty += best_overlap * _FULL_FINGERPRINT_OVERLAP_PENALTY
        return c.total_score - penalty, penalty

    for slot in range(slot_count):
        best_c: Optional[ArchitectureCandidate] = None
        best_adj = -999.0
        best_penalty = 0.0
        for c in scientific:
            key = (c.canonical_paper_id, c.source_formulation_id)
            if key in [a.candidate.architecture_candidate_id for a in assignments if a.candidate]:
                pass  # a candidate MAY be reused across slots when nothing better remains (§15/§16)
            adj, pen = adjusted_score(c)
            if adj > best_adj:
                best_adj, best_c, best_penalty = adj, c, pen

        fallback_score = fallback.total_score if fallback else -999.0
        if best_c is not None and best_adj >= fallback_score and best_adj >= _MIN_DEFENSIBLE_SCORE:
            chosen = best_c
            penalty = best_penalty
            rationale = (
                f"Highest-ranked scientific architecture for this slot after diversity "
                f"adjustment (base {chosen.total_score:.2f}, penalty {penalty:.2f})."
                if penalty > 0 else
                f"Highest-ranked scientific architecture for this slot (score {chosen.total_score:.2f})."
            )
            used_sources.append((chosen.canonical_paper_id, chosen.source_formulation_id))
            used_fingerprints.append(chosen.source_fingerprint)
        elif fallback is not None and fallback_score >= _MIN_DEFENSIBLE_SCORE:
            chosen = fallback
            penalty = 0.0
            rationale = (
                "No scientific architecture outranked the general evidence/deterministic-rule "
                "candidate pool for this slot after diversity adjustment."
                if best_c is not None else
                "No applicable scientific architecture exists for this request; the general "
                "evidence/deterministic-rule candidate pool fills this slot."
            )
        else:
            assignments.append(PortfolioAssignment(
                slot_index=slot, candidate=None, diversity_penalty_applied=0.0,
                rationale="No defensible architecture (scientific or fallback) remained for this slot.",
            ))
            continue

        assignments.append(PortfolioAssignment(
            slot_index=slot, candidate=chosen, diversity_penalty_applied=round(penalty, 4), rationale=rationale,
        ))

    assigned_ids = {a.candidate.architecture_candidate_id for a in assignments if a.candidate}
    rejected: List[Dict[str, Any]] = []
    for c in scientific:
        if c.architecture_candidate_id in assigned_ids:
            continue
        if c.eligibility != ELIGIBLE:
            reason = c.rejection_reason or "Not eligible."
        else:
            # Real, specific reason — never "no version selected it" alone.
            same_seed_used = (c.canonical_paper_id, c.source_formulation_id) in used_sources
            overlap = max((_fingerprint_overlap(c.source_fingerprint, f) for f in used_fingerprints), default=0.0)
            if overlap >= 0.999:
                reason = ("Identical major-functional-system architecture to an already-selected "
                          "candidate (concentration-only variant) — fails diversity threshold.")
            elif same_seed_used:
                reason = "Same source formulation already selected for another slot; a higher-scoring alternative was available."
            elif c.experimental_support < 0.5 and _request_relevant_metrics({}):
                reason = "Weaker request-relevant experimental support than the selected candidate(s)."
            else:
                reason = f"Lower overall architecture fitness (score {c.total_score:.2f}) than the candidate(s) selected for every slot."
        rejected.append({
            "canonical_paper_id": c.canonical_paper_id, "doi": c.doi, "source_title": c.source_title,
            "source_formulation_id": c.source_formulation_id, "reason": reason, "score": c.total_score,
        })
    for c in candidates:
        if c.eligibility != ELIGIBLE and c.architecture_origin == ORIGIN_SCIENTIFIC:
            rejected.append({
                "canonical_paper_id": c.canonical_paper_id, "doi": c.doi, "source_title": c.source_title,
                "source_formulation_id": c.source_formulation_id, "reason": c.rejection_reason, "score": c.total_score,
            })

    return assignments, rejected
