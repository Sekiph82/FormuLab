# Laboratory and stability approval readiness

`packages/shared/src/engine/approvalReadiness.ts`
(`LabApprovalPolicy`/`LabReadinessInput`, `StabilityApprovalPolicy`/
`StabilityReadinessInput`, the `"laboratory"`/`"stability"`
`ApprovalBlockerSource` branches inside `assessApprovalReadiness`),
`apps/desktop/src/app/routes/FormulasPage.tsx`'s approval screen. Extends
the pre-existing [Approval Readiness](APPROVAL_READINESS.md) service — this
phase's job was closing the gap where that service was implemented but not
connected to the desktop approval action for lab/stability requirements.

## Configurable, never hardcoded

Every requirement below is **optional and off by default**. An
organization turns on exactly the gates it wants via
`LabApprovalPolicy`/`StabilityApprovalPolicy`; nothing here hardcodes "3
completed trials" or "6/12 months of stability data" — the closest thing to
a duration requirement is `StabilityApprovalPolicy.minimumRequiredTimePoints`,
an organization-configured integer the caller sets explicitly.

```ts
interface LabApprovalPolicy {
  requireCompletedTrial?: boolean;
  requireAllRequiredTestsCompleted?: boolean;
  requireAllCriticalTestsPassed?: boolean;
  requireNoOpenCriticalDeviation?: boolean;
  requireNoOpenCriticalCorrectiveAction?: boolean;
}

interface StabilityApprovalPolicy {
  requireActiveStudy?: boolean;
  requireInitialTestsPassed?: boolean;
  minimumRequiredTimePoints?: number;
  requireNoOpenCriticalFailure?: boolean;
  requirePackagingCompatibilityPassed?: boolean;
}
```

The caller supplies both the policy AND the current facts
(`LabReadinessInput`/`StabilityReadinessInput` — `hasCompletedTrial`,
`allRequiredTestsCompleted`, `completedTimePointCount`, etc.); the service
itself never queries `laboratory_trials`/`stability_studies` directly.

## Structured blockers

`assessApprovalReadiness` appends one blocker per unmet, policy-enabled
requirement, each with a stable `code` a UI can key off of (not just a
message string):

| Code | Source | Meaning |
|---|---|---|
| `missing_required_trial` | `laboratory` | No completed trial exists and the policy requires one. |
| `trial_not_completed` | `laboratory` | Not every required test has a recorded result yet. |
| `critical_test_failed` | `laboratory` | A test flagged critical has not passed. |
| `critical_deviation_open` | `laboratory` | A critical trial deviation is still open/under review. |
| `critical_corrective_action_open` | `laboratory` | A corrective action tied to a critical lab issue is not yet `effective`. |
| `stability_study_missing` | `stability` | No active/completed stability study exists and the policy requires one. |
| `initial_stability_tests_failed` | `stability` | The study's initial time-point tests have not all passed. |
| `required_time_point_missing` | `stability` | Fewer completed time points than `minimumRequiredTimePoints`. |
| `stability_failure_open` | `stability` | A critical stability failure is still open. |
| `packaging_test_failed` | `stability` | Packaging compatibility testing has not passed. |

Every blocker is returned even when several apply simultaneously — the
approval screen shows the whole list, not just the first failure.

## Engine-level integration, not yet a desktop approval screen

`assessApprovalReadiness` accepts `labReadiness`/`stabilityReadiness` and
produces the ten blocker codes above — this half of the work is complete
and fully tested (`approvalReadiness.test.ts`, 38 tests including the
lab/stability additions). But — consistent with
[APPROVAL_READINESS.md](APPROVAL_READINESS.md#what-this-does-not-do)'s own
disclosure — **no screen in `apps/desktop/src` currently calls
`assessApprovalReadiness` at all**, for any source (validation,
compatibility, safety, or lab/stability). There is no "approve this
version" UI action anywhere in the desktop app yet; the only version-status
transitions wired into `FormulasPage.tsx` today are retire/reject/reopen
(`onLifecycleAction`), never a transition *into* `pilot_approved`/
`production_approved`. Building that approval action is a pre-existing gap
that predates this phase and is not specific to laboratory/stability — it
applies equally to the validation/compatibility/safety sources this module
already supported before this phase's work. An organization integrating
this module today would call `assessApprovalReadiness` from its own
approval-action code path, supplying `labReadiness`/`stabilityReadiness`
alongside the other five sources, exactly as documented above.

## Human-only, always

Regardless of policy configuration, nothing in this phase allows an
AI/system/import/migration/restore/clone actor to bypass a gate: completing
a trial, resolving a critical deviation/failure, verifying corrective-
action effectiveness, and approving a formula version all independently
require a human actor at the point each action is taken (see
[LABORATORY_TRIALS.md](LABORATORY_TRIALS.md#lifecycle),
[TRIAL_EXECUTION.md](TRIAL_EXECUTION.md#deviations),
[STABILITY_TRENDS.md](STABILITY_TRENDS.md#failures),
[CORRECTIVE_ACTIONS.md](CORRECTIVE_ACTIONS.md#lifecycle), and the
pre-existing formula-approval `Actor` check in
[APPROVAL_READINESS.md](APPROVAL_READINESS.md)). The approval-readiness
service adds *additional* blockers on top of those independent guards; it
does not replace them.

## Known limitations

- **No desktop approval-action screen exists yet** (see above) — this is
  the most significant limitation in this area, and it is a pre-existing
  gap across all five approval-readiness sources, not something introduced
  by or specific to this phase's lab/stability work.
- `packaging_test_failed` reads a single boolean (`packagingCompatibilityPassed`)
  the caller supplies — there is no dedicated packaging-compatibility test
  type distinct from an ordinary numeric/pass-fail test definition tagged
  for that purpose.
- Policies are per-call parameters, not yet a persisted per-organization
  settings record — a real deployment would need its own settings UI/storage
  to make a chosen policy durable across sessions.
