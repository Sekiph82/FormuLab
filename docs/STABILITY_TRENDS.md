# Stability trends and failures

`packages/shared/src/engine/stability.ts` (`computeStabilityTrend`,
`MIN_PROJECTION_POINTS`, `MIN_PROJECTION_SPAN_DAYS`,
`resolveStabilityFailure`, `hasOpenCriticalFailure`),
`packages/shared/src/schemas/stability.ts` (`stabilityTrendSchema`,
`stabilityFailureSchema`), `apps/desktop/src/components/formula/
StabilityPanel.tsx`'s `TrendCharts`/`TrendSparkline`/`FailuresSection`. Part
of [Stability Studies](STABILITY_STUDIES.md).

## Trend calculation

`computeStabilityTrend({ studyId, conditionId, testDefinitionId, definition,
resultsByTimePoint })` takes one `StabilityResult` per time point already
tested for a given condition × test, sorts by `daysFromStart`, and computes,
purely from the numeric means already recorded:

- `absoluteChangeFromInitial` / `percentageChangeFromInitial` — latest vs.
  the point at day 0 (or the earliest available point).
- `changeFromPrevious` / `ratePerDay` — latest vs. the second-most-recent
  point, rate per calendar day between them.
- `minimum` / `maximum` / `mean` / `standardDeviation` (sample, n−1) across
  every numeric point.
- `limitCrossing` — set only when a point's mean actually crossed the test
  definition's own `minimum`/`maximum`, never inferred from a trend line.

Each test metric gets its **own separate chart** (`TrendCharts` renders one
`TrendSparkline` per condition × numeric test definition) rather than
overcrowding a single combined chart.

## No validated shelf-life claims

This is the one place in the platform where a number could easily read as
"predicts when this product goes bad" — so it's the most guarded. A
`projection` is **only ever computed** when ALL of:

1. At least `MIN_PROJECTION_POINTS` (**3**) numeric points exist.
2. Those points span at least `MIN_PROJECTION_SPAN_DAYS` (**14**) days.
3. A `ratePerDay` was actually computable (needs ≥ 2 points).
4. The test definition has a `minimum` or `maximum` to project toward.
5. The observed rate is actually moving *toward* that limit (a rate moving
   away from the limit produces no projection — there's nothing to warn
   about).

When all five hold, `projection` is a simple **linear extrapolation**:
`estimatedDaysToLimit` and a `basis` string stating the rate and the data it
was computed from. Its `label` field is a Zod **literal**:
`"experimental estimate — not validated — human review required"` — this
string cannot be changed to sound more authoritative without changing the
schema itself, by design. Below the minimum-data threshold, `computeStabilityTrend`
returns the real trend data with **no** `projection` field at all, rather
than guessing from too little.

## Failures

`STABILITY_FAILURE_TYPES` (13): `out_of_specification`, `phase_separation`,
`precipitation`, `color_change`, `odor_change`, `viscosity_drift`,
`ph_drift`, `active_loss`, `packaging_failure`, `leakage`, `seal_failure`,
`microbiological_failure`, `other`. A `StabilityFailure` references its
study/sample/condition/time-point/test-result, has a severity
(`minor`/`major`/`critical`, shared enum with trial deviations), an
`investigationStatus` (`open`/`investigating`/`root_cause_identified`/
`closed`), and links to any [corrective actions](CORRECTIVE_ACTIONS.md)
opened against it.

`StabilityPanel.tsx`'s `recordResult` auto-creates a failure the moment a
numeric result's computed `passFail` is `"fail"` — severity `critical` when
the test definition is `criticalTestFlag: true`, `major` otherwise. This is
the one place a failure record is created without an explicit human click,
because the pass/fail verdict itself was already computed deterministically
from the test definition's own logic; the human step is what happens *next*
(investigation, resolution).

`resolveStabilityFailure(failure, actor, notes)` is **human-only** (throws
for non-human actors), sets `investigationStatus: "closed"`. A
`critical`+unresolved failure blocks a study from `completed`
([STABILITY_STUDIES.md](STABILITY_STUDIES.md#lifecycle)) and blocks
[stability approval readiness](LAB_STABILITY_APPROVAL.md).

## Known limitations

- Projection is a single linear fit over all available points — no
  weighting toward recent points, no Arrhenius or other kinetic model. It
  is explicitly an "experimental estimate," not a shelf-life methodology.
- `TrendSparkline` is a minimal inline SVG (polyline + points), not an
  interactive chart — no hover tooltips, zoom, or point-level detail beyond
  what the numeric trend summary already shows alongside it.
