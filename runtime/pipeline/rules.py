"""Deterministic formulation rules for FormuLab v2.

The v1 (agentic) pipeline decided case by case whether to, say, avoid SLES for a
dandruff/eczema shampoo — so it warned once and then forgot. v2 makes those
decisions **deterministic**: the brief is mapped to a fixed constraint set
(hard avoid-list, required functions, target pH) that is applied on EVERY run
AND checked against the model's output afterwards. Consistency is guaranteed by
code, not left to the model.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List

from region_profiles import needs_chelator, high_preservation, resolve

# --- ingredient synonym groups (INCI + common names, case-insensitive) --------

SULFATES = [
    "sodium lauryl sulfate", "sls", "sodium laureth sulfate", "sles",
    "ammonium lauryl sulfate", "ammonium laureth sulfate", "sodium coco-sulfate",
]
HARSH_PRESERVATIVES = [
    "methylisothiazolinone", "methylchloroisothiazolinone", "mit", "cmit", "mi/mci",
    "dmdm hydantoin", "imidazolidinyl urea", "diazolidinyl urea", "quaternium-15",
    "formaldehyde",
]
FRAGRANCE = ["fragrance", "parfum", "perfume"]

MILD_SURFACTANTS = [
    "decyl glucoside", "coco-glucoside", "lauryl glucoside", "caprylyl/capryl glucoside",
    "cocamidopropyl betaine", "sodium cocoyl isethionate", "sodium lauroyl sarcosinate",
    "sodium lauroyl methyl isethionate", "disodium laureth sulfosuccinate",
]
CHELATORS = [
    "disodium edta", "tetrasodium edta", "tetrasodium glutamate diacetate", "gluconolactone",
    "sodium phytate", "sodium citrate", "trisodium citrate",
]

# Trigger phrases (EN + a little TR) that mean "sensitive / gentle" -> avoid harsh.
SENSITIVE_TRIGGERS = [
    "dandruff", "anti-dandruff", "antidandruff", "kepek", "pelliculair", "pelliculaire",
    "seborrh", "eczema", "egzama", "psoria", "sensitive", "hassas", "baby", "bebek",
    "gentle", "mild", "yumuşak", "sulfate-free", "sulphate-free", "sülfatsız", "tear-free",
]


def _contains(hay: str, needles: List[str]) -> bool:
    return any(n in hay for n in needles)


def _split_terms(raw: str) -> List[str]:
    """A free-text comma/semicolon/slash-separated field ("sulfates, parabens")
    into individual trimmed terms. Used for the New Formulation Request
    screen's Excluded/Preferred Ingredients fields (docs/
    PHASE14_FRONTEND_UI_SPECIFICATION.md §C) — each term is matched the same
    way a named ingredient in `SULFATES`/`HARSH_PRESERVATIVES` already is."""
    return [t.strip() for t in re.split(r"[,;/]", raw or "") if t.strip()]


def derive_constraints(brief: Dict[str, Any]) -> Dict[str, Any]:
    """Turn a brief into a fixed constraint set applied to every run.

    brief keys (all optional except target): target, category, audience, market,
    performance, materials. Phase 14's New Formulation Request screen also
    supplies excludedIngredients/preferredIngredients/claims/targetProductType/
    targetPhMin/targetPhMax (docs/PHASE14_FRONTEND_UI_SPECIFICATION.md §C) —
    wired into this same deterministic engine below, not just forwarded as
    opaque LLM context. targetViscosity/targetActiveMatter/targetCostLevel/
    packagingType/estimatedBatchSize/availableEquipment/availableRawMaterials
    have no deterministic-rule equivalent yet and stay opaque-context-only
    (see formulationV2.ts's own FormulationBrief doc comment).
    """
    target = str(brief.get("target", ""))
    audience = str(brief.get("audience", "")).lower()
    performance = str(brief.get("performance", ""))
    category = str(brief.get("category", "")).lower()
    claims = str(brief.get("claims", ""))
    product_type = str(brief.get("targetProductType", ""))
    hay = f"{target} {performance} {category} {claims} {product_type}".lower()

    profile = resolve(brief.get("market"))

    sensitive = _contains(hay, SENSITIVE_TRIGGERS) or audience in ("child", "children", "baby")
    is_rinse_off_hair = any(k in f"{category} {hay}" for k in ("shampoo", "conditioner", "hair"))

    avoid: List[str] = []
    require_functions: List[str] = []
    prefer: List[str] = []
    reasons: List[str] = []

    user_excluded = _split_terms(str(brief.get("excludedIngredients", "")))
    if user_excluded:
        avoid += user_excluded
        reasons.append(
            "User-specified excluded ingredients honored (New Formulation "
            "Request screen): " + ", ".join(user_excluded) + "."
        )
    user_preferred = _split_terms(str(brief.get("preferredIngredients", "")))
    if user_preferred:
        prefer += user_preferred

    if sensitive:
        avoid += SULFATES + HARSH_PRESERVATIVES
        prefer += MILD_SURFACTANTS
        reasons.append(
            "Sensitive/anti-dandruff/child target: sulfates (SLS/SLES) and harsh "
            "preservatives (MI/MCI, formaldehyde donors) are excluded; mild "
            "surfactants (glucosides, isethionates, betaines) preferred."
        )
        if is_rinse_off_hair:
            avoid += FRAGRANCE
            reasons.append("Fragrance/parfum excluded on a sensitive-scalp product (allergen risk).")

    if needs_chelator(profile):
        require_functions.append("chelator")
        prefer += CHELATORS
        reasons.append(
            f"{profile['display']} has {profile['water_hardness']} water: a chelator "
            "(e.g. disodium EDTA / tetrasodium glutamate diacetate / sodium citrate) is required "
            "for surfactant efficacy and stability."
        )
        if any(k in hay for k in ("detergent", "laundry", "dish", "cleaner", "deterjan")):
            require_functions.append("builder")
            reasons.append("Hard-water detergent: include a builder (e.g. sodium carbonate/citrate/zeolite).")

    if high_preservation(profile):
        reasons.append(
            f"{profile['display']} climate ({profile['climate']}) carries a higher microbial "
            "load: use a robust, broad-spectrum preservative system and confirm with a challenge test."
        )

    ph_min = str(brief.get("targetPhMin", "")).strip()
    ph_max = str(brief.get("targetPhMax", "")).strip()
    if ph_min and ph_max:
        target_ph = f"{ph_min}-{ph_max}"
        reasons.append(f"User-specified target pH range honored: {target_ph}.")
    else:
        target_ph = _target_ph(category, hay)

    # De-dup while preserving order.
    def uniq(xs: List[str]) -> List[str]:
        seen, out = set(), []
        for x in xs:
            if x.lower() not in seen:
                seen.add(x.lower()); out.append(x)
        return out

    return {
        "profile": profile,
        "sensitive": sensitive,
        "avoid": uniq(avoid),
        "prefer": uniq(prefer),
        "require_functions": uniq(require_functions),
        "target_ph": target_ph,
        "reasons": reasons,
    }


def _target_ph(category: str, hay: str) -> str | None:
    if any(k in f"{category} {hay}" for k in ("shampoo", "conditioner", "body wash", "hair")):
        return "4.5-5.5"
    if "toothpaste" in f"{category} {hay}":
        return "6.5-8.5"
    if any(k in f"{category} {hay}" for k in ("laundry", "detergent", "dish", "surface cleaner")):
        return "8-11"
    if "limescale" in f"{category} {hay}":
        return "2-3"
    return None


def validate(ingredients: List[str], constraints: Dict[str, Any]) -> List[str]:
    """Return a list of violations: any avoided ingredient present in the formula.

    Matching is substring, case-insensitive, so "Sodium Laureth Sulfate (70%)"
    still trips the "sodium laureth sulfate" / "sles" rule.
    """
    violations: List[str] = []
    names = [i.lower() for i in ingredients]
    for banned in constraints.get("avoid", []):
        b = banned.lower()
        for name in names:
            if b in name or (len(b) <= 5 and re.search(rf"\b{re.escape(b)}\b", name)):
                violations.append(f"contains excluded ingredient '{banned}' (matched: {name})")
                break
    return violations
