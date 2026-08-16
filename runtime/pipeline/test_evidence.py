"""Tests for Phase 14 Session 2's structured evidence extraction, A-E
classification, ranking, and formula-synthesis integration — deterministic,
no network, no LLM call except where `pipeline.run()` itself is exercised
with a mock (matching this suite's existing convention).
"""

import json
import os
import tempfile
import unittest

import evidence as ev


# --------------------------------------------------------- fixture texts ---

FULL_FORMULATION_TEXT = (
    "MATERIALS AND METHODS: A shampoo formulation was prepared containing "
    "Cocamidopropyl Betaine at 5.0 wt%, Decyl Glucoside at 8.0%, and Piroctone "
    "Olamine at 1.0%, along with Glycerin and Citric Acid for pH adjustment to "
    "pH 5.2, mixed at 40 C using a rotor-stator homogenizer for 15 min. "
    "RESULTS: the formulation with Piroctone Olamine at 1.0% showed significant "
    "reduction in dandruff scores compared to the control, with good foam "
    "stability and no reported irritation."
)

ISOLATED_INGREDIENT_TEXT = (
    "This study examined Piroctone Olamine at 1.0% for antifungal efficacy "
    "against Malassezia in a controlled experiment."
)

REVIEW_TEXT = (
    "This review of anti-dandruff actives discusses Piroctone Olamine and "
    "Zinc Pyrithione broadly across the literature."
)

OTHER_DOMAIN_TEXT = (
    "Piroctone Olamine was evaluated at 2.0% as a preservative in industrial "
    "paint coatings and showed good fungal resistance in outdoor exposure panels."
)


def paper(doi="10.1/x", title="x", unique_source_count=1, provenance=None):
    return {"doi": doi, "title": title, "year": "2021", "authors": "A. Author",
            "venue": "J. Test", "source_db": "openalex",
            "unique_source_count": unique_source_count,
            "provenance_sources": provenance or ["openalex"]}


class ExtractionDepthTests(unittest.TestCase):
    def test_full_text_extraction_produces_records(self):
        recs = ev.extract_evidence_from_paper(paper(), FULL_FORMULATION_TEXT, "full_text", "full_text:METHODS")
        self.assertGreater(len(recs), 0)
        self.assertTrue(all(r.source_depth == "full_text" for r in recs))

    def test_abstract_only_extraction_still_produces_records(self):
        recs = ev.extract_evidence_from_paper(paper(), ISOLATED_INGREDIENT_TEXT, "abstract_only", "abstract")
        self.assertGreater(len(recs), 0)
        self.assertTrue(all(r.source_depth == "abstract_only" for r in recs))

    def test_metadata_only_record_does_not_become_strong_evidence(self):
        # No text at all -> no recognizable ingredient mention -> NO record,
        # never a fabricated strong one.
        recs = ev.extract_evidence_from_paper(paper(), "", "metadata_only", "")
        self.assertEqual(recs, [])

    def test_metadata_only_with_a_bare_ingredient_mention_floors_at_class_e(self):
        recs = ev.extract_evidence_from_paper(
            paper(), "Piroctone Olamine", "metadata_only", "",
        )
        self.assertTrue(len(recs) >= 1)
        self.assertTrue(all(r.evidence_class == ev.EvidenceClass.E for r in recs))
        self.assertTrue(all(r.confidence is None for r in recs))


class ConcentrationExtractionTests(unittest.TestCase):
    def test_each_ingredient_gets_its_own_reported_concentration_not_a_neighbors(self):
        # The real bug found and fixed during this session: a naive nearest-
        # number search attached the WRONG neighbor's concentration once
        # ingredient names of different lengths were involved.
        recs = ev.extract_evidence_from_paper(paper(), FULL_FORMULATION_TEXT, "full_text", "full_text:METHODS")
        by_key = {}
        for r in recs:
            by_key.setdefault(r.ingredient_key, []).append(r)
        cpb = by_key["cocamidopropyl-betaine"][0]
        self.assertEqual((cpb.concentration.value, cpb.concentration.unit), (5.0, "wt%"))
        decyl = by_key["decyl-glucoside"][0]
        self.assertEqual((decyl.concentration.value, decyl.concentration.unit), (8.0, "%"))
        piroctone_first = by_key["piroctone-olamine"][0]
        self.assertEqual((piroctone_first.concentration.value, piroctone_first.concentration.unit), (1.0, "%"))

    def test_missing_concentration_stays_unknown_not_a_fabricated_default(self):
        recs = ev.extract_evidence_from_paper(paper(), FULL_FORMULATION_TEXT, "full_text", "full_text:METHODS")
        by_key = {}
        for r in recs:
            by_key.setdefault(r.ingredient_key, []).append(r)
        # Glycerin and Citric Acid are mentioned but no % is reported for
        # either — must stay None, never inherit a neighboring number.
        self.assertIsNone(by_key["glycerin"][0].concentration)
        self.assertIsNone(by_key["citric-acid"][0].concentration)

    def test_concentration_range_is_preserved_as_a_range(self):
        recs = ev.extract_evidence_from_paper(
            paper(), "Zinc Pyrithione at 1.0-2.0% reduced flaking in a controlled trial.",
            "full_text", "full_text:RESULTS",
        )
        zp = next(r for r in recs if r.ingredient_key == "zinc-pyrithione")
        self.assertEqual(zp.concentration.value, 1.0)
        self.assertEqual(zp.concentration.value_max, 2.0)


class EvidenceClassTests(unittest.TestCase):
    def test_class_a_direct_formulation_evidence(self):
        recs = ev.extract_evidence_from_paper(
            paper(), FULL_FORMULATION_TEXT, "full_text", "full_text:RESULTS",
            product_context="anti-dandruff shampoo",
        )
        a_records = [r for r in recs if r.evidence_class == ev.EvidenceClass.A]
        self.assertTrue(a_records, "a full-text, full-formulation, concentration+outcome record must reach Class A")
        self.assertTrue(a_records[0].concentration is not None and a_records[0].outcome)

    def test_class_b_experimental_ingredient_evidence(self):
        recs = ev.extract_evidence_from_paper(paper(), ISOLATED_INGREDIENT_TEXT, "abstract_only", "abstract")
        self.assertEqual({r.evidence_class for r in recs}, {ev.EvidenceClass.B})

    def test_class_c_review_evidence(self):
        recs = ev.extract_evidence_from_paper(paper(), REVIEW_TEXT, "abstract_only", "abstract")
        self.assertTrue(recs)
        self.assertTrue(all(r.evidence_class == ev.EvidenceClass.C for r in recs))

    def test_class_d_related_domain_evidence(self):
        recs = ev.extract_evidence_from_paper(paper(), OTHER_DOMAIN_TEXT, "full_text", "full_text:RESULTS")
        self.assertTrue(recs)
        self.assertTrue(all(r.evidence_class == ev.EvidenceClass.D for r in recs))

    def test_class_e_weak_indirect_evidence(self):
        recs = ev.extract_evidence_from_paper(paper(), "Piroctone Olamine", "metadata_only", "")
        self.assertTrue(recs)
        self.assertTrue(all(r.evidence_class == ev.EvidenceClass.E for r in recs))

    def test_a_paper_is_never_class_a_merely_for_containing_an_ingredient_name(self):
        # Same ingredient, same nominal "full text" depth, but no formulation
        # shape and no concentration/outcome — must not reach A.
        recs = ev.extract_evidence_from_paper(paper(), "Piroctone Olamine is a known antifungal compound.", "full_text", "full_text:INTRO")
        self.assertTrue(recs)
        self.assertNotEqual(recs[0].evidence_class, ev.EvidenceClass.A)


class DedupStudyCountTests(unittest.TestCase):
    def test_one_canonical_paper_via_multiple_providers_is_one_study(self):
        p = paper(unique_source_count=5, provenance=["openalex", "openaire", "europepmc", "crossref", "doaj"])
        recs = ev.extract_evidence_from_paper(p, ISOLATED_INGREDIENT_TEXT, "abstract_only", "abstract")
        self.assertEqual(ev.study_count(recs), 1)
        self.assertTrue(all(r.unique_source_count == 5 for r in recs))

    def test_multiple_findings_from_one_paper_stay_one_study(self):
        p = paper()
        text = ("Piroctone Olamine at 1.0% reduced flaking significantly. "
                "Zinc Pyrithione at 2.0% also showed antifungal efficacy versus control.")
        recs = ev.extract_evidence_from_paper(p, text, "full_text", "full_text:RESULTS")
        self.assertGreaterEqual(len(recs), 2)
        self.assertEqual(ev.study_count(recs), 1)

    def test_provenance_sources_deduped_even_if_the_paper_dict_repeats_a_source(self):
        # literature_cache's own flattening can legitimately list a source
        # more than once (found via multiple query angles) — the evidence
        # record must not display that as if it were multiple providers.
        p = paper(unique_source_count=1, provenance=["europepmc", "europepmc", "europepmc"])
        recs = ev.extract_evidence_from_paper(p, ISOLATED_INGREDIENT_TEXT, "abstract_only", "abstract")
        self.assertEqual(recs[0].provenance_sources, ["europepmc"])


class RankingTests(unittest.TestCase):
    def test_ranking_prefers_direct_experimental_evidence_over_weak_indirect(self):
        strong = ev.extract_evidence_from_paper(
            paper(doi="10.1/strong"), FULL_FORMULATION_TEXT, "full_text", "full_text:RESULTS",
        )
        weak = ev.extract_evidence_from_paper(
            paper(doi="10.1/weak"), "Piroctone Olamine", "metadata_only", "",
        )
        ranked = ev.rank_evidence(strong + weak)
        self.assertEqual(ranked[0].paper_doi, "10.1/strong")
        self.assertGreater(ev.score_evidence(ranked[0]).total, ev.score_evidence(ranked[-1]).total)

    def test_provider_count_alone_does_not_multiply_ranking_weight(self):
        # Two otherwise-identical records, differing ONLY in unique_source_count
        # (5 providers vs 1) — the score must be IDENTICAL, since provider
        # count is a confidence signal, never a scoring factor.
        p1 = paper(doi="10.1/x", unique_source_count=1)
        p5 = paper(doi="10.1/x", unique_source_count=5)
        r1 = ev.extract_evidence_from_paper(p1, ISOLATED_INGREDIENT_TEXT, "abstract_only", "abstract")[0]
        r5 = ev.extract_evidence_from_paper(p5, ISOLATED_INGREDIENT_TEXT, "abstract_only", "abstract")[0]
        self.assertEqual(ev.score_evidence(r1).total, ev.score_evidence(r5).total)
        # And the EvidenceScore dataclass itself has no provider-count field
        # to read in the first place — structurally, not just by convention.
        self.assertNotIn("unique_source_count", ev.EvidenceScore.__dataclass_fields__)

    def test_score_factors_are_individually_inspectable_not_a_black_box(self):
        recs = ev.extract_evidence_from_paper(paper(), FULL_FORMULATION_TEXT, "full_text", "full_text:RESULTS")
        a_rec = next(r for r in recs if r.evidence_class == ev.EvidenceClass.A)
        score = ev.score_evidence(a_rec)
        self.assertEqual(
            round(score.class_weight + score.full_text_bonus + score.experimental_data_bonus
                  + score.domain_comparability + score.consistency_bonus, 4),
            score.total,
        )


class IngredientNormalizationTests(unittest.TestCase):
    def test_chemically_distinct_sulfates_are_never_merged(self):
        text = "Sodium Lauryl Sulfate and Sodium Laureth Sulfate were compared in this study."
        mentions = ev.detect_ingredient_mentions(text)
        keys = {key for key, _, _, _ in mentions}
        self.assertIn("sodium-lauryl-sulfate", keys)
        self.assertIn("sodium-laureth-sulfate", keys)
        self.assertNotEqual(
            ev.normalize_ingredient_key("Sodium Lauryl Sulfate"),
            ev.normalize_ingredient_key("Sodium Laureth Sulfate"),
        )

    def test_original_reported_text_is_preserved_verbatim(self):
        recs = ev.extract_evidence_from_paper(
            paper(), "The formulation used SLES (sodium laureth sulfate) at 10%.",
            "full_text", "full_text:METHODS",
        )
        # Whichever surface form matched, it must be the RAW text, not a
        # normalized/rewritten version.
        raws = {r.ingredient_raw for r in recs}
        self.assertTrue(any(raw in "The formulation used SLES (sodium laureth sulfate) at 10%." for raw in raws))


class GapsAndFabricationGuardTests(unittest.TestCase):
    def test_evidence_context_block_states_missing_when_no_records(self):
        block = ev.build_evidence_context_block([])
        self.assertIn("MISSING", block)
        self.assertIn("FORMULAB INFERENCE", block)

    def test_evidence_context_block_separates_fact_from_inference(self):
        recs = ev.extract_evidence_from_paper(paper(), FULL_FORMULATION_TEXT, "full_text", "full_text:RESULTS")
        block = ev.build_evidence_context_block(ev.rank_evidence(recs))
        self.assertIn("FACT FROM EVIDENCE", block)
        self.assertIn("FORMULAB INFERENCE", block)
        self.assertIn("MISSING", block)

    def test_no_fabricated_doi_confidence_or_process_values_ever_appear(self):
        # A record built from text with NOTHING extractable beyond a bare
        # ingredient mention must carry only real, present values — never an
        # invented DOI, confidence, or process reading.
        recs = ev.extract_evidence_from_paper(
            {"doi": "", "title": "untitled", "year": "", "authors": "", "venue": ""},
            "Piroctone Olamine is mentioned here with no other detail at all whatsoever here.",
            "abstract_only", "abstract",
        )
        self.assertTrue(recs)
        r = recs[0]
        self.assertEqual(r.paper_doi, "")  # never invented
        self.assertIsNone(r.concentration)
        self.assertTrue(r.process.is_empty())


class PersistenceCacheTests(unittest.TestCase):
    def test_evidence_cache_round_trips_through_the_shared_library(self):
        with tempfile.TemporaryDirectory() as tmp:
            library = os.path.join(tmp, "library")
            recs = ev.extract_evidence_from_paper(paper(doi="10.1/cache"), FULL_FORMULATION_TEXT, "full_text", "full_text:RESULTS")
            cache = {}
            cache["10.1/cache"] = [r.to_dict() for r in recs]
            ev.save_evidence_cache(library, cache)
            reloaded = ev.load_evidence_cache(library)
            self.assertIn("10.1/cache", reloaded)
            self.assertEqual(len(reloaded["10.1/cache"]), len(recs))

    def test_session_evidence_persists_to_evidence_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            recs = ev.extract_evidence_from_paper(paper(), FULL_FORMULATION_TEXT, "full_text", "full_text:RESULTS")
            ev.save_session_evidence(tmp, recs)
            path = os.path.join(tmp, "evidence.json")
            self.assertTrue(os.path.isfile(path))
            with open(path, encoding="utf-8") as fh:
                loaded = json.load(fh)
            self.assertEqual(len(loaded), len(recs))
            self.assertIn("evidence_class", loaded[0])

    def test_gather_evidence_does_not_re_extract_a_cached_paper(self):
        with tempfile.TemporaryDirectory() as tmp:
            library = os.path.join(tmp, "library")
            p = paper(doi="10.1/gather-test")
            # First call populates the cache.
            ev.gather_evidence([dict(p, abstract=ISOLATED_INGREDIENT_TEXT)], "", library)
            cache_before = ev.load_evidence_cache(library)
            self.assertIn("10.1/gather-test", cache_before)
            # Second call, same paper: must reuse the cache, not error or
            # duplicate — proven by an unchanged cache file after reload.
            records = ev.gather_evidence([dict(p, abstract=ISOLATED_INGREDIENT_TEXT)], "", library)
            self.assertTrue(records)
            cache_after = ev.load_evidence_cache(library)
            self.assertEqual(cache_before, cache_after)


if __name__ == "__main__":
    unittest.main()
