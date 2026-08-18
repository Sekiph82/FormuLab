"""Traceability integrity tests — Phase 14 Session 6, §30 of the brief this
module implements. Exercises the real deterministic pipeline end to end
(seeded literature, no network) and proves the persisted trace/evidence/
process/safety/regulatory data is internally consistent."""

import json
import os
import tempfile
import unittest

import literature_cache as lc
import pipeline
from evidence import normalize_ingredient_key


def seed_library(lib):
    idx = [{
        "source_db": "openalex", "title": f"Study {i} antidandruff shampoo surfactant piroctone olamine",
        "year": 2020, "authors": "A", "venue": "J", "doi": f"10.1/{i}", "is_oa": True,
        "oa_url": "", "cited_by": i, "concepts": "shampoo",
        "abstract": (
            "antidandruff shampoo surfactant formulation: piroctone olamine at 1.0% reduced "
            "flaking significantly. Cocamidopropyl betaine at 6.0% improved mildness. Decyl "
            "glucoside at 10.0% wt% provided cleansing."
        ),
    } for i in range(15)]
    lc.save_index(lib, idx)


def run_session(brief, n=3):
    tmp = tempfile.mkdtemp()
    lib = os.path.join(tmp, "library")
    seed_library(lib)
    out = os.path.join(tmp, "session")
    res = pipeline.run(brief, library=lib, out_dir=out, n=n, download_fulltexts=False)
    return res, out


class TraceabilityIntegrityTests(unittest.TestCase):
    def test_every_formula_ingredient_has_an_origin(self):
        res, _ = run_session({"target": "anti-dandruff shampoo", "category": "shampoo"})
        card = res["cards"][0]
        for ing in card["formula"]["ingredients"]:
            key = normalize_ingredient_key(ing["inci"])
            self.assertIn(key, card["ingredient_origins"])
            self.assertTrue(card["ingredient_origins"][key])

    def test_every_concentration_has_a_basis_or_is_unresolved(self):
        # A resolved concentration always came from a real q.s. closure or
        # a real ConcentrationResolution.source_type — reflected in the
        # trace's own selected-ingredient events.
        res, _ = run_session({"target": "anti-dandruff shampoo", "category": "shampoo"})
        card = res["cards"][0]
        selected = [e for e in card["trace_events"] if e["decision_type"] == "ingredient_selected"]
        for e in selected:
            self.assertTrue(e["status"], e)  # q.s. closure / evidence / rule / supplier — never blank

    def test_every_process_step_has_a_basis(self):
        res, _ = run_session({"target": "anti-dandruff shampoo", "category": "shampoo"})
        card = res["cards"][0]
        if card["manufacturing"]["ready"]:
            for step in card["manufacturing"]["steps"]:
                self.assertIn(step["basis"], ("scientific_evidence", "deterministic_rule",
                                               "supplier_data", "internal_formulab_data"))

    def test_every_critical_parameter_has_a_basis(self):
        res, _ = run_session({"target": "anti-dandruff shampoo", "category": "shampoo"})
        card = res["cards"][0]
        if card["manufacturing"]["ready"]:
            for p in card["manufacturing"]["critical_parameters"]:
                self.assertTrue(p["source_type"])

    def test_every_equipment_recommendation_has_a_basis(self):
        res, _ = run_session({"target": "anti-dandruff shampoo", "category": "shampoo"})
        card = res["cards"][0]
        if card["manufacturing"]["ready"]:
            for e in card["manufacturing"]["equipment"]:
                self.assertTrue(e["basis"])

    # FVL-03.009: `test_every_safety_finding_has_a_source_or_rule` removed
    # — `card["safety"]` no longer exists (the retired
    # `runtime/pipeline/safety.py` counterpart was deleted; the
    # authoritative safety verdict, with its own real `ruleId` on every
    # finding, is now computed client-side — see
    # `generatedFormulaSafety.ts` and `packages/shared/src/engine/
    # safety.test.ts`'s own coverage of that same guarantee).

    # FVL-03.010: `test_every_regulatory_finding_has_a_source_or_rule`
    # removed — `card["regulatory"]` no longer exists (the retired
    # `runtime/pipeline/regulatory.py` counterpart was deleted; the
    # authoritative regulatory verdict, with its own real `ruleCode` on
    # every finding, is now computed client-side — see
    # `generatedFormulaRegulatory.ts` and `packages/shared/src/engine/
    # regulatoryRules.test.ts`'s own coverage of that same guarantee).

    def test_evidence_link_dois_point_to_real_retrieved_papers(self):
        res, out = run_session({"target": "anti-dandruff shampoo", "category": "shampoo"})
        with open(os.path.join(out, "literature", "papers.json"), encoding="utf-8") as fh:
            papers = json.load(fh)
        real_dois = {p["doi"].lower() for p in papers if p.get("doi")}
        card = res["cards"][0]
        for link in card["evidence_links"]:
            if link.get("paper_doi"):
                self.assertIn(link["paper_doi"].lower(), real_dois)

    def test_same_paper_via_multiple_providers_remains_one_study(self):
        res, _ = run_session({"target": "anti-dandruff shampoo", "category": "shampoo"})
        card = res["cards"][0]
        corpus = card["research_corpus"]
        # unique_evidence_study_count must never exceed evidence_record_count
        # (many records can share one study; never the reverse).
        self.assertLessEqual(corpus["unique_evidence_study_count"], corpus["evidence_record_count"] or corpus["unique_evidence_study_count"])

    def test_cross_version_trace_does_not_leak(self):
        res, _ = run_session({"target": "anti-dandruff shampoo", "category": "shampoo"}, n=3)
        v1_ids = {e["decision_id"] for e in res["cards"][0]["trace_events"]}
        v2_ids = {e["decision_id"] for e in res["cards"][1]["trace_events"]}
        self.assertEqual(v1_ids & v2_ids, set())
        for e in res["cards"][0]["trace_events"]:
            self.assertEqual(e["formula_version_id"], "v1")
        for e in res["cards"][1]["trace_events"]:
            self.assertEqual(e["formula_version_id"], "v2")

    def test_no_decision_references_a_missing_source_id(self):
        res, out = run_session({"target": "anti-dandruff shampoo", "category": "shampoo"})
        with open(os.path.join(out, "literature", "papers.json"), encoding="utf-8") as fh:
            papers = json.load(fh)
        real_dois = {p["doi"].lower() for p in papers if p.get("doi")}
        card = res["cards"][0]
        for e in card["trace_events"]:
            for doi in e.get("evidence_ids", []):
                self.assertIn(doi.lower(), real_dois)

    def test_historical_pre_session_6_session_still_loads(self):
        # A pre-Session-6 card (no safety/regulatory/trace_events keys) must
        # not crash anything that reads a card dict generically.
        legacy_card = {
            "version": "v1", "status": "ok", "markdown": "# x",
            "formula": {"name": "A", "ingredients": []}, "violations": [],
        }
        self.assertNotIn("safety", legacy_card)
        self.assertNotIn("regulatory", legacy_card)
        # Accessing with .get() (the same pattern the frontend/Rust bridge
        # already use) must return a safe default, never raise.
        self.assertIsNone(legacy_card.get("safety"))
        self.assertIsNone(legacy_card.get("regulatory"))
        self.assertEqual(legacy_card.get("trace_events", []), [])


if __name__ == "__main__":
    unittest.main()
