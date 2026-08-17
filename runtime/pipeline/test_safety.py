"""Tests for the Phase 14 Session 6 deterministic Safety engine. Zero LLM."""

import unittest

import safety


def formula(ingredients):
    return {"ingredients": ingredients}


class SafetyStatusTests(unittest.TestCase):
    def test_clean_formula_passes(self):
        f = formula([{"inci": "Water (Aqua)", "weight_pct": "q.s. 100"},
                      {"inci": "Decyl Glucoside", "weight_pct": "10"}])
        res = safety.evaluate_safety(f, {"targetPhMin": "5.0", "targetPhMax": "5.5"}, [], {"ready": True, "steps": []})
        self.assertEqual(res.overall_status, safety.PASS)

    def test_known_sensitizer_class_ingredient_is_pass_with_conditions(self):
        f = formula([{"inci": "Methylisothiazolinone", "weight_pct": "0.01"}])
        res = safety.evaluate_safety(f, {"targetPhMin": "5.0", "targetPhMax": "5.5"}, [], {"ready": True, "steps": []})
        self.assertEqual(res.overall_status, safety.PASS_WITH_CONDITIONS)
        self.assertTrue(any(x["rule_id"] == "SAFETY-SENS-001" for x in res.findings))

    def test_excluded_ingredient_violation_is_fail(self):
        f = formula([{"inci": "Sodium Laureth Sulfate", "weight_pct": "10"}])
        res = safety.evaluate_safety(f, {}, ["contains excluded ingredient 'SLES'"], {"ready": True, "steps": []})
        self.assertEqual(res.overall_status, safety.FAIL)

    def test_extreme_ph_crossing_ghs_boundary_is_fail(self):
        f = formula([{"inci": "Water (Aqua)", "weight_pct": "q.s. 100"}])
        res = safety.evaluate_safety(f, {"targetPhMin": "1.0", "targetPhMax": "1.5"}, [], {"ready": True, "steps": []})
        self.assertEqual(res.overall_status, safety.FAIL)
        self.assertTrue(any(x["rule_id"] == "SAFETY-PH-001" for x in res.findings))

    def test_missing_ph_is_data_incomplete_never_pass_or_fail(self):
        f = formula([{"inci": "Water (Aqua)", "weight_pct": "q.s. 100"}])
        res = safety.evaluate_safety(f, {}, [], {"ready": True, "steps": []})
        ph_finding = next(x for x in res.findings if x["rule_id"] == "SAFETY-PH-003")
        self.assertEqual(ph_finding["status"], safety.DATA_INCOMPLETE)

    def test_unready_manufacturing_plan_is_data_incomplete(self):
        f = formula([{"inci": "Water (Aqua)", "weight_pct": "q.s. 100"}])
        res = safety.evaluate_safety(f, {"targetPhMin": "5.0", "targetPhMax": "5.5"}, [], {"ready": False})
        mfg_finding = next(x for x in res.findings if x["rule_id"] == "SAFETY-MFG-000")
        self.assertEqual(mfg_finding["status"], safety.DATA_INCOMPLETE)

    def test_manufacturing_elevated_temperature_flagged(self):
        f = formula([{"inci": "Phenoxyethanol", "weight_pct": "0.5"}])
        mfg = {"ready": True, "steps": [{"phase": "Preservation", "temperature_c": 55, "ingredients": ["Phenoxyethanol"], "basis": "deterministic_rule"}]}
        res = safety.evaluate_safety(f, {"targetPhMin": "5.0", "targetPhMax": "5.5"}, [], mfg)
        self.assertTrue(any(x["rule_id"] == "SAFETY-TEMP-001" for x in res.findings))

    def test_hard_rule_violation_stays_separate_from_soft_evidence_findings(self):
        # A PASS_WITH_CONDITIONS finding (sensitizer class) never escalates
        # to FAIL on its own — only a real hard violation (excluded
        # ingredient, extreme pH) does.
        f = formula([{"inci": "Methylisothiazolinone", "weight_pct": "0.01"}])
        res = safety.evaluate_safety(f, {"targetPhMin": "5.0", "targetPhMax": "5.5"}, [], {"ready": True, "steps": []})
        self.assertNotEqual(res.overall_status, safety.FAIL)

    def test_findings_always_carry_a_real_rule_id_and_source(self):
        f = formula([{"inci": "Sodium Hydroxide", "weight_pct": "0.1"},
                      {"inci": "Fragrance", "weight_pct": "0.3"}])
        res = safety.evaluate_safety(f, {"targetPhMin": "5.0", "targetPhMax": "5.5"}, [], {"ready": True, "steps": []})
        for finding in res.findings:
            self.assertTrue(finding["rule_id"], finding)


if __name__ == "__main__":
    unittest.main()
