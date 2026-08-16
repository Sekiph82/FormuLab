"""Phase 14 Session 1 — the Findpapers-wrapping adapter (architecture doc §3's
"Findpapers adapter", `canonical_paper.LiteratureAdapter` boundary).

FormuLab must not depend directly on Findpapers-specific result structures in
business logic (Session 1 brief §H) — this module is the one place that talks
to `findpapers` at all; everywhere else in this pipeline only ever sees
`discover.py::_row()`-shaped dicts, exactly like every native fetcher already
produces.

**Not embedded into the desktop app.** `apps/desktop/src-tauri/src/
formulation_v2.rs`'s `materialize_pipeline()` embeds this pipeline's `.py`
files via `include_str!` and writes them into an app-private directory — a
deliberately pure-stdlib design (no `pip install` step exists for that
embedded copy). `findpapers` is a real PyPI package with its own dependency
tree (requests, lxml, xylose, fake-useragent, …), so it cannot be added to
that embedded set without a fundamentally different packaging model — a
change out of this session's scope, and one this module does not silently
assume. `import findpapers` is therefore lazy, inside `search()`, so this
module's own import never fails even when `findpapers` isn't installed; it
only activates for a caller running against a full Python environment that
happens to have it pip-installed (`apps/desktop/src-tauri/src/kernel.rs`'s
`python_bin()` resolves to the user's own interpreter, not a bundled one, so
this is a real, reachable path outside the shipped desktop bundle — a dev/CLI
run, for instance — not a purely theoretical one).

Scope, per `canonical_paper.SOURCE_AVAILABILITY`'s own recorded decisions:
OpenAlex and Crossref already have working, preferred native fetchers
(`discover.fetch_openalex`/`fetch_crossref`) — Session 1's keep-vs-replace
call is to KEEP them (proven, zero-dependency, no reason to route through a
third-party wrapper). arXiv has a native fetcher too, deliberately off by
default. PubMed is judged likely-redundant with Europe PMC's own MED
coverage, unconfirmed either way. IEEE Xplore/Scopus/Web of Science are
confirmed unavailable to this installation (Session 0). That leaves
**Semantic Scholar** as the one Findpapers-listed source this module
meaningfully adds when available — and Semantic Scholar already has its own
free-standing native fetcher too (`discover.fetch_semantic_scholar`, built
this session against the live API), so this adapter's real remaining value is
as a working example of the boundary itself and a fallback path, not a
source FormuLab has no other way to reach.
"""

from __future__ import annotations

from typing import Any, Dict, List


def findpapers_available() -> bool:
    """Whether `findpapers` is importable in THIS process's interpreter right
    now — checked, never assumed (the same evidentiary standard Session 0
    applied to IEEE/Scopus/Web of Science/Google Scholar)."""
    try:
        import findpapers  # noqa: F401
    except ImportError:
        return False
    return True


def _publication_to_row(pub: Any) -> Dict[str, Any]:
    """A `findpapers` `Publication` object (or the dict shape its own search
    index serializes to) into the one shared `_row()` shape every adapter —
    native or Findpapers-routed — must return (architecture doc §3's
    "Adapter boundary rule")."""
    get = (lambda k, default=None: getattr(pub, k, default)) if not isinstance(pub, dict) else pub.get
    authors = get("authors") or []
    doi = get("doi") or ""
    urls = get("urls") or []
    return {
        "source_db": "findpapers",
        "title": (get("title") or "").strip(),
        "year": get("publication_date").year if get("publication_date") and hasattr(get("publication_date"), "year") else (get("year") or ""),
        "authors": "; ".join(authors) if isinstance(authors, list) else str(authors or ""),
        "venue": getattr(get("publication"), "title", "") if get("publication") else (get("venue") or ""),
        "doi": str(doi).replace("https://doi.org/", "").lower().strip(),
        "is_oa": bool(get("is_open_access") or get("is_oa")),
        "oa_url": next(iter(urls), "") if urls else (get("oa_url") or ""),
        "cited_by": get("citations") or get("cited_by") or 0,
        "concepts": "",
        "abstract": (get("abstract") or "").strip(),
    }


class FindpapersAdapter:
    """Implements `canonical_paper.LiteratureAdapter` — `search(query,
    max_results) -> List[Dict]`, `_row()`-shaped. Restricted to the databases
    Findpapers itself supports that this pipeline has no better native
    coverage for (see module docstring) — never IEEE Xplore/Scopus/Web of
    Science, which stay recorded `"unavailable"` regardless of what
    Findpapers itself might attempt."""

    DATABASES = ("Semantic Scholar",)

    def search(self, query: str, max_results: int) -> List[Dict[str, Any]]:
        if not findpapers_available():
            return []
        import tempfile
        import os
        import findpapers

        with tempfile.TemporaryDirectory() as tmp:
            outfile = os.path.join(tmp, "findpapers_search.json")
            try:
                findpapers.search(
                    outfile, query, limit=max_results,
                    databases=list(self.DATABASES),
                )
                result = findpapers.load_search_results(outfile) if hasattr(findpapers, "load_search_results") else None
            except Exception:
                return []
        if result is None:
            return []
        papers = getattr(result, "papers", None) or []
        return [_publication_to_row(p) for p in papers][:max_results]
