# Evidence matrix engine (Phase 3)

`packages/shared/src/engine/regulatoryDossier.ts`
(`evaluateEvidenceEligibility`/`evaluateRequirementSatisfaction`/
`buildEvidenceMatrix`), `packages/shared/src/schemas/dossier.ts`
(`dossierRequirementRowSchema`). See [DOSSIER_REQUIREMENTS.md](DOSSIER_REQUIREMENTS.md)
and [DOSSIER_EVIDENCE.md](DOSSIER_EVIDENCE.md) for the two records this
combines, and [DOSSIER_READINESS.md](DOSSIER_READINESS.md) for the
dossier-level summary built on top of this matrix.

## What it computes

For every requirement in a dossier revision, the matrix computes: jurisdiction,
mandatory/optional, critical/non-critical, applicability, accepted evidence
types, linked evidence, verification state, expiry state, whether the linked
evidence actually matches this exact formula version/packaging SKU/
jurisdiction, the resulting satisfaction state, a blocking reason when
unsatisfied, and the most recent activity timestamp. `buildEvidenceMatrix`
returns one `DossierRequirementRow` per current (non-excluded) requirement.

This is entirely a **computed view** — none of it is stored on the
requirement row itself (which stays frozen). Re-running the matrix after new
evidence is linked or verified always reflects the current, real state; it
never silently drifts from what the underlying records actually say.

## Eligibility before verification

`evaluateEvidenceEligibility(evidence, ctx)` runs before verification is even
considered, and rejects — with a reason — an evidence item that is: the
wrong formula version, the wrong packaging SKU, missing this jurisdiction,
`rejected`, `revoked`, `superseded`, or past its `expiresAt`. **An evidence
item cannot satisfy a requirement just because it exists somewhere in the
dossier** — it has to be eligible for this exact requirement's scope first.

## Satisfaction logic ("unknown is contagious")

`evaluateRequirementSatisfaction(requirement, links, evidenceItems, ctx)`
branches in this order:

1. **Applicability first.** `excluded` requirement status → `not_applicable`.
   `applicabilityStatus: "not_applicable"` → `not_applicable`.
   `applicabilityStatus` of `unknown` or `human_review_required` →
   `"unknown"`, with `blockingReason: "applicability_unknown"`. **Unknown
   never becomes satisfied** — an applicability question left open by the
   classifier stays visibly open here, it is never silently treated as
   resolved.
2. **Evidence linkage.** No `accepted` link at all → `missing` (mandatory) or
   `not_started` (optional).
3. **Eligibility filtering.** Ineligible links (wrong version/SKU/
   jurisdiction/expired/rejected/revoked/superseded — see above) are excluded
   before counting toward satisfaction.
4. **Verification count vs. `minimumEvidenceCount`.** Verified, eligible
   evidence meeting the required count → `satisfied_verified`. Eligible
   evidence meeting the count but still unverified → `satisfied_unverified`
   (linking and uploading are not verifying). Below the required count →
   `partially_satisfied`.

`DOSSIER_REQUIREMENT_SATISFACTION_STATUSES` (11): `not_started`, `missing`,
`partially_satisfied`, `satisfied_unverified`, `satisfied_verified`,
`rejected`, `expired`, `revoked`, `not_applicable`, `blocked`, `unknown`.

## Status

Implemented, verified by tests (`regulatoryDossier.test.ts` — missing vs.
not-started, unverified ≠ verified, expired, excluded, unknown/human-review
propagation, insufficient count). Matrix UI (table with requirement/
jurisdiction/mandatory/applicability/linked-evidence/satisfaction/blocking-
reason/last-activity columns, plus CSV/Excel export) is implemented in
`DossierPanel.tsx`'s Evidence Matrix section — see
[WORKSPACES.md](WORKSPACES.md#dossiers). No column-level filtering UI yet
(the full matrix always renders); the underlying data supports it.
