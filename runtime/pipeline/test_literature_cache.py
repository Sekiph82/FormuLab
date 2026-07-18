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
