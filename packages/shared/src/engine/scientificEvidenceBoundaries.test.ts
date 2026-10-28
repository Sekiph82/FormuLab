import { describe, expect, it } from "vitest";
import { EVIDENCE_ORIGINS, provenanceSchema } from "../schemas/formulation";
import { laboratoryTrialSchema } from "../schemas/laboratory";
import { TARGET_SOURCE_ENTITIES, targetDefinitionSchema } from "../schemas/dataset";
import { referenceFormulationRecordSchema } from "../schemas/referenceFormulationRecord";
import { supplierSdsProductEvidenceSchema } from "../schemas/supplierSdsProductEvidence";
import { testResultSchema } from "../schemas/testDefinitions";

const HASH = "a".repeat(64);

describe("scientific evidence boundaries", () => {
  it("keeps supplier recommendations distinct from laboratory-result provenance", () => {
    expect(EVIDENCE_ORIGINS).toContain("supplier_recommendation");
    expect(EVIDENCE_ORIGINS).toContain("laboratory_result");
    expect(provenanceSchema.parse({ origin: "supplier_recommendation" }).origin).toBe("supplier_recommendation");
    expect(provenanceSchema.parse({ origin: "laboratory_result" }).origin).toBe("laboratory_result");
    expect("supplier_recommendation").not.toBe("laboratory_result");
  });

  it("does not allow supplier formula, SDS, or recommendation categories to create measured target definitions", () => {
    expect(TARGET_SOURCE_ENTITIES).toEqual(["testResult", "stabilityResult", "doeObservation"]);
    for (const sourceEntity of ["supplier_reference_formula", "supplier_sds", "supplier_recommendation"]) {
      const result = targetDefinitionSchema.safeParse({
        productFamilyCode: "hand-dishwash",
        sourceEntity,
        testDefinitionId: "performance-test",
      });
      expect(result.success, `${sourceEntity} must not be a measured target source`).toBe(false);
    }
    expect(targetDefinitionSchema.parse({
      productFamilyCode: "hand-dishwash",
      sourceEntity: "testResult",
      testDefinitionId: "performance-test",
    }).sourceEntity).toBe("testResult");
  });

  it("keeps supplier formula and SDS records outside laboratory trial/result schemas", () => {
    expect(referenceFormulationRecordSchema.shape.recordKind.parse("supplier_reference_formula"))
      .toBe("supplier_reference_formula");
    expect(referenceFormulationRecordSchema.safeParse({ recordKind: "supplier_reference_formula" }).success).toBe(false);

    const sdsEvidence = supplierSdsProductEvidenceSchema.parse({
      schemaVersion: "1.0",
      id: "sds-evidence-1",
      commercialProductId: "commercial-product-1",
      section1: { sectionNumber: 1, sourceDocumentHash: HASH },
      section3: { sectionNumber: 3, sourceDocumentHash: HASH },
    });
    expect(sdsEvidence).not.toHaveProperty("performanceClaim");
    expect(laboratoryTrialSchema.safeParse(sdsEvidence).success).toBe(false);
    expect(testResultSchema.safeParse(sdsEvidence).success).toBe(false);
    expect(() => supplierSdsProductEvidenceSchema.parse({
      schemaVersion: "1.0",
      id: "sds-evidence-2",
      commercialProductId: "commercial-product-1",
      section1: { sectionNumber: 1, sourceDocumentHash: HASH },
      section3: { sectionNumber: 3, sourceDocumentHash: HASH },
      performanceClaim: "Removes soil",
    })).toThrow();
  });

  it("requires trial and test-result identities for structured measured results", () => {
    const trial = laboratoryTrialSchema.parse({
      schemaVersion: "1.0",
      id: "trial-1",
      code: "TRIAL-1",
      projectId: "formula-1",
      sourceType: "working_draft",
      sourceDraftId: "draft-1",
      formulaSnapshot: { lines: [], basisBatchKg: "100", capturedAt: "2026-10-27T08:00:00.000Z" },
      productFamilyId: "hand-dishwash",
      title: "Controlled performance trial",
      batchSize: "100",
      status: "completed",
      createdAt: "2026-10-27T08:00:00.000Z",
      updatedAt: "2026-10-27T08:00:00.000Z",
    });
    const result = testResultSchema.parse({
      schemaVersion: "1.0",
      id: "result-1",
      trialId: trial.id,
      formulaVersionId: "version-1",
      testDefinitionId: "soil-removal",
      resultType: "numeric",
      replicates: [{ replicateNumber: 1, numericValue: "82", isOutlier: false }],
      performedBy: "chemist-1",
      performedAt: "2026-10-27T08:30:00.000Z",
      createdAt: "2026-10-27T08:31:00.000Z",
      updatedAt: "2026-10-27T08:31:00.000Z",
    });

    expect(trial.status).toBe("completed");
    expect(result.trialId).toBe(trial.id);
    expect(result.testDefinitionId).toBe("soil-removal");
    expect(testResultSchema.safeParse({ ...result, trialId: undefined }).success).toBe(false);
  });
});
