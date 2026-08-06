import { describe, expect, it } from "vitest";
import type { Actor } from "../schemas/status";
import type { DoeCandidate, DoeConstraint, DoeDesign, DoeFactor, DoeResponse } from "../schemas/doe";
import {
  applyDoeCandidateToDraft,
  calculateOverallDesirability,
  calculateResponseDesirability,
  createDoeCandidates,
  rankDoeCandidates,
  searchDoeCandidateSpace,
  validateDoeCandidate,
  type AnalysisForPrediction,
} from "./doeCandidates";

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

function response(overrides: Partial<DoeResponse> = {}): DoeResponse {
  return {
    schemaVersion: "1.0",
    id: overrides.id ?? "response-1",
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

describe("calculateResponseDesirability", () => {
  it("maximize: 0 at/below lower limit, 1 at/above upper limit, linear between", () => {
    const r = response({ objective: "maximize", lowerLimit: "0", upperLimit: "10" });
    expect(calculateResponseDesirability(r, -5)).toBe(0);
    expect(calculateResponseDesirability(r, 0)).toBe(0);
    expect(calculateResponseDesirability(r, 10)).toBe(1);
    expect(calculateResponseDesirability(r, 15)).toBe(1);
    expect(calculateResponseDesirability(r, 5)).toBeCloseTo(0.5, 6);
  });

  it("minimize is the mirror of maximize", () => {
    const r = response({ objective: "minimize", lowerLimit: "0", upperLimit: "10" });
    expect(calculateResponseDesirability(r, 0)).toBe(1);
    expect(calculateResponseDesirability(r, 10)).toBe(0);
    expect(calculateResponseDesirability(r, 5)).toBeCloseTo(0.5, 6);
  });

  it("target: 1 exactly at target, 0 outside the tolerance band, triangular between", () => {
    const r = response({ objective: "target", lowerLimit: "0", targetValue: "5", upperLimit: "10" });
    expect(calculateResponseDesirability(r, 5)).toBe(1);
    expect(calculateResponseDesirability(r, 0)).toBe(0);
    expect(calculateResponseDesirability(r, 10)).toBe(0);
    expect(calculateResponseDesirability(r, 2.5)).toBeCloseTo(0.5, 6);
    expect(calculateResponseDesirability(r, 7.5)).toBeCloseTo(0.5, 6);
  });

  it("within_range: 1 inside inclusive bounds, 0 outside, no tapering", () => {
    const r = response({ objective: "within_range", lowerLimit: "4", upperLimit: "6" });
    expect(calculateResponseDesirability(r, 5)).toBe(1);
    expect(calculateResponseDesirability(r, 4)).toBe(1);
    expect(calculateResponseDesirability(r, 6)).toBe(1);
    expect(calculateResponseDesirability(r, 6.1)).toBe(0);
  });

  it("observe_only is always fully desirable", () => {
    const r = response({ objective: "observe_only" });
    expect(calculateResponseDesirability(r, -1000)).toBe(1);
    expect(calculateResponseDesirability(r, 1000)).toBe(1);
  });

  it("concave/convex shapes bend the linear ramp as expected", () => {
    const linear = response({ objective: "maximize", lowerLimit: "0", upperLimit: "10", desirabilityShape: "linear" });
    const concave = response({ objective: "maximize", lowerLimit: "0", upperLimit: "10", desirabilityShape: "concave" });
    const convex = response({ objective: "maximize", lowerLimit: "0", upperLimit: "10", desirabilityShape: "convex" });
    expect(calculateResponseDesirability(concave, 2.5)).toBeGreaterThan(calculateResponseDesirability(linear, 2.5));
    expect(calculateResponseDesirability(convex, 2.5)).toBeLessThan(calculateResponseDesirability(linear, 2.5));
  });
});

describe("calculateOverallDesirability", () => {
  it("computes the weighted geometric mean across responses", () => {
    const r1 = response({ id: "r1", objective: "maximize", lowerLimit: "0", upperLimit: "10", weight: "1" });
    const r2 = response({ id: "r2", objective: "maximize", lowerLimit: "0", upperLimit: "10", weight: "1" });
    const predicted = new Map([["r1", 10], ["r2", 10]]);
    expect(calculateOverallDesirability([r1, r2], predicted)).toBeCloseTo(1, 6);
  });

  it("any response scoring 0 sinks the overall desirability to 0", () => {
    const r1 = response({ id: "r1", objective: "maximize", lowerLimit: "0", upperLimit: "10" });
    const r2 = response({ id: "r2", objective: "within_range", lowerLimit: "4", upperLimit: "6" });
    const predicted = new Map([["r1", 10], ["r2", 100]]); // r2 way outside range -> 0
    expect(calculateOverallDesirability([r1, r2], predicted)).toBe(0);
  });

  it("ignores observe_only responses in the weighting", () => {
    const r1 = response({ id: "r1", objective: "maximize", lowerLimit: "0", upperLimit: "10" });
    const r2 = response({ id: "r2", objective: "observe_only" });
    const predicted = new Map([["r1", 10], ["r2", -99999]]);
    expect(calculateOverallDesirability([r1, r2], predicted)).toBeCloseTo(1, 6);
  });

  it("a heavier weight pulls the geometric mean toward that response's score", () => {
    // r1 is perfect (d=1), r2 is nearly worst (d=0.0001, not exactly 0 so the
    // hard-zero rule doesn't just force the whole thing to 0). Weighting r1
    // ten times more heavily should pull the overall score up compared to
    // weighting both responses equally.
    const predicted = new Map([["r1", 10], ["r2", 0.001]]);
    const equalWeight = calculateOverallDesirability(
      [response({ id: "r1", objective: "maximize", lowerLimit: "0", upperLimit: "10", weight: "1" }), response({ id: "r2", objective: "maximize", lowerLimit: "0", upperLimit: "10", weight: "1" })],
      predicted,
    );
    const heavyWeightOnR1 = calculateOverallDesirability(
      [response({ id: "r1", objective: "maximize", lowerLimit: "0", upperLimit: "10", weight: "10" }), response({ id: "r2", objective: "maximize", lowerLimit: "0", upperLimit: "10", weight: "1" })],
      predicted,
    );
    expect(heavyWeightOnR1).toBeGreaterThan(equalWeight);
  });
});

describe("searchDoeCandidateSpace", () => {
  const factors = [factor({ factorCode: "A" }), factor({ factorCode: "B" })];
  const response1 = response({ id: "r1", objective: "maximize", lowerLimit: "10", upperLimit: "20" });
  const analyses: AnalysisForPrediction[] = [
    { responseId: "r1", analysisId: "analysis-1", terms: ["intercept", "A", "B"], coefficients: [15, 2, 1], observedCodedRanges: { A: { min: -1, max: 1 }, B: { min: -1, max: 1 } } },
  ];

  it("is reproducible for the same seed", () => {
    const input = { factors, constraints: [], responses: [response1], analyses, seed: 42, candidateCount: 20 };
    const first = searchDoeCandidateSpace(input);
    const second = searchDoeCandidateSpace(input);
    expect(first).toEqual(second);
  });

  it("produces a different set for a different seed", () => {
    const base = { factors, constraints: [], responses: [response1], analyses, candidateCount: 20 };
    const a = searchDoeCandidateSpace({ ...base, seed: 1 });
    const b = searchDoeCandidateSpace({ ...base, seed: 2 });
    expect(a).not.toEqual(b);
  });

  it("keeps every non-mixture numeric factor's coded value within the design's [-1, 1] space", () => {
    const results = searchDoeCandidateSpace({ factors, constraints: [], responses: [response1], analyses, seed: 5, candidateCount: 50 });
    for (const c of results) {
      for (const s of c.factorSettings) {
        expect(Number(s.codedValue)).toBeGreaterThanOrEqual(-1);
        expect(Number(s.codedValue)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("drops every candidate that violates a hard constraint", () => {
    const constraint: DoeConstraint = { schemaVersion: "1.0", id: "c1", studyId: "s", studyRevision: 1, constraintType: "upper_bound", expression: "A <= -0.99", severity: "hard", appliesTo: ["A"], createdBy: "alice", createdAt: "now" };
    const results = searchDoeCandidateSpace({ factors, constraints: [constraint], responses: [response1], analyses, seed: 5, candidateCount: 50 });
    for (const c of results) {
      const aValue = Number(c.factorSettings.find((s) => s.factorCode === "A")!.codedValue);
      expect(aValue).toBeLessThanOrEqual(-0.99 + 1e-6);
    }
  });

  it("mixture-component candidates always sum to exactly 1 (before per-factor rounding)", () => {
    const mixtureFactors = [factor({ factorCode: "X", isMixtureComponent: true }), factor({ factorCode: "Y", isMixtureComponent: true }), factor({ factorCode: "Z", isMixtureComponent: true })];
    const results = searchDoeCandidateSpace({ factors: mixtureFactors, constraints: [], responses: [], analyses: [], seed: 3, candidateCount: 30 });
    for (const c of results) {
      // codedValue carries the exact, unrounded fraction; actualValue is
      // rounded to the factor's display precision and so may drift slightly.
      const codedSum = c.factorSettings.reduce((s, setting) => s + Number(setting.codedValue), 0);
      expect(codedSum).toBeCloseTo(1, 6);
      const actualSum = c.factorSettings.reduce((s, setting) => s + Number(setting.actualValue), 0);
      expect(Math.abs(actualSum - 1)).toBeLessThan(0.05);
    }
  });

  it("every prediction cites the analysis it came from", () => {
    const results = searchDoeCandidateSpace({ factors, constraints: [], responses: [response1], analyses, seed: 9, candidateCount: 5 });
    for (const c of results) {
      for (const p of c.predictedResponses) expect(p.analysisId).toBe("analysis-1");
    }
  });
});

describe("rankDoeCandidates", () => {
  it("sorts descending by desirability and assigns sequential ranks", () => {
    const raw = [
      { factorSettings: [], predictedResponses: [], desirability: 0.5, constraintStatus: [] },
      { factorSettings: [], predictedResponses: [], desirability: 0.9, constraintStatus: [] },
      { factorSettings: [], predictedResponses: [], desirability: 0.1, constraintStatus: [] },
    ];
    const ranked = rankDoeCandidates(raw);
    expect(ranked.map((c) => c.desirability)).toEqual([0.9, 0.5, 0.1]);
    expect(ranked.map((c) => c.rank)).toEqual([1, 2, 3]);
  });
});

describe("validateDoeCandidate", () => {
  it("is invalid when a hard constraint is unsatisfied", () => {
    const result = validateDoeCandidate({ constraintStatus: [{ constraintId: "c1", satisfied: false, severity: "hard" }] });
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
  });

  it("is valid when only soft constraints are unsatisfied", () => {
    const result = validateDoeCandidate({ constraintStatus: [{ constraintId: "c1", satisfied: false, severity: "soft" }] });
    expect(result.valid).toBe(true);
  });
});

describe("createDoeCandidates", () => {
  it("persists ranked candidates as proposed DoeCandidate records", () => {
    const ranked = [{ factorSettings: [], predictedResponses: [], desirability: 0.8, constraintStatus: [], rank: 1 }];
    const candidates = createDoeCandidates({ studyId: "study-1", studyRevision: 1, analysisIds: ["analysis-1"], ranked }, HUMAN);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].status).toBe("proposed");
    expect(candidates[0].rank).toBe(1);
    expect(candidates[0].createdBy).toBe("alice");
  });

  it("refuses a non-human actor", () => {
    const ranked = [{ factorSettings: [], predictedResponses: [], desirability: 0.8, constraintStatus: [], rank: 1 }];
    expect(() => createDoeCandidates({ studyId: "study-1", studyRevision: 1, analysisIds: [], ranked }, { kind: "import" } as Actor)).toThrow();
  });
});

describe("applyDoeCandidateToDraft", () => {
  it("maps formula_material factors to material quantities and other factors to process settings", () => {
    const factors = [
      factor({ factorCode: "SLES", sourceType: "formula_material", sourceEntityId: "material-sles" }),
      factor({ factorCode: "MixSpeed", sourceType: "mixing_speed", sourceEntityId: "mixing_speed", unit: "rpm" }),
      factor({ factorCode: "Total", sourceType: "formula_total" }),
    ];
    const candidate: DoeCandidate = {
      schemaVersion: "1.0",
      id: "candidate-1",
      studyId: "study-1",
      studyRevision: 1,
      analysisIds: ["analysis-1"],
      factorSettings: [
        { factorCode: "SLES", codedValue: "1", actualValue: "12.5" },
        { factorCode: "MixSpeed", codedValue: "0.5", actualValue: "450" },
        { factorCode: "Total", codedValue: "0", actualValue: "100" },
      ],
      predictedResponses: [],
      desirability: 0.9,
      constraintStatus: [],
      rank: 1,
      status: "proposed",
      createdBy: "alice",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const design: DoeDesign = { id: "design-1" } as DoeDesign;
    const application = applyDoeCandidateToDraft(candidate, factors, design);
    expect(application.materialQuantities).toEqual([{ materialId: "material-sles", quantity: "12.5" }]);
    expect(application.processSettings).toEqual([{ key: "mixing_speed", value: "450", unit: "rpm" }]);
    expect(application.lineage).toEqual({ candidateId: "candidate-1", analysisIds: ["analysis-1"], studyId: "study-1", designId: "design-1" });
  });
});
