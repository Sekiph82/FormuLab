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

    def test_scent_character_is_extracted_as_a_narrow_structural_pattern(self):
        parsed = engine.parse_requirements({"target": "hand soap with rosemary scent"})
        self.assertEqual(parsed.scent_character, "rosemary")
        self.assertIn("fragrance_requested", parsed.resolved)
        self.assertEqual(parsed.unresolved_fragments, [])

    def test_no_scent_phrase_leaves_scent_character_empty(self):
        parsed = engine.parse_requirements({"target": "a sulfate-free anti-dandruff shampoo"})
        self.assertEqual(parsed.scent_character, "")

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

    def test_hand_soap_is_classified_cleansing_not_generic(self):
        # Phase 14 Session 6 correction gate: a real runtime defect —
        # "hand soap" matched neither "bar soap" nor "hand wash" in the
        # old cleansing-head keyword list, so it fell through to
        # "generic", whose own role library never requires a cleansing
        # system at all. This is the exact root cause of a real hand-soap
        # run producing a formula with no surfactant in it whatsoever.
        for phrase in ("hand soap with rosemary scent", "liquid hand soap", "bar soap",
                       "liquid dishwashing soap"):
            self.assertEqual(engine.category_group("", phrase), "cleansing", phrase)

    def test_cleansing_group_always_requires_a_primary_surfactant_role(self):
        brief = {"target": "hand soap with rosemary scent"}
        constraints = derive_constraints(brief)
        parsed = engine.parse_requirements(brief)
        roles = engine.resolve_role_requirements("cleansing", brief, constraints, parsed)
        self.assertEqual(roles["primary_surfactant"], engine.REQUIRED)
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

    def test_matched_scent_character_is_never_a_fabricated_ingredient(self):
        # No real "rosemary" candidate exists anywhere in the pool (no
        # evidence, no supplier row, no rule default) — the scent request
        # must never invent one.
        brief = {"target": "hand soap with rosemary scent"}
        constraints = derive_constraints(brief)
        pool = engine.build_candidate_pool(brief, constraints, [], [], scent_character="rosemary")
        self.assertFalse(any("rosemary" in k for k in pool.candidates))

    def test_a_real_matching_scent_candidate_becomes_selectable_as_fragrance(self):
        materials = [{"inci": "Rosemary Extract", "name": "Rosemary Extract", "function": "fragrance", "price": 10.0}]
        brief = {"target": "hand soap with rosemary scent"}
        constraints = derive_constraints(brief)
        pool = engine.build_candidate_pool(brief, constraints, [], materials, scent_character="rosemary")
        c = pool.candidates[normalize_ingredient_key("Rosemary Extract")]
        self.assertIn("fragrance", c.roles)
        self.assertIn(engine.ORIGIN_SUPPLIER_DATA, c.origins)

    def test_a_generic_fragrance_ingredient_never_silently_satisfies_a_specific_scent_request(self):
        # Real bug found during this round's own live network acceptance
        # testing: a request for "rosemary scent" was satisfied by a
        # generic "perfume" evidence mention (rules.py's own FRAGRANCE
        # vocabulary) filling the fragrance ROLE, silently marking the
        # SPECIFIC rosemary request as resolved even though nothing
        # rosemary-specific was ever selected.
        from evidence import EvidenceRecord as ER, ConcentrationValue, EvidenceClass, ProcessObservation
        record = ER(
            schema_version=1, paper_doi="10.1/x", paper_title="t", paper_year="2021",
            paper_authors="A", paper_venue="J", unique_source_count=1, provenance_sources=["openalex"],
            ingredient_key=normalize_ingredient_key("perfume"), ingredient_raw="perfume",
            is_full_formulation=True, product_context="", concentration=None, function="",
            outcome="", process=ProcessObservation(), evidence_text="perfume mentioned",
            source_location="abstract", source_depth="abstract_only", evidence_class=EvidenceClass.E,
            confidence=0.3,
        )
        brief = {"target": "hand soap with rosemary scent", "category": "hand soap"}
        constraints = derive_constraints(brief)
        parsed = engine.parse_requirements(brief)
        self.assertEqual(parsed.scent_character, "rosemary")
        group = "cleansing"
        roles = {"fragrance": engine.OPTIONAL}
        pool = engine.build_candidate_pool(brief, constraints, [record], [], scent_character=parsed.scent_character)
        import strategy as strategy_mod
        strat = strategy_mod.VersionStrategy(
            formula_version_id="v1", label="V1", strategy_type="balanced", title="Balanced",
            rationale="r", primary_priorities=[], secondary_priorities=[], tradeoffs_accepted=[],
            tradeoffs_forbidden=[],
        )
        result = engine.build_formula_for_strategy(strat, group, roles, pool, [record], constraints, parsed)
        self.assertIn("rosemary scent requirement unresolved", result.unresolved_requirements)


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

    def test_avoid_major_role_keys_makes_the_solver_pick_a_real_alternative(self):
        # Phase 14 Session 6 correction gate: when a real alternative
        # candidate exists for a MAJOR role, a version told to avoid an
        # already-used key must pick the alternative — real architectural
        # search, not always the same highest-ranked candidate.
        brief = {"target": "hand soap", "category": "hand soap"}
        constraints = derive_constraints(brief)
        parsed = engine.parse_requirements(brief)
        group = "cleansing"
        roles = {"preservative": engine.REQUIRED}
        pool = engine.build_candidate_pool(brief, constraints, [], [])
        v1 = engine.build_formula_for_strategy(self._strategy(), group, roles, pool, [], constraints, parsed)
        v1_preservative_key = next(s.key for s in v1.ingredients if s.role == "preservative")
        avoid = {"preservative": {v1_preservative_key}}
        v2 = engine.build_formula_for_strategy(self._strategy(), group, roles, pool, [], constraints, parsed,
                                                  avoid_major_role_keys=avoid)
        v2_preservative_key = next(s.key for s in v2.ingredients if s.role == "preservative")
        self.assertNotEqual(v1_preservative_key, v2_preservative_key)

    def test_avoid_major_role_keys_never_forces_a_fake_alternative_when_none_exists(self):
        brief = {"target": "hand soap", "category": "hand soap"}
        constraints = derive_constraints(brief)
        parsed = engine.parse_requirements(brief)
        group = "cleansing"
        roles = {"rheology_modifier": engine.REQUIRED}  # only one real default exists
        pool = engine.build_candidate_pool(brief, constraints, [], [])
        v1 = engine.build_formula_for_strategy(self._strategy(), group, roles, pool, [], constraints, parsed)
        v1_key = next(s.key for s in v1.ingredients if s.role == "rheology_modifier")
        avoid = {"rheology_modifier": {v1_key}}
        v2 = engine.build_formula_for_strategy(self._strategy(), group, roles, pool, [], constraints, parsed,
                                                  avoid_major_role_keys=avoid)
        v2_key = next(s.key for s in v2.ingredients if s.role == "rheology_modifier")
        self.assertEqual(v1_key, v2_key)  # honestly reused — no alternative existed

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
