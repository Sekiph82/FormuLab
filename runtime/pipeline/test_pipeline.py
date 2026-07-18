"""End-to-end tests for the v2 orchestrator (mock LLM, cached papers, no network)."""

import json
import os
import tempfile
import unittest

import literature_cache as lc
import pipeline


def seed_library(lib):
    idx = [{
        "source_db": "openalex", "title": f"Study {i} antidandruff shampoo surfactant",
        "year": 2020, "authors": "A", "venue": "J", "doi": f"10.1/{i}", "is_oa": True,
        "oa_url": "", "cited_by": i, "concepts": "shampoo",
        "abstract": "antidandruff shampoo surfactant formulation piroctone olamine",
    } for i in range(15)]
    lc.save_index(lib, idx)


def mock_llm(formulas):
    def _call(**kwargs):
        return json.dumps({"formulas": formulas})
    return _call


class PipelineTests(unittest.TestCase):
    def test_end_to_end_two_cards(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library(lib)
            out = os.path.join(tmp, "session")
            formulas = [
                {"name": "Piroctone shampoo", "purpose": "anti-dandruff",
                 "ingredients": [{"inci": "Water (Aqua)", "function": "Solvent", "weight_pct": "q.s. 100"},
                                 {"inci": "Decyl Glucoside", "function": "Surfactant", "weight_pct": "12.0"},
                                 {"inci": "Piroctone Olamine", "function": "Active", "weight_pct": "1.0"}],
                 "warnings": ["lab test needed"]},
                {"name": "Climbazole shampoo", "purpose": "anti-dandruff v2",
                 "ingredients": [{"inci": "Water (Aqua)", "function": "Solvent", "weight_pct": "q.s. 100"},
                                 {"inci": "Cocamidopropyl Betaine", "function": "Surfactant", "weight_pct": "8.0"},
                                 {"inci": "Climbazole", "function": "Active", "weight_pct": "0.5"}],
                 "warnings": ["lab test needed"]},
            ]
            res = pipeline.run(
                {"target": "anti-dandruff shampoo", "category": "shampoo", "market": "kenya"},
                provider="mock", model="m", api_key="", library=lib, out_dir=out, n=2,
                llm_call=mock_llm(formulas),
            )
            self.assertEqual(res["status"], "ok")
            self.assertEqual(len(res["cards"]), 2)
            self.assertEqual([c["version"] for c in res["cards"]], ["v1", "v2"])
            self.assertIn("Formulation Card", res["cards"][0]["markdown"])
            self.assertTrue(os.path.isfile(os.path.join(out, "formulation-card-v1.md")))
            self.assertTrue(os.path.isfile(os.path.join(out, "formulation-card-v2.md")))
            # No banned ingredient -> no violations.
            self.assertEqual(res["cards"][0]["violations"], [])

    def test_validation_flags_sulfate_in_antidandruff(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library(lib)
            out = os.path.join(tmp, "session")
            bad = [{"name": "bad", "purpose": "x",
                    "ingredients": [{"inci": "Water (Aqua)", "function": "Solvent", "weight_pct": "q.s. 100"},
                                    {"inci": "Sodium Laureth Sulfate", "function": "Surfactant", "weight_pct": "12.0"}],
                    "warnings": []}]
            res = pipeline.run(
                {"target": "antidandruff shampoo", "category": "shampoo"},
                provider="mock", model="m", api_key="", library=lib, out_dir=out, n=1,
                llm_call=mock_llm(bad),
            )
            self.assertEqual(res["status"], "ok")
            self.assertTrue(res["cards"][0]["violations"])  # SLES flagged

    def test_safety_gate_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = pipeline.run(
                {"target": "an explosive detonator mixture"},
                provider="mock", model="m", api_key="", library=os.path.join(tmp, "l"),
                out_dir=os.path.join(tmp, "s"), llm_call=mock_llm([]),
            )
            self.assertEqual(res["status"], "refused")


if __name__ == "__main__":
    unittest.main()
