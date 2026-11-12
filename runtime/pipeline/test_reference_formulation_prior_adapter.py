"""Authoritative field-formulation guidance tests."""
from __future__ import annotations

import json
import os
import tempfile
import unittest

from reference_formulation_prior_adapter import build_authoritative_guidance


class AuthoritativeReferenceGuidanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = self.temp.name
        self.digest = "a" * 64
        self.material = {"code": "MAT-001", "name": "Reviewed surfactant", "inci": "Reviewed surfactant", "active": True}
        self.source = {
            "id": "formula-1", "sourceDocumentHash": self.digest,
            "source": {
                "supplierId": "supplier-1",
                "rights": {"status": "owner_provided", "evidenceRefs": ["owner-attestation"],
                           "usePermissions": {
                               "internalResearch": {"status": "allowed", "evidenceRefs": ["owner-attestation"]},
                               "crossSupplierPrior": {"status": "allowed", "evidenceRefs": ["owner-attestation"]},
                           },
                           "retentionPolicy": {"status": "retain_until_revoked", "evidenceRefs": ["owner-attestation"]}},
            },
            "identityCandidates": [{"field": "product_family", "rawValue": "Hand Dishwash"}],
            "ingredientLines": [{
                "id": "line-1", "quantitySemantics": "explicit_amount",
                "ingredientName": {"rawValue": "Reviewed surfactant", "evidence": {"sourceDocumentHash": self.digest}},
                "amount": {"rawValue": "4", "evidence": {"sourceDocumentHash": self.digest}},
                "unit": {"rawValue": "%", "evidence": {"sourceDocumentHash": self.digest}},
                "basis": {"rawValue": "w/w", "evidence": {"sourceDocumentHash": self.digest}},
            }],
        }
        self.normalization = {
            "id": "norm-1", "referenceFormulationRecordId": "formula-1", "sourceDocumentHash": self.digest,
            "version": 1, "lines": [{"sourceLineId": "line-1", "canonicalChemistry": {"status": "proposed", "candidateIds": ["chem-1"]}}],
        }
        self.reviews = [
            self._review("identity:product_family:0", "identityCandidates[0].product_family", "Hand Dishwash", "identity"),
            self._review("ingredient:line-1:ingredientName", "ingredientLines[line-1].ingredientName", "Reviewed surfactant"),
            self._review("normalization:norm-1:line:line-1:canonicalChemistry:chem-1",
                         "normalizations[norm-1].lines[line-1].canonicalChemistry", "chem-1"),
            self._review("ingredient:line-1:amount", "ingredientLines[line-1].amount", "4"),
            self._review("ingredient:line-1:unit", "ingredientLines[line-1].unit", "%"),
            self._review("ingredient:line-1:basis", "ingredientLines[line-1].basis", "w/w"),
        ]
        identity_review = {
            "id": "identity-1", "targetRecordId": "MAT-001", "field": "canonical_identity", "decision": "accepted",
            "proposedValueSnapshot": json.dumps({"canonicalChemistryId": "chem-1"}), "reviewedAt": "2026-01-01T00:00:00Z",
            "reviewedBy": "owner-1", "evidenceRefs": ["identity-evidence"],
        }
        self._write("reference_formulations", [self.source])
        self._write("reference_formulation_normalizations", [self.normalization])
        self._write("reference_formulation_reviews", self.reviews)
        self._write("identity_field_reviews", [identity_review])

    def _review(self, key, field_path, value, target_type="ingredient"):
        return {"id": f"review-{len(getattr(self, 'reviews', []))}-{key}",
                "referenceFormulationRecordId": "formula-1", "sourceDocumentHash": self.digest,
                "targetKey": key, "fieldPath": field_path, "sourceValue": value,
                "targetType": target_type, "decision": "accepted", "reviewedAt": "2026-01-01T00:00:00Z",
                "reviewer": {"userId": "owner-1", "displayName": "Owner"}}

    def _write(self, name, rows):
        with open(os.path.join(self.directory, f"{name}.json"), "w", encoding="utf-8") as handle:
            json.dump(rows, handle)

    def test_recomputes_prior_and_dosage_from_reviewed_source_records(self):
        result = build_authoritative_guidance(self.directory, {"targetProductType": "  HAND   DISHWASH "}, [self.material])
        self.assertEqual(result["eligibleFormulaCount"], 1)
        self.assertEqual(result["ingredientPriors"][0]["sourceRecordIds"], ["formula-1"])
        self.assertEqual(result["ingredientPriors"][0]["formulaWeightedFrequency"], 1.0)
        self.assertEqual(result["ingredientPriors"][0]["dosageGuidance"][0]["typicalRangePercent"], {"lower": 4.0, "upper": 4.0})

    def test_unreviewed_or_fabricated_renderer_claims_cannot_create_eligible_guidance(self):
        self._write("reference_formulation_reviews", [])
        result = build_authoritative_guidance(self.directory, {
            "targetProductType": "Hand Dishwash",
            "referenceFormulationGuidance": {"eligibleFormulaCount": 9000, "ingredientPriors": [{"sourceRecordIds": ["fake-source"]}]},
        }, [self.material])
        self.assertEqual(result["eligibleFormulaCount"], 0)
        self.assertEqual(result["ingredientPriors"], [])

    def test_wrong_material_identity_does_not_receive_prior(self):
        self._write("identity_field_reviews", [{
            "id": "identity-1", "targetRecordId": "MAT-001", "field": "canonical_identity", "decision": "accepted",
            "proposedValueSnapshot": json.dumps({"canonicalChemistryId": "different-chemistry"}),
            "reviewedAt": "2026-01-01T00:00:00Z", "reviewedBy": "owner-1", "evidenceRefs": ["identity-evidence"],
        }])
        result = build_authoritative_guidance(self.directory, {"targetProductType": "Hand Dishwash"}, [self.material])
        self.assertEqual(result["eligibleFormulaCount"], 1)
        self.assertEqual(result["ingredientPriors"], [])


if __name__ == "__main__":
    unittest.main()
