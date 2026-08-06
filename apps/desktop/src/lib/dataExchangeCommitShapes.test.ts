/**
 * `dataExchangeCommit.ts`'s handlers build several records with `as never`
 * casts (dispatched to `upsertRecords`, which is untyped at the Rust
 * boundary) rather than the collection's real TypeScript type — pragmatic
 * given how many distinct target schemas there are, but it means a field
 * mismatch would otherwise only surface by actually running the import
 * live. This file catches that class of mistake cheaply: it builds the
 * exact same record shape each handler constructs and parses it through
 * the REAL Zod schema, without touching Tauri at all.
 */
import { describe, expect, it } from "vitest";
import {
  regulatoryRuleSchema,
  regulatoryDossierRequirementSchema,
  regulatoryDossierEvidenceItemSchema,
  productClaimSchema,
  labelContentBlockSchema,
  labelArtworkSchema,
  doeFactorSchema,
  doeResponseSchema,
  doeObservationSchema,
  testDefinitionSchema,
  testResultSchema,
  packagingComponentSchema,
  factoryCostProfileSchema,
} from "@formulab/shared";

describe("commit-handler record shapes conform to their real Zod schemas", () => {
  it("regulatory rule", () => {
    const parsed = regulatoryRuleSchema.safeParse({
      schemaVersion: "1.0",
      id: "rule-1",
      code: "TEST-RULE-001",
      name: "TEST-RULE-001",
      jurisdiction: "KE",
      authority: "Imported — authority not yet confirmed",
      ruleType: "label_requirement",
      productCategories: [],
      requirement: "Label must state net contents.",
      severity: "blocking",
      status: "draft",
      conditions: [],
      claimKeywordsAny: [],
      requiredEvidenceTypes: [],
      requiredLabelElements: ["net_contents"],
      requiredWarnings: [],
      requiredDocumentTypes: [],
      requiredTestTypes: [],
      requiredPackagingElements: [],
      requiredLanguages: [],
      requiresRegistration: false,
      requiresNotification: false,
      requiresResponsiblePartyInMarket: false,
      requiresMarketSpecificIdentifier: false,
      version: 1,
      verificationStatus: "not_verified",
      humanReviewStatus: "review_required",
      active: true,
      createdBy: "data-exchange-import",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify((parsed as { error: unknown }).error)).toBe(true);
  });

  it("dossier requirement", () => {
    const parsed = regulatoryDossierRequirementSchema.safeParse({
      schemaVersion: "1.0",
      id: "req-1",
      dossierId: "dossier-1",
      dossierRevision: 1,
      jurisdiction: "KE",
      requirementCode: "TEST-REQ-001",
      requirementType: "other",
      title: "Net contents statement",
      isManual: true,
      mandatory: true,
      critical: true,
      applicabilityStatus: "applicable",
      applicabilityReason: "Set via Data Exchange import.",
      evidenceRequirement: true,
      documentTypesAccepted: [],
      minimumEvidenceCount: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify((parsed as { error: unknown }).error)).toBe(true);
  });

  it("dossier evidence", () => {
    const parsed = regulatoryDossierEvidenceItemSchema.safeParse({
      schemaVersion: "1.0",
      id: "evid-1",
      dossierId: "dossier-1",
      evidenceCode: "TEST-EVID-001",
      formulationId: "formulation-1",
      formulaVersionId: "version-1",
      jurisdictions: ["KE"],
      evidenceType: "other",
      title: "TEST net-contents declaration",
      status: "draft",
      sourceType: "uploaded",
      attachmentIds: [],
      confidentiality: "normal",
      createdBy: "data-exchange-import",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify((parsed as { error: unknown }).error)).toBe(true);
  });

  it("product claim", () => {
    const parsed = productClaimSchema.safeParse({
      schemaVersion: "1.0",
      id: "claim-1",
      claimCode: "TEST-CLAIM-001",
      claimText: "TEST gentle on sensitive skin",
      normalizedClaim: "test gentle on sensitive skin",
      claimCategory: "sensitive",
      formulationId: "formulation-1",
      formulaVersionId: "version-1",
      jurisdictions: ["KE"],
      languages: ["en"],
      status: "draft",
      riskLevel: "low",
      proposedBy: "data-exchange-import",
      proposedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify((parsed as { error: unknown }).error)).toBe(true);
  });

  it("label content block", () => {
    const parsed = labelContentBlockSchema.safeParse({
      schemaVersion: "1.0",
      id: "block-1",
      labelId: "label-1",
      labelRevision: 1,
      blockType: "product_name",
      panel: "front",
      text: "TEST Gentle Hand Soap",
      language: "en",
      position: 0,
      mandatory: true,
      source: "imported",
      translationStatus: "draft",
      status: "draft",
      createdBy: "data-exchange-import",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify((parsed as { error: unknown }).error)).toBe(true);
  });

  it("label artwork", () => {
    const parsed = labelArtworkSchema.safeParse({
      schemaVersion: "1.0",
      id: "artwork-1",
      labelId: "label-1",
      labelRevision: 1,
      artworkCode: "TEST-ART-001",
      attachmentIds: [],
      languageSet: ["en"],
      createdBy: "data-exchange-import",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "draft",
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify((parsed as { error: unknown }).error)).toBe(true);
  });

  it("DOE factor", () => {
    const parsed = doeFactorSchema.safeParse({
      schemaVersion: "1.0",
      id: "factor-1",
      studyId: "study-1",
      studyRevision: 1,
      factorCode: "TEST-FACTOR-A",
      name: "TEST Surfactant Level",
      factorType: "continuous",
      sourceType: "process_parameter",
      categoricalLevels: [],
      transformation: "none",
      precision: 2,
      isMixtureComponent: false,
      isProcessFactor: true,
      isControlled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify((parsed as { error: unknown }).error)).toBe(true);
  });

  it("DOE response", () => {
    const parsed = doeResponseSchema.safeParse({
      schemaVersion: "1.0",
      id: "response-1",
      studyId: "study-1",
      studyRevision: 1,
      responseCode: "TEST-RESPONSE-1",
      name: "TEST Viscosity Response",
      responseType: "continuous",
      objective: "within_range",
      weight: "1",
      desirabilityShape: "linear",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify((parsed as { error: unknown }).error)).toBe(true);
  });

  it("DOE observation", () => {
    const parsed = doeObservationSchema.safeParse({
      schemaVersion: "1.0",
      id: "obs-1",
      studyId: "study-1",
      studyRevision: 1,
      runId: "run-1",
      responseId: "response-1",
      value: "12500",
      status: "recorded",
      recordedBy: "data-exchange-import",
      recordedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify((parsed as { error: unknown }).error)).toBe(true);
  });

  it("test definition", () => {
    const parsed = testDefinitionSchema.safeParse({
      schemaVersion: "1.0",
      code: "TEST-TST-001",
      name: "TEST pH Measurement",
      category: "physicochemical",
      resultType: "numeric",
      replicatesRequired: 2,
      requiredEquipment: [],
      requiredAttachment: false,
      applicableProductFamilies: [],
      applicableProductSkus: [],
      requiredByDefault: true,
      criticalTestFlag: false,
      verificationStatus: "imported_unverified",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify((parsed as { error: unknown }).error)).toBe(true);
  });

  it("lab test result (grouped replicates)", () => {
    const parsed = testResultSchema.safeParse({
      schemaVersion: "1.0",
      id: "result-1",
      trialId: "trial-1",
      testDefinitionId: "testdef-1",
      sampleId: "S1",
      resultType: "numeric",
      replicates: [{ replicateNumber: 1, numericValue: "5.4", isOutlier: false }],
      passFail: "not_evaluated",
      attachments: [],
      performedBy: "Test Analyst",
      performedAt: "2026-01-15",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify((parsed as { error: unknown }).error)).toBe(true);
  });

  it("packaging component", () => {
    const parsed = packagingComponentSchema.safeParse({
      schemaVersion: "1.0",
      code: "TEST-PKG-001",
      description: "TEST 250ml PET Bottle",
      componentType: "bottle",
      unit: "piece",
      currency: "KES",
      wasteFactorPercent: "0",
      active: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify((parsed as { error: unknown }).error)).toBe(true);
  });

  it("costing profile, including the structured freight/duty/tax/target-margin fields", () => {
    const parsed = factoryCostProfileSchema.safeParse({
      schemaVersion: "1.0",
      code: "TEST-COST-001",
      name: "Imported costing profile TEST-COST-001",
      currency: "KES",
      processLossPercent: "2",
      freightPercent: "3",
      dutyPercent: "0",
      taxPercent: "16",
      targetMarginPercent: "30",
      effectiveFrom: "2026-01-01",
      verification: "not_verified",
      notes: "Imported via Data Exchange.",
      active: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify((parsed as { error: unknown }).error)).toBe(true);
  });
});
