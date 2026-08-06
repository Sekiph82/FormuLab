# Corrective actions

`packages/shared/src/schemas/correctiveActions.ts`,
`packages/shared/src/engine/correctiveActions.ts`,
`apps/desktop/src/components/formula/CorrectiveActionsPanel.tsx` (the
cross-cutting workspace) plus the inline sections in `TrialsPanel.tsx`/
`StabilityPanel.tsx`. Shared by [Laboratory Trials](LABORATORY_TRIALS.md)
and [Stability Studies](STABILITY_STUDIES.md) — one model, not two, because
"what do we do about a deviation/failure" is the same question regardless
of which domain raised it.

## One shared model

`CorrectiveAction.sourceType` is `trial_deviation` / `trial_failure` /
`stability_failure` / `manual`; `sourceRecordId` is the trial or study id,
`deviationOrFailureId` the specific `TrialDeviation`/`StabilityFailure` when
one exists (absent for a `manual` action not tied to a single logged
problem). Fields: title, problem statement, optional root-cause notes,
action type (`reformulation`/`process_change`/`supplier_change`/
`packaging_change`/`specification_change`/`retest`/`documentation`/`other`),
owner, optional due date, and a full `auditHistory[]` of every state
transition (action, actor id/kind, timestamp, detail).

## Lifecycle

```
open → in_progress → awaiting_verification → effective
                            ↓                      ↓
                       ineffective ←───────── (re-check) → reopen → in_progress
open/in_progress/awaiting_verification → cancelled
```

**`effective`/`ineffective` are only reachable through a recorded
effectiveness check** (`verifyEffectiveness(action, actor, { effective,
notes })`) — never set directly, the same discipline `resolved` on a
[trial deviation](TRIAL_EXECUTION.md#deviations) requires a resolution
record. `verifyEffectiveness` is implicitly a human action in every call
site in this codebase (no automated verification path exists).
`reopenCorrectiveAction`/`cancelCorrectiveAction` both require a reason.

## Creating a draft formula from a corrective action

`createDraftFromCorrectiveAction(action, sourceVersion, actor)` reuses
`draftFromVersion` (`engine/versioning.ts`) — the **exact same** function a
plain "start a variant from this version" action uses elsewhere in the
codebase, not a parallel implementation:

- The source version is never mutated.
- The new draft links back to the corrective action (`action.createdDraftId
  = draft.formulationId`) and, transitively, to whichever trial/failure
  prompted it.
- **Never inherits approval** — a fresh draft has no approval field to
  inherit; only an explicit human approval on a *new* saved version confers
  approved status (see [APPROVAL_READINESS.md](APPROVAL_READINESS.md)).
- Validation, compatibility and safety re-run naturally on the draft's next
  tab visit, exactly as for any other line edit — not a special corrective-
  action code path.
- Cost recalculates the same way any draft's cost recalculates — no cached
  figure carries over from the version the draft branched from.

## Where it shows up

`CorrectiveActionsPanel.tsx` is the cross-cutting list for a whole formula
project (every action regardless of source), with the full lifecycle button
set. `TrialsPanel.tsx`/`StabilityPanel.tsx` additionally show actions inline
against their originating deviation/failure, with a **Create draft** button
wired to the same handler. A corrective action now also supports safe file
attachments (evidence of the fix) — see [ATTACHMENTS.md](ATTACHMENTS.md).
Only a corrective action tied to a *critical*-severity deviation/failure
counts as an unresolved-critical-corrective-action approval blocker — see
[APPROVAL_WORKFLOW.md](APPROVAL_WORKFLOW.md#laboratory-and-stability-derivation).

## Known limitations

- No due-date reminders or overdue highlighting in the UI — `dueDate` is
  stored and shown, but nothing currently flags a past-due open action.
- `owner` is a free-text string (reassign toggles between two hardcoded
  placeholder values in the current UI), not a reference into a real user/
  role directory.
