import { describe, expect, it } from "vitest";
import { referenceFormulationEvaluationTimestamp, summarizeReferenceFormulationSupport } from "./referenceFormulationGeneration";
import { evaluateReferenceFormulationSourceUse } from "@formulab/shared";

describe("reference formulation support quality", () => {
  it("evaluates retention against request time instead of the old source or review timestamp", () => {
    const asOf = referenceFormulationEvaluationTimestamp(new Date("2026-10-28T12:00:00.000Z"));
    const decision = evaluateReferenceFormulationSourceUse({
      use: "internalResearch",
      asOf,
      rights: {
        status: "owner_provided", redistribution: "unknown", evidenceRefs: ["owner:permission"],
        usePermissions: { internalResearch: { status: "allowed", evidenceRefs: ["owner:research-use"] } },
        retentionPolicy: { status: "retain_until_date", expiresAt: "2026-10-27T23:59:59.000Z", evidenceRefs: ["owner:expiry"] },
      },
    });
    expect(decision).toMatchObject({ allowed: false, reason: "retention_expired" });
    expect(asOf).toBe("2026-10-28T12:00:00.000Z");
  });

  function fixture(input: { total: number; eligible: number; suppliers: number; unresolved?: number; uncited?: number }) {
    const total = input.total;
    const queryRecords = Array.from({ length: total }, (_, index) => ({
      id: `query-${index}`,
      productFamily: { candidates: [{ rawValue: "Hand Dishwash" }] },
      lines: Array.from({ length: index < (input.uncited ?? 0) ? 2 : 1 }, (_, lineIndex) => ({
        sourceLineEvidenceRefs: index < (input.uncited ?? 0) && lineIndex === 0 ? [] : [`line:${index}:${lineIndex}`],
      })),
    })) as unknown as Parameters<typeof summarizeReferenceFormulationSupport>[0]["queryRecords"];
    const decisions = queryRecords.map((query, index) => ({
      sourceRecordId: `source-${index}`,
      queryRecordId: query.id,
      normalizationId: `normalization-${index}`,
      eligible: index < input.eligible,
      reasons: index < (input.unresolved ?? 0) ? ["canonical_chemistry_unresolved"]
        : index < input.eligible ? [] : ["product_family_not_reviewed"],
    })) as unknown as Parameters<typeof summarizeReferenceFormulationSupport>[0]["decisions"];
    return summarizeReferenceFormulationSupport({
      queryRecords,
      decisions,
      context: { eligibleFormulaCount: input.eligible, supplierCount: input.suppliers },
      productFamilyKey: "hand dishwash",
    });
  }

  it("reports sample, identity-resolution, and citation denominators with deterministic broad tier", () => {
    const quality = fixture({ total: 10, eligible: 10, suppliers: 3 });
    expect(quality).toMatchObject({
      status: "BROAD", familyFormulaCount: 10, eligibleFormulaCount: 10, supplierCount: 3,
      identityResolvedFormulaCount: 10, identityResolutionPercent: 100,
      ingredientLineCount: 10, sourceCitedIngredientLineCount: 10, sourceCitationCoveragePercent: 100,
      policyVersion: "formulab-reference-support-quality-v1",
    });
  });

  it("keeps unresolved identities and missing citations visible and uses the sparse tier", () => {
    const quality = fixture({ total: 4, eligible: 2, suppliers: 1, unresolved: 1, uncited: 2 });
    expect(quality).toMatchObject({
      status: "SPARSE", identityResolvedFormulaCount: 1, identityResolutionPercent: 25,
      ingredientLineCount: 6, sourceCitedIngredientLineCount: 4, sourceCitationCoveragePercent: 66.7,
    });
  });

  it("reports moderate and unavailable cohorts without treating absent samples as zero-confidence", () => {
    expect(fixture({ total: 5, eligible: 3, suppliers: 2 }).status).toBe("MODERATE");
    expect(fixture({ total: 4, eligible: 0, suppliers: 0 }).status).toBe("UNAVAILABLE");
  });
});
