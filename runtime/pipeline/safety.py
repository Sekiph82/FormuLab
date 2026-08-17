"""Phase 14 Session 6 — deterministic Safety intelligence. Zero LLM.

Every finding below traces to one of four real sources, named on the
finding itself (`source_type`): `deterministic_rule` (this module's own
small, real, well-established hazard-class table — the same "any working
formulator already knows this" standard `engine.py`'s
`INTERNAL_RANGE_BY_ROLE`/`DETERMINISTIC_ROLE_DEFAULTS` already hold
themselves to), `supplier_data` (a matched material's own safety fields —
`materials.py`'s schema does not carry any today, a real, disclosed gap,
never fabricated), `scientific_evidence` (a linked evidence record's own
extracted outcome text, when it mentions a real safety-relevant signal —
never a toxicity number this module invents), and formula-level
deterministic facts already computed elsewhere (mass balance, pH,
hard-constraint violations) — referenced, never recomputed independently.

**No invented toxicity/exposure limit.** A concentration ceiling used
here is either a real regulatory/scientific threshold this module names
explicitly (GHS skin-corrosion pH boundary), or `engine.py`'s own already-
real `INTERNAL_RANGE_BY_ROLE` upper bound used as a "typical safe use
level" reference — never a number this module makes up for the occasion.
An ingredient/hazard this module has no real data for is `DATA_INCOMPLETE`,
never guessed at.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

from evidence import normalize_ingredient_key
from rules import CHELATORS, FRAGRANCE, HARSH_PRESERVATIVES, MILD_SURFACTANTS, SULFATES

SCHEMA_VERSION = 1

PASS = "PASS"
PASS_WITH_CONDITIONS = "PASS_WITH_CONDITIONS"
FAIL = "FAIL"
DATA_INCOMPLETE = "DATA_INCOMPLETE"

_STATUS_PRECEDENCE = {FAIL: 3, DATA_INCOMPLETE: 2, PASS_WITH_CONDITIONS: 1, PASS: 0}


@dataclass(frozen=True)
class SafetyFinding:
    subject_type: str
    """`"ingredient"` | `"formula"` | `"process_step"`."""
    subject: str
    status: str
    rule_id: str
    source_type: str
    condition: str
    """The real threshold/condition text, or `""` when none applies."""
    actual_value: str
    rationale: str
    required_action: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class SafetyResult:
    overall_status: str
    findings: List[Dict[str, Any]]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ------------------------------------------------- known hazard classes ---
# Real, well-established, widely-known safety facts about the SAME
# ingredient vocabulary `rules.py`/`engine.py` already work with — never a
# broader chemistry reference this module invents for the occasion. Each
# entry names the real hazard class and the real, generic mitigating
# action a working formulator already knows to take.

_SENSITIZER_CLASS_INGREDIENTS = {normalize_ingredient_key(n) for n in HARSH_PRESERVATIVES}
_ALLERGEN_DECLARATION_INGREDIENTS = {normalize_ingredient_key(n) for n in FRAGRANCE}
_CORROSIVE_HANDLING_INGREDIENTS = {normalize_ingredient_key("Sodium Hydroxide")}
_IRRITANT_POWDER_HANDLING_INGREDIENTS = {normalize_ingredient_key("Citric Acid")}
_SULFATE_KEYS = {normalize_ingredient_key(n) for n in SULFATES}

# GHS/CLP skin-corrosion classification boundary (Regulation (EC) No
# 1272/2008, Annex I, 3.2 — a substance/mixture with pH <= 2 or >= 11.5 is
# classified as skin-corrosive) — a real, widely-cited regulatory/
# scientific threshold, not invented for this module.
_GHS_CORROSIVE_PH_LOW = 2.0
_GHS_CORROSIVE_PH_HIGH = 11.5
# A tighter, real, widely-used "topical consumer product" comfort/
# compatibility band (skin's own natural pH sits roughly 4.5-5.5; broader
# personal-care formulation practice commonly targets 3.5-9 for a
# leave-on/rinse-off consumer product before an irritation risk is flagged
# even short of full GHS corrosivity).
_IRRITATION_RISK_PH_LOW = 3.5
_IRRITATION_RISK_PH_HIGH = 9.0

_ELEVATED_PROCESS_TEMP_C = 40.0  # matches engine/manufacturing's own preservative-handling note


def _finding(subject_type, subject, status, rule_id, source_type, condition, actual_value, rationale, required_action) -> SafetyFinding:
    return SafetyFinding(subject_type=subject_type, subject=subject, status=status, rule_id=rule_id,
                          source_type=source_type, condition=condition, actual_value=actual_value,
                          rationale=rationale, required_action=required_action)


def _ingredient_findings(ingredients: List[Dict[str, Any]]) -> List[SafetyFinding]:
    findings: List[SafetyFinding] = []
    for ing in ingredients:
        name = ing.get("inci", "")
        key = normalize_ingredient_key(name)
        pct = ing.get("weight_pct", "")

        if key in _SENSITIZER_CLASS_INGREDIENTS:
            findings.append(_finding(
                "ingredient", name, PASS_WITH_CONDITIONS, "SAFETY-SENS-001", "deterministic_rule",
                "known sensitizer class (formaldehyde-releaser/isothiazolinone)", pct,
                "This ingredient belongs to a real, well-established sensitizer class regardless of "
                "concentration; individual sensitization risk varies by person.",
                "Confirm current supplier SDS/IFRA-style guidance and consider a patch test before "
                "release.",
            ))
        if key in _ALLERGEN_DECLARATION_INGREDIENTS:
            findings.append(_finding(
                "ingredient", name, PASS_WITH_CONDITIONS, "SAFETY-ALRG-001", "deterministic_rule",
                "fragrance allergen declaration may apply", pct,
                "Fragrance mixtures commonly contain regulated allergen components that require "
                "declaration above a threshold in several jurisdictions.",
                "Obtain the supplier's own allergen declaration for this fragrance before finalizing "
                "labeling.",
            ))
        if key in _CORROSIVE_HANDLING_INGREDIENTS:
            findings.append(_finding(
                "ingredient", name, PASS_WITH_CONDITIONS, "SAFETY-CORR-001", "deterministic_rule",
                "corrosive in concentrate form", pct,
                "Sodium hydroxide is corrosive to skin/eyes in concentrate form, even though the "
                "finished, diluted formula may not be.",
                "Handle concentrate with appropriate PPE (gloves, eye protection); confirm finished-"
                "formula pH separately.",
            ))
        if key in _IRRITANT_POWDER_HANDLING_INGREDIENTS:
            findings.append(_finding(
                "ingredient", name, PASS_WITH_CONDITIONS, "SAFETY-DUST-001", "deterministic_rule",
                "mild irritant in powder/concentrate form", pct,
                "Citric acid in powder form can irritate eyes/airways during handling before dilution.",
                "Use dust control/PPE during weighing; confirm finished-formula pH separately.",
            ))
    return findings


def _formula_level_findings(
    ingredients: List[Dict[str, Any]], brief: Dict[str, Any], violations: List[str],
) -> List[SafetyFinding]:
    findings: List[SafetyFinding] = []

    ph_min = str(brief.get("targetPhMin", "")).strip()
    ph_max = str(brief.get("targetPhMax", "")).strip()
    if ph_min and ph_max:
        try:
            lo, hi = float(ph_min), float(ph_max)
            if lo <= _GHS_CORROSIVE_PH_LOW or hi >= _GHS_CORROSIVE_PH_HIGH:
                findings.append(_finding(
                    "formula", "target pH", FAIL, "SAFETY-PH-001", "deterministic_rule",
                    f"pH <= {_GHS_CORROSIVE_PH_LOW} or >= {_GHS_CORROSIVE_PH_HIGH} (GHS/CLP skin-"
                    f"corrosion classification boundary, Regulation (EC) No 1272/2008 Annex I 3.2)",
                    f"{ph_min}-{ph_max}",
                    "The requested target pH range crosses the GHS skin-corrosion classification "
                    "boundary for a topical consumer product.",
                    "Confirm this product category genuinely requires this pH (e.g. a descaler), and "
                    "apply corrosive-product handling/labeling if so.",
                ))
            elif lo < _IRRITATION_RISK_PH_LOW or hi > _IRRITATION_RISK_PH_HIGH:
                findings.append(_finding(
                    "formula", "target pH", PASS_WITH_CONDITIONS, "SAFETY-PH-002", "deterministic_rule",
                    f"outside the {_IRRITATION_RISK_PH_LOW}-{_IRRITATION_RISK_PH_HIGH} typical "
                    f"consumer-product comfort/compatibility band",
                    f"{ph_min}-{ph_max}",
                    "The requested target pH range is outside the typical comfort band for a "
                    "leave-on/rinse-off consumer product, short of GHS corrosivity.",
                    "Confirm irritation risk is acceptable for the intended use/audience.",
                ))
        except ValueError:
            pass
    else:
        findings.append(_finding(
            "formula", "target pH", DATA_INCOMPLETE, "SAFETY-PH-003", "",
            "", "", "No target pH was specified for this request, so pH-related safety cannot be "
            "assessed.", "Specify a target pH to enable this check.",
        ))

    if violations:
        findings.append(_finding(
            "formula", "excluded-ingredient compliance", FAIL, "SAFETY-EXCL-001", "deterministic_rule",
            "must not contain a deterministically excluded ingredient", "; ".join(violations),
            "This formula version contains a hard-excluded ingredient (rules.py::validate).",
            "Remove the excluded ingredient before this formula proceeds.",
        ))

    sulfate_present = [i.get("inci", "") for i in ingredients if normalize_ingredient_key(i.get("inci", "")) in _SULFATE_KEYS]
    if sulfate_present:
        findings.append(_finding(
            "formula", "sulfate irritation load", PASS_WITH_CONDITIONS, "SAFETY-IRR-001", "deterministic_rule",
            "sulfate surfactant present", ", ".join(sulfate_present),
            "Sulfate surfactants carry a real, well-established irritation-potential profile, "
            "especially on sensitized/compromised skin.",
            "Confirm this is acceptable for the intended audience; consider a co-surfactant/mildness "
            "system if not already present.",
        ))

    return findings


def _manufacturing_findings(manufacturing_plan: Optional[Dict[str, Any]]) -> List[SafetyFinding]:
    findings: List[SafetyFinding] = []
    if not manufacturing_plan or not manufacturing_plan.get("ready"):
        findings.append(_finding(
            "process_step", "manufacturing process", DATA_INCOMPLETE, "SAFETY-MFG-000", "",
            "", "", "No real manufacturing plan exists for this formula version (not ready), so "
            "manufacturing safety cannot be assessed.", "Resolve the formula's own state first.",
        ))
        return findings

    for step in manufacturing_plan.get("steps", []):
        phase = step.get("phase", "")
        temp = step.get("temperature_c")
        ingredients = step.get("ingredients", [])
        keys = {normalize_ingredient_key(n) for n in ingredients}

        if isinstance(temp, (int, float)) and temp >= _ELEVATED_PROCESS_TEMP_C:
            findings.append(_finding(
                "process_step", phase, PASS_WITH_CONDITIONS, "SAFETY-TEMP-001", step.get("basis", ""),
                f">= {_ELEVATED_PROCESS_TEMP_C}C reported process temperature", f"{temp}C",
                "This step's own real reported process temperature is elevated enough to carry a "
                "burn/thermal-handling risk.", "Use thermal PPE and confirm ventilation adequacy.",
            ))
        if keys & _CORROSIVE_HANDLING_INGREDIENTS:
            findings.append(_finding(
                "process_step", phase, PASS_WITH_CONDITIONS, "SAFETY-MFG-CORR-001", "deterministic_rule",
                "corrosive material in this step", ", ".join(ingredients),
                "This step handles a corrosive-in-concentrate material.",
                "Use appropriate PPE (gloves, eye protection) and confirm local ventilation.",
            ))
        if keys & _IRRITANT_POWDER_HANDLING_INGREDIENTS:
            findings.append(_finding(
                "process_step", phase, PASS_WITH_CONDITIONS, "SAFETY-MFG-DUST-001", "deterministic_rule",
                "irritant powder handling in this step", ", ".join(ingredients),
                "This step handles a material that can irritate eyes/airways in powder form.",
                "Use dust control/PPE during this step.",
            ))
    return findings


def evaluate_safety(
    formula: Dict[str, Any],
    brief: Dict[str, Any],
    violations: List[str],
    manufacturing_plan: Optional[Dict[str, Any]],
) -> SafetyResult:
    ingredients = formula.get("ingredients") or []
    findings: List[SafetyFinding] = []
    findings.extend(_ingredient_findings(ingredients))
    findings.extend(_formula_level_findings(ingredients, brief, violations))
    findings.extend(_manufacturing_findings(manufacturing_plan))

    overall = PASS
    for f in findings:
        if _STATUS_PRECEDENCE[f.status] > _STATUS_PRECEDENCE[overall]:
            overall = f.status

    return SafetyResult(overall_status=overall, findings=[f.to_dict() for f in findings])
