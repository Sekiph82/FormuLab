"""Tests for the shared literature cache (cache-first retrieval)."""

import csv
import json
import os
import tempfile
import unittest

import literature_cache as lc


def fake_paper(i, terms):
    return {
        "source_db": "openalex", "title": f"Study {i} on {terms}", "year": 2020,
        "authors": "A", "venue": "J", "doi": f"10.1/{i}", "is_oa": True,
        "oa_url": "", "cited_by": i, "concepts": terms, "abstract": f"about {terms} formulation",
    }


class CacheTests(unittest.TestCase):
    def test_cache_hit_skips_api(self):
        # 15 relevant cached papers -> gather must not touch the network.
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            index = [fake_paper(i, "antidandruff shampoo surfactant") for i in range(15)]
            lc.save_index(lib, index)
            out = os.path.join(tmp, "session")

            # Force any accidental API use to blow up.
            orig = lc._load_fetchers
            lc._load_fetchers = lambda: (_ for _ in ()).throw(AssertionError("hit API despite full cache"))
            try:
                got = lc.gather(["antidandruff shampoo surfactant"], out, lib, target=15,
                                download_pdfs=False)
            finally:
                lc._load_fetchers = orig

            self.assertEqual(len(got), 15)
            self.assertTrue(os.path.isfile(os.path.join(out, "papers.json")))
            self.assertTrue(os.path.isfile(os.path.join(out, "papers.csv")))

    def test_short_cache_fetches_fresh_15(self):
        # Cache has < target relevant -> fetch `target` NEW papers, grow library.
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            lc.save_index(lib, [fake_paper(1, "antidandruff shampoo surfactant")])  # only 1
            out = os.path.join(tmp, "session")

            class FakeDiscover:
                FETCHERS = {
                    "openalex": lambda q, n: [fake_paper(100 + i, "antidandruff shampoo surfactant") for i in range(n)],
                }
                @staticmethod
                def is_relevant(_row):
                    return True

            orig = lc._load_fetchers
            lc._load_fetchers = lambda: FakeDiscover
            try:
                got = lc.gather(["antidandruff shampoo surfactant"], out, lib,
                                target=15, sources="openalex", download_pdfs=False)
            finally:
                lc._load_fetchers = orig

            self.assertEqual(len(got), 15)
            # All 15 are the freshly-fetched ones (doi 10.1/100..), not the cached #1.
            self.assertTrue(all(p["doi"].startswith("10.1/1") for p in got))
            # Library grew (1 old + 15 new).
            self.assertEqual(len(lc.load_index(lib)), 16)

    def test_short_fresh_tops_up_from_cache(self):
        # 11 relevant cached (<15) but APIs return only 4 genuinely new ->
        # session = 4 fresh + top-up from cache to reach 15 (never fewer than cache).
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            lc.save_index(lib, [fake_paper(i, "antidandruff shampoo surfactant") for i in range(11)])
            out = os.path.join(tmp, "session")

            class FakeDiscover:
                FETCHERS = {
                    "openalex": lambda q, n: [fake_paper(500 + i, "antidandruff shampoo surfactant") for i in range(4)],
                }
                @staticmethod
                def is_relevant(_row):
                    return True

            orig = lc._load_fetchers
            lc._load_fetchers = lambda: FakeDiscover
            try:
                got = lc.gather(["antidandruff shampoo surfactant"], out, lib,
                                target=15, sources="openalex", download_pdfs=False)
            finally:
                lc._load_fetchers = orig

            self.assertEqual(len(got), 15)  # 4 fresh + 11 cached
            fresh = [p for p in got if int(p["doi"].split("/")[1]) >= 500]
            self.assertEqual(len(fresh), 4)  # fresh preferred, all included
            self.assertEqual(len({p["doi"] for p in got}), 15)  # no dupes

    def test_budget_spreads_across_angles_best_source_first(self):
        # The budget is spread over the ANGLES; sources are tried best-first, so
        # a strong OpenAlex fills the quota across every angle and the weaker
        # arXiv is never reached.
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            lc.save_index(lib, [])
            out = os.path.join(tmp, "session")
            calls = []

            def make(src):
                def fetch(q, n):
                    calls.append((src, q))
                    # On-topic for whichever angle was asked (so the topical gate
                    # passes), with unique dois so nothing dedups away.
                    base = abs(hash((src, q))) % 9000
                    return [fake_paper(f"{src}-{base}-{i}", q) for i in range(n)]
                return fetch

            class FakeDiscover:
                FETCHERS = {"openalex": make("openalex"),
                            "europepmc": make("europepmc"),
                            "arxiv": make("arxiv")}
                @staticmethod
                def is_relevant(_row):
                    return True

            orig = lc._load_fetchers
            lc._load_fetchers = lambda: FakeDiscover
            try:
                got = lc.gather(
                    ["antidandruff shampoo surfactant", "antidandruff efficacy active",
                     "shampoo preservative stability"],
                    out, lib, target=15, sources="openalex,europepmc,arxiv",
                    download_pdfs=False,
                )
            finally:
                lc._load_fetchers = orig

            self.assertEqual(len(got), 15)
            # Every angle was asked, and no single angle monopolised the quota.
            queried = {q for _, q in calls}
            self.assertEqual(len(queried), 3)
            # More than one database contributed: the evidence behind a formula
            # should not rest on a single index even when that index is strong.
            used = {p["doi"].split("/")[1].split("-")[0] for p in got}
            self.assertGreater(len(used), 1)
            # ...and the strongest source still leads, capped at its share.
            self.assertLessEqual(sum(1 for p in got if "openalex" in p["doi"]), 5)

    def test_single_source_still_fills_the_quota(self):
        # Regression: the per-source cap must not starve the evidence base when
        # only one database is available — diversity is a preference, not a
        # reason to hand back 5 papers instead of 15.
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            lc.save_index(lib, [])
            out = os.path.join(tmp, "session")

            class FakeDiscover:
                FETCHERS = {"openalex": lambda q, n: [
                    fake_paper(f"solo-{abs(hash(q)) % 999}-{i}", q) for i in range(n)]}
                @staticmethod
                def is_relevant(_row):
                    return True

            orig = lc._load_fetchers
            lc._load_fetchers = lambda: FakeDiscover
            try:
                got = lc.gather(["antidandruff shampoo surfactant", "shampoo preservative"],
                                out, lib, target=15, sources="openalex", download_pdfs=False)
            finally:
                lc._load_fetchers = orig
            self.assertEqual(len(got), 15)

    def test_fulltext_sniffing_accepts_jats_and_never_html(self):
        # Regression: Europe PMC serves JATS starting with a newline and
        # "<!DOCTYPE article", which a naive "<?xml" check rejected — real full
        # texts were being dropped.
        jats = b'\n<!DOCTYPE article\n  PUBLIC "-//NLM//DTD JATS (Z39.96)...">\n<article xml:lang="en">'
        self.assertEqual(lc.sniff_fulltext(jats), "xml")
        self.assertEqual(lc.sniff_fulltext(b'<?xml version="1.0"?><article/>'), "xml")
        self.assertEqual(lc.sniff_fulltext(b"%PDF-1.7\n..."), "pdf")
        # A landing page is never the paper and must not be saved.
        self.assertIsNone(lc.sniff_fulltext(b"<!DOCTYPE html><html><body>Sign in"))
        self.assertIsNone(lc.sniff_fulltext(b"\n  <html lang='en'><head>"))
        self.assertIsNone(lc.sniff_fulltext(b'<?xml version="1.0"?><!DOCTYPE html><html>'))
        self.assertIsNone(lc.sniff_fulltext(b"{}", "text/html; charset=utf-8"))

    def test_session_contains_only_papers_we_downloaded(self):
        # The session IS the evidence list: a candidate whose full text cannot be
        # fetched is not listed at all, and the pool is searched until `target`
        # readable papers are in hand.
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            lc.save_index(lib, [])
            out = os.path.join(tmp, "session")

            def candidate(i, q):
                p = fake_paper(f"cand-{i}", q)
                # Only every third candidate is actually downloadable.
                p["oa_url"] = f"https://example.org/{i}.xml" if i % 3 == 0 else ""
                return p

            class FakeDiscover:
                FETCHERS = {"openalex": lambda q, n: [candidate(i, q) for i in range(n)]}
                @staticmethod
                def is_relevant(_row):
                    return True

            def fake_dl(url, dest, timeout=30):
                path = dest[:-4] + ".xml"
                with open(path, "wb") as fh:
                    fh.write(b"<?xml version='1.0'?><article/>")
                return path, "full text saved"

            orig_f, orig_d = lc._load_fetchers, lc._download_fulltext
            lc._load_fetchers = lambda: FakeDiscover
            lc._download_fulltext = fake_dl
            try:
                got = lc.gather(["antidandruff shampoo surfactant"], out, lib,
                                target=5, sources="openalex")
            finally:
                lc._load_fetchers, lc._download_fulltext = orig_f, orig_d

            self.assertEqual(len(got), 5)
            # Every listed paper has a file, and the files are really there.
            self.assertTrue(all(p.get("pdf_file") for p in got))
            files = os.listdir(os.path.join(out, "pdfs"))
            self.assertEqual(len(files), 5)
            # papers.csv lists exactly those five, nothing skipped.
            with open(os.path.join(out, "papers.csv"), encoding="utf-8-sig") as fh:
                rows = list(csv.DictReader(fh))
            self.assertEqual(len(rows), 5)
            self.assertTrue(all(r["pdf_file"] for r in rows))

    def test_off_domain_papers_are_rejected(self):
        # A physics preprint that merely contains the word "formulation" must not
        # be accepted as evidence for a household-chemistry query.
        qterms = lc._terms("limescale remover kettles descaling")
        physics = {"title": "Unified formulation for helicity and continuous spin fermionic fields",
                   "abstract": "gauge theory formulation of massless fields", "concepts": ""}
        ontopic = {"title": "Descaling kettles: citric acid limescale removal",
                   "abstract": "limescale descaling efficacy of acids", "concepts": ""}
        self.assertFalse(lc.topical(physics, qterms))
        self.assertTrue(lc.topical(ontopic, qterms))

    def test_generic_research_words_do_not_make_a_paper_relevant(self):
        # Regression: these real arXiv titles were accepted for a limescale query
        # because the angle queries contain "evaluation"/"active"/"ingredient".
        anchor = lc._terms("limescale remover for kettles limescale remover")
        junk = [
            {"title": "On the Evaluation Criterions for the Active Learning Processes",
             "abstract": "active learning evaluation", "concepts": ""},
            {"title": "Unified formulation for helicity and continuous spin fermionic fields",
             "abstract": "gauge theory formulation", "concepts": ""},
            {"title": "Normalization of peer-evaluation measures of group research quality",
             "abstract": "research evaluation metrics", "concepts": ""},
        ]
        for row in junk:
            self.assertFalse(lc.anchored(row, anchor), row["title"])
        good = {"title": "Citric acid descaling of limescale in kettles",
                "abstract": "limescale removal efficacy", "concepts": ""}
        self.assertTrue(lc.anchored(good, anchor))

    def test_search_ranks_by_overlap(self):
        index = [fake_paper(1, "toothpaste silica"), fake_paper(2, "antidandruff shampoo surfactant")]
        hits = lc.search_cache(["antidandruff shampoo"], index, 5)
        self.assertEqual(hits[0]["doi"], "10.1/2")

    def test_dedup_key(self):
        self.assertEqual(lc.paper_key({"doi": "10.1/X"}), "10.1/x")
        self.assertEqual(lc.paper_key({"title": "Hello World!"}), "hello world")

    def test_shared_index_persists(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            lc.save_index(lib, [fake_paper(1, "x")])
            self.assertEqual(len(lc.load_index(lib)), 1)
            with open(os.path.join(lib, "index.json"), encoding="utf-8") as fh:
                self.assertEqual(len(json.load(fh)), 1)


if __name__ == "__main__":
    unittest.main()
