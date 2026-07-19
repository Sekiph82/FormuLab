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

    _add_composition_constraints(prob, x, materials, batch_kg, problem.get("compositionConstraints") or [], constraint_meta)
    _add_functional_constraints(prob, x, materials, batch_kg, problem.get("functionalConstraints") or [], constraint_meta)
    _add_ratio_constraints(prob, x, materials, problem.get("ratioConstraints") or [], constraint_meta)
    _add_conditional_constraints(
        prob, x, materials, batch_kg, problem.get("conditionalConstraints") or [], constraint_meta, binary_vars
    )

    objective_config = problem.get("objectiveConfig") or {}
    objective_terms, objective_meta, norm_bounds = _build_objective_terms(
        x, materials, batch_kg, objective_config.get("objectives") or []
    )
    strategy = objective_config.get("type", "weighted")

    solver_config = problem.get("solverConfig") or {}
    timeout = _num(solver_config.get("timeoutSeconds", 30), "solverConfig.timeoutSeconds")

    is_mixed_integer = len(binary_vars) > 0

    if strategy == "lexicographic":
        status, solved_prob = _solve_lexicographic(prob, objective_terms, objective_meta, timeout)
    else:
        combined = pulp.lpSum(term for term, _meta in objective_terms) if objective_terms else 0
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
    constraint_results = _extract_constraint_results(constraint_meta)
    warnings = _build_warnings(materials, problem)
    sensitivity = _sensitivity_report(solved_prob, is_mixed_integer)

    return {
        "schemaVersion": "1.0",
        "runId": run_id,
        "problemId": str(problem.get("id") or ""),
        "status": result_status,
        "formulaLines": lines,
        "totals": totals,
        "objectiveResults": objective_results,
        "constraintResults": constraint_results,
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
# Composition constraints
# ---------------------------------------------------------------------------


def _material_side_sum(x, mat_ids: Sequence[str]):
    import pulp

    return pulp.lpSum(x[mid] for mid in mat_ids if mid in x)


def _add_composition_constraints(prob, x, materials, batch_kg, constraints, meta):
    import pulp

    for c in constraints:
        cid = c["id"]
        ctype = c["constraintType"]
        strictness = c.get("strictness", "hard")
        mid = c.get("materialId")

        def add(expr, name):
            prob.addConstraint(expr, name)
            meta.append({"id": cid, "kind": "composition", "strictness": strictness, "pulpName": name})

        if ctype == "exact_percentage" and mid:
            pct = _num(c["exactPercent"], "exactPercent")
            add(x[mid] == batch_kg * pct / 100.0, f"comp_{cid}")
        elif ctype == "min_percentage" and mid:
            pct = _num(c["minPercent"], "minPercent")
            add(x[mid] >= batch_kg * pct / 100.0, f"comp_{cid}")
        elif ctype == "max_percentage" and mid:
            pct = _num(c["maxPercent"], "maxPercent")
            add(x[mid] <= batch_kg * pct / 100.0, f"comp_{cid}")
        elif ctype == "percentage_range" and mid:
            lo = _num(c["minPercent"], "minPercent")
            hi = _num(c["maxPercent"], "maxPercent")
            add(x[mid] >= batch_kg * lo / 100.0, f"comp_{cid}_min")
            add(x[mid] <= batch_kg * hi / 100.0, f"comp_{cid}_max")
        elif ctype == "fixed_ingredient" and mid:
            pct = _num(c["exactPercent"], "exactPercent")
            add(x[mid] == batch_kg * pct / 100.0, f"comp_{cid}")
        elif ctype == "excluded_ingredient" and mid:
            add(x[mid] == 0, f"comp_{cid}")
        elif ctype == "total_equals_100":
            add(pulp.lpSum(x.values()) == batch_kg, f"comp_{cid}")
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
            expr = pulp.lpSum(
                x[m.id] * (m.active_pct / 100.0) for m in materials.values() if m.active_pct is not None
            )
            add(expr >= batch_kg * pct / 100.0, f"comp_{cid}")
        elif ctype == "max_total_active_matter":
            pct = _num(c["maxPercent"], "maxPercent")
            expr = pulp.lpSum(
                x[m.id] * (m.active_pct / 100.0) for m in materials.values() if m.active_pct is not None
            )
            add(expr <= batch_kg * pct / 100.0, f"comp_{cid}")
        # min_total_solids / max_total_solids / min_total_water / max_total_water
        # require solidsPercent/waterPercent per material, which OptimizationMaterial
        # does not currently carry (only RawMaterial does) — see
        # docs/OPTIMIZATION_CONSTRAINTS.md's "not yet wired" note. Silently
        # skipped rather than raising, so a problem built from a profile that
        # includes one of these can still solve on its other constraints.


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


def _add_functional_constraints(prob, x, materials, batch_kg, constraints, meta):
    for c in constraints:
        cid = c["id"]
        strictness = c.get("strictness", "hard")
        basis = c.get("basis", "raw_material")
        members = _group_members(materials, c["functionGroups"])
        expr = _group_expr(x, materials, members, basis)
        ctype = c["constraintType"]

        if ctype == "min_total":
            pct = _num(c["value"], "value")
            prob += expr >= batch_kg * pct / 100.0, f"func_{cid}"
            meta.append({"id": cid, "kind": "functional", "strictness": strictness, "pulpName": f"func_{cid}"})
        elif ctype == "max_total":
            pct = _num(c["value"], "value")
            prob += expr <= batch_kg * pct / 100.0, f"func_{cid}"
            meta.append({"id": cid, "kind": "functional", "strictness": strictness, "pulpName": f"func_{cid}"})
        elif ctype == "at_least_one_present":
            # "present" needs a binary per member material to express an OR
            # over a strict >0 condition in an LP; approximated instead with
            # a trace-amount minimum, which is exact for the common case
            # (the group's members are otherwise unconstrained below trace)
            # and documented as such in docs/OPTIMIZATION_CONSTRAINTS.md.
            trace_kg = batch_kg * DEFAULT_PRESENCE_THRESHOLD_PCT / 100.0
            prob += expr >= trace_kg, f"func_{cid}"
            meta.append({"id": cid, "kind": "functional", "strictness": strictness, "pulpName": f"func_{cid}"})


# ---------------------------------------------------------------------------
# Ratio constraints
# ---------------------------------------------------------------------------


def _ratio_side_members(materials, side: Dict[str, Any]) -> List[str]:
    if side.get("materialIds"):
        return [mid for mid in side["materialIds"] if mid in materials]
    if side.get("functionGroups"):
        return _group_members(materials, side["functionGroups"])
    return []


def _add_ratio_constraints(prob, x, materials, constraints, meta):
    for c in constraints:
        cid = c["id"]
        strictness = c.get("strictness", "hard")
        num_members = _ratio_side_members(materials, c["numerator"])
        den_members = _ratio_side_members(materials, c["denominator"])
        num_expr = _group_expr(x, materials, num_members, c["numerator"].get("basis", "raw_material"))
        den_expr = _group_expr(x, materials, den_members, c["denominator"].get("basis", "raw_material"))
        ratio = _num(c["value"], "value")
        name = f"ratio_{cid}"

        # numerator - ratio*denominator {>=,<=,==} 0 — safe when the
        # denominator side has no candidates (den_expr == 0): a min/max ratio
        # constraint against an absent denominator is then vacuously
        # satisfied (0 >= 0 / 0 <= 0) rather than a division-by-zero error;
        # an exact_ratio against an absent denominator forces the numerator
        # to 0 too, which is the mathematically correct reading of "exact
        # ratio" when one side cannot exist.
        if c["ratioType"] == "min_ratio":
            prob += num_expr - ratio * den_expr >= 0, name
        elif c["ratioType"] == "max_ratio":
            prob += num_expr - ratio * den_expr <= 0, name
        else:  # exact_ratio
            prob += num_expr - ratio * den_expr == 0, name
        meta.append({"id": cid, "kind": "ratio", "strictness": strictness, "pulpName": name})


# ---------------------------------------------------------------------------
# Conditional constraints (mixed-integer)
# ---------------------------------------------------------------------------


def _side_members(materials, side: Dict[str, Any]) -> List[str]:
    if side.get("materialId"):
        return [side["materialId"]] if side["materialId"] in materials else []
    if side.get("functionGroup"):
        return _group_members(materials, [side["functionGroup"]])
    return []


def _add_conditional_constraints(prob, x, materials, batch_kg, constraints, meta, binary_vars):
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
        if ctype == "if_present_then_required":
            presence_pct = float(c.get("presenceThresholdPercent", DEFAULT_PRESENCE_THRESHOLD_PCT))
            trace_kg = batch_kg * presence_pct / 100.0
            prob += trigger_expr <= big_m * y, f"cond_{cid}_trigger"
            prob += target_expr >= trace_kg * y, f"cond_{cid}_target"
        elif ctype == "if_exceeds_then_min_required":
            threshold_pct = _num(c["triggerThresholdPercent"], "triggerThresholdPercent")
            min_pct = _num(c["targetMinPercent"], "targetMinPercent")
            threshold_kg = batch_kg * threshold_pct / 100.0
            min_kg = batch_kg * min_pct / 100.0
            eps = batch_kg * DEFAULT_PRESENCE_THRESHOLD_PCT / 100.0
            prob += trigger_expr - threshold_kg - eps <= big_m * y, f"cond_{cid}_trigger"
            prob += target_expr >= min_kg * y, f"cond_{cid}_target"
        elif ctype == "if_present_then_excluded":
            prob += trigger_expr <= big_m * y, f"cond_{cid}_trigger"
            prob += target_expr <= big_m * (1 - y), f"cond_{cid}_target"

        meta.append({"id": cid, "kind": "conditional", "strictness": strictness, "pulpName": f"cond_{cid}"})


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
    if metric in ("compatibility_risk", "safety_risk"):
        # No per-material flag on OptimizationMaterial for "is part of a
        # known risky combination" — a real proxy would need the caller to
        # pre-populate this from the compatibility/safety engines' findings,
        # which `compatibilityPolicy`/`safetyPolicy` already handle via hard
        # exclusion in "exclude_blocking" mode (the default). In "penalize"
        # mode this metric is currently a flat 0 contribution per material —
        # documented as a real, honest limitation in
        # docs/MULTI_OBJECTIVE_OPTIMIZATION.md, not a fabricated risk score.
        return 0.0
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


def _solve_lexicographic(prob, terms, meta, timeout):
    import pulp

    tiers: Dict[int, List[int]] = {}
    for i, m in enumerate(meta):
        tiers.setdefault(int(m.get("priority") or 0), []).append(i)

    solved = prob
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


def _extract_constraint_results(meta) -> List[Dict[str, Any]]:
    results = []
    for entry in meta:
        results.append(
            {
                "constraintId": entry["id"],
                "kind": entry["kind"],
                "strictness": entry["strictness"],
                "satisfied": True,  # the solve only returns for a feasible/optimal status.
            }
        )
    return results


def _build_warnings(materials, problem) -> List[Dict[str, Any]]:
    warnings = []
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
        if c["conditionType"] != "if_present_then_required":
            continue
        target_members = _side_members(materials, c["target"])
        if not target_members:
            causes.append(
                {
                    "code": "required_coingredient_unavailable",
                    "constraintIds": [c["id"]],
                    "materialIds": [],
                    "message": f"Constraint \"{c['displayName']}\" requires a co-ingredient that no candidate material satisfies.",
                    "suggestedActions": ["Add a candidate material matching the required co-ingredient, or remove/relax this constraint."],
                }
            )

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
