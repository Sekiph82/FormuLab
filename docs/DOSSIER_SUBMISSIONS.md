# Dossier submissions (Phase 3)

`packages/shared/src/schemas/dossier.ts` (`regulatoryDossierSubmissionSchema`),
`packages/shared/src/engine/regulatoryDossier.ts`
(`recordDossierSubmission`/`updateDossierSubmissionStatus`).

## Tracking record only — not a portal integration

**This phase does not integrate with any real government or regulatory
authority portal.** A `RegulatoryDossierSubmission` is an internal record of
"we believe we submitted this, here, on this date, and here's what came
back" — nothing more. There is no API call to an external system, no
document actually transmitted by this software, and no verification that a
real authority received anything. The UI must say this plainly wherever a
submission is recorded.

```ts
RegulatoryDossierSubmission {
  id, schemaVersion: "1.0", dossierId, dossierRevision, jurisdiction,
  submissionReference?, submittedBy, submittedAt, submissionChannel?,
  status,     // 9-state internal tracking lifecycle
  notes?, attachmentIds,
  responseReceivedAt?, responseStatus?, responseNotes?,
  updatedBy?, updatedAt,
}
```

## Mutable, not append-only

Unlike reviews and requirement-evidence links, a submission row is a mutable
tracking log (`recordDossierSubmission`/`updateDossierSubmissionStatus`, both
`requireAuthorizedRegulatoryActor`) — its own status changes are edits to the
same row, not a new append-only record each time. This is deliberate: a
submission is not a compliance-critical evidence fact the way a review or a
piece of verified evidence is, and its full history already lives in the
formulation's audit log (`dossier.submission_recorded`,
`dossier.submission_status_changed`), the same way an `ApprovalPolicy`
edit's history lives in the audit log rather than a dedicated revisions
table.

## Status

Implemented, verified by tests (`regulatoryDossierApproval.test.ts`/
`regulatoryDossier.test.ts` — authorization, tracking-only semantics, status
transitions). Submission tracking UI: see [WORKSPACES.md](WORKSPACES.md).
