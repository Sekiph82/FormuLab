"""FormuLab v1 (FVL-02.009) — `formula_alternatives_status`, a signal
DISTINCT from `status` (which is entirely about research-corpus
completeness). `actual_formula_count < engine.MIN_FORMULA_ALTERNATIVES`
is a real, independent condition: the honest alternatives already built
are always returned as-is (never discarded, never padded to reach the
minimum) alongside an explicit machine-readable flag.

Under the current strategy library, `balanced` + one of
`cost_optimized`/`premium_sensory` (mutually exclusive but jointly
exhaustive over every `targetCostLevel` value) + the near-universal
`max_performance` fallback together guarantee at least 3 applicable
strategies for virtually any brief — so `actual < 3` is not reachable
through genuine strategy scarcity today. These tests prove the SIGNAL
itself is correct by truncating `strategy.derive_strategies()`'s own real
output (never fabricating a strategy — just simulating "fewer genuinely
applied" the same way a future, narrower library legitimately could)."""

import os
import tempfile
import unittest
from unittest import mock

import engine
import literature_cache as lc
import pipeline
import strategy
from test_pipeline import seed_library_with_concentrations


def _truncate_to(count):
    """Wraps the REAL `strategy.derive_strategies` and slices its own
    real output — never invents a `VersionStrategy`."""
    real = strategy.derive_strategies

    def wrapped(brief, constraints, n=3):
        return real(brief, constraints, n=n)[:count]

    return wrapped


class FormulaAlternativesStatusTests(unittest.TestCase):
    def _brief(self):
        return {"target": "anti-dandruff shampoo", "category": "shampoo"}

    def test_requested_3_actual_2_below_minimum_status(self):
        with mock.patch.object(pipeline.strategy, "derive_strategies", _truncate_to(2)):
            with tempfile.TemporaryDirectory() as tmp:
                lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
                out = os.path.join(tmp, "session")
                res = pipeline.run(self._brief(), library=lib, out_dir=out, n=3, download_fulltexts=False)
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["requested_formula_count"], 3)
        self.assertEqual(res["actual_formula_count"], 2)
        self.assertEqual(res["alternative_shortfall"], 1)
        self.assertEqual([c["version"] for c in res["cards"]], ["v1", "v2"])
        self.assertNotIn("v3", [c["version"] for c in res["cards"]])
        self.assertEqual(res["formula_alternatives_status"], engine.FORMULA_ALTERNATIVES_INSUFFICIENT)

    def test_requested_7_actual_2_below_minimum_status_large_shortfall(self):
        with mock.patch.object(pipeline.strategy, "derive_strategies", _truncate_to(2)):
            with tempfile.TemporaryDirectory() as tmp:
                lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
                out = os.path.join(tmp, "session")
                res = pipeline.run(self._brief(), library=lib, out_dir=out, n=7, download_fulltexts=False)
        self.assertEqual(res["actual_formula_count"], 2)
        self.assertEqual(res["alternative_shortfall"], 5)
        self.assertEqual([c["version"] for c in res["cards"]], ["v1", "v2"])
        self.assertEqual(res["formula_alternatives_status"], engine.FORMULA_ALTERNATIVES_INSUFFICIENT)

    def test_requested_5_actual_4_is_normal_shortfall_not_below_minimum(self):
        # The real, already-established shortfall scenario (only 4 of 9
        # library strategies genuinely apply to this narrower brief) —
        # 4 >= MIN_FORMULA_ALTERNATIVES, so this must stay "sufficient".
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run(
                {"target": "a sulfate-free anti-dandruff shampoo for a sensitive scalp",
                 "category": "shampoo", "targetPhMin": "5.0", "targetPhMax": "5.5"},
                library=lib, out_dir=out, n=7, download_fulltexts=False,
            )
        self.assertEqual(res["actual_formula_count"], 4)
        self.assertEqual(res["alternative_shortfall"], 3)
        self.assertEqual(res["formula_alternatives_status"], engine.FORMULA_ALTERNATIVES_SUFFICIENT)

    def test_requested_3_actual_3_is_normal_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run(self._brief(), library=lib, out_dir=out, n=3, download_fulltexts=False)
        self.assertEqual(res["actual_formula_count"], 3)
        self.assertEqual(res["alternative_shortfall"], 0)
        self.assertEqual(res["formula_alternatives_status"], engine.FORMULA_ALTERNATIVES_SUFFICIENT)

    def _run_with_full_text_count(self, downloadable_count, tmp, n=3):
        """Mirrors `test_pipeline.py::PipelineTests._run_with_full_text_count`
        exactly (same technique, kept independent rather than reaching into
        another test module's instance method)."""
        lib = os.path.join(tmp, "library")
        lc.save_index(lib, [])
        out = os.path.join(tmp, "session")

        def candidate(i):
            p = {
                "source_db": "openalex", "title": f"Study {i} antidandruff shampoo surfactant piroctone olamine",
                "year": 2020, "authors": "A", "venue": "J", "doi": f"10.1/{i}",
                "cited_by": i, "concepts": "shampoo",
                "abstract": "antidandruff shampoo surfactant formulation piroctone olamine 1.0%",
            }
            if i < downloadable_count:
                p["is_oa"] = True
                p["oa_url"] = f"https://example.org/{i}.xml"
            else:
                p["is_oa"] = False
                p["oa_url"] = ""
            return p

        def fetch(q, pool):
            return [candidate(i) for i in range(min(pool, 120))]

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
            return pipeline.run(
                {"target": "anti-dandruff shampoo", "category": "shampoo"},
                library=lib, out_dir=out, n=n, download_fulltexts=True,
            )
        finally:
            lc._load_fetchers, lc._download_fulltext = orig_f, orig_d

    def test_partial_research_corpus_with_sufficient_alternatives(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = self._run_with_full_text_count(14, tmp, n=3)
        self.assertEqual(res["status"], "ok_partial_research")
        self.assertEqual(res["actual_formula_count"], 3)
        self.assertEqual(res["formula_alternatives_status"], engine.FORMULA_ALTERNATIVES_SUFFICIENT)

    def test_partial_research_corpus_with_insufficient_alternatives_both_signals_independent(self):
        # Both real conditions hold SIMULTANEOUSLY; neither may silently
        # overwrite the other — the whole point of keeping this a
        # separate field from `status`.
        with mock.patch.object(pipeline.strategy, "derive_strategies", _truncate_to(2)):
            with tempfile.TemporaryDirectory() as tmp:
                res = self._run_with_full_text_count(14, tmp, n=3)
        self.assertEqual(res["status"], "ok_partial_research")
        self.assertEqual(res["actual_formula_count"], 2)
        self.assertEqual(res["formula_alternatives_status"], engine.FORMULA_ALTERNATIVES_INSUFFICIENT)
        corpus = res["cards"][0]["research_corpus"]
        self.assertEqual(corpus["status"], "partial")

    def test_no_fabricated_alternative_when_below_minimum(self):
        with mock.patch.object(pipeline.strategy, "derive_strategies", _truncate_to(2)):
            with tempfile.TemporaryDirectory() as tmp:
                lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
                out = os.path.join(tmp, "session")
                res = pipeline.run(self._brief(), library=lib, out_dir=out, n=3, download_fulltexts=False)
        self.assertEqual(len(res["cards"]), 2)
        versions = [c["version"] for c in res["cards"]]
        self.assertEqual(len(versions), len(set(versions)), "no duplicate/padded version")

    def test_zero_llm_guard_still_passes_below_minimum(self):
        with mock.patch.object(pipeline.strategy, "derive_strategies", _truncate_to(2)):
            with tempfile.TemporaryDirectory() as tmp:
                lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
                out = os.path.join(tmp, "session")
                res = pipeline.run(self._brief(), library=lib, out_dir=out, n=3, download_fulltexts=False)
        self.assertEqual(res["status"], "ok")
        for card in res["cards"]:
            for origins in card.get("ingredient_origins", {}).values():
                self.assertNotIn("ai_formulation_inference", origins)


if __name__ == "__main__":
    unittest.main()
