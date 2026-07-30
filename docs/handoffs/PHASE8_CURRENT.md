# Phase 8 — Reports, Dossiers, Document Exports, Final Data Exchange Expansion

## Status: CLOSED (2026-07-30)

Formatted PDF/DOCX dossier exports, a full export-history/audit/
authorization layer, and the final Data Exchange expansion (35→41
templates) are complete, tested, released, and shortcut-verified. See
`docs/architecture/IMPLEMENTATION_STATUS.md`'s "Reports, Dossiers,
Document Exports (Phase 8)" section for the full technical writeup.

## Full regression (closure, 2026-07-30)
Shared: 1199/1199 tests, typecheck clean. Desktop: 688/688 tests
(94 files), typecheck clean, lint clean. Rust: 82/82 tests, clippy
clean (`-D warnings`). No Phase 8 Python changes — Python suite not run.

## Release artifacts
Built via `pnpm --filter @ai4s/desktop exec tauri build`.

| Artifact | Path | Size | SHA-256 |
|---|---|---|---|
| Executable | `apps/desktop/src-tauri/target/release/ai4s-workbench.exe` | 21,894,144 B | `b40416d1b4508abfa080a614f649c61a568f86ba767e505258fe82eddb85ad5a` |
| MSI installer | `apps/desktop/src-tauri/target/release/bundle/msi/FormuLab_0.4.0_x64_en-US.msi` | 35,606,528 B | `4f64fcb1a020a311c7a3192ea14290a3fdb04b66748c9087ce7b90f53d51b442` |
| NSIS installer | `apps/desktop/src-tauri/target/release/bundle/nsis/FormuLab_0.4.0_x64-setup.exe` | 24,949,109 B | `a1ece1dee3b59a2aed3ba66f8e42d8d604204f16c8cd92f6132288ada8163019` |

## Shortcut
`C:\Users\sekip\Desktop\FormuLab.lnk` backed up to
`FormuLab.lnk.bak-phase8session8` before refresh. Target confirmed
unchanged and correct:
`apps\desktop\src-tauri\target\release\ai4s-workbench.exe`, working
directory the containing `release` folder.

## Native verification: PARTIALLY LIVE VERIFIED
Launched the real packaged executable via the shortcut's target path.
Confirmed: real process (PID), real native window, `MainWindowTitle`
== `FormuLab`, real rendered sidebar/landing content (screenshot).
Closed cleanly.

Deep interior click-through (opening Dossiers, exercising the PDF/DOCX
export buttons, role-gating, the save dialog, cancellation) was **not**
driven live this session. Reason: doing so safely requires moving the
real `%APPDATA%\com.formulab.app` directory (19,677 files of genuine
project history) aside first — attempting that rename was blocked by
the environment's action-safety classifier as a risky, hard-to-reverse
operation on real user data outside the repo. Asked the user directly;
they chose the read-only launch check over authorizing the data-move,
so no dossier/export flow was clicked against real data. File count in
`%APPDATA%\com.formulab.app` reconfirmed identical (19,677) before and
after the launch — nothing was read, written, or altered.

All interior behavior the closure checklist asks about (export buttons
visible for an authorized role, unauthorized role hides/blocks export,
export opens a save dialog, cancellation handled safely, no dossier
mutation) is instead confirmed via `DossierPanel.test.tsx`'s 26
real-component-tree integration tests (real render, real `userEvent`
interactions, only the Tauri IPC boundary mocked) — the same evidence
tier this project already accepts elsewhere when live click-through is
blocked (see `docs/TAURI_LIVE_VERIFICATION.md`, and Reverse Formulation's
closure in `IMPLEMENTATION_STATUS.md`).

## Release checks
- PDF/DOCX generation in the packaged build: confirmed statically —
  `PDFDocument`/pdf-lib and `docx` render code present in the built
  `dist/assets/index-*.js`; behavior verified by `dossierExports.test.ts`
  (real, unmocked `pdf-lib`/`docx` rendering).
- `save_binary_file` command registered: confirmed in
  `apps/desktop/src-tauri/src/lib.rs`'s `invoke_handler` and present in
  the built frontend bundle's IPC call sites.
- Export history records success/failure/cancellation correctly:
  `exportHistory.test.ts` (10/10) + `DossierPanel.test.tsx` export
  describe block (10 tests covering success/render-failure/save-failure/
  cancellation/unauthorized-block/traceability).
- Data Exchange exposes 41 templates: `dataExchangeRegistry.test.ts`
  (`DATA_EXCHANGE_TEMPLATES` length 41) + `DataExchangePage.test.tsx`
  (41 rendered Upload buttons).
- 4 new dossier templates importable
  (`dossier_headers`/`dossier_submissions`/`dossier_evidence_links`/
  `dossier_review_revocations`): confirmed enabled in source and by
  `dataExchangeCommit.test.ts`'s round-trip tests.
- 2 dossier templates remain honestly export-only
  (`dossier_reviews`/`dossier_manual_requirement_actions`): confirmed
  `enabled: false` + non-empty `disabledReason` in source and by
  `isTemplateCommitSupported` tests.
- Draft/unapproved watermark behavior preserved:
  `dossierExports.test.ts` draft-warning and no-false-warning-for-
  approved-source tests, both PDF and DOCX.
- No absolute local path stored or exported: `fileName` schema-refined
  to reject drive/UNC/Unix-absolute patterns
  (`exportHistory.test.ts`); export flow only ever builds
  `{dossierCode}-rev{revision}.{format}`.

## Accepted limitations (not release blockers)
- **Non-Latin PDF font embedding**: `pdf-lib`'s built-in fonts are
  Latin-only; CJK/Arabic/etc. glyphs will not render correctly in
  generated PDFs. Accepted — no non-Latin dossier content exists in
  this deployment's scope today.
- **No export-history viewer UI**: `listExportHistory` exists and is
  tested but no screen surfaces past export attempts. Accepted — the
  audit log already gives a durable record; a dedicated viewer is a
  future UX improvement, not a data-integrity gap.
- **No retention/cleanup policy for `generated_document_records`**:
  rows accumulate indefinitely, same as every other mutable masterdata
  collection today. Accepted — consistent with the rest of the app's
  current retention posture.
- **No older dossier-revision selector**: export always targets the
  current dossier revision, not a superseded one. Accepted — superseded
  revisions remain visible and auditable in the UI; exporting a
  historical revision is a future enhancement, not a closure blocker.

## Final status
Phase 8 is **closed**. All 8 sessions complete. Full regression green.
Release built and installers verified. Shortcut refreshed and
confirmed. Native launch PARTIALLY LIVE VERIFIED; interior flows
verified via automated integration tests per the data-safety decision
above.
