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


if __name__ == "__main__":
    unittest.main()
