# Trial execution: weighing, process steps, observations, deviations

`packages/shared/src/engine/laboratory.ts` (`computeMaterialUsageDeviation`,
`computeBatchWeightVariance`, `evaluateWeightTolerance`,
`computeActualFormulaPercent`, `computeProcessStepDeviation`,
`resolveTrialDeviation`, `acceptDeviationWithJustification`), embedded
schemas in `packages/shared/src/schemas/laboratory.ts`. Part of
[Laboratory Trials](LABORATORY_TRIALS.md).

## Material weighing

Each `TrialMaterialUsage` (one per formula line) carries `targetWeight`
(computed from the formula snapshot at trial creation) and an optional
`actualWeight` — **absent, never zero**, until a technician actually weighs
it. `computeMaterialUsageDeviation` returns `{ absoluteDeviation,
percentageDeviation }`, both `undefined` when `actualWeight` hasn't been
entered; a genuinely-weighed zero (e.g. a material skipped entirely) is a
real, calculated 100% deficit, not silently treated the same as "not
weighed yet."

`evaluateWeightTolerance(percentageDeviation, { warningPercent,
failurePercent })` returns `"ok" | "warning" | "failure" | "not_evaluated"`.
Tolerances are **caller-supplied configuration**, never a hardcoded
universal standard — a different product family or lab can use different
thresholds.

`computeBatchWeightVariance` sums target and actual weights across every
line. While any line is unweighed, `totalActualWeight` is a real lower-bound
sum (not padded to match target), `allWeighed` is `false`, and
`varianceAbsolute`/`variancePercentage` are `undefined` — the batch-level
variance is only meaningful once every material has been weighed.
`computeActualFormulaPercent` (actual weight ÷ actual batch total) is
likewise `undefined` until `allWeighed`.

Lot number, supplier, COA status (`received`/`pending`/`not_required`/
`missing`), quarantine and release are tracked per line, the same convention
`InventoryRecord` uses elsewhere in this codebase — quarantined and released
are separate booleans, not one combined "status" flag.

## Process execution

Each `TrialProcessStep` records a planned instruction plus optional planned
ranges (`plannedTemperatureMinC/MaxC`, `plannedMixingSpeedMinRpm/MaxRpm`,
`plannedDurationMinutes`) and the actuals a technician enters
(`actualTemperatureC`, `actualMixingSpeedRpm`, `actualDurationMinutes`,
`actualPh`, `actualViscosity`). `computeProcessStepDeviation` reports **only
the numbers that were actually entered**, and only when they fall outside a
planned range that was actually set — no fabricated "in spec" verdict for a
step whose planned range was never recorded, and no invented actual value
for a field nobody measured.

A step can be `planned`/`in_progress`/`paused`/`completed`/`skipped`
(`skipReason` required when skipped), and a step added mid-run that wasn't
in the original plan is flagged `unplanned: true` rather than silently
merged into the numbered sequence.

## Observations

A `TrialObservation` records a structural, non-quantified event during
execution — color/odor change, phase separation, sedimentation,
precipitation, foaming/viscosity/dissolution issues, unexpected
heating/gas, packaging interaction, processability issue, or `other` — with
who observed it and when. An observation is not itself a deviation; it's
the raw note a deviation (below) may or may not get filed against.

## Deviations

`TrialDeviation` is its own top-level collection (`trial_deviations`), not
an embedded array — see [LABORATORY_TRIALS.md](LABORATORY_TRIALS.md#whats-embedded-vs-what-a-separate-collection)
for why. Severity is `minor`/`major`/`critical`; status is
`open`/`under_review`/`resolved`/`accepted_with_justification`/`rejected`.

- `resolveTrialDeviation(deviation, actor, resolution)` — **human-only**,
  throws for any non-human actor. Sets `resolvedBy`/`resolvedAt`.
- `acceptDeviationWithJustification(deviation, actor, justification)` —
  also human-only. Accepting a deviation without fixing it is still a
  human decision that must state *why*, never a silent pass; `justification`
  is required.
- A `critical` deviation that is still `open`/`under_review` blocks the
  trial from reaching `completed` ([LABORATORY_TRIALS.md](LABORATORY_TRIALS.md#lifecycle))
  and blocks [lab approval readiness](LAB_STABILITY_APPROVAL.md).
- A deviation can spawn a [corrective action](CORRECTIVE_ACTIONS.md)
  (`sourceType: "trial_deviation"`); `TrialDeviation.correctiveActionIds`
  links back to every action opened against it.

## Known limitations

- No photo/attachment capture is wired from the Process/Observations UI yet
  — `attachments: AttachmentReference[]` exists on the schema (a reference
  to a file already in the project folder, never an embedded blob) but the
  desktop panel does not yet expose a way to attach one during execution.
- Tolerance configuration (`WeightToleranceConfig`) is currently hardcoded
  in the UI call site (`±0.5%` warning, `±2%` failure) rather than a
  per-project or per-material-family setting.
