# DOE runs, observations, and Laboratory integration (Phase 5)

`packages/shared/src/schemas/doe.ts` (`doeRunSchema`/`doeObservationSchema`),
`packages/shared/src/engine/doeDesign.ts` (run finalization inside
`generateDoeDesign`), `packages/shared/src/engine/doeLabIntegration.ts`
(`applyDoeFactorsToLines`), `apps/desktop/src/components/formula/DoePanel.tsx`
(the Runs tab).

## The run record

```ts
DoeRun {
  id, schemaVersion: "1.0", studyId, studyRevision, designId,
  runNumber, standardOrder, randomizedOrder,
  block, replicate, isCenterPoint,
  factorSettings,      // DoeFactorSetting[]: { factorCode, codedValue, actualValue }
  status,              // planned | prepared | trial_created | in_progress |
                        // completed | failed | excluded | cancelled
  linkedTrialId?, linkedFormulaVersionId?,
  createdAt, startedAt?, completedAt?, excludedAt?, exclusionReason?,
}
```

`factorSettings` are frozen once a run leaves `planned`
(`DOE_RUN_LOCKED_STATUSES`) — enforced at the application layer, the same
convention `regulatory_evidence_items` already uses. If a run's intended
settings need to change after that point, the correct path is regenerating
the design through a new study revision, never mutating an executed run in
place — spec §9: "do not modify historical laboratory trials silently."

## Observations

```ts
DoeObservation {
  id, schemaVersion: "1.0", studyId, studyRevision, runId, responseId,
  value?, textValue?,
  status,     // recorded | validated | missing | invalid | excluded |
               // outlier_flagged | outlier_confirmed
  sourceTrialId?, sourceTestResultId?,
  measuredAt?, recordedBy, recordedAt,
  excludedAt?, exclusionReason?,
}
```

An observation is entered manually per (run, response) pair in the Runs
tab's expanded row — real, human-typed values, never fabricated. A missing
response is genuinely absent (`status: "missing"`, `value: undefined`) —
[DOE_STATISTICAL_ANALYSIS.md](DOE_STATISTICAL_ANALYSIS.md)'s analysis
engine excludes it from the fit and lists it explicitly, it is never
treated as zero. Excluding an observation always records a reason
(`exclusionReason`); outlier flags are suggestions from the statistical
engine that a human confirms or dismisses — an observation is never
auto-excluded.

## Generating a Laboratory trial from a run

`LaboratoryTrial` gained three optional lineage fields this phase:
`sourceDoeStudyId`, `sourceDoeDesignId`, `sourceDoeRunId` (backward
compatible — no migration needed, existing trials simply omit them).

`applyDoeFactorsToLines(baselineLines, factorSettings, factors)`
deterministically maps a run's factor settings onto the study's exact
baseline formula version:

- A `formula_material` factor overwrites the matching line's `percent`.
- A factor referencing a material **absent from the baseline** warns
  rather than fabricating a new line — a human decides whether to add that
  material.
- Every other factor (`temperature`/`mixing_speed`/`mixing_time`/
  `addition_order`/`pH_target`/`packaging`/`custom`) becomes a process
  setting, never a formula line.
- Fixed ingredients (lines with no matching factor) are left exactly as
  they were in the baseline.
- A resulting composition that doesn't total ~100% warns for review before
  it becomes a trial.

The workspace's "Generate lab trial" action (Runs tab) builds a real
`LaboratoryTrial` this way, persists it, and links it back to the run
(`linkedTrialId`) — or a human can link an already-existing trial instead
via "Link existing trial". Either way, the run's status advances to
`trial_created` and a `doe.trials_generated`/`doe.trial_linked` audit event
is recorded.

## Stability

A DOE response can be manually populated from a stability result the same
way any other response is — by a human typing the observed value into the
Runs tab. Automatic import from a `StabilityResult` record specifically
(matching by condition/time point) is not implemented in this phase; see
[DESIGN_OF_EXPERIMENTS.md](DESIGN_OF_EXPERIMENTS.md#implemented-vs-not-yet-implemented).
Because missing observations are always excluded from analysis rather than
treated as zero, an incomplete future stability time point can never
silently be read as "the product failed" — see spec §11.

## Status

Implemented, tested (`doeLabIntegration.test.ts`, `doeDesign.test.ts`'s run
tests), live-usable through the Runs tab: status transitions, manual
observation entry, exclusion with reason, trial generation/linking.
