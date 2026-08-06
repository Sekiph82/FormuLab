# Soft constraints (penalty-based relaxation)

`runtime/formulation/advanced_optimizer.py` (`_apply_bound`, `_require_penalty_weight`),
`packages/shared/src/schemas/optimization.ts` (`constraintMetaShape`,
`SOFT_PENALTY_TYPES`, `constraintResultSchema`). Part of the
[Advanced Optimizer](ADVANCED_OPTIMIZER.md).

## What "soft" actually does

A hard constraint is exactly the `prob.addConstraint(...)` call it has
always been — soft constraints did not change hard behavior at all. A soft
constraint becomes a **relaxed** version of the same inequality/equality
plus a non-negative slack (deviation) variable, and the slack's weighted
cost is added to the solver's objective. The solver only pays that cost when
there is truly no better option — it never relaxes a soft constraint just to
shave a little off an unrelated objective, because the deviation is
minimized in its own priority tier (see "Lexicographic ordering" below).

Every soft constraint (`strictness: "soft"`) must state:

| Field | Meaning |
|---|---|
| `penaltyWeight` | Required. Missing → `OptimizerError`, not a silent 0-weight no-op. |
| `penaltyType` | `linear_absolute`, `under_target`, `over_target` — see below. |
| `allowedDeviation` | How much deviation is tolerated before `constraintResults[i].satisfied` turns `false`. Defaults to 0. |
| `deviationUnit` | Free-text, for display only — the solver always works in the constraint's own internal unit (kg, or the ratio's dimensionless residual). |
| `priority` | Reserved for future per-constraint tiering; not yet read by the solver (all soft constraints share one penalty tier — see below). |

## Which constraint types can be soft

Composition (`exact_percentage`, `min_percentage`, `max_percentage`,
`percentage_range`, `min_total_active_matter`/`solids`/`water`,
`max_total_active_matter`/`solids`/`water`), functional (`min_total`,
`max_total`), ratio (`min_ratio`, `max_ratio`, `exact_ratio`), and the two
conditional target-percentage types (`if_present_then_required`,
`if_exceeds_then_min_required`) can all be `soft`. A `PropertyTarget` with
`enforceAs: "soft"` goes through the identical mechanism.

**Never soft, regardless of what a caller requests:**

- `excluded_ingredient`, `total_equals_100` (composition) — a formula that
  does not total 100%, or contains an excluded ingredient "a little", is not
  a formula.
- `at_least_one_present` (functional) — "partially present" has no defined
  deviation semantics for a presence constraint.
- `if_present_then_excluded` (conditional) — this is the compatibility/
  safety hard-exclusion adapter; a "soft exclusion" would let a blocking
  pair appear anyway for a price, defeating the point of excluding it.

## Penalty types

- `linear_absolute` — `|achieved − target|`, used for an exact/two-sided
  target (a single slack pair, under + over).
- `under_target` — only penalized below the target (a `>=` bound; one slack).
- `over_target` — only penalized above the target (a `<=` bound; one slack,
  used by the global cost ceiling below).

## Normalization

A composition/functional/property deviation is scaled by `batch_kg` (a
kg-of-deviation reads as roughly its own percentage-of-batch). A ratio
deviation is scaled by `max(|ratio|, 1.0)` (it has no natural kg scale). This
is a **documented heuristic**, not a claim that penalties across different
constraint kinds are truly commensurable in one unit — two soft constraints
of very different kinds with the same `penaltyWeight` are not guaranteed to
be "equally important" in any absolute sense, only comparably scaled.

## The cost ceiling

`FormulationProblem.costCeiling` is a single, formula-wide raw-material-cost
budget — always soft (`over_target`), never a hard cap: a strict budget the
solver cannot exceed under any circumstance is architecturally just a very
tight `raw_material_cost` objective weight, and a true hard ceiling risks
turning a tight budget into silent infeasibility with no informative cause.
Silently skipped (not an error) when no candidate has a recorded price at
all. Reported in `constraintResults` under `kind: "cost"`, `constraintId:
"cost_ceiling"`.

## Lexicographic ordering

For `objectiveConfig.type: "lexicographic"`, total soft-constraint violation
is minimized in its own tier **before** any user objective priority tier,
then frozen at its optimum before the first user tier runs. This is what
makes "soft relaxes only when necessary" true even under lexicographic
optimization: a cheaper material never wins by quietly violating a soft
minimum that a different, still-optimal-on-cost mix could have honored.

For `weighted`, the summed penalty terms are added directly into the single
combined objective alongside the normalized objective terms — a soft
constraint is what it says it is: a cost, evaluated at the same time as
everything else.

## `feasible_with_penalties`

The run status becomes `feasible_with_penalties` — never an unqualified
`optimal` — whenever at least one soft constraint's actual deviation exceeds
its `allowedDeviation`. Every hard constraint is still satisfied whenever
this status appears (that is what CBC returning `optimal`/`feasible` already
means); only a soft constraint's own `satisfied` flag can be `false`. A
`soft_penalties_exceed_tolerance` warning lists every violated constraint
by id.

## What each soft `constraintResults` entry reports

`requestedTarget`, `achievedValue`, `deviation`, `penaltyApplied`,
`satisfied` — in the constraint's own unit (percent-of-batch for
composition/functional/conditional/property; the ratio's internal residual
space, not a directly comparable ratio number, for a ratio constraint; KES
for the cost ceiling). `satisfied` uses a tolerance scaled to the
constraint's own magnitude (roughly `scale × 1e-5`) rather than a fixed
epsilon, because CBC's own LP solve leaves a residual on that order even for
a constraint that is, in the reportable sense, exactly met.

## Known limitations

- `priority` on a soft constraint is accepted by the schema but not yet read
  by the solver — all soft constraints share one penalty-minimization tier,
  regardless of a stated priority.
- No UI exposes `penaltyWeight`/`penaltyType`/`allowedDeviation`/
  `costCeiling` yet — see [ADVANCED_OPTIMIZER.md](ADVANCED_OPTIMIZER.md)'s
  "What this is not".
- The cross-kind penalty scale (`batch_kg` vs. `max(|ratio|, 1.0)`) is a
  documented heuristic, not a unit-true commensurability guarantee.
