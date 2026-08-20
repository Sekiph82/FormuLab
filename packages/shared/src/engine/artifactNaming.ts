/**
 * FVL-04.026 — deterministic, cross-platform-safe naming for literature/
 * source documents and formulation export artifacts. Implements the
 * frozen contract in `docs/ARTIFACT_NAMING_SPEC.md`; the Python adapter
 * (`runtime/pipeline/artifact_naming.py`, literature naming only) passes
 * the SAME golden vectors (`artifactNaming.goldenVectors.json`) as this
 * file. No LLM/heuristic summarization anywhere here — every rule is a
 * fixed, deterministic string transform.
 *
 * Canonical database identity is never touched by anything in this
 * module: `Formulation.id`/`.code`, `FormulationVersion.id`/
 * `.versionNumber` are only ever READ here to build a derived display
 * string or filename — never renamed, never mutated.
 */

const WINDOWS_ILLEGAL = /[<>:"/\\|?*\x00-\x1F\x7F]/g;

const RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

/**
 * Sanitizes ONE filename component — never a display title, which stays
 * human Unicode text untouched. Deterministic: the same input always
 * produces the same output, on any run, on any platform.
 */
export function sanitizeFilenameComponent(raw: string, maxLength = 60): string {
  let s = (raw ?? "").normalize("NFC");
  s = s.replace(WINDOWS_ILLEGAL, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/ /g, "-");
  s = s.replace(/-{2,}/g, "-");
  s = s.replace(/^[-.]+|[-.]+$/g, "");
  if (s.length > maxLength) {
    s = s.slice(0, maxLength).replace(/[-.]+$/g, "");
  }
  if (RESERVED_NAMES.has(s.toUpperCase())) s = `${s}-file`;
  return s;
}

/**
 * Sanitizes a STABLE identifier component (a DOI or another external
 * source id) — DOI slashes map to `-` (kept visually recognizable, never
 * silently dropped) before the same illegal-character strip every
 * component gets. Never truncated by a caller — the stable id is what
 * makes two records with identical human-readable text collision-safe.
 */
export function sanitizeIdComponent(raw: string): string {
  let s = (raw ?? "").trim();
  s = s.replace(/\//g, "-");
  s = s.replace(WINDOWS_ILLEGAL, "");
  s = s.replace(/^[-.]+|[-.]+$/g, "");
  if (!s) return "UNKNOWN-ID";
  if (RESERVED_NAMES.has(s.toUpperCase())) s = `${s}-id`;
  return s;
}

// ------------------------------------------------------------ literature ---

export interface LiteratureNamingInput {
  firstAuthor?: string;
  year?: string | number;
  title: string;
  /** A DOI, or any other stable source identifier — never guessed, never
   *  derived from the title/author. */
  stableSourceId: string;
  /** Without the leading dot, e.g. "pdf". */
  extension: string;
}

/** Human-readable, NEVER sanitized — Unicode text for on-screen display,
 *  kept entirely separate from the physical filename. */
export function literatureDisplayTitle(input: Pick<LiteratureNamingInput, "firstAuthor" | "year" | "title">): string {
  const author = (input.firstAuthor ?? "").trim() || "Unknown Author";
  const year = String(input.year ?? "").trim() || "n.d.";
  const title = (input.title ?? "").trim() || "Untitled";
  return `${author} (${year}) — ${title}`;
}

const YEAR_RE = /^\d{4}$/;

export function literatureFilename(input: LiteratureNamingInput): string {
  const yearRaw = String(input.year ?? "").trim();
  const year = YEAR_RE.test(yearRaw) ? yearRaw : "UnknownYear";
  const authorRaw = (input.firstAuthor ?? "").trim();
  const author = authorRaw ? sanitizeFilenameComponent(authorRaw, 40) || "UnknownAuthor" : "UnknownAuthor";
  const shortTitle = sanitizeFilenameComponent(input.title ?? "", 60) || "Untitled";
  const id = sanitizeIdComponent(input.stableSourceId);
  const ext = (input.extension || "pdf").replace(/^\./, "").toLowerCase();
  return `LIT_${year}_${author}_${shortTitle}_${id}.${ext}`;
}

// ----------------------------------------------------------- formulation ---

/** Closed vocabulary — never arbitrary caller-supplied text. Derived from
 *  the real export types that exist in this codebase today (see
 *  `docs/ARTIFACT_NAMING_SPEC.md`'s own B1 audit table). */
export const FORMULATION_ARTIFACT_TYPES = [
  "Formula",
  "CostSnapshot",
  "PackagingBom",
  "ErpBom",
  "ErpRecipe",
  "Dossier",
  "EvidenceMatrix",
  "RegulatoryRules",
] as const;
export type FormulationArtifactType = (typeof FORMULATION_ARTIFACT_TYPES)[number];

export interface FormulationNamingInput {
  productFamily: string;
  formulaName: string;
  formulaCode: string;
  /** The formulation's own canonical version number — read only, never
   *  mutated or renamed. */
  version: number | string;
  artifactType: FormulationArtifactType;
  /** Without the leading dot, e.g. "xlsx". */
  extension: string;
}

/** Zero-padded 2-digit display (`V03`) for a real integer version number;
 *  a non-numeric/negative version falls back to a sanitized literal
 *  rather than fabricating a number. */
export function formulationVersionLabel(version: number | string): string {
  const n = typeof version === "number" ? version : Number.parseInt(String(version), 10);
  if (Number.isFinite(n) && n >= 0) return `V${String(n).padStart(2, "0")}`;
  return `V${sanitizeFilenameComponent(String(version), 10) || "00"}`;
}

/** Human-readable, NEVER sanitized. */
export function formulationDisplayTitle(input: Pick<FormulationNamingInput, "productFamily" | "formulaName" | "formulaCode" | "version">): string {
  return `${input.productFamily} — ${input.formulaName} — ${input.formulaCode} — ${formulationVersionLabel(input.version)}`;
}

export function formulationExportFilename(input: FormulationNamingInput): string {
  const family = sanitizeFilenameComponent(input.productFamily, 30) || "Unassigned";
  const name = sanitizeFilenameComponent(input.formulaName, 40) || "Formula";
  const code = sanitizeFilenameComponent(input.formulaCode, 30) || "NOCODE";
  const version = formulationVersionLabel(input.version);
  const ext = (input.extension || "xlsx").replace(/^\./, "").toLowerCase();
  return `FORM_${family}_${name}_${code}_${version}_${input.artifactType}.${ext}`;
}
