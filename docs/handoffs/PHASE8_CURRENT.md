# Phase 8 — Reports, Dossiers, Document Exports, Final Data Exchange Expansion

## Current status
Session 4 complete: real PDF/DOCX export wired into the Dossier
workspace, backed by a new binary-safe Tauri save command. Reports
description text updated for the one report type that's genuinely
implemented. No Data Exchange, export-history persistence, or
authorization redesign done yet.

## Binary save implementation
`save_binary_file(app, filename, bytes: Vec<u8>)` in `artifact_file.rs` —
same native "Save As" dialog `save_text_file` already uses, same cancel/
error shape (`Result<Option<String>, String>`). `bytes` travels as a
plain JSON number array (`Array.from(bytes)` on the JS side), never
coerced through a Rust `String`/UTF-8 step. The write itself is a small
extracted `write_binary_file(path, bytes)` helper, tested directly
(round-trips arbitrary bytes including `0x00`/invalid UTF-8; a missing
parent directory fails with a clear "write failed" error) since the
dialog-driving command itself can't be unit tested headlessly — same
convention `save_text_file`'s own (untested) shape already follows.
Registered in `lib.rs` next to `save_text_file`. `tauri.ts` gained
`saveBinaryFile`; `download.ts` gained `saveBinaryWithFeedback` (toast +
browser-Blob fallback, mirrors `saveTextWithFeedback` exactly).

## Dossier export UI
`DossierPanel.tsx`'s Evidence Library toolbar gained "Export PDF"/
"Export DOCX" buttons. Each: pre-filters the panel's already-loaded
dossier-domain state to the selected dossier (never a second query),
calls `assembleDossierExportSnapshot` (Session 2) — any integrity
failure there (mismatched revision, missing formulaVersionId) surfaces
as a visible error, blocking the export rather than producing an
incomplete document — then `renderDossierDocument` (Session 3) and
`saveBinaryWithFeedback`. Loading ("Generating…", other export button
disabled), success (toast via `saveBinaryWithFeedback`), cancellation
(silent, matching the existing JSON/CSV export convention), and failure
(inline error text) states are all covered. The formula version's real
`status` (via the `versions` prop) drives the watermark — nothing
persists, nothing sets approval/verification fields.

## Reports workspace
Only the `dossier` row's description was updated (it already linked to
`/dossiers`, so no code change was needed) — every other row's "not yet
implemented" text is untouched.

## Files changed this session
`apps/desktop/src-tauri/src/artifact_file.rs` (+`save_binary_file`,
+`write_binary_file`, +2 tests), `apps/desktop/src-tauri/src/lib.rs`
(+1 registration), `apps/desktop/src/lib/tauri.ts` (+`saveBinaryFile`),
`apps/desktop/src/lib/download.ts` (+`saveBinaryWithFeedback`),
`apps/desktop/src/lib/download.test.ts` (new, 5 tests),
`apps/desktop/src/components/formula/DossierPanel.tsx` (export wiring),
`apps/desktop/src/components/formula/DossierPanel.test.tsx` (+4 tests),
`apps/desktop/src/i18n/locales/en/session.json` (+4 keys, 1 description
update) + the other 7 locales (English placeholder, via
`scripts/i18n-fill-missing.py`).

## Focused tests passing
`cargo test --lib artifact_file::` — 12/12. `vitest run
src/lib/download.test.ts src/components/formula/DossierPanel.test.tsx
src/i18n/parity.test.ts` — 40/40 (includes a real, unmocked end-to-end
PDF+DOCX render inside the actual UI component). Desktop typecheck —
clean. Desktop lint — clean.

## Known limitations
Non-Latin PDF font embedding still out of scope (unchanged from Session
3 — documented there, not attempted here). No Data Exchange template, no
export-history persistence record, no authorization gating beyond the
existing reviewer-role selector. Export always targets the dossier's
current `revision` (no revision picker yet — matches the rest of this
panel's "current revision only" scope).

## Recommended sessions (unchanged plan, see external log for detail)
5. Final Data Exchange expansion (next)
6. Export history, audit, authorization integration
7. Focused Phase 8 verification
8. Closure: full regression, release, installers, shortcut, native verify

## Exact next session
Phase 8 Session 5: Final Data Exchange Expansion.
