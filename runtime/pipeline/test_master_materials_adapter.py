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
    def test_only_latest_human_accepted_exact_product_claims_join_one_material(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write(tmp, "materials.json", [{
                "code": "RM-CRODA-1", "displayName": "Incromine Oxide C",
                "inciName": "Cocamine Oxide", "casNumbers": ["61788-90-7"],
                "functions": ["surfactant"], "active": True,
            }])
            _write(tmp, "suppliers.json", [{"code": "CRODA", "displayName": "Croda", "legalName": "Croda International Plc"}])
            _write(tmp, "material_suppliers.json", [{"code": "MS-1", "materialCode": "RM-CRODA-1", "supplierCode": "CRODA", "supplierItemCode": "IOC", "supplierTradeName": "Incromine Oxide C"}])
            claim = {
                "id": "claim-active", "fieldCode": "active_matter", "subject": "product",
                "rawValue": "30%", "normalizedValue": "30", "originalUnit": "%",
                "normalizedUnit": "%", "qualifier": "specified", "basis": "as_supplied",
                "context": {}, "extraction": {"method": "table_cell", "parserVersion": "v1"},
                "evidence": [{"documentHash": "a" * 64, "pageNumber": 2, "excerpt": "Active matter 30%", "source": "digital"}],
            }
            identity = {
                "id": "claim-name", "fieldCode": "product_identifier", "subject": "product",
                "rawValue": "Incromine Oxide C", "qualifier": "specified", "basis": "unknown",
                "context": {}, "extraction": {"method": "explicit_label", "parserVersion": "v1"},
                "evidence": [{"documentHash": "a" * 64, "pageNumber": 1, "excerpt": "Incromine Oxide C", "source": "digital"}],
            }
            document = {
                "recordType": "document", "id": "doc-1", "productCardId": "card-1",
                "documentType": "TDS", "documentHash": "a" * 64, "claims": [claim, identity],
            }
            card = {
                "recordType": "card_version", "id": "card-version-1", "productCardId": "card-1",
                "version": 1, "supplierId": "CRODA", "supplierName": "Croda", "tradeName": "Incromine Oxide C", "supplierItemCode": "IOC",
                "identityStatus": "review_required", "evidenceRecordIds": ["doc-1"],
                "claimIds": ["claim-active", "claim-name"],
            }
            accepted = {
                "recordType": "claim_review", "id": "review-1", "productCardId": "card-1",
                "sourceEvidenceId": "doc-1", "claimId": "claim-active", "claimSnapshot": claim,
                "decision": "accepted", "reviewedBy": "chemist-1", "reviewedAt": "2026-01-01T00:00:00Z",
                "evidenceRefs": ["{}:p2".format("a" * 64)],
            }
            accepted_identity = {
                "recordType": "claim_review", "id": "review-name", "productCardId": "card-1",
                "sourceEvidenceId": "doc-1", "claimId": "claim-name", "claimSnapshot": identity,
                "decision": "accepted", "reviewedBy": "chemist-1", "reviewedAt": "2026-01-01T00:00:30Z",
                "evidenceRefs": ["{}:p1".format("a" * 64)],
            }
            rejected_identity = {
                "recordType": "claim_review", "id": "review-2", "productCardId": "card-1",
                "sourceEvidenceId": "doc-1", "claimId": "claim-name", "claimSnapshot": identity,
                "decision": "rejected", "reviewedBy": "chemist-1", "reviewedAt": "2026-01-01T00:01:00Z",
                "evidenceRefs": ["{}:p1".format("a" * 64)],
            }
            _write(tmp, "supplier_product_evidence.json", [document, card, accepted, accepted_identity])
            rows = adapter.load_master_materials(tmp)
            self.assertEqual(len(rows[0]["supplier_product_card_evidence"]), 1)
            product = rows[0]["supplier_product_card_evidence"][0]
            self.assertEqual(product["productCardId"], "card-1")
            self.assertEqual([fact["fieldCode"] for fact in product["claims"]], ["active_matter", "product_identifier"])
            self.assertEqual(product["claims"][0]["reviewedBy"], "chemist-1")
            # A later rejection of the exact product identity claim removes
            # this otherwise matching card from the generation input.
            _write(tmp, "supplier_product_evidence.json", [document, card, accepted, accepted_identity, rejected_identity])
            rows = adapter.load_master_materials(tmp)
            self.assertTrue(all("supplier_product_card_evidence" not in row for row in rows))

    def test_unreviewed_or_ambiguous_product_claims_do_not_join_materials(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write(tmp, "materials.json", [
                {"code": "RM-1", "displayName": "Trade Product", "active": True},
                {"code": "RM-2", "displayName": "Trade Product", "active": True},
            ])
            _write(tmp, "supplier_product_evidence.json", [])
            rows = adapter.load_master_materials(tmp)
            self.assertTrue(all("supplier_product_card_evidence" not in row for row in rows))

    def test_product_claim_cas_match_requires_the_same_supplier_link(self):
        with tempfile.TemporaryDirectory() as tmp:
            digest = "b" * 64
            claim = {"id": "claim-cas", "fieldCode": "product_cas", "subject": "product", "rawValue": "61788-90-7", "qualifier": "specified", "basis": "unknown", "context": {}, "evidence": [{"documentHash": digest, "pageNumber": 1, "excerpt": "CAS 61788-90-7", "source": "digital"}]}
            _write(tmp, "materials.json", [{"code": "RM-1", "displayName": "Chemistry", "casNumbers": ["61788-90-7"], "active": True}])
            _write(tmp, "suppliers.json", [{"code": "OTHER", "displayName": "Other Supplier", "legalName": "Other Supplier Inc."}])
            _write(tmp, "material_suppliers.json", [{"code": "MS-1", "materialCode": "RM-1", "supplierCode": "OTHER"}])
            _write(tmp, "supplier_product_evidence.json", [
                {"recordType": "document", "id": "doc-1", "productCardId": "card-1", "documentType": "SDS", "documentHash": digest, "claims": [claim]},
                {"recordType": "card_version", "id": "version-1", "productCardId": "card-1", "version": 1, "supplierId": "CRODA", "supplierName": "Croda", "tradeName": "Trade Product", "evidenceRecordIds": ["doc-1"], "claimIds": ["claim-cas"]},
                {"recordType": "claim_review", "id": "review-1", "productCardId": "card-1", "sourceEvidenceId": "doc-1", "claimId": "claim-cas", "claimSnapshot": claim, "decision": "accepted", "reviewedBy": "owner", "reviewedAt": "2026-01-01T00:00:00Z", "evidenceRefs": [digest + ":p1"]},
            ])
            rows = adapter.load_master_materials(tmp)
            self.assertNotIn("supplier_product_card_evidence", rows[0])

    def test_unreviewed_card_trade_name_cannot_join_without_an_accepted_identity_claim(self):
        with tempfile.TemporaryDirectory() as tmp:
            digest = "c" * 64
            claim = {"id": "claim-active", "fieldCode": "active_matter", "subject": "product", "rawValue": "30%", "qualifier": "specified", "basis": "as_supplied", "context": {}, "evidence": [{"documentHash": digest, "pageNumber": 1, "excerpt": "Active 30%", "source": "digital"}]}
            _write(tmp, "materials.json", [{"code": "RM-1", "displayName": "Trade Product", "active": True}])
            _write(tmp, "suppliers.json", [{"code": "CRODA", "displayName": "Croda", "legalName": "Croda International Plc"}])
            _write(tmp, "material_suppliers.json", [{"code": "MS-1", "materialCode": "RM-1", "supplierCode": "CRODA", "supplierItemCode": "IOC", "supplierTradeName": "Trade Product"}])
            _write(tmp, "supplier_product_evidence.json", [
                {"recordType": "document", "id": "doc-1", "productCardId": "card-1", "documentType": "TDS", "documentHash": digest, "claims": [claim]},
                {"recordType": "card_version", "id": "version-1", "productCardId": "card-1", "version": 1, "supplierId": "CRODA", "supplierName": "Croda", "tradeName": "Trade Product", "supplierItemCode": "IOC", "evidenceRecordIds": ["doc-1"], "claimIds": ["claim-active"]},
                {"recordType": "claim_review", "id": "review-1", "productCardId": "card-1", "sourceEvidenceId": "doc-1", "claimId": "claim-active", "claimSnapshot": claim, "decision": "accepted", "reviewedBy": "owner", "reviewedAt": "2026-01-01T00:00:00Z", "evidenceRefs": [digest + ":p1"]},
            ])
            rows = adapter.load_master_materials(tmp)
            self.assertNotIn("supplier_product_card_evidence", rows[0])

    def test_supplier_item_code_from_another_supplier_link_cannot_join_card(self):
        with tempfile.TemporaryDirectory() as tmp:
            digest = "d" * 64
            claim = {"id": "claim-code", "fieldCode": "supplier_material_number", "subject": "product", "rawValue": "OTHER-CODE", "qualifier": "specified", "basis": "unknown", "context": {}, "evidence": [{"documentHash": digest, "pageNumber": 1, "excerpt": "Product code OTHER-CODE", "source": "digital"}]}
            _write(tmp, "materials.json", [{"code": "RM-1", "displayName": "Raw material", "active": True}])
            _write(tmp, "suppliers.json", [
                {"code": "CRODA", "displayName": "Croda", "legalName": "Croda International Plc"},
                {"code": "OTHER", "displayName": "Other Supplier", "legalName": "Other Supplier Inc."},
            ])
            _write(tmp, "material_suppliers.json", [
                {"code": "MS-1", "materialCode": "RM-1", "supplierCode": "CRODA", "supplierItemCode": "CRODA-CODE"},
                {"code": "MS-2", "materialCode": "RM-1", "supplierCode": "OTHER", "supplierItemCode": "OTHER-CODE"},
            ])
            _write(tmp, "supplier_product_evidence.json", [
                {"recordType": "document", "id": "doc-1", "productCardId": "card-1", "documentType": "SDS", "documentHash": digest, "claims": [claim]},
                {"recordType": "card_version", "id": "version-1", "productCardId": "card-1", "version": 1, "supplierId": "CRODA", "supplierName": "Croda", "tradeName": "Card only name", "evidenceRecordIds": ["doc-1"], "claimIds": ["claim-code"]},
                {"recordType": "claim_review", "id": "review-1", "productCardId": "card-1", "sourceEvidenceId": "doc-1", "claimId": "claim-code", "claimSnapshot": claim, "decision": "accepted", "reviewedBy": "owner", "reviewedAt": "2026-01-01T00:00:00Z", "evidenceRefs": [digest + ":p1"]},
            ])
            rows = adapter.load_master_materials(tmp)
            self.assertNotIn("supplier_product_card_evidence", rows[0])

    def test_exactly_linked_supplier_cards_are_exposed_as_product_alternatives(self):
        with tempfile.TemporaryDirectory() as tmp:
            materials = [{"code": "RM-1", "displayName": "Shared Product", "active": True}]
            _write(tmp, "materials.json", materials)
            _write(tmp, "suppliers.json", [
                {"code": "SUP-A", "displayName": "Supplier A", "legalName": "Supplier A Inc."},
                {"code": "SUP-B", "displayName": "Supplier B", "legalName": "Supplier B Inc."},
            ])
            _write(tmp, "material_suppliers.json", [
                {"code": "MS-A", "materialCode": "RM-1", "supplierCode": "SUP-A", "supplierItemCode": "A-1"},
                {"code": "MS-B", "materialCode": "RM-1", "supplierCode": "SUP-B", "supplierItemCode": "B-1"},
            ])
            records = []
            for index, supplier in enumerate(("SUP-A", "SUP-B"), start=1):
                digest = str(index) * 64
                claim = {"id": f"claim-{index}", "fieldCode": "product_identifier", "subject": "product", "rawValue": "Shared Product", "qualifier": "specified", "basis": "unknown", "context": {}, "evidence": [{"documentHash": digest, "pageNumber": 1, "excerpt": "Shared Product", "source": "digital"}]}
                document_id = f"doc-{index}"
                card_id = f"card-{index}"
                records.extend([
                    {"recordType": "document", "id": document_id, "productCardId": card_id, "documentType": "TDS", "documentHash": digest, "claims": [claim]},
                    {"recordType": "card_version", "id": f"version-{index}", "productCardId": card_id, "version": 1, "supplierId": supplier, "supplierName": f"Supplier {index}", "supplierItemCode": f"{chr(64 + index)}-1", "tradeName": "Shared Product", "evidenceRecordIds": [document_id], "claimIds": [claim["id"]]},
                    {"recordType": "claim_review", "id": f"review-{index}", "productCardId": card_id, "sourceEvidenceId": document_id, "claimId": claim["id"], "claimSnapshot": claim, "decision": "accepted", "reviewedBy": "owner", "reviewedAt": f"2026-01-01T00:00:0{index}Z", "evidenceRefs": [digest + ":p1"]},
                ])
            _write(tmp, "supplier_product_evidence.json", records)
            rows = adapter.load_master_materials(tmp)
            cards = rows[0]["supplier_product_card_evidence"]
            self.assertEqual({card["supplierItemCode"] for card in cards}, {"A-1", "B-1"})

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
