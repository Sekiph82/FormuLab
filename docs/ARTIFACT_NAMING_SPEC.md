# FVL-04.026 — Artifact Naming Specification

Frozen, language-neutral contract for human-readable literature and
formulation artifact names. Two real adapters implement it:

- TypeScript: `packages/shared/src/engine/artifactNaming.ts`
- Python: `runtime/pipeline/artifact_naming.py`

Both pass the SAME golden vectors:
`packages/shared/src/engine/artifactNaming.goldenVectors.json` (literature
naming only — the only naming concern that genuinely crosses both
runtimes; formulation export naming is TypeScript-only, since no
formulation export path exists in Python).

## B1 audit summary (existing authorities found before designing anything)

| Artifact type | Current code path | Current filename rule | Provenance model |
|---|---|---|---|
| Literature PDF/XML->MD | `runtime/pipeline/literature_cache.py::_pdf_name()`/`fetch_pdfs()` | `<doi-or-source-index>.pdf`, illegal chars replaced with `_`, truncated to 120 chars | `library/index.json` (shared) + per-session `papers.json`/`papers.csv`/`README.txt`; each paper dict already carries `doi`, `title`, `year`, `authors`, `venue`, `source_db`, `oa_url`, `is_oa`, `pdf_file`, `fulltext`, `resolved_via` |
| Formula spreadsheet (XLSX/CSV/JSON) | `apps/desktop/src/components/formula/ExportMenu.tsx` | `${formulation.code}-${meta.versionLabel}[-suffix].<ext>` via `buildVersionExportMeta()` (`packages/shared/src/engine/exports.ts`) | N/A (no separate document registry; canonical `Formulation`/`FormulationVersion` records are the source of truth) |
| Cost snapshot / packaging BOM / ERP draft BOM / ERP draft recipe | same `ExportMenu.tsx` | same `${base}-<suffix>.<ext>` pattern | same |
| Regulatory rules export | `apps/desktop/src/components/formula/RegulatoryPanel.tsx` | `regulatory-rules-<jurisdiction>.<ext>` | N/A |
| Dossier evidence matrix | `apps/desktop/src/components/formula/DossierPanel.tsx` | `${dossierCode}-evidence-matrix-<suffix>.<ext>` | N/A |
| Dossier PDF/DOCX report | `apps/desktop/src/lib/documentExports/dossierPdf.ts`/`dossierDocx.ts` (`renderDossierPdf`/`renderDossierDocx`) | N/A — **not wired to any UI caller** (confirmed by repo search: only referenced from their own test files and `index.ts`'s re-export) | N/A |

Decision: ONE frozen specification below, a thin TypeScript adapter for
every reachable formulation export path, and a thin Python adapter for
the literature acquisition path. No second document registry is created
— every provenance field this task needs already exists on the literature
paper dict; nothing new is needed for formulation exports (canonical
`Formulation.id`/`.code`/`FormulationVersion.id`/`.versionNumber` are
never touched by naming — display/filename are pure derived strings).

## Sanitization rules (both adapters, identical behavior — proven by the
golden vectors)

Applied to every filename COMPONENT (never to a display title, which
stays human Unicode text):

1. Unicode input passes through untouched except where a rule below
   applies — no transliteration/ASCII-folding.
2. Windows-illegal characters `< > : " / \ | ? *` and ASCII control
   characters (0x00-0x1F, 0x7F) are stripped (removed, not replaced).
3. Internal whitespace runs collapse to one space, trimmed, then spaces
   become `-`; repeated `-` collapse to one.
4. Leading/trailing `-`/`.` are stripped (prevents a leading dot making a
   hidden file, and a trailing dot, which Windows silently drops).
5. A component that sanitizes to `""` falls back to a documented
   per-field token (`UnknownAuthor`, `UnknownYear`, `Untitled`, ...).
6. A component that case-insensitively equals a Windows reserved device
   name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`) gets a
   disambiguating suffix appended.
7. A component is deterministically truncated to a fixed max length
   (never mid-multi-byte-codepoint — string slicing on both runtimes
   operates on codepoints/UTF-16 code units, not bytes); the STABLE ID
   component is never truncated, and is never dropped — it is what makes
   two different sources with identical human-readable text collision-
   safe (see "collision resistance" below).
8. A stable-ID component (DOI or other external id) additionally maps
   `/` to `-` (DOI slashes) before the general illegal-character strip,
   so a DOI stays visually recognizable rather than disappearing.

## Filenames

```
LIT_<Year>_<FirstAuthor>_<ShortTitle>_<StableSourceId>.<ext>
FORM_<ProductFamily>_<ShortFormulaName>_<FormulaCode>_V<Version>_<ArtifactType>.<ext>
```

- `<Year>` — exactly 4 digits, else `UnknownYear`.
- `<FirstAuthor>` — sanitized, else `UnknownAuthor`.
- `<Version>` — zero-padded 2-digit (`V03`); the FORMULATION's own
  canonical `versionNumber` is read, never renamed or mutated — only
  this DERIVED display string is zero-padded.
- `<ArtifactType>` — a closed vocabulary
  (`Formula`/`CostSnapshot`/`PackagingBom`/`ErpBom`/`ErpRecipe`/
  `Dossier`/`EvidenceMatrix`/`RegulatoryRules`), never arbitrary text.

## Display titles (separate helpers, never sanitized — human Unicode)

```
<First Author> (<Year>) — <Short Human-Readable Title>
<Product Family> — <Formula Name> — <Formula Code> — V<Version>
```

## Collision resistance

The stable-id component is ALWAYS present and ALWAYS the second-to-last
component before the extension. Two source records whose human-readable
title/author sanitize to the identical text but carry different stable
ids therefore always produce different filenames — proven directly
(NAME11 in `artifactNaming.test.ts`), not merely asserted.

## Provenance

New human-readable filenames never destroy the existing provenance a
paper dict already carries (`doi`, an `oa_url`/original source, an
acquisition timestamp via `resolved_via`/library `index.json` entry
timestamps, and — where the download produced one — a content
fingerprint). Applied PROSPECTIVELY to new acquisitions/exports only; no
mass rename of existing library files.
