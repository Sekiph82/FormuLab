# Stability studies

`packages/shared/src/schemas/stability.ts`, `packages/shared/src/engine/stability.ts`,
`packages/shared/src/catalog/stabilityConditions.ts`
(`SEED_STABILITY_CONDITIONS`, `SEED_STABILITY_TIME_POINTS`),
`apps/desktop/src/components/formula/StabilityPanel.tsx`. Explicitly
excludes automatic shelf-life prediction — see
[STABILITY_TRENDS.md](STABILITY_TRENDS.md) for exactly what a trend
projection is (and is not) instead.

## What this is

A `StabilityStudy` links one formula (a frozen `formulaSnapshot`, same
capture-once convention as a [Laboratory Trial](LABORATORY_TRIALS.md)'s
snapshot) to one packaging system (`packagingSkuCode` + a frozen
`packagingSnapshot` of the BOM at study creation), an owner, an optional
free-text `protocol` reference, and the set of storage conditions, time
points and required test definitions the study actually uses. It can
optionally reference a `laboratoryTrialId` when the study is following up on
a specific trial's formula. A study **never runs against a mutable working
draft without first freezing a snapshot** — the snapshot is what makes a
months-long study immune to a formula edit made in week three.

## Conditions and time points — configurable, not requirements

`SEED_STABILITY_CONDITIONS` (9: 4°C, 25°C/long-term, 30°C/intermediate,
40°C/accelerated, 45°C/accelerated-high, room temperature, freeze-thaw
cycling, light exposure, custom) and `SEED_STABILITY_TIME_POINTS` (9:
initial, 24h, 1wk, 2wk, 1mo, 2mo, 3mo, 6mo, 12mo, custom) are **structural
starting examples**, each shipped `verificationStatus: "not_verified"` —
never presented as what any regulator or standard requires. A study picks
whichever subset actually applies to its protocol; each condition supports
its own temperature/humidity + tolerance, light condition, orientation,
freeze-thaw cycle definition, and free-text custom instructions.

## Lifecycle

```
planned → active → completed → archived
             ↓  ↖ paused
           failed → archived
             ↓
         cancelled → archived
```

`canTransitionStability` mirrors `canTransitionTrial`'s discipline exactly:
an undocumented transition is rejected, `completed` requires a **human**
actor (`REQUIRES_HUMAN` otherwise), and `completed` is blocked
(`OPEN_CRITICAL_FAILURE`) while any `critical`-severity
[failure](STABILITY_TRENDS.md#failures) is still open. Once terminal
(`completed`/`failed`/`cancelled`/`archived`), `assertStudyEditable` throws
on further edits — the same application-level immutability guard
[LABORATORY_TRIALS.md](LABORATORY_TRIALS.md#lifecycle) uses, for the same
reason (the Rust `stability_studies` collection is mutable master data, not
append-only).

## Sample generation

One physical pull-point sample per **(condition × time point × replicate)**
combination — packaging system is the study's own fixed field, not a fourth
combinatorial axis, since a study links to exactly one packaging SKU/BOM
(spec's original "condition × time point × packaging × replicate" framing
collapses to three axes once packaging is fixed per study).
`generateStabilitySamples(study, conditions, timePoints)` throws if the
study has no `startDate` yet (due dates are computed from it) and produces
a `StabilitySample` per combination with a deterministic `dueDate =
startDate + timePoint.daysFromStart`, computed once at generation time and
never re-derived differently later. `sampleCode` is
`${study.code}-${condition.code}-${timePoint.code}-R${replicate}`.

`computeSampleDueState`/`refreshSampleDueStates` compare each sample's
`dueDate` against "now" (UTC day comparison) to move it to `due`/`overdue`
— deterministic, never a guess, and only samples whose status actually
changed are written back.

A study created today also captures an immutable `testRequirementSnapshot`
— see [TEST_APPLICABILITY.md](TEST_APPLICABILITY.md) — and its results/
failures support safe file attachments — see
[ATTACHMENTS.md](ATTACHMENTS.md). Packaging-compatibility readiness for
approval is now derived from real results against a `testCapability`-
tagged definition, not a manually supplied boolean — see
[APPROVAL_WORKFLOW.md](APPROVAL_WORKFLOW.md#packaging-compatibility-for-real).
Each time-point result also has a "View history" action opening the
dedicated [result history browser](RESULT_HISTORY_BROWSER.md).

## Test applicability at study creation

`StabilityPanel.tsx` wires the same applicability engine
`TrialsPanel.tsx` uses — `isTestDefinitionApplicable`,
`evaluateApplicability`, `buildTestRequirementSnapshot` from
`testApplicability.ts` — into study creation via a "Test applicability"
button next to the tests picker, opening the same `ExclusionExplorer`
component with `context: "stability"` and the in-progress
packaging/condition/time-point selections. See
[TEST_APPLICABILITY.md](TEST_APPLICABILITY.md) for the shared engine and
[TEST_APPLICABILITY.md#manual-inclusion](TEST_APPLICABILITY.md) for the
manual-inclusion reviewer/reason capture this panel requires before a
manually-included test can be added.

For an existing study, the captured `testRequirementSnapshot` is always
shown; if the current `TestDefinition` set would now resolve differently
(a definition's applicability changed after the study was created), a
comparison-only note lists what would additionally be included/excluded —
it never mutates the original, immutable snapshot.

## Known limitations

- A study is locked to one packaging SKU for its whole duration; testing
  the same formula in two different packaging systems means two separate
  studies.
- `replicatesPerPullPoint` is set once at study creation (default 1) and
  applies uniformly to every condition × time point — there's no per-
  condition replicate override.
