"""CLI wrapper for the formulation optimizer skill.

Reads a problem from JSON or CSV, solves the cost-minimization LP with the
shared :mod:`formulation_core`, prints the result JSON, and (for CSV/JSON file
inputs) writes ``<stem>.result.json`` and ``<stem>.result.csv`` next to it.

Usage
-----
    # JSON problem file ({"materials":[...], "constraints":{...}})
    python optimize.py problem.json

    # CSV materials + constraints as flags
    python optimize.py --materials materials.csv --batch 1000 --min-active 40

    # stdin JSON (no files written)
    python optimize.py < problem.json

Materials CSV columns (header row, case-insensitive; extras ignored):
    name, unit_price, stock, active_matter_pct, max_usage_pct
The verbose spreadsheet headers (Material_Name, Unit_Price_USD_per_kg,
Stock_Available_kg, Active_Matter_Content_%, Max_Usage_Limit_%) are also
accepted, so a sheet exported straight to CSV works unchanged.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys

from formulation_core import FormulationError, optimize


def _read_materials_csv(path: str) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return [dict(r) for r in csv.DictReader(fh)]


def _write_outputs(stem: str, result: dict) -> None:
    with open(f"{stem}.result.json", "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
    with open(f"{stem}.result.csv", "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["Material", "Quantity_kg", "Share_%", "Cost"])
        for item in result.get("items", []):
            writer.writerow(
                [item["name"], item["quantity_kg"], item["share_pct"], item["cost"]]
            )
        writer.writerow([])
        writer.writerow(["Status", result.get("status", "")])
        writer.writerow(["Total_Cost", result.get("total_cost", "")])
        writer.writerow(["Achieved_Active_%", result.get("achieved_active_pct", "")])


def _solve_and_report(payload: dict, stem: str | None) -> int:
    try:
        result = optimize(payload)
    except FormulationError as exc:
        json.dump({"status": "error", "message": str(exc)}, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 1

    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    if stem is not None:
        _write_outputs(stem, result)
        print(f"\nWrote {stem}.result.json and {stem}.result.csv", file=sys.stderr)
    return 0 if result["status"] == "optimal" else 2


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Chemical formulation cost optimizer")
    parser.add_argument("problem", nargs="?", help="JSON problem file (materials + constraints)")
    parser.add_argument("--materials", help="CSV of materials")
    parser.add_argument("--batch", type=float, help="Total batch size (kg)")
    parser.add_argument("--min-active", type=float, default=0.0, help="Minimum active matter %%")
    args = parser.parse_args(argv)

    if args.materials:
        if args.batch is None:
            parser.error("--batch is required with --materials")
        payload = {
            "materials": _read_materials_csv(args.materials),
            "constraints": {"batch_size": args.batch, "min_active_pct": args.min_active},
        }
        stem = os.path.splitext(args.materials)[0]
        return _solve_and_report(payload, stem)

    if args.problem:
        with open(args.problem, encoding="utf-8-sig") as fh:
            payload = json.load(fh)
        stem = os.path.splitext(args.problem)[0]
        return _solve_and_report(payload, stem)

    # No file — read JSON from stdin, write nothing.
    payload = json.load(sys.stdin)
    return _solve_and_report(payload, None)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
