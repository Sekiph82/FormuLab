# Phase 8 — Reports, Dossiers, Document Exports, Final Data Exchange Expansion

## Current repository state
Assessment-only session (Session 0). No Phase 8 features implemented.
HEAD at assessment: see external log. Phase 7 (Reverse Formulation) closed
and stable; nothing touched this session.

## Reusable architecture
- **Dossiers** (`packages/shared/src/schemas/dossier.ts`,
  `engine/regulatoryDossier.ts`, `engine/dossierRecordDiscovery.ts`,
  `apps/desktop/src/components/formula/DossierPanel.tsx`, 1917 lines):
  complete, version/revision-bound, immutable at terminal statuses,
  append-only requirements/reviews/links/manual-actions, evidence
  supersession chain, readiness + approval-snapshot computation. Reuse
  directly — do not build a parallel dossier system.
- `engine/exports.ts`'s `VersionExportMeta`/`draftWatermark` — the
  traceability-header pattern every new document export must reuse.
- `apps/desktop/src/lib/download.ts` — real Tauri Save-As + toast +
  browser-Blob-fallback file delivery. Reuse for PDF/DOCX; extend with a
  binary variant if `saveTextFile` can't carry binary data.
- Data Exchange registry/validation/commit pipeline (Phase 6/7 pattern,
  35 templates) — extend with new templates, never a second pipeline.

## Complete functionality
- Dossiers: schema, engine (882+161+281 lines), UI (1917 lines), 8 Rust
  collections, 1820 lines of tests across 4 test files.

## Partial / broken functionality
- Data Exchange dossier coverage: only 2 of 8 dossier collections have
  templates (`dossier_requirements`→`regulatory_dossier_requirements`,
  `dossier_evidence`→`regulatory_evidence_items`). No template can create
  a dossier header itself — only add to an existing one.
- `stability_protocols`/`stability_results` templates exist with no
  commit handler (pre-existing Phase 6 gap, not new, still open).

## Missing functionality
- **Reports**: `ReportsPage.tsx` is a static nav shell — no schema,
  engine, persistence, or tests. Its own comment discloses this.
- **Document exports**: no PDF library, no DOCX generation library
  anywhere (`docx-preview` is a read-only viewer used by
  `OfficePreview.tsx`, not a generator). No `window.print()`, no
  template/header/footer/pagination/branding infra, no export-history
  collection for documents.

## Protected invariants (unchanged, non-negotiable for Phase 8)
No fabricated evidence; drafts never presented as approved; every
generated document identifies its exact source record + version; stale
evidence never appears current; blanks stay blank; imports/generation
never approve or verify; approval requires a named human; saved versions
never silently overwritten; export failures never marked successful;
deterministic output for fixed inputs; no secrets/local paths in exports.

## Recommended sessions
1. Shared report/document-export schemas (reuse `exports.ts` pattern)
2. Dossier export-snapshot assembly (reuse `regulatoryDossier.ts`)
3. PDF + DOCX render engines (new, deterministic, library TBD)
4. Reports + Dossiers desktop workspace wiring
5. Data Exchange expansion (dossier header/reviews/submissions/links +
   any new export-history collection)
6. Export history, audit, authorization integration
7. Focused Phase 8 verification
8. Closure: full regression, release, installers, shortcut, native verify

Full per-session detail (files, tests, commit messages, boundaries): the
external log.

## Test strategy
Targeted tests per session; full Phase 8 verification after session 7;
full regression/release/native verification reserved for closure (8).

## Release strategy
No release build in Phase 8 sessions 1-7. Closure session only.

## Desktop shortcut status
Reused existing, already-correct shortcut (target/workdir/icon already
valid) — backed up, re-verified, launch-confirmed this session. See
external log for exact paths/hashes.

## Exact next session
Phase 8 Session 1: shared report/document-export schemas.
