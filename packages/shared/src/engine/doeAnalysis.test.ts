import { describe, expect, it } from "vitest";
import type { Actor } from "../schemas/status";
import type { DoeDesign, DoeFactor, DoeObservation, DoeResponse, DoeRun } from "../schemas/doe";
import {
  buildDesignMatrix,
  calculateAnova,
  calculateFitMetrics,
  calculateResidualDiagnostics,
  comparePredictedAndObserved,
  createDoeAnalysis,
  deriveModelTerms,
  deriveObservedCodedRanges,
  fDistributionUpperTailPValue,
  fitFactorialModel,
  fitMixtureModel,
  fitResponseSurfaceModel,
  predictDoeResponse,
  suggestOutliers,
  tDistributionTwoSidedPValue,
  validateAnalysisEstimability,
} from "./doeAnalysis";
import { generateDoeDesign, createDoeStudy } from "./doeDesign";

const HUMAN: Actor = { kind: "human", role: "researcher", userId: "alice" };

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
    centerValue: "15",
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

function run(id: string, standardOrder: number, settings: { factorCode: string; codedValue: string }[]): DoeRun {
  return {
    schemaVersion: "1.0",
    id,
    studyId: "study-1",
    studyRevision: 1,
    designId: "design-1",
    runNumber: standardOrder,
    standardOrder,
    randomizedOrder: standardOrder,
    block: 1,
    replicate: 1,
    isCenterPoint: false,
    factorSettings: settings.map((s) => ({ ...s, actualValue: s.codedValue })),
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function response(overrides: Partial<DoeResponse> = {}): DoeResponse {
  return {
    schemaVersion: "1.0",
    id: "response-1",
    studyId: "study-1",
    studyRevision: 1,
    responseCode: "Y",
    name: "Y",
    responseType: "continuous",
    objective: "maximize",
    weight: "1",
    desirabilityShape: "linear",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function observation(runId: string, responseId: string, value: string, status: DoeObservation["status"] = "recorded"): DoeObservation {
  return {
    schemaVersion: "1.0",
    id: `obs-${runId}`,
    studyId: "study-1",
    studyRevision: 1,
    runId,
    responseId,
    value: status === "missing" ? undefined : value,
    status,
    recordedBy: "alice",
    recordedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("distributions", () => {
  it("fDistributionUpperTailPValue matches a known reference point", () => {
    // F(1,10) critical value for alpha=0.05 is ~4.965.
    const p = fDistributionUpperTailPValue(4.965, 1, 10);
    expect(p).toBeCloseTo(0.05, 2);
  });

  it("tDistributionTwoSidedPValue matches a known reference point", () => {
    // t(10) critical value for two-sided alpha=0.05 is ~2.228.
    const p = tDistributionTwoSidedPValue(2.228, 10);
    expect(p).toBeCloseTo(0.05, 2);
  });

  it("returns p near 1 for a near-zero statistic and near 0 for a huge statistic", () => {
    expect(fDistributionUpperTailPValue(0, 2, 20)).toBeCloseTo(1, 6);
    expect(fDistributionUpperTailPValue(1000, 2, 20)!).toBeLessThan(0.001);
  });
});

describe("deriveModelTerms / buildDesignMatrix", () => {
  it("main model: intercept + one term per numeric factor", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
    expect(deriveModelTerms(factors, "main")).toEqual(["intercept", "A", "B"]);
  });

  it("factorial model adds two-way interactions", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
    expect(deriveModelTerms(factors, "factorial")).toEqual(["intercept", "A", "B", "A*B"]);
  });

  it("quadratic model adds squared terms after interactions", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
    expect(deriveModelTerms(factors, "quadratic")).toEqual(["intercept", "A", "B", "A*B", "A^2", "B^2"]);
  });

  it("mixture models have no intercept and only mixture-component factors", () => {
    const factors = [factor({ factorCode: "A", isMixtureComponent: true }), factor({ factorCode: "B", isMixtureComponent: true }), factor({ factorCode: "C" })];
    expect(deriveModelTerms(factors, "mixture_linear")).toEqual(["A", "B"]);
    expect(deriveModelTerms(factors, "mixture_quadratic")).toEqual(["A", "B", "A*B"]);
  });

  it("categorical factors become k-1 dummy indicator terms", () => {
    const factors = [factor({ factorCode: "Color", factorType: "categorical", categoricalLevels: ["red", "green", "blue"] })];
    expect(deriveModelTerms(factors, "main")).toEqual(["intercept", "Color:green", "Color:blue"]);
  });

  it("buildDesignMatrix evaluates every term for every run", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
    const runs = [run("r1", 1, [{ factorCode: "A", codedValue: "-1" }, { factorCode: "B", codedValue: "1" }])];
    const { matrix, terms } = buildDesignMatrix(runs, factors, "factorial");
    expect(terms).toEqual(["intercept", "A", "B", "A*B"]);
    expect(matrix[0]).toEqual([1, -1, 1, -1]);
  });
});

describe("fitFactorialModel / fitResponseSurfaceModel — known-coefficient recovery", () => {
  it("recovers an exact main-effects-plus-interaction model from a 2^2 factorial plus a center point", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
    const points: [number, number][] = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
      [0, 0], // adds a residual degree of freedom beyond the saturated 4-term/4-run case
    ];
    const runs = points.map((p, i) => run(`r${i}`, i + 1, [{ factorCode: "A", codedValue: String(p[0]) }, { factorCode: "B", codedValue: String(p[1]) }]));
    const y = points.map(([a, b]) => 10 + 3 * a - 2 * b + 5 * a * b);
    const fit = fitFactorialModel(runs, factors, y);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.coefficients[0]).toBeCloseTo(10, 6);
    expect(fit.coefficients[1]).toBeCloseTo(3, 6);
    expect(fit.coefficients[2]).toBeCloseTo(-2, 6);
    expect(fit.coefficients[3]).toBeCloseTo(5, 6);
  });

  it("recovers an exact quadratic response-surface model", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
    const points: [number, number][] = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
      [0, 0],
      [0, 0],
      [1.41, 0],
      [-1.41, 0],
      [0, 1.41],
      [0, -1.41],
    ];
    const runs = points.map((p, i) => run(`r${i}`, i + 1, [{ factorCode: "A", codedValue: String(p[0]) }, { factorCode: "B", codedValue: String(p[1]) }]));
    const y = points.map(([a, b]) => 5 + 2 * a + 1 * b + 0.5 * a * b + 3 * a * a - 1 * b * b);
    const fit = fitResponseSurfaceModel(runs, factors, y);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const [intercept, ca, cb, cab, ca2, cb2] = fit.coefficients;
    expect(intercept).toBeCloseTo(5, 2);
    expect(ca).toBeCloseTo(2, 2);
    expect(cb).toBeCloseTo(1, 2);
    expect(cab).toBeCloseTo(0.5, 2);
    expect(ca2).toBeCloseTo(3, 2);
    expect(cb2).toBeCloseTo(-1, 2);
  });

  it("fails honestly (does not fabricate) for a singular model", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
    // Every run has A == B, so A and B are perfectly collinear for a main-effects model.
    const runs = [
      run("r1", 1, [{ factorCode: "A", codedValue: "-1" }, { factorCode: "B", codedValue: "-1" }]),
      run("r2", 2, [{ factorCode: "A", codedValue: "1" }, { factorCode: "B", codedValue: "1" }]),
      run("r3", 3, [{ factorCode: "A", codedValue: "0" }, { factorCode: "B", codedValue: "0" }]),
    ];
    const fit = fitFactorialModel(runs, factors, [1, 2, 3]);
    expect(fit.ok).toBe(false);
  });

  it("recovers an exact Scheffé mixture-linear model (no intercept)", () => {
    const factors = [factor({ factorCode: "A", isMixtureComponent: true }), factor({ factorCode: "B", isMixtureComponent: true }), factor({ factorCode: "C", isMixtureComponent: true })];
    // A {3,2} simplex-lattice: vertices + edge midpoints, 6 points summing to 1.
    const points: [number, number, number][] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.5, 0.5, 0],
      [0.5, 0, 0.5],
      [0, 0.5, 0.5],
    ];
    const runs = points.map((p, i) => run(`r${i}`, i + 1, [{ factorCode: "A", codedValue: String(p[0]) }, { factorCode: "B", codedValue: String(p[1]) }, { factorCode: "C", codedValue: String(p[2]) }]));
    const y = points.map(([a, b, c]) => 5 * a + 3 * b + 8 * c);
    const fit = fitMixtureModel(runs, factors, y, "linear");
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.terms).toEqual(["A", "B", "C"]);
    expect(fit.coefficients[0]).toBeCloseTo(5, 6);
    expect(fit.coefficients[1]).toBeCloseTo(3, 6);
    expect(fit.coefficients[2]).toBeCloseTo(8, 6);
  });
});

describe("calculateAnova / calculateFitMetrics", () => {
  it("computes a perfect-fit ANOVA (zero residual sum of squares) correctly", () => {
    const y = [0, 1, 2, 3];
    const fitted = [0, 1, 2, 3];
    const rows = calculateAnova(y, fitted, 2, true);
    const residualRow = rows.find((r) => r.source === "Residual")!;
    expect(residualRow.sumOfSquares).toBeCloseTo(0, 8);
    const metrics = calculateFitMetrics(y, fitted, 2, true);
    expect(metrics.rSquared).toBeCloseTo(1, 6);
  });

  it("computes lack-of-fit and pure-error rows when replication leaves spare degrees of freedom", () => {
    // 3 distinct x-levels x2 replicates each: a 2-term (intercept+slope) linear
    // model has residual df=4, but pure error only consumes df=3 (1 per group),
    // leaving 1 genuine lack-of-fit degree of freedom.
    const y = [10, 10.4, 12, 12.6, 14, 13.2];
    const fitted = [10.2, 10.2, 12.3, 12.3, 14.4, 14.4];
    const keys = ["A=-1", "A=-1", "A=0", "A=0", "A=1", "A=1"];
    const rows = calculateAnova(y, fitted, 2, true, keys);
    expect(rows.some((r) => r.source === "Lack of Fit")).toBe(true);
    expect(rows.some((r) => r.source === "Pure Error")).toBe(true);
  });

  it("adjusted R^2 is never greater than R^2 for a non-saturated model", () => {
    const y = [1, 2, 3, 5, 4, 6];
    const fitted = [1.2, 2.1, 2.8, 4.6, 4.3, 5.9];
    const metrics = calculateFitMetrics(y, fitted, 2, true);
    expect(metrics.adjustedRSquared!).toBeLessThanOrEqual(metrics.rSquared!);
  });
});

describe("calculateResidualDiagnostics / suggestOutliers", () => {
  it("flags a planted outlier via standardized residual or Cook's distance without excluding it", () => {
    // 7 points exactly on y=1+2x, plus one wild outlier at a duplicated x=3.
    // More clean points (higher residual df) keeps a single outlier's masking
    // effect on MSE from hiding it — see doeMath.test.ts's Cook's-distance note.
    const xs = [-3, -2, -1, 0, 1, 2, 3, 3];
    const ys = [-5, -3, -1, 1, 3, 5, 7, 50];
    const factors = [factor({ factorCode: "A" })];
    const runs = xs.map((x, i) => run(`r${i}`, i + 1, [{ factorCode: "A", codedValue: String(x) }]));
    const fit = fitFactorialModel(runs, factors, ys);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const mse = fit.rss / fit.residualDegreesOfFreedom;
    const diagnostics = calculateResidualDiagnostics(runs.map((r) => r.id), ys, fit.fitted, fit.residuals, fit.leverage, 2, mse);
    expect(diagnostics).toHaveLength(8);
    const outliers = suggestOutliers(diagnostics);
    expect(outliers.some((o) => o.runId === "r7")).toBe(true);
  });

  it("suggests nothing for a clean, well-fit dataset", () => {
    const runIds = ["r1", "r2", "r3", "r4"];
    const y = [1, 2, 3, 4];
    const fitted = [1.02, 1.98, 3.01, 3.99];
    const residuals = y.map((v, i) => v - fitted[i]);
    const leverage = [0.25, 0.25, 0.25, 0.25];
    const mse = 0.001;
    const diagnostics = calculateResidualDiagnostics(runIds, y, fitted, residuals, leverage, 2, mse);
    expect(suggestOutliers(diagnostics)).toHaveLength(0);
  });
});

describe("predictDoeResponse / comparePredictedAndObserved", () => {
  it("predicts using exactly the fitted terms and flags extrapolation outside the observed range", () => {
    const terms = ["intercept", "A"];
    const coefficients = [10, 3];
    const ranges = { A: { min: -1, max: 1 } };
    const inRange = predictDoeResponse(terms, coefficients, [{ factorCode: "A", codedValue: "0.5", actualValue: "0.5" }], ranges);
    expect(inRange.value).toBeCloseTo(11.5, 6);
    expect(inRange.isExtrapolated).toBe(false);
    const outOfRange = predictDoeResponse(terms, coefficients, [{ factorCode: "A", codedValue: "2", actualValue: "2" }], ranges);
    expect(outOfRange.isExtrapolated).toBe(true);
  });

  it("deriveObservedCodedRanges reads the min/max coded value per factor from a run set", () => {
    const runs = [
      run("r1", 1, [{ factorCode: "A", codedValue: "-1" }]),
      run("r2", 2, [{ factorCode: "A", codedValue: "1" }]),
      run("r3", 3, [{ factorCode: "A", codedValue: "0" }]),
    ];
    expect(deriveObservedCodedRanges(runs)).toEqual({ A: { min: -1, max: 1 } });
  });

  it("comparePredictedAndObserved pairs every included run with its observed value", () => {
    const terms = ["intercept", "A"];
    const coefficients = [10, 3];
    const runs = [run("r1", 1, [{ factorCode: "A", codedValue: "1" }]), run("r2", 2, [{ factorCode: "A", codedValue: "-1" }])];
    const observed = new Map([["r1", 13], ["r2", 6]]);
    const points = comparePredictedAndObserved(terms, coefficients, runs, observed);
    expect(points).toHaveLength(2);
    expect(points.find((p) => p.runId === "r1")!.residual).toBeCloseTo(0, 6);
    expect(points.find((p) => p.runId === "r2")!.residual).toBeCloseTo(-1, 6);
  });
});

describe("validateAnalysisEstimability", () => {
  it("rejects when runs cannot estimate every term", () => {
    expect(validateAnalysisEstimability(3, 3).valid).toBe(false);
    expect(validateAnalysisEstimability(2, 3).valid).toBe(false);
  });

  it("accepts with a low-df warning when the margin is thin", () => {
    const result = validateAnalysisEstimability(5, 3);
    expect(result.valid).toBe(true);
    expect(result.message).toMatch(/unstable/i);
  });

  it("accepts cleanly with a comfortable margin", () => {
    expect(validateAnalysisEstimability(20, 4)).toEqual({ valid: true });
  });
});

describe("createDoeAnalysis (end-to-end)", () => {
  const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" }), factor({ factorCode: "C" })];
  const study = createDoeStudy(
    { studyCode: "DOE-200", title: "Study", projectId: "p", formulationId: "f", baselineFormulaVersionId: "v1", baselineFormulaVersionStatus: "approved", designType: "full_factorial" },
    HUMAN,
  );
  const generated = generateDoeDesign({ study, factors, constraints: [], responses: [response()], designType: "full_factorial", seed: 1 }, HUMAN);
  const resp = response();

  it("fits a real model from recorded observations, excluding missing/excluded runs honestly", () => {
    const runs = generated.runs; // 2^3 = 8 runs; main_effects model has 4 terms (intercept+A+B+C)
    const observations: DoeObservation[] = runs.slice(0, 7).map((r, i) => observation(r.id, resp.id, String(10 + i)));
    // runs[7] deliberately left with no observation at all — must be excluded, never treated as 0.
    const analysis = createDoeAnalysis({ studyId: study.id, studyRevision: study.revision, design: generated.design, runs, observations, response: resp, analysisType: "main_effects" }, HUMAN);
    expect(analysis.includedRunIds).toHaveLength(7);
    expect(analysis.excludedRunIds).toHaveLength(1);
    expect(analysis.excludedRunIds[0]).toBe(runs[7].id);
    expect(analysis.warnings.some((w) => /no observation recorded/i.test(w))).toBe(true);
    expect(analysis.coefficients.length).toBeGreaterThan(0);
  });

  it("keeps an outlier-flagged observation in the fit while still warning about it", () => {
    const runs = generated.runs;
    const observations: DoeObservation[] = runs.map((r, i) => observation(r.id, resp.id, String(10 + i), i === 0 ? "outlier_flagged" : "recorded"));
    const analysis = createDoeAnalysis({ studyId: study.id, studyRevision: study.revision, design: generated.design, runs, observations, response: resp, analysisType: "main_effects" }, HUMAN);
    expect(analysis.includedRunIds).toHaveLength(8);
    expect(analysis.warnings.some((w) => /flagged as a possible outlier/i.test(w))).toBe(true);
  });

  it("refuses a categorical response rather than forcing it through OLS", () => {
    const catResponse = response({ responseType: "categorical", id: "response-cat" });
    const runs = generated.runs;
    const observations = runs.map((r) => observation(r.id, catResponse.id, "1"));
    expect(() =>
      createDoeAnalysis({ studyId: study.id, studyRevision: study.revision, design: generated.design, runs, observations, response: catResponse, analysisType: "categorical_comparison" }, HUMAN),
    ).toThrow(/only continuous\/integer responses/i);
  });

  it("refuses when too few observations remain to estimate the model", () => {
    const runs = generated.runs;
    const observations = [observation(runs[0].id, resp.id, "10")];
    expect(() =>
      createDoeAnalysis({ studyId: study.id, studyRevision: study.revision, design: generated.design, runs, observations, response: resp, analysisType: "factorial" }, HUMAN),
    ).toThrow(/cannot run analysis/i);
  });

  it("refuses a non-human actor", () => {
    const runs = generated.runs;
    const observations = runs.map((r, i) => observation(r.id, resp.id, String(10 + i)));
    expect(() =>
      createDoeAnalysis({ studyId: study.id, studyRevision: study.revision, design: generated.design, runs, observations, response: resp, analysisType: "main_effects" }, { kind: "agent" } as Actor),
    ).toThrow();
  });
});
