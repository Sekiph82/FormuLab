"""Advanced Formulation Constraint Optimizer — mixed-integer solver core.

A real constraint-satisfaction + multi-objective optimizer over a formula's
raw-material mix, going well beyond `formulation_core.py`'s single
cost-minimize-subject-to-active-target LP. This module is additive: the
simple optimizer is untouched, keeps its own CLI/Tauri command, and nothing
here changes its input or output shape.

Model
-----
Decision variable ``x_i`` = kilograms of candidate material ``i`` to use,
``0 <= x_i <= cap_i`` where ``cap_i`` is the tighter of available stock and
``batch_kg * max_usage_pct_i / 100``. A material referenced by a conditional
constraint additionally gets a binary indicator ``y_i`` (or one per
constraint pairing) — see ``_add_conditional_constraints``. When no
conditional constraint fires the model stays pure LP, which is also when
``sensitivity`` is available (see ``_sensitivity_report``); a model with any
binary variable is genuinely a MIP, and CBC's duals are not meaningful for
one, so sensitivity is reported unavailable rather than printed anyway.

Contract
--------
Input/output are plain JSON, matching the shapes of
``packages/shared/src/schemas/optimization.ts``'s ``formulationProblemSchema``
/ ``advancedOptimizationResultSchema`` — kept in sync by hand, like the rest
of this platform's TS/Python boundary (`HUMAN_ONLY_STATUSES`, the
compatibility/safety rule shapes). See docs/SOLVER_ARCHITECTURE.md.

Run as a CLI (reads one JSON `FormulationProblem` on stdin, writes one
`AdvancedOptimizationResult` on stdout)::

    python advanced_optimizer.py < problem.json

Or import :func:`solve` directly.
"""

from __future__ import annotations

import json
import sys
import time
import uuid
from typing import Any, Dict, List, Optional, Sequence, Tuple

# Percentage points below which a variable is treated as "not present" for a
# conditional-constraint trigger — matches
# `conditionalConstraintSchema.presenceThresholdPercent`'s schema default.
DEFAULT_PRESENCE_THRESHOLD_PCT = 0.001

# Precision policy (docs/PRECISION_POLICY.md / packages/shared/src/engine/decimal.ts).
DP_PERCENT = 4
DP_QUANTITY = 4
DP_MONEY = 6  # unitPrice-scale; totals are re-rounded to 2dp by the caller.

# Objective metrics this module can honestly compute from real, linear data.
# `performance_score` and `regulatory_uncertainty` are deliberately absent —
# see `_build_objective_terms`.
SUPPORTED_METRICS = {
    "raw_material_cost",
    "landed_cost",
    "total_factory_cost",  # alias of landed_cost — see _build_objective_terms.
    "compatibility_risk",
    "safety_risk",
    "supply_risk",
    "carbon_score",
    "stock_utilization",
    "evidence_confidence",
}


class OptimizerError(ValueError):
    """Raised when the input describes a malformed problem."""


# ---------------------------------------------------------------------------
# Input normalization
# ---------------------------------------------------------------------------


def _num(value: Any, field: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        raise OptimizerError(f"'{field}' must be a number, got {value!r}")


def _opt_num(container: Dict[str, Any], key: str) -> Optional[float]:
    """Read an `OptimizationValue { value, state }` field: a number only when
    both present and non-empty; `None` (never 0) otherwise."""
    v = container.get(key)
    if not isinstance(v, dict):
        return None
    raw = v.get("value")
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


class Material:
    __slots__ = (
        "id",
        "code",
        "name",
        "price",
        "active_pct",
        "solids_pct",
        "water_pct",
        "density",
        "hlb",
        "functions",
        "ionic",
        "min_use_pct",
        "max_use_pct",
        "technical_max_pct",
        "regulatory_max_pct",
        "stock",
        "reserved_stock",
        "supply_risk",
        "evidence_confidence",
        "carbon_score",
        "compat_risk",
        "safety_risk",
        "cas_numbers",
        "locked_percent",
        "excluded",
        "cap_kg",
    )

    def __init__(self, raw: Dict[str, Any], batch_kg: float):
        self.id = str(raw.get("id") or raw.get("materialCode") or "")
        if not self.id:
            raise OptimizerError("every material needs an 'id'")
        self.code = str(raw.get("materialCode") or self.id)
        self.name = str(raw.get("name") or self.code)

        self.price = _opt_num(raw, "price")
        self.active_pct = _opt_num(raw, "activeMatterPercent")
        self.solids_pct = _opt_num(raw, "solidsPercent")
        self.water_pct = _opt_num(raw, "waterPercent")
        self.density = _opt_num(raw, "density")
        self.hlb = _opt_num(raw, "hlb")
        self.functions = list(raw.get("functions") or [])
        self.ionic = raw.get("ionicCharacter")
        self.min_use_pct = _num(raw["minUsePercent"], "minUsePercent") if raw.get("minUsePercent") not in (None, "") else 0.0
        self.max_use_pct = (
            _num(raw["maxUsePercent"], "maxUsePercent") if raw.get("maxUsePercent") not in (None, "") else 100.0
        )
        self.technical_max_pct = (
            _num(raw["technicalMaxPercent"], "technicalMaxPercent")
            if raw.get("technicalMaxPercent") not in (None, "")
            else None
        )
        self.regulatory_max_pct = _opt_num(raw, "regulatoryMaxPercent")

        self.stock = _opt_num(raw, "stock")
        self.reserved_stock = _opt_num(raw, "reservedStock")
        available = _opt_num(raw, "availableStock")
        if available is None and self.stock is not None:
            available = max(0.0, self.stock - (self.reserved_stock or 0.0))
        self.stock = available  # from here on, "stock" means AVAILABLE stock.

        supply_risk = raw.get("supplyRiskScore")
        self.supply_risk = float(supply_risk) if isinstance(supply_risk, (int, float)) else None
        evidence = raw.get("evidenceConfidenceScore")
        self.evidence_confidence = float(evidence) if isinstance(evidence, (int, float)) else None
        carbon = raw.get("carbonScore")
        self.carbon_score = float(carbon) if isinstance(carbon, (int, float)) else None
        # Real, findings-derived graded risk (spec §A4) — computed by the
        # caller from the actual compatibility/safety engines
        # (blockingExclusionConstraints's sibling, AdvancedOptimizerPanel.tsx's
        # gradedRiskScores) and passed in here; the solver never invents one.
        compat_risk = raw.get("compatibilityRiskScore")
        self.compat_risk = float(compat_risk) if isinstance(compat_risk, (int, float)) else None
        safety_risk = raw.get("safetyRiskScore")
        self.safety_risk = float(safety_risk) if isinstance(safety_risk, (int, float)) else None

        self.cas_numbers = list(raw.get("casNumbers") or [])
        self.locked_percent = (
            _num(raw["lockedPercent"], "lockedPercent") if raw.get("lockedPercent") not in (None, "") else None
        )
        self.excluded = bool(raw.get("excluded", False))

        effective_max_pct = min(
            self.max_use_pct,
            self.technical_max_pct if self.technical_max_pct is not None else 100.0,
            self.regulatory_max_pct if self.regulatory_max_pct is not None else 100.0,
        )
        cap_by_pct = batch_kg * max(0.0, effective_max_pct) / 100.0
        cap_by_stock = self.stock if self.stock is not None else cap_by_pct
        self.cap_kg = 0.0 if self.excluded else max(0.0, min(cap_by_pct, cap_by_stock))
        if self.locked_percent is not None:
            locked_kg = batch_kg * self.locked_percent / 100.0
            self.cap_kg = locked_kg
            self.min_use_pct = max(self.min_use_pct, self.locked_percent)


def _normalize_materials(raw_materials: Sequence[Dict[str, Any]], batch_kg: float) -> Dict[str, Material]:
    if not raw_materials:
        raise OptimizerError("at least one candidate material is required")
    out: Dict[str, Material] = {}
    for i, m in enumerate(raw_materials):
        mat = Material(m, batch_kg)
        if mat.id in out:
            raise OptimizerError(f"duplicate material id: {mat.id}")
        out[mat.id] = mat
    return out


# ---------------------------------------------------------------------------
# Solve
# ---------------------------------------------------------------------------


def solve(problem: Dict[str, Any], *, cancel_check: Optional[Any] = None) -> Dict[str, Any]:
    """Solve one `FormulationProblem`. `cancel_check`, if given, is called
    periodically-in-spirit (PuLP/CBC does not support mid-solve polling, so
    this is checked before the solve starts and used to label a result
    `cancelled` post hoc when the caller kills the process — the Rust command
    layer is what actually enforces cancellation, by dropping the child
    process; see docs/SOLVER_ARCHITECTURE.md)."""
    import pulp

    started = time.monotonic()
    run_id = str(uuid.uuid4())

    batch = problem.get("batch") or {}
    batch_kg = _num(batch.get("sizeKg", 0), "batch.sizeKg")
    if batch_kg <= 0:
        raise OptimizerError("batch.sizeKg must be greater than 0")

    materials = _normalize_materials(problem.get("materials") or [], batch_kg)
    mat_ids = sorted(materials.keys())  # deterministic order for var/constraint naming.

    prob = pulp.LpProblem("formulation_advanced", pulp.LpMinimize)
    x = {mid: pulp.LpVariable(f"x_{_safe_name(mid)}", lowBound=0, upBound=materials[mid].cap_kg) for mid in mat_ids}
    if any(m.locked_percent is not None for m in materials.values()):
        for mid, m in materials.items():
            if m.locked_percent is not None:
                prob += x[mid] == batch_kg * m.locked_percent / 100.0, f"lock_{_safe_name(mid)}"

    constraint_meta: List[Dict[str, Any]] = []  # for constraint_results in the output.
    binary_vars: Dict[str, "pulp.LpVariable"] = {}
    penalty_terms: List[Tuple[Any, Dict[str, Any]]] = []  # soft-constraint objective contributions (spec §A2).

    _add_composition_constraints(prob, x, materials, batch_kg, problem.get("compositionConstraints") or [], constraint_meta, penalty_terms)
    _add_functional_constraints(prob, x, materials, batch_kg, problem.get("functionalConstraints") or [], constraint_meta, penalty_terms)
    _add_ratio_constraints(prob, x, materials, problem.get("ratioConstraints") or [], constraint_meta, penalty_terms)
    _add_conditional_constraints(
        prob, x, materials, batch_kg, problem.get("conditionalConstraints") or [], constraint_meta, binary_vars, penalty_terms
    )
    property_evaluations = _evaluate_property_targets(
        prob, x, materials, batch_kg, problem.get("propertyTargets") or [], constraint_meta, penalty_terms
    )
    cost_ceiling = problem.get("costCeiling")
    if cost_ceiling:
        _add_cost_ceiling_constraint(prob, x, materials, constraint_meta, penalty_terms, cost_ceiling)

    objective_config = problem.get("objectiveConfig") or {}
    objective_terms, objective_meta, norm_bounds = _build_objective_terms(
        x, materials, batch_kg, objective_config.get("objectives") or []
    )
    strategy = objective_config.get("type", "weighted")

    solver_config = problem.get("solverConfig") or {}
    timeout = _num(solver_config.get("timeoutSeconds", 30), "solverConfig.timeoutSeconds")

    is_mixed_integer = len(binary_vars) > 0

    if strategy == "lexicographic":
        status, solved_prob = _solve_lexicographic(prob, objective_terms, objective_meta, timeout, penalty_terms)
    else:
        combined_terms = [term for term, _meta in objective_terms] + [term for term, _meta in penalty_terms]
        combined = pulp.lpSum(combined_terms) if combined_terms else 0
        solved_prob = prob
        solved_prob += combined, "combined_objective"
        status_code = solved_prob.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=timeout))
        status = pulp.LpStatus[status_code].lower()

    solve_time_ms = (time.monotonic() - started) * 1000.0
    result_status = _map_status(status)

    solver_metadata = {
        "solver": "cbc",
        "solveTimeMs": round(solve_time_ms, 2),
        "variableCount": len(x) + len(binary_vars),
        "constraintCount": len(solved_prob.constraints),
        "isMixedInteger": is_mixed_integer,
        "timeoutSeconds": timeout,
        "cancelled": False,
    }

    if result_status not in ("optimal", "feasible"):
        infeasibility = _diagnose_infeasibility(materials, batch_kg, problem)
        return _empty_result(run_id, problem, result_status, solver_metadata, infeasibility)

    lines, totals = _extract_lines(x, materials, batch_kg)
    objective_results = _extract_objective_results(objective_terms, objective_meta, norm_bounds, strategy)
    constraint_results = _extract_constraint_results(constraint_meta, batch_kg)
    property_results = _extract_property_results(property_evaluations, materials, x, batch_kg, constraint_results)
    warnings = _build_warnings(materials, problem, constraint_results)
    sensitivity = _sensitivity_report(solved_prob, is_mixed_integer)

    # Every hard constraint is satisfied whenever we get here (that is what
    # `optimal`/`feasible` from CBC means); a soft constraint's own
    # `satisfied` flag is the only thing that can still be false. Never
    # relabel an unqualified `optimal` when a violation is present.
    any_soft_violated = any(
        not r["satisfied"] for r in constraint_results if r["strictness"] == "soft"
    )
    if any_soft_violated and result_status == "optimal":
        result_status = "feasible_with_penalties"

    return {
        "schemaVersion": "1.0",
        "runId": run_id,
        "problemId": str(problem.get("id") or ""),
        "status": result_status,
        "formulaLines": lines,
        "totals": totals,
        "objectiveResults": objective_results,
        "constraintResults": constraint_results,
        "propertyResults": property_results,
        "warnings": warnings,
        "sensitivity": sensitivity,
        "solverMetadata": solver_metadata,
        "completedAt": _now_iso(),
    }


def _safe_name(material_id: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in material_id)


def _map_status(pulp_status: str) -> str:
    return {
        "optimal": "optimal",
        "infeasible": "infeasible",
        "unbounded": "unbounded",
        "undefined": "infeasible",
        "not solved": "timeout",
    }.get(pulp_status, "error")


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _empty_result(
    run_id: str,
    problem: Dict[str, Any],
    status: str,
    solver_metadata: Dict[str, Any],
    infeasibility: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "runId": run_id,
        "problemId": str(problem.get("id") or ""),
        "status": status,
        "formulaLines": [],
        "objectiveResults": [],
        "constraintResults": [],
        "warnings": [],
        "infeasibility": infeasibility,
        "solverMetadata": solver_metadata,
        "completedAt": _now_iso(),
    }


# ---------------------------------------------------------------------------
# Soft-constraint plumbing (spec §A2)
#
# A soft constraint is never silently dropped and never silently ignored: it
# becomes a *relaxed* version of the same constraint (via a non-negative
# slack/deviation variable) plus a penalty term added to the objective, so
# the solver only pays the slack when there is truly no better option. A hard
# constraint never gets a slack variable — it is exactly the same
# `prob.addConstraint(...)` call as before this module supported soft
# constraints at all, so hard behavior is provably unchanged.
# ---------------------------------------------------------------------------


def _require_penalty_weight(c: Dict[str, Any], cid: str) -> float:
    weight_raw = c.get("penaltyWeight")
    if weight_raw is None:
        raise OptimizerError(
            f"constraint '{cid}' has strictness=\"soft\" but no penaltyWeight — "
            f"a soft constraint must state how much its own violation costs"
        )
    weight = _num(weight_raw, "penaltyWeight")
    if weight < 0:
        raise OptimizerError(f"constraint '{cid}' has a negative penaltyWeight")
    return weight


def _apply_bound(
    prob,
    meta: List[Dict[str, Any]],
    penalty_terms: List[Tuple[Any, Dict[str, Any]]],
    cid: str,
    kind: str,
    expr,
    cmp: str,
    target: float,
    c: Dict[str, Any],
    scale: float,
    name_suffix: str = "",
) -> None:
    """Add `expr {cmp} target` (`cmp` in `">=" "<=" "=="`), hard or soft
    depending on `c["strictness"]`. Always appends exactly one
    `constraint_meta` entry (two for a soft two-sided bound only if the
    caller invokes this twice, e.g. `percentage_range`). `scale` normalizes
    the penalty contribution into roughly the same [0, ~1] magnitude the
    main weighted objectives already use — see docs/SOFT_CONSTRAINTS.md for
    the exact scale chosen per constraint kind and why it is a documented
    heuristic, not a claim of true cross-unit commensurability."""
    import pulp

    strictness = c.get("strictness", "hard")
    name = f"{kind}_{_safe_name(cid)}{name_suffix}"

    if strictness != "soft":
        if cmp == ">=":
            prob.addConstraint(expr >= target, name)
        elif cmp == "<=":
            prob.addConstraint(expr <= target, name)
        else:
            prob.addConstraint(expr == target, name)
        meta.append({"id": cid, "kind": kind, "strictness": "hard", "pulpName": name, "soft": False})
        return

    weight = _require_penalty_weight(c, cid)
    allowed = (
        _num(c["allowedDeviation"], "allowedDeviation") if c.get("allowedDeviation") not in (None, "") else 0.0
    )

    if cmp == ">=":
        slack = pulp.LpVariable(f"slack_{_safe_name(cid)}{name_suffix}_u", lowBound=0)
        prob.addConstraint(expr + slack >= target, name)
        penalty_vars = [slack]
    elif cmp == "<=":
        slack = pulp.LpVariable(f"slack_{_safe_name(cid)}{name_suffix}_o", lowBound=0)
        prob.addConstraint(expr - slack <= target, name)
        penalty_vars = [slack]
    else:  # "=="
        slack_u = pulp.LpVariable(f"slack_{_safe_name(cid)}{name_suffix}_u", lowBound=0)
        slack_o = pulp.LpVariable(f"slack_{_safe_name(cid)}{name_suffix}_o", lowBound=0)
        prob.addConstraint(expr + slack_u - slack_o == target, name)
        penalty_vars = [slack_u, slack_o]

    deviation_expr = pulp.lpSum(penalty_vars)
    penalty_terms.append((weight * deviation_expr / scale, {"constraintId": cid}))
    meta.append(
        {
            "id": cid,
            "kind": kind,
            "strictness": "soft",
            "pulpName": name,
            "soft": True,
            "target": target,
            "expr": expr,
            "penalty_vars": penalty_vars,
            "penalty_weight": weight,
            "allowed_deviation": allowed,
            "scale": scale,
        }
    )


# ---------------------------------------------------------------------------
# Composition constraints
# ---------------------------------------------------------------------------


def _material_side_sum(x, mat_ids: Sequence[str]):
    import pulp

    return pulp.lpSum(x[mid] for mid in mat_ids if mid in x)


def _weighted_field_expr(x, materials, field: str):
    """`sum(x_i * field_i / 100)` over materials whose `field` is known —
    the same "10% of a 70%-active material contributes 7%" arithmetic used
    for active matter, generalized to any per-material percentage field
    (`active_pct`, `solids_pct`, `water_pct`)."""
    import pulp

    return pulp.lpSum(
        x[m.id] * (getattr(m, field) / 100.0) for m in materials.values() if getattr(m, field) is not None
    )


def _add_composition_constraints(prob, x, materials, batch_kg, constraints, meta, penalty_terms):
    import pulp

    # Percentage-based constraints scale their penalty by batch_kg so a
    # deviation of X kg reads as a ~X/batch_kg fraction — roughly the same
    # [0, ~1] magnitude the main weighted objectives already use. See
    # docs/SOFT_CONSTRAINTS.md.
    scale = batch_kg

    for c in constraints:
        cid = c["id"]
        ctype = c["constraintType"]
        mid = c.get("materialId")

        if ctype == "exact_percentage" and mid:
            pct = _num(c["exactPercent"], "exactPercent")
            _apply_bound(prob, meta, penalty_terms, cid, "composition", x[mid], "==", batch_kg * pct / 100.0, c, scale)
        elif ctype == "min_percentage" and mid:
            pct = _num(c["minPercent"], "minPercent")
            _apply_bound(prob, meta, penalty_terms, cid, "composition", x[mid], ">=", batch_kg * pct / 100.0, c, scale)
        elif ctype == "max_percentage" and mid:
            pct = _num(c["maxPercent"], "maxPercent")
            _apply_bound(prob, meta, penalty_terms, cid, "composition", x[mid], "<=", batch_kg * pct / 100.0, c, scale)
        elif ctype == "percentage_range" and mid:
            lo = _num(c["minPercent"], "minPercent")
            hi = _num(c["maxPercent"], "maxPercent")
            _apply_bound(prob, meta, penalty_terms, cid, "composition", x[mid], ">=", batch_kg * lo / 100.0, c, scale, "_min")
            _apply_bound(prob, meta, penalty_terms, cid, "composition", x[mid], "<=", batch_kg * hi / 100.0, c, scale, "_max")
        elif ctype == "fixed_ingredient" and mid:
            pct = _num(c["exactPercent"], "exactPercent")
            _apply_bound(prob, meta, penalty_terms, cid, "composition", x[mid], "==", batch_kg * pct / 100.0, c, scale)
        elif ctype == "excluded_ingredient" and mid:
            # An excluded ingredient is always hard — "soft exclusion" would
            # mean the material can appear anyway for a price, which is not
            # what "excluded" means.
            prob.addConstraint(x[mid] == 0, f"composition_{_safe_name(cid)}")
            meta.append({"id": cid, "kind": "composition", "strictness": "hard", "pulpName": f"composition_{_safe_name(cid)}", "soft": False})
        elif ctype == "total_equals_100":
            # Always hard: a formula that does not total 100% is not a
            # formula, whatever penalty is attached.
            prob.addConstraint(pulp.lpSum(x.values()) == batch_kg, f"composition_{_safe_name(cid)}")
            meta.append({"id": cid, "kind": "composition", "strictness": "hard", "pulpName": f"composition_{_safe_name(cid)}", "soft": False})
        elif ctype == "water_qs":
            # The q.s. line is not a separate variable here — it is resolved
            # by `total_equals_100` plus every other constraint. This
            # constraint type exists in the schema for UI/round-trip parity
            # with the simple builder's q.s. concept; the solver enforces it
            # implicitly via the total constraint.
            continue
        elif ctype in ("min_phase_percentage", "max_phase_percentage"):
            # OptimizationMaterial does not carry a `phase` field (only the
            # Formula Builder's line-level FormulationLine does) — a phase
            # constraint has nothing to bind to at the solver level yet. See
            # docs/OPTIMIZATION_CONSTRAINTS.md's "not yet wired" note.
            continue
        elif ctype == "min_total_active_matter":
            pct = _num(c["minPercent"], "minPercent")
            expr = _weighted_field_expr(x, materials, "active_pct")
            _apply_bound(prob, meta, penalty_terms, cid, "composition", expr, ">=", batch_kg * pct / 100.0, c, scale)
        elif ctype == "max_total_active_matter":
            pct = _num(c["maxPercent"], "maxPercent")
            expr = _weighted_field_expr(x, materials, "active_pct")
            _apply_bound(prob, meta, penalty_terms, cid, "composition", expr, "<=", batch_kg * pct / 100.0, c, scale)
        elif ctype == "min_total_solids":
            pct = _num(c["minPercent"], "minPercent")
            expr = _weighted_field_expr(x, materials, "solids_pct")
            _apply_bound(prob, meta, penalty_terms, cid, "composition", expr, ">=", batch_kg * pct / 100.0, c, scale)
        elif ctype == "max_total_solids":
            pct = _num(c["maxPercent"], "maxPercent")
            expr = _weighted_field_expr(x, materials, "solids_pct")
            _apply_bound(prob, meta, penalty_terms, cid, "composition", expr, "<=", batch_kg * pct / 100.0, c, scale)
        elif ctype == "min_total_water":
            pct = _num(c["minPercent"], "minPercent")
            expr = _weighted_field_expr(x, materials, "water_pct")
            _apply_bound(prob, meta, penalty_terms, cid, "composition", expr, ">=", batch_kg * pct / 100.0, c, scale)
        elif ctype == "max_total_water":
            pct = _num(c["maxPercent"], "maxPercent")
            expr = _weighted_field_expr(x, materials, "water_pct")
            _apply_bound(prob, meta, penalty_terms, cid, "composition", expr, "<=", batch_kg * pct / 100.0, c, scale)


# ---------------------------------------------------------------------------
# Functional-group constraints
# ---------------------------------------------------------------------------


def _group_members(materials, function_groups: Sequence[str]) -> List[str]:
    groups = set(function_groups)
    return [m.id for m in materials.values() if groups.intersection(m.functions)]


def _group_expr(x, materials, member_ids: Sequence[str], basis: str):
    import pulp

    if basis == "active_matter":
        return pulp.lpSum(
            x[mid] * (materials[mid].active_pct / 100.0) for mid in member_ids if materials[mid].active_pct is not None
        )
    return pulp.lpSum(x[mid] for mid in member_ids)


def _add_functional_constraints(prob, x, materials, batch_kg, constraints, meta, penalty_terms):
    scale = batch_kg

    for c in constraints:
        cid = c["id"]
        basis = c.get("basis", "raw_material")
        members = _group_members(materials, c["functionGroups"])
        expr = _group_expr(x, materials, members, basis)
        ctype = c["constraintType"]

        if ctype == "min_total":
            pct = _num(c["value"], "value")
            _apply_bound(prob, meta, penalty_terms, cid, "functional", expr, ">=", batch_kg * pct / 100.0, c, scale)
        elif ctype == "max_total":
            pct = _num(c["value"], "value")
            _apply_bound(prob, meta, penalty_terms, cid, "functional", expr, "<=", batch_kg * pct / 100.0, c, scale)
        elif ctype == "at_least_one_present":
            # "present" needs a binary per member material to express an OR
            # over a strict >0 condition in an LP; approximated instead with
            # a trace-amount minimum, which is exact for the common case
            # (the group's members are otherwise unconstrained below trace)
            # and documented as such in docs/OPTIMIZATION_CONSTRAINTS.md.
            # Always hard — a soft "at least one present" would need its own
            # deviation semantics (how much is a fully-absent group worth?)
            # this constraint type does not define.
            trace_kg = batch_kg * DEFAULT_PRESENCE_THRESHOLD_PCT / 100.0
            name = f"functional_{_safe_name(cid)}"
            prob.addConstraint(expr >= trace_kg, name)
            meta.append({"id": cid, "kind": "functional", "strictness": "hard", "pulpName": name, "soft": False})


# ---------------------------------------------------------------------------
# Ratio constraints
# ---------------------------------------------------------------------------


def _ratio_side_members(materials, side: Dict[str, Any]) -> List[str]:
    if side.get("materialIds"):
        return [mid for mid in side["materialIds"] if mid in materials]
    if side.get("functionGroups"):
        return _group_members(materials, side["functionGroups"])
    return []


def _add_ratio_constraints(prob, x, materials, constraints, meta, penalty_terms):
    for c in constraints:
        cid = c["id"]
        num_members = _ratio_side_members(materials, c["numerator"])
        den_members = _ratio_side_members(materials, c["denominator"])
        num_expr = _group_expr(x, materials, num_members, c["numerator"].get("basis", "raw_material"))
        den_expr = _group_expr(x, materials, den_members, c["denominator"].get("basis", "raw_material"))
        ratio = _num(c["value"], "value")

        # numerator - ratio*denominator {>=,<=,==} 0 — safe when the
        # denominator side has no candidates (den_expr == 0): a min/max ratio
        # constraint against an absent denominator is then vacuously
        # satisfied (0 >= 0 / 0 <= 0) rather than a division-by-zero error;
        # an exact_ratio against an absent denominator forces the numerator
        # to 0 too, which is the mathematically correct reading of "exact
        # ratio" when one side cannot exist.
        expr = num_expr - ratio * den_expr
        # A ratio deviation has no natural "batch_kg" scale (it is
        # dimensionless), so it is normalized against its own target
        # magnitude instead — a heuristic, not exact cross-constraint
        # commensurability; see docs/SOFT_CONSTRAINTS.md.
        scale = max(abs(ratio), 1.0)
        cmp = {"min_ratio": ">=", "max_ratio": "<="}.get(c["ratioType"], "==")
        _apply_bound(prob, meta, penalty_terms, cid, "ratio", expr, cmp, 0.0, c, scale)


# ---------------------------------------------------------------------------
# Conditional constraints (mixed-integer)
# ---------------------------------------------------------------------------


def _side_members(materials, side: Dict[str, Any]) -> List[str]:
    if side.get("materialId"):
        return [side["materialId"]] if side["materialId"] in materials else []
    if side.get("functionGroup"):
        return _group_members(materials, [side["functionGroup"]])
    return []


def _add_conditional_constraints(prob, x, materials, batch_kg, constraints, meta, binary_vars, penalty_terms):
    import pulp

    big_m = batch_kg  # safe & tight: no combination of materials can exceed the batch.

    for c in constraints:
        cid = c["id"]
        strictness = c.get("strictness", "hard")
        trigger_ids = _side_members(materials, c["trigger"])
        target_ids = _side_members(materials, c["target"])
        trigger_expr = _material_side_sum(x, trigger_ids)
        target_expr = _material_side_sum(x, target_ids)
        y = pulp.LpVariable(f"y_{_safe_name(cid)}", cat="Binary")
        binary_vars[cid] = y

        ctype = c["conditionType"]
        name = f"conditional_{_safe_name(cid)}"

        if ctype == "if_present_then_excluded":
            # Always hard — this is the safety/compatibility exclusion
            # adapter (docs/OPTIMIZATION_CONSTRAINTS.md); a "soft exclusion"
            # would mean a blocking compatibility/safety pair can appear
            # anyway for a price, which defeats the point of excluding it.
            prob.addConstraint(trigger_expr <= big_m * y, f"{name}_trigger")
            prob.addConstraint(target_expr <= big_m * (1 - y), f"{name}_target")
            meta.append({"id": cid, "kind": "conditional", "strictness": "hard", "pulpName": name, "soft": False})
            continue

        if ctype == "if_present_then_required":
            presence_pct = float(c.get("presenceThresholdPercent", DEFAULT_PRESENCE_THRESHOLD_PCT))
            min_kg_const = batch_kg * presence_pct / 100.0
        elif ctype == "if_exceeds_then_min_required":
            threshold_pct = _num(c["triggerThresholdPercent"], "triggerThresholdPercent")
            min_pct = _num(c["targetMinPercent"], "targetMinPercent")
            threshold_kg = batch_kg * threshold_pct / 100.0
            eps = batch_kg * DEFAULT_PRESENCE_THRESHOLD_PCT / 100.0
            prob.addConstraint(trigger_expr - threshold_kg - eps <= big_m * y, f"{name}_trigger")
            min_kg_const = batch_kg * min_pct / 100.0
        else:
            continue

        if ctype == "if_present_then_required":
            prob.addConstraint(trigger_expr <= big_m * y, f"{name}_trigger")

        target_bound = min_kg_const * y  # linear: constant * binary variable.
        if strictness != "soft":
            prob.addConstraint(target_expr >= target_bound, f"{name}_target")
            meta.append({"id": cid, "kind": "conditional", "strictness": "hard", "pulpName": name, "soft": False})
            continue

        weight = _require_penalty_weight(c, cid)
        allowed = (
            _num(c["allowedDeviation"], "allowedDeviation") if c.get("allowedDeviation") not in (None, "") else 0.0
        )
        slack = pulp.LpVariable(f"slack_{_safe_name(cid)}_u", lowBound=0)
        prob.addConstraint(target_expr + slack >= target_bound, f"{name}_target")
        scale = batch_kg
        penalty_terms.append((weight * slack / scale, {"constraintId": cid}))
        meta.append(
            {
                "id": cid,
                "kind": "conditional",
                "strictness": "soft",
                "pulpName": name,
                "soft": True,
                # The target itself depends on the trigger binary `y`, only
                # known after solving — resolved in `_extract_constraint_results`.
                "target_const": min_kg_const,
                "target_binary": y,
                "expr": target_expr,
                "penalty_vars": [slack],
                "penalty_weight": weight,
                "allowed_deviation": allowed,
                "scale": scale,
            }
        )


# ---------------------------------------------------------------------------
# Property targets (spec §A3)
#
# Every property below is either a real, deterministic linear calculation
# over the chosen materials (`calculated`/`rule_based_estimate`) or is
# reported `laboratory_required` with no computed value at all — nothing
# here fabricates a precise number for pH, viscosity, foam, cleaning
# performance, stability, mildness or preservative efficacy. See
# docs/PROPERTY_TARGETS.md.
# ---------------------------------------------------------------------------

# Which functional group's active-matter total approximates a named active
# property. This is a real linear calculation (the same machinery functional
# constraints already use) standing in for a wet-chemistry titration result —
# documented in PROPERTY_METHODS below, never presented as a lab result.
_PROPERTY_FUNCTION_GROUP = {
    "available_chlorine": "bleaching_agent",
    "peroxide_active": "oxygen_donor",
    "qac_active": "qac_active",
    "chlorhexidine_active": "chlorhexidine_active",
    "fluoride_level": "fluoride_active",
}

# Fixed platform capability per property — the ceiling `classification` may
# reach for THIS property, regardless of what a PropertyTarget requests.
# Mirrors packages/shared/src/engine/optimization.ts's PROPERTY_CAPABILITY;
# kept in sync by hand like the rest of the TS/Python contract. `ph` is
# capped at `laboratory_required` here (stricter than that file's aspirational
# `rule_based_estimate` ceiling) because no pH-mixing rule is implemented —
# actual behavior may be more conservative than a stated ceiling, never less.
_PROPERTY_CAPABILITY = {
    "active_matter": "calculated",
    "total_solids": "calculated",
    "density": "rule_based_estimate",
    "hlb": "rule_based_estimate",
    "available_chlorine": "rule_based_estimate",
    "peroxide_active": "rule_based_estimate",
    "qac_active": "rule_based_estimate",
    "chlorhexidine_active": "rule_based_estimate",
    "fluoride_level": "rule_based_estimate",
    "ph": "laboratory_required",
    "viscosity": "laboratory_required",
    "foam_profile": "laboratory_required",
    "hard_water_tolerance": "laboratory_required",
    "wet_wipe_lotion_loading": "laboratory_required",
}

_PROPERTY_METHODS = {
    "active_matter": "sum(x_i * activeMatterPercent_i) over the batch",
    "total_solids": "sum(x_i * solidsPercent_i) over the batch",
    "density": "batch_kg / sum(x_i / density_i) — ideal-mixture weighted-volume approximation; ignores real mixing/excess-volume effects",
    "hlb": "sum(x_i * hlb_i) / sum(x_i) over materials carrying an HLB value",
    "available_chlorine": "active-matter total of materials functioning as bleaching_agent",
    "peroxide_active": "active-matter total of materials functioning as oxygen_donor",
    "qac_active": "active-matter total of materials functioning as qac_active",
    "chlorhexidine_active": "active-matter total of materials functioning as chlorhexidine_active",
    "fluoride_level": "active-matter total of materials functioning as fluoride_active",
}


def _property_expr(prop: str, x, materials, batch_kg):
    """Return (expr_or_None, kind) where `expr` is a PuLP linear expression
    for `prop`'s computed value (in the property's natural unit — percentage
    points for every property this function supports), or `None` when no
    calculation exists for this property at all."""
    if prop == "active_matter":
        return _weighted_field_expr(x, materials, "active_pct"), "linear"
    if prop == "total_solids":
        return _weighted_field_expr(x, materials, "solids_pct"), "linear"
    if prop in _PROPERTY_FUNCTION_GROUP:
        members = _group_members(materials, [_PROPERTY_FUNCTION_GROUP[prop]])
        if not members:
            return None, "linear"
        return _group_expr(x, materials, members, "active_matter"), "linear"
    # hlb and density are NOT linear in x (they are weighted averages, i.e.
    # ratios of two linear expressions) — they cannot be used as solver
    # CONSTRAINTS without a nonlinear or piecewise-linear reformulation this
    # module does not implement. They are still computed and REPORTED
    # post-solve from the optimal x (see _evaluate_property_targets), just
    # never enforced as hard/soft constraints.
    if prop in ("hlb", "density"):
        return None, "nonlinear"
    return None, "unsupported"


def _evaluate_property_targets(prob, x, materials, batch_kg, targets, meta, penalty_terms):
    """Add a constraint for every calculable `PropertyTarget` that requests
    enforcement, and return a `(target, expr_or_None, kind)` list the
    post-solve extraction pass turns into `PropertyResult`s. Never enforces
    (or claims a value for) a property whose `_PROPERTY_CAPABILITY` is
    `laboratory_required`."""
    evaluations = []
    for t in targets:
        prop = t["property"]
        capability = _PROPERTY_CAPABILITY.get(prop, "unknown")
        expr, kind = _property_expr(prop, x, materials, batch_kg)

        if capability == "laboratory_required" or expr is None and kind != "nonlinear":
            evaluations.append((t, None, capability, "unsupported" if expr is None and kind == "unsupported" else None))
            continue

        enforce_as = t.get("enforceAs")
        if enforce_as and kind == "linear":
            target_val = t.get("targetValue") or t.get("minValue") or t.get("maxValue")
            if t.get("minValue") is not None and t.get("maxValue") is not None:
                lo = batch_kg * _num(t["minValue"], "minValue") / 100.0
                hi = batch_kg * _num(t["maxValue"], "maxValue") / 100.0
                fake_c = {"strictness": enforce_as, "penaltyWeight": t.get("penaltyWeight"), "allowedDeviation": None}
                _apply_bound(prob, meta, penalty_terms, f"{t['id']}_min", "property", expr, ">=", lo, fake_c, batch_kg)
                _apply_bound(prob, meta, penalty_terms, f"{t['id']}_max", "property", expr, "<=", hi, fake_c, batch_kg)
            elif target_val is not None:
                target_kg = batch_kg * _num(target_val, "targetValue") / 100.0
                cmp = "==" if t.get("targetValue") is not None else (">=" if t.get("minValue") is not None else "<=")
                fake_c = {"strictness": enforce_as, "penaltyWeight": t.get("penaltyWeight"), "allowedDeviation": None}
                _apply_bound(prob, meta, penalty_terms, t["id"], "property", expr, cmp, target_kg, fake_c, batch_kg)

        evaluations.append((t, expr, capability, kind))
    return evaluations


def _extract_property_results(evaluations, materials, x, batch_kg, constraint_results) -> List[Dict[str, Any]]:
    import pulp

    solved_qty = {mid: (pulp.value(var) or 0.0) for mid, var in x.items()}
    satisfied_by_id = {r["constraintId"]: r["satisfied"] for r in constraint_results}

    results = []
    for t, expr, capability, unsupported_kind in evaluations:
        prop = t["property"]
        entry: Dict[str, Any] = {
            "targetId": t["id"],
            "property": prop,
            "targetValue": t.get("targetValue") or t.get("minValue") or t.get("maxValue"),
            "classification": capability,
            "laboratoryConfirmationRequired": capability != "calculated",
        }
        if capability == "laboratory_required" or unsupported_kind == "unsupported":
            entry["dataCompleteness"] = "insufficient"
            entry["constraintStatus"] = "unsupported"
            results.append(entry)
            continue

        if prop in ("hlb", "density"):
            value, completeness, method = _weighted_average_hlb_or_density(prop, materials, solved_qty)
        elif expr is not None:
            raw = pulp.value(expr)
            value = round(raw / batch_kg * 100.0, DP_PERCENT) if raw is not None else None
            # Complete when every candidate that actually ended up in the
            # solution (x_i > 0) has the data field this property reads;
            # a nonzero line missing it means the total is a lower bound.
            field = "active_pct" if prop == "active_matter" else ("solids_pct" if prop == "total_solids" else "active_pct")
            missing_in_solution = any(
                solved_qty.get(mid, 0.0) > 1e-6 and getattr(m, field) is None for mid, m in materials.items()
            )
            completeness = "partial" if missing_in_solution else "complete"
            method = _PROPERTY_METHODS.get(prop)
        else:
            value, completeness, method = None, "insufficient", None

        entry["value"] = _round(value, DP_PERCENT) if value is not None else None
        entry["method"] = method
        entry["dataCompleteness"] = completeness
        if value is None:
            entry["constraintStatus"] = "unsupported"
        elif t.get("enforceAs") == "hard":
            entry["constraintStatus"] = "enforced_hard"
        elif t.get("enforceAs") == "soft":
            # The soft constraint(s) actually added were named `t["id"]`
            # (single-sided) or `{t["id"]}_min`/`{t["id"]}_max` (a range) —
            # see _evaluate_property_targets. Violated if either is.
            ids = [t["id"], f"{t['id']}_min", f"{t['id']}_max"]
            violated = any(satisfied_by_id.get(i) is False for i in ids)
            entry["constraintStatus"] = "enforced_soft_violated" if violated else "enforced_soft_satisfied"
        else:
            entry["constraintStatus"] = "reported_only"
        results.append(entry)
    return results


def _weighted_average_hlb_or_density(prop: str, materials, solved_qty: Dict[str, float]):
    """hlb and density are weighted AVERAGES (ratios), not sums — computed
    post-solve from the optimal quantities directly, never as a solver
    constraint (see `_property_expr`'s nonlinear note)."""
    field = "hlb" if prop == "hlb" else "density"
    total_kg = 0.0
    weighted = 0.0
    volume_l = 0.0
    any_missing = False
    for mid, m in materials.items():
        qty = solved_qty.get(mid, 0.0)
        if qty <= 1e-6:
            continue
        total_kg += qty
        value = getattr(m, field)
        if value is None or value <= 0:
            any_missing = True
            continue
        if prop == "hlb":
            weighted += qty * value
        else:
            volume_l += qty / value
    if total_kg <= 1e-9:
        return None, "insufficient", None
    if prop == "hlb":
        if weighted <= 0:
            return None, "insufficient", _PROPERTY_METHODS["hlb"]
        value = weighted / total_kg
        return round(value, DP_PERCENT), ("partial" if any_missing else "complete"), _PROPERTY_METHODS["hlb"]
    if volume_l <= 1e-9:
        return None, "insufficient", _PROPERTY_METHODS["density"]
    value = total_kg / volume_l
    return round(value, DP_PERCENT), ("partial" if any_missing else "complete"), _PROPERTY_METHODS["density"]


# ---------------------------------------------------------------------------
# Objectives
# ---------------------------------------------------------------------------


def _metric_unit_value(m: Material, metric: str) -> Optional[float]:
    """Per-kg contribution of material `m` to `metric`, or None if unknown."""
    if metric in ("raw_material_cost", "landed_cost", "total_factory_cost"):
        return m.price
    if metric == "supply_risk":
        return m.supply_risk
    if metric == "carbon_score":
        return m.carbon_score
    if metric == "evidence_confidence":
        return m.evidence_confidence
    if metric == "compatibility_risk":
        # Real, findings-derived score (0..1) computed by the caller from
        # the actual compatibility engine — see Material.__init__. A
        # material the caller never scored (e.g. no other candidate paired
        # with it produced a finding) is None, not silently 0-risk; a
        # missing score contributes nothing to this objective, same
        # treatment as a missing price contributes nothing to a cost
        # objective. Blocking findings never reach here — those already
        # became a hard exclusion (`compatibilityPolicy: "exclude_blocking"`).
        return m.compat_risk
    if metric == "safety_risk":
        return m.safety_risk
    return None


def _build_objective_terms(
    x, materials, batch_kg, objectives: Sequence[Dict[str, Any]]
) -> Tuple[List[Tuple[Any, Dict[str, Any]]], List[Dict[str, Any]], Dict[str, Tuple[float, float]]]:
    import pulp

    if not objectives:
        raise OptimizerError("at least one objective is required")

    terms: List[Tuple[Any, Dict[str, Any]]] = []
    meta: List[Dict[str, Any]] = []
    norm_bounds: Dict[str, Tuple[float, float]] = {}

    for obj in objectives:
        metric = obj["metric"]
        direction = obj["direction"]
        if metric in ("performance_score", "regulatory_uncertainty"):
            raise OptimizerError(
                f"objective metric '{metric}' has no validated computation in this platform "
                f"(no predictive performance model; the Regulatory Engine is not implemented) "
                f"— see docs/MULTI_OBJECTIVE_OPTIMIZATION.md"
            )
        if metric not in SUPPORTED_METRICS:
            raise OptimizerError(f"unknown objective metric: {metric}")

        unit_values = {mid: _metric_unit_value(m, metric) for mid, m in materials.items()}
        known = {mid: v for mid, v in unit_values.items() if v is not None}
        if metric == "stock_utilization":
            raw_expr = pulp.lpSum(x.values())
            min_bound, max_bound = 0.0, batch_kg
        else:
            if not known:
                raise OptimizerError(f"no candidate material has data for objective metric '{metric}'")
            raw_expr = pulp.lpSum(x[mid] * known[mid] for mid in known)
            min_unit, max_unit = min(known.values()), max(known.values())
            min_bound = batch_kg * min(0.0, min_unit) if min_unit < 0 else 0.0
            max_bound = batch_kg * max_unit
            if min_bound == max_bound:
                max_bound = min_bound + 1.0  # degenerate range guard (every candidate identical).

        norm_bounds[metric] = (min_bound, max_bound)
        span = max_bound - min_bound or 1.0
        if direction == "minimize":
            normalized = (raw_expr - min_bound) / span
        else:
            normalized = (max_bound - raw_expr) / span

        weight = obj.get("weight")
        priority = obj.get("priority")
        w = float(weight) if weight is not None else 1.0
        terms.append((w * normalized, {"metric": metric, "direction": direction, "weight": weight, "priority": priority}))
        meta.append({"metric": metric, "direction": direction, "weight": weight, "priority": priority, "raw_expr": raw_expr})

    return terms, meta, norm_bounds


def _add_cost_ceiling_constraint(prob, x, materials, meta, penalty_terms, cost_ceiling: Dict[str, Any]) -> None:
    """A global raw-material-cost budget is always soft (see the field's own
    docstring in formulationProblemSchema) — an `over_target` penalty on
    total raw-material cost, never a hard cap. Silently skipped (not an
    error) when no candidate has a price at all, since there is then nothing
    to constrain and no honest "requested vs achieved" to report."""
    import pulp

    priced = {mid: m.price for mid, m in materials.items() if m.price is not None}
    if not priced:
        return
    expr = pulp.lpSum(x[mid] * priced[mid] for mid in priced)
    value = _num(cost_ceiling["value"], "costCeiling.value")
    fake_c = {"strictness": "soft", "penaltyWeight": cost_ceiling["penaltyWeight"], "allowedDeviation": None}
    scale = max(value, 1.0)
    _apply_bound(prob, meta, penalty_terms, "cost_ceiling", "cost", expr, "<=", value, fake_c, scale)


def _solve_lexicographic(prob, terms, meta, timeout, penalty_terms=None):
    import pulp

    solved = prob

    if penalty_terms:
        # Minimize total soft-constraint violation BEFORE any user objective
        # preference — a soft constraint should only relax when the hard
        # constraints truly leave no better option, never traded away for a
        # marginally better cost/risk score. See docs/SOFT_CONSTRAINTS.md.
        penalty_expr = pulp.lpSum(t for t, _ in penalty_terms)
        solved += penalty_expr, "lex_tier_penalties"
        status_code = solved.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=timeout))
        status = pulp.LpStatus[status_code].lower()
        if status != "optimal":
            return status, solved
        optimal_penalty = pulp.value(penalty_expr)
        solved += penalty_expr <= optimal_penalty + 1e-6, "lex_tier_penalties_freeze"
        solved.objective = None

    tiers: Dict[int, List[int]] = {}
    for i, m in enumerate(meta):
        tiers.setdefault(int(m.get("priority") or 0), []).append(i)

    for tier in sorted(tiers.keys()):
        indices = tiers[tier]
        expr = pulp.lpSum(terms[i][0] for i in indices)
        solved += expr, f"lex_tier_{tier}"
        status_code = solved.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=timeout))
        status = pulp.LpStatus[status_code].lower()
        if status != "optimal":
            return status, solved
        optimal_value = pulp.value(expr)
        # Freeze this tier at its optimum (within a small tolerance in the
        # already-normalized [0,1] objective space) before moving on, then
        # remove the tier's own objective row so the NEXT tier's `+=`
        # becomes the active objective rather than an additional constraint.
        solved += expr <= optimal_value + 1e-6, f"lex_tier_{tier}_freeze"
        solved.objective = None
    return "optimal", solved


def _extract_objective_results(terms, meta, norm_bounds, strategy) -> List[Dict[str, Any]]:
    import pulp

    results = []
    for (_, term_meta), m in zip(terms, meta):
        metric = m["metric"]
        raw_value = pulp.value(m["raw_expr"])
        min_b, max_b = norm_bounds.get(metric, (0.0, 1.0))
        span = (max_b - min_b) or 1.0
        normalized = (raw_value - min_b) / span if m["direction"] == "minimize" else (max_b - raw_value) / span
        entry = {
            "metric": metric,
            "direction": m["direction"],
            "rawValue": _round(raw_value, DP_MONEY),
            "normalizedValue": _round(max(0.0, min(1.0, normalized)), 6),
        }
        if m.get("weight") is not None:
            entry["weight"] = str(m["weight"])
            entry["contribution"] = _round(float(m["weight"]) * normalized, 6)
        if m.get("priority") is not None:
            entry["priority"] = int(m["priority"])
        results.append(entry)
    return results


# ---------------------------------------------------------------------------
# Result extraction
# ---------------------------------------------------------------------------


def _round(value: float, dp: int) -> str:
    return f"{round(value, dp):.{dp}f}"


def _extract_lines(x, materials, batch_kg) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    import pulp

    lines = []
    total_kg = 0.0
    total_active_kg = 0.0
    total_cost = 0.0
    have_cost = True
    for mid in sorted(x.keys()):
        qty = pulp.value(x[mid]) or 0.0
        if qty < 1e-6:
            continue
        m = materials[mid]
        pct = qty / batch_kg * 100.0
        active_contrib_pct = (qty * (m.active_pct / 100.0) / batch_kg * 100.0) if m.active_pct is not None else 0.0
        total_kg += qty
        total_active_kg += qty * (m.active_pct / 100.0 if m.active_pct is not None else 0.0)
        line: Dict[str, Any] = {
            "materialId": mid,
            "materialCode": m.code,
            "name": m.name,
            "percent": _round(pct, DP_PERCENT),
            "activeContributionPercent": _round(active_contrib_pct, DP_PERCENT),
            "quantityKg": _round(qty, DP_QUANTITY),
        }
        if m.price is not None:
            cost = qty * m.price
            total_cost += cost
            line["rawMaterialCost"] = _round(cost, 2)
        else:
            have_cost = False
        lines.append(line)

    totals = {
        "batchKg": _round(batch_kg, DP_QUANTITY),
        "totalPercent": _round(total_kg / batch_kg * 100.0, DP_PERCENT),
        "totalActiveMatterPercent": _round(total_active_kg / batch_kg * 100.0, DP_PERCENT),
    }
    if have_cost:
        totals["totalRawMaterialCost"] = _round(total_cost, 2)
    return lines, totals


def _extract_constraint_results(meta, batch_kg: float) -> List[Dict[str, Any]]:
    import pulp

    results = []
    for entry in meta:
        base: Dict[str, Any] = {
            "constraintId": entry["id"],
            "kind": entry["kind"],
            "strictness": entry["strictness"],
        }
        if not entry.get("soft"):
            base["satisfied"] = True  # the solve only returns for a feasible/optimal status.
            results.append(base)
            continue

        deviation = sum(pulp.value(pv) or 0.0 for pv in entry["penalty_vars"])
        allowed = entry.get("allowed_deviation") or 0.0
        # CBC's own LP tolerance leaves a residual on the order of
        # scale * 1e-6 even for a constraint that is, in the reportable
        # sense, exactly met (e.g. 39.9999% instead of 40.0000%) — a fixed
        # 1e-6 epsilon flags that residual as a genuine violation. Scale the
        # tolerance to the constraint's own magnitude instead, ten times
        # looser than solver noise and still two orders of magnitude tighter
        # than the 4dp reporting precision.
        tolerance = max(1e-6, entry.get("scale", 1.0) * 1e-5)
        satisfied = deviation <= allowed + tolerance

        if "target_binary" in entry:
            # if_present_then_required / if_exceeds_then_min_required: the
            # target is `min_kg_const * y`, only knowable post-solve.
            target_val = entry["target_const"] * (pulp.value(entry["target_binary"]) or 0.0)
        else:
            target_val = entry["target"]
        achieved_val = pulp.value(entry["expr"])

        if entry["kind"] == "ratio":
            # `target`/`expr` here live in the internal residual space
            # (numerator - ratio*denominator, target 0) rather than a
            # directly comparable ratio number — see docs/SOFT_CONSTRAINTS.md.
            # The deviation and penalty are what is operationally meaningful.
            requested = _round(target_val, 6) if target_val is not None else None
            achieved = _round(achieved_val, 6) if achieved_val is not None else None
            dp = 6
        elif entry["kind"] == "cost":
            requested = _round(target_val, DP_MONEY) if target_val is not None else None
            achieved = _round(achieved_val, DP_MONEY) if achieved_val is not None else None
            dp = DP_MONEY
        else:
            requested = _round(target_val / batch_kg * 100.0, DP_PERCENT) if target_val is not None and batch_kg else None
            achieved = _round(achieved_val / batch_kg * 100.0, DP_PERCENT) if achieved_val is not None and batch_kg else None
            dp = DP_PERCENT

        true_deviation = abs(achieved_val - target_val) if (achieved_val is not None and target_val is not None) else deviation
        true_deviation_scaled = true_deviation / batch_kg * 100.0 if entry["kind"] not in ("ratio", "cost") and batch_kg else true_deviation
        penalty_value = entry["penalty_weight"] * deviation / entry["scale"]

        base.update(
            {
                "satisfied": satisfied,
                "requestedTarget": requested,
                "achievedValue": achieved,
                "deviation": _round(true_deviation_scaled, dp),
                "penaltyApplied": _round(penalty_value, 6),
            }
        )
        results.append(base)
    return results


def _build_warnings(materials, problem, constraint_results: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    warnings = []
    violated_soft = [r for r in (constraint_results or []) if r["strictness"] == "soft" and not r["satisfied"]]
    if violated_soft:
        warnings.append(
            {
                "code": "soft_penalties_exceed_tolerance",
                "severity": "warning",
                "message": (
                    f"{len(violated_soft)} soft constraint(s) could not be met within their configured "
                    f"allowedDeviation and were relaxed: {', '.join(r['constraintId'] for r in violated_soft[:10])}. "
                    f"See each one's own constraintResults entry for its requested target, achieved value and "
                    f"deviation."
                ),
                "materialIds": [],
            }
        )
    unpriced = [m.code for m in materials.values() if m.price is None and not m.excluded]
    if unpriced:
        warnings.append(
            {
                "code": "materials_missing_price",
                "severity": "warning",
                "message": f"{len(unpriced)} candidate material(s) have no recorded price and were excluded from any cost objective: {', '.join(unpriced[:10])}",
                "materialIds": unpriced,
            }
        )
    no_active = [m.code for m in materials.values() if m.active_pct is None and not m.excluded]
    if no_active:
        warnings.append(
            {
                "code": "materials_missing_active_matter",
                "severity": "warning",
                "message": f"{len(no_active)} candidate material(s) have no recorded active-matter percentage; they contribute 0 to every active-matter total: {', '.join(no_active[:10])}",
                "materialIds": no_active,
            }
        )
    return warnings


def _sensitivity_report(solved_prob, is_mixed_integer: bool) -> Dict[str, Any]:
    if is_mixed_integer:
        return {
            "available": False,
            "unavailableReason": "The solved model included at least one binary indicator variable (from a conditional constraint), so it was a mixed-integer program — CBC's dual values are not meaningful for a MIP and are not reported.",
        }
    shadow_prices = []
    try:
        for name, constraint in solved_prob.constraints.items():
            pi = getattr(constraint, "pi", None)
            if pi is not None and abs(pi) > 1e-9:
                shadow_prices.append({"constraintId": name, "shadowPrice": _round(pi, 6)})
    except Exception:  # pragma: no cover - defensive; CBC always sets .pi for a pure LP.
        return {"available": False, "unavailableReason": "Solver did not report dual values for this model."}
    return {"available": True, "shadowPrices": shadow_prices}


# ---------------------------------------------------------------------------
# Infeasibility analysis
# ---------------------------------------------------------------------------


def _pinned_kg(mid: str, batch_kg: float, materials, problem) -> Optional[float]:
    """The exact kg a material is pinned to by a hard `exact_percentage`/
    `fixed_ingredient` composition constraint or a `lockedPercent`, or
    `None` if it is free to vary — used only for the deterministic
    pre-solve ratio-conflict check below, never as a general
    constraint-propagation engine."""
    m = materials.get(mid)
    if m is not None and m.locked_percent is not None:
        return batch_kg * m.locked_percent / 100.0
    for c in problem.get("compositionConstraints") or []:
        if c.get("materialId") != mid or c.get("strictness", "hard") != "hard":
            continue
        if c["constraintType"] in ("exact_percentage", "fixed_ingredient") and c.get("exactPercent") is not None:
            return batch_kg * float(c["exactPercent"]) / 100.0
    return None


def _diagnose_ratio_conflicts(materials, batch_kg, problem) -> List[Dict[str, Any]]:
    """Deterministic-only: a ratio conflict is reported exclusively when it
    can be PROVEN from data the solver did not need to search for — every
    material on both sides of the ratio is pinned to an exact kg by a hard
    fixed/exact-percentage constraint (or a lock), so the achieved ratio is
    a fact, not a guess. A ratio constraint that depends on any free-to-vary
    material is left to the honest generic fallback instead."""
    causes: List[Dict[str, Any]] = []
    for c in problem.get("ratioConstraints") or []:
        if c.get("strictness", "hard") != "hard":
            continue
        num_members = _ratio_side_members(materials, c["numerator"])
        den_members = _ratio_side_members(materials, c["denominator"])
        ratio = _num(c["value"], "value")
        ratio_type = c["ratioType"]

        # min_ratio (num >= ratio*den) with den forced to 0 collapses to
        # num >= 0, always true — never infeasible on its own (see the
        # solver's own comment in _add_ratio_constraints). Only exact_ratio
        # (num == ratio*den) forces the numerator to 0 too, which IS a real
        # conflict when the numerator is pinned away from 0.
        if num_members and not den_members and ratio_type == "exact_ratio" and ratio > 0:
            num_pinned = [_pinned_kg(mid, batch_kg, materials, problem) for mid in num_members]
            if all(v is not None for v in num_pinned) and sum(v or 0.0 for v in num_pinned) > 1e-9:
                causes.append(
                    {
                        "code": "ratio_division_by_zero",
                        "constraintIds": [c["id"]],
                        "materialIds": num_members,
                        "message": (
                            f"Ratio constraint \"{c['displayName']}\" has no candidate material on its "
                            f"denominator side, so the denominator is always 0, but its pinned numerator "
                            f"materials sum to {sum(v or 0.0 for v in num_pinned):.4f} kg — a positive "
                            f"{ratio_type} target against an always-zero denominator cannot be satisfied "
                            f"unless the numerator is 0 too."
                        ),
                        "suggestedActions": [
                            "Add a candidate material to the denominator side.",
                            "Remove or relax this ratio constraint.",
                        ],
                    }
                )
            continue

        num_pinned = [_pinned_kg(mid, batch_kg, materials, problem) for mid in num_members]
        den_pinned = [_pinned_kg(mid, batch_kg, materials, problem) for mid in den_members]
        if (
            num_members
            and den_members
            and all(v is not None for v in num_pinned)
            and all(v is not None for v in den_pinned)
        ):
            num_val = sum(v or 0.0 for v in num_pinned)
            den_val = sum(v or 0.0 for v in den_pinned)
            if den_val <= 1e-9:
                continue  # covered by the division-by-zero branch above for the ratio types that can prove it.
            actual_ratio = num_val / den_val
            violated = (
                (ratio_type == "min_ratio" and actual_ratio < ratio - 1e-9)
                or (ratio_type == "max_ratio" and actual_ratio > ratio + 1e-9)
                or (ratio_type == "exact_ratio" and abs(actual_ratio - ratio) > 1e-9)
            )
            if violated:
                code = "ratio_maximum_conflict" if ratio_type == "max_ratio" else "ratio_minimum_conflict"
                causes.append(
                    {
                        "code": code,
                        "constraintIds": [c["id"]],
                        "materialIds": num_members + den_members,
                        "message": (
                            f"Every material on both sides of ratio constraint \"{c['displayName']}\" is "
                            f"pinned by a hard fixed/exact percentage or lock; the resulting ratio is "
                            f"{actual_ratio:.4f}, which does not satisfy {ratio_type} {ratio}."
                        ),
                        "calculatedLimit": _round(actual_ratio, 4),
                        "requestedLimit": str(ratio),
                        "suggestedActions": [
                            "Relax one of the fixed/exact percentages pinning this ratio's materials.",
                            "Relax the ratio constraint.",
                        ],
                    }
                )
    return causes


def _diagnose_property_target_conflicts(materials, batch_kg, problem) -> List[Dict[str, Any]]:
    """Only for a property target enforced `hard` with a real linear
    expression (active_matter, total_solids, or one of the named actives) —
    hlb/density are non-linear and never enforced as constraints, and a
    `laboratory_required` property was never turned into one at all (see
    `_evaluate_property_targets`)."""
    causes: List[Dict[str, Any]] = []
    for t in problem.get("propertyTargets") or []:
        if t.get("enforceAs") != "hard":
            continue
        prop = t["property"]
        if _PROPERTY_CAPABILITY.get(prop) == "laboratory_required":
            continue
        min_val = t.get("minValue") or t.get("targetValue")
        if min_val is None:
            continue

        if prop == "active_matter":
            field = "active_pct"
        elif prop == "total_solids":
            field = "solids_pct"
        elif prop in _PROPERTY_FUNCTION_GROUP:
            members = _group_members(materials, [_PROPERTY_FUNCTION_GROUP[prop]])
            max_reachable = sum(materials[mid].cap_kg for mid in members) / batch_kg * 100.0 if members else 0.0
            if max_reachable < _num(min_val, "minValue") - 1e-6:
                causes.append(
                    {
                        "code": "property_target_unreachable",
                        "constraintIds": [t["id"]],
                        "materialIds": members,
                        "message": (
                            f"Even at maximum usage, the candidate materials contributing to \"{prop}\" can "
                            f"only reach {max_reachable:.2f}%, below the required {min_val}%."
                        ),
                        "calculatedLimit": _round(max_reachable, DP_PERCENT),
                        "requestedLimit": str(min_val),
                        "suggestedActions": [
                            "Add another candidate material carrying this active.",
                            "Relax the property target.",
                        ],
                    }
                )
            continue
        else:
            continue

        contributing = [m for m in materials.values() if getattr(m, field) is not None]
        max_reachable = (
            sum(m.cap_kg * (getattr(m, field) / 100.0) for m in contributing) / batch_kg * 100.0
            if contributing
            else 0.0
        )
        if max_reachable < _num(min_val, "minValue") - 1e-6:
            causes.append(
                {
                    "code": "property_target_unreachable",
                    "constraintIds": [t["id"]],
                    "materialIds": [m.id for m in contributing],
                    "message": (
                        f"Even at maximum usage, the candidate materials with a recorded value can only "
                        f"reach {max_reachable:.2f}% {prop}, below the required {min_val}%."
                    ),
                    "calculatedLimit": _round(max_reachable, DP_PERCENT),
                    "requestedLimit": str(min_val),
                    "suggestedActions": [
                        "Add another candidate material with this property recorded.",
                        "Relax the property target.",
                        "Record the missing property value on an existing candidate.",
                    ],
                }
            )
    return causes


def _diagnose_exclusion_lockout(materials, batch_kg, problem) -> List[Dict[str, Any]]:
    """A hard `if_present_then_excluded` conditional constraint is how both
    the compatibility and safety `exclude_blocking` policies reach the
    solver — the optimizer consumes them identically and, by design, keeps
    no record of which engine produced which pair (so it never re-implements
    either engine's rules). When exclusions leave no way to combine any two
    candidates to reach the batch size, this is reported as a single,
    honestly-unattributed cause rather than guessing compatibility vs safety."""
    exclusion_pairs: List[Tuple[str, str]] = []
    exclusion_ids: List[str] = []
    for c in problem.get("conditionalConstraints") or []:
        if c.get("conditionType") == "if_present_then_excluded" and c.get("strictness", "hard") == "hard":
            trig = c["trigger"].get("materialId")
            targ = c["target"].get("materialId")
            if trig and targ and trig in materials and targ in materials:
                exclusion_pairs.append((trig, targ))
                exclusion_ids.append(c["id"])
    if not exclusion_pairs:
        return []

    excluded_ids = {mid for pair in exclusion_pairs for mid in pair}
    if excluded_ids != set(materials.keys()):
        return []  # some candidate is untouched by any exclusion — not the whole-pool lockout this checks for.

    excluded_set = {frozenset(p) for p in exclusion_pairs}
    all_pairs = {frozenset((a, b)) for a in materials for b in materials if a < b}
    if excluded_set != all_pairs:
        return []  # not every pair is mutually exclusive — some valid multi-material combination may still exist.

    if any(m.cap_kg >= batch_kg - 1e-6 for m in materials.values()):
        return []  # one candidate alone can still fill the whole batch on its own.

    return [
        {
            "code": "compatibility_or_safety_exclusions_remove_all_candidates",
            "constraintIds": exclusion_ids,
            "materialIds": sorted(excluded_ids),
            "message": (
                "Every candidate material mutually excludes every other candidate (a hard compatibility "
                "and/or safety finding), and no single candidate's usage cap alone can fill the batch — no "
                "combination of the candidate pool can reach the target batch size."
            ),
            "suggestedActions": [
                "Add a candidate material that does not conflict with the rest of the pool.",
                "Raise the usage cap on a candidate that can be used alone.",
                "Review the compatibility/safety findings driving these exclusions.",
            ],
        }
    ]


def _diagnose_infeasibility(materials, batch_kg, problem) -> Dict[str, Any]:
    causes: List[Dict[str, Any]] = []

    max_fillable = sum(m.cap_kg for m in materials.values())
    if max_fillable < batch_kg - 1e-6:
        causes.append(
            {
                "code": "insufficient_stock_or_usage_cap",
                "constraintIds": [],
                "materialIds": [m.id for m in materials.values()],
                "message": f"Stock and max-usage limits across all candidate materials cap the batch at {max_fillable:.2f} kg, below the {batch_kg:.2f} kg target.",
                "calculatedLimit": _round(max_fillable, DP_QUANTITY),
                "requestedLimit": _round(batch_kg, DP_QUANTITY),
                "suggestedActions": [
                    "Increase available stock on one or more candidate materials.",
                    "Relax a maximum-usage or technical-maximum limit.",
                    "Add another candidate material to the run.",
                ],
            }
        )

    fixed_total_pct = 0.0
    for c in problem.get("compositionConstraints") or []:
        if c["constraintType"] in ("exact_percentage", "fixed_ingredient") and c.get("exactPercent"):
            fixed_total_pct += float(c["exactPercent"])
    if fixed_total_pct > 100.0 + 1e-9:
        causes.append(
            {
                "code": "fixed_ingredients_exceed_batch",
                "constraintIds": [c["id"] for c in (problem.get("compositionConstraints") or []) if c["constraintType"] in ("exact_percentage", "fixed_ingredient")],
                "materialIds": [],
                "message": f"Fixed/exact-percentage ingredients alone total {fixed_total_pct:.2f}%, over 100%.",
                "calculatedLimit": _round(fixed_total_pct, DP_PERCENT),
                "requestedLimit": "100.0000",
                "suggestedActions": ["Reduce one or more fixed ingredient percentages."],
            }
        )

    for c in problem.get("functionalConstraints") or []:
        if c["constraintType"] != "min_total":
            continue
        members = _group_members(materials, c["functionGroups"])
        if not members:
            causes.append(
                {
                    "code": "functional_minimum_unreachable",
                    "constraintIds": [c["id"]],
                    "materialIds": [],
                    "message": f"No candidate material carries any of the required function group(s) for constraint \"{c['displayName']}\".",
                    "suggestedActions": [
                        f"Add a candidate material with one of the function group(s): {', '.join(c['functionGroups'])}.",
                    ],
                }
            )
            continue
        max_reachable = sum(materials[mid].cap_kg for mid in members)
        required = batch_kg * float(c["value"]) / 100.0
        if max_reachable < required - 1e-6:
            causes.append(
                {
                    "code": "functional_minimum_unreachable",
                    "constraintIds": [c["id"]],
                    "materialIds": members,
                    "message": f"Even at maximum usage, the candidate materials in \"{c['displayName']}\" can only reach {max_reachable / batch_kg * 100:.2f}%, below the required {c['value']}%.",
                    "calculatedLimit": _round(max_reachable / batch_kg * 100, DP_PERCENT),
                    "requestedLimit": str(c["value"]),
                    "suggestedActions": [
                        "Add another candidate material in this function group.",
                        "Relax the functional minimum.",
                        "Raise a technical/regulatory maximum on an existing candidate.",
                    ],
                }
            )

    for c in problem.get("conditionalConstraints") or []:
        ctype = c["conditionType"]
        if ctype not in ("if_present_then_required", "if_exceeds_then_min_required"):
            continue
        if c.get("strictness", "hard") != "hard":
            continue  # a soft conditional target always has a slack — it cannot be the infeasibility cause.
        target_members = _side_members(materials, c["target"])
        if target_members:
            continue
        if ctype == "if_present_then_required":
            causes.append(
                {
                    "code": "required_coingredient_unavailable",
                    "constraintIds": [c["id"]],
                    "materialIds": [],
                    "message": f"Constraint \"{c['displayName']}\" requires a co-ingredient that no candidate material satisfies.",
                    "suggestedActions": ["Add a candidate material matching the required co-ingredient, or remove/relax this constraint."],
                }
            )
        else:
            causes.append(
                {
                    "code": "conditional_coingredient_unavailable",
                    "constraintIds": [c["id"]],
                    "materialIds": [],
                    "message": f"Constraint \"{c['displayName']}\" requires a co-ingredient above a threshold that no candidate material satisfies.",
                    "suggestedActions": ["Add a candidate material matching the required co-ingredient, or remove/relax this constraint."],
                }
            )

    causes.extend(_diagnose_ratio_conflicts(materials, batch_kg, problem))
    causes.extend(_diagnose_property_target_conflicts(materials, batch_kg, problem))
    causes.extend(_diagnose_exclusion_lockout(materials, batch_kg, problem))

    if not causes:
        causes.append(
            {
                "code": "no_combination_satisfies_all_constraints",
                "constraintIds": [],
                "materialIds": [],
                "message": "No combination of the candidate materials satisfies every constraint at once; the individual conflict could not be isolated by the deterministic pre-checks.",
                "suggestedActions": [
                    "Review composition, functional, ratio and conditional constraints for a conflict.",
                    "Try relaxing one constraint at a time to isolate the conflict.",
                ],
            }
        )

    return {"causes": causes}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _selfcheck() -> int:
    try:
        import pulp  # noqa: F401
    except Exception as exc:  # pragma: no cover - env-dependent
        print(json.dumps({"ok": False, "reason": f"pulp unavailable: {exc}"}))
        return 0
    demo = {
        "id": "demo",
        "materials": [
            {"id": "a", "materialCode": "A", "name": "A", "price": {"value": "2.0", "state": "known"}, "activeMatterPercent": {"value": "80", "state": "known"}, "stock": {"value": "100", "state": "known"}},
            {"id": "b", "materialCode": "B", "name": "B", "price": {"value": "1.0", "state": "known"}, "activeMatterPercent": {"value": "20", "state": "known"}, "stock": {"value": "100", "state": "known"}},
        ],
        "batch": {"sizeKg": 100},
        "compositionConstraints": [
            {"id": "total", "displayName": "Total", "constraintType": "total_equals_100", "strictness": "hard"},
            {"id": "min_active", "displayName": "Min active", "constraintType": "min_total_active_matter", "minPercent": "50", "strictness": "hard"},
        ],
        "objectiveConfig": {"type": "weighted", "objectives": [{"metric": "raw_material_cost", "direction": "minimize", "weight": "1"}]},
    }
    result = solve(demo)
    print(json.dumps({"ok": result["status"] == "optimal", "result": result}))
    return 0


def main(argv: List[str]) -> int:
    if "--selfcheck" in argv:
        return _selfcheck()

    raw = sys.stdin.read()
    try:
        problem = json.loads(raw)
    except json.JSONDecodeError as exc:
        json.dump({"status": "error", "message": f"invalid JSON input: {exc}"}, sys.stdout)
        return 1

    try:
        result = solve(problem)
    except OptimizerError as exc:
        json.dump({"status": "error", "message": str(exc)}, sys.stdout)
        return 1
    except ImportError as exc:
        json.dump({"status": "error", "message": f"solver dependency missing: {exc}"}, sys.stdout)
        return 1

    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
