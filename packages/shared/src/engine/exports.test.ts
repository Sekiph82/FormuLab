import { describe, expect, it } from "vitest";
import {
  buildVersionExportMeta,
  draftWatermark,
  erpDraftBomCsv,
  erpDraftRecipeCsv,
  versionLinesToCsv,
  versionToJsonPackage,
} from "./exports";
import type { Formulation, FormulationVersion } from "../schemas/formulation";

const FORMULATION: Formulation = {
  schemaVersion: "1.0",
  id: "f1",
  code: "HC-SHAMPOO-REG-001",
  name: "Regular Shampoo",
  productFamilyCode: "HC-SHAMPOO-REG",
  targetSkuCodes: ["HC-SHAMPOO-REG-250ML-BOTTLE"],
  targetMarkets: ["KE"],
  targetClaims: ["gentle cleansing"],
  targetBatchKg: "100",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archived: false,
};

const VERSION: FormulationVersion = {
  schemaVersion: "1.0",
  id: "v1",
  formulationId: "f1",
  versionNumber: 2,
  versionLabel: "0.2",
  status: "chemist_review",
  author: "local",
  createdAt: "2026-01-02T00:00:00.000Z",
  changeReason: "adjusted surfactant blend",
  lines: [
    {
      id: "line-1",
      lineNumber: 1,
      phase: "A",
      materialCode: "SLES-70",
      displayName: "Sodium Laureth Sulfate",
      percent: "12",
      isQsToHundred: false,
      functions: ["anionic_surfactant"],
      activeMatterPercent: "70",
      provenance: { origin: "chemist_override", evidenceClaimIds: [] },
    },
    {
      id: "line-2",
      lineNumber: 2,
      phase: "A",
      displayName: "Water",
      percent: "0",
      isQsToHundred: true,
      functions: ["water"],
      provenance: { origin: "chemist_override", evidenceClaimIds: [] },
    },
  ],
  basisBatchKg: "100",
  sourceRunIds: [],
  regulatoryFindingIds: [],
  compatibilityFindingIds: [],
  safetyFindingIds: [],
  approvalRecordIds: [],
};

describe("buildVersionExportMeta", () => {
  it("carries every required header field", () => {
    const meta = buildVersionExportMeta(FORMULATION, VERSION, "chemist_review", "cost-1");
    expect(meta).toMatchObject({
      formulaId: "f1",
      formulaCode: "HC-SHAMPOO-REG-001",
      versionId: "v1",
      versionLabel: "0.2",
      schemaVersion: "1.0",
      approvalStatus: "chemist_review",
      costSnapshotId: "cost-1",
      targetProductFamily: "HC-SHAMPOO-REG",
      targetSkus: ["HC-SHAMPOO-REG-250ML-BOTTLE"],
    });
    expect(meta.exportTimestamp).toBeTruthy();
  });
});

describe("draftWatermark", () => {
  it("marks anything short of production_approved as an R&D draft", () => {
    for (const s of ["concept", "chemist_review", "pilot_candidate", "pilot_approved", "retired", "rejected"] as const) {
      expect(draftWatermark(s)).toMatch(/R&D DRAFT/);
    }
  });

  it("is null once actually production approved", () => {
    expect(draftWatermark("production_approved")).toBeNull();
  });
});

describe("versionToJsonPackage", () => {
  it("includes the watermark for a non-approved version", () => {
    const meta = buildVersionExportMeta(FORMULATION, VERSION, "chemist_review");
    const pkg = versionToJsonPackage(FORMULATION, VERSION, meta);
    expect(pkg.watermark).toMatch(/NOT PRODUCTION APPROVED/);
    expect((pkg.version as { lines: unknown[] }).lines).toHaveLength(2);
  });

  it("has no watermark once production approved", () => {
    const meta = buildVersionExportMeta(FORMULATION, VERSION, "production_approved");
    const pkg = versionToJsonPackage(FORMULATION, VERSION, meta);
    expect(pkg.watermark).toBeNull();
  });
});

describe("versionLinesToCsv", () => {
  it("emits one row per line with the material identity and percent", () => {
    const csv = versionLinesToCsv(VERSION);
    const rows = csv.split("\n");
    expect(rows[0]).toContain("displayName");
    expect(rows[1]).toContain("Sodium Laureth Sulfate");
    expect(rows[1]).toContain("12");
  });
});

describe("erpDraftBomCsv / erpDraftRecipeCsv", () => {
  it("both carry the draft watermark in a leading comment line", () => {
    const meta = buildVersionExportMeta(FORMULATION, VERSION, "chemist_review");
    expect(erpDraftBomCsv(VERSION, meta).split("\n")[0]).toMatch(/R&D DRAFT/);
    expect(erpDraftRecipeCsv(VERSION, meta).split("\n")[0]).toMatch(/R&D DRAFT/);
  });

  it("the recipe sheet numbers steps in line order", () => {
    const meta = buildVersionExportMeta(FORMULATION, VERSION, "chemist_review");
    const csv = erpDraftRecipeCsv(VERSION, meta);
    expect(csv).toContain("Sodium Laureth Sulfate");
    expect(csv).toContain("Water");
  });
});
