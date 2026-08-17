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
import traceability
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
ORIGIN_SCIENTIFIC_FORMULATION = "scientific_formulation"
"""FormuLab v1 correction (FVL-03): distinct from `ORIGIN_SCIENTIFIC_EVIDENCE`
— this ingredient's role AND concentration come from a real, complete
formulation architecture a paper reported (`scientific_formulation.py`'s
own `ScientificFormulationRecord`), not merely an isolated mention. See
`_ARCHITECTURE_ROLE_LABELS`/`_selection_score`/`resolve_concentration`'s
own Tier 0 below for exactly how this outranks a bare mention."""
ORIGIN_SUPPLIER_DATA = "supplier_data"
ORIGIN_INTERNAL_FORMULAB_DATA = "internal_formulab_data"  # reserved — see module docstring
ORIGIN_DETERMINISTIC_RULE = "deterministic_rule"
ORIGIN_USER_REQUIRED = "user_required"

# Real, deterministic architecture-source classification for a whole
# GENERATED formula version (§11/§25) — never a per-ingredient origin,
# a whole-formula-level summary of where its architecture came from.
ARCHITECTURE_SCIENTIFIC_DIRECT = "scientific_formulation"
ARCHITECTURE_SCIENTIFIC_ADAPTED = "scientific_formulation_adapted"
ARCHITECTURE_SUPPLIER_FORMULATION = "supplier_formulation"
ARCHITECTURE_INTERNAL_VALIDATED = "internal_validated_formula"
ARCHITECTURE_EVIDENCE_ASSEMBLED = "evidence_assembled"
ARCHITECTURE_DETERMINISTIC_RULE = "deterministic_rule"


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
    # Product-type qualifier words — the same structural role a product's
    # own head word already plays ("hand soap", "body wash", "facial
    # cleanser", "liquid soap", "bar soap", "laundry detergent").
    "hand", "body", "face", "facial", "liquid", "bar", "dish", "dishwashing",
    "surface", "glass", "laundry", "scent", "fragrance", "aroma",
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
    scent_character: str = ""
    """The word immediately before "scent"/"fragrance"/"aroma" in the
    request's own text (e.g. "rosemary" from "hand soap with rosemary
    scent") — a narrow, structural pattern match, not language
    understanding. `""` when no such phrase is present. A real matching
    fragrance ingredient is looked up for this character in
    `build_candidate_pool`; never fabricated when none exists."""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# A real, narrow structural pattern — "<word> scent/fragrance/aroma" — not
# unrestricted language understanding: it extracts exactly one adjacent
# word, the same way a product-head or a claim keyword is matched
# elsewhere in this module, never interprets the sentence around it.
_SCENT_PATTERN = re.compile(r"\b([a-z][a-z\-]{2,})\s+(?:scent|fragrance|aroma)\b", re.I)


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

    scent_character = ""
    m = _SCENT_PATTERN.search(hay)
    if m and m.group(1) not in _STRUCTURAL_STOPWORDS:
        scent_character = m.group(1)
        resolved.append("fragrance_requested")

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
    if scent_character:
        idx = "".join(masked).find(m.group(0))
        if idx != -1:
            for i in range(idx, idx + len(m.group(0))):
                if i < len(masked):
                    masked[i] = " "
    leftover_words = [
        w for w in re.findall(r"[a-z0-9\-]+", "".join(masked))
        if w not in _STRUCTURAL_STOPWORDS and len(w) > 2
    ]
    # De-dup, preserve order.
    unresolved = list(dict.fromkeys(leftover_words))

    return RequirementParse(resolved=sorted(set(resolved)), unresolved_fragments=unresolved,
                             scent_character=scent_character)


# ------------------------------------------------------- functional roles ---

REQUIRED = "required"
PREFERRED = "preferred"
OPTIONAL = "optional"
NOT_APPLICABLE = "not_applicable"

_CLEANSING_HEAD = ("shampoo", "body wash", "bodywash", "bar soap", "hand soap", "liquid soap",
                    "soap", "dishwashing", "dish", "detergent", "laundry", "surface cleaner",
                    "glass cleaner", "hand wash", "handwash", "cleanser", "face wash",
                    "facial cleanser", "shower gel")
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

# The roles that actually DEFINE a formulation's own architecture — the
# same real distinction `strategy.py`'s own `_MAJOR_SYSTEM_ROLE_LABELS`
# makes for diversity scoring, kept here as the snake_case role-key form.
# When a later strategy has a genuine alternative candidate for one of
# these roles, it is preferred over reusing an earlier version's own
# choice — real architectural search, not a fixed best-candidate-always
# solver (Phase 14 Session 6 correction gate).
MAJOR_SYSTEM_ROLES = {
    "primary_surfactant", "mildness_cosurfactant", "surfactant", "active_treatment",
    "active_system", "rheology_modifier", "preservative", "conditioning_agent",
    "emulsifier", "oil_phase", "abrasive",
}


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
    scientific_formulation_ref: Optional[Dict[str, Any]] = None
    """The best (highest-confidence) `ScientificFormulationRecord.to_dict()`
    row this ingredient came from, when `ORIGIN_SCIENTIFIC_FORMULATION` is
    among `origins` — real paper DOI, real `source_formulation_id` (e.g.
    `"F4"`), real reported amount/unit. `None` otherwise."""
    is_preferred_architecture: bool = False
    """FormuLab v1 (FVL-02) — true when this candidate's own
    `scientific_formulation_ref` matches THIS version's own portfolio-
    assigned architecture seed (`build_candidate_pool()`'s own
    `preferred_source_formulation_id`). Real, deterministic per-version
    priority signal — never a global exclusion of every OTHER scientific
    formulation's ingredients (§2/§3: the portfolio layer answers "which
    architecture gets priority for this slot", never "should this slot
    even see the generic/other-formulation candidate universe")."""

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


def _formulation_amount_pct(row: Dict[str, Any], total_declared: str) -> Optional[float]:
    """A real, disclosed, narrow convention this class of lab-scale paper
    uses: a batch made up to a declared `Total` of ~100 (mL/g) means each
    component's own stated amount already numerically approximates its
    %w/w or %v/v. Only applied when the source's own declared total is
    genuinely ~100 — never assumed, never applied to a batch scaled to
    any other real total."""
    if row.get("value") is None or row.get("qs"):
        return None
    m = re.match(r"^(\d+\.?\d*)", total_declared or "")
    if not m:
        return None
    try:
        total = float(m.group(1))
    except ValueError:
        return None
    if abs(total - 100.0) > 1.0:
        return None
    return float(row["value"])


def build_candidate_pool(
    brief: Dict[str, Any],
    constraints: Dict[str, Any],
    ranked_evidence: List[EvidenceRecord],
    materials: List[Dict[str, Any]],
    scent_character: str = "",
    scientific_formulations: Optional[List[Dict[str, Any]]] = None,
    preferred_source_formulation_id: Optional[Tuple[str, str]] = None,
) -> CandidatePool:
    """`preferred_source_formulation_id` — FormuLab v1 (FVL-02):
    `(canonical_paper_id, source_formulation_id)` of THIS version's own
    global-portfolio-assigned architecture seed, or `None`. This never
    excludes any other scientific formulation's ingredients from the pool
    (§2/§3) — every formulation passed in `scientific_formulations` still
    contributes real candidates for whatever role it resolves. It only
    breaks the otherwise-arbitrary first-in-list-wins tie (e.g. glycerin
    reported identically across F1-F4) in favor of the assigned seed, and
    gives that seed's own distinct ingredients real role-selection
    priority over a DIFFERENT, non-assigned formulation's ingredient
    competing for the same role — the real, deterministic mechanism that
    lets different versions materialize different scientific architectures
    instead of every version converging on whichever formulation happened
    to be first in extraction order."""
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

    # 0. FormuLab v1 correction (FVL-03): a complete scientific formulation
    #    architecture — its own resolved ingredients get real priority
    #    (§8/§25) over an isolated evidence MENTION of the same ingredient,
    #    never a role invented for an unresolved row (§6: unknown material
    #    identity means the row is preserved for display, never silently
    #    turned into a role-filling candidate this engine cannot justify).
    for sf in (scientific_formulations or []):
        total_declared = sf.get("total_declared", "")
        is_preferred_sf = preferred_source_formulation_id is not None and (
            sf.get("canonical_paper_id", ""), sf.get("source_formulation_id", "")
        ) == preferred_source_formulation_id
        for row in sf.get("ingredients", []):
            key = row.get("normalized_key")
            if not key or key not in ROLE_MAP:
                continue
            c = get(key, row.get("source_name") or key)
            if ORIGIN_SCIENTIFIC_FORMULATION not in c.origins:
                c.origins.append(ORIGIN_SCIENTIFIC_FORMULATION)
            existing = c.scientific_formulation_ref
            # The assigned seed always wins this ingredient's own attributed
            # provenance over a same-or-worse-class rival (never over a
            # genuinely BETTER evidence class — real quality still wins);
            # once attributed to the seed, a later non-seed formulation can
            # never displace it.
            better_class = existing is None or sf.get("evidence_class", "E") < existing.get("evidence_class", "E")
            should_replace = (
                (is_preferred_sf and not c.is_preferred_architecture)
                or (better_class and not (c.is_preferred_architecture and not is_preferred_sf))
            )
            if should_replace:
                c.scientific_formulation_ref = {
                    "canonical_paper_id": sf.get("canonical_paper_id", ""),
                    "doi": sf.get("doi", ""),
                    "source_title": sf.get("source_title", ""),
                    "source_formulation_id": sf.get("source_formulation_id", ""),
                    "table_reference": sf.get("table_reference", ""),
                    "evidence_class": sf.get("evidence_class", "E"),
                    "source_amount_pct": _formulation_amount_pct(row, total_declared),
                    "source_value_text": row.get("value_text", ""),
                    "source_unit": row.get("unit", ""),
                }
                c.is_preferred_architecture = is_preferred_sf
            mark_excluded_if_needed(c)

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

    # A requested scent character ("rosemary scent") is matched against
    # any REAL candidate already in the pool (from evidence, supplier
    # data, or the deterministic rule library) whose own key contains it
    # — never a fabricated ingredient. Boosting `roles` (not creating a
    # new candidate) means an existing evidence/supplier-backed match
    # becomes selectable for the fragrance role with its own real origin
    # intact; if nothing matches, the pool is left exactly as it was and
    # the solver reports the requirement honestly unresolved.
    if scent_character:
        for c in pool.values():
            if scent_character in c.key and not c.excluded and "fragrance" not in c.roles:
                c.roles.append("fragrance")

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
    # Tier 0 (FormuLab v1 correction, FVL-03): a real amount reported
    # inside a complete scientific formulation architecture — real, whole-
    # formula context Tier 1-3's own isolated evidence mentions do not
    # carry. Only used when a real, source-derived percentage was actually
    # computable (`_formulation_amount_pct`'s own honest total≈100 gate;
    # see that function for why); never a range to "pick within" — the
    # source reported exactly one real value for this exact ingredient in
    # this exact architecture, so that value IS the resolution, still
    # gated by the same `_is_plausible` sanity bound every other tier
    # already uses.
    ref = candidate.scientific_formulation_ref
    if ref and ref.get("source_amount_pct") is not None:
        pct = ref["source_amount_pct"]
        if _is_plausible(role, pct, "%"):
            label = ref.get("source_formulation_id") or "its own source formulation"
            doi = ref.get("doi") or ref.get("source_title") or "the source paper"
            return ConcentrationResolution(
                value=pct, unit="%", basis="formulation", source_type="scientific_evidence",
                note=f"as reported in {label} of {doi} — a complete scientific formulation "
                     f"architecture, not an isolated evidence mention",
            )

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

# FormuLab v1 (FVL-02) — the one authoritative source of truth for the
# requestable formula-alternative count. Every other module (pipeline.py's
# own validation, the frontend's request-count control) reads these
# instead of repeating the numbers 3/7.
MIN_FORMULA_ALTERNATIVES = 3
MAX_FORMULA_ALTERNATIVES = 7
DEFAULT_FORMULA_ALTERNATIVES = 3

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
    if ORIGIN_SCIENTIFIC_FORMULATION in candidate.origins:
        # §8/§25: a complete scientific formulation architecture outranks
        # a bare ingredient-mention (below) — real whole-formula context,
        # never enough to outrank an explicit user requirement above.
        class_weight = {"A": 1.0, "B": 0.6, "C": 0.3, "D": 0.15, "E": 0.05}
        cls = (candidate.scientific_formulation_ref or {}).get("evidence_class", "E")
        score += 700.0 + class_weight.get(cls, 0.0) * 100.0
        if candidate.is_preferred_architecture:
            # FormuLab v1 (FVL-02): this version's own portfolio-assigned
            # architecture seed real deterministic priority over a
            # DIFFERENT scientific formulation's ingredient competing for
            # the same role — bounded well under an explicit user
            # requirement (1000), never a magic/unexplained jump.
            score += 50.0
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


def covered_roles(pool: CandidatePool, roles: List[str]) -> set:
    """Real, non-excluded candidate coverage per role from an already-built
    pool. FormuLab v1 (FVL-02) §6/§7: used by `architecture_portfolio.py`
    to compute a REAL generic-fallback completeness figure (how many
    required roles the current request's actual evidence/supplier/rule
    candidate universe can cover) instead of assuming a flat 1.0 — a
    fallback with no eligible candidate for `active_treatment` must not be
    scored as if it were complete."""
    return {role for role in roles if any(not c.excluded for c in _candidates_for_role(pool, role))}


@dataclass
class SolvedIngredient:
    key: str
    display_name: str
    role: str
    origins: List[str]
    concentration: ConcentrationResolution
    evidence_class: Optional[str]
    best_evidence_record: Optional[EvidenceRecord] = None
    scientific_formulation_ref: Optional[Dict[str, Any]] = None


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
    trace_events: List[Any] = field(default_factory=list)  # traceability.TraceEvent
    architecture_basis: Dict[str, Any] = field(default_factory=dict)
    """FormuLab v1 correction (FVL-03) — real, computed whole-formula
    architecture provenance. See `_classify_architecture()`'s own
    docstring for exactly how `origin`/`retained`/`modified`/`added`/
    `removed` are derived (never a subjective judgement)."""


def _classify_architecture(solved: List[SolvedIngredient], pool: CandidatePool) -> Dict[str, Any]:
    """§11/§25 — a whole-formula-level architecture-source summary, real
    and computed, never a per-ingredient origin badge. The DOMINANT
    scientific formulation is the one the most SELECTED ingredients trace
    back to (`ORIGIN_SCIENTIFIC_FORMULATION`); `retained`/`removed` count
    that dominant source's own ROLE_MAP-resolved ingredients that did/did
    not survive into this version's final selection; `added` counts every
    selected ingredient that did NOT come from it (any other origin —
    evidence, supplier, rule); `modified` mirrors `removed` (a source
    ingredient that had to be functionally replaced still shows up as one
    real removal from the source architecture, whatever filled its role
    instead)."""
    refs = [s.scientific_formulation_ref for s in solved if s.scientific_formulation_ref]
    if not refs:
        excluded_sci = [pool.candidates[k].scientific_formulation_ref
                         for k in pool.excluded_keys
                         if pool.candidates.get(k) and pool.candidates[k].scientific_formulation_ref]
        reason = "No applicable scientific formulation architecture was available for this request."
        if excluded_sci:
            ref = excluded_sci[0]
            reason = (f"A scientific formulation architecture was available "
                      f"({ref.get('source_formulation_id') or 'unlabeled'} of "
                      f"{ref.get('doi') or ref.get('source_title') or 'a retrieved paper'}), "
                      f"but at least one of its own ingredients was hard-excluded and no "
                      f"majority of this version's own selected ingredients trace back to it.")
        return {"origin": ARCHITECTURE_DETERMINISTIC_RULE, "reason": reason,
                "source_paper_doi": "", "source_title": "", "source_formulation_id": "",
                "retained": 0, "modified": 0, "added": 0, "removed": 0}

    counts: Dict[tuple, int] = {}
    for ref in refs:
        key = (ref.get("doi") or "", ref.get("source_title") or "", ref.get("source_formulation_id") or "")
        counts[key] = counts.get(key, 0) + 1
    dominant_doi, dominant_title, dominant_flabel = max(counts, key=lambda k: counts[k])

    dominant_source_keys = {
        c.key for c in pool.candidates.values()
        if c.scientific_formulation_ref
        and (c.scientific_formulation_ref.get("doi") or "") == dominant_doi
        and (c.scientific_formulation_ref.get("source_title") or "") == dominant_title
        and (c.scientific_formulation_ref.get("source_formulation_id") or "") == dominant_flabel
    }
    solved_keys = {s.key for s in solved}
    retained = len(dominant_source_keys & solved_keys)
    removed = len(dominant_source_keys - solved_keys)
    added = len([s for s in solved if s.key not in dominant_source_keys])
    origin = ARCHITECTURE_SCIENTIFIC_DIRECT if removed == 0 else ARCHITECTURE_SCIENTIFIC_ADAPTED
    return {
        "origin": origin, "reason": "",
        "source_paper_doi": dominant_doi, "source_title": dominant_title,
        "source_formulation_id": dominant_flabel,
        "retained": retained, "modified": removed, "added": added, "removed": removed,
    }


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
    avoid_major_role_keys: Optional[Dict[str, set]] = None,
) -> FormulaResult:
    """`avoid_major_role_keys`: `{role: {already-used ingredient keys}}`,
    accumulated by the caller (`pipeline.py`) across the versions already
    built for this session. For a `MAJOR_SYSTEM_ROLES` role, a genuinely
    different, non-excluded, non-worse-ranked-out-of-candidates candidate
    is preferred over reusing an earlier version's own choice — real
    architectural search across strategies, not a fixed best-candidate-
    always solver (Phase 14 Session 6 correction gate). Never forces a
    worse-than-unresolvable substitute: if no alternative exists for a
    role, the same real candidate is reused and the true shortfall shows
    up honestly in `strategy.diversity_report()` instead of being papered
    over here."""
    strategy_type = getattr(strat, "strategy_type", "balanced")
    # Strategies that explicitly trade sensory/process richness for
    # simplicity skip OPTIONAL roles — a real, named difference between
    # versions rather than an arbitrary one (§9 of the brief this module
    # implements).
    skip_optional = strategy_type in ("low_raw_material_count", "simplified_manufacturing")

    solved: List[SolvedIngredient] = []
    missing_roles: List[Dict[str, str]] = []
    used_keys: set = set()
    version_id = getattr(strat, "formula_version_id", "v?")
    traceability.reset_id_counter(version_id)
    trace_events: List[Any] = []

    ordered_roles = sorted(role_requirements.items(), key=lambda kv: {REQUIRED: 0, PREFERRED: 1, OPTIONAL: 2}.get(kv[1], 3))
    for role, level in ordered_roles:
        if level == NOT_APPLICABLE:
            continue
        if level == OPTIONAL and skip_optional:
            continue
        cap = max_candidates_per_role.get(role, 1)
        role_candidates = _candidates_for_role(pool, role)
        candidates = [c for c in role_candidates if c.key not in used_keys]
        if role in MAJOR_SYSTEM_ROLES and avoid_major_role_keys and avoid_major_role_keys.get(role):
            already_used = avoid_major_role_keys[role]
            alternative = [c for c in candidates if c.key not in already_used]
            if alternative:
                candidates = alternative
            # else: no genuinely different candidate exists for this major
            # role — honestly reuse; the resulting lack of diversity is
            # what `strategy.diversity_report()` will correctly flag.
        # Every candidate that could theoretically fill this role but was
        # excluded (a hard rule/user exclusion) is a real, traceable
        # rejection — never silently absent from the trace.
        for excluded_key in pool.excluded_keys:
            ec = pool.candidates.get(excluded_key)
            if ec and role in ec.roles:
                reason = f"excluded: {ec.exclusion_reason}"
                if ec.scientific_formulation_ref:
                    ref = ec.scientific_formulation_ref
                    reason += (f" — removed from the scientific formulation architecture "
                               f"{ref.get('source_formulation_id') or ''} ({ref.get('doi') or ref.get('source_title') or 'source paper'})")
                trace_events.append(traceability.rejected_event(
                    version_id, role, ec.display_name,
                    reason, source_type="deterministic_rule",
                    rule_id="hard_exclusion",
                ))
        picked_any = False
        for rank, c in enumerate(candidates[:cap]):
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
                trace_events.append(traceability.rejected_event(
                    version_id, role, c.display_name,
                    "no evidence, supplier range, or applicable engineering default gives a "
                    "defensible concentration", source_type=(c.origins[0] if c.origins else ""),
                    rule_id="concentration_unresolved",
                ))
                continue
            used_keys.add(c.key)
            picked_any = True
            solved.append(SolvedIngredient(
                key=c.key, display_name=_display_name(c.key, c.display_name), role=role,
                origins=list(c.origins), concentration=resolution,
                evidence_class=c.best_evidence_class(), best_evidence_record=_best_record(c),
                scientific_formulation_ref=c.scientific_formulation_ref,
            ))
            trace_events.append(traceability.selected_event(
                version_id, role, c.display_name, list(c.origins),
                source_ids=([c.supplier_material.get("material_id", "")] if c.supplier_material else []),
                evidence_ids=[r.paper_doi for r in c.evidence_records if r.paper_doi][:5],
                rationale=f"highest-ranked non-excluded candidate for {role} "
                          f"(origins: {', '.join(c.origins)})",
                input_values={"role": role, "level": level},
                output_values={"concentration": resolution.value, "unit": resolution.unit,
                                "source_type": resolution.source_type},
                status=resolution.source_type,
            ))
        # A candidate that filled the role's own candidate list but lost to
        # the cap (e.g. a third co-surfactant when only two are used) is a
        # real, named rejection too — never silently dropped from the trace.
        for c in candidates[cap:]:
            trace_events.append(traceability.rejected_event(
                version_id, role, c.display_name,
                f"role already filled by {cap} higher-ranked candidate(s)",
                source_type=(c.origins[0] if c.origins else ""), rule_id="role_capacity_exceeded",
            ))
        if not picked_any and level == REQUIRED and not any(m["role"] == role for m in missing_roles):
            missing_roles.append({
                "role": role, "level": level,
                "reason": "no non-excluded candidate in the pool fills this required role",
            })
        trace_events.append(traceability.role_coverage_event(
            version_id, role, level, covered=picked_any,
            rationale=(f"filled by {sum(1 for s in solved if s.role == role)} ingredient(s)" if picked_any
                       else f"no candidate available/resolvable for this {level} role"),
        ))

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
    # A generic fragrance ingredient (e.g. the real rules.py FRAGRANCE
    # vocabulary — "perfume"/"parfum") satisfying the fragrance ROLE is
    # not the same as satisfying a SPECIFIC requested scent character
    # ("rosemary scent") — checked by key match, the same real signal
    # `build_candidate_pool` used to boost a genuine match's own roles, so
    # a generic fragrance placeholder is never mistaken for having
    # resolved the actual request.
    scent_satisfied = any(
        s.role == "fragrance" and parsed.scent_character in s.key for s in solved
    ) if parsed.scent_character else True
    if parsed.scent_character and not scent_satisfied:
        note = f"{parsed.scent_character} scent requirement unresolved"
        unresolved_requirements.append(note)
        warnings.append(
            f"{note} — no matching fragrance material was found in evidence, supplier data, "
            f"or the FormuLab fragrance rule library; no ingredient was invented to satisfy it."
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
        trace_events=trace_events, architecture_basis=_classify_architecture(solved, pool),
    )
