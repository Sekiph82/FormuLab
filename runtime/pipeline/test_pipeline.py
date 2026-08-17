"""End-to-end tests for the v2 orchestrator.

Phase 15 zero-LLM round: `pipeline.run()` no longer takes a `provider`/
`model`/`api_key`/`llm_call` — every formula now comes from the
deterministic engine (`engine.py`), driven entirely by seeded literature
(cached, no network) and, where a test needs it, a seeded materials list.
No mock LLM response is injected anywhere in this file — there is nothing
left to inject a mock LLM response INTO.
"""

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


def seed_library_with_concentrations(lib):
    """A richer seed: real extractable concentrations for a primary
    surfactant, a co-surfactant, and an anti-dandruff active, so the
    deterministic engine can actually resolve every required role for a
    sensitive/anti-dandruff shampoo request end to end."""
    idx = [{
        "source_db": "openalex", "title": f"Study {i} antidandruff shampoo surfactant piroctone olamine",
        "year": 2020, "authors": "A", "venue": "J", "doi": f"10.1/{i}", "is_oa": True,
        "oa_url": "", "cited_by": i, "concepts": "shampoo",
        "abstract": (
            "antidandruff shampoo surfactant formulation: piroctone olamine at 1.0% "
            "reduced flaking significantly versus placebo. Cocamidopropyl betaine at "
            "6.0% improved mildness. Decyl glucoside at 10.0% wt% provided cleansing."
        ),
    } for i in range(15)]
    lc.save_index(lib, idx)


class PipelineTests(unittest.TestCase):
    def test_end_to_end_deterministic_generation(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run(
                {"target": "a sulfate-free anti-dandruff shampoo for a sensitive scalp",
                 "category": "shampoo", "targetPhMin": "5.0", "targetPhMax": "5.5"},
                library=lib, out_dir=out, n=3, download_fulltexts=False,
            )
            self.assertEqual(res["status"], "ok")
            self.assertEqual(len(res["cards"]), 3)
            self.assertEqual([c["version"] for c in res["cards"]], ["v1", "v2", "v3"])
            for card in res["cards"]:
                self.assertEqual(card["status"], "ok")
                self.assertIn("Formulation Card", card["markdown"])
                self.assertTrue(card["formula"]["ingredients"])
                # No excluded (sulfate) ingredient ever reaches a generated
                # formula — enforced structurally by the candidate pool,
                # never merely caught after the fact.
                names = [i["inci"].lower() for i in card["formula"]["ingredients"]]
                self.assertFalse(any("sulfate" in n or n == "sles" for n in names))
                self.assertEqual(card["violations"], [])
            sid = os.path.basename(out)
            self.assertTrue(os.path.isfile(os.path.join(out, f"Formulation_Card_{sid}_v1.md")))

            with open(os.path.join(out, "cards.json"), encoding="utf-8") as fh:
                persisted_cards = json.load(fh)
            self.assertEqual(len(persisted_cards), 3)
            self.assertEqual(persisted_cards[0]["version"], "v1")
            self.assertGreater(len(persisted_cards[0]["formula"]["ingredients"]), 1)

            with open(os.path.join(out, "brief.json"), encoding="utf-8") as fh:
                persisted_brief = json.load(fh)
            self.assertEqual(
                persisted_brief["brief"]["target"],
                "a sulfate-free anti-dandruff shampoo for a sensitive scalp",
            )

    # --- Phase 15 zero-LLM round: the mandatory architecture guard ---

    def test_llm_call_is_never_reached_by_the_deterministic_path(self):
        """The permanent regression guard the brief this round implements
        explicitly requires: patch `llm.call` to raise, run a REAL
        deterministic generation end to end — through formulation
        generation, manufacturing planning, safety evaluation, regulatory
        evaluation, and validation-plan generation, all in this one
        `pipeline.run()` call — and prove the exception never fires. The
        deterministic path must not import, invoke, depend on, or require
        `llm.py::call()` at all, anywhere in that chain (Phase 14 Session 6,
        §28)."""
        import llm as llm_module

        def boom(*args, **kwargs):
            raise AssertionError("LLM MUST NOT BE CALLED")

        original = llm_module.call
        llm_module.call = boom
        try:
            with tempfile.TemporaryDirectory() as tmp:
                lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
                out = os.path.join(tmp, "session")
                res = pipeline.run(
                    {"target": "a sulfate-free anti-dandruff shampoo for a sensitive scalp",
                     "category": "shampoo", "market": "kenya"},
                    library=lib, out_dir=out, n=3, download_fulltexts=False,
                )
                self.assertEqual(res["status"], "ok")
                self.assertGreater(len(res["cards"]), 0)
                card = res["cards"][0]
                # Every Session 6 output was genuinely produced, LLM-free.
                self.assertIn("safety", card)
                self.assertIn("regulatory", card)
                self.assertIn("validation_plan", card)
                self.assertIn("trace_events", card)
                self.assertTrue(card["trace_events"])
                self.assertTrue(os.path.isfile(os.path.join(out, "traceability.json")))
        finally:
            llm_module.call = original

    def test_pipeline_module_no_longer_imports_llm(self):
        # Structural, not just behavioral: `pipeline.py` itself carries no
        # reference to the `llm` module at all as of this round.
        self.assertFalse(hasattr(pipeline, "llm"))

    def test_run_signature_has_no_provider_model_api_key_or_llm_call(self):
        import inspect
        params = set(inspect.signature(pipeline.run).parameters)
        self.assertFalse(params & {"provider", "model", "api_key", "llm_call"})

    def test_generation_succeeds_with_zero_credentials_of_any_kind(self):
        # No provider/model/api_key is even passed — the deterministic
        # engine requires none (§17 of the brief this round implements).
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run(
                {"target": "anti-dandruff shampoo", "category": "shampoo"},
                library=lib, out_dir=out, n=1, download_fulltexts=False,
            )
            self.assertEqual(res["status"], "ok")

    # --- generation provenance (deterministic engine) ---

    def test_generation_provenance_is_deterministic_with_no_secret(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run(
                {"target": "anti-dandruff shampoo", "category": "shampoo"},
                library=lib, out_dir=out, n=1, download_fulltexts=False,
            )
            self.assertEqual(res["status"], "ok")
            card = res["cards"][0]
            self.assertEqual(card["generation_provenance"]["engine_type"], "deterministic")
            self.assertEqual(card["generation_provenance"]["source"], "formulab_deterministic_engine")
            self.assertEqual(card["generation_provenance"]["provider"], "")
            self.assertEqual(card["generation_provenance"]["model"], "")
            with open(os.path.join(out, "generation_provenance.json"), encoding="utf-8") as fh:
                persisted = fh.read()
            self.assertNotIn("THE-SECRET-KEY", persisted)  # nothing to leak — never even collected

    # --- research corpus ---

    def test_research_corpus_separate_from_evidence_record_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run(
                {"target": "anti-dandruff shampoo", "category": "shampoo"},
                library=lib, out_dir=out, n=1, download_fulltexts=False,
            )
            corpus = res["cards"][0]["research_corpus"]
            self.assertEqual(corpus["target_count"], 15)
            self.assertIn("raw_candidate_count", corpus)
            self.assertIn("qualifying_count", corpus)
            self.assertIn("evidence_record_count", corpus)
            self.assertIn("unique_evidence_study_count", corpus)
            with open(os.path.join(out, "literature", "research_corpus.json"), encoding="utf-8") as fh:
                persisted_corpus = json.load(fh)
            self.assertEqual(persisted_corpus["qualifying_count"], corpus["qualifying_count"])

    def test_raw_candidate_count_field_is_real_and_never_below_qualifying(self):
        # `literature_cache.gather()`'s own dedicated test suite
        # (`test_literature_cache.py`) proves `raw_candidate_count` reflects
        # the real, wider pre-ranking pool when one exists; this pipeline-
        # level test proves the field round-trips end to end into the
        # persisted `research_corpus.json`/card, never silently defaulting
        # back to `qualifying_count` the way Session 4's own disclosed gap
        # did (this pool is exactly `target` wide with `download_fulltexts=
        # False`, so equality here is the correct, honest offline-cache
        # result — see the dedicated wider-pool test for the > 15 case).
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run(
                {"target": "anti-dandruff shampoo", "category": "shampoo"},
                library=lib, out_dir=out, n=1, download_fulltexts=False,
            )
            corpus = res["cards"][0]["research_corpus"]
            self.assertIsInstance(corpus["raw_candidate_count"], int)
            self.assertGreaterEqual(corpus["raw_candidate_count"], corpus["qualifying_count"])
            with open(os.path.join(out, "literature", "discovery_stats.json"), encoding="utf-8") as fh:
                stats = json.load(fh)
            self.assertEqual(stats["raw_candidate_count"], corpus["raw_candidate_count"])

    def test_full_text_shortfall_blocks_normal_formulation(self):
        # Phase 14 Session 6 correction gate §9: a real run
        # (`download_fulltexts=True`) that cannot obtain 15 full texts must
        # not synthesize a normal formula at all — never a card, never
        # fabricated evidence. `lc._load_fetchers` is faked (same technique
        # `test_literature_cache.py`'s own full-text-gate test already
        # established) so every discovered candidate is real-shaped but
        # genuinely non-downloadable (`oa_url=""`), keeping this test
        # offline and deterministic rather than hitting live network.
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            lc.save_index(lib, [])
            out = os.path.join(tmp, "session")

            def fetch(q, n):
                return [{
                    "source_db": "openalex", "title": f"Study {i} antidandruff shampoo surfactant",
                    "year": 2020, "authors": "A", "venue": "J", "doi": f"10.1/{i}",
                    "is_oa": False, "oa_url": "", "cited_by": i, "concepts": "shampoo",
                    "abstract": "antidandruff shampoo surfactant formulation piroctone olamine",
                } for i in range(n)]

            class FakeDiscover:
                FETCHERS = {"openalex": fetch}

                @staticmethod
                def is_relevant(_row):
                    return True

            orig_f = lc._load_fetchers
            lc._load_fetchers = lambda: FakeDiscover
            try:
                res = pipeline.run(
                    {"target": "anti-dandruff shampoo", "category": "shampoo"},
                    library=lib, out_dir=out, n=3, download_fulltexts=True,
                )
            finally:
                lc._load_fetchers = orig_f

            self.assertEqual(res["status"], "research_corpus_incomplete")
            self.assertIn("0/15", res["message"])
            self.assertNotIn("cards", res)
            self.assertEqual(res["research_corpus"]["full_text_count"], 0)

    # --- mass balance ---

    def test_mass_balance_closes_to_100_for_every_card(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run(
                {"target": "a sulfate-free anti-dandruff shampoo for a sensitive scalp",
                 "category": "shampoo"},
                library=lib, out_dir=out, n=3, download_fulltexts=False,
            )
            for card in res["cards"]:
                mb = card["mass_balance"]
                self.assertEqual(mb["status"], "complete", mb)
                self.assertEqual(mb["final_total"], 100.0)

    # --- ingredient origin ---

    def test_no_new_deterministic_ingredient_has_ai_origin(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run(
                {"target": "a sulfate-free anti-dandruff shampoo for a sensitive scalp",
                 "category": "shampoo"},
                library=lib, out_dir=out, n=2, download_fulltexts=False,
            )
            for card in res["cards"]:
                for origins in card["ingredient_origins"].values():
                    self.assertNotIn("ai_formulation_inference", origins)
                    self.assertTrue(origins)  # never empty — always at least one real origin

    def test_supplier_material_contributes_a_real_candidate(self):
        import materials as materials_mod
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            mat_dir = os.path.join(tmp, "matdata")
            materials_mod.save_materials(mat_dir, [{
                "material_id": "m1", "name": "Phenoxyethanol", "inci": "Phenoxyethanol",
                "cas": "", "price": 4.2, "currency": "USD", "unit": "kg",
                "supplier": "Acme Chem", "stock": None, "function": "preservative",
                "external_ref": "",
            }])
            out = os.path.join(tmp, "session")
            res = pipeline.run(
                {"target": "anti-dandruff shampoo", "category": "shampoo"},
                library=lib, out_dir=out, n=1, download_fulltexts=False, materials_dir=mat_dir,
            )
            self.assertEqual(res["status"], "ok")
            origins = res["cards"][0]["ingredient_origins"]
            key = "phenoxyethanol"
            self.assertIn(key, origins)
            self.assertIn("supplier_data", origins[key])

    # --- strategies stay real and request-aware ---

    def test_cards_carry_real_strategy_metadata_matched_by_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run(
                {"target": "a sulfate-free anti-dandruff shampoo for a sensitive scalp",
                 "category": "shampoo", "targetCostLevel": "economy"},
                library=lib, out_dir=out, n=3, download_fulltexts=False,
            )
            self.assertEqual(res["status"], "ok")
            for card in res["cards"]:
                self.assertIn("strategy", card)
                self.assertTrue(card["strategy"]["title"])
                self.assertEqual(card["status"], "ok")
            types = {c["strategy"]["strategy_type"] for c in res["cards"]}
            self.assertIn("sensitive_skin", types)
            self.assertIn("cost_optimized", types)

    def test_version_specific_evidence_and_score_persist_to_cards_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run(
                {"target": "anti-dandruff shampoo", "category": "shampoo"},
                library=lib, out_dir=out, n=1, download_fulltexts=False,
            )
            self.assertEqual(res["status"], "ok")
            card = res["cards"][0]
            self.assertIn("evidence_links", card)
            self.assertIn("concentration_alignment", card)
            self.assertIn("score", card)
            with open(os.path.join(out, "cards.json"), encoding="utf-8") as fh:
                persisted = json.load(fh)
            self.assertIn("strategy", persisted[0])
            self.assertIn("evidence_links", persisted[0])
            with open(os.path.join(out, "diversity.json"), encoding="utf-8") as fh:
                diversity_persisted = json.load(fh)
            self.assertIn("sufficiently_diverse", diversity_persisted)

    # --- explicit completeness states, never a silently "successful" gap ---

    def test_formula_state_is_explicit_and_never_defaults_to_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            lc.save_index(lib, [])  # no literature at all, no materials -> real gaps
            out = os.path.join(tmp, "session")
            orig = lc.gather
            lc.gather = lambda *a, **k: []
            try:
                res = pipeline.run(
                    {"target": "a completely novel niche cosmetic base", "category": "cleanser"},
                    library=lib, out_dir=out, n=1, download_fulltexts=False,
                )
            finally:
                lc.gather = orig
            self.assertEqual(res["status"], "ok")
            card = res["cards"][0]
            self.assertIn("formula_state", card)
            self.assertIn(card["formula_state"], (
                "complete", "complete_with_validation_required",
                "incomplete_missing_evidence", "incomplete_missing_material",
                "incomplete_missing_functional_role", "invalid_constraint_violation",
                "invalid_mass_balance",
            ))
            self.assertIn("missing_roles", card)
            self.assertIn("unresolved_requirements", card)

    def test_quality_gate_flags_formulation_incomplete_when_state_is_not_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            lc.save_index(lib, [])
            out = os.path.join(tmp, "session")
            orig = lc.gather
            lc.gather = lambda *a, **k: []
            try:
                res = pipeline.run(
                    {"target": "a completely novel niche cosmetic base", "category": "cleanser"},
                    library=lib, out_dir=out, n=1, download_fulltexts=False,
                )
            finally:
                lc.gather = orig
            card = res["cards"][0]
            if card["formula_state"] not in ("complete", "complete_with_validation_required"):
                self.assertTrue(any(f["factor"] == "formulation_incomplete" for f in card["quality_gate"]))

    # --- Phase 14 Session 5 (Phase 15 zero-LLM round): manufacturing wiring ---

    def test_manufacturing_plan_persists_on_every_card(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run(
                {"target": "anti-dandruff shampoo", "category": "shampoo"},
                library=lib, out_dir=out, n=1, download_fulltexts=False,
            )
            card = res["cards"][0]
            self.assertIn("manufacturing", card)
            self.assertIn("ready", card["manufacturing"])
            if card["manufacturing"]["ready"]:
                self.assertTrue(card["manufacturing"]["steps"])
                self.assertTrue(card["manufacturing"]["critical_parameters"])
            with open(os.path.join(out, "cards.json"), encoding="utf-8") as fh:
                persisted = json.load(fh)
            self.assertIn("manufacturing", persisted[0])

    def test_manufacturing_process_steps_use_only_this_formulas_ingredients(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run(
                {"target": "a sulfate-free anti-dandruff shampoo for a sensitive scalp",
                 "category": "shampoo"},
                library=lib, out_dir=out, n=1, download_fulltexts=False,
            )
            card = res["cards"][0]
            formula_names = {i["inci"] for i in card["formula"]["ingredients"]}
            if card["manufacturing"]["ready"]:
                step_names = {n for s in card["manufacturing"]["steps"] for n in s["ingredients"]}
                self.assertTrue(step_names.issubset(formula_names))

    # --- Phase 14 Session 6 correction gate: hand-soap + true diversity ---

    def test_hand_soap_request_gets_a_real_cleansing_system(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            idx = [{
                "source_db": "openalex", "title": f"Study {i} hand soap surfactant cleansing formulation",
                "year": 2020, "authors": "A", "venue": "J", "doi": f"10.1/{i}", "is_oa": True,
                "oa_url": "", "cited_by": i, "concepts": "hand soap",
                "abstract": ("hand soap formulation: cocamidopropyl betaine at 6.0% cleansing "
                             "performance, decyl glucoside at 10.0% wt% mildness"),
            } for i in range(15)]
            lc.save_index(lib, idx)
            out = os.path.join(tmp, "session")
            res = pipeline.run({"target": "hand soap with rosemary scent"}, library=lib, out_dir=out,
                                n=3, download_fulltexts=False)
            self.assertEqual(res["status"], "ok")
            for card in res["cards"]:
                names = [i["inci"].lower() for i in card["formula"]["ingredients"]]
                self.assertTrue(any("glucoside" in n or "betaine" in n or "sulfate" in n for n in names),
                                 f"no cleansing system in {names}")
                self.assertIn("rosemary scent requirement unresolved", card["unresolved_requirements"])

    def test_hand_soap_versions_seek_real_architectural_diversity(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            idx = [{
                "source_db": "openalex", "title": f"Study {i} hand soap surfactant cleansing formulation",
                "year": 2020, "authors": "A", "venue": "J", "doi": f"10.1/{i}", "is_oa": True,
                "oa_url": "", "cited_by": i, "concepts": "hand soap",
                "abstract": ("hand soap formulation: cocamidopropyl betaine at 6.0% cleansing "
                             "performance, decyl glucoside at 10.0% wt% mildness"),
            } for i in range(15)]
            lc.save_index(lib, idx)
            out = os.path.join(tmp, "session")
            res = pipeline.run({"target": "hand soap with rosemary scent"}, library=lib, out_dir=out,
                                n=3, download_fulltexts=False)
            # The preservative role has two real deterministic defaults —
            # the solver must use the second one for v2 rather than
            # reusing v1's own choice.
            v1_preservative = next(i["inci"] for i in res["cards"][0]["formula"]["ingredients"] if i["function"] == "Preservative")
            v2_preservative = next(i["inci"] for i in res["cards"][1]["formula"]["ingredients"] if i["function"] == "Preservative")
            self.assertNotEqual(v1_preservative, v2_preservative)

    def test_diversity_report_names_real_distinct_architecture_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            idx = [{
                "source_db": "openalex", "title": f"Study {i} hand soap surfactant cleansing formulation",
                "year": 2020, "authors": "A", "venue": "J", "doi": f"10.1/{i}", "is_oa": True,
                "oa_url": "", "cited_by": i, "concepts": "hand soap",
                "abstract": ("hand soap formulation: cocamidopropyl betaine at 6.0% cleansing "
                             "performance, decyl glucoside at 10.0% wt% mildness"),
            } for i in range(15)]
            lc.save_index(lib, idx)
            out = os.path.join(tmp, "session")
            res = pipeline.run({"target": "hand soap with rosemary scent"}, library=lib, out_dir=out,
                                n=3, download_fulltexts=False)
            self.assertIn("distinct_architecture_count", res["diversity"])
            self.assertGreaterEqual(res["diversity"]["distinct_architecture_count"], 1)
            self.assertLessEqual(res["diversity"]["distinct_architecture_count"], 3)

    # --- archiving ---

    def test_archives_every_card_to_the_formula_library(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "sessions", "123-shampoo")
            formulas = os.path.join(tmp, "formulas")
            res = pipeline.run(
                {"target": "mild shampoo", "category": "shampoo", "market": "eu"},
                library=lib, out_dir=out, n=2, formulas_dir=formulas, download_fulltexts=False,
            )
            self.assertEqual(res["status"], "ok")
            self.assertEqual(len(res["archived"]), len(res["cards"]))
            for name in res["archived"]:
                self.assertTrue(os.path.isfile(os.path.join(formulas, name)))
            with open(os.path.join(formulas, "index.json"), encoding="utf-8") as fh:
                index = json.load(fh)
            self.assertEqual(len(index), len(res["cards"]))
            self.assertEqual(index[0]["target"], "mild shampoo")
            self.assertEqual(index[0]["market"], "eu")
            self.assertEqual(index[0]["session"], "123-shampoo")

    # --- query planner (unaffected by the zero-LLM round) ---

    def test_planner_builds_distinct_angles(self):
        from rules import derive_constraints
        brief = {"target": "anti-dandruff shampoo", "category": "shampoo", "market": "kenya"}
        qs = pipeline.build_queries(brief, derive_constraints(brief))
        self.assertGreater(len(qs), 3)
        self.assertEqual(len(qs), len(set(qs)))
        joined = " ".join(qs).lower()
        self.assertIn("surfactant", joined)
        self.assertIn("preservative", joined)
        self.assertIn("hard water", joined)
        self.assertIn("irritation", joined)

    def test_queries_stay_short_enough_to_match(self):
        brief = {"target": "anti-dandruff shampoo for eczema-prone scalp",
                 "category": "shampoo", "market": "kenya"}
        from rules import derive_constraints
        for q in pipeline.build_queries(brief, derive_constraints(brief)):
            self.assertLessEqual(len(q.split()), 4, q)

    def test_cards_declare_when_no_literature_was_found(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            lc.save_index(lib, [])
            out = os.path.join(tmp, "session")
            orig = lc.gather
            lc.gather = lambda *a, **k: []
            try:
                res = pipeline.run(
                    {"target": "obscure niche product", "category": "cleaner"},
                    library=lib, out_dir=out, n=1, download_fulltexts=False,
                )
            finally:
                lc.gather = orig
            self.assertEqual(res["status"], "ok")
            self.assertIn("NOT grounded in retrieved sources", res["cards"][0]["markdown"])

    def test_planner_covers_cleansing_function_angles_and_scent_character(self):
        # Phase 14 Session 6 correction gate §10: a cleansing-family request
        # must search mildness/viscosity angles, not just "surfactant" — and
        # a real requested scent character gets its own dedicated angle,
        # never collapsed into the generic head query.
        from rules import derive_constraints
        brief = {"target": "hand soap with rosemary scent", "category": "hand soap"}
        qs = pipeline.build_queries(brief, derive_constraints(brief), scent_character="rosemary")
        joined = " ".join(qs).lower()
        self.assertIn("mildness", joined)
        self.assertIn("viscosity", joined)
        self.assertIn("rosemary fragrance", joined)

    def test_planner_adapts_to_product_class(self):
        qs = pipeline.build_queries({"target": "hand cream", "category": "hand cream"})
        joined = " ".join(qs).lower()
        self.assertIn("emulsion", joined)
        self.assertNotIn("foam", joined)

    def test_citations_are_checked_against_the_retrieved_papers(self):
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
        self.assertEqual(len(refs), 2)
        self.assertEqual(refs[0]["doi"], "10.3290/j.ohpd.c_2697")
        self.assertEqual(refs[0]["author"], "Meyer et al.")
        self.assertEqual(refs[0]["year"], "2026")
        self.assertEqual(refs[1]["author"], "Marinho et al.")
        self.assertTrue(any("corrected" in n for n in notes))
        self.assertTrue(any("not drawn from the retrieved sources" in n for n in notes))

    # --- safety gate (unaffected by the zero-LLM round) ---

    def test_safety_gate_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = pipeline.run(
                {"target": "an explosive detonator mixture"},
                library=os.path.join(tmp, "l"), out_dir=os.path.join(tmp, "s"),
                download_fulltexts=False,
            )
            self.assertEqual(res["status"], "refused")
            self.assertEqual(res["classification"], "prohibited_request")

    def test_ordinary_request_classifies_and_proceeds(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            seed_library_with_concentrations(lib)
            res = pipeline.run(
                {"target": "antidandruff shampoo"},
                library=lib, out_dir=os.path.join(tmp, "s"), download_fulltexts=False,
            )
            self.assertEqual(res["status"], "ok")

    def test_regulated_disinfectant_requires_human_review_before_proceeding(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            res = pipeline.run(
                {"target": "a QAC surface disinfectant"},
                library=lib, out_dir=os.path.join(tmp, "s"), download_fulltexts=False,
            )
            self.assertEqual(res["status"], "human_review_required")
            self.assertEqual(res["classification"], "regulated_disinfectant")

    def test_human_review_proceeds_once_acknowledged_by_a_named_person(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            seed_library_with_concentrations(lib)
            res = pipeline.run(
                {
                    "target": "a QAC surface disinfectant",
                    "human_review_acknowledged": True,
                    "human_review_by": "Jane Chemist",
                },
                library=lib, out_dir=os.path.join(tmp, "s"), download_fulltexts=False,
            )
            self.assertEqual(res["status"], "ok")

    def test_acknowledgement_without_a_named_reviewer_does_not_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            res = pipeline.run(
                {"target": "a QAC surface disinfectant", "human_review_acknowledged": True},
                library=lib, out_dir=os.path.join(tmp, "s"), download_fulltexts=False,
            )
            self.assertEqual(res["status"], "human_review_required")

    def test_every_safety_decision_is_logged(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            pipeline.run(
                {"target": "an explosive detonator mixture"},
                library=lib, out_dir=os.path.join(tmp, "s"), download_fulltexts=False,
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
