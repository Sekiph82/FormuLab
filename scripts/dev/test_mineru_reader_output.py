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
        markdown = "- (w/w)\n- A WATER 53.30%\n- GLYCERIN 2.00%\n- PLANTASENS™ VL\n- Ricinus Communis (Castor) Seed Oil 5.00%\n"
        rows = [[w["text"] for w in line["words"]] for line in reader_lines(markdown)]
        self.assertEqual(rows[0], ["Phase", "Ingredient", "INCI", "% w/w"])
        self.assertEqual(rows[1], ["A", "WATER", "53.30"])
        self.assertEqual(rows[3], ["PLANTASENS™ VL", "Ricinus Communis (Castor) Seed Oil", "5.00"])


if __name__ == "__main__":
    unittest.main()
