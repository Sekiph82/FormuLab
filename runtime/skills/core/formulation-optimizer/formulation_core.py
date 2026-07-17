"""Chemical formulation cost optimizer — portable linear-program core.

Minimize the raw-material cost of a batch while meeting an active-matter
target and respecting per-material stock and maximum-usage limits.

This is a clean-room implementation written for FormuLab: pure Python +
PuLP (which bundles the CBC solver), no Excel / VBA / win32com. Data goes in
and comes out as plain dicts, so the same core backs the desktop UI (via a
Tauri command) and the agent skill (via a CSV/JSON wrapper).

Model
-----
Decision variable  x_i  = kilograms of material i to use.

    minimize    sum_i  x_i * unit_price_i
    subject to  sum_i  x_i                     == batch_size
                sum_i  x_i * active_i/100      >= batch_size * min_active/100
                0 <= x_i <= stock_i
                x_i <= batch_size * max_usage_i/100

Run as a CLI (reads one JSON object on stdin, writes one on stdout):

    python formulation_core.py < input.json

Or import and call :func:`optimize` directly.
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, List


class FormulationError(ValueError):
    """Raised when the input describes an unsolvable or malformed problem."""


def _as_float(value: Any, field: str, *, material: str | None = None) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        where = f" for material '{material}'" if material else ""
        raise FormulationError(f"'{field}'{where} must be a number, got {value!r}")


def _normalize_material(raw: Dict[str, Any], index: int) -> Dict[str, Any]:
    """Validate one material row and fill in defaults.

    Accepts both the terse UI keys and the verbose spreadsheet-style keys so the
    same payload shape works from the desktop form and from a converted xlsx.
    """
    name = raw.get("name") or raw.get("Material_Name") or f"Material {index + 1}"

    def pick(*keys: str, default: Any = None) -> Any:
        for key in keys:
            if key in raw and raw[key] is not None:
                return raw[key]
        return default

    unit_price = _as_float(
        pick("unit_price", "Unit_Price_USD_per_kg", default=0.0),
        "unit_price",
        material=name,
    )
    stock = _as_float(
        pick("stock", "Stock_Available_kg", default=0.0),
        "stock",
        material=name,
    )
    active = _as_float(
        pick("active_matter_pct", "Active_Matter_Content_%", default=0.0),
        "active_matter_pct",
        material=name,
    )
    # No explicit cap == may fill the whole batch.
    max_usage = _as_float(
        pick("max_usage_pct", "Max_Usage_Limit_%", default=100.0),
        "max_usage_pct",
        material=name,
    )

    if unit_price < 0:
        raise FormulationError(f"unit_price for '{name}' cannot be negative")
    if stock < 0:
        raise FormulationError(f"stock for '{name}' cannot be negative")
    if not 0 <= active <= 100:
        raise FormulationError(f"active_matter_pct for '{name}' must be within 0–100")
    if not 0 <= max_usage <= 100:
        raise FormulationError(f"max_usage_pct for '{name}' must be within 0–100")

    return {
        "name": str(name),
        "unit_price": unit_price,
        "stock": stock,
        "active_matter_pct": active,
        "max_usage_pct": max_usage,
    }


def optimize(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Solve the formulation LP.

    Parameters
    ----------
    payload:
        ``{"materials": [ {...}, ... ], "constraints": {"batch_size": float,
        "min_active_pct": float}}``.

    Returns
    -------
    dict
        ``{"status": "optimal"|"infeasible"|..., "total_cost": float,
        "items": [{"name","quantity_kg","cost","share_pct"}...],
        "achieved_active_pct": float, "batch_size": float}``. On a non-optimal
        solve, ``items`` is empty and ``message`` explains why.
    """
    # Imported lazily so importing this module (e.g. for --selfcheck) never
    # requires PuLP; only an actual solve does.
    import pulp

    raw_materials: List[Dict[str, Any]] = payload.get("materials") or []
    if not raw_materials:
        raise FormulationError("at least one material is required")

    constraints = payload.get("constraints") or {}
    batch_size = _as_float(constraints.get("batch_size", 0.0), "batch_size")
    min_active = _as_float(constraints.get("min_active_pct", 0.0), "min_active_pct")

    if batch_size <= 0:
        raise FormulationError("batch_size must be greater than 0")
    if not 0 <= min_active <= 100:
        raise FormulationError("min_active_pct must be within 0–100")

    materials = [_normalize_material(m, i) for i, m in enumerate(raw_materials)]

    prob = pulp.LpProblem("formulation_cost_minimization", pulp.LpMinimize)

    # Per-material upper bound = the tighter of physical stock and the max-usage
    # cap, so an impossible cap surfaces as infeasibility rather than a silent
    # over-use.
    variables = []
    for i, mat in enumerate(materials):
        cap = min(mat["stock"], batch_size * mat["max_usage_pct"] / 100.0)
        variables.append(pulp.LpVariable(f"x_{i}", lowBound=0, upBound=cap))

    prob += pulp.lpSum(
        variables[i] * materials[i]["unit_price"] for i in range(len(materials))
    ), "total_cost"

    prob += pulp.lpSum(variables) == batch_size, "batch_size"
    prob += (
        pulp.lpSum(
            variables[i] * materials[i]["active_matter_pct"] / 100.0
            for i in range(len(materials))
        )
        >= batch_size * min_active / 100.0
    ), "min_active_matter"

    status_code = prob.solve(pulp.PULP_CBC_CMD(msg=0))
    status = pulp.LpStatus[status_code].lower()

    if status != "optimal":
        return {
            "status": status,
            "message": _explain_infeasible(materials, batch_size, min_active),
            "total_cost": None,
            "items": [],
            "achieved_active_pct": None,
            "batch_size": batch_size,
        }

    items = []
    total_active_kg = 0.0
    for i, mat in enumerate(materials):
        qty = pulp.value(variables[i]) or 0.0
        # CBC returns tiny negatives / dust; clamp so the report is clean.
        if qty < 1e-6:
            continue
        qty = round(qty, 6)
        total_active_kg += qty * mat["active_matter_pct"] / 100.0
        items.append(
            {
                "name": mat["name"],
                "quantity_kg": qty,
                "cost": round(qty * mat["unit_price"], 4),
                "share_pct": round(qty / batch_size * 100.0, 4),
            }
        )

    items.sort(key=lambda it: it["quantity_kg"], reverse=True)

    return {
        "status": "optimal",
        "message": "",
        "total_cost": round(pulp.value(prob.objective), 4),
        "items": items,
        "achieved_active_pct": round(total_active_kg / batch_size * 100.0, 4),
        "batch_size": batch_size,
    }


def _explain_infeasible(
    materials: List[Dict[str, Any]], batch_size: float, min_active: float
) -> str:
    """Best-effort human reason for an infeasible solve.

    The two structural causes are (1) the caps can't add up to the batch, and
    (2) even the richest feasible mix can't reach the active-matter target.
    """
    max_fillable = sum(
        min(m["stock"], batch_size * m["max_usage_pct"] / 100.0) for m in materials
    )
    if max_fillable < batch_size - 1e-6:
        return (
            f"Stock and max-usage limits cap the batch at {max_fillable:.2f} kg, "
            f"below the target of {batch_size:.2f} kg. Raise a stock or usage limit."
        )
    best_active = max((m["active_matter_pct"] for m in materials), default=0.0)
    if best_active < min_active - 1e-9:
        return (
            f"No material exceeds {best_active:.2f}% active matter, so the "
            f"{min_active:.2f}% target is unreachable at any mix."
        )
    return (
        "No mix satisfies every constraint at once (batch size, active-matter "
        "target, and per-material limits conflict)."
    )


def _selfcheck() -> int:
    """Tiny built-in smoke test so the packaged script can prove it runs.

    Skips silently if PuLP isn't importable, so `--selfcheck` never fails the
    host just because the env isn't provisioned yet.
    """
    try:
        import pulp  # noqa: F401
    except Exception as exc:  # pragma: no cover - env-dependent
        print(json.dumps({"ok": False, "reason": f"pulp unavailable: {exc}"}))
        return 0
    demo = {
        "materials": [
            {"name": "A", "unit_price": 2.0, "stock": 100, "active_matter_pct": 80, "max_usage_pct": 100},
            {"name": "B", "unit_price": 1.0, "stock": 100, "active_matter_pct": 20, "max_usage_pct": 100},
        ],
        "constraints": {"batch_size": 100, "min_active_pct": 50},
    }
    result = optimize(demo)
    print(json.dumps({"ok": result["status"] == "optimal", "result": result}))
    return 0


def main(argv: List[str]) -> int:
    if "--selfcheck" in argv:
        return _selfcheck()

    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        json.dump({"status": "error", "message": f"invalid JSON input: {exc}"}, sys.stdout)
        return 1

    try:
        result = optimize(payload)
    except FormulationError as exc:
        json.dump({"status": "error", "message": str(exc)}, sys.stdout)
        return 1
    except ImportError as exc:
        json.dump(
            {"status": "error", "message": f"solver dependency missing: {exc}"},
            sys.stdout,
        )
        return 1

    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
