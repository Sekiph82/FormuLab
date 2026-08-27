import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  DATASET_SCHEMA_VERSION,
  FEATURE_SCHEMA_VERSION,
  datasetRowBaseSchema,
  datasetSchemaVersionSchema,
  datasetSchemaVersionedSchema,
  featureSchemaVersionSchema,
  featureSchemaVersionedSchema,
  sourceRecordLineageSchema,
  sourceRecordReferenceSchema,
} from "./dataset";

describe("dataset schema version", () => {
  it("is an explicit literal, not a free-form string", () => {
    expect(DATASET_SCHEMA_VERSION).toBe("1.6");
    expect(datasetSchemaVersionSchema.safeParse("1.6").success).toBe(true);
    expect(datasetSchemaVersionSchema.safeParse("").success).toBe(false);
    expect(datasetSchemaVersionSchema.safeParse(1.6).success).toBe(false);
  });

  it("every superseded prior version is explicitly rejected — old and new row identity can never be ambiguous, across every bump", () => {
    expect(datasetSchemaVersionSchema.safeParse("1.0").success).toBe(false);
    expect(datasetSchemaVersionSchema.safeParse("1.1").success).toBe(false);
    expect(datasetSchemaVersionSchema.safeParse("1.2").success).toBe(false);
    expect(datasetSchemaVersionSchema.safeParse("1.3").success).toBe(false);
    expect(datasetSchemaVersionSchema.safeParse("1.4").success).toBe(false);
    expect(datasetSchemaVersionSchema.safeParse("1.5").success).toBe(false);
  });

  it("rejects a record missing the field, so the version can never be silently absent", () => {
    expect(datasetSchemaVersionedSchema.safeParse({}).success).toBe(false);
    expect(
      datasetSchemaVersionedSchema.safeParse({ datasetSchemaVersion: DATASET_SCHEMA_VERSION }).success,
    ).toBe(true);
  });
});

describe("feature schema version", () => {
  it("is an explicit literal, not a free-form string", () => {
    expect(FEATURE_SCHEMA_VERSION).toBe("1.1");
    expect(featureSchemaVersionSchema.safeParse("1.1").success).toBe(true);
    expect(featureSchemaVersionSchema.safeParse("1.2").success).toBe(false);
    expect(featureSchemaVersionSchema.safeParse("").success).toBe(false);
    expect(featureSchemaVersionSchema.safeParse(1.1).success).toBe(false);
  });

  it("rejects the superseded FVL-05.009 literal — old and new feature-row identity can never be ambiguous", () => {
    expect(featureSchemaVersionSchema.safeParse("1.0").success).toBe(false);
  });

  it("rejects a record missing the field, so the version can never be silently absent", () => {
    expect(featureSchemaVersionedSchema.safeParse({}).success).toBe(false);
    expect(
      featureSchemaVersionedSchema.safeParse({ featureSchemaVersion: FEATURE_SCHEMA_VERSION }).success,
    ).toBe(true);
  });
});

describe("dataset schema version vs feature schema version — independence", () => {
  it("are two distinct fields that can be validated independently of one another", () => {
    const combinedSchema = datasetSchemaVersionedSchema.merge(featureSchemaVersionedSchema);

    // Valid dataset version + invalid feature version: only the feature field fails.
    const badFeature = combinedSchema.safeParse({
      datasetSchemaVersion: DATASET_SCHEMA_VERSION,
      featureSchemaVersion: "9.9",
    });
    expect(badFeature.success).toBe(false);
    if (!badFeature.success) {
      const paths = badFeature.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("featureSchemaVersion");
      expect(paths).not.toContain("datasetSchemaVersion");
    }

    // Invalid dataset version + valid feature version: only the dataset field fails.
    const badDataset = combinedSchema.safeParse({
      datasetSchemaVersion: "9.9",
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    });
    expect(badDataset.success).toBe(false);
    if (!badDataset.success) {
      const paths = badDataset.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("datasetSchemaVersion");
      expect(paths).not.toContain("featureSchemaVersion");
    }

    // Both valid: the combined record is accepted, each field independently identifiable.
    const both = combinedSchema.parse({
      datasetSchemaVersion: DATASET_SCHEMA_VERSION,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    });
    expect(both.datasetSchemaVersion).toBe(DATASET_SCHEMA_VERSION);
    expect(both.featureSchemaVersion).toBe(FEATURE_SCHEMA_VERSION);
  });

  it("round-trips through JSON deterministically without the two versions colliding or swapping", () => {
    const record = { datasetSchemaVersion: DATASET_SCHEMA_VERSION, featureSchemaVersion: FEATURE_SCHEMA_VERSION };
    const serializedOnce = JSON.stringify(record);
    const serializedTwice = JSON.stringify(record);
    expect(serializedOnce).toBe(serializedTwice);

    const parsed = JSON.parse(serializedOnce);
    expect(parsed.datasetSchemaVersion).toBe(DATASET_SCHEMA_VERSION);
    expect(parsed.featureSchemaVersion).toBe(FEATURE_SCHEMA_VERSION);
    expect(Object.keys(parsed).sort()).toEqual(["datasetSchemaVersion", "featureSchemaVersion"]);
  });
});

describe("source record lineage (FVL-05.002)", () => {
  const row = (sourceRecords: unknown) => ({
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    sourceRecords,
  });

  it("accepts a row with one exact source-record reference", () => {
    const result = datasetRowBaseSchema.safeParse(
      row([{ sourceEntity: "formulation", sourceRecordId: "FORM-0001" }]),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceRecords).toEqual([
        { sourceEntity: "formulation", sourceRecordId: "FORM-0001" },
      ]);
    }
  });

  it("accepts multiple references and preserves their exact values and order", () => {
    const refs = [
      { sourceEntity: "formulation", sourceRecordId: "FORM-0001" },
      { sourceEntity: "labResult", sourceRecordId: "LAB-9982" },
      { sourceEntity: "correctiveAction", sourceRecordId: "CA-004" },
    ];
    const result = datasetRowBaseSchema.safeParse(row(refs));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceRecords).toEqual(refs);
    }
  });

  it("rejects missing lineage", () => {
    const result = datasetRowBaseSchema.safeParse({ datasetSchemaVersion: DATASET_SCHEMA_VERSION });
    expect(result.success).toBe(false);
  });

  it("rejects empty lineage", () => {
    const result = datasetRowBaseSchema.safeParse(row([]));
    expect(result.success).toBe(false);
  });

  it("rejects missing, blank, whitespace-only, or non-string entity discriminators", () => {
    expect(
      sourceRecordReferenceSchema.safeParse({ sourceRecordId: "FORM-0001" }).success,
    ).toBe(false);
    expect(
      sourceRecordReferenceSchema.safeParse({ sourceEntity: "", sourceRecordId: "FORM-0001" })
        .success,
    ).toBe(false);
    expect(
      sourceRecordReferenceSchema.safeParse({ sourceEntity: "   ", sourceRecordId: "FORM-0001" })
        .success,
    ).toBe(false);
    expect(
      sourceRecordReferenceSchema.safeParse({ sourceEntity: 123, sourceRecordId: "FORM-0001" })
        .success,
    ).toBe(false);
  });

  it("rejects missing, blank, whitespace-only, or non-string source record ids", () => {
    expect(
      sourceRecordReferenceSchema.safeParse({ sourceEntity: "formulation" }).success,
    ).toBe(false);
    expect(
      sourceRecordReferenceSchema.safeParse({ sourceEntity: "formulation", sourceRecordId: "" })
        .success,
    ).toBe(false);
    expect(
      sourceRecordReferenceSchema.safeParse({ sourceEntity: "formulation", sourceRecordId: "  " })
        .success,
    ).toBe(false);
    expect(
      sourceRecordReferenceSchema.safeParse({ sourceEntity: "formulation", sourceRecordId: 42 })
        .success,
    ).toBe(false);
  });

  it("keeps ids case-sensitive and never trims or normalizes them", () => {
    const result = sourceRecordReferenceSchema.safeParse({
      sourceEntity: "formulation",
      sourceRecordId: "  FoRm-0001  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceRecordId).toBe("  FoRm-0001  ");
    }

    const distinctCase = sourceRecordReferenceSchema.safeParse({
      sourceEntity: "formulation",
      sourceRecordId: "form-0001",
    });
    expect(distinctCase.success).toBe(true);
    expect(
      sourceRecordLineageSchema.safeParse([
        { sourceEntity: "formulation", sourceRecordId: "FORM-0001" },
        { sourceEntity: "formulation", sourceRecordId: "form-0001" },
      ]).success,
    ).toBe(true);
  });

  it("accepts the same record id under different entity discriminators", () => {
    const result = sourceRecordLineageSchema.safeParse([
      { sourceEntity: "formulation", sourceRecordId: "0001" },
      { sourceEntity: "labResult", sourceRecordId: "0001" },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects an exact duplicate (sourceEntity, sourceRecordId) pair", () => {
    const result = sourceRecordLineageSchema.safeParse([
      { sourceEntity: "formulation", sourceRecordId: "FORM-0001" },
      { sourceEntity: "formulation", sourceRecordId: "FORM-0001" },
    ]);
    expect(result.success).toBe(false);
  });

  it("keeps the existing dataset schema version mandatory and independently validated", () => {
    const missingVersion = datasetRowBaseSchema.safeParse({
      sourceRecords: [{ sourceEntity: "formulation", sourceRecordId: "FORM-0001" }],
    });
    expect(missingVersion.success).toBe(false);

    const wrongVersion = datasetRowBaseSchema.safeParse({
      datasetSchemaVersion: "9.9",
      sourceRecords: [{ sourceEntity: "formulation", sourceRecordId: "FORM-0001" }],
    });
    expect(wrongVersion.success).toBe(false);
  });

  it("round-trips exact source identities through JSON serialization and parsing", () => {
    const parsed = datasetRowBaseSchema.parse(
      row([
        { sourceEntity: "formulation", sourceRecordId: "FORM-0001" },
        { sourceEntity: "labResult", sourceRecordId: "  LAB-9982" },
      ]),
    );
    const roundTripped = JSON.parse(JSON.stringify(parsed));
    expect(roundTripped).toEqual(parsed);
    expect(roundTripped.sourceRecords[1].sourceRecordId).toBe("  LAB-9982");
  });

  it("lets a synthetic payload schema extend the row base without weakening mandatory lineage", () => {
    const syntheticDatasetRowSchema = datasetRowBaseSchema.extend({
      syntheticFeatureA: z.number(),
    });

    const missingLineage = syntheticDatasetRowSchema.safeParse({
      datasetSchemaVersion: DATASET_SCHEMA_VERSION,
      syntheticFeatureA: 1.5,
    });
    expect(missingLineage.success).toBe(false);

    const withLineage = syntheticDatasetRowSchema.safeParse({
      datasetSchemaVersion: DATASET_SCHEMA_VERSION,
      syntheticFeatureA: 1.5,
      sourceRecords: [{ sourceEntity: "formulation", sourceRecordId: "FORM-0001" }],
    });
    expect(withLineage.success).toBe(true);
  });
});
