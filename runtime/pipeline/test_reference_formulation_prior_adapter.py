"""Authoritative field-formulation guidance tests."""
from __future__ import annotations

import json
import os
import tempfile
import unittest

import reference_formulation_prior_adapter as adapter
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

    def test_only_the_newest_layout_parse_of_a_source_document_counts(self):
        rec = lambda rid, h, v: {"id": rid, "sourceDocumentHash": h, "source": {"parserVersion": f"formulab-reference-formulation-layout-v{v}"}}
        records = [rec("old", "AA", 1), rec("new-a", "aa", 3), rec("new-b", "aa", 3), rec("only", "bb", 1)]
        self.assertEqual([r["id"] for r in adapter._current(records)], ["new-a", "new-b", "only"])

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

    def test_printed_name_meets_material_and_header_gives_unit(self):
        # A Croda-style line: trade name only, unit and basis printed in the column header.
        line = {"id": "line-2", "quantitySemantics": "explicit_amount",
                "ingredientName": {"rawValue": "Crodamol GTCC", "evidence": {"sourceDocumentHash": self.digest}},
                "amount": {"rawValue": "5.2", "evidence": {"sourceDocumentHash": self.digest, "header": "% w/w"}}}
        unreviewed = {"id": "line-3", "quantitySemantics": "explicit_amount",
                      "ingredientName": {"rawValue": "Unknown blend", "evidence": {"sourceDocumentHash": self.digest}}}
        self._write("reference_formulations", [{**self.source, "ingredientLines": [line, unreviewed]}])
        self._write("reference_formulation_normalizations", [])
        self._write("identity_field_reviews", [])
        self._write("reference_formulation_reviews", [
            self.reviews[0],
            self._review("ingredient:line-2:ingredientName", "ingredientLines[line-2].ingredientName", "Crodamol GTCC"),
            self._review("ingredient:line-2:amount", "ingredientLines[line-2].amount", "5.2"),
        ])
        material = {"code": "MAT-GTCC", "name": "Crodamol GTCC", "trade_name": "Crodamol GTCC", "active": True}
        result = build_authoritative_guidance(self.directory, {"targetProductType": "Hand Dishwash"}, [material])
        self.assertEqual(result["eligibleFormulaCount"], 1)
        prior = result["ingredientPriors"][0]
        self.assertEqual(prior["materialCode"], "MAT-GTCC")
        self.assertEqual(prior["dosageGuidance"][0]["typicalRangePercent"], {"lower": 5.2, "upper": 5.2})

    def _as_ai(self, rows):
        return [{**row, "id": "ai-" + row["id"], "reviewer": {"userId": "ai:claude-opus-5-5", "displayName": "Claude (AI review, advisory)"}}
                for row in rows]

    def test_claude_reviews_count_as_advisory_and_are_labelled(self):
        self._write("reference_formulation_reviews", [])
        self._write("reference_formulation_ai_reviews", self._as_ai(self.reviews))
        result = build_authoritative_guidance(self.directory, {"targetProductType": "Hand Dishwash"}, [self.material])
        self.assertEqual((result["eligibleFormulaCount"], result["aiAdvisoryFormulaCount"]), (1, 1))
        self.assertEqual(result["ingredientPriors"][0]["aiAdvisoryFormulaCount"], 1)

    def test_a_human_decision_overrides_claude(self):
        rejected = {**self.reviews[0], "id": "human-reject", "decision": "rejected"}
        self._write("reference_formulation_reviews", [rejected])
        self._write("reference_formulation_ai_reviews", self._as_ai(self.reviews))
        result = build_authoritative_guidance(self.directory, {"targetProductType": "Hand Dishwash"}, [self.material])
        self.assertEqual((result["eligibleFormulaCount"], result["aiAdvisoryFormulaCount"]), (0, 0))

    def test_rows_in_the_ai_collection_without_an_ai_reviewer_are_ignored(self):
        self._write("reference_formulation_reviews", [])
        self._write("reference_formulation_ai_reviews", self.reviews)
        result = build_authoritative_guidance(self.directory, {"targetProductType": "Hand Dishwash"}, [self.material])
        self.assertEqual(result["eligibleFormulaCount"], 0)

    def test_human_reviewed_formulas_are_not_labelled_ai(self):
        result = build_authoritative_guidance(self.directory, {"targetProductType": "Hand Dishwash"}, [self.material])
        self.assertEqual(result["aiAdvisoryFormulaCount"], 0)

    def test_family_is_matched_through_the_shared_taxonomy(self):
        for request in ("Bulaşık deterjanı", "hand dishwashing liquid", "Hand dishwashing"):
            result = build_authoritative_guidance(self.directory, {"targetProductType": request}, [self.material])
            self.assertEqual((result["eligibleFormulaCount"], result["productFamilyKey"]), (1, "hand dishwashing"), request)
        self.assertEqual(build_authoritative_guidance(self.directory, {"targetProductType": "Şampuan"}, [self.material])["eligibleFormulaCount"], 0)

    def test_python_taxonomy_agrees_with_the_shared_one(self):
        from product_family_taxonomy import family_key
        cases = {"3_in_1_Treatment_Concentrate_Anti_Dandruff_Shampoo_EN_FORM_GEN_504249_en_US": "shampoo",
                 "110-00874-01-glass-cleaner": "hard_surface_cleaner", "Fabric conditioner with 3-in-1 protection": "fabric_softener",
                 "Premium Automatic Dishwasher Tablets": "dishwash_automatic", "SAÇ KREMİ": "conditioner",
                 "Bulaşık makinesi deterjanı": "dishwash_automatic", "Duş jeli": "body_wash", "110-00797-01-acetal": None}
        for text, expected in cases.items():
            self.assertEqual(family_key(text), expected, text)


if __name__ == "__main__":
    unittest.main()
