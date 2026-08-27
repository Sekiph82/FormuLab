import { describe, expect, it } from "vitest";
import {
  FormulaVersionFeatureExtractionError,
  extractFormulaVersionFeatureRows,
  normalizeQuantity,
  type FormulaVersionFeatureExtractionInput,
} from "./formulaVersionFeatureExtractor";
import { extractFormulaVersionFeatureRows as extractFromPublicEntryPoint } from "../index";
import {
  DATASET_SCHEMA_VERSION,
  FEATURE_SCHEMA_VERSION,
  formulaVersionCompositionRowSchema,
  formulaVersionCorrectiveCostContextRowSchema,
  formulaVersionDoeRowSchema,
  formulaVersionFeatureRowSchema,
  formulaVersionProcessRowSchema,
  formulaVersionStabilityRowSchema,
  formulaVersionTestResultRowSchema,
  type FormulaVersionCompositionRow,
  type FormulaVersionCorrectiveCostContextRow,
  type FormulaVersionDoeRow,
  type FormulaVersionProcessRow,
  type FormulaVersionStabilityRow,
  type FormulaVersionTestResultRow,
} from "../schemas/dataset";
import { formulationLineSchema, provenanceSchema, type FormulationLine } from "../schemas/formulation";

// ---------------------------------------------------------------------------
// Fixture builders — each goes through its own real schema `.parse()`, so a
// malformed fixture fails the test suite loudly instead of silently
// validating something the real extractor would reject.
// ---------------------------------------------------------------------------

const BASE_LINEAGE = [
  { sourceEntity: "formulation", sourceRecordId: "FORM-0001" },
  { sourceEntity: "formulationVersion", sourceRecordId: "VER-0001" },
];

function line(over: Partial<FormulationLine> = {}): FormulationLine {
  return formulationLineSchema.parse({
    id: "LINE-0001",
    lineNumber: 0,
    displayName: "Water",
    percent: "70.0000",
    provenance: provenanceSchema.parse({ origin: "chemist_override" }),
    ...over,
  });
}

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

function processRow(over: Record<string, unknown> = {}): FormulaVersionProcessRow {
  return formulaVersionProcessRowSchema.parse({
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    sourceRecords: BASE_LINEAGE,
    formulaId: "FORM-0001",
    formulaCode: "HC-SHAMPOO-REG-001",
    formulaVersionId: "VER-0001",
    formulaVersionNumber: 1,
    plannedProcedure: [],
    trials: [],
    ...over,
  });
}

function actualStepObservation(over: Record<string, unknown> = {}) {
  return {
    processStepId: "STEP-0001",
    stepNumber: 1,
    status: "completed",
    unplanned: false,
    attachments: [],
    ...over,
  };
}

function processTrial(over: Record<string, unknown> = {}) {
  return {
    trialId: "TRIAL-0001",
    trialCode: "TRL-0001",
    plannedSteps: [],
    actualStepObservations: [],
    observations: [],
    ...over,
  };
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

function doeFactor(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0",
    id: "FACTOR-0001",
    studyId: "DOESTUDY-0001",
    studyRevision: 1,
    factorCode: "TEMP",
    name: "Mixing temperature",
    factorType: "continuous",
    sourceType: "temperature",
    categoricalLevels: [],
    transformation: "none",
    precision: 2,
    isMixtureComponent: false,
    isProcessFactor: true,
    isControlled: true,
    createdAt: "2026-01-05T00:00:00.000Z",
    ...over,
  };
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
    factorSnapshot: [doeFactor()],
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

function costSnapshot(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0",
    code: "COST-0001",
    formulationId: "FORM-0001",
    versionId: "VER-0001",
    currency: "KES",
    batchKg: "100",
    calculatedAt: "2026-01-06T00:00:00.000Z",
    calculatedBy: "local",
    priceRecordCodes: [],
    exchangeRateCodes: [],
    packagingComponentCodes: [],
    lines: [],
    skuCosts: [],
    missingDataWarnings: [],
    ...over,
  };
}

function correctiveCostContextRow(over: Record<string, unknown> = {}): FormulaVersionCorrectiveCostContextRow {
  return formulaVersionCorrectiveCostContextRowSchema.parse({
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    sourceRecords: BASE_LINEAGE,
    formulaId: "FORM-0001",
    formulaCode: "HC-SHAMPOO-REG-001",
    formulaVersionId: "VER-0001",
    formulaVersionNumber: 1,
    correctiveActions: [],
    costSnapshots: [],
    packagingContext: [],
    ...over,
  });
}

function baseInput(over: Partial<FormulaVersionFeatureExtractionInput> = {}): FormulaVersionFeatureExtractionInput {
  return {
    formulaVersionIds: ["VER-0001"],
    compositionRows: [compositionRow()],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// normalizeQuantity — the pure conversion core
// ---------------------------------------------------------------------------

describe("normalizeQuantity", () => {
  it("returns undefined when the value itself is missing — missing stays missing", () => {
    expect(normalizeQuantity(undefined, "kg")).toBeUndefined();
    expect(normalizeQuantity(undefined, undefined)).toBeUndefined();
  });

  it("preserves an exact zero as a valid normalized value, never as absent", () => {
    const result = normalizeQuantity("0", "g");
    expect(result).toEqual({ raw: "0", rawUnit: "g", canonicalUnit: "g", canonicalValue: "0.0000", normalized: true });
  });

  it("passes a value through unconverted when no unit was ever recorded", () => {
    expect(normalizeQuantity("12.5", undefined)).toEqual({ raw: "12.5", normalized: false });
  });

  it("passes a value through unconverted, but keeps the raw unit, when the unit is unrecognized", () => {
    expect(normalizeQuantity("4.2", "cP")).toEqual({ raw: "4.2", rawUnit: "cP", normalized: false });
  });

  it("never crashes on a Unicode/delimiter-rich opaque unit string — unrecognized, raw preserved", () => {
    const weird = "µg/L³·〜特殊";
    expect(normalizeQuantity("1", weird)).toEqual({ raw: "1", rawUnit: weird, normalized: false });
  });

  it("converts a known mass unit to canonical grams", () => {
    expect(normalizeQuantity("1", "kg")).toEqual({ raw: "1", rawUnit: "kg", canonicalUnit: "g", canonicalValue: "1000.0000", normalized: true });
    expect(normalizeQuantity("500", "mg")).toEqual({ raw: "500", rawUnit: "mg", canonicalUnit: "g", canonicalValue: "0.5000", normalized: true });
  });

  it("converts a known volume unit to canonical millilitres", () => {
    expect(normalizeQuantity("2", "L")).toEqual({ raw: "2", rawUnit: "L", canonicalUnit: "mL", canonicalValue: "2000.0000", normalized: true });
  });

  it("is case-insensitive on the unit token, matching the reused convertUnit authority", () => {
    expect(normalizeQuantity("1", "KG")?.canonicalValue).toBe("1000.0000");
    expect(normalizeQuantity("1", "Kg")?.canonicalValue).toBe("1000.0000");
  });

  it("produces the same canonical value for unit-equivalent inputs (1000 mg === 1 g)", () => {
    const fromMg = normalizeQuantity("1000", "mg");
    const fromG = normalizeQuantity("1", "g");
    expect(fromMg?.canonicalValue).toBe(fromG?.canonicalValue);
    expect(fromMg?.canonicalUnit).toBe(fromG?.canonicalUnit);
  });

  it("never guesses across dimensions — 'pieces' (a count) stays unconverted, never treated as mass/volume", () => {
    expect(normalizeQuantity("12", "pieces")).toEqual({ raw: "12", rawUnit: "pieces", normalized: false });
  });

  it("is deterministic under repeated calls with the same input", () => {
    expect(normalizeQuantity("3.14159", "kg")).toEqual(normalizeQuantity("3.14159", "kg"));
  });
});

// ---------------------------------------------------------------------------
// Per-family extraction
// ---------------------------------------------------------------------------

describe("extractFormulaVersionFeatureRows — composition", () => {
  it("normalizes a composition line's quantity+quantityUnit with an exact per-line citation", () => {
    const row = compositionRow({ composition: [line({ id: "LINE-A", quantity: "2.5000", quantityUnit: "kg" })] });
    const [feature] = extractFormulaVersionFeatureRows(baseInput({ compositionRows: [row] }));
    expect(feature.normalizedQuantities).toEqual([
      {
        path: "composition.line.quantity",
        raw: "2.5000",
        rawUnit: "kg",
        canonicalUnit: "g",
        canonicalValue: "2500.0000",
        normalized: true,
        sourceRecords: [{ sourceEntity: "formulationLine", sourceRecordId: "LINE-A" }],
      },
    ]);
  });

  it("emits no entry for a line with no quantity recorded at all — never a fabricated zero", () => {
    const row = compositionRow({ composition: [line({ id: "LINE-B" })] });
    const [feature] = extractFormulaVersionFeatureRows(baseInput({ compositionRows: [row] }));
    expect(feature.normalizedQuantities).toEqual([]);
  });

  it("never normalizes unitPrice/priceUnit — a rate, deliberately excluded", () => {
    const row = compositionRow({
      composition: [line({ id: "LINE-C", quantity: "1", quantityUnit: "kg", unitPrice: "500", priceUnit: "kg" })],
    });
    const [feature] = extractFormulaVersionFeatureRows(baseInput({ compositionRows: [row] }));
    expect(feature.normalizedQuantities).toHaveLength(1);
    expect(feature.normalizedQuantities[0].path).toBe("composition.line.quantity");
  });
});

describe("extractFormulaVersionFeatureRows — process", () => {
  it("carries an unrecognized viscosity unit through raw, citing the exact step + owning trial", () => {
    const row = processRow({
      trials: [
        processTrial({ actualStepObservations: [actualStepObservation({ actualViscosity: "1500", viscosityUnit: "cP" })] }),
      ],
    });
    const [feature] = extractFormulaVersionFeatureRows(baseInput({ processRows: [row] }));
    expect(feature.normalizedQuantities).toEqual([
      {
        path: "process.actualStep.viscosity",
        raw: "1500",
        rawUnit: "cP",
        normalized: false,
        sourceRecords: [{ sourceEntity: "trialProcessStep", sourceRecordId: "STEP-0001", parentRecordId: "TRIAL-0001" }],
      },
    ]);
  });
});

describe("extractFormulaVersionFeatureRows — test results", () => {
  it("normalizes every replicate and every stats field, sharing the result's own unit, disambiguated by replicateNumber", () => {
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
              stats: { count: 2, mean: "15", minimum: "10", maximum: "20" },
            }),
          ],
        },
      ],
    });
    const [feature] = extractFormulaVersionFeatureRows(baseInput({ testResultRows: [row] }));
    const paths = feature.normalizedQuantities.map((e) => `${e.path}:${e.detail ?? ""}`);
    expect(paths).toEqual([
      "testResult.replicate.numericValue:1",
      "testResult.replicate.numericValue:2",
      "testResult.stats.mean:",
      "testResult.stats.minimum:",
      "testResult.stats.maximum:",
    ]);
    for (const entry of feature.normalizedQuantities) {
      expect(entry.sourceRecords).toEqual([{ sourceEntity: "testResult", sourceRecordId: "RESULT-0001" }]);
      expect(entry.normalized).toBe(true);
      expect(entry.canonicalUnit).toBe("g");
    }
  });

  it("leaves a value with no unit at all as raw, unconverted numeric passthrough", () => {
    const row = testResultRow({
      trials: [
        {
          trialId: "TRIAL-0001",
          trialCode: "TRL-0001",
          testResults: [testResult({ replicates: [{ replicateNumber: 1, numericValue: "6.8" }] })],
        },
      ],
    });
    const [feature] = extractFormulaVersionFeatureRows(baseInput({ testResultRows: [row] }));
    expect(feature.normalizedQuantities).toEqual([
      {
        path: "testResult.replicate.numericValue",
        detail: "1",
        raw: "6.8",
        normalized: false,
        sourceRecords: [{ sourceEntity: "testResult", sourceRecordId: "RESULT-0001" }],
      },
    ]);
  });
});

describe("extractFormulaVersionFeatureRows — stability", () => {
  it("normalizes a stability result the same way as a trial test result", () => {
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
              results: [stabilityResult({ unit: "mL", replicates: [{ replicateNumber: 1, numericValue: "5" }] })],
            },
          ],
        },
      ],
    });
    const [feature] = extractFormulaVersionFeatureRows(baseInput({ stabilityRows: [row] }));
    expect(feature.normalizedQuantities).toEqual([
      {
        path: "stabilityResult.replicate.numericValue",
        detail: "1",
        raw: "5",
        rawUnit: "mL",
        canonicalUnit: "mL",
        canonicalValue: "5.0000",
        normalized: true,
        sourceRecords: [{ sourceEntity: "stabilityResult", sourceRecordId: "STABRESULT-0001" }],
      },
    ]);
  });
});

describe("extractFormulaVersionFeatureRows — DOE", () => {
  it("resolves a factor setting's unit from the owning design's frozen factorSnapshot, disambiguated by factorCode", () => {
    const row = doeRow({
      studies: [
        {
          studyId: "DOESTUDY-0001",
          studyCode: "DOE-0001",
          studyRevision: 1,
          designs: [
            {
              design: doeDesign({ factorSnapshot: [doeFactor({ factorCode: "TEMP", unit: "kg" })] }),
              runs: [{ run: doeRun({ factorSettings: [{ factorCode: "TEMP", codedValue: "1", actualValue: "0.5" }] }), observations: [] }],
            },
          ],
        },
      ],
    });
    const [feature] = extractFormulaVersionFeatureRows(baseInput({ doeRows: [row] }));
    expect(feature.normalizedQuantities).toEqual([
      {
        path: "doe.factorSetting.actualValue",
        detail: "TEMP",
        raw: "0.5",
        rawUnit: "kg",
        canonicalUnit: "g",
        canonicalValue: "500.0000",
        normalized: true,
        sourceRecords: [{ sourceEntity: "doeRun", sourceRecordId: "RUN-0001" }],
      },
    ]);
  });

  it("resolves an observation's unit from the owning design's frozen responseSnapshot", () => {
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
    const [feature] = extractFormulaVersionFeatureRows(baseInput({ doeRows: [row] }));
    expect(feature.normalizedQuantities).toEqual([
      {
        path: "doe.observation.value",
        raw: "12.5",
        rawUnit: "mL",
        canonicalUnit: "mL",
        canonicalValue: "12.5000",
        normalized: true,
        sourceRecords: [{ sourceEntity: "doeObservation", sourceRecordId: "OBS-0001" }],
      },
    ]);
  });

  it("never normalizes DoeFactor.lowValue/centerValue/highValue or DoeResponse.targetValue — planned/spec fields, not actuals", () => {
    const row = doeRow({
      studies: [
        {
          studyId: "DOESTUDY-0001",
          studyCode: "DOE-0001",
          studyRevision: 1,
          designs: [
            {
              design: doeDesign({
                factorSnapshot: [doeFactor({ factorCode: "TEMP", unit: "kg", lowValue: "0.1", centerValue: "0.5", highValue: "0.9" })],
                responseSnapshot: [doeResponse({ id: "RESPONSE-0001", unit: "mL", targetValue: "10", lowerLimit: "5", upperLimit: "15" })],
              }),
              runs: [],
            },
          ],
        },
      ],
    });
    const [feature] = extractFormulaVersionFeatureRows(baseInput({ doeRows: [row] }));
    expect(feature.normalizedQuantities).toEqual([]);
  });

  it("fails closed on a factorSettings.factorCode absent from the design's own factorSnapshot", () => {
    const row = doeRow({
      studies: [
        {
          studyId: "DOESTUDY-0001",
          studyCode: "DOE-0001",
          studyRevision: 1,
          designs: [
            {
              design: doeDesign(),
              runs: [{ run: doeRun({ factorSettings: [{ factorCode: "GHOST", codedValue: "1", actualValue: "1" }] }), observations: [] }],
            },
          ],
        },
      ],
    });
    expect(() => extractFormulaVersionFeatureRows(baseInput({ doeRows: [row] }))).toThrow(FormulaVersionFeatureExtractionError);
    try {
      extractFormulaVersionFeatureRows(baseInput({ doeRows: [row] }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionFeatureExtractionError);
      expect((err as FormulaVersionFeatureExtractionError).code).toBe("doe_run_factor_code_not_found");
    }
  });

  it("fails closed on a duplicate factorCode within one design's own factorSnapshot", () => {
    const row = doeRow({
      studies: [
        {
          studyId: "DOESTUDY-0001",
          studyCode: "DOE-0001",
          studyRevision: 1,
          designs: [
            {
              design: doeDesign({
                factorSnapshot: [doeFactor({ id: "F1", factorCode: "TEMP" }), doeFactor({ id: "F2", factorCode: "TEMP" })],
              }),
              runs: [],
            },
          ],
        },
      ],
    });
    try {
      extractFormulaVersionFeatureRows(baseInput({ doeRows: [row] }));
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionFeatureExtractionError).code).toBe("duplicate_doe_design_factor_code");
    }
  });
});

describe("extractFormulaVersionFeatureRows — corrective actions / cost / packaging context", () => {
  it("treats CostLine.quantityKg as already-in-kg, normalizing to canonical grams", () => {
    const row = correctiveCostContextRow({
      costSnapshots: [
        costSnapshot({ lines: [{ lineId: "COSTLINE-1", displayName: "Water", percent: "70", quantityKg: "70" }] }),
      ],
    });
    const [feature] = extractFormulaVersionFeatureRows(baseInput({ correctiveCostContextRows: [row] }));
    expect(feature.normalizedQuantities).toEqual([
      {
        path: "costSnapshot.costLine.quantityKg",
        detail: "COSTLINE-1",
        raw: "70",
        rawUnit: "kg",
        canonicalUnit: "g",
        canonicalValue: "70000.0000",
        normalized: true,
        sourceRecords: [{ sourceEntity: "costSnapshot", sourceRecordId: "COST-0001" }],
      },
    ]);
  });

  it("normalizes SkuCost.fillQuantity+fillUnit and leaves a 'pieces' fillUnit raw", () => {
    const row = correctiveCostContextRow({
      costSnapshots: [
        costSnapshot({ skuCosts: [{ skuCode: "SKU-0001", fillQuantity: "250", fillUnit: "ml" }] }),
      ],
    });
    const [feature] = extractFormulaVersionFeatureRows(baseInput({ correctiveCostContextRows: [row] }));
    expect(feature.normalizedQuantities).toEqual([
      {
        path: "costSnapshot.skuCost.fillQuantity",
        detail: "SKU-0001",
        raw: "250",
        rawUnit: "ml",
        canonicalUnit: "mL",
        canonicalValue: "250.0000",
        normalized: true,
        sourceRecords: [{ sourceEntity: "costSnapshot", sourceRecordId: "COST-0001" }],
      },
    ]);
  });

  it("normalizes packaging context fillQuantity, citing the owning stability study", () => {
    const row = correctiveCostContextRow({
      packagingContext: [
        {
          studyId: "STUDY-0001",
          studyCode: "STB-0001",
          packagingSkuCode: "SKU-0001",
          packagingSnapshot: { skuCode: "SKU-0001", lines: [], fillQuantity: "500", fillUnit: "g", capturedAt: "2026-01-06T00:00:00.000Z" },
        },
      ],
    });
    const [feature] = extractFormulaVersionFeatureRows(baseInput({ correctiveCostContextRows: [row] }));
    expect(feature.normalizedQuantities).toEqual([
      {
        path: "packagingContext.fillQuantity",
        detail: "SKU-0001",
        raw: "500",
        rawUnit: "g",
        canonicalUnit: "g",
        canonicalValue: "500.0000",
        normalized: true,
        sourceRecords: [{ sourceEntity: "stabilityStudy", sourceRecordId: "STUDY-0001" }],
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Row assembly / lineage / fail-closed behaviour
// ---------------------------------------------------------------------------

describe("extractFormulaVersionFeatureRows — row assembly", () => {
  it("carries the composition row's own identity onto the feature row and stays at FEATURE_SCHEMA_VERSION '1.0'", () => {
    const [feature] = extractFormulaVersionFeatureRows(baseInput());
    expect(feature.featureSchemaVersion).toBe(FEATURE_SCHEMA_VERSION);
    expect(FEATURE_SCHEMA_VERSION).toBe("1.0");
    expect(feature.formulaId).toBe("FORM-0001");
    expect(feature.formulaCode).toBe("HC-SHAMPOO-REG-001");
    expect(feature.formulaVersionId).toBe("VER-0001");
    expect(feature.formulaVersionNumber).toBe(1);
  });

  it("dedupes the shared formulation/formulationVersion lineage citation across every contributing row", () => {
    const [feature] = extractFormulaVersionFeatureRows(
      baseInput({ processRows: [processRow()], testResultRows: [testResultRow()], stabilityRows: [stabilityRow()] }),
    );
    expect(feature.sourceRecords).toEqual(BASE_LINEAGE);
  });

  it("produces an empty normalizedQuantities array (not an error) when every optional family is absent", () => {
    const [feature] = extractFormulaVersionFeatureRows(baseInput());
    expect(feature.normalizedQuantities).toEqual([]);
  });

  it("emits one row per requested id, in the requested order", () => {
    const rows = extractFormulaVersionFeatureRows({
      formulaVersionIds: ["VER-0002", "VER-0001"],
      compositionRows: [compositionRow(), compositionRow({ formulaVersionId: "VER-0002", formulaVersionNumber: 2 })],
    });
    expect(rows.map((r) => r.formulaVersionId)).toEqual(["VER-0002", "VER-0001"]);
  });

  it("fails closed when a requested id has no composition row", () => {
    expect(() => extractFormulaVersionFeatureRows({ formulaVersionIds: ["VER-GHOST"], compositionRows: [] })).toThrow(
      FormulaVersionFeatureExtractionError,
    );
  });

  it("fails closed on more than one composition row for the same formulaVersionId", () => {
    try {
      extractFormulaVersionFeatureRows(baseInput({ compositionRows: [compositionRow(), compositionRow()] }));
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionFeatureExtractionError).code).toBe("duplicate_formula_version_composition_row");
    }
  });

  it("fails closed when an optional row's formulaId contradicts the composition row's formulaId", () => {
    try {
      extractFormulaVersionFeatureRows(baseInput({ processRows: [processRow({ formulaId: "FORM-OTHER" })] }));
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionFeatureExtractionError).code).toBe("process_row_formula_version_conflict");
    }
  });

  it("fails closed on more than one optional row for the same formulaVersionId", () => {
    try {
      extractFormulaVersionFeatureRows(baseInput({ testResultRows: [testResultRow(), testResultRow()] }));
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionFeatureExtractionError).code).toBe("duplicate_formula_version_test_result_row");
    }
  });

  it("does not mutate any supplied input row", () => {
    const composition = compositionRow({ composition: [line({ id: "LINE-A", quantity: "1", quantityUnit: "kg" })] });
    const frozenCopy = structuredClone(composition);
    extractFormulaVersionFeatureRows(baseInput({ compositionRows: [composition] }));
    expect(composition).toEqual(frozenCopy);
  });

  it("returns output that shares no mutable aliasing with the source rows — mutating the result never touches the input", () => {
    const composition = compositionRow({ composition: [line({ id: "LINE-A", quantity: "1", quantityUnit: "kg" })] });
    const [feature] = extractFormulaVersionFeatureRows(baseInput({ compositionRows: [composition] }));
    feature.normalizedQuantities.push({
      path: "composition.line.quantity",
      raw: "999",
      normalized: false,
      sourceRecords: [{ sourceEntity: "formulationLine", sourceRecordId: "INJECTED" }],
    });
    expect(composition.composition).toHaveLength(1);
  });

  it("round-trips through JSON and still validates against formulaVersionFeatureRowSchema", () => {
    const row = compositionRow({ composition: [line({ id: "LINE-A", quantity: "1", quantityUnit: "kg" })] });
    const [feature] = extractFormulaVersionFeatureRows(baseInput({ compositionRows: [row] }));
    const roundTripped = JSON.parse(JSON.stringify(feature));
    expect(() => formulaVersionFeatureRowSchema.parse(roundTripped)).not.toThrow();
    expect(roundTripped).toEqual(feature);
  });

  it("is exported from the package's public entry point", () => {
    expect(extractFromPublicEntryPoint).toBe(extractFormulaVersionFeatureRows);
  });

  it("DATASET_SCHEMA_VERSION is untouched by this task — stays '1.6'", () => {
    expect(DATASET_SCHEMA_VERSION).toBe("1.6");
  });
});
