import { describe, expect, it } from "vitest";
import {
  DatasetManifestBuilderError,
  buildDatasetManifest,
  buildFormulaVersionBundleManifest,
  canonicalizeForFingerprint,
  digestCanonical,
  sha256Hex,
  type FormulaVersionBundleInput,
} from "./datasetManifestBuilder";
import {
  buildDatasetManifest as buildDatasetManifestFromPublicEntryPoint,
  buildFormulaVersionBundleManifest as buildFormulaVersionBundleManifestFromPublicEntryPoint,
} from "../index";
import { extractFormulaVersionFeatureRows } from "./formulaVersionFeatureExtractor";
import { extractFormulaVersionTargetRows } from "./formulaVersionTargetExtractor";
import {
  CANONICALIZATION_ALGORITHM,
  DIGEST_ALGORITHM,
  MANIFEST_SCHEMA_VERSION,
  datasetManifestSchema,
  formulaVersionBundleManifestSchema,
} from "../schemas/datasetManifest";
import {
  DATASET_SCHEMA_VERSION,
  formulaVersionCompositionRowSchema,
  formulaVersionDoeRowSchema,
  formulaVersionStabilityRowSchema,
  formulaVersionTestResultRowSchema,
  type FormulaVersionCompositionRow,
  type FormulaVersionDoeRow,
  type FormulaVersionStabilityRow,
  type FormulaVersionTestResultRow,
} from "../schemas/dataset";

// ---------------------------------------------------------------------------
// Fixture builders — each goes through its own real schema `.parse()`.
// ---------------------------------------------------------------------------

const BASE_LINEAGE = [
  { sourceEntity: "formulation", sourceRecordId: "FORM-0001" },
  { sourceEntity: "formulationVersion", sourceRecordId: "VER-0001" },
];

function compositionRow(over: Record<string, unknown> = {}): FormulaVersionCompositionRow {
  return formulaVersionCompositionRowSchema.parse({
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    sourceRecords: BASE_LINEAGE,
    formulaId: "FORM-0001",
    formulaCode: "HC-SHAMPOO-REG-001",
    formulaVersionId: "VER-0001",
    formulaVersionNumber: 1,
    composition: [
      {
        id: "LINE-A",
        lineNumber: 0,
        displayName: "Water",
        percent: "70.0000",
        quantity: "70",
        quantityUnit: "kg",
        provenance: { origin: "chemist_override" },
      },
    ],
    materials: [],
    productFamilyCode: "HC-SHAMPOO-REG",
    ...over,
  });
}

function testResult(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0",
    id: "RESULT-0001",
    trialId: "TRIAL-0001",
    testDefinitionId: "TESTDEF-0001",
    resultType: "numeric",
    unit: "g",
    replicates: [{ replicateNumber: 1, numericValue: "10" }],
    attachments: [],
    passFail: "not_evaluated",
    performedBy: "chemist",
    performedAt: "2026-01-04T00:00:00.000Z",
    createdAt: "2026-01-04T00:00:00.000Z",
    updatedAt: "2026-01-04T00:00:00.000Z",
    ...over,
  };
}

function testResultRow(over: Record<string, unknown> = {}): FormulaVersionTestResultRow {
  return formulaVersionTestResultRowSchema.parse({
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    sourceRecords: BASE_LINEAGE,
    formulaId: "FORM-0001",
    formulaCode: "HC-SHAMPOO-REG-001",
    formulaVersionId: "VER-0001",
    formulaVersionNumber: 1,
    trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult()] }],
    ...over,
  });
}

function stabilityRow(over: Record<string, unknown> = {}): FormulaVersionStabilityRow {
  return formulaVersionStabilityRowSchema.parse({
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    sourceRecords: BASE_LINEAGE,
    formulaId: "FORM-0001",
    formulaCode: "HC-SHAMPOO-REG-001",
    formulaVersionId: "VER-0001",
    formulaVersionNumber: 1,
    studies: [],
    ...over,
  });
}

function doeRow(over: Record<string, unknown> = {}): FormulaVersionDoeRow {
  return formulaVersionDoeRowSchema.parse({
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    sourceRecords: BASE_LINEAGE,
    formulaId: "FORM-0001",
    formulaCode: "HC-SHAMPOO-REG-001",
    formulaVersionId: "VER-0001",
    formulaVersionNumber: 1,
    studies: [],
    ...over,
  });
}

function fullBundleInput(): FormulaVersionBundleInput {
  const composition = compositionRow();
  const testResultR = testResultRow();
  const [feature] = extractFormulaVersionFeatureRows({ formulaVersionIds: ["VER-0001"], compositionRows: [composition], testResultRows: [testResultR] });
  const [target] = extractFormulaVersionTargetRows({ formulaVersionIds: ["VER-0001"], compositionRows: [composition], testResultRows: [testResultR] });
  return { compositionRow: composition, testResultRow: testResultR, featureRow: feature, targetRow: target };
}

// ---------------------------------------------------------------------------
// canonicalizeForFingerprint
// ---------------------------------------------------------------------------

describe("canonicalizeForFingerprint", () => {
  it("sorts object keys ordinally regardless of insertion order", () => {
    expect(canonicalizeForFingerprint({ b: 1, a: 2 })).toBe(canonicalizeForFingerprint({ a: 2, b: 1 }));
    expect(canonicalizeForFingerprint({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it("never reorders array elements — array order is domain-meaningful, not touched", () => {
    expect(canonicalizeForFingerprint([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalizeForFingerprint([3, 1, 2])).not.toBe(canonicalizeForFingerprint([1, 2, 3]));
  });

  it("omits an undefined object property entirely, distinct from a present null", () => {
    expect(canonicalizeForFingerprint({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalizeForFingerprint({ a: null, b: 1 })).toBe('{"a":null,"b":1}');
    expect(canonicalizeForFingerprint({ a: undefined, b: 1 })).not.toBe(canonicalizeForFingerprint({ a: null, b: 1 }));
  });

  it("distinguishes an explicit empty string from a missing key", () => {
    expect(canonicalizeForFingerprint({ a: "" })).not.toBe(canonicalizeForFingerprint({}));
  });

  it("distinguishes an explicit zero from a missing key", () => {
    expect(canonicalizeForFingerprint({ a: 0 })).not.toBe(canonicalizeForFingerprint({}));
  });

  it("distinguishes explicit false from missing and from true", () => {
    expect(canonicalizeForFingerprint({ a: false })).not.toBe(canonicalizeForFingerprint({}));
    expect(canonicalizeForFingerprint({ a: false })).not.toBe(canonicalizeForFingerprint({ a: true }));
  });

  it("preserves Unicode/delimiter-rich strings exactly, never normalized", () => {
    const weird = "µg/L³·〜特殊[test]\"quoted\"";
    expect(canonicalizeForFingerprint(weird)).toBe(JSON.stringify(weird));
  });

  it("distinguishes case — exact opaque ids stay case-sensitive", () => {
    expect(canonicalizeForFingerprint("ABC")).not.toBe(canonicalizeForFingerprint("abc"));
  });

  it("is deterministic under repeated calls with the same input", () => {
    const value = { z: [1, 2, { nested: "x" }], a: "y" };
    expect(canonicalizeForFingerprint(value)).toBe(canonicalizeForFingerprint(value));
  });

  it("produces the same canonical string for a deep-cloned but key-reordered structure", () => {
    const original = { outer: { b: 1, a: { y: 2, x: 1 } } };
    const reordered = { outer: { a: { x: 1, y: 2 }, b: 1 } };
    expect(canonicalizeForFingerprint(original)).toBe(canonicalizeForFingerprint(reordered));
  });
});

// ---------------------------------------------------------------------------
// sha256Hex / digestCanonical
// ---------------------------------------------------------------------------

describe("sha256Hex / digestCanonical", () => {
  it("produces a real, known SHA-256 digest (empty string) — proves it is genuine SHA-256, not an invented algorithm", async () => {
    // Well-known test vector: SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("produces a lowercase, exactly-64-hex-character digest", async () => {
    const hex = await sha256Hex("formulab");
    expect(hex).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic — identical input twice produces an identical digest", async () => {
    expect(await sha256Hex("same input")).toBe(await sha256Hex("same input"));
  });

  it("a single-character input difference changes the digest completely", async () => {
    expect(await sha256Hex("input-a")).not.toBe(await sha256Hex("input-b"));
  });

  it("digestCanonical wraps the digest with explicit algorithm/canonicalization identifiers, never a bare hash", async () => {
    const result = await digestCanonical({ a: 1 });
    expect(result.algorithm).toBe(DIGEST_ALGORITHM);
    expect(result.canonicalization).toBe(CANONICALIZATION_ALGORITHM);
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// buildFormulaVersionBundleManifest
// ---------------------------------------------------------------------------

describe("buildFormulaVersionBundleManifest", () => {
  it("includes only the composition family when no other row is supplied", async () => {
    const manifest = await buildFormulaVersionBundleManifest({ compositionRow: compositionRow() });
    expect(manifest.rows.map((r) => r.family)).toEqual(["composition"]);
    expect(manifest.manifestSchemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(manifest.formulaVersionId).toBe("VER-0001");
  });

  it("includes every supplied family, in the fixed family order, regardless of input object key order", async () => {
    const input1: FormulaVersionBundleInput = { doeRow: doeRow(), compositionRow: compositionRow(), stabilityRow: stabilityRow() };
    const input2: FormulaVersionBundleInput = { stabilityRow: stabilityRow(), compositionRow: compositionRow(), doeRow: doeRow() };
    const manifest1 = await buildFormulaVersionBundleManifest(input1);
    const manifest2 = await buildFormulaVersionBundleManifest(input2);
    expect(manifest1.rows.map((r) => r.family)).toEqual(["composition", "stability", "doe"]);
    expect(manifest1.bundle).toEqual(manifest2.bundle);
  });

  it("produces byte-identical bundle digests for identical, deep-cloned input", async () => {
    const input = fullBundleInput();
    const cloned = structuredClone(input);
    const manifestA = await buildFormulaVersionBundleManifest(input);
    const manifestB = await buildFormulaVersionBundleManifest(cloned);
    expect(manifestA.bundle).toEqual(manifestB.bundle);
    expect(manifestA.rows).toEqual(manifestB.rows);
  });

  it("changes the bundle digest when one normalized feature value changes", async () => {
    const base = fullBundleInput();
    const changed = fullBundleInput();
    (changed.compositionRow.composition[0] as { quantity: string }).quantity = "71";
    const [changedFeature] = extractFormulaVersionFeatureRows({
      formulaVersionIds: ["VER-0001"],
      compositionRows: [changed.compositionRow],
      testResultRows: [changed.testResultRow!],
    });
    changed.featureRow = changedFeature;
    const manifestBase = await buildFormulaVersionBundleManifest(base);
    const manifestChanged = await buildFormulaVersionBundleManifest(changed);
    expect(manifestBase.bundle).not.toEqual(manifestChanged.bundle);
  });

  it("changes the bundle digest when one measured target value changes", async () => {
    const base = fullBundleInput();
    const changedResult = testResultRow({
      trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ replicates: [{ replicateNumber: 1, numericValue: "999" }] })] }],
    });
    const [changedTarget] = extractFormulaVersionTargetRows({
      formulaVersionIds: ["VER-0001"],
      compositionRows: [base.compositionRow],
      testResultRows: [changedResult],
    });
    const changed: FormulaVersionBundleInput = { ...base, targetRow: changedTarget };
    const manifestBase = await buildFormulaVersionBundleManifest(base);
    const manifestChanged = await buildFormulaVersionBundleManifest(changed);
    expect(manifestBase.bundle).not.toEqual(manifestChanged.bundle);
  });

  it("changes the bundle digest when a source lineage parentRecordId differs", async () => {
    const withoutParent = compositionRow();
    const withParent = compositionRow({
      sourceRecords: [...BASE_LINEAGE, { sourceEntity: "trialProcessStep", sourceRecordId: "STEP-1", parentRecordId: "TRIAL-1" }],
    });
    const manifestA = await buildFormulaVersionBundleManifest({ compositionRow: withoutParent });
    const manifestB = await buildFormulaVersionBundleManifest({ compositionRow: withParent });
    expect(manifestA.bundle).not.toEqual(manifestB.bundle);
  });

  it("changes the digest when exact source id casing changes", async () => {
    const lower = compositionRow({ formulaId: "form-0001", sourceRecords: [{ sourceEntity: "formulation", sourceRecordId: "form-0001" }] });
    const upper = compositionRow({ formulaId: "FORM-0001", sourceRecords: [{ sourceEntity: "formulation", sourceRecordId: "FORM-0001" }] });
    const manifestLower = await buildFormulaVersionBundleManifest({ compositionRow: lower });
    const manifestUpper = await buildFormulaVersionBundleManifest({ compositionRow: upper });
    expect(manifestLower.bundle).not.toEqual(manifestUpper.bundle);
  });

  it("remains stable for Unicode/delimiter-rich ids", async () => {
    const weird = "FORM-µg/L³·〜特殊[test]";
    const row = compositionRow({ formulaId: weird, sourceRecords: [{ sourceEntity: "formulation", sourceRecordId: weird }] });
    const manifestA = await buildFormulaVersionBundleManifest({ compositionRow: row });
    const manifestB = await buildFormulaVersionBundleManifest({ compositionRow: structuredClone(row) });
    expect(manifestA.bundle).toEqual(manifestB.bundle);
  });

  it("fails closed on a schema-invalid row (never hashes an invalid pseudo-row)", async () => {
    const invalidComposition = { ...compositionRow(), formulaId: "" } as unknown as FormulaVersionCompositionRow;
    await expect(buildFormulaVersionBundleManifest({ compositionRow: invalidComposition })).rejects.toThrow(DatasetManifestBuilderError);
    try {
      await buildFormulaVersionBundleManifest({ compositionRow: invalidComposition });
      expect.unreachable();
    } catch (err) {
      expect((err as DatasetManifestBuilderError).code).toBe("invalid_row");
    }
  });

  it("fails closed on a stale/superseded schema-version literal (never hashes an invalid pseudo-row)", async () => {
    const staleRow = { ...compositionRow(), datasetSchemaVersion: "1.5" } as unknown as FormulaVersionCompositionRow;
    try {
      await buildFormulaVersionBundleManifest({ compositionRow: staleRow });
      expect.unreachable();
    } catch (err) {
      expect((err as DatasetManifestBuilderError).code).toBe("invalid_row");
    }
  });

  it("fails closed when a supplied row's formulaId contradicts the composition row's", async () => {
    const composition = compositionRow();
    const conflicting = testResultRow({ formulaId: "FORM-OTHER" });
    try {
      await buildFormulaVersionBundleManifest({ compositionRow: composition, testResultRow: conflicting });
      expect.unreachable();
    } catch (err) {
      expect((err as DatasetManifestBuilderError).code).toBe("formula_version_identity_conflict");
    }
  });

  it("does not mutate any supplied input row", async () => {
    const input = fullBundleInput();
    const frozenCopy = structuredClone(input);
    await buildFormulaVersionBundleManifest(input);
    expect(input).toEqual(frozenCopy);
  });

  it("returns output that shares no mutable aliasing with the source — mutating the result never touches the input", async () => {
    const input = fullBundleInput();
    const manifest = await buildFormulaVersionBundleManifest(input);
    manifest.rows.push({ family: "composition", algorithm: DIGEST_ALGORITHM, canonicalization: CANONICALIZATION_ALGORITHM, digest: "0".repeat(64) });
    const manifestAgain = await buildFormulaVersionBundleManifest(input);
    expect(manifestAgain.rows).toHaveLength(manifest.rows.length - 1);
  });

  it("round-trips through JSON and still validates against formulaVersionBundleManifestSchema", async () => {
    const manifest = await buildFormulaVersionBundleManifest(fullBundleInput());
    const roundTripped = JSON.parse(JSON.stringify(manifest));
    expect(() => formulaVersionBundleManifestSchema.parse(roundTripped)).not.toThrow();
    expect(roundTripped).toEqual(manifest);
  });

  it("is exported from the package's public entry point", () => {
    expect(buildFormulaVersionBundleManifestFromPublicEntryPoint).toBe(buildFormulaVersionBundleManifest);
  });
});

// ---------------------------------------------------------------------------
// buildDatasetManifest
// ---------------------------------------------------------------------------

describe("buildDatasetManifest", () => {
  it("orders entries by formulaVersionId (ordinal), independent of caller-supplied bundle order", async () => {
    const bundleA = await buildFormulaVersionBundleManifest({ compositionRow: compositionRow({ formulaVersionId: "VER-AAA" }) });
    const bundleB = await buildFormulaVersionBundleManifest({ compositionRow: compositionRow({ formulaVersionId: "VER-BBB" }) });
    const manifest1 = await buildDatasetManifest([bundleB, bundleA]);
    const manifest2 = await buildDatasetManifest([bundleA, bundleB]);
    expect(manifest1.entries.map((e) => e.formulaVersionId)).toEqual(["VER-AAA", "VER-BBB"]);
    expect(manifest1.dataset).toEqual(manifest2.dataset);
  });

  it("produces an identical dataset digest for the same SET of bundles regardless of array order — permutation invariant", async () => {
    const bundles = await Promise.all(
      ["VER-1", "VER-2", "VER-3"].map((id) => buildFormulaVersionBundleManifest({ compositionRow: compositionRow({ formulaVersionId: id }) })),
    );
    const manifestForward = await buildDatasetManifest(bundles);
    const manifestReversed = await buildDatasetManifest([...bundles].reverse());
    expect(manifestForward.dataset).toEqual(manifestReversed.dataset);
  });

  it("fails closed on more than one bundle for the same formulaVersionId", async () => {
    const bundle = await buildFormulaVersionBundleManifest({ compositionRow: compositionRow() });
    try {
      await buildDatasetManifest([bundle, bundle]);
      expect.unreachable();
    } catch (err) {
      expect((err as DatasetManifestBuilderError).code).toBe("duplicate_formula_version_bundle");
    }
  });

  it("produces a different dataset digest when a single included bundle's own digest changes", async () => {
    const bundleV1 = await buildFormulaVersionBundleManifest({ compositionRow: compositionRow() });
    const bundleV2 = await buildFormulaVersionBundleManifest({
      compositionRow: compositionRow({ composition: [{ id: "LINE-A", lineNumber: 0, displayName: "Water", percent: "80.0000", provenance: { origin: "chemist_override" } }] }),
    });
    const manifest1 = await buildDatasetManifest([bundleV1]);
    const manifest2 = await buildDatasetManifest([bundleV2]);
    expect(manifest1.dataset).not.toEqual(manifest2.dataset);
  });

  it("handles an empty bundle set deterministically", async () => {
    const manifest = await buildDatasetManifest([]);
    expect(manifest.entries).toEqual([]);
    const manifestAgain = await buildDatasetManifest([]);
    expect(manifest.dataset).toEqual(manifestAgain.dataset);
  });

  it("does not mutate the supplied bundles array or its elements", async () => {
    const bundle = await buildFormulaVersionBundleManifest({ compositionRow: compositionRow() });
    const bundles = [bundle];
    const frozenCopy = structuredClone(bundles);
    await buildDatasetManifest(bundles);
    expect(bundles).toEqual(frozenCopy);
  });

  it("round-trips through JSON and still validates against datasetManifestSchema", async () => {
    const bundle = await buildFormulaVersionBundleManifest({ compositionRow: compositionRow() });
    const manifest = await buildDatasetManifest([bundle]);
    const roundTripped = JSON.parse(JSON.stringify(manifest));
    expect(() => datasetManifestSchema.parse(roundTripped)).not.toThrow();
    expect(roundTripped).toEqual(manifest);
  });

  it("is exported from the package's public entry point", () => {
    expect(buildDatasetManifestFromPublicEntryPoint).toBe(buildDatasetManifest);
  });

  it("proves no wall-clock timestamp, random value, or machine path enters the digest — same logical input, any number of runs, identical dataset digest", async () => {
    const bundle = await buildFormulaVersionBundleManifest({ compositionRow: compositionRow() });
    const digests = await Promise.all(Array.from({ length: 5 }, () => buildDatasetManifest([bundle])));
    const uniqueDigests = new Set(digests.map((m) => m.dataset.digest));
    expect(uniqueDigests.size).toBe(1);
  });
});
