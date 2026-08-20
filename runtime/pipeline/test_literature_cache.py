"""Tests for the shared literature cache (cache-first retrieval)."""

import csv
import hashlib
import json
import os
import tempfile
import unittest

import artifact_naming as an
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

    def test_research_corpus_keeps_relevant_candidates_even_without_full_text(self):
        # Phase 14 Session 4: the research corpus is the top `target`
        # genuinely relevant, deduplicated candidates — full-text
        # availability is a QUALITY DIMENSION of the corpus (`fulltext`/
        # `pdf_file` per entry), never a filter that silently shrinks a
        # relevant 5-document corpus down to however many happen to be
        # full-text-downloadable. A real, relevant, paywalled/blocked
        # abstract-only candidate still belongs in the corpus (it can still
        # contribute weaker evidence, Session 2's own `source_depth` model)
        # — this is the exact bug fix this session's own brief describes.
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

            # The full target corpus size is reached — relevant candidates
            # are kept regardless of downloadability. Phase 14 Session 6
            # correction gate: the corpus may now legitimately GROW beyond
            # `target` when the full-text gate searches deeper into the
            # remaining pool for more downloadable documents — never
            # shrinks below `target`, and never drops an already-selected
            # relevant candidate to make room.
            self.assertGreaterEqual(len(got), 5)
            with_files = [p for p in got if p.get("pdf_file")]
            without_files = [p for p in got if not p.get("pdf_file")]
            self.assertTrue(with_files, "at least the downloadable ones must have a real file")
            self.assertTrue(without_files, "non-downloadable candidates must still be IN the corpus")
            # Every non-downloaded entry says WHY, in words — never silent.
            self.assertTrue(all(p.get("fulltext") for p in without_files))
            # Only the genuinely-downloaded files exist on disk.
            files = os.listdir(os.path.join(out, "pdfs"))
            self.assertEqual(len(files), len(with_files))
            # papers.csv lists the WHOLE corpus, not just the downloaded slice.
            with open(os.path.join(out, "papers.csv"), encoding="utf-8-sig") as fh:
                rows = list(csv.DictReader(fh))
            self.assertEqual(len(rows), len(got))

    def test_full_text_gate_searches_deeper_when_short_and_reports_its_own_status(self):
        # Phase 14 Session 6 correction gate: when the initial `target`-
        # sized corpus doesn't reach `target` full texts, the full-text
        # gate searches the REMAINING candidate pool for more downloadable
        # documents — a real, separate acquisition effort from the
        # relevant-document corpus gate, honestly reported via
        # `discovery_stats.json::full_text_gate_met`.
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            lc.save_index(lib, [])
            out = os.path.join(tmp, "session")

            def candidate(i, q, downloadable):
                p = fake_paper(f"cand-{i}", q)
                p["oa_url"] = f"https://example.org/{i}.xml" if downloadable else ""
                return p

            # First `target` candidates are all non-downloadable; the
            # remainder are all downloadable — proves the gate actually
            # reaches past the initial window.
            def fetch(q, n):
                return [candidate(i, q, downloadable=(i >= 5)) for i in range(n)]

            class FakeDiscover:
                FETCHERS = {"openalex": fetch}
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

            full_text_count = sum(1 for p in got if p.get("pdf_file"))
            self.assertGreaterEqual(full_text_count, 5)
            with open(os.path.join(out, "discovery_stats.json"), encoding="utf-8") as fh:
                stats = json.load(fh)
            self.assertTrue(stats["full_text_gate_met"])

    def test_raw_candidate_count_reflects_the_real_wider_pool(self):
        # Phase 15 zero-LLM round: closes the disclosed
        # `raw_candidate_count` gap (Session 4's `provenance.
        # summarize_research_corpus` defaulted it to `len(papers)`, i.e.
        # `qualifying_count`, since nothing threaded the real wider
        # pre-ranking pool through). With `download_pdfs=True` the pool is
        # `target * POOL_FACTOR` (120 for target=15) — more candidates are
        # considered than the 15 that end up in the final corpus, and
        # `discovery_stats.json` must say so honestly.
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            lc.save_index(lib, [])
            out = os.path.join(tmp, "session")

            class FakeDiscover:
                FETCHERS = {"openalex": lambda q, n: [fake_paper(f"wide-{q}-{i}", q) for i in range(n)]}
                @staticmethod
                def is_relevant(_row):
                    return True

            orig_f = lc._load_fetchers
            orig_backfill, orig_fetch = lc.backfill_oa_via_unpaywall, lc.fetch_pdfs
            lc._load_fetchers = lambda: FakeDiscover
            lc.backfill_oa_via_unpaywall = lambda *a, **k: None
            lc.fetch_pdfs = lambda *a, **k: []
            try:
                got = lc.gather(["antidandruff shampoo surfactant"], out, lib,
                                target=15, sources="openalex", download_pdfs=True)
            finally:
                lc._load_fetchers = orig_f
                lc.backfill_oa_via_unpaywall, lc.fetch_pdfs = orig_backfill, orig_fetch

            self.assertEqual(len(got), 15)  # the final corpus still respects target
            with open(os.path.join(out, "discovery_stats.json"), encoding="utf-8") as fh:
                stats = json.load(fh)
            self.assertGreater(stats["raw_candidate_count"], 15)

    def test_corpus_shortfall_is_reported_not_padded(self):
        # Fewer than `target` genuinely relevant candidates exist -> the
        # corpus is honestly short, never padded with duplicates/irrelevant
        # filler to reach the number.
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            lc.save_index(lib, [])
            out = os.path.join(tmp, "session")

            class FakeDiscover:
                FETCHERS = {"openalex": lambda q, n: [fake_paper(i, q) for i in range(3)]}
                @staticmethod
                def is_relevant(_row):
                    return True

            orig = lc._load_fetchers
            lc._load_fetchers = lambda: FakeDiscover
            try:
                got = lc.gather(["a very narrow niche query"], out, lib,
                                target=15, sources="openalex", download_pdfs=False)
            finally:
                lc._load_fetchers = orig

            self.assertEqual(len(got), 3)
            self.assertEqual(len({p["doi"] for p in got}), 3, "no padding/duplication")

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

    # --- Phase 14 Session 1: canonical cross-source dedup with provenance ---

    def test_same_doi_from_two_sources_merges_into_one_paper_with_provenance(self):
        # The exact bug the architecture doc's §4 flags: today's dedup
        # silently discards the losing duplicate's row entirely. This proves
        # the fix: one paper appears in `got`, not two, and its provenance
        # names BOTH sources that actually found it.
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            lc.save_index(lib, [])
            out = os.path.join(tmp, "session")

            def openalex_row(i, terms):
                p = fake_paper(i, terms)
                p["source_db"] = "openalex"
                p["doi"] = "10.1/shared-paper"
                return p

            def crossref_row(i, terms):
                p = fake_paper(i, terms)
                p["source_db"] = "crossref"
                p["doi"] = "10.1/shared-paper"  # same real paper, different source
                return p

            class FakeDiscover:
                FETCHERS = {
                    "openalex": lambda q, n: [openalex_row(1, q)] + [fake_paper(f"oa-{i}", q) for i in range(2, n)],
                    "crossref": lambda q, n: [crossref_row(1, q)] + [fake_paper(f"cr-{i}", q) for i in range(2, n)],
                }
                @staticmethod
                def is_relevant(_row):
                    return True

            orig = lc._load_fetchers
            lc._load_fetchers = lambda: FakeDiscover
            try:
                got = lc.gather(["antidandruff shampoo surfactant"], out, lib,
                                target=5, sources="openalex,crossref", download_pdfs=False)
            finally:
                lc._load_fetchers = orig

            shared = [p for p in got if p["doi"] == "10.1/shared-paper"]
            self.assertEqual(len(shared), 1, "the same DOI from two sources must be ONE paper, not two")
            self.assertEqual(shared[0]["unique_source_count"], 2)
            self.assertEqual(set(shared[0]["provenance_sources"]), {"openalex", "crossref"})
            # Never double-counted: the shared paper occupies exactly one of
            # the returned slots, not two.
            self.assertEqual(len({p["doi"] for p in got}), len(got))

    def test_single_source_paper_still_has_provenance_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            lc.save_index(lib, [])
            out = os.path.join(tmp, "session")

            class FakeDiscover:
                FETCHERS = {"openalex": lambda q, n: [fake_paper(i, q) for i in range(n)]}
                @staticmethod
                def is_relevant(_row):
                    return True

            orig = lc._load_fetchers
            lc._load_fetchers = lambda: FakeDiscover
            try:
                got = lc.gather(["antidandruff shampoo surfactant"], out, lib,
                                target=3, sources="openalex", download_pdfs=False)
            finally:
                lc._load_fetchers = orig

            self.assertTrue(all(p["unique_source_count"] == 1 for p in got))
            self.assertTrue(all(p["provenance_sources"] == ["openalex"] for p in got))

    # --- Phase 14 Session 1: Unpaywall OA-location backfill ---

    def test_unpaywall_backfill_fills_a_genuine_gap(self):
        candidates = [
            {"doi": "10.1/needs-help", "oa_url": ""},
            {"doi": "10.1/already-has-a-link", "oa_url": "https://example.org/already.pdf"},
            {"doi": "", "oa_url": ""},  # no DOI at all — nothing to resolve
        ]

        def fake_resolve(doi):
            if doi == "10.1/needs-help":
                return {"is_oa": True, "oa_url": "https://example.org/resolved.pdf"}
            return None

        improved = lc.backfill_oa_via_unpaywall(candidates, resolve=fake_resolve)
        self.assertEqual(improved, 1)
        self.assertEqual(candidates[0]["oa_url"], "https://example.org/resolved.pdf")
        self.assertTrue(candidates[0]["is_oa"])
        # Never touched — it already had a usable link.
        self.assertEqual(candidates[1]["oa_url"], "https://example.org/already.pdf")

    def test_unpaywall_backfill_respects_the_cap(self):
        candidates = [{"doi": f"10.1/{i}", "oa_url": ""} for i in range(10)]
        calls = []

        def fake_resolve(doi):
            calls.append(doi)
            return None

        lc.backfill_oa_via_unpaywall(candidates, cap=3, resolve=fake_resolve)
        self.assertEqual(len(calls), 3)

    def test_unpaywall_backfill_tolerates_a_resolver_failure(self):
        candidates = [{"doi": "10.1/x", "oa_url": ""}, {"doi": "10.1/y", "oa_url": ""}]

        def flaky_resolve(doi):
            if doi == "10.1/x":
                raise RuntimeError("network error")
            return {"is_oa": True, "oa_url": "https://example.org/y.pdf"}

        # Must not raise — one provider failure cannot crash discovery.
        improved = lc.backfill_oa_via_unpaywall(candidates, resolve=flaky_resolve)
        self.assertEqual(improved, 1)
        self.assertEqual(candidates[1]["oa_url"], "https://example.org/y.pdf")

    def test_default_sources_include_doaj_not_semantic_scholar(self):
        import inspect
        default = inspect.signature(lc.gather).parameters["sources"].default
        self.assertIn("doaj", default)
        self.assertNotIn("semantic_scholar", default)
        self.assertNotIn("core", default)
        self.assertNotIn("base", default)


class ArtifactNamingIntegrationTests(unittest.TestCase):
    """FVL-04.026 (B6) — a REAL integration test for the actual literature
    acquisition/save path, against a real local HTTP server (never a fake
    fetch_pdfs stand-in), proving the human-readable naming convention is
    genuinely wired into `_pdf_name()`/`fetch_pdfs()` and that provenance
    (doi/oa_url/content_sha256) survives alongside it."""

    @classmethod
    def setUpClass(cls):
        import http.server
        import threading

        pdf_bytes = b"%PDF-1.4\n%real-fixture-bytes-for-fvl-04-026\n"
        cls._pdf_bytes = pdf_bytes

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                self.send_response(200)
                self.send_header("Content-Type", "application/pdf")
                self.end_headers()
                self.wfile.write(pdf_bytes)

            def log_message(self, *a):  # silence
                pass

        cls._server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        cls._port = cls._server.server_address[1]
        cls._thread = threading.Thread(target=cls._server.serve_forever, daemon=True)
        cls._thread.start()

    @classmethod
    def tearDownClass(cls):
        cls._server.shutdown()
        cls._thread.join(timeout=5)

    def test_real_download_produces_the_new_human_readable_filename_and_preserves_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            library = os.path.join(tmp, "library")
            out_dir = os.path.join(tmp, "session")
            paper = {
                "source_db": "openalex",
                "title": "Herbal Anti-Dandruff Shampoo Formulation and Evaluation",
                "year": 2024,
                "authors": "Sharma, A.; Kumar, B.",
                "venue": "J. Cosmet. Sci.",
                "doi": "10.1234/jcs.2024.001",
                "is_oa": True,
                "oa_url": f"http://127.0.0.1:{self._port}/paper.pdf",
                "cited_by": 0,
                "concepts": "",
                "abstract": "",
            }
            got = lc.fetch_pdfs([paper], library, out_dir, target=1)
            self.assertEqual(len(got), 1)
            result = got[0]

            # The real filename genuinely produced by the real save path —
            # never hand-asserted against a standalone sanitizer nothing
            # calls.
            expected_filename = an.literature_filename("Sharma, A.", 2024, paper["title"], "10.1234/jcs.2024.001", "pdf")
            self.assertEqual(result["pdf_file"], expected_filename)
            self.assertTrue(expected_filename.startswith("LIT_2024_"))

            # Original provenance preserved, never destroyed by the new name.
            self.assertEqual(result["doi"], "10.1234/jcs.2024.001")
            self.assertEqual(result["oa_url"], paper["oa_url"])
            self.assertEqual(result["source_db"], "openalex")
            self.assertIn("resolved_via", result)

            # NAME16 — a real content fingerprint was computed and preserved.
            self.assertEqual(result["content_sha256"], hashlib.sha256(self._pdf_bytes).hexdigest())

            # The file genuinely exists under the human-readable name, in
            # both the shared library and the session copy.
            self.assertTrue(os.path.isfile(os.path.join(library, "pdfs", expected_filename)))
            self.assertTrue(os.path.isfile(os.path.join(out_dir, "pdfs", expected_filename)))

    def test_no_mass_rename_of_existing_library_files(self):
        # A file already saved under the OLD opaque naming scheme must stay
        # exactly where it is — this task applies prospectively to NEW
        # acquisitions only, never a destructive rename pass over history.
        with tempfile.TemporaryDirectory() as tmp:
            library = os.path.join(tmp, "library")
            os.makedirs(os.path.join(library, "pdfs"), exist_ok=True)
            old_name = "10.1234_jcs.2024.001.pdf"
            old_path = os.path.join(library, "pdfs", old_name)
            with open(old_path, "wb") as fh:
                fh.write(self._pdf_bytes)
            lc.gather(["antidandruff shampoo"], os.path.join(tmp, "session"), library, target=1, download_pdfs=False)
            self.assertTrue(os.path.isfile(old_path))  # untouched


if __name__ == "__main__":
    unittest.main()
