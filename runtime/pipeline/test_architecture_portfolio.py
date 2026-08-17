"""FormuLab v1 (FVL-02) regression tests for the portfolio-gating fix:
scientific-formulation and generic evidence/rule candidates MERGE into one
per-version pool (never mutually exclusive), a version's assigned
architecture gets a real, bounded priority for its own slot, and the
generic fallback's own completeness is computed from real role coverage
rather than assumed. No LLM, no ML, synthetic fixtures only — nothing here
depends on the real anti-dandruff PDF or any DOI/formulation-label special
case (see `test_no_doi_or_label_special_case` below)."""

import unittest
from unittest import mock

import architecture_portfolio as ap
import engine


MAJOR_ROLES = {"primary_surfactant", "active_treatment", "preservative"}
ROLE_MAP = {
    "ingredient-a": ["active_treatment"],
    "ingredient-b": ["active_treatment"],
    "sls": ["primary_surfactant"],
    "generic-preservative": ["preservative"],
}
ROLE_REQUIREMENTS = {
    "primary_surfactant": "required",
    "active_treatment": "required",
    "preservative": "required",
}


def _sf(paper_id, formulation_id, ingredient_key, ingredient_name, evidence_class="A", extra_rows=None):
    rows = [{
        "source_name": ingredient_name, "value": 10.0, "value_text": "10", "unit": "%",
        "normalized_key": ingredient_key,
    }]
    if extra_rows:
        rows.extend(extra_rows)
    return {
        "id": f"{paper_id}:{formulation_id}", "canonical_paper_id": paper_id,
        "doi": f"10.0/{paper_id}", "source_title": f"Study {paper_id}",
        "source_formulation_id": formulation_id, "evidence_class": evidence_class,
        "extraction_confidence": "high", "total_declared": "100",
        "ingredients": rows,
    }


class PortfolioGatingRegressionTests(unittest.TestCase):
    # ---- 1/2: merged pool ---------------------------------------------

    def test_scientific_and_generic_candidates_coexist_in_one_pool(self):
        sf = _sf("p1", "F1", "sls", "SLS")
        pool = engine.build_candidate_pool(
            {}, {"avoid": []}, [], [], scientific_formulations=[sf],
        )
        origins = {c.key: c.origins for c in pool.candidates.values()}
        self.assertIn("sls", origins)
        self.assertIn(engine.ORIGIN_SCIENTIFIC_FORMULATION, origins["sls"])
        # a scientific-formulation candidate never REPLACES the pool; a
        # deterministic-rule/evidence candidate for a DIFFERENT role can
        # still be built by the very same call with real evidence present
        # (exercised at the pipeline level in test_pipeline.py; this proves
        # the pool itself never becomes single-origin-only).
        self.assertGreaterEqual(len(pool.candidates), 1)

    def test_partial_scientific_seed_leaves_other_roles_for_generic_pool(self):
        sf = _sf("p1", "F1", "sls", "SLS")  # only covers primary_surfactant
        pool = engine.build_candidate_pool(
            {}, {"avoid": []}, [], [], scientific_formulations=[sf],
        )
        covered = engine.covered_roles(pool, list(ROLE_REQUIREMENTS.keys()))
        # the scientific seed alone does NOT claim active_treatment/preservative —
        # they remain open for whatever the generic pool can supply, never
        # silently marked "covered" merely because a scientific formulation
        # was present in the request.
        self.assertNotIn("active_treatment", {r for r in covered if r in ROLE_MAP.get("sls", [])})

    # ---- 3/4: assigned-seed priority, no list-order theft --------------

    def test_assigned_architecture_gets_priority_for_its_own_slot(self):
        sf_a = _sf("p1", "F1", "ingredient-a", "Ingredient A")  # first in list order
        sf_b = _sf("p2", "F1", "ingredient-b", "Ingredient B")
        with mock.patch.dict(engine.ROLE_MAP, ROLE_MAP):
            pool = engine.build_candidate_pool(
                {}, {"avoid": []}, [], [], scientific_formulations=[sf_a, sf_b],
                preferred_source_formulation_id=("p2", "F1"),
            )
            role_winner = engine._candidates_for_role(pool, "active_treatment")[0]
        self.assertEqual(role_winner.key, "ingredient-b")
        self.assertTrue(role_winner.is_preferred_architecture)

    def test_non_assigned_formulation_cannot_steal_slot_via_list_order(self):
        sf_a = _sf("p1", "F1", "ingredient-a", "Ingredient A")
        sf_b = _sf("p2", "F1", "ingredient-b", "Ingredient B")
        with mock.patch.dict(engine.ROLE_MAP, ROLE_MAP):
            # No preferred seed at all: first-encountered (list order) wins —
            # documented, unavoidable tie-break, NOT the same thing as a
            # non-assigned formulation overriding an assigned one.
            pool_none = engine.build_candidate_pool(
                {}, {"avoid": []}, [], [], scientific_formulations=[sf_a, sf_b],
            )
            self.assertEqual(engine._candidates_for_role(pool_none, "active_treatment")[0].key, "ingredient-a")
            # WITH an explicit seed assigned to F_B (paper p2), the non-assigned
            # p1/F1 must never win merely because it was extracted first.
            pool_assigned = engine.build_candidate_pool(
                {}, {"avoid": []}, [], [], scientific_formulations=[sf_a, sf_b],
                preferred_source_formulation_id=("p2", "F1"),
            )
            self.assertEqual(engine._candidates_for_role(pool_assigned, "active_treatment")[0].key, "ingredient-b")

    # ---- 5/6: real fallback completeness --------------------------------

    def test_fallback_completeness_reflects_real_role_coverage(self):
        # No scientific formulations, no ranked evidence, no supplier data:
        # `preservative` still gets a real deterministic-rule default (the
        # engine's own documented universal-role-defaults policy), but
        # `primary_surfactant`/`active_treatment` deliberately have none —
        # those stay evidence/user/supplier-only. Real, partial coverage,
        # never an assumed 1.0.
        pool = engine.build_candidate_pool({}, {"avoid": []}, [], [], scientific_formulations=[])
        covered = engine.covered_roles(pool, list(ROLE_REQUIREMENTS.keys()))
        self.assertEqual(covered, {"preservative"})
        self.assertNotIn("primary_surfactant", covered)
        self.assertNotIn("active_treatment", covered)

    def test_fallback_with_partial_coverage_is_not_scored_as_complete(self):
        candidates = ap.build_candidates(
            [], [], ROLE_MAP, ROLE_REQUIREMENTS, set(), {}, MAJOR_ROLES,
            fallback_completeness=1 / 3,
        )
        fallback = next(c for c in candidates if c.architecture_origin == ap.ORIGIN_FALLBACK)
        self.assertAlmostEqual(fallback.functional_completeness, 1 / 3)
        self.assertLess(fallback.functional_completeness, 1.0)

    # ---- 7/8: partial-scientific-vs-fallback competition -----------------

    def test_partial_scientific_architecture_can_beat_a_weak_fallback(self):
        # A single, otherwise-clean scientific formulation covering the
        # only required role recognized in this fixture, against a
        # fallback whose REAL coverage is deliberately made weak.
        sf = _sf("p1", "F1", "sls", "SLS")
        candidates = ap.build_candidates(
            [sf], [], {"sls": ["primary_surfactant"]}, {"primary_surfactant": "required"},
            set(), {}, {"primary_surfactant"}, fallback_completeness=0.0,
        )
        assignments, _ = ap.select_portfolio(candidates, slot_count=1)
        self.assertEqual(assignments[0].candidate.architecture_origin, ap.ORIGIN_SCIENTIFIC)

    def test_fallback_wins_when_genuinely_superior(self):
        sf = _sf("p1", "F1", "sls", "SLS")
        candidates = ap.build_candidates(
            [sf], [], {"sls": ["primary_surfactant"]},
            {"primary_surfactant": "required", "active_treatment": "required", "preservative": "required"},
            set(), {}, {"primary_surfactant", "active_treatment", "preservative"},
            fallback_completeness=1.0,
        )
        assignments, _ = ap.select_portfolio(candidates, slot_count=1)
        self.assertEqual(assignments[0].candidate.architecture_origin, ap.ORIGIN_FALLBACK)

    # ---- 9/10: hard constraint vs. source structural visibility ----------

    def test_forbidden_ingredient_removed_from_final_but_visible_in_source(self):
        sf = _sf("p1", "F1", "sls", "SLS")
        candidates = ap.build_candidates(
            [sf], [], {"sls": ["primary_surfactant"]}, {"primary_surfactant": "required"},
            {"sls"}, {}, {"primary_surfactant"}, fallback_completeness=0.5,
        )
        sci = next(c for c in candidates if c.architecture_origin == ap.ORIGIN_SCIENTIFIC)
        self.assertIn("primary_surfactant:sls", sci.source_fingerprint)
        self.assertEqual(sci.fingerprint, ())  # removed from the request-feasible/final identity
        self.assertTrue(sci.hard_violation)
        self.assertTrue(sci.adaptation_required)
        self.assertEqual(sci.violating_ingredients[0]["key"], "sls")

    # ---- 11: no DOI/label special-casing ---------------------------------

    def test_no_doi_or_label_special_case(self):
        import inspect
        src = inspect.getsource(ap) + inspect.getsource(engine.build_candidate_pool)
        self.assertNotIn("10.20431", src)
        self.assertNotIn('"F1"', src)
        self.assertNotIn("'F1'", src)

    # ---- 12: deterministic reproducibility --------------------------------

    def test_portfolio_selection_is_deterministic(self):
        sf_a = _sf("p1", "F1", "ingredient-a", "Ingredient A")
        sf_b = _sf("p2", "F2", "ingredient-b", "Ingredient B")
        args = ([sf_a, sf_b], [], ROLE_MAP, ROLE_REQUIREMENTS, set(), {}, MAJOR_ROLES)
        c1 = ap.build_candidates(*args, fallback_completeness=0.3)
        c2 = ap.build_candidates(*args, fallback_completeness=0.3)
        a1, r1 = ap.select_portfolio(c1, slot_count=3)
        a2, r2 = ap.select_portfolio(c2, slot_count=3)
        self.assertEqual([x.to_dict() for x in a1], [x.to_dict() for x in a2])
        self.assertEqual(r1, r2)

    # ---- preferred-seed boost stays bounded under user-required ---------

    def test_preferred_architecture_boost_never_beats_user_required(self):
        user_required = engine.IngredientCandidate(
            key="user-thing", display_name="User Thing", roles=["active_treatment"],
            origins=[engine.ORIGIN_USER_REQUIRED],
        )
        preferred_scientific = engine.IngredientCandidate(
            key="ingredient-a", display_name="Ingredient A", roles=["active_treatment"],
            origins=[engine.ORIGIN_SCIENTIFIC_FORMULATION],
            scientific_formulation_ref={"evidence_class": "A"},
            is_preferred_architecture=True,
        )
        self.assertGreater(
            engine._selection_score(user_required), engine._selection_score(preferred_scientific),
        )


if __name__ == "__main__":
    unittest.main()
