"""Tests for the deterministic rules engine — the SLES/eczema consistency fix."""

import unittest

from rules import derive_constraints, validate


class RulesTests(unittest.TestCase):
    def test_antidandruff_always_excludes_sulfates(self):
        # This is the v1 bug: it must fire EVERY time, not once.
        for target in [
            "anti dandruff / anti-pelliculair shampoo",
            "antidandruff shampoo",
            "kepek önleyici şampuan",
            "shampoo for seborrheic dermatitis",
        ]:
            c = derive_constraints({"target": target, "category": "shampoo"})
            self.assertTrue(c["sensitive"], target)
            joined = " ".join(c["avoid"]).lower()
            self.assertIn("sles", joined, target)
            self.assertIn("sodium lauryl sulfate", joined, target)

    def test_child_audience_triggers_sensitive(self):
        c = derive_constraints({"target": "shampoo", "audience": "child"})
        self.assertTrue(c["sensitive"])
        self.assertIn("parfum", " ".join(c["avoid"]).lower())

    def test_normal_shampoo_allows_sulfates(self):
        c = derive_constraints({"target": "everyday cleansing shampoo", "category": "shampoo"})
        self.assertFalse(c["sensitive"])
        self.assertEqual(c["avoid"], [])

    def test_kenya_requires_chelator(self):
        c = derive_constraints({"target": "shampoo", "market": "kenya"})
        self.assertIn("chelator", c["require_functions"])
        self.assertTrue(any("edta" in p.lower() or "citrate" in p.lower() for p in c["prefer"]))

    def test_kenya_detergent_requires_builder(self):
        c = derive_constraints({"target": "laundry detergent", "market": "kenya"})
        self.assertIn("builder", c["require_functions"])

    def test_target_ph_by_category(self):
        self.assertEqual(derive_constraints({"target": "shampoo"})["target_ph"], "4.5-5.5")
        self.assertEqual(derive_constraints({"target": "limescale remover"})["target_ph"], "2-3")

    def test_validate_flags_banned_ingredient(self):
        c = derive_constraints({"target": "antidandruff shampoo", "category": "shampoo"})
        formula = ["Water (Aqua)", "Sodium Laureth Sulfate (70%)", "Cocamidopropyl Betaine"]
        v = validate(formula, c)
        self.assertTrue(v)
        self.assertIn("Sodium Laureth Sulfate".lower(), v[0].lower())

    def test_validate_passes_clean_formula(self):
        c = derive_constraints({"target": "antidandruff shampoo", "category": "shampoo"})
        formula = ["Water (Aqua)", "Decyl Glucoside", "Cocamidopropyl Betaine", "Piroctone Olamine"]
        self.assertEqual(validate(formula, c), [])


if __name__ == "__main__":
    unittest.main()
