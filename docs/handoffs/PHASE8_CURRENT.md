# Phase 8 — Reports, Dossiers, Document Exports, Final Data Exchange Expansion

## Current status
Session 6 complete: every PDF/DOCX export attempt (Dossiers workspace)
now persists a `generated_document_records` row — created `generating`
before render, updated in place to `succeeded`/`failed`/`cancelled` —
plus a `dossier.export_succeeded`/`_failed`/`_cancelled` audit event.
Export actions are gated on the existing regulatory/quality/administrator
role model, checked before any record is created.

## Persistence model
Reused the Session 1 `GeneratedDocumentRecord` schema unchanged (no
second record shape). New collection `generated_document_records`,
allow-listed in `masterdata.rs`/`masterdata.ts`, `append_only: false`
(mutable — status changes in place, same pattern as
`regulatory_evidence_items`/`doe_observations`; full history lives in
the audit log, not a second append-only table). Keyed by `id` (row has
no separate `code`), confirmed via `row_key()`. New
`apps/desktop/src/lib/documentExports/exportHistory.ts`:
`sha256Hex`, `startExportRecord`, `finalizeExportSucceeded`,
`finalizeExportFailed`, `finalizeExportCancelled`, `listExportHistory`.

## Integrity rules enforced
Succeeded requires fileName+mimeType+positive byteSize+checksum, forbids
error fields. Failed requires errorCode+errorMessage, forbids all
success file fields. Cancelled forbids both. `fileName` schema-refined
to reject absolute/UNC/drive paths — export flow only ever builds
`{dossierCode}-rev{revision}.{format}`, never an absolute path. Export
flow never calls any dossier-mutating `upsertRecords` — only
`generated_document_records`. Source dossier id/code/revision/formula
version recorded from the live snapshot exactly, before any render
happens.

## Audit and authorization
`requireAuthorizedRegulatoryActor` checked first, before
`startExportRecord` — an unauthorized role gets no history row at all
(buttons are also hidden via existing `canActRegulatory`). Every
terminal state (succeeded/failed/cancelled) appends one audit event via
the existing `appendAudit`/`auditEvent` helpers with the real acting
human's `userId` — export never approves/verifies/submits/mutates the
dossier itself.

## Files changed this session
`apps/desktop/src-tauri/src/masterdata.rs` (+1 collection, +1 test, 87→88),
`apps/desktop/src/lib/masterdata.ts` (+1 collection type),
`apps/desktop/src/lib/documentExports/exportHistory.ts` (new, +10 tests),
`apps/desktop/src/lib/documentExports/index.ts` (barrel export),
`apps/desktop/src/lib/download.ts` (`saveBinaryWithFeedback` now returns
`SaveResult` and re-throws on failure so a caller can record the
outcome), `.test.ts` (+2 tests, 1 renamed),
`apps/desktop/src/components/formula/DossierPanel.tsx` (export flow
rewritten: history record + audit at each terminal state, authorization
gate), `.test.tsx` (+8 tests: success, render failure, save failure,
cancellation, unauthorized-role block, source traceability, no-mutation
rewritten to allow the new collection).

## Focused tests passing
Desktop: `exportHistory.test.ts` 10/10, `download.test.ts` 7/7,
`DossierPanel.test.tsx` 26/26. Rust: `cargo test --lib masterdata::`
12/12. Desktop typecheck clean, desktop lint clean. Shared package
untouched this session — no shared typecheck needed.

## Known limitations
No dedicated export-history viewer UI yet (`listExportHistory` exists,
unused by any screen) — Reports/Dossiers still only show live
generate/export actions, not past attempts. No retention/cleanup policy
for `generated_document_records` rows.

## Recommended sessions (unchanged plan, see external log for detail)
7. Focused Phase 8 verification (next)
8. Closure: full regression, release, installers, shortcut, native verify

## Exact next session
Phase 8 Session 7: Focused Phase 8 Verification.
