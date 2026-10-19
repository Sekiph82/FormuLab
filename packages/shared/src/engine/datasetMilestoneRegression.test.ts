import { describe, expect, it } from "vitest";
import {
  DATASET_SCHEMA_VERSION,
  extractFormulaVersionDatasetRows,
  extractFormulaVersionFeatureRows,
  extractFormulaVersionTargetRows,
  buildFormulaVersionBundleManifest,
  buildDatasetManifest,
  partitionDataset,
  datasetManifestSchema,
  formulaVersionBundleManifestSchema,
  datasetPartitionManifestSchema,
  type FormulaVersionBundleInput,
} from "../index";
import type { Formulation, FormulationLine, FormulationVersion } from "../schemas/formulation";
import type { RawMaterial } from "../schemas/materials";

function line(id: string, percent: string): FormulationLine {
  return {
    id,
    lineNumber: 1,
    phase: "A",
    displayName: "Surfactant",
    materialCode: "RM-001",
    percent,
    isQsToHundred: false,
    functions: ["anionic_surfactant"],
    provenance: { origin: "chemist_override", evidenceClaimIds: [] },
  };
}

function formulation(id: string): Formulation {
  return {
    schemaVersion: "1.0",
    id,
    code: `FORM-${id}`,
    name: `Formula ${id}`,
    productFamilyCode: "SHAMPOO",
    targetSkuCodes: [],
    targetMarkets: ["KE"],
    targetClaims: [],
    targetBatchKg: "100",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archived: false,
  };
}

function version(formulaId: string, formulaVersionId: string, percent: string): FormulationVersion {
  return {
    schemaVersion: "1.0",
    id: formulaVersionId,
    formulationId: formulaId,
    versionNumber: 1,
    status: "concept",
    author: "local",
    createdAt: "2026-01-02T00:00:00.000Z",
    lines: [line(`LINE-${formulaId}`, percent)],
    basisBatchKg: "100",
    sourceRunIds: [],
    regulatoryFindingIds: [],
    compatibilityFindingIds: [],
    safetyFindingIds: [],
    approvalRecordIds: [],
  };
}

function material(): RawMaterial {
  return {
    schemaVersion: "1.0",
    code: "RM-001",
    displayName: "Surfactant",
    casNumbers: [],
    ecNumbers: [],
    functions: ["anionic_surfactant"],
    documents: [],
    regulatoryStatuses: [],
    hazardClassifications: [],
    allergens: [],
    incompatibilities: [],
    substituteCodes: [],
    activeMatterState: "known",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function freezeDeep(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freezeDeep);
  }
}

async function buildPipeline(source: {
  formulationVersions: FormulationVersion[];
  formulations: Formulation[];
  materials: RawMaterial[];
}) {
  const formulaVersionIds = source.formulationVersions.map(({ id }) => id);
  const compositionRows = extractFormulaVersionDatasetRows({ ...source, formulationVersionIds: formulaVersionIds });
  const featureRows = extractFormulaVersionFeatureRows({ formulaVersionIds, compositionRows });
  const targetRows = extractFormulaVersionTargetRows({ formulaVersionIds, compositionRows });
  const bundles: FormulaVersionBundleInput[] = compositionRows.map((compositionRow) => ({
    compositionRow,
    featureRow: featureRows.find((row) => row.formulaVersionId === compositionRow.formulaVersionId)!,
    targetRow: targetRows.find((row) => row.formulaVersionId === compositionRow.formulaVersionId)!,
  }));
  const bundleManifests = await Promise.all(bundles.map(buildFormulaVersionBundleManifest));
  const datasetManifest = await buildDatasetManifest(bundleManifests);
  const partitionManifest = await partitionDataset(bundles, {
    ratios: { train: 1 / 3, validation: 1 / 3, test: 1 / 3 },
    seed: 105,
  });
  return { compositionRows, featureRows, targetRows, bundleManifests, datasetManifest, partitionManifest };
}

describe("FVL-05 end-to-end dataset regression", () => {
  it("rebuilds deterministically, preserves exact lineage and values, and never mutates source records", async () => {
    const source = {
      formulationVersions: [version("FORM-A", "VER-A", "0"), version("FORM-B", "VER-B", "12.50"), version("FORM-C", "VER-C", "4")],
      formulations: [formulation("FORM-A"), formulation("FORM-B"), formulation("FORM-C")],
      materials: [material()],
    };
    const sourceBefore = structuredClone(source);
    freezeDeep(source);

    const first = await buildPipeline(source);
    const repeat = await buildPipeline(source);
    expect(repeat).toEqual(first);
    expect(source).toEqual(sourceBefore);

    expect(first.compositionRows[0]!.datasetSchemaVersion).toBe(DATASET_SCHEMA_VERSION);
    expect(first.compositionRows[0]!.composition[0]!.percent).toBe("0");
    expect(first.compositionRows[0]!.composition[0]!.isQsToHundred).toBe(false);
    expect(first.featureRows[0]!.normalizedQuantities).toEqual([]);
    expect(first.targetRows[0]!.targetObservations).toEqual([]);
    expect(first.compositionRows[0]!.sourceRecords).toContainEqual({ sourceEntity: "formulationVersion", sourceRecordId: "VER-A" });

    expect(datasetManifestSchema.parse(first.datasetManifest)).toEqual(first.datasetManifest);
    first.bundleManifests.forEach((manifest) => expect(formulaVersionBundleManifestSchema.parse(manifest)).toEqual(manifest));
    expect(datasetPartitionManifestSchema.parse(first.partitionManifest)).toEqual(first.partitionManifest);
    expect(first.partitionManifest.entries.map(({ formulaVersionId }) => formulaVersionId).sort())
      .toEqual(["VER-A", "VER-B", "VER-C"]);
    for (const entry of first.partitionManifest.entries) {
      const group = first.partitionManifest.groups.find(({ groupId }) => groupId === entry.groupId)!;
      expect(group.formulaVersionIds).toContain(entry.formulaVersionId);
    }

    first.compositionRows[0]!.composition[0]!.percent = "999";
    first.compositionRows[0]!.materials[0]!.functions.push("water");
    first.partitionManifest.groups[0]!.sourceRecords[0]!.sourceRecordId = "mutated-output";
    expect(source).toEqual(sourceBefore);

    const reordered = await buildPipeline({
      ...sourceBefore,
      formulationVersions: [...sourceBefore.formulationVersions].reverse(),
      formulations: [...sourceBefore.formulations].reverse(),
    });
    const byVersionId = (a: (typeof repeat.bundleManifests)[number], b: (typeof repeat.bundleManifests)[number]) =>
      a.formulaVersionId < b.formulaVersionId ? -1 : a.formulaVersionId > b.formulaVersionId ? 1 : 0;
    expect([...reordered.bundleManifests].sort(byVersionId)).toEqual([...repeat.bundleManifests].sort(byVersionId));
    expect(reordered.datasetManifest).toEqual(repeat.datasetManifest);
    expect(reordered.partitionManifest).toEqual(repeat.partitionManifest);
  });
});
