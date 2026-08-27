import { describe, expect, it } from "vitest";
import {
  FormulaVersionTargetExtractionError,
  extractFormulaVersionTargetRows,
  type FormulaVersionTargetExtractionInput,
} from "./formulaVersionTargetExtractor";
import { extractFormulaVersionTargetRows as extractFromPublicEntryPoint } from "../index";
import {
  DATASET_SCHEMA_VERSION,
  FEATURE_SCHEMA_VERSION,
  formulaVersionCompositionRowSchema,
  formulaVersionDoeRowSchema,
  formulaVersionStabilityRowSchema,
  formulaVersionTargetRowSchema,
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
    composition: [],
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
    replicates: [],
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
    trials: [],
    ...over,
  });
}

function stabilityResult(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0",
    id: "STABRESULT-0001",
    studyId: "STUDY-0001",
    sampleId: "SAMPLE-0001",
    conditionId: "COND-0001",
    timePointId: "TP-0001",
    testDefinitionId: "TESTDEF-0001",
    resultType: "numeric",
    replicates: [],
    attachments: [],
    passFail: "not_evaluated",
    performedBy: "chemist",
    performedAt: "2026-01-04T00:00:00.000Z",
    createdAt: "2026-01-04T00:00:00.000Z",
    updatedAt: "2026-01-04T00:00:00.000Z",
    ...over,
  };
}

function stabilitySample(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0",
    id: "SAMPLE-0001",
    sampleCode: "SMP-0001",
    studyId: "STUDY-0001",
    conditionId: "COND-0001",
    timePointId: "TP-0001",
    packagingSkuCode: "SKU-0001",
    replicateNumber: 1,
    status: "completed",
    testDefinitionIds: [],
    createdAt: "2026-01-03T00:00:00.000Z",
    ...over,
  };
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

function doeResponse(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0",
    id: "RESPONSE-0001",
    studyId: "DOESTUDY-0001",
    studyRevision: 1,
    responseCode: "VISC",
    name: "Viscosity",
    responseType: "continuous",
    objective: "target",
    weight: "1",
    desirabilityShape: "linear",
    targetValue: "100",
    lowerLimit: "80",
    upperLimit: "120",
    createdAt: "2026-01-05T00:00:00.000Z",
    ...over,
  };
}

function doeDesign(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0",
    id: "DESIGN-0001",
    studyId: "DOESTUDY-0001",
    studyRevision: 1,
    designType: "full_factorial",
    factorSnapshot: [],
    constraintSnapshot: [],
    responseSnapshot: [doeResponse()],
    generationSettings: {},
    seed: 42,
    runCount: 1,
    replicateCount: 0,
    centerPointCount: 0,
    blockCount: 1,
    generatedBy: "local",
    generatedAt: "2026-01-05T00:00:00.000Z",
    diagnostics: {
      runCount: 1,
      degreesOfFreedom: 0,
      duplicateRunCount: 0,
      estimableTerms: [],
      aliasedTerms: [],
      isOrthogonal: true,
      isBalanced: true,
      centerPointCount: 0,
      replicateCount: 0,
      constraintViolationCount: 0,
      warnings: [],
    },
    ...over,
  };
}

function doeRun(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0",
    id: "RUN-0001",
    studyId: "DOESTUDY-0001",
    studyRevision: 1,
    designId: "DESIGN-0001",
    runNumber: 1,
    standardOrder: 1,
    randomizedOrder: 1,
    block: 1,
    replicate: 1,
    isCenterPoint: false,
    factorSettings: [],
    status: "completed",
    createdAt: "2026-01-05T00:00:00.000Z",
    ...over,
  };
}

function doeObservation(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0",
    id: "OBS-0001",
    studyId: "DOESTUDY-0001",
    studyRevision: 1,
    runId: "RUN-0001",
    responseId: "RESPONSE-0001",
    status: "recorded",
    recordedBy: "chemist",
    recordedAt: "2026-01-05T00:00:00.000Z",
    ...over,
  };
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

function baseInput(over: Partial<FormulaVersionTargetExtractionInput> = {}): FormulaVersionTargetExtractionInput {
  return {
    formulaVersionIds: ["VER-0001"],
    compositionRows: [compositionRow()],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Empty / row assembly
// ---------------------------------------------------------------------------

describe("extractFormulaVersionTargetRows — row assembly", () => {
  it("produces an empty targetObservations array (not an error) when no measured-response family is supplied", () => {
    const [row] = extractFormulaVersionTargetRows(baseInput());
    expect(row.targetObservations).toEqual([]);
    expect(row.productFamilyCode).toBe("HC-SHAMPOO-REG");
    expect(row.featureSchemaVersion).toBe(FEATURE_SCHEMA_VERSION);
  });

  it("FEATURE_SCHEMA_VERSION is '1.2' (bumped again by the corrective cycle's additive targetDefinition/targetObservation fields)", () => {
    expect(FEATURE_SCHEMA_VERSION).toBe("1.2");
  });

  it("DATASET_SCHEMA_VERSION is untouched by this task — stays '1.6'", () => {
    expect(DATASET_SCHEMA_VERSION).toBe("1.6");
  });

  it("copies productFamilyCode/formulaId/formulaCode/formulaVersionNumber from the composition row, never re-resolved", () => {
    const row = compositionRow({ productFamilyCode: "HC-BODYWASH" });
    const [feature] = extractFormulaVersionTargetRows(baseInput({ compositionRows: [row] }));
    expect(feature.productFamilyCode).toBe("HC-BODYWASH");
    expect(feature.formulaId).toBe("FORM-0001");
    expect(feature.formulaCode).toBe("HC-SHAMPOO-REG-001");
    expect(feature.formulaVersionNumber).toBe(1);
  });

  it("dedupes the shared formulation/formulationVersion lineage citation across every contributing row", () => {
    const [row] = extractFormulaVersionTargetRows(
      baseInput({ testResultRows: [testResultRow()], stabilityRows: [stabilityRow()], doeRows: [doeRow()] }),
    );
    expect(row.sourceRecords).toEqual(BASE_LINEAGE);
  });

  it("emits one row per requested id, in the requested order", () => {
    const rows = extractFormulaVersionTargetRows({
      formulaVersionIds: ["VER-0002", "VER-0001"],
      compositionRows: [compositionRow(), compositionRow({ formulaVersionId: "VER-0002", formulaVersionNumber: 2 })],
    });
    expect(rows.map((r) => r.formulaVersionId)).toEqual(["VER-0002", "VER-0001"]);
  });

  it("fails closed when a requested id has no composition row", () => {
    expect(() => extractFormulaVersionTargetRows({ formulaVersionIds: ["VER-GHOST"], compositionRows: [] })).toThrow(
      FormulaVersionTargetExtractionError,
    );
  });

  it("fails closed on more than one composition row for the same formulaVersionId", () => {
    try {
      extractFormulaVersionTargetRows(baseInput({ compositionRows: [compositionRow(), compositionRow()] }));
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionTargetExtractionError).code).toBe("duplicate_formula_version_composition_row");
    }
  });

  it("fails closed when an optional row's formulaId contradicts the composition row's formulaId", () => {
    try {
      extractFormulaVersionTargetRows(baseInput({ testResultRows: [testResultRow({ formulaId: "FORM-OTHER" })] }));
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionTargetExtractionError).code).toBe("test_result_row_formula_version_conflict");
    }
  });

  it("fails closed on more than one optional row for the same formulaVersionId", () => {
    try {
      extractFormulaVersionTargetRows(baseInput({ stabilityRows: [stabilityRow(), stabilityRow()] }));
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionTargetExtractionError).code).toBe("duplicate_formula_version_stability_row");
    }
  });

  it("is exported from the package's public entry point", () => {
    expect(extractFromPublicEntryPoint).toBe(extractFormulaVersionTargetRows);
  });

  it("round-trips through JSON and still validates against formulaVersionTargetRowSchema", () => {
    const row = testResultRow({
      trials: [
        { trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ unit: "g", replicates: [{ replicateNumber: 1, numericValue: "5" }] })] },
      ],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    const roundTripped = JSON.parse(JSON.stringify(target));
    expect(() => formulaVersionTargetRowSchema.parse(roundTripped)).not.toThrow();
    expect(roundTripped).toEqual(target);
  });

  it("does not mutate any supplied input row, and output shares no mutable aliasing with the source", () => {
    const row = testResultRow({
      trials: [
        { trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ unit: "g", replicates: [{ replicateNumber: 1, numericValue: "5" }] })] },
      ],
    });
    const frozenCopy = structuredClone(row);
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    expect(row).toEqual(frozenCopy);
    target.targetObservations.push({
      targetDefinition: { productFamilyCode: "INJECTED", sourceEntity: "testResult", testDefinitionId: "X" },
      value: { kind: "text", text: "injected" },
      isOutlier: false,
      sourceRecords: [{ sourceEntity: "testResult", sourceRecordId: "INJECTED" }],
    });
    expect(row).toEqual(frozenCopy);
  });
});

// ---------------------------------------------------------------------------
// TestResult targets
// ---------------------------------------------------------------------------

describe("extractFormulaVersionTargetRows — TestResult targets", () => {
  it("extracts one numeric observation per replicate, disambiguated by replicateNumber, plus stats observations", () => {
    const row = testResultRow({
      trials: [
        {
          trialId: "TRIAL-0001",
          trialCode: "TRL-0001",
          testResults: [
            testResult({
              testDefinitionId: "TD-VISC",
              unit: "g",
              replicates: [
                { replicateNumber: 1, numericValue: "10" },
                { replicateNumber: 2, numericValue: "20", isOutlier: true },
              ],
              stats: { count: 2, mean: "15", minimum: "10", maximum: "20" },
            }),
          ],
        },
      ],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    const details = target.targetObservations.map((o) => o.detail);
    expect(details).toEqual(["1", "2"]);
    for (const obs of target.targetObservations) {
      expect(obs.targetDefinition).toEqual({ productFamilyCode: "HC-SHAMPOO-REG", sourceEntity: "testResult", testDefinitionId: "TD-VISC" });
      expect(obs.sourceRecords).toEqual([{ sourceEntity: "testResult", sourceRecordId: "RESULT-0001" }]);
      expect(obs.value.kind).toBe("numeric");
    }
    expect(target.targetObservations[1].isOutlier).toBe(true);
    expect(target.targetObservations[0].isOutlier).toBe(false);
  });

  it("AUDIT_FVL05_GPT_000015 finding A: ReplicateStats never produces target observations, only the actual replicates do", () => {
    const row = testResultRow({
      trials: [
        {
          trialId: "TRIAL-0001",
          trialCode: "TRL-0001",
          testResults: [
            testResult({
              unit: "g",
              replicates: [
                { replicateNumber: 1, numericValue: "10" },
                { replicateNumber: 2, numericValue: "20" },
              ],
              stats: { count: 2, mean: "15", minimum: "10", maximum: "20", standardDeviation: "5" },
            }),
          ],
        },
      ],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    expect(target.targetObservations).toHaveLength(2);
    expect(JSON.stringify(target)).not.toContain("\"15\"");
  });

  it("stats-cache mutation/removal over identical replicates never changes the target-observation set", () => {
    const rowWithStats = testResultRow({
      trials: [
        {
          trialId: "TRIAL-0001",
          trialCode: "TRL-0001",
          testResults: [
            testResult({
              unit: "g",
              replicates: [{ replicateNumber: 1, numericValue: "10" }, { replicateNumber: 2, numericValue: "20" }],
              stats: { count: 2, mean: "15", minimum: "10", maximum: "20", standardDeviation: "5" },
            }),
          ],
        },
      ],
    });
    const rowWithDifferentStats = testResultRow({
      trials: [
        {
          trialId: "TRIAL-0001",
          trialCode: "TRL-0001",
          testResults: [
            testResult({
              unit: "g",
              replicates: [{ replicateNumber: 1, numericValue: "10" }, { replicateNumber: 2, numericValue: "20" }],
              stats: { count: 2, mean: "999", minimum: "1", maximum: "1000", standardDeviation: "1" },
            }),
          ],
        },
      ],
    });
    const rowWithNoStats = testResultRow({
      trials: [
        {
          trialId: "TRIAL-0001",
          trialCode: "TRL-0001",
          testResults: [testResult({ unit: "g", replicates: [{ replicateNumber: 1, numericValue: "10" }, { replicateNumber: 2, numericValue: "20" }] })],
        },
      ],
    });
    const [withStats] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [rowWithStats] }));
    const [withDifferentStats] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [rowWithDifferentStats] }));
    const [withNoStats] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [rowWithNoStats] }));
    expect(withStats.targetObservations).toEqual(withDifferentStats.targetObservations);
    expect(withStats.targetObservations).toEqual(withNoStats.targetObservations);
  });

  it("stability stats likewise never produce target observations, only the actual replicates do", () => {
    const row = stabilityRow({
      studies: [
        {
          studyId: "STUDY-0001",
          studyCode: "STB-0001",
          conditions: [],
          timePoints: [],
          samples: [
            {
              sample: stabilitySample(),
              results: [
                stabilityResult({
                  unit: "mL",
                  replicates: [{ replicateNumber: 1, numericValue: "5" }],
                  stats: { count: 1, mean: "5", minimum: "5", maximum: "5" },
                }),
              ],
            },
          ],
        },
      ],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ stabilityRows: [row] }));
    expect(target.targetObservations).toHaveLength(1);
    expect(target.targetObservations[0].detail).toBe("1");
  });

  it("treats explicit zero as a real, distinct numeric observation, never absent", () => {
    const row = testResultRow({
      trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ unit: "g", replicates: [{ replicateNumber: 1, numericValue: "0" }] })] }],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    expect(target.targetObservations).toHaveLength(1);
    expect(target.targetObservations[0].value).toMatchObject({ kind: "numeric", raw: "0", normalized: true, canonicalValue: "0.0000" });
  });

  it("extracts a text observation for resultType 'text'", () => {
    const row = testResultRow({
      trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ resultType: "text", textValue: "Clear liquid" })] }],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    expect(target.targetObservations).toEqual([
      {
        targetDefinition: { productFamilyCode: "HC-SHAMPOO-REG", sourceEntity: "testResult", testDefinitionId: "TESTDEF-0001" },
        value: { kind: "text", text: "Clear liquid" },
        detail: undefined,
        isOutlier: false,
        sourceRecords: [{ sourceEntity: "testResult", sourceRecordId: "RESULT-0001" }],
      },
    ]);
  });

  it("extracts a categorical observation for resultType 'categorical'", () => {
    const row = testResultRow({
      trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ resultType: "categorical", categoricalValue: "Grade A" })] }],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    expect(target.targetObservations[0].value).toEqual({ kind: "categorical", categorical: "Grade A" });
  });

  it("extracts an explicit boolean false as a real, distinct observation, never absent", () => {
    const row = testResultRow({
      trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ resultType: "boolean", booleanValue: false })] }],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    expect(target.targetObservations[0].value).toEqual({ kind: "boolean", boolean: false });
  });

  it("extracts pass/fail only when actually evaluated — never 'not_evaluated' as a label", () => {
    const evaluated = testResultRow({
      trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ resultType: "pass_fail", passFail: "fail" })] }],
    });
    const [evaluatedTarget] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [evaluated] }));
    expect(evaluatedTarget.targetObservations[0].value).toEqual({ kind: "passFail", passFail: "fail" });

    const notEvaluated = testResultRow({
      trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ resultType: "pass_fail", passFail: "not_evaluated" })] }],
    });
    const [notEvaluatedTarget] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [notEvaluated] }));
    expect(notEvaluatedTarget.targetObservations).toEqual([]);
  });

  it("treats visual_rating identically to numeric (the only field structurally capable of holding it)", () => {
    const row = testResultRow({
      trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ resultType: "visual_rating", unit: undefined, replicates: [{ replicateNumber: 1, numericValue: "4" }] })] }],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    expect(target.targetObservations[0].value).toMatchObject({ kind: "numeric", raw: "4" });
  });

  it("emits nothing for a numeric result with no replicates and no stats — missing stays missing, never a fabricated observation", () => {
    const row = testResultRow({
      trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult()] }],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    expect(target.targetObservations).toEqual([]);
  });

  it("extracts every entry in a revisesResultId revision chain as its own separate observation — never collapsed to latest", () => {
    const row = testResultRow({
      trials: [
        {
          trialId: "TRIAL-0001",
          trialCode: "TRL-0001",
          testResults: [
            testResult({ id: "RESULT-A", unit: "g", replicates: [{ replicateNumber: 1, numericValue: "10" }] }),
            testResult({ id: "RESULT-B", revisesResultId: "RESULT-A", unit: "g", replicates: [{ replicateNumber: 1, numericValue: "11" }] }),
          ],
        },
      ],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    expect(target.targetObservations.map((o) => o.sourceRecords[0].sourceRecordId)).toEqual(["RESULT-A", "RESULT-B"]);
  });

  it("never leaks a planned-spec-shaped field — TestDefinition is never pooled by this extractor at all", () => {
    // TestDefinition.targetValue/minimum/maximum simply cannot appear:
    // FormulaVersionTestResultRow never embeds TestDefinition, only TestResult.
    const row = testResultRow({
      trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ unit: "g", replicates: [{ replicateNumber: 1, numericValue: "10" }] })] }],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    expect(JSON.stringify(target)).not.toContain("targetValue");
  });

  // AUDIT_FVL05_GPT_000015 finding B: persisted TestResult.timePoint/
  // storageCondition are part of target IDENTITY (same reasoning as
  // stabilityResult's conditionId/timePointId); sampleId/instrument/
  // methodSnapshot are observation CONTEXT, not identity.

  it("keeps two TestResults with the same testDefinitionId but different timePoint as distinct target definitions", () => {
    const row = testResultRow({
      trials: [
        {
          trialId: "TRIAL-0001",
          trialCode: "TRL-0001",
          testResults: [
            testResult({ id: "R1", unit: "g", timePoint: "hour 0", replicates: [{ replicateNumber: 1, numericValue: "1" }] }),
            testResult({ id: "R2", unit: "g", timePoint: "hour 24", replicates: [{ replicateNumber: 1, numericValue: "2" }] }),
          ],
        },
      ],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    const defs = target.targetObservations.map((o) => JSON.stringify(o.targetDefinition));
    expect(new Set(defs).size).toBe(2);
    expect(target.targetObservations[0].targetDefinition).toMatchObject({ timePoint: "hour 0" });
    expect(target.targetObservations[1].targetDefinition).toMatchObject({ timePoint: "hour 24" });
  });

  it("keeps two TestResults with the same testDefinitionId but different storageCondition as distinct target definitions", () => {
    const row = testResultRow({
      trials: [
        {
          trialId: "TRIAL-0001",
          trialCode: "TRL-0001",
          testResults: [
            testResult({ id: "R1", unit: "g", storageCondition: "refrigerated", replicates: [{ replicateNumber: 1, numericValue: "1" }] }),
            testResult({ id: "R2", unit: "g", storageCondition: "ambient", replicates: [{ replicateNumber: 1, numericValue: "2" }] }),
          ],
        },
      ],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    const defs = target.targetObservations.map((o) => JSON.stringify(o.targetDefinition));
    expect(new Set(defs).size).toBe(2);
  });

  it("collapses two TestResults with the same testDefinitionId and no timePoint/storageCondition into the SAME target definition — the ordinary case", () => {
    const row = testResultRow({
      trials: [
        {
          trialId: "TRIAL-0001",
          trialCode: "TRL-0001",
          testResults: [
            testResult({ id: "R1", unit: "g", replicates: [{ replicateNumber: 1, numericValue: "1" }] }),
            testResult({ id: "R2", unit: "g", replicates: [{ replicateNumber: 1, numericValue: "2" }] }),
          ],
        },
      ],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    const defs = target.targetObservations.map((o) => JSON.stringify(o.targetDefinition));
    expect(new Set(defs).size).toBe(1);
  });

  it("handles Unicode/delimiter-rich timePoint/storageCondition context values collision-safely", () => {
    const weird = "T=0h/µ〜特殊[start]";
    const row = testResultRow({
      trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ unit: "g", timePoint: weird, replicates: [{ replicateNumber: 1, numericValue: "1" }] })] }],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    expect(target.targetObservations[0].targetDefinition).toMatchObject({ timePoint: weird });
  });

  it("attaches an observation context object only when sampleId/instrument/methodSnapshot are actually present, never an all-undefined placeholder", () => {
    const withContext = testResultRow({
      trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ unit: "g", sampleId: "SMP-1", instrument: "HPLC-3", replicates: [{ replicateNumber: 1, numericValue: "1" }] })] }],
    });
    const [withContextTarget] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [withContext] }));
    expect(withContextTarget.targetObservations[0].context).toEqual({ sampleId: "SMP-1", instrument: "HPLC-3" });

    const withoutContext = testResultRow({
      trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ unit: "g", replicates: [{ replicateNumber: 1, numericValue: "1" }] })] }],
    });
    const [withoutContextTarget] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [withoutContext] }));
    expect(withoutContextTarget.targetObservations[0].context).toBeUndefined();
  });

  it("treats an explicit empty-string sampleId as present and distinct from absence — never conflated with missing", () => {
    const row = testResultRow({
      trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ unit: "g", sampleId: "", replicates: [{ replicateNumber: 1, numericValue: "1" }] })] }],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    expect(target.targetObservations[0].context).toEqual({ sampleId: "" });
  });

  it("does not treat sampleId/instrument as part of target identity — same testDefinitionId, different sampleId, still one target definition", () => {
    const row = testResultRow({
      trials: [
        {
          trialId: "TRIAL-0001",
          trialCode: "TRL-0001",
          testResults: [
            testResult({ id: "R1", unit: "g", sampleId: "SMP-A", replicates: [{ replicateNumber: 1, numericValue: "1" }] }),
            testResult({ id: "R2", unit: "g", sampleId: "SMP-B", replicates: [{ replicateNumber: 1, numericValue: "2" }] }),
          ],
        },
      ],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    const defs = target.targetObservations.map((o) => JSON.stringify(o.targetDefinition));
    expect(new Set(defs).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// StabilityResult targets
// ---------------------------------------------------------------------------

describe("extractFormulaVersionTargetRows — StabilityResult targets", () => {
  it("includes conditionId/timePointId as part of target IDENTITY, not a predictor dimension", () => {
    const row = stabilityRow({
      studies: [
        {
          studyId: "STUDY-0001",
          studyCode: "STB-0001",
          conditions: [],
          timePoints: [],
          samples: [
            {
              sample: stabilitySample(),
              results: [stabilityResult({ unit: "mL", conditionId: "COND-40C", timePointId: "TP-3M", replicates: [{ replicateNumber: 1, numericValue: "5" }] })],
            },
          ],
        },
      ],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ stabilityRows: [row] }));
    expect(target.targetObservations[0].targetDefinition).toEqual({
      productFamilyCode: "HC-SHAMPOO-REG",
      sourceEntity: "stabilityResult",
      testDefinitionId: "TESTDEF-0001",
      conditionId: "COND-40C",
      timePointId: "TP-3M",
    });
  });

  it("keeps two different condition/time-point combinations distinguishable as different target definitions", () => {
    const row = stabilityRow({
      studies: [
        {
          studyId: "STUDY-0001",
          studyCode: "STB-0001",
          conditions: [],
          timePoints: [],
          samples: [
            {
              sample: stabilitySample(),
              results: [
                stabilityResult({ id: "SR-1", unit: "mL", conditionId: "COND-40C", timePointId: "TP-3M", replicates: [{ replicateNumber: 1, numericValue: "5" }] }),
                stabilityResult({ id: "SR-2", unit: "mL", conditionId: "COND-25C", timePointId: "TP-1M", replicates: [{ replicateNumber: 1, numericValue: "6" }] }),
              ],
            },
          ],
        },
      ],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ stabilityRows: [row] }));
    const defs = target.targetObservations.map((o) => JSON.stringify(o.targetDefinition));
    expect(new Set(defs).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// DOE observation targets
// ---------------------------------------------------------------------------

describe("extractFormulaVersionTargetRows — DOE observation targets", () => {
  it("extracts a recorded numeric observation, resolving unit from the frozen responseSnapshot", () => {
    const row = doeRow({
      studies: [
        {
          studyId: "DOESTUDY-0001",
          studyCode: "DOE-0001",
          studyRevision: 1,
          designs: [
            {
              design: doeDesign({ responseSnapshot: [doeResponse({ id: "RESPONSE-0001", unit: "mL" })] }),
              runs: [{ run: doeRun(), observations: [doeObservation({ value: "12.5" })] }],
            },
          ],
        },
      ],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ doeRows: [row] }));
    expect(target.targetObservations).toEqual([
      {
        targetDefinition: { productFamilyCode: "HC-SHAMPOO-REG", sourceEntity: "doeObservation", responseId: "RESPONSE-0001" },
        value: { kind: "numeric", raw: "12.5", rawUnit: "mL", canonicalUnit: "mL", canonicalValue: "12.5000", normalized: true },
        isOutlier: false,
        sourceRecords: [{ sourceEntity: "doeObservation", sourceRecordId: "OBS-0001" }],
      },
    ]);
  });

  it("never uses DoeResponse.targetValue/lowerLimit/upperLimit as a label — only the actual observation value", () => {
    const row = doeRow({
      studies: [
        {
          studyId: "DOESTUDY-0001",
          studyCode: "DOE-0001",
          studyRevision: 1,
          designs: [
            { design: doeDesign({ responseSnapshot: [doeResponse({ id: "RESPONSE-0001", unit: "mL", targetValue: "999", lowerLimit: "1", upperLimit: "2" })] }), runs: [{ run: doeRun(), observations: [doeObservation({ value: "12.5" })] }] },
          ],
        },
      ],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ doeRows: [row] }));
    expect(target.targetObservations[0].value).toMatchObject({ raw: "12.5" });
    expect(JSON.stringify(target)).not.toContain("999");
  });

  for (const status of ["missing", "invalid", "excluded"]) {
    it(`excludes a DoeObservation with status "${status}" — never silently becomes a label`, () => {
      const row = doeRow({
        studies: [
          {
            studyId: "DOESTUDY-0001",
            studyCode: "DOE-0001",
            studyRevision: 1,
            designs: [{ design: doeDesign(), runs: [{ run: doeRun(), observations: [doeObservation({ status, value: "5" })] }] }],
          },
        ],
      });
      const [target] = extractFormulaVersionTargetRows(baseInput({ doeRows: [row] }));
      expect(target.targetObservations).toEqual([]);
    });
  }

  for (const status of ["outlier_flagged", "outlier_confirmed"]) {
    it(`keeps an outlier-status observation ("${status}"), flagged, not deleted`, () => {
      const row = doeRow({
        studies: [
          {
            studyId: "DOESTUDY-0001",
            studyCode: "DOE-0001",
            studyRevision: 1,
            designs: [{ design: doeDesign(), runs: [{ run: doeRun(), observations: [doeObservation({ status, value: "5" })] }] }],
          },
        ],
      });
      const [target] = extractFormulaVersionTargetRows(baseInput({ doeRows: [row] }));
      expect(target.targetObservations).toHaveLength(1);
      expect(target.targetObservations[0].isOutlier).toBe(true);
    });
  }

  it("fails closed when a design's own studyId/studyRevision contradicts the study it is nested under", () => {
    const row = doeRow({
      studies: [{ studyId: "DOESTUDY-0001", studyCode: "DOE-0001", studyRevision: 1, designs: [{ design: doeDesign({ studyId: "DOESTUDY-OTHER" }), runs: [] }] }],
    });
    try {
      extractFormulaVersionTargetRows(baseInput({ doeRows: [row] }));
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionTargetExtractionError).code).toBe("doe_design_study_conflict");
    }
  });

  it("fails closed on a response snapshot child whose studyId contradicts the owning design", () => {
    const row = doeRow({
      studies: [
        { studyId: "DOESTUDY-0001", studyCode: "DOE-0001", studyRevision: 1, designs: [{ design: doeDesign({ responseSnapshot: [doeResponse({ studyId: "DOESTUDY-OTHER" })] }), runs: [] }] },
      ],
    });
    try {
      extractFormulaVersionTargetRows(baseInput({ doeRows: [row] }));
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionTargetExtractionError).code).toBe("doe_design_response_snapshot_conflict");
    }
  });

  it("fails closed on a duplicate response id within one design's own responseSnapshot", () => {
    const row = doeRow({
      studies: [
        {
          studyId: "DOESTUDY-0001",
          studyCode: "DOE-0001",
          studyRevision: 1,
          designs: [{ design: doeDesign({ responseSnapshot: [doeResponse({ id: "R1" }), doeResponse({ id: "R1" })] }), runs: [] }],
        },
      ],
    });
    try {
      extractFormulaVersionTargetRows(baseInput({ doeRows: [row] }));
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionTargetExtractionError).code).toBe("duplicate_doe_design_response_id");
    }
  });

  it("fails closed when an observation's responseId does not resolve in its design's own responseSnapshot", () => {
    const row = doeRow({
      studies: [
        {
          studyId: "DOESTUDY-0001",
          studyCode: "DOE-0001",
          studyRevision: 1,
          designs: [{ design: doeDesign(), runs: [{ run: doeRun(), observations: [doeObservation({ responseId: "GHOST", value: "1" })] }] }],
        },
      ],
    });
    try {
      extractFormulaVersionTargetRows(baseInput({ doeRows: [row] }));
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionTargetExtractionError).code).toBe("doe_observation_response_not_found");
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-family / identity / determinism
// ---------------------------------------------------------------------------

describe("extractFormulaVersionTargetRows — identity and determinism", () => {
  it("keeps the same opaque testDefinitionId in two unrelated product families from colliding", () => {
    const rowA = compositionRow({ formulaVersionId: "VER-A", formulaId: "FORM-A", formulaCode: "A", productFamilyCode: "FAMILY-A" });
    const rowB = compositionRow({ formulaVersionId: "VER-B", formulaId: "FORM-B", formulaCode: "B", productFamilyCode: "FAMILY-B" });
    const testRowA = testResultRow({
      formulaVersionId: "VER-A",
      formulaId: "FORM-A",
      formulaCode: "A",
      trials: [{ trialId: "T1", trialCode: "T1", testResults: [testResult({ id: "RA", testDefinitionId: "SHARED-TD", unit: "g", replicates: [{ replicateNumber: 1, numericValue: "1" }] })] }],
    });
    const testRowB = testResultRow({
      formulaVersionId: "VER-B",
      formulaId: "FORM-B",
      formulaCode: "B",
      trials: [{ trialId: "T2", trialCode: "T2", testResults: [testResult({ id: "RB", testDefinitionId: "SHARED-TD", unit: "g", replicates: [{ replicateNumber: 1, numericValue: "2" }] })] }],
    });
    const rows = extractFormulaVersionTargetRows({
      formulaVersionIds: ["VER-A", "VER-B"],
      compositionRows: [rowA, rowB],
      testResultRows: [testRowA, testRowB],
    });
    expect(rows[0].targetObservations[0].targetDefinition.productFamilyCode).toBe("FAMILY-A");
    expect(rows[1].targetObservations[0].targetDefinition.productFamilyCode).toBe("FAMILY-B");
  });

  it("handles a Unicode/delimiter-rich testDefinitionId without crashing or corrupting identity", () => {
    const weird = "TD-µg/L³·〜特殊[test]";
    const row = testResultRow({
      trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ testDefinitionId: weird, unit: "g", replicates: [{ replicateNumber: 1, numericValue: "1" }] })] }],
    });
    const [target] = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    expect(target.targetObservations[0].targetDefinition.testDefinitionId).toBe(weird);
  });

  it("is deterministic under repeated extraction of the same input", () => {
    const row = testResultRow({
      trials: [{ trialId: "TRIAL-0001", trialCode: "TRL-0001", testResults: [testResult({ unit: "g", replicates: [{ replicateNumber: 1, numericValue: "1" }] })] }],
    });
    const first = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    const second = extractFormulaVersionTargetRows(baseInput({ testResultRows: [row] }));
    expect(first).toEqual(second);
  });
});

// ---------------------------------------------------------------------------
// targetDefinitionSchema identity-tuple enforcement (direct schema tests)
// ---------------------------------------------------------------------------

describe("targetDefinitionSchema", () => {
  it("rejects a testResult definition missing testDefinitionId", () => {
    expect(formulaVersionTargetRowSchema.shape.targetObservations.element.shape.targetDefinition.safeParse({ productFamilyCode: "X", sourceEntity: "testResult" }).success).toBe(false);
  });

  it("rejects a doeObservation definition that also carries testDefinitionId", () => {
    expect(
      formulaVersionTargetRowSchema.shape.targetObservations.element.shape.targetDefinition.safeParse({
        productFamilyCode: "X",
        sourceEntity: "doeObservation",
        responseId: "R1",
        testDefinitionId: "TD1",
      }).success,
    ).toBe(false);
  });

  it("rejects a stabilityResult definition missing conditionId/timePointId", () => {
    expect(
      formulaVersionTargetRowSchema.shape.targetObservations.element.shape.targetDefinition.safeParse({
        productFamilyCode: "X",
        sourceEntity: "stabilityResult",
        testDefinitionId: "TD1",
      }).success,
    ).toBe(false);
  });
});
