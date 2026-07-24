# Dossier requirements (Phase 3)

`packages/shared/src/schemas/dossier.ts` (`regulatoryDossierRequirementSchema`),
`packages/shared/src/engine/regulatoryDossier.ts`
(`resolveDossierRequirements`/`buildDossierRequirementSnapshot`/
`currentRequirementsForRevision`/`addManualRequirement`/`excludeRequirement`/
`compareDossierRequirementsToCurrentRules`). See
[REGULATORY_DOSSIERS.md](REGULATORY_DOSSIERS.md) for the parent record and
[EVIDENCE_MATRIX.md](EVIDENCE_MATRIX.md) for how a requirement's satisfaction
is computed.

## Frozen per revision, not live-computed

A `RegulatoryDossierRequirement` row is generated once, when a dossier
revision is created, from the same rule/classification/finding engine Phase 2
built (`REGULATORY_RULE_TYPES`, `RegulatoryRule`, `RegulatoryFinding`) — never
invented. `resolveDossierRequirements(ctx)` filters active, non-deprecated
rules by jurisdiction (including the EAC overlay for East African Community
markets), maps each to a requirement row via `RULE_TYPE_TO_REQUIREMENT_TYPE`,
and derives `applicabilityStatus`/`applicabilityReason` from any matching
`RegulatoryFinding`. `mandatory` is true for `blocking`/`warning` severity;
`critical` is true only for `blocking`. The exact rule id and version used are
frozen onto the row (`sourceRuleId`/`sourceRuleVersion`) — a later edit to the
live rule can never retroactively change what a past dossier revision
required.

```ts
RegulatoryDossierRequirement {
  id, schemaVersion: "1.0", dossierId, dossierRevision,
  jurisdiction, requirementCode,   // "${ruleCode}:${jurisdiction}"
  requirementType,                 // 15 values, e.g. document/laboratory_evidence/artwork
  title, description?,
  sourceRuleId?, sourceRuleVersion?, sourceAuthority?, sourceReference?,
  isManual,                        // false for rule-generated rows
  mandatory, critical,
  applicabilityStatus,             // applicable/not_applicable/conditionally_applicable/human_review_required/unknown
  applicabilityReason,
  evidenceRequirement, documentTypesAccepted, minimumEvidenceCount, expiryPolicy?,
  status,                          // "active" | "excluded"
  createdAt,
}
```

## Append-only per requirement code

Requirements are append-only per `(dossierId, dossierRevision,
requirementCode)`. A manual exclusion (`excludeRequirement`) never edits the
original row — it appends a new row with `status: "excluded"`.
`currentRequirementsForRevision(all, dossierId, dossierRevision)` returns the
latest row per code, so "frozen when the revision is created" stays literally
true for the rule-generated content while still letting a reviewer exclude a
specific requirement within that same revision, with the full history
retained.

## Manual requirements and exclusions

`addManualRequirement(dossier, input, actor, justification)` and
`excludeRequirement(requirement, actor, justification)` both require
`requireAuthorizedRegulatoryActor` and a non-empty justification. A manual
requirement is clearly marked (`isManual: true`); an excluded one keeps its
original row untouched in history and is visibly `excluded`, never silently
absent. **A critical requirement cannot be dismissed by a casual checkbox** —
exclusion always goes through this authorized, justified, audited path
(`dossier.requirement_excluded`).

## Drift: frozen requirements vs. today's rules

`compareDossierRequirementsToCurrentRules(frozen, ctx)` re-runs
`resolveDossierRequirements` against the CURRENT rule set and diffs it
against what the dossier revision actually froze, by `requirementCode`:
new requirement codes, removed codes, changed rule version, changed
mandatory/critical status, changed accepted evidence types, changed
jurisdiction applicability. This is a read-only comparison — it never mutates
the historical dossier revision. A reviewer sees the drift and decides
whether it warrants a new revision; nothing here rewrites history
automatically.

## Status

Implemented, verified by tests (`regulatoryDossier.test.ts` — requirement
generation, EAC overlay, frozen rule id/version, latest-wins overlay, manual
add/exclude authorization, drift comparison). Requirement-generation UI
(reviewing/excluding/adding manually from the Dossiers workspace): see
[WORKSPACES.md](WORKSPACES.md) for current status.
