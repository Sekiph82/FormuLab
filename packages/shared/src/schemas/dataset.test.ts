import { describe, expect, it } from "vitest";
import {
  DATASET_SCHEMA_VERSION,
  FEATURE_SCHEMA_VERSION,
  datasetSchemaVersionSchema,
  datasetSchemaVersionedSchema,
  featureSchemaVersionSchema,
  featureSchemaVersionedSchema,
} from "./dataset";

describe("dataset schema version", () => {
  it("is an explicit literal, not a free-form string", () => {
    expect(DATASET_SCHEMA_VERSION).toBe("1.0");
    expect(datasetSchemaVersionSchema.safeParse("1.0").success).toBe(true);
    expect(datasetSchemaVersionSchema.safeParse("1.1").success).toBe(false);
    expect(datasetSchemaVersionSchema.safeParse("").success).toBe(false);
    expect(datasetSchemaVersionSchema.safeParse(1.0).success).toBe(false);
  });

  it("rejects a record missing the field, so the version can never be silently absent", () => {
    expect(datasetSchemaVersionedSchema.safeParse({}).success).toBe(false);
    expect(
      datasetSchemaVersionedSchema.safeParse({ datasetSchemaVersion: "1.0" }).success,
    ).toBe(true);
  });
});

describe("feature schema version", () => {
  it("is an explicit literal, not a free-form string", () => {
    expect(FEATURE_SCHEMA_VERSION).toBe("1.0");
    expect(featureSchemaVersionSchema.safeParse("1.0").success).toBe(true);
    expect(featureSchemaVersionSchema.safeParse("1.1").success).toBe(false);
    expect(featureSchemaVersionSchema.safeParse("").success).toBe(false);
    expect(featureSchemaVersionSchema.safeParse(1.0).success).toBe(false);
  });

  it("rejects a record missing the field, so the version can never be silently absent", () => {
    expect(featureSchemaVersionedSchema.safeParse({}).success).toBe(false);
    expect(
      featureSchemaVersionedSchema.safeParse({ featureSchemaVersion: "1.0" }).success,
    ).toBe(true);
  });
});

describe("dataset schema version vs feature schema version — independence", () => {
  it("are two distinct fields that can be validated independently of one another", () => {
    const combinedSchema = datasetSchemaVersionedSchema.merge(featureSchemaVersionedSchema);

    // Valid dataset version + invalid feature version: only the feature field fails.
    const badFeature = combinedSchema.safeParse({
      datasetSchemaVersion: "1.0",
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
      featureSchemaVersion: "1.0",
    });
    expect(badDataset.success).toBe(false);
    if (!badDataset.success) {
      const paths = badDataset.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("datasetSchemaVersion");
      expect(paths).not.toContain("featureSchemaVersion");
    }

    // Both valid: the combined record is accepted, each field independently identifiable.
    const both = combinedSchema.parse({
      datasetSchemaVersion: "1.0",
      featureSchemaVersion: "1.0",
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
