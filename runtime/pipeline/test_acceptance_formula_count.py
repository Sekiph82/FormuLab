"""FormuLab v1 (FVL-02) Acceptance Cases C/D/E — the dynamic 3-7 formula-
alternative request contract, end to end through `pipeline.run()`. Cases
A/B (the real anti-dandruff PDF, unconstrained and sulfate-free) are
already covered by `ScientificFormulationPriorityTests` in
`test_pipeline.py`; this file covers the three cases that need a
purpose-built deterministic fixture instead of the single real paper
(which only ever yields one real scientific architecture family — not
enough on its own to prove 7 genuinely distinct alternatives)."""

import os
import tempfile
import unittest

import engine
import pipeline
from test_pipeline import seed_library_with_concentrations


class RequestedCountParametrizedTests(unittest.TestCase):
    """FVL-02.020 — every value in the accepted 3-7 range, individually,
    against the same brief used for Acceptance Case C (which legitimately
    triggers all 9 library strategies, so `actual_formula_count` tracks
    `n` exactly up to the library's own ceiling)."""

    def _brief(self):
        return {
            "target": "anti-dandruff shampoo", "category": "shampoo",
            "claims": "premium luxury natural organic antifungal medicated",
            "market": "EU", "availableEquipment": "stand mixer",
            "availableRawMaterials": "Water, Glycerin, Citric Acid, Xanthan Gum, Decyl Glucoside, Phenoxyethanol, EDTA",
        }

    def test_each_accepted_count(self):
        for n in range(engine.MIN_FORMULA_ALTERNATIVES, engine.MAX_FORMULA_ALTERNATIVES + 1):
            with self.subTest(n=n):
                with tempfile.TemporaryDirectory() as tmp:
                    lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
                    out = os.path.join(tmp, "session")
                    res = pipeline.run(self._brief(), library=lib, out_dir=out, n=n, download_fulltexts=False)
                self.assertEqual(res["status"], "ok")
                self.assertEqual(res["requested_formula_count"], n)
                self.assertEqual(res["actual_formula_count"], n)
                self.assertEqual(len(res["cards"]), n)
                self.assertEqual([c["version"] for c in res["cards"]], [f"v{i}" for i in range(1, n + 1)])


class AcceptanceCaseCTests(unittest.TestCase):
    """Case C: a brief whose own real signals legitimately trigger all 9
    library strategy types (never invented — each trigger below is a real,
    documented `strategy.py::_applies_*` condition), requesting 7. Expect
    7 real, genuinely distinct alternatives — never concentration-only
    fake diversity."""

    def _brief(self):
        return {
            "target": "anti-dandruff shampoo", "category": "shampoo",
            "claims": "premium luxury natural organic antifungal medicated",
            "market": "EU",
            "availableEquipment": "stand mixer",
            "availableRawMaterials": "Water, Glycerin, Citric Acid, Xanthan Gum, Decyl Glucoside, Phenoxyethanol, EDTA",
        }

    def test_seven_requested_seven_genuinely_distinct_alternatives(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run(self._brief(), library=lib, out_dir=out, n=7, download_fulltexts=False)
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["requested_formula_count"], 7)
        self.assertEqual(res["actual_formula_count"], 7)
        self.assertEqual(res["alternative_shortfall"], 0)
        self.assertEqual([c["version"] for c in res["cards"]], [f"v{i}" for i in range(1, 8)])
        strategy_types = [c["strategy"]["strategy_type"] for c in res["cards"]]
        self.assertEqual(len(strategy_types), len(set(strategy_types)), "no duplicate strategy padding")
        ingredient_sets = [tuple(sorted(i["inci"] for i in c["formula"]["ingredients"])) for c in res["cards"]]
        # Real diversity, not concentration-only: every version's own
        # ingredient SET (not just concentrations) must differ from every
        # other version's.
        self.assertEqual(len(ingredient_sets), len(set(ingredient_sets)),
                          "no two versions may share an identical ingredient set")


class AcceptanceCaseDTests(unittest.TestCase):
    """Case D: a brief for which only 4 of the 9 library strategies
    genuinely apply (no sensory/regulatory/manufacturing/raw-material
    signal present), requesting 7. Expect an honest, persisted shortfall —
    never a fabricated V5-V7."""

    def _brief(self):
        return {
            "target": "a sulfate-free anti-dandruff shampoo for a sensitive scalp",
            "category": "shampoo", "targetPhMin": "5.0", "targetPhMax": "5.5",
        }

    def test_seven_requested_four_defensible(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run(self._brief(), library=lib, out_dir=out, n=7, download_fulltexts=False)
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["requested_formula_count"], 7)
        self.assertEqual(res["actual_formula_count"], 4)
        self.assertEqual(res["alternative_shortfall"], 3)
        self.assertTrue(res["shortfall_reason"])
        self.assertNotIn("no version selected it", res["shortfall_reason"].lower())
        self.assertEqual([c["version"] for c in res["cards"]], ["v1", "v2", "v3", "v4"])
        self.assertNotIn("v5", [c["version"] for c in res["cards"]])


class AcceptanceCaseETests(unittest.TestCase):
    """Case E: explicit out-of-range counts are rejected outright — never
    silently clamped to the nearest valid value."""

    def test_below_minimum_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run({"target": "anti-dandruff shampoo", "category": "shampoo"},
                                library=lib, out_dir=out, n=2, download_fulltexts=False)
        self.assertEqual(res["status"], "error")
        self.assertNotIn("cards", res)
        self.assertIn("3", res["message"])
        self.assertIn("7", res["message"])

    def test_above_maximum_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run({"target": "anti-dandruff shampoo", "category": "shampoo"},
                                library=lib, out_dir=out, n=8, download_fulltexts=False)
        self.assertEqual(res["status"], "error")
        self.assertNotIn("cards", res)


if __name__ == "__main__":
    unittest.main()
