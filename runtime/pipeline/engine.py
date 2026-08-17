"""Phase 15 — the zero-LLM deterministic formulation engine.

**This module replaces `llm.py::call()` as the thing that actually decides
which ingredients go in a formula and at what concentration.** No generative
model of any kind — remote or local — sits anywhere in this file or in
anything it calls. Every decision below is either a lookup against real,
already-gathered data (structured evidence, the user's own supplier
materials list, the user's own request fields) or a named, inspectable rule
(`rules.py`'s own deterministic constraint engine, this module's own
functional-role registry and internal engineering-default table). Nothing
here can produce an ingredient, a concentration, or a claim that cannot be
traced back to one of those four sources.

`llm.py` remains in the repository for historical/legacy compatibility
(old sessions were genuinely produced by a real model call, and this
codebase never rewrites history — see `provenance.py`), but nothing in this
module imports it, and `pipeline.py::run()` no longer reaches it either.

Pipeline (the actual one this module implements, not aspirational):

    brief -> parse_requirements()               deterministic signal parsing
          -> functional-role requirements        per-category, dynamic
          -> build_candidate_pool()              evidence + rule + user + supplier
          -> resolve_concentration() per role     evidence -> supplier -> rule -> unresolved
          -> per-strategy select_ingredients()    role coverage + strategy bias
          -> render as a formula dict             same shape `render_card`/
                                                    `provenance.compute_mass_balance`/
                                                    the frontend already expect

**Honest incompleteness is a real, first-class outcome.** A required
functional role with no defensible candidate, or a candidate with no
defensible concentration, does not get a plausible-looking number invented
for it — the formula is marked with an explicit completeness state
(`FormulaState`) and the specific gap is recorded in
`unresolved_requirements`/`missing_roles`, never silently dropped or
papered over.

**Two ingredient roles are deliberately excluded from the internal
engineering-default concentration table** (`INTERNAL_RANGE_BY_ROLE`):
`primary_surfactant` and `active_treatment`. These are exactly the
ingredients a real formulation's performance/claims/cost actually turn on
— a generic textbook range is not a defensible source for them the way it
is for, say, a preservative's typical use level. Those two roles may only
be resolved from real evidence, an explicit user requirement, or a matched
supplier material; otherwise they stay unresolved.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import evidence as evidence_mod
from evidence import (
    EvidenceRecord,
    compute_comparable_stats,
    normalize_ingredient_key,
    strictly_comparable_group,
)
from rules import CHELATORS, FRAGRANCE, HARSH_PRESERVATIVES, MILD_SURFACTANTS, SULFATES

SCHEMA_VERSION = 1


# ------------------------------------------------------- origin constants ---
# Deliberately duplicated as plain strings (not imported from provenance.py)
# so this module has zero import-time dependency on the LEGACY-labeled
# provenance helpers built around the old evidence-linked-after-the-fact
# model (`provenance.classify_ingredient_origin`). This module computes
# origin AS PART OF selection, not after it — see the module docstring's
# "evidence-first, not evidence-attached-afterward" requirement.

ORIGIN_SCIENTIFIC_EVIDENCE = "scientific_evidence"
ORIGIN_SUPPLIER_DATA = "supplier_data"
ORIGIN_INTERNAL_FORMULAB_DATA = "internal_formulab_data"  # reserved — see module docstring
ORIGIN_DETERMINISTIC_RULE = "deterministic_rule"
ORIGIN_USER_REQUIRED = "user_required"


# --------------------------------------------------- deterministic parser ---

# Controlled vocabulary only (§3 of the brief this module implements: "do
# not attempt unrestricted language understanding"). Each entry maps a
# recognized phrase to a normalized signal tag; matching is substring,
# case-insensitive, against the request's own `target`/`claims`/
# `performance` text — the same fields `rules.py::derive_constraints`
# already reads.
CONTROLLED_SIGNAL_VOCABULARY: Dict[str, Tuple[str, ...]] = {
    "sulfate_free": ("sulfate-free", "sulphate-free", "sulfate free", "sülfatsız"),
    "silicone_free": ("silicone-free", "silicone free"),
    "sensitive_skin": ("sensitive skin", "hassas cilt"),
    "sensitive_scalp": ("sensitive scalp", "hassas saçlı deri"),
    "anti_dandruff": ("anti-dandruff", "antidandruff", "dandruff", "kepek"),
    "moisturizing": ("moisturizing", "moisturising", "hydrating"),
    "antibacterial": ("antibacterial", "anti-bacterial"),
    "antifungal": ("antifungal", "anti-fungal"),
    "low_cost": ("low cost", "low-cost", "economy", "budget"),
    "medium_cost": ("medium cost", "mid-range", "mid range"),
    "premium": ("premium", "luxury"),
    "natural_origin": ("natural-origin", "natural origin", "natural", "organic", "plant-based"),
    "color_protection": ("color protection", "colour protection", "color-safe", "colour-safe"),
    "easy_combing": ("easy combing", "detangling", "detangle"),
    "good_foam": ("good foam", "rich foam", "high foam", "foaming"),
    "high_viscosity": ("high viscosity", "thick"),
    "low_viscosity": ("low viscosity", "thin", "runny"),
    "fragrance_free": ("fragrance-free", "fragrance free", "unscented", "parfum-free"),
}

# Roles a resolved signal maps onto — used to upgrade a role's requirement
# level (see `resolve_role_requirements`) and, for the treatment-claim
# signals, to feed `active_treatment`. Not every signal maps to a role (cost
# level and viscosity direction feed the concentration/strategy bias
# instead, not a role requirement).
_SIGNAL_REQUIRES_ACTIVE_TREATMENT = {"anti_dandruff", "antibacterial", "antifungal", "moisturizing"}

# Words that are structurally handled elsewhere (product-type head terms,
# already-parsed brief fields) and must never be reported as an "unresolved"
# leftover just because they were stripped out of the free-text scan.
_STRUCTURAL_STOPWORDS = {
    "a", "an", "the", "for", "with", "without", "and", "or", "of", "to", "in",
    "on", "shampoo", "conditioner", "cream", "lotion", "soap", "detergent",
    "cleanser", "wash", "gel", "toothpaste", "mouthwash", "product",
    # Generic request-framing verbs/nouns that carry no formulation-relevant
    # meaning of their own — filtering these is not "guessing" at content,
    # it is recognizing structural filler common to how a request is
    # phrased ("develop an effective X" vs. just "X"), the same way a
    # product-type head word already is.
    "develop", "create", "design", "make", "formulate", "effective", "new",
    "please", "want", "need", "would", "like", "that", "this", "is", "are",
}


@dataclass(frozen=True)
class RequirementParse:
    """Deterministic interpretation of the request's own free-text fields.
    `resolved` is the set of controlled-vocabulary signal tags actually
    found; `unresolved_fragments` are leftover words from `target`/`claims`
    this parser could not map to anything — persisted honestly rather than
    silently dropped or guessed at (§3's own explicit instruction)."""

    resolved: List[str]
    unresolved_fragments: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def parse_requirements(brief: Dict[str, Any]) -> RequirementParse:
    target = str(brief.get("target", ""))
    claims = str(brief.get("claims", ""))
    performance = str(brief.get("performance", ""))
    hay = f"{target} {claims} {performance}".lower()

    resolved: List[str] = []
    consumed_spans: List[Tuple[int, int]] = []
    for tag, phrases in CONTROLLED_SIGNAL_VOCABULARY.items():
        for phrase in phrases:
            idx = hay.find(phrase)
            if idx != -1:
                resolved.append(tag)
                consumed_spans.append((idx, idx + len(phrase)))
                break

    # What's left of `target` after removing every recognized phrase and
    # every structural/head word — real leftover content the parser could
    # not interpret, not a fabricated gap.
    masked = list(target.lower())
    for tag, phrases in CONTROLLED_SIGNAL_VOCABULARY.items():
        if tag not in resolved:
            continue
        for phrase in phrases:
            idx = "".join(masked).find(phrase)
            if idx != -1:
                for i in range(idx, idx + len(phrase)):
                    if i < len(masked):
                        masked[i] = " "
    leftover_words = [
        w for w in re.findall(r"[a-z0-9\-]+", "".join(masked))
        if w not in _STRUCTURAL_STOPWORDS and len(w) > 2
    ]
    # De-dup, preserve order.
    unresolved = list(dict.fromkeys(leftover_words))

    return RequirementParse(resolved=sorted(set(resolved)), unresolved_fragments=unresolved)


# ------------------------------------------------------- functional roles ---

REQUIRED = "required"
PREFERRED = "preferred"
OPTIONAL = "optional"
NOT_APPLICABLE = "not_applicable"

_CLEANSING_HEAD = ("shampoo", "body wash", "bodywash", "bar soap", "dishwashing", "dish",
                    "detergent", "surface cleaner", "glass cleaner", "hand wash", "handwash",
                    "cleanser", "shower gel")
_ORAL_HEAD = ("toothpaste", "mouthwash")
_LEAVE_ON_HEAD = ("cream", "lotion", "conditioner", "serum", "balm", "softener")

FUNCTIONAL_ROLE_LIBRARY: Dict[str, Dict[str, str]] = {
    "cleansing": {
        "solvent": REQUIRED,
        "primary_surfactant": REQUIRED,
        "mildness_cosurfactant": PREFERRED,
        "active_treatment": OPTIONAL,
        "rheology_modifier": PREFERRED,
        "conditioning_agent": OPTIONAL,
        "humectant": OPTIONAL,
        "chelator": OPTIONAL,
        "preservative": REQUIRED,
        "ph_adjuster": PREFERRED,
        "fragrance": OPTIONAL,
    },
    "oral": {
        "solvent": REQUIRED,
        "abrasive": PREFERRED,
        "humectant": REQUIRED,
        "surfactant": PREFERRED,
        "active_treatment": PREFERRED,
        "preservative": REQUIRED,
        "rheology_modifier": PREFERRED,
        "ph_adjuster": PREFERRED,
        "fragrance": OPTIONAL,
    },
    "leave_on": {
        "solvent": REQUIRED,
        "emulsifier": PREFERRED,
        "oil_phase": PREFERRED,
        "conditioning_agent": PREFERRED,
        "preservative": REQUIRED,
        "humectant": PREFERRED,
        "rheology_modifier": PREFERRED,
        "ph_adjuster": PREFERRED,
        "fragrance": OPTIONAL,
    },
    "generic": {
        "solvent_or_base": REQUIRED,
        "active_system": PREFERRED,
        "builder": OPTIONAL,
        "preservative": PREFERRED,
        "ph_adjuster": PREFERRED,
    },
}

# At most this many distinct ingredients may fill one role in one formula —
# default 1; a real co-surfactant system commonly uses two (primary +
# secondary), so that role alone gets 2. Deliberately conservative
# elsewhere: this is a bounded, testable solver, not a full mixture
# optimizer.
MAX_CANDIDATES_PER_ROLE: Dict[str, int] = {"mildness_cosurfactant": 2}


def category_group(category: str, target: str) -> str:
    hay = f"{category} {target}".lower()
    if any(k in hay for k in _ORAL_HEAD):
        return "oral"
    if any(k in hay for k in _LEAVE_ON_HEAD):
        return "leave_on"
    if any(k in hay for k in _CLEANSING_HEAD):
        return "cleansing"
    return "generic"


def resolve_role_requirements(
    group: str, brief: Dict[str, Any], constraints: Dict[str, Any], parsed: RequirementParse,
) -> Dict[str, str]:
    """The static library, then real, named upgrades for THIS request —
    never a hardcoded per-product-name special case."""
    roles = dict(FUNCTIONAL_ROLE_LIBRARY[group])
    target = str(brief.get("target", "")).lower()
    category = str(brief.get("category", "")).lower()

    if constraints.get("sensitive") and "mildness_cosurfactant" in roles:
        roles["mildness_cosurfactant"] = REQUIRED

    if "conditioner" in f"{category} {target}" and "conditioning_agent" in roles:
        roles["conditioning_agent"] = REQUIRED

    if constraints.get("require_functions") and "chelator" in constraints["require_functions"] and "chelator" in roles:
        roles["chelator"] = REQUIRED

    if any(sig in parsed.resolved for sig in _SIGNAL_REQUIRES_ACTIVE_TREATMENT):
        role = "active_treatment" if "active_treatment" in roles else ("active_system" if "active_system" in roles else None)
        if role:
            roles[role] = REQUIRED

    if "fragrance_free" in parsed.resolved or "fragrance" in constraints.get("avoid", []):
        if "fragrance" in roles:
            roles["fragrance"] = NOT_APPLICABLE
    # A sensitive-scalp rinse-off-hair product already excludes fragrance via
    # rules.py's own hard rule (FRAGRANCE folded into `constraints["avoid"]`)
    # — reflected here structurally rather than re-derived.
    avoid_keys = {normalize_ingredient_key(a) for a in constraints.get("avoid", [])}
    if "fragrance" in roles and any(normalize_ingredient_key(f) in avoid_keys for f in FRAGRANCE):
        roles["fragrance"] = NOT_APPLICABLE

    return roles


# ------------------------------------------------------------ role lookup ---

ROLE_MAP: Dict[str, List[str]] = {}


def _add_role(names: Any, role: str) -> None:
    for n in names:
        k = normalize_ingredient_key(n)
        if not k:
            continue
        ROLE_MAP.setdefault(k, [])
        if role not in ROLE_MAP[k]:
            ROLE_MAP[k].append(role)


_add_role(["water", "aqua", "water (aqua)", "demineralised water", "demineralized water"], "solvent")
_add_role(SULFATES, "primary_surfactant")
_add_role([
    "decyl glucoside", "coco-glucoside", "lauryl glucoside", "caprylyl/capryl glucoside",
    "sodium cocoyl isethionate", "sodium lauroyl sarcosinate", "sodium lauroyl methyl isethionate",
], "primary_surfactant")
_add_role(MILD_SURFACTANTS, "mildness_cosurfactant")
_add_role(CHELATORS, "chelator")
_add_role([
    "piroctone olamine", "climbazole", "zinc pyrithione", "ketoconazole",
    "salicylic acid", "selenium disulfide",
], "active_treatment")
_add_role(["phenoxyethanol", "sodium benzoate", "potassium sorbate"], "preservative")
_add_role(["citric acid", "sodium hydroxide"], "ph_adjuster")
_add_role(["xanthan gum", "carbomer", "hydroxypropyl methylcellulose", "sodium chloride"], "rheology_modifier")
_add_role(["glycerin", "glycerol", "panthenol"], "humectant")
_add_role(["cetyl alcohol", "stearyl alcohol", "dimethicone", "cyclopentasiloxane", "polyquaternium-10"], "conditioning_agent")
_add_role(FRAGRANCE, "fragrance")
# Roles with no evidence-vocabulary ingredient behind them yet (abrasive,
# surfactant/emulsifier/oil_phase/builder/active_system/solvent_or_base for
# the oral/leave_on/generic groups) are a real, disclosed gap — see the
# architecture doc's "known limitations" — never filled with a guessed
# ingredient.

# Keywords matched against a supplier material's own free-text `function`
# column (materials.py's own schema) when the material's INCI/name is not
# already a recognized ROLE_MAP entry — the only way a supplier row can
# contribute a role FormuLab's own evidence vocabulary has never heard of.
_SUPPLIER_FUNCTION_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    "primary_surfactant": ("surfactant", "cleanser", "cleansing"),
    "mildness_cosurfactant": ("co-surfactant", "cosurfactant", "secondary surfactant", "mild"),
    "preservative": ("preserv",),
    "chelator": ("chelat", "sequestrant"),
    "rheology_modifier": ("thicken", "rheolog", "viscosity"),
    "humectant": ("humectant", "moistur"),
    "conditioning_agent": ("condition",),
    "fragrance": ("fragrance", "perfume"),
    "ph_adjuster": ("ph adjust", "buffer", "acidifier", "alkalizer"),
    "emulsifier": ("emulsif",),
    "oil_phase": ("emollient", "oil phase", "ester"),
    "abrasive": ("abrasive", "polishing"),
    "active_treatment": ("active",),
    "builder": ("builder",),
}


def _roles_for_supplier_material(material: Dict[str, Any]) -> List[str]:
    key = normalize_ingredient_key(material.get("inci") or material.get("name") or "")
    if key in ROLE_MAP:
        return list(ROLE_MAP[key])
    fn = str(material.get("function", "")).lower()
    if not fn:
        return []
    roles = [role for role, kws in _SUPPLIER_FUNCTION_KEYWORDS.items() if any(k in fn for k in kws)]
    return roles


# ---------------------------------------------- internal engineering table --

@dataclass(frozen=True)
class InternalRange:
    low: float
    high: float
    unit: str
    basis: str
    note: str


# Well-established, generic engineering default ranges — real domain
# knowledge (the kind any working formulation chemist already knows without
# opening a specific paper), never invented for this request. Deliberately
# does NOT include `primary_surfactant`/`active_treatment` — see the module
# docstring for why those two are excluded on purpose. Origin for any
# ingredient resolved from this table is `deterministic_rule`, not
# `internal_formulab_data` (that category stays reserved — see
# `ORIGIN_INTERNAL_FORMULAB_DATA`'s own comment above).
# Universal, real, named role defaults — the water rule's own logic
# extended to a small set of mundane infrastructure roles. Never
# `primary_surfactant`/`active_treatment` (see `_NO_GENERIC_RANGE_ROLES`
# below and the module docstring). Each entry is a REAL, broadly-used
# ingredient for that role, not a guess specific to any one request.
DETERMINISTIC_ROLE_DEFAULTS: Dict[str, List[str]] = {
    "preservative": ["Phenoxyethanol", "Potassium Sorbate"],
    "chelator": ["Disodium EDTA", "Sodium Citrate"],
    "ph_adjuster": ["Citric Acid", "Sodium Hydroxide"],
    "rheology_modifier": ["Xanthan Gum"],
    "humectant": ["Glycerin"],
}

INTERNAL_RANGE_BY_ROLE: Dict[str, InternalRange] = {
    "preservative": InternalRange(0.3, 1.0, "%", "formulation",
                                   "Typical broad-spectrum preservative-system use level "
                                   "per general cosmetic/detergent formulation engineering "
                                   "practice — not paper- or supplier-sourced; confirm with "
                                   "a preservative-efficacy challenge test."),
    "chelator": InternalRange(0.05, 0.2, "%", "formulation",
                               "Typical chelator use level per general formulation "
                               "engineering practice."),
    "rheology_modifier": InternalRange(0.2, 0.8, "%", "formulation",
                                        "Typical thickener/rheology-modifier use level per "
                                        "general formulation engineering practice."),
    "ph_adjuster": InternalRange(0.05, 0.5, "%", "formulation",
                                  "Typical pH-adjuster dosing per general formulation "
                                  "engineering practice — the amount actually needed "
                                  "depends on titrating to the target pH in the lab."),
    "humectant": InternalRange(1.0, 5.0, "%", "formulation",
                                "Typical humectant use level per general formulation "
                                "engineering practice."),
    "mildness_cosurfactant": InternalRange(2.0, 8.0, "%", "formulation",
                                            "Typical co-surfactant use level per general "
                                            "formulation engineering practice."),
    "conditioning_agent": InternalRange(0.5, 3.0, "%", "formulation",
                                         "Typical conditioning-agent use level per general "
                                         "formulation engineering practice."),
}


# ---------------------------------------------------------- candidate pool --

@dataclass
class IngredientCandidate:
    key: str
    display_name: str
    roles: List[str] = field(default_factory=list)
    origins: List[str] = field(default_factory=list)
    evidence_records: List[EvidenceRecord] = field(default_factory=list)
    supplier_material: Optional[Dict[str, Any]] = None
    excluded: bool = False
    exclusion_reason: str = ""

    def best_evidence_class(self) -> Optional[str]:
        if not self.evidence_records:
            return None
        order = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4}
        best = min(self.evidence_records, key=lambda r: order.get(r.evidence_class.value, 9))
        return best.evidence_class.value


@dataclass(frozen=True)
class CandidatePool:
    candidates: Dict[str, IngredientCandidate]
    excluded_keys: List[str]

    def to_diagnostics(self) -> Dict[str, Any]:
        by_origin: Dict[str, int] = {}
        for c in self.candidates.values():
            for o in c.origins:
                by_origin[o] = by_origin.get(o, 0) + 1
        return {
            "candidate_count": len(self.candidates),
            "excluded_count": len(self.excluded_keys),
            "by_origin": by_origin,
        }


def build_candidate_pool(
    brief: Dict[str, Any],
    constraints: Dict[str, Any],
    ranked_evidence: List[EvidenceRecord],
    materials: List[Dict[str, Any]],
) -> CandidatePool:
    avoid_keys = {normalize_ingredient_key(a) for a in constraints.get("avoid", [])}
    user_preferred = {
        normalize_ingredient_key(t)
        for t in re.split(r"[,;/]", str(brief.get("preferredIngredients", "")))
        if t.strip()
    }

    pool: Dict[str, IngredientCandidate] = {}
    excluded_keys: List[str] = []

    def get(key: str, display: str) -> IngredientCandidate:
        if key not in pool:
            pool[key] = IngredientCandidate(key=key, display_name=display, roles=list(ROLE_MAP.get(key, [])))
        return pool[key]

    def mark_excluded_if_needed(c: IngredientCandidate) -> bool:
        if c.key in avoid_keys and not c.excluded:
            c.excluded = True
            c.exclusion_reason = "matches a deterministically excluded ingredient (user exclusion or hard rule)"
            if c.key not in excluded_keys:
                excluded_keys.append(c.key)
        return c.excluded

    # 1. Scientific evidence — every recognized ingredient mention the
    #    already-ranked evidence pool carries, real origin, real class.
    for r in ranked_evidence:
        if r.ingredient_key not in ROLE_MAP:
            continue  # no functional role known for it — cannot safely use it to fill a role
        c = get(r.ingredient_key, r.ingredient_raw or r.ingredient_key)
        if ORIGIN_SCIENTIFIC_EVIDENCE not in c.origins:
            c.origins.append(ORIGIN_SCIENTIFIC_EVIDENCE)
        c.evidence_records.append(r)
        mark_excluded_if_needed(c)

    # 2. `constraints["prefer"]` — rule-derived groups AND the user's own
    #    preferred-ingredients text are folded together by
    #    `rules.py::derive_constraints`; disambiguated here the same way
    #    `provenance.classify_ingredient_origin` already does, so a
    #    user-typed preference is never mislabeled as an independent rule.
    for name in constraints.get("prefer", []):
        key = normalize_ingredient_key(name)
        if not key:
            continue
        c = get(key, name)
        is_user = key in user_preferred or any(u and (u in key or key in u) for u in user_preferred)
        origin = ORIGIN_USER_REQUIRED if is_user else ORIGIN_DETERMINISTIC_RULE
        if origin not in c.origins:
            c.origins.append(origin)
        mark_excluded_if_needed(c)

    # 3. Supplier materials — real, live data when the user has uploaded a
    #    raw-material list for this installation (`materials.py`); simply
    #    contributes zero candidates when none exists, which is the honest
    #    outcome, not an error.
    for m in materials:
        key = normalize_ingredient_key(m.get("inci") or m.get("name") or "")
        if not key:
            continue
        roles = _roles_for_supplier_material(m)
        c = get(key, m.get("name") or m.get("inci") or key)
        if roles:
            for role in roles:
                if role not in c.roles:
                    c.roles.append(role)
        if ORIGIN_SUPPLIER_DATA not in c.origins:
            c.origins.append(ORIGIN_SUPPLIER_DATA)
        c.supplier_material = m
        mark_excluded_if_needed(c)

    # 4. The universal aqueous base. Including water as the solvent for an
    #    aqueous personal-care/detergent product is a real, deterministic
    #    engineering rule (the same category as `rules.py`'s own hard
    #    rules) — never an invented ingredient choice.
    water_key = normalize_ingredient_key("Water (Aqua)")
    wc = get(water_key, "Water (Aqua)")
    if "solvent" not in wc.roles:
        wc.roles.append("solvent")
    if "solvent_or_base" not in wc.roles:
        wc.roles.append("solvent_or_base")
    if ORIGIN_DETERMINISTIC_RULE not in wc.origins:
        wc.origins.append(ORIGIN_DETERMINISTIC_RULE)
    mark_excluded_if_needed(wc)

    # 5. Universal role defaults — the SAME kind of real, named engineering
    #    rule water above already is, extended to a small set of mundane,
    #    non-claim-bearing infrastructure roles (never `primary_surfactant`/
    #    `active_treatment` — those stay evidence/user/supplier-only, see
    #    `_NO_GENERIC_RANGE_ROLES`). Without this, a request whose retrieved
    #    literature happens not to discuss preservation at all would report
    #    "no defensible preservative candidate found" even though a real,
    #    standard, broadly-used preservative system is a legitimate
    #    deterministic default for ANY aqueous formulation — the exact
    #    "legitimately-sourced basic ingredient" case this engine must not
    #    force journal evidence for.
    for role, names in DETERMINISTIC_ROLE_DEFAULTS.items():
        for name in names:
            key = normalize_ingredient_key(name)
            c = get(key, name)
            if role not in c.roles:
                c.roles.append(role)
            if ORIGIN_DETERMINISTIC_RULE not in c.origins:
                c.origins.append(ORIGIN_DETERMINISTIC_RULE)
            mark_excluded_if_needed(c)

    return CandidatePool(candidates=pool, excluded_keys=excluded_keys)


# ------------------------------------------------------- concentration ----

@dataclass(frozen=True)
class ConcentrationResolution:
    value: Optional[float]
    unit: str
    basis: str
    source_type: str
    """`"scientific_evidence"` | `"deterministic_rule"` | `"unresolved"` —
    what actually resolved the value, for direct display, never guessed
    after the fact."""
    note: str


_STRATEGY_BIAS_LOW = {"cost_optimized", "sensitive_skin"}
_STRATEGY_BIAS_HIGH = {"max_performance", "premium_sensory"}

# Roles where a "low load" strategy bias (cost/sensitive-skin) means the
# LOWER end of the range, matching the brief's own worked example
# ("Sensitive Skin: prefer lower defensible surfactant/irritancy load").
# Every other role treats "low" the same way for consistency (a lower
# defensible dose is the conservative choice for any non-active system too).
_LOW_BIAS_QUARTILE = 0.25
_HIGH_BIAS_QUARTILE = 0.75


def _pick_within_range(low: float, high: float, strategy_type: str) -> float:
    if high < low:
        low, high = high, low
    span = high - low
    if strategy_type == "cost_optimized":
        return round(low, 4)
    if strategy_type == "max_performance":
        return round(high, 4)
    if strategy_type in _STRATEGY_BIAS_LOW:
        return round(low + span * _LOW_BIAS_QUARTILE, 4)
    if strategy_type in _STRATEGY_BIAS_HIGH:
        return round(low + span * _HIGH_BIAS_QUARTILE, 4)
    return round((low + high) / 2, 4)  # balanced and every other strategy type


# Roles a generic internal engineering range must NEVER resolve — see the
# module docstring. Evidence, an explicit user requirement, or a matched
# supplier material are the only allowed sources for these.
_NO_GENERIC_RANGE_ROLES = {"primary_surfactant", "active_treatment", "active_system"}

# A real, well-established formulation-engineering plausibility bound per
# functional role — (min%, max%) no legitimate use level for that role
# ever exceeds in a real personal-care/detergent formulation, regardless of
# the specific chemistry. This is NOT a source of concentration values (it
# never resolves anything itself) — it is a sanity gate on values that
# already came from real evidence extraction. `evidence.py`'s deterministic
# text extraction (Session 2) occasionally attaches an unrelated number
# from the same sentence/paragraph to an ingredient mention (e.g. a study's
# own "89% of patients improved" outcome statistic, not a concentration) —
# a real extraction-accuracy limitation of that module, found during this
# round's own real-network acceptance testing (a genuine "ketoconazole at
# 45%" formula was produced from a real evidence pair of 1.0% and a
# mis-extracted 89.0%). Rather than trust an evidence-derived number that
# no working formulator would ever accept, an implausible value is
# discarded here and the hierarchy falls through to the next real tier —
# never silently used, never "fixed" by inventing a different number.
_PLAUSIBLE_RANGE_BY_ROLE: Dict[str, tuple] = {
    "active_treatment": (0.001, 20.0),
    "active_system": (0.001, 20.0),
    "primary_surfactant": (0.5, 40.0),
    "mildness_cosurfactant": (0.1, 20.0),
    "surfactant": (0.5, 40.0),
    "preservative": (0.01, 5.0),
    "chelator": (0.01, 2.0),
    "rheology_modifier": (0.01, 5.0),
    "humectant": (0.1, 30.0),
    "ph_adjuster": (0.001, 5.0),
    "conditioning_agent": (0.01, 10.0),
    "abrasive": (1.0, 60.0),
}


def _is_plausible(role: str, value: float, unit: str) -> bool:
    if unit and unit != "%":
        return True  # only a %-basis value is checked against a %-basis bound
    bounds = _PLAUSIBLE_RANGE_BY_ROLE.get(role)
    if not bounds:
        return True
    lo, hi = bounds
    return lo <= value <= hi


def resolve_concentration(
    candidate: IngredientCandidate,
    role: str,
    ranked_evidence: List[EvidenceRecord],
    strategy_type: str,
) -> ConcentrationResolution:
    # Tier 1-3: evidence. Strict comparable stats first (Session 4's own
    # multi-study statistic); a single real reported concentration next
    # (still a real fact, just not enough independent studies to average).
    # Both are gated by `_is_plausible` — see that function's own comment.
    stats = compute_comparable_stats(ranked_evidence, candidate.key)
    if stats and _is_plausible(role, stats.observed_min, stats.unit) and _is_plausible(role, stats.observed_max, stats.unit):
        value = _pick_within_range(stats.observed_min, stats.observed_max, strategy_type)
        return ConcentrationResolution(
            value=value, unit=stats.unit, basis=stats.basis, source_type="scientific_evidence",
            note=f"within the observed {stats.observed_min}-{stats.observed_max}{stats.unit} range "
                 f"from {stats.unique_study_count} unique studies",
        )
    group = strictly_comparable_group(ranked_evidence, candidate.key)
    single = next((r for r in group if r.concentration
                    and _is_plausible(role, r.concentration.value, r.concentration.unit)
                    and (r.concentration.value_max is None or _is_plausible(role, r.concentration.value_max, r.concentration.unit))), None)
    if single and single.concentration:
        conc = single.concentration
        low = conc.value
        high = conc.value_max if conc.value_max is not None else conc.value
        value = _pick_within_range(low, high, strategy_type)
        return ConcentrationResolution(
            value=value, unit=conc.unit, basis=conc.basis, source_type="scientific_evidence",
            note=f"a single reported concentration from {single.paper_doi or single.paper_title}",
        )

    # Tier 4: supplier recommended range — real when a material carries one
    # (materials.py's schema has no such field today; this checks for it
    # anyway so a future supplier-data field is honored automatically
    # rather than requiring another engine change).
    m = candidate.supplier_material
    if m:
        lo = m.get("recommended_min_pct")
        hi = m.get("recommended_max_pct")
        if isinstance(lo, (int, float)) and isinstance(hi, (int, float)):
            value = _pick_within_range(float(lo), float(hi), strategy_type)
            return ConcentrationResolution(
                value=value, unit="%", basis="formulation", source_type="supplier_data",
                note=f"within {m.get('supplier') or 'supplier'}'s recommended {lo}-{hi}% range",
            )

    # Tier 5 (validated internal FormuLab range/history) is real, disclosed,
    # NOT wired — no curated, lab-validated internal concentration-history
    # database exists in this codebase (same disclosed-gap treatment
    # Session 4 gave `internal_formulab_data` as an origin).

    # Tier 6: the internal engineering-default table — never for a
    # performance/claim-bearing role.
    if role not in _NO_GENERIC_RANGE_ROLES:
        rng = INTERNAL_RANGE_BY_ROLE.get(role)
        if rng:
            value = _pick_within_range(rng.low, rng.high, strategy_type)
            return ConcentrationResolution(
                value=value, unit=rng.unit, basis=rng.basis, source_type="deterministic_rule",
                note=rng.note,
            )

    # Tier 7: unresolved. Never invented.
    return ConcentrationResolution(value=None, unit="", basis="", source_type="unresolved",
                                    note="no evidence, supplier range, or applicable engineering "
                                         "default was available for this ingredient")


# -------------------------------------------------------------- solver ----

FORMULA_COMPLETE = "complete"
FORMULA_COMPLETE_WITH_VALIDATION_REQUIRED = "complete_with_validation_required"
FORMULA_INCOMPLETE_MISSING_EVIDENCE = "incomplete_missing_evidence"
FORMULA_INCOMPLETE_MISSING_MATERIAL = "incomplete_missing_material"
FORMULA_INCOMPLETE_MISSING_FUNCTIONAL_ROLE = "incomplete_missing_functional_role"
FORMULA_INVALID_CONSTRAINT_VIOLATION = "invalid_constraint_violation"
FORMULA_INVALID_MASS_BALANCE = "invalid_mass_balance"


def _selection_score(candidate: IngredientCandidate) -> float:
    score = 0.0
    if ORIGIN_USER_REQUIRED in candidate.origins:
        score += 1000.0
    if ORIGIN_SCIENTIFIC_EVIDENCE in candidate.origins:
        class_weight = {"A": 1.0, "B": 0.7, "C": 0.4, "D": 0.25, "E": 0.1}
        best = candidate.best_evidence_class() or "E"
        score += 500.0 + class_weight.get(best, 0.0) * 100.0 + len(candidate.evidence_records)
    if ORIGIN_DETERMINISTIC_RULE in candidate.origins:
        score += 100.0
    if ORIGIN_SUPPLIER_DATA in candidate.origins:
        score += 50.0
        price = (candidate.supplier_material or {}).get("price")
        if isinstance(price, (int, float)):
            score += max(0.0, 10.0 - min(price, 10.0))  # cheaper material tips a supplier-only tie
    return score


def _candidates_for_role(pool: CandidatePool, role: str) -> List[IngredientCandidate]:
    matches = [c for c in pool.candidates.values() if role in c.roles and not c.excluded]
    return sorted(matches, key=_selection_score, reverse=True)


@dataclass
class SolvedIngredient:
    key: str
    display_name: str
    role: str
    origins: List[str]
    concentration: ConcentrationResolution
    evidence_class: Optional[str]
    best_evidence_record: Optional[EvidenceRecord] = None


def _best_record(candidate: IngredientCandidate) -> Optional[EvidenceRecord]:
    if not candidate.evidence_records:
        return None
    order = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4}
    return min(candidate.evidence_records, key=lambda r: order.get(r.evidence_class.value, 9))


@dataclass
class FormulaResult:
    strategy: Any  # strategy.VersionStrategy
    ingredients: List[SolvedIngredient]
    missing_roles: List[Dict[str, str]]
    unresolved_requirements: List[str]
    state: str
    formula: Dict[str, Any]  # rendered {"name","purpose","ingredients":[...],"warnings":[...]}


def _display_name(key: str, fallback: str) -> str:
    if key == normalize_ingredient_key("Water (Aqua)"):
        return "Water (Aqua)"
    return fallback


def build_formula_for_strategy(
    strat: Any,
    group: str,
    role_requirements: Dict[str, str],
    pool: CandidatePool,
    ranked_evidence: List[EvidenceRecord],
    constraints: Dict[str, Any],
    parsed: RequirementParse,
    max_candidates_per_role: Dict[str, int] = MAX_CANDIDATES_PER_ROLE,
) -> FormulaResult:
    strategy_type = getattr(strat, "strategy_type", "balanced")
    # Strategies that explicitly trade sensory/process richness for
    # simplicity skip OPTIONAL roles — a real, named difference between
    # versions rather than an arbitrary one (§9 of the brief this module
    # implements).
    skip_optional = strategy_type in ("low_raw_material_count", "simplified_manufacturing")

    solved: List[SolvedIngredient] = []
    missing_roles: List[Dict[str, str]] = []
    used_keys: set = set()

    ordered_roles = sorted(role_requirements.items(), key=lambda kv: {REQUIRED: 0, PREFERRED: 1, OPTIONAL: 2}.get(kv[1], 3))
    for role, level in ordered_roles:
        if level == NOT_APPLICABLE:
            continue
        if level == OPTIONAL and skip_optional:
            continue
        cap = max_candidates_per_role.get(role, 1)
        candidates = [c for c in _candidates_for_role(pool, role) if c.key not in used_keys]
        picked_any = False
        for c in candidates[:cap]:
            # The solvent is always the q.s.-to-100 closing ingredient
            # (rendered below) — it structurally has no percentage to
            # "resolve" the way every other role's ingredient does, so it
            # never goes through the evidence/supplier/rule concentration
            # hierarchy and can never be reported as concentration-
            # unresolved.
            if role in ("solvent", "solvent_or_base"):
                resolution = ConcentrationResolution(value=None, unit="", basis="",
                                                       source_type="qs_closure", note="q.s. to 100%")
            else:
                resolution = resolve_concentration(c, role, ranked_evidence, strategy_type)
            if resolution.source_type == "unresolved":
                if level == REQUIRED:
                    missing_roles.append({
                        "role": role, "level": level,
                        "reason": f"a candidate ({c.display_name}) fills this role but no evidence, "
                                  f"supplier range, or applicable engineering default gives it a "
                                  f"defensible concentration",
                    })
                continue
            used_keys.add(c.key)
            picked_any = True
            solved.append(SolvedIngredient(
                key=c.key, display_name=_display_name(c.key, c.display_name), role=role,
                origins=list(c.origins), concentration=resolution,
                evidence_class=c.best_evidence_class(), best_evidence_record=_best_record(c),
            ))
        if not picked_any and level == REQUIRED and not any(m["role"] == role for m in missing_roles):
            missing_roles.append({
                "role": role, "level": level,
                "reason": "no non-excluded candidate in the pool fills this required role",
            })

    # The solvent is always the q.s.-to-100 closing ingredient — never given
    # an explicit percentage (its resolved concentration, if any, is
    # discarded in favor of q.s.).
    water_key = normalize_ingredient_key("Water (Aqua)")
    ingredients_json: List[Dict[str, str]] = []
    has_water = any(s.key == water_key for s in solved)
    for s in solved:
        if s.key == water_key:
            ingredients_json.append({"inci": s.display_name, "function": "Solvent", "weight_pct": "q.s. 100"})
        else:
            ingredients_json.append({
                "inci": s.display_name, "function": s.role.replace("_", " ").title(),
                "weight_pct": f"{s.concentration.value:g}",
            })
    if not has_water and any(m["role"] == "solvent" for m in missing_roles):
        pass  # honestly incomplete — no fabricated water line

    violations_ingredients = [i["inci"] for i in ingredients_json]

    warnings: List[str] = []
    unresolved_requirements = list(parsed.unresolved_fragments)
    if unresolved_requirements:
        warnings.append(
            "Could not deterministically interpret: " + ", ".join(unresolved_requirements)
            + " — no assumption was made; address explicitly if this affects the formulation."
        )
    for m in missing_roles:
        warnings.append(f"{m['role'].replace('_', ' ').title()}: {m['reason']}")

    from rules import validate as rules_validate
    rule_violations = rules_validate(violations_ingredients, constraints)

    # Real references — the actual papers behind this formula's own
    # evidence-backed ingredients, never a citation list the model
    # invented. Deduped by DOI, order-preserved.
    references: List[Dict[str, str]] = []
    seen_dois: set = set()
    for s in solved:
        r = s.best_evidence_record
        if not r or not r.paper_doi:
            continue
        doi = r.paper_doi.lower().strip()
        if doi in seen_dois:
            continue
        seen_dois.add(doi)
        references.append({"author": r.paper_authors, "year": r.paper_year, "doi": r.paper_doi,
                            "title": r.paper_title})

    required_missing = [m for m in missing_roles if m["level"] == REQUIRED]
    if required_missing:
        any_evidence_gap = any("no evidence" in m["reason"] or "defensible concentration" in m["reason"] for m in required_missing)
        state = FORMULA_INCOMPLETE_MISSING_EVIDENCE if any_evidence_gap else FORMULA_INCOMPLETE_MISSING_FUNCTIONAL_ROLE
    elif rule_violations:
        state = FORMULA_INVALID_CONSTRAINT_VIOLATION
    else:
        preferred_missing = [m for m in missing_roles if m["level"] == PREFERRED]
        used_generic_range = any(s.concentration.source_type == "deterministic_rule" for s in solved)
        state = FORMULA_COMPLETE_WITH_VALIDATION_REQUIRED if (preferred_missing or used_generic_range) else FORMULA_COMPLETE

    formula = {
        "name": strat.title if hasattr(strat, "title") else "Candidate",
        "purpose": strat.rationale if hasattr(strat, "rationale") else "",
        "ingredients": ingredients_json,
        "warnings": warnings,
        "references": references,
    }

    return FormulaResult(
        strategy=strat, ingredients=solved, missing_roles=missing_roles,
        unresolved_requirements=unresolved_requirements, state=state, formula=formula,
    )
