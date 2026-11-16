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

    def test_list_numbers_and_supplier_suffixes_do_not_make_another_material(self):
        with tempfile.TemporaryDirectory() as directory:
            def write(name, rows):
                with open(os.path.join(directory, f"{name}.json"), "w", encoding="utf-8") as handle:
                    json.dump(rows, handle)

            def cut(name, inci, line_id):
                return {**_line(name, "Thickener", line_id), "inciOrChemicalName": {"rawValue": inci}}
            write("reference_formulations", [{
                "id": "f1", "sourceDocumentHash": "a" * 64, "source": {"supplierId": "clariant", "parserVersion": "layout-v3"},
                # One product whose INCI cell each PDF cuts at a different place.
                "ingredientLines": [cut("Aristoflex BLV", "Polyacrylate Crosspolyme", "l1"),
                                    _line("1. Butylene Glycol / Making Cosmetics", "Humectant", "l2")],
            }, {
                "id": "f2", "sourceDocumentHash": "b" * 64, "source": {"supplierId": "clariant", "parserVersion": "layout-v3"},
                "ingredientLines": [cut("ARISTOFLEX® BLV", "Polyacrylate Crosspolymer-11", "l1"),
                                    cut("Aristoflex BLV", "Acryloyldimethyl- taurate", "l2")],
            }])
            stale = {"code": "REF-1-BUTYLENE-GLYCOL-MAKING-COSMETICS", "displayName": "1. Butylene Glycol / Making Cosmetics",
                     "notes": "From supplier field formulas: 1 formula(s).", "active": True,
                     "createdAt": "2026-11-01T00:00:00.000Z", "updatedAt": "2026-11-01T00:00:00.000Z"}
            write("materials", [stale])
            m.append_materials(directory)
            with open(os.path.join(directory, "materials.json"), encoding="utf-8") as handle:
                rows = json.load(handle)
            active = {row["displayName"]: row for row in rows if row.get("active", True)}
            self.assertEqual(sorted(active), ["Aristoflex BLV", "Butylene Glycol"])
            self.assertEqual({doc["location"] for doc in active["Aristoflex BLV"]["documents"]},
                             {"reference-formulations/f1", "reference-formulations/f2"})
            old = next(row for row in rows if row["code"] == stale["code"])
            self.assertFalse(old["active"])
            self.assertIn(f"same material as {active['Butylene Glycol']['code']}", old["notes"])

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

    def test_a_printed_class_name_is_not_a_material_and_an_earlier_row_is_switched_off(self):
        self.assertTrue(m.is_placeholder("Preservative q.s."))
        self.assertTrue(m.is_placeholder("Colorants"))
        self.assertFalse(m.is_placeholder("Parfum"))
        self.assertFalse(m.is_placeholder("Phenoxyethanol"))
        with tempfile.TemporaryDirectory() as directory:
            def write(name, rows):
                with open(os.path.join(directory, f"{name}.json"), "w", encoding="utf-8") as handle:
                    json.dump(rows, handle)
            write("reference_formulations", [{"id": "f1", "sourceDocumentHash": "a" * 64, "source": {"supplierId": "dow", "parserVersion": "layout-v3"},
                                              "ingredientLines": [_line("Preservative", "Preservative", "l1")]}])
            write("materials", [{"code": "REF-PRESERVATIVE", "displayName": "Preservative", "active": True,
                                 "notes": "From supplier field formulas: 11 formula(s).", "createdAt": "t0", "updatedAt": "t1"}])
            self.assertEqual(m.append_materials(directory), {"existing": 1, "added": 0, "repaired": 1})
            with open(os.path.join(directory, "materials.json"), encoding="utf-8") as handle:
                (row,) = json.load(handle)
            self.assertFalse(row["active"])

    def test_an_updated_row_is_not_written_again_and_earlier_repeats_are_switched_off(self):
        with tempfile.TemporaryDirectory() as directory:
            def write(name, rows):
                with open(os.path.join(directory, f"{name}.json"), "w", encoding="utf-8") as handle:
                    json.dump(rows, handle)
            write("reference_formulations", [{"id": "f1", "sourceDocumentHash": "a" * 64, "source": {"supplierId": "croda", "parserVersion": "layout-v3"},
                                              "ingredientLines": [_line("Crodamol GTCC", "Emollient", "l1")]}])
            note = "From supplier field formulas: 1 formula(s)."
            write("materials", [
                {"code": "REF-CRODAMOL-GTCC", "displayName": "Crodamol GTCC", "active": True, "notes": note, "createdAt": "t0", "updatedAt": "t1"},
                {"code": "REF-CRODAMOL-GTCC-X-X", "displayName": "Crodamol GTCC", "active": True, "notes": note, "createdAt": "t2", "updatedAt": "t2"},
            ])
            self.assertEqual(m.append_materials(directory), {"existing": 2, "added": 0, "repaired": 1})
            with open(os.path.join(directory, "materials.json"), encoding="utf-8") as handle:
                rows = json.load(handle)
            self.assertEqual([row["active"] for row in rows], [True, False])

    def test_ocr_marks_and_procedure_steps(self):
        self.assertEqual(m.plain_marks("ACULYN $^{TM}$ Siltouch"), "ACULYN ™ Siltouch")
        self.assertTrue(m._NOT_A_MATERIAL.search("Adjust pH if necessary to 5.5-"))
        self.assertFalse(m._NOT_A_MATERIAL.search("Adipic Acid"))

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
