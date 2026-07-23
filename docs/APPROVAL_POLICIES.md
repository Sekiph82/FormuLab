# Approval policies

`packages/shared/src/schemas/approvalPolicy.ts`, `engine/approvalPolicy.ts`,
the "Manage policies" section inside
`apps/desktop/src/components/formula/PolicyEditor.tsx`.

## What this is

A durable, per-organization record of which laboratory/stability gates (and
the cost-snapshot gate) must be satisfied before a version may be granted
`pilot_approved` or `production_approved`, for which product families and
packaging SKUs. It is the persisted counterpart to the per-call
`LabApprovalPolicy`/`StabilityApprovalPolicy` objects
[APPROVAL_READINESS.md](APPROVAL_READINESS.md) and
[LAB_STABILITY_APPROVAL.md](LAB_STABILITY_APPROVAL.md) already documented —
`engine/approvalReadiness.ts` still never reads a policy record itself;
the Approval panel resolves the applicable `ApprovalPolicy`, converts it
with `toLabApprovalPolicy`/`toStabilityApprovalPolicy`, and passes the
result in exactly as before.

```ts
interface ApprovalPolicy {
  schemaVersion: "1.0";
  id: string;
  name: string;
  description?: string;
  productFamilyCodes: string[];   // empty = every family
  packagingSkuCodes: string[];    // empty = every SKU
  targetStatus: "pilot_approved" | "production_approved";
  effectiveDate?: string;
  verificationStatus: "verified" | "not_verified";
  active: boolean;                // seeded example ships `false`
  retired: boolean;                // terminal — see "Lifecycle" below
  revisionNumber: number;          // what ApprovalPolicyRevision.revisionNumber counts
  priority?: number;                // explicit tie-break — see "Precedence"

  requireCompletedTrial?: boolean;
  requireAllRequiredTestsCompleted?: boolean;
  requireAllCriticalTestsPassed?: boolean;
  requireNoUnresolvedCriticalDeviation?: boolean;
  requireNoUnresolvedCriticalCorrectiveAction?: boolean;

  requireActiveStudy?: boolean;
  requireInitialTestsPassed?: boolean;
  minimumRequiredTimePoints?: number;   // an org's own number — never hardcoded
  requireNoUnresolvedCriticalFailure?: boolean;
  requirePackagingCompatibilityPassed?: boolean;

  requireCostSnapshot?: boolean;

  // Regulatory gates (spec §2.5/§3.3) — see REGULATORY_ENGINE.md.
  requireRegulatoryClassificationCompleted?: boolean;
  requireNoBlockingRegulatoryFinding?: boolean;
  requireAllMandatoryDocumentsPresent?: boolean;
  requireAllMandatoryEvidencePresent?: boolean;
  requireAllRequiredClaimsReviewed?: boolean;
  requireHumanRegulatoryReviewCompleted?: boolean;
  // Which jurisdiction(s) the six gates above evaluate against —
  // does not itself turn any gate on. See "Regulatory jurisdiction scope" below.
  requiredRegulatoryJurisdictions?: RegulatoryJurisdiction[];
  requireAllTargetMarketsReviewed?: boolean;
  allowPrimaryMarketOnly?: boolean;

  createdBy: string; createdAt: string;
  updatedBy?: string; updatedAt: string;
}
```

Nothing in this schema hardcodes a duration or a count.
`minimumRequiredTimePoints` is the closest thing to a duration requirement,
and it is an organization-supplied integer, exactly like the underlying
`StabilityApprovalPolicy` it converts to.

## Lifecycle and revision history

Every mutating action goes through `engine/approvalPolicy.ts`, which
requires a human `Actor` and, for anything except activate/deactivate, a
non-empty reason:

| Action | What happens | Revision `changeType` |
|---|---|---|
| Create | New policy, revision 1 | `created` |
| Edit | Any field except lifecycle flags; requires a change reason | `edited` |
| Activate / Deactivate | Flips `active`; refused once `retired` | `activated` / `deactivated` |
| Retire | Terminal — `retired: true`, `active: false`; cannot be reactivated | `retired` |
| Clone | A brand-new, independent policy (its own id, revision 1, `active: false`) seeded from the source's current fields | `cloned_from` |
| Restore | Applies an old revision's field values as a **new** revision on top of the current one | `restored` |

`ApprovalPolicyRevision` is append-only (`approval_policy_revisions`,
`masterdata.rs`) — a full snapshot of the policy at that point, never
edited or deleted. **Editing, retiring or restoring a policy never
rewrites its own or any other revision's history**; `approval_policies`
itself stays a mutable "current state" row so existing scope-resolution
and Approval-tab selection code keeps reading it the same way, while the
append-only revisions are what actually let a reviewer answer "what did
this policy require last quarter, and who changed it since." Every one of
these actions also appends an `approval.policy_changed` audit event to the
formulation's `audit.jsonl`, naming the change type, the revision number,
and who made it.

Retirement is deliberately one-way: `setPolicyActive`/`editPolicy` both
refuse to touch a retired policy. Cloning or restoring an old revision are
the only ways to get an equivalent policy active again, and both produce a
demonstrably new record rather than resurrecting the old one in place.

## Scope and precedence

The policy editor's scope controls (product families, packaging SKUs) are
each either **All** or **Selected** (with search and multi-select) —
"All" stores an empty array, the same unrestricted-when-empty convention
`TestDefinition` applicability already uses.

When more than one active, non-retired policy matches a given
version's target status/family/SKU, `resolvePolicyPrecedence`
(`schemas/approvalPolicy.ts`) resolves it deterministically, in this
order, never by silently merging their requirements:

1. Exact product family **and** exact packaging SKU
2. Exact product family alone
3. Exact packaging SKU alone
4. A global (fully unscoped) policy
5. Tie-break: the higher explicit `priority`
6. Tie-break: the most recent `effectiveDate`
7. Still tied → a structured `PolicyConflict` is returned instead of a
   guess: `{ targetStatus, productFamilyCode, packagingSkuCode,
   matchingPolicyIds, reason }`

The Approval panel renders an unresolved conflict as a blocker
(`source: "policy"`) with a "Go to" link back into policy management, and
disables Approve until either the ambiguity is fixed (retire/rescope one
of the tied policies) or the reviewer picks one explicitly from the
policy selector — an explicit selection always wins over automatic
resolution.

## Regulatory jurisdiction scope (spec §3.3)

The six regulatory gates (`requireRegulatoryClassificationCompleted`
etc.) are off by default like everything else. Independently, three
fields decide **which jurisdiction(s)** those gates are evaluated
against once turned on — none of the three turns a gate on by itself:

1. `requiredRegulatoryJurisdictions` (an explicit list) — always wins
   when non-empty.
2. Otherwise `requireAllTargetMarketsReviewed: true` — every one of the
   formulation's own `targetMarkets`.
3. Otherwise `allowPrimaryMarketOnly` or nothing set — the formulation's
   first target market only, the exact behavior a policy had before
   multi-jurisdiction support existed.

See `resolveRegulatoryJurisdictions`
(`engine/regulatoryApproval.ts`) and
[REGULATORY_MULTI_MARKET_APPROVAL.md](REGULATORY_MULTI_MARKET_APPROVAL.md).

## Persistence

`approval_policies` (mutable, current state) and
`approval_policy_revisions` (append-only history) are both `masterdata.rs`
collections, stored at `data/master/approval_policies.json` and
`data/master/approval_policy_revisions.json`.

`approval_records` and `approval_audit_events` are deliberately **not**
masterdata collections — see the comment at the top of `masterdata.rs` and
[APPROVAL_WORKFLOW.md](APPROVAL_WORKFLOW.md#audit-and-immutability) for why
(an `ApprovalRecord` already has its own dedicated, per-formulation
storage; an approval audit event is just another line in the same
formulation's existing `audit.jsonl`).

## Seeded example

Exactly one seeded policy ships, and it is **inactive**:

> "Example: require a completed trial before pilot approval (disabled)" —
> `requireCompletedTrial`, `requireAllRequiredTestsCompleted`,
> `requireAllCriticalTestsPassed`, `requireNoUnresolvedCriticalDeviation`,
> `requireNoUnresolvedCriticalCorrectiveAction` all `true`; everything else
> off; `active: false`.

Turning it — or any policy — on is a deliberate organizational act, never a
side effect of opening FormuLab for the first time.

## The panel

Inside the Approval tab, "Manage policies" reveals every policy
(active, inactive and retired, each labelled), each with:

- **Edit** (full field form: name, description, target status, effective
  date, minimum time points, priority, scope, every requirement toggle;
  requires a change reason) — hidden once retired.
- **Activate/Deactivate** — hidden once retired.
- **Clone** (prompts for the new policy's name).
- **Retire** (prompts for a reason) — hidden once already retired.
- **History**, expanding the full revision list (revision number, change
  type, reason, who, when), each with a **Restore** button (disabled on
  the current revision).

The Approval panel's own policy selector then lets the reviewer pick among
the applicable **active** policies for the readiness calculation (or "No
policy", meaning only validation/compatibility/safety/human-review/
optimization/substitution are checked — laboratory and stability are
skipped entirely, same as omitting `labReadiness`/`stabilityReadiness` from
`ApprovalReadinessInput` always did) — or resolves automatically via the
precedence rules above.

## Known limitations

- The scope editor's packaging-SKU options come from the current
  formulation's own `targetSkuCodes`, not a global catalog of every SKU
  in the project — scoping a policy to a SKU the current formulation
  doesn't target requires editing the record directly.
- `verificationStatus` is a schema field with no UI control yet.
