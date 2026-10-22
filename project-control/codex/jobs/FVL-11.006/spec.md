# FVL-11.006 acceptance specification

## Goal

Re-verify role policy, authorization, human approval, and lifecycle transition gates, including explicit denial of AI/system auto-approval.

## Acceptance criteria

- Every registered masterdata collection resolves to a known policy area; unknown collections/areas/actions default-deny.
- Approval/verification roles match the canonical authority sets for pilot and production gates.
- Worker-tier roles can submit but cannot approve; an agent/system actor cannot perform human-only approval or verification actions.
- Lifecycle transitions and required justifications are checked independently of role authorization.
- The trusted authenticated actor identity overrides caller-provided identity fields.
- Targeted shared-engine and Rust policy tests pass. No live user/workspace data or approval is created.

## Scope boundaries

Do not weaken authorization or synthesize an approval to make an acceptance test pass. Change only stale verification assertions exposed by current canonical policy data.
