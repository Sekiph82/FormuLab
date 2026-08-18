"""Phase 14 Session 6 — deterministic validation-plan generator. Zero LLM.

Recommends real laboratory/process checks based on this formula version's
own real characteristics (category group, functional roles actually
present, batch scale) — never a fixed, one-size-fits-all checklist, and
never a claimed test RESULT (this module recommends what to check, it
never asserts a check passed). FVL-03.009/.010: no longer takes a
safety/regulatory outcome at all — both `safety.py` and `regulatory.py`
were retired as duplicate final-verdict authorities; the real ones now
live entirely client-side (`packages/shared/src/engine/safety.ts`/
`regulatoryRules.ts`).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional

SCHEMA_VERSION = 1


@dataclass(frozen=True)
class ValidationCheck:
    check: str
    rule_id: str
    reason: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _check(check, rule_id, reason) -> ValidationCheck:
    return ValidationCheck(check=check, rule_id=rule_id, reason=reason)


def build_validation_plan(
    formula_state: str,
    group: str,
    manufacturing_plan: Optional[Dict[str, Any]],
) -> List[ValidationCheck]:
    checks: List[ValidationCheck] = []

    if formula_state in ("invalid_mass_balance", "invalid_constraint_violation"):
        checks.append(_check(
            "Resolve formula validity before any laboratory validation", "VAL-000",
            f"This formula version's own state is '{formula_state}' — laboratory time should not "
            f"be spent validating a formula that is not yet internally valid.",
        ))
        return checks

    if formula_state.startswith("incomplete_"):
        checks.append(_check(
            "Resolve the missing evidence/functional-role gap before full validation", "VAL-001",
            f"This formula version's own state is '{formula_state}' — a real, specific gap "
            f"remains unresolved (see `missing_roles`); validating an incomplete formula wastes "
            f"lab time on a candidate that will change.",
        ))

    # FVL-03.009/.010: VAL-002 (a Safety/Regulatory NON_COMPLIANT advisory
    # entry) was removed entirely — both `safety.py` and `regulatory.py`
    # are now retired, and neither authoritative verdict is computed in
    # Python at all any more (see `apps/desktop/src/lib/
    # generatedFormulaSafety.ts`/`generatedFormulaRegulatory.ts`). This
    # checklist generator now only recommends real, formula-shape-derived
    # laboratory checks — it never re-derives a business verdict itself.

    checks.append(_check("Laboratory batch", "VAL-010",
                          "Baseline requirement for any newly generated formula before further testing."))
    checks.append(_check("Appearance", "VAL-011",
                          "Standard baseline check for any laboratory batch."))
    checks.append(_check("pH", "VAL-012",
                          "Standard baseline check for any aqueous formulation; confirms the target/"
                          "critical pH is actually achieved in the real batch."))

    roles_present = set()
    if manufacturing_plan and manufacturing_plan.get("ready"):
        for step in manufacturing_plan.get("steps", []):
            roles_present.add(step.get("role", ""))

    if "rheology_modifier" in roles_present:
        checks.append(_check("Viscosity", "VAL-013",
                              "A rheology-modifier role is present in this formula's own resolved "
                              "ingredients — viscosity is a real process/quality parameter for it."))
    if "preservative" in roles_present:
        checks.append(_check("Microbiological / preservative-efficacy challenge testing", "VAL-014",
                              "A preservative role is present — this is the same real requirement "
                              "already named in this version's own Critical Parameters."))
    if "active_treatment" in roles_present or "active_system" in roles_present:
        checks.append(_check("Performance test", "VAL-015",
                              "An active-treatment role is present — a real performance check "
                              "against the request's own claim is applicable."))
    if group == "leave_on":
        checks.append(_check("Freeze/thaw stability", "VAL-016",
                              "Leave-on emulsion-type products are real candidates for phase "
                              "instability under temperature cycling."))
        checks.append(_check("Centrifuge stability", "VAL-017",
                              "Leave-on emulsion-type products are real candidates for a "
                              "centrifuge-based phase-separation screen."))

    checks.append(_check("Accelerated stability", "VAL-018",
                          "Standard real practice for any new formulation before shelf-life claims."))
    checks.append(_check("Ambient stability", "VAL-019",
                          "Standard real practice alongside accelerated stability."))
    checks.append(_check("Compatibility (packaging)", "VAL-020",
                          "Standard real practice before committing to a packaging format."))

    scale = (manufacturing_plan or {}).get("batch_scale", "not_specified")
    if scale in ("pilot", "production") or formula_state == "complete_with_validation_required":
        checks.append(_check("Pilot batch / scale-up validation", "VAL-021",
                              f"Batch scale is '{scale}' and/or this version carries a real "
                              f"validation-required condition — a pilot run before full production "
                              f"is the applicable next real step."))

    return checks
