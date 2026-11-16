"""Material Master rows from supplier field formulas."""
from __future__ import annotations

import json
import os
import tempfile
import unittest

import reference_material_master as m


def _line(name, function, line_id):
    return {"id": line_id, "ingredientName": {"rawValue": name}, "function": {"rawValue": function}}


class ReferenceMaterialMasterTests(unittest.TestCase):
    def test_adds_one_row_per_new_printed_material_and_keeps_existing(self):
        with tempfile.TemporaryDirectory() as directory:
            def write(name, rows):
                with open(os.path.join(directory, f"{name}.json"), "w", encoding="utf-8") as handle:
                    json.dump(rows, handle)
            write("reference_formulations", [{
                "id": "f1", "sourceDocumentHash": "a" * 64, "source": {"supplierId": "croda", "parserVersion": "layout-v3"},
                "ingredientLines": [_line("Water", "Solvent", "l1"), _line("Crodamol GTCC", "Emollient", "l2"),
                                    _line("10,000/200 Fluid (Dimethicone)", "Conditioner", "l3"), _line("4.0", "", "l4")],
            }])
            write("materials", [{"code": "MAT-1", "displayName": "Water"}])
            result = m.append_materials(directory)
            with open(os.path.join(directory, "materials.json"), encoding="utf-8") as handle:
                rows = json.load(handle)
            self.assertEqual(result, {"existing": 1, "added": 2, "repaired": 0})
            added = {row["displayName"]: row for row in rows[1:]}
            self.assertEqual(added["Crodamol GTCC"]["functions"], ["emollient"])
            self.assertEqual(added["10,000/200 Fluid (Dimethicone)"]["inciName"], "Dimethicone")
            self.assertNotIn("inciName", added["Crodamol GTCC"])
            # Each row links to the formula PDF that printed it.
            self.assertEqual(added["Crodamol GTCC"]["documents"][-1]["location"], "reference-formulations/f1")
            self.assertEqual(m.append_materials(directory), {"existing": 3, "added": 0, "repaired": 0})

    def test_a_merged_row_is_named_by_its_inci_and_an_old_generated_row_is_repaired(self):
        with tempfile.TemporaryDirectory() as directory:
            def write(name, rows):
                with open(os.path.join(directory, f"{name}.json"), "w", encoding="utf-8") as handle:
                    json.dump(rows, handle)
            merged = {"id": "l1", "ingredientName": {"rawValue": "Dongbaek (Tsubaki) Oil � Hostapon SCI 85 �"},
                      "inciOrChemicalName": {"rawValue": "Camellia Japonica Seed Oil"}}
            write("reference_formulations", [{"id": "f1", "sourceDocumentHash": "a" * 64,
                                              "source": {"supplierId": "clariant", "parserVersion": "layout-v3", "title": "Body wash"},
                                              "ingredientLines": [merged]}])
            old = {"code": "REF-CAMELLIA-JAPONICA-SEED-OIL", "displayName": "Dongbaek (Tsubaki) Oil � Hostapon SCI 85 �",
                   "notes": "From supplier field formulas: 1 formula(s).", "createdAt": "t0", "updatedAt": "t0"}
            write("materials", [old])
            self.assertEqual(m.append_materials(directory)["repaired"], 1)
            with open(os.path.join(directory, "materials.json"), encoding="utf-8") as handle:
                (row,) = json.load(handle)
            self.assertEqual(row["displayName"], "Camellia Japonica Seed Oil")
            self.assertEqual(row["createdAt"], "t0")
            self.assertEqual(row["documents"][0]["title"], "Supplier field formula: Body wash")

    def test_page_furniture_rows_are_not_materials(self):
        noise = ["© 2019 The Dow Chemical Company. All rights reserved.", "(and) Cetearyl Alcohol", "/ Dow",
                 "Sodium metasilicate pentahydrate Suppliers: 1. Croda", " DOW CORNING 556 FLUID"]
        kept = ["sodium lauryl sulfate", "1,2-Hexanediol", "(3-methoxy-3-methyl-1-butanol)", "Crodamol GTCC"]
        self.assertEqual([name for name in noise + kept if not m._NOT_A_MATERIAL.search(name)], kept)

    def test_cas_numbers_with_spaced_hyphens_and_a_valid_check_digit(self):
        self.assertEqual(m.cas_numbers("CASRN: 63148 - 62 - 9; water 7732-18-5; date 2026-10-25; bad 7732-18-4"),
                         ["63148-62-9", "7732-18-5"])


if __name__ == "__main__":
    unittest.main()
