# Phase 8 — Reports, Dossiers, Document Exports, Final Data Exchange Expansion

## Current status
Session 7 complete: full Phase 8-focused test set (Sessions 1–6) run
together for the first time. One genuine Phase 8 defect found and
fixed — a stale UI test — everything else was already green. All
integrity safeguards (export history honesty, traceability, no dossier
mutation, authorization gating, watermark honesty, binary fidelity,
import safety, disabled export-only templates, no absolute paths)
reconfirmed passing.

## Defect found and fixed
`apps/desktop/src/app/routes/DataExchangePage.test.tsx` — "shows all 35
template cards by default" still asserted the pre-Session-5 template
count. Session 5 grew the registry from 35 to 41 templates (already
correctly reflected in `dataExchangeRegistry.test.ts`), but this UI test
was never updated. Fixed: assertion and test name now say 41, matching
`DATA_EXCHANGE_TEMPLATES.length`.

## Full Phase 8 focused test set (this session)
Shared: `documentExport.test.ts` 19, `dossierExportAssembly.test.ts` 19,
`dataExchangeRegistry.test.ts` 42, `dataExchangeValidation.test.ts` 41,
`dataExchangeCsv.test.ts` 6, `regulatoryDossier.test.ts` 72 (adjacent —
`dossierExportAssembly.ts` reuses its pure functions directly) — 199/199,
shared typecheck clean. Desktop: `dossierExports.test.ts`,
`exportHistory.test.ts` 10, `download.test.ts` 7, `DossierPanel.test.tsx`
26, `dataExchangeCommit.test.ts`, `dataExchangeCommitShapes.test.ts`,
`dataExchangeExisting.test.ts`, `dataExchangeXlsx.test.ts`,
`DataExchangePage.test.tsx` 10, `DataExchangeImportDialog.test.tsx` 1,
`i18n/parity.test.ts` — 238/238 across 11 files, desktop typecheck
clean, desktop lint clean. Rust: `artifact_file::` 12/12, `masterdata::`
12/12.

## Safeguards reconfirmed
- Failed/cancelled exports never appear successful — schema-level
  (`exportHistory.test.ts`) and integration-level (`DossierPanel.test.tsx`
  failed/cancelled tests assert no success fields).
- Exact dossier/formula-version traceability —
  `DossierPanel.test.tsx` "records the exact source dossier and formula
  version" test.
- Export never mutates dossier records — `DossierPanel.test.tsx` "never
  persists or mutates any dossier record".
- Unauthorized roles blocked before generation —
  `DossierPanel.test.tsx` "blocks export before any generation for an
  unauthorized role" (no history row created, `renderDossierDocument`
  never called).
- PDF/DOCX watermark honesty — `dossierExports.test.ts` draft-warning
  and no-false-warning-for-approved-source tests, both formats.
- Binary files saved without UTF-8 conversion — `download.test.ts`
  "passes the exact byte array through to the save call, never a
  converted string".
- Dossier imports cannot approve/submit/accept evidence/fabricate
  snapshots — `dataExchangeCommit.test.ts` forces draft/revision-1,
  "prepared", "proposed" regardless of file content.
- Export-only templates stay disabled for import —
  `dataExchangeRegistry.test.ts` `isTemplateCommitSupported` checks for
  the 2 export-only dossier templates.
- No absolute machine path persisted — `exportHistory.test.ts` "refuses
  an absolute path as fileName".

## Known limitations
No dedicated export-history viewer UI yet (`listExportHistory` exists,
unused by any screen). No retention/cleanup policy for
`generated_document_records` rows.

## Recommended sessions (unchanged plan, see external log for detail)
8. Closure: full regression, release, installers, shortcut, native verify (next)

## Exact next session
Phase 8 Session 8: Closure.
