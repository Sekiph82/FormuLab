import { describe, expect, it } from "vitest";
import {
  buildSupplierBalancedReferenceFormulationPrior,
  calculateReferenceFormulationSupplierBiasProfile,
  evaluateReferenceFormulationSourceUse,
  referenceFormulationSupplierBiasProfileSchema,
} from "./referenceFormulationSupplierRights";
import type { ReferenceFormulationRights } from "../schemas/referenceFormulationSource";

const AS_OF = "2026-10-26T12:00:00.000Z";
const allowedRights = (overrides: Partial<ReferenceFormulationRights> = {}): ReferenceFormulationRights => ({
  status: "publicly_available",
  redistribution: "allowed",
  evidenceRefs: ["license:terms-v1"],
  usePermissions: {
    internalResearch: { status: "allowed", evidenceRefs: ["license:internal"] },
    sameSupplierPrior: { status: "allowed", evidenceRefs: ["license:same-supplier"] },
    crossSupplierPrior: { status: "allowed", evidenceRefs: ["license:cross-supplier"] },
    sourceExport: { status: "allowed", evidenceRefs: ["license:export"] },
    derivedExport: { status: "allowed", evidenceRefs: ["license:derived"] },
  },
  retentionPolicy: { status: "retain_until_revoked", evidenceRefs: ["license:retention"] },
  ...overrides,
});
const candidate = (sourceRecordId: string, supplierId: string, rights = allowedRights()) => ({ sourceRecordId, supplierId, rights });

describe("reference formulation supplier bias and rights", () => {
  it("fails closed for legacy, publicly available, unknown, prohibited, and restricted rights", () => {
    const legacy = evaluateReferenceFormulationSourceUse({ rights: { status: "publicly_available", redistribution: "unknown", evidenceRefs: ["source:public-page"] }, use: "crossSupplierPrior", asOf: AS_OF });
    expect(legacy).toMatchObject({ allowed: false, reason: "retention_unknown" });
    const unknown = evaluateReferenceFormulationSourceUse({ rights: allowedRights({ usePermissions: undefined }), use: "internalResearch", asOf: AS_OF });
    expect(unknown).toMatchObject({ allowed: false, reason: "permission_unknown" });
    const prohibited = evaluateReferenceFormulationSourceUse({
      rights: allowedRights({ usePermissions: { crossSupplierPrior: { status: "prohibited", evidenceRefs: ["terms:no-reuse"] } } }),
      use: "crossSupplierPrior", asOf: AS_OF,
    });
    expect(prohibited).toMatchObject({ allowed: false, reason: "permission_prohibited", evidenceRefs: ["license:retention", "terms:no-reuse"] });
    expect(evaluateReferenceFormulationSourceUse({ rights: allowedRights({ status: "restricted" }), use: "internalResearch", asOf: AS_OF }))
      .toMatchObject({ allowed: false, reason: "restricted_source" });
  });

  it("enforces explicit source and derived export rights, source redistribution, and retention", () => {
    expect(evaluateReferenceFormulationSourceUse({
      rights: allowedRights({ redistribution: "unknown" }), use: "sourceExport", asOf: AS_OF,
    })).toMatchObject({ allowed: false, reason: "redistribution_not_allowed" });
    expect(evaluateReferenceFormulationSourceUse({
      rights: allowedRights({ usePermissions: { sourceExport: { status: "prohibited", evidenceRefs: ["terms:no-copy"] } } }),
      use: "sourceExport", asOf: AS_OF,
    })).toMatchObject({ allowed: false, reason: "permission_prohibited" });
    expect(evaluateReferenceFormulationSourceUse({
      rights: allowedRights({ usePermissions: { derivedExport: { status: "unknown", evidenceRefs: [] } } }),
      use: "derivedExport", asOf: AS_OF,
    })).toMatchObject({ allowed: false, reason: "permission_unknown" });
    expect(evaluateReferenceFormulationSourceUse({
      rights: allowedRights({ retentionPolicy: { status: "retain_until_date", expiresAt: "2026-10-26T12:00:00.000Z", evidenceRefs: ["terms:expiry"] } }),
      use: "internalResearch", asOf: AS_OF,
    })).toMatchObject({ allowed: false, reason: "retention_expired" });
    expect(evaluateReferenceFormulationSourceUse({
      rights: allowedRights({ retentionPolicy: { status: "delete_after_use", evidenceRefs: ["terms:ephemeral"] } }),
      use: "internalResearch", asOf: AS_OF,
    })).toMatchObject({ allowed: false, reason: "delete_after_use" });
  });

  it("measures supplier concentration and equalizes total eligible supplier weights", () => {
    const profile = calculateReferenceFormulationSupplierBiasProfile([
      { sourceRecordId: "a1", supplierId: "A" }, { sourceRecordId: "a2", supplierId: "A" },
      { sourceRecordId: "a3", supplierId: "A" }, { sourceRecordId: "b1", supplierId: "B" },
    ]);
    expect(profile).toMatchObject({ formulaCount: 4, supplierCount: 2, largestSupplierShare: 0.75, hhi: 0.625, effectiveSupplierCount: 1.6 });
    expect(() => referenceFormulationSupplierBiasProfileSchema.parse({ ...profile, hhi: 0.5 })).toThrow(/concentration values/);
    expect(() => calculateReferenceFormulationSupplierBiasProfile([
      { sourceRecordId: "same", supplierId: "A" }, { sourceRecordId: "same", supplierId: "B" },
    ])).toThrow(/duplicate source formula IDs/);

    const result = buildSupplierBalancedReferenceFormulationPrior({
      targetSupplierId: "A", asOf: AS_OF,
      candidates: [candidate("a1", "A"), candidate("a2", "A"), candidate("a3", "A"), candidate("b1", "B"),
        candidate("c1", "C", { status: "publicly_available", redistribution: "allowed", evidenceRefs: ["source:public-page"] })],
    });
    expect(result.weights).toEqual([
      { sourceRecordId: "a1", supplierId: "A", weight: 1 / 6 },
      { sourceRecordId: "a2", supplierId: "A", weight: 1 / 6 },
      { sourceRecordId: "a3", supplierId: "A", weight: 1 / 6 },
      { sourceRecordId: "b1", supplierId: "B", weight: 0.5 },
    ]);
    expect(result.decisions[result.decisions.length - 1]).toMatchObject({ sourceRecordId: "c1", allowed: false, reason: "retention_unknown" });
    expect(result.weights.reduce((sum, row) => sum + row.weight, 0)).toBeCloseTo(1);
  });
});
