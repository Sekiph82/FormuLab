"""Tests for the Phase 14 Session 6 deterministic Regulatory engine. Zero LLM."""

import unittest

import regulatory as reg
from evidence import normalize_ingredient_key


def formula(ingredients):
    return {"ingredients": ingredients}


class MarketCoverageTests(unittest.TestCase):
    def test_supported_alias_resolves_to_a_real_jurisdiction_code(self):
        self.assertEqual(reg.resolve_market("kenya"), "KE")
        self.assertEqual(reg.market_coverage("kenya"), "partial")

    def test_partially_supported_market_is_never_compliant_with_zero_findings(self):
        result = reg.evaluate_regulatory(formula([{"inci": "Water (Aqua)", "weight_pct": "q.s. 100"}]), {"market": "rwanda"}, {})
        self.assertEqual(result.coverage, "partial")
        self.assertNotEqual(result.overall_status, reg.COMPLIANT)

    def test_unsupported_market_is_data_incomplete(self):
        result = reg.evaluate_regulatory(formula([{"inci": "Water (Aqua)", "weight_pct": "q.s. 100"}]), {"market": "eu"}, {})
        self.assertEqual(result.coverage, "unsupported")
        self.assertEqual(result.overall_status, reg.DATA_INCOMPLETE)

    def test_unspecified_market_is_unsupported_and_data_incomplete(self):
        result = reg.evaluate_regulatory(formula([{"inci": "Water (Aqua)", "weight_pct": "q.s. 100"}]), {}, {})
        self.assertEqual(result.coverage, "unsupported")
        self.assertEqual(result.overall_status, reg.DATA_INCOMPLETE)


class RuleEvaluationTests(unittest.TestCase):
    def test_prohibited_ingredient_is_non_compliant(self):
        rule = reg.RegulatoryRule("TEST-PROHIB-001", "KE", "Test Authority", "ingredient_prohibition", [],
                                    "Test ingredient is prohibited.",
                                    ingredient_keys=[normalize_ingredient_key("Banned Substance")])
        findings = reg.evaluate_rule(rule, formula([{"inci": "Banned Substance", "weight_pct": "1.0"}]), {})
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0].status, reg.NON_COMPLIANT)

    def test_restricted_ingredient_within_limit_is_compliant_with_conditions(self):
        rule = reg.RegulatoryRule("TEST-LIMIT-001", "KE", "Test Authority", "ingredient_restriction", [],
                                    "Max 1% test active.", ingredient_keys=[normalize_ingredient_key("Test Active")],
                                    max_concentration_pct=1.0)
        findings = reg.evaluate_rule(rule, formula([{"inci": "Test Active", "weight_pct": "0.5"}]), {})
        self.assertEqual(findings[0].status, reg.COMPLIANT_WITH_CONDITIONS)

    def test_restricted_ingredient_over_limit_is_non_compliant(self):
        rule = reg.RegulatoryRule("TEST-LIMIT-002", "KE", "Test Authority", "ingredient_restriction", [],
                                    "Max 1% test active.", ingredient_keys=[normalize_ingredient_key("Test Active")],
                                    max_concentration_pct=1.0)
        findings = reg.evaluate_rule(rule, formula([{"inci": "Test Active", "weight_pct": "5.0"}]), {})
        self.assertEqual(findings[0].status, reg.NON_COMPLIANT)

    def test_missing_concentration_basis_never_invents_a_pass_or_fail(self):
        rule = reg.RegulatoryRule("TEST-LIMIT-003", "KE", "Test Authority", "ingredient_restriction", [],
                                    "Max 1% test active.", ingredient_keys=[normalize_ingredient_key("Test Active")],
                                    max_concentration_pct=1.0)
        findings = reg.evaluate_rule(rule, formula([{"inci": "Test Active", "weight_pct": "q.s. 100"}]), {})
        # A non-numeric weight (e.g. the q.s. line) cannot be compared to a
        # limit — the rule still reports the requirement is real and
        # applicable, but never claims a numeric pass/fail it cannot compute.
        self.assertEqual(findings[0].status, reg.COMPLIANT_WITH_CONDITIONS)

    def test_ingredient_not_present_produces_no_finding(self):
        rule = reg.RegulatoryRule("TEST-PROHIB-002", "KE", "Test Authority", "ingredient_prohibition", [],
                                    "Test ingredient is prohibited.",
                                    ingredient_keys=[normalize_ingredient_key("Banned Substance")])
        findings = reg.evaluate_rule(rule, formula([{"inci": "Water (Aqua)", "weight_pct": "q.s. 100"}]), {})
        self.assertEqual(findings, [])


class ClaimReviewTests(unittest.TestCase):
    def test_sulfate_free_claim_checked_against_real_composition(self):
        f = formula([{"inci": "Water (Aqua)", "weight_pct": "q.s. 100"},
                      {"inci": "Decyl Glucoside", "weight_pct": "10"}])
        claims = reg.review_claims({"claims": "sulfate-free"}, f, {}, "partial")
        c = next(c for c in claims if c.claim == "sulfate-free")
        self.assertEqual(c.check_type, "formulation_condition")
        self.assertEqual(c.status, reg.COMPLIANT)

    def test_sulfate_free_claim_with_a_real_sulfate_present_is_non_compliant(self):
        f = formula([{"inci": "Water (Aqua)", "weight_pct": "q.s. 100"},
                      {"inci": "Sodium Laureth Sulfate", "weight_pct": "10"}])
        claims = reg.review_claims({"claims": "sulfate-free"}, f, {}, "partial")
        c = next(c for c in claims if c.claim == "sulfate-free")
        self.assertEqual(c.status, reg.NON_COMPLIANT)

    def test_substantiation_required_claim_never_satisfied_by_composition(self):
        f = formula([{"inci": "Water (Aqua)", "weight_pct": "q.s. 100"}])
        claims = reg.review_claims({"claims": "dermatologically tested"}, f, {}, "partial")
        c = next(c for c in claims if c.claim == "dermatologically tested")
        self.assertEqual(c.check_type, "substantiation_required")
        self.assertEqual(c.status, reg.DATA_INCOMPLETE)

    def test_regulatory_eligibility_claim_is_data_incomplete_for_unsupported_market(self):
        f = formula([{"inci": "Water (Aqua)", "weight_pct": "q.s. 100"}])
        claims = reg.review_claims({"claims": "antibacterial"}, f, {}, "unsupported")
        c = next(c for c in claims if c.claim == "antibacterial")
        self.assertEqual(c.status, reg.DATA_INCOMPLETE)


class VersionScopingTests(unittest.TestCase):
    def test_two_versions_with_different_composition_get_different_regulatory_results(self):
        v1 = formula([{"inci": "Water (Aqua)", "weight_pct": "q.s. 100"},
                       {"inci": "Sodium Laureth Sulfate", "weight_pct": "10"}])
        v2 = formula([{"inci": "Water (Aqua)", "weight_pct": "q.s. 100"},
                       {"inci": "Decyl Glucoside", "weight_pct": "10"}])
        brief = {"market": "kenya", "claims": "sulfate-free"}
        r1 = reg.evaluate_regulatory(v1, brief, {})
        r2 = reg.evaluate_regulatory(v2, brief, {})
        self.assertNotEqual(r1.overall_status, r2.overall_status)


if __name__ == "__main__":
    unittest.main()
