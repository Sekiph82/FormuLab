# Test results

`packages/shared/src/schemas/testDefinitions.ts` (`testResultSchema`,
`testReplicateSchema`, `replicateStatsSchema`, `testResultOverrideSchema`),
`packages/shared/src/engine/testResults.ts`
(`computeReplicateStats`, `evaluatePassFail`,
`evaluateNumericResultPassFail`, `applyResultOverride`, `reviseTestResult`,
`flagOutliers`). Used by both trials (`TestResult`, keyed by `trialId`) and
stability samples (`StabilityResult`, keyed by `sampleId`/`conditionId`/
`timePointId`) — structurally the same replicate/stats/override machinery,
kept as two schemas because a stability result's identity is a sample × time
point, not a trial id.

## Replicates and computed statistics

A result carries `replicates: TestReplicate[]` (one per physical repeat) —
`replicateNumber`, `numericValue`/`textValue`, and `isOutlier`/
`outlierReason`. `computeReplicateStats` derives `{ count, mean, minimum,
maximum, standardDeviation, coefficientOfVariationPercent }` purely from the
replicates, using **sample standard deviation (n−1)**, appropriate for a
small lab sample rather than a full population. `coefficientOfVariationPercent`
is `undefined` when the mean is zero (division by zero) or fewer than two
replicates exist — never a fabricated ratio. The computed `stats` are
persisted alongside the raw `replicates` (the same "snapshot the computed
totals but keep the raw data" convention `CostSnapshot`/`OptimizationRun`
already use elsewhere), so a report never needs to recompute them, but the
replicates remain the source of truth.

## Outlier detection

`flagOutliers` uses the standard **1.5×IQR rule**, and only runs with **four
or more** numeric replicates (below that, "outlier" isn't a statistically
meaningful label). A flagged replicate is never deleted or excluded
automatically — `isOutlier`/`outlierReason` are set on the record, and it is
the caller's explicit choice whether to exclude it from a recalculated mean.

## Pass/fail evaluation

`evaluateNumericResultPassFail(definition, stats)` reads the definition's
`passFailLogic` against the computed mean — `within_range` (min/max),
`at_least`, `at_most`. Returns `"pass" | "fail" | "not_evaluated"` — the
latter when the definition has no pass/fail logic at all (a purely
observational/informational test never gets a manufactured verdict).
`manual_judgment` is **never** evaluated automatically; `passFail` must be
set directly by a human reviewer.

## Human override

`applyResultOverride(result, actor, { reason, overriddenEvaluation })` is
**human-only** — throws for any non-human actor. It records the reviewer's
identity, timestamp, reason, and both the original and overridden
evaluation on `TestResultOverride`, never silently replacing the computed
verdict. An overridden result still shows its original computed pass/fail
alongside the override, not in place of it.

## Revision history

Editing a recorded result **never mutates it in place**. `reviseTestResult`
creates a brand-new `TestResult` with `revisesResultId` pointing at the
prior record's id — every historical measurement stays exactly as recorded,
forever queryable, and a report generated before a revision remains
reproducible. `retestOf` is the separate, deliberate "this is a fresh
sample, re-tested" pointer, distinct from a same-sample correction.

## Known limitations

- No UI surface yet for browsing a result's full revision chain — only the
  latest revision is shown in `TrialsPanel.tsx`/`StabilityPanel.tsx`;
  reconstructing history means querying `test_results`/`stability_results`
  directly for records sharing a `revisesResultId` chain.
- Text/categorical/boolean/visual_rating results do not currently compute
  replicate statistics (`computeReplicateStats` is numeric-only) — only
  `numeric` results get a full `stats` object.
