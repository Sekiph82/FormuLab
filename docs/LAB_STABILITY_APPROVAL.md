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

## Wired into the desktop Approval tab

`assessApprovalReadiness` accepts `labReadiness`/`stabilityReadiness` and
produces the ten blocker codes above (`approvalReadiness.test.ts`, 38
tests). The desktop Approval tab
(`apps/desktop/src/components/formula/ApprovalPanel.tsx`) now calls it for
every source, lab/stability included — see
[APPROVAL_WORKFLOW.md](APPROVAL_WORKFLOW.md). `labReadiness`/
`stabilityReadiness` are no longer manually supplied booleans: they are
derived from the real `laboratory_trials`/`test_results`/
`trial_deviations`/`corrective_actions`/`stability_studies`/
`stability_samples`/`stability_results`/`stability_failures` collections by
`deriveLabReadiness`/`deriveStabilityReadiness`
(`engine/approvalDerivation.ts`).

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

- `packaging_test_failed` still reads the boolean
  `packagingCompatibilityPassed` — but that boolean is now itself derived
  from real test results via `derivePackagingCompatibilityReadiness`, keyed
  off a dedicated `testCapability` field
  (`packaging_compatibility`/`seal_integrity`/`leak_test`), not a
  display-name text match. See
  [TEST_APPLICABILITY.md](TEST_APPLICABILITY.md#testcapability) and
  [APPROVAL_WORKFLOW.md](APPROVAL_WORKFLOW.md#packaging-compatibility-for-real).
- Policies are now a persisted, per-organization `ApprovalPolicy` record
  (`approval_policies`) with a UI to create and activate/deactivate them —
  see [APPROVAL_POLICIES.md](APPROVAL_POLICIES.md). Editing an existing
  policy's individual requirement toggles after creation is not yet
  supported from the UI.
