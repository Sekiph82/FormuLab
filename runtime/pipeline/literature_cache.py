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

_STOP = {"a", "an", "the", "for", "of", "and", "or", "to", "in", "on", "with", "formulation"}


def _terms(text: str) -> List[str]:
    return [w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(w) > 2 and w not in _STOP]


def score(paper: Dict[str, Any], query_terms: List[str]) -> int:
    hay = f"{paper.get('title','')} {paper.get('abstract','')} {paper.get('concepts','')}".lower()
    return sum(1 for t in set(query_terms) if t in hay)


def search_cache(queries: List[str], index: List[Dict[str, Any]], want: int) -> List[Dict[str, Any]]:
    """Rank cached papers by overlap with the queries; return the relevant top-`want`."""
    qterms: List[str] = []
    for q in queries:
        qterms += _terms(q)
    scored = [(score(p, qterms), p) for p in index]
    # A paper is "relevant" if it shares at least 2 query terms.
    hits = [p for s, p in sorted(scored, key=lambda sp: sp[0], reverse=True) if s >= 2]
    return hits[:want]


# ---------------------------------------------------------------- gather ------

def gather(
    queries: List[str],
    out_dir: str,
    library: str,
    target: int = 15,
    sources: str = "openalex,europepmc,arxiv",
    log: Callable[[str], None] = lambda m: None,
) -> List[Dict[str, Any]]:
    """Return >=`target` relevant papers, cache-first.

    1. Search the shared library. 2. If short, fetch the shortfall from the open
    APIs, dedup, and add new papers to the shared index (+ session). 3. Write the
    session's papers.csv/json.
    """
    os.makedirs(out_dir, exist_ok=True)
    index = load_index(library)
    seen = {paper_key(p) for p in index}

    selected = search_cache(queries, index, target)
    log(f"cache: {len(selected)}/{target} relevant papers from the shared library")

    if len(selected) < target:
        discover = _load_fetchers()
        srcs = [s.strip() for s in sources.split(",") if s.strip() in discover.FETCHERS]
        new: List[Dict[str, Any]] = []
        selected_keys = {paper_key(p) for p in selected}
        for q in queries:
            if len(selected) + len(new) >= target:
                break
            for src in srcs:
                try:
                    rows = discover.FETCHERS[src](q, target)
                except Exception as e:
                    log(f"  [warn] {src} failed: {e}")
                    continue
                for row in rows:
                    k = paper_key(row)
                    if not k or k in selected_keys or k in {paper_key(x) for x in new}:
                        continue
                    if not discover.is_relevant(row):
                        continue
                    new.append(row)
                    if k not in seen:
                        seen.add(k)
                        index.append(row)  # grow the shared library
        log(f"fetched {len(new)} new papers from the open APIs")
        selected += new

    selected = selected[:max(target, len(selected))]
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
