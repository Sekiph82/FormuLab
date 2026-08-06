import { describe, expect, it } from "vitest";
import { deriveLabReadiness, derivePackagingCompatibilityReadiness, deriveStabilityReadiness } from "./approvalDerivation";
import type { CorrectiveAction } from "../schemas/correctiveActions";
import type { LaboratoryTrial, TrialDeviation } from "../schemas/laboratory";
import type { StabilityFailure, StabilityResult, StabilitySample, StabilityStudy, StabilityTimePoint } from "../schemas/stability";
import type { TestDefinition, TestResult } from "../schemas/testDefinitions";

const NOW = "2026-01-01T00:00:00.000Z";

function trial(over: Partial<LaboratoryTrial> = {}): LaboratoryTrial {
  return {
    schemaVersion: "1.0",
    id: "trial-1",
    code: "TRIAL-1",
    projectId: "proj-1",
    sourceType: "saved_version",
    sourceFormulaVersionId: "version-1",
    formulaSnapshot: { lines: [], basisBatchKg: "100", capturedAt: NOW },
    productFamilyId: "fam-1",
    targetPackagingSkuIds: [],
    equipmentIds: [],
    title: "Trial 1",
    batchSize: "100",
    batchUnit: "kg",
    status: "completed",
    priority: "normal",
    materialUsage: [],
    processSteps: [],
    observations: [],
    hasOpenCriticalDeviation: false,
    createdAt: NOW,
    createdBy: "local",
    updatedAt: NOW,
    ...over,
  };
}

function testDef(over: Partial<TestDefinition> = {}): TestDefinition {
  return {
    schemaVersion: "1.0",
    code: "TEST-PH",
    name: "pH",
    category: "physical_chemical",
    resultType: "numeric",
    replicatesRequired: 1,
    requiredEquipment: [],
    requiredAttachment: false,
    applicableProductFamilies: [],
    applicableProductSkus: [],
    requiredByDefault: true,
    criticalTestFlag: false,
    verificationStatus: "not_verified",
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function testResult(over: Partial<TestResult> = {}): TestResult {
  return {
    schemaVersion: "1.0",
    id: "result-1",
    trialId: "trial-1",
    testDefinitionId: "TEST-PH",
    resultType: "numeric",
    replicates: [],
    passFail: "pass",
    attachments: [],
    performedBy: "alice",
    performedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function deviation(over: Partial<TrialDeviation> = {}): TrialDeviation {
  return {
    schemaVersion: "1.0",
    id: "dev-1",
    trialId: "trial-1",
    severity: "critical",
    status: "open",
    description: "Phase separation observed.",
    detectedBy: "alice",
    detectedAt: NOW,
    correctiveActionIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function correctiveAction(over: Partial<CorrectiveAction> = {}): CorrectiveAction {
  return {
    schemaVersion: "1.0",
    id: "ca-1",
    code: "CA-1",
    projectId: "proj-1",
    sourceType: "trial_deviation",
    sourceRecordId: "trial-1",
    deviationOrFailureId: "dev-1",
    title: "Fix phase separation",
    problemStatement: "Phase separated on standing.",
    actionType: "reformulation",
    owner: "alice",
    status: "open",
    auditHistory: [],
    createdAt: NOW,
    createdBy: "local",
    updatedAt: NOW,
    ...over,
  };
}

describe("deriveLabReadiness", () => {
  it("only a trial linked to the exact formula version satisfies hasCompletedTrial", () => {
    const wrongVersion = trial({ sourceFormulaVersionId: "version-2" });
    const readiness = deriveLabReadiness({
      policy: {},
      formulaVersionId: "version-1",
      trials: [wrongVersion],
      testDefinitions: [],
      testResults: [],
      deviations: [],
      correctiveActions: [],
    });
    expect(readiness.hasCompletedTrial).toBe(false);
  });

  it("hasCompletedTrial is true for a completed trial on the exact version", () => {
    const readiness = deriveLabReadiness({
      policy: {},
      formulaVersionId: "version-1",
      trials: [trial()],
      testDefinitions: [],
      testResults: [],
      deviations: [],
      correctiveActions: [],
    });
    expect(readiness.hasCompletedTrial).toBe(true);
  });

  it("an explicitly listed equivalent version can also satisfy hasCompletedTrial", () => {
    const equivalent = trial({ sourceFormulaVersionId: "version-old" });
    const readiness = deriveLabReadiness({
      policy: {},
      formulaVersionId: "version-1",
      trials: [equivalent],
      testDefinitions: [],
      testResults: [],
      deviations: [],
      correctiveActions: [],
      equivalentVersionIds: ["version-old"],
    });
    expect(readiness.hasCompletedTrial).toBe(true);
  });

  it("allRequiredTestsCompleted is false when a required test has no recorded result", () => {
    const readiness = deriveLabReadiness({
      policy: {},
      formulaVersionId: "version-1",
      trials: [trial()],
      testDefinitions: [testDef({ code: "TEST-PH", requiredByDefault: true })],
      testResults: [],
      deviations: [],
      correctiveActions: [],
    });
    expect(readiness.allRequiredTestsCompleted).toBe(false);
  });

  it("allRequiredTestsCompleted is true once every required test has a recorded result", () => {
    const readiness = deriveLabReadiness({
      policy: {},
      formulaVersionId: "version-1",
      trials: [trial()],
      testDefinitions: [testDef({ code: "TEST-PH", requiredByDefault: true })],
      testResults: [testResult({ testDefinitionId: "TEST-PH", passFail: "pass" })],
      deviations: [],
      correctiveActions: [],
    });
    expect(readiness.allRequiredTestsCompleted).toBe(true);
  });

  it("allCriticalTestsPassed is false when a critical test failed", () => {
    const readiness = deriveLabReadiness({
      policy: {},
      formulaVersionId: "version-1",
      trials: [trial()],
      testDefinitions: [testDef({ code: "TEST-MICRO", requiredByDefault: true, criticalTestFlag: true })],
      testResults: [testResult({ testDefinitionId: "TEST-MICRO", passFail: "fail" })],
      deviations: [],
      correctiveActions: [],
    });
    expect(readiness.allCriticalTestsPassed).toBe(false);
  });

  it("a trial's own testRequirementSnapshot governs even after a definition changes", () => {
    const snapshotted = trial({
      testRequirementSnapshot: {
        capturedAt: NOW,
        entries: [{ testDefinitionId: "TEST-PH", testDefinitionCode: "TEST-PH", name: "pH", testCapability: "general", criticalTestFlag: false, required: true, reason: "snapshotted" }],
      },
    });
    // The live definition now says NOT required — the snapshot must win.
    const readiness = deriveLabReadiness({
      policy: {},
      formulaVersionId: "version-1",
      trials: [snapshotted],
      testDefinitions: [testDef({ code: "TEST-PH", requiredByDefault: false })],
      testResults: [],
      deviations: [],
      correctiveActions: [],
    });
    expect(readiness.allRequiredTestsCompleted).toBe(false);
  });

  it("hasUnresolvedCriticalDeviation is true for an open critical deviation on a relevant trial", () => {
    const readiness = deriveLabReadiness({
      policy: {},
      formulaVersionId: "version-1",
      trials: [trial()],
      testDefinitions: [],
      testResults: [],
      deviations: [deviation()],
      correctiveActions: [],
    });
    expect(readiness.hasUnresolvedCriticalDeviation).toBe(true);
  });

  it("hasUnresolvedCriticalCorrectiveAction is true while the linked corrective action is not effective", () => {
    const readiness = deriveLabReadiness({
      policy: {},
      formulaVersionId: "version-1",
      trials: [trial()],
      testDefinitions: [],
      testResults: [],
      deviations: [deviation()],
      correctiveActions: [correctiveAction()],
    });
    expect(readiness.hasUnresolvedCriticalCorrectiveAction).toBe(true);
  });

  it("hasUnresolvedCriticalCorrectiveAction is false once the corrective action is effective", () => {
    const readiness = deriveLabReadiness({
      policy: {},
      formulaVersionId: "version-1",
      trials: [trial()],
      testDefinitions: [],
      testResults: [],
      deviations: [deviation()],
      correctiveActions: [correctiveAction({ status: "effective" })],
    });
    expect(readiness.hasUnresolvedCriticalCorrectiveAction).toBe(false);
  });
});

function packagingTestDef(over: Partial<TestDefinition> = {}): TestDefinition {
  return testDef({
    code: "TEST-PACKAGING-COMPATIBILITY",
    name: "Packaging compatibility",
    testCapability: "packaging_compatibility",
    applicableContexts: ["stability"],
    ...over,
  });
}

function stabilityStudy(over: Partial<StabilityStudy> = {}): StabilityStudy {
  return {
    schemaVersion: "1.0",
    id: "study-1",
    code: "STUDY-1",
    projectId: "proj-1",
    sourceType: "saved_version",
    sourceFormulaVersionId: "version-1",
    formulaSnapshot: { lines: [], basisBatchKg: "100", capturedAt: NOW },
    productFamilyId: "fam-1",
    packagingSkuCode: "SKU-1",
    packagingSnapshot: { skuCode: "SKU-1", lines: [], capturedAt: NOW },
    title: "Study 1",
    owner: "alice",
    status: "active",
    conditionIds: [],
    timePointIds: [],
    requiredTestDefinitionIds: [],
    replicatesPerPullPoint: 1,
    hasOpenCriticalFailure: false,
    createdAt: NOW,
    createdBy: "local",
    updatedAt: NOW,
    ...over,
  };
}

function stabilityResult(over: Partial<StabilityResult> = {}): StabilityResult {
  return {
    schemaVersion: "1.0",
    id: "sresult-1",
    studyId: "study-1",
    sampleId: "sample-1",
    conditionId: "c25",
    timePointId: "tp0",
    testDefinitionId: "TEST-PACKAGING-COMPATIBILITY",
    resultType: "pass_fail",
    replicates: [],
    passFail: "pass",
    attachments: [],
    performedBy: "alice",
    performedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe("derivePackagingCompatibilityReadiness", () => {
  it("returns not_required when no packaging-capability test applies to this family/SKU", () => {
    const status = derivePackagingCompatibilityReadiness({
      productFamilyId: "fam-1",
      packagingSkuCode: "SKU-1",
      formulaVersionId: "version-1",
      studies: [],
      results: [],
      failures: [],
      testDefinitions: [testDef({ testCapability: "general" })],
    });
    expect(status).toBe("not_required");
  });

  it("returns unknown when an applicable test exists but no relevant study does", () => {
    const status = derivePackagingCompatibilityReadiness({
      productFamilyId: "fam-1",
      packagingSkuCode: "SKU-1",
      formulaVersionId: "version-1",
      studies: [],
      results: [],
      failures: [],
      testDefinitions: [packagingTestDef()],
    });
    expect(status).toBe("unknown");
  });

  it("returns incomplete when a study exists but no result has been recorded yet", () => {
    const status = derivePackagingCompatibilityReadiness({
      productFamilyId: "fam-1",
      packagingSkuCode: "SKU-1",
      formulaVersionId: "version-1",
      studies: [stabilityStudy()],
      results: [],
      failures: [],
      testDefinitions: [packagingTestDef()],
    });
    expect(status).toBe("incomplete");
  });

  it("returns failed when the recorded result failed", () => {
    const status = derivePackagingCompatibilityReadiness({
      productFamilyId: "fam-1",
      packagingSkuCode: "SKU-1",
      formulaVersionId: "version-1",
      studies: [stabilityStudy()],
      results: [stabilityResult({ passFail: "fail" })],
      failures: [],
      testDefinitions: [packagingTestDef()],
    });
    expect(status).toBe("failed");
  });

  it("returns failed when an unresolved packaging-related stability failure exists, even if the test itself passed", () => {
    const failure: StabilityFailure = {
      schemaVersion: "1.0", id: "fail-1", studyId: "study-1", sampleId: "sample-1", conditionId: "c25", timePointId: "tp0",
      type: "leakage", severity: "critical", description: "Leaked at cap.", investigationStatus: "open",
      correctiveActionIds: [], createdAt: NOW, updatedAt: NOW,
    };
    const status = derivePackagingCompatibilityReadiness({
      productFamilyId: "fam-1",
      packagingSkuCode: "SKU-1",
      formulaVersionId: "version-1",
      studies: [stabilityStudy()],
      results: [stabilityResult({ passFail: "pass" })],
      failures: [failure],
      testDefinitions: [packagingTestDef()],
    });
    expect(status).toBe("failed");
  });

  it("returns passed when the latest revision passes and no unresolved failure exists", () => {
    const status = derivePackagingCompatibilityReadiness({
      productFamilyId: "fam-1",
      packagingSkuCode: "SKU-1",
      formulaVersionId: "version-1",
      studies: [stabilityStudy()],
      results: [stabilityResult({ passFail: "pass" })],
      failures: [],
      testDefinitions: [packagingTestDef()],
    });
    expect(status).toBe("passed");
  });

  it("uses only the latest revision, not a superseded earlier failing result", () => {
    const original = stabilityResult({ id: "r-old", passFail: "fail" });
    const revised = stabilityResult({ id: "r-new", passFail: "pass", revisesResultId: "r-old" });
    const status = derivePackagingCompatibilityReadiness({
      productFamilyId: "fam-1",
      packagingSkuCode: "SKU-1",
      formulaVersionId: "version-1",
      studies: [stabilityStudy()],
      results: [original, revised],
      failures: [],
      testDefinitions: [packagingTestDef()],
    });
    expect(status).toBe("passed");
  });

  it("does not silently treat unknown as passed", () => {
    const status = derivePackagingCompatibilityReadiness({
      productFamilyId: "fam-1",
      packagingSkuCode: "SKU-1",
      formulaVersionId: "version-1",
      studies: [],
      results: [],
      failures: [],
      testDefinitions: [packagingTestDef()],
    });
    expect(status).not.toBe("passed");
  });
});

describe("deriveStabilityReadiness", () => {
  const TIME_POINTS: StabilityTimePoint[] = [
    { schemaVersion: "1.0", id: "tp0", code: "INITIAL", label: "Initial", daysFromStart: 0, custom: false },
    { schemaVersion: "1.0", id: "tp30", code: "1MO", label: "1 month", daysFromStart: 30, custom: false },
  ];

  function sample(over: Partial<StabilitySample> = {}): StabilitySample {
    return {
      schemaVersion: "1.0",
      id: "sample-1",
      sampleCode: "S1",
      studyId: "study-1",
      conditionId: "c25",
      timePointId: "tp0",
      packagingSkuCode: "SKU-1",
      replicateNumber: 1,
      status: "completed",
      testDefinitionIds: [],
      createdAt: NOW,
      ...over,
    };
  }

  it("hasActiveOrCompletedStudy is false when no study is linked to this version/SKU", () => {
    const r = deriveStabilityReadiness({
      policy: {},
      formulaVersionId: "version-1",
      productFamilyId: "fam-1",
      packagingSkuCode: "SKU-1",
      studies: [stabilityStudy({ sourceFormulaVersionId: "version-2" })],
      samples: [],
      results: [],
      failures: [],
      timePoints: TIME_POINTS,
      testDefinitions: [],
    });
    expect(r.hasActiveOrCompletedStudy).toBe(false);
  });

  it("initialTestsPassed reads the daysFromStart=0 time point's results", () => {
    const r = deriveStabilityReadiness({
      policy: {},
      formulaVersionId: "version-1",
      productFamilyId: "fam-1",
      packagingSkuCode: "SKU-1",
      studies: [stabilityStudy()],
      samples: [],
      results: [stabilityResult({ timePointId: "tp0", testDefinitionId: "TEST-PH", passFail: "pass" })],
      failures: [],
      timePoints: TIME_POINTS,
      testDefinitions: [],
    });
    expect(r.initialTestsPassed).toBe(true);
  });

  it("completedTimePointCount counts distinct time points with a completed sample", () => {
    const r = deriveStabilityReadiness({
      policy: {},
      formulaVersionId: "version-1",
      productFamilyId: "fam-1",
      packagingSkuCode: "SKU-1",
      studies: [stabilityStudy()],
      samples: [sample({ timePointId: "tp0" }), sample({ id: "sample-2", timePointId: "tp30" })],
      results: [],
      failures: [],
      timePoints: TIME_POINTS,
      testDefinitions: [],
    });
    expect(r.completedTimePointCount).toBe(2);
  });

  it("hasUnresolvedCriticalFailure reflects an open critical failure on a relevant study", () => {
    const failure: StabilityFailure = {
      schemaVersion: "1.0", id: "fail-1", studyId: "study-1", sampleId: "sample-1", conditionId: "c25", timePointId: "tp0",
      type: "out_of_specification", severity: "critical", description: "pH drift.", investigationStatus: "open",
      correctiveActionIds: [], createdAt: NOW, updatedAt: NOW,
    };
    const r = deriveStabilityReadiness({
      policy: {},
      formulaVersionId: "version-1",
      productFamilyId: "fam-1",
      packagingSkuCode: "SKU-1",
      studies: [stabilityStudy()],
      samples: [],
      results: [],
      failures: [failure],
      timePoints: TIME_POINTS,
      testDefinitions: [],
    });
    expect(r.hasUnresolvedCriticalFailure).toBe(true);
  });

  it("packagingCompatibilityPassed is true (not_required) and the status is surfaced distinctly", () => {
    const r = deriveStabilityReadiness({
      policy: {},
      formulaVersionId: "version-1",
      productFamilyId: "fam-1",
      packagingSkuCode: "SKU-1",
      studies: [stabilityStudy()],
      samples: [],
      results: [],
      failures: [],
      timePoints: TIME_POINTS,
      testDefinitions: [],
    });
    expect(r.packagingCompatibilityStatus).toBe("not_required");
    expect(r.packagingCompatibilityPassed).toBe(true);
  });

  it("packagingCompatibilityPassed is false when the derived status is unknown", () => {
    const r = deriveStabilityReadiness({
      policy: {},
      formulaVersionId: "version-1",
      productFamilyId: "fam-1",
      packagingSkuCode: "SKU-1",
      studies: [],
      samples: [],
      results: [],
      failures: [],
      timePoints: TIME_POINTS,
      testDefinitions: [packagingTestDef()],
    });
    expect(r.packagingCompatibilityStatus).toBe("unknown");
    expect(r.packagingCompatibilityPassed).toBe(false);
  });
});
