# Phase 8 — Reports, Dossiers, Document Exports, Final Data Exchange Expansion

## Current status
Session 3 complete: deterministic PDF and DOCX render engines implemented
for a dossier export snapshot, tested, typechecked, lint-clean. No UI,
Rust persistence, Data Exchange, audit, or authorization work done yet.

## Session 3 — render engines completed
`apps/desktop/src/lib/documentExports/`: `renderDossierPdf` (`pdf-lib`),
`renderDossierDocx` (`docx` npm package), both consuming one shared
`buildDossierDocumentContent` intermediate model (`content.ts`) so the
two formats can never silently diverge on what they include.
`renderDossierDocument(snapshot, format)` is the single entry point,
returning `{ bytes, mimeType }` with `mimeType` always read from
`@ai4s/shared`'s `DOCUMENT_FORMAT_MIME_TYPES`.

## Libraries chosen
- PDF: `pdf-lib` (pure TS, no native/Rust dependency, browser+Node).
  Low-level text drawing only — never an HTML/DOM-to-PDF path.
- DOCX: `docx` npm package (pure TS, `Packer.toArrayBuffer`).
Both added to `apps/desktop/package.json`; lockfile updated via
`pnpm install`.

## Watermark
`watermark.ts`'s `computeSnapshotWatermark` reuses `draftWatermark()`
from `@ai4s/shared` (`engine/exports.ts`) for the exact warning text —
never a second, parallel string. An undefined source approval status
gets its own distinct "APPROVAL STATUS UNKNOWN" text rather than being
folded into "draft" (that would fabricate certainty this app doesn't
have).

## Determinism decision
PDF: creation/modification dates are set explicitly from
`snapshot.generationTimestamp` (never `new Date()` with no args); no
other library randomness observed — the test suite asserts full
byte-for-byte equality across two renders and it holds. DOCX: the `docx`
package's public API exposes no way to override its zip/core-properties
timestamps (confirmed against its own type definitions), so byte
equality is not guaranteed — the test suite instead extracts and
compares `word/document.xml`'s actual text content (the explicitly
permitted structural-equality fallback), which IS stable.

## Files changed this session
`apps/desktop/package.json` (+`docx`, +`pdf-lib`), `pnpm-lock.yaml`,
`apps/desktop/src/lib/documentExports/{content,watermark,dossierPdf,
dossierDocx,index}.ts` (new), `.../dossierExports.test.ts` (new, 18
tests).

## Focused tests passing
`vitest run src/lib/documentExports/dossierExports.test.ts` — 18/18.
Desktop typecheck — clean. Desktop lint — clean.

## Known limitations
No Unicode font embedding — `pdf-lib`'s StandardFonts/WinAnsiEncoding
cannot render non-Latin script content (dossier codes/titles in this
domain are Latin-script today; a future non-Latin dossier would need an
embedded TTF, out of this session's scope). No binary file-save wiring
yet — `apps/desktop/src/lib/tauri.ts`'s `saveTextFile` is text-only;
Session 4 needs a `saveBinaryFile` Rust command addition (documented
here, not implemented, per this session's scope boundary). No UI action
calls these renderers yet.

## Recommended sessions (unchanged plan, see external log for detail)
4. Reports + Dossiers desktop workspace wiring (next)
5. Data Exchange expansion
6. Export history, audit, authorization integration
7. Focused Phase 8 verification
8. Closure: full regression, release, installers, shortcut, native verify

## Exact next session
Phase 8 Session 4: Reports and Dossiers Desktop Export Wiring.
