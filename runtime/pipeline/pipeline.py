"""FormuLab v2 orchestrator — direct pipeline, no OpenCode agent loop.

brief -> safety gate -> deterministic constraints -> cache-first retrieval ->
structured evidence extraction -> the Phase 15 zero-LLM deterministic
formulation engine (N candidate formulas, one independently-built per
request-aware strategy) -> validate each against the hard avoid-list ->
render N formulation cards (v1..vN).

**Zero LLM.** No generative model, local or remote, sits anywhere in this
path — `engine.py` builds every formula from real evidence, real supplier
data, and real deterministic rules. `llm.py` remains in the repository for
legacy/historical compatibility only (old sessions were genuinely produced
by it) and is not imported here; see `engine.py`'s and `provenance.py`'s
own module docstrings for the full audit.

No sidecar, no SSE, no tool loop: a single request/response the desktop app
invokes and renders.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Callable, Dict, List

import architecture_portfolio
import engine
import evidence
import fulltext
import literature_cache
import manufacturing
import master_materials_adapter
import provenance
import scientific_formulation
import strategy
import validation_plan
from rules import derive_constraints, validate

# Hazardous / illicit classes the app must refuse (safety gate).
FORBIDDEN = [
    "explosive", "energetic material", "detonat", "tnt", "rdx", "nitroglycer",
    "chemical weapon", "nerve agent", "sarin", "vx", "mustard gas", "toxin",
    "bioweapon", "pathogen weapon", "methamphetamine", "cocaine", "heroin", "fentanyl",
    "mdma", "lsd", "controlled substance", "poison to harm", "nerve gas",
]


def safety_gate(target: str) -> str | None:
    t = (target or "").lower()
    for bad in FORBIDDEN:
        if bad in t:
            return (f"Refused: the target appears to involve a prohibited class "
                    f"('{bad}'). FormuLab only designs lawful consumer/industrial products.")
    return None


# Deterministic pre-generation safety classification. Mirrors the TypeScript
# PRODUCT_SAFETY_CLASSIFICATIONS enum in packages/shared/src/schemas/safety.ts
# — kept in sync by hand, the same way HUMAN_ONLY_STATUSES is duplicated
# between status.ts and formulations.rs elsewhere in this project. This gate
# runs BEFORE literature discovery or any model call: a prompt instruction is
# not a safety control, a keyword-matched, testable function is.
PRODUCT_SAFETY_CLASSIFICATIONS = (
    "ordinary_consumer_product",
    "industrial_cleaning_product",
    "hazardous_lawful_product",
    "regulated_disinfectant",
    "medical_or_health_related_product",
    "restricted_request",
    "prohibited_request",
    "human_review_required",
)

_RESTRICTED_KEYWORDS = (
    "pesticide", "insecticide", "rodenticide", "fumigant", "veterinary drug",
    "controlled precursor",
)
_MEDICAL_KEYWORDS = (
    "toothpaste", "mouthwash", "therapeutic", "medicated", "medical device",
    "wound care", "prescription", "drug",
)
_DISINFECTANT_KEYWORDS = (
    "disinfectant", "sanitiser", "sanitizer", "qac", "quaternary ammonium",
    "chlorhexidine", "biocide", "germicide", "antimicrobial surface",
)
_HAZARDOUS_LAWFUL_KEYWORDS = (
    "bleach", "hypochlorite", "sodium hypochlorite", "acid cleaner", "caustic",
    "sulfuric", "hydrochloric", "oven cleaner",
)
_INDUSTRIAL_KEYWORDS = (
    "degreaser", "industrial cleaner", "floor cleaner", "limescale remover", "descaler",
)

# Classifications that always require a named human to review and
# acknowledge before literature discovery/generation proceeds, even though
# the request itself is lawful.
_HUMAN_REVIEW_TIERS = frozenset({
    "regulated_disinfectant", "medical_or_health_related_product", "restricted_request",
})


def classify_target(target: str) -> str:
    """Deterministic classification of a free-text product target."""
    t = (target or "").lower()
    if safety_gate(target):
        return "prohibited_request"
    if any(k in t for k in _RESTRICTED_KEYWORDS):
        return "restricted_request"
    if any(k in t for k in _MEDICAL_KEYWORDS):
        return "medical_or_health_related_product"
    if any(k in t for k in _DISINFECTANT_KEYWORDS):
        return "regulated_disinfectant"
    if any(k in t for k in _HAZARDOUS_LAWFUL_KEYWORDS):
        return "hazardous_lawful_product"
    if any(k in t for k in _INDUSTRIAL_KEYWORDS):
        return "industrial_cleaning_product"
    return "ordinary_consumer_product"


def safety_decision(target: str) -> tuple[str, str]:
    """(classification, decision) where decision is one of
    "proceed" | "human_review_required" | "refused"."""
    classification = classify_target(target)
    if classification == "prohibited_request":
        return classification, "refused"
    if classification in _HUMAN_REVIEW_TIERS:
        return classification, "human_review_required"
    return classification, "proceed"


def _log_safety_decision(library: str, record: Dict[str, Any]) -> None:
    """Append one line to data/safety/ai_request_log.jsonl (sibling of the
    literature cache). Best-effort: a logging failure must never block the
    pipeline itself."""
    try:
        safety_dir = os.path.join(os.path.dirname(library.rstrip("/\\")), "safety")
        os.makedirs(safety_dir, exist_ok=True)
        with open(os.path.join(safety_dir, "ai_request_log.jsonl"), "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError:
        pass


# Product classes whose "base system" is a cleansing/surfactant problem vs. a
# different core technology — the retrieval angle differs accordingly.
# Reuses `engine.py`'s own, wider `_CLEANSING_HEAD` vocabulary (Phase 14
# Session 6 correction gate §10: a real bug found during this round's own
# live acceptance testing — this list previously omitted "hand soap"/
# "liquid soap"/"handwash", so a "hand soap with rosemary scent" request
# never got a surfactant/mildness/viscosity retrieval angle at all, one
# real, disclosed reason the live corpus for that request undershot 15).
# Never drift the two lists apart again — one real source of truth.
_CLEANSING = engine._CLEANSING_HEAD
_ORAL = engine._ORAL_HEAD
_LEAVE_ON = engine._LEAVE_ON_HEAD


# Qualifiers that narrow a product name past what a literature index can match
# ("shampoo for eczema-prone scalp" -> "shampoo"). The angle terms re-add focus.
_FILLER = {"for", "with", "without", "free", "prone", "and", "or", "the", "a", "an",
           "my", "our", "type", "kind", "use", "used", "very", "extra", "super"}


def _head(name: str, max_words: int = 3) -> str:
    """The searchable core of a product name: first few content words."""
    words = [w for w in re.findall(r"[A-Za-z0-9-]+", name or "") if w.lower() not in _FILLER]
    return " ".join(words[:max_words]) or "product"


def build_queries(
    brief: Dict[str, Any], constraints: Dict[str, Any] | None = None, scent_character: str = "",
) -> List[str]:
    """Plan several retrieval angles instead of one catch-all query.

    A single query ("<target> formulation ingredients") returns one narrow slice
    and lets the first source fill the whole quota. Real formulation evidence is
    spread across distinct questions — the active's efficacy, the base system,
    preservation, the regional water/climate constraint, safety — so we ask each
    separately and let the cache layer spread the budget across them.

    Deterministic on purpose: no extra LLM call, no added latency, and the same
    brief always plans the same angles.
    """
    target = str(brief.get("target", "")).strip()
    cat = str(brief.get("category", "")).strip()
    catl = f"{cat} {target}".lower()

    # Keep queries SHORT. These APIs match conjunctively: a five-concept query
    # like "limescale remover for kettles formulation ingredients" returns zero
    # hits, while "limescale removal" returns solid ones. So each angle is the
    # product head plus ONE distinguishing term.
    head = _head(cat if cat and cat != "auto-detect" else target)

    queries: List[str] = [head]

    # 1. Does the active/claim work?
    queries.append(f"{head} efficacy")

    # 2. The base system — what the product is mostly made of.
    if any(k in catl for k in _CLEANSING):
        queries.append(f"{head} surfactant")
    elif any(k in catl for k in _ORAL):
        queries.append(f"{head} abrasive fluoride")
    elif any(k in catl for k in _LEAVE_ON):
        queries.append(f"{head} emulsion stability")
    else:
        queries.append(f"{head} raw materials")

    # 3. Preservation + shelf life.
    queries.append(f"{head} preservative")

    # 3a. Cleansing-family products carry function-specific evidence
    # (mildness, foam, rheology) a "surfactant"-only angle misses — Phase
    # 14 Session 6 correction gate §10: never collapse a cleansing request
    # into one generic angle.
    if any(k in catl for k in _CLEANSING):
        queries.append(f"{head} mildness")
        queries.append(f"{head} viscosity")

    if constraints:
        p = constraints.get("profile") or {}
        # 4. The regional constraint that actually changes the formula.
        if p.get("water_hardness") in ("hard", "very_hard"):
            queries.append(f"{head} hard water")
        if p.get("climate") in ("hot_humid", "hot_dry", "tropical"):
            queries.append(f"{head} thermal stability")
        # 5. Safety angle for sensitive/child/medicated targets.
        if constraints.get("sensitive"):
            queries.append(f"{head} skin irritation")

    # 6. A real requested scent character ("rosemary" from "hand soap with
    # rosemary scent") gets its own real retrieval angle (§10's own
    # explicit REQUEST-SPECIFIC example) — never collapsed into the
    # generic head query, which a fragrance-focused paper rarely matches.
    if scent_character:
        queries.append(f"{scent_character} fragrance")

    # Dedup, preserve order, keep the budget sane.
    seen: set = set()
    out: List[str] = []
    for q in queries:
        k = " ".join(q.lower().split())
        if k and k not in seen:
            seen.add(k)
            out.append(" ".join(q.split()))
    return out[:9]


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "product").lower()).strip("-")[:48] or "product"


def _author_list(authors: str) -> List[str]:
    """Split an author string. OpenAlex separates with ';', Europe PMC with ','."""
    sep = ";" if ";" in authors else ","
    return [a.strip() for a in authors.split(sep) if a.strip()]


def _surname(name: str) -> str:
    """The family name, whichever order the source used.

    Europe PMC writes "Meyer F" (surname first, then initials); OpenAlex writes
    "Valéria CC Marinho" (surname last). Trailing initials are the tell: a short
    all-caps final token means the name is surname-first.
    """
    parts = [p for p in name.replace(".", " ").split() if p]
    if not parts:
        return ""
    last = parts[-1]
    if len(parts) > 1 and len(last) <= 3 and last.isupper():
        return parts[0]
    return last


def verify_references(formula: Dict[str, Any], papers: List[Dict[str, Any]]) -> List[str]:
    """Check every citation against the papers we actually supplied.

    The model reliably picks a real DOI from the set but will invent the author
    line to go with it — a card citing "Figueiredo et al." for a paper by Meyer
    et al. looks authoritative and is wrong. Author and year are therefore taken
    from OUR metadata whenever the DOI matches, and a citation whose DOI we never
    supplied is dropped: an unverifiable reference is worse than none.

    Returns notes describing anything corrected or removed.
    """
    by_doi = {(p.get("doi") or "").lower().strip(): p for p in papers if p.get("doi")}
    notes: List[str] = []
    kept: List[Dict[str, Any]] = []
    for ref in formula.get("references") or []:
        doi = str(ref.get("doi", "")).lower().strip().replace("https://doi.org/", "")
        paper = by_doi.get(doi)
        if not paper:
            notes.append(f"removed a citation not drawn from the retrieved sources (DOI:{doi or 'none'})")
            continue
        authors = _author_list(paper.get("authors") or "")
        surname = _surname(authors[0]) if authors else ""
        correct_author = (f"{surname} et al." if surname and len(authors) > 1
                          else surname or ref.get("author", ""))
        correct_year = str(paper.get("year") or ref.get("year", ""))
        if ref.get("author") and correct_author and ref["author"] != correct_author:
            notes.append(f"corrected citation for DOI:{doi} ({ref['author']} -> {correct_author})")
        kept.append({"author": correct_author, "year": correct_year, "doi": doi,
                     "title": paper.get("title", "")})
    formula["references"] = kept
    return notes


def render_card(formula: Dict[str, Any], violations: List[str], strat: Dict[str, Any] | None = None) -> str:
    md = [f"# Formulation Card: {formula.get('name','Candidate')}", ""]
    if strat:
        md.append(f"**Strategy:** {strat.get('title','')} — {strat.get('rationale','')}")
        md.append("")
    md.append(f"**Purpose:** {formula.get('purpose','')}")
    md.append("")
    refs = "; ".join(
        f"{r.get('author','')} {r.get('year','')} (DOI:{r.get('doi','')})".strip()
        for r in formula.get("references", [])
    )
    if refs:
        md.append(f"**References:** {refs}")
        md.append("")
    md.append("## Formulation Table")
    md.append("")
    md.append("| # | Ingredient (INCI) | Function | Weight % |")
    md.append("|---|---|---|---|")
    for i, ing in enumerate(formula.get("ingredients", []), 1):
        md.append(f"| {i} | {ing.get('inci','')} | {ing.get('function','')} | {ing.get('weight_pct','')} |")
    md.append("")
    if formula.get("how_it_works"):
        md.append("## How It Works")
        md.append("")
        for sec in formula["how_it_works"]:
            md.append(f"### {sec.get('title','')}")
            md.append(sec.get("text", ""))
            md.append("")
    if formula.get("avoid"):
        md.append("## What to Avoid")
        for a in formula["avoid"]:
            md.append(f"- ❌ {a.get('item','')} — {a.get('reason','')}")
        md.append("")
    if formula.get("usage"):
        md.append("## Usage")
        for i, s in enumerate(formula["usage"], 1):
            md.append(f"{i}. {s}")
        md.append("")
    md.append("## ⚠️ Warnings")
    for w in formula.get("warnings", []):
        md.append(f"- {w}")
    md.append("- Evidence-based candidate, not a validated commercial product; lab validation required.")
    if violations:
        md.append("")
        md.append("> ⚠️ Rule check found issues that were auto-corrected or need review: "
                  + "; ".join(violations))
    return "\n".join(md)


def card_filename(session_id: str, version: str) -> str:
    """The one name a card is stored under, in the session AND in the library.

    `Formulation_Card_<session>_<version>.md` — the session id already carries
    the date, time and product, so the same file name identifies the card
    wherever it sits, and the library sorts chronologically by product.
    """
    return f"Formulation_Card_{session_id}_{version}.md"


def archive_formulas(
    formulas_dir: str,
    cards: List[Dict[str, Any]],
    brief: Dict[str, Any],
    slug: str,
    session_id: str,
) -> List[str]:
    """Copy every produced card into the flat formula library and index it.

    The library is the one place that holds EVERY formula ever generated, across
    sessions, under the SAME file name the session uses, plus an `index.json`
    describing each entry so the set stays browsable without opening the files.
    """
    os.makedirs(formulas_dir, exist_ok=True)
    index_path = os.path.join(formulas_dir, "index.json")
    try:
        with open(index_path, encoding="utf-8") as fh:
            index = json.load(fh)
    except Exception:
        index = []

    created = time.strftime("%Y-%m-%d %H:%M:%S")
    written: List[str] = []
    for card in cards:
        version = card["version"]
        # Session id carries date + time + product, so this name is already
        # unique — no collision suffix needed.
        name = card_filename(session_id, version)
        with open(os.path.join(formulas_dir, name), "w", encoding="utf-8") as fh:
            fh.write(card["markdown"])
        written.append(name)

        formula = card.get("formula", {}) or {}
        index.append({
            "file": name,
            "name": formula.get("name", ""),
            "target": brief.get("target", ""),
            "category": brief.get("category", ""),
            "market": brief.get("market", ""),
            "version": version,
            "created": created,
            "session": session_id,
            "ingredients": len(formula.get("ingredients", []) or []),
            "violations": card.get("violations", []),
        })

    with open(index_path, "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, indent=2)
    return written


def run(
    brief: Dict[str, Any],
    library: str,
    out_dir: str,
    n: int = 3,
    formulas_dir: str | None = None,
    # FVL-03.002: this is the canonical Material Master directory
    # (`data/master`, owned by `masterdata.rs`), not a legacy materials
    # folder — read via `master_materials_adapter.load_master_materials()`,
    # never `materials.load_materials()`, for the generation path below.
    materials_dir: str | None = None,
    download_fulltexts: bool = True,
    log: Callable[[str], None] = lambda m: None,
) -> Dict[str, Any]:
    """Run the full pipeline. Returns {status, cards:[{version, markdown, formula}], ...}."""
    target = str(brief.get("target", "")).strip()
    if not target:
        return {"status": "error", "message": "no target product given"}

    # FormuLab v1 (FVL-02) §2: reject an explicit out-of-range requested
    # count rather than silently clamping it — the user's own request is
    # never quietly changed. `n` IS the real `requestedFormulaCount`
    # request-contract field (already threaded end-to-end from the
    # frontend's own count control through the Rust bridge/`run_cli.py`
    # as a first-class request parameter, not part of `brief`).
    if not (engine.MIN_FORMULA_ALTERNATIVES <= n <= engine.MAX_FORMULA_ALTERNATIVES):
        return {
            "status": "error",
            "message": (
                f"requestedFormulaCount must be between {engine.MIN_FORMULA_ALTERNATIVES} "
                f"and {engine.MAX_FORMULA_ALTERNATIVES} (got {n})."
            ),
        }

    classification, decision = safety_decision(target)
    reviewer = str(brief.get("human_review_by", "")).strip()
    acknowledged = bool(brief.get("human_review_acknowledged")) and bool(reviewer)
    log_record: Dict[str, Any] = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "target": target,
        "classification": classification,
        "decision": decision,
    }

    if decision == "refused":
        log_record["outcome"] = "refused"
        _log_safety_decision(library, log_record)
        return {
            "status": "refused",
            "classification": classification,
            "message": safety_gate(target) or "Refused: prohibited request class.",
        }

    if decision == "human_review_required" and not acknowledged:
        log_record["outcome"] = "pending_human_review"
        _log_safety_decision(library, log_record)
        return {
            "status": "human_review_required",
            "classification": classification,
            "message": (
                f'This product classifies as "{classification.replace("_", " ")}" and requires '
                f"a named human to review and acknowledge before literature discovery proceeds."
            ),
        }

    log_record["outcome"] = "proceeded"
    if decision == "human_review_required":
        log_record["acknowledged_by"] = reviewer
    _log_safety_decision(library, log_record)

    constraints = derive_constraints(brief)
    os.makedirs(out_dir, exist_ok=True)
    lit_dir = os.path.join(out_dir, "literature")
    # Parsed ahead of `build_queries()` (Phase 14 Session 6 correction gate
    # §10) purely so a real requested scent character ("rosemary" from
    # "hand soap with rosemary scent") can become its own retrieval angle —
    # `parse_requirements()` is a pure function of `brief` alone, so calling
    # it here changes no other ordering/dependency. Re-used again below
    # rather than re-parsed a second time.
    parsed_requirements = engine.parse_requirements(brief)
    # Loaded ahead of scientific-formulation extraction below (needs it for
    # ingredient-identity resolution) and reused again at candidate-pool
    # construction — a real, live raw-material list when the user has
    # imported one for this installation, `[]` otherwise (never an error).
    materials_list: List[Dict[str, Any]] = []
    if materials_dir:
        try:
            materials_list = master_materials_adapter.load_master_materials(materials_dir)
        except OSError:
            materials_list = []
    queries = build_queries(brief, constraints, scent_character=parsed_requirements.scent_character)
    log(f"planned {len(queries)} retrieval angles")
    # Anchor every retrieved paper to the product itself, so an angle query can
    # sharpen the search without drifting off-domain.
    anchor = f"{brief.get('target', '')} {brief.get('category', '')}"
    papers = literature_cache.gather(
        queries, lit_dir, library, target=15, anchor=anchor,
        download_pdfs=download_fulltexts, log=log,
    )
    log(f"literature ready: {len(papers)} papers")

    # Phase 14 Session 2: structured evidence extraction, ranked, ON TOP of
    # the same already-deduplicated `papers` list — never a second discovery
    # pass. Cache-first (`evidence.gather_evidence` checks the shared
    # library-level cache before re-extracting a paper this installation has
    # already processed), same convention `literature_cache.gather()` itself
    # already uses for discovery.
    pdf_dir = os.path.join(lit_dir, "pdfs")
    evidence_records = evidence.gather_evidence(papers, pdf_dir, library, product_context=anchor)
    ranked_evidence = evidence.rank_evidence(evidence_records)
    evidence.save_session_evidence(lit_dir, ranked_evidence)
    studies = evidence.study_count(evidence_records)
    class_counts: Dict[str, int] = {}
    for r in evidence_records:
        class_counts[r.evidence_class.value] = class_counts.get(r.evidence_class.value, 0) + 1
    log(f"evidence: {len(evidence_records)} record(s) from {studies} unique studies "
        f"(classes: {class_counts or 'none'})")

    # FormuLab v1 correction (FVL-03): complete scientific formulations —
    # a paper's own real, whole experimental architecture (an F1/F2/F3...
    # composition table), not just the individual ingredient MENTIONS
    # `evidence.py` above already extracts. Deterministic, zero-LLM, over
    # `fulltext.pdf_lines()`'s own real positional PDF text reconstruction
    # — see `scientific_formulation.py`'s own module docstring for why
    # this was previously structurally impossible (the old flat-text
    # excerpt destroys a table's row/column layout).
    scientific_formulations: List[Dict[str, Any]] = []
    scientific_outcomes: List[Dict[str, Any]] = []
    pdf_lines_by_doi: Dict[str, List[str]] = {}
    for paper in papers:
        pdf_lines = fulltext.pdf_lines_for(paper, pdf_dir)
        if not pdf_lines:
            continue
        canonical_id = (paper.get("doi") or "").lower().strip() or re.sub(
            r"[^a-z0-9]+", " ", (paper.get("title") or "").lower()).strip()
        pdf_lines_by_doi[paper.get("doi") or ""] = pdf_lines
        records, outcomes = scientific_formulation.extract_scientific_formulations(
            pdf_lines, canonical_paper_id=canonical_id, doi=paper.get("doi") or "",
            title=paper.get("title") or "", year=str(paper.get("year") or ""),
            authors=paper.get("authors") or "", product_type=str(brief.get("category", "")),
        )
        if records:
            records = scientific_formulation.resolve_identities(records, materials_list)
            scientific_formulations.extend(r.to_dict() for r in records)
            scientific_outcomes.extend(o.to_dict() for o in outcomes)
    with open(os.path.join(lit_dir, "scientific_formulations.json"), "w", encoding="utf-8") as fh:
        json.dump({"formulations": scientific_formulations, "outcomes": scientific_outcomes},
                   fh, ensure_ascii=False, indent=2)
    formulations_with_outcomes = len({o["source_formulation_id"] + "::" + o.get("condition", "")
                                       for o in scientific_outcomes}) if scientific_outcomes else 0
    log(f"scientific formulations: {len(scientific_formulations)} extracted, "
        f"{len(scientific_outcomes)} experimental outcome(s) linked")

    # Phase 14 Session 4 §5: the research corpus (unique relevant documents)
    # and structured evidence (extracted findings) are NOT interchangeable
    # numbers — persisted and logged separately, never collapsed into one
    # "sources" figure. `papers` is already the real, honest corpus fixed by
    # `literature_cache.gather()`'s own §4 fix (relevant candidates kept
    # regardless of full-text success; never padded with duplicates).
    # Close the disclosed `raw_candidate_count` gap: `literature_cache.gather()`
    # now writes the real, wider pre-ranking candidate-pool size next to
    # `papers.json` (see that function's own comment) — read back here rather
    # than defaulting to `len(papers)` (identical to `qualifying_count`,
    # which is what made the gap worth disclosing in the first place).
    raw_candidate_count = None
    full_text_gate_met = None
    try:
        with open(os.path.join(lit_dir, "discovery_stats.json"), encoding="utf-8") as fh:
            stats = json.load(fh)
            raw_candidate_count = stats.get("raw_candidate_count")
            full_text_gate_met = stats.get("full_text_gate_met")
    except OSError:
        pass
    corpus = provenance.summarize_research_corpus(
        papers, evidence_records, target_count=provenance.RESEARCH_FULL_TEXT_TARGET,
        raw_candidate_count=raw_candidate_count, full_text_gate_met=full_text_gate_met,
    )
    with open(os.path.join(lit_dir, "research_corpus.json"), "w", encoding="utf-8") as fh:
        json.dump(corpus.to_dict(), fh, ensure_ascii=False, indent=2)
    log(f"research corpus: {corpus.qualifying_count}/{corpus.target_count} target unique document(s) "
        f"({corpus.full_text_count} full text, {corpus.abstract_only_count} abstract-only, "
        f"{corpus.metadata_only_count} metadata-only) — status: {corpus.status}")

    # 2026-08-17 correction to the Session 6 correction gate's own §9: 15
    # full texts remains the PREFERRED target (searched for hard — see
    # `literature_cache.gather()`'s own deeper-search behavior, unchanged
    # by this correction), but is no longer an absolute prerequisite for
    # generating formulas. Three real states, one authoritative source of
    # truth (`provenance.research_corpus_status()`):
    #   full (>= RESEARCH_FULL_TEXT_TARGET)         -> normal generation
    #   partial (>= RESEARCH_FULL_TEXT_MINIMUM)      -> generation allowed,
    #                                                    shortfall disclosed
    #   insufficient (< RESEARCH_FULL_TEXT_MINIMUM)  -> blocked, as before
    # Only enforced when this run actually attempted full-text acquisition
    # (`download_fulltexts=True`) — a `download_fulltexts=False` run never
    # attempted the gate in the first place, so there is nothing honest to
    # block on.
    partial_research = False
    if download_fulltexts:
        if corpus.status == provenance.CORPUS_INSUFFICIENT:
            message = (
                f"Research corpus incomplete: {corpus.full_text_count}/"
                f"{provenance.RESEARCH_FULL_TEXT_MINIMUM} minimum required full-text "
                f"sources acquired (preferred target {provenance.RESEARCH_FULL_TEXT_TARGET})."
            )
            log(f"[blocked] {message}")
            return {
                "status": "research_corpus_incomplete",
                "message": message,
                "research_corpus": corpus.to_dict(),
            }
        partial_research = corpus.status == provenance.CORPUS_PARTIAL
        if partial_research:
            log(f"[partial] research corpus below the preferred target: "
                f"{corpus.full_text_count}/{provenance.RESEARCH_FULL_TEXT_TARGET} full-text "
                f"sources (>= minimum {provenance.RESEARCH_FULL_TEXT_MINIMUM}) — "
                f"formulation generation proceeds, shortfall disclosed")

    # Phase 14 Session 3: request-aware strategy derivation — never a fixed
    # V1/V2/V3 enum. `len(strategies)` becomes the real formula count
    # requested (it can be < n when fewer than n strategies genuinely apply
    # to this brief — architecture doc §4's own instruction to say so
    # explicitly rather than invent an alternative).
    strategies = strategy.derive_strategies(brief, constraints, n=n)
    log(f"strategies: {', '.join(s.title for s in strategies)}")

    # Phase 15 zero-LLM round: no prompt, no model call, no provider/model
    # credential of any kind. `engine.py` builds every formula directly from
    # real evidence, real supplier data, and real deterministic rules — see
    # that module's own docstring for the full pipeline this replaces.
    generation_provenance = provenance.build_deterministic_provenance()
    with open(os.path.join(out_dir, "generation_provenance.json"), "w", encoding="utf-8") as fh:
        json.dump(generation_provenance.to_dict(), fh, ensure_ascii=False, indent=2)

    group = engine.category_group(str(brief.get("category", "")), target)
    role_requirements = engine.resolve_role_requirements(group, brief, constraints, parsed_requirements)

    # FormuLab v1 correction (FVL-02) §6-20: a GLOBAL scientific-
    # architecture portfolio decision, made ONCE across every requested
    # slot, before any version's own candidate pool is built — replacing
    # the prior round's own bug (every version built its pool from the
    # SAME full `scientific_formulations` list, so whichever formulation's
    # shared support ingredients ranked highest always won every slot).
    # See `architecture_portfolio.py`'s own module docstring for the full
    # account, including the real discovery that this specific reference
    # paper's own F1-F4 are concentration-only variants of ONE real
    # architecture (collapsed here via a real functional-role fingerprint,
    # never penalized merely for sharing a DOI — §17).
    avoid_keys = {evidence.normalize_ingredient_key(a) for a in constraints.get("avoid", [])}
    # §6/§7: the generic fallback's own `functional_completeness` must come
    # from the REAL current-request candidate universe, never an assumed
    # 1.0 — built here from a scientific-formulation-free pool (the same
    # generic evidence/supplier/deterministic-rule candidates every version
    # already has access to) so a request with no real coverage for e.g.
    # `active_treatment` produces a fallback that honestly reflects that.
    generic_pool = engine.build_candidate_pool(
        brief, constraints, ranked_evidence, materials_list,
        scent_character=parsed_requirements.scent_character, scientific_formulations=[],
    )
    required_roles_for_fallback = [r for r, level in role_requirements.items() if level == "required"]
    generic_covered = engine.covered_roles(generic_pool, required_roles_for_fallback)
    fallback_completeness = (
        (len(generic_covered) / len(required_roles_for_fallback)) if required_roles_for_fallback else 1.0
    )
    architecture_candidates = architecture_portfolio.build_candidates(
        scientific_formulations, scientific_outcomes, engine.ROLE_MAP, role_requirements,
        avoid_keys, brief, engine.MAJOR_SYSTEM_ROLES, pdf_lines_by_doi,
        fallback_completeness=fallback_completeness,
    )
    portfolio_assignments, architectures_rejected = architecture_portfolio.select_portfolio(
        architecture_candidates, slot_count=len(strategies),
    )
    log(f"architecture portfolio: {len(architecture_candidates)} candidate(s) "
        f"({sum(1 for c in architecture_candidates if c.architecture_origin == 'scientific_formulation')} scientific), "
        f"{len(portfolio_assignments)} slot(s) assigned, {len(architectures_rejected)} rejected")
    with open(os.path.join(lit_dir, "architecture_portfolio.json"), "w", encoding="utf-8") as fh:
        json.dump({
            "candidates": [c.to_dict() for c in architecture_candidates],
            "assignments": [a.to_dict() for a in portfolio_assignments],
            "rejected": architectures_rejected,
        }, fh, ensure_ascii=False, indent=2)

    if parsed_requirements.unresolved_fragments:
        log(f"[note] unresolved request fragments (no assumption made): "
            f"{', '.join(parsed_requirements.unresolved_fragments)}")

    # A card is only "evidence-based" if evidence was actually retrieved. When
    # retrieval comes back empty every formula rests on rule/supplier data
    # alone — say so on the card instead of implying literature backing.
    unevidenced = not papers
    if unevidenced:
        log("[warn] no literature retrieved — cards will be marked as not literature-grounded")

    # The session folder's own name identifies every card written from this run.
    session_id = os.path.basename(out_dir.rstrip("/\\"))

    # Every strategy slot is built, validated, scored, and linked to
    # evidence INDEPENDENTLY (architecture doc §10: "a valid V1 does not
    # make V2/V3 valid"). The deterministic engine has no stochastic failure
    # mode — it never fails to "return" a formula the way a model call
    # could — so there is no more `generation_failed` status for a new
    # session; a genuinely incomplete result is instead a real, explicit
    # `formula_state` on an otherwise-normal card (§10 of the brief this
    # round implements: "the UI should show the real state").
    # Phase 14 Session 6 correction gate: real cross-version diversity
    # pressure. Each major-system role's already-used ingredient key(s)
    # from every PRIOR version are accumulated here and passed into the
    # next version's own solver call, so V2/V3 actively search for a
    # genuinely different architecture rather than always re-selecting
    # the same highest-ranked candidate (see `engine.build_formula_for_
    # strategy`'s own docstring for the exact, honest fallback behavior
    # when no real alternative exists).
    major_role_used_keys: Dict[str, set] = {}
    cards: List[Dict[str, Any]] = []
    for idx, strat in enumerate(strategies, 1):
        version = f"v{idx}"
        # Per-VERSION candidate pool. FormuLab v1 (FVL-02) correction: the
        # global portfolio decision above answers "which scientific
        # architecture gets PRIORITY / SEED STATUS for this slot", never
        # "should this slot see scientific data at all" — `engine.
        # build_candidate_pool()` has never treated scientific-formulation
        # and generic evidence/rule candidates as mutually exclusive (it
        # merges every origin into one pool, role-by-role), so gating the
        # whole `scientific_formulations` list to a single record here
        # would falsely block the assigned architecture from being
        # completed by the normal generic candidate universe. Every
        # version still sees every extracted formulation (§3); only the
        # portfolio-assigned one gets `preferred_source_formulation_id`
        # priority (`engine._selection_score`'s own `is_preferred_
        # architecture` boost) — real per-slot diversity without
        # restoring the original bug (every version silently converging
        # on whichever formulation was first in extraction order).
        assignment = portfolio_assignments[idx - 1] if idx - 1 < len(portfolio_assignments) else None
        assigned_candidate = assignment.candidate if assignment else None
        preferred_source_formulation_id = (
            (assigned_candidate.canonical_paper_id, assigned_candidate.source_formulation_id)
            if assigned_candidate and assigned_candidate.architecture_origin == architecture_portfolio.ORIGIN_SCIENTIFIC
            else None
        )
        pool = engine.build_candidate_pool(
            brief, constraints, ranked_evidence, materials_list,
            scent_character=parsed_requirements.scent_character,
            scientific_formulations=scientific_formulations,
            preferred_source_formulation_id=preferred_source_formulation_id,
        )
        result = engine.build_formula_for_strategy(
            strat, group, role_requirements, pool, ranked_evidence, constraints, parsed_requirements,
            avoid_major_role_keys=major_role_used_keys,
        )
        for s in result.ingredients:
            if s.role in engine.MAJOR_SYSTEM_ROLES:
                major_role_used_keys.setdefault(s.role, set()).add(s.key)
        f = result.formula

        ingredients = [str(i.get("inci", "")) for i in f.get("ingredients", [])]
        violations = validate(ingredients, constraints)
        # Citations are real (built directly from the evidence records
        # behind this formula's own ingredients — see `engine.py`'s own
        # reference-building) but still checked against the retrieved set,
        # never taken on trust.
        for note in verify_references(f, papers):
            log(f"citation: {note}")
        if unevidenced:
            f["warnings"] = list(f.get("warnings") or []) + [
                "No open-access literature was found for this product, so this "
                "formulation reflects supplier/rule data and general formulation "
                "engineering practice only — it is NOT grounded in retrieved "
                "sources.",
            ]

        # Version-specific evidence association (architecture doc §7): which
        # of the already-ranked evidence records are actually about an
        # ingredient THIS version uses, keyed by `formulaVersionId +
        # ingredient` — never assumed to apply equally across versions.
        version_links = strategy.link_evidence_to_version(version, f, ranked_evidence)
        alignment = strategy.concentration_alignment(f, version_links)
        score = strategy.compute_version_score(f, violations, version_links)

        # Deterministic mass balance (§15 of this round: never client-side
        # arithmetic, never a second, inconsistent recomputation on the
        # frontend). Ingredient origins now come DIRECTLY from `engine.py`'s
        # own candidate selection (§14: evidence-first construction, not
        # evidence attached after the fact) — every ingredient in a new
        # deterministic formula therefore carries a real, non-AI origin by
        # construction, never `ai_formulation_inference` (§11).
        mass_balance = provenance.compute_mass_balance(f.get("ingredients", []))
        ingredient_origins = {s.key: list(s.origins) for s in result.ingredients}
        comparable_stats = {
            key: (stats.to_dict() if (stats := evidence.compute_comparable_stats(ranked_evidence, key)) else None)
            for key in ingredient_origins
        }
        formula_state = result.state
        if mass_balance.status != "complete" and formula_state in (
            engine.FORMULA_COMPLETE, engine.FORMULA_COMPLETE_WITH_VALIDATION_REQUIRED,
        ):
            formula_state = engine.FORMULA_INVALID_MASS_BALANCE
        quality_gate = provenance.assess_quality(
            f, violations, version_links, mass_balance,
            corpus_qualifying_count=corpus.qualifying_count, corpus_target_count=corpus.target_count,
            formula_state=formula_state,
        )

        # Phase 14 Session 5 (Phase 15 zero-LLM round): Manufacturing
        # Procedure / Critical Parameters / Equipment — zero LLM, built
        # directly from this version's own resolved ingredients (real
        # process evidence when a linked record carries one, a small
        # generic role-ordered engineering rule table otherwise), never
        # planned at all for a formula whose own state is invalid.
        manufacturing_ingredients = [
            {
                "key": s.key, "display_name": s.display_name, "role": s.role,
                "process": (s.best_evidence_record.process.__dict__
                            if s.best_evidence_record and not s.best_evidence_record.process.is_empty()
                            else None),
                "evidence_doi": s.best_evidence_record.paper_doi if s.best_evidence_record else "",
            }
            for s in result.ingredients
        ]
        manufacturing_plan = manufacturing.plan_manufacturing(
            formula_state, manufacturing_ingredients, brief, mass_balance.to_dict(), violations, comparable_stats,
        )

        # FVL-03.009/.010: this pipeline-local `safety.py`/`regulatory.py`
        # pair (each its own independent `overall_status` — safety from a
        # hardcoded ingredient-NAME hazard table, regulatory from a
        # partial, stale port of `packages/shared/src/catalog/
        # regulatoryRules.ts` — neither ever consuming the real TS
        # engines) has been retired entirely; neither is an authoritative
        # final verdict anywhere in the platform any more. Both
        # authoritative results are now computed read-only, client-side,
        # post-generation, from real canonical materials + the live
        # safety_rules/regulatory_rules collections (see
        # apps/desktop/src/lib/generatedFormulaSafety.ts,
        # apps/desktop/src/lib/generatedFormulaRegulatory.ts, and
        # docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md's "Safety Engine
        # boundary"/"Regulatory Engine boundary") — exactly the same
        # architecture already established for Cost/Inventory/
        # Compatibility (Python cannot call packages/shared at all;
        # `run_cli.py` is a one-shot subprocess with no back-channel). No
        # `card["safety"]`/`card["regulatory"]` is emitted here.
        validation_checks = validation_plan.build_validation_plan(
            formula_state, group, manufacturing_plan.to_dict(),
        )

        # Phase 14 Session 6 correction gate: real, structured evidence-gap
        # analysis — assembled entirely from data this card ALREADY
        # computed above (never a second extraction pass, never generic
        # filler text). Each gap names its own real category.
        evidence_gaps: List[Dict[str, str]] = []
        for m in result.missing_roles:
            evidence_gaps.append({"category": "missing_functional_role",
                                   "gap": f"{m['role'].replace('_', ' ').title()}: {m['reason']}"})
        for key, origins in ingredient_origins.items():
            if origins == [provenance.IngredientOrigin.DETERMINISTIC_RULE] and key in comparable_stats and comparable_stats[key] is None:
                evidence_gaps.append({"category": "rule_only_provenance",
                                       "gap": f"{key.replace('-', ' ')}: only a deterministic engineering "
                                              f"default backs this ingredient/concentration — no direct or "
                                              f"comparable scientific evidence."})
        if parsed_requirements.scent_character and any(
            "scent requirement unresolved" in u for u in result.unresolved_requirements
        ):
            evidence_gaps.append({"category": "fragrance_unresolved",
                                   "gap": f"{parsed_requirements.scent_character} scent requirement unresolved "
                                          f"— no matching fragrance material found."})
        if corpus.qualifying_count < corpus.target_count:
            evidence_gaps.append({"category": "insufficient_research_corpus",
                                   "gap": f"Research corpus: {corpus.qualifying_count}/{corpus.target_count} "
                                          f"target unique relevant documents were genuinely available."})
        if corpus.full_text_count < corpus.target_count:
            evidence_gaps.append({"category": "insufficient_full_text",
                                   "gap": f"Full-text sources: {corpus.full_text_count}/{corpus.target_count} "
                                          f"target — {corpus.abstract_only_count} abstract-only, "
                                          f"{corpus.metadata_only_count} metadata-only."})
        if corpus.qualifying_count > 0 and corpus.evidence_record_count == 0:
            evidence_gaps.append({"category": "zero_evidence_extracted",
                                   "gap": f"{corpus.qualifying_count} relevant document(s) were retrieved but "
                                          f"0 usable evidence records were extracted from them — this "
                                          f"formula version's architecture is not evidence-driven."})
        for qf in quality_gate:
            if qf.factor in ("critical_active_no_evidence", "unusual_concentration_no_evidence"):
                evidence_gaps.append({"category": qf.factor, "gap": qf.message})

        md = render_card(f, violations, strat.to_dict())
        with open(os.path.join(out_dir, card_filename(session_id, version)), "w", encoding="utf-8") as fh:
            fh.write(md)
        cards.append({
            "version": version, "status": "ok", "markdown": md, "formula": f, "violations": violations,
            "strategy": strat.to_dict(),
            "evidence_links": version_links,
            "concentration_alignment": alignment,
            "score": score.to_dict() if score else None,
            "generation_provenance": generation_provenance.to_dict(),
            "mass_balance": mass_balance.to_dict(),
            "ingredient_origins": ingredient_origins,
            "comparable_stats": comparable_stats,
            "quality_gate": [qf.to_dict() for qf in quality_gate],
            "research_corpus": {
                **corpus.to_dict(),
                "scientific_formulation_count": len(scientific_formulations),
                "scientific_formulation_with_outcomes_count": len({
                    o["source_formulation_id"] for o in scientific_outcomes
                }) if scientific_outcomes else 0,
            },
            "formula_state": formula_state,
            "missing_roles": result.missing_roles,
            "unresolved_requirements": result.unresolved_requirements,
            "manufacturing": manufacturing_plan.to_dict(),
            "validation_plan": [c.to_dict() for c in validation_checks],
            "trace_events": [e.to_dict() for e in result.trace_events],
            "evidence_gaps": evidence_gaps,
            "architecture_basis": result.architecture_basis,
            "portfolio_assignment": assignment.to_dict() if assignment else None,
        })

    # Cross-version diversity validation (architecture doc §9). Marks rather
    # than silently regenerates: regeneration would need its own retry/loop-
    # safety design this session does not build (see the module-level note
    # in strategy.py on why no repair/retry architecture exists yet).
    diversity = strategy.diversity_report(cards)
    log(f"diversity: {'sufficient' if diversity.sufficiently_diverse else 'INSUFFICIENT'} — {diversity.explanation}")
    if not diversity.sufficiently_diverse:
        for card in cards:
            if card.get("status") == "ok":
                card["formula"]["warnings"] = list(card["formula"].get("warnings") or []) + [
                    f"Diversity check: {diversity.explanation}",
                ]

    # FormuLab v1 correction (FVL-03) §14/§25: real, session-wide
    # architecture-source composition — which scientific formulations
    # this run actually USED (directly or adapted, by any generated
    # version) vs. which relevant applicable ones it did NOT, and why not.
    # Assembled entirely from data the cards above already computed —
    # never a second scan, never generic filler text.
    used_source_keys = {
        (c["architecture_basis"]["source_paper_doi"], c["architecture_basis"]["source_formulation_id"])
        for c in cards
        if c.get("architecture_basis", {}).get("origin") in (
            engine.ARCHITECTURE_SCIENTIFIC_DIRECT, engine.ARCHITECTURE_SCIENTIFIC_ADAPTED,
        )
    }
    architectures_used = []
    architectures_rejected = []
    for sf in scientific_formulations:
        key = (sf.get("doi", ""), sf.get("source_formulation_id", ""))
        entry = {"doi": sf.get("doi", ""), "source_title": sf.get("source_title", ""),
                 "source_formulation_id": sf.get("source_formulation_id", "")}
        if key in used_source_keys:
            architectures_used.append(entry)
        else:
            architectures_rejected.append(entry)
    all_rule_only = bool(cards) and all(
        c.get("architecture_basis", {}).get("origin") == engine.ARCHITECTURE_DETERMINISTIC_RULE for c in cards
    )
    scientific_formulation_summary = {
        "extracted_count": len(scientific_formulations),
        "with_outcomes_count": len({o["source_formulation_id"] for o in scientific_outcomes}) if scientific_outcomes else 0,
        "architectures_used": architectures_used,
        "architectures_rejected": architectures_rejected,
        "all_selected_versions_rule_only": all_rule_only,
        "rule_only_despite_applicable_scientific_formulation": bool(all_rule_only and scientific_formulations),
    }
    with open(os.path.join(lit_dir, "scientific_formulation_summary.json"), "w", encoding="utf-8") as fh:
        json.dump(scientific_formulation_summary, fh, ensure_ascii=False, indent=2)
    if scientific_formulation_summary["rule_only_despite_applicable_scientific_formulation"]:
        log(f"[note] every selected version is rule-only architecture despite "
            f"{len(scientific_formulations)} applicable scientific formulation(s) being available — "
            f"see scientific_formulation_summary.json for why each was rejected")

    with open(os.path.join(out_dir, "brief.json"), "w", encoding="utf-8") as fh:
        json.dump({"brief": brief, "constraints_reasons": constraints["reasons"]}, fh, ensure_ascii=False, indent=2)

    # The markdown files are for a person to read; `cards.json` is the same
    # data structured so `read_session` can return the real formula object,
    # violations, strategy metadata, per-version evidence links, and score on
    # reopen — not just the rendered markdown. Session-local only, not
    # archived to the formula library (archive_formulas keeps its own
    # index.json for that). Stays a flat JSON ARRAY at the top level —
    # formulation_v2.rs::read_cards requires that shape.
    with open(os.path.join(out_dir, "cards.json"), "w", encoding="utf-8") as fh:
        json.dump(cards, fh, ensure_ascii=False, indent=2)

    # Session-local, additive — never read by the existing Rust bridge, so
    # this cannot break backward compatibility with any old session.
    with open(os.path.join(out_dir, "diversity.json"), "w", encoding="utf-8") as fh:
        json.dump(diversity.to_dict(), fh, ensure_ascii=False, indent=2)

    # Phase 14 Session 6: the ONE genuinely new session-level artifact —
    # ingredient selection/rejection decision events, keyed by version,
    # exactly mirroring each card's own `trace_events` field so the same
    # data is inspectable without opening `cards.json`. Deliberately NOT
    # duplicated as a separate file — the same precedent `mass_balance`/
    # `quality_gate`/`manufacturing` already established; a second file
    # holding the identical data would be exactly the "same truth in
    # multiple conflicting files" this session's own brief warns against.
    # (`card["safety"]`/`card["regulatory"]` no longer exist at all —
    # FVL-03.009/.010 retired them; the authoritative safety/regulatory
    # results are computed client-side, see `generatedFormulaSafety.ts`/
    # `generatedFormulaRegulatory.ts`.)
    with open(os.path.join(out_dir, "traceability.json"), "w", encoding="utf-8") as fh:
        json.dump({"schema_version": 1, "versions": {c["version"]: c["trace_events"] for c in cards}},
                   fh, ensure_ascii=False, indent=2)

    slug = _slug(target)
    archived: List[str] = []
    ok_cards = [c for c in cards if c.get("status") == "ok"]
    if formulas_dir:
        try:
            archived = archive_formulas(formulas_dir, ok_cards, brief, slug, session_id)
            log(f"archived {len(archived)} formula(s) to the library")
        except Exception as e:
            # The library is a convenience copy — never fail a good run over it.
            log(f"[warn] could not archive to the formula library: {e}")

    # FormuLab v1 (FVL-02) §3: the requested count is a TARGET, never
    # permission to fabricate. `actual_formula_count` is the real number
    # of cards actually produced (one per genuinely-applicable strategy —
    # `strategy.derive_strategies()` itself already refuses to invent a
    # strategy with no real triggering signal, §5's own instruction); a
    # shortfall against `n` is disclosed with a real, specific reason,
    # never silently absorbed.
    actual_formula_count = len(cards)
    alternative_shortfall = max(0, n - actual_formula_count)
    shortfall_reason = ""
    if alternative_shortfall > 0:
        if len(strategies) < n:
            shortfall_reason = (
                f"Only {len(strategies)} of {n} requested strategies genuinely apply to this "
                f"request (`strategy.derive_strategies()` — no strategy is invented without a "
                f"real triggering signal in the brief/constraints)."
            )
        else:
            shortfall_reason = (
                "No defensible architecture (scientific or general evidence/deterministic-rule) "
                "remained for one or more requested slots after diversity adjustment."
            )
        log(f"[note] alternative shortfall: requested {n}, delivered {actual_formula_count} — {shortfall_reason}")

    # FormuLab v1 (FVL-02.009) — a distinct, independent signal from the
    # generic shortfall above: whether the delivered count itself fell
    # below the real minimum a "3-7 alternatives" request promises, never
    # conflated with (or overwriting) `status`'s own research-corpus
    # meaning. The real alternatives already built above are returned
    # exactly as-is either way — this never discards or pads them.
    formula_alternatives_status = (
        engine.FORMULA_ALTERNATIVES_SUFFICIENT
        if actual_formula_count >= engine.MIN_FORMULA_ALTERNATIVES
        else engine.FORMULA_ALTERNATIVES_INSUFFICIENT
    )
    if formula_alternatives_status == engine.FORMULA_ALTERNATIVES_INSUFFICIENT:
        log(f"[note] formula_alternatives_status=insufficient_formula_alternatives: "
            f"only {actual_formula_count} of a minimum {engine.MIN_FORMULA_ALTERNATIVES} "
            f"defensible alternative(s) were produced — real formulas returned as-is, "
            f"never padded to reach the minimum.")

    return {"status": "ok_partial_research" if partial_research else "ok", "cards": cards, "slug": slug,
            "papers": len(papers), "archived": archived, "diversity": diversity.to_dict(),
            "scientific_formulation_summary": scientific_formulation_summary,
            "requested_formula_count": n, "actual_formula_count": actual_formula_count,
            "alternative_shortfall": alternative_shortfall, "shortfall_reason": shortfall_reason,
            "formula_alternatives_status": formula_alternatives_status}
