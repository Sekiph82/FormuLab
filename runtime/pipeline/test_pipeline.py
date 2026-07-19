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
                download_fulltexts=False, llm_call=mock_llm(formulas),
            )
            self.assertEqual(res["status"], "ok")
            self.assertEqual(len(res["cards"]), 2)
            self.assertEqual([c["version"] for c in res["cards"]], ["v1", "v2"])
            self.assertIn("Formulation Card", res["cards"][0]["markdown"])
            # Cards are named for their session, so the file identifies itself
            # wherever it is copied: Formulation_Card_<session>_v1.md
            sid = os.path.basename(out)
            self.assertTrue(os.path.isfile(os.path.join(out, f"Formulation_Card_{sid}_v1.md")))
            self.assertTrue(os.path.isfile(os.path.join(out, f"Formulation_Card_{sid}_v2.md")))
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
                download_fulltexts=False, llm_call=mock_llm(bad),
            )
            self.assertEqual(res["status"], "ok")
            self.assertTrue(res["cards"][0]["violations"])  # SLES flagged

    def test_archives_every_card_to_the_formula_library(self):
        # Every card also lands in the flat library, with an index entry.
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library(lib)
            out = os.path.join(tmp, "sessions", "123-shampoo")
            formulas = os.path.join(tmp, "formulas")
            made = [
                {"name": "A", "purpose": "x",
                 "ingredients": [{"inci": "Water (Aqua)", "function": "Solvent", "weight_pct": "q.s. 100"}],
                 "warnings": []},
                {"name": "B", "purpose": "y",
                 "ingredients": [{"inci": "Decyl Glucoside", "function": "Surfactant", "weight_pct": "10.0"}],
                 "warnings": []},
            ]
            res = pipeline.run(
                {"target": "mild shampoo", "category": "shampoo", "market": "eu"},
                provider="mock", model="m", api_key="", library=lib, out_dir=out, n=2,
                formulas_dir=formulas, download_fulltexts=False, llm_call=mock_llm(made),
            )
            self.assertEqual(res["status"], "ok")
            self.assertEqual(len(res["archived"]), 2)
            for name in res["archived"]:
                self.assertTrue(os.path.isfile(os.path.join(formulas, name)))
            with open(os.path.join(formulas, "index.json"), encoding="utf-8") as fh:
                index = json.load(fh)
            self.assertEqual(len(index), 2)
            # Library copy carries the SAME name as the session copy.
            sid = os.path.basename(out)
            self.assertEqual(
                sorted(res["archived"]),
                [f"Formulation_Card_{sid}_v1.md", f"Formulation_Card_{sid}_v2.md"],
            )
            self.assertEqual(index[0]["target"], "mild shampoo")
            self.assertEqual(index[0]["market"], "eu")
            self.assertEqual({e["version"] for e in index}, {"v1", "v2"})
            self.assertEqual(index[0]["session"], "123-shampoo")

    def test_planner_builds_distinct_angles(self):
        from rules import derive_constraints
        brief = {"target": "anti-dandruff shampoo", "category": "shampoo", "market": "kenya"}
        qs = pipeline.build_queries(brief, derive_constraints(brief))
        self.assertGreater(len(qs), 3)          # several angles, not one query
        self.assertEqual(len(qs), len(set(qs)))  # no duplicates
        joined = " ".join(qs).lower()
        self.assertIn("surfactant", joined)      # cleansing base system
        self.assertIn("preservative", joined)    # preservation
        self.assertIn("hard water", joined)      # Kenya -> hard water angle
        self.assertIn("irritation", joined)      # anti-dandruff -> sensitive angle

    def test_queries_stay_short_enough_to_match(self):
        # Long conjunctive queries return zero hits from the open APIs, so every
        # angle must stay at the product head plus one distinguishing term.
        brief = {"target": "anti-dandruff shampoo for eczema-prone scalp",
                 "category": "shampoo", "market": "kenya"}
        from rules import derive_constraints
        for q in pipeline.build_queries(brief, derive_constraints(brief)):
            self.assertLessEqual(len(q.split()), 4, q)

    def test_cards_declare_when_no_literature_was_found(self):
        # A formula with no retrieved evidence must say so rather than look cited.
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            lc.save_index(lib, [])  # empty library
            out = os.path.join(tmp, "session")
            orig = lc.gather
            lc.gather = lambda *a, **k: []  # retrieval finds nothing
            try:
                res = pipeline.run(
                    {"target": "obscure niche product", "category": "cleaner"},
                    provider="mock", model="m", api_key="", library=lib, out_dir=out, n=1,
                    download_fulltexts=False, llm_call=mock_llm([{"name": "x", "purpose": "y",
                                        "ingredients": [{"inci": "Water (Aqua)", "function": "Solvent",
                                                         "weight_pct": "q.s. 100"}],
                                        "warnings": []}]),
                )
            finally:
                lc.gather = orig
            self.assertEqual(res["status"], "ok")
            self.assertIn("NOT grounded in retrieved sources", res["cards"][0]["markdown"])

    def test_planner_adapts_to_product_class(self):
        # A leave-on product must not be asked surfactant/foam questions.
        qs = pipeline.build_queries({"target": "hand cream", "category": "hand cream"})
        joined = " ".join(qs).lower()
        self.assertIn("emulsion", joined)
        self.assertNotIn("foam", joined)

    def test_citations_are_checked_against_the_retrieved_papers(self):
        # The model picks a real DOI but invents the author line to go with it.
        # Real rows: Europe PMC writes "Meyer F, ..." (surname first), OpenAlex
        # writes "Valéria CC Marinho; ..." (surname last).
        papers = [{
            "doi": "10.3290/j.ohpd.c_2697", "year": 2026,
            "authors": "Meyer F, Mohammed ZS, Deschner J, Enax J.",
            "title": "Natural Agents for the Improvement of Gingival Health",
        }, {
            "doi": "10.1002/14651858.cd002278", "year": 2003,
            "authors": "Valéria CC Marinho; Julian P. T. Higgins; Stuart Logan",
            "title": "Fluoride toothpastes for preventing dental caries",
        }]
        formula = {"references": [
            {"author": "Figueiredo et al.", "year": "2025", "doi": "10.3290/j.ohpd.c_2697"},
            {"author": "Smith et al.", "year": "2003", "doi": "10.1002/14651858.cd002278"},
            {"author": "Nobody", "year": "2024", "doi": "10.9999/invented"},
        ]}
        notes = pipeline.verify_references(formula, papers)

        refs = formula["references"]
        self.assertEqual(len(refs), 2)                      # the invented DOI is dropped
        self.assertEqual(refs[0]["doi"], "10.3290/j.ohpd.c_2697")
        self.assertEqual(refs[0]["author"], "Meyer et al.")  # surname-first source
        self.assertEqual(refs[0]["year"], "2026")
        self.assertEqual(refs[1]["author"], "Marinho et al.")  # surname-last source
        self.assertTrue(any("corrected" in n for n in notes))
        self.assertTrue(any("not drawn from the retrieved sources" in n for n in notes))

    def test_safety_gate_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = pipeline.run(
                {"target": "an explosive detonator mixture"},
                provider="mock", model="m", api_key="", library=os.path.join(tmp, "l"),
                out_dir=os.path.join(tmp, "s"), download_fulltexts=False, llm_call=mock_llm([]),
            )
            self.assertEqual(res["status"], "refused")
            self.assertEqual(res["classification"], "prohibited_request")

    def test_ordinary_request_classifies_and_proceeds(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            seed_library(lib)
            res = pipeline.run(
                {"target": "antidandruff shampoo"},
                provider="mock", model="m", api_key="", library=lib,
                out_dir=os.path.join(tmp, "s"), download_fulltexts=False,
                llm_call=mock_llm([{"name": "x", "purpose": "y", "ingredients": [
                    {"inci": "Water (Aqua)", "function": "Solvent", "weight_pct": "q.s. 100"},
                ]}]),
            )
            self.assertEqual(res["status"], "ok")

    def test_regulated_disinfectant_requires_human_review_before_proceeding(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            res = pipeline.run(
                {"target": "a QAC surface disinfectant"},
                provider="mock", model="m", api_key="", library=lib,
                out_dir=os.path.join(tmp, "s"), download_fulltexts=False, llm_call=mock_llm([]),
            )
            self.assertEqual(res["status"], "human_review_required")
            self.assertEqual(res["classification"], "regulated_disinfectant")

    def test_human_review_proceeds_once_acknowledged_by_a_named_person(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            seed_library(lib)
            res = pipeline.run(
                {
                    "target": "a QAC surface disinfectant",
                    "human_review_acknowledged": True,
                    "human_review_by": "Jane Chemist",
                },
                provider="mock", model="m", api_key="", library=lib,
                out_dir=os.path.join(tmp, "s"), download_fulltexts=False,
                llm_call=mock_llm([{"name": "x", "purpose": "y", "ingredients": [
                    {"inci": "Water (Aqua)", "function": "Solvent", "weight_pct": "q.s. 100"},
                ]}]),
            )
            self.assertEqual(res["status"], "ok")

    def test_acknowledgement_without_a_named_reviewer_does_not_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            res = pipeline.run(
                {"target": "a QAC surface disinfectant", "human_review_acknowledged": True},
                provider="mock", model="m", api_key="", library=lib,
                out_dir=os.path.join(tmp, "s"), download_fulltexts=False, llm_call=mock_llm([]),
            )
            self.assertEqual(res["status"], "human_review_required")

    def test_every_safety_decision_is_logged(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            pipeline.run(
                {"target": "an explosive detonator mixture"},
                provider="mock", model="m", api_key="", library=lib,
                out_dir=os.path.join(tmp, "s"), download_fulltexts=False, llm_call=mock_llm([]),
            )
            log_path = os.path.join(os.path.dirname(lib), "safety", "ai_request_log.jsonl")
            self.assertTrue(os.path.exists(log_path))
            with open(log_path, encoding="utf-8") as fh:
                record = json.loads(fh.readline())
            self.assertEqual(record["classification"], "prohibited_request")
            self.assertEqual(record["decision"], "refused")


class SafetyClassificationTests(unittest.TestCase):
    def test_classifies_ordinary_products(self):
        self.assertEqual(pipeline.classify_target("a regular shampoo"), "ordinary_consumer_product")

    def test_classifies_industrial_cleaners(self):
        self.assertEqual(pipeline.classify_target("a heavy duty degreaser"), "industrial_cleaning_product")

    def test_escalates_bleach_to_hazardous_lawful(self):
        self.assertEqual(pipeline.classify_target("a sodium hypochlorite bleach"), "hazardous_lawful_product")

    def test_classifies_disinfectants_as_regulated(self):
        self.assertEqual(pipeline.classify_target("a chlorhexidine hand rub"), "regulated_disinfectant")

    def test_classifies_medical_products(self):
        self.assertEqual(pipeline.classify_target("a fluoride toothpaste"), "medical_or_health_related_product")

    def test_classifies_restricted_requests(self):
        self.assertEqual(pipeline.classify_target("a household insecticide"), "restricted_request")

    def test_classifies_prohibited_requests(self):
        self.assertEqual(pipeline.classify_target("a nerve agent"), "prohibited_request")

    def test_safety_decision_proceeds_for_ordinary(self):
        self.assertEqual(pipeline.safety_decision("a regular shampoo"), ("ordinary_consumer_product", "proceed"))

    def test_safety_decision_requires_review_for_disinfectants(self):
        self.assertEqual(
            pipeline.safety_decision("a QAC disinfectant"),
            ("regulated_disinfectant", "human_review_required"),
        )

    def test_safety_decision_refuses_prohibited(self):
        classification, decision = pipeline.safety_decision("a nerve agent")
        self.assertEqual(classification, "prohibited_request")
        self.assertEqual(decision, "refused")


if __name__ == "__main__":
    unittest.main()
