"""MinerU markdown becomes OCR-style lines the app's table detection reads."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from mineru_reader_output import reader_lines  # noqa: E402


class ReaderLinesTests(unittest.TestCase):
    def test_a_table_with_a_spanning_phase_puts_every_cell_under_its_header(self):
        markdown = ("<!-- page 2 of 2 -->\n## Royal Glow - Hair Scalp Serum\n"
                    "<table><tr><td>Phase</td><td>Ingredient</td><td>Weight -%</td></tr>"
                    "<tr><td rowspan=\"2\">A</td><td>Water</td><td>Add 100</td></tr>"
                    "<tr><td>Glycerin 85%</td><td>6,00</td></tr></table>")
        lines = reader_lines(markdown)
        self.assertEqual(lines[0]["text"], "Royal Glow - Hair Scalp Serum")
        header, water, glycerin = lines[1:]
        self.assertEqual([w["text"] for w in glycerin["words"]], ["A", "Glycerin 85%", "6,00"])
        self.assertEqual([w["x0"] for w in glycerin["words"]], [w["x0"] for w in header["words"]])
        self.assertTrue(all(line["pageNumber"] == 2 for line in lines))
        # Cells never touch, so the app does not merge two columns into one fragment.
        self.assertGreater(header["words"][1]["x0"] - header["words"][0]["x1"], 6)

    def test_an_ocr_list_pairs_each_trade_name_with_its_inci_and_amount(self):
        markdown = "- (w/w)\n- A WATER 93.00%\n- GLYCERIN 2.00%\n- PLANTASENS™ VL\n- Ricinus Communis (Castor) Seed Oil 5.00%\n"
        rows = [[w["text"] for w in line["words"]] for line in reader_lines(markdown)]
        self.assertEqual(rows[0], ["Phase", "Ingredient", "INCI", "% w/w"])
        self.assertEqual(rows[1], ["A", "WATER", "93.00"])
        self.assertEqual(rows[3], ["PLANTASENS™ VL", "Ricinus Communis (Castor) Seed Oil", "5.00"])


    def test_unnamed_name_column_headerless_and_transposed_tables(self):
        def rows(markdown):
            return [[w["text"] for w in line["words"]] for line in reader_lines(markdown)]
        unnamed = rows("| | Supplier | % by wt |\n|---|---|---|\n| Water | - | 80.0 |\n| Crodasinic LS30 | Croda | 10.0 |\n| Glycerin | - | 10.0 |\n")
        self.assertEqual(unnamed[0], ["Ingredient", "Supplier", "% by wt"])
        headerless = rows("| A | Water | Solvent | ad 100.00 % |\n|---|---|---|---|\n| | Glycerin | Humectant | 3.00 % |\n| B | Aristoflex AVC | Thickener | 1.00 % |\n")
        self.assertEqual(headerless[0], ["Phase", "Ingredient", "Function", "% w/w"])
        self.assertEqual(headerless[1], ["A", "Water", "Solvent", "ad 100.00 %"])
        transposed = rows("| Formulations | Water | DOWANOL PnB | Butyl CELLOSOLVE |\n|---|---|---|---|\n| 1 | 94.0 | 3.0 | 3.0 |\n| 2 | 92.0 | 4.0 | 4.0 |\n")
        self.assertEqual(transposed[0], ["Ingredient", "% w/w"])
        self.assertEqual(transposed[1], ["Water", "94.0"])
        self.assertEqual(sum(1 for r in transposed if r == ["Ingredient", "% w/w"]), 2)


    def test_a_scanned_card_splits_joined_trade_and_inci_names_and_drops_its_title_rows(self):
        markdown = ("<table><tr><td colspan=\"3\">Hair Conditioner/ Treatment</td><td>BII/ 2024</td></tr>"
                    "<tr><td colspan=\"4\">With Octopirox®</td></tr>"
                    "<tr><td>A</td><td>Octopirox® (Clariant)Piroctone Olamine</td><td>Active ingredient</td><td>0.20%.</td></tr>"
                    "<tr><td>B</td><td>Agenajel 21287Zea Mays (Corn) Starch</td><td>Consistency factor</td><td>45.00%</td></tr>"
                    "<tr><td></td><td>Polyglykol® 3350 P (Clariant)PEG-75</td><td>Humectant</td><td>10.00%</td></tr>"
                    "<tr><td>C</td><td>Fragrance (Bell)</td><td>Fragrance</td><td>0.30%</td></tr>"
                    "<tr><td>D</td><td>Water</td><td></td><td>Ad 100%</td></tr></table>")
        rows = [[w["text"] for w in line["words"]] for line in reader_lines(markdown)]
        self.assertEqual(rows[0], ["Phase", "Ingredient", "INCI", "Function", "% w/w"])
        self.assertEqual(rows[1], ["A", "Octopirox® (Clariant)", "Piroctone Olamine", "Active ingredient", "0.20%"])
        self.assertEqual(rows[2], ["B", "Agenajel 21287", "Zea Mays (Corn) Starch", "Consistency factor", "45.00%"])
        self.assertEqual(rows[3], ["Polyglykol® 3350 P (Clariant)", "PEG-75", "Humectant", "10.00%"])
        # Nothing joined: the name keeps its cell; "(Corn) Starch" and "(Bell)" are not split.
        self.assertEqual(rows[4], ["C", "Fragrance (Bell)", "Fragrance", "0.30%"])
        self.assertEqual(len(rows), 6)


if __name__ == "__main__":
    unittest.main()
