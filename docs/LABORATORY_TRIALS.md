# Laboratory Trials

`packages/shared/src/schemas/laboratory.ts`, `packages/shared/src/engine/laboratory.ts`,
`apps/desktop/src/components/formula/TrialsPanel.tsx`. Explicitly excludes
regulatory engine, DOE, reverse formulation and automatic shelf-life
prediction — none of that is implemented here or anywhere else in this
phase.

## What this is

A `LaboratoryTrial` is the record of what actually happened at the bench for
one physical batch — distinct from the `FormulationVersion` (or working
draft) it started from. A `FormulationVersion` is already immutable once
saved ([FORMULA_VERSIONING.md](FORMULA_VERSIONING.md)); a trial goes one step
further and embeds its own frozen `formulaSnapshot` (lines + basis batch kg,
captured once at creation), so a trial started from the mutable working
draft is just as immune to later formula edits as one started from a saved
version. Reading a trial never requires joining back to a formula version
that might not exist under that id forever.

## Identity and scope

A trial belongs to exactly one `Formulation` (`projectId`) and records
either `sourceFormulaVersionId` (started from a saved version) or
`sourceDraftId` (started from the working draft) — never both, never
neither. It carries the product family, target packaging SKU ids, and
optionally the `sourceOptimizationRunCode`/`sourceSubstitutionRunCode` that
produced the formula being tested, so a trial can always be traced back to
*why* this particular composition was worth running at the bench.

## Lifecycle

```
planned → materials_prepared → in_progress → awaiting_results → completed → archived
                                     ↓              ↓
                                  failed  ────────→ archived
                                     ↓
                                 cancelled → archived
```

Every transition is checked by `canTransitionTrial` (`engine/laboratory.ts`),
not just hidden in the UI:

- An undocumented transition is rejected with `NOT_A_VALID_TRANSITION`.
- Moving to `completed` requires a **human** actor
  ([`schemas/status.ts`](../packages/shared/src/schemas/status.ts)'s
  `Actor` type) — an `agent`/`system`/`import` actor gets `REQUIRES_HUMAN`.
  This is the same discipline as formula approval: no automated process may
  mark a trial complete.
- Moving to `completed` is additionally blocked
  (`OPEN_CRITICAL_DEVIATION`) while any `critical`-severity
  [deviation](TRIAL_EXECUTION.md#deviations) on this trial is still `open`
  or `under_review`.

Once a trial reaches a terminal status (`completed`/`failed`/`cancelled`/
`archived`), `assertTrialEditable` throws on any further edit. The Rust
storage layer keeps `laboratory_trials` mutable (like `materials`/
`inventory`, not append-only), so this application-level guard is what
actually makes a completed trial's execution record immutable in practice —
there is no database-level enforcement to fall back on.

## What's embedded vs. what's a separate collection

Material usage, process steps and observations are **embedded arrays** on
the trial record (`materialUsage[]`, `processSteps[]`, `observations[]`),
the same pattern `FormulationVersion` already uses for `lines[]` — a trial
is one mutable JSON document with nested execution detail, not three
separate master-data collections. `TrialDeviation` is the one exception: it
is its own top-level collection (`trial_deviations`), because a deviation is
cross-referenced independently by [corrective actions](CORRECTIVE_ACTIONS.md)
and [approval readiness](LAB_STABILITY_APPROVAL.md) regardless of whether
the trial that produced it is still open.

See [TRIAL_EXECUTION.md](TRIAL_EXECUTION.md) for material weighing, process
steps, and deviations; [TEST_DEFINITIONS.md](TEST_DEFINITIONS.md) and
[TEST_RESULTS.md](TEST_RESULTS.md) for the shared test system; and
[TRIAL_COMPARISON.md](TRIAL_COMPARISON.md) for comparing two or more trials.

## Known limitations

- No automatic linkage back to a specific optimizer/substitution *result
  line* — only the run *code* is recorded. Tracing which candidate a trial
  actually used means opening that run's own record.
- Equipment is a free-text id list (`equipmentIds: string[]`); there is no
  separate equipment master-data collection to validate against.
