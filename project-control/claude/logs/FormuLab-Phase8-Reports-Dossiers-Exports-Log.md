# FormuLab Phase 8 â€” Reports, Dossiers, Document Exports, Final Data Exchange Expansion â€” Log

## Session 0: Assessment, Implementation Plan, and Desktop Shortcut Refresh

### Objective
Bounded assessment session. Determine real repository state for Phase 8
areas (Reports, Dossiers, Document Exports, final Data Exchange
expansion), produce a session-by-session implementation plan, refresh the
Windows Desktop shortcut for manual user verification. No Phase 8 feature
implementation.

### Initial HEAD
`1379130cd0c743b49e709cfaf211ccb2d91ebac8` (== upstream, clean tree apart
from the pre-existing, deliberately-untouched files carried across every
session: `.FormuLab/runs.db`, `.gitignore`, `formulas/index.json`).

### Files inspected
Read-first list: AGENTS.md, docs/architecture/IMPLEMENTATION_STATUS.md
(tail, lines 1160-1200), docs/handoffs/PHASE7_CURRENT.md, package.json,
packages/shared/package.json, apps/desktop/package.json.

Phase 8 area files:
- Reports: `apps/desktop/src/app/routes/ReportsPage.tsx`.
- Dossiers: `packages/shared/src/schemas/dossier.ts` (499 lines),
  `packages/shared/src/engine/regulatoryDossier.ts` (882 lines) +
  `.test.ts` (676 lines), `engine/regulatoryDossierApproval.ts` (161) +
  `.test.ts` (291), `engine/dossierRecordDiscovery.ts` (281) + `.test.ts`
  (275), `apps/desktop/src/app/routes/DossiersPage.tsx`,
  `apps/desktop/src/components/formula/DossierPanel.tsx` (1917 lines) +
  `.test.tsx` (578 lines).
- Document exports: `apps/desktop/package.json` dependency list (grepped
  for jspdf/pdf-lib/pdfmake/@react-pdf/docx â€” zero hits),
  `apps/desktop/src/components/inspector/OfficePreview.tsx`,
  `packages/shared/src/engine/exports.ts` (170 lines),
  `apps/desktop/src/lib/download.ts`.
- Data Exchange: `packages/shared/src/engine/dataExchangeRegistry.ts`
  (grepped every `templateCode:` â€” 35 confirmed), spot-read the
  `dossier_requirements`/`dossier_evidence` template definitions
  (lines 1164-1192).
- Windows shortcut/build: `scripts/windows/verify-formulab-phase1.ps1`
  (glob-located, prior knowledge from Phase 7 closure), no
  `scripts/**/*shortcut*` found (no repo shortcut-update script exists â€”
  confirmed by glob), `apps/desktop/src-tauri/tauri.conf.json` and
  `Cargo.toml` (already read/known from Phase 7 closure this same
  conversation â€” package name `legacy-workbench`, binary
  `legacy-workbench.exe`, not `FormuLab.exe`).

### Findings by Phase 8 area

**Reports** â€” PROTOTYPE/PLACEHOLDER (self-disclosed shell).
`ReportsPage.tsx` is a static list of 18 rows linking to existing
workspaces (`/formulation`, `/laboratory`, `/stability`, `/regulatory`,
`/dossiers`, `/claims-labels`, `/doe`, `/data-exchange`, `/approval`) plus
one `undefined`-href "audit" row shown as "not yet implemented". Its own
top-of-file comment states it is "a navigation shell over the export
capabilities that already exist" and that "the full Phase 7 PDF/DOCX
report engine is explicitly out of scope... never presented as
available." No schema, no engine, no persistence collection, no test
file. i18n keys exist (`session.json`'s `reports.*` namespace) but are
never round-trip-tested.

**Dossiers** â€” COMPLETE AND REUSABLE (core); Data Exchange coverage
PARTIAL.
`dossier.ts` defines a full version/packaging-SKU/jurisdiction-bound
lifecycle: `regulatoryDossierSchema` (header, revision-numbered,
immutable once `submitted`/`superseded`/`archived` â€”
`DOSSIER_IMMUTABLE_STATUSES`), frozen-per-revision requirements
(`regulatoryDossierRequirementSchema`), evidence items with a real
supersession chain (`supersedesEvidenceId`, never edited/deleted, only
superseded), an explicit human-only requirementâ†”evidence link
(`regulatoryRequirementEvidenceLinkSchema`, revocable via
`revokesLinkId`), append-only reviews frozen with a
`requirementSnapshot`/`evidenceSnapshot` at review time, an internal-only
submission tracking log (never a real authority-portal integration, by
design), append-only manual requirement add/exclude actions requiring a
named authorized role + justification, and computed (never stored)
readiness/drift/approval-snapshot schemas. 8 Rust masterdata collections
back this. `regulatoryDossier.ts` implements the satisfaction/readiness
computation; `dossierRecordDiscovery.ts` implements spec Â§7's automatic
evidence-suggestion-from-existing-records (never itself sufficient â€” only
a human `"accepted"` link counts). `DossierPanel.tsx` (1917 lines) is a
real, first-class route (`DossiersPage.tsx`) with Overview/Evidence
Matrix/Requirements/Evidence Library/Reviews/Submissions/History/Audit
sections. Total test coverage across the 4 test files: 1820 lines.
This is genuinely production-grade â€” Phase 8 must build ON it, never
reimplement any part of it.
Gap: of the 8 dossier Rust collections, only 2 have Data Exchange
templates (`dossier_requirements` â†’ `regulatory_dossier_requirements`,
`dossier_evidence` â†’ `regulatory_evidence_items`, both requiring an
already-existing dossier referenced by `dossier_code` â€” neither can
create a dossier header). `regulatory_dossiers` (header),
`regulatory_dossier_reviews`, `regulatory_dossier_submissions`,
`regulatory_requirement_evidence_links`,
`regulatory_dossier_manual_requirement_actions`,
`regulatory_dossier_review_revocations` have zero Data Exchange coverage.

**Document exports** â€” NOT STARTED (generation); reusable building blocks
exist.
Zero PDF library in `apps/desktop/package.json` or
`packages/shared/package.json` (grepped for jspdf/pdf-lib/pdfmake/
@react-pdf â€” no hits). `docx-preview` is present but is a read-only
Office-format viewer (`OfficePreview.tsx` renders docx/xlsx/pptx via
Shadow DOM for the File Explorer/attachment inspector, dynamic-imported
to keep it out of the main bundle) â€” not a document generator; confirmed
by reading its top-of-file comment and imports. No `window.print()` call
anywhere under `apps/desktop/src`. No template/header/footer/pagination/
branding infrastructure. No document-export-history persistence
collection (the only export-history collection, `data_exchange_export_
jobs`, Phase 6, is scoped to CSV/Excel Data Exchange jobs, not documents).
Reusable foundations found:
- `exports.ts`'s `VersionExportMeta` (formulaId/formulaCode/versionId/
  versionLabel/schemaVersion/exportTimestamp/approvalStatus/
  targetProductFamily/targetSkus) + `draftWatermark()` (an
  "R&D DRAFT â€” NOT PRODUCTION APPROVED" watermark for anything short of
  `production_approved` status) â€” this IS the traceability-header pattern
  a PDF/DOCX export must reuse rather than invent.
- `download.ts`'s `saveTextWithFeedback`/`downloadBlob`/`downloadText` â€”
  native Tauri Save-As dialog with toast feedback, browser-Blob fallback.
  Handles text today; a PDF/DOCX Buffer will need a binary-safe sibling
  (check `apps/desktop/src/lib/tauri.ts`'s `saveTextFile` command surface
  in Session 3 â€” likely needs a `saveBinaryFile` Rust command addition,
  not a parallel save mechanism).

**Final Data Exchange expansion** â€” PARTIAL.
`dataExchangeRegistry.ts` has 35 templates (every `templateCode:`
grepped and hand-counted), spanning raw materials/suppliers/pricing/
documents through all 11 Phase 7 reverse-formulation collections. Gaps:
(1) the 6 uncovered dossier collections above; (2) `stability_protocols`/
`stability_results` templates exist but have no commit handler â€” a
pre-existing, already-disclosed Phase 6 gap
(`IMPLEMENTATION_STATUS.md`'s Data Exchange Center section), not new,
still open, Phase 8 may or may not choose to close it; (3) no template
exists yet for Reports (nothing to import/export â€” Reports has zero
persistence) or for a future document-export-history collection (doesn't
exist yet â€” will need one if Session 5/6 create it).

### Reuse decisions
- Dossier schema/engine/persistence/UI: reuse as-is. Do not create a
  parallel Phase 8 dossier system.
- Data Exchange registry/validation/commit pipeline: extend with new
  templates using the exact existing pattern (template/columns/
  naturalKey/duplicatePolicy/authorization/targetCollection). Never a
  second import/export pipeline.
- `exports.ts`'s `VersionExportMeta`/`draftWatermark`: reuse for every
  new document's traceability header/watermark.
- `download.ts`: reuse and extend (binary variant), not replace.
- Formulation version immutability + named-human-approval rules
  (AGENTS.md): apply identically to generated documents â€” a PDF/DOCX
  snapshot is regenerable but can never itself grant approval.
- `regulatoryDossierReviewSchema`'s frozen `requirementSnapshot`/
  `evidenceSnapshot` pattern: reuse as the shape for a dossier
  export-ready snapshot rather than inventing a new frozen-snapshot
  concept.

### Blockers (genuine Phase 8 release blockers to resolve in-plan)
- No PDF/DOCX library chosen â€” Session 3 must pick one of each
  (deterministic output required; no embedded absolute file paths, no
  non-deterministic font-substitution/timestamp behavior unless the
  timestamp is an explicit, controlled input).
- Document generation must consume validated domain snapshots (dossier/
  version data), never ad hoc UI HTML â†’ print â€” no `window.print()`-based
  approach.
- A new persisted export-history/generated-document collection needs
  Rust masterdata allow-list registration + (optionally) a Data Exchange
  template, following the exact existing collection-registration pattern
  in `masterdata.rs`.
- Binary file-save path (`download.ts` currently text-only) needs
  extending, not replacing.

### Proposed Phase 8 sessions

**Session 1 â€” Shared report/document-export schemas**
- Objective: define `packages/shared/src/schemas/documentExport.ts`
  (report-run / export-request / export-record schemas) reusing
  `exports.ts`'s `VersionExportMeta`/`draftWatermark` shape and pattern;
  no fabrication, blank-stays-blank, no approval-granting fields.
- Files to read: `engine/exports.ts`, `schemas/dossier.ts`,
  `schemas/formulation.ts` (approval/version shape),
  `schemas/reverseFormulation.ts` (recent schema-style reference).
- Files allowed to modify: new `schemas/documentExport.ts`, its test
  file, `packages/shared/src/index.ts` (export additions only).
- Focused tests: new schema test file only.
- Completion condition: schema compiles, zod parses realistic fixtures,
  exported from the package index.
- Out of scope: any engine, any UI, any PDF/DOCX rendering, any Rust
  changes.
- Suggested commit: `feat(document-exports): add shared report/document-export schemas`

**Session 2 â€” Dossier export-snapshot assembly**
- Objective: a pure function assembling a complete, version-bound
  "dossier export package" (frozen requirement+evidence+review data,
  reusing the review-snapshot shape) ready for rendering â€” no new
  persistence collection if the review-snapshot shape already covers it.
- Files to read: `engine/regulatoryDossier.ts`,
  `engine/dossierRecordDiscovery.ts`, `schemas/dossier.ts`.
- Files allowed to modify: new `engine/dossierExportAssembly.ts` + test.
- Focused tests: new engine test file; rerun `regulatoryDossier.test.ts`
  if any shared helper is touched (prefer not touching it at all).
- Completion condition: assembling a snapshot from fixture dossier data
  produces a deterministic, fully-typed package with no fabricated
  fields.
- Out of scope: PDF/DOCX rendering, UI, Data Exchange.
- Suggested commit: `feat(document-exports): assemble dossier export snapshots`

**Session 3 â€” PDF and DOCX render engines**
- Objective: choose and add one PDF library and one DOCX-generation
  library (evaluate Tauri/Node compatibility first â€” flag if the chosen
  libraries need to run Rust-side instead of JS-side); implement pure
  render functions consuming Session 1/2 output; deterministic given
  fixed inputs + an explicit timestamp input; every exported file's
  header carries `VersionExportMeta`-equivalent data + `draftWatermark`.
  This is the highest-risk, most novel session â€” split further if the
  chosen libraries prove heavy to integrate (e.g. split PDF and DOCX into
  two sessions).
- Files to read: Session 1/2 output, `download.ts`,
  `apps/desktop/src/lib/tauri.ts` (existing save-file command surface).
- Files allowed to modify: `apps/desktop/package.json` (new deps), new
  render-engine files (location TBD by chosen library's runtime â€” shared
  package if pure-JS/isomorphic, desktop app if it needs Tauri APIs), new
  tests.
- Focused tests: new render-engine tests (byte-for-byte or structural
  determinism assertions with fixed inputs).
- Completion condition: given identical fixture input + timestamp, output
  bytes are identical across two runs; no local file path or secret
  appears in output.
- Out of scope: UI wiring, Data Exchange, export-history persistence.
- Suggested commit: `feat(document-exports): add PDF and DOCX render engines`

**Session 4 â€” Reports and Dossiers desktop workspace wiring**
- Objective: wire real "Generate PDF/DOCX" actions into `ReportsPage.tsx`
  (replacing "not yet implemented" badges only for report types with a
  real engine behind them â€” do not flip badges for types Session 1-3
  didn't cover) and add an export action to `DossierPanel.tsx`, using
  `download.ts` (extended with a binary save path if Session 3 needs it).
- Files to read: `ReportsPage.tsx`, `DossierPanel.tsx`, `download.ts`,
  `apps/desktop/src/lib/tauri.ts`.
- Files allowed to modify: `ReportsPage.tsx`, `DossierPanel.tsx`,
  `download.ts` (add binary variant only), their test files, i18n locale
  files for new UI strings (8 shipped locales, English/Turkish real
  translations + established placeholder convention for the rest, same
  as every prior phase).
- Focused tests: `ReportsPage.test.tsx` (new), `DossierPanel.test.tsx`
  (rerun), `download.test.ts` if one exists or gets created.
- Completion condition: a user can generate and save a real PDF/DOCX from
  the UI for at least one report type and one dossier export, watermarked
  correctly, no approval implied.
- Out of scope: Data Exchange templates, export-history persistence.
- Suggested commit: `feat(document-exports): wire PDF/DOCX export actions into Reports and Dossiers`

**Session 5 â€” Final Data Exchange expansion**
- Objective: add templates for the 6 uncovered dossier collections (or a
  justified subset, following the exact precedent already set for
  `stability_protocols`/`stability_results` â€” a template can exist
  without a commit handler if fabrication risk is too high, disclosed
  honestly) and a template for any new export-history collection Session
  6 introduces.
- Files to read: `dataExchangeRegistry.ts`,
  `apps/desktop/src/lib/dataExchangeCommit.ts`, `masterdata.rs`
  (allow-list pattern).
- Files allowed to modify: `dataExchangeRegistry.ts`,
  `dataExchangeCommit.ts`, `masterdata.rs` (new collection registration
  only, following the exact existing pattern), their test files.
- Focused tests: `dataExchangeRegistry.test.ts`,
  `dataExchangeValidation.test.ts`, `dataExchangeCommit.test.ts`,
  `cargo test --lib masterdata::`.
- Completion condition: new templates round-trip (export â†’ import â†’
  identical data), reference validation rejects an unresolved parent,
  duplicate policy matches the target collection's real mutability.
- Out of scope: PDF/DOCX rendering changes, UI beyond what Data Exchange
  already surfaces automatically (Template Library card count, etc.).
- Suggested commit: `feat(data-exchange): add dossier and document-export templates`

**Session 6 â€” Export history, audit, authorization, integration**
- Objective: persist one record per generation attempt â€” success or
  failure ("export failures must not produce records marked
  successful") â€” wired into the existing audit-log convention (the same
  `appendAudit` pattern `DossierPanel.tsx`'s Audit tab already uses);
  authorization role gating consistent with the existing
  `REGULATORY_ROLES` precedent.
- Files to read: whatever `appendAudit`/audit-log helper the codebase
  already uses (locate via `DossierPanel.tsx`'s Audit tab), Session 1's
  export-record schema.
- Files allowed to modify: Session 1's schema (status/error fields if
  missing), new persistence wiring, `masterdata.rs` if a dedicated
  collection is needed, their tests.
- Focused tests: new export-history test file, audit-log integration
  test.
- Completion condition: a forced render failure produces a visible
  `failed` record, never a `succeeded` one; a real success is retrievable
  and traceable to its exact source version.
- Out of scope: new report/dossier types, UI redesign.
- Suggested commit: `feat(document-exports): persist export history with audit and authorization`

**Session 7 â€” Focused Phase 8 verification**
- Objective: run every focused test file touched across Sessions 1-6
  together in one pass; confirm no regression in adjacent areas
  (dossier, Data Exchange, formulation-version immutability tests).
- Files to read: none new â€” verification only.
- Files allowed to modify: none, unless a genuine Phase 8 defect is
  found, in which case fix only that defect, matching the Phase 7
  closure protocol (fix, rerun affected test, rerun the full Phase 8
  focused set once).
- Focused tests: the union of every test file touched in Sessions 1-6.
- Completion condition: 100% pass on that union.
- Out of scope: full regression, release build, native verification â€”
  reserved for Session 8.
- Suggested commit: none unless a defect fix is needed
  (`fix(document-exports): <exact defect>`).

**Session 8 â€” Closure**
- Objective: full regression (shared/desktop/Rust), release build,
  installer creation, Desktop shortcut refresh, deep native verification
  for Reports/Dossiers/Document Exports â€” mirrors the Phase 7 closure
  session's exact protocol and honesty conventions (PARTIALLY LIVE
  VERIFIED is an acceptable, precedented outcome if the same
  wheel-scroll/DPI environment limitation recurs).
- Files to read: this log, `PHASE8_CURRENT.md`, whatever accumulated
  during Sessions 1-7.
- Files allowed to modify: `IMPLEMENTATION_STATUS.md`,
  `PHASE8_CURRENT.md` (rewrite to closed-state), this external log
  (append), the Desktop shortcut + one backup.
- Focused tests: full regression per AGENTS.md's closure convention.
- Completion condition: matches Phase 7's closure gate exactly (Level 2
  + Level 3 + release build + installer artifacts + native verification,
  no unresolved closure blocker).
- Out of scope: new Phase 8 features not already built in Sessions 1-7.
- Suggested commit: `chore(document-exports): close phase 8`

### Tests not run this session
Per instructions, no full regression, no broad suite. Not run: shared
full test suite, desktop full test suite, Rust full test suite,
typecheck, lint, clippy. Only inspected existing test file line counts
and prior Phase 7 closure results (already known-green from this same
conversation, unchanged since â€” no source touched between then and now).

### Executable build decision and result
DECISION: NO REBUILD. Existing release executable
(`apps/desktop/src-tauri/target/release/legacy-workbench.exe`, last
modified 2026-07-30 14:57) was built from the exact working-tree state
committed as HEAD `1379130cd0c743b49e709cfaf211ccb2d91ebac8` at
2026-07-30T15:15:59+03:00 (the Phase 7 closure commit â€” source fixes were
applied, then built, then committed with no further edits in between,
confirmed by this session's own memory of that closure sequence). No
commits have landed since. Native launch/window verification already
passed during Phase 7 closure (`verify-formulab-phase1.ps1`: Launch PASS,
Window PASS, title "FormuLab"). This session re-confirmed the executable
still exists and re-verified launch via the actual Desktop shortcut
(below) rather than rebuilding.

### Executable path
`C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\legacy-workbench.exe`

### Desktop shortcut path
`C:\Users\sekip\Desktop\FormuLab.lnk`

### Previous shortcut target
`C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\legacy-workbench.exe`
(already correct before this session â€” working directory and icon were
also already correct; no drift found).

### Shortcut backup path
`C:\Users\sekip\Desktop\FormuLab.lnk.backup-20260730-163334`

### New shortcut target and working directory
Target: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\legacy-workbench.exe`
(unchanged â€” reconfirmed/rewritten to the same, verified-correct value).
Working directory: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release`.
Icon: the exe itself, index 0 (unchanged). No arguments.

### Shortcut launch-verification result
PASS. Launched via the actual `.lnk` file (`Start-Process` targeting the
shortcut, not the exe directly). Resulting process: `legacy-workbench.exe`,
PID 50936, `MainWindowTitle` = "FormuLab", `Path` matched the current
repository build exactly. No FormuLab instance was running before this
verification (confirmed via `tasklist` first), so the verification
instance was closed cleanly afterward (`Stop-Process`, confirmed gone).

### Commit
docs(phase8): assess reports dossiers and document exports

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `b5664525bfce9ce90fcacd67a2178e8dc3abf905`, matches `@{u}`.

### Exact next session
Phase 8 Session 1: shared report/document-export schemas.

---

## Session 1: Shared Report and Document Export Schemas

### Objective
Define and validate the shared domain model for Phase 8 reports and
document exports. No rendering, UI, Rust persistence, Data Exchange,
audit, or release work.

### Initial HEAD
`b5664525bfce9ce90fcacd67a2178e8dc3abf905` (== upstream, clean tree apart
from the pre-existing, deliberately-untouched files: `.FormuLab/runs.db`,
`.gitignore`, `formulas/index.json`).

### Files inspected
AGENTS.md, docs/handoffs/PHASE8_CURRENT.md, packages/shared/package.json,
packages/shared/src/index.ts, packages/shared/src/engine/exports.ts,
packages/shared/src/schemas/primitives.ts,
packages/shared/src/schemas/formulation.ts (FORMULA_STATUSES/
HUMAN_ONLY_STATUSES section), packages/shared/src/schemas/dossier.ts
(already read in full, Session 0), packages/shared/src/schemas/
reverseFormulation.ts (full read â€” flagged as a style outlier: PascalCase
export names, no `schemaVersion` field, single quotes, unlike dossier.ts/
formulation.ts's camelCase-plus-`Schema`-suffix + `schemaVersion:
z.literal("1.0")` convention used everywhere else in the codebase).
Followed the dominant convention (dossier.ts/formulation.ts), not
reverseFormulation.ts's, since the task required a `schemaVersion` field
on every new schema. packages/shared/src/schemas/status.test.ts (test
style reference).

### Files changed
- `packages/shared/src/schemas/documentExport.ts` (new)
- `packages/shared/src/schemas/documentExport.test.ts` (new)
- `packages/shared/src/index.ts` (one `export *` line added)

### Schemas added
`reportDefinitionSchema`/`ReportDefinition`,
`documentSourceReferenceSchema`/`DocumentSourceReference`,
`documentExportRequestSchema`/`DocumentExportRequest`,
`generatedDocumentRecordSchema`/`GeneratedDocumentRecord`,
`dossierExportSnapshotMetaSchema`/`DossierExportSnapshotMeta`. Constants:
`DOCUMENT_FORMATS` (pdf/docx only â€” no HTML/PPTX/ODT), `REPORT_TYPES`
(the exact 18 keys already in `ReportsPage.tsx` â€” reused verbatim, not
reinvented), `DOCUMENT_SOURCE_ENTITY_TYPES` (8 values), `DOCUMENT_
CLASSIFICATIONS` (normal/confidential, reusing dossier evidence's own
confidentiality convention), `EXPORT_STATUSES` (requested/generating/
succeeded/failed/cancelled, exactly as specified â€” shared by both the
request and the record schema rather than two parallel enums),
`WATERMARK_STATES` (draft/unapproved/none), `DOCUMENT_FORMAT_MIME_TYPES`
(the single source of truth for formatâ†”MIME coherence, exported so
Session 3's render engine reads the same map rather than duplicating it).

### Integrity rules enforced
Implemented as a `superRefine` on `generatedDocumentRecordSchema`:
- `status === "succeeded"` requires `fileName`+`mimeType`+`checksum`
  present and `byteSize > 0`; forbids `errorCode`/`errorMessage`.
- Any non-succeeded status (`requested`/`generating`/`failed`/
  `cancelled`) forbids every success-only field (`fileName`/`mimeType`/
  `byteSize`/`checksum`) â€” a failed export can never carry file metadata
  that would let it look successful.
- `status === "failed"` requires both `errorCode` and `errorMessage`;
  every other status forbids them.
- `mimeType`, when present, must equal `DOCUMENT_FORMAT_MIME_TYPES[format]`
  â€” format/MIME coherence enforced structurally, not by convention.
- `fileName` is rejected if it matches an absolute-path pattern (Windows
  drive `C:\`, UNC `\`, or Unix-rooted `/`) â€” a relative name only.
- `byteSize` is `z.number().int().nonnegative()` at the base type level
  (never negative), with the succeeded-only refinement additionally
  requiring `> 0`.
- `sourceRevision`/`dossierRevision` are `z.number().int().nonnegative()`
  â€” never negative.
- `generationTimestamp`/`generatedAt` are required, explicit,
  `Date.parse`-validated strings with no schema-side default â€” two
  parses of identical input are guaranteed identical (no `Date.now()`/
  `crypto.randomUUID()` anywhere in this file).
- `documentSourceReferenceSchema.approvalStatusAtGeneration` is typed as
  the existing `FormulaStatus` union (imported, not redefined) and is the
  ONLY approval-adjacent field anywhere in this file â€” nothing here can
  set, grant, or imply approval/verification.
- Every field not explicitly required is `.optional()` â€” no field
  defaults an absent/unknown value to zero, empty string, or a synthetic
  placeholder.

### Tests and results
`pnpm --filter @legacy/shared exec vitest run src/schemas/
documentExport.test.ts` â€” 19/19 passing: valid report definition parses;
valid PDF/DOCX export requests parse; explicit timestamp required
(missing-field and non-parseable-string cases); deterministic parsing of
identical input; valid succeeded record parses; valid failed record with
failure metadata parses; failed record with success file metadata is
refused; succeeded record missing file metadata is refused; negative
byte size refused; zero byte size on a succeeded record refused; absolute
Windows path refused; absolute Unix path refused; relative fileName
accepted; PDF/DOCX MIME coherence enforced both ways; source-version
traceability fields preserved; unsupplied optional source fields stay
`undefined` (never defaulted); approval status confirmed as read-only
source metadata with no separate "approved" field anywhere on the
schema. `pnpm --filter @legacy/shared typecheck` â€” clean, no errors.

### Remaining limitations
No render engine (Session 3), no dossier export-snapshot assembly
function (Session 2), no Rust persistence or masterdata collection
registration, no Data Exchange template, no UI wiring, no audit/
authorization integration. `documentExport.ts` is pure schema â€” nothing
in it executes generation logic.

### Commit
feat(document-exports): add shared report and document-export schemas

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `aab5ab808b630a648d1d01e26cf1c654aef1c118`, matches `@{u}`.

### Exact next session
Phase 8 Session 2: Dossier Export Snapshot Assembly.

---

## Session 2: Dossier Export Snapshot Assembly

### Objective
Implement a pure, deterministic dossier export-snapshot assembly engine
using the existing dossier domain. No PDF/DOCX rendering, UI, Rust
persistence, Data Exchange, audit, authorization, or release work.

### Initial HEAD
`aab5ab808b630a648d1d01e26cf1c654aef1c118` (== upstream, clean tree apart
from the pre-existing, deliberately-untouched files: `.FormuLab/runs.db`,
`.gitignore`, `formulas/index.json`).

### Files inspected
AGENTS.md, docs/handoffs/PHASE8_CURRENT.md, packages/shared/src/schemas/
documentExport.ts (Session 1 output), packages/shared/src/schemas/
dossier.ts (already read in full, Session 0), packages/shared/src/engine/
regulatoryDossier.ts (full read â€” confirmed exported pure helpers:
currentRequirementsForRevision, buildEvidenceMatrix,
calculateDossierReadiness, compareDossierRequirementsToCurrentRules,
deriveEvidenceStatus, isDossierReviewActive, resolveEvidenceRevisionChain,
resolveDossierRevisionChain), packages/shared/src/engine/
regulatoryDossierApproval.ts (full read â€” the style reference for a flat
"facts in, blockers out" input/output shape, e.g.
DeriveDossierApprovalReadinessInput), packages/shared/src/engine/
dossierRecordDiscovery.ts (full read â€” confirmed evidence suggestions
never create a link on their own; a human must call proposeEvidenceLink/
acceptEvidenceLink, so a suggestion can never leak into this session's
snapshot as accepted evidence).

### Files changed
- packages/shared/src/engine/dossierExportAssembly.ts (new)
- packages/shared/src/engine/dossierExportAssembly.test.ts (new)
- packages/shared/src/index.ts (one export line added)

No change to documentExport.ts/.test.ts â€” the existing
DossierExportSnapshotMeta/DocumentSourceReference schemas from Session 1
were sufficient; no new schema was strictly required.

### Assembly behavior
assembleDossierExportSnapshot(input) â€” pure, no I/O, no Date.now()/
crypto.randomUUID(), no mutation of any input array/object (every output
array is built via a copy-then-sort, never in-place .sort()). Validates
the requested dossierRevision against dossier.revision, validates every
supplied record array against the requested dossier.id (throws on any
cross-dossier reference), checks for duplicate requirement ids, validates
every review revocation resolves to a known review, and requires
generationTimestamp/generatedBy to be present and, for the timestamp,
Date.parse-valid. Filters requirements/reviews/submissions/manual-actions/
links down to the exact requested revision â€” a record belonging to the
SAME dossier but a DIFFERENT revision is silently excluded (normal
historical data from before a reviseDossier call), not an error; only a
genuinely different dossierId throws.

### Snapshot contents
meta (DossierExportSnapshotMeta, Session 1's schema, parsed for a runtime
guarantee), source (DocumentSourceReference, likewise parsed,
sourceEntityType "regulatory_dossier"), dossierCode/dossierTitle/
dossierStatus (the dossier row's own recorded status â€” deliberately NOT
derived against a wider "all dossiers" set, since this snapshot's input
is scoped to one dossier only; that supersession check belongs to
deriveDossierStatus at the caller's layer), requirements
(current-for-revision, deterministically ordered), evidenceMatrix
(buildEvidenceMatrix reused verbatim), evidenceItems (every item
referenced by an included link, any status, plus its full supersession
ancestry via resolveEvidenceRevisionChain, each with its DERIVED status
via deriveEvidenceStatus so a superseded item's possibly-stale stored
status never leaks through as current), links (every status â€” proposed/
accepted/rejected/revoked â€” full transparency; only accepted ones count
toward the matrix, which the reused buildEvidenceMatrix already
enforces), reviews (frozen requirementSnapshot/evidenceSnapshot preserved
exactly), reviewRevocations, submissions (internal tracking only),
manualRequirementActions, readiness (calculateDossierReadiness reused),
optional drift (only when currentRules supplied), passthrough optional
approvalSnapshot (never recomputed), warnings (readiness's own warnings
plus one line per requirement blockingReason plus drift-derived lines,
sorted), assumptions (a static, deterministic list of what this snapshot
deliberately does not compute), generationTimestamp/generatedBy (verbatim
passthrough).

### Integrity decisions
- A discovered-but-not-accepted evidence suggestion
  (dossierRecordDiscovery.ts's output) never enters this function at
  all â€” it only accepts already-real RegulatoryRequirementEvidenceLink
  rows, and only linkStatus "accepted" ones count toward evidenceMatrix/
  readiness (via the reused buildEvidenceMatrix).
- "review references a different dossier revision": resolved as
  exclusion (filter), not an error, for a review that legitimately
  belongs to an earlier revision of the SAME dossier â€” throwing here
  would wrongly punish normal multi-revision review history. The actual
  rejected error case is a review (or any other record) referencing a
  completely different dossierId â€” genuine cross-dossier contamination.
- "duplicate active evidence links for the same logical relation": the
  existing model does NOT forbid multiple append-only rows for the same
  (requirementId, evidenceItemId) pair by design (see
  activeLinksForDossier's own "latest row wins" resolution) â€” so this
  assembly engine does not throw for that case either; it stays exactly
  as permissive as the domain model it composes with.
- "dossier not found in supplied input": not implemented as a distinct
  runtime check â€” dossier is a required, directly-typed parameter (not
  looked up from an array by id), so this class of error cannot occur
  through the type system; documented here as a deliberate design choice
  rather than silently dropped.

### Tests and results
`pnpm --filter @legacy/shared exec vitest run src/engine/dossierExportAssembly.test.ts`
â€” 19/19 passing: valid snapshot assembly; deeply identical output for
identical input; input arrays not mutated (including original unsorted
order preserved); exact revision preserved in both meta and source;
requirements ordered by requirementCode; evidence ordered by evidenceType
then title; stale-revision requirements/reviews excluded (not errored); a
revoked link never counts as active evidence; superseded evidence keeps
its DERIVED "superseded" status even though its stored status was
"draft"; a proposed link is never treated as accepted; missing mandatory
evidence surfaces as a REQ-B-tagged warning, not fabricated content;
review snapshots preserved exactly; review revocations stay visible;
submissions included with their own real status ("prepared"), never
upgraded; blank optional fields (packagingSkuCode,
approvalStatusAtGeneration) stay undefined; explicit generationTimestamp
preserved verbatim; no approved/verified top-level field exists on the
output at all; a mismatched dossierRevision is rejected; a requirement
referencing a foreign dossierId is rejected.
`pnpm --filter @legacy/shared typecheck` â€” clean. regulatoryDossier.ts was
not modified (pure import-only reuse), so its own 676-line test suite was
not rerun â€” not genuinely necessary per this session's instructions.

### Remaining limitations
No PDF/DOCX render engine yet (Session 3's job â€” this snapshot is the
exact input a renderer will consume). No Rust persistence or masterdata
collection, no Data Exchange template, no UI wiring, no audit/
authorization integration. This engine never loads records from
persistence itself; a future caller (desktop UI action) must load and
pass in every array.

### Commit
feat(document-exports): assemble dossier export snapshots

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `5987778a2c6b0c0476dbf166f706f93782e6948d`, matches `@{u}`.

### Exact next session
Phase 8 Session 3: PDF and DOCX Render Engines.

---

## Session 3: PDF and DOCX Render Engines

### Objective
Choose one PDF library and one DOCX library, implement deterministic
render functions consuming the Session 2 dossier export snapshot. No
UI, persistence, Data Exchange, audit, authorization, release, or
native verification.

### Initial HEAD
`5987778a2c6b0c0476dbf166f706f93782e6948d` (== upstream, clean tree
apart from the pre-existing, deliberately-untouched files:
`.FormuLab/runs.db`, `.gitignore`, `formulas/index.json`).

### Files inspected
AGENTS.md, docs/handoffs/PHASE8_CURRENT.md, packages/shared/src/schemas/
documentExport.ts, packages/shared/src/engine/dossierExportAssembly.ts,
apps/desktop/src/lib/download.ts (confirmed text-only Tauri Save-As â€”
`saveTextFile`, no binary variant), apps/desktop/src/lib/tauri.ts (full
read â€” confirmed the exact `invoke` command surface; no
`save_binary_file` command exists). Checked `apps/desktop/package.json`
for an existing PDF/DOCX dependency (none) before adding new ones.
Read `pdf-lib`'s and `docx`'s own bundled `.d.ts` files directly (not
assumed) to confirm real API shapes before writing code: `PDFDocument.
setCreationDate`/`setModificationDate`/`embedFont`/`addPage`,
`PDFFont.widthOfTextAtSize`, `PDFPageDrawTextOptions` (`size`, not
`fontSize`); `docx`'s `IPropertiesOptions` (confirmed NO exposed
created/modified date override â€” informed the determinism decision
below), `IParagraphPropertiesOptionsBase.bullet: { level }`,
`HeadingLevel.TITLE`/`HEADING_1`, `Packer.toArrayBuffer`.

### Files changed
- `apps/desktop/package.json` (+`docx@^9.7.1`, +`pdf-lib@^1.17.1`)
- `pnpm-lock.yaml` (via `pnpm install`, dependency resolution only)
- `apps/desktop/src/lib/documentExports/content.ts` (new)
- `apps/desktop/src/lib/documentExports/watermark.ts` (new)
- `apps/desktop/src/lib/documentExports/dossierPdf.ts` (new)
- `apps/desktop/src/lib/documentExports/dossierDocx.ts` (new)
- `apps/desktop/src/lib/documentExports/index.ts` (new)
- `apps/desktop/src/lib/documentExports/dossierExports.test.ts` (new)

### Libraries chosen and why
PDF: `pdf-lib` â€” pure TypeScript, no native/Rust dependency, works in
both browser and Node, MIT-licensed, low-level text-drawing API (no
HTML/DOM rendering path, satisfying "not ad hoc UI HTML"). DOCX: the
`docx` npm package â€” pure TypeScript, `Document`/`Paragraph`/`TextRun`
object model + `Packer`, MIT-licensed. Both installed at the desktop-app
level (`apps/desktop/package.json`), not the shared package, since
rendering is desktop-specific presentation logic, not shared domain
logic â€” the shared package stays render-agnostic.

### Render capabilities
Both renderers consume ONE shared intermediate model
(`buildDossierDocumentContent`, `content.ts`) built as a pure map over
an already-assembled `DossierExportSnapshot` â€” document title, dossier
code + exact revision, jurisdiction(s) + packaging SKU, source formula/
version traceability, generation timestamp + generated-by, dossier
status, watermark (via `computeSnapshotWatermark`), every requirement,
the full evidence matrix, every evidence item with supersession
traceability (`supersedes <id>` shown inline), reviews + revocations,
submissions explicitly labeled "internal tracking only â€” not
confirmation of regulatory authority approval", the readiness summary,
warnings, and assumptions. `renderDossierDocument(snapshot, format,
options)` is the single entry point Session 4's UI action will call,
returning `{ bytes: Uint8Array, mimeType }` with `mimeType` always read
from `DOCUMENT_FORMAT_MIME_TYPES` (`@legacy/shared`, Session 1) â€” never a
locally re-declared value.

### Determinism decision
PDF: `pdfDoc.setCreationDate`/`setModificationDate` are both set
explicitly from `snapshot.generationTimestamp` â€” never a no-argument
`new Date()`. No other pdf-lib randomness was observed in practice: the
test suite asserts full byte-for-byte equality between two renders of
identical input, and it passes. DOCX: `docx`'s public
`IPropertiesOptions` type exposes no `created`/`modified` override at
all (verified directly against its shipped `.d.ts`, not assumed), so
byte-level determinism cannot be guaranteed even for identical input â€”
this session uses the task's explicitly permitted fallback instead: the
test suite unzips the generated `.docx` (`JSZip`, already a desktop
dependency) and compares `word/document.xml`'s actual text content
between two renders, which IS stable, rather than comparing raw bytes.

### Tests and results
`pnpm --filter @legacy/desktop exec vitest run src/lib/documentExports/
dossierExports.test.ts` â€” 18/18 passing: valid PDF bytes (`%PDF-`
header); valid DOCX bytes (zip local-file-header magic); dossier
traceability present in the PDF's actual drawn content (not just
title/subject metadata â€” content streams are FlateDecode-compressed AND
drawn text is hex-encoded (`<HEX> Tj`), so the test helper inflates
every stream and hex-decodes every text-show operator before searching,
rather than naively scanning raw bytes); draft warning appears for a
`concept`-status source and is absent for a `production_approved` one,
checked for both formats; byte-identical PDF output across two renders
of identical input; structurally-identical DOCX `document.xml` across
two renders; no absolute local path (`C:\` / backslash-drive pattern)
anywhere in either output; a blank `packagingSkuCode` renders as the
literal word "unknown" (DOCX: tag-stripped visible text, since label
and value are deliberately separate bold/plain runs); neither renderer
mutates the input snapshot (`toEqual` against a pre-render deep clone);
`renderDossierDocument`'s `mimeType` matches `DOCUMENT_FORMAT_MIME_TYPES`
for both formats. `pnpm --filter @legacy/desktop typecheck` â€” clean.
`pnpm --filter @legacy/desktop lint` â€” clean (new files triggered no
rules).

### Remaining limitations
No Unicode/non-Latin font embedding â€” `pdf-lib`'s StandardFonts only
cover WinAnsiEncoding; a dossier with non-Latin content would need an
embedded TTF (out of scope, disclosed rather than silently broken). No
binary file-save wiring â€” `apps/desktop/src/lib/tauri.ts`'s
`saveTextFile`/`download.ts` are text-only; Session 4 needs a
`saveBinaryFile` Rust command (or an existing binary-safe path this
session didn't find) before a UI "Export" button can actually write
these bytes to disk. No UI wiring, no Rust persistence, no Data
Exchange template, no export-history/audit record of a generation
attempt yet.

### Commit
feat(document-exports): add PDF and DOCX render engines

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `ba95f13323f8c96b394a38cbe57ae5df8c24bf64`, matches `@{u}`.

### Exact next session
Phase 8 Session 4: Reports and Dossiers Desktop Export Wiring.

---

## Session 4: Reports and Dossiers Export Wiring

### Objective
Wire desktop PDF/DOCX export into the Dossier workspace: a binary-safe
Tauri save command, a `download.ts` binary helper, real export actions
in `DossierPanel.tsx`, and a Reports description update for the one
report type that's genuinely implemented. No Data Exchange,
export-history persistence, authorization redesign, release build, or
native verification.

### Initial HEAD
`ba95f13323f8c96b394a38cbe57ae5df8c24bf64` (== upstream, clean tree
apart from the pre-existing, deliberately-untouched files:
`.FormuLab/runs.db`, `.gitignore`, `formulas/index.json`).

### Files inspected
AGENTS.md, docs/handoffs/PHASE8_CURRENT.md, ReportsPage.tsx (unchanged
since Session 0's read â€” its `dossier` row already had `href: "/dossiers"`,
never a placeholder badge), DossierPanel.tsx (full structural scan â€”
confirmed it already loads every dossier-domain record array
`assembleDossierExportSnapshot` needs: `dossiers`/`requirements`/
`evidenceItems`/`links`/`reviews`/`reviewRevocations`/`submissions`/
`manualActions`, via `listRecords` in one `Promise.all`; found the
existing `exportDossierJson`/`exportMatrixCsv`/`exportMatrixXlsx`
toolbar in the "evidence" `DetailSection` â€” the exact insertion point
and styling convention followed), `apps/desktop/src/lib/documentExports/*`
(Session 3 output), `download.ts`, `tauri.ts` (full read â€” confirmed
`saveTextFile`'s exact dialog/`SaveResult` shape to mirror),
`apps/desktop/src-tauri/src/artifact_file.rs` (found and read
`save_text_file` in full â€” `blocking_save_file()` dialog,
`std::fs::write`, `Result<Option<String>, String>`), `lib.rs`'s
`invoke_handler` registration list.

### Files changed
- `apps/desktop/src-tauri/src/artifact_file.rs` (+`save_binary_file`
  command, +`write_binary_file` helper, +2 tests)
- `apps/desktop/src-tauri/src/lib.rs` (+1 command registration)
- `apps/desktop/src/lib/tauri.ts` (+`saveBinaryFile`)
- `apps/desktop/src/lib/download.ts` (+`saveBinaryWithFeedback`)
- `apps/desktop/src/lib/download.test.ts` (new, 5 tests)
- `apps/desktop/src/components/formula/DossierPanel.tsx` (export wiring)
- `apps/desktop/src/components/formula/DossierPanel.test.tsx` (+4 tests)
- `apps/desktop/src/i18n/locales/en/session.json` (+4 keys:
  `dossier.exportPdf`/`exportDocx`/`exportGenerating`/`exportError`;
  1 description update: `reports.dossier.description`)
- `apps/desktop/src/i18n/locales/{de,es,fr,ja,ko,tr,zh-Hans}/session.json`
  (English placeholder for the 4 new keys, via
  `scripts/i18n-fill-missing.py` â€” the existing, established process;
  +4 keys each, 28 total, exactly matching the 4Ã—7 expected)

### Binary save implementation
`save_binary_file(app: AppHandle, filename: String, bytes: Vec<u8>) ->
Result<Option<String>, String>` â€” same `tauri_plugin_dialog::DialogExt`
`.file().set_file_name(&filename).blocking_save_file()` dialog
`save_text_file` already uses; `None` (user cancelled) short-circuits to
`Ok(None)` before any write is attempted. The actual write is split into
`write_binary_file(path: &Path, bytes: &[u8]) -> Result<(), String>` â€”
a plain `std::fs::write(path, bytes)` â€” specifically so it's callable
from a unit test without a live `AppHandle`/dialog (the dialog-driving
command itself can't be headlessly tested â€” same limitation
`save_text_file` already has, so this isn't a new gap). The path always
comes from the OS file picker, never a caller-supplied string, so there
is no path string to validate/reject â€” the existing dialog convention
already eliminates that class of bug by construction. Bytes travel from
JS as `Array.from(bytes)` (a plain JSON number array), decoded by serde
straight into `Vec<u8>` â€” at no point does the payload pass through a
Rust `String`/UTF-8 interpretation, so an arbitrary byte sequence (e.g.
`0x00`, invalid UTF-8 continuation bytes) round-trips exactly. Verified
by test 1. Registered in `lib.rs` immediately after `save_text_file`.

### Reports/Dossier export behavior
**Dossiers**: two new buttons, "Export PDF"/"Export DOCX", in the
Evidence Library toolbar. On click: pre-filters `requirements`/
`evidenceItems`/`links`/`reviews`/`submissions`/`manualActions` (each
already loaded in this component's own state) down to the selected
dossier's `id` â€” including filtering `reviewRevocations` down to only
those whose `revokesReviewId` resolves to an already-dossier-scoped
review, matching exactly what `assembleDossierExportSnapshot`'s own
internal validation expects (an unfiltered pass-through would have
wrongly triggered its "unknown review" rejection for a revocation
belonging to a different dossier's review) â€” then calls
`assembleDossierExportSnapshot` with `dossierRevision:
selectedDossier.revision`, `formulaApprovalStatusAtGeneration` read from
the real `FormulationVersion.status` (via the `versions` prop, matched
by `formulaVersionId`), and an explicit `generationTimestamp: new
Date().toISOString()` (the UI is the legitimate caller supplying "now" â€”
the render ENGINE itself still never calls `Date.now()`). Any thrown
integrity error (mismatched revision, missing `formulaVersionId`, a
cross-dossier record slipping through) is caught and shown as visible
error text â€” the export simply does not happen, never a fabricated or
partial document. On success, `renderDossierDocument` â†’ the real
`pdf-lib`/`docx` engines from Session 3 â†’ `saveBinaryWithFeedback` (real
dialog on desktop, Blob download fallback in the browser/test
environment). States: loading (button reads "Generatingâ€¦", the *other*
export button is disabled so only one export runs at a time),
success (toast, handled entirely inside `saveBinaryWithFeedback`),
cancellation (silent â€” matches the existing JSON/matrix export
convention, which also gives no feedback on a no-op), failure (inline
red error text via `dossier.exportError`). Nothing in this path calls
`upsertRecords` â€” confirmed by a dedicated test â€” so no dossier record
is ever mutated by exporting. The watermark (draft/unapproved) is
preserved exactly per Session 3's existing `computeSnapshotWatermark`
logic, driven by the real formula version status, never fabricated.
**Reports**: the `dossier` row already linked to `/dossiers` (it was
never a placeholder badge â€” only the `claimsReview`/`labelReadiness`/
`formulaLabelConsistency` rows still correctly say "not yet
implemented", untouched). Only its English description text was updated
to describe the now-real PDF/DOCX capability living in that workspace â€”
no `ReportsPage.tsx` code change was needed, so none was made, and no
new test was added there (nothing new to test in that file).

### Tests
`cargo test --lib artifact_file::` â€” 12/12 (10 pre-existing + 2 new:
arbitrary-byte round-trip including invalid UTF-8; clear error for an
unwritable path). `pnpm --filter @legacy/desktop exec vitest run
src/lib/download.test.ts src/components/formula/DossierPanel.test.tsx
src/i18n/parity.test.ts` â€” 40/40: `download.test.ts` (5, all new) covers
success-toast-with-path, silent cancellation, browser-download fallback,
error-toast-on-throw, and the exact `Uint8Array` reaching
`saveBinaryFile` unconverted; `DossierPanel.test.tsx` (20, 4 new,
16 pre-existing unaffected) covers the generating/disabled state, a
visible error with no crash on a forced render failure, zero
`upsertRecords` calls during export, and â€” deliberately unmocked â€” a
real end-to-end PDF and DOCX render triggered from inside the actual
rendered UI component (not just the Session 3 unit tests in isolation);
`parity.test.ts` (15, pre-existing) confirms all 8 locales still carry
matching key sets after the new additions. `pnpm --filter @legacy/desktop
typecheck` â€” clean (one real fix needed: `new Blob([bytes], ...)` didn't
satisfy a stricter `ArrayBufferView<ArrayBuffer>` constraint for a
`Uint8Array<ArrayBufferLike>` from `pdf-lib`/`docx`'s return type â€”
fixed by wrapping in `new Uint8Array(bytes)` first, a copy into a
plain-`ArrayBuffer`-backed view). `pnpm --filter @legacy/desktop lint` â€”
clean.

### Remaining limitations
Non-Latin PDF font embedding remains out of scope (documented in
Session 3, unchanged here â€” no closure decision made yet). No Data
Exchange template for any Phase 8 collection. No persisted export-history
record of a generation attempt (Session 6's job). No authorization
gating specific to document export beyond the existing reviewer-role
selector already governing every other dossier action. Export always
targets the dossier's current `revision` â€” no UI to pick an older,
superseded revision to export (would require loading that older
revision's own frozen requirement/evidence rows, out of this session's
scope).

### Commit
feat(document-exports): wire PDF and DOCX exports into Reports and Dossiers

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `d4c55c65c53497d88d325b6c5ef09fe4f7abf4cb`, matches `@{u}`.

### Exact next session
Phase 8 Session 5: Final Data Exchange Expansion.

---

## Session 5: Final Data Exchange Expansion

### Objective
Extend the Data Exchange registry/validation/commit/export-loader
pipeline for the 6 remaining dossier-domain collections. No second
import/export system.

### Initial HEAD
`d4c55c65c53497d88d325b6c5ef09fe4f7abf4cb` (== upstream, clean tree
apart from the pre-existing, deliberately-untouched files:
`.FormuLab/runs.db`, `.gitignore`, `formulas/index.json`).

### Files inspected
dataExchangeRegistry.ts (full read of the `template()`/`col()` helpers,
role constants, and the existing `dossier_requirements`/`dossier_evidence`
templates + their `DOSSIER_REQUIREMENT_COLUMNS`/`DOSSIER_EVIDENCE_COLUMNS`
â€” confirmed neither column list declares a `referenceTemplate` for
`dossier_code`, meaning dossier-parent resolution has never been a
registry-level cross-template check), dataExchangeValidation.ts
(confirmed `duplicatePolicy` is documentation-only metadata â€” the engine
never reads it; actual dedup/immutability is driven by caller-supplied
`existingNaturalKeys`/`immutableNaturalKeys`/`isUnchanged` options, and
`enabled: false` + `disabledReason` is the one field this engine DOES
enforce, returning a `fatalError` before any row is parsed â€” this is the
exact mechanism used for the two export-only templates below),
dataExchangeCommit.ts (full read of `commitDossierRequirements`/
`commitDossierEvidence`/`commitRegulatoryRules`/`commitProductClaims`/
`commitFormulaBom` â€” confirmed the real parent-resolution convention is
a LIVE `findByCode` lookup against persisted data at commit time, not a
registry-level reference; also confirmed `commitFormulaBom` auto-creates
a missing formulation, which this session's stricter "no missing parent
may be created automatically" rule deliberately does not follow for the
new dossier_headers handler), apps/desktop/src/lib/dataExchangeExisting.ts
(the real export-loader file â€” `apps/desktop/src/lib/dataExchangeExport.ts`
named in the task prompt does not exist; found via DataExchangePage.tsx's
`existingRowsFor`/`loadExisting` imports â€” full read of its `LOADERS` map
and `flat()` helper, plus the existing `dossier_requirements`/
`dossier_evidence` loaders as the join-pattern reference), dossier.ts
(schemas already fully known from Sessions 0-2), masterdata.ts (full
read â€” confirmed all 6 target collections already typed in `Collection`/
`CollectionTypes`, added in Phase 3, no changes needed), masterdata.rs
(grepped â€” confirmed all 6 already on the Rust allow-list with correct
append_only flags: `regulatory_dossiers` false, `regulatory_requirement_
evidence_links`/`regulatory_dossier_reviews`/`regulatory_dossier_review_
revocations`/`regulatory_dossier_manual_requirement_actions` true,
`regulatory_dossier_submissions` false â€” no Rust changes needed at all).

### Files changed
- `packages/shared/src/engine/dataExchangeRegistry.ts` (+2 imports,
  +6 templates: `dossier_headers`, `dossier_reviews`,
  `dossier_submissions`, `dossier_evidence_links`,
  `dossier_manual_requirement_actions`, `dossier_review_revocations`)
- `packages/shared/src/engine/dataExchangeRegistry.test.ts` (2 count
  assertions 35â†’41, 1 blanket-enabled test scoped to exclude the 2
  known-disabled templates, +6 new tests)
- `apps/desktop/src/lib/dataExchangeCommit.ts` (+4 imports, +4 handlers:
  `commitDossierHeaders`, `commitDossierSubmissions`,
  `commitDossierEvidenceLinks`, `commitDossierReviewRevocations`,
  registered in `COMMIT_HANDLERS`)
- `apps/desktop/src/lib/dataExchangeCommit.test.ts` (+1 import, +21
  tests: 4 handler describe blocks + 1 unsupported-templates check + 4
  exportâ†’import round-trip tests)
- `apps/desktop/src/lib/dataExchangeExisting.ts` (+6 loaders:
  `dossier_headers`, `dossier_reviews`, `dossier_submissions`,
  `dossier_evidence_links`, `dossier_manual_requirement_actions`,
  `dossier_review_revocations`)
- `apps/desktop/src/lib/dataExchangeExisting.test.ts` (template-list
  updated, +4 loader describe blocks)

No change to `masterdata.ts`, `masterdata.rs`, `dataExchangeValidation.ts`
(generic engine needed nothing new), or the existing
`dossier_requirements`/`dossier_evidence` templates/handlers/loaders.

### Templates added and import/export support decisions
**Importable (4):**
- `dossier_headers` â†’ `regulatory_dossiers`. Rejects an already-existing
  `dossier_code` (dossiers are revised in the workspace, never
  overwritten). Resolves `formula_code`/`formula_version` via a live
  `listFormulations()`/`readFormulation()` lookup â€” refuses if the
  formula or version doesn't exist; deliberately does NOT auto-create a
  missing formulation, unlike `commitFormulaBom`'s own precedent, per
  this session's explicit "no missing parent may be created
  automatically" rule. Always `status: "draft"`, `revision: 1` â€”
  `submittedBy`/`reviewedBy`/`approvedBy`/`supersedesDossierId` are never
  read from the file at all (the handler doesn't even look at those
  columns, because the template doesn't define them as importable).
- `dossier_submissions` â†’ `regulatory_dossier_submissions`. Requires an
  existing dossier (live lookup). Always `status: "prepared"`; an
  authority's actual `responseReceivedAt`/`responseStatus`/
  `responseNotes` are never taken from the file â€” the handler doesn't
  read or set them.
- `dossier_evidence_links` â†’ `regulatory_requirement_evidence_links`.
  Requires an existing dossier, requirement (by code, scoped to that
  dossier), and evidence item (by code, scoped to that dossier) â€” all
  three live lookups. Always `linkStatus: "proposed"` regardless of what
  the file's `link_status` column says â€” accepting/rejecting/revoking a
  mapping stays a human-only action in the Dossiers workspace.
- `dossier_review_revocations` â†’ `regulatory_dossier_review_revocations`.
  Requires an existing dossier and resolves the EXACT review being
  revoked live, by `(dossierId, dossierRevision, reviewedAt)` â€” refuses
  with "No review found..." if no match exists. Reviews have no
  human-referenceable code of their own, so this triple is the natural
  identity a spreadsheet author can realistically supply.

**Export-only (2), each with an honest `disabledReason` and a real
export loader:**
- `dossier_reviews` â†’ `regulatory_dossier_reviews`. A review's frozen
  `requirementSnapshot`/`evidenceSnapshot` are copies of the actual
  requirement/evidence rows at the exact moment a real human reviewed
  the dossier. A flat import row cannot supply those arrays without
  either fabricating them empty (dishonestly claiming nothing was
  reviewed) or substituting today's live state for what the reviewer
  actually saw (silently rewriting history). Neither is safe.
- `dossier_manual_requirement_actions` â†’
  `regulatory_dossier_manual_requirement_actions`. The real
  `addManualRequirement`/`excludeRequirement` engine functions always
  write this audit row together with a real, atomic mutation of the
  requirement row itself. A standalone imported action row could
  reference a requirement that was never actually mutated to match,
  corrupting that two-record invariant â€” `dossier_requirements` (already
  existing, untouched) remains the safe, already-supported way to add a
  requirement via import (it always forces `isManual: true`).

### Safety constraints enforced
Imports never approve/verify/submit/accept: `dossier_headers` forces
draft/revision 1 and reads no lifecycle field from the file;
`dossier_submissions` forces "prepared" and reads no response field;
`dossier_evidence_links` forces "proposed" and reads no
accept/reject/revoke field. Parent references resolve live before
commit (dossier/requirement/evidence/review, every one a real
`findByCode`/array-scan lookup â€” never a registry-declared
`referenceTemplate`, matching this codebase's own established
convention). Append-only records always create new rows â€” none of the
4 importable handlers checks for or updates an existing row by anything
other than `id`, matching `commitDossierRequirements`'s own precedent of
never deduplicating. Revocations reference real prior records â€” refused
outright if the named review can't be resolved live. Reviews never
fabricate frozen snapshots â€” solved by refusing import entirely rather
than approximating. Submissions stay internal tracking only â€” an
authority's real response can never enter through this template. Blank
values stay blank (`nn()` helper, matching every other handler in this
file). No missing parent is ever auto-created â€” `dossier_headers`
deliberately breaks with `commitFormulaBom`'s auto-create precedent for
exactly this reason.

### Tests and results
`pnpm --filter @legacy/shared exec vitest run src/engine/
dataExchangeRegistry.test.ts src/engine/dataExchangeValidation.test.ts`
â€” 42/42 + 41/41. New registry tests: all 6 templates registered exactly
once in module "dossier"; every workflow-status column locked to its
safe starting value only (`draft`/`prepared`/`proposed`); the 4
importable templates confirmed `enabled: true`; the 2 export-only
templates confirmed `enabled: false` with a non-empty `disabledReason`;
`dossier_headers.formula_code` confirmed `code_reference`+required;
`dossier_review_revocations`' natural key confirmed
`[dossier_code, dossier_revision, reviewed_at]`, every column required.
`pnpm --filter @legacy/desktop exec vitest run src/lib/
dataExchangeCommit.test.ts src/lib/dataExchangeExisting.test.ts` â€”
80/80 + 46/46. Commit tests per handler: missing-parent rejection (each
of the 4, including "already exists" for headers and "no saved version"
for an unversioned formula); safe-status-forced assertions (draft/
revision 1 with `submittedBy`/`approvedBy`/`supersedesDossierId` all
`undefined`; "prepared" with no `responseStatus` key present; "proposed"
even when the file said `link_status: "accepted"`); a dedicated
`isTemplateCommitSupported` check confirming the 2 export-only templates
have no wired handler at all. **Exportâ†’import round trip** (4 new
tests, one per importable template): commits each template's own
registry `exampleRows[0]` through `commitDataExchangeRows` into a real
stateful in-memory store (`upsertRecords` mock actually appends,
`listRecords` mock actually reads it back â€” not just re-asserting the
same mock call), then calls the real `loadExisting()` export loader
against that same store and confirms the resulting natural key and key
fields match. Loader tests: each of the 4 new join-based loaders
(`dossier_headers`/`dossier_submissions`/`dossier_evidence_links`/
`dossier_review_revocations`) resolves its foreign ids back to codes
correctly, matching the exact style of the existing `dossier_evidence`
loader test. `pnpm --filter @legacy/shared typecheck` and `pnpm --filter
@legacy/desktop typecheck` â€” both clean (one real fix needed: 3 test-file
object-spread expressions needed an explicit `Record<string, string>`
annotation, since TS narrowed the spread's inferred type to only the
overridden literal keys). `pnpm --filter @legacy/desktop lint` â€” clean.
No Rust changes, so no `cargo test` run this session.

### Remaining limitations
No export-history/generated-document persistence record of an import or
export attempt (Session 6's job). No new authorization tier beyond the
existing `REGULATORY_ROLES` gate every dossier template already uses.
`dossier_evidence_links` can only link already-existing evidence to an
already-existing requirement â€” bulk-creating new evidence still requires
the existing `dossier_evidence` template. A dossier's manual requirement
actions and formal reviews remain UI-only for creation, by design â€”
export/audit visibility only through Data Exchange.

### Commit
feat(data-exchange): add dossier document-export templates

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `7cb1578d6591cba292282800f2cb4a674b15c118`, matches `@{u}`.

### Exact next session
Phase 8 Session 6: Export History, Audit, Authorization, and Integration.

## Session 6: Export History, Audit, Authorization, and Integration

### Objective
Persist one record for every PDF/DOCX generation attempt (Dossiers
workspace): generating, succeeded, failed, cancelled. A failed or
cancelled export must never appear successful. Gate export on the
existing regulatory/quality/administrator role model, and never let
export mutate the dossier itself.

### Persistence model
New collection `generated_document_records`, allow-listed in
`masterdata.rs` (88th entry, `append_only: false` â€” status changes in
place, matching `regulatory_evidence_items`/`doe_observations`, full
history lives in the audit log) and in `masterdata.ts`. Reused the
Session 1 `GeneratedDocumentRecord` schema unmodified â€” no second record
shape invented. Keyed by `id` (no separate `code` field), confirmed via
`row_key()`'s code-then-id lookup, so the same row updates in place
across `generating` -> terminal status rather than duplicating. New
`apps/desktop/src/lib/documentExports/exportHistory.ts`: `sha256Hex`
(real client-side SHA-256 via `crypto.subtle`, no polyfill needed in
jsdom), `startExportRecord`, `finalizeExportSucceeded`,
`finalizeExportFailed`, `finalizeExportCancelled`, `listExportHistory`.

### Integration into DossierPanel
`exportDossierDocument` rewritten: checks
`requireAuthorizedRegulatoryActor` first (throws before any record is
created), assembles the dossier export snapshot, calls
`startExportRecord` ("generating"), renders, computes the checksum,
calls `saveBinaryWithFeedback` (now returns `SaveResult` instead of
`void` and re-throws after its error toast so the same catch block
handles both render and save failures uniformly). On `{kind:"canceled"}`
finalizes "cancelled" + appends `dossier.export_cancelled`. On success
finalizes "succeeded" with fileName/mimeType/byteSize/checksum/watermark
+ appends `dossier.export_succeeded`. On any thrown error (auth, render,
or save) finalizes "failed" with errorCode/errorMessage + appends
`dossier.export_failed` â€” only if a history record was already started
(an auth failure creates no row at all, matching "unauthorized role
blocked before generation"). Export buttons wrapped in the existing
`canActRegulatory` gate.

### Integrity rules enforced (schema `superRefine`, unchanged from
Session 1, exercised fresh this session)
Succeeded requires fileName+mimeType+positive byteSize+checksum and
forbids error fields. Failed requires errorCode+errorMessage and forbids
all success file fields. Cancelled forbids both. `fileName` rejects
Windows drive/UNC and Unix-absolute paths â€” the export flow only ever
builds a bare `{dossierCode}-rev{revision}.{format}`, never an absolute
path. Export never calls `upsertRecords` against any dossier-owned
collection (`regulatory_dossiers`, `regulatory_dossier_requirements`,
`regulatory_evidence_items`, `regulatory_requirement_evidence_links`,
`regulatory_dossier_reviews`, `regulatory_dossier_review_revocations`,
`regulatory_dossier_submissions`,
`regulatory_dossier_manual_requirement_actions`) â€” only
`generated_document_records`.

### Tests
`exportHistory.test.ts` (10 new): known SHA-256 vectors for empty input
and "abc", `startExportRecord` shape, `finalizeExportSucceeded` (success
case, zero-byte-size rejection, absolute-path rejection),
`finalizeExportFailed` (error metadata present, success fields absent,
explicit never-succeeded assertion), `finalizeExportCancelled`,
`listExportHistory` sort order. `download.test.ts` (+2, 1 renamed):
`saveBinaryWithFeedback` now asserted to resolve with the real
`SaveResult` on success/cancellation and to re-throw (not just toast) on
failure. `DossierPanel.test.tsx` (+8, 1 rewritten): success persists a
generating-then-succeeded pair + fires `onAuditChanged`; a render
failure persists "failed" with error metadata and no success fields +
fires `onAuditChanged`; a save failure (mocked `saveBinaryWithFeedback`
rejection) does the same; a cancelled save (mocked `{kind:"canceled"}`)
persists "cancelled" with neither success nor error fields; switching
"Acting as" to an unauthorized role ("chemist") hides both export
buttons and creates no history record, confirming `renderDossierDocument`
is never even called; a dedicated test asserts the persisted record's
`source` exactly matches the live dossier's id/formulaVersionId/revision;
the pre-existing "never persists or mutates any dossier record" test was
rewritten to allow `generated_document_records` writes while asserting
zero writes to any of the 8 dossier-owned collections above.

### Commands run
`pnpm --filter @legacy/desktop exec vitest run
src/lib/documentExports/exportHistory.test.ts src/lib/download.test.ts` â€”
17/17. `pnpm --filter @legacy/desktop exec vitest run
src/components/formula/DossierPanel.test.tsx` â€” 26/26 (a missing `nowIso`
export in this file's `@/lib/masterdata` mock, needed internally by the
new `exportHistory.ts`, broke 3 pre-existing tests until added). `cargo
test --lib masterdata::` (in `apps/desktop/src-tauri`) â€” 12/12, incl. the
new `generated_document_records_is_allow_listed_as_mutable` test and the
updated 88-length regression guard. `pnpm --filter @legacy/desktop
typecheck` â€” clean. `pnpm --filter @legacy/desktop lint` â€” clean. Shared
package untouched this session; no shared typecheck run.

### Remaining limitations
No export-history viewer UI â€” `listExportHistory` exists and is tested
but no screen surfaces past attempts yet. No retention/cleanup policy
for `generated_document_records` rows (they accumulate indefinitely,
same as every other mutable masterdata collection today).

### Commit
feat(document-exports): persist export history with audit and authorization

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `87dcef282823ca216e0f1a9667392bb4521996b8`, matches `@{u}`.

### Exact next session
Phase 8 Session 7: Focused Phase 8 Verification.


## Session 7: Focused Verification

### Objective
Run the complete Phase 8-focused test set from Sessions 1-6 together,
fixing only genuine Phase 8 defects. No features, no UI redesign, no
release build, no native verification.

### Defect found and fixed
DataExchangePage.test.tsx's "shows all 35 template cards by default"
test was stale — Session 5 grew the registry from 35 to 41 templates
(dataExchangeRegistry.test.ts was updated then, this UI test was not).
Fixed the count assertion and test name to 41.

### Full run results
Shared (199/199): documentExport.test.ts, dossierExportAssembly.test.ts,
dataExchangeRegistry.test.ts, dataExchangeValidation.test.ts,
dataExchangeCsv.test.ts, regulatoryDossier.test.ts (adjacent — reused
directly by dossierExportAssembly.ts). Shared typecheck clean.
Desktop (238/238 across 11 files): dossierExports.test.ts,
exportHistory.test.ts, download.test.ts, DossierPanel.test.tsx,
dataExchangeCommit.test.ts, dataExchangeCommitShapes.test.ts,
dataExchangeExisting.test.ts, dataExchangeXlsx.test.ts,
DataExchangePage.test.tsx, DataExchangeImportDialog.test.tsx,
i18n/parity.test.ts. Desktop typecheck clean, desktop lint clean.
Rust: artifact_file:: 12/12, masterdata:: 12/12.

### Safeguards verified
Failed/cancelled exports never appear successful; exact dossier/formula-
version traceability; export never mutates dossier records; unauthorized
roles blocked before generation (no history row created); PDF/DOCX
watermark honesty (draft warning shown/withheld correctly); binary files
saved byte-exact, never UTF-8-converted; dossier imports cannot approve/
submit/accept evidence/fabricate snapshots; export-only templates stay
disabled for import; no absolute machine path ever persisted. All
confirmed via existing passing tests, none weakened.

### Commit
fix(document-exports): resolve phase 8 verification defects

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `61c400cad4f975ce12ea766ecbcf965350e7e8de`, matches `@{u}`.

### Exact next session
Phase 8 Session 8: Closure.

## Session 8: Closure

### Objective
Close Phase 8 completely: full regression, release build + installers,
shortcut refresh, deepest practical native verification without risking
real user data, and final documentation rewrite.

### Full regression
Shared: 1199/1199 tests, typecheck clean. Desktop: 688/688 tests
(94 files), typecheck clean, lint clean. Rust: 82/82 tests, clippy
clean (-D warnings). No Phase 8 Python changes, Python suite not run.
No genuine closure regressions found — nothing to fix.

### Release build
pnpm --filter @legacy/desktop exec tauri build. Produced:
- legacy-workbench.exe — 21,894,144 B —
  sha256 b40416d1b4508abfa080a614f649c61a568f86ba767e505258fe82eddb85ad5a
- FormuLab_0.4.0_x64_en-US.msi — 35,606,528 B —
  sha256 4f64fcb1a020a311c7a3192ea14290a3fdb04b66748c9087ce7b90f53d51b442
- FormuLab_0.4.0_x64-setup.exe (NSIS) — 24,949,109 B —
  sha256 a1ece1dee3b59a2aed3ba66f8e42d8d604204f16c8cd92f6132288ada8163019

### Shortcut
C:\Users\sekip\Desktop\FormuLab.lnk backed up to
FormuLab.lnk.bak-phase8session8, then refreshed. Target confirmed
correct and unchanged: the release legacy-workbench.exe path.

### Native verification
Attempted to move the real %APPDATA%\com.formulab.app directory
(19,677 files of real project history) aside to safely click through
Dossiers/export flows, matching the Phase 1/7 precedent methodology.
That rename was blocked by the environment's action-safety classifier
as a risky operation on real user data outside the repo. Asked the user
directly how to proceed; they chose a read-only launch check over
authorizing the data move.

Launched the real packaged executable. Confirmed real process, real
native window, MainWindowTitle "FormuLab", real rendered sidebar/
landing content via screenshot. Closed cleanly. Re-counted
%APPDATA%\com.formulab.app afterward: 19,677 files, unchanged — nothing
was read, written, or altered.

Did not click into Dossiers, exercise export buttons, role-gating, the
save dialog, or cancellation live, per the data-safety decision above.
That interior behavior is instead verified by DossierPanel.test.tsx's
26 real-component-tree integration tests (real render, real userEvent,
only Tauri IPC mocked) plus exportHistory.test.ts/
dossierExports.test.ts/download.test.ts — all green this session.

Label: PARTIALLY LIVE VERIFIED (native launch fully confirmed; interior
flows confirmed via automated integration tests, not live clicks).

### Release checks
All confirmed: PDF/DOCX render code and save_binary_file present in the
built bundle; export history records success/failure/cancellation
correctly (schema + integration tests); Data Exchange exposes 41
templates (dataExchangeRegistry.test.ts + DataExchangePage.test.tsx);
the 4 new dossier templates are importable and the 2 export-only ones
stay disabled with honest disabledReasons (confirmed in source); draft/
unapproved watermark behavior preserved (dossierExports.test.ts); no
absolute local path stored or exported (schema-enforced, unit-tested).

### Accepted limitations (not release blockers)
Non-Latin PDF font embedding (pdf-lib's built-in fonts are Latin-only);
no export-history viewer UI (listExportHistory exists, unused by any
screen); no retention/cleanup policy for generated_document_records
rows; no older dossier-revision selector for export (always targets the
current revision). None implemented this session — recorded honestly as
accepted.

### Commit
chore(document-exports): close phase 8

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `14164ed49c8fe8cc7515bb481badc1bf93a26380`, matches `@{u}`.

### Final status
Phase 8 CLOSED. All 8 sessions complete.
