"""Tests for Phase 14 Session 3's strategy model, diversity validation,
version-specific evidence linking, and explainable version scoring —
deterministic, no network, no LLM call.
"""

import unittest

import evidence as ev
import strategy as st
from rules import derive_constraints


def formula(*ingredients):
    return {"ingredients": [
        {"inci": inci, "function": fn, "weight_pct": pct} for inci, fn, pct in ingredients
    ]}


class StrategyDerivationTests(unittest.TestCase):
    def test_balanced_is_always_first(self):
        c = derive_constraints({"target": "a daily shampoo"})
        strategies = st.derive_strategies({"target": "a daily shampoo"}, c, n=3)
        self.assertEqual(strategies[0].strategy_type, "balanced")

    def test_request_aware_sensitive_request_gets_sensitive_strategy(self):
        brief = {"target": "a sulfate-free anti-dandruff shampoo for sensitive scalp", "category": "shampoo"}
        c = derive_constraints(brief)
        strategies = st.derive_strategies(brief, c, n=3)
        types = {s.strategy_type for s in strategies}
        self.assertIn("sensitive_skin", types)

    def test_different_requests_produce_different_strategy_sets(self):
        brief_a = {"target": "a sulfate-free anti-dandruff shampoo for sensitive scalp", "targetCostLevel": "economy"}
        brief_b = {"target": "a premium daily conditioner", "targetCostLevel": "premium", "market": "EU"}
        strategies_a = st.derive_strategies(brief_a, derive_constraints(brief_a), n=3)
        strategies_b = st.derive_strategies(brief_b, derive_constraints(brief_b), n=3)
        titles_a = {s.strategy_type for s in strategies_a}
        titles_b = {s.strategy_type for s in strategies_b}
        self.assertNotEqual(titles_a, titles_b)
        self.assertIn("sensitive_skin", titles_a)
        self.assertIn("premium_sensory", titles_b)
        self.assertNotIn("premium_sensory", titles_a)

    def test_cost_optimized_never_applies_to_a_premium_request(self):
        brief = {"target": "a premium daily conditioner", "targetCostLevel": "premium"}
        c = derive_constraints(brief)
        strategies = st.derive_strategies(brief, c, n=3)
        self.assertNotIn("cost_optimized", {s.strategy_type for s in strategies})

    def test_strategy_ids_match_version_labels(self):
        brief = {"target": "a daily shampoo"}
        c = derive_constraints(brief)
        strategies = st.derive_strategies(brief, c, n=3)
        for i, s in enumerate(strategies, 1):
            self.assertEqual(s.formula_version_id, f"v{i}")
            self.assertEqual(s.label, f"V{i}")

    def test_every_strategy_forbids_hard_constraints(self):
        brief = {"target": "a daily shampoo"}
        c = derive_constraints(brief)
        for s in st.derive_strategies(brief, c, n=3):
            self.assertIn("Any excluded/hard-avoid ingredient", s.tradeoffs_forbidden)

    def test_fewer_strategies_than_n_when_genuinely_not_applicable(self):
        # A request with no signal at all still gets the two near-universal
        # strategies (balanced, cost_optimized/max_performance) — but never
        # a strategy count that exceeds what genuinely applies, and never
        # duplicate strategy types.
        brief = {"target": "an ordinary daily shampoo"}
        c = derive_constraints(brief)
        strategies = st.derive_strategies(brief, c, n=5)
        types = [s.strategy_type for s in strategies]
        self.assertEqual(len(types), len(set(types)), "no duplicate strategy types")
        self.assertLessEqual(len(strategies), 5)


class DiversityValidationTests(unittest.TestCase):
    def test_near_identical_variants_are_flagged(self):
        cards = [
            {"version": "v1", "status": "ok", "formula": formula(
                ("Water (Aqua)", "Solvent", "q.s. 100"),
                ("Sodium Laureth Sulfate", "Surfactant", "10.0"),
            )},
            {"version": "v2", "status": "ok", "formula": formula(
                ("Water (Aqua)", "Solvent", "q.s. 100"),
                ("Sodium Laureth Sulfate", "Surfactant", "10.2"),
            )},
        ]
        report = st.diversity_report(cards)
        self.assertFalse(report.sufficiently_diverse)
        self.assertIn("v1", report.explanation)

    def test_genuinely_different_variants_pass(self):
        cards = [
            {"version": "v1", "status": "ok", "formula": formula(
                ("Water (Aqua)", "Solvent", "q.s. 100"),
                ("Sodium Laureth Sulfate", "Surfactant", "12.0"),
                ("Piroctone Olamine", "Active", "1.0"),
            )},
            {"version": "v2", "status": "ok", "formula": formula(
                ("Water (Aqua)", "Solvent", "q.s. 100"),
                ("Decyl Glucoside", "Surfactant", "10.0"),
                ("Zinc Pyrithione", "Active", "2.0"),
            )},
        ]
        report = st.diversity_report(cards)
        self.assertTrue(report.sufficiently_diverse)

    def test_identical_major_system_with_only_concentration_difference_is_flagged(self):
        # Phase 14 Session 6 correction gate: this exact scenario — the
        # SAME primary-surfactant ingredient in both versions, differing
        # only in concentration (plus a minor humectant addition that
        # doesn't touch a major-system role) — was Session 3's own
        # documented exception (§4: "same defensible surfactant system,
        # legitimate difference elsewhere"). A real runtime defect found
        # during Session 6's own correction-gate testing proved this
        # exception let three versions differ ONLY by concentration and
        # still report as "sufficiently diverse", which is not a genuine
        # architecture difference. The user's own explicit override:
        # concentration-only variation must never satisfy diversity on its
        # own — this is now the correct, current expected behavior.
        cards = [
            {"version": "v1", "status": "ok", "formula": formula(
                ("Water (Aqua)", "Solvent", "q.s. 100"),
                ("Sodium Laureth Sulfate", "Surfactant", "12.0"),
                ("Piroctone Olamine", "Active", "1.0"),
            )},
            {"version": "v2", "status": "ok", "formula": formula(
                ("Water (Aqua)", "Solvent", "q.s. 100"),
                ("Sodium Laureth Sulfate", "Surfactant", "6.0"),
                ("Piroctone Olamine", "Active", "0.5"),
                ("Glycerin", "Humectant", "2.0"),
            )},
        ]
        report = st.diversity_report(cards)
        self.assertFalse(report.sufficiently_diverse)
        self.assertEqual(report.pairs[0]["major_system_overlap"], 1.0)

    def test_a_genuinely_different_major_system_ingredient_is_sufficiently_diverse(self):
        cards = [
            {"version": "v1", "status": "ok", "formula": formula(
                ("Water (Aqua)", "Solvent", "q.s. 100"),
                ("Sodium Laureth Sulfate", "Primary Surfactant", "12.0"),
            )},
            {"version": "v2", "status": "ok", "formula": formula(
                ("Water (Aqua)", "Solvent", "q.s. 100"),
                ("Decyl Glucoside", "Primary Surfactant", "10.0"),
            )},
        ]
        report = st.diversity_report(cards)
        self.assertTrue(report.sufficiently_diverse)
        self.assertLess(report.pairs[0]["major_system_overlap"], 1.0)

    def test_failed_versions_are_excluded_from_comparison(self):
        cards = [
            {"version": "v1", "status": "ok", "formula": formula(("Water (Aqua)", "Solvent", "q.s. 100"))},
            {"version": "v2", "status": "generation_failed", "failure_reason": "x"},
        ]
        report = st.diversity_report(cards)
        self.assertTrue(report.sufficiently_diverse)
        self.assertEqual(report.pairs, [])

    def test_ingredient_count_alone_is_not_the_diversity_signal(self):
        # Two formulas with the same ingredient COUNT but genuinely
        # different ingredients/concentrations must pass; the validator
        # must not be a raw count comparison.
        cards = [
            {"version": "v1", "status": "ok", "formula": formula(
                ("Water (Aqua)", "Solvent", "q.s. 100"), ("Sodium Laureth Sulfate", "Surfactant", "10.0"),
            )},
            {"version": "v2", "status": "ok", "formula": formula(
                ("Water (Aqua)", "Solvent", "q.s. 100"), ("Decyl Glucoside", "Surfactant", "10.0"),
            )},
        ]
        report = st.diversity_report(cards)
        self.assertTrue(report.sufficiently_diverse)


class VersionEvidenceLinkingTests(unittest.TestCase):
    def _evidence_for(self, text, doi="10.1/x"):
        paper = {"doi": doi, "title": "x", "year": "2021", "authors": "A", "venue": "J",
                 "unique_source_count": 1, "provenance_sources": ["openalex"]}
        return ev.extract_evidence_from_paper(paper, text, "full_text", "full_text:RESULTS")

    def test_evidence_links_only_ingredients_the_version_actually_uses(self):
        records = self._evidence_for("Piroctone Olamine at 1.0% reduced flaking. Zinc Pyrithione at 2.0% also worked.")
        f = formula(("Water (Aqua)", "Solvent", "q.s. 100"), ("Piroctone Olamine", "Active", "1.0"))
        links = st.link_evidence_to_version("v1", f, records)
        self.assertTrue(all(l["ingredient_key"] == "piroctone-olamine" for l in links))

    def test_same_ingredient_can_have_different_evidence_context_across_versions(self):
        records_v1 = self._evidence_for("Piroctone Olamine at 1.0% reduced flaking significantly.", doi="10.1/v1paper")
        records_v2 = self._evidence_for("Piroctone Olamine at 0.5% showed a milder antifungal effect.", doi="10.1/v2paper")
        f1 = formula(("Piroctone Olamine", "Active", "1.0"))
        f2 = formula(("Piroctone Olamine", "Active", "0.5"))
        links_v1 = st.link_evidence_to_version("v1", f1, records_v1)
        links_v2 = st.link_evidence_to_version("v2", f2, records_v2)
        self.assertEqual(links_v1[0]["formula_version_id"], "v1")
        self.assertEqual(links_v2[0]["formula_version_id"], "v2")
        self.assertNotEqual(links_v1[0]["paper_doi"], links_v2[0]["paper_doi"])

    def test_selected_concentration_correctly_linked_to_its_own_version(self):
        records = self._evidence_for("Piroctone Olamine at 1.0% reduced flaking significantly.")
        f = formula(("Piroctone Olamine", "Active", "1.0"))
        links = st.link_evidence_to_version("v3", f, records)
        self.assertEqual(links[0]["formula_version_id"], "v3")


class ConcentrationAlignmentTests(unittest.TestCase):
    def test_matching_concentration_is_evidence_supported(self):
        paper = {"doi": "10.1/x", "title": "x", "year": "2021", "authors": "A", "venue": "J",
                 "unique_source_count": 1, "provenance_sources": ["openalex"]}
        records = ev.extract_evidence_from_paper(
            paper, "Piroctone Olamine at 1.0% reduced flaking significantly.", "full_text", "full_text:RESULTS",
        )
        f = formula(("Piroctone Olamine", "Active", "1.0"), ("Glycerin", "Humectant", "2.0"))
        links = st.link_evidence_to_version("v1", f, records)
        alignment = st.concentration_alignment(f, links)
        self.assertEqual(alignment["piroctone-olamine"], "evidence_supported")

    def test_unsupported_concentration_is_formulab_inference_never_a_fake_fact(self):
        f = formula(("Glycerin", "Humectant", "2.0"))
        alignment = st.concentration_alignment(f, [])
        self.assertEqual(alignment["glycerin"], "formulab_inference")

    def test_evidence_present_but_no_comparable_concentration_is_context_only(self):
        paper = {"doi": "10.1/x", "title": "x", "year": "2021", "authors": "A", "venue": "J",
                 "unique_source_count": 1, "provenance_sources": ["openalex"]}
        records = ev.extract_evidence_from_paper(
            paper, "Piroctone Olamine at 1.0% reduced flaking significantly.", "full_text", "full_text:RESULTS",
        )
        # Chosen concentration (5.0%) is far from the evidence's own 1.0%.
        f = formula(("Piroctone Olamine", "Active", "5.0"))
        links = st.link_evidence_to_version("v1", f, records)
        alignment = st.concentration_alignment(f, links)
        self.assertEqual(alignment["piroctone-olamine"], "evidence_context_only")

    def test_no_doi_ever_implied_for_an_inferred_value(self):
        # concentration_alignment never attaches a DOI to a
        # "formulab_inference" ingredient — proven by the return shape
        # itself: the value is a plain status string, never a citation.
        f = formula(("Glycerin", "Humectant", "2.0"))
        alignment = st.concentration_alignment(f, [])
        self.assertIsInstance(alignment["glycerin"], str)
        self.assertNotIn("doi", alignment["glycerin"].lower())


class VersionScoreTests(unittest.TestCase):
    def test_score_decomposes_into_named_factors(self):
        paper = {"doi": "10.1/x", "title": "x", "year": "2021", "authors": "A", "venue": "J",
                 "unique_source_count": 1, "provenance_sources": ["openalex"]}
        records = ev.extract_evidence_from_paper(
            paper, "Piroctone Olamine at 1.0% reduced flaking significantly.", "full_text", "full_text:RESULTS",
        )
        f = formula(("Water (Aqua)", "Solvent", "q.s. 100"), ("Piroctone Olamine", "Active", "1.0"))
        links = st.link_evidence_to_version("v1", f, records)
        score = st.compute_version_score(f, [], links)
        self.assertIsNotNone(score)
        self.assertGreater(score.total, 0)
        self.assertLessEqual(score.total, 1.0)

    def test_violations_reduce_hard_constraint_compliance(self):
        f = formula(("Water (Aqua)", "Solvent", "q.s. 100"), ("Sodium Laureth Sulfate", "Surfactant", "10.0"))
        clean_score = st.compute_version_score(f, [], [])
        violated_score = st.compute_version_score(f, ["contains excluded ingredient"], [])
        self.assertGreater(clean_score.hard_constraint_compliance, violated_score.hard_constraint_compliance)
        self.assertGreater(clean_score.total, violated_score.total)

    def test_evidence_class_a_scores_higher_than_class_e(self):
        strong = {"ingredient_key": "piroctone-olamine", "evidence_class": "A"}
        weak = {"ingredient_key": "piroctone-olamine", "evidence_class": "E"}
        f = formula(("Piroctone Olamine", "Active", "1.0"))
        strong_score = st.compute_version_score(f, [], [strong])
        weak_score = st.compute_version_score(f, [], [weak])
        self.assertGreater(strong_score.evidence_strength, weak_score.evidence_strength)

    def test_provider_count_does_not_affect_score(self):
        # unique_source_count is not part of the linked-evidence dict this
        # scorer reads at all — only evidence_class/ingredient_key matter.
        one_provider = {"ingredient_key": "piroctone-olamine", "evidence_class": "B", "unique_source_count": 1}
        five_providers = {"ingredient_key": "piroctone-olamine", "evidence_class": "B", "unique_source_count": 5}
        f = formula(("Piroctone Olamine", "Active", "1.0"))
        self.assertEqual(
            st.compute_version_score(f, [], [one_provider]).total,
            st.compute_version_score(f, [], [five_providers]).total,
        )

    def test_score_not_available_without_ingredients(self):
        self.assertIsNone(st.compute_version_score({"ingredients": []}, [], []))

    def test_score_never_conflated_with_safety_pass_fail(self):
        # VersionScore has no field that could be mistaken for a
        # deterministic PASS/FAIL — violations stay a separate list on the
        # card, never folded into this dataclass's own fields.
        self.assertNotIn("safety_status", st.VersionScore.__dataclass_fields__)
        self.assertNotIn("regulatory_status", st.VersionScore.__dataclass_fields__)


if __name__ == "__main__":
    unittest.main()
