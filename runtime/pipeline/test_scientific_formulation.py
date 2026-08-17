"""Tests for `scientific_formulation.py` — complete formulation extraction
from real, positional PDF text (`fulltext.pdf_lines()`).

The real acceptance fixture is the user's own actual downloaded PDF
(`10.20431_2455-1538.0402005.pdf`, a real herbal anti-dandruff shampoo
paper with an explicit F1-F5 composition table) — read-only, copied into
a disposable temp directory for the duration of each test, per this
project's own standing data-safety rule (never mutate/import a real
session's own files in place). Skipped, not failed, when that local file
is unavailable (e.g. a fresh checkout without the user's own local
session data) — the synthetic tests below cover the same logic without it.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import unittest

import fulltext
import scientific_formulation as sf

REAL_FIXTURE = (
    r"C:\Users\sekip\Desktop\FormuLab\data\data\sessions\2026-08-17-1706-anti-dandruff-shampoo"
    r"\literature\pdfs\10.20431_2455-1538.0402005.pdf"
)


def _copy_fixture(tmp: str) -> str:
    dest = os.path.join(tmp, "10.20431_2455-1538.0402005.pdf")
    shutil.copyfile(REAL_FIXTURE, dest)
    return dest


@unittest.skipUnless(os.path.isfile(REAL_FIXTURE), "real local PDF fixture not present on this machine")
class RealPdfExtractionTests(unittest.TestCase):
    """§28/§29 acceptance: the exact reported PDF, parsed successfully."""

    def test_extracts_five_complete_formulations(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = _copy_fixture(tmp)
            lines = fulltext.pdf_lines(path)
            self.assertGreater(len(lines), 50)
            records, outcomes = sf.extract_scientific_formulations(
                lines, canonical_paper_id="cp-real", doi="10.20431/2455-1538.0402005",
                title="Formulation and Evaluation of Herbal Anti-Dandruff Shampoo from Bhringraj Leaves",
                year="2017", authors="A. Author", product_type="shampoo",
            )
            self.assertEqual({r.source_formulation_id for r in records}, {"F1", "F2", "F3", "F4", "F5"})
            self.assertEqual(len(records), 5)

    def test_each_formulation_retains_all_ten_ingredient_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = _copy_fixture(tmp)
            lines = fulltext.pdf_lines(path)
            records, _ = sf.extract_scientific_formulations(
                lines, canonical_paper_id="cp-real", doi="10.20431/2455-1538.0402005",
                title="t", year="2017", authors="a", product_type="shampoo",
            )
            for r in records:
                names = {i.source_name for i in r.ingredients}
                self.assertEqual(len(r.ingredients), 10, names)
                self.assertIn("Neem oil", names)
                self.assertIn("Sodium Lauryl Sulfate", names)
                self.assertEqual(r.total_declared, "100ml")

    def test_sls_amount_decreases_across_f1_to_f5_matching_the_real_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = _copy_fixture(tmp)
            lines = fulltext.pdf_lines(path)
            records, _ = sf.extract_scientific_formulations(
                lines, canonical_paper_id="cp-real", doi="10.20431/2455-1538.0402005",
                title="t", year="2017", authors="a", product_type="shampoo",
            )
            by_f = {r.source_formulation_id: r for r in records}
            sls = {f: next(i for i in by_f[f].ingredients if i.source_name == "Sodium Lauryl Sulfate")
                   for f in ("F1", "F2", "F3", "F4", "F5")}
            self.assertEqual(sls["F1"].value, 20.0)
            self.assertEqual(sls["F2"].value, 15.0)
            self.assertEqual(sls["F3"].value, 10.0)
            self.assertEqual(sls["F4"].value, 5.0)
            self.assertIsNone(sls["F5"].value)  # the real source reports "-" for F5
            self.assertEqual(sls["F5"].value_text, "-")

    def test_qs_and_to_adjust_ph_cells_preserved_never_a_fabricated_number(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = _copy_fixture(tmp)
            lines = fulltext.pdf_lines(path)
            records, _ = sf.extract_scientific_formulations(
                lines, canonical_paper_id="cp-real", doi="10.20431/2455-1538.0402005",
                title="t", year="2017", authors="a", product_type="shampoo",
            )
            water = next(i for i in records[0].ingredients if i.source_name == "Water")
            self.assertTrue(water.qs)
            self.assertIsNone(water.value)
            naoh = next(i for i in records[0].ingredients if i.source_name == "Sodium Hydroxide")
            self.assertFalse(naoh.qs)
            self.assertIsNone(naoh.value)
            self.assertEqual(naoh.value_text, "To adjust pH")

    def test_unknown_herbal_ingredients_preserved_not_discarded(self):
        # §6: "Neem oil"/"Bhringraj Powder" have no FormuLab canonical
        # material match — the row must still be retained, never dropped.
        with tempfile.TemporaryDirectory() as tmp:
            path = _copy_fixture(tmp)
            lines = fulltext.pdf_lines(path)
            records, _ = sf.extract_scientific_formulations(
                lines, canonical_paper_id="cp-real", doi="10.20431/2455-1538.0402005",
                title="t", year="2017", authors="a", product_type="shampoo",
            )
            records = sf.resolve_identities(records, materials=[])
            bhringraj = next(i for i in records[0].ingredients if i.source_name == "Bhringraj Powder")
            self.assertEqual(bhringraj.identity_status, sf.UNRESOLVED_MATERIAL_IDENTITY)
            self.assertIsNone(bhringraj.material_id)
            self.assertEqual(bhringraj.source_name, "Bhringraj Powder")  # never dropped

    def test_known_ingredients_resolve_to_a_real_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = _copy_fixture(tmp)
            lines = fulltext.pdf_lines(path)
            records, _ = sf.extract_scientific_formulations(
                lines, canonical_paper_id="cp-real", doi="10.20431/2455-1538.0402005",
                title="t", year="2017", authors="a", product_type="shampoo",
            )
            records = sf.resolve_identities(records, materials=[])
            sls = next(i for i in records[0].ingredients if i.source_name == "Sodium Lauryl Sulfate")
            self.assertEqual(sls.identity_status, sf.RESOLVED_KNOWN_INGREDIENT)
            self.assertIsNotNone(sls.normalized_key)

    def test_experimental_outcomes_link_to_the_correct_source_formulation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = _copy_fixture(tmp)
            lines = fulltext.pdf_lines(path)
            _, outcomes = sf.extract_scientific_formulations(
                lines, canonical_paper_id="cp-real", doi="10.20431/2455-1538.0402005",
                title="t", year="2017", authors="a", product_type="shampoo",
            )
            self.assertGreater(len(outcomes), 0)
            f1_viscosity = [o for o in outcomes if o.source_formulation_id == "F1" and o.metric == "viscosity_cp"]
            self.assertTrue(f1_viscosity)
            # A real reported value from Table 3, RPM 0.3 -> 95733.33 cp for F1.
            at_03 = next((o for o in f1_viscosity if o.condition == "0.3"), None)
            self.assertIsNotNone(at_03)
            self.assertAlmostEqual(at_03.value, 95733.33, places=1)
            f1_foam = [o for o in outcomes if o.source_formulation_id == "F1" and o.metric == "foam_volume_ml"]
            self.assertTrue(f1_foam)

    def test_evidence_class_a_requires_materially_complete_numeric_composition(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = _copy_fixture(tmp)
            lines = fulltext.pdf_lines(path)
            records, _ = sf.extract_scientific_formulations(
                lines, canonical_paper_id="cp-real", doi="10.20431/2455-1538.0402005",
                title="t", year="2017", authors="a", product_type="shampoo",
            )
            for r in records:
                self.assertEqual(r.evidence_class, "A")
                self.assertEqual(r.extraction_confidence, "high")


class SyntheticExtractionTests(unittest.TestCase):
    """Deterministic behavior proven without depending on any local file —
    runs everywhere, including CI without the user's own local session."""

    def _lines_for(self, header, rows, total=None):
        lines = ["Table1. Formulation of Synthetic Cleanser", header]
        lines.extend(rows)
        if total is not None:
            lines.append(total)
        return lines

    def test_multi_column_table_becomes_separate_formulation_records(self):
        lines = self._lines_for(
            "F1 F2 F3",
            ["Sodium Lauryl Sulfate 10 5 -", "Glycerin 2 2 2", "Water q.s q.s q.s"],
            "Total 100ml 100ml 100ml",
        )
        records, _ = sf.extract_scientific_formulations(
            lines, canonical_paper_id="cp1", doi="10.1/x", title="t", year="2020", authors="a",
        )
        self.assertEqual(len(records), 3)
        self.assertEqual({r.source_formulation_id for r in records}, {"F1", "F2", "F3"})

    def test_no_composition_table_returns_empty_not_fabricated(self):
        lines = ["This paper discusses shampoo formulation in general terms.",
                 "No structured table is present anywhere in this text."]
        records, outcomes = sf.extract_scientific_formulations(
            lines, canonical_paper_id="cp2", doi="10.1/y", title="t", year="2020", authors="a",
        )
        self.assertEqual(records, [])
        self.assertEqual(outcomes, [])

    def test_unparseable_row_does_not_crash_and_stops_the_table_scan(self):
        lines = self._lines_for(
            "F1 F2",
            ["Sodium Lauryl Sulfate 10 5", "this row has no trailing numeric cells at all"],
        )
        records, _ = sf.extract_scientific_formulations(
            lines, canonical_paper_id="cp3", doi="10.1/z", title="t", year="2020", authors="a",
        )
        self.assertEqual(len(records), 2)
        for r in records:
            self.assertEqual(len(r.ingredients), 1)

    def test_study_count_stays_one_formulation_count_is_five(self):
        # §4: five formulations from one paper must never inflate the
        # unique-study count this pipeline reports elsewhere.
        lines = self._lines_for(
            "F1 F2 F3 F4 F5",
            ["Neem oil 0.5 1.0 1.5 2.0 2.5", "Water q.s q.s q.s q.s q.s"],
            "Total 100ml 100ml 100ml 100ml 100ml",
        )
        records, _ = sf.extract_scientific_formulations(
            lines, canonical_paper_id="cp-single-paper", doi="10.1/one-paper",
            title="t", year="2020", authors="a",
        )
        self.assertEqual(len(records), 5)
        self.assertEqual(len({r.canonical_paper_id for r in records}), 1)

    def test_resolve_row_identity_layers_supplier_before_known_vocabulary(self):
        materials = [{"inci": "Glycerin", "name": "Glycerin USP", "cas": "56-81-5"}]
        key, mat_id, status = sf.resolve_row_identity("Glycerin", materials)
        self.assertEqual(status, sf.RESOLVED_SUPPLIER_MATERIAL)
        self.assertIsNotNone(mat_id)

    def test_resolve_row_identity_unknown_stays_unresolved(self):
        key, mat_id, status = sf.resolve_row_identity("Bhringraj Powder", [])
        self.assertEqual(status, sf.UNRESOLVED_MATERIAL_IDENTITY)
        self.assertIsNone(mat_id)
        self.assertIsNone(key)


if __name__ == "__main__":
    unittest.main()
