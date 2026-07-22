import { describe, expect, it } from "vitest";
import {
  buildStabilityExportMeta,
  samplePlanCsvRows,
  stabilityProtocolJson,
  stabilitySummaryReportRows,
  timePointReportRows,
} from "./stabilityExports";
import type { FormulationLine } from "../schemas/formulation";
import type { StabilityFailure, StabilitySample, StabilityStudy } from "../schemas/stability";

function line(over: Partial<FormulationLine> & { id: string; displayName: string; percent: string }): FormulationLine {
  return { lineNumber: 1, phase: "A", functions: [], isQsToHundred: false, provenance: { origin: "model_estimate", evidenceClaimIds: [] }, ...over };
}

function study(over: Partial<StabilityStudy> = {}): StabilityStudy {
  return {
    schemaVersion: "1.0",
    id: "study-1",
    code: "STUDY-1",
    projectId: "proj-1",
    sourceType: "working_draft",
    sourceDraftId: "proj-1",
    formulaSnapshot: { lines: [line({ id: "l1", displayName: "Water", percent: "50" })], basisBatchKg: "100", capturedAt: "2026-01-01T00:00:00.000Z" },
    productFamilyId: "fam-1",
    packagingSkuCode: "sku-1",
    packagingSnapshot: { skuCode: "sku-1", lines: [], capturedAt: "2026-01-01T00:00:00.000Z" },
    title: "Study 1",
    owner: "alice",
    status: "active",
    conditionIds: ["c25"],
    timePointIds: ["tp0"],
    requiredTestDefinitionIds: [],
    replicatesPerPullPoint: 1,
    hasOpenCriticalFailure: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "local",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function sample(over: Partial<StabilitySample> = {}): StabilitySample {
  return {
    schemaVersion: "1.0",
    id: "samp-1",
    sampleCode: "STUDY-1-25C-INIT-R1",
    studyId: "study-1",
    conditionId: "c25",
    timePointId: "tp0",
    packagingSkuCode: "sku-1",
    replicateNumber: 1,
    status: "planned",
    testDefinitionIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("buildStabilityExportMeta", () => {
  it("carries the study identity, product family and packaging SKU", () => {
    const meta = buildStabilityExportMeta(study(), "chemist_review");
    expect(meta.studyId).toBe("study-1");
    expect(meta.studyCode).toBe("STUDY-1");
    expect(meta.packagingSkuCode).toBe("sku-1");
    expect(meta.owner).toBe("alice");
  });
});

describe("stabilityProtocolJson", () => {
  it("carries a draft watermark unless the formula is production approved", () => {
    const meta = buildStabilityExportMeta(study(), "chemist_review");
    const pkg = stabilityProtocolJson(study(), meta);
    expect(pkg.watermark).toBe("R&D DRAFT — NOT PRODUCTION APPROVED");
  });

  it("embeds the frozen formula and packaging snapshots, not a live reference", () => {
    const meta = buildStabilityExportMeta(study(), "production_approved");
    const pkg = stabilityProtocolJson(study(), meta);
    expect(pkg.watermark).toBeNull();
    const embedded = pkg.study as Record<string, unknown>;
    expect(embedded.formulaSnapshot).toBeDefined();
    expect(embedded.packagingSnapshot).toBeDefined();
  });
});

describe("samplePlanCsvRows", () => {
  it("lists one row per sample with its due date and status", () => {
    const { rows } = samplePlanCsvRows([sample(), sample({ id: "samp-2", sampleCode: "STUDY-1-25C-1MO-R1", timePointId: "tp1", dueDate: "2026-02-01T00:00:00.000Z" })]);
    expect(rows).toHaveLength(2);
    expect(rows[1].dueDate).toBe("2026-02-01T00:00:00.000Z");
  });
});

describe("timePointReportRows", () => {
  it("filters to one time point when given, and reports its result count", () => {
    const samples = [sample(), sample({ id: "samp-2", timePointId: "tp1" })];
    const counts = new Map([["samp-1", 3]]);
    const { rows } = timePointReportRows(samples, counts, "tp0");
    expect(rows).toHaveLength(1);
    expect(rows[0].resultCount).toBe(3);
  });

  it("includes every time point when none is specified, defaulting missing counts to 0", () => {
    const samples = [sample(), sample({ id: "samp-2", timePointId: "tp1" })];
    const { rows } = timePointReportRows(samples, new Map());
    expect(rows).toHaveLength(2);
    expect(rows[0].resultCount).toBe(0);
  });
});

describe("stabilitySummaryReportRows", () => {
  it("reports sample counts by status and open critical failures, nothing derived beyond that", () => {
    const samples = [sample(), sample({ id: "samp-2", status: "completed" })];
    const failure: StabilityFailure = {
      schemaVersion: "1.0", id: "f1", studyId: "study-1", sampleId: "samp-1", conditionId: "c25", timePointId: "tp0",
      type: "out_of_specification", severity: "critical", description: "pH drifted.",
      investigationStatus: "open", correctiveActionIds: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const { rows } = stabilitySummaryReportRows(study(), samples, [failure]);
    expect(rows[0].totalSamples).toBe(2);
    expect(rows[0].openCriticalFailures).toBe(1);
    expect(rows[0].samples_planned).toBe(1);
    expect(rows[0].samples_completed).toBe(1);
  });
});
