# Optimization constraints

`packages/shared/src/schemas/optimization.ts`,
`runtime/formulation/advanced_optimizer.py`.

Every constraint carries `severity`, `strictness` (`hard` | `soft`),
`source`, `verificationStatus` and an optional `explanation` — the same
honesty convention as a compatibility or safety rule
([COMPATIBILITY_ENGINE.md](COMPATIBILITY_ENGINE.md)): a constraint loaded
into a solve is not authoritative just because it is loaded.

**Soft constraints are genuinely enforced as soft.** A `strictness: "soft"`
constraint (composition, functional, ratio, or the two conditional
target-percentage types) becomes a relaxed constraint plus a non-negative
slack variable, weighted by its own required `penaltyWeight` and added to
the objective — see [SOFT_CONSTRAINTS.md](SOFT_CONSTRAINTS.md) for the exact
mechanism, which constraint types can never be soft regardless of what is
requested, and what `ConstraintResult.penaltyApplied`/`requestedTarget`/
`achievedValue`/`deviation` report. No UI yet exposes the
`penaltyWeight`/`penaltyType`/`allowedDeviation` fields a soft constraint
needs — a `FormulationProblem` built by another caller gets the real
enforcement today.

## Composition constraints

`CompositionConstraint` — per-material or formula-wide percentage rules.

| Type | Meaning | Wired into the solver? |
|---|---|---|
| `exact_percentage` / `fixed_ingredient` | `x_material == batch_kg * pct / 100` | yes |
| `min_percentage` | `x_material >= ...` | yes |
| `max_percentage` | `x_material <= ...` | yes |
| `percentage_range` | both of the above | yes |
| `excluded_ingredient` | `x_material == 0` | yes |
| `total_equals_100` | `sum(x) == batch_kg` | yes |
| `water_qs` | no separate variable — resolved implicitly by `total_equals_100` plus every other constraint | accepted, no-op (kept for round-trip parity with the Formula Builder's own q.s. line concept) |
| `min_total_active_matter` / `max_total_active_matter` | sum of `x_i * active_pct_i / 100` bounded | yes |
| `min_phase_percentage` / `max_phase_percentage` | — | **not wired**: `OptimizationMaterial` has no `phase` field (only a plain `FormulationLine` does), so there is nothing to bind to yet |
| `min_total_solids` / `max_total_solids` / `min_total_water` / `max_total_water` | `sum(x_i * solidsPercent_i / 100)` / `waterPercent_i` `{>=,<=} ...` | yes |

The last two rows are accepted by the schema (so a profile can name them)
and silently skipped by the solver — a documented limitation, not a bug: a
problem built from a profile that includes one of these constraint types
still solves on its other constraints, it just does not enforce that
particular one yet.

## Functional-group constraints

`FunctionalConstraint` — a total across every candidate material carrying
any of a set of `MATERIAL_FUNCTIONS`, on either basis:

- `raw_material` — sum of the members' raw percentages.
- `active_matter` — sum of the members' active-matter contribution (10% of
  a 70%-active surfactant contributes 7% active, not 10%).

`constraintType`: `min_total`, `max_total`, both wired as straightforward
sum bounds; `at_least_one_present` is approximated as a small trace-amount
minimum (`batch_kg * 0.001% `) rather than a true logical OR over strict
positivity, which would need one binary per member material. This is exact
for the common case (nothing else drives a member below trace) and
documented here as an approximation, not hidden.

## Ratio constraints

`RatioConstraint` — `numerator / denominator {>=,<=,==} value`, where each
side is a sum over named materials or a function group, on either basis.
Linearized as `numerator - value * denominator {>=,<=,==} 0`, which is safe
against a zero denominator: `min_ratio`/`max_ratio` against an absent
denominator side is vacuously satisfied (`0 >= 0` / `0 <= 0`); `exact_ratio`
against an absent denominator forces the numerator to zero too, the
mathematically correct reading of "an exact ratio against nothing" — not a
crash, not a silently-ignored constraint.

## Conditional constraints

`ConditionalConstraint` — the only constraint type that introduces a binary
indicator variable (see [SOLVER_ARCHITECTURE.md](SOLVER_ARCHITECTURE.md)'s
big-M note). Three patterns:

- **`if_present_then_required`** — trigger material/group present (above
  `presenceThresholdPercent`) forces the target material/group to at least a
  trace amount. Used for "carbomer needs a neutralizer" style rules.
- **`if_exceeds_then_min_required`** — trigger exceeding
  `triggerThresholdPercent` forces the target to at least
  `targetMinPercent`. Used for "fragrance above X% needs a solubilizer."
- **`if_present_then_excluded`** — trigger present forces the target to
  zero. This is the adapter the compatibility/safety policy
  (`compatibilityPolicy.mode: "exclude_blocking"`, the default) uses to turn
  a `blocking`-severity compatibility or safety finding into a hard
  exclusion pair, without duplicating the compatibility/safety rule sets
  inside the optimizer — see
  [COMPATIBILITY_ENGINE.md](COMPATIBILITY_ENGINE.md) and
  [SAFETY_ENGINE.md](SAFETY_ENGINE.md).

Each linearization is one-directional by design (the binary is only ever
forced to `1` when the trigger requires it; the solver has no incentive to
set it spuriously for a minimize-style objective, since doing so can only
add restriction, never relax it — true regardless of objective direction,
since an added constraint can only weakly worsen any feasible region).

## What this is not

- Not a general constraint-programming language. The eight constraint kinds
  above are what this platform models; a requirement that does not fit one
  of them cannot currently be expressed.
- Soft constraints are schema-complete but solver-incomplete — see above.
- Does not itself run the compatibility or safety rule engines — a
  `conditionalConstraint` with `if_present_then_excluded` is how a caller
  (the Advanced Optimizer panel) turns an *already-evaluated* blocking
  finding into a solver constraint, not a re-implementation of the rules
  that produced it.
