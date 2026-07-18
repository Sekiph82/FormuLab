"""Region profiles for FormuLab v2.

A target market is more than a set of regulations: local **water hardness**,
**climate**, and typical **hair/skin** norms materially change a formulation
(hard water needs chelators/builders; hot-humid climates need a heavier
preservative system; Afro-textured hair markets favor sulfate-free, richer
conditioning). This module maps a country/continent to a structured profile the
rules engine and the LLM prompt both consume, so the SAME market always yields
the SAME structural constraints.

Values are typical/representative, not point measurements — they steer the
formulation and must be verified for a specific city/plant water source.
"""

from __future__ import annotations

from typing import Any, Dict

# Water hardness bands (as CaCO3): soft <60, moderate 60-120, hard 120-180,
# very_hard >180 mg/L. Climate drives preservative load + rheology stability.
PROFILES: Dict[str, Dict[str, Any]] = {
    "kenya": {
        "display": "Kenya",
        "water_hardness": "hard",          # boreholes/groundwater common
        "water_ph": "7.5-8.5",
        "climate": "warm_varied",          # highlands temperate, coast hot-humid
        "hair_type": "afro_textured",
        "regulator": "KEBS (Kenya Bureau of Standards); broadly aligns with EAC/EU",
        "notes": "Hard borehole water and Afro-textured hair: prioritize chelators, "
                 "hard-water-tolerant surfactants, and richer conditioning; sulfate-free preferred.",
    },
    "africa": {
        "display": "Africa (general)",
        "water_hardness": "hard",
        "water_ph": "7.0-8.5",
        "climate": "hot_variable",
        "hair_type": "afro_textured",
        "regulator": "Varies by country; verify national body (e.g. KEBS, SONCAP, SABS)",
        "notes": "Wide variation across countries; assume hard water + hot climate + "
                 "Afro-textured hair unless specified. Verify per-country regs.",
    },
    "eu": {
        "display": "European Union",
        "water_hardness": "moderate",
        "water_ph": "7.0-8.0",
        "climate": "temperate",
        "hair_type": "mixed",
        "regulator": "EU Regulation 1223/2009 (cosmetics) / CosIng; Detergents Reg. 648/2004; BPR",
        "notes": "Strict Annexes: check permitted actives + caps + labeling. ZPT restricted since 2022.",
    },
    "us": {
        "display": "United States",
        "water_hardness": "moderate",
        "water_ph": "6.5-8.0",
        "climate": "temperate_variable",
        "hair_type": "mixed",
        "regulator": "FDA OTC monographs (anti-dandruff etc.); FDA cosmetics; EPA for antimicrobials",
        "notes": "Anti-dandruff actives are OTC-drug regulated; check monograph actives + levels.",
    },
    "turkey": {
        "display": "Türkiye",
        "water_hardness": "hard",
        "water_ph": "7.0-8.0",
        "climate": "temperate_dry",
        "hair_type": "mixed",
        "regulator": "TİTCK / KKDIK; broadly follows EU cosmetic + detergent rules",
        "notes": "Follows EU framework; hard water in many regions -> chelators help.",
    },
    "any": {
        "display": "Any / infer",
        "water_hardness": "moderate",
        "water_ph": "6.5-8.0",
        "climate": "temperate",
        "hair_type": "mixed",
        "regulator": "Not specified — flag region-specific rules generally (EU CosIng, US FDA OTC)",
        "notes": "No market specified; assume moderate water/temperate climate and flag "
                 "that region-specific limits must be verified.",
    },
}

# Accept the app's market slugs and common names.
ALIASES = {
    "kenya": "kenya",
    "africa": "africa",
    "eu": "eu", "european union": "eu", "europe": "eu",
    "us": "us", "usa": "us", "united states": "us",
    "tr": "turkey", "turkey": "turkey", "türkiye": "turkey", "turkiye": "turkey",
    "any": "any", "": "any", "any / infer": "any",
}


def resolve(market: str | None) -> Dict[str, Any]:
    """Return the profile for a market slug/name, defaulting to 'any'."""
    key = ALIASES.get((market or "").strip().lower(), None)
    if key is None:
        # Unknown but named market: use the generic profile, keep the label.
        prof = dict(PROFILES["any"])
        prof["display"] = market or "Any / infer"
        prof["notes"] = f"No built-in profile for {market!r}; verify local water, climate, and regulations."
        return prof
    return PROFILES[key]


def needs_chelator(profile: Dict[str, Any]) -> bool:
    """Hard / very-hard water needs a chelator (and a builder for detergents)."""
    return profile.get("water_hardness") in ("hard", "very_hard")


def high_preservation(profile: Dict[str, Any]) -> bool:
    """Hot/humid climates carry a higher microbial load -> stronger preservation."""
    return profile.get("climate") in ("hot_humid", "tropical", "hot_variable", "hot")
