import { describe, expect, it } from "vitest";
import { candidateToDraftEvidenceInput, classifyDossierCandidateMatch, discoverDossierEvidenceCandidates } from "./dossierRecordDiscovery";
import type { RawMaterial } from "../schemas/materials";
import type { LaboratoryTrial } from "../schemas/laboratory";
import type { TestResult } from "../schemas/testDefinitions";
import type { StabilityStudy, StabilityResult } from "../schemas/stability";
import type { CompatibilitySnapshot } from "../schemas/compatibility";
import type { RegulatoryJurisdiction, RegulatoryReview, RegulatoryEvidenceConfirmation } from "../schemas/regulatory";

function material(over: Partial<RawMaterial> = {}): RawMaterial {
  return {
    schemaVersion: "1.0",
    code: "MAT-1",
    displayName: "Sodium Laureth Sulfate",
    casNumbers: [],
    ecNumbers: [],
    functions: [],
    activeMatterState: "missing",
    documents: [{ kind: "sds", title: "SLS SDS", location: "materials/mat-1-sds.pdf" }],
    regulatoryStatuses: [],
    hazardClassifications: [],
    allergens: [],
    incompatibilities: [],
    substituteCodes: [],
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function trial(over: Partial<LaboratoryTrial> = {}): LaboratoryTrial {
  return {
    schemaVersion: "1.0",
    id: "trial-1",
    code: "TRL-1",
    projectId: "proj-1",
    sourceType: "saved_version",
    sourceFormulaVersionId: "version-1",
    formulaSnapshot: { lines: [], basisBatchKg: "100", capturedAt: "2026-01-01T00:00:00.000Z" } as LaboratoryTrial["formulaSnapshot"],
    productFamilyId: "fam-1",
    targetPackagingSkuIds: ["SKU-1"],
    title: "Trial 1",
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    processSteps: [],
    observations: [],
    ...over,
  } as LaboratoryTrial;
}

function testResult(over: Partial<TestResult> = {}): TestResult {
  return {
    schemaVersion: "1.0",
    id: "result-1",
    trialId: "trial-1",
    testDefinitionId: "test-1",
    resultType: "numeric",
    replicates: [],
    passFail: "not_evaluated",
    attachments: [{ id: "att-1", kind: "document", title: "Trial report", location: "trials/report.pdf" }],
    performedBy: "alice",
    performedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as TestResult;
}

function study(over: Partial<StabilityStudy> = {}): StabilityStudy {
  return {
    schemaVersion: "1.0",
    id: "study-1",
    code: "STB-1",
    projectId: "proj-1",
    sourceType: "saved_version",
    sourceFormulaVersionId: "version-1",
    formulaSnapshot: { lines: [], basisBatchKg: "100", capturedAt: "2026-01-01T00:00:00.000Z" } as StabilityStudy["formulaSnapshot"],
    productFamilyId: "fam-1",
    packagingSkuCode: "SKU-1",
    packagingSnapshot: {} as StabilityStudy["packagingSnapshot"],
    title: "Stability study 1",
    owner: "alice",
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    conditions: [],
    samples: [],
    ...over,
  } as StabilityStudy;
}

function stabilityResult(over: Partial<StabilityResult> = {}): StabilityResult {
  return {
    schemaVersion: "1.0",
    id: "sresult-1",
    studyId: "study-1",
    sampleId: "sample-1",
    conditionId: "cond-1",
    timePointId: "t0",
    testDefinitionId: "test-1",
    resultType: "numeric",
    replicates: [],
    passFail: "not_evaluated",
    attachments: [{ id: "att-2", kind: "document", title: "Stability report", location: "stability/report.pdf" }],
    performedBy: "alice",
    performedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as StabilityResult;
}

function compatSnapshot(over: Partial<CompatibilitySnapshot> = {}): CompatibilitySnapshot {
  return {
    schemaVersion: "1.0",
    code: "COMPAT-1",
    formulationId: "proj-1",
    versionId: "version-1",
    calculatedAt: "2026-01-01T00:00:00.000Z",
    ruleVersionsUsed: [],
    findings: [],
    ...over,
  };
}

function review(over: Partial<RegulatoryReview> = {}): RegulatoryReview {
  return {
    schemaVersion: "1.0",
    id: "review-1",
    formulationId: "proj-1",
    formulaVersionId: "version-1",
    jurisdiction: "KE",
    classificationSnapshot: { category: "household_cleaning_product", confidence: 0.9, reasoning: ["x"], uncertain: false },
    findingSnapshot: [],
    ruleVersionSnapshot: [],
    reviewedBy: "alice",
    reviewerRole: "regulatory",
    reviewedAt: "2026-01-01T00:00:00.000Z",
    outcome: "compliant",
    notes: "Looks fine.",
    ...over,
  };
}

function confirmation(over: Partial<RegulatoryEvidenceConfirmation> = {}): RegulatoryEvidenceConfirmation {
  return {
    id: "confirm-1",
    schemaVersion: "1.0",
    formulationId: "proj-1",
    formulaVersionId: "version-1",
    jurisdiction: "KE",
    requirementType: "document",
    requirementCode: "R1",
    status: "confirmed",
    confirmedBy: "alice",
    confirmedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as RegulatoryEvidenceConfirmation;
}

const BASE_CTX = {
  formulationId: "proj-1",
  formulaVersionId: "version-1",
  packagingSkuCode: "SKU-1",
  jurisdictions: ["KE"] as RegulatoryJurisdiction[],
  formulaVersionMaterialCodes: ["MAT-1"],
};

describe("discoverDossierEvidenceCandidates", () => {
  it("suggests a raw material's document only when the material is used in this version", () => {
    const used = discoverDossierEvidenceCandidates({ ...BASE_CTX, materials: [material()] });
    expect(used).toHaveLength(1);
    expect(used[0].sourceKind).toBe("raw_material_document");
    expect(used[0].evidenceType).toBe("sds");

    const unused = discoverDossierEvidenceCandidates({ ...BASE_CTX, formulaVersionMaterialCodes: ["OTHER"], materials: [material()] });
    expect(unused).toHaveLength(0);
  });

  it("suggests laboratory trial result attachments, flagging a version mismatch rather than hiding it", () => {
    const matching = discoverDossierEvidenceCandidates({ ...BASE_CTX, laboratoryTrials: [trial()], testResults: [testResult()] });
    expect(matching).toHaveLength(1);
    expect(matching[0].matchesFormulaVersion).toBe(true);

    const mismatched = discoverDossierEvidenceCandidates({
      ...BASE_CTX,
      formulaVersionId: "version-2",
      laboratoryTrials: [trial()],
      testResults: [testResult()],
    });
    expect(mismatched).toHaveLength(1);
    expect(mismatched[0].matchesFormulaVersion).toBe(false);
  });

  it("never suggests a trial from a different project", () => {
    const result = discoverDossierEvidenceCandidates({
      ...BASE_CTX,
      laboratoryTrials: [trial({ projectId: "other-project" })],
      testResults: [testResult()],
    });
    expect(result).toHaveLength(0);
  });

  it("suggests stability study result attachments with packaging-SKU match flagged", () => {
    const matching = discoverDossierEvidenceCandidates({ ...BASE_CTX, stabilityStudies: [study()], stabilityResults: [stabilityResult()] });
    expect(matching).toHaveLength(1);
    expect(matching[0].matchesPackagingSku).toBe(true);

    const wrongSku = discoverDossierEvidenceCandidates({
      ...BASE_CTX,
      packagingSkuCode: "SKU-2",
      stabilityStudies: [study()],
      stabilityResults: [stabilityResult()],
    });
    expect(wrongSku[0].matchesPackagingSku).toBe(false);
  });

  it("suggests a compatibility snapshot with no attachment, referencing the computed findings only", () => {
    const result = discoverDossierEvidenceCandidates({ ...BASE_CTX, compatibilitySnapshots: [compatSnapshot()] });
    expect(result).toHaveLength(1);
    expect(result[0].attachment).toBeUndefined();
    expect(result[0].evidenceType).toBe("packaging_compatibility_report");
  });

  it("suggests a regulatory review, flagging jurisdiction mismatch rather than hiding it", () => {
    const result = discoverDossierEvidenceCandidates({ ...BASE_CTX, regulatoryReviews: [review()] });
    expect(result).toHaveLength(1);
    expect(result[0].matchesJurisdiction).toBe(true);

    const wrongJurisdiction = discoverDossierEvidenceCandidates({
      ...BASE_CTX,
      jurisdictions: ["UG"] as RegulatoryJurisdiction[],
      regulatoryReviews: [review()],
    });
    expect(wrongJurisdiction[0].matchesJurisdiction).toBe(false);
  });

  it("suggests a regulatory evidence confirmation", () => {
    const result = discoverDossierEvidenceCandidates({ ...BASE_CTX, regulatoryEvidenceConfirmations: [confirmation()] });
    expect(result).toHaveLength(1);
    expect(result[0].sourceKind).toBe("regulatory_evidence_confirmation");
  });

  it("returns nothing when no source records are supplied", () => {
    expect(discoverDossierEvidenceCandidates(BASE_CTX)).toHaveLength(0);
  });
});

describe("candidateToDraftEvidenceInput", () => {
  it("carries the source reference forward as formulab_record, never as uploaded", () => {
    const [candidate] = discoverDossierEvidenceCandidates({ ...BASE_CTX, materials: [material()] });
    const input = candidateToDraftEvidenceInput(candidate, {
      id: "dossier-1",
      formulationId: "proj-1",
      formulaVersionId: "version-1",
      packagingSkuCode: "SKU-1",
    });
    expect(input.sourceType).toBe("formulab_record");
    expect(input.sourceEntityId).toBe("MAT-1");
    expect(input.attachmentIds).toHaveLength(1);
  });
});

describe("classifyDossierCandidateMatch", () => {
  it("reports exact_match when all three scopes match", () => {
    expect(classifyDossierCandidateMatch({ matchesFormulaVersion: true, matchesPackagingSku: true, matchesJurisdiction: true })).toBe("exact_match");
  });
  it("reports the single mismatched scope by name", () => {
    expect(classifyDossierCandidateMatch({ matchesFormulaVersion: false, matchesPackagingSku: true, matchesJurisdiction: true })).toBe("version_mismatch");
    expect(classifyDossierCandidateMatch({ matchesFormulaVersion: true, matchesPackagingSku: false, matchesJurisdiction: true })).toBe("packaging_mismatch");
    expect(classifyDossierCandidateMatch({ matchesFormulaVersion: true, matchesPackagingSku: true, matchesJurisdiction: false })).toBe("jurisdiction_mismatch");
  });
  it("reports multiple_scope_mismatch when two or more scopes disagree", () => {
    expect(classifyDossierCandidateMatch({ matchesFormulaVersion: false, matchesPackagingSku: false, matchesJurisdiction: true })).toBe("multiple_scope_mismatch");
    expect(classifyDossierCandidateMatch({ matchesFormulaVersion: false, matchesPackagingSku: false, matchesJurisdiction: false })).toBe("multiple_scope_mismatch");
  });
});
