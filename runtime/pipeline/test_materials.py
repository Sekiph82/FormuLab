"""Tests for raw-material import.

FVL-03.003 retired `materials.py::cost_formula()`/`render_costing_markdown()`
(and this file's own `CostingTests`) — the single authoritative Cost Engine
is `packages/shared/src/engine/cost.ts` (see
`apps/desktop/src/lib/generatedFormulaCost.test.ts`/`cost.test.ts`)."""

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


if __name__ == "__main__":
    unittest.main()
