"""Phase 14 Session 2 — structured evidence extraction, A-E classification,
ranking, and formula-synthesis integration.

Session 1 gave the pipeline deduplicated `CanonicalPaper`-equivalent flat
rows with real cross-source provenance (`literature_cache.gather()`). Paper
discovery alone is not evidence: a paper must support a SPECIFIC formulation
decision through content this module actually extracted from it, not merely
from having been found.

**Deterministic and rule-based, not a second LLM call.** "Build a
deterministic/traceable evidence layer" is Session 2's own brief — a
model-based extractor would be neither deterministic nor free of its own
fabrication risk (the exact failure mode this whole phase exists to avoid).
Every field below is either read verbatim from the source text (a regex
match, a section title) or left `None`/unknown — never inferred, never
guessed, never a plausible-looking default.

**Known-ingredient vocabulary is real but intentionally not exhaustive.**
Extraction only recognizes ingredients from `KNOWN_INGREDIENTS` below
(seeded from `rules.py`'s own SULFATES/HARSH_PRESERVATIVES/
MILD_SURFACTANTS/CHELATORS/FRAGRANCE groups plus a modest list of common
cosmetic/detergent actives and functional ingredients). This is a real,
disclosed gap — growing this list is future work, not a limitation hidden
behind confident-looking output. A mention of an ingredient this module
doesn't recognize produces no evidence record for it, which is the honest
outcome (silence), never a wrong or invented one.

**Concentration statistics (observed range/median/confidence) are
deliberately NOT computed here.** Session 2's own brief: only after strict
comparability grouping exists (same ingredient, same basis, same product
context) does aggregating multiple records into one statistic become safe —
that comparability-grouping work is not built this session. Individual
`ConcentrationValue` records are preserved with their own basis/unit
untouched; aggregating them is later work.
"""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

import fulltext

EXTRACTION_SCHEMA_VERSION = 1


# ------------------------------------------------------------- vocabulary ---

# Reused, not reinvented — the exact groups `rules.py`'s deterministic engine
# already treats as real, named ingredients.
from rules import CHELATORS, FRAGRANCE, HARSH_PRESERVATIVES, MILD_SURFACTANTS, SULFATES  # noqa: E402

_ANTIDANDRUFF_ACTIVES = [
    "piroctone olamine", "climbazole", "zinc pyrithione", "ketoconazole",
    "salicylic acid", "selenium disulfide", "coal tar",
]
_COMMON_FUNCTIONAL = [
    "glycerin", "glycerol", "panthenol", "xanthan gum", "sodium chloride",
    "citric acid", "phenoxyethanol", "sodium benzoate", "potassium sorbate",
    "cetyl alcohol", "stearyl alcohol", "dimethicone", "cyclopentasiloxane",
    "hydroxypropyl methylcellulose", "carbomer", "polyquaternium-10",
    "sodium hydroxide", "lauryl glucoside", "coco-glucoside",
]

# canonical_key -> sorted-longest-first surface forms recognized in text.
# Longest-first matters: "sodium laureth sulfate" must not be shadowed by a
# shorter, chemically-different partial match like "sulfate" alone.
KNOWN_INGREDIENTS: Dict[str, List[str]] = {}
for _group in (SULFATES, HARSH_PRESERVATIVES, MILD_SURFACTANTS, CHELATORS,
               FRAGRANCE, _ANTIDANDRUFF_ACTIVES, _COMMON_FUNCTIONAL):
    for _name in _group:
        _key = re.sub(r"[^a-z0-9]+", "-", _name.lower()).strip("-")
        KNOWN_INGREDIENTS.setdefault(_key, [])
        if _name.lower() not in KNOWN_INGREDIENTS[_key]:
            KNOWN_INGREDIENTS[_key].append(_name.lower())

_REVIEW_KEYWORDS = ("systematic review", "review of", "literature review",
                     ": a review", "overview of")

_OUTCOME_KEYWORDS = (
    "viscosity", "stability", "stable", "foam", "foaming", "cleansing",
    "conditioning", "irritation", "irritant", "mild", "mildness",
    "antimicrobial", "antifungal", "antibacterial", "particle size",
    "emulsion", "sensory", "efficacy", "efficacious", "reduced", "improved",
    "significant", "compared to", "versus",
)

_FORMULATION_SHAPE_TERMS = ("wt%", "w/w", "w/v", "formulation", "composition",
                             "prepared by", "formulated with")

# --------------------------------------------------------------- models ---


class EvidenceClass(str, Enum):
    """Architecture doc §5's five-tier hierarchy. Content-based, never
    provider-based — the source that FOUND a paper never affects its class."""

    A = "A"  # Direct Formulation Evidence
    B = "B"  # Experimental Ingredient Evidence
    C = "C"  # Review / Secondary Evidence
    D = "D"  # Related-Domain Evidence
    E = "E"  # Weak / Indirect Evidence


@dataclass(frozen=True)
class ConcentrationValue:
    """Only ever populated from an explicit number in the source text — never
    a fabricated or inferred value. `value_max` is set only for an explicit
    reported range ("1-3%"); a single reported value leaves it `None`."""

    value: float
    value_max: Optional[float]
    unit: str
    """As reported in the source text — '%', 'wt%', 'w/w', 'ppm', 'mg/mL',
    etc. Never normalized/converted here (Session 2 doesn't implement
    cross-basis comparability — see module docstring)."""
    basis: str
    """'formulation' (this % of the total formula) or 'ingredient_active'
    (this % is the active-matter content of the ingredient itself) when the
    text makes the distinction explicit; '' (unknown) otherwise — never
    guessed."""


@dataclass(frozen=True)
class ProcessObservation:
    """Every field is `None`/empty unless the source text explicitly reports
    it. A paper with no process detail produces an all-empty
    `ProcessObservation`, not a fabricated typical value."""

    temperature_c: Optional[float] = None
    ph: Optional[float] = None
    mixing_method: str = ""
    time_minutes: Optional[float] = None
    equipment: str = ""
    note: str = ""
    """A short verbatim fragment of the process-relevant sentence, when one
    of the fields above was actually found — traceability for a person to
    verify the extraction against the source."""

    def is_empty(self) -> bool:
        return not any([self.temperature_c, self.ph, self.mixing_method,
                         self.time_minutes, self.equipment, self.note])


@dataclass
class EvidenceRecord:
    """One structured finding, traceable to exactly one `CanonicalPaper`
    (Session 1's dedup — never one row per contributing source) and, when
    recognized, one ingredient. A single paper genuinely reporting multiple
    distinct findings (e.g. two different actives) produces multiple
    `EvidenceRecord`s — still ONE study for evidence-counting purposes
    (`study_count()` below), never inflated by record count either."""

    schema_version: int
    # --- paper identity / traceability (architecture doc §12) ---
    paper_doi: str
    paper_title: str
    paper_year: str
    paper_authors: str
    paper_venue: str
    unique_source_count: int
    """Session 1's `CanonicalPaper.unique_source_count` — how many distinct
    PROVIDERS found this paper. Confidence signal only, never multiplies
    evidence weight (architecture doc §5, enforced again in `rank_evidence`
    below by simply never reading this field for scoring)."""
    provenance_sources: List[str]
    # --- what this record is about ---
    ingredient_key: str
    ingredient_raw: str
    """The exact surface form found in the source text — preserved verbatim,
    never normalized away (architecture doc §5 wiring brief §5: "Preserve
    original reported ingredient text from the source")."""
    is_full_formulation: bool
    """Whether the SOURCE PAPER (not just this record) reports a complete
    formulation composition, vs. an isolated ingredient study."""
    product_context: str
    concentration: Optional[ConcentrationValue]
    function: str
    outcome: str
    process: ProcessObservation
    evidence_text: str
    """The verbatim sentence/snippet this record was extracted from —
    required whenever a record exists at all; never omitted."""
    source_location: str
    """'abstract' or 'full_text:<section title>' — where in the paper this
    came from."""
    source_depth: str
    """'full_text' | 'abstract_only' | 'metadata_only' — architecture doc
    §4's own three-tier depth."""
    evidence_class: EvidenceClass
    confidence: Optional[float]
    """A simple, explainable 0-1 signal derived from `source_depth` +
    whether a concentration/outcome was actually found — `None` when even
    that can't be judged (e.g. a metadata-only record). Never a black-box
    number; see `_confidence_for` for the exact, inspectable rule."""
    formula_version_id: Optional[str] = None
    """Always `None` at extraction time — Session 2 has no version-specific
    decision engine yet (architecture doc §13's own explicit scope note).
    The field exists now so a later session can attach evidence to a real
    `formulaVersionId + ingredientId + concentration` triple without a
    storage-schema migration."""
    extracted_at: str = ""

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["evidence_class"] = self.evidence_class.value
        return d


# ------------------------------------------------------- ingredient scan ---

def normalize_ingredient_key(raw: str) -> str:
    """A conservative, deterministic key — used only to compare a mention
    against `KNOWN_INGREDIENTS`' own keys, never a fuzzy merge. Two
    chemically distinct sulfates (e.g. "sodium lauryl sulfate" and "sodium
    laureth sulfate") normalize to two DIFFERENT keys, on purpose."""
    return re.sub(r"[^a-z0-9]+", "-", (raw or "").lower()).strip("-")


def detect_ingredient_mentions(text: str) -> List[tuple]:
    """`[(ingredient_key, raw_surface_form, start, end), ...]`, longest
    surface form first so a longer, more specific name is never shadowed by
    a shorter substring of itself (word-boundary matched, so "sls" doesn't
    match inside an unrelated word)."""
    if not text:
        return []
    hay = text.lower()
    surface_to_key = []
    for key, forms in KNOWN_INGREDIENTS.items():
        for form in forms:
            surface_to_key.append((form, key))
    # Longest surface form first: a specific multi-word name takes priority
    # over a shorter one that happens to be a substring of it.
    surface_to_key.sort(key=lambda p: -len(p[0]))

    found: List[tuple] = []
    claimed = [False] * len(hay)
    for form, key in surface_to_key:
        pattern = re.compile(r"\b" + re.escape(form) + r"\b")
        for m in pattern.finditer(hay):
            if any(claimed[m.start():m.end()]):
                continue  # already covered by a longer mention here
            found.append((key, text[m.start():m.end()], m.start(), m.end()))
            for i in range(m.start(), m.end()):
                claimed[i] = True
    found.sort(key=lambda t: t[2])
    return found


# ------------------------------------------------------------ extraction ---

_CONC_PATTERN = re.compile(
    r"(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)\s*(%|wt%|w/w|w/v|ppm|mg/m[lL])"
    r"|(\d+(?:\.\d+)?)\s*(%|wt%|w/w|w/v|ppm|mg/m[lL])",
    re.I,
)
_TEMP_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*°?\s*C\b")
_PH_PATTERN = re.compile(r"\bpH\s*(?:of\s*)?(\d+(?:\.\d+)?)\b", re.I)
_TIME_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*(min|minutes|hours|h)\b", re.I)
_MIXING_TERMS = ("homogeniz", "homogenis", "stirred", "stirring", "agitat",
                  "rotor-stator", "rpm", "high shear", "high-shear", "mixed at")

_WINDOW = 150  # characters of context around an ingredient mention (outcome sentence search)
_PROCESS_WINDOW = 300  # wider — process conditions are usually reported once for the whole formulation, not per-ingredient


_SENTENCE_BOUNDARY = re.compile(r"(?<!\d)\.(?!\d)")
"""A period that ends a sentence — NOT a decimal point ("1.0%" must stay
one token). Naive period-splitting cut "Piroctone Olamine at 1.0%" sentences
in half at the decimal point, silently losing the outcome text that followed
it — this is why that specific bug mattered enough to fix explicitly rather
than approximate."""


def _sentence_around(text: str, pos: int) -> str:
    start = None
    for m in _SENTENCE_BOUNDARY.finditer(text, 0, pos):
        start = m.end()
    end_m = _SENTENCE_BOUNDARY.search(text, pos)
    start = 0 if start is None else start
    end = len(text) if end_m is None else end_m.end()
    return text[start:end].strip()


_CONC_WINDOW = 40  # tight — "at 5.0%" adjacency, not a whole-paragraph scan


def _value_from_match(m: "re.Match") -> ConcentrationValue:
    if m.group(1) and m.group(2):  # a range
        return ConcentrationValue(value=float(m.group(1)), value_max=float(m.group(2)),
                                   unit=m.group(3), basis="")
    return ConcentrationValue(value=float(m.group(4)), value_max=None,
                               unit=m.group(5), basis="")


def extract_concentration_near(
    text: str, start: int, end: int, other_spans: Optional[List[tuple]] = None,
) -> Optional[ConcentrationValue]:
    """The concentration number belonging to THIS specific ingredient
    mention (its `[start, end)` span) — never merely the nearest number by
    raw character distance, which gets the common academic phrasing "X at
    5.0%, Y at 8.0%, Z at 1.0%" systematically wrong (a symmetric-distance
    search attaches each ingredient's OWN reported number to its neighbor
    instead, once mid-name character counts are folded in) — a real bug
    found and fixed by testing this exact sentence shape during this
    session, not a hypothetical.

    The rule that actually matches how these sentences are written: prefer
    a number immediately AFTER this mention (the dominant "ingredient at
    X%" phrasing), only accepting it if no OTHER ingredient mention starts
    between this one's end and that number — i.e. the number is still
    "inside" this ingredient's own clause, not already inside the next
    one's. Falls back to a number immediately BEFORE this mention ("X%
    ingredient" phrasing) under the same no-intervening-mention rule. A
    wrongly-attributed number is worse than a missing one (this module's own
    conservative-merge bias, reused here for concentration attribution
    instead of paper deduplication), so this function returns `None` rather
    than guess when neither direction is safely attributable.
    """
    others = other_spans or []

    # Prefer AFTER (the dominant phrasing): search the tight window right
    # after this mention, reject if any other mention's START falls before
    # the candidate number — that number belongs to the closer, later
    # ingredient instead.
    after_hi = min(len(text), end + _CONC_WINDOW)
    after_window = text[end:after_hi]
    for m in _CONC_PATTERN.finditer(after_window):
        abs_start = end + m.start()
        if any(o_start > end and o_start < abs_start for o_start, _ in others):
            continue
        return _value_from_match(m)

    # Fall back to BEFORE: reject if another mention's END falls after the
    # candidate number's start (that number is closer to, and more likely
    # describing, the mention right before this one's own window opens) —
    # OR if the candidate sits inside another mention's own AFTER-adjacency
    # zone (already "claimed" going forward from that mention, even with no
    # intervening mention in between — the exact case a trailing ", along
    # with Y" clause after "X at 1.0%," produced: Y must not also claim X's
    # own number just because nothing sits between them).
    before_lo = max(0, start - _CONC_WINDOW)
    before_window = text[before_lo:start]
    best = None
    for m in _CONC_PATTERN.finditer(before_window):
        abs_start = before_lo + m.start()
        if any(o_end < start and o_end > abs_start for _, o_end in others):
            continue
        if any(o_end <= abs_start <= o_end + _CONC_WINDOW for _, o_end in others):
            continue
        best = m  # keep the LAST (closest-to-start) match in this window
    if best is not None:
        return _value_from_match(best)
    return None


def extract_outcome_near(text: str, pos: int) -> str:
    sentence = _sentence_around(text, pos)
    low = sentence.lower()
    if any(k in low for k in _OUTCOME_KEYWORDS):
        return sentence
    return ""


def extract_process_observations(text: str) -> ProcessObservation:
    temp = None
    m = _TEMP_PATTERN.search(text)
    note_parts = []
    if m:
        temp = float(m.group(1))
        note_parts.append(_sentence_around(text, m.start()))
    ph = None
    m = _PH_PATTERN.search(text)
    if m:
        ph = float(m.group(1))
        note_parts.append(_sentence_around(text, m.start()))
    mixing = ""
    for term in _MIXING_TERMS:
        idx = text.lower().find(term)
        if idx != -1:
            mixing = term
            note_parts.append(_sentence_around(text, idx))
            break
    minutes = None
    m = _TIME_PATTERN.search(text)
    if m:
        val = float(m.group(1))
        minutes = val * 60 if m.group(2).lower().startswith("h") else val
    note = " / ".join(dict.fromkeys(note_parts))[:400]  # dedup, preserve order
    return ProcessObservation(temperature_c=temp, ph=ph, mixing_method=mixing,
                               time_minutes=minutes, equipment="", note=note)


def is_full_formulation_paper(text: str) -> bool:
    """A paper describing a COMPLETE formulation, not an isolated ingredient
    study: at least 3 distinct recognized ingredients mentioned AND at least
    one formulation-shape term (e.g. "wt%", "formulation")."""
    mentions = detect_ingredient_mentions(text)
    distinct = {key for key, _, _, _ in mentions}
    low = text.lower()
    has_shape = any(t in low for t in _FORMULATION_SHAPE_TERMS)
    return len(distinct) >= 3 and has_shape


def is_review_paper(title: str, text: str) -> bool:
    low = f"{title} {text}".lower()
    return any(k in low for k in _REVIEW_KEYWORDS)


# --------------------------------------------------------- classification ---

def classify_evidence(
    *, source_depth: str, is_full_formulation: bool, is_review: bool,
    has_concentration: bool, has_outcome: bool, domain_match: bool,
) -> EvidenceClass:
    """Content-based only — never reads which provider(s) found the paper.
    Architecture doc §3's own worked examples, made into a deterministic
    decision tree:

    - A paper never becomes Class A merely for containing an ingredient
      name — Class A requires a genuine complete-formulation paper with an
      actual measured concentration AND a reported outcome, read from real
      full text (an abstract cannot carry enough detail to earn A).
    - Class E is the honest floor: metadata-only, or any record where the
      paper's own domain doesn't match the request's product context.
    """
    if is_review:
        return EvidenceClass.C
    if source_depth == "metadata_only":
        return EvidenceClass.E
    if not domain_match:
        return EvidenceClass.D
    if source_depth == "full_text" and is_full_formulation and has_concentration and has_outcome:
        return EvidenceClass.A
    if has_concentration or has_outcome:
        return EvidenceClass.B
    return EvidenceClass.E


# Explicit signals of a DIFFERENT product domain/application — architecture
# doc §3's own D examples ("scientifically relevant but different
# application/product/domain"). Deliberately narrow and explicit rather than
# a broad keyword-overlap check against the request's own wording: a real
# ingredient-safety/efficacy study (e.g. an antifungal study against
# Malassezia, the organism actually implicated in dandruff) must not be
# demoted to D just because it never happens to use the word "shampoo" — a
# keyword-overlap version of this check was tried during this session and
# produced exactly that false demotion; this explicit list is the fix.
_OTHER_DOMAIN_TERMS = (
    "paint", "coating", "industrial", "textile", "concrete", "automotive",
    "agricultural", "pesticide", "food packaging", "construction material",
    "lubricant", "metalworking", "oilfield", "wood preservative",
)
_PERSONAL_CARE_SIGNAL = (
    "skin", "scalp", "hair", "shampoo", "cosmetic", "dermal", "dermat",
    "topical", "cleansing", "dandruff", "malassezia", "sebum", "formulation",
)


def _domain_matches(text: str) -> bool:
    """`True` unless the text carries an explicit OTHER-domain signal with no
    personal-care/cosmetic counter-signal — the default assumption is
    relevance (Class D is for a REAL, positively-identified domain mismatch,
    never the fallback for "didn't mention my exact product category")."""
    if not text:
        return True
    low = text.lower()
    has_other = any(t in low for t in _OTHER_DOMAIN_TERMS)
    has_personal_care = any(t in low for t in _PERSONAL_CARE_SIGNAL)
    return not (has_other and not has_personal_care)


def _confidence_for(source_depth: str, has_concentration: bool, has_outcome: bool) -> Optional[float]:
    """A simple, inspectable rule — never a black-box number. Full text with
    a real concentration and outcome is the most trustworthy combination
    this extractor can produce; metadata-only carries no defensible
    confidence at all."""
    if source_depth == "metadata_only":
        return None
    base = 0.5 if source_depth == "full_text" else 0.3
    if has_concentration:
        base += 0.2
    if has_outcome:
        base += 0.15
    return round(min(base, 0.95), 2)


# -------------------------------------------------------------- main API ---

def extract_evidence_from_paper(
    paper: Dict[str, Any],
    text: str,
    source_depth: str,
    source_location: str = "",
    product_context: str = "",
) -> List[EvidenceRecord]:
    """The whole point of this module: real, per-ingredient findings from
    ONE already-deduplicated paper's actual text — never from its title or
    metadata alone unless `source_depth == "metadata_only"` (see
    `classify_evidence`, which floors that case at Class E)."""
    if not text:
        text = ""
    title = paper.get("title", "")
    mentions = detect_ingredient_mentions(text) if text else []
    is_review = is_review_paper(title, text)
    is_full = is_full_formulation_paper(text) if text else False
    domain_match = _domain_matches(text)

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    base_kwargs = dict(
        schema_version=EXTRACTION_SCHEMA_VERSION,
        paper_doi=paper.get("doi", ""), paper_title=title,
        paper_year=str(paper.get("year", "")), paper_authors=paper.get("authors", ""),
        paper_venue=paper.get("venue", ""),
        unique_source_count=int(paper.get("unique_source_count", 1) or 1),
        # Deduped, order-preserved: `literature_cache._flatten_canonical`
        # (Session 1) records one `ProvenanceEntry` per contributing RETRIEVAL
        # (a source found via two different query angles produces two
        # entries), so its own `provenance_sources` can legitimately repeat a
        # source name — e.g. `["europepmc", "europepmc", "europepmc"]` for one
        # provider found via three angles. `unique_source_count` already
        # reports the correct deduped provider count; this field should show
        # WHICH providers, not how many retrieval events each contributed, so
        # it never reads as inflated evidence when displayed.
        provenance_sources=list(dict.fromkeys(paper.get("provenance_sources") or [paper.get("source_db", "")])),
        is_full_formulation=is_full, product_context=product_context,
        source_location=source_location or ("abstract" if source_depth == "abstract_only" else ""),
        source_depth=source_depth, extracted_at=now,
    )

    if source_depth == "metadata_only" or not mentions:
        # Nothing extractable — at most a weak, explicit gap record, never a
        # fabricated one, and only when there's at least a recognized
        # ingredient mention worth naming (a paper with zero recognized
        # ingredients contributes NO record at all — silence, not a guess).
        if not mentions:
            return []
        records = []
        for key, raw, pos, _ in mentions:
            records.append(EvidenceRecord(
                **base_kwargs, ingredient_key=key, ingredient_raw=raw,
                concentration=None, function="", outcome="",
                process=ProcessObservation(),
                evidence_text=_sentence_around(text, pos) if text else title,
                evidence_class=EvidenceClass.E,
                confidence=_confidence_for(source_depth, False, False),
            ))
        return records

    all_spans = [(s, e) for _, _, s, e in mentions]
    records: List[EvidenceRecord] = []
    for key, raw, pos, end in mentions:
        other_spans = [(s, e) for s, e in all_spans if (s, e) != (pos, end)]
        conc = extract_concentration_near(text, pos, end, other_spans)
        outcome = extract_outcome_near(text, pos)
        process = extract_process_observations(text[max(0, pos - _PROCESS_WINDOW):pos + _PROCESS_WINDOW])
        cls = classify_evidence(
            source_depth=source_depth, is_full_formulation=is_full, is_review=is_review,
            has_concentration=conc is not None, has_outcome=bool(outcome),
            domain_match=domain_match,
        )
        records.append(EvidenceRecord(
            **base_kwargs, ingredient_key=key, ingredient_raw=raw,
            concentration=conc, function="", outcome=outcome, process=process,
            evidence_text=_sentence_around(text, pos),
            evidence_class=cls,
            confidence=_confidence_for(source_depth, conc is not None, bool(outcome)),
        ))
    return records


def study_count(records: List[EvidenceRecord]) -> int:
    """Unique STUDIES behind a set of records — architecture doc §9's own
    rule made a real, testable function: one `CanonicalPaper` (by DOI, or by
    normalized title when no DOI exists) is one study, regardless of how
    many records it produced or how many providers found it."""
    seen = set()
    for r in records:
        seen.add(r.paper_doi.lower().strip() or re.sub(r"[^a-z0-9]+", " ", r.paper_title.lower()).strip())
    return len(seen)


# ---------------------------------------------------------------- ranking ---

@dataclass(frozen=True)
class EvidenceScore:
    """Every factor named and inspectable — never a single opaque number.
    `unique_source_count`/provider count is deliberately absent from this
    dataclass: it is never read anywhere in `_score` below, so it structurally
    cannot multiply ranking weight (architecture doc §5/§10's own rule)."""

    class_weight: float
    full_text_bonus: float
    experimental_data_bonus: float
    domain_comparability: float
    consistency_bonus: float
    total: float


_CLASS_WEIGHT = {EvidenceClass.A: 1.0, EvidenceClass.B: 0.7, EvidenceClass.C: 0.4,
                  EvidenceClass.D: 0.25, EvidenceClass.E: 0.1}


def score_evidence(record: EvidenceRecord, requested_ingredient_key: str = "") -> EvidenceScore:
    class_weight = _CLASS_WEIGHT[record.evidence_class]
    full_text_bonus = 0.15 if record.source_depth == "full_text" else 0.0
    experimental_data_bonus = (0.1 if record.concentration else 0.0) + (0.05 if record.outcome else 0.0)
    domain_comparability = 0.1 if record.evidence_class not in (EvidenceClass.D, EvidenceClass.E) else 0.0
    consistency_bonus = 0.05 if requested_ingredient_key and record.ingredient_key == requested_ingredient_key else 0.0
    total = round(class_weight + full_text_bonus + experimental_data_bonus
                  + domain_comparability + consistency_bonus, 4)
    return EvidenceScore(class_weight=class_weight, full_text_bonus=full_text_bonus,
                          experimental_data_bonus=experimental_data_bonus,
                          domain_comparability=domain_comparability,
                          consistency_bonus=consistency_bonus, total=total)


def rank_evidence(records: List[EvidenceRecord], requested_ingredient_key: str = "") -> List[EvidenceRecord]:
    """Sorted strongest-first. Ties broken by `paper_doi` for a deterministic
    result (never dict/set iteration order)."""
    return sorted(
        records,
        key=lambda r: (-score_evidence(r, requested_ingredient_key).total, r.paper_doi or r.paper_title),
    )


# --------------------------------------------------- synthesis integration --

def build_evidence_context_block(records: List[EvidenceRecord], limit: int = 12) -> str:
    """The evidence-aware block added to the LLM prompt (architecture doc
    §11): explicitly separates FACT FROM EVIDENCE from what would be
    FORMULAB INFERENCE, and states outright when evidence for the request is
    MISSING — a model must never present an inferred value as a literature
    fact, and this block's own structure makes that distinction impossible
    to miss rather than relying on the model to infer it."""
    if not records:
        return ("FACT FROM EVIDENCE: none extracted for this request.\n"
                "MISSING / REQUIRES LAB VALIDATION: no structured evidence was "
                "extracted from the retrieved literature — treat every "
                "concentration/process/outcome choice below as FORMULAB "
                "INFERENCE from general formulation science, not a literature "
                "fact, and say so on the card.")
    lines = ["FACT FROM EVIDENCE (extracted from the retrieved papers below — "
             "cite these, do not restate them as your own claim):"]
    for r in records[:limit]:
        conc = ""
        if r.concentration:
            c = r.concentration
            rng = f"{c.value}-{c.value_max}" if c.value_max is not None else str(c.value)
            conc = f", concentration {rng}{c.unit}"
        outcome = f", outcome: {r.outcome}" if r.outcome else ""
        lines.append(
            f"- [{r.evidence_class.value}] {r.ingredient_raw}{conc}{outcome} "
            f"(DOI:{r.paper_doi or 'none'}, {r.paper_year}, {r.source_depth})"
        )
    lines.append(
        "\nFORMULAB INFERENCE: any choice above NOT directly traceable to one "
        "of these lines (e.g. an exact weight-% not shown above, a process "
        "step, a claim) is FormuLab's own inference from general formulation "
        "science, not a literature fact — do not cite a DOI for it."
    )
    lines.append(
        "\nMISSING / REQUIRES LAB VALIDATION: where the evidence above does "
        "not cover a decision you need to make, say so explicitly rather than "
        "inventing a plausible-looking value."
    )
    return "\n".join(lines)


# ------------------------------------------------------------- persistence --

def _paper_key(paper: Dict[str, Any]) -> str:
    return (paper.get("doi") or "").lower().strip() or re.sub(
        r"[^a-z0-9]+", " ", (paper.get("title") or "").lower()).strip()


def load_evidence_cache(library: str) -> Dict[str, List[Dict[str, Any]]]:
    """The shared LIBRARY-level cache (parallel to `literature_cache.py`'s
    own `index.json`) — extraction is re-run only for a paper key not
    already present, exactly the same cache-first convention this pipeline
    already uses for discovery itself."""
    path = os.path.join(library, "evidence_cache.json")
    if os.path.isfile(path):
        try:
            with open(path, encoding="utf-8") as fh:
                return json.load(fh)
        except Exception:
            return {}
    return {}


def save_evidence_cache(library: str, cache: Dict[str, List[Dict[str, Any]]]) -> None:
    os.makedirs(library, exist_ok=True)
    with open(os.path.join(library, "evidence_cache.json"), "w", encoding="utf-8") as fh:
        json.dump(cache, fh, ensure_ascii=False, indent=2)


def gather_evidence(
    papers: List[Dict[str, Any]],
    pdf_dir: str,
    library: str,
    product_context: str = "",
) -> List[EvidenceRecord]:
    """Extract (or load from cache) structured evidence for every paper in
    `papers` — the same already-deduplicated list `literature_cache.gather()`
    returns. One entry per paper in `papers`, however many `EvidenceRecord`s
    it produces (`study_count()` on the result still reflects real, unique
    studies, never inflated by this)."""
    cache = load_evidence_cache(library)
    changed = False
    all_records: List[EvidenceRecord] = []

    for paper in papers:
        key = _paper_key(paper)
        if not key:
            continue
        if key in cache:
            for d in cache[key]:
                d = dict(d)
                conc = d.get("concentration")
                d["concentration"] = ConcentrationValue(**conc) if conc else None
                proc = d.get("process") or {}
                d["process"] = ProcessObservation(**proc)
                d["evidence_class"] = EvidenceClass(d["evidence_class"])
                all_records.append(EvidenceRecord(**d))
            continue

        full_text = fulltext.excerpt_for(paper, pdf_dir) if pdf_dir else ""
        if full_text:
            depth, loc = "full_text", "full_text"
        elif paper.get("abstract"):
            full_text, depth, loc = paper["abstract"], "abstract_only", "abstract"
        else:
            depth, loc = "metadata_only", ""

        records = extract_evidence_from_paper(paper, full_text, depth, loc, product_context)
        cache[key] = [r.to_dict() for r in records]
        changed = True
        all_records.extend(records)

    if changed:
        save_evidence_cache(library, cache)
    return all_records


def save_session_evidence(out_dir: str, records: List[EvidenceRecord]) -> None:
    """Session-local copy — `out_dir/literature/evidence.json`, the same
    convention `literature_cache.gather()` already uses for
    `papers.csv`/`papers.json`. `out_dir` here is the session's `literature`
    subdirectory (the caller already resolves this, matching how
    `papers.json` itself is written)."""
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "evidence.json"), "w", encoding="utf-8") as fh:
        json.dump([r.to_dict() for r in records], fh, ensure_ascii=False, indent=2)
