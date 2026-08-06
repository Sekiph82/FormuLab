import { describe, expect, it } from "vitest";
import type { DoeAnalysis, DoeCandidate, DoeConstraint, DoeDesign, DoeFactor, DoeObservation, DoeResponse, DoeRun, DoeStudy } from "../schemas/doe";
import {
  buildDoeStudyExportMeta,
  doeAnalysisJsonPackage,
  doeAnovaCsvRows,
  doeCandidateListCsvRows,
  doeCoefficientsCsvRows,
  doeConstraintsCsvRows,
  doeDesignMatrixCsvRows,
  doeFactorsCsvRows,
  doeObservationsCsvRows,
  doeResponsesCsvRows,
  doeRunSheetCsvRows,
  doeStudyJsonPackage,
  previewDoeConstraintImport,
  previewDoeFactorImport,
  previewDoeObservationImport,
} from "./doeExports";

function factor(overrides: Partial<DoeFactor> & Pick<DoeFactor, "factorCode">): DoeFactor {
  return {
    schemaVersion: "1.0",
    id: `factor-${overrides.factorCode}`,
    studyId: "study-1",
    studyRevision: 1,
    name: overrides.factorCode,
    factorType: "continuous",
    sourceType: "process_parameter",
    sourceEntityId: overrides.factorCode,
    lowValue: "10",
    highValue: "20",
    categoricalLevels: [],
    transformation: "none",
    precision: 2,
    isMixtureComponent: false,
    isProcessFactor: true,
    isControlled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function study(): DoeStudy {
  return {
    schemaVersion: "1.0",
    id: "study-1",
    studyCode: "DOE-1",
    title: "Screening",
    projectId: "project-1",
    formulationId: "project-1",
    baselineFormulaVersionId: "version-1",
    status: "runs_generated",
    designType: "full_factorial",
    randomizationEnabled: true,
    blockingEnabled: false,
    replicatePolicy: "none",
    centerPointPolicy: "none",
    revision: 1,
    createdBy: "alice",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function run(id: string, standardOrder: number, randomizedOrder: number, settings: { factorCode: string; codedValue: string; actualValue: string }[]): DoeRun {
  return {
    schemaVersion: "1.0",
    id,
    studyId: "study-1",
    studyRevision: 1,
    designId: "design-1",
    runNumber: standardOrder,
    standardOrder,
    randomizedOrder,
    block: 1,
    replicate: 1,
    isCenterPoint: false,
    factorSettings: settings,
    status: "planned",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function design(factors: DoeFactor[]): DoeDesign {
  return {
    schemaVersion: "1.0",
    id: "design-1",
    studyId: "study-1",
    studyRevision: 1,
    designType: "full_factorial",
    factorSnapshot: factors,
    constraintSnapshot: [],
    responseSnapshot: [],
    generationSettings: {},
    seed: 1,
    runCount: 2,
    replicateCount: 0,
    centerPointCount: 0,
    blockCount: 1,
    generatedBy: "alice",
    generatedAt: "2026-01-01T00:00:00.000Z",
    diagnostics: { runCount: 2, degreesOfFreedom: 0, duplicateRunCount: 0, estimableTerms: [], aliasedTerms: [], isOrthogonal: true, isBalanced: true, centerPointCount: 0, replicateCount: 0, constraintViolationCount: 0, warnings: [] },
  };
}

function response(): DoeResponse {
  return {
    schemaVersion: "1.0",
    id: "response-1",
    studyId: "study-1",
    studyRevision: 1,
    responseCode: "Y",
    name: "Viscosity",
    responseType: "continuous",
    objective: "maximize",
    weight: "1",
    desirabilityShape: "linear",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("study/factor/constraint/response export", () => {
  it("buildDoeStudyExportMeta captures identifying fields", () => {
    const meta = buildDoeStudyExportMeta(study());
    expect(meta.studyCode).toBe("DOE-1");
    expect(meta.baselineFormulaVersionId).toBe("version-1");
  });

  it("doeStudyJsonPackage embeds factors/constraints/responses/design/runs", () => {
    const factors = [factor({ factorCode: "A" })];
    const runs = [run("r1", 1, 1, [{ factorCode: "A", codedValue: "-1", actualValue: "10" }])];
    const pkg = doeStudyJsonPackage(study(), buildDoeStudyExportMeta(study()), factors, [], [response()], design(factors), runs);
    expect(pkg.factors).toEqual(factors);
    expect((pkg.design as Record<string, unknown>).seed).toBe(1);
    expect((pkg.runs as unknown[])).toHaveLength(1);
  });

  it("doeStudyJsonPackage handles no design generated yet", () => {
    const pkg = doeStudyJsonPackage(study(), buildDoeStudyExportMeta(study()), [], [], []);
    expect(pkg.design).toBeNull();
    expect(pkg.runs).toEqual([]);
  });

  it("doeFactorsCsvRows / doeConstraintsCsvRows / doeResponsesCsvRows produce real rows", () => {
    const factors = doeFactorsCsvRows([factor({ factorCode: "A", categoricalLevels: [] })]);
    expect(factors.rows[0].factorCode).toBe("A");
    const constraint: DoeConstraint = { schemaVersion: "1.0", id: "c1", studyId: "s", studyRevision: 1, constraintType: "custom", expression: "A <= 10", severity: "hard", appliesTo: ["A"], createdBy: "alice", createdAt: "now" };
    const constraints = doeConstraintsCsvRows([constraint]);
    expect(constraints.rows[0].expression).toBe("A <= 10");
    const responses = doeResponsesCsvRows([response()]);
    expect(responses.rows[0].responseCode).toBe("Y");
  });
});

describe("design matrix / run sheet export", () => {
  const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
  const d = design(factors);
  const runs = [
    run("r1", 1, 2, [{ factorCode: "A", codedValue: "-1", actualValue: "10" }, { factorCode: "B", codedValue: "1", actualValue: "20" }]),
    run("r2", 2, 1, [{ factorCode: "A", codedValue: "1", actualValue: "20" }, { factorCode: "B", codedValue: "-1", actualValue: "10" }]),
  ];

  it("doeDesignMatrixCsvRows uses coded values, ordered by standard order", () => {
    const matrix = doeDesignMatrixCsvRows(d, runs);
    expect(matrix.headers).toContain("A");
    expect(matrix.rows[0].standardOrder).toBe(1);
    expect(matrix.rows[0].A).toBe("-1");
  });

  it("doeRunSheetCsvRows uses actual values, ordered by randomized order", () => {
    const sheet = doeRunSheetCsvRows(d, runs);
    expect(sheet.rows[0].randomizedOrder).toBe(1);
    expect(sheet.rows[0].A).toBe("20"); // run r2 has randomizedOrder=1
  });
});

describe("observations export/import", () => {
  const factors = [factor({ factorCode: "A" })];
  const runs = [run("r1", 1, 1, [{ factorCode: "A", codedValue: "-1", actualValue: "10" }])];
  const resp = response();

  it("doeObservationsCsvRows produces one row per (run, response), defaulting to missing", () => {
    const obs: DoeObservation[] = [{ schemaVersion: "1.0", id: "o1", studyId: "study-1", studyRevision: 1, runId: "r1", responseId: resp.id, value: "12.5", status: "recorded", recordedBy: "alice", recordedAt: "now" }];
    const table = doeObservationsCsvRows(runs, [resp], obs);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].value).toBe("12.5");
  });

  it("doeObservationsCsvRows marks an unrecorded response as missing, never fabricating a value", () => {
    const table = doeObservationsCsvRows(runs, [resp], []);
    expect(table.rows[0].status).toBe("missing");
    expect(table.rows[0].value).toBe("");
  });

  it("previewDoeObservationImport validates rows and dedupes on the composite (runId, responseCode) key", () => {
    const csv = "runId,responseCode,value,status\nr1,Y,12.5,recorded\nr1,Y,13,recorded\n";
    const preview = previewDoeObservationImport(csv);
    expect(preview.valid).toHaveLength(1);
    expect(preview.invalidRows).toEqual([3]); // second r1/Y row is a duplicate within the file
  });

  it("previewDoeObservationImport rejects a row missing a required column", () => {
    const csv = "runId,responseCode,value\n,Y,12.5\n";
    const preview = previewDoeObservationImport(csv);
    expect(preview.valid).toHaveLength(0);
    expect(preview.issues.some((i) => i.severity === "error")).toBe(true);
  });

  void factors;
});

describe("factor / constraint import", () => {
  it("previewDoeFactorImport validates a well-formed factor CSV", () => {
    const csv = "factorCode,name,factorType,sourceType,lowValue,highValue\nA,Surfactant,continuous,formula_material,10,20\n";
    const preview = previewDoeFactorImport(csv);
    expect(preview.valid).toHaveLength(1);
    expect(preview.creates).toEqual(["A"]);
  });

  it("previewDoeFactorImport flags a non-numeric lowValue", () => {
    const csv = "factorCode,name,factorType,sourceType,lowValue,highValue\nA,Surfactant,continuous,formula_material,not-a-number,20\n";
    const preview = previewDoeFactorImport(csv);
    expect(preview.valid).toHaveLength(0);
    expect(preview.issues.some((i) => /not a number/i.test(i.message))).toBe(true);
  });

  it("previewDoeConstraintImport treats an existing constraint code as an update", () => {
    const csv = "code,constraintType,expression,severity\nc1,custom,A <= 10,hard\n";
    const preview = previewDoeConstraintImport(csv, ["c1"]);
    expect(preview.updates).toEqual(["c1"]);
  });
});

describe("analysis-results / coefficients / ANOVA export", () => {
  const analysis: DoeAnalysis = {
    schemaVersion: "1.0",
    id: "analysis-1",
    studyId: "study-1",
    studyRevision: 1,
    designId: "design-1",
    responseId: "response-1",
    analysisType: "main_effects",
    includedRunIds: ["r1", "r2"],
    excludedRunIds: [],
    modelTerms: ["intercept", "A"],
    coefficients: [
      { term: "intercept", estimate: 10 },
      { term: "A", estimate: 2.5, standardError: 0.3, tStatistic: 8.3, pValue: 0.001 },
    ],
    effectEstimates: [{ term: "A", effect: 5, absoluteEffect: 5 }],
    anova: [{ source: "Model", sumOfSquares: 12, degreesOfFreedom: 1 }],
    diagnostics: [],
    fitMetrics: { rSquared: 0.95 },
    predictions: [],
    warnings: [],
    createdBy: "alice",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("doeAnalysisJsonPackage explicitly documents it is export-only, never re-importable as native", () => {
    const pkg = doeAnalysisJsonPackage(analysis, response());
    expect(String(pkg.note)).toMatch(/never be re-imported as a native analysis/i);
    expect(pkg.coefficients).toEqual(analysis.coefficients);
  });

  it("doeCoefficientsCsvRows / doeAnovaCsvRows produce real rows from the stored analysis", () => {
    const coeffs = doeCoefficientsCsvRows(analysis);
    expect(coeffs.rows).toHaveLength(2);
    expect(coeffs.rows[1].estimate).toBe(2.5);
    const anova = doeAnovaCsvRows(analysis);
    expect(anova.rows[0].source).toBe("Model");
  });
});

describe("candidate-list export", () => {
  it("doeCandidateListCsvRows summarizes factor settings and predicted responses per candidate", () => {
    const candidate: DoeCandidate = {
      schemaVersion: "1.0",
      id: "candidate-1",
      studyId: "study-1",
      studyRevision: 1,
      analysisIds: ["analysis-1"],
      factorSettings: [{ factorCode: "A", codedValue: "1", actualValue: "20" }],
      predictedResponses: [{ responseId: "response-1", predictedValue: 15.5, isExtrapolated: false, analysisId: "analysis-1" }],
      desirability: 0.8,
      constraintStatus: [],
      rank: 1,
      status: "proposed",
      createdBy: "alice",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const table = doeCandidateListCsvRows([candidate], [response()]);
    expect(table.rows[0].rank).toBe(1);
    expect(String(table.rows[0].factorSettings)).toContain("A=20");
    expect(String(table.rows[0].predictedResponses)).toContain("Viscosity=15.5000");
  });
});
