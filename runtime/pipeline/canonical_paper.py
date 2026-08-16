"""Phase 14 Session 0 — CanonicalPaper schema, deduplication algorithm, and
the Findpapers/native-adapter boundary contract (architecture doc §3/§4).

**Not yet wired into the live pipeline.** `discover.py`/`literature_cache.py`/
`pipeline.py` are completely unchanged by this module and do not import it —
wiring real adapters and the orchestrator through this contract is Session
1's job (`docs/PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md` §12). This
module is dormant on its own: directly importable, directly testable, and
fixes the CONTRACT Session 1's real adapters/orchestrator must satisfy,
per the explicit Session 0 brief — "design the CanonicalPaper schema and
deduplication algorithm concretely, design the Findpapers-adapter boundary."

Audit finding this module's design is built on (see the architecture doc's
Session 0 closing note for the full write-up): the architecture doc's own
§0/§1 premise — "today it retrieves ... from exactly three sources —
OpenAlex, Europe PMC, arXiv" — describes `discover.py`'s CLI default
(`--sources openalex,europepmc,arxiv`), not the actual production path.
`literature_cache.gather()` — what `pipeline.py::run()` (and therefore the
real `generate_formulation` Tauri command) actually calls — defaults to
`"openalex,openaire,europepmc,crossref"`: OpenAlex, OpenAIRE, Europe PMC,
and Crossref, with arXiv deliberately EXCLUDED by default (its own comment:
"indexes physics/CS/math preprints and holds essentially no consumer-
formulation literature"). Two consequences for Session 1's adapter work:
Crossref already has a real, working native fetcher (`discover.fetch_crossref`)
— Session 1 should decide whether to keep it or replace it with Findpapers'
Crossref coverage, not assume it needs building from scratch. OpenAIRE has a
real, working native fetcher too (`discover.fetch_openaire`) but appears
nowhere in the architecture doc's §3 source list at all — it should be added
to the "native/specialized FormuLab adapters" list, not silently dropped
when Session 1 wires the orchestrator through this module.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Protocol, runtime_checkable


# --------------------------------------------------------- normalization ---

def normalize_doi(doi: str | None) -> str:
    """The one normalized-DOI form every dedup/lookup in this module uses —
    same rule `discover.py::_row()` already applies at fetch time, repeated
    here so this module never trusts a caller to have pre-normalized."""
    return (doi or "").strip().lower().replace("https://doi.org/", "")


def normalize_title(title: str | None) -> str:
    """Same normalization `discover.py`/`literature_cache.py` already use
    for their own flat dedup key — reused, not reinvented."""
    return re.sub(r"[^a-z0-9]+", " ", (title or "").lower()).strip()


def author_surnames(authors: str | None) -> set[str]:
    """A rough, deliberately simple surname set from a ';'- or ','-joined
    author string, for Tier-2 dedup's overlap check only.

    Does not attempt `pipeline.py::_surname`'s surname-first-vs-surname-last
    detection — that precision matters for a citation shown to a person, not
    here: Tier-2 dedup uses this set only as a secondary confirming signal
    alongside an exact title match (`deduplicate` below), so an occasional
    wrong single-name extraction only produces a missed merge (safe), never
    a false one — the failure mode this module is deliberately biased
    toward (see `deduplicate`'s own doc comment).
    """
    if not authors:
        return set()
    sep = ";" if ";" in authors else ","
    out: set[str] = set()
    for name in authors.split(sep):
        parts = [p for p in re.split(r"[.\s]+", name.strip()) if p]
        if parts:
            out.add(parts[-1].lower())
    return out


# ------------------------------------------------------------- the model ---

@dataclass(frozen=True)
class ProvenanceEntry:
    """One source's contribution to a `CanonicalPaper` — never discarded
    once deduplication picks a canonical representation (architecture doc
    §4: "every source that contributed to it is preserved as its own
    provenance entry ... never discarded")."""

    source: str
    """The provider name, e.g. "openalex" | "crossref" | "europepmc" |
    "arxiv" | "openaire" | a future Findpapers-routed or native adapter
    name — whatever `discover.py`'s `_row()`-shaped dict's `source_db` field
    already carries."""

    source_id: str
    """The source-native id this specific contribution can be looked up by
    — normalized DOI when the row has one, otherwise a normalized-title
    fallback (`_synthesized_source_id`) so every provenance entry has SOME
    stable id even for a DOI-less arXiv/OpenAIRE record."""

    retrieved_at: str
    """ISO 8601 timestamp of the fetch that produced this row. Empty string
    is valid (a caller that hasn't threaded a real clock through yet) —
    never fabricated by this module itself."""

    raw: Dict[str, Any]
    """The original fetched row, verbatim, never mutated — the same
    `discover.py::_row()`-shaped dict the adapter returned. This is what
    makes provenance real: a later session can always re-derive exactly
    what a source said, not just this module's summary of it."""


@dataclass
class CanonicalPaper:
    """One study, one record, regardless of how many sources returned it
    (architecture doc §4). Deliberately mirrors `discover.py::_row()`'s
    field set for the representative fields (`title`/`year`/`authors`/
    `venue`/`doi`/`is_oa`/`oa_url`/`abstract`) — this is the same shared
    result shape §3's "Adapter boundary rule" already established, extended
    with `sources` rather than replaced by a new shape."""

    title: str
    year: str
    authors: str
    venue: str
    doi: str
    """Normalized (see `normalize_doi`); `""` when genuinely absent from
    every contributing source, never a placeholder value."""
    is_oa: bool
    oa_url: str
    abstract: str
    sources: List[ProvenanceEntry] = field(default_factory=list)

    @property
    def source_names(self) -> List[str]:
        return [p.source for p in self.sources]

    @property
    def unique_source_count(self) -> int:
        """How many *distinct* providers contributed — architecture doc §5:
        "provider agreement across sources for the same study improves
        provenance/metadata confidence, it does NOT multiply the underlying
        experimental evidence count." This is the number to show for that
        confidence signal; it is never the evidence count itself."""
        return len(set(self.source_names))


# -------------------------------------------------- adapter boundary rule ---

@runtime_checkable
class LiteratureAdapter(Protocol):
    """The Findpapers-adapter boundary (architecture doc §3's "Adapter
    boundary rule"): the single Findpapers-wrapping adapter and every native
    adapter (CORE/DOAJ/Europe PMC/BASE/Unpaywall, and OpenAIRE per this
    module's own audit finding above) alike must return this ONE shape
    before touching `deduplicate` or any other FormuLab business logic.

    `discover.py`'s existing fetchers (`fetch_openalex`, `fetch_crossref`,
    `fetch_europepmc`, `fetch_openaire`, `fetch_arxiv`) already satisfy this
    contract structurally — each returns a `List[Dict]` of `_row()`-shaped
    rows — this `Protocol` names that existing, working shape as the
    boundary Session 1's new adapters must match, not a new one to migrate
    the old fetchers onto.
    """

    def search(self, query: str, max_results: int) -> List[Dict[str, Any]]:
        """Returns `_row()`-shaped dicts: `source_db`, `title`, `year`,
        `authors`, `venue`, `doi`, `is_oa`, `oa_url`, `cited_by`,
        `concepts`, `abstract` — the exact keys `discover.py::_row()`
        already produces."""
        ...


# ------------------------------------------------------------ known sources -

# Session 0's confirmed decision (architecture doc Risks items 1-2) on which
# planned sources are real for THIS installation, checked directly rather
# than assumed: no IEEE Xplore / Scopus / Web of Science API key, base URL,
# or institutional-proxy configuration exists anywhere in this codebase
# (`llm.py`'s provider table is the only external-API credential registry
# this pipeline has, and none of the three appear in it); no Google Scholar
# integration of any kind — scraping-based or otherwise — exists either.
# Session 1 should build adapters only for the "existing"/"planned_*" rows
# below; the "unavailable" rows stay unbuilt until real credentials or a
# legitimate integration path are actually available, per the architecture
# doc's own explicit allowance ("may mean 'not available to this
# installation at all'"). The orchestrator (Session 1) must work correctly
# with every "unavailable" row absent, exactly as §3 already requires for
# Google Scholar specifically.
SOURCE_AVAILABILITY: Dict[str, Dict[str, str]] = {
    "openalex": {"status": "existing", "note": "discover.fetch_openalex, already live and default-on"},
    "openaire": {"status": "existing", "note": "discover.fetch_openaire, already live and default-on — not currently listed in architecture doc §3 at all"},
    "europepmc": {"status": "existing", "note": "discover.fetch_europepmc, already live and default-on"},
    "crossref": {"status": "existing", "note": "discover.fetch_crossref, already live and default-on — architecture doc §3 lists it under Findpapers, but a working native fetcher already exists; Session 1 decision: kept native (see this module's own Session 1 note below)"},
    "arxiv": {"status": "existing_not_default", "note": "discover.fetch_arxiv exists but is deliberately excluded from literature_cache.gather()'s default sources (too much off-domain preprint noise for consumer-formulation queries)"},
    "doaj": {"status": "existing", "note": "discover.fetch_doaj — Session 1: built and confirmed working, keyless, against the live API; added to literature_cache.gather()'s default sources"},
    "unpaywall": {"status": "existing", "note": "discover.resolve_unpaywall_oa — Session 1: built and confirmed working, keyless, against the live API; wired as an OA-location RESOLVER (literature_cache.backfill_oa_via_unpaywall), never a search source, per its own real purpose"},
    "semantic_scholar": {"status": "existing_not_default", "note": "discover.fetch_semantic_scholar — Session 1: built and confirmed reachable, but a live unauthenticated test hit HTTP 429 within the first call; kept off literature_cache.gather()'s default sources until a request key exists (none configured — llm.py's provider table is this pipeline's only credential registry and does not have one), available as an explicit opt-in via the `sources` parameter"},
    "pubmed": {"status": "planned_findpapers", "note": "not built directly; Europe PMC's europepmc source already covers PubMed/MED records today, so a real incremental-coverage comparison is still needed before building a separate adapter — unchanged from Session 0's own caution"},
    "core": {"status": "unavailable", "note": "Session 1: tested live — an unauthenticated request to api.core.ac.uk/v3 fails outright (connection refused); CORE v3 requires an API key this installation does not have"},
    "base": {"status": "unavailable", "note": "Session 1: tested live — api.base-search.net returned \"Access denied for IP address ... and user agent ...\" for an unauthenticated request (with and without a descriptive User-Agent); this installation is not registered/allow-listed"},
    "ieee_xplore": {"status": "unavailable", "note": "no API key/base-URL/institutional-proxy configuration exists anywhere in this codebase; institution-licensed access this installation does not have"},
    "scopus": {"status": "unavailable", "note": "no API key/base-URL/institutional-proxy configuration exists anywhere in this codebase; institution-licensed access this installation does not have"},
    "web_of_science": {"status": "unavailable", "note": "no API key/base-URL/institutional-proxy configuration exists anywhere in this codebase; institution-licensed access this installation does not have"},
    "google_scholar": {"status": "unavailable", "note": "no official public API exists industry-wide; no scraping-based integration exists in this codebase either, and building one would be the ToS-risk architecture doc §3 explicitly cautions against — stays optional/last-resort and absent unless a legitimate integration path is found later"},
    "findpapers": {"status": "existing_not_bundled", "note": "findpapers_adapter.py — Session 1: real FormuLab-owned adapter, lazy-imports the `findpapers` PyPI package at call time so its absence never breaks discovery; NOT embedded into the desktop app's materialize_pipeline() (formulation_v2.rs's include_str! files are pure-stdlib by design — findpapers pulls in its own third-party dependency tree), so it activates only when a caller's own Python interpreter happens to have it pip-installed (e.g. a dev/CLI run against kernel::python_bin's resolved interpreter, never the embedded desktop bundle). Not installed in this session's environment (confirmed: `import findpapers` raises ModuleNotFoundError)"},
}


# --------------------------------------------------------- deduplication ---

def _synthesized_source_id(row: Dict[str, Any]) -> str:
    """No DOI: fall back to a normalized-title id so every provenance entry
    still has SOME stable, source-scoped lookup key."""
    return normalize_title(row.get("title")) or "untitled"


def _merge_group(doi: str, group: List[Dict[str, Any]], source_key: str, fetched_at: str) -> CanonicalPaper:
    """One `CanonicalPaper` from a group of rows already confirmed to be the
    same real study. The representative record is the row with the longest
    abstract (the richest single metadata source) — ties keep the
    first-seen row, so the result is deterministic for a given input order."""
    rep = max(group, key=lambda r: len(r.get("abstract") or ""))
    sources = [
        ProvenanceEntry(
            source=str(r.get(source_key, "unknown")),
            source_id=normalize_doi(r.get("doi")) or _synthesized_source_id(r),
            retrieved_at=fetched_at,
            raw=r,
        )
        for r in group
    ]
    is_oa = any(bool(r.get("is_oa")) for r in group)
    # An OA url specifically, not just any url — prefer a row that is BOTH
    # marked open access AND actually carries a link, falling back to the
    # representative row's own url only if nothing in the group qualifies.
    oa_url = next((r.get("oa_url") or "" for r in group if r.get("is_oa") and r.get("oa_url")), "") or (rep.get("oa_url") or "")
    return CanonicalPaper(
        title=rep.get("title") or "",
        year=str(rep.get("year") or ""),
        authors=rep.get("authors") or "",
        venue=rep.get("venue") or "",
        doi=doi,
        is_oa=is_oa,
        oa_url=oa_url,
        abstract=rep.get("abstract") or "",
        sources=sources,
    )


def deduplicate(
    rows: List[Dict[str, Any]],
    source_key: str = "source_db",
    fetched_at: str = "",
) -> List[CanonicalPaper]:
    """One `CanonicalPaper` per real study, full provenance preserved
    (architecture doc §4's deduplication-key priority order):

    **Tier 1 — DOI exact match.** Rows sharing the same non-empty
    normalized DOI merge into one `CanonicalPaper`, regardless of source.

    **Tier 2 — no DOI on either side.** Rows with an empty DOI merge only
    when BOTH the normalized title matches exactly AND at least one author
    surname overlaps — two independent, individually-weak signals combined
    into one considerably stronger one, rather than trusting either alone
    (a title-only match risks merging two different studies that happen to
    share a generic title; an author-only match risks merging two different
    papers by a common-surnamed author).

    **Tier 3 — the documented fallback** (architecture doc §4 explicitly
    defers the exact similarity-threshold algorithm for "the remaining
    ambiguous cases" past this document, not past this session): anything
    that clears neither tier stays its own distinct `CanonicalPaper`, never
    guessed into a merge on a single weak signal. This is a deliberate,
    documented bias — a missed merge only costs a little provenance
    completeness (a duplicate the model sees as two entries instead of one,
    correctable by a future, stronger algorithm); a WRONG merge would
    silently inflate an evidence count or narrow a concentration range with
    two different studies' data pooled as one (architecture doc §5's
    explicit warning) — the more dangerous failure mode by far, so this
    algorithm is deliberately conservative in its favor.

    Deterministic for a given input order: does not depend on set/dict
    iteration order for anything user-visible (dedup keys are computed
    directly from `rows`, not from an intermediate unordered structure the
    result depends on).
    """
    doi_groups: Dict[str, List[Dict[str, Any]]] = {}
    doi_order: List[str] = []
    no_doi: List[Dict[str, Any]] = []
    for row in rows:
        doi = normalize_doi(row.get("doi"))
        if doi:
            if doi not in doi_groups:
                doi_groups[doi] = []
                doi_order.append(doi)
            doi_groups[doi].append(row)
        else:
            no_doi.append(row)

    canonical: List[CanonicalPaper] = [
        _merge_group(doi, doi_groups[doi], source_key, fetched_at) for doi in doi_order
    ]

    used = [False] * len(no_doi)
    for i, row in enumerate(no_doi):
        if used[i]:
            continue
        used[i] = True
        group = [row]
        title_i = normalize_title(row.get("title"))
        authors_i = author_surnames(row.get("authors"))
        if title_i:
            for j in range(i + 1, len(no_doi)):
                if used[j]:
                    continue
                other = no_doi[j]
                if normalize_title(other.get("title")) == title_i and authors_i & author_surnames(other.get("authors")):
                    group.append(other)
                    used[j] = True
        canonical.append(_merge_group("", group, source_key, fetched_at))

    return canonical
