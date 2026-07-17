"""Literature retrieval for the formulation-discovery skill.

Queries the OpenAlex API (open, no key) for papers relevant to a formulation
target, keeps the formulation-relevant hits, reconstructs their abstracts, and
writes a metadata index (`papers.csv` + `papers.json`) into the workspace.
Optionally downloads the legally open-access (OA) full-text PDFs.

Only OpenAlex is queried here; it aggregates metadata across publishers and
exposes each work's best OA location, so downloads stay within open access —
no paywalled or Sci-Hub-style sources are ever touched.

Usage
-----
    python discover.py "antidandruff shampoo formulation" --max 40
    python discover.py "shampoo colloidal oatmeal soothing" --max 25 --pdfs
    python discover.py "q1" "q2" --max 30 --out shampoo   # merge several queries

Outputs (in --out dir, default "literature"):
    papers.csv   — one row per paper (title, year, doi, oa, oa_url, concepts…)
    papers.json  — same, plus reconstructed abstracts for the reader step
    pdfs/        — OA PDFs when --pdfs is set and a PDF URL exists
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.parse
import urllib.request

OPENALEX = "https://api.openalex.org/works"
MAILTO = os.getenv("OPENALEX_MAILTO", "sekiphayit1982@gmail.com")

# A hit must look like it is actually about making/testing a formulation, not
# merely mentioning the product — keeps reviews and clinical-only papers from
# dominating. Matched against title + abstract, case-insensitive.
RELEVANCE_TERMS = (
    "formulation", "formulate", "prepared", "preparation", "compounded",
    "excipient", "surfactant", "emulsion", "gel", "composition", "ingredient",
    "wt%", "w/w", "concentration", "active", "recipe", "blend", "vehicle",
)


def _get(url: str, tries: int = 3):
    req = urllib.request.Request(url, headers={"User-Agent": f"OpenScienceLab/0.3 (mailto:{MAILTO})"})
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # transient network / rate limit
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def reconstruct_abstract(inv: dict | None) -> str:
    """OpenAlex ships abstracts as an inverted index {word: [positions]}."""
    if not inv:
        return ""
    positions: list[tuple[int, str]] = []
    for word, idxs in inv.items():
        for i in idxs:
            positions.append((i, word))
    positions.sort()
    return " ".join(w for _, w in positions)


def is_relevant(title: str, abstract: str) -> bool:
    hay = f"{title} {abstract}".lower()
    return any(term in hay for term in RELEVANCE_TERMS)


def fetch_query(query: str, max_results: int) -> list[dict]:
    out: list[dict] = []
    per_page = min(50, max_results)
    cursor = "*"
    while len(out) < max_results:
        params = {
            "search": query,
            "per-page": str(per_page),
            "cursor": cursor,
            "mailto": MAILTO,
        }
        data = _get(f"{OPENALEX}?{urllib.parse.urlencode(params)}")
        results = data.get("results", [])
        if not results:
            break
        out.extend(results)
        cursor = data.get("meta", {}).get("next_cursor")
        if not cursor:
            break
    return out[:max_results]


def normalize(work: dict) -> dict:
    title = work.get("title") or ""
    abstract = reconstruct_abstract(work.get("abstract_inverted_index"))
    oa = work.get("open_access") or {}
    best = work.get("best_oa_location") or work.get("primary_location") or {}
    authors = [
        (a.get("author") or {}).get("display_name", "")
        for a in (work.get("authorships") or [])
    ]
    concepts = [c.get("display_name", "") for c in (work.get("concepts") or [])[:6]]
    return {
        "id": work.get("id", ""),
        "title": title,
        "year": work.get("publication_year", ""),
        "doi": (work.get("doi") or "").replace("https://doi.org/", ""),
        "venue": ((work.get("primary_location") or {}).get("source") or {}).get("display_name", ""),
        "authors": "; ".join(a for a in authors if a),
        "is_oa": bool(oa.get("is_oa")),
        "oa_status": oa.get("oa_status", ""),
        "oa_url": best.get("pdf_url") or best.get("landing_page_url") or oa.get("oa_url") or "",
        "cited_by": work.get("cited_by_count", 0),
        "concepts": ", ".join(concepts),
        "abstract": abstract,
    }


def download_pdfs(papers: list[dict], pdf_dir: str) -> int:
    os.makedirs(pdf_dir, exist_ok=True)
    n = 0
    for i, p in enumerate(papers):
        url = p["oa_url"]
        if not p["is_oa"] or not url or not url.lower().endswith(".pdf"):
            continue
        name = (p["doi"] or f"paper_{i}").replace("/", "_") + ".pdf"
        dest = os.path.join(pdf_dir, name)
        if os.path.exists(dest):
            continue
        try:
            req = urllib.request.Request(url, headers={"User-Agent": f"OpenScienceLab/0.3 (mailto:{MAILTO})"})
            with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as fh:
                fh.write(r.read())
            n += 1
            p["pdf_file"] = os.path.relpath(dest)
        except Exception as e:
            print(f"  [skip pdf] {name}: {e}", file=sys.stderr)
    return n


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Retrieve open-access formulation literature via OpenAlex")
    ap.add_argument("queries", nargs="+", help="one or more search queries")
    ap.add_argument("--max", type=int, default=40, help="max papers per query")
    ap.add_argument("--out", default="literature", help="output directory")
    ap.add_argument("--pdfs", action="store_true", help="download OA full-text PDFs")
    ap.add_argument("--all", action="store_true", help="keep every hit (skip relevance filter)")
    args = ap.parse_args(argv)

    os.makedirs(args.out, exist_ok=True)
    seen: set[str] = set()
    papers: list[dict] = []
    for q in args.queries:
        print(f"Querying OpenAlex: {q!r}", file=sys.stderr)
        for work in fetch_query(q, args.max):
            row = normalize(work)
            key = row["doi"] or row["id"]
            if key in seen:
                continue
            if not args.all and not is_relevant(row["title"], row["abstract"]):
                continue
            seen.add(key)
            papers.append(row)

    papers.sort(key=lambda p: (p["is_oa"], p["cited_by"]), reverse=True)

    fields = ["title", "year", "authors", "venue", "doi", "is_oa", "oa_status",
              "oa_url", "cited_by", "concepts"]
    with open(os.path.join(args.out, "papers.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for p in papers:
            w.writerow(p)
    with open(os.path.join(args.out, "papers.json"), "w", encoding="utf-8") as fh:
        json.dump(papers, fh, ensure_ascii=False, indent=2)

    oa_count = sum(1 for p in papers if p["is_oa"])
    print(f"\nKept {len(papers)} relevant papers ({oa_count} open-access) -> {args.out}/papers.csv", file=sys.stderr)

    if args.pdfs:
        n = download_pdfs(papers, os.path.join(args.out, "pdfs"))
        json.dump(papers, open(os.path.join(args.out, "papers.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"Downloaded {n} OA PDFs -> {args.out}/pdfs/", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
