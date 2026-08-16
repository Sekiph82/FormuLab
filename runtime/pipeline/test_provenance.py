"""Tests for Phase 14 Session 4's generation provenance, ingredient-origin
classification, deterministic mass-balance validation, and quality gate —
deterministic, no network, no LLM call.
"""

import unittest

import provenance as pv
from rules import derive_constraints


class GenerationProvenanceTests(unittest.TestCase):
    def test_real_values_only(self):
        p = pv.build_generation_provenance("gemini", "gemini-3.1-flash")
        self.assertEqual(p.engine_type, "llm")
        self.assertEqual(p.source, "real_model_call")
        self.assertEqual(p.provider, "gemini")
        self.assertEqual(p.model, "gemini-3.1-flash")
        self.assertTrue(p.generated_at)

    def test_never_carries_a_secret_field(self):
        p = pv.build_generation_provenance("openai", "gpt-5")
        d = p.to_dict()
        self.assertNotIn("api_key", d)
        self.assertNotIn("apiKey", d)
        self.assertNotIn("key", d)


class IngredientOriginTests(unittest.TestCase):
    def test_evidence_linked_ingredient(self):
        brief = {"target": "a daily shampoo"}
        c = derive_constraints(brief)
        links = [{"ingredient_key": "piroctone-olamine", "evidence_class": "A"}]
        origins = pv.classify_ingredient_origin("Piroctone Olamine", brief, c, links)
        self.assertIn(pv.IngredientOrigin.SCIENTIFIC_EVIDENCE, origins)

    def test_deterministic_rule_ingredient(self):
        brief = {"target": "anti-dandruff shampoo for sensitive scalp"}
        c = derive_constraints(brief)
        origins = pv.classify_ingredient_origin("Cocamidopropyl Betaine", brief, c, [])
        self.assertEqual(origins, [pv.IngredientOrigin.DETERMINISTIC_RULE])

    def test_user_required_ingredient_not_double_labeled_as_rule(self):
        # rules.py folds preferredIngredients directly into constraints["prefer"] —
        # this must not ALSO produce a misleading DETERMINISTIC_RULE label.
        brief = {"target": "a daily shampoo", "preferredIngredients": "aloe vera"}
        c = derive_constraints(brief)
        origins = pv.classify_ingredient_origin("Aloe Vera", brief, c, [])
        self.assertEqual(origins, [pv.IngredientOrigin.USER_REQUIRED])

    def test_unrecognized_ingredient_is_honest_ai_inference(self):
        brief = {"target": "a daily shampoo"}
        c = derive_constraints(brief)
        origins = pv.classify_ingredient_origin("Some Random Chemical", brief, c, [])
        self.assertEqual(origins, [pv.IngredientOrigin.AI_FORMULATION_INFERENCE])

    def test_an_ingredient_can_carry_multiple_real_origins(self):
        brief = {"target": "a daily shampoo", "preferredIngredients": "piroctone olamine"}
        c = derive_constraints(brief)
        links = [{"ingredient_key": "piroctone-olamine", "evidence_class": "B"}]
        origins = pv.classify_ingredient_origin("Piroctone Olamine", brief, c, links)
        self.assertIn(pv.IngredientOrigin.SCIENTIFIC_EVIDENCE, origins)
        self.assertIn(pv.IngredientOrigin.USER_REQUIRED, origins)

    def test_supplier_and_internal_origins_are_never_emitted_this_session(self):
        # No live masterdata/supplier connection is wired into generation —
        # these reserved categories must never be fabricated.
        brief = {"target": "a daily shampoo"}
        c = derive_constraints(brief)
        for name in ("Glycerin", "Xanthan Gum", "Citric Acid", "Random Thing"):
            origins = pv.classify_ingredient_origin(name, brief, c, [])
            self.assertNotIn(pv.IngredientOrigin.SUPPLIER_DATA, origins)
            self.assertNotIn(pv.IngredientOrigin.INTERNAL_FORMULAB_DATA, origins)


class MassBalanceTests(unittest.TestCase):
    def test_normal_qs_closes_to_100(self):
        mb = pv.compute_mass_balance([
            {"inci": "Water (Aqua)", "weight_pct": "q.s. 100"},
            {"inci": "SLES", "weight_pct": "10.0"},
            {"inci": "CAPB", "weight_pct": "5.0"},
        ])
        self.assertEqual(mb.status, "complete")
        self.assertEqual(mb.final_total, 100.0)
        self.assertEqual(mb.qs_amount, 85.0)

    def test_the_129_5_percent_bug_scenario_is_now_correct(self):
        # The exact bug this session's brief names: q.s. 100 must never be
        # treated as an ADDITIONAL 100% on top of the other ingredients.
        mb = pv.compute_mass_balance([
            {"inci": "Water (Aqua)", "weight_pct": "q.s. 100"},
            {"inci": "A", "weight_pct": "20.0"},
            {"inci": "B", "weight_pct": "9.5"},
        ])
        self.assertEqual(mb.status, "complete")
        self.assertEqual(mb.final_total, 100.0)  # never 129.5

    def test_exact_100_without_qs(self):
        mb = pv.compute_mass_balance([
            {"inci": "A", "weight_pct": "60.0"},
            {"inci": "B", "weight_pct": "40.0"},
        ])
        self.assertEqual(mb.status, "complete")
        self.assertEqual(mb.final_total, 100.0)

    def test_over_100_without_qs_is_invalid(self):
        mb = pv.compute_mass_balance([
            {"inci": "A", "weight_pct": "60.0"},
            {"inci": "B", "weight_pct": "60.0"},
        ])
        self.assertEqual(mb.status, "invalid_over_100")

    def test_under_100_without_qs_is_incomplete(self):
        mb = pv.compute_mass_balance([{"inci": "A", "weight_pct": "50.0"}])
        self.assertEqual(mb.status, "incomplete")

    def test_negative_qs_is_rejected(self):
        mb = pv.compute_mass_balance([
            {"inci": "Water (Aqua)", "weight_pct": "q.s. 100"},
            {"inci": "A", "weight_pct": "60.0"},
            {"inci": "B", "weight_pct": "60.0"},
        ])
        self.assertEqual(mb.status, "invalid_negative_qs")
        self.assertLess(mb.qs_amount, 0)

    def test_multiple_qs_ingredients_are_flagged_ambiguous(self):
        mb = pv.compute_mass_balance([
            {"inci": "A", "weight_pct": "q.s. 100"},
            {"inci": "B", "weight_pct": "q.s. 100"},
        ])
        self.assertEqual(mb.status, "ambiguous_multiple_qs")
        self.assertEqual(len(mb.qs_ingredient_keys), 2)

    def test_malformed_percentage_is_flagged(self):
        mb = pv.compute_mass_balance([{"inci": "A", "weight_pct": "a lot"}])
        self.assertEqual(mb.status, "malformed")

    def test_qs_case_and_spacing_variants_recognized(self):
        for variant in ("q.s. 100", "q.s 100", "QS 100", "qs to 100", "Q.S."):
            mb = pv.compute_mass_balance([{"inci": "Water", "weight_pct": variant}])
            self.assertEqual(len(mb.qs_ingredient_keys), 1, variant)


class QualityGateTests(unittest.TestCase):
    def test_every_factor_is_documented(self):
        formula = {"ingredients": [{"inci": "Mystery Active", "function": "Active", "weight_pct": "2.0"}]}
        mb = pv.compute_mass_balance(formula["ingredients"])
        findings = pv.assess_quality(formula, ["contains excluded ingredient"], [], mb,
                                      corpus_qualifying_count=11, corpus_target_count=15)
        for f in findings:
            self.assertIn(f.factor, pv.QUALITY_GATE_FACTORS)

    def test_does_not_reject_a_formula_merely_for_lacking_journal_evidence(self):
        # assess_quality only ever returns findings/warnings — never a
        # reject/accept verdict on its own.
        formula = {"ingredients": [{"inci": "Glycerin", "function": "Humectant", "weight_pct": "2.0"}]}
        mb = pv.compute_mass_balance(formula["ingredients"])
        findings = pv.assess_quality(formula, [], [], mb)
        self.assertIsInstance(findings, list)  # never raises/blocks

    def test_hard_constraint_violation_is_flagged(self):
        formula = {"ingredients": [{"inci": "SLES", "function": "Surfactant", "weight_pct": "q.s. 100"}]}
        mb = pv.compute_mass_balance(formula["ingredients"])
        findings = pv.assess_quality(formula, ["contains excluded ingredient 'sles'"], [], mb)
        self.assertTrue(any(f.factor == "hard_constraint_violation" for f in findings))

    def test_insufficient_research_corpus_is_flagged(self):
        formula = {"ingredients": [{"inci": "Water", "function": "Solvent", "weight_pct": "q.s. 100"}]}
        mb = pv.compute_mass_balance(formula["ingredients"])
        findings = pv.assess_quality(formula, [], [], mb, corpus_qualifying_count=9, corpus_target_count=15)
        self.assertTrue(any(f.factor == "insufficient_research_corpus" for f in findings))

    def test_full_corpus_does_not_trigger_the_shortfall_finding(self):
        formula = {"ingredients": [{"inci": "Water", "function": "Solvent", "weight_pct": "q.s. 100"}]}
        mb = pv.compute_mass_balance(formula["ingredients"])
        findings = pv.assess_quality(formula, [], [], mb, corpus_qualifying_count=15, corpus_target_count=15)
        self.assertFalse(any(f.factor == "insufficient_research_corpus" for f in findings))


if __name__ == "__main__":
    unittest.main()
