"""Unit tests for the formulation LP core. Run: python -m pytest (or unittest)."""

import unittest

from formulation_core import FormulationError, optimize


BASE = {
    "materials": [
        {"name": "HighActive", "unit_price": 3.0, "stock": 100, "active_matter_pct": 90, "max_usage_pct": 100},
        {"name": "Cheap", "unit_price": 1.0, "stock": 100, "active_matter_pct": 10, "max_usage_pct": 100},
    ],
    "constraints": {"batch_size": 100.0, "min_active_pct": 50.0},
}


class OptimizeTests(unittest.TestCase):
    def test_optimal_meets_active_target(self):
        res = optimize(BASE)
        self.assertEqual(res["status"], "optimal")
        # Batch must sum to 100 kg.
        total_kg = sum(it["quantity_kg"] for it in res["items"])
        self.assertAlmostEqual(total_kg, 100.0, places=3)
        # Active target satisfied (within solver tolerance).
        self.assertGreaterEqual(res["achieved_active_pct"], 50.0 - 1e-3)

    def test_prefers_cheaper_mix_at_the_target(self):
        # 90/10 actives, target 50 -> 50 kg each; cost = 50*3 + 50*1 = 200.
        res = optimize(BASE)
        self.assertAlmostEqual(res["total_cost"], 200.0, places=2)

    def test_zero_target_picks_cheapest_only(self):
        payload = {**BASE, "constraints": {"batch_size": 100.0, "min_active_pct": 0.0}}
        res = optimize(payload)
        self.assertEqual(res["status"], "optimal")
        names = [it["name"] for it in res["items"]]
        self.assertEqual(names, ["Cheap"])
        self.assertAlmostEqual(res["total_cost"], 100.0, places=2)

    def test_infeasible_active_target_too_high(self):
        payload = {**BASE, "constraints": {"batch_size": 100.0, "min_active_pct": 95.0}}
        res = optimize(payload)
        self.assertEqual(res["status"], "infeasible")
        self.assertIn("active", res["message"].lower())
        self.assertEqual(res["items"], [])

    def test_infeasible_caps_below_batch(self):
        payload = {
            "materials": [
                {"name": "A", "unit_price": 1, "stock": 20, "active_matter_pct": 50, "max_usage_pct": 100},
                {"name": "B", "unit_price": 1, "stock": 20, "active_matter_pct": 50, "max_usage_pct": 100},
            ],
            "constraints": {"batch_size": 100.0, "min_active_pct": 10.0},
        }
        res = optimize(payload)
        self.assertEqual(res["status"], "infeasible")
        self.assertIn("cap", res["message"].lower())

    def test_max_usage_limit_is_enforced(self):
        payload = {
            "materials": [
                {"name": "Cheap", "unit_price": 1, "stock": 100, "active_matter_pct": 10, "max_usage_pct": 40},
                {"name": "Mid", "unit_price": 2, "stock": 100, "active_matter_pct": 10, "max_usage_pct": 100},
            ],
            "constraints": {"batch_size": 100.0, "min_active_pct": 10.0},
        }
        res = optimize(payload)
        self.assertEqual(res["status"], "optimal")
        cheap = next(it for it in res["items"] if it["name"] == "Cheap")
        self.assertLessEqual(cheap["quantity_kg"], 40.0 + 1e-6)

    def test_verbose_spreadsheet_keys_accepted(self):
        payload = {
            "materials": [
                {"Material_Name": "X", "Unit_Price_USD_per_kg": 1.5, "Stock_Available_kg": 100,
                 "Active_Matter_Content_%": 60, "Max_Usage_Limit_%": 100},
            ],
            "constraints": {"batch_size": 50.0, "min_active_pct": 40.0},
        }
        res = optimize(payload)
        self.assertEqual(res["status"], "optimal")
        self.assertEqual(res["items"][0]["name"], "X")

    def test_rejects_empty_materials(self):
        with self.assertRaises(FormulationError):
            optimize({"materials": [], "constraints": {"batch_size": 10, "min_active_pct": 0}})

    def test_rejects_bad_batch_size(self):
        with self.assertRaises(FormulationError):
            optimize({**BASE, "constraints": {"batch_size": 0, "min_active_pct": 0}})

    def test_rejects_out_of_range_active(self):
        bad = {
            "materials": [{"name": "A", "unit_price": 1, "stock": 10, "active_matter_pct": 150, "max_usage_pct": 100}],
            "constraints": {"batch_size": 10, "min_active_pct": 0},
        }
        with self.assertRaises(FormulationError):
            optimize(bad)


if __name__ == "__main__":
    unittest.main()
