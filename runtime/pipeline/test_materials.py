"""Tests for raw-material import and formula costing."""

import os
import tempfile
import unittest

import materials as mat

CSV = """Material Name;INCI;CAS;Unit Price;Currency;Unit;Supplier;Stock;ERP Code
Sodium Laureth Sulphate;Sodium Laureth Sulfate;68585-34-2;1,85;EUR;kg;Acme;500;RM-001
Cocamidopropyl Betaine;Cocamidopropyl Betaine;61789-40-0;2,40;EUR;kg;Acme;300;RM-002
Glycerine;Glycerin;56-81-5;1,10;EUR;kg;BASF;1000;RM-003
Demineralised Water;Water (Aqua);7732-18-5;0,01;EUR;kg;Local;99999;RM-004
"""


class ImportTests(unittest.TestCase):
    def test_reads_supplier_headers_and_comma_decimals(self):
        rows, warnings = mat.parse_materials(CSV)
        self.assertEqual(len(rows), 4)
        self.assertEqual(warnings, [])
        sles = rows[0]
        self.assertEqual(sles["inci"], "Sodium Laureth Sulfate")
        self.assertEqual(sles["price"], 1.85)      # "1,85" is one euro eighty-five
        self.assertEqual(sles["currency"], "EUR")
        self.assertEqual(sles["external_ref"], "RM-001")  # the ERP seam
        self.assertTrue(sles["material_id"])

    def test_number_parsing_handles_both_thousand_conventions(self):
        self.assertEqual(mat._number("1.234,56"), 1234.56)   # European
        self.assertEqual(mat._number("1,234.56"), 1234.56)   # Anglo
        self.assertEqual(mat._number("€ 12,50"), 12.5)
        self.assertIsNone(mat._number(""))
        self.assertIsNone(mat._number("n/a"))

    def test_turkish_headers_are_recognised(self):
        rows, _ = mat.parse_materials(
            "Hammadde;INCI;Birim Fiyat;Para Birimi;Tedarikci\n"
            "Gliserin;Glycerin;1,10;TRY;BASF\n")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["price"], 1.10)
        self.assertEqual(rows[0]["currency"], "TRY")

    def test_missing_price_column_is_reported_not_guessed(self):
        _, warnings = mat.parse_materials("Material Name;INCI\nGlycerine;Glycerin\n")
        self.assertTrue(any("price" in w for w in warnings))

    def test_round_trip_through_disk(self):
        with tempfile.TemporaryDirectory() as tmp:
            rows, _ = mat.parse_materials(CSV)
            doc = mat.save_materials(tmp, rows)
            self.assertEqual(doc["currency"], "EUR")
            again = mat.load_materials(tmp)
            self.assertEqual(len(again["materials"]), 4)
            self.assertTrue(os.path.isfile(mat.store_path(tmp)))


class MatchTests(unittest.TestCase):
    def setUp(self):
        self.materials, _ = mat.parse_materials(CSV)

    def test_matches_across_spelling_and_grade_noise(self):
        m = mat.match_material("Sodium Laureth Sulfate", self.materials)
        self.assertEqual(m["external_ref"], "RM-001")
        # "Glycerine" vs "Glycerin", and water written the INCI way.
        self.assertEqual(mat.match_material("Glycerin", self.materials)["external_ref"], "RM-003")
        self.assertEqual(mat.match_material("Water (Aqua)", self.materials)["external_ref"], "RM-004")

    def test_refuses_a_one_word_coincidence(self):
        # "Sodium Benzoate" shares only "sodium" with "Sodium Laureth Sulfate";
        # pricing it from that would be confidently wrong.
        self.assertIsNone(mat.match_material("Sodium Benzoate", self.materials))
        self.assertIsNone(mat.match_material("Piroctone Olamine", self.materials))


class CostingTests(unittest.TestCase):
    def setUp(self):
        self.materials, _ = mat.parse_materials(CSV)
        self.formula = {"ingredients": [
            {"inci": "Water (Aqua)", "function": "Solvent", "weight_pct": "q.s. 100"},
            {"inci": "Sodium Laureth Sulfate", "function": "Surfactant", "weight_pct": "12.0"},
            {"inci": "Cocamidopropyl Betaine", "function": "Co-surfactant", "weight_pct": "8.0"},
            {"inci": "Glycerin", "function": "Humectant", "weight_pct": "3.0"},
        ]}

    def test_costs_a_full_formula_by_hand_checkable_arithmetic(self):
        sheet = mat.cost_formula(self.formula, self.materials, batch_kg=100.0)
        # water 77 kg * 0.01 + SLES 12 * 1.85 + CAPB 8 * 2.40 + glycerin 3 * 1.10
        expected = 77 * 0.01 + 12 * 1.85 + 8 * 2.40 + 3 * 1.10
        self.assertAlmostEqual(sheet["total_cost"], expected, places=4)
        self.assertAlmostEqual(sheet["cost_per_kg"], expected / 100.0, places=4)
        self.assertTrue(sheet["complete"])
        self.assertEqual(sheet["unmatched"], [])

    def test_qs_ingredient_takes_the_remaining_mass(self):
        sheet = mat.cost_formula(self.formula, self.materials, batch_kg=100.0)
        water = next(l for l in sheet["lines"] if l["ingredient"] == "Water (Aqua)")
        self.assertTrue(water["qs"])
        self.assertAlmostEqual(water["weight_pct"], 77.0, places=4)

    def test_batch_size_scales_linearly(self):
        one = mat.cost_formula(self.formula, self.materials, batch_kg=100.0)
        ten = mat.cost_formula(self.formula, self.materials, batch_kg=1000.0)
        self.assertAlmostEqual(ten["total_cost"], one["total_cost"] * 10, places=3)
        self.assertAlmostEqual(ten["cost_per_kg"], one["cost_per_kg"], places=4)

    def test_an_unpriced_ingredient_is_excluded_and_declared(self):
        formula = {"ingredients": [
            {"inci": "Water (Aqua)", "weight_pct": "90.0"},
            {"inci": "Piroctone Olamine", "weight_pct": "10.0"},  # not in the list
        ]}
        sheet = mat.cost_formula(formula, self.materials, batch_kg=100.0)
        self.assertFalse(sheet["complete"])          # must not read as a full cost
        self.assertIn("Piroctone Olamine", sheet["unmatched"])
        self.assertAlmostEqual(sheet["covered_pct"], 90.0, places=2)
        self.assertAlmostEqual(sheet["total_cost"], 90 * 0.01, places=4)

    def test_markdown_sheet_states_incompleteness(self):
        formula = {"ingredients": [
            {"inci": "Water (Aqua)", "weight_pct": "90.0"},
            {"inci": "Piroctone Olamine", "weight_pct": "10.0"},
        ]}
        md = mat.render_costing_markdown(
            mat.cost_formula(formula, self.materials), "Test")
        self.assertIn("Costing sheet", md)
        self.assertIn("Piroctone Olamine", md)
        self.assertIn("covers 90", md)

    def test_money_is_never_rendered_in_scientific_notation(self):
        # A 14,472 TRY total printed as "1.447e+04" is not a number anyone can
        # act on at a purchasing desk.
        self.assertEqual(mat._money(14472.62), "14,472.62")
        self.assertEqual(mat._money(1234567.8), "1,234,567.80")
        self.assertEqual(mat._money(0.45), "0.45")
        big = {"ingredients": [{"inci": "Sodium Laureth Sulfate", "weight_pct": "100"}]}
        md = mat.render_costing_markdown(
            mat.cost_formula(big, self.materials, batch_kg=100_000))
        self.assertNotIn("e+", md)
        self.assertIn("185,000.00", md)   # 100000 kg * 1.85

    def test_no_materials_means_no_invented_cost(self):
        sheet = mat.cost_formula(self.formula, [], batch_kg=100.0)
        self.assertEqual(sheet["total_cost"], 0.0)
        self.assertFalse(sheet["complete"])
        self.assertEqual(len(sheet["unmatched"]), 4)


if __name__ == "__main__":
    unittest.main()
