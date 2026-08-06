# Property targets

`runtime/formulation/advanced_optimizer.py` (`_property_expr`,
`_evaluate_property_targets`, `_extract_property_results`,
`_weighted_average_hlb_or_density`), `packages/shared/src/schemas/optimization.ts`
(`propertyTargetSchema`, `propertyResultSchema`,
`PROPERTY_CONSTRAINT_STATUSES`). Part of the
[Advanced Optimizer](ADVANCED_OPTIMIZER.md).

## The rule

A property is either a real, deterministic calculation over the chosen
materials, or it is reported `laboratory_required` with **no computed
value at all**. Nothing in this module fabricates a precise number for pH,
viscosity, foam, cleaning performance, stability, mildness or preservative
efficacy — those five require a lab measurement, full stop, regardless of
what a `PropertyTarget` requests.

## What is actually calculated

| Property | Method | Classification |
|---|---|---|
| `active_matter` | `sum(x_i × activeMatterPercent_i)` over the batch | `calculated` |
| `total_solids` | `sum(x_i × solidsPercent_i)` over the batch | `calculated` |
| `available_chlorine` | active-matter total of materials functioning as `bleaching_agent` | `rule_based_estimate` |
| `peroxide_active` | active-matter total of materials functioning as `oxygen_donor` | `rule_based_estimate` |
| `qac_active` | active-matter total of materials functioning as `qac_active` | `rule_based_estimate` |
| `chlorhexidine_active` | active-matter total of materials functioning as `chlorhexidine_active` | `rule_based_estimate` |
| `fluoride_level` | active-matter total of materials functioning as `fluoride_active` | `rule_based_estimate` |
| `hlb` | `sum(x_i × hlb_i) / sum(x_i)` over materials carrying an HLB value | `rule_based_estimate` |
| `density` | `batch_kg / sum(x_i / density_i)` — ideal-mixture weighted-volume approximation | `rule_based_estimate` |

`ph`, `viscosity`, `foam_profile`, `hard_water_tolerance` and
`wet_wipe_lotion_loading` are `laboratory_required` — capped there by
`_PROPERTY_CAPABILITY` regardless of `enforceAs`. Note `ph`'s Python-side
ceiling is `laboratory_required`, stricter than `engine/optimization.ts`'s
aspirational `rule_based_estimate` ceiling: no pH-mixing rule is
implemented, so the actual solver behavior is more conservative than the
platform's stated aspirational ceiling — never less conservative than what
is stated.

## Hard vs. soft vs. reported-only

`enforceAs: "hard"` or `"soft"` turns a calculable target (`active_matter`,
`total_solids`, or one of the five named actives — all genuinely linear in
the chosen quantities) into a real solver constraint via the same
`_apply_bound` machinery [soft constraints](SOFT_CONSTRAINTS.md) use. Omit
`enforceAs` and the target is still calculated and reported
(`constraintStatus: "reported_only"`), just never binds the solve.

`hlb` and `density` are **never** enforced, hard or soft — they are weighted
*averages* (ratios of two linear expressions in the chosen quantities), not
linear functions of the decision variables, so PuLP cannot constrain them
directly without a nonlinear or piecewise-linear reformulation this module
does not implement. They are still computed and reported, post-solve, from
the optimal quantities — this is a genuine mathematical limitation, not a
shortcut.

## `PropertyResult`

Every `PropertyTarget` produces exactly one (or, for a two-sided
min/max range enforced as a constraint, still one) `PropertyResult`:

| Field | Meaning |
|---|---|
| `value` | The computed/estimated value, absent when `laboratory_required` or data was too incomplete. |
| `method` | Human-readable derivation, e.g. `"sum(x_i * solidsPercent_i) over the batch"`. |
| `dataCompleteness` | `complete` / `partial` (a nonzero line in the solution is missing the field) / `insufficient` (nothing computable). |
| `classification` | The actual `PROPERTY_CAPABILITY` ceiling for this property. |
| `constraintStatus` | `enforced_hard`, `enforced_soft_satisfied`, `enforced_soft_violated`, `reported_only`, or `unsupported`. |
| `laboratoryConfirmationRequired` | `true` whenever `classification !== "calculated"`. |

`constraintStatus` for a soft target is derived from whether its own
underlying `constraintResults` entry (or entries, for a two-sided range)
actually ended up `satisfied` — never assumed satisfied just because
`enforceAs: "soft"` was requested.

## Infeasibility

A hard property target that no combination of candidates can reach produces
a `property_target_unreachable` cause in `infeasibility.causes` (see
[INFEASIBILITY_ANALYSIS.md](INFEASIBILITY_ANALYSIS.md)), computed
deterministically from each contributing material's usage cap — never a
guess from a failed solve alone.

## Known limitations

- No UI exposes a property-target editor yet — `AdvancedOptimizerPanel.tsx`
  always sends `propertyTargets: []`. A `FormulationProblem` built by
  another caller gets the real calculation and enforcement today.
- `hlb`/`density` cannot be enforced (see above) — a formula's effective HLB
  in reality is not a strict linear function of its emulsifiers' individual
  HLB values either, so even the *reported* value is an approximation, never
  presented as measured.
- The named-active properties (`available_chlorine`, `peroxide_active`,
  etc.) read a material's active-matter percentage under a matching
  function group as a stand-in for a wet-chemistry titration result — real,
  but a proxy, and always `rule_based_estimate`, never `calculated`.
