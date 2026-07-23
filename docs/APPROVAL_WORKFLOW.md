# Approval workflow

`apps/desktop/src/components/formula/ApprovalPanel.tsx` (rendered at its
own route, `/approval` — the **Approval workspace** — rather than a tab
inside the Formula Builder; the panel itself is unchanged, only its place
in the navigation moved, see [WORKSPACES.md](WORKSPACES.md#approval) and
[NAVIGATION_AND_CONTEXT.md](NAVIGATION_AND_CONTEXT.md)),
`packages/shared/src/engine/lifecycle.ts`
(`attemptApprovalTransition`), `packages/shared/src/engine/approvalDerivation.ts`.

## What this closes

[APPROVAL_READINESS.md](APPROVAL_READINESS.md) and
[LAB_STABILITY_APPROVAL.md](LAB_STABILITY_APPROVAL.md) both disclosed the
same gap: `assessApprovalReadiness` was implemented and fully tested, but no
screen in the desktop app ever called it. This document describes the
screen that now does, and the real data path feeding it — laboratory and
stability readiness are no longer manually supplied booleans; they are
derived from the persisted `laboratory_trials`/`test_results`/
`trial_deviations`/`corrective_actions`/`stability_studies`/
`stability_samples`/`stability_results`/`stability_failures` collections.

## Reused architecture, not a parallel one

The Approval tab does not introduce a second status mechanism. Granting
`pilot_approved` or `production_approved` still goes through exactly the
same audit-event/`effectiveStatus` mechanism that retire/reject/reopen
already used (`engine/lifecycle.ts`):

```
LIFECYCLE_ACTIONS = {
  "version.retired": "retired",
  "version.rejected": "rejected",
  "version.reopened": "concept",
  "version.approved.pilot_approved": "pilot_approved",
  "version.approved.production_approved": "production_approved",
}
```

`attemptApprovalTransition(currentStatus, to, actor, readiness, opts)` is a
thin wrapper around the pre-existing `canTransitionWithReadiness`
(actor/role authority **and** content readiness, together) that returns one
of the two new `LIFECYCLE_ACTIONS` entries on success. A version file is
never rewritten to say it is approved; an audit event is appended, exactly
like every other status change this platform tracks.

## What the panel actually does (spec §2.1)

1. Selects a saved, immutable version (never the mutable working draft —
   there is no "approve the draft" path; a draft must first become a
   version via the normal Save Version flow).
2. Shows the version's current effective status
   (`effectiveStatus(version, auditLog)`).
3. Offers the one valid next human-only status, computed from the same two
   edges the status graph (`ALLOWED_NEXT`, `schemas/status.ts`) actually
   allows — `pilot_candidate → pilot_approved` and
   `pilot_approved → production_approved`. Any other current status shows
   no target (there is nothing to approve into yet), rather than offering a
   selection that would always be refused as `NOT_A_VALID_TRANSITION`.
4. Loads every readiness source for real (below) and calls
   `assessApprovalReadiness`.
5. Displays every blocker and warning, each labelled with its source and,
   where practical, a "Go to" link that jumps to the relevant tab
   (Builder/Compatibility/Safety/Optimizer/Trials/Tests/Stability/Corrective
   Actions/Cost) and focuses the specific line when one is implicated.
6. Requires a human actor: the reviewer picks a role from `APPROVAL_ROLES`,
   and the Approve button is only enabled when that role is one
   `APPROVAL_AUTHORITY[targetStatus]` actually authorizes.
7. Requires a reviewer display name, a reviewer user id, and a reason —
   none of the three are optional; the button stays disabled without them.
8. Requires explicit confirmation (the Approve click itself; there is no
   auto-approve on readiness alone).
9. Persists an `ApprovalRecord` (see below) and the audit events described
   under "Audit and immutability".
10. Performs the status transition (the `version.approved.*` audit event)
    **only** when `attemptApprovalTransition` returns `allowed: true` — the
    readiness used is recomputed at click time from current state, not a
    value trusted from earlier in the render, so a stale or forged
    "ready" flag cannot slip a blocked approval through.

## Real readiness sources (spec §3), not placeholders

| Source | Where it comes from |
|---|---|
| Validation | `validateFormula(version.lines, template-derived options)` — the same function the Builder itself uses. |
| Compatibility | `evaluateCompatibility(version.lines, compatibility_rules, ...)` — live, same as the Compatibility tab. |
| Safety | `evaluateSafety(...)` + `classifyProductSafety(...)`; `humanReviewAcknowledged` reads real `safety_resolutions` records (`classification:<value>`). |
| Optimization / substitution | The version's `appliedOptimizationRunCode`/`appliedSubstitutionRunCode`, looked up against the real persisted `optimization_runs`/`substitution_runs` — never assumed valid. |
| Laboratory | `deriveLabReadiness` (`engine/approvalDerivation.ts`) — see below. |
| Stability | `deriveStabilityReadiness` (same module) — see [LAB_STABILITY_APPROVAL.md](LAB_STABILITY_APPROVAL.md) and [Packaging compatibility, for real](#packaging-compatibility-for-real). |
| Cost | Not one of `assessApprovalReadiness`'s built-in sources — see [Why cost is a layer up](#why-cost-is-a-layer-up). |

### Laboratory and stability derivation

`deriveLabReadiness`/`deriveStabilityReadiness` turn the real collections
into the plain facts `LabReadinessInput`/`StabilityReadinessInput` always
expected, per [LAB_STABILITY_APPROVAL.md](LAB_STABILITY_APPROVAL.md):

- **Exact version only, by default.** A trial/study counts only when its
  `sourceFormulaVersionId` is the version being approved. An organization
  that wants to accept a named, documented equivalent version passes
  `equivalentVersionIds` explicitly — there is no implicit fallback.
- **Required tests** come from the trial/study's own
  `testRequirementSnapshot` when one exists (see
  [TEST_APPLICABILITY.md](TEST_APPLICABILITY.md)); trials/studies created
  before this phase fall back to a live applicability resolution.
- **Critical corrective actions** only count as unresolved when they are
  tied to a `TrialDeviation` that is itself `severity: "critical"` — a
  corrective action linked to a minor/major deviation does not block this
  check (though it may still surface as a warning elsewhere).

### Packaging compatibility, for real

See [TEST_APPLICABILITY.md](TEST_APPLICABILITY.md#testcapability) for the
`testCapability` field and
`derivePackagingCompatibilityReadiness`'s five-state result
(`passed`/`failed`/`incomplete`/`not_required`/`unknown`). The panel stores
the full five-state read in the approval record's
`stabilityReadinessSnapshot.packagingCompatibilityStatus`, alongside the
boolean (`packagingCompatibilityPassed`) that actually feeds
`assessApprovalReadiness` — so a UI or a later audit can see *why*, not
just pass/fail, and `unknown` is never rendered or stored as if it were
`passed`.

### Why cost is a layer up

`assessApprovalReadiness`'s `ApprovalBlockerSource` union
(`validation`/`compatibility`/`safety`/`human_review`/`optimization`/
`substitution`/`laboratory`/`stability`) is fixed, and that module already
has 38 passing tests this phase deliberately left untouched. Rather than
widen a well-tested contract, the cost-snapshot requirement
(`ApprovalPolicy.requireCostSnapshot`) is enforced one layer up, in the
panel itself: a synthetic blocker with `source: "cost"` is folded into
`effectiveReady` and into the persisted readiness snapshot's `blockers`
array (whose `source` field is a plain string, precisely so a caller may
add sources like this without a schema change). The Approve button is
gated on `effectiveReady`, not on `readiness.ready` alone.

## Approval records (spec §2.2)

`ApprovalRecord` (`schemas/formulation.ts`) is the pre-existing schema,
extended additively — every new field is optional, so a record written
before this phase still parses:

```ts
{
  schemaVersion, id, formulationId, versionId,
  status,                    // the status this record concerns
  decision,                  // "approved" | "rejected" | "cancelled" | "blocked"
  previousStatus, requestedStatus,
  approvedBy, approvedByRole, approvedAt,
  reviewerUserId, reviewerRole,
  justification, notes,
  readinessSnapshot,             // { ready, blockers, warnings } — frozen
  laboratoryReadinessSnapshot,   // the five lab facts, frozen
  stabilityReadinessSnapshot,    // the five stability facts + packaging status, frozen
  regulatorySnapshot,            // multi-jurisdiction regulatory picture, frozen — see below
  validationSnapshot,
  appliedOptimizationRunCode, appliedSubstitutionRunCode,
  costSnapshotId,
  createdAt,                 // when the attempt/dialog opened
}
```

Only `decision: "approved"` ever moves a version's effective status. The
other three are recorded for audit and never touch status — a `blocked`
attempt is exactly the case where readiness or role authority refused the
transition; recording it is what makes "someone tried to approve this
before it was ready" answerable later, without ever having changed
anything.

`save_approval_record` (Rust) is unchanged: it still refuses an
`approvedBy` of "ai"/"system"/"agent"/"model"/"automation"/"import" and
still requires a non-empty justification, exactly as documented in
[FORMULA_VERSIONING.md](FORMULA_VERSIONING.md#approval). It operates on
untyped JSON, so the new fields needed no Rust change at all.

## Regulatory readiness (spec §3.3/§3.9)

Folded into `allBlockers`/`effectiveReady` the same one-layer-up way cost
is (`assessMultiJurisdictionRegulatoryReadiness`,
`engine/regulatoryApproval.ts`) — every jurisdiction
`resolveRegulatoryJurisdictions` resolves for the active policy must be
ready, not just the first one. `formulaVersionId` passed into
`deriveRegulatoryReadiness` is always the panel's real, selected,
**saved** version — a `RegulatoryReview` only ever satisfies the exact
version, jurisdiction, and packaging SKU it was recorded against; a
review for a different version, a working draft, or a wrong
jurisdiction/SKU is never silently treated as covering the version up
for approval. See
[REGULATORY_ENGINE.md](REGULATORY_ENGINE.md#approval-readiness-integration)
and [REGULATORY_MULTI_MARKET_APPROVAL.md](REGULATORY_MULTI_MARKET_APPROVAL.md).

At the moment of decision, `buildRegulatorySnapshot()` freezes the
complete per-jurisdiction picture onto `ApprovalRecord.regulatorySnapshot`:
classification snapshot, finding snapshot, rule-version snapshot, the
ids of the evidence confirmations that were active, the applicable
review's id (if any) and its currentness, plus that jurisdiction's own
ready/blockers — the same "snapshot, don't recompute on read" convention
as `readinessSnapshot`/`laboratoryReadinessSnapshot`/
`stabilityReadinessSnapshot`. A later rule edit, a later review, or a
later confirmation revocation never rewrites a historical approval
record's regulatory picture.

## Audit and immutability (spec §9)

Every step appends to the formulation's existing append-only
`audit.jsonl`, using the pre-existing `appendAudit`/`auditEvent` helpers —
no new persistence mechanism:

| Moment | Action |
|---|---|
| Panel opened for a version | `approval.dialog_opened` |
| A decision is recorded, `approved` | `version.approved.pilot_approved` **or** `version.approved.production_approved`, then `approval.granted` |
| A decision is recorded, `rejected` | `approval.rejected` |
| A decision is recorded, `cancelled` | `approval.cancelled` |
| An approval attempt is refused | `approval.blocked` — no `version.approved.*` event, so status never changes |
| A policy is created or its `active` flag is toggled | `approval.policy_changed` |

`readinessSnapshot`/`laboratoryReadinessSnapshot`/
`stabilityReadinessSnapshot`/`regulatorySnapshot` on an `ApprovalRecord`
are frozen at decision time, the same "snapshot, don't recompute on
read" convention
`totalsSnapshot`/`validationSnapshot` on `FormulationVersion` already use
(see [FORMULA_VERSIONING.md](FORMULA_VERSIONING.md#what-a-version-records)).
A later edit to a trial, a study, or a policy never rewrites a historical
approval record.

Production approval still never propagates to a clone, a restore, or any
draft-creation path (corrective action, stability failure, optimization
result, substitution result) — every one of those calls `createVersion`
(or the draft equivalent), which unconditionally sets `status: "concept"`
regardless of the parent's status. This was already true before this
phase (see [FORMULA_VERSIONING.md](FORMULA_VERSIONING.md#approval)); this
phase adds test coverage against the new `ApprovalRecord`/lifecycle
mechanism specifically (`engine/lifecycle.test.ts`).

## Equivalent versions

An authorized human can declare that a **different** formula version's
laboratory/stability evidence may count toward the version being
approved — spec closure for `equivalentVersionIds`, which existed as an
engine parameter with no UI. The "Equivalent versions" workflow inside the
Approval tab (`EquivalenceWorkflow.tsx`, `engine/equivalence.ts`):

- Shows a real field-level comparison (`compareVersions` — lines
  added/removed/changed, active-matter delta, packaging-SKU
  additions/removals) plus live compatibility/safety finding counts for
  both versions, before a justification is even typed. Process
  instructions are NOT part of this comparison — they live on trials/
  studies, not on the formula version itself, and the panel says so
  rather than silently omitting it.
- Requires a justification and an `evidenceReuseScope`
  (`laboratory_only`/`stability_only`/`laboratory_and_stability`).
- Refuses a non-human actor (`declareEquivalence`).
- Persists an append-only `FormulaVersionEquivalence`
  (`formula_version_equivalences`) — revoking one appends a second record
  with `revokesEquivalenceId` set rather than editing or deleting the
  first; "is this currently active" is computed live by checking for a
  revocation, the same overlay convention `effectiveStatus` already uses.
- Feeds `deriveLabReadiness`/`deriveStabilityReadiness` via
  `equivalentVersionIdsFor(sourceVersionId, scope, equivalences)`.
- Surfaces in the Laboratory/Stability summary cards as "Includes evidence
  from equivalent version(s): …" whenever an active declaration applies —
  never silent.

## Known limitations

- The Approval tab lets a chemist pick *any* saved version of the current
  project, not only the one the working draft descends from — this is
  deliberate (spec: "select a saved immutable formula version"), but means
  the tab's own version selector is independent of the Builder's "current"
  version.
- No real GUI/WebDriver-driven end-to-end run of the Approval tab exists
  in this environment (no attached display, no `tauri-driver`) — see
  [APPROVAL_MANUAL_SMOKE_TEST.md](APPROVAL_MANUAL_SMOKE_TEST.md) for the
  manual checklist and exactly what automated coverage exists instead.
