# Attachment references

`packages/shared/src/schemas/testDefinitions.ts` (`attachmentReferenceSchema`),
`apps/desktop/src-tauri/src/attachments.rs`,
`apps/desktop/src/components/formula/AttachmentField.tsx`.

## What this is

Safe evidence attachment for laboratory and stability records: a photo of a
phase-separated batch, a scanned certificate of analysis, a spreadsheet of
raw instrument output, a PDF method reference. Wired into trial
observations, trial deviations, process steps, test results, stability
results, stability failures, and corrective actions — every record type
that already carried an `attachments: AttachmentReference[]` field, plus
three (`TrialDeviation`, `StabilityFailure`, `CorrectiveAction`) that
gained one additively this phase.

A file-picker-based workflow — never camera capture. Nothing in this
codebase claims to read a device camera, and none of the `AttachmentKind`
values (`photo`/`document`/`chart`/`raw_data`/`other`) imply one; `photo`
just means "the file happens to be a photograph", picked the same way a
PDF would be.

## Safety model

1. **The renderer never supplies a path that gets trusted as-is.** A file
   is chosen through the native OS dialog (`pickFile()`, already used
   elsewhere in the app for CSV imports) — that path is trustworthy because
   the OS, not the webview, produced it. It is then handed to
   `copy_attachment_into_project` (Rust), which:
   - Rejects a relative path outright (a picker result is always absolute;
     a relative string here would mean the caller is feeding through
     untrusted renderer text instead of a real picker result).
   - Reads the extension and rejects anything outside a closed allow-list:

     ```
     image:          png jpg jpeg gif webp bmp heic tif tiff
     pdf:            pdf
     spreadsheet:    xlsx xls csv tsv ods
     text_document:  doc docx txt md rtf odt
     ```

     An `.exe`, `.dll`, `.sh`, `.js`, `.bat`, `.com`, `.ps1` — anything not
     listed — is refused with an error naming the extension, never silently
     skipped.
   - Computes a SHA-256 checksum of the actual bytes (`sha2` crate).
   - Copies the file into `data/formulations/<id>/attachments/` under a
     **generated** name (`att-<32 hex chars>.<ext>`) — the original
     filename is preserved as metadata (`originalFileName`), never used as
     the on-disk name, so a hostile or colliding filename cannot influence
     where the file lands.
   - Returns `{ location, originalFileName, fileCategory, mimeType,
     sizeBytes, checksumSha256 }`. `location` is always
     `attachments/<generated-name>`, relative to the formulation's own
     folder.
2. **Opening an attachment resolves `location` the same way every other
   workspace-relative path in this codebase already does** —
   `artifact_file::resolve_under(formulationRoot, location)`, which
   canonicalizes and rejects anything that would escape the root. A
   location naming a file outside `attachments/` (or containing `..`) is
   refused, not silently widened.
3. **`AttachmentReference` carries the metadata, never the bytes**:

   ```ts
   {
     id, kind,              // photo | document | chart | raw_data | other
     title, location,
     capturedAt?, capturedBy?, notes?,
     // additive, populated when copied through this pipeline:
     fileCategory?,          // image | pdf | spreadsheet | text_document
     originalFileName?, mimeType?, sizeBytes?, checksumSha256?,
     addedBy?, addedAt?, description?,
     replacesAttachmentId?,  // set when a finalized attachment was replaced
   }
   ```

   All the additive fields are `.optional()`, not `.default()` — an
   attachment recorded before this phase has none of them and still parses.

## Immutability after finalization

`AttachmentField`'s "Remove" control is only rendered when the caller does
not pass `disabled` — the finalized-record rule differs by collection:

- **Append-only collections** (`test_results`, `stability_results`): the
  Rust storage layer itself refuses to overwrite an existing row, so an
  attachment can only be **added** at recording time, in the same form
  that captures the replicate values — `TestsSection`/`SampleDashboard`
  collect pending attachments locally and include them in the `TestResult`/
  `StabilityResult` object on first save. Once recorded, `AttachmentField`
  is rendered with `disabled` for that result.
- **Mutable collections** (`trial_deviations`, `stability_failures`,
  `corrective_actions`) and embedded arrays on a still-editable
  `LaboratoryTrial` (`observations`, `processSteps`): attachments may be
  added or removed at any time before the parent reaches a terminal state
  (`assertTrialEditable`/`assertStudyEditable` already enforce that a
  completed trial's/study's own execution record is immutable — the same
  guard covers its embedded attachments).

## Replacing a finalized attachment

A finalized (`disabled`) `AttachmentField` still offers **Replace** when
its caller passes `onReplace` — spec §1.4. Clicking it picks and safely
copies a new file exactly like Add, then hands both the superseded and
new `AttachmentReference` to the caller instead of editing the array
in place:

- **`test_results`/`stability_results`** (append-only): the caller
  (`TrialsPanel.tsx`'s `replaceTestResultAttachment`, `StabilityPanel.tsx`'s
  `replaceStabilityResultAttachment`) creates a **new result revision** —
  the same `revisesResultId` mechanism `reviseTestResult` already uses for
  a corrected measurement, applied here to a corrected attachment. The
  superseded result (and its original attachment) is never deleted; the UI
  shows `revises <id>` on the new one and only offers Replace on the
  latest, un-superseded revision in a chain.
- Both replacement paths append a dedicated `attachment.replaced` audit
  event (`AuditEvent.metadata`, additive/optional on the schema) carrying
  `oldAttachmentId`, `newAttachmentId`, `parentRecordType`,
  `parentRecordId`, `reason`, `replacedBy`, `replacedAt`,
  `oldChecksum`, `newChecksum` — distinct from whatever generic event
  already covers editing that record type, so a replacement is always
  individually auditable.
- The superseded attachment is **never removed** from the record's
  `attachments` array — `AttachmentField`'s default view hides it (any
  entry another entry's `replacesAttachmentId` points at), but passing
  `showSuperseded` (the historical browser, above) reveals it labelled
  "Superseded", still openable.

## Tests

`AttachmentField.test.tsx` covers: a safe reference is accepted with its
checksum retained; the picker being cancelled does nothing; a rejection
from the Rust command (e.g. an unsupported extension) surfaces as an error
without calling `onChange`; opening resolves through the safe path;
removing works when not disabled; add/remove are hidden when `disabled`.
The unsafe-path and unsupported-extension rejections themselves are Rust
unit tests (`attachments::tests` in `src-tauri/src/attachments.rs`) —
`allow_listed_extensions_map_to_a_category`,
`unsupported_extensions_are_rejected`,
`checksum_is_stable_for_the_same_bytes`.

## Known limitations

- Replacement (with its `attachment.replaced` audit event) is wired for
  `test_results`/`stability_results` (the two append-only, evidence-heavy
  collections). Mutable records (`trial_deviations`, `stability_failures`,
  `corrective_actions`, observations/process steps) still use plain
  add/remove regardless of whether their parent trial/study/action has
  reached a terminal state — extending the same finalized-record Replace
  gate to those is not yet done.
- Tests do not (and per spec should not) require actual camera hardware —
  there is no camera capture in this codebase at all, by design.
- No thumbnail preview for image attachments in the list view; opening
  hands off to the OS default viewer.

## Result history browser

The dedicated historical-attachment browsing this document used to list
as a gap is closed by `ResultHistoryBrowser.tsx` (spec §2) — see
[RESULT_HISTORY_BROWSER.md](RESULT_HISTORY_BROWSER.md) and
[TEST_RESULTS.md](TEST_RESULTS.md#result-history-browser). It uses
`resolveAttachmentReplacementChain` (`packages/shared/src/engine/resultHistory.ts`)
to group a result chain's attachments into original -> replacement
sequences, flags a pure replacement cycle (every attachment replaces
another, no root) with an honest warning instead of silently dropping any
of them, and every entry in a chain — including a superseded one —
remains individually openable through the browser via the same safe
`openAttachment` resolver `AttachmentField` already uses.

## Phase 3: dossier evidence

`RegulatoryDossierEvidenceItem.attachmentIds` reuses this exact mechanism —
`AttachmentReference`, the same checksum/MIME/size/filename validation, the
same safe resolver, no new upload path. Evidence replacement
(`replaceEvidence`, see [DOSSIER_EVIDENCE.md](DOSSIER_EVIDENCE.md)) follows
the same never-delete-the-superseded-file convention this document already
establishes for test results.
