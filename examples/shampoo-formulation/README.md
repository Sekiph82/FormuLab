# Example — Shampoo surfactant blend

A least-cost surfactant-system problem for the **formulation-optimizer** skill.
Four commercial surfactants, each sold at a different active-matter content and
price, are blended into a premix. Find the cheapest blend that reaches a target
active-surfactant content without exceeding any material's blend share.

## Data

`data/materials.csv` — columns: `name, unit_price` (USD/kg), `stock` (kg),
`active_matter_pct` (surfactant active content), `max_usage_pct` (max share of
the blend).

## Target

- Premix batch size: **250 kg**
- Minimum active-surfactant content: **40%**

## Run

```bash
python ../../runtime/skills/core/formulation-optimizer/optimize.py \
  --materials data/materials.csv --batch 250 --min-active 40
```

The optimizer writes the optimal mix, total cost, and achieved active content.
This is a cost model only — real shampoo needs actives, preservative, rheology,
and pH control, plus bench validation.
