import { describe, expect, it } from "vitest";
import {
  buildTrialExportMeta,
  correctiveActionReportRows,
  erpLabResultDraftCsv,
  testResultReportRows,
  trialBatchSheetRows,
  trialComparisonReportRows,
  trialProcessSheetRows,
  trialToJsonPackage,
  trialWeighingSheetRows,
} from "./labExports";
import { compareTrials } from "./laboratory";
import type { FormulationLine } from "../schemas/formulation";
import type { CorrectiveAction } from "../schemas/correctiveActions";
import type { LaboratoryTrial, TrialComparison, TrialProcessStep } from "../schemas/laboratory";
import type { TestDefinition, TestResult } from "../schemas/testDefinitions";

function line(over: Partial<FormulationLine> & { id: string; displayName: string; percent: string }): FormulationLine {
  return { lineNumber: 1, phase: "A", functions: [], isQsToHundred: false, provenance: { origin: "model_estimate", evidenceClaimIds: [] }, ...over };
}

function trial(over: Partial<LaboratoryTrial> = {}): LaboratoryTrial {
  return {
    schemaVersion: "1.0",
    id: "trial-1",
    code: "TRIAL-1",
    projectId: "proj-1",
    sourceType: "working_draft",
    sourceDraftId: "proj-1",
    formulaSnapshot: {
      lines: [line({ id: "l1", displayName: "Water", percent: "50", materialCode: "WATER" })],
      basisBatchKg: "100",
      capturedAt: "2026-01-01T00:00:00.000Z",
    },
    productFamilyId: "fam-1",
    targetPackagingSkuIds: ["sku-1"],
    title: "Trial 1",
    batchSize: "1",
    batchUnit: "kg",
    status: "in_progress",
    priority: "normal",
    operator: "alice",
    equipmentIds: [],
    materialUsage: [
      { id: "usage-1", formulaLineId: "l1", materialCode: "WATER", materialName: "Water", targetPercent: "50", targetWeight: "50", weightUnit: "kg", coaStatus: "pending", quarantined: false, released: false },
    ],
    processSteps: [],
    observations: [],
    hasOpenCriticalDeviation: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "local",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("buildTrialExportMeta", () => {
  it("carries the trial identity, product family and target SKUs", () => {
    const meta = buildTrialExportMeta(trial(), "chemist_review");
    expect(meta.trialId).toBe("trial-1");
    expect(meta.trialCode).toBe("TRIAL-1");
    expect(meta.formulaProjectId).toBe("proj-1");
    expect(meta.productFamilyId).toBe("fam-1");
    expect(meta.targetPackagingSkuIds).toEqual(["sku-1"]);
    expect(meta.approvalStatus).toBe("chemist_review");
  });
});

describe("trialToJsonPackage", () => {
  it("carries a draft watermark unless the formula is production approved", () => {
    const meta = buildTrialExportMeta(trial(), "chemist_review");
    const pkg = trialToJsonPackage(trial(), meta);
    expect(pkg.watermark).toBe("R&D DRAFT — NOT PRODUCTION APPROVED");
  });

  it("has no watermark once the formula is production approved", () => {
    const meta = buildTrialExportMeta(trial(), "production_approved");
    const pkg = trialToJsonPackage(trial(), meta);
    expect(pkg.watermark).toBeNull();
  });

  it("embeds the trial and any related records passed in", () => {
    const meta = buildTrialExportMeta(trial(), "production_approved");
    const pkg = trialToJsonPackage(trial(), meta, { deviations: [{ id: "d1", severity: "minor", status: "open", description: "x" }] });
    expect((pkg.trial as LaboratoryTrial).id).toBe("trial-1");
    expect(pkg.deviations).toHaveLength(1);
  });
});

describe("trialBatchSheetRows", () => {
  it("lists only the planned formula lines with target weights, no actual column", () => {
    const { headers, rows } = trialBatchSheetRows(trial());
    expect(headers).not.toContain("actualWeight");
    expect(rows).toHaveLength(1);
    expect(rows[0].materialCode).toBe("WATER");
    expect(rows[0].targetWeight).toBe("50");
  });
});

describe("trialWeighingSheetRows", () => {
  it("reports 'not entered' rather than a fabricated zero when unweighed", () => {
    const { rows } = trialWeighingSheetRows(trial());
    expect(rows[0].actualWeight).toBe("not entered");
    expect(rows[0].batchAllWeighed).toBe(false);
  });

  it("computes deviation once an actual weight is entered", () => {
    const t = trial({ materialUsage: [{ id: "usage-1", formulaLineId: "l1", materialCode: "WATER", materialName: "Water", targetPercent: "50", targetWeight: "50", actualWeight: "51", weightUnit: "kg", coaStatus: "pending", quarantined: false, released: false }] });
    const { rows } = trialWeighingSheetRows(t);
    expect(rows[0].percentageDeviation).toBe("2.000000");
    expect(rows[0].batchAllWeighed).toBe(true);
  });
});

describe("trialProcessSheetRows", () => {
  it("reports a temperature deviation only when the actual is outside the planned range", () => {
    const step: TrialProcessStep = {
      id: "step-1", stepNumber: 1, phase: "A", plannedInstruction: "Heat", requiredEquipment: [],
      plannedTemperatureMinC: "65", plannedTemperatureMaxC: "75", actualTemperatureC: "80",
      status: "completed", unplanned: false, attachments: [],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const { rows } = trialProcessSheetRows(trial({ processSteps: [step] }));
    expect(rows[0].temperatureDeviationC).toBe("5.000000");
  });
});

describe("testResultReportRows", () => {
  it("resolves the test name from the matching definition", () => {
    const def: TestDefinition = {
      schemaVersion: "1.0", code: "PH", name: "pH", category: "physical", resultType: "numeric",
      replicatesRequired: 1, requiredEquipment: [], requiredAttachment: false, applicableProductFamilies: [], applicableProductSkus: [],
      criticalTestFlag: false, verificationStatus: "not_verified", active: true,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const result: TestResult = {
      schemaVersion: "1.0", id: "r1", trialId: "trial-1", testDefinitionId: "PH", resultType: "numeric",
      replicates: [], attachments: [], stats: { count: 3, mean: "7.0", standardDeviation: "0.1" }, passFail: "pass",
      performedBy: "alice", performedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const { rows } = testResultReportRows([result], [def]);
    expect(rows[0].testName).toBe("pH");
    expect(rows[0].mean).toBe("7.0");
    expect(rows[0].replicateCount).toBe(3);
    expect(rows[0].overridden).toBe(false);
  });
});

describe("trialComparisonReportRows", () => {
  it("passes through compareTrials' deterministic rows without re-deriving them", () => {
    const t1 = trial({ id: "t1", code: "T1" });
    const t2 = trial({ id: "t2", code: "T2" });
    const comparison: TrialComparison = compareTrials({
      projectId: "proj-1",
      trials: [t1, t2],
      deviationsByTrial: {},
      testResultsByTrial: {},
      testDefinitionsById: {},
    });
    const { trials, tests } = trialComparisonReportRows(comparison);
    expect(trials.rows).toHaveLength(2);
    expect(trials.rows[0].trialCode).toBe("T1");
    expect(tests.headers).toContain("meanDifference");
  });
});

describe("correctiveActionReportRows", () => {
  it("reports one row per action with its effectiveness when checked", () => {
    const action: CorrectiveAction = {
      schemaVersion: "1.0", id: "ca-1", code: "CA-1", projectId: "proj-1", sourceType: "trial_deviation", sourceRecordId: "trial-1",
      title: "Fix mixing", problemStatement: "Overheated", actionType: "process_change", owner: "alice", status: "effective",
      effectivenessCheck: { checkedBy: "alice", checkedAt: "2026-01-02T00:00:00.000Z", effective: true },
      auditHistory: [], createdAt: "2026-01-01T00:00:00.000Z", createdBy: "local", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const { rows } = correctiveActionReportRows([action]);
    expect(rows[0].code).toBe("CA-1");
    expect(rows[0].effective).toBe(true);
  });
});

describe("erpLabResultDraftCsv", () => {
  it("carries the draft watermark header and one row per result", () => {
    const result: TestResult = {
      schemaVersion: "1.0", id: "r1", trialId: "trial-1", testDefinitionId: "PH", resultType: "numeric",
      replicates: [], attachments: [], stats: { count: 1, mean: "7.0" }, passFail: "pass",
      performedBy: "alice", performedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const csv = erpLabResultDraftCsv([result], [], { recordLabel: trial().code, approvalStatus: "chemist_review" });
    expect(csv).toContain("R&D DRAFT — NOT PRODUCTION APPROVED");
    expect(csv).toContain("PH");
  });
});
