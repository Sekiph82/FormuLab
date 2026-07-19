"""Tests for the Advanced Formulation Constraint Optimizer.

Run: python -m pytest runtime/formulation/test_advanced_optimizer.py

See docstring notes on `test_solver_timeout_is_wired_through` and
`test_cancellation_flag_defaults_false` for what this suite can and cannot
verify about timeout/cancellation in a fast unit test — true enforcement of
both lives at the Rust process layer (dropping the child process), not
inside a single CBC solve, which is documented in advanced_optimizer.py's
module docstring.
"""

import unittest

from advanced_optimizer import OptimizerError, solve


def val(v, state="known"):
    return {"value": str(v), "state": state}


def material(id_, price=None, active=None, **extra):
    m = {"id": id_, "materialCode": id_.upper(), "name": id_.upper()}
    if price is not None:
        m["price"] = val(price)
    if active is not None:
        m["activeMatterPercent"] = val(active)
    m.update(extra)
    return m


def problem(materials, batch_kg=100, comp=None, func=None, ratio=None, cond=None, objectives=None, solver=None):
    return {
        "id": "p1",
        "materials": materials,
        "batch": {"sizeKg": batch_kg},
        "compositionConstraints": comp or [],
        "functionalConstraints": func or [],
        "ratioConstraints": ratio or [],
        "conditionalConstraints": cond or [],
        "objectiveConfig": {
            "type": "weighted",
            "objectives": objectives or [{"metric": "raw_material_cost", "direction": "minimize", "weight": "1"}],
        },
        "solverConfig": solver or {},
    }


def comp_constraint(cid, ctype, **kwargs):
    c = {"id": cid, "displayName": cid, "constraintType": ctype, "strictness": "hard"}
    c.update(kwargs)
    return c


TWO_MATERIALS = [
    material("a", price=2.0, active=80, stock=val(100), minUsePercent="0", maxUsePercent="100"),
    material("b", price=1.0, active=20, stock=val(100), minUsePercent="0", maxUsePercent="100"),
]


class BasicCompositionTests(unittest.TestCase):
    def test_total_equals_100(self):
        res = solve(problem(TWO_MATERIALS, comp=[comp_constraint("t", "total_equals_100")]))
        self.assertEqual(res["status"], "optimal")
        self.assertEqual(res["totals"]["totalPercent"], "100.0000")

    def test_exact_percentage(self):
        res = solve(
            problem(
                TWO_MATERIALS,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("exact_a", "exact_percentage", materialId="a", exactPercent="30"),
                ],
            )
        )
        self.assertEqual(res["status"], "optimal")
        line_a = next(l for l in res["formulaLines"] if l["materialId"] == "a")
        self.assertEqual(line_a["percent"], "30.0000")

    def test_min_percentage(self):
        res = solve(
            problem(
                TWO_MATERIALS,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("min_a", "min_percentage", materialId="a", minPercent="40"),
                ],
                objectives=[{"metric": "raw_material_cost", "direction": "minimize", "weight": "1"}],
            )
        )
        self.assertEqual(res["status"], "optimal")
        line_a = next(l for l in res["formulaLines"] if l["materialId"] == "a")
        self.assertGreaterEqual(float(line_a["percent"]), 40.0 - 1e-6)

    def test_max_percentage(self):
        res = solve(
            problem(
                TWO_MATERIALS,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("max_a", "max_percentage", materialId="a", maxPercent="10"),
                    comp_constraint("min_active", "min_total_active_matter", minPercent="0"),
                ],
            )
        )
        self.assertEqual(res["status"], "optimal")
        line_a = next((l for l in res["formulaLines"] if l["materialId"] == "a"), None)
        if line_a:
            self.assertLessEqual(float(line_a["percent"]), 10.0 + 1e-6)

    def test_fixed_ingredient(self):
        res = solve(
            problem(
                TWO_MATERIALS,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("fix_a", "fixed_ingredient", materialId="a", exactPercent="25"),
                ],
            )
        )
        line_a = next(l for l in res["formulaLines"] if l["materialId"] == "a")
        self.assertEqual(line_a["percent"], "25.0000")

    def test_excluded_ingredient(self):
        res = solve(
            problem(
                TWO_MATERIALS,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("excl_a", "excluded_ingredient", materialId="a"),
                ],
            )
        )
        self.assertEqual(res["status"], "optimal")
        self.assertFalse(any(l["materialId"] == "a" for l in res["formulaLines"]))

    def test_water_qs_does_not_break_solve(self):
        res = solve(
            problem(
                TWO_MATERIALS,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("qs", "water_qs"),
                ],
            )
        )
        self.assertEqual(res["status"], "optimal")
        self.assertEqual(res["totals"]["totalPercent"], "100.0000")

    def test_min_total_active_matter(self):
        res = solve(
            problem(
                TWO_MATERIALS,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("min_act", "min_total_active_matter", minPercent="50"),
                ],
            )
        )
        self.assertEqual(res["status"], "optimal")
        self.assertGreaterEqual(float(res["totals"]["totalActiveMatterPercent"]), 50.0 - 1e-3)

    def test_max_total_active_matter(self):
        res = solve(
            problem(
                TWO_MATERIALS,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("max_act", "max_total_active_matter", maxPercent="30"),
                ],
                objectives=[{"metric": "raw_material_cost", "direction": "maximize", "weight": "1"}],
            )
        )
        self.assertEqual(res["status"], "optimal")
        self.assertLessEqual(float(res["totals"]["totalActiveMatterPercent"]), 30.0 + 1e-3)

    def test_active_contribution_calculation(self):
        # 30% of an 80%-active material contributes 24% active, not 30%.
        res = solve(
            problem(
                TWO_MATERIALS,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("exact_a", "exact_percentage", materialId="a", exactPercent="30"),
                ],
            )
        )
        line_a = next(l for l in res["formulaLines"] if l["materialId"] == "a")
        self.assertEqual(line_a["activeContributionPercent"], "24.0000")


class FunctionalGroupTests(unittest.TestCase):
    def _materials(self):
        return [
            material("anion", price=2.0, active=70, functions=["anionic_surfactant"], stock=val(100)),
            material("amph", price=3.0, active=40, functions=["amphoteric_surfactant"], stock=val(100)),
            material("water", price=0.01, active=0, functions=["water"], stock=val(1000)),
        ]

    def test_functional_group_minimum_raw(self):
        res = solve(
            problem(
                self._materials(),
                comp=[comp_constraint("t", "total_equals_100")],
                func=[
                    {
                        "id": "min_anion",
                        "displayName": "min anion",
                        "functionGroups": ["anionic_surfactant"],
                        "basis": "raw_material",
                        "constraintType": "min_total",
                        "value": "15",
                        "strictness": "hard",
                    }
                ],
            )
        )
        self.assertEqual(res["status"], "optimal")
        anion_pct = sum(float(l["percent"]) for l in res["formulaLines"] if l["materialId"] == "anion")
        self.assertGreaterEqual(anion_pct, 15.0 - 1e-6)

    def test_functional_group_maximum_active_basis(self):
        res = solve(
            problem(
                self._materials(),
                comp=[comp_constraint("t", "total_equals_100"), comp_constraint("min_a", "min_percentage", materialId="anion", minPercent="50")],
                func=[
                    {
                        "id": "max_anion_active",
                        "displayName": "max anion active",
                        "functionGroups": ["anionic_surfactant"],
                        "basis": "active_matter",
                        "constraintType": "max_total",
                        "value": "60",
                        "strictness": "hard",
                    }
                ],
            )
        )
        self.assertEqual(res["status"], "optimal")


class RatioTests(unittest.TestCase):
    def test_material_ratio_minimum(self):
        materials = [
            material("a", price=1.0, active=50, stock=val(1000)),
            material("b", price=1.0, active=50, stock=val(1000)),
        ]
        res = solve(
            problem(
                materials,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("min_b", "min_percentage", materialId="b", minPercent="1"),
                ],
                ratio=[
                    {
                        "id": "r1",
                        "displayName": "a:b >= 2",
                        "numerator": {"materialIds": ["a"], "basis": "raw_material"},
                        "denominator": {"materialIds": ["b"], "basis": "raw_material"},
                        "ratioType": "min_ratio",
                        "value": "2",
                        "strictness": "hard",
                    }
                ],
            )
        )
        self.assertEqual(res["status"], "optimal")
        a_pct = next((float(l["percent"]) for l in res["formulaLines"] if l["materialId"] == "a"), 0.0)
        b_pct = next((float(l["percent"]) for l in res["formulaLines"] if l["materialId"] == "b"), 0.0)
        self.assertGreaterEqual(a_pct / b_pct, 2.0 - 1e-6)

    def test_material_ratio_maximum(self):
        materials = [
            material("a", price=1.0, active=50, stock=val(1000)),
            material("b", price=1.0, active=50, stock=val(1000)),
        ]
        res = solve(
            problem(
                materials,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("min_a", "min_percentage", materialId="a", minPercent="1"),
                ],
                ratio=[
                    {
                        "id": "r1",
                        "displayName": "a:b <= 0.5",
                        "numerator": {"materialIds": ["a"], "basis": "raw_material"},
                        "denominator": {"materialIds": ["b"], "basis": "raw_material"},
                        "ratioType": "max_ratio",
                        "value": "0.5",
                        "strictness": "hard",
                    }
                ],
            )
        )
        self.assertEqual(res["status"], "optimal")
        a_pct = next((float(l["percent"]) for l in res["formulaLines"] if l["materialId"] == "a"), 0.0)
        b_pct = next((float(l["percent"]) for l in res["formulaLines"] if l["materialId"] == "b"), 1e-9)
        self.assertLessEqual(a_pct / b_pct, 0.5 + 1e-6)

    def test_ratio_with_zero_denominator_is_vacuously_satisfied(self):
        materials = [material("a", price=1.0, active=50, stock=val(1000))]
        res = solve(
            problem(
                materials,
                comp=[comp_constraint("t", "total_equals_100")],
                ratio=[
                    {
                        "id": "r1",
                        "displayName": "a:missing >= 1",
                        "numerator": {"materialIds": ["a"], "basis": "raw_material"},
                        "denominator": {"materialIds": ["missing"], "basis": "raw_material"},
                        "ratioType": "min_ratio",
                        "value": "1",
                        "strictness": "hard",
                    }
                ],
            )
        )
        self.assertEqual(res["status"], "optimal")

    def test_functional_group_ratio(self):
        materials = [
            material("anion", price=1.0, active=50, functions=["anionic_surfactant"], stock=val(1000)),
            material("amph", price=1.0, active=50, functions=["amphoteric_surfactant"], stock=val(1000)),
        ]
        res = solve(
            problem(
                materials,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("min_amph", "min_percentage", materialId="amph", minPercent="1"),
                ],
                ratio=[
                    {
                        "id": "r1",
                        "displayName": "anionic:amphoteric >= 3",
                        "numerator": {"functionGroups": ["anionic_surfactant"], "basis": "raw_material"},
                        "denominator": {"functionGroups": ["amphoteric_surfactant"], "basis": "raw_material"},
                        "ratioType": "min_ratio",
                        "value": "3",
                        "strictness": "hard",
                    }
                ],
            )
        )
        self.assertEqual(res["status"], "optimal")


class ConditionalTests(unittest.TestCase):
    def test_required_coingredient_present_forces_target(self):
        materials = [
            material("carbomer", price=5.0, active=100, functions=["rheology_modifier"], stock=val(100)),
            material("neutralizer", price=2.0, active=100, functions=["ph_adjuster"], stock=val(100)),
            material("water", price=0.01, active=0, functions=["water"], stock=val(1000)),
        ]
        res = solve(
            problem(
                materials,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("min_carbomer", "min_percentage", materialId="carbomer", minPercent="2"),
                ],
                cond=[
                    {
                        "id": "need_neutralizer",
                        "displayName": "carbomer needs neutralizer",
                        "conditionType": "if_present_then_required",
                        "trigger": {"materialId": "carbomer"},
                        "target": {"materialId": "neutralizer"},
                        "strictness": "hard",
                        "presenceThresholdPercent": "0.001",
                    }
                ],
            )
        )
        self.assertEqual(res["status"], "optimal")
        neutralizer_present = any(l["materialId"] == "neutralizer" for l in res["formulaLines"])
        self.assertTrue(neutralizer_present)

    def test_conditional_percentage_rule(self):
        materials = [
            material("active_x", price=1.0, active=100, stock=val(1000)),
            material("solubilizer", price=1.0, active=100, stock=val(1000)),
            material("water", price=0.01, active=0, stock=val(1000)),
        ]
        res = solve(
            problem(
                materials,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("fix_x", "exact_percentage", materialId="active_x", exactPercent="10"),
                ],
                cond=[
                    {
                        "id": "need_solubilizer_above_5",
                        "displayName": "above 5% needs solubilizer",
                        "conditionType": "if_exceeds_then_min_required",
                        "trigger": {"materialId": "active_x"},
                        "target": {"materialId": "solubilizer"},
                        "triggerThresholdPercent": "5",
                        "targetMinPercent": "3",
                        "strictness": "hard",
                    }
                ],
            )
        )
        self.assertEqual(res["status"], "optimal")
        solubilizer_pct = next((float(l["percent"]) for l in res["formulaLines"] if l["materialId"] == "solubilizer"), 0.0)
        self.assertGreaterEqual(solubilizer_pct, 3.0 - 1e-6)

    def test_compatibility_or_safety_exclusion(self):
        # Shared adapter mechanism for both compatibilityPolicy/safetyPolicy's
        # "exclude_blocking" mode — see docs/OPTIMIZATION_CONSTRAINTS.md.
        materials = [
            material("qac", price=1.0, active=100, functions=["qac_active"], stock=val(1000)),
            material("anionic", price=1.0, active=100, functions=["anionic_surfactant"], stock=val(1000)),
            material("water", price=0.01, active=0, stock=val(1000)),
        ]
        res = solve(
            problem(
                materials,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("min_qac", "min_percentage", materialId="qac", minPercent="1"),
                ],
                cond=[
                    {
                        "id": "qac_excludes_anionic",
                        "displayName": "QAC excludes anionic",
                        "conditionType": "if_present_then_excluded",
                        "trigger": {"materialId": "qac"},
                        "target": {"materialId": "anionic"},
                        "strictness": "blocking",
                    }
                ],
            )
        )
        self.assertEqual(res["status"], "optimal")
        self.assertFalse(any(l["materialId"] == "anionic" for l in res["formulaLines"]))


class StockAndCapTests(unittest.TestCase):
    def test_stock_limit_respected(self):
        materials = [
            material("scarce", price=1.0, active=100, stock=val(5)),
            material("plentiful", price=1.0, active=100, stock=val(1000)),
        ]
        res = solve(problem(materials, comp=[comp_constraint("t", "total_equals_100")]))
        self.assertEqual(res["status"], "optimal")
        scarce_kg = next((float(l["quantityKg"]) for l in res["formulaLines"] if l["materialId"] == "scarce"), 0.0)
        self.assertLessEqual(scarce_kg, 5.0 + 1e-6)

    def test_reserved_stock_reduces_available(self):
        materials = [
            {**material("scarce", price=1.0, active=100), "stock": val(10), "reservedStock": val(8)},
            material("plentiful", price=1.0, active=100, stock=val(1000)),
        ]
        res = solve(problem(materials, comp=[comp_constraint("t", "total_equals_100")]))
        self.assertEqual(res["status"], "optimal")
        scarce_kg = next((float(l["quantityKg"]) for l in res["formulaLines"] if l["materialId"] == "scarce"), 0.0)
        self.assertLessEqual(scarce_kg, 2.0 + 1e-6)

    def test_technical_maximum_respected(self):
        materials = [
            material("capped", price=1.0, active=100, technicalMaxPercent="3", stock=val(1000)),
            material("other", price=2.0, active=100, stock=val(1000)),
        ]
        res = solve(
            problem(
                materials,
                comp=[comp_constraint("t", "total_equals_100")],
                objectives=[{"metric": "raw_material_cost", "direction": "minimize", "weight": "1"}],
            )
        )
        capped_pct = next((float(l["percent"]) for l in res["formulaLines"] if l["materialId"] == "capped"), 0.0)
        self.assertLessEqual(capped_pct, 3.0 + 1e-6)

    def test_regulatory_maximum_respected(self):
        materials = [
            material("regulated", price=1.0, active=100, regulatoryMaxPercent=val("2"), stock=val(1000)),
            material("other", price=2.0, active=100, stock=val(1000)),
        ]
        res = solve(
            problem(
                materials,
                comp=[comp_constraint("t", "total_equals_100")],
            )
        )
        reg_pct = next((float(l["percent"]) for l in res["formulaLines"] if l["materialId"] == "regulated"), 0.0)
        self.assertLessEqual(reg_pct, 2.0 + 1e-6)


class ObjectiveTests(unittest.TestCase):
    def test_weighted_multi_objective(self):
        materials = [
            material("cheap_risky", price=1.0, active=100, stock=val(1000), supplyRiskScore=0.9),
            material("expensive_safe", price=5.0, active=100, stock=val(1000), supplyRiskScore=0.1),
        ]
        res = solve(
            problem(
                materials,
                comp=[comp_constraint("t", "total_equals_100")],
                objectives=[
                    {"metric": "raw_material_cost", "direction": "minimize", "weight": "0.5"},
                    {"metric": "supply_risk", "direction": "minimize", "weight": "0.5"},
                ],
            )
        )
        self.assertEqual(res["status"], "optimal")
        self.assertEqual(len(res["objectiveResults"]), 2)
        metrics = {o["metric"] for o in res["objectiveResults"]}
        self.assertEqual(metrics, {"raw_material_cost", "supply_risk"})

    def test_lexicographic_objective(self):
        materials = [
            material("cheap_risky", price=1.0, active=100, stock=val(1000), supplyRiskScore=0.9),
            material("expensive_safe", price=5.0, active=100, stock=val(1000), supplyRiskScore=0.1),
        ]
        problem_dict = problem(
            materials,
            comp=[comp_constraint("t", "total_equals_100")],
            objectives=[
                {"metric": "raw_material_cost", "direction": "minimize", "priority": 0},
                {"metric": "supply_risk", "direction": "minimize", "priority": 1},
            ],
        )
        problem_dict["objectiveConfig"]["type"] = "lexicographic"
        res = solve(problem_dict)
        self.assertEqual(res["status"], "optimal")
        # Cost is minimized first (cheapest material wins entirely) since it
        # has priority 0 — supply risk (priority 1) cannot trade off against it.
        cheap_pct = next((float(l["percent"]) for l in res["formulaLines"] if l["materialId"] == "cheap_risky"), 0.0)
        self.assertAlmostEqual(cheap_pct, 100.0, places=2)

    def test_performance_score_objective_is_rejected(self):
        materials = [material("a", price=1.0, active=100, stock=val(1000))]
        with self.assertRaises(OptimizerError):
            solve(
                problem(
                    materials,
                    comp=[comp_constraint("t", "total_equals_100")],
                    objectives=[{"metric": "performance_score", "direction": "maximize", "weight": "1"}],
                )
            )

    def test_solver_timeout_is_wired_through(self):
        # CBC solves a problem this small far under any reasonable timeout,
        # so this does not (and cannot, without a deliberately huge synthetic
        # MIP) exercise an actual timeout — it verifies the configured value
        # is the one reported back, i.e. the wiring is correct.
        materials = [material("a", price=1.0, active=100, stock=val(1000))]
        res = solve(
            problem(
                materials,
                comp=[comp_constraint("t", "total_equals_100")],
                solver={"timeoutSeconds": 5},
            )
        )
        self.assertEqual(res["solverMetadata"]["timeoutSeconds"], 5.0)

    def test_cancellation_flag_defaults_false(self):
        # True cancellation is enforced by the Rust command layer dropping
        # the child process (see the module docstring) — not testable from a
        # single in-process solve here.
        materials = [material("a", price=1.0, active=100, stock=val(1000))]
        res = solve(problem(materials, comp=[comp_constraint("t", "total_equals_100")]))
        self.assertFalse(res["solverMetadata"]["cancelled"])


class InfeasibilityTests(unittest.TestCase):
    def test_infeasible_stock(self):
        materials = [material("scarce", price=1.0, active=100, stock=val(5))]
        res = solve(problem(materials, comp=[comp_constraint("t", "total_equals_100")]))
        self.assertEqual(res["status"], "infeasible")
        codes = [c["code"] for c in res["infeasibility"]["causes"]]
        self.assertIn("insufficient_stock_or_usage_cap", codes)
        cause = res["infeasibility"]["causes"][0]
        self.assertTrue(cause["suggestedActions"])

    def test_infeasible_functional_target(self):
        materials = [
            material("water", price=0.01, active=0, functions=["water"], stock=val(1000)),
        ]
        res = solve(
            problem(
                materials,
                comp=[comp_constraint("t", "total_equals_100")],
                func=[
                    {
                        "id": "need_anionic",
                        "displayName": "need anionic",
                        "functionGroups": ["anionic_surfactant"],
                        "basis": "raw_material",
                        "constraintType": "min_total",
                        "value": "10",
                        "strictness": "hard",
                    }
                ],
            )
        )
        self.assertEqual(res["status"], "infeasible")
        codes = [c["code"] for c in res["infeasibility"]["causes"]]
        self.assertIn("functional_minimum_unreachable", codes)

    def test_infeasible_conditional_rule(self):
        materials = [material("carbomer", price=1.0, active=100, stock=val(1000))]
        res = solve(
            problem(
                materials,
                comp=[comp_constraint("t", "total_equals_100"), comp_constraint("min_c", "min_percentage", materialId="carbomer", minPercent="50")],
                cond=[
                    {
                        "id": "need_neutralizer",
                        "displayName": "needs neutralizer",
                        "conditionType": "if_present_then_required",
                        "trigger": {"materialId": "carbomer"},
                        "target": {"materialId": "neutralizer_not_offered"},
                        "strictness": "hard",
                    }
                ],
            )
        )
        self.assertEqual(res["status"], "infeasible")
        codes = [c["code"] for c in res["infeasibility"]["causes"]]
        self.assertIn("required_coingredient_unavailable", codes)

    def test_infeasible_ratio_returns_structured_fallback(self):
        materials = [
            material("a", price=1.0, active=100, stock=val(1000)),
            material("b", price=1.0, active=100, stock=val(1000)),
        ]
        res = solve(
            problem(
                materials,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("fix_a", "exact_percentage", materialId="a", exactPercent="90"),
                    comp_constraint("fix_b", "exact_percentage", materialId="b", exactPercent="10"),
                ],
                ratio=[
                    {
                        "id": "impossible_ratio",
                        "displayName": "impossible",
                        "numerator": {"materialIds": ["a"], "basis": "raw_material"},
                        "denominator": {"materialIds": ["b"], "basis": "raw_material"},
                        "ratioType": "max_ratio",
                        "value": "1",
                        "strictness": "hard",
                    }
                ],
            )
        )
        self.assertEqual(res["status"], "infeasible")
        self.assertTrue(res["infeasibility"]["causes"])
        for cause in res["infeasibility"]["causes"]:
            self.assertTrue(cause["message"])
            self.assertIsInstance(cause["suggestedActions"], list)
        codes = [c["code"] for c in res["infeasibility"]["causes"]]
        self.assertIn("ratio_maximum_conflict", codes)

    def test_ratio_minimum_conflict_diagnosed_when_pinned(self):
        materials = [
            material("a", price=1.0, active=100, stock=val(1000)),
            material("b", price=1.0, active=100, stock=val(1000)),
        ]
        res = solve(
            problem(
                materials,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("fix_a", "exact_percentage", materialId="a", exactPercent="10"),
                    comp_constraint("fix_b", "exact_percentage", materialId="b", exactPercent="90"),
                ],
                ratio=[
                    {
                        "id": "impossible_min_ratio",
                        "displayName": "impossible min",
                        "numerator": {"materialIds": ["a"], "basis": "raw_material"},
                        "denominator": {"materialIds": ["b"], "basis": "raw_material"},
                        "ratioType": "min_ratio",
                        "value": "1",
                        "strictness": "hard",
                    }
                ],
            )
        )
        self.assertEqual(res["status"], "infeasible")
        codes = [c["code"] for c in res["infeasibility"]["causes"]]
        self.assertIn("ratio_minimum_conflict", codes)

    def test_ratio_division_by_zero_diagnosed(self):
        materials = [material("a", price=1.0, active=100, stock=val(1000))]
        res = solve(
            problem(
                materials,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("fix_a", "exact_percentage", materialId="a", exactPercent="100"),
                ],
                ratio=[
                    {
                        "id": "no_denominator",
                        "displayName": "no denominator",
                        "numerator": {"materialIds": ["a"], "basis": "raw_material"},
                        "denominator": {"materialIds": ["nonexistent"], "basis": "raw_material"},
                        "ratioType": "exact_ratio",
                        "value": "1",
                        "strictness": "hard",
                    }
                ],
            )
        )
        self.assertEqual(res["status"], "infeasible")
        codes = [c["code"] for c in res["infeasibility"]["causes"]]
        self.assertIn("ratio_division_by_zero", codes)

    def test_property_target_unreachable_diagnosed(self):
        materials = [material("a", price=1.0, active=30, stock=val(1000))]
        p = problem(materials, comp=[comp_constraint("t", "total_equals_100")])
        p["propertyTargets"] = [
            {"id": "am_unreachable", "property": "active_matter", "minValue": "80", "enforceAs": "hard"}
        ]
        res = solve(p)
        self.assertEqual(res["status"], "infeasible")
        codes = [c["code"] for c in res["infeasibility"]["causes"]]
        self.assertIn("property_target_unreachable", codes)

    def test_all_candidates_mutually_excluded_diagnosed(self):
        materials = [
            material("a", price=1.0, active=100, stock=val(1000), minUsePercent="0", maxUsePercent="50"),
            material("b", price=1.0, active=100, stock=val(1000), minUsePercent="0", maxUsePercent="50"),
        ]
        res = solve(
            problem(
                materials,
                comp=[comp_constraint("t", "total_equals_100")],
                cond=[
                    {
                        "id": "mutual_exclusion",
                        "displayName": "a excludes b",
                        "conditionType": "if_present_then_excluded",
                        "trigger": {"materialId": "a"},
                        "target": {"materialId": "b"},
                        "strictness": "hard",
                    }
                ],
            )
        )
        self.assertEqual(res["status"], "infeasible")
        codes = [c["code"] for c in res["infeasibility"]["causes"]]
        self.assertIn("compatibility_or_safety_exclusions_remove_all_candidates", codes)


class PrecisionTests(unittest.TestCase):
    def test_percent_and_quantity_are_4dp_strings(self):
        materials = [material("a", price=1.0, active=100, stock=val(1000))]
        res = solve(problem(materials, comp=[comp_constraint("t", "total_equals_100")]))
        line = res["formulaLines"][0]
        self.assertRegex(line["percent"], r"^-?\d+\.\d{4}$")
        self.assertRegex(line["quantityKg"], r"^-?\d+\.\d{4}$")
        self.assertRegex(line["activeContributionPercent"], r"^-?\d+\.\d{4}$")


class PropertyBasedInvariantTests(unittest.TestCase):
    """Not a full property-based framework (no new test dependency added) —
    a hand-picked spread of varied problems, each checked against the same
    invariant set every optimal result must satisfy."""

    def _cases(self):
        yield problem(TWO_MATERIALS, comp=[comp_constraint("t", "total_equals_100")])
        yield problem(
            TWO_MATERIALS,
            comp=[
                comp_constraint("t", "total_equals_100"),
                comp_constraint("min_active", "min_total_active_matter", minPercent="40"),
                comp_constraint("fix_a", "min_percentage", materialId="a", minPercent="5"),
            ],
        )
        yield problem(
            [
                material("anion", price=2.0, active=70, functions=["anionic_surfactant"], stock=val(100)),
                material("amph", price=3.0, active=40, functions=["amphoteric_surfactant"], stock=val(100)),
                material("water", price=0.01, active=0, functions=["water"], stock=val(1000)),
            ],
            comp=[comp_constraint("t", "total_equals_100")],
            func=[
                {
                    "id": "min_anion",
                    "displayName": "min anion",
                    "functionGroups": ["anionic_surfactant"],
                    "basis": "raw_material",
                    "constraintType": "min_total",
                    "value": "10",
                    "strictness": "hard",
                }
            ],
        )

    def test_invariants_hold_for_every_optimal_result(self):
        for p in self._cases():
            res = solve(p)
            self.assertEqual(res["status"], "optimal", msg=p)
            total = float(res["totals"]["totalPercent"])
            self.assertAlmostEqual(total, 100.0, places=2)
            for line in res["formulaLines"]:
                self.assertGreaterEqual(float(line["percent"]), -1e-9)
                self.assertGreaterEqual(float(line["quantityKg"]), -1e-9)

    def test_fixed_ingredients_unchanged_and_excluded_ingredients_absent(self):
        p = problem(
            TWO_MATERIALS,
            comp=[
                comp_constraint("t", "total_equals_100"),
                comp_constraint("fix_a", "fixed_ingredient", materialId="a", exactPercent="15"),
                comp_constraint("excl_b", "excluded_ingredient", materialId="b"),
            ],
        )
        # b excluded means nothing can reach 85% on its own besides a fixed
        # at 15 -- add a third material to make this feasible.
        p["materials"].append(material("c", price=1.0, active=100, stock=val(1000)))
        res = solve(p)
        self.assertEqual(res["status"], "optimal")
        line_a = next(l for l in res["formulaLines"] if l["materialId"] == "a")
        self.assertEqual(line_a["percent"], "15.0000")
        self.assertFalse(any(l["materialId"] == "b" for l in res["formulaLines"]))

    def test_objective_values_reproducible(self):
        p = problem(TWO_MATERIALS, comp=[comp_constraint("t", "total_equals_100")])
        res1 = solve(p)
        res2 = solve(p)
        self.assertEqual(res1["objectiveResults"], res2["objectiveResults"])
        self.assertEqual(res1["totals"], res2["totals"])


class SoftConstraintTests(unittest.TestCase):
    """Spec §A2 — penalty-based relaxation."""

    def test_hard_constraint_never_relaxes(self):
        materials = [
            material("a", price=1.0, active=100, stock=val(1000)),
            material("b", price=1.0, active=100, stock=val(1000)),
        ]
        res = solve(
            problem(
                materials,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("exact_a", "exact_percentage", materialId="a", exactPercent="60"),
                    comp_constraint("exact_b", "exact_percentage", materialId="b", exactPercent="60"),
                ],
            )
        )
        self.assertEqual(res["status"], "infeasible")

    def test_soft_constraint_relaxes_only_when_necessary(self):
        materials = [
            material("a", price=1.0, active=100, stock=val(1000)),
            material("b", price=1.0, active=100, stock=val(1000)),
        ]
        res = solve(
            problem(
                materials,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("exact_a", "exact_percentage", materialId="a", exactPercent="60"),
                    comp_constraint(
                        "exact_b",
                        "exact_percentage",
                        materialId="b",
                        exactPercent="60",
                        strictness="soft",
                        penaltyWeight="1",
                        allowedDeviation="0",
                    ),
                ],
            )
        )
        self.assertEqual(res["status"], "feasible_with_penalties")
        line_a = next(l for l in res["formulaLines"] if l["materialId"] == "a")
        line_b = next(l for l in res["formulaLines"] if l["materialId"] == "b")
        self.assertEqual(line_a["percent"], "60.0000")
        self.assertEqual(line_b["percent"], "40.0000")
        cr_a = next(c for c in res["constraintResults"] if c["constraintId"] == "exact_a")
        cr_b = next(c for c in res["constraintResults"] if c["constraintId"] == "exact_b")
        self.assertTrue(cr_a["satisfied"])
        self.assertFalse(cr_b["satisfied"])
        self.assertEqual(cr_b["requestedTarget"], "60.0000")
        self.assertEqual(cr_b["achievedValue"], "40.0000")
        self.assertEqual(cr_b["deviation"], "20.0000")

    def test_soft_constraint_satisfied_when_reachable_is_not_flagged(self):
        materials = [
            material("a", price=1.0, active=100, stock=val(1000)),
            material("b", price=1.0, active=100, stock=val(1000)),
        ]
        res = solve(
            problem(
                materials,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint(
                        "exact_a",
                        "exact_percentage",
                        materialId="a",
                        exactPercent="30",
                        strictness="soft",
                        penaltyWeight="1",
                        allowedDeviation="0",
                    ),
                ],
            )
        )
        self.assertEqual(res["status"], "optimal")
        line_a = next(l for l in res["formulaLines"] if l["materialId"] == "a")
        self.assertEqual(line_a["percent"], "30.0000")
        cr_a = next(c for c in res["constraintResults"] if c["constraintId"] == "exact_a")
        self.assertTrue(cr_a["satisfied"])
        self.assertEqual(cr_a["deviation"], "0.0000")

    def test_higher_penalty_weight_wins_over_lower(self):
        materials = [
            material("a", price=1.0, active=100, stock=val(1000)),
            material("b", price=1.0, active=100, stock=val(1000)),
        ]
        res = solve(
            problem(
                materials,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint(
                        "min_a",
                        "min_percentage",
                        materialId="a",
                        minPercent="50",
                        strictness="soft",
                        penaltyWeight="10",
                        allowedDeviation="0",
                    ),
                    comp_constraint(
                        "max_a",
                        "max_percentage",
                        materialId="a",
                        maxPercent="30",
                        strictness="soft",
                        penaltyWeight="1",
                        allowedDeviation="0",
                    ),
                ],
            )
        )
        line_a = next(l for l in res["formulaLines"] if l["materialId"] == "a")
        self.assertAlmostEqual(float(line_a["percent"]), 50.0, places=2)
        cr_min = next(c for c in res["constraintResults"] if c["constraintId"] == "min_a")
        cr_max = next(c for c in res["constraintResults"] if c["constraintId"] == "max_a")
        self.assertTrue(cr_min["satisfied"])
        self.assertFalse(cr_max["satisfied"])

    def test_lexicographic_soft_penalties_minimized_before_objective_preference(self):
        materials = [
            material("cheap", price=1.0, active=100, stock=val(1000)),
            material("costly", price=5.0, active=100, stock=val(1000)),
        ]
        problem_dict = problem(
            materials,
            comp=[
                comp_constraint("t", "total_equals_100"),
                comp_constraint(
                    "min_costly",
                    "min_percentage",
                    materialId="costly",
                    minPercent="40",
                    strictness="soft",
                    penaltyWeight="1",
                    allowedDeviation="0",
                ),
            ],
            objectives=[{"metric": "raw_material_cost", "direction": "minimize", "priority": 0}],
        )
        problem_dict["objectiveConfig"]["type"] = "lexicographic"
        res = solve(problem_dict)
        # Cost minimization alone would want 0% of the costly material, but
        # the penalty tier is solved (and frozen) before any objective tier.
        self.assertEqual(res["status"], "optimal")
        line_costly = next(l for l in res["formulaLines"] if l["materialId"] == "costly")
        self.assertAlmostEqual(float(line_costly["percent"]), 40.0, places=2)

    def test_penalty_values_deterministic(self):
        materials = [
            material("a", price=1.0, active=100, stock=val(1000)),
            material("b", price=1.0, active=100, stock=val(1000)),
        ]
        p = problem(
            materials,
            comp=[
                comp_constraint("t", "total_equals_100"),
                comp_constraint("exact_a", "exact_percentage", materialId="a", exactPercent="60"),
                comp_constraint(
                    "exact_b",
                    "exact_percentage",
                    materialId="b",
                    exactPercent="60",
                    strictness="soft",
                    penaltyWeight="1",
                    allowedDeviation="0",
                ),
            ],
        )
        res1 = solve(p)
        res2 = solve(p)
        self.assertEqual(res1["constraintResults"], res2["constraintResults"])

    def test_soft_penalties_exceed_tolerance_warning(self):
        materials = [
            material("a", price=1.0, active=100, stock=val(1000)),
            material("b", price=1.0, active=100, stock=val(1000)),
        ]
        res = solve(
            problem(
                materials,
                comp=[
                    comp_constraint("t", "total_equals_100"),
                    comp_constraint("exact_a", "exact_percentage", materialId="a", exactPercent="60"),
                    comp_constraint(
                        "exact_b",
                        "exact_percentage",
                        materialId="b",
                        exactPercent="60",
                        strictness="soft",
                        penaltyWeight="1",
                        allowedDeviation="0",
                    ),
                ],
            )
        )
        self.assertEqual(res["status"], "feasible_with_penalties")
        codes = [w["code"] for w in res["warnings"]]
        self.assertIn("soft_penalties_exceed_tolerance", codes)

    def test_soft_constraint_without_penalty_weight_raises(self):
        materials = [material("a", price=1.0, active=100, stock=val(1000))]
        with self.assertRaises(OptimizerError):
            solve(
                problem(
                    materials,
                    comp=[
                        comp_constraint("t", "total_equals_100"),
                        comp_constraint(
                            "exact_a", "exact_percentage", materialId="a", exactPercent="30", strictness="soft"
                        ),
                    ],
                )
            )


class PropertyTargetTests(unittest.TestCase):
    """Spec §A3 — deterministic where possible, honest elsewhere."""

    def test_total_solids_calculated(self):
        materials = [
            material("a", price=1.0, active=100, stock=val(1000), solidsPercent=val(90)),
            material("b", price=1.0, active=100, stock=val(1000), solidsPercent=val(10)),
        ]
        p = problem(materials, comp=[comp_constraint("t", "total_equals_100")])
        p["propertyTargets"] = [{"id": "solids1", "property": "total_solids", "minValue": "20"}]
        res = solve(p)
        self.assertEqual(res["status"], "optimal")
        pr = next(r for r in res["propertyResults"] if r["targetId"] == "solids1")
        self.assertEqual(pr["classification"], "calculated")
        self.assertEqual(pr["dataCompleteness"], "complete")
        self.assertIsNotNone(pr["value"])

    def test_ph_is_laboratory_required_never_fabricated(self):
        materials = [material("a", price=1.0, active=100, stock=val(1000))]
        p = problem(materials, comp=[comp_constraint("t", "total_equals_100")])
        p["propertyTargets"] = [{"id": "ph1", "property": "ph", "targetValue": "7"}]
        res = solve(p)
        pr = next(r for r in res["propertyResults"] if r["targetId"] == "ph1")
        self.assertEqual(pr["classification"], "laboratory_required")
        self.assertIsNone(pr.get("value"))
        self.assertEqual(pr["constraintStatus"], "unsupported")
        self.assertTrue(pr["laboratoryConfirmationRequired"])

    def test_hlb_weighted_average_reported_not_enforced(self):
        materials = [
            material("a", price=1.0, active=100, stock=val(1000), hlb=val(12)),
            material("b", price=1.0, active=100, stock=val(1000), hlb=val(4)),
        ]
        p = problem(
            materials,
            comp=[
                comp_constraint("t", "total_equals_100"),
                comp_constraint("exact_a", "exact_percentage", materialId="a", exactPercent="50"),
            ],
        )
        p["propertyTargets"] = [{"id": "hlb1", "property": "hlb", "targetValue": "8"}]
        res = solve(p)
        pr = next(r for r in res["propertyResults"] if r["targetId"] == "hlb1")
        self.assertEqual(pr["classification"], "rule_based_estimate")
        self.assertAlmostEqual(float(pr["value"]), 8.0, places=2)
        self.assertEqual(pr["constraintStatus"], "reported_only")

    def test_property_target_enforced_as_hard(self):
        materials = [
            material("a", price=1.0, active=90, stock=val(1000)),
            material("b", price=1.0, active=10, stock=val(1000)),
        ]
        p = problem(materials, comp=[comp_constraint("t", "total_equals_100")])
        p["propertyTargets"] = [{"id": "am1", "property": "active_matter", "minValue": "50", "enforceAs": "hard"}]
        res = solve(p)
        self.assertEqual(res["status"], "optimal")
        pr = next(r for r in res["propertyResults"] if r["targetId"] == "am1")
        self.assertEqual(pr["constraintStatus"], "enforced_hard")
        self.assertGreaterEqual(float(pr["value"]), 50.0 - 1e-6)

    def test_property_target_enforced_as_soft_can_violate(self):
        materials = [material("a", price=1.0, active=30, stock=val(1000))]
        p = problem(materials, comp=[comp_constraint("t", "total_equals_100")])
        p["propertyTargets"] = [
            {
                "id": "am2",
                "property": "active_matter",
                "minValue": "80",
                "enforceAs": "soft",
                "penaltyWeight": "1",
            }
        ]
        res = solve(p)
        self.assertEqual(res["status"], "feasible_with_penalties")
        pr = next(r for r in res["propertyResults"] if r["targetId"] == "am2")
        self.assertEqual(pr["constraintStatus"], "enforced_soft_violated")


class CostCeilingTests(unittest.TestCase):
    """Spec §A2 — the global raw-material-cost budget, always soft."""

    def test_cost_ceiling_penalizes_over_budget(self):
        materials = [
            material("cheap", price=1.0, active=100, stock=val(1000)),
            material("costly", price=5.0, active=100, stock=val(1000)),
        ]
        p = problem(
            materials,
            comp=[
                comp_constraint("t", "total_equals_100"),
                comp_constraint("force_costly", "min_percentage", materialId="costly", minPercent="100"),
            ],
        )
        p["costCeiling"] = {"value": "300", "currency": "KES", "penaltyWeight": "1"}
        res = solve(p)
        self.assertEqual(res["status"], "feasible_with_penalties")
        cr = next(c for c in res["constraintResults"] if c["constraintId"] == "cost_ceiling")
        self.assertEqual(cr["kind"], "cost")
        self.assertFalse(cr["satisfied"])

    def test_cost_ceiling_not_penalized_when_within_budget(self):
        materials = [material("cheap", price=1.0, active=100, stock=val(1000))]
        p = problem(materials, comp=[comp_constraint("t", "total_equals_100")])
        p["costCeiling"] = {"value": "1000", "currency": "KES", "penaltyWeight": "1"}
        res = solve(p)
        self.assertEqual(res["status"], "optimal")
        cr = next(c for c in res["constraintResults"] if c["constraintId"] == "cost_ceiling")
        self.assertTrue(cr["satisfied"])


class GradedRiskObjectiveTests(unittest.TestCase):
    """Spec §A4 — real graded risk scoring, consumed (not computed) here."""

    def test_optimizer_prefers_lower_compatibility_risk_material(self):
        materials = [
            material("risky", price=1.0, active=100, stock=val(1000), compatibilityRiskScore=0.9),
            material("safe", price=1.0, active=100, stock=val(1000), compatibilityRiskScore=0.1),
        ]
        res = solve(
            problem(
                materials,
                comp=[comp_constraint("t", "total_equals_100")],
                objectives=[{"metric": "compatibility_risk", "direction": "minimize", "weight": "1"}],
            )
        )
        self.assertEqual(res["status"], "optimal")
        safe_pct = next((float(l["percent"]) for l in res["formulaLines"] if l["materialId"] == "safe"), 0.0)
        self.assertAlmostEqual(safe_pct, 100.0, places=2)

    def test_compatibility_risk_objective_requires_at_least_one_scored_material(self):
        materials = [material("a", price=1.0, active=100, stock=val(1000))]  # no compatibilityRiskScore
        with self.assertRaises(OptimizerError):
            solve(
                problem(
                    materials,
                    comp=[comp_constraint("t", "total_equals_100")],
                    objectives=[{"metric": "compatibility_risk", "direction": "minimize", "weight": "1"}],
                )
            )


if __name__ == "__main__":
    unittest.main()
