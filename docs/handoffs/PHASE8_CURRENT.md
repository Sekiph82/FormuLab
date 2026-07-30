# Phase 8 — Reports, Dossiers, Document Exports, Final Data Exchange Expansion

## Current status
Session 1 complete: shared report/document-export domain schemas defined,
tested, typechecked. No rendering, UI, Rust persistence, Data Exchange, or
audit work done yet.

## Session 1 — schemas completed
`packages/shared/src/schemas/documentExport.ts`: `ReportDefinition`,
`DocumentSourceReference`, `DocumentExportRequest`,
`GeneratedDocumentRecord`, `DossierExportSnapshotMeta`, plus
`DOCUMENT_FORMATS`/`REPORT_TYPES`/`DOCUMENT_SOURCE_ENTITY_TYPES`/
`DOCUMENT_CLASSIFICATIONS`/`EXPORT_STATUSES`/`WATERMARK_STATES`/
`DOCUMENT_FORMAT_MIME_TYPES`. `REPORT_TYPES` mirrors `ReportsPage.tsx`'s
18 existing row keys verbatim — no parallel taxonomy invented.

## Reuse decisions
- `DocumentSourceReference.approvalStatusAtGeneration` reuses
  `FormulaStatus` from `formulation.ts` — no new approval concept.
- `dossierExportSnapshotMetaSchema` references `DOSSIER_READINESS_STATES`
  and `REGULATORY_JURISDICTIONS` from `dossier.ts`/`regulatory.ts`; does
  not recreate requirement/evidence/review/readiness models.
- `DOCUMENT_CLASSIFICATIONS` reuses the exact 2-value convention
  `regulatoryDossierEvidenceItemSchema.confidentiality` already uses.
- No duplication of `VersionExportMeta`/`draftWatermark` from
  `engine/exports.ts` — `WatermarkState` models the same rule
  ("anything short of production-approved must not appear
  production-approved") as data for a later render engine to apply.

## Complete functionality (unchanged from Session 0)
Dossiers (schema/engine/UI, Phase 3) remain complete and reusable.

## Missing functionality (unchanged from Session 0)
Reports is still a nav shell. No PDF/DOCX render engine exists yet —
Session 3's job. No Data Exchange templates for the new schemas yet —
Session 5's job.

## Known limitations
- `GeneratedDocumentRecord` never stores raw bytes or absolute paths, by
  design — a render engine must return a relative fileName + checksum.
- `mimeType` coherence is format-keyed 1:1 (`DOCUMENT_FORMAT_MIME_TYPES`);
  extending formats later must update that map, not duplicate it.
- No Rust persistence, no masterdata collection, no Data Exchange
  template exists for these schemas yet.

## Files changed this session
`packages/shared/src/schemas/documentExport.ts` (new),
`packages/shared/src/schemas/documentExport.test.ts` (new, 19 tests),
`packages/shared/src/index.ts` (one export line).

## Focused tests passing
`vitest run src/schemas/documentExport.test.ts` — 19/19. Shared
typecheck — clean. Full shared suite not run this session (out of scope).

## Recommended sessions (unchanged plan, see external log for detail)
2. Dossier export-snapshot assembly (next)
3. PDF + DOCX render engines
4. Reports + Dossiers desktop workspace wiring
5. Data Exchange expansion
6. Export history, audit, authorization integration
7. Focused Phase 8 verification
8. Closure: full regression, release, installers, shortcut, native verify

## Exact next session
Phase 8 Session 2: Dossier Export Snapshot Assembly.
