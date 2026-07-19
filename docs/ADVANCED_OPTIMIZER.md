# Advanced Formulation Constraint Optimizer

`packages/shared/src/schemas/optimization.ts`,
`packages/shared/src/engine/optimization.ts`,
`runtime/formulation/advanced_optimizer.py`,
`apps/desktop/src/components/formula/AdvancedOptimizerPanel.tsx`. Open the
**Optimizer** tab inside a formula project.

## What this is

A real constraint-satisfaction and multi-objective optimizer over a
formula's raw-material mix — composition, functional-group, ratio and
conditional constraints, solved as a linear or mixed-integer program by the
bundled Python + PuLP/CBC (see [SOLVER_ARCHITECTURE.md](SOLVER_ARCHITECTURE.md)).
This is additive to, not a replacement for, the existing simple optimizer
(`formulation_core.py`, the **Optimizer** page under the main sidebar):
that page's input/output shape, CLI and Tauri command are unchanged.

## Domain model

`FormulationProblem` (the request) and `AdvancedOptimizationResult` (the
response) are the contract shared between the UI, the persisted run
history, and the Python solver. See:

- [OPTIMIZATION_CONSTRAINTS.md](OPTIMIZATION_CONSTRAINTS.md) — composition,
  functional-group, ratio and conditional constraints, and which of the
  eight constraint types the solver actually enforces today.
- [SOFT_CONSTRAINTS.md](SOFT_CONSTRAINTS.md) — penalty-based relaxation:
  what becomes soft, how a violation is scored, and what
  `feasible_with_penalties` means.
- [PROPERTY_TARGETS.md](PROPERTY_TARGETS.md) — which properties the solver
  can genuinely calculate, which are honestly `laboratory_required`, and how
  a target can be enforced as a hard or soft constraint.
- [OPTIMIZATION_SCENARIOS.md](OPTIMIZATION_SCENARIOS.md) — scenario
  lifecycle, the append-only revision model, product-family profile
  application, and run comparison.
- [SYSTEM_SUBSTITUTION.md](SYSTEM_SUBSTITUTION.md) — multi-material
  substitution: candidate generation, optimizer routing, scoring.
- [OPTIMIZER_UI_VERIFICATION.md](OPTIMIZER_UI_VERIFICATION.md) — what was
  and was not verified for the Optimizer/Substitution screens, and why.
- [MULTI_OBJECTIVE_OPTIMIZATION.md](MULTI_OBJECTIVE_OPTIMIZATION.md) —
  weighted and lexicographic strategies, metric normalization, and which
  metrics are refused outright (`performance_score`,
  `regulatory_uncertainty`) rather than computed dishonestly.
- [INFEASIBILITY_ANALYSIS.md](INFEASIBILITY_ANALYSIS.md) — the deterministic
  infeasibility checks (composition, functional, ratio, conditional,
  property, and compatibility/safety-exclusion lockout) and their suggested
  actions.
- [SOLVER_ARCHITECTURE.md](SOLVER_ARCHITECTURE.md) — why the solve itself
  stays in Python, the TS/Python contract, timeout/cancellation, and
  deterministic naming.

## Optimization material

`OptimizationMaterial` mirrors the fields the solver needs — price, active
matter, stock, ionic character, functions, min/max/technical/regulatory
use limits, supply-risk/evidence-confidence/carbon scores — each wrapped in
an `OptimizationValue { value?, state }` for the fields where "unknown" must
never be treated as zero (price, active matter, regulatory maximum, stock).
`AdvancedOptimizerPanel.tsx` builds this from the real material master
(`RawMaterial` + current `MaterialPrice` + aggregated `InventoryRecord`
availability) — never invented.

## Property targets

`PropertyTarget.requestedClassification` is what a caller *asks for*;
`engine/optimization.ts`'s `PROPERTY_CAPABILITY` is the fixed ceiling on
what this platform can *honestly claim*, and every consumer of a property
target result must go through `actualPropertyClassification()` rather than
trusting the request:

| Property | Capability |
|---|---|
| `active_matter`, `total_solids` | `calculated` — exact sums over the formula lines |
| `ph`, `hlb`, `density`, `available_chlorine`, `peroxide_active`, `qac_active`, `chlorhexidine_active`, `fluoride_level` | `rule_based_estimate` — a weighted-average approximation, never presented as measured |
| `viscosity`, `foam_profile`, `hard_water_tolerance`, `wet_wipe_lotion_loading` | `laboratory_required` — always, no matter what is requested |

**The solver genuinely calculates and can enforce (hard or soft) every
`calculated`/`rule_based_estimate` property above** — see
[PROPERTY_TARGETS.md](PROPERTY_TARGETS.md) for the exact formulas and the
`PropertyResult` each target produces. `laboratory_required` properties are
never enforced and never given a fabricated value.

**The disclosed gap is in the UI, not the solver**: `AdvancedOptimizerPanel.tsx`
still always sends `propertyTargets: []` and never sets `costCeiling` — there
is no property-target or cost-ceiling input on the Optimizer screen yet.
Building a `FormulationProblem` by hand (or from a future UI affordance) gets
the real calculation and enforcement today.

## Product-family optimization profiles

`catalog/optimizationProfiles.ts` seeds 31 structural profiles (required/
allowed/forbidden function groups, `not_verified`, `requiresChemistReview:
true` — the same honesty convention as the compatibility/safety seed rule
sets) for the named Kenya families, one per family named in the
specification. The Optimizer screen's Scenarios section loads them for
real: pick a profile, then **Apply missing** / **Merge** / **Replace**
(the last requires a confirming click) — see
[OPTIMIZATION_SCENARIOS.md](OPTIMIZATION_SCENARIOS.md) for exactly what
each mode does and does not touch.

## Scenarios

`OptimizationScenario` now has a real, working lifecycle in the UI: create
from the current candidate/constraint/objective selection, save, clone,
rename, retire, and restore a retired scenario as a new one — all through
`AdvancedOptimizerPanel.tsx`'s Scenarios section. Every run is persisted
against the scenario's group (`OptimizationRun.scenarioId`), so a
scenario's full run history survives navigation, and comparing two or more
runs (from the same scenario or different ones) renders a real comparison
table with per-metric highlights (never a fabricated "best overall"). See
[OPTIMIZATION_SCENARIOS.md](OPTIMIZATION_SCENARIOS.md) for the append-only
revision model this is built on.

## Graded compatibility/safety risk

A `blocking` compatibility or safety finding between two candidates always
becomes a hard exclusion (`if_present_then_excluded`) — the solver can never
select both. Every other finding (`info`/`warning`/`error`) instead feeds
the `compatibility_risk`/`safety_risk` objective metrics as a real,
severity-weighted score: `AdvancedOptimizerPanel.tsx`'s `gradedRiskScores`
runs the same `evaluateCompatibility`/`evaluateSafety` engines pairwise over
every pair of selected candidates (the same evaluation
`blockingExclusionConstraints` already does), sums each material's
severity-weighted findings (`info` 0.1, `warning` 0.4, `error` 0.8, ×1.3 for
a `human_review_required`/data-incomplete finding), caps at 1.0, and passes
the result as `compatibilityRiskScore`/`safetyRiskScore` on each
`OptimizationMaterial`. The solver never runs the rules itself — it only
consumes these numbers via `_metric_unit_value` in `advanced_optimizer.py`.
A candidate that was actually paired against another (pool size ≥ 2) always
gets an explicit `0`, never `undefined` — unscored is reserved for the
single-candidate case where no pairing was even possible, never used as a
shortcut for "did not check."

## Workflow

1. Open the **Optimizer** tab. Candidate materials default to whatever the
   current draft already uses; add or remove from the full material master.
2. Add functional-group constraints (min/max, raw or active basis). Ratio
   and conditional constraint UI is not yet built — see "What this is not."
3. Compatibility/safety exclusion is automatic: every pair of selected
   candidates is checked with the real compatibility/safety engines before
   the problem is built, and a blocking pair becomes a hard exclusion (see
   [OPTIMIZATION_CONSTRAINTS.md](OPTIMIZATION_CONSTRAINTS.md#conditional-constraints)).
4. Choose one or more objectives (weighted; the UI does not yet expose
   lexicographic priority selection, though the solver supports it).
5. **Run** — real cancellation is available while a solve is in progress.
6. Review the result: formula lines with per-line active contribution and
   cost, totals, objective values, or (on an infeasible solve) the
   structured causes and suggested actions.
7. **Apply to draft** — creates/updates the **working draft**, never the
   saved version the draft was derived from. The run's code
   (`appliedOptimizationRunCode`) is remembered so the next saved version
   records it, and re-running validation, compatibility, safety and cost
   happens naturally on the next tab visit — the same as any other line
   edit, not a special optimizer code path.

Optimization does not itself approve anything — see
[APPROVAL_READINESS.md](APPROVAL_READINESS.md) for how an applied run is
re-validated (its stored result status, not just its presence) before
`pilot_approved`/`production_approved` can be granted.

## What this is not

- Property targets and a cost ceiling have a real, if minimal, editor now
  (add a target with a min/max and hard/soft/reported-only, one cost-ceiling
  field) — see [PROPERTY_TARGETS.md](PROPERTY_TARGETS.md). Soft-constraint
  parameters (`penaltyWeight`/`allowedDeviation`) are exposed only on the
  functional-constraint rows, not on composition constraints (there is no
  composition-constraint builder at all — see the next bullet).
- Does not have a composition-, ratio-, or conditional-constraint builder in
  the UI; only functional-group constraints, property targets, a cost
  ceiling, and the automatic compatibility/safety exclusion are user-facing
  today, even though the solver and schema support the full set. A loaded
  scenario or applied profile that carries any of these three still sends
  them to the solver correctly (shown as a read-only count), just not
  editable here.
- The UI does not yet expose lexicographic priority selection (weighted
  only), even though the solver supports it and now solves soft-constraint
  penalties in their own tier ahead of every priority (see
  [SOFT_CONSTRAINTS.md](SOFT_CONSTRAINTS.md)).
- No per-material lock editor in the Scenarios section yet — a scenario's
  `problem.materials[].lockedPercent` round-trips correctly when loaded, but
  there is no UI control to set one.
- Does not guarantee cleaning performance, stability, or regulatory
  compliance — see [MULTI_OBJECTIVE_OPTIMIZATION.md](MULTI_OBJECTIVE_OPTIMIZATION.md).

See [OPTIMIZATION_SCENARIOS.md](OPTIMIZATION_SCENARIOS.md) and
[SYSTEM_SUBSTITUTION.md](SYSTEM_SUBSTITUTION.md) for their own, more
detailed "known limitations" sections.

## Tests

`runtime/formulation/test_advanced_optimizer.py` (57 — composition,
functional, ratio, conditional, soft-constraint relaxation, property
targets, cost ceiling, graded risk objectives, and infeasibility diagnostic
coverage), `packages/shared/src/engine/optimization.test.ts` (17, including
`blockingExclusionConstraints`/`gradedRiskScores`),
`packages/shared/src/engine/scenarios.test.ts` (20 — lifecycle, profile
application, comparison), `packages/shared/src/engine/systemSubstitution.test.ts`
(21 — candidate generation, problem building, scoring),
`packages/shared/src/engine/approvalReadiness.test.ts` (24, including the
substitution no-selection/blocked-selection checks),
`apps/desktop/src/components/formula/AdvancedOptimizerPanel.test.tsx` (9)
and `SubstitutionPanel.test.tsx` (5) — see
[OPTIMIZER_UI_VERIFICATION.md](OPTIMIZER_UI_VERIFICATION.md) for exactly
what those two integration suites cover and what they do not.
