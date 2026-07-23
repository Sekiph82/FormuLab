# Approval policies

`packages/shared/src/schemas/approvalPolicy.ts`, the "Manage policies"
section inside `apps/desktop/src/components/formula/ApprovalPanel.tsx`.

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
  productFamilyCodes: string[];   // empty = every family
  packagingSkuCodes: string[];    // empty = every SKU
  targetStatus: "pilot_approved" | "production_approved";
  effectiveDate?: string;
  verificationStatus: "verified" | "not_verified";
  active: boolean;                // seeded example ships `false`

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

  createdBy: string; createdAt: string;
  updatedBy?: string; updatedAt: string;
}
```

Nothing in this schema hardcodes a duration or a count.
`minimumRequiredTimePoints` is the closest thing to a duration requirement,
and it is an organization-supplied integer, exactly like the underlying
`StabilityApprovalPolicy` it converts to.

## Persistence

`approval_policies` is a `masterdata.rs` collection like `materials`/
`inventory` — mutable (not append-only), identified by `id`, stored at
`data/master/approval_policies.json`. Every create or `active` toggle also
appends an `approval.policy_changed` audit event to the current
formulation's audit log, so a policy's own history is visible from the
angle of "what did the approver see at the time", even though the storage
layer itself does not version the policy record.

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

Inside the Approval tab, "Manage policies" reveals:

- The list of policies applicable to the currently selected target status
  and product family/SKU (via `policyApplies`), each with an
  Activate/Deactivate toggle.
- A creation form: a name, an `active` checkbox, and one checkbox per
  requirement listed above. Saving calls `upsertRecords("approval_policies", …)`
  and appends `approval.policy_changed`.

The Approval panel's own policy selector then lets the reviewer pick among
the applicable **active** policies for the readiness calculation (or "No
policy", meaning only validation/compatibility/safety/human-review/
optimization/substitution are checked — laboratory and stability are
skipped entirely, same as omitting `labReadiness`/`stabilityReadiness` from
`ApprovalReadinessInput` always did).

## Known limitations

- No edit-in-place for an existing policy's individual requirement
  toggles — only its `active` flag can be flipped after creation.
  Correcting a mistake means deactivating the wrong policy and creating a
  new one.
- `productFamilyCodes`/`packagingSkuCodes` scoping exists in the schema and
  is enforced by `policyApplies`, but the creation form does not yet expose
  fields to set them — every policy created through the UI today is
  unrestricted (applies to every family/SKU) until edited directly in
  `data/master/approval_policies.json`.
- `effectiveDate` and `verificationStatus` are schema fields with no UI
  control yet.
