import { describe, expect, it } from "vitest";
import {
  MIN_PROJECTION_POINTS,
  canTransitionStability,
  computeSampleDueState,
  computeStabilityTrend,
  generateStabilitySamples,
  hasOpenCriticalFailure,
  resolveStabilityFailure,
} from "./stability";
import type { Actor } from "../schemas/status";
import type { StabilityCondition, StabilityFailure, StabilityResult, StabilityStudy, StabilityTimePoint } from "../schemas/stability";
import type { TestDefinition } from "../schemas/testDefinitions";

const HUMAN: Actor = { kind: "human", role: "chemist", userId: "alice" };
const AGENT: Actor = { kind: "agent", runId: "run-1" };

describe("canTransitionStability", () => {
  it("allows a documented transition", () => {
    expect(canTransitionStability("planned", "active", HUMAN).allowed).toBe(true);
  });

  it("rejects an undocumented transition", () => {
    expect(canTransitionStability("planned", "completed", HUMAN).allowed).toBe(false);
  });

  it("refuses to let an agent complete a study", () => {
    const r = canTransitionStability("active", "completed", AGENT);
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("REQUIRES_HUMAN");
  });

  it("blocks completion while a critical failure is open", () => {
    const failure: StabilityFailure = {
      schemaVersion: "1.0", id: "f1", studyId: "s1", sampleId: "samp1", conditionId: "c1", timePointId: "tp1",
      type: "out_of_specification", severity: "critical", description: "pH drifted out of spec.",
      investigationStatus: "open", correctiveActionIds: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const r = canTransitionStability("active", "completed", HUMAN, { openCriticalFailures: [failure] });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("OPEN_CRITICAL_FAILURE");
  });
});

describe("resolveStabilityFailure / hasOpenCriticalFailure", () => {
  function failure(over: Partial<StabilityFailure> = {}): StabilityFailure {
    return {
      schemaVersion: "1.0", id: "f1", studyId: "s1", sampleId: "samp1", conditionId: "c1", timePointId: "tp1",
      type: "out_of_specification", severity: "critical", description: "pH drifted.",
      investigationStatus: "open", correctiveActionIds: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      ...over,
    };
  }

  it("only a human may resolve a failure", () => {
    expect(() => resolveStabilityFailure(failure(), AGENT, "Root cause fixed.")).toThrow();
    const resolved = resolveStabilityFailure(failure(), HUMAN, "Root cause fixed.");
    expect(resolved.investigationStatus).toBe("closed");
    expect(resolved.resolvedBy).toBe("alice");
  });

  it("hasOpenCriticalFailure is false once closed", () => {
    expect(hasOpenCriticalFailure([failure()])).toBe(true);
    expect(hasOpenCriticalFailure([failure({ investigationStatus: "closed" })])).toBe(false);
  });
});

const CONDITIONS: StabilityCondition[] = [
  { schemaVersion: "1.0", id: "c25", code: "25C", label: "25C", verificationStatus: "not_verified", active: true, lightCondition: "none", orientation: "not_applicable" },
  { schemaVersion: "1.0", id: "c40", code: "40C", label: "40C", verificationStatus: "not_verified", active: true, lightCondition: "none", orientation: "not_applicable" },
];
const TIME_POINTS: StabilityTimePoint[] = [
  { schemaVersion: "1.0", id: "tp0", code: "INITIAL", label: "Initial", daysFromStart: 0, custom: false },
  { schemaVersion: "1.0", id: "tp30", code: "1MO", label: "1 month", daysFromStart: 30, custom: false },
];

function study(over: Partial<StabilityStudy> = {}): StabilityStudy {
  return {
    schemaVersion: "1.0",
    id: "study-1",
    code: "STUDY-1",
    projectId: "proj-1",
    sourceType: "working_draft",
    sourceDraftId: "proj-1",
    formulaSnapshot: { lines: [], basisBatchKg: "100", capturedAt: "2026-01-01T00:00:00.000Z" },
    productFamilyId: "fam-1",
    packagingSkuCode: "SKU-1",
    packagingSnapshot: { skuCode: "SKU-1", lines: [], capturedAt: "2026-01-01T00:00:00.000Z" },
    title: "Study 1",
    owner: "alice",
    status: "planned",
    startDate: "2026-01-01T00:00:00.000Z",
    conditionIds: ["c25", "c40"],
    timePointIds: ["tp0", "tp30"],
    requiredTestDefinitionIds: ["def-ph"],
    replicatesPerPullPoint: 2,
    hasOpenCriticalFailure: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "local",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("generateStabilitySamples", () => {
  it("generates condition x timePoint x replicate samples", () => {
    const samples = generateStabilitySamples(study(), CONDITIONS, TIME_POINTS);
    expect(samples).toHaveLength(2 * 2 * 2); // 2 conditions x 2 time points x 2 replicates
    expect(new Set(samples.map((s) => s.sampleCode)).size).toBe(samples.length); // unique codes
  });

  it("computes a deterministic due date from startDate + daysFromStart", () => {
    const samples = generateStabilitySamples(study(), CONDITIONS, [TIME_POINTS[1]]);
    const due = new Date(samples[0].dueDate!);
    expect(due.getUTCDate()).toBe(31); // Jan 1 + 30 days = Jan 31
  });

  it("throws without a startDate — due dates cannot be computed", () => {
    expect(() => generateStabilitySamples(study({ startDate: undefined }), CONDITIONS, TIME_POINTS)).toThrow();
  });

  it("stamps every sample with the study's own fixed packaging SKU", () => {
    const samples = generateStabilitySamples(study(), CONDITIONS, TIME_POINTS);
    expect(samples.every((s) => s.packagingSkuCode === "SKU-1")).toBe(true);
  });
});

describe("computeSampleDueState", () => {
  it("is unchanged before the due date", () => {
    const state = computeSampleDueState({ schemaVersion: "1.0", id: "s1", sampleCode: "S1", studyId: "study-1", conditionId: "c1", timePointId: "tp1", packagingSkuCode: "SKU-1", replicateNumber: 1, status: "planned", dueDate: "2099-01-01T00:00:00.000Z", testDefinitionIds: [], createdAt: "2026-01-01T00:00:00.000Z" }, new Date("2026-01-01T00:00:00.000Z"));
    expect(state).toBe("unchanged");
  });

  it("is due on the due date and overdue after it", () => {
    const dueSample = { schemaVersion: "1.0" as const, id: "s1", sampleCode: "S1", studyId: "study-1", conditionId: "c1", timePointId: "tp1", packagingSkuCode: "SKU-1", replicateNumber: 1, status: "planned" as const, dueDate: "2026-01-15T00:00:00.000Z", testDefinitionIds: [], createdAt: "2026-01-01T00:00:00.000Z" };
    expect(computeSampleDueState(dueSample, new Date("2026-01-15T12:00:00.000Z"))).toBe("due");
    expect(computeSampleDueState(dueSample, new Date("2026-01-20T00:00:00.000Z"))).toBe("overdue");
  });

  it("does not change state for a sample already tested or disposed", () => {
    const completed = { schemaVersion: "1.0" as const, id: "s1", sampleCode: "S1", studyId: "study-1", conditionId: "c1", timePointId: "tp1", packagingSkuCode: "SKU-1", replicateNumber: 1, status: "completed" as const, dueDate: "2020-01-01T00:00:00.000Z", testDefinitionIds: [], createdAt: "2026-01-01T00:00:00.000Z" };
    expect(computeSampleDueState(completed, new Date("2026-01-01T00:00:00.000Z"))).toBe("unchanged");
  });
});

const DEF_PH: TestDefinition = {
  schemaVersion: "1.0", code: "TEST-PH", name: "pH", category: "physical_chemical", resultType: "numeric",
  minimum: "6", maximum: "8", replicatesRequired: 1, requiredEquipment: [], requiredAttachment: false,
  applicableProductFamilies: [], applicableProductSkus: [], criticalTestFlag: false, verificationStatus: "not_verified",
  active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

function stabResult(mean: string): StabilityResult {
  return {
    schemaVersion: "1.0", id: `r-${mean}`, studyId: "study-1", sampleId: "samp-1", conditionId: "c25", timePointId: "tp0",
    testDefinitionId: "def-ph", resultType: "numeric", replicates: [], attachments: [], stats: { count: 1, mean }, passFail: "pass",
    performedBy: "alice", performedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("computeStabilityTrend", () => {
  it("computes absolute/percentage change from initial and rate of change", () => {
    const trend = computeStabilityTrend({
      studyId: "study-1",
      conditionId: "c25",
      testDefinitionId: "def-ph",
      definition: DEF_PH,
      resultsByTimePoint: [
        { timePoint: TIME_POINTS[0], result: stabResult("7.0") },
        { timePoint: TIME_POINTS[1], result: stabResult("6.5") },
      ],
    });
    expect(trend.absoluteChangeFromInitial).toBe("-0.500000");
    expect(trend.percentageChangeFromInitial).toBeDefined();
    expect(trend.ratePerDay).toBeDefined();
  });

  it("detects a limit crossing against the test definition's own bounds", () => {
    const trend = computeStabilityTrend({
      studyId: "study-1",
      conditionId: "c25",
      testDefinitionId: "def-ph",
      definition: DEF_PH,
      resultsByTimePoint: [
        { timePoint: TIME_POINTS[0], result: stabResult("7.0") },
        { timePoint: TIME_POINTS[1], result: stabResult("5.0") }, // below minimum 6
      ],
    });
    expect(trend.limitCrossing?.direction).toBe("below_minimum");
  });

  it("never projects with fewer than the minimum required points", () => {
    const trend = computeStabilityTrend({
      studyId: "study-1",
      conditionId: "c25",
      testDefinitionId: "def-ph",
      definition: DEF_PH,
      resultsByTimePoint: [
        { timePoint: TIME_POINTS[0], result: stabResult("7.0") },
        { timePoint: TIME_POINTS[1], result: stabResult("6.9") },
      ],
    });
    expect(trend.projection).toBeUndefined();
  });

  it("offers a labeled projection once the minimum-data rule is met", () => {
    const points: { timePoint: typeof TIME_POINTS[number]; result: StabilityResult }[] = [
      { timePoint: { schemaVersion: "1.0", id: "tp0", code: "INITIAL", label: "Initial", daysFromStart: 0, custom: false }, result: stabResult("7.0") },
      { timePoint: { schemaVersion: "1.0", id: "tp15", code: "15D", label: "15 days", daysFromStart: 15, custom: false }, result: stabResult("6.8") },
      { timePoint: { schemaVersion: "1.0", id: "tp30", code: "1MO", label: "1 month", daysFromStart: 30, custom: false }, result: stabResult("6.6") },
    ];
    expect(points.length).toBeGreaterThanOrEqual(MIN_PROJECTION_POINTS);
    const trend = computeStabilityTrend({ studyId: "study-1", conditionId: "c25", testDefinitionId: "def-ph", definition: DEF_PH, resultsByTimePoint: points });
    expect(trend.projection?.label).toBe("experimental estimate — not validated — human review required");
    expect(trend.projection?.estimatedDaysToLimit).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const input = {
      studyId: "study-1", conditionId: "c25", testDefinitionId: "def-ph", definition: DEF_PH,
      resultsByTimePoint: [{ timePoint: TIME_POINTS[0], result: stabResult("7.0") }, { timePoint: TIME_POINTS[1], result: stabResult("6.5") }],
    };
    const a = computeStabilityTrend(input);
    const b = computeStabilityTrend(input);
    expect(a.absoluteChangeFromInitial).toBe(b.absoluteChangeFromInitial);
    expect(a.ratePerDay).toBe(b.ratePerDay);
  });
});
