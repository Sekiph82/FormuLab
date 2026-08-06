# Infeasibility analysis

`runtime/formulation/advanced_optimizer.py`'s `_diagnose_infeasibility`.

## What this is

When a solve does not return `"optimal"`/`"feasible"`, the result carries an
`infeasibility.causes` array instead of an empty formula and a bare status
code. Each `InfeasibilityCause` is produced by a **deterministic,
independent pre-check** run against the problem's materials and constraints
— not derived from CBC's own infeasibility certificate (CBC does not expose
an interpretable one for a MIP the way an LP relaxation's Farkas certificate
would, and even that would need translating back into formulation language
a chemist can act on).

## The checks

Every check below only ever fires against **hard** constraints — a soft
constraint always has a slack variable, so by construction it can never be
the cause of an infeasible solve (see [SOFT_CONSTRAINTS.md](SOFT_CONSTRAINTS.md)).

| Code | Detects | Suggested actions |
|---|---|---|
| `insufficient_stock_or_usage_cap` | `sum(cap_kg)` over every candidate is below `batch_kg` | increase stock, relax a usage/technical/regulatory maximum, add a candidate |
| `fixed_ingredients_exceed_batch` | `exact_percentage`/`fixed_ingredient` constraints alone sum above 100% | reduce a fixed percentage |
| `functional_minimum_unreachable` | a `min_total` functional constraint's member materials, even at full caps, cannot reach the required total (or has zero members) | add a candidate in that function group, relax the minimum, raise a cap |
| `required_coingredient_unavailable` | a hard `if_present_then_required` conditional constraint's target side matches no candidate material | add a matching candidate, or remove/relax the constraint |
| `conditional_coingredient_unavailable` | a hard `if_exceeds_then_min_required` conditional constraint's target side matches no candidate material | add a matching candidate, or remove/relax the constraint |
| `ratio_minimum_conflict` / `ratio_maximum_conflict` | every material on **both** sides of a hard `min_ratio`/`max_ratio`/`exact_ratio` constraint is pinned to an exact kg (by a hard `exact_percentage`/`fixed_ingredient` constraint or a lock) and the resulting ratio provably violates the target | relax one of the pinning percentages, or relax the ratio constraint |
| `ratio_division_by_zero` | a hard `exact_ratio` constraint's denominator side has no candidate material at all, while its numerator side is pinned away from 0 — an always-zero denominator forces the numerator to 0 too | add a candidate to the denominator side, or remove/relax the constraint |
| `property_target_unreachable` | a hard `PropertyTarget`'s minimum, even with every contributing candidate at full cap, cannot be reached | add a candidate carrying the property, relax the target, record a missing value |
| `compatibility_or_safety_exclusions_remove_all_candidates` | every candidate pairwise-excludes every other candidate (hard `if_present_then_excluded`) and no single candidate's cap alone can fill the batch | add a non-conflicting candidate, raise a cap, review the compatibility/safety findings |

`compatibility_or_safety_exclusions_remove_all_candidates` is deliberately
**not** split into a compatibility-specific and safety-specific cause: the
solver consumes `if_present_then_excluded` constraints identically
regardless of which engine produced them (by design — it never
re-implements either engine's rules), so it has no record of the origin to
report honestly. Attributing one anyway would be a guess dressed up as a
finding.

When none of the above fire but the solve is still infeasible, one generic
`no_combination_satisfies_all_constraints` cause is returned rather than
nothing — an honest "the pre-checks did not isolate it" rather than a false
claim of having found the specific conflict. The ratio and ratio-division
checks above are deliberately narrow (fully pinned materials only); a ratio
constraint that depends on any free-to-vary material falls through to the
generic cause rather than a guessed diagnosis.

## Suggested actions are deterministic where possible

Every cause's `suggestedActions` is a fixed list of plain-language next
steps tied to that cause's own code — not an LLM-generated suggestion, and
not personalized to the specific numbers beyond what the cause's `message`
already states (which does interpolate the actual calculated/requested
limits). Two solves of the same infeasible problem produce byte-identical
`suggestedActions`.

## Multiple causes

All checks run independently and every one that fires is included —
`_diagnose_infeasibility` does not stop at the first match. A problem that
is infeasible for two independent reasons (say, insufficient stock **and**
an unreachable functional minimum) reports both, so a chemist does not fix
one and re-run only to hit the second.

## Known gaps

- **A ratio constraint depending on any free-to-vary material** — the
  `ratio_minimum_conflict`/`ratio_maximum_conflict` checks only fire when
  every material on both sides is pinned to an exact kg; a ratio constraint
  that depends on a material free to vary within a range falls through to
  the generic cause, since proving that conflict in general would mean
  solving a sub-problem, not a cheap deterministic check.
- **`invalid_objective_configuration`** — not reachable as an infeasibility
  cause under the current architecture: an empty `objectives` array, an
  unknown metric, or an objective metric with no scored candidate all raise
  `OptimizerError` immediately, before a solve is even attempted, rather
  than producing an `infeasible` result. This fails faster and more
  specifically than a post-hoc diagnosis would.
- **`soft_penalties_exceed_tolerance`** — not an infeasibility cause at all
  in this architecture: a soft constraint always has a slack variable, so it
  can never be the reason a solve is infeasible. When at least one soft
  constraint's deviation exceeds its `allowedDeviation`, the result is
  `feasible_with_penalties` (not `infeasible`) and carries a
  `soft_penalties_exceed_tolerance` **warning** instead — see
  [SOFT_CONSTRAINTS.md](SOFT_CONSTRAINTS.md).
- **Cost ceiling unreachable** — not applicable: `costCeiling` is always
  soft (see [SOFT_CONSTRAINTS.md](SOFT_CONSTRAINTS.md)'s "The cost ceiling"),
  so it can relax rather than cause infeasibility.

## What this is not

- Not a full Irreducible Infeasible Subsystem (IIS) analysis. An IIS would
  name the minimal set of constraints that together cause infeasibility;
  these checks name plausible, common, cheaply-detectable causes instead.
- Not exhaustive — the generic fallback cause exists specifically so this
  module never claims a diagnosis it did not actually make.
