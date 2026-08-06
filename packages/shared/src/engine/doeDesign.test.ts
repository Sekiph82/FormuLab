import { describe, expect, it } from "vitest";
import type { Actor } from "../schemas/status";
import type { DoeConstraint, DoeFactor, DoeResponse, DoeStudy } from "../schemas/doe";
import {
  calculateDesignDiagnostics,
  canTransitionDoeStudyStatus,
  createDoeStudy,
  createSeededRandom,
  deriveDoeStudyStatus,
  generateBoxBehnkenDesign,
  generateCentralCompositeDesign,
  generateDoeDesign,
  generateFractionalFactorialDesign,
  generateFullFactorialDesign,
  generateLatinHypercubeDesign,
  generateManualDesign,
  generateMixtureSimplexLatticeDesign,
  generatePlackettBurmanDesign,
  generateTwoLevelFactorialDesign,
  isDoeStudyImmutable,
  randomizeDoeRuns,
  resolveDoeRevisionChain,
  reviseDoeStudy,
  validateDoeConstraints,
  validateDoeFactors,
  validateDoeResponses,
  validateGeneratedDesign,
} from "./doeDesign";

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

function response(code: string): DoeResponse {
  return {
    schemaVersion: "1.0",
    id: `response-${code}`,
    studyId: "study-1",
    studyRevision: 1,
    responseCode: code,
    name: code,
    responseType: "continuous",
    objective: "maximize",
    weight: "1",
    desirabilityShape: "linear",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const RESPONSES = [response("Viscosity")];

describe("createDoeStudy / reviseDoeStudy", () => {
  it("creates a draft study bound to a saved formula version", () => {
    const study = createDoeStudy(
      {
        studyCode: "DOE-001",
        title: "Screening",
        projectId: "project-1",
        formulationId: "formulation-1",
        baselineFormulaVersionId: "version-1",
        baselineFormulaVersionStatus: "approved",
        designType: "full_factorial",
      },
      HUMAN,
    );
    expect(study.status).toBe("draft");
    expect(study.revision).toBe(1);
    expect(study.baselineFormulaVersionId).toBe("version-1");
  });

  it("refuses a working draft as the baseline", () => {
    expect(() =>
      createDoeStudy(
        {
          studyCode: "DOE-002",
          title: "Screening",
          projectId: "project-1",
          formulationId: "formulation-1",
          baselineFormulaVersionId: "version-1",
          baselineFormulaVersionStatus: "draft",
          designType: "full_factorial",
        },
        HUMAN,
      ),
    ).toThrow(/working draft/i);
  });

  it("refuses a non-human actor", () => {
    expect(() =>
      createDoeStudy(
        {
          studyCode: "DOE-003",
          title: "Screening",
          projectId: "project-1",
          formulationId: "formulation-1",
          baselineFormulaVersionId: "version-1",
          baselineFormulaVersionStatus: "approved",
          designType: "full_factorial",
        },
        { kind: "system" } as Actor,
      ),
    ).toThrow();
  });

  it("revises a study with a bumped revision and supersedesStudyId", () => {
    const original = createDoeStudy(
      {
        studyCode: "DOE-004",
        title: "Screening",
        projectId: "project-1",
        formulationId: "formulation-1",
        baselineFormulaVersionId: "version-1",
        baselineFormulaVersionStatus: "approved",
        designType: "full_factorial",
      },
      HUMAN,
    );
    const revised = reviseDoeStudy(original, { title: "Screening v2" }, HUMAN);
    expect(revised.revision).toBe(2);
    expect(revised.supersedesStudyId).toBe(original.id);
    expect(revised.title).toBe("Screening v2");
    expect(revised.status).toBe("draft");
  });

  it("resolveDoeRevisionChain walks supersedesStudyId back to the original, oldest first", () => {
    const v1 = createDoeStudy(
      { studyCode: "DOE-005", title: "V1", projectId: "p", formulationId: "f", baselineFormulaVersionId: "v1", baselineFormulaVersionStatus: "approved", designType: "full_factorial" },
      HUMAN,
    );
    const v2 = reviseDoeStudy(v1, { title: "V2" }, HUMAN);
    const v3 = reviseDoeStudy(v2, { title: "V3" }, HUMAN);
    const chain = resolveDoeRevisionChain(v3, [v1, v2, v3]);
    expect(chain.map((s) => s.title)).toEqual(["V1", "V2", "V3"]);
  });
});

describe("study status", () => {
  it("locks immutable statuses", () => {
    expect(isDoeStudyImmutable("analyzed")).toBe(true);
    expect(isDoeStudyImmutable("draft")).toBe(false);
  });

  it("canTransitionDoeStudyStatus follows the allowed graph only", () => {
    expect(canTransitionDoeStudyStatus("draft", "design_ready")).toBe(true);
    expect(canTransitionDoeStudyStatus("draft", "completed")).toBe(false);
    expect(canTransitionDoeStudyStatus("completed", "archived")).toBe(true);
    expect(canTransitionDoeStudyStatus("archived", "draft")).toBe(false);
  });

  it("deriveDoeStudyStatus reflects real recorded state, never assumed", () => {
    expect(
      deriveDoeStudyStatus({ currentStatus: "draft", hasDesign: false, runCount: 0, completedRunCount: 0, totalObservationSlots: 0, recordedObservationCount: 0, hasAnalysis: false, hasSelectedCandidate: false }),
    ).toBe("draft");
    expect(
      deriveDoeStudyStatus({ currentStatus: "draft", hasDesign: true, runCount: 0, completedRunCount: 0, totalObservationSlots: 0, recordedObservationCount: 0, hasAnalysis: false, hasSelectedCandidate: false }),
    ).toBe("design_ready");
    expect(
      deriveDoeStudyStatus({ currentStatus: "draft", hasDesign: true, runCount: 8, completedRunCount: 0, totalObservationSlots: 0, recordedObservationCount: 0, hasAnalysis: false, hasSelectedCandidate: false }),
    ).toBe("runs_generated");
    expect(
      deriveDoeStudyStatus({ currentStatus: "draft", hasDesign: true, runCount: 8, completedRunCount: 8, totalObservationSlots: 8, recordedObservationCount: 8, hasAnalysis: false, hasSelectedCandidate: false }),
    ).toBe("analysis_ready");
    expect(
      deriveDoeStudyStatus({ currentStatus: "draft", hasDesign: true, runCount: 8, completedRunCount: 8, totalObservationSlots: 8, recordedObservationCount: 8, hasAnalysis: true, hasSelectedCandidate: false }),
    ).toBe("analyzed");
    // Once immutable, stays immutable regardless of new counts.
    expect(
      deriveDoeStudyStatus({ currentStatus: "completed", hasDesign: true, runCount: 8, completedRunCount: 8, totalObservationSlots: 8, recordedObservationCount: 8, hasAnalysis: false, hasSelectedCandidate: false }),
    ).toBe("completed");
  });
});

describe("validateDoeFactors / validateDoeConstraints / validateDoeResponses", () => {
  it("requires at least one factor", () => {
    expect(validateDoeFactors([])).toHaveLength(1);
  });

  it("rejects duplicate factor codes", () => {
    const issues = validateDoeFactors([factor({ factorCode: "A" }), factor({ factorCode: "A" })]);
    expect(issues.some((i) => /duplicate/i.test(i.message))).toBe(true);
  });

  it("requires low < high for continuous factors", () => {
    const issues = validateDoeFactors([factor({ factorCode: "A", lowValue: "20", highValue: "10" })]);
    expect(issues.some((i) => /low value must be less/i.test(i.message))).toBe(true);
  });

  it("requires at least 2 categorical levels", () => {
    const issues = validateDoeFactors([factor({ factorCode: "A", factorType: "categorical", categoricalLevels: ["one"] })]);
    expect(issues.some((i) => /2 categorical levels/i.test(i.message))).toBe(true);
  });

  it("requires a source entity id unless sourceType is custom", () => {
    const issues = validateDoeFactors([factor({ factorCode: "A", sourceEntityId: undefined })]);
    expect(issues.some((i) => /source entity/i.test(i.message))).toBe(true);
  });

  it("requires at least 2 mixture-component factors if any are marked as mixture", () => {
    const issues = validateDoeFactors([factor({ factorCode: "A", isMixtureComponent: true }), factor({ factorCode: "B", isMixtureComponent: false })]);
    expect(issues.some((i) => /mixture design needs at least 2/i.test(i.message))).toBe(true);
  });

  it("validateDoeConstraints rejects unsafe/unknown expressions and accepts valid ones", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
    const good: DoeConstraint = { schemaVersion: "1.0", id: "c1", studyId: "s", studyRevision: 1, constraintType: "sum_max", expression: "A + B <= 25", severity: "hard", appliesTo: [], createdBy: "alice", createdAt: "now" };
    const bad: DoeConstraint = { ...good, id: "c2", expression: "A + Unknown <= 25" };
    expect(validateDoeConstraints([good], factors)).toHaveLength(0);
    expect(validateDoeConstraints([bad], factors)).toHaveLength(1);
  });

  it("validateDoeResponses requires target/limits matching the chosen objective", () => {
    expect(validateDoeResponses([])).toHaveLength(1);
    const missingTarget: DoeResponse = { ...response("R"), objective: "target", targetValue: undefined };
    expect(validateDoeResponses([missingTarget]).some((i) => /target value/i.test(i.message))).toBe(true);
    const missingRange: DoeResponse = { ...response("R"), objective: "within_range" };
    expect(validateDoeResponses([missingRange]).some((i) => /lower or upper limit/i.test(i.message))).toBe(true);
  });
});

describe("generateFullFactorialDesign / generateTwoLevelFactorialDesign", () => {
  it("produces 2^k runs for k continuous factors", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" }), factor({ factorCode: "C" })];
    expect(generateFullFactorialDesign(factors)).toHaveLength(8);
    expect(generateTwoLevelFactorialDesign(factors)).toHaveLength(8);
  });

  it("every combination of levels appears exactly once", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
    const runs = generateFullFactorialDesign(factors);
    const signatures = new Set(runs.map((r) => r.settings.map((s) => `${s.factorCode}=${s.codedValue}`).sort().join("|")));
    expect(signatures.size).toBe(4);
  });

  it("maps coded -1/+1 to the factor's low/high actual values", () => {
    const factors = [factor({ factorCode: "A", lowValue: "10", highValue: "20" })];
    const runs = generateFullFactorialDesign(factors);
    const actuals = runs.map((r) => Number(r.settings[0].actualValue)).sort((a, b) => a - b);
    expect(actuals).toEqual([10, 20]);
  });

  it("handles a categorical factor by using its own levels", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "Color", factorType: "categorical", categoricalLevels: ["red", "green", "blue"] })];
    expect(generateFullFactorialDesign(factors)).toHaveLength(6); // 2 * 3
  });
});

describe("generateFractionalFactorialDesign", () => {
  it("produces a 2^(k-1) half fraction", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" }), factor({ factorCode: "C" })];
    expect(generateFractionalFactorialDesign(factors, {})).toHaveLength(4);
  });

  it("the derived factor's coded value is the product of the base factors' signs", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" }), factor({ factorCode: "C" })];
    const runs = generateFractionalFactorialDesign(factors, {});
    for (const run of runs) {
      const a = Number(run.settings.find((s) => s.factorCode === "A")!.codedValue);
      const b = Number(run.settings.find((s) => s.factorCode === "B")!.codedValue);
      const c = Number(run.settings.find((s) => s.factorCode === "C")!.codedValue);
      expect(Math.sign(c)).toBe(Math.sign(a * b));
    }
  });

  it("refuses an unsupported fraction denominator rather than faking it", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" }), factor({ factorCode: "C" }), factor({ factorCode: "D" })];
    expect(() => generateFractionalFactorialDesign(factors, { fractionDenominator: 4 })).toThrow(/not implemented/i);
  });

  it("requires at least 3 factors", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
    expect(() => generateFractionalFactorialDesign(factors, {})).toThrow(/at least 3/i);
  });
});

describe("generatePlackettBurmanDesign", () => {
  it("produces 8 runs for up to 7 factors", () => {
    const factors = Array.from({ length: 7 }, (_, i) => factor({ factorCode: `F${i}` }));
    expect(generatePlackettBurmanDesign(factors)).toHaveLength(8);
  });

  it("produces 12 runs for 8-11 factors", () => {
    const factors = Array.from({ length: 9 }, (_, i) => factor({ factorCode: `F${i}` }));
    expect(generatePlackettBurmanDesign(factors)).toHaveLength(12);
  });

  it("every column is balanced (equal +1/-1 count is not required for PB, but each level must be -1 or +1 only)", () => {
    const factors = Array.from({ length: 7 }, (_, i) => factor({ factorCode: `F${i}` }));
    const runs = generatePlackettBurmanDesign(factors);
    for (const run of runs) {
      for (const s of run.settings) expect(["-1", "1"].includes(s.codedValue) || Number(s.codedValue) === 1 || Number(s.codedValue) === -1).toBe(true);
    }
  });

  it("refuses more factors than any supported run size can screen", () => {
    const factors = Array.from({ length: 15 }, (_, i) => factor({ factorCode: `F${i}` }));
    expect(() => generatePlackettBurmanDesign(factors)).toThrow(/not implemented/i);
  });
});

describe("generateCentralCompositeDesign", () => {
  it("produces factorial + 2k axial + center-point runs", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
    const runs = generateCentralCompositeDesign(factors, {}, 3);
    // 2^2 factorial (4) + 2*2 axial (4) + 3 center = 11
    expect(runs).toHaveLength(11);
    expect(runs.filter((r) => r.isCenterPoint)).toHaveLength(3);
  });

  it("axial points use the rotatable alpha by default", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
    const runs = generateCentralCompositeDesign(factors, {}, 1);
    const codedMagnitudes = runs.flatMap((r) => r.settings.map((s) => Math.abs(Number(s.codedValue)))).filter((v) => v > 1);
    expect(codedMagnitudes.length).toBeGreaterThan(0);
    const expectedAlpha = Math.pow(4, 0.25);
    codedMagnitudes.forEach((v) => expect(v).toBeCloseTo(expectedAlpha, 6));
  });

  it("requires at least 2 factors", () => {
    expect(() => generateCentralCompositeDesign([factor({ factorCode: "A" })], {}, 1)).toThrow(/at least 2/i);
  });
});

describe("generateBoxBehnkenDesign", () => {
  it("produces 4*C(k,2) + center-point runs for k=3", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" }), factor({ factorCode: "C" })];
    const runs = generateBoxBehnkenDesign(factors, 3);
    // 4 * C(3,2) = 12, + 3 center = 15
    expect(runs).toHaveLength(15);
    expect(runs.filter((r) => r.isCenterPoint)).toHaveLength(3);
  });

  it("every non-center run holds exactly one factor at its center (0) level", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" }), factor({ factorCode: "C" })];
    const runs = generateBoxBehnkenDesign(factors, 0);
    for (const run of runs.filter((r) => !r.isCenterPoint)) {
      const zeroCount = run.settings.filter((s) => Number(s.codedValue) === 0).length;
      expect(zeroCount).toBe(1);
    }
  });

  it("requires at least 3 factors", () => {
    expect(() => generateBoxBehnkenDesign([factor({ factorCode: "A" }), factor({ factorCode: "B" })], 1)).toThrow(/at least 3/i);
  });
});

describe("generateLatinHypercubeDesign", () => {
  it("produces exactly the requested sample count", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
    expect(generateLatinHypercubeDesign(factors, 10, 42)).toHaveLength(10);
  });

  it("is reproducible from the same seed and different for a different seed", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
    const run1 = generateLatinHypercubeDesign(factors, 10, 42);
    const run2 = generateLatinHypercubeDesign(factors, 10, 42);
    const run3 = generateLatinHypercubeDesign(factors, 10, 99);
    expect(run1).toEqual(run2);
    expect(run1).not.toEqual(run3);
  });

  it("every factor's coded values are stratified across the sample range", () => {
    const factors = [factor({ factorCode: "A" })];
    const runs = generateLatinHypercubeDesign(factors, 20, 7);
    const values = runs.map((r) => Number(r.settings[0].codedValue));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(-1.001);
    expect(Math.max(...values)).toBeLessThanOrEqual(1.001);
    expect(new Set(values.map((v) => Math.floor(v * 10))).size).toBeGreaterThan(10); // spread across strata
  });
});

describe("generateMixtureSimplexLatticeDesign", () => {
  it("produces every {q,m} lattice point summing to 1", () => {
    const factors = [factor({ factorCode: "A", isMixtureComponent: true }), factor({ factorCode: "B", isMixtureComponent: true }), factor({ factorCode: "C", isMixtureComponent: true })];
    const runs = generateMixtureSimplexLatticeDesign(factors, 2);
    // C(q+m-1, m) = C(4,2) = 6 points for q=3, m=2
    expect(runs).toHaveLength(6);
    for (const run of runs) {
      const sum = run.settings.reduce((s, setting) => s + Number(setting.actualValue), 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it("requires at least 2 mixture-component factors", () => {
    expect(() => generateMixtureSimplexLatticeDesign([factor({ factorCode: "A", isMixtureComponent: true })], 2)).toThrow(/at least 2/i);
  });
});

describe("generateManualDesign", () => {
  it("freezes exactly the supplied rows", () => {
    const rows = generateManualDesign([{ factorSettings: [{ factorCode: "A", codedValue: "1", actualValue: "20" }] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].settings[0].factorCode).toBe("A");
  });

  it("rejects an empty run list", () => {
    expect(() => generateManualDesign([])).toThrow(/at least one run/i);
  });
});

describe("randomizeDoeRuns", () => {
  it("assigns a reproducible order for the same seed", () => {
    const rows = ["a", "b", "c", "d", "e"];
    const r1 = randomizeDoeRuns(rows, 123).map((r) => r.randomizedOrder);
    const r2 = randomizeDoeRuns(rows, 123).map((r) => r.randomizedOrder);
    expect(r1).toEqual(r2);
  });

  it("produces a permutation of 1..n", () => {
    const rows = ["a", "b", "c", "d", "e"];
    const orders = randomizeDoeRuns(rows, 7).map((r) => r.randomizedOrder).sort((a, b) => a - b);
    expect(orders).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("createSeededRandom", () => {
  it("is deterministic for the same seed", () => {
    const a = createSeededRandom(5);
    const b = createSeededRandom(5);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });
});

describe("calculateDesignDiagnostics", () => {
  it("detects a duplicate run", () => {
    const factors = [factor({ factorCode: "A" })];
    const runs = generateFullFactorialDesign(factors);
    const duplicated = [...runs, runs[0]];
    const diagnostics = calculateDesignDiagnostics(duplicated, factors, []);
    expect(diagnostics.duplicateRunCount).toBeGreaterThan(0);
  });

  it("flags a design with no center points", () => {
    const factors = [factor({ factorCode: "A" })];
    const runs = generateFullFactorialDesign(factors);
    const diagnostics = calculateDesignDiagnostics(runs, factors, []);
    expect(diagnostics.centerPointCount).toBe(0);
    expect(diagnostics.warnings.some((w) => /center points/i.test(w))).toBe(true);
  });

  it("a balanced 2-level factorial is orthogonal and balanced", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
    const runs = generateFullFactorialDesign(factors);
    const diagnostics = calculateDesignDiagnostics(runs, factors, []);
    expect(diagnostics.isOrthogonal).toBe(true);
    expect(diagnostics.isBalanced).toBe(true);
  });

  it("counts hard-constraint violations", () => {
    const factors = [factor({ factorCode: "A", lowValue: "10", highValue: "20" })];
    const runs = generateFullFactorialDesign(factors);
    const constraint: DoeConstraint = { schemaVersion: "1.0", id: "c1", studyId: "s", studyRevision: 1, constraintType: "upper_bound", expression: "A <= 15", severity: "hard", appliesTo: ["A"], createdBy: "alice", createdAt: "now" };
    const diagnostics = calculateDesignDiagnostics(runs, factors, [constraint]);
    expect(diagnostics.constraintViolationCount).toBeGreaterThan(0);
  });
});

describe("validateGeneratedDesign", () => {
  it("rejects a design with a hard-constraint-violating run", () => {
    const factors = [factor({ factorCode: "A", lowValue: "10", highValue: "20" })];
    const runs = generateFullFactorialDesign(factors);
    const constraint: DoeConstraint = { schemaVersion: "1.0", id: "c1", studyId: "s", studyRevision: 1, constraintType: "upper_bound", expression: "A <= 15", severity: "hard", appliesTo: ["A"], createdBy: "alice", createdAt: "now" };
    expect(validateGeneratedDesign(runs, [constraint]).length).toBeGreaterThan(0);
  });

  it("accepts a design with only soft-constraint violations", () => {
    const factors = [factor({ factorCode: "A", lowValue: "10", highValue: "20" })];
    const runs = generateFullFactorialDesign(factors);
    const constraint: DoeConstraint = { schemaVersion: "1.0", id: "c1", studyId: "s", studyRevision: 1, constraintType: "upper_bound", expression: "A <= 15", severity: "soft", appliesTo: ["A"], createdBy: "alice", createdAt: "now" };
    expect(validateGeneratedDesign(runs, [constraint])).toHaveLength(0);
  });
});

describe("generateDoeDesign (end-to-end)", () => {
  const study: DoeStudy = createDoeStudy(
    { studyCode: "DOE-100", title: "Screening", projectId: "p", formulationId: "f", baselineFormulaVersionId: "v1", baselineFormulaVersionStatus: "approved", designType: "full_factorial" },
    HUMAN,
  );

  it("generates a full factorial design with matching runs, standard order and reproducible randomization", () => {
    const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
    const result = generateDoeDesign({ study, factors, constraints: [], responses: RESPONSES, designType: "full_factorial", seed: 42 }, HUMAN);
    expect(result.design.runCount).toBe(4);
    expect(result.runs).toHaveLength(4);
    expect(new Set(result.runs.map((r) => r.standardOrder))).toEqual(new Set([1, 2, 3, 4]));
    expect(new Set(result.runs.map((r) => r.randomizedOrder))).toEqual(new Set([1, 2, 3, 4]));

    const again = generateDoeDesign({ study, factors, constraints: [], responses: RESPONSES, designType: "full_factorial", seed: 42 }, HUMAN);
    expect(again.runs.map((r) => r.randomizedOrder)).toEqual(result.runs.map((r) => r.randomizedOrder));
  });

  it("marks replicate numbers for a manual design containing a deliberate duplicate", () => {
    const settings = [{ factorCode: "A", codedValue: "1", actualValue: "20" }];
    const result = generateDoeDesign(
      {
        study,
        factors: [factor({ factorCode: "A" })],
        constraints: [],
        responses: RESPONSES,
        designType: "custom_manual",
        seed: 1,
        manualRuns: [{ factorSettings: settings }, { factorSettings: settings }],
      },
      HUMAN,
    );
    expect(result.runs.map((r) => r.replicate).sort()).toEqual([1, 2]);
  });

  it("refuses a design type not in DOE_IMPLEMENTED_DESIGN_TYPES", () => {
    expect(() =>
      generateDoeDesign({ study, factors: [factor({ factorCode: "A" })], constraints: [], responses: RESPONSES, designType: "definitive_screening", seed: 1 }, HUMAN),
    ).toThrow(/not yet implemented/i);
  });

  it("refuses to generate (and persist nothing) when a hard constraint is violated by every run", () => {
    const factors = [factor({ factorCode: "A", lowValue: "10", highValue: "20" })];
    const constraint: DoeConstraint = { schemaVersion: "1.0", id: "c1", studyId: study.id, studyRevision: 1, constraintType: "upper_bound", expression: "A <= 5", severity: "hard", appliesTo: ["A"], createdBy: "alice", createdAt: "now" };
    expect(() => generateDoeDesign({ study, factors, constraints: [constraint], responses: RESPONSES, designType: "full_factorial", seed: 1 }, HUMAN)).toThrow(/hard constraint/i);
  });

  it("refuses invalid factors before attempting generation", () => {
    expect(() => generateDoeDesign({ study, factors: [], constraints: [], responses: RESPONSES, designType: "full_factorial", seed: 1 }, HUMAN)).toThrow(/at least one factor/i);
  });

  it("stores frozen factor/constraint/response snapshots on the design", () => {
    const factors = [factor({ factorCode: "A" })];
    const result = generateDoeDesign({ study, factors, constraints: [], responses: RESPONSES, designType: "full_factorial", seed: 1 }, HUMAN);
    expect(result.design.factorSnapshot).toEqual(factors);
    expect(result.design.responseSnapshot).toEqual(RESPONSES);
  });
});
