# Dossier readiness (Phase 3)

`packages/shared/src/engine/regulatoryDossier.ts` (`calculateDossierReadiness`),
`packages/shared/src/schemas/dossier.ts` (`dossierReadinessSchema`,
`DOSSIER_READINESS_STATES`), `packages/shared/src/engine/regulatoryDossierApproval.ts`
(`deriveDossierApprovalReadiness` — see [APPROVAL_READINESS.md](APPROVAL_READINESS.md)
for how this feeds into the Approval workspace). Builds on
[EVIDENCE_MATRIX.md](EVIDENCE_MATRIX.md).

## The seven states

`DOSSIER_READINESS_STATES`: `not_ready`, `partially_ready`,
`ready_for_review`, `under_review`, `review_complete`, `blocked`, `unknown`.

**`unknown` must never become `ready`.** `calculateDossierReadiness` checks
this first, before anything else: if any requirement's matrix row resolved
to `human_review_required` (applicability left open), the overall readiness
is `"unknown"` regardless of how much evidence is verified elsewhere. This is
the single highest-priority rule in the function — a classifier's open
question is never papered over by unrelated progress.

After that:

1. The dossier's own stored status wins for `under_review`,
   `review_complete`, `approved_for_submission`, and `submitted` — those are
   states a human explicitly put the dossier into, and the readiness
   calculation defers to them rather than recomputing a conflicting answer.
2. If every mandatory requirement is `missing` → `not_ready`.
3. If some but not all mandatory requirements are satisfied (in any state
   short of fully verified) → `partially_ready`.
4. Only when every mandatory requirement is `satisfied_verified` →
   `ready_for_review`.

`DossierReadiness` also surfaces counts (mandatory/optional/critical
requirement counts, satisfied/missing/expired/rejected counts) and warnings
(e.g. evidence nearing expiry) alongside the single overall state, so a UI
can show both the headline state and why.

## Multi-jurisdiction dossiers

A dossier spanning several jurisdictions computes readiness per
jurisdiction internally where the underlying requirements differ — the
Dossiers workspace UI must show each jurisdiction's picture distinctly and
must never merge conflicting market requirements into one fake universal
answer (see [WORKSPACES.md](WORKSPACES.md) for the UI's current state).

## Status

Implemented, verified by tests (`regulatoryDossier.test.ts` — no
requirements, missing mandatory, unverified evidence, all verified,
human-review-required always unknown, expiry warnings). Readiness badge/UI:
see [WORKSPACES.md](WORKSPACES.md).
