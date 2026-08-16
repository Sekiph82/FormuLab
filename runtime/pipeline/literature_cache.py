"""Shared literature cache for FormuLab v2.

Every paper we retrieve is kept in ONE shared library (metadata index + OA PDFs),
separate from any session. On a new query we search that library FIRST; only if
it can't supply the target number of relevant sources do we hit the open APIs
(default: OpenAlex, OpenAIRE, Europe PMC, Crossref, DOAJ — arXiv and Semantic
Scholar are real, working sources kept OFF by default, see `gather()`'s own
doc comment for why) for the shortfall, then fold the new papers back into both
the shared library and the session. This makes repeat/related queries fast and
offline-friendly, and cuts API load.

Cross-source duplicates (the same real paper returned by more than one source
in one `gather()` call) are merged into one `CanonicalPaper` with full
per-source provenance preserved (`canonical_paper.py`, wired in Phase 14
Session 1) — never silently discarded, and never double-counted as two
independent pieces of evidence for the same study.

Layout (LIBRARY dir, shared):
    index.json        # list of paper dicts (dedup by DOI or normalized title)
    pdfs/<doi>.pdf    # downloaded OA PDFs

Per-session (OUT dir):
    papers.csv / papers.json   # the set actually used for this run
"""

from __future__ import annotations

import concurrent.futures
import csv
import json
import os
import re
import shutil
import sys
import urllib.request
from typing import Any, Callable, Dict, List

import fulltext
from canonical_paper import deduplicate as _canonical_deduplicate

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


def _flatten_canonical(rep_row: Dict[str, Any], group: List[Dict[str, Any]]) -> Dict[str, Any]:
    """One `_row()`-shaped flat dict for a group of raw rows already confirmed
    to share one `paper_key()` (architecture doc §4/§10, `canonical_paper.py`
    Session 0's own dedup contract, wired into the real pipeline this
    session). `group` of length 1 is the common case (no cross-source
    duplicate this run) and returns `rep_row` itself, unmodified but for the
    two additive fields below — cheap, and avoids ever needing to call
    `deduplicate()` for the overwhelming majority of rows.

    Every existing downstream consumer (`papers.csv`'s fixed `fields` list,
    `pipeline.py::_paper_context`/`verify_references`, `fulltext.py`) reads
    this by the SAME keys `discover.py::_row()` has always produced — this
    function only ADDS `unique_source_count`/`provenance_sources`, it never
    renames or drops an existing key, so nothing downstream needs to change.
    """
    if len(group) == 1:
        out = dict(rep_row)
        out.setdefault("unique_source_count", 1)
        out.setdefault("provenance_sources", [rep_row.get("source_db", "")])
        return out
    canonical = _canonical_deduplicate(group, source_key="source_db")
    # Tier 1 (shared DOI) always merges a paper_key-matched group into exactly
    # one CanonicalPaper. Tier 2 (title+author overlap) can, rarely, decide two
    # DOI-less rows sharing a normalized title are NOT the same study (no
    # author overlap) — canonical_paper.py's own documented conservative bias.
    # That is a real, tier-confirmed judgment, not a bug: this function still
    # returns exactly one flattened row (so `new`'s cardinality/budget
    # accounting in `gather()` above is never disturbed by it), using the
    # first CanonicalPaper — the same `_merge_group` representative-selection
    # rule (richest abstract) canonical_paper.py already applies internally.
    cp = canonical[0]
    base = dict(cp.sources[0].raw) if cp.sources else dict(rep_row)
    base.update({
        "title": cp.title, "year": cp.year, "authors": cp.authors,
        "venue": cp.venue, "doi": cp.doi, "is_oa": cp.is_oa,
        "oa_url": cp.oa_url, "abstract": cp.abstract,
    })
    base["unique_source_count"] = cp.unique_source_count
    base["provenance_sources"] = cp.source_names
    return base


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

# How many candidates to line up per paper we want to end up reading. Most
# search hits are paywalled or blocked, so reaching 15 full texts takes a pool
# several times that size; too small a factor silently returns a thin session.
POOL_FACTOR = 8

# Rows to request from one database for one angle. Large enough to be worth the
# round trip, small enough that OpenAlex does not answer with a 429.
PAGE_SIZE = 40


def _pdf_name(paper: Dict[str, Any], i: int) -> str:
    base = (paper.get("doi") or f"{paper.get('source_db', 'src')}-{i}").strip().lower()
    return re.sub(r"[^a-z0-9._-]+", "_", base)[:120] + ".pdf"


def sniff_fulltext(head: bytes, content_type: str = "") -> str | None:
    """Classify a response body as "pdf", "xml", or None (not an article).

    Only the real thing is kept. A landing page is HTML and must NEVER be saved
    — it is not the paper, and a folder of .html stubs is worse than an empty
    one. Full-text XML is not always a clean "<?xml" either: Europe PMC serves
    JATS starting with a newline and "<!DOCTYPE article ...", which a naive
    magic-byte check rejects even though it IS the article.
    """
    if head[:4] == b"%PDF":
        return "pdf"
    start = head.lstrip()[:400].lower()
    # HTML in any guise (including XHTML that opens with an XML declaration).
    if b"<!doctype html" in start or start.startswith(b"<html") or b"<html" in start[:200]:
        return None
    if "text/html" in content_type.lower():
        return None
    if start.startswith((b"<?xml", b"<!doctype article", b"<article")):
        return "xml"
    return None


def _download_fulltext(url: str, dest: str, timeout: int = 30) -> tuple[str | None, str]:
    """Fetch one open-access full text.

    Returns (path_written, reason). Accepts a PDF or the JATS XML Europe PMC's
    REST service serves for PMC articles (the sanctioned route, and richer than
    a PDF). Anything else is a landing page and is discarded rather than saved
    as a junk file. The reason is recorded per paper so a session can explain
    why it has 15 references but fewer files.
    """
    req = urllib.request.Request(url, headers={"User-Agent": "FormuLab/1.0 (formulation research)"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            head = r.read(512)
            kind = sniff_fulltext(head, r.headers.get("Content-Type", ""))
            if kind is None:
                return None, "link is a landing page, not the article"
            body = r.read()
            if kind == "xml":
                # Store the article as readable Markdown rather than raw JATS:
                # the folder is for a person to open, and .xml reads as markup.
                text = fulltext.jats_to_markdown(head + body)
                if not text:
                    return None, "full text could not be converted"
                dest = (dest[:-4] if dest.endswith(".pdf") else dest) + ".md"
                head, body = text.encode("utf-8"), b""
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return None, "publisher blocks automated download"
        return None, f"link returned HTTP {e.code}"
    except Exception as e:
        return None, f"download failed ({type(e).__name__})"
    tmp = dest + ".part"
    try:
        with open(tmp, "wb") as fh:
            fh.write(head)
            fh.write(body)
        os.replace(tmp, dest)
    except Exception:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
        return None, "could not write the file"
    return dest, "full text saved"


# How many candidates one gather() call may ask Unpaywall about. Unpaywall's
# own usage policy is generous (their public dataset dump is meant for bulk
# use; the live API is fine for this), but this is a per-DOI lookup, not a
# batch endpoint — bounding it keeps one gather() call's worst case sane
# rather than firing a request per candidate in a large pool.
UNPAYWALL_BACKFILL_CAP = 20


def backfill_oa_via_unpaywall(
    candidates: List[Dict[str, Any]],
    cap: int = UNPAYWALL_BACKFILL_CAP,
    resolve: Callable[[str], Dict[str, Any] | None] | None = None,
    log: Callable[[str], None] = lambda m: None,
) -> int:
    """Discovery and full-text access are separate stages (architecture doc
    §K/Session 1 brief): a source finding a paper's metadata does not by
    itself mean a legal OA copy is known. This fills that specific gap —
    ONLY for a candidate that already has a DOI but no usable `oa_url` — by
    asking Unpaywall (the OA-location resolver, not a search source) for a
    better location, exactly as its own real purpose is. Never touches a
    candidate that already has a usable link: this backfills a genuine gap,
    it never second-guesses a source that already answered. Mutates
    `candidates` in place (`is_oa`/`oa_url`) and returns how many were
    actually improved. A resolver failure for one candidate (network error,
    unknown DOI) is caught and skipped — it must never abort the batch
    (Session 1 brief §I: one provider's failure cannot crash discovery).
    """
    if resolve is None:
        discover = _load_fetchers()
        resolve = getattr(discover, "resolve_unpaywall_oa", None)
        if resolve is None:
            return 0  # e.g. a test double standing in for discover.py — never crash
    improved = 0
    asked = 0
    for p in candidates:
        if asked >= cap:
            break
        doi = (p.get("doi") or "").strip()
        oa_url = (p.get("oa_url") or "").strip()
        if not doi or oa_url.lower().startswith("http"):
            continue  # nothing to resolve, or already has a usable link
        asked += 1
        try:
            result = resolve(doi)
        except Exception as e:
            log(f"  [warn] unpaywall lookup failed for {doi}: {e}")
            continue
        if result and result.get("oa_url"):
            p["oa_url"] = result["oa_url"]
            p["is_oa"] = bool(result.get("is_oa"))
            improved += 1
    if asked:
        log(f"unpaywall: resolved {improved}/{asked} OA-location gap(s)")
    return improved


def fetch_pdfs(
    candidates: List[Dict[str, Any]],
    library: str,
    out_dir: str,
    target: int = 0,
    log: Callable[[str], None] = lambda m: None,
    workers: int = 6,
) -> List[Dict[str, Any]]:
    """Download open-access full texts, returning the papers actually obtained.

    Works through `candidates` in batches and stops once `target` full texts are
    in hand (0 = attempt every candidate), so the caller can hand in a large pool
    and get back a fixed number of papers it can genuinely read.

    Library-first means a paper is fetched at most once ever: a later session
    citing the same work copies the file instead of re-downloading it. Only
    genuinely open-access URLs are touched — paywalled work is skipped, never
    circumvented.
    """
    lib_pdfs = os.path.join(library, "pdfs")
    ses_pdfs = os.path.join(out_dir, "pdfs")
    os.makedirs(lib_pdfs, exist_ok=True)
    os.makedirs(ses_pdfs, exist_ok=True)

    jobs = []
    for i, p in enumerate(candidates):
        url = (p.get("oa_url") or "").strip()
        if not p.get("is_oa"):
            p["fulltext"] = "not open access"
        elif not url.lower().startswith("http"):
            p["fulltext"] = "open access but no file link published"
        else:
            p["fulltext"] = "pending"
            jobs.append((p, url, _pdf_name(p, i)))

    def ensure(job):
        p, url, name = job
        lib_path = os.path.join(lib_pdfs, name)
        md_path = lib_path[:-4] + ".md"
        xml_path = lib_path[:-4] + ".xml"
        for existing in (lib_path, md_path, xml_path):  # already in the shared library
            if os.path.exists(existing):
                return (p, os.path.basename(existing), existing, "full text saved (from cache)")
        written, reason = _download_fulltext(url, lib_path)
        if not written:
            p["fulltext"] = reason
            return None
        return (p, os.path.basename(written), written, reason)

    # Phase 1 — fetch into the shared library, in batches, until we have enough.
    # A batch runs in parallel and can overshoot slightly; the surplus stays in
    # the library for a later session rather than being thrown away.
    fetched: List[tuple] = []
    batch = max(workers, (target or len(jobs)))
    for start in range(0, len(jobs), batch):
        if target and len(fetched) >= target:
            break
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            fetched.extend(r for r in pool.map(ensure, jobs[start:start + batch]) if r)

    # Phase 2 — the session gets exactly the papers it will cite.
    got: List[Dict[str, Any]] = []
    for p, name, lib_path, reason in (fetched[:target] if target else fetched):
        try:
            shutil.copyfile(lib_path, os.path.join(ses_pdfs, name))
        except Exception:
            p["fulltext"] = "could not copy into the session"
            continue
        p["pdf_file"] = name
        p["fulltext"] = reason
        got.append(p)
    log(f"full texts: {len(got)} obtained from {len(jobs)} open-access candidate(s)")
    return got


def gather(
    queries: List[str],
    out_dir: str,
    library: str,
    target: int = 15,
    # arXiv is deliberately NOT a default source. It indexes physics/CS/math
    # preprints and holds essentially no consumer-formulation literature, so it
    # contributes noise that merely shares a word: a "limescale remover" query
    # pulls back image-inpainting "object remover" and watermark-removal papers.
    # The five defaults each cover a different slice: OpenAlex the chemistry,
    # OpenAIRE the European open-access repositories (green-OA copies that are
    # actually downloadable), Europe PMC the biomedical side plus patents,
    # Crossref essentially every remaining DOI, and DOAJ every fully-open-access
    # journal article (added Phase 14 Session 1 — confirmed keyless and working
    # against the live API, unlike CORE/BASE, see canonical_paper.
    # SOURCE_AVAILABILITY for that same session's concrete access findings on
    # the sources still NOT defaulted on: Semantic Scholar is real but
    # aggressively rate-limits unauthenticated traffic (opt in via `sources`
    # if a caller can tolerate/retry a 429); CORE needs an API key this
    # installation does not have; BASE denied this installation's IP/user
    # agent outright when tested live this session.
    sources: str = "openalex,openaire,europepmc,crossref,doaj",
    anchor: str = "",
    download_pdfs: bool = True,
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

    # We want `target` papers we can actually READ, and most search hits are
    # paywalled, so gather a much larger candidate pool and let the download
    # step decide which ones make the session.
    pool = target * POOL_FACTOR if download_pdfs else target

    cached = search_cache(queries, index, pool, anchor_terms)
    if len(cached) >= pool:
        # The shared library already covers this query — use it, no API call.
        log(f"cache: {len(cached)} relevant candidates from the shared library (no API needed)")
        candidates = cached[:pool]
    else:
        # Not enough in the library: fetch a FRESH set of `target` NEW papers
        # (deduped against the whole library so they are genuinely new) for this
        # session, and add them to the shared library.
        log(f"cache: only {len(cached)}/{pool} candidates in the library — searching the open APIs")
        discover = _load_fetchers()
        srcs = [s.strip() for s in sources.split(",") if s.strip() in discover.FETCHERS]
        lib_keys = {paper_key(p) for p in index}
        new: List[Dict[str, Any]] = []
        new_keys: set = set()
        # Phase 14 Session 1: every raw row sharing a key is kept here (not just
        # the first one) so a paper found by more than one source in this same
        # run keeps its full provenance instead of the loser being silently
        # discarded — canonical_paper.deduplicate() below turns each group into
        # exactly one CanonicalPaper (almost always) with every contributing
        # source preserved, never inflating `new`'s own cardinality/budget.
        provenance_by_key: Dict[str, List[Dict[str, Any]]] = {}

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
        # Ordered by how much usable evidence each returns for formulation work:
        # OpenAlex and OpenAIRE almost always carry abstracts (and OpenAIRE
        # carries downloadable links), Europe PMC adds biomed + patents, and
        # Crossref is broadest but deposits an abstract only about a third of
        # the time. arXiv sits last and is off by default.
        priority = {"openalex": 0, "openaire": 1, "europepmc": 2, "crossref": 3,
                    "doaj": 4, "semantic_scholar": 5, "arxiv": 9}
        srcs.sort(key=lambda s: priority.get(s, 99))
        pairs = [(q, src) for src in srcs for q in queries]
        # No single database may supply the whole quota. Each indexes a
        # different slice of the literature, so a formula backed by three
        # independent sources is better corroborated than one backed by fifteen
        # papers from a single index — even when that index is the strongest.
        #
        # Two passes: the first honours the cap so several databases get in, the
        # second lifts it to top up whatever is still missing. Diversity is a
        # preference, never a reason to return a thinner evidence base — with a
        # single source available the cap would otherwise starve the quota.
        base_cap = max(3, -(-pool // 3))
        per_source: Dict[str, int] = {}
        for cap in (base_cap, pool):
            if len(new) >= pool:
                break
            # How much one (source, angle) pair may contribute. Derived from the
            # cap so a source spends its share ACROSS the angles: if this equals
            # the cap, the first angle exhausts the source and the rest are
            # never asked.
            per_pair = max(2, -(-cap // max(1, len(queries))))
            for q, src in pairs:
                if len(new) >= pool:
                    break
                if per_source.get(src, 0) >= cap:
                    continue  # this database has contributed its share
                try:
                    # Ask for a page, not the whole pool: requesting 120 rows per
                    # angle earns a 429 from OpenAlex, and the pool is filled by
                    # asking several angles rather than one huge query.
                    rows = discover.FETCHERS[src](q, min(pool, PAGE_SIZE))
                except Exception as e:
                    log(f"  [warn] {src} failed: {e}")
                    continue
                taken = 0
                qterms = _terms(q)
                for row in rows:
                    if taken >= per_pair or len(new) >= pool:
                        break
                    if per_source.get(src, 0) >= cap:
                        break
                    k = paper_key(row)
                    if not k or k in lib_keys:
                        continue
                    if k in new_keys:
                        # Same study already collected this run, from another
                        # source or angle — record it as additional provenance
                        # (canonical_paper.deduplicate() below merges the group
                        # into one CanonicalPaper) instead of dropping it, which
                        # is what silently threw away cross-source corroboration
                        # before this session. Does not consume this source's
                        # quota — it is not a new candidate.
                        provenance_by_key.setdefault(k, []).append(row)
                        continue
                    # NOTE: discover.is_relevant is deliberately NOT used here.
                    # It asks "does this contain formulation jargon?", which
                    # rejects genuine domain papers ("Removal and prevention of
                    # limescale in plumbing tubes" has no such vocabulary) while
                    # admitting any preprint containing the word "formulation".
                    # anchored() + topical() test what we actually care about:
                    # is this paper about this product, and about this angle.
                    if not topical(row, qterms) or not anchored(row, anchor_terms):
                        continue
                    new.append(row)
                    new_keys.add(k)
                    provenance_by_key[k] = [row]
                    index.append(row)  # grow the shared library
                    taken += 1
                    per_source[src] = per_source.get(src, 0) + 1
        spread = ", ".join(f"{s}:{n}" for s, n in sorted(per_source.items())) or "none"
        log(f"fetched {len(new)} new papers across {len(queries)} angles ({spread})")
        multi = sum(1 for k, g in provenance_by_key.items() if k in new_keys and len(g) > 1)
        if multi:
            log(f"canonical dedup: {multi} paper(s) corroborated by more than one source this run")
        # One CanonicalPaper per paper_key group, full provenance preserved —
        # replaces `new`'s rows in place, never changing `new`'s own length/
        # order/quota accounting above (architecture doc §4: never count the
        # same paper once per database).
        new = [_flatten_canonical(row, provenance_by_key.get(paper_key(row), [row])) for row in new]
        # Fresh-preferred, but always deliver up to `target`: if the deduped
        # fresh batch is short (the APIs returned mostly already-cached work),
        # top up from the ranked cache so the session never has FEWER sources
        # than the library already held.
        candidates = new[:pool]
        if len(candidates) < pool:
            have = {paper_key(p) for p in candidates}
            for p in cached:
                if len(candidates) >= pool:
                    break
                if paper_key(p) not in have:
                    candidates.append(p)
                    have.add(paper_key(p))

    if download_pdfs:
        backfill_oa_via_unpaywall(candidates, log=log)

    # The session is the papers we can actually read. Candidates whose full text
    # we cannot obtain are not written anywhere: a reference we never read does
    # not belong in the evidence list.
    if download_pdfs:
        log(f"{len(candidates)} candidates -> downloading until {target} full texts")
        try:
            selected = fetch_pdfs(candidates, library, out_dir, target=target, log=log)
        except Exception as e:
            log(f"[warn] full-text download failed: {e}")
            selected = []
        if len(selected) < target:
            log(f"[note] only {len(selected)} of {target} could be obtained in full "
                f"— the rest of the candidates are paywalled or blocked")
    else:
        selected = candidates[:target]

    save_index(library, index)

    # Session copy.
    # `fulltext` says, in words, why a row does or does not have a file: every
    # paper here is read as metadata, but only open-access ones can be fetched.
    fields = ["source_db", "title", "year", "authors", "venue", "doi", "is_oa",
              "oa_url", "cited_by", "concepts", "pdf_file", "fulltext"]
    with open(os.path.join(out_dir, "papers.csv"), "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(selected)
    with open(os.path.join(out_dir, "papers.json"), "w", encoding="utf-8") as fh:
        json.dump(selected, fh, ensure_ascii=False, indent=2)

    # A short note next to the files: this folder IS the evidence list.
    with open(os.path.join(out_dir, "README.txt"), "w", encoding="utf-8") as fh:
        fh.write(
            f"{len(selected)} papers informed this formulation, and all of them\n"
            "are stored in full under pdfs/.\n\n"
            "Only papers whose full text could be downloaded are listed here: the\n"
            "model reads the papers themselves, so a reference it could not read\n"
            "does not belong in the list. Search hits that were paywalled or\n"
            "blocked were skipped and are not recorded.\n\n"
            "Paywalled papers are never bypassed.\n"
        )

    return selected
