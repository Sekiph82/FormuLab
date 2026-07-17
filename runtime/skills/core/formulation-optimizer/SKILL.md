---
name: formulation-optimizer
description: Use when the user wants to minimize the raw-material cost of a chemical formulation, blend, or recipe — find the cheapest mix of ingredients that meets an active-matter (or active-ingredient) target while respecting per-material stock and maximum-usage limits. Triggers on "optimize formulation", "cheapest recipe", "least-cost blend", "raw material mix", batch/active-matter constraints, or a materials table with prices and stock.
---

# Formulation cost optimizer

Solve the least-cost blending problem as a linear program: choose kilograms of
each raw material to **minimize total cost** while hitting a batch size and a
minimum active-matter percentage, without exceeding any material's stock or its
maximum usage share.

This skill runs **locally** with Python + PuLP (bundled CBC solver). It does not
call a model, touch Excel, or need a network.

## Model

Decision variable `x_i` = kg of material *i*.

    minimize    sum_i  x_i * unit_price_i
    subject to  sum_i  x_i                    == batch_size
                sum_i  x_i * active_i / 100   >= batch_size * min_active / 100
                0 <= x_i <= stock_i
                x_i <= batch_size * max_usage_i / 100

## Inputs

Each material needs: `name`, `unit_price`, `stock` (kg), `active_matter_pct`
(0–100), `max_usage_pct` (0–100, default 100). Constraints: `batch_size` (kg)
and `min_active_pct` (0–100).

## How to run

The solver lives next to this file. Run it in the workspace with the local
Python (the same interpreter the notebook Run button uses):

1. **From a JSON problem file** — write `problem.json`:

   ```json
   {
     "materials": [
       {"name": "Surfactant A", "unit_price": 3.2, "stock": 400, "active_matter_pct": 90, "max_usage_pct": 100},
       {"name": "Surfactant B", "unit_price": 1.1, "stock": 400, "active_matter_pct": 20, "max_usage_pct": 100}
     ],
     "constraints": {"batch_size": 1000, "min_active_pct": 40}
   }
   ```

   ```bash
   python optimize.py problem.json
   ```

2. **From a materials CSV** (headers `name,unit_price,stock,active_matter_pct,max_usage_pct`;
   the verbose `Material_Name,Unit_Price_USD_per_kg,Stock_Available_kg,Active_Matter_Content_%,Max_Usage_Limit_%`
   headers from an exported spreadsheet also work):

   ```bash
   python optimize.py --materials materials.csv --batch 1000 --min-active 40
   ```

Both file forms also write `<stem>.result.json` and `<stem>.result.csv` next to
the input so the run is reproducible and the numbers land in the workspace.

## Reading the result

```json
{
  "status": "optimal",
  "total_cost": 2150.0,
  "items": [{"name": "...", "quantity_kg": 500.0, "share_pct": 50.0, "cost": 1600.0}],
  "achieved_active_pct": 55.0,
  "batch_size": 1000
}
```

- `status: "optimal"` — report the mix, the total cost, and the achieved active
  matter. Quantities below 1e-6 kg are dropped.
- `status: "infeasible"` — the constraints conflict. The `message` says which
  structural cause (caps below the batch, or the active target unreachable).
  Suggest raising a stock/usage limit or lowering the active target; do **not**
  invent a mix.

## Boundaries

- Report the solver's numbers as-is. This is a cost model, not a formulation
  recommendation — do not assert a blend is safe, stable, or regulatory-compliant.
- The model is linear: it assumes cost and active matter scale linearly with
  quantity and that materials mix ideally. Flag that assumption if the user's
  chemistry is non-linear (e.g. reactions, synergistic actives).
