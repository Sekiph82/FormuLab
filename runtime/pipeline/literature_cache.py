"""Shared literature cache for FormuLab v2.

Every paper we retrieve is kept in ONE shared library (metadata index + OA PDFs),
separate from any session. On a new query we search that library FIRST; only if
it can't supply the target number of relevant sources do we hit the open APIs
(OpenAlex + Europe PMC + arXiv) for the shortfall, then fold the new papers back
into both the shared library and the session. This makes repeat/related queries
fast and offline-friendly, and cuts API load.

Layout (LIBRARY dir, shared):
    index.json        # list of paper dicts (dedup by DOI or normalized title)
    pdfs/<doi>.pdf    # downloaded OA PDFs

Per-session (OUT dir):
    papers.csv / papers.json   # the set actually used for this run
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
from typing import Any, Callable, Dict, List

# Reuse the retrieval fetchers + relevance filter from the discovery script.
_DISCOVERY = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "skills", "core", "formulation-discovery",
)


def _load_fetchers():
    if _DISCOVERY not in sys.path:
        sys.path.insert(0, _DISCOVERY)
    import discover  # noqa: E402
    return discover


def norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()


def paper_key(p: Dict[str, Any]) -> str:
    return (p.get("doi") or "").lower().strip() or norm_title(p.get("title", ""))


# ------------------------------------------------------------- shared index ---

def load_index(library: str) -> List[Dict[str, Any]]:
    path = os.path.join(library, "index.json")
    if os.path.isfile(path):
        try:
            with open(path, encoding="utf-8") as fh:
                return json.load(fh)
        except Exception:
            return []
    return []


def save_index(library: str, papers: List[Dict[str, Any]]) -> None:
    os.makedirs(library, exist_ok=True)
    with open(os.path.join(library, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(papers, fh, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------- ranking -----

# Words that carry no discriminating power for THIS domain. Generic research
# vocabulary ("evaluation", "active", "system") must not count toward topical
# overlap: without this, "On the Evaluation Criterions for the Active Learning
# Processes" matches a limescale-remover query on two terms and is accepted.
_STOP = {
    "a", "an", "the", "for", "of", "and", "or", "to", "in", "on", "with",
    # formulation jargon — true of every paper we want AND many we don't
    "formulation", "formulations", "preparation", "ingredient", "ingredients",
    "active", "actives", "composition", "system", "systems", "agent", "agents",
    # research boilerplate
    "study", "studies", "evaluation", "efficacy", "analysis", "assessment",
    "performance", "properties", "property", "effect", "effects", "method",
    "methods", "application", "applications", "review", "novel", "new",
    "using", "based", "development", "characterization", "optimization",
}


def _terms(text: str) -> List[str]:
    return [w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(w) > 2 and w not in _STOP]


def score(paper: Dict[str, Any], query_terms: List[str]) -> int:
    hay = f"{paper.get('title','')} {paper.get('abstract','')} {paper.get('concepts','')}".lower()
    return sum(1 for t in set(query_terms) if t in hay)


def topical(paper: Dict[str, Any], query_terms: List[str]) -> bool:
    """Does the paper actually share the QUERY's subject, not just formulation jargon?

    discover.is_relevant only asks "does this look like a formulation paper?",
    and its term list is generic enough ("formulation", "active", "composition")
    that a gauge-theory preprint titled "Unified formulation for … spin fields"
    passes. Fetched papers must clear the same topical bar the cache path uses,
    or off-domain preprints get fed to the model as evidence.
    """
    need = 2 if len(set(query_terms)) >= 3 else 1
    return score(paper, query_terms) >= need


def anchored(paper: Dict[str, Any], anchor_terms: List[str]) -> bool:
    """Is the paper about THIS product at all?

    Each angle query drifts toward its own sub-topic ("preservative stability",
    "hard water"), so per-angle overlap alone lets off-domain work in. Every
    accepted paper must also share the product's own vocabulary (target +
    category) — that is what keeps a limescale query away from spin fields.
    """
    if not anchor_terms:
        return True
    return score(paper, anchor_terms) >= 1


def search_cache(
    queries: List[str],
    index: List[Dict[str, Any]],
    want: int,
    anchor_terms: List[str] | None = None,
) -> List[Dict[str, Any]]:
    """Rank cached papers by overlap with the queries; return the relevant top-`want`."""
    qterms: List[str] = []
    for q in queries:
        qterms += _terms(q)
    anchor = anchor_terms or []
    scored = [(score(p, qterms), p) for p in index if anchored(p, anchor)]
    # A paper is "relevant" if it shares at least 2 query terms.
    hits = [p for s, p in sorted(scored, key=lambda sp: sp[0], reverse=True) if s >= 2]
    return hits[:want]


# ---------------------------------------------------------------- gather ------

def gather(
    queries: List[str],
    out_dir: str,
    library: str,
    target: int = 15,
    # arXiv is deliberately NOT a default source. It indexes physics/CS/math
    # preprints and holds essentially no consumer-formulation literature, so it
    # contributes noise that merely shares a word: a "limescale remover" query
    # pulls back image-inpainting "object remover" and watermark-removal papers.
    # OpenAlex carries the chemistry and Europe PMC the biomed + patent side.
    # Fewer, on-domain sources beat a padded list.
    sources: str = "openalex,europepmc",
    anchor: str = "",
    log: Callable[[str], None] = lambda m: None,
) -> List[Dict[str, Any]]:
    """Return >=`target` relevant papers, cache-first.

    1. Search the shared library. 2. If short, fetch the shortfall from the open
    APIs, dedup, and add new papers to the shared index (+ session). 3. Write the
    session's papers.csv/json.
    """
    os.makedirs(out_dir, exist_ok=True)
    index = load_index(library)
    anchor_terms = _terms(anchor)

    cached = search_cache(queries, index, target, anchor_terms)
    if len(cached) >= target:
        # The shared library already covers this query — use it, no API call.
        log(f"cache: {len(cached)} relevant papers from the shared library (no API needed)")
        selected = cached[:target]
    else:
        # Not enough in the library: fetch a FRESH set of `target` NEW papers
        # (deduped against the whole library so they are genuinely new) for this
        # session, and add them to the shared library.
        log(f"cache: only {len(cached)}/{target} in the library — fetching {target} new from the open APIs")
        discover = _load_fetchers()
        srcs = [s.strip() for s in sources.split(",") if s.strip() in discover.FETCHERS]
        lib_keys = {paper_key(p) for p in index}
        new: List[Dict[str, Any]] = []
        new_keys: set = set()

        # Spread the budget over the ANGLES, not over the sources: the point is
        # to cover different questions, and the sources are NOT equally
        # authoritative for formulation work. OpenAlex is multidisciplinary and
        # carries the chemistry; Europe PMC covers the derm/biomed angle; arXiv
        # is mostly physics/CS preprints and is a last resort here — giving it an
        # equal share drowns a consumer-chemistry query in irrelevant preprints.
        #
        # So: walk sources best-first, and within each source ask every angle,
        # capped so one angle cannot monopolise the quota. A strong source fills
        # the budget across all angles; weaker ones only top up what is missing.
        priority = {"openalex": 0, "europepmc": 1, "arxiv": 2}
        srcs.sort(key=lambda s: priority.get(s, 99))
        pairs = [(q, src) for src in srcs for q in queries]
        per_pair = max(2, -(-target // max(1, len(queries))))  # ceil, floor of 2
        per_source: Dict[str, int] = {}
        for q, src in pairs:
            if len(new) >= target:
                break
            try:
                rows = discover.FETCHERS[src](q, target)
            except Exception as e:
                log(f"  [warn] {src} failed: {e}")
                continue
            taken = 0
            qterms = _terms(q)
            for row in rows:
                if taken >= per_pair or len(new) >= target:
                    break
                k = paper_key(row)
                if not k or k in lib_keys or k in new_keys:
                    continue
                # NOTE: discover.is_relevant is deliberately NOT used here. It
                # asks "does this contain formulation jargon?", which rejects
                # genuine domain papers ("Removal and prevention of limescale in
                # plumbing tubes" has no such vocabulary) while admitting any
                # preprint containing the word "formulation". anchored() +
                # topical() test the thing we actually care about: is this paper
                # about this product, and about this angle.
                if not topical(row, qterms) or not anchored(row, anchor_terms):
                    continue
                new.append(row)
                new_keys.add(k)
                index.append(row)  # grow the shared library
                taken += 1
                per_source[src] = per_source.get(src, 0) + 1
        spread = ", ".join(f"{s}:{n}" for s, n in sorted(per_source.items())) or "none"
        log(f"fetched {len(new)} new papers across {len(queries)} angles ({spread})")
        # Fresh-preferred, but always deliver up to `target`: if the deduped
        # fresh batch is short (the APIs returned mostly already-cached work),
        # top up from the ranked cache so the session never has FEWER sources
        # than the library already held.
        selected = new[:target]
        if len(selected) < target:
            have = {paper_key(p) for p in selected}
            for p in cached:
                if len(selected) >= target:
                    break
                if paper_key(p) not in have:
                    selected.append(p)
                    have.add(paper_key(p))
            log(f"topped up from cache -> {len(selected)} papers "
                f"({len(new)} fresh + {len(selected) - len(new)} cached)")

    save_index(library, index)

    # Session copy.
    fields = ["source_db", "title", "year", "authors", "venue", "doi", "is_oa", "oa_url", "cited_by", "concepts"]
    with open(os.path.join(out_dir, "papers.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(selected)
    with open(os.path.join(out_dir, "papers.json"), "w", encoding="utf-8") as fh:
        json.dump(selected, fh, ensure_ascii=False, indent=2)
    return selected
