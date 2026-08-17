"""Tests for the Phase 15 zero-LLM deterministic formulation engine."""

import unittest

import engine
from evidence import (
    ConcentrationValue,
    EvidenceClass,
    EvidenceRecord,
    normalize_ingredient_key,
)
from rules import derive_constraints


def make_record(ingredient_raw, value=None, unit="%", basis="", doi="10.1/x", evidence_class=EvidenceClass.A):
    return EvidenceRecord(
        schema_version=1, paper_doi=doi, paper_title=f"Paper about {ingredient_raw}",
        paper_year="2021", paper_authors="Doe J", paper_venue="J", unique_source_count=1,
        provenance_sources=["openalex"], ingredient_key=normalize_ingredient_key(ingredient_raw),
        ingredient_raw=ingredient_raw, is_full_formulation=True, product_context="",
        concentration=(ConcentrationValue(value=value, value_max=None, unit=unit, basis=basis) if value is not None else None),
        function="", outcome="reduced flaking", process=__import__("evidence").ProcessObservation(),
        evidence_text=f"{ingredient_raw} at {value}{unit}", source_location="full_text:results",
        source_depth="full_text", evidence_class=evidence_class, confidence=0.9,
    )


class RequirementParserTests(unittest.TestCase):
    def test_recognizes_controlled_vocabulary_signals(self):
        brief = {"target": "a sulfate-free anti-dandruff shampoo for a sensitive scalp"}
        parsed = engine.parse_requirements(brief)
        self.assertIn("sulfate_free", parsed.resolved)
        self.assertIn("anti_dandruff", parsed.resolved)
        self.assertIn("sensitive_scalp", parsed.resolved)

    def test_leftover_free_text_is_persisted_as_unresolved_not_guessed(self):
        brief = {"target": "a shampoo with quantum-infused crystal essence"}
        parsed = engine.parse_requirements(brief)
        self.assertTrue(any("quantum" in f or "crystal" in f for f in parsed.unresolved_fragments))

    def test_fully_recognized_request_has_no_unresolved_fragments(self):
        brief = {"target": "a sulfate-free anti-dandruff shampoo"}
        parsed = engine.parse_requirements(brief)
        self.assertEqual(parsed.unresolved_fragments, [])


class FunctionalRoleTests(unittest.TestCase):
    def test_category_group_covers_multiple_product_types_not_just_shampoo(self):
        self.assertEqual(engine.category_group("", "a shampoo"), "cleansing")
        self.assertEqual(engine.category_group("", "a fluoride toothpaste"), "oral")
        self.assertEqual(engine.category_group("", "a hand cream"), "leave_on")
        self.assertEqual(engine.category_group("", "a laundry detergent"), "cleansing")
        self.assertEqual(engine.category_group("", "an unusual novel product"), "generic")

    def test_sensitive_request_upgrades_cosurfactant_to_required(self):
        brief = {"target": "a sensitive scalp anti-dandruff shampoo"}
        constraints = derive_constraints(brief)
        parsed = engine.parse_requirements(brief)
        roles = engine.resolve_role_requirements("cleansing", brief, constraints, parsed)
        self.assertEqual(roles["mildness_cosurfactant"], engine.REQUIRED)

    def test_anti_dandruff_signal_requires_active_treatment(self):
        brief = {"target": "an anti-dandruff shampoo"}
        constraints = derive_constraints(brief)
        parsed = engine.parse_requirements(brief)
        roles = engine.resolve_role_requirements("cleansing", brief, constraints, parsed)
        self.assertEqual(roles["active_treatment"], engine.REQUIRED)

    def test_ordinary_request_leaves_active_treatment_optional(self):
        brief = {"target": "a daily shampoo"}
        constraints = derive_constraints(brief)
        parsed = engine.parse_requirements(brief)
        roles = engine.resolve_role_requirements("cleansing", brief, constraints, parsed)
        self.assertEqual(roles["active_treatment"], engine.OPTIONAL)

    def test_fragrance_excluded_on_sensitive_scalp_hair_product_is_not_applicable(self):
        brief = {"target": "an anti-dandruff shampoo for a sensitive scalp"}
        constraints = derive_constraints(brief)
        parsed = engine.parse_requirements(brief)
        roles = engine.resolve_role_requirements("cleansing", brief, constraints, parsed)
        self.assertEqual(roles["fragrance"], engine.NOT_APPLICABLE)


class CandidatePoolTests(unittest.TestCase):
    def test_unknown_ingredient_never_enters_the_pool(self):
        brief = {"target": "a shampoo"}
        constraints = derive_constraints(brief)
        records = [make_record("Some Totally Unrecognized Compound XYZ", value=1.0)]
        pool = engine.build_candidate_pool(brief, constraints, records, [])
        self.assertNotIn(normalize_ingredient_key("Some Totally Unrecognized Compound XYZ"), pool.candidates)

    def test_scientific_evidence_candidate_enters_the_pool(self):
        brief = {"target": "a shampoo"}
        constraints = derive_constraints(brief)
        records = [make_record("Piroctone Olamine", value=1.0)]
        pool = engine.build_candidate_pool(brief, constraints, records, [])
        c = pool.candidates[normalize_ingredient_key("Piroctone Olamine")]
        self.assertIn(engine.ORIGIN_SCIENTIFIC_EVIDENCE, c.origins)

    def test_supplier_candidate_enters_the_pool(self):
        brief = {"target": "a shampoo"}
        constraints = derive_constraints(brief)
        materials = [{"inci": "Phenoxyethanol", "name": "Phenoxyethanol", "function": "preservative", "price": 3.0}]
        pool = engine.build_candidate_pool(brief, constraints, [], materials)
        c = pool.candidates[normalize_ingredient_key("Phenoxyethanol")]
        self.assertIn(engine.ORIGIN_SUPPLIER_DATA, c.origins)
        self.assertIn("preservative", c.roles)

    def test_deterministic_rule_candidate_enters_the_pool(self):
        brief = {"target": "a sensitive scalp shampoo"}  # triggers MILD_SURFACTANTS via rules.py
        constraints = derive_constraints(brief)
        pool = engine.build_candidate_pool(brief, constraints, [], [])
        c = pool.candidates[normalize_ingredient_key("Decyl Glucoside")]
        self.assertIn(engine.ORIGIN_DETERMINISTIC_RULE, c.origins)

    def test_explicit_user_preferred_candidate_enters_the_pool_as_user_required(self):
        brief = {"target": "a shampoo", "preferredIngredients": "Aloe Vera"}
        constraints = derive_constraints(brief)
        pool = engine.build_candidate_pool(brief, constraints, [], [])
        c = pool.candidates[normalize_ingredient_key("Aloe Vera")]
        self.assertIn(engine.ORIGIN_USER_REQUIRED, c.origins)
        self.assertNotIn(engine.ORIGIN_DETERMINISTIC_RULE, c.origins)  # no double-labeling

    def test_excluded_candidate_is_marked_excluded_and_never_fills_a_role(self):
        brief = {"target": "a sulfate-free sensitive scalp shampoo"}
        constraints = derive_constraints(brief)
        records = [make_record("Sodium Laureth Sulfate", value=12.0)]
        pool = engine.build_candidate_pool(brief, constraints, records, [])
        c = pool.candidates[normalize_ingredient_key("Sodium Laureth Sulfate")]
        self.assertTrue(c.excluded)
        matches = engine._candidates_for_role(pool, "primary_surfactant")
        self.assertNotIn(c, matches)

    def test_water_is_always_a_deterministic_rule_solvent_candidate(self):
        brief = {"target": "a shampoo"}
        constraints = derive_constraints(brief)
        pool = engine.build_candidate_pool(brief, constraints, [], [])
        c = pool.candidates[normalize_ingredient_key("Water (Aqua)")]
        self.assertIn("solvent", c.roles)
        self.assertIn(engine.ORIGIN_DETERMINISTIC_RULE, c.origins)


class ConcentrationHierarchyTests(unittest.TestCase):
    def test_resolves_from_comparable_evidence_statistics(self):
        records = [
            make_record("Piroctone Olamine", value=1.0, doi="10.1/a"),
            make_record("Piroctone Olamine", value=1.2, doi="10.1/b"),
        ]
        c = engine.IngredientCandidate(key=normalize_ingredient_key("Piroctone Olamine"),
                                         display_name="Piroctone Olamine", roles=["active_treatment"],
                                         origins=[engine.ORIGIN_SCIENTIFIC_EVIDENCE], evidence_records=records)
        res = engine.resolve_concentration(c, "active_treatment", records, "balanced")
        self.assertEqual(res.source_type, "scientific_evidence")
        self.assertIsNotNone(res.value)

    def test_resolves_from_a_single_reported_concentration(self):
        records = [make_record("Piroctone Olamine", value=1.0)]
        c = engine.IngredientCandidate(key=normalize_ingredient_key("Piroctone Olamine"),
                                         display_name="Piroctone Olamine", roles=["active_treatment"],
                                         origins=[engine.ORIGIN_SCIENTIFIC_EVIDENCE], evidence_records=records)
        res = engine.resolve_concentration(c, "active_treatment", records, "balanced")
        self.assertEqual(res.source_type, "scientific_evidence")
        self.assertEqual(res.value, 1.0)

    def test_resolves_from_supplier_recommended_range_when_present(self):
        c = engine.IngredientCandidate(
            key="x", display_name="X", roles=["chelator"], origins=[engine.ORIGIN_SUPPLIER_DATA],
            supplier_material={"recommended_min_pct": 0.1, "recommended_max_pct": 0.3},
        )
        res = engine.resolve_concentration(c, "chelator", [], "balanced")
        self.assertEqual(res.source_type, "supplier_data")
        self.assertIsNotNone(res.value)

    def test_resolves_from_internal_engineering_default_for_non_active_role(self):
        c = engine.IngredientCandidate(key="x", display_name="X", roles=["preservative"],
                                         origins=[engine.ORIGIN_DETERMINISTIC_RULE])
        res = engine.resolve_concentration(c, "preservative", [], "balanced")
        self.assertEqual(res.source_type, "deterministic_rule")
        self.assertIsNotNone(res.value)

    def test_never_uses_generic_range_for_active_treatment_or_primary_surfactant(self):
        c = engine.IngredientCandidate(key="x", display_name="X", roles=["active_treatment"],
                                         origins=[engine.ORIGIN_DETERMINISTIC_RULE])
        res = engine.resolve_concentration(c, "active_treatment", [], "balanced")
        self.assertEqual(res.source_type, "unresolved")
        self.assertIsNone(res.value)

    def test_missing_concentration_is_never_invented(self):
        c = engine.IngredientCandidate(key="x", display_name="X", roles=["primary_surfactant"],
                                         origins=[engine.ORIGIN_DETERMINISTIC_RULE])
        res = engine.resolve_concentration(c, "primary_surfactant", [], "balanced")
        self.assertEqual(res.source_type, "unresolved")
        self.assertIsNone(res.value)

    def test_implausible_evidence_value_is_rejected_not_propagated(self):
        # Real bug found during this round's own live network acceptance
        # test: a mis-extracted "89%" (almost certainly an unrelated
        # outcome statistic, e.g. "89% of patients improved", attributed by
        # evidence.py's own text extraction to the wrong number) paired
        # with a real 1.0% record produced an averaged "ketoconazole at
        # 45%" — scientifically absurd for an active in a rinse-off
        # shampoo. The plausibility gate must reject the whole comparable-
        # stats group (since its own observed_max is implausible) and fall
        # through to the single-record tier, which itself must also reject
        # the same implausible record and continue to the next real
        # candidate rather than average/propagate the bad number.
        records = [
            make_record("Ketoconazole", value=1.0, doi="10.1/real"),
            make_record("Ketoconazole", value=89.0, doi="10.1/misextracted"),
        ]
        c = engine.IngredientCandidate(key=normalize_ingredient_key("Ketoconazole"),
                                         display_name="Ketoconazole", roles=["active_treatment"],
                                         origins=[engine.ORIGIN_SCIENTIFIC_EVIDENCE], evidence_records=records)
        res = engine.resolve_concentration(c, "active_treatment", records, "balanced")
        self.assertNotEqual(res.value, 45.0)
        if res.value is not None:
            self.assertLessEqual(res.value, 20.0)

    def test_plausible_evidence_value_still_resolves_normally(self):
        records = [make_record("Piroctone Olamine", value=1.0)]
        c = engine.IngredientCandidate(key=normalize_ingredient_key("Piroctone Olamine"),
                                         display_name="Piroctone Olamine", roles=["active_treatment"],
                                         origins=[engine.ORIGIN_SCIENTIFIC_EVIDENCE], evidence_records=records)
        res = engine.resolve_concentration(c, "active_treatment", records, "balanced")
        self.assertEqual(res.source_type, "scientific_evidence")
        self.assertEqual(res.value, 1.0)

    def test_strategy_bias_moves_value_within_the_evidence_range(self):
        records = [
            make_record("Piroctone Olamine", value=0.5, doi="10.1/a"),
            make_record("Piroctone Olamine", value=1.5, doi="10.1/b"),
        ]
        c = engine.IngredientCandidate(key=normalize_ingredient_key("Piroctone Olamine"),
                                         display_name="Piroctone Olamine", roles=["active_treatment"],
                                         origins=[engine.ORIGIN_SCIENTIFIC_EVIDENCE], evidence_records=records)
        low = engine.resolve_concentration(c, "active_treatment", records, "cost_optimized").value
        high = engine.resolve_concentration(c, "active_treatment", records, "max_performance").value
        self.assertLess(low, high)


class SolverTests(unittest.TestCase):
    def _strategy(self, strategy_type="balanced", title="Balanced"):
        import strategy as strategy_mod
        return strategy_mod.VersionStrategy(
            formula_version_id="v1", label="V1", strategy_type=strategy_type, title=title,
            rationale="test", primary_priorities=[], secondary_priorities=[],
            tradeoffs_accepted=[], tradeoffs_forbidden=[],
        )

    def test_complete_formula_closes_with_water_as_qs(self):
        brief = {"target": "anti-dandruff shampoo", "category": "shampoo"}
        constraints = derive_constraints(brief)
        parsed = engine.parse_requirements(brief)
        group = engine.category_group("shampoo", brief["target"])
        roles = engine.resolve_role_requirements(group, brief, constraints, parsed)
        records = [
            make_record("Piroctone Olamine", value=1.0),
            make_record("Decyl Glucoside", value=10.0),
            make_record("Cocamidopropyl Betaine", value=6.0),
        ]
        pool = engine.build_candidate_pool(brief, constraints, records, [])
        result = engine.build_formula_for_strategy(self._strategy(), group, roles, pool, records, constraints, parsed)
        qs = [i for i in result.formula["ingredients"] if i["weight_pct"] == "q.s. 100"]
        self.assertEqual(len(qs), 1)
        self.assertEqual(qs[0]["inci"], "Water (Aqua)")

    def test_missing_required_role_produces_incomplete_functional_role_state(self):
        brief = {"target": "an entirely evidence-free novel product", "category": "cleanser"}
        constraints = derive_constraints(brief)
        parsed = engine.parse_requirements(brief)
        group = "generic"
        roles = {"solvent_or_base": engine.REQUIRED}
        pool = engine.CandidatePool(candidates={}, excluded_keys=[])  # deliberately empty
        result = engine.build_formula_for_strategy(self._strategy(), group, roles, pool, [], constraints, parsed)
        self.assertEqual(result.state, engine.FORMULA_INCOMPLETE_MISSING_FUNCTIONAL_ROLE)
        self.assertTrue(result.missing_roles)

    def test_strategies_produce_meaningfully_different_concentrations(self):
        brief = {"target": "an anti-dandruff shampoo", "category": "shampoo", "targetCostLevel": "economy"}
        constraints = derive_constraints(brief)
        parsed = engine.parse_requirements(brief)
        group = engine.category_group("shampoo", brief["target"])
        roles = engine.resolve_role_requirements(group, brief, constraints, parsed)
        records = [
            make_record("Piroctone Olamine", value=0.5, doi="10.1/a"),
            make_record("Piroctone Olamine", value=1.5, doi="10.1/b"),
            make_record("Decyl Glucoside", value=10.0),
        ]
        pool = engine.build_candidate_pool(brief, constraints, records, [])
        cost = engine.build_formula_for_strategy(self._strategy("cost_optimized", "Cost Optimized"),
                                                    group, roles, pool, records, constraints, parsed)
        perf = engine.build_formula_for_strategy(self._strategy("max_performance", "Maximum Performance"),
                                                    group, roles, pool, records, constraints, parsed)

        def active_pct(res):
            for i in res.formula["ingredients"]:
                if i["inci"].lower() == "piroctone olamine":
                    return float(i["weight_pct"])
            return None

        self.assertLess(active_pct(cost), active_pct(perf))

    def test_rule_violation_produces_invalid_constraint_violation_state(self):
        # Force a violating ingredient directly into the pool (bypassing the
        # normal excluded-candidate guard) to prove the state machine itself
        # reacts correctly if one ever did slip through — a belt-and-braces
        # check, since `build_candidate_pool` already prevents this in
        # practice (see `CandidatePoolTests.
        # test_excluded_candidate_is_marked_excluded_and_never_fills_a_role`).
        brief = {"target": "a sulfate-free shampoo", "category": "shampoo"}
        constraints = derive_constraints(brief)
        parsed = engine.parse_requirements(brief)
        group = "cleansing"
        roles = {"primary_surfactant": engine.REQUIRED}
        key = normalize_ingredient_key("Sodium Laureth Sulfate")
        candidate = engine.IngredientCandidate(
            key=key, display_name="Sodium Laureth Sulfate", roles=["primary_surfactant"],
            origins=[engine.ORIGIN_DETERMINISTIC_RULE],
            evidence_records=[make_record("Sodium Laureth Sulfate", value=12.0)],
        )
        pool = engine.CandidatePool(candidates={key: candidate}, excluded_keys=[])
        result = engine.build_formula_for_strategy(
            self._strategy(), group, roles, pool,
            [make_record("Sodium Laureth Sulfate", value=12.0)], constraints, parsed,
        )
        self.assertEqual(result.state, engine.FORMULA_INVALID_CONSTRAINT_VIOLATION)


if __name__ == "__main__":
    unittest.main()
