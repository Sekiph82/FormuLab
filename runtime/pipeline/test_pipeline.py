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
                library=lib, out_dir=out, n=3, download_fulltexts=False,
            )
            self.assertEqual(res["status"], "ok")

    # --- generation provenance (deterministic engine) ---

    def test_generation_provenance_is_deterministic_with_no_secret(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            out = os.path.join(tmp, "session")
            res = pipeline.run(
                {"target": "anti-dandruff shampoo", "category": "shampoo"},
                library=lib, out_dir=out, n=3, download_fulltexts=False,
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
                library=lib, out_dir=out, n=3, download_fulltexts=False,
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
                library=lib, out_dir=out, n=3, download_fulltexts=False,
            )
            corpus = res["cards"][0]["research_corpus"]
            self.assertIsInstance(corpus["raw_candidate_count"], int)
            self.assertGreaterEqual(corpus["raw_candidate_count"], corpus["qualifying_count"])
            with open(os.path.join(out, "literature", "discovery_stats.json"), encoding="utf-8") as fh:
                stats = json.load(fh)
            self.assertEqual(stats["raw_candidate_count"], corpus["raw_candidate_count"])

    # --- full/partial/insufficient research-corpus policy (2026-08-17 correction) ---

    def _run_with_full_text_count(self, downloadable_count, tmp, log_lines=None):
        """A real `pipeline.run(download_fulltexts=True)` against a faked
        discovery layer (same technique `test_literature_cache.py`'s own
        full-text-gate test already established) with an EXACT, controlled
        number of genuinely downloadable candidates — the first
        `downloadable_count` of 120 real-shaped candidates carry a working
        `oa_url`, the rest do not. Fully offline and deterministic."""
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
                library=lib, out_dir=out, n=3, download_fulltexts=True,
                log=(log_lines.append if log_lines is not None else (lambda m: None)),
            )
        finally:
            lc._load_fetchers, lc._download_fulltext = orig_f, orig_d

    def test_15_of_15_full_text_is_full_status_and_generates_formulas(self):
        with tempfile.TemporaryDirectory() as tmp:
            logs = []
            res = self._run_with_full_text_count(15, tmp, logs)
            self.assertEqual(res["status"], "ok")
            self.assertEqual(len(res["cards"]), 3)
            corpus = res["cards"][0]["research_corpus"]
            self.assertEqual(corpus["full_text_count"], 15)
            self.assertEqual(corpus["status"], "full")
            for card in res["cards"]:
                self.assertNotIn("insufficient_full_text", [g["category"] for g in card["evidence_gaps"]])
            # Search stops once the preferred target is reached — no deeper
            # backfill search was needed or logged.
            self.assertFalse(any("full-text gate: searched" in m for m in logs))

    def test_14_of_15_full_text_is_partial_status_and_still_generates_formulas(self):
        with tempfile.TemporaryDirectory() as tmp:
            logs = []
            res = self._run_with_full_text_count(14, tmp, logs)
            self.assertEqual(res["status"], "ok_partial_research")
            self.assertEqual(len(res["cards"]), 3)
            corpus = res["cards"][0]["research_corpus"]
            self.assertEqual(corpus["full_text_count"], 14)
            self.assertEqual(corpus["status"], "partial")
            gaps = [g["category"] for g in res["cards"][0]["evidence_gaps"]]
            self.assertIn("insufficient_full_text", gaps)
            # The acquisition budget genuinely kept searching past the 10th
            # and past the 14th successful full text, looking for the 15th
            # (`literature_cache.gather()`'s own backfill pool was searched
            # — it just found no MORE downloadable candidates among them,
            # which is why the log's own "searched N additional" success
            # line doesn't fire; the honest SHORTFALL outcome always does).
            self.assertTrue(any("full-text gate: 14/15 SHORTFALL" in m for m in logs))

    def test_10_of_15_full_text_is_partial_status_and_still_generates_formulas(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = self._run_with_full_text_count(10, tmp)
            self.assertEqual(res["status"], "ok_partial_research")
            self.assertEqual(len(res["cards"]), 3)
            corpus = res["cards"][0]["research_corpus"]
            self.assertEqual(corpus["full_text_count"], 10)
            self.assertEqual(corpus["status"], "partial")

    def test_9_of_15_full_text_is_insufficient_and_blocks_formulation(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = self._run_with_full_text_count(9, tmp)
            self.assertEqual(res["status"], "research_corpus_incomplete")
            self.assertIn("9/10", res["message"])
            self.assertNotIn("cards", res)
            self.assertEqual(res["research_corpus"]["full_text_count"], 9)
            self.assertEqual(res["research_corpus"]["status"], "insufficient")

    def test_0_of_15_full_text_is_insufficient_and_blocks_formulation(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = self._run_with_full_text_count(0, tmp)
            self.assertEqual(res["status"], "research_corpus_incomplete")
            self.assertNotIn("cards", res)
            self.assertEqual(res["research_corpus"]["full_text_count"], 0)
            self.assertEqual(res["research_corpus"]["status"], "insufficient")

    def test_partial_corpus_never_weakens_concentration_evidence_hierarchy(self):
        # A 10-14 corpus is still real evidence, resolved through the exact
        # same six-tier hierarchy — proven here by seeding a library rich
        # enough that concentrations resolve from real evidence even though
        # the full-text count itself is only 10.
        with tempfile.TemporaryDirectory() as tmp:
            res = self._run_with_full_text_count(10, tmp)
            self.assertEqual(res["status"], "ok_partial_research")
            for card in res["cards"]:
                mb = card["mass_balance"]
                self.assertEqual(mb["status"], "complete", mb)
                for i in card["formula"]["ingredients"]:
                    if i.get("weight_pct") == "":
                        self.fail(f"invented blank concentration under partial corpus: {i}")

    def test_partial_status_round_trips_through_the_persisted_card(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = self._run_with_full_text_count(12, tmp)
            self.assertEqual(res["status"], "ok_partial_research")
            corpus_path = None
            for root, _dirs, files in os.walk(tmp):
                if "research_corpus.json" in files:
                    corpus_path = os.path.join(root, "research_corpus.json")
            self.assertIsNotNone(corpus_path)
            with open(corpus_path, encoding="utf-8") as fh:
                persisted = json.load(fh)
            self.assertEqual(persisted["status"], "partial")
            self.assertEqual(persisted["full_text_count"], 12)

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
                library=lib, out_dir=out, n=3, download_fulltexts=False,
            )
            for card in res["cards"]:
                for origins in card["ingredient_origins"].values():
                    self.assertNotIn("ai_formulation_inference", origins)
                    self.assertTrue(origins)  # never empty — always at least one real origin

    def test_supplier_material_contributes_a_real_candidate(self):
        """FVL-03.002: `materials_dir` is now the canonical Material Master
        directory (`data/master`-shaped), read via
        `master_materials_adapter.load_master_materials()` — bare JSON
        arrays, `RawMaterial.code` as identity, never the legacy
        `materials.py::save_materials()` envelope."""
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            master_dir = os.path.join(tmp, "master")
            os.makedirs(master_dir)
            with open(os.path.join(master_dir, "materials.json"), "w", encoding="utf-8") as f:
                json.dump([{
                    "code": "RM-001", "displayName": "Phenoxyethanol",
                    "inciName": "Phenoxyethanol", "casNumbers": [],
                    "functions": ["preservative"], "active": True,
                }], f)
            with open(os.path.join(master_dir, "material_suppliers.json"), "w", encoding="utf-8") as f:
                json.dump([{
                    "code": "MS-001", "materialCode": "RM-001", "supplierCode": "SUP-001",
                    "supplierTradeName": "Acme Chem", "preferred": True, "qualified": True,
                }], f)
            out = os.path.join(tmp, "session")
            res = pipeline.run(
                {"target": "anti-dandruff shampoo", "category": "shampoo"},
                library=lib, out_dir=out, n=3, download_fulltexts=False, materials_dir=master_dir,
            )
            self.assertEqual(res["status"], "ok")
            origins = res["cards"][0]["ingredient_origins"]
            key = "phenoxyethanol"
            self.assertIn(key, origins)
            self.assertIn("supplier_data", origins[key])
            ingredient_rows = [
                i for i in res["cards"][0]["formula"]["ingredients"]
                if i["inci"] == "Phenoxyethanol"
            ]
            self.assertTrue(ingredient_rows)
            self.assertEqual(ingredient_rows[0]["material_code"], "RM-001")

    def test_canonical_recommended_range_makes_tier_4_concentration_live(self):
        """FVL-03.002: the concrete regression proof FVL-03.001's audit was
        building toward — a canonical Material Master row carrying
        `recommendedMinPercent`/`recommendedMaxPercent` now reaches
        `resolve_concentration()`'s Tier 4 end to end (previously proven
        dead code for the legacy CSV path in
        `test_material_master_seam.py`)."""
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library"); seed_library_with_concentrations(lib)
            master_dir = os.path.join(tmp, "master")
            os.makedirs(master_dir)
            with open(os.path.join(master_dir, "materials.json"), "w", encoding="utf-8") as f:
                json.dump([{
                    "code": "RM-002", "displayName": "Phenoxyethanol",
                    "inciName": "Phenoxyethanol", "functions": ["preservative"],
                    "active": True, "recommendedMinPercent": "0.4", "recommendedMaxPercent": "0.9",
                }], f)
            out = os.path.join(tmp, "session")
            res = pipeline.run(
                {"target": "anti-dandruff shampoo", "category": "shampoo"},
                library=lib, out_dir=out, n=3, download_fulltexts=False, materials_dir=master_dir,
            )
            self.assertEqual(res["status"], "ok")
            events = res["cards"][0]["trace_events"]
            phenoxy_events = [
                e for e in events
                if e["subject"] == "Phenoxyethanol" and e["decision_type"] == "ingredient_selected"
            ]
            self.assertTrue(phenoxy_events)
            self.assertEqual(phenoxy_events[0]["output_values"]["source_type"], "supplier_data")

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
                library=lib, out_dir=out, n=3, download_fulltexts=False,
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
                    library=lib, out_dir=out, n=3, download_fulltexts=False,
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
                    library=lib, out_dir=out, n=3, download_fulltexts=False,
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
                library=lib, out_dir=out, n=3, download_fulltexts=False,
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
                library=lib, out_dir=out, n=3, download_fulltexts=False,
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
                library=lib, out_dir=out, n=3, formulas_dir=formulas, download_fulltexts=False,
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
                    library=lib, out_dir=out, n=3, download_fulltexts=False,
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


# ---------------------------------------------------------------------------
# FormuLab v1 correction (FVL-03): scientific formulation architecture
# priority. Fully offline/deterministic — the discovery layer is faked
# (`lc._load_fetchers`/`lc._download_fulltext`) to hand `pipeline.run()` the
# user's own REAL local anti-dandruff-shampoo PDF (a genuine F1-F5
# composition table with 10 ingredient rows and SLS present), copied
# read-only from the user's own local session directory per this project's
# standing data-safety rule — never mutated, never referenced from
# production code, skipped (not failed) when that local file is absent.
# ---------------------------------------------------------------------------

import shutil
import unittest as _unittest

_REAL_SHAMPOO_PDF = (
    r"C:\Users\sekip\Desktop\FormuLab\data\data\sessions\2026-08-17-1706-anti-dandruff-shampoo"
    r"\literature\pdfs\10.20431_2455-1538.0402005.pdf"
)
_FIXTURE_MARKER = "REALPDFFIXTURE"
_FIXTURE_DOI = "10.20431/2455-1538.0402005"


def _sci_fetch(q, n):
    out = [{
        "source_db": "openalex",
        "title": "Formulation and Evaluation of Herbal Anti-Dandruff Shampoo from Bhringraj Leaves",
        "year": 2017, "authors": "A. Author", "venue": "ARC Journal of Pharmaceutical Sciences",
        "doi": _FIXTURE_DOI, "is_oa": True, "oa_url": f"https://example.org/{_FIXTURE_MARKER}.pdf",
        "cited_by": 3, "concepts": "shampoo dandruff",
        "abstract": "Formulation and evaluation of herbal anti-dandruff shampoo containing "
                    "neem oil, lemon grass oil, bhringraj powder, henna oil, sodium lauryl sulfate.",
    }]
    out += [{
        "source_db": "openalex", "title": f"Study {q}-{i} antidandruff shampoo surfactant",
        "year": 2020, "authors": "A", "venue": "J", "doi": f"10.1/{abs(hash(q))}-{i}",
        "is_oa": True, "oa_url": f"https://example.org/{abs(hash(q))}-{i}.xml",
        "cited_by": i, "concepts": "shampoo",
        "abstract": "antidandruff shampoo surfactant formulation piroctone olamine cocamidopropyl betaine",
    } for i in range(max(n - 1, 0))]
    return out


def _sci_fake_dl(url, dest, timeout=30):
    if _FIXTURE_MARKER in url:
        shutil.copyfile(_REAL_SHAMPOO_PDF, dest)
        return dest, "full text saved"
    path = dest[:-4] + ".xml"
    with open(path, "wb") as fh:
        fh.write(b"<?xml version='1.0'?><article><body><sec><title>Methods</title>"
                 b"<p>antidandruff shampoo surfactant formulation piroctone olamine 1.0%</p>"
                 b"</sec></body></article>")
    return path, "full text saved"


class _SciFakeDiscover:
    FETCHERS = {"openalex": _sci_fetch}

    @staticmethod
    def is_relevant(_row):
        return True


def _run_with_real_shampoo_pdf(target, category, extra_brief=None):
    with tempfile.TemporaryDirectory() as tmp:
        lib = os.path.join(tmp, "library")
        out = os.path.join(tmp, "session")
        brief = {"target": target, "category": category}
        if extra_brief:
            brief.update(extra_brief)
        orig_f, orig_d = lc._load_fetchers, lc._download_fulltext
        lc._load_fetchers = lambda: _SciFakeDiscover
        lc._download_fulltext = _sci_fake_dl
        try:
            return pipeline.run(brief, library=lib, out_dir=out, n=3, download_fulltexts=True)
        finally:
            lc._load_fetchers, lc._download_fulltext = orig_f, orig_d


@_unittest.skipUnless(os.path.isfile(_REAL_SHAMPOO_PDF), "real local PDF fixture not present on this machine")
class ScientificFormulationPriorityTests(unittest.TestCase):
    def test_A_applicable_scientific_formulation_is_extracted_and_considered(self):
        res = _run_with_real_shampoo_pdf("anti-dandruff shampoo", "shampoo")
        self.assertIn(res["status"], ("ok", "ok_partial_research"))
        summary = res["scientific_formulation_summary"]
        self.assertEqual(summary["extracted_count"], 5)
        self.assertGreater(summary["with_outcomes_count"], 0)

    def test_B_applicable_formulation_is_selected_as_architecture(self):
        res = _run_with_real_shampoo_pdf("anti-dandruff shampoo", "shampoo")
        origins = {c["architecture_basis"]["origin"] for c in res["cards"]}
        self.assertTrue(origins & {"scientific_formulation", "scientific_formulation_adapted"})

    def test_C_hard_constraint_violation_is_never_copied_unchanged(self):
        res = _run_with_real_shampoo_pdf(
            "sulfate-free anti-dandruff shampoo", "shampoo", {"excludedIngredients": "sulfate"},
        )
        self.assertIn(res["status"], ("ok", "ok_partial_research"))
        for c in res["cards"]:
            names = [i["inci"].lower() for i in c["formula"]["ingredients"]]
            self.assertFalse(any("sulfate" in n or n == "sls" for n in names))

    def test_D_adaptation_trace_exists_when_source_ingredient_is_removed(self):
        res = _run_with_real_shampoo_pdf(
            "sulfate-free anti-dandruff shampoo", "shampoo", {"excludedIngredients": "sulfate"},
        )
        for c in res["cards"]:
            if c["architecture_basis"]["origin"] != "scientific_formulation_adapted":
                continue
            rejections = [e for e in c["trace_events"]
                          if e["result"] == "rejected" and "sulfate" in e["subject"].lower()]
            self.assertTrue(rejections)
            self.assertIn("scientific formulation architecture", rejections[0]["rationale"])
            self.assertEqual(c["architecture_basis"]["removed"], c["architecture_basis"]["modified"])
            self.assertGreater(c["architecture_basis"]["removed"], 0)

    def test_F_unresolved_source_ingredient_never_becomes_a_role_candidate(self):
        # Neem oil / Bhringraj Powder have no ROLE_MAP entry — they must
        # never silently appear as a chosen ingredient with an invented role.
        res = _run_with_real_shampoo_pdf("anti-dandruff shampoo", "shampoo")
        for c in res["cards"]:
            names = [i["inci"] for i in c["formula"]["ingredients"]]
            self.assertNotIn("Neem oil", names)
            self.assertNotIn("Bhringraj Powder", names)

    def test_G_multi_column_table_produces_five_formulation_records_one_paper(self):
        res = _run_with_real_shampoo_pdf("anti-dandruff shampoo", "shampoo")
        summary = res["scientific_formulation_summary"]
        self.assertEqual(summary["extracted_count"], 5)
        # A single downloaded paper's own composition table — never
        # inflates the unique-study count reported by evidence classes.
        for c in res["cards"]:
            self.assertEqual(c["research_corpus"]["scientific_formulation_count"], 5)

    def test_I_scientific_formulation_count_is_independent_of_study_count(self):
        # Five formulation records from the SAME one paper must never be
        # mistaken for five separate studies in the unrelated evidence
        # study-count figure (architecture doc §4's own distinct-counts rule).
        res = _run_with_real_shampoo_pdf("anti-dandruff shampoo", "shampoo")
        corpus = res["cards"][0]["research_corpus"]
        self.assertEqual(corpus["scientific_formulation_count"], 5)
        self.assertNotEqual(corpus["scientific_formulation_count"], corpus["unique_evidence_study_count"])

    def test_J_scientific_formulation_summary_persists_used_and_rejected_with_reasons(self):
        res = _run_with_real_shampoo_pdf("anti-dandruff shampoo", "shampoo")
        summary = res["scientific_formulation_summary"]
        self.assertEqual(len(summary["architectures_used"]) + len(summary["architectures_rejected"]), 5)
        self.assertIn("all_selected_versions_rule_only", summary)
        self.assertIn("rule_only_despite_applicable_scientific_formulation", summary)

    def test_3_to_7_compatibility_scientific_priority_still_honors_requested_n(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib = os.path.join(tmp, "library")
            out = os.path.join(tmp, "session")
            orig_f, orig_d = lc._load_fetchers, lc._download_fulltext
            lc._load_fetchers = lambda: _SciFakeDiscover
            lc._download_fulltext = _sci_fake_dl
            try:
                res = pipeline.run(
                    {"target": "anti-dandruff shampoo", "category": "shampoo"},
                    library=lib, out_dir=out, n=5, download_fulltexts=True,
                )
            finally:
                lc._load_fetchers, lc._download_fulltext = orig_f, orig_d
        self.assertIn(res["status"], ("ok", "ok_partial_research"))
        self.assertLessEqual(len(res["cards"]), 5)
        self.assertGreaterEqual(len(res["cards"]), 3)


if __name__ == "__main__":
    unittest.main()
