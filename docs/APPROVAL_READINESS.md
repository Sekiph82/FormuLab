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

`assessApprovalReadiness(input)` walks nine sources and is deterministic —
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
5. **An applied optimization run whose stored result was not actually
   usable**: if `FormulationVersion.appliedOptimizationRunCode` is set, the
   caller looks up the real, persisted `OptimizationRun` by that code and
   reports its stored `result.status` as `appliedOptimizationRun`. A status
   other than `optimal`/`feasible` — or no such run existing at all — blocks
   with an `optimization` source. This is a defensive re-check against a
   forged or stale reference, not a duplicate of the solver: the solver
   already refused to report `optimal` for an infeasible problem: see
   [ADVANCED_OPTIMIZER.md](ADVANCED_OPTIMIZER.md).
6. **An applied substitution run whose stored result had no valid
   candidate**: the same re-check for `appliedSubstitutionRunCode` against
   the persisted `SubstitutionRun.result.status` (`substitution` source) —
   see [MATERIAL_SUBSTITUTION.md](MATERIAL_SUBSTITUTION.md).
7. **An applied substitution run with no selected candidate, or a selected
   candidate that is itself blocked**: even when 6's status check passes
   (`candidates_found`), the caller also reports whether the run actually
   has a `selectedCandidateId` and whether that specific candidate carries a
   blocking compatibility/safety finding. A run that only ever browsed
   candidates without applying one, or whose "applied" candidate turns out
   to be the blocked one, blocks readiness the same as a missing run would
   — this closes the gap where "a run exists and found *some* candidates"
   was being read as "a valid candidate was actually chosen and applied."

8. **Laboratory readiness** (opt-in via `LabReadinessInput.policy`) — five
   blocker codes covering a completed trial, required tests, critical
   trial deviations, and critical lab corrective actions.
9. **Stability readiness** (opt-in via `StabilityReadinessInput.policy`) —
   five more blocker codes covering an active/completed study, initial
   test results, a configurable minimum time-point count, critical
   stability failures, and packaging compatibility.

See [LAB_STABILITY_APPROVAL.md](LAB_STABILITY_APPROVAL.md) for the full
policy shape and blocker-code table — never a hardcoded duration
requirement, and (like 5–7 above) off entirely unless the caller opts in.

Optimization and substitution runs are opt-in checks: a version with neither
`appliedOptimizationRunCode` nor `appliedSubstitutionRunCode` set (the
common case — most versions are authored directly) is unaffected by 5–7.
Applying an optimization or substitution result is itself never an approval
— see [ADVANCED_OPTIMIZER.md](ADVANCED_OPTIMIZER.md#workflow) and
[MATERIAL_SUBSTITUTION.md](MATERIAL_SUBSTITUTION.md#workflow-spec-56):
both workflows only ever produce a new working draft, and AI explanation
text generated alongside either has no path to `blockers`.

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
`packages/shared/src/engine/approvalReadiness.test.ts` (38 tests, including
the 7 optimization/substitution stored-status checks and the lab/stability
readiness checks above) and `versioning.test.ts` for the bypass-attempt
coverage, including agent/system/import actors and legacy-data migration
paths.

## What this does not do

- Does not itself compute validation, compatibility or safety findings — it
  consumes what those three engines already produced.
- Does not decide *who* may approve; that is `canTransitionTo`'s job, kept
  separate on purpose so the actor rule and the content rule can each be
  reasoned about independently.
- Does not auto-resolve anything. A blocker clears only when a listed source
  condition genuinely changes — a resolution record is created, a line is
  fixed, a validation severity drops.
- Is now called from the desktop Approval tab
  (`apps/desktop/src/components/formula/ApprovalPanel.tsx`) — see
  [APPROVAL_WORKFLOW.md](APPROVAL_WORKFLOW.md) for the full flow: every
  source above is populated from real, persisted records, not a placeholder,
  and `pilot_approved`/`production_approved` are gated on this module's
  output via `attemptApprovalTransition`
  (`engine/lifecycle.ts`, which wraps `canTransitionWithReadiness`).

## Phase 3: dossier readiness as an independent, opt-in blocker source

`packages/shared/src/engine/regulatoryDossierApproval.ts`'s
`deriveDossierApprovalReadiness` is a **separate** module, not part of this
one's fixed blocker-source union — it is entirely inert
(`{ ready: true, blockers: [] }`) unless the policy's
`requireRegulatoryDossier` field is set, so installing Phase 3 never blocks
an existing project that has not opted in (see
[REGULATORY_DOSSIERS.md](REGULATORY_DOSSIERS.md) and
[DOSSIER_READINESS.md](DOSSIER_READINESS.md)). When opted in, it resolves the
exact `RegulatoryDossier` for the formula version/packaging SKU/jurisdiction
in scope via `findDossierForScope` — never a same-project-different-scope
dossier treated as a match — and pushes one of ten structured blocker codes
(`dossier_missing`, `dossier_wrong_formula_version`,
`dossier_wrong_packaging_sku`, `dossier_jurisdiction_missing`,
`dossier_not_ready`, `dossier_requirement_stale`,
`dossier_review_incomplete`, `dossier_mandatory_evidence_missing`,
`dossier_evidence_rejected`, `dossier_evidence_expired`) when the
corresponding opt-in field requires it. At the moment an `ApprovalRecord` is
actually created, the dossier readiness at that instant is frozen onto the
record as `dossierSnapshot` — a later dossier change never rewrites an
already-created approval record's snapshot.
