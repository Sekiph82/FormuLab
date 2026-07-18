"""Literature retrieval for the formulation-discovery skill.

Pulls papers relevant to a formulation target from multiple OPEN sources and
writes a merged, de-duplicated metadata index (`papers.csv` + `papers.json`)
into the workspace. Only open, legal endpoints are queried and only
open-access full text is linked/downloaded — no paywalled or pirated sources.

Sources
-------
- OpenAlex           — cross-publisher metadata + best OA location.
- Europe PMC         — PubMed (MED) + PubMed Central (PMC) full text +
                       preprints (PPR) + patents (PAT), one API.
- arXiv              — preprints (chem-ph, cond-mat, ...).

Usage
-----
    python discover.py "antidandruff shampoo formulation" --max 40 --pdfs
    python discover.py "toothpaste abrasive silica formulation" \
        --sources openalex,europepmc --max 30
    python discover.py "q1" "q2" --max 25 --out shampoo/literature
"""

from __future__ import annotations

import argparse
import concurrent.futures
import csv
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

MAILTO = os.getenv("OPENALEX_MAILTO", "sekiphayit1982@gmail.com")
UA = f"FormuLab/0.4 (mailto:{MAILTO})"

RELEVANCE_TERMS = (
    "formulation", "formulate", "prepared", "preparation", "compounded",
    "excipient", "surfactant", "emulsion", "gel", "composition", "ingredient",
    "wt%", "w/w", "concentration", "active", "recipe", "blend", "vehicle",
)


def _get(url: str, tries: int = 3, accept: str = "application/json"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read()
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def _row(source_db, title, year, authors, venue, doi, is_oa, oa_url, cited_by, concepts, abstract):
    return {
        "source_db": source_db,
        "title": (title or "").strip(),
        "year": year or "",
        "authors": authors or "",
        "venue": venue or "",
        "doi": (doi or "").replace("https://doi.org/", "").lower().strip(),
        "is_oa": bool(is_oa),
        "oa_url": oa_url or "",
        "cited_by": cited_by or 0,
        "concepts": concepts or "",
        "abstract": (abstract or "").strip(),
    }


# ---------------------------------------------------------------- OpenAlex ----

def _reconstruct_abstract(inv):
    if not inv:
        return ""
    pos = [(i, w) for w, idxs in inv.items() for i in idxs]
    pos.sort()
    return " ".join(w for _, w in pos)


def fetch_openalex(query, max_results):
    out, cursor = [], "*"
    while len(out) < max_results:
        params = {"search": query, "per-page": str(min(50, max_results)),
                  "cursor": cursor, "mailto": MAILTO}
        data = json.loads(_get(f"https://api.openalex.org/works?{urllib.parse.urlencode(params)}"))
        results = data.get("results", [])
        if not results:
            break
        for w in results:
            oa = w.get("open_access") or {}
            best = w.get("best_oa_location") or w.get("primary_location") or {}
            authors = [(a.get("author") or {}).get("display_name", "") for a in (w.get("authorships") or [])]
            concepts = [c.get("display_name", "") for c in (w.get("concepts") or [])[:6]]
            # Prefer an ACTUAL pdf link from any open location: the best
            # location's landing page is usually publisher HTML (or blocks
            # automated clients), while a repository copy of the same paper is
            # directly downloadable.
            pdf = best.get("pdf_url")
            if not pdf:
                for loc in (w.get("locations") or []):
                    if loc.get("is_oa") and loc.get("pdf_url"):
                        pdf = loc["pdf_url"]
                        break
            out.append(_row(
                "openalex", w.get("title"), w.get("publication_year"),
                "; ".join(a for a in authors if a),
                ((w.get("primary_location") or {}).get("source") or {}).get("display_name", ""),
                w.get("doi"), oa.get("is_oa"),
                pdf or best.get("landing_page_url") or oa.get("oa_url"),
                w.get("cited_by_count", 0), ", ".join(concepts),
                _reconstruct_abstract(w.get("abstract_inverted_index")),
            ))
        cursor = data.get("meta", {}).get("next_cursor")
        if not cursor:
            break
    return out[:max_results]


# -------------------------------------------------------------- Europe PMC ----

def fetch_europepmc(query, max_results):
    """PubMed + PMC + preprints + patents in one API."""
    out, cursor = [], "*"
    base = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
    while len(out) < max_results:
        params = {"query": query, "format": "json", "resultType": "core",
                  "pageSize": str(min(100, max_results)), "cursorMark": cursor}
        data = json.loads(_get(f"{base}?{urllib.parse.urlencode(params)}"))
        results = (data.get("resultList") or {}).get("result", [])
        if not results:
            break
        for r in results:
            src = r.get("source", "")
            db = "patent" if src == "PAT" else "europepmc"
            oa = str(r.get("isOpenAccess", "")).upper() == "Y" or r.get("inPMC") == "Y"
            oa_url = ""
            for u in ((r.get("fullTextUrlList") or {}).get("fullTextUrl") or []):
                if u.get("documentStyle") == "pdf":
                    oa_url = u.get("url", "")
                    break
                if u.get("availabilityCode") in ("OA", "F") and not oa_url:
                    oa_url = u.get("url", "")
            # For PMC articles the listed fullTextUrl is usually a publisher
            # landing page (HTML, or a 403 for non-browser clients). Europe PMC's
            # own REST service is the sanctioned route and serves the complete
            # article as XML — richer than a PDF for downstream use.
            pmcid = r.get("pmcid") or ""
            if pmcid and (not oa_url or not oa_url.lower().endswith(".pdf")):
                if r.get("inPMC") == "Y" or r.get("isOpenAccess") == "Y":
                    oa_url = ("https://www.ebi.ac.uk/europepmc/webservices/rest/"
                              f"{pmcid}/fullTextXML")
            venue = ((r.get("journalInfo") or {}).get("journal") or {}).get("title", "") or src
            out.append(_row(
                db, r.get("title"), r.get("pubYear"), r.get("authorString", ""),
                venue, r.get("doi"), oa, oa_url, r.get("citedByCount", 0),
                "", r.get("abstractText", ""),
            ))
        nxt = data.get("nextCursorMark")
        if not nxt or nxt == cursor:
            break
        cursor = nxt
    return out[:max_results]


# ------------------------------------------------------------------- arXiv ----

def fetch_arxiv(query, max_results):
    ns = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
    params = {"search_query": f"all:{query}", "start": "0",
              "max_results": str(min(50, max_results))}
    xml = _get(f"http://export.arxiv.org/api/query?{urllib.parse.urlencode(params)}",
               accept="application/atom+xml")
    root = ET.fromstring(xml)
    out = []
    for e in root.findall("a:entry", ns):
        title = (e.findtext("a:title", default="", namespaces=ns) or "").replace("\n", " ").strip()
        summary = e.findtext("a:summary", default="", namespaces=ns)
        year = (e.findtext("a:published", default="", namespaces=ns) or "")[:4]
        authors = "; ".join(a.findtext("a:name", default="", namespaces=ns) for a in e.findall("a:author", ns))
        doi = e.findtext("arxiv:doi", default="", namespaces=ns) or ""
        pdf = ""
        for link in e.findall("a:link", ns):
            if link.get("title") == "pdf" or link.get("type") == "application/pdf":
                pdf = link.get("href", "")
        out.append(_row("arxiv", title, year, authors, "arXiv", doi, True, pdf, 0, "", summary))
    return out[:max_results]


# ---------------------------------------------------------------- Crossref ----

def _strip_tags(text):
    """Crossref/OpenAIRE abstracts arrive as JATS XML."""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text or "")).strip()


def fetch_crossref(query, max_results):
    """Crossref indexes essentially every DOI, including the applied and
    industrial chemistry journals other sources rank lower. Roughly a third of
    records carry a deposited abstract; the rest still contribute title, venue
    and DOI, and dedup by DOI merges them with richer records from elsewhere."""
    url = ("https://api.crossref.org/works?"
           f"query={urllib.parse.quote(query)}&rows={min(100, max_results)}"
           "&select=title,abstract,issued,author,container-title,DOI,"
           "is-referenced-by-count,link,license")
    items = json.loads(_get(url)).get("message", {}).get("items", [])
    out = []
    for w in items:
        title = (w.get("title") or [""])[0]
        if not title:
            continue
        year = ""
        parts = ((w.get("issued") or {}).get("date-parts") or [[]])[0]
        if parts:
            year = parts[0]
        pdf = ""
        for l in (w.get("link") or []):
            if l.get("content-type") == "application/pdf":
                pdf = l.get("URL", "")
                break
        out.append(_row(
            "crossref", title, year,
            "; ".join(f"{a.get('given','')} {a.get('family','')}".strip()
                      for a in (w.get("author") or [])[:8]),
            (w.get("container-title") or [""])[0], w.get("DOI"),
            bool(pdf), pdf, w.get("is-referenced-by-count", 0), "",
            _strip_tags(w.get("abstract")),
        ))
        if len(out) >= max_results:
            break
    return out


# ---------------------------------------------------------------- OpenAIRE ----

def _oa_text(v):
    """OpenAIRE returns a field as a dict, a list of dicts, or a bare string."""
    if isinstance(v, list):
        return _oa_text(v[0]) if v else ""
    if isinstance(v, dict):
        return str(v.get("$", ""))
    return str(v or "")


def _oa_attr(v, attr):
    """Read an @attribute from a field that may also arrive as a list."""
    if isinstance(v, list):
        v = v[0] if v else {}
    return str((v or {}).get(attr, "")) if isinstance(v, dict) else ""


def _oa_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def fetch_openaire(query, max_results):
    """OpenAIRE aggregates European open-access repositories, so it surfaces
    green-OA copies (author manuscripts, institutional deposits) that are
    downloadable when the publisher's own copy is not."""
    url = ("https://api.openaire.eu/search/publications?"
           f"keywords={urllib.parse.quote(query)}&size={min(50, max_results)}&format=json")
    data = json.loads(_get(url))
    results = _oa_list(((data.get("response") or {}).get("results") or {}).get("result"))
    out = []
    for r in results:
        meta = (((r.get("metadata") or {}).get("oaf:entity") or {}).get("oaf:result") or {})
        title = _oa_text(meta.get("title"))
        if not title:
            continue
        doi = ""
        for pid in _oa_list(meta.get("pid")):
            if isinstance(pid, dict) and pid.get("@classid") == "doi":
                doi = _oa_text(pid)
                break
        is_oa = _oa_attr(meta.get("bestaccessright"), "@classname").lower().startswith("open")
        url_out = ""
        children = meta.get("children")
        if isinstance(children, list):
            children = children[0] if children else {}
        for inst in _oa_list((children or {}).get("instance")):
            for wr in _oa_list((inst or {}).get("webresource")):
                url_out = _oa_text((wr or {}).get("url") if isinstance(wr, dict) else wr)
                if url_out:
                    break
            if url_out:
                break
        out.append(_row(
            "openaire", title, _oa_text(meta.get("dateofacceptance"))[:4],
            "; ".join(_oa_text(c.get("fullname")) for c in _oa_list(meta.get("creator"))
                      if isinstance(c, dict))[:400],
            _oa_attr(meta.get("collectedfrom"), "@name"),
            doi, is_oa, url_out, 0, "", _strip_tags(_oa_text(meta.get("description"))),
        ))
        if len(out) >= max_results:
            break
    return out


FETCHERS = {
    "openalex": fetch_openalex,
    "crossref": fetch_crossref,
    "europepmc": fetch_europepmc,
    "openaire": fetch_openaire,
    "arxiv": fetch_arxiv,
}


# --------------------------------------------------------------- pipeline ----

def is_relevant(row):
    hay = f"{row['title']} {row['abstract']}".lower()
    return any(t in hay for t in RELEVANCE_TERMS)


def norm_title(t):
    return re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()


def download_pdfs(papers, pdf_dir):
    os.makedirs(pdf_dir, exist_ok=True)
    n = 0
    for i, p in enumerate(papers):
        url = p["oa_url"]
        if not p["is_oa"] or not url or not url.lower().endswith(".pdf"):
            continue
        name = (p["doi"] or f"{p['source_db']}_{i}").replace("/", "_") + ".pdf"
        dest = os.path.join(pdf_dir, name)
        if os.path.exists(dest):
            continue
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r, open(dest, "wb") as fh:
                fh.write(r.read())
            n += 1
            p["pdf_file"] = os.path.relpath(dest)
        except Exception as e:
            print(f"  [skip pdf] {name}: {e}", file=sys.stderr)
    return n


def main(argv):
    ap = argparse.ArgumentParser(description="Retrieve open-access formulation literature")
    ap.add_argument("queries", nargs="+")
    ap.add_argument("--max", type=int, default=40, help="max papers per query per source")
    ap.add_argument("--out", default="literature")
    ap.add_argument("--sources", default="openalex,europepmc,arxiv",
                    help="comma list: openalex,europepmc,arxiv")
    ap.add_argument("--pdfs", action="store_true")
    ap.add_argument("--all", action="store_true", help="keep every hit (skip relevance filter)")
    args = ap.parse_args(argv)

    os.makedirs(args.out, exist_ok=True)
    sources = [s.strip() for s in args.sources.split(",") if s.strip() in FETCHERS]

    # Fetch every (query, source) pair in parallel — the sources are independent
    # network calls, so this cuts retrieval time to roughly the slowest single
    # endpoint instead of the sum of them all.
    def fetch_one(q, src):
        try:
            return src, FETCHERS[src](q, args.max)
        except Exception as e:
            print(f"  [warn] {src} failed: {e}", file=sys.stderr)
            return src, []

    tasks = [(q, src) for q in args.queries for src in sources]
    seen, papers = set(), []
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(tasks) or 1)) as pool:
        for src, rows in pool.map(lambda t: fetch_one(*t), tasks):
            for row in rows:
                key = row["doi"] or norm_title(row["title"])
                if not key or key in seen:
                    continue
                if not args.all and not is_relevant(row):
                    continue
                seen.add(key)
                papers.append(row)

    papers.sort(key=lambda p: (p["is_oa"], p["cited_by"]), reverse=True)

    fields = ["source_db", "title", "year", "authors", "venue", "doi",
              "is_oa", "oa_url", "cited_by", "concepts"]
    with open(os.path.join(args.out, "papers.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(papers)
    with open(os.path.join(args.out, "papers.json"), "w", encoding="utf-8") as fh:
        json.dump(papers, fh, ensure_ascii=False, indent=2)

    by_src = {}
    for p in papers:
        by_src[p["source_db"]] = by_src.get(p["source_db"], 0) + 1
    oa = sum(1 for p in papers if p["is_oa"])
    print(f"\nKept {len(papers)} papers ({oa} open-access) — {by_src} -> {args.out}/papers.csv",
          file=sys.stderr)

    if args.pdfs:
        n = download_pdfs(papers, os.path.join(args.out, "pdfs"))
        json.dump(papers, open(os.path.join(args.out, "papers.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        print(f"Downloaded {n} OA PDFs -> {args.out}/pdfs/", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
