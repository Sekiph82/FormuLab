"""Tests for the Phase 14 Session 5 (Phase 15 zero-LLM round) manufacturing
intelligence module — Manufacturing Procedure / Critical Parameters /
Equipment, zero LLM."""

import unittest

import manufacturing as mfg


def ingredient(key, name, role, process=None, doi=""):
    return {"key": key, "display_name": name, "role": role, "process": process, "evidence_doi": doi}


class ProcessPlanningTests(unittest.TestCase):
    def test_steps_are_ordered_by_the_real_role_convention(self):
        ings = [
            ingredient("preservative", "Phenoxyethanol", "preservative"),
            ingredient("water", "Water (Aqua)", "solvent"),
            ingredient("surf", "Decyl Glucoside", "primary_surfactant"),
        ]
        steps = mfg.plan_process_steps(ings)
        roles_in_order = [s.role for s in steps]
        self.assertLess(roles_in_order.index("solvent"), roles_in_order.index("primary_surfactant"))
        self.assertLess(roles_in_order.index("primary_surfactant"), roles_in_order.index("preservative"))

    def test_uses_real_process_evidence_when_present(self):
        ings = [ingredient("x", "X", "primary_surfactant",
                            process={"temperature_c": 45.0, "ph": None, "mixing_method": "homogenized",
                                     "time_minutes": 10.0, "equipment": "", "note": "homogenized at 45 C"},
                            doi="10.1/real")]
        steps = mfg.plan_process_steps(ings)
        self.assertEqual(steps[0].basis, mfg.BASIS_SCIENTIFIC_EVIDENCE)
        self.assertEqual(steps[0].temperature_c, 45.0)
        self.assertEqual(steps[0].confidence, "established")
        self.assertEqual(steps[0].evidence_doi, "10.1/real")

    def test_no_evidence_never_invents_a_numeric_value(self):
        ings = [ingredient("x", "X", "primary_surfactant")]
        steps = mfg.plan_process_steps(ings)
        self.assertIsNone(steps[0].temperature_c)
        self.assertIsNone(steps[0].time_minutes)
        self.assertEqual(steps[0].mixing_method, mfg.NOT_ESTABLISHED)
        self.assertEqual(steps[0].confidence, "not_established")
        self.assertEqual(steps[0].basis, mfg.BASIS_ENGINEERING_RULE)

    def test_process_only_uses_this_formulas_own_ingredients(self):
        ings = [ingredient("a", "A", "solvent"), ingredient("b", "B", "preservative")]
        steps = mfg.plan_process_steps(ings)
        all_names = {n for s in steps for n in s.ingredients}
        self.assertEqual(all_names, {"A", "B"})

    def test_role_with_no_ingredient_gets_no_step(self):
        ings = [ingredient("a", "A", "solvent")]
        steps = mfg.plan_process_steps(ings)
        self.assertEqual(len(steps), 1)
        self.assertEqual(steps[0].role, "solvent")


class CriticalParameterTests(unittest.TestCase):
    def test_mass_balance_is_always_a_critical_parameter(self):
        params = mfg.build_critical_parameters(
            {"status": "complete", "final_total": 100.0}, {}, [], [], {},
        )
        mb = next(p for p in params if p.parameter == "Total batch mass balance")
        self.assertEqual(mb.param_type, "critical_limit")
        self.assertEqual(mb.confidence, "established")

    def test_ph_is_a_target_not_automatically_a_critical_limit(self):
        params = mfg.build_critical_parameters(
            {"status": "complete", "final_total": 100.0},
            {"targetPhMin": "5.0", "targetPhMax": "5.5"}, [], [], {},
        )
        ph = next(p for p in params if p.parameter == "pH")
        self.assertEqual(ph.param_type, "target")

    def test_no_established_range_says_not_established_never_invented(self):
        params = mfg.build_critical_parameters(
            {"status": "complete", "final_total": 100.0}, {}, [], [], {},
        )
        ph = next(p for p in params if p.parameter == "pH")
        self.assertEqual(ph.range_or_limit, mfg.NOT_ESTABLISHED)
        self.assertEqual(ph.confidence, "not_established")

    def test_preservative_efficacy_test_required_when_a_preservative_is_present(self):
        ings = [ingredient("p", "Phenoxyethanol", "preservative")]
        params = mfg.build_critical_parameters({"status": "complete", "final_total": 100.0}, {}, [], ings, {})
        self.assertTrue(any(p.parameter.startswith("Preservative efficacy") for p in params))

    def test_no_preservative_role_means_no_preservative_efficacy_parameter(self):
        params = mfg.build_critical_parameters({"status": "complete", "final_total": 100.0}, {}, [], [], {})
        self.assertFalse(any(p.parameter.startswith("Preservative efficacy") for p in params))

    def test_violations_surface_as_a_critical_limit(self):
        params = mfg.build_critical_parameters(
            {"status": "complete", "final_total": 100.0}, {}, ["contains excluded ingredient 'SLES'"], [], {},
        )
        self.assertTrue(any(p.parameter == "Excluded-ingredient compliance" for p in params))

    def test_evidence_backed_active_concentration_uses_real_comparable_stats(self):
        ings = [ingredient("piroctone-olamine", "Piroctone Olamine", "active_treatment")]
        stats = {"piroctone-olamine": {"observed_min": 0.5, "observed_max": 1.5, "unit": "%"}}
        params = mfg.build_critical_parameters({"status": "complete", "final_total": 100.0}, {}, [], ings, stats)
        active = next(p for p in params if "Piroctone Olamine" in p.parameter)
        self.assertEqual(active.source_type, mfg.BASIS_SCIENTIFIC_EVIDENCE)
        self.assertIn("0.5", active.range_or_limit)


class EquipmentTests(unittest.TestCase):
    def test_equipment_derived_from_actual_process_needs(self):
        ings = [ingredient("x", "X", "rheology_modifier")]
        steps = mfg.plan_process_steps(ings)
        equipment = mfg.derive_equipment(steps, {})
        names = {e.equipment for e in equipment}
        self.assertIn("High-Shear/Disperser Mixer", names)

    def test_no_rheology_modifier_means_no_high_shear_mixer(self):
        ings = [ingredient("x", "X", "solvent")]
        steps = mfg.plan_process_steps(ings)
        equipment = mfg.derive_equipment(steps, {})
        names = {e.equipment for e in equipment}
        self.assertNotIn("High-Shear/Disperser Mixer", names)

    def test_available_equipment_is_compared_against_the_users_own_text(self):
        ings = [ingredient("x", "X", "ph_adjuster")]
        steps = mfg.plan_process_steps(ings)
        with_text = mfg.derive_equipment(steps, {"availableEquipment": "we have a pH meter and a mixing vessel"})
        without_text = mfg.derive_equipment(steps, {})
        ph_with = next(e for e in with_text if e.equipment == "Calibrated pH Meter")
        ph_without = next(e for e in without_text if e.equipment == "Calibrated pH Meter")
        self.assertEqual(ph_with.available_in_facility, "yes")
        self.assertEqual(ph_without.available_in_facility, "not_specified")

    def test_never_invents_motor_power_or_rpm(self):
        ings = [ingredient("x", "X", "rheology_modifier")]
        steps = mfg.plan_process_steps(ings)
        equipment = mfg.derive_equipment(steps, {})
        for e in equipment:
            self.assertNotIn("rpm", e.suggested_capacity.lower())
            self.assertNotIn("hp", e.suggested_capacity.lower())


class BatchScaleTests(unittest.TestCase):
    def test_recognizes_laboratory_pilot_and_production(self):
        self.assertEqual(mfg.batch_scale({"estimatedBatchSize": "small lab trial, 500g"}), "laboratory")
        self.assertEqual(mfg.batch_scale({"estimatedBatchSize": "pilot batch, 50kg"}), "pilot")
        self.assertEqual(mfg.batch_scale({"estimatedBatchSize": "full production run"}), "production")
        self.assertEqual(mfg.batch_scale({}), "not_specified")

    def test_never_scales_rpm_or_time_linearly(self):
        # The suggested capacity text for every scale must never carry a
        # specific invented RPM/time value — only a qualitative bucket and,
        # where relevant, an honest "validation required" note.
        for scale_text in ("lab", "pilot", "production", ""):
            equipment = mfg.derive_equipment([], {"estimatedBatchSize": scale_text})
            for e in equipment:
                self.assertNotRegex(e.suggested_capacity, r"\d+\s*rpm")


class SafetySeparationTests(unittest.TestCase):
    def test_invalid_mass_balance_formula_is_not_process_planned(self):
        plan = mfg.plan_manufacturing(
            "invalid_mass_balance", [ingredient("x", "X", "solvent")], {},
            {"status": "invalid_over_100", "final_total": 129.5}, [], {},
        )
        self.assertFalse(plan.ready)
        self.assertEqual(plan.steps, [])
        self.assertTrue(plan.not_ready_reason)

    def test_invalid_constraint_violation_formula_is_not_process_planned(self):
        plan = mfg.plan_manufacturing(
            "invalid_constraint_violation", [ingredient("x", "X", "solvent")], {},
            {"status": "complete", "final_total": 100.0}, ["excluded ingredient"], {},
        )
        self.assertFalse(plan.ready)

    def test_incomplete_but_valid_formula_is_still_planned(self):
        plan = mfg.plan_manufacturing(
            "incomplete_missing_evidence", [ingredient("x", "X", "solvent")], {},
            {"status": "complete", "final_total": 100.0}, [], {},
        )
        self.assertTrue(plan.ready)
        self.assertTrue(plan.steps)

    def test_complete_formula_is_planned(self):
        plan = mfg.plan_manufacturing(
            "complete", [ingredient("x", "X", "solvent")], {},
            {"status": "complete", "final_total": 100.0}, [], {},
        )
        self.assertTrue(plan.ready)


if __name__ == "__main__":
    unittest.main()
