"""Tests for the shared literature cache (cache-first retrieval)."""

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
                got = lc.gather(["antidandruff shampoo surfactant"], out, lib, target=15)
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
                                target=15, sources="openalex")
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
                                target=15, sources="openalex")
            finally:
                lc._load_fetchers = orig

            self.assertEqual(len(got), 15)  # 4 fresh + 11 cached
            fresh = [p for p in got if int(p["doi"].split("/")[1]) >= 500]
            self.assertEqual(len(fresh), 4)  # fresh preferred, all included
            self.assertEqual(len({p["doi"] for p in got}), 15)  # no dupes

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
