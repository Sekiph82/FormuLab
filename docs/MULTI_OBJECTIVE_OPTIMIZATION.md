# Multi-objective optimization

`packages/shared/src/schemas/optimization.ts` (`ObjectiveConfig`,
`OptimizationObjective`), `runtime/formulation/advanced_optimizer.py`
(`_build_objective_terms`, `_solve_lexicographic`).

## Metrics

| Metric | Computation | Basis |
|---|---|---|
| `raw_material_cost` | `sum(x_i * price_i)` | real, per-candidate price |
| `landed_cost` | same as `raw_material_cost` today | see "What `landed_cost` and `total_factory_cost` actually mean" below |
| `total_factory_cost` | alias of `landed_cost` today | ditto |
| `supply_risk` | `sum(x_i * supplyRiskScore_i)` | real, only when the candidate carries a score |
| `carbon_score` | `sum(x_i * carbonScore_i)` | real, only when the candidate carries a score |
| `stock_utilization` | `sum(x_i)` (batch fill), normalized `[0, batch_kg]` | real |
| `evidence_confidence` | `sum(x_i * evidenceConfidenceScore_i)` | real, only when the candidate carries a score |
| `compatibility_risk` | flat `0` contribution per material | **not a real risk signal today** — see below |
| `safety_risk` | flat `0` contribution per material | **not a real risk signal today** — see below |
| `performance_score` | refused — `OptimizerError` raised | no validated predictive model exists |
| `regulatory_uncertainty` | refused — `OptimizerError` raised | the Regulatory Engine is not implemented |

**`compatibility_risk` and `safety_risk` are accepted as objective metrics
but currently score every candidate identically (0).** The actual safety
mechanism is the hard exclusion built by
`compatibilityPolicy`/`safetyPolicy: "exclude_blocking"` (see
[OPTIMIZATION_CONSTRAINTS.md](OPTIMIZATION_CONSTRAINTS.md#conditional-constraints)) —
a blocking compatibility or safety pair is removed from the feasible region
entirely, not merely penalized in the objective. Selecting one of these two
metrics as an objective today has no effect beyond that hard exclusion; it
is not yet a graded risk score a chemist could weight against cost. This is
listed here rather than silently shipped as if it worked.

**Why `performance_score` and `regulatory_uncertainty` are refused
outright** (`OptimizerError`, not a fabricated number): this platform has no
validated model that predicts cleaning performance, foam, stability, or
similar from a raw-material mix (see
[FORMULA_BUILDER.md](FORMULA_BUILDER.md) and the `PROPERTY_CAPABILITY`
table in [ADVANCED_OPTIMIZER.md](ADVANCED_OPTIMIZER.md#property-targets)),
and the Regulatory Engine described in the full specification is not
implemented (`docs/architecture/IMPLEMENTATION_STATUS.md`). Solving toward
either metric would mean inventing a number and letting the solver optimize
against it — exactly the "guaranteed by the optimizer" claim this platform
does not make.

### What `landed_cost` and `total_factory_cost` actually mean here

Labour, utilities, QC, waste and factory overhead
([COST_ENGINE.md](COST_ENGINE.md)) are **batch-level costs that do not
change with which materials are chosen** — a batch costs the same
electricity and labour whether it is 70% SLES or 70% an alternative
surfactant. Since the solver is choosing a *mix*, not a batch count, those
fixed components cannot move the optimal mix and are correctly omitted from
what the solver optimizes; `total_factory_cost` is left as an alias of
`landed_cost` rather than duplicated with a fake distinct computation.
`landed_cost` itself is currently computed identically to
`raw_material_cost` — true per-shipment landed-cost allocation
(freight/duty/insurance, [COST_ENGINE.md](COST_ENGINE.md)) is not yet
plumbed into `OptimizationMaterial.landedCost` from the material price
record; when it is, `landed_cost` will diverge from `raw_material_cost` for
imported materials without any objective-metric API change.

## Weighted strategy

All requested metrics are normalized to `[0, 1]` and combined into one LP
objective. Normalization needs a range without pre-solving: for a linear
metric, the achievable range over *any* feasible mix that sums to
`batch_kg` is bounded by `[batch_kg * min(unit value), batch_kg * max(unit
value)]` across the candidate set — a mathematical fact of linearity over a
simplex-like feasible region, not an approximation of unknown accuracy. The
true achievable range under the problem's OTHER constraints is a subset of
this, so the reported `normalizedValue` can under-spread (less than the full
`[0, 1]` in practice) but never falls outside it.

```
normalized_minimize = (raw - min_bound) / (max_bound - min_bound)
normalized_maximize = (max_bound - raw) / (max_bound - min_bound)
combined_objective  = sum(weight_k * normalized_k)   -- minimized
```

`stock_utilization`'s bound is fixed at `[0, batch_kg]` rather than derived
from unit values (it has none — it is a fill-quantity metric, not a
per-material rate).

## Lexicographic strategy

Objectives are grouped by `priority` (lower runs first). Each tier is
solved to optimality, its optimal value frozen as a `<= optimum + 1e-6`
constraint (a small tolerance in the already-normalized `[0, 1]` space, not
a business-meaningful slack), and the next tier's combined expression
becomes the new objective. A tier failing to solve optimally (infeasible,
unbounded, timeout) stops the whole run at that status — a later tier is
never allowed to "fix" an earlier tier's infeasibility, because that would
mean silently abandoning a higher-priority objective the caller asked for.

Multiple objectives sharing one `priority` are weighted-combined within that
tier only, using their own `weight`s — a tier is not required to be a single
metric.

## What this is not

- Not a Pareto-front explorer. One run produces one optimal point for the
  given strategy, not a frontier of tradeoffs — comparing tradeoffs is what
  [scenarios](ADVANCED_OPTIMIZER.md#scenarios) are for (run the same problem
  twice with different weights/priorities, compare the two results).
- Normalization bounds are a property of the *candidate set*, not of the
  problem's other constraints — a heavily constrained problem's true
  achievable range can be much narrower than the reported bound, which is
  why `objectiveResults` reports both `rawValue` (unambiguous) and
  `normalizedValue` (relative to the candidate-set bound, not the
  constrained feasible region).
