"""Phase 14 Session 5 (Phase 15 zero-LLM round) — Manufacturing Procedure,
Critical Parameters, and Equipment intelligence.

**Zero LLM, same as `engine.py`.** Every step, parameter, and equipment
recommendation below is either read directly from a real structured
evidence `ProcessObservation` (`evidence.py`, extracted deterministically
in Session 2 — this module is the first thing that actually USES that
field), or derived from a small, explicit, generic engineering-order rule
table keyed by functional ROLE (never by a specific ingredient name, and
never by a specific request) — the same kind of real, named, inspectable
rule `engine.py`'s own `INTERNAL_RANGE_BY_ROLE`/`ROLE_PROCESS_ORDER`
already are.

**No numeric value is ever invented.** A temperature, mixing speed, or
duration is shown only when a real `ProcessObservation` reports one, or
when it is a direct, deterministic calculation (mass balance's own 100%
total). Everywhere else this module says so explicitly — "Not
established — laboratory validation required" — never a plausible-looking
placeholder number.

**Formula validity gates process planning (§31).** A formula whose own
`formula_state` is `invalid_mass_balance` or `invalid_constraint_violation`
is not process-planned at all — `plan_manufacturing()` returns an explicit
`not_ready_reason` instead of a (necessarily nonsensical) process for an
invalid formula. Hard ingredient exclusions and deterministic safety rules
are never re-decided or overridden here.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

SCHEMA_VERSION = 1

NOT_ESTABLISHED = "Not established — laboratory validation required"

BASIS_SCIENTIFIC_EVIDENCE = "scientific_evidence"
BASIS_SUPPLIER_DATA = "supplier_data"
BASIS_INTERNAL_FORMULAB_DATA = "internal_formulab_data"
BASIS_ENGINEERING_RULE = "deterministic_rule"


# ------------------------------------------------------- process ordering --

# A real, well-established formulation-engineering convention — charge the
# aqueous base, disperse chelator/thickener before surfactants (both work
# far better added to plain water than into an already-viscous/foaming
# mix), add surfactants, add actives, adjust pH last against the actual
# measured batch, add preservative/fragrance last (both are commonly
# heat/shear sensitive and adding them last minimizes processing exposure).
# Generic by ROLE — never a per-request or per-ingredient special case, so
# it applies to any product category `engine.py`'s functional-role registry
# covers, not just shampoo.
ROLE_PROCESS_ORDER: List[str] = [
    "solvent", "solvent_or_base",
    "chelator",
    "rheology_modifier",
    "humectant",
    "emulsifier", "oil_phase",
    "primary_surfactant", "surfactant",
    "mildness_cosurfactant",
    "active_treatment", "active_system", "abrasive",
    "conditioning_agent",
    "ph_adjuster",
    "preservative",
    "fragrance",
]

_PHASE_LABEL: Dict[str, str] = {
    "solvent": "Aqueous Phase Preparation", "solvent_or_base": "Base Phase Preparation",
    "chelator": "Aqueous Phase Preparation",
    "rheology_modifier": "Thickener Dispersion",
    "humectant": "Aqueous Phase Preparation",
    "emulsifier": "Emulsification", "oil_phase": "Oil Phase Preparation",
    "primary_surfactant": "Surfactant Addition", "surfactant": "Surfactant Addition",
    "mildness_cosurfactant": "Surfactant Addition",
    "active_treatment": "Active Addition", "active_system": "Active Addition", "abrasive": "Active Addition",
    "conditioning_agent": "Conditioning Addition",
    "ph_adjuster": "pH Adjustment",
    "preservative": "Preservation",
    "fragrance": "Fragrance Addition",
}

_GENERIC_INSTRUCTION: Dict[str, str] = {
    "solvent": "Charge the solvent (water) to the main mixing vessel first.",
    "solvent_or_base": "Charge the base to the main mixing vessel first.",
    "chelator": "Disperse the chelator into the aqueous phase before adding surfactants.",
    "rheology_modifier": "Disperse the rheology modifier slowly under agitation to avoid clumping, before adding surfactants.",
    "humectant": "Add the humectant to the aqueous phase under mild agitation.",
    "emulsifier": "Combine the emulsifier with the oil phase per its own emulsification requirement.",
    "oil_phase": "Prepare and, where required, heat the oil phase separately before combining with the aqueous phase.",
    "primary_surfactant": "Add the primary surfactant under moderate agitation, minimizing air entrainment/foam.",
    "surfactant": "Add the surfactant under moderate agitation.",
    "mildness_cosurfactant": "Add the co-surfactant(s) after the primary surfactant.",
    "active_treatment": "Add the active ingredient(s), respecting any reported temperature/order sensitivity.",
    "active_system": "Add the active system, respecting any reported temperature/order sensitivity.",
    "abrasive": "Disperse the abrasive uniformly before final adjustment.",
    "conditioning_agent": "Add the conditioning agent after the surfactant system is fully dispersed.",
    "ph_adjuster": "Adjust pH against the actual measured batch, once every other ingredient is in.",
    "preservative": "Add the preservative last (or once the batch has cooled to a safe temperature), per its own technical data.",
    "fragrance": "Add fragrance last, minimizing heat/shear exposure.",
}


@dataclass(frozen=True)
class ProcessStep:
    order: int
    phase: str
    role: str
    ingredients: List[str]
    instruction: str
    equipment: str
    mixing_method: str
    temperature_c: Optional[float]
    time_minutes: Optional[float]
    endpoint: str
    basis: str
    evidence_doi: str
    confidence: str
    """`"established"` (a real reported value backs at least one numeric
    field) or `"not_established"` (qualitative instruction only)."""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _role_rank(role: str) -> int:
    return ROLE_PROCESS_ORDER.index(role) if role in ROLE_PROCESS_ORDER else len(ROLE_PROCESS_ORDER)


def plan_process_steps(solved_ingredients: List[Dict[str, Any]]) -> List[ProcessStep]:
    """`solved_ingredients`: plain dicts, one per ingredient this formula
    version actually uses — `{"key", "display_name", "role", "process":
    {"temperature_c","ph","mixing_method","time_minutes","note"} or None,
    "evidence_doi": str}`. Real evidence process data (when present, i.e.
    the linked evidence record's own `ProcessObservation` was not empty)
    always wins over the generic role instruction; a role with no
    ingredient present in this formula gets no step at all."""
    by_role: Dict[str, List[Dict[str, Any]]] = {}
    for ing in solved_ingredients:
        by_role.setdefault(ing["role"], []).append(ing)

    steps: List[ProcessStep] = []
    order = 1
    for role in sorted(by_role, key=_role_rank):
        group = by_role[role]
        names = [i["display_name"] for i in group]
        phase = _PHASE_LABEL.get(role, role.replace("_", " ").title())
        # Prefer the strongest real process observation among this role's
        # own ingredients (never averaged/guessed across them).
        evidenced = next((i for i in group if i.get("process")), None)
        if evidenced:
            proc = evidenced["process"]
            steps.append(ProcessStep(
                order=order, phase=phase, role=role, ingredients=names,
                instruction=f"{_GENERIC_INSTRUCTION.get(role, 'Add per formulation.')} "
                            f"Reported process detail: {proc.get('note') or 'see linked evidence'}.",
                equipment="", mixing_method=proc.get("mixing_method") or "",
                temperature_c=proc.get("temperature_c"), time_minutes=proc.get("time_minutes"),
                endpoint="Uniform dispersion, no visible undissolved material." if not proc.get("mixing_method")
                          else f"Per reported method: {proc.get('mixing_method')}.",
                basis=BASIS_SCIENTIFIC_EVIDENCE, evidence_doi=evidenced.get("evidence_doi", ""),
                confidence="established",
            ))
        else:
            steps.append(ProcessStep(
                order=order, phase=phase, role=role, ingredients=names,
                instruction=_GENERIC_INSTRUCTION.get(role, "Add per formulation."),
                equipment="", mixing_method=NOT_ESTABLISHED, temperature_c=None, time_minutes=None,
                endpoint="Uniform dispersion, no visible undissolved material.",
                basis=BASIS_ENGINEERING_RULE, evidence_doi="", confidence="not_established",
            ))
        order += 1
    return steps


# --------------------------------------------------- critical parameters ---

@dataclass(frozen=True)
class CriticalParameter:
    parameter: str
    param_type: str
    """`"target"` or `"critical_limit"` — never conflated. A target range
    is not automatically a hard boundary unless real evidence/rule
    justifies treating it as one (§25)."""
    range_or_limit: str
    source_type: str
    why_it_matters: str
    consequence_if_violated: str
    confidence: str
    evidence_doi: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def build_critical_parameters(
    mass_balance: Dict[str, Any],
    brief: Dict[str, Any],
    violations: List[str],
    solved_ingredients: List[Dict[str, Any]],
    comparable_stats: Dict[str, Any],
) -> List[CriticalParameter]:
    params: List[CriticalParameter] = []

    params.append(CriticalParameter(
        parameter="Total batch mass balance", param_type="critical_limit",
        range_or_limit=f"{mass_balance.get('final_total')}% w/w" if mass_balance.get("final_total") is not None
                        else NOT_ESTABLISHED,
        source_type=BASIS_ENGINEERING_RULE,
        why_it_matters="Batch quantities and ingredient ratios are only correct if the formula sums to 100% w/w.",
        consequence_if_violated="Under- or over-filled batch; every ingredient's real proportion is wrong.",
        confidence="established" if mass_balance.get("status") == "complete" else "not_established",
        evidence_doi="",
    ))

    ph_min = str(brief.get("targetPhMin", "")).strip()
    ph_max = str(brief.get("targetPhMax", "")).strip()
    params.append(CriticalParameter(
        parameter="pH", param_type="target",
        range_or_limit=f"{ph_min}-{ph_max}" if ph_min and ph_max else NOT_ESTABLISHED,
        source_type="user_required" if ph_min and ph_max else BASIS_ENGINEERING_RULE,
        why_it_matters="Affects skin/scalp compatibility, active/surfactant stability, and preservative efficacy.",
        consequence_if_violated="Irritation risk, reduced preservative efficacy, potential instability.",
        confidence="established" if ph_min and ph_max else "not_established",
        evidence_doi="",
    ))

    if any(i["role"] == "preservative" for i in solved_ingredients):
        params.append(CriticalParameter(
            parameter="Preservative efficacy (challenge test)", param_type="critical_limit",
            range_or_limit="Pass a preservative-efficacy (challenge) test per an applicable regional standard.",
            source_type=BASIS_ENGINEERING_RULE,
            why_it_matters="Prevents microbial contamination across the product's shelf life and in-use conditions.",
            consequence_if_violated="Spoilage, contamination, consumer safety risk.",
            confidence="not_established", evidence_doi="",
        ))

    if violations:
        params.append(CriticalParameter(
            parameter="Excluded-ingredient compliance", param_type="critical_limit",
            range_or_limit="Must not contain: " + "; ".join(violations),
            source_type=BASIS_ENGINEERING_RULE,
            why_it_matters="A deterministic hard rule/exclusion was violated by this formula version.",
            consequence_if_violated="Non-compliant product; must not proceed to production as-is.",
            confidence="established", evidence_doi="",
        ))

    viscosity = str(brief.get("targetViscosity", "")).strip()
    if viscosity:
        params.append(CriticalParameter(
            parameter="Viscosity", param_type="target", range_or_limit=viscosity,
            source_type="user_required",
            why_it_matters="Consumer sensory expectation and correct dispensing/application behavior.",
            consequence_if_violated="Product pours, dispenses, or applies incorrectly.",
            confidence="established", evidence_doi="",
        ))

    for ing in solved_ingredients:
        stats = comparable_stats.get(ing["key"])
        if stats and ing["role"] in ("active_treatment", "active_system"):
            params.append(CriticalParameter(
                parameter=f"{ing['display_name']} concentration", param_type="target",
                range_or_limit=f"{stats['observed_min']}-{stats['observed_max']}{stats['unit']}",
                source_type=BASIS_SCIENTIFIC_EVIDENCE,
                why_it_matters="Evidence-supported concentration range for the intended effect.",
                consequence_if_violated="Reduced efficacy if too low; unnecessary cost or irritation risk if too high.",
                confidence="established", evidence_doi="",
            ))

    return params


# ------------------------------------------------------------- equipment ---

@dataclass(frozen=True)
class EquipmentRecommendation:
    equipment: str
    purpose: str
    requirement_level: str  # required | preferred | optional
    suggested_capacity: str
    key_capabilities: List[str]
    used_in_steps: List[str]
    available_in_facility: str  # yes | missing | partially_suitable | not_specified
    basis: str
    confidence: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


_LAB_TERMS = ("lab", "bench", "trial", "sample", "small")
_PILOT_TERMS = ("pilot",)
_PRODUCTION_TERMS = ("production", "full-scale", "full scale", "commercial", "plant")


def batch_scale(brief: Dict[str, Any]) -> str:
    text = str(brief.get("estimatedBatchSize", "")).strip().lower()
    if not text:
        return "not_specified"
    if any(k in text for k in _PRODUCTION_TERMS):
        return "production"
    if any(k in text for k in _PILOT_TERMS):
        return "pilot"
    if any(k in text for k in _LAB_TERMS):
        return "laboratory"
    return "not_specified"


def _availability(match_terms: List[str], available_text: str) -> str:
    if not available_text.strip():
        return "not_specified"
    hay = available_text.lower()
    return "yes" if any(term in hay for term in match_terms) else "missing"


def derive_equipment(
    steps: List[ProcessStep], brief: Dict[str, Any],
) -> List[EquipmentRecommendation]:
    roles_present = {s.role for s in steps}
    available_text = str(brief.get("availableEquipment", ""))
    scale = batch_scale(brief)
    scale_capacity = {
        "laboratory": "Bench scale (≤ 1-5 kg) — Scale-up validation required for larger batches.",
        "pilot": "Pilot scale — exact capacity depends on the facility's own pilot vessel.",
        "production": "Production scale — exact capacity depends on the facility's own production line.",
        "not_specified": "Not specified — batch size was not provided.",
    }[scale]

    recs: List[EquipmentRecommendation] = []

    def add(name, purpose, level, capabilities, used_in, match_terms,
            basis=BASIS_ENGINEERING_RULE, confidence="established"):
        recs.append(EquipmentRecommendation(
            equipment=name, purpose=purpose, requirement_level=level,
            suggested_capacity=scale_capacity, key_capabilities=capabilities,
            used_in_steps=used_in, available_in_facility=_availability(match_terms, available_text),
            basis=basis, confidence=confidence,
        ))

    add("Main Mixing Vessel", "Hold and mix the aqueous base and the finished batch.", "required",
        ["agitation"], [s.phase for s in steps if s.role in ("solvent", "solvent_or_base")] or ["Aqueous Phase Preparation"],
        ["mixing vessel", "main vessel", "mixer", "mixing tank"])
    add("Batch Scale/Balance", "Weigh every ingredient accurately.", "required",
        ["precision weighing"], ["Weighing"], ["scale", "balance"])

    if "rheology_modifier" in roles_present:
        add("High-Shear/Disperser Mixer", "Disperse the rheology modifier without clumping.", "preferred",
            ["high shear", "dispersion"], ["Thickener Dispersion"],
            ["high-shear", "high shear", "disperser", "homogenizer", "rotor-stator"])
    if roles_present & {"emulsifier", "oil_phase"}:
        add("Heating/Cooling Jacketed Vessel", "Melt the oil phase and control emulsification temperature.", "required",
            ["heating", "cooling", "temperature control"], ["Emulsification", "Oil Phase Preparation"],
            ["jacketed vessel", "heating", "cooling"])
    if "ph_adjuster" in roles_present:
        add("Calibrated pH Meter", "Verify and adjust pH against the target range.", "required",
            ["pH measurement"], ["pH Adjustment"], ["ph meter", "phmeter"])
    if "primary_surfactant" in roles_present or "surfactant" in roles_present:
        add("Low-Shear Agitator", "Incorporate surfactants while minimizing foam/air entrainment.", "preferred",
            ["low shear", "minimal air entrainment"], ["Surfactant Addition"], ["agitator", "low-shear", "low shear"])

    return recs


# --------------------------------------------------------------- top-level -

INVALID_STATES = {"invalid_mass_balance", "invalid_constraint_violation"}


@dataclass(frozen=True)
class ManufacturingPlan:
    ready: bool
    not_ready_reason: str
    steps: List[Dict[str, Any]]
    critical_parameters: List[Dict[str, Any]]
    equipment: List[Dict[str, Any]]
    batch_scale: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def plan_manufacturing(
    formula_state: str,
    solved_ingredients: List[Dict[str, Any]],
    brief: Dict[str, Any],
    mass_balance: Dict[str, Any],
    violations: List[str],
    comparable_stats: Dict[str, Any],
) -> ManufacturingPlan:
    """§31: a formula whose own state is invalid (bad mass balance or a hard
    constraint violation) is never process-planned — planning around an
    invalid formula would itself be a fabrication. An INCOMPLETE-but-valid
    formula (missing evidence/role, still `complete_with_validation_
    required`/`incomplete_*`) is still planned — the plan just carries that
    same honesty forward (fewer real steps/parameters where the formula
    itself has real gaps)."""
    if formula_state in INVALID_STATES:
        return ManufacturingPlan(
            ready=False,
            not_ready_reason=f"This formula version's state is '{formula_state}' — manufacturing "
                              f"process planning requires a valid formula (a correct mass balance and "
                              f"no deterministic hard-constraint violation) first.",
            steps=[], critical_parameters=[], equipment=[], batch_scale=batch_scale(brief),
        )
    steps = plan_process_steps(solved_ingredients)
    params = build_critical_parameters(mass_balance, brief, violations, solved_ingredients, comparable_stats)
    equipment = derive_equipment(steps, brief)
    return ManufacturingPlan(
        ready=True, not_ready_reason="",
        steps=[s.to_dict() for s in steps],
        critical_parameters=[p.to_dict() for p in params],
        equipment=[e.to_dict() for e in equipment],
        batch_scale=batch_scale(brief),
    )
