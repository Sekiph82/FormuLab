/**
 * FVL-05.011 — dataset hash/fingerprint + reproducible rebuild from source
 * records.
 *
 * SOURCE RECOVERY (not inferred from the tracker's short title — see
 * `docs/external-logs` / `project-control/claude/logs/FormuLab-FVL05-
 * Dataset-Schema-Versioning-Log.md`'s own FVL-05.011 section for the full
 * question-by-question evidence trail):
 *
 * WHAT IS FINGERPRINTED (three levels, `Depends on FVL-05.009` in the
 * tracker but reused generically across every FVL-05.002-.010 row family
 * — FVL-05.012's own "no same-formula-version rows split across
 * partitions" wording and FVL-05.014's own "lineage round-trip" wording
 * both presuppose a formula-version-scoped bundle already exists to
 * partition/round-trip):
 *
 * 1. ROW-LEVEL: one digest per already-extracted, already-schema-valid
 *    FVL-05.003-.010 row (`formulaVersionRowFingerprintSchema`).
 * 2. BUNDLE-LEVEL: one digest per `FormulationVersion`, over the
 *    canonical, fixed-order array of that version's own row-level digests
 *    (`formulaVersionBundleManifestSchema`) — the exact "one row per
 *    FormulationVersion" grain every FVL-05.003-.010 row already uses,
 *    generalized to "one BUNDLE per FormulationVersion."
 * 3. DATASET-LEVEL: one digest over the canonical, deterministically
 *    ORDERED (by `formulaVersionId`, ordinal — never caller-supplied
 *    order, since dataset MEMBERSHIP is a set, not a sequence) array of
 *    bundle-level digests across every included formula version
 *    (`datasetManifestSchema`) — the level FVL-05.012's partition rules
 *    and FVL-05.014's rebuild-determinism tests will actually consume.
 *
 * WHAT GOES INTO A BUNDLE: exactly the row types
 * `FORMULA_VERSION_ROW_FAMILIES` names, in that FIXED order (composition
 * required — a version always has one, matching every prior FVL-05
 * extractor's own convention; process/testResult/stability/doe/
 * correctiveCostContext/feature/target each independently optional,
 * included only when the caller actually supplies that family's row for
 * this version). A row's OWN embedded `sourceRecords` lineage is already
 * part of what gets canonicalized (the row is hashed whole, exactly as
 * its own extractor returned it) — no separate lineage encoding is
 * needed or invented.
 *
 * CANONICALIZATION (the actual algorithm, `engine/datasetManifestBuilder.ts`'s
 * `canonicalizeForFingerprint()`): object keys sorted by exact ordinal
 * `<` comparison (never `localeCompare`, matching every other FVL-05
 * ordinal-tie-break precedent) — this is the ONLY departure from a row's
 * own natural shape; array element ORDER is NEVER touched (every
 * FVL-05.003-.010 array is already meaningfully ordered by its own
 * extractor — composition lines, replicates, DOE runs — re-sorting here
 * would corrupt exactly the domain order those extractors deliberately
 * preserve); an `undefined`/absent field is OMITTED from the canonical
 * string exactly as it is omitted from the source object (never coerced
 * to `null`, which would collide "explicitly absent" with a genuinely
 * different value); a decimal is ALWAYS the source's own exact string
 * (this package never stores a training-relevant quantity as a raw `z.number()`
 * float, so no locale/precision-formatting ambiguity exists to canonicalize
 * away); no Unicode normalization is performed (an opaque id/string stays
 * byte-for-byte exact, matching "exact opaque ids remain case-sensitive
 * and unnormalized"); output is a single-line, compact (no indentation)
 * string, so no line-ending ambiguity can exist in the first place.
 *
 * DIGEST ALGORITHM: real cryptographic SHA-256
 * (`crypto.subtle.digest("SHA-256", ...)`), NOT the existing
 * `engine/connectorFingerprint.ts`'s FNV-1a `fingerprint()`. Found and
 * rejected reusing FNV-1a: `connectorFingerprint.ts`'s own header comment
 * states plainly "not a cryptographic hash and never used as one," and
 * `schemas/connector.ts`'s own header comment independently confirms the
 * same 32-bit fingerprint is "deliberately never called a hash or SHA256
 * anywhere, since it is not a cryptographic digest and claiming otherwise
 * would overstate the guarantee." A 32-bit space is a genuine collision
 * risk at real ML-dataset-corpus scale in a way FNV-1a's own original,
 * narrower Data-Exchange-schema-drift-detection purpose never had to
 * survive. SHA-256 is not invented here — it is the SAME standard,
 * already-proven-portable API this exact codebase already uses for
 * content-identity hashing: `apps/desktop/src/lib/documentExports/
 * exportHistory.ts`'s `sha256Hex()` and
 * `apps/desktop/src/components/dataExchange/DataExchangeImportDialog.tsx`'s
 * `sha256Hex()` both call `crypto.subtle.digest("SHA-256", ...)` today;
 * `apps/desktop/src-tauri/src/{attachments,backup,data_location_manager,
 * identity}.rs` all use the Rust `sha2` crate's `Sha256` for the exact
 * same "does this content match" purpose. `crypto.subtle` is a true
 * global in both real runtime targets this monorepo ships to — the Tauri
 * webview and Node ≥20 (this repo's own `package.json` `engines.node`
 * requirement) — confirmed by direct check (`globalThis.crypto.subtle`
 * is defined under this repo's own Node version), needing no new
 * dependency and no environment-specific import, exactly matching
 * `exportHistory.ts`'s own documented rationale ("works in the Tauri
 * webview, a real browser, and Node's vitest/jsdom environment"). Digest
 * output is lowercase hex, matching `engine/dataExchangeValidation.ts`'s
 * own `SHA256 = /^[a-f0-9]{64}$/i` convention and `sha256Hex()`'s own
 * `toString(16)` lowercase-by-default output.
 *
 * DELIBERATE, DISCLOSED DEPARTURE FROM THE FVL-05.003-.010 SYNCHRONOUS
 * CONVENTION: `crypto.subtle.digest` is asynchronous — there is no
 * synchronous standard-library SHA-256 available without either adding a
 * new dependency or reimplementing the algorithm by hand (the governing
 * prompt explicitly forbids inventing a custom hash). `packages/shared`
 * already has a real precedent for async engine functions
 * (`engine/databaseConnector.ts`/`fileConnector.ts`/`restApiConnector.ts`
 * — I/O-bound connector adapters), so `engine/datasetManifestBuilder.ts`'s
 * digest-producing functions are async; determinism/purity/non-mutation
 * are unaffected by asynchrony (no wall-clock time, random id, machine
 * path, or process id ever enters the digest — proven by dedicated
 * tests).
 *
 * SOFTWARE/BUILD VERSION IS DELIBERATELY NOT MIXED INTO THE DATA DIGEST
 * (Q10): no existing FVL-05 manifest architecture mixes app-build
 * identity into a data-content hash, and inventing that mixing here
 * would be exactly the unproven contract the governing invariants forbid.
 * The algorithm/canonicalization identifiers ARE included, but as
 * EXPLICIT SIBLING METADATA next to the digest bytes
 * (`rowFingerprintSchema.algorithm`/`.canonicalization`), never hashed
 * into them — satisfying "explicit algorithm identifier" without
 * conflating code-build identity with data identity.
 *
 * VERSIONING (Q14): a THIRD, independent `MANIFEST_SCHEMA_VERSION` is
 * introduced — not `DATASET_SCHEMA_VERSION` (whose own documented scope
 * is "the shape of a dataset ROW," FVL-05.002-.008 raw extracted
 * evidence — a manifest is not that) and not `FEATURE_SCHEMA_VERSION`
 * (whose own documented scope is "normalization + target-variable
 * definitions," FVL-05.009-.010 — a manifest is neither). This mirrors
 * the EXACT reasoning FVL-05.001's own original design already used to
 * justify two independent versions instead of one shared version — "a
 * dataset-row shape change and a feature-vector shape change happen on
 * independent timelines" — extended one step further: a manifest/digest
 * CONTRACT change (e.g. swapping canonicalization algorithms, or which
 * row families a bundle includes) happens on a timeline independent of
 * BOTH a dataset-row shape change AND a feature-vector shape change, so a
 * third independent version constant is the same kind of architecture
 * evidence the governing prompt asks for, not an invented exception.
 * `MANIFEST_SCHEMA_VERSION` starts at `"1.0"` — the FIRST manifest shape
 * ever defined, the identical "nothing existed before, nothing changed"
 * case both `DATASET_SCHEMA_VERSION` (FVL-05.002) and
 * `FEATURE_SCHEMA_VERSION` (FVL-05.009) were already in at their own
 * first definitions, correctly unbumped.
 */
import { z } from "zod";
import { nonBlankString } from "./dataset";

/** First manifest shape ever defined — see this module's own header
 *  comment for why a third, independent version family is genuine
 *  architecture evidence, not an invented exception. */
export const MANIFEST_SCHEMA_VERSION = "1.0" as const;
export const manifestSchemaVersionSchema = z.literal(MANIFEST_SCHEMA_VERSION);
export const manifestSchemaVersionedSchema = z.object({
  manifestSchemaVersion: manifestSchemaVersionSchema,
});
export type ManifestSchemaVersioned = z.infer<typeof manifestSchemaVersionedSchema>;

/** The one, real, cryptographic digest algorithm this module uses — see
 *  this module's own header comment for why FNV-1a
 *  (`engine/connectorFingerprint.ts`) was found and rejected. */
export const DIGEST_ALGORITHM = "sha256" as const;

/** The exact canonical-JSON serialization this module's digests are
 *  computed over — versioned as its own literal (not folded into
 *  `MANIFEST_SCHEMA_VERSION`) so a future canonicalization change can be
 *  identified on an already-emitted digest without ambiguity. */
export const CANONICALIZATION_ALGORITHM = "formulab-canonical-json-v1" as const;

/** A single cryptographic digest, self-describing: never just a bare hex
 *  string a reader has to trust the algorithm/canonicalization of. */
export const digestSchema = z.object({
  algorithm: z.literal(DIGEST_ALGORITHM),
  canonicalization: z.literal(CANONICALIZATION_ALGORITHM),
  /** Lowercase hex SHA-256, exactly 64 characters — matches
   *  `engine/dataExchangeValidation.ts`'s own `SHA256` format convention. */
  digest: z.string().regex(/^[a-f0-9]{64}$/, "must be a lowercase 64-hex-character SHA-256 digest"),
});
export type Digest = z.infer<typeof digestSchema>;

/** The closed, FIXED order every formula-version bundle's row-level
 *  digests are assembled in — never caller-supplied order. `composition`
 *  is always present (every `FormulationVersion` has one, per every
 *  prior FVL-05 extractor's own established convention); every other
 *  family is independently optional, matching each extractor's own
 *  "empty/absent when that family contributes nothing" convention. */
export const FORMULA_VERSION_ROW_FAMILIES = [
  "composition",
  "process",
  "testResult",
  "stability",
  "doe",
  "correctiveCostContext",
  "feature",
  "target",
] as const;
export type FormulaVersionRowFamily = (typeof FORMULA_VERSION_ROW_FAMILIES)[number];

export const formulaVersionRowFingerprintSchema = digestSchema.extend({
  family: z.enum(FORMULA_VERSION_ROW_FAMILIES),
});
export type FormulaVersionRowFingerprint = z.infer<typeof formulaVersionRowFingerprintSchema>;

/** One bundle per `FormulationVersion` — the digest of every row family
 *  actually supplied for that version, in the fixed
 *  `FORMULA_VERSION_ROW_FAMILIES` order, plus one combined `bundle`
 *  digest over that same ordered array. `rows` is never empty (the
 *  required `composition` row guarantees at least one entry). */
export const formulaVersionBundleManifestSchema = manifestSchemaVersionedSchema.extend({
  formulaId: nonBlankString("formulaId"),
  formulaCode: nonBlankString("formulaCode"),
  formulaVersionId: nonBlankString("formulaVersionId"),
  formulaVersionNumber: z.number().int().positive(),
  rows: z.array(formulaVersionRowFingerprintSchema).min(1),
  bundle: digestSchema,
});
export type FormulaVersionBundleManifest = z.infer<typeof formulaVersionBundleManifestSchema>;

/** One dataset-level entry — the bundle digest for exactly one included
 *  formula version. `formulaVersionId` here is the join key a
 *  partitioning/rebuild consumer (FVL-05.012/.014) resolves against;
 *  never a display name, never fuzzy-matched. */
export const datasetManifestEntrySchema = z.object({
  formulaVersionId: nonBlankString("formulaVersionId"),
  bundle: digestSchema,
});
export type DatasetManifestEntry = z.infer<typeof datasetManifestEntrySchema>;

/** The dataset-level manifest: every included formula version's bundle
 *  digest, deterministically ORDERED by `formulaVersionId` (ordinal, not
 *  `localeCompare`, matching every other FVL-05 opaque-id tie-break) —
 *  membership is a SET (which versions are included), never a
 *  caller-supplied sequence, so two callers supplying the same set of
 *  bundles in different orders produce byte-identical `entries` and an
 *  identical `dataset` digest. `dataset` is the combined digest over
 *  that same canonical, ordered `entries` array. */
export const datasetManifestSchema = manifestSchemaVersionedSchema.extend({
  entries: z.array(datasetManifestEntrySchema),
  dataset: digestSchema,
});
export type DatasetManifest = z.infer<typeof datasetManifestSchema>;
