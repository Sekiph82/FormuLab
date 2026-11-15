"""Claude advisory review writer tests."""
from __future__ import annotations

import json
import os
import tempfile
import unittest

import reference_formulation_ai_review as ai

DIGEST = "b" * 64
EVIDENCE = {"sourceDocumentHash": DIGEST, "pageNumber": 1, "blockIndex": 2, "rowIndex": 1, "cellIndex": 0}


def _source(total=("100", "100"), family="Shampoo"):
    cell = lambda value, index: {"rawValue": value, "evidence": {**EVIDENCE, "cellIndex": index}}
    return {
        "id": "formula-1", "sourceDocumentHash": DIGEST,
        "source": {"parserVersion": "formulab-reference-formulation-layout-v3-multi-supplier-tables"},
        "identityCandidates": [{"field": "product_family", "rawValue": family, "extractionMethod": "title_keyword",
                                "evidence": [{"excerpt": "Mild Shampoo", "pageNumber": 1, "blockIndex": 0}]}],
        "arithmetic": {"calculatedTotal": {"lowerBound": total[0], "upperBound": total[1]}},
        "ingredientLines": [{
            "id": "formula-1:p1:b2:r1", "rawRow": ["Texapon N 70", "Sodium Laureth Sulfate", "100"],
            "quantitySemantics": "explicit_amount",
            "ingredientName": cell("Texapon N 70", 0), "inciOrChemicalName": cell("Sodium Laureth Sulfate", 1),
            "amount": cell("100", 2),
        }],
    }


NORMALIZATION = {"id": "normalization-auto-formula-1", "referenceFormulationRecordId": "formula-1", "version": 1,
                 "lines": [{"sourceLineId": "formula-1:p1:b2:r1",
                            "canonicalChemistry": {"status": "proposed", "candidateIds": ["inci:sodium-laureth-sulfate"]}}]}


class ClaudeReviewTests(unittest.TestCase):
    def test_python_and_shared_inci_ids_agree(self):
        cases = {"Sodium Laureth Sulfate": "inci:sodium-laureth-sulfate", "Aqua (Water)": "inci:water",
                 "Acrylates/C10-30 Alkyl Acrylate Crosspolymer": "inci:acrylates-c10-30-alkyl-acrylate-crosspolymer",
                 "1,2-Hexanediol": "inci:1-2-hexanediol", "Cetearyl Alcohol (and) Ceteareth-20": None, "2.5 %": None}
        for raw, expected in cases.items():
            self.assertEqual(ai.inci_chemistry_id(raw), expected, raw)

    def test_a_closing_formula_gets_claude_decisions_citing_the_source_cells(self):
        rows = ai.build_ai_reviews([_source()], [NORMALIZATION], {"Shampoo"}, "2026-11-15T00:00:00Z")
        keys = [row["targetKey"] for row in rows]
        self.assertEqual(keys, [
            "identity:product_family:0", "ingredient:formula-1:p1:b2:r1:ingredientName", "ingredient:formula-1:p1:b2:r1:amount",
            "normalization:normalization-auto-formula-1:line:formula-1:p1:b2:r1:canonicalChemistry:inci:sodium-laureth-sulfate",
        ])
        self.assertTrue(all(row["reviewer"]["userId"].startswith("ai:") and row["decision"] == "accepted" for row in rows))
        chemistry = rows[-1]
        self.assertEqual((chemistry["evidenceExcerpt"], chemistry["cellIndex"]), ("Texapon N 70 | Sodium Laureth Sulfate | 100", 1))

    def test_broad_groups_get_no_family_decision_and_open_totals_are_noted(self):
        rows = ai.build_ai_reviews([_source(total=("80", "80"), family="Hair care")], [NORMALIZATION], {"Shampoo"}, "t")
        self.assertFalse(any(row["targetType"] == "identity" for row in rows))
        self.assertTrue(rows and all("does not close" in row["note"] for row in rows if row["targetKey"].startswith("ingredient:")))

    def test_append_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            for name, rows in (("reference_formulations", [_source()]), ("reference_formulation_normalizations", [NORMALIZATION])):
                with open(os.path.join(directory, f"{name}.json"), "w", encoding="utf-8") as handle:
                    json.dump(rows, handle)
            first = ai.append_ai_reviews(directory)
            second = ai.append_ai_reviews(directory)
        self.assertGreater(first["added"], 0)
        self.assertEqual(second["added"], 0)


if __name__ == "__main__":
    unittest.main()
