# Approval readiness

`packages/shared/src/engine/approvalReadiness.ts`.

## What this is

The single place that decides whether a formula version's **content** is
ready for the approval workflow to even begin — separate from, and in
addition to, the **actor** gate. `canTransitionTo`
(`packages/shared/src/schemas/status.ts`, see
[FORMULA_VERSIONING.md](FORMULA_VERSIONING.md#approval)) refuses
`pilot_approved`/`production_approved` to any actor that is not a human, no
matter what the formula contains. This module refuses the same transitions
when the formula itself is not in an approvable state, no matter who is
asking. Both gates are required; neither substitutes for the other.

## Shape

```typescript
interface ApprovalBlocker {
  id: string;
  source: "validation" | "compatibility" | "safety" | "human_review";
  message: string;
  lineId?: string;
  code?: string;
}

interface ApprovalWarning {
  id: string;
  source: "validation" | "compatibility" | "safety" | "human_review";
  message: string;
  lineId?: string;
}

interface ApprovalReadiness {
  ready: boolean;
  blockers: ApprovalBlocker[];
  warnings: ApprovalWarning[];
}
```

## What blocks readiness

`assessApprovalReadiness(input)` walks four sources and is deterministic —
the same inputs always produce the same blockers, in the same order, so it
can be re-run on every save, before showing an approval dialog, or in a test
without surprise:

1. **Formula validation findings** at `blocking` or `error` severity (not
   just the four literally-blocking codes — total ≠ 100, a q.s. gone
   negative, a non-human approval attempt — but also a validation `error`,
   which is still a data-integrity problem an approver should not be able to
   wave through silently). A `warning`-severity finding is a warning, not a
   blocker.
2. **Compatibility findings** at `blocking` severity (see
   [COMPATIBILITY_ENGINE.md](COMPATIBILITY_ENGINE.md)) — `warning` and
   `error` severities are warnings here, not blockers.
3. **Safety findings** at `blocking` severity (see
   [SAFETY_ENGINE.md](SAFETY_ENGINE.md)) — same warning/blocker split.
4. **Unresolved mandatory human review**: if the product's safety
   classification is one of the classifications in
   `HUMAN_REVIEW_CLASSIFICATIONS` and `humanReviewAcknowledged` is not set,
   a `human_review` blocker is added regardless of whether any other finding
   exists.

A compatibility or safety finding stops blocking only once its id appears in
`resolvedFindingIds` — i.e. only after a formal resolution record exists for
it (a `SafetyResolution`, or the equivalent for compatibility). There is no
other way to clear one; a blocker does not disappear because a message says
to ignore it, and nothing AI-generated can shrink `blockers` by asserting the
formula is fine.

`ready` is `blockers.length === 0`. Warnings never affect `ready` — they are
surfaced so a chemist sees them, but a warning does not block saving or
progressing the draft.

## Gating the transition

```typescript
function canTransitionWithReadiness(
  from: FormulaStatus,
  to: FormulaStatus,
  actor: Actor,
  readiness: ApprovalReadiness,
  opts?: { hasApprovalRecord?: boolean },
): TransitionResult
```

This is the one call site every path is expected to go through to attempt an
approval transition: it runs `canTransitionTo` (actor/role authority) first,
and if that passes, additionally refuses `pilot_approved` or
`production_approved` (`HUMAN_ONLY_STATUSES`) when `readiness.ready` is
false, returning `NOT_READY_FOR_APPROVAL` with up to three blocker messages
inlined. Calling `canTransitionTo` directly instead still cannot grant a
human-only status without a human actor and an approval record — but it
would skip the content check, so `canTransitionWithReadiness` is the correct
entry point wherever readiness has already been computed.

This applies identically regardless of how the transition is attempted: a UI
button, a domain-service call, an import, a version restore, a clone, or an
agent event. None of those paths grant an exemption — see
`packages/shared/src/engine/approvalReadiness.test.ts` (16 tests) and
`versioning.test.ts` for the bypass-attempt coverage, including agent/system/
import actors and legacy-data migration paths.

## What this does not do

- Does not itself compute validation, compatibility or safety findings — it
  consumes what those three engines already produced.
- Does not decide *who* may approve; that is `canTransitionTo`'s job, kept
  separate on purpose so the actor rule and the content rule can each be
  reasoned about independently.
- Does not auto-resolve anything. A blocker clears only when a listed source
  condition genuinely changes — a resolution record is created, a line is
  fixed, a validation severity drops.
