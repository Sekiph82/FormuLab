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
  attachment can only be set **at recording time**, in the same form that
  captures the replicate values — `TestsSection`/`SampleDashboard` collect
  pending attachments locally and include them in the `TestResult`/
  `StabilityResult` object on first save. Once recorded, `AttachmentField`
  is rendered with `disabled` for that result — open-only, never
  add/remove.
- **Mutable collections** (`trial_deviations`, `stability_failures`,
  `corrective_actions`) and embedded arrays on a still-editable
  `LaboratoryTrial` (`observations`, `processSteps`): attachments may be
  added or removed at any time before the parent reaches a terminal state
  (`assertTrialEditable`/`assertStudyEditable` already enforce that a
  completed trial's/study's own execution record is immutable — the same
  guard covers its embedded attachments).
- **Replacing** a finalized attachment is a new reference with
  `replacesAttachmentId` set to the prior one's id, never an in-place edit
  — the schema supports this; no UI currently offers a "replace" action
  distinct from remove-then-add on a still-mutable record.

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

- No dedicated attachment-revision *audit event* — a replaced attachment on
  a still-mutable record is just a normal `upsertRecords` write to that
  parent record; there is no `attachment.replaced`-style entry in
  `audit.jsonl` distinct from whatever event already covers editing that
  record type.
- Tests do not (and per spec should not) require actual camera hardware —
  there is no camera capture in this codebase at all, by design.
- No thumbnail preview for image attachments in the list view; opening
  hands off to the OS default viewer.
