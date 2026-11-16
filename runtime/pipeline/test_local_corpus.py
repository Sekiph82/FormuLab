"""The formulation-discovery skill reads the local formula corpus first."""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "skills", "core", "formulation-discovery"))

from local_corpus import local_formulas  # noqa: E402
from test_reference_formulation_prior_adapter import AuthoritativeReferenceGuidanceTests as Fixture  # noqa: E402


class LocalCorpusTests(unittest.TestCase):
    def test_returns_the_family_formula_with_its_printed_lines_and_ingredient_statistics(self):
        fixture = Fixture("test_recomputes_prior_and_dosage_from_reviewed_source_records")
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture._write("materials", [{"code": "MAT-001", "displayName": "Reviewed surfactant", "inciName": "Reviewed surfactant", "active": True}])
        result = local_formulas(fixture.directory, "hand dishwash")
        self.assertEqual(result["eligibleFormulaCount"], 1)
        (formula,) = result["formulas"]
        self.assertEqual(formula["id"], "formula-1")
        self.assertEqual(formula["lines"][0]["amount"], "4")
        self.assertEqual(result["ingredients"][0]["typicalPercent"], {"lower": 4.0, "upper": 4.0})


if __name__ == "__main__":
    unittest.main()
