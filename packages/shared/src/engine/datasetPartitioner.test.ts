import { describe, expect, it } from "vitest";
import { partitionDataset, DatasetPartitionError, type DatasetPartitionConfig } from "./datasetPartitioner";
import { partitionDataset as partitionDatasetFromPublicEntryPoint } from "../index";
import {
  DATASET_SCHEMA_VERSION,
  FEATURE_SCHEMA_VERSION,
  formulaVersionCompositionRowSchema,
  formulaVersionTargetRowSchema,
  formulaVersionTestResultRowSchema,
  type SourceRecordReference,
} from "../index";
import type { FormulaVersionBundleInput } from "./datasetManifestBuilder";
import { datasetPartitionManifestSchema, PARTITION_SCHEMA_VERSION } from "../schemas/datasetPartition";

const DEFAULT_CONFIG: DatasetPartitionConfig = {
  ratios: { train: 0.7, validation: 0.15, test: 0.15 },
  seed: 17,
};

function bundle(
  formulaId: string,
  formulaVersionId: string,
  formulaVersionNumber: number,
  options: { trialId?: string; target?: string; additionalLineage?: SourceRecordReference[] } = {},
): FormulaVersionBundleInput {
  const sourceRecords = [
    { sourceEntity: "formulation", sourceRecordId: formulaId },
    { sourceEntity: "formulationVersion", sourceRecordId: formulaVersionId },
  ];
  const compositionRow = formulaVersionCompositionRowSchema.parse({
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    sourceRecords: [...sourceRecords, ...(options.additionalLineage ?? [])],
    formulaId,
    formulaCode: `FORM-${formulaId}`,
    formulaVersionId,
    formulaVersionNumber,
    composition: [],
    materials: [],
    productFamilyCode: "SHAMPOO",
  });

  const testResultRow = options.trialId === undefined ? undefined : formulaVersionTestResultRowSchema.parse({
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    sourceRecords: [...sourceRecords, { sourceEntity: "laboratoryTrial", sourceRecordId: options.trialId }],
    formulaId,
    formulaCode: `FORM-${formulaId}`,
    formulaVersionId,
    formulaVersionNumber,
    trials: [{ trialId: options.trialId, trialCode: `TRIAL-${options.trialId}`, testResults: [] }],
  });

  const targetRow = options.target === undefined ? undefined : formulaVersionTargetRowSchema.parse({
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    sourceRecords: [...sourceRecords, { sourceEntity: "testResult", sourceRecordId: `RESULT-${formulaVersionId}` }],
    formulaId,
    formulaCode: `FORM-${formulaId}`,
    formulaVersionId,
    formulaVersionNumber,
    productFamilyCode: "SHAMPOO",
    targetObservations: [{
      targetDefinition: { productFamilyCode: "SHAMPOO", sourceEntity: "testResult", testDefinitionId: "VISCOSITY" },
      value: { kind: "numeric", raw: options.target, normalized: false },
      sourceRecords: [{ sourceEntity: "testResult", sourceRecordId: `RESULT-${formulaVersionId}` }],
    }],
  });

  return { compositionRow, testResultRow, targetRow };
}

function assignmentMap(manifest: Awaited<ReturnType<typeof partitionDataset>>): Map<string, string> {
  return new Map(manifest.entries.map((entry) => [entry.formulaVersionId, entry.partition]));
}

describe("partitionDataset", () => {
  it("is available from the public shared entry point", () => {
    expect(partitionDatasetFromPublicEntryPoint).toBe(partitionDataset);
  });

  it("repeats deterministically and ignores caller bundle order", async () => {
    const bundles = [
      bundle("F01", "V01", 1), bundle("F02", "V02", 1), bundle("F03", "V03", 1),
      bundle("F04", "V04", 1), bundle("F05", "V05", 1), bundle("F06", "V06", 1),
      bundle("F07", "V07", 1), bundle("F08", "V08", 1), bundle("F09", "V09", 1),
    ];
    const first = await partitionDataset(bundles, DEFAULT_CONFIG);
    const repeat = await partitionDataset(bundles, DEFAULT_CONFIG);
    const reversed = await partitionDataset([...bundles].reverse(), DEFAULT_CONFIG);
    expect(repeat).toEqual(first);
    expect(reversed).toEqual(first);
    expect(datasetPartitionManifestSchema.parse(first)).toEqual(first);
    expect(first.partitionSchemaVersion).toBe(PARTITION_SCHEMA_VERSION);
  });

  it("keeps every version and revision of a formula in one partition", async () => {
    const result = await partitionDataset([
      bundle("F-A", "A-v1", 1), bundle("F-A", "A-v2", 2), bundle("F-A", "A-v3", 3),
      bundle("F-B", "B-v1", 1), bundle("F-C", "C-v1", 1), bundle("F-D", "D-v1", 1),
    ], DEFAULT_CONFIG);
    const assignments = assignmentMap(result);
    expect(new Set([assignments.get("A-v1"), assignments.get("A-v2"), assignments.get("A-v3")]).size).toBe(1);
    expect(result.groups.find((group) => group.formulaIds.includes("F-A"))?.formulaVersionIds).toEqual(["A-v1", "A-v2", "A-v3"]);
  });

  it("unites bundles that cite the same exact experiment lineage", async () => {
    const result = await partitionDataset([
      bundle("F-A", "A-v1", 1, { trialId: "TRIAL-SHARED" }),
      bundle("F-B", "B-v1", 1, { trialId: "TRIAL-SHARED" }),
      bundle("F-C", "C-v1", 1),
      bundle("F-D", "D-v1", 1),
    ], DEFAULT_CONFIG);
    const assignments = assignmentMap(result);
    expect(assignments.get("A-v1")).toBe(assignments.get("B-v1"));
    expect(result.groups.find((group) => group.formulaVersionIds.includes("A-v1"))?.sourceRecords).toContainEqual({
      sourceEntity: "laboratoryTrial",
      sourceRecordId: "TRIAL-SHARED",
    });
  });

  it("keeps stability study, sample, and result lineage together", async () => {
    const result = await partitionDataset([
      bundle("F-A", "A-v1", 1, { additionalLineage: [
        { sourceEntity: "stabilityStudy", sourceRecordId: "STUDY-SHARED" },
        { sourceEntity: "stabilitySample", sourceRecordId: "SAMPLE-A" },
        { sourceEntity: "stabilityResult", sourceRecordId: "STABILITY-RESULT-A" },
      ] }),
      bundle("F-B", "B-v1", 1, { additionalLineage: [
        { sourceEntity: "stabilityStudy", sourceRecordId: "STUDY-SHARED" },
        { sourceEntity: "stabilitySample", sourceRecordId: "SAMPLE-B" },
        { sourceEntity: "stabilityResult", sourceRecordId: "STABILITY-RESULT-B" },
      ] }),
      bundle("F-C", "C-v1", 1), bundle("F-D", "D-v1", 1),
    ], DEFAULT_CONFIG);
    const assignments = assignmentMap(result);
    expect(assignments.get("A-v1")).toBe(assignments.get("B-v1"));
    const group = result.groups.find(({ formulaVersionIds }) => formulaVersionIds.includes("A-v1"))!;
    expect(group.sourceRecords).toContainEqual({ sourceEntity: "stabilityStudy", sourceRecordId: "STUDY-SHARED" });
    expect(group.sourceRecords).toContainEqual({ sourceEntity: "stabilitySample", sourceRecordId: "SAMPLE-A" });
    expect(group.sourceRecords).toContainEqual({ sourceEntity: "stabilityResult", sourceRecordId: "STABILITY-RESULT-B" });
  });

  it("keeps related DOE study/design/run/observation and corrective-action records together", async () => {
    const result = await partitionDataset([
      bundle("F-A", "A-v1", 1, { additionalLineage: [
        { sourceEntity: "doeStudy", sourceRecordId: "DOE-SHARED" },
        { sourceEntity: "doeDesign", sourceRecordId: "DESIGN-A" },
        { sourceEntity: "doeRun", sourceRecordId: "RUN-A" },
        { sourceEntity: "doeObservation", sourceRecordId: "OBS-A" },
        { sourceEntity: "correctiveAction", sourceRecordId: "ACTION-SHARED" },
      ] }),
      bundle("F-B", "B-v1", 1, { additionalLineage: [
        { sourceEntity: "doeStudy", sourceRecordId: "DOE-SHARED" },
        { sourceEntity: "doeDesign", sourceRecordId: "DESIGN-B" },
        { sourceEntity: "doeRun", sourceRecordId: "RUN-B" },
        { sourceEntity: "doeObservation", sourceRecordId: "OBS-B" },
        { sourceEntity: "correctiveAction", sourceRecordId: "ACTION-SHARED" },
      ] }),
      bundle("F-C", "C-v1", 1), bundle("F-D", "D-v1", 1),
    ], DEFAULT_CONFIG);
    const assignments = assignmentMap(result);
    expect(assignments.get("A-v1")).toBe(assignments.get("B-v1"));
    const group = result.groups.find(({ formulaVersionIds }) => formulaVersionIds.includes("A-v1"))!;
    expect(group.sourceRecords).toContainEqual({ sourceEntity: "doeStudy", sourceRecordId: "DOE-SHARED" });
    expect(group.sourceRecords).toContainEqual({ sourceEntity: "doeDesign", sourceRecordId: "DESIGN-B" });
    expect(group.sourceRecords).toContainEqual({ sourceEntity: "doeRun", sourceRecordId: "RUN-A" });
    expect(group.sourceRecords).toContainEqual({ sourceEntity: "doeObservation", sourceRecordId: "OBS-B" });
    expect(group.sourceRecords).toContainEqual({ sourceEntity: "correctiveAction", sourceRecordId: "ACTION-SHARED" });
  });

  it("does not use measured target values to determine groups or assignments", async () => {
    const others = [bundle("F-B", "B-v1", 1), bundle("F-C", "C-v1", 1), bundle("F-D", "D-v1", 1), bundle("F-E", "E-v1", 1)];
    const low = await partitionDataset([bundle("F-A", "A-v1", 1, { target: "0" }), ...others], DEFAULT_CONFIG);
    const high = await partitionDataset([bundle("F-A", "A-v1", 1, { target: "98765" }), ...others], DEFAULT_CONFIG);
    expect(assignmentMap(low)).toEqual(assignmentMap(high));
    expect(low.entries.find((entry) => entry.formulaVersionId === "A-v1")?.bundle.digest)
      .not.toBe(high.entries.find((entry) => entry.formulaVersionId === "A-v1")?.bundle.digest);
  });

  it("leaves deeply frozen source bundles unchanged and does not return aliased lineage", async () => {
    const source = bundle("F-A", "A-v1", 1, { trialId: "TRIAL-A", target: "0" });
    const before = structuredClone(source);
    const freezeDeep = (value: unknown): void => {
      if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(freezeDeep);
      }
    };
    freezeDeep(source);
    const result = await partitionDataset([source, bundle("F-B", "B-v1", 1), bundle("F-C", "C-v1", 1)], DEFAULT_CONFIG);
    expect(source).toEqual(before);
    const group = result.groups.find((entry) => entry.formulaVersionIds.includes("A-v1"))!;
    group.sourceRecords[0]!.sourceRecordId = "changed-after-build";
    expect(source).toEqual(before);
  });

  it("balances independent groups close to requested ratios without splitting groups", async () => {
    const bundles = Array.from({ length: 20 }, (_, index) => bundle(`F-${String(index).padStart(2, "0")}`, `V-${index}`, 1));
    const result = await partitionDataset(bundles, DEFAULT_CONFIG);
    const counts = { train: 0, validation: 0, test: 0 };
    result.entries.forEach((entry) => { counts[entry.partition] += 1; });
    expect(counts.train).toBeGreaterThanOrEqual(13);
    expect(counts.train).toBeLessThanOrEqual(15);
    expect(counts.validation).toBeGreaterThanOrEqual(2);
    expect(counts.validation).toBeLessThanOrEqual(4);
    expect(counts.test).toBeGreaterThanOrEqual(2);
    expect(counts.test).toBeLessThanOrEqual(4);
  });

  it("allows the seed to change assignments when group ties permit", async () => {
    const bundles = Array.from({ length: 12 }, (_, index) => bundle(`F-${index}`, `V-${index}`, 1));
    const first = await partitionDataset(bundles, DEFAULT_CONFIG);
    const second = await partitionDataset(bundles, { ...DEFAULT_CONFIG, seed: 18 });
    expect(assignmentMap(second)).not.toEqual(assignmentMap(first));
  });

  it("fails closed when positive-ratio splits cannot each receive an independent group", async () => {
    await expect(partitionDataset([bundle("F-A", "A-v1", 1), bundle("F-A", "A-v2", 2)], DEFAULT_CONFIG))
      .rejects.toMatchObject({ name: "DatasetPartitionError", code: "insufficient_groups" });
  });

  it("fails closed on an unknown lineage entity or malformed parent scope", async () => {
    const unknown = bundle("F-A", "A-v1", 1);
    unknown.compositionRow.sourceRecords.push({ sourceEntity: "unclassifiedRecord", sourceRecordId: "X" });
    await expect(partitionDataset([unknown, bundle("F-B", "B-v1", 1), bundle("F-C", "C-v1", 1)], DEFAULT_CONFIG))
      .rejects.toMatchObject({ name: "DatasetPartitionError", code: "ambiguous_lineage" });

    const malformed = bundle("F-D", "D-v1", 1);
    malformed.compositionRow.sourceRecords.push({ sourceEntity: "testResult", sourceRecordId: "RESULT", parentRecordId: "TRIAL" });
    await expect(partitionDataset([malformed, bundle("F-E", "E-v1", 1), bundle("F-F", "F-v1", 1)], DEFAULT_CONFIG))
      .rejects.toMatchObject({ name: "DatasetPartitionError", code: "ambiguous_lineage" });
  });

  it("rejects duplicate formula-version identities and invalid ratios", async () => {
    await expect(partitionDataset([bundle("F-A", "A-v1", 1), bundle("F-B", "A-v1", 1)], DEFAULT_CONFIG))
      .rejects.toMatchObject({ name: "DatasetPartitionError", code: "invalid_bundle" });
    await expect(partitionDataset([bundle("F-A", "A-v1", 1)], { ratios: { train: 0.5, validation: 0.5, test: 0.5 }, seed: 1 }))
      .rejects.toMatchObject({ name: "DatasetPartitionError", code: "invalid_config" });
  });
});
