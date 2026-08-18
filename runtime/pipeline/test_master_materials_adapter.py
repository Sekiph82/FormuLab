"""FormuLab v1 (FVL-03.002) — tests for the canonical Material Master
adapter (`master_materials_adapter.py`). Proves the shape-only contract:
real identity carried through, missing data stays missing, inactive
materials excluded, and — the critical single-authority boundary — no
price or supplier is ever SELECTED, only passed through raw/unfiltered."""

import json
import os
import tempfile
import unittest

import master_materials_adapter as adapter


def _write(master_dir, name, rows):
    with open(os.path.join(master_dir, name), "w", encoding="utf-8") as f:
        json.dump(rows, f)


class LoadMasterMaterialsTests(unittest.TestCase):
    def test_active_material_carries_real_identity_and_matching_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write(tmp, "materials.json", [{
                "code": "RM-001", "displayName": "Phenoxyethanol",
                "inciName": "Phenoxyethanol", "casNumbers": ["122-99-6"],
                "functions": ["preservative"], "active": True,
                "manufacturer": "Acme Corp", "countryOfOrigin": "DE",
            }])
            rows = adapter.load_master_materials(tmp)
            self.assertEqual(len(rows), 1)
            row = rows[0]
            self.assertEqual(row["code"], "RM-001")
            self.assertEqual(row["material_code"], "RM-001")
            self.assertEqual(row["external_ref"], "RM-001")
            self.assertEqual(row["name"], "Phenoxyethanol")
            self.assertEqual(row["inci"], "Phenoxyethanol")
            self.assertEqual(row["cas"], "122-99-6")
            self.assertEqual(row["function"], "preservative")
            self.assertEqual(row["manufacturer"], "Acme Corp")
            self.assertEqual(row["country_of_origin"], "DE")

    def test_inactive_material_is_excluded(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write(tmp, "materials.json", [
                {"code": "RM-ACTIVE", "displayName": "Active One", "active": True},
                {"code": "RM-INACTIVE", "displayName": "Discontinued One", "active": False},
            ])
            rows = adapter.load_master_materials(tmp)
            codes = [r["code"] for r in rows]
            self.assertIn("RM-ACTIVE", codes)
            self.assertNotIn("RM-INACTIVE", codes)

    def test_missing_active_key_defaults_to_active(self):
        """Schema default for `RawMaterial.active` is `true`
        (`materials.ts`) — a row missing the key entirely must still be
        treated as active, never silently excluded."""
        with tempfile.TemporaryDirectory() as tmp:
            _write(tmp, "materials.json", [{"code": "RM-001", "displayName": "No Active Key"}])
            rows = adapter.load_master_materials(tmp)
            self.assertEqual(len(rows), 1)
            self.assertTrue(rows[0]["active"])

    def test_missing_recommended_range_and_technical_max_stay_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write(tmp, "materials.json", [{"code": "RM-001", "displayName": "No Range"}])
            rows = adapter.load_master_materials(tmp)
            self.assertNotIn("recommended_min_pct", rows[0])
            self.assertNotIn("recommended_max_pct", rows[0])
            self.assertNotIn("technical_max_pct", rows[0])

    def test_recommended_range_and_technical_max_carried_when_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write(tmp, "materials.json", [{
                "code": "RM-001", "displayName": "Ranged",
                "recommendedMinPercent": "0.3", "recommendedMaxPercent": "1.0",
                "technicalMaxPercent": "2.0",
            }])
            rows = adapter.load_master_materials(tmp)
            self.assertEqual(rows[0]["recommended_min_pct"], 0.3)
            self.assertEqual(rows[0]["recommended_max_pct"], 1.0)
            self.assertEqual(rows[0]["technical_max_pct"], 2.0)

    def test_no_price_key_is_ever_set_price_refs_pass_through_unselected(self):
        """The single-authority boundary: `master_materials_adapter` must
        NEVER choose a current price the way `cost.ts::priceFor()` does —
        proven here against two price rows for the same material, one
        clearly more "current" than the other. Neither is selected; both
        pass through raw in `material_price_refs`, and `price` is never a
        key on the emitted row at all."""
        with tempfile.TemporaryDirectory() as tmp:
            _write(tmp, "materials.json", [{"code": "RM-001", "displayName": "Priced"}])
            _write(tmp, "material_prices.json", [
                {"code": "MP-1", "materialCode": "RM-001", "price": "3.50",
                 "currency": "USD", "effectiveFrom": "2026-01-01", "effectiveTo": "2026-06-01"},
                {"code": "MP-2", "materialCode": "RM-001", "price": "4.10",
                 "currency": "USD", "effectiveFrom": "2026-06-01"},
            ])
            rows = adapter.load_master_materials(tmp)
            self.assertNotIn("price", rows[0])
            self.assertNotIn("currency", rows[0])
            refs = rows[0]["material_price_refs"]
            self.assertEqual(len(refs), 2)
            self.assertEqual({r["code"] for r in refs}, {"MP-1", "MP-2"})

    def test_ambiguous_preferred_supplier_leaves_display_unset_but_keeps_full_ref_set(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write(tmp, "materials.json", [{"code": "RM-001", "displayName": "Multi Supplier"}])
            _write(tmp, "material_suppliers.json", [
                {"code": "MS-1", "materialCode": "RM-001", "supplierCode": "SUP-A",
                 "supplierTradeName": "Supplier A", "preferred": True},
                {"code": "MS-2", "materialCode": "RM-001", "supplierCode": "SUP-B",
                 "supplierTradeName": "Supplier B", "preferred": True},
            ])
            rows = adapter.load_master_materials(tmp)
            self.assertNotIn("supplier", rows[0])
            self.assertEqual(len(rows[0]["material_supplier_refs"]), 2)

    def test_zero_preferred_suppliers_leaves_display_unset(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write(tmp, "materials.json", [{"code": "RM-001", "displayName": "No Preference"}])
            _write(tmp, "material_suppliers.json", [
                {"code": "MS-1", "materialCode": "RM-001", "supplierCode": "SUP-A",
                 "supplierTradeName": "Supplier A", "preferred": False},
            ])
            rows = adapter.load_master_materials(tmp)
            self.assertNotIn("supplier", rows[0])
            self.assertEqual(len(rows[0]["material_supplier_refs"]), 1)

    def test_exactly_one_preferred_supplier_sets_display_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write(tmp, "materials.json", [{"code": "RM-001", "displayName": "Single Preference"}])
            _write(tmp, "material_suppliers.json", [
                {"code": "MS-1", "materialCode": "RM-001", "supplierCode": "SUP-A",
                 "supplierTradeName": "Acme Chem", "preferred": True},
                {"code": "MS-2", "materialCode": "RM-001", "supplierCode": "SUP-B",
                 "supplierTradeName": "Other Chem", "preferred": False},
            ])
            rows = adapter.load_master_materials(tmp)
            self.assertEqual(rows[0]["supplier"], "Acme Chem")
            self.assertEqual(len(rows[0]["material_supplier_refs"]), 2)

    def test_missing_supplier_and_price_collections_degrade_gracefully(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write(tmp, "materials.json", [{"code": "RM-001", "displayName": "Alone"}])
            rows = adapter.load_master_materials(tmp)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["material_supplier_refs"], [])
            self.assertEqual(rows[0]["material_price_refs"], [])

    def test_missing_materials_file_returns_empty_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            rows = adapter.load_master_materials(tmp)
            self.assertEqual(rows, [])


if __name__ == "__main__":
    unittest.main()
