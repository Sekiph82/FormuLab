/**
 * FVL-05.011 — the builder: turns already-extracted, already-schema-valid
 * FVL-05.003-.010 rows into deterministic, reproducible SHA-256 digests at
 * the row/formula-version-bundle/dataset level.
 *
 * See `schemas/datasetManifest.ts`'s own header comment for the full
 * recovered source contract: what gets fingerprinted at each of the three
 * levels, the exact canonicalization algorithm, why real SHA-256 (not the
 * existing non-cryptographic `engine/connectorFingerprint.ts` FNV-1a) was
 * chosen, why this module is deliberately async unlike every prior
 * FVL-05.003-.010 extractor, and why `MANIFEST_SCHEMA_VERSION` is a third,
 * independent version family.
 *
 * Pure and deterministic (mod required asynchrony — see the schema
 * module's own header comment): no persistence, no mutation of its
 * inputs, no generated ids/timestamps, no wall-clock time, no random
 * value, no machine path, no process id ever enters a digest. Every
 * supplied row is walked in the fixed `FORMULA_VERSION_ROW_FAMILIES`
 * order, never caller-supplied order; dataset-level bundle membership is
 * sorted by `formulaVersionId` (ordinal) since membership is a SET, not a
 * caller-meaningful sequence.
 *
 * REBUILD CONTRACT (Q6): this module accepts the ALREADY-PRODUCED output
 * of FVL-05.003-.010's own extractors — it never re-invokes them and
 * never accepts raw masterdata pools. "Reproducible rebuild" here means:
 * given the exact same set of already-extracted rows, the canonicalization
 * + hashing pipeline itself is proven pure and reproducible — each
 * extractor's OWN test suite already proves ITS OWN determinism
 * independently; this module does not re-prove that.
 */
import { z } from "zod";
import {
  type FormulaVersionCompositionRow,
  type FormulaVersionCorrectiveCostContextRow,
  type FormulaVersionDoeRow,
  type FormulaVersionFeatureRow,
  type FormulaVersionProcessRow,
  type FormulaVersionStabilityRow,
  type FormulaVersionTargetRow,
  type FormulaVersionTestResultRow,
  formulaVersionCompositionRowSchema,
  formulaVersionCorrectiveCostContextRowSchema,
  formulaVersionDoeRowSchema,
  formulaVersionFeatureRowSchema,
  formulaVersionProcessRowSchema,
  formulaVersionStabilityRowSchema,
  formulaVersionTargetRowSchema,
  formulaVersionTestResultRowSchema,
} from "../schemas/dataset";
import {
  CANONICALIZATION_ALGORITHM,
  DIGEST_ALGORITHM,
  FORMULA_VERSION_ROW_FAMILIES,
  MANIFEST_SCHEMA_VERSION,
  datasetManifestSchema,
  formulaVersionBundleManifestSchema,
  type Digest,
  type DatasetManifest,
  type FormulaVersionBundleManifest,
  type FormulaVersionRowFamily,
} from "../schemas/datasetManifest";

export type DatasetManifestBuilderErrorCode = "invalid_row" | "formula_version_identity_conflict" | "duplicate_formula_version_bundle";

export interface DatasetManifestBuilderErrorContext {
  family?: FormulaVersionRowFamily;
  formulaVersionId?: string;
}

export class DatasetManifestBuilderError extends Error {
  readonly code: DatasetManifestBuilderErrorCode;
  readonly family?: FormulaVersionRowFamily;
  readonly formulaVersionId?: string;

  constructor(code: DatasetManifestBuilderErrorCode, message: string, context: DatasetManifestBuilderErrorContext = {}) {
    super(message);
    this.name = "DatasetManifestBuilderError";
    this.code = code;
    this.family = context.family;
    this.formulaVersionId = context.formulaVersionId;
  }
}

/** Locale/ICU-independent ordinal comparison for opaque ids — see
 *  `formulaVersionDoeDatasetExtractor.ts`'s identical helper for the full
 *  rationale. */
function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The one canonical-JSON serializer every digest in this module is
 * computed over — see `schemas/datasetManifest.ts`'s own header comment
 * for the full rule set. Identical to `JSON.stringify` except object keys
 * are sorted by exact ordinal `<` comparison; array element order is
 * NEVER touched.
 */
export function canonicalizeForFingerprint(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new DatasetManifestBuilderError("invalid_row", `Cannot canonicalize a non-finite number (${String(value)}) into a fingerprint.`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeForFingerprint(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareOrdinal);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeForFingerprint(record[key])}`).join(",")}}`;
  }
  throw new DatasetManifestBuilderError("invalid_row", `Cannot canonicalize a value of type "${typeof value}" into a fingerprint.`);
}

/** Real SHA-256 over the exact UTF-8 bytes of `input`, lowercase hex —
 *  see `schemas/datasetManifest.ts`'s own header comment for why
 *  `crypto.subtle` (not a new dependency, not a hand-rolled algorithm) is
 *  the correct, already-proven-portable choice in this exact codebase. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digestBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digestBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Canonicalizes then hashes `value`, wrapped in the self-describing
 *  `Digest` shape — never a bare hex string a reader has to trust the
 *  algorithm/canonicalization of. */
export async function digestCanonical(value: unknown): Promise<Digest> {
  const digest = await sha256Hex(canonicalizeForFingerprint(value));
  return { algorithm: DIGEST_ALGORITHM, canonicalization: CANONICALIZATION_ALGORITHM, digest };
}

export interface FormulaVersionBundleInput {
  /** Required — every `FormulationVersion` has exactly one, the same
   *  identity (`formulaId`/`formulaCode`/`formulaVersionId`/
   *  `formulaVersionNumber`) every other supplied row is cross-checked
   *  against. */
  compositionRow: FormulaVersionCompositionRow;
  processRow?: FormulaVersionProcessRow;
  testResultRow?: FormulaVersionTestResultRow;
  stabilityRow?: FormulaVersionStabilityRow;
  doeRow?: FormulaVersionDoeRow;
  correctiveCostContextRow?: FormulaVersionCorrectiveCostContextRow;
  featureRow?: FormulaVersionFeatureRow;
  targetRow?: FormulaVersionTargetRow;
}

type FamilyRow = { formulaId: string; formulaCode: string; formulaVersionId: string; formulaVersionNumber: number };

function rowForFamily(input: FormulaVersionBundleInput, family: FormulaVersionRowFamily): unknown {
  switch (family) {
    case "composition":
      return input.compositionRow;
    case "process":
      return input.processRow;
    case "testResult":
      return input.testResultRow;
    case "stability":
      return input.stabilityRow;
    case "doe":
      return input.doeRow;
    case "correctiveCostContext":
      return input.correctiveCostContextRow;
    case "feature":
      return input.featureRow;
    case "target":
      return input.targetRow;
  }
}

const ROW_SCHEMA_BY_FAMILY: Record<FormulaVersionRowFamily, z.ZodType> = {
  composition: formulaVersionCompositionRowSchema,
  process: formulaVersionProcessRowSchema,
  testResult: formulaVersionTestResultRowSchema,
  stability: formulaVersionStabilityRowSchema,
  doe: formulaVersionDoeRowSchema,
  correctiveCostContext: formulaVersionCorrectiveCostContextRowSchema,
  feature: formulaVersionFeatureRowSchema,
  target: formulaVersionTargetRowSchema,
};

/** Fails closed (`formula_version_identity_conflict`) when a supplied
 *  row's own `formulaId`/`formulaCode`/`formulaVersionId`/
 *  `formulaVersionNumber` contradicts the composition row's — the same
 *  "resolve both sides of a redundant identity, fail closed on
 *  contradiction" discipline every prior FVL-05 extractor applies. */
function assertMatchesComposition(row: FamilyRow, composition: FamilyRow, family: FormulaVersionRowFamily): void {
  if (
    row.formulaId !== composition.formulaId ||
    row.formulaCode !== composition.formulaCode ||
    row.formulaVersionId !== composition.formulaVersionId ||
    row.formulaVersionNumber !== composition.formulaVersionNumber
  ) {
    throw new DatasetManifestBuilderError(
      "formula_version_identity_conflict",
      `The supplied "${family}" row's identity (formulaId "${row.formulaId}", formulaCode "${row.formulaCode}", formulaVersionId "${row.formulaVersionId}", formulaVersionNumber ${row.formulaVersionNumber}) contradicts the composition row's identity (formulaId "${composition.formulaId}", formulaCode "${composition.formulaCode}", formulaVersionId "${composition.formulaVersionId}", formulaVersionNumber ${composition.formulaVersionNumber}).`,
      { family, formulaVersionId: row.formulaVersionId },
    );
  }
}

/** Builds one formula-version bundle manifest from whichever
 *  FVL-05.003-.010 rows are supplied. Every supplied row is re-validated
 *  against its own canonical schema before being hashed — reusing prior
 *  schema validation (never inventing a second one) and guaranteeing an
 *  invalid/stale-version pseudo-row is rejected before it can ever
 *  receive an authoritative fingerprint. Fails closed on a schema-invalid
 *  row or a cross-row identity contradiction. Never mutates a supplied
 *  row (each is rebuilt fresh by its own schema's `.parse()`); the
 *  returned manifest shares no mutable structure with any input. */
export async function buildFormulaVersionBundleManifest(input: FormulaVersionBundleInput): Promise<FormulaVersionBundleManifest> {
  const compositionParsed = formulaVersionCompositionRowSchema.safeParse(input.compositionRow);
  if (!compositionParsed.success) {
    const issues = compositionParsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new DatasetManifestBuilderError("invalid_row", `The supplied "composition" row failed its own canonical schema validation: ${issues}`, {
      family: "composition",
    });
  }
  const composition = compositionParsed.data;
  const rows: { family: FormulaVersionRowFamily; algorithm: typeof DIGEST_ALGORITHM; canonicalization: typeof CANONICALIZATION_ALGORITHM; digest: string }[] = [];

  for (const family of FORMULA_VERSION_ROW_FAMILIES) {
    const raw = family === "composition" ? composition : rowForFamily(input, family);
    if (raw === undefined) continue;

    const schema = ROW_SCHEMA_BY_FAMILY[family];
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
      throw new DatasetManifestBuilderError(
        "invalid_row",
        `The supplied "${family}" row for formula version "${composition.formulaVersionId}" failed its own canonical schema validation: ${issues}`,
        { family, formulaVersionId: composition.formulaVersionId },
      );
    }
    const row = parsed.data as FamilyRow;
    if (family !== "composition") {
      assertMatchesComposition(row, composition, family);
    }

    const digest = await digestCanonical(row);
    rows.push({ family, ...digest });
  }

  const bundle = await digestCanonical(rows);

  const manifest = {
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    formulaId: composition.formulaId,
    formulaCode: composition.formulaCode,
    formulaVersionId: composition.formulaVersionId,
    formulaVersionNumber: composition.formulaVersionNumber,
    rows,
    bundle,
  };
  const parsed = formulaVersionBundleManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new DatasetManifestBuilderError(
      "invalid_row",
      `Constructed bundle manifest for formula version "${composition.formulaVersionId}" failed schema validation: ${issues}`,
      { formulaVersionId: composition.formulaVersionId },
    );
  }
  return parsed.data;
}

/** Builds the dataset-level manifest from a set of already-built formula-
 *  version bundle manifests. Fails closed on more than one bundle for the
 *  same `formulaVersionId` (ambiguous membership). Entries are sorted by
 *  `formulaVersionId` (ordinal) before hashing — membership is a SET,
 *  never a caller-meaningful sequence, so callers supplying the same
 *  bundles in a different order produce a byte-identical `dataset`
 *  digest. Never mutates the supplied `bundles` array or its elements. */
export async function buildDatasetManifest(bundles: FormulaVersionBundleManifest[]): Promise<DatasetManifest> {
  const seen = new Set<string>();
  for (const bundle of bundles) {
    if (seen.has(bundle.formulaVersionId)) {
      throw new DatasetManifestBuilderError(
        "duplicate_formula_version_bundle",
        `Ambiguous exact formula version identity: more than one supplied bundle has formulaVersionId "${bundle.formulaVersionId}".`,
        { formulaVersionId: bundle.formulaVersionId },
      );
    }
    seen.add(bundle.formulaVersionId);
  }

  const sorted = [...bundles].sort((a, b) => compareOrdinal(a.formulaVersionId, b.formulaVersionId));
  const entries = sorted.map((bundle) => ({ formulaVersionId: bundle.formulaVersionId, bundle: bundle.bundle }));
  const dataset = await digestCanonical(entries);

  const manifest = { manifestSchemaVersion: MANIFEST_SCHEMA_VERSION, entries, dataset };
  const parsed = datasetManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new DatasetManifestBuilderError("invalid_row", `Constructed dataset manifest failed schema validation: ${issues}`);
  }
  return parsed.data;
}
