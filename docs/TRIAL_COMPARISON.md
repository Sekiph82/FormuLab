# Trial comparison

`packages/shared/src/engine/laboratory.ts` (`compareTrials`),
`packages/shared/src/schemas/laboratory.ts` (`trialComparisonSchema`,
`trialComparisonRowSchema`, `testResultComparisonSchema`),
`apps/desktop/src/components/formula/TrialsPanel.tsx`'s comparison table,
`packages/shared/src/engine/labExports.ts` (`trialComparisonReportRows`,
the Excel export). Part of [Laboratory Trials](LABORATORY_TRIALS.md).

## What it compares

`compareTrials({ projectId, trials, deviationsByTrial, testResultsByTrial,
testDefinitionsById })` requires **at least two trials** (throws otherwise)
and produces one `TrialComparisonRow` per trial: formula version id,
material usage count, process deviation count, critical deviation count,
test result count, pass/fail counts, total raw material cost (when
available), and the trial's optimization/substitution source codes.

For every test definition shared by two or more of the compared trials, a
`TestResultComparison` reports `meanDifference`, `absoluteDifference`,
`percentageDifference`, and `standardDeviationDifference` between the
trials' means — computed once, directly, never re-derived per render.

## What it deliberately does not do

**No automatic causation inference.** The engine never says "Trial B's
higher viscosity is *because of* the substituted thickener" — it reports
the numbers side by side and stops there. If an `aiInterpretation` string is
attached to a saved `TrialComparison`, every writer in this codebase is
expected to prefix it with **"AI-assisted interpretation — requires chemist
review"** (the schema documents this convention; it does not enforce the
exact prefix string itself). The deterministic `rows`/`testComparisons`
remain the source of truth regardless of whether an interpretation is
attached — the UI never treats an AI-generated narrative as a substitute for
the numbers.

## Saving and exporting a comparison

A `TrialComparison` is one record (`trial_comparisons`, **append-only** at
the Rust storage layer — a saved comparison is never edited in place, only
superseded by a new one) capturing `trialIds`, the computed `rows` and
`testComparisons`, and `generatedAt`/`generatedBy`.

`trialComparisonReportRows` (`engine/labExports.ts`) turns a comparison into
two export tables — a Trials sheet and a Test Differences sheet — both
built directly from the saved comparison's own fields, with no
re-derivation at export time. See [the exports doc section on trial
comparison](LABORATORY_TRIALS.md) and the desktop Export menu on the
Trials workspace.

## Known limitations

- Comparison is trial-vs-trial only; there is no cross-cutting "compare
  this trial against a stability study" view (the two domains use
  structurally similar but separate result types — see
  [TEST_RESULTS.md](TEST_RESULTS.md)).
- `totalRawMaterialCost` on a comparison row is only populated when the
  caller happens to have a cost figure already computed for that trial's
  batch; `compareTrials` does not itself invoke the cost engine.
