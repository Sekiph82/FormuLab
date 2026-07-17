# Example — All-purpose surface cleaner concentrate

A least-cost actives problem for the **formulation-optimizer** skill: blend
surfactants, a builder, and a solvent into a cleaner concentrate that reaches a
target active content within stock and per-material usage caps.

## Data

`data/materials.csv` — `name, unit_price` (USD/kg), `stock` (kg),
`active_matter_pct`, `max_usage_pct` (max share of the concentrate).

## Target

- Concentrate batch size: **100 kg**
- Minimum active content: **50%**

## Run

```bash
python ../../runtime/skills/core/formulation-optimizer/optimize.py \
  --materials data/materials.csv --batch 100 --min-active 50
```

Cost model only — verify surfactant compatibility, pH, and safety on the bench.
