"""Phase 14 Session 6 — deterministic Regulatory intelligence. Zero LLM.

**Real data, not invented from memory.** The seed rule table below is a
direct, faithful port of this repository's own PRE-EXISTING regulatory
rule catalog, `packages/shared/src/catalog/regulatoryRules.ts` (built for
an earlier phase's lab/formulation-approval workflow) — the exact same
jurisdictions, authorities, rule types, and requirement text, not a
Python-side reinvention. That TypeScript catalog is itself explicit that
every entry is a real but UNVERIFIED placeholder
(`verificationStatus: "not_verified"`, `status: "draft"`,
`humanReviewStatus: "review_required"`) requiring a qualified regulatory
reviewer's confirmation before any real compliance decision — this
module carries that same honesty forward rather than upgrading the data's
own claimed reliability. See `docs/REGULATORY_RULES.md` (that catalog's
own documentation) for the full context.

**Jurisdiction coverage is explicit and honest.** `MARKET_COVERAGE` names
exactly which jurisdictions this module has ANY real rule data for
(`"partial"` — real but unverified/draft data) versus everywhere else
(`"unsupported"` — no data at all). `evaluate_regulatory()` NEVER returns
`COMPLIANT` for an unsupported market, and never infers compliance merely
from the absence of a matched violation — an unsupported/partial market
with no matching restriction is `DATA_INCOMPLETE`, not `COMPLIANT`
(§13/§18 of the brief this module implements).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

from evidence import normalize_ingredient_key

SCHEMA_VERSION = 1

COMPLIANT = "COMPLIANT"
COMPLIANT_WITH_CONDITIONS = "COMPLIANT_WITH_CONDITIONS"
NON_COMPLIANT = "NON_COMPLIANT"
DATA_INCOMPLETE = "DATA_INCOMPLETE"

_STATUS_PRECEDENCE = {NON_COMPLIANT: 3, DATA_INCOMPLETE: 2, COMPLIANT_WITH_CONDITIONS: 1, COMPLIANT: 0}


# ---------------------------------------------------------- market scope --

# Coverage is honest and narrow: exactly the jurisdictions
# `regulatoryRules.ts` already seeded, real (though unverified/draft) data
# for. Every other jurisdiction — including markets `region_profiles.py`
# has a formulation-profile for, like "eu"/"us"/"turkey" — is
# "unsupported" here: those profiles carry descriptive notes about a
# regulator's NAME, never structured, checkable rules, and using them as
# if they were coverage would be exactly the fabrication this module
# exists to prevent.
MARKET_COVERAGE: Dict[str, str] = {
    "KE": "partial", "UG": "partial", "TZ": "partial", "RW": "partial",
    "BI": "partial", "SS": "partial", "EAC": "partial",
}

_MARKET_ALIASES: Dict[str, str] = {
    "kenya": "KE", "ke": "KE",
    "uganda": "UG", "ug": "UG",
    "tanzania": "TZ", "tz": "TZ",
    "rwanda": "RW", "rw": "RW",
    "burundi": "BI", "bi": "BI",
    "south sudan": "SS", "southsudan": "SS", "ss": "SS",
    "eac": "EAC", "east africa": "EAC", "east african community": "EAC",
}


def resolve_market(market: str) -> str:
    """The real jurisdiction code for a request's own `market` text, or
    `""` when it doesn't match any known alias — never guessed."""
    key = (market or "").strip().lower()
    return _MARKET_ALIASES.get(key, "")


def market_coverage(market: str) -> str:
    code = resolve_market(market)
    if not code:
        return "unsupported"
    return MARKET_COVERAGE.get(code, "unsupported")


# ------------------------------------------------------------- rule model -

@dataclass(frozen=True)
class RegulatoryRule:
    rule_id: str
    jurisdiction: str
    authority: str
    rule_type: str
    product_categories: List[str]
    requirement: str
    ingredient_keys: List[str] = field(default_factory=list)
    claim_keywords_any: List[str] = field(default_factory=list)
    max_concentration_pct: Optional[float] = None
    required_label_elements: List[str] = field(default_factory=list)
    required_warnings: List[str] = field(default_factory=list)
    verification_status: str = "not_verified"


# A direct, faithful port of `regulatoryRules.ts`'s own real seed data —
# same codes, same authorities, same requirement text (trimmed of the
# TS-side placeholder wrapper sentence, kept here as `verification_status`
# instead so it isn't repeated on every single requirement string).
# `ingredient_keys` is populated only where this Python pipeline's own
# evidence/rule vocabulary (`engine.ROLE_MAP`) has a matching real
# ingredient — a TS-side condition this vocabulary has no counterpart for
# (e.g. a chlorine-releasing disinfectant active) is ported for
# completeness but will structurally never match a personal-care formula,
# which is the honest, correct outcome, not a bug.
SEED_REGULATORY_RULES: List[RegulatoryRule] = [
    RegulatoryRule("KE-REG-003", "KE", "Kenya Bureau of Standards (KEBS)", "label_requirement", [],
                    "Consumer household/cleaning products may require specific label elements "
                    "(net content, batch code, manufacturer, country of origin).",
                    required_label_elements=["net_content", "batch_code", "manufacturer_name", "country_of_origin"]),
    RegulatoryRule("KE-REG-004", "KE", "Kenya Bureau of Standards (KEBS)", "claim_evidence_requirement",
                    ["disinfectant", "biocidal_product", "personal_care_cleanser"],
                    "Antimicrobial/antibacterial efficacy claims may require supporting laboratory "
                    "evidence on file.",
                    claim_keywords_any=["antibacterial", "antimicrobial", "kills germs", "disinfects"]),
    RegulatoryRule("KE-REG-005", "KE", "Pharmacy and Poisons Board", "ingredient_restriction",
                    ["oral_care_product", "toothpaste"],
                    "Fluoride actives in oral-care products may be subject to a maximum concentration "
                    "and a required warning statement for children.",
                    ingredient_keys=[normalize_ingredient_key("Sodium Fluoride")],
                    required_warnings=["do_not_swallow_children_under_6"]),
    RegulatoryRule("UG-REG-002", "UG", "Uganda National Bureau of Standards (UNBS)", "language_requirement", [],
                    "Product labels may be required in English, and locally in additional languages "
                    "depending on distribution channel."),
    RegulatoryRule("TZ-REG-002", "TZ", "Tanzania Food and Drugs Authority (TFDA/TMDA)",
                    "responsible_party_requirement",
                    ["cosmetic", "personal_care_cleanser", "hair_care_product", "medical_or_health_related_product"],
                    "Cosmetic/personal-care/medical products may require a named in-market responsible "
                    "party on the label."),
    RegulatoryRule("RW-REG-001", "RW", "Rwanda Standards Board (RSB)", "notification_requirement",
                    ["household_cleaning_product", "laundry_detergent", "dishwashing_product"],
                    "Household cleaning products may require a notification filing before first sale, "
                    "distinct from full registration."),
    RegulatoryRule("EAC-REG-001", "EAC", "East African Community Secretariat", "market_specific_identifier", [],
                    "Products traded across EAC member states may require an EAC-wide conformity mark "
                    "in addition to any national mark."),
]


# ------------------------------------------------------------- findings ---

@dataclass(frozen=True)
class RegulatoryFinding:
    subject_type: str
    """`"ingredient"` | `"formula"` | `"claim"` | `"label"`."""
    subject: str
    status: str
    rule_id: str
    jurisdiction: str
    condition: str
    actual_value: str
    rationale: str
    required_action: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _finding(subject_type, subject, status, rule_id, jurisdiction, condition, actual_value, rationale, required_action) -> RegulatoryFinding:
    return RegulatoryFinding(subject_type=subject_type, subject=subject, status=status, rule_id=rule_id,
                              jurisdiction=jurisdiction, condition=condition, actual_value=actual_value,
                              rationale=rationale, required_action=required_action)


def evaluate_rule(rule: RegulatoryRule, formula: Dict[str, Any], brief: Dict[str, Any]) -> List[RegulatoryFinding]:
    """Evaluate ONE rule against a formula — the real matching logic,
    exposed directly (not only through the full `evaluate_regulatory()`
    pipeline) so it can be tested against a synthetic rule without
    depending on `SEED_REGULATORY_RULES`'s own current real content."""
    ingredients = formula.get("ingredients") or []
    out: List[RegulatoryFinding] = []

    if rule.rule_type == "ingredient_prohibition" and rule.ingredient_keys:
        for ing in ingredients:
            key = normalize_ingredient_key(ing.get("inci", ""))
            if key in rule.ingredient_keys:
                out.append(_finding(
                    "ingredient", ing.get("inci", ""), NON_COMPLIANT, rule.rule_id, rule.jurisdiction,
                    rule.requirement, ing.get("weight_pct", ""),
                    f"{rule.authority}: {rule.requirement} (draft/not-yet-verified rule).",
                    "Remove or replace this ingredient before release in this market.",
                ))

    elif rule.rule_type == "ingredient_restriction" and rule.ingredient_keys:
        for ing in ingredients:
            key = normalize_ingredient_key(ing.get("inci", ""))
            if key not in rule.ingredient_keys:
                continue
            if rule.max_concentration_pct is not None:
                raw = str(ing.get("weight_pct", "")).strip()
                try:
                    pct = float(raw)
                except ValueError:
                    pct = None
                if pct is not None and pct > rule.max_concentration_pct:
                    out.append(_finding(
                        "ingredient", ing.get("inci", ""), NON_COMPLIANT, rule.rule_id, rule.jurisdiction,
                        f"max {rule.max_concentration_pct}%", raw,
                        f"{rule.authority}: {rule.requirement} (draft/not-yet-verified rule) — "
                        f"selected concentration exceeds the stated maximum.",
                        "Reduce concentration to at or below the stated maximum, or confirm the "
                        "limit with a qualified regulatory reviewer.",
                    ))
                    continue
            out.append(_finding(
                "ingredient", ing.get("inci", ""), COMPLIANT_WITH_CONDITIONS, rule.rule_id, rule.jurisdiction,
                rule.requirement, ing.get("weight_pct", ""),
                f"{rule.authority}: {rule.requirement} (draft/not-yet-verified rule).",
                "Confirm the concentration/warning requirement with a qualified regulatory "
                "reviewer before this market's release.",
            ))

    elif rule.rule_type == "claim_evidence_requirement":
        claims_text = (str(brief.get("claims", "")) + " " + str(brief.get("target", ""))).lower()
        if any(k in claims_text for k in rule.claim_keywords_any):
            out.append(_finding(
                "claim", ", ".join(rule.claim_keywords_any), COMPLIANT_WITH_CONDITIONS,
                rule.rule_id, rule.jurisdiction, rule.requirement, claims_text.strip(),
                f"{rule.authority}: {rule.requirement} (draft/not-yet-verified rule).",
                "Obtain and file supporting antimicrobial-efficacy evidence before making this "
                "claim in this market.",
            ))

    elif rule.rule_type == "label_requirement" and rule.required_label_elements:
        out.append(_finding(
            "label", "required label elements", COMPLIANT_WITH_CONDITIONS, rule.rule_id,
            rule.jurisdiction, rule.requirement, ", ".join(rule.required_label_elements),
            f"{rule.authority}: {rule.requirement} (draft/not-yet-verified rule).",
            "Ensure the final label carries these elements before this market's release.",
        ))

    return out


# ------------------------------------------------------------ claim review -

# §16's own three-way distinction, made real and testable.
FORMULATION_CONDITION_CLAIMS: Dict[str, List[str]] = {
    "sulfate_free": [],  # checked structurally against ingredient origins/roles, not a keyword list
    "silicone_free": [],
    "fragrance_free": [],
}
# Claims no formulation-composition check can ever satisfy — always
# require real, separate substantiation (clinical/lab testing), regardless
# of what the formula itself contains.
SUBSTANTIATION_REQUIRED_CLAIMS = (
    "dermatologically tested", "clinically tested", "hypoallergenic", "dermatologically approved",
)
# Claims a partial-coverage jurisdiction's own seed rules can speak to.
REGULATORY_ELIGIBILITY_CLAIM_SIGNALS = ("antibacterial", "antimicrobial", "disinfects")


@dataclass(frozen=True)
class ClaimFinding:
    claim: str
    check_type: str
    """`"formulation_condition"` | `"regulatory_eligibility"` | `"substantiation_required"`."""
    status: str
    rationale: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _formulation_condition_satisfied(claim_text: str, ingredients: List[Dict[str, Any]], ingredient_origins: Dict[str, List[str]]) -> Optional[bool]:
    from rules import SULFATES, FRAGRANCE
    names = {normalize_ingredient_key(i.get("inci", "")) for i in ingredients}
    if "sulfate" in claim_text:
        return not any(normalize_ingredient_key(s) in names for s in SULFATES)
    if "silicone" in claim_text:
        silicone_keys = {normalize_ingredient_key("Dimethicone"), normalize_ingredient_key("Cyclopentasiloxane")}
        return not (names & silicone_keys)
    if "fragrance" in claim_text or "parfum" in claim_text:
        return not any(normalize_ingredient_key(fr) in names for fr in FRAGRANCE)
    return None


def review_claims(brief: Dict[str, Any], formula: Dict[str, Any], ingredient_origins: Dict[str, List[str]], coverage: str) -> List[ClaimFinding]:
    claims_text = str(brief.get("claims", "")).lower()
    target_text = str(brief.get("target", "")).lower()
    hay = f"{claims_text} {target_text}"
    ingredients = formula.get("ingredients") or []
    findings: List[ClaimFinding] = []
    seen: set = set()

    for phrase in ("sulfate-free", "sulfate free", "silicone-free", "silicone free", "fragrance-free", "fragrance free"):
        if phrase in hay and phrase not in seen:
            seen.add(phrase)
            satisfied = _formulation_condition_satisfied(phrase, ingredients, ingredient_origins)
            status = (COMPLIANT if satisfied else NON_COMPLIANT) if satisfied is not None else DATA_INCOMPLETE
            findings.append(ClaimFinding(
                claim=phrase, check_type="formulation_condition", status=status,
                rationale=(f"Checked directly against this formula's own resolved ingredients: "
                           f"{'no' if satisfied else 'a'} matching excluded-class ingredient is present."
                           if satisfied is not None else "Could not be checked deterministically."),
            ))

    for phrase in SUBSTANTIATION_REQUIRED_CLAIMS:
        if phrase in hay and phrase not in seen:
            seen.add(phrase)
            findings.append(ClaimFinding(
                claim=phrase, check_type="substantiation_required", status=DATA_INCOMPLETE,
                rationale="This claim can never be considered satisfied by formulation composition "
                          "alone — it requires real, separate clinical/laboratory substantiation on "
                          "file, which this pipeline does not generate or verify.",
            ))

    for phrase in REGULATORY_ELIGIBILITY_CLAIM_SIGNALS:
        if phrase in hay and phrase not in seen:
            seen.add(phrase)
            if coverage == "partial":
                findings.append(ClaimFinding(
                    claim=phrase, check_type="regulatory_eligibility", status=COMPLIANT_WITH_CONDITIONS,
                    rationale=f"A real (draft/not-yet-verified) rule for this market requires "
                              f"supporting evidence on file for this claim type — see the matched "
                              f"regulatory finding for the exact rule.",
                ))
            else:
                findings.append(ClaimFinding(
                    claim=phrase, check_type="regulatory_eligibility", status=DATA_INCOMPLETE,
                    rationale="No regulatory rule data exists for the requested market to evaluate "
                              "this claim's eligibility.",
                ))

    return findings


# --------------------------------------------------------------- top-level -

@dataclass(frozen=True)
class RegulatoryResult:
    target_market: str
    jurisdiction: str
    coverage: str
    """`"partial"` | `"unsupported"`."""
    overall_status: str
    findings: List[Dict[str, Any]]
    claims: List[Dict[str, Any]]
    missing_coverage_note: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def evaluate_regulatory(
    formula: Dict[str, Any],
    brief: Dict[str, Any],
    ingredient_origins: Dict[str, List[str]],
) -> RegulatoryResult:
    market = str(brief.get("market", "")).strip()
    jurisdiction = resolve_market(market)
    coverage = market_coverage(market)
    ingredients = formula.get("ingredients") or []

    findings: List[RegulatoryFinding] = []

    if coverage == "unsupported":
        note = (f"No regulatory rule data exists for {market or 'an unspecified market'} in this "
                f"installation. This is an honest data gap, not a compliance determination.")
        overall = DATA_INCOMPLETE
    else:
        note = (f"FormuLab has real but draft/not-yet-verified regulatory rule data for "
                f"{jurisdiction} — a qualified regulatory reviewer must confirm any finding below "
                f"before it is relied on for a real compliance decision.")
        rules = [r for r in SEED_REGULATORY_RULES if r.jurisdiction == jurisdiction]
        for rule in rules:
            findings.extend(evaluate_rule(rule, formula, brief))

        # Coverage itself, even with zero matched findings, is always
        # surfaced — never silently implying a clean COMPLIANT from
        # nothing having matched (§13's own explicit instruction). Never
        # `COMPLIANT` outright even when findings exist and none are
        # adverse — this installation's own rule data is itself draft/
        # unverified, so the best a partial-coverage market can achieve is
        # `COMPLIANT_WITH_CONDITIONS`, promoted to `NON_COMPLIANT` only by
        # a real matched violation.
        if findings:
            overall = COMPLIANT_WITH_CONDITIONS
            for f in findings:
                if _STATUS_PRECEDENCE[f.status] > _STATUS_PRECEDENCE[overall]:
                    overall = f.status
        else:
            overall = DATA_INCOMPLETE
        if not findings:
            note += (" No specific rule in this installation's own (partial, draft) rule set matched "
                      "this formula/request — that does NOT mean this market has no real "
                      "requirements, only that this installation has no data for them yet.")

    claims = review_claims(brief, formula, ingredient_origins, coverage)
    for c in claims:
        if _STATUS_PRECEDENCE.get(c.status, 0) > _STATUS_PRECEDENCE.get(overall, 0):
            overall = c.status

    return RegulatoryResult(
        target_market=market, jurisdiction=jurisdiction or "", coverage=coverage,
        overall_status=overall, findings=[f.to_dict() for f in findings],
        claims=[c.to_dict() for c in claims], missing_coverage_note=note,
    )
