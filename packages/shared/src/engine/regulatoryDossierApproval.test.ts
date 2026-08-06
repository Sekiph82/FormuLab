import { describe, expect, it } from "vitest";
import { deriveDossierApprovalReadiness, findDossierForScope, resolveDossierJurisdictions, type DossierApprovalPolicy } from "./regulatoryDossierApproval";
import { createDossier, recordDossierReview } from "./regulatoryDossier";
import type { Actor } from "../schemas/status";
import type { RegulatoryDossier, RegulatoryDossierEvidenceItem, RegulatoryDossierRequirement, RegulatoryRequirementEvidenceLink } from "../schemas/dossier";

const REGULATORY_ACTOR: Actor = { kind: "human", role: "regulatory", userId: "alice" };

const OFF_POLICY: DossierApprovalPolicy = {
  requireRegulatoryDossier: false,
  requireDossierReadyForReview: false,
  requireDossierReviewComplete: false,
  requireNoMissingMandatoryDossierEvidence: false,
  requireNoExpiredMandatoryDossierEvidence: false,
  requireAllRequiredJurisdictionDossiers: false,
};

function makeDossier(over: Partial<RegulatoryDossier> = {}): RegulatoryDossier {
  const base = createDossier(
    { dossierCode: "DOS-1", title: "t", formulationId: "proj-1", formulaVersionId: "version-1", jurisdictions: ["KE"], productFamilyCode: "x", packagingSkuCode: "SKU-1" },
    REGULATORY_ACTOR,
  );
  return { ...base, ...over };
}

function requirement(over: Partial<RegulatoryDossierRequirement> = {}): RegulatoryDossierRequirement {
  return {
    schemaVersion: "1.0",
    id: "req-1",
    dossierId: "dossier-x",
    dossierRevision: 1,
    jurisdiction: "KE",
    requirementCode: "R1:KE",
    requirementType: "document",
    title: "Requirement",
    isManual: false,
    mandatory: true,
    critical: false,
    applicabilityStatus: "applicable",
    applicabilityReason: "test",
    evidenceRequirement: true,
    documentTypesAccepted: ["sds"],
    minimumEvidenceCount: 1,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function evidenceItem(over: Partial<RegulatoryDossierEvidenceItem> = {}): RegulatoryDossierEvidenceItem {
  return {
    schemaVersion: "1.0",
    id: "evidence-1",
    dossierId: "dossier-x",
    formulationId: "proj-1",
    formulaVersionId: "version-1",
    packagingSkuCode: "SKU-1",
    jurisdictions: ["KE"],
    evidenceType: "sds",
    title: "SDS",
    status: "verified",
    sourceType: "uploaded",
    attachmentIds: [{ id: "att-1", kind: "document", title: "SDS", location: "sds.pdf" }],
    confidentiality: "normal",
    createdBy: "alice",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function acceptedLink(over: Partial<RegulatoryRequirementEvidenceLink> = {}): RegulatoryRequirementEvidenceLink {
  return {
    schemaVersion: "1.0",
    id: "link-1",
    dossierId: "dossier-x",
    requirementId: "req-1",
    evidenceItemId: "evidence-1",
    linkStatus: "accepted",
    linkedBy: "alice",
    linkedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("resolveDossierJurisdictions", () => {
  it("checks only the primary market by default", () => {
    expect(resolveDossierJurisdictions(OFF_POLICY, ["KE", "UG"])).toEqual(["KE"]);
  });

  it("checks every target market when requireAllRequiredJurisdictionDossiers is set", () => {
    expect(resolveDossierJurisdictions({ ...OFF_POLICY, requireAllRequiredJurisdictionDossiers: true }, ["KE", "UG"])).toEqual(["KE", "UG"]);
  });
});

describe("findDossierForScope", () => {
  const d = makeDossier();

  it("matches the exact version/packaging/jurisdiction", () => {
    const result = findDossierForScope([d], { formulaVersionId: "version-1", packagingSkuCode: "SKU-1", jurisdiction: "KE" });
    expect(result.reason).toBe("matched");
    expect(result.dossier?.id).toBe(d.id);
  });

  it("reports no_dossier when none exist", () => {
    expect(findDossierForScope([], { formulaVersionId: "version-1", jurisdiction: "KE" }).reason).toBe("no_dossier");
  });

  it("reports wrong_formula_version rather than silently missing", () => {
    const result = findDossierForScope([d], { formulaVersionId: "version-2", packagingSkuCode: "SKU-1", jurisdiction: "KE" });
    expect(result.reason).toBe("wrong_formula_version");
  });

  it("reports wrong_packaging_sku", () => {
    const result = findDossierForScope([d], { formulaVersionId: "version-1", packagingSkuCode: "SKU-2", jurisdiction: "KE" });
    expect(result.reason).toBe("wrong_packaging_sku");
  });

  it("reports jurisdiction_not_covered when a dossier exists but not for this jurisdiction", () => {
    const result = findDossierForScope([d], { formulaVersionId: "version-1", packagingSkuCode: "SKU-1", jurisdiction: "UG" });
    expect(result.reason).toBe("jurisdiction_not_covered");
  });

  it("never matches a superseded dossier", () => {
    const superseded = { ...d, status: "superseded" as const };
    const result = findDossierForScope([superseded], { formulaVersionId: "version-1", packagingSkuCode: "SKU-1", jurisdiction: "KE" });
    expect(result.reason).toBe("no_dossier");
  });
});

describe("deriveDossierApprovalReadiness", () => {
  it("is off by default — no existing project becomes blocked merely because Phase 3 was installed", () => {
    const result = deriveDossierApprovalReadiness({
      policy: OFF_POLICY,
      formulaVersionId: "version-1",
      jurisdictions: ["KE"],
      dossiers: [],
      requirements: [],
      links: [],
      evidenceItems: [],
      reviews: [],
      reviewRevocations: [],
    });
    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("dossier_missing blocks when required and none exists", () => {
    const result = deriveDossierApprovalReadiness({
      policy: { ...OFF_POLICY, requireRegulatoryDossier: true },
      formulaVersionId: "version-1",
      jurisdictions: ["KE"],
      dossiers: [],
      requirements: [],
      links: [],
      evidenceItems: [],
      reviews: [],
      reviewRevocations: [],
    });
    expect(result.ready).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain("dossier_missing");
  });

  it("dossier_wrong_formula_version blocks when the only dossier is for a different version", () => {
    const d = makeDossier();
    const result = deriveDossierApprovalReadiness({
      policy: { ...OFF_POLICY, requireRegulatoryDossier: true },
      formulaVersionId: "version-2",
      packagingSkuCode: "SKU-1",
      jurisdictions: ["KE"],
      dossiers: [d],
      requirements: [],
      links: [],
      evidenceItems: [],
      reviews: [],
      reviewRevocations: [],
    });
    expect(result.blockers.map((b) => b.code)).toContain("dossier_wrong_formula_version");
  });

  it("dossier_not_ready blocks when requireDossierReadyForReview is on and mandatory evidence is missing", () => {
    const d = makeDossier();
    const req = requirement({ dossierId: d.id, dossierRevision: d.revision });
    const result = deriveDossierApprovalReadiness({
      policy: { ...OFF_POLICY, requireRegulatoryDossier: true, requireDossierReadyForReview: true },
      formulaVersionId: "version-1",
      packagingSkuCode: "SKU-1",
      jurisdictions: ["KE"],
      dossiers: [d],
      requirements: [req],
      links: [],
      evidenceItems: [],
      reviews: [],
      reviewRevocations: [],
    });
    expect(result.blockers.map((b) => b.code)).toContain("dossier_not_ready");
  });

  it("ready_for_review with all mandatory evidence verified produces no dossier_not_ready blocker", () => {
    const d = makeDossier();
    const req = requirement({ dossierId: d.id, dossierRevision: d.revision });
    const ev = evidenceItem({ dossierId: d.id });
    const link = acceptedLink({ dossierId: d.id, requirementId: req.id, evidenceItemId: ev.id });
    const result = deriveDossierApprovalReadiness({
      policy: { ...OFF_POLICY, requireRegulatoryDossier: true, requireDossierReadyForReview: true },
      formulaVersionId: "version-1",
      packagingSkuCode: "SKU-1",
      jurisdictions: ["KE"],
      dossiers: [d],
      requirements: [req],
      links: [link],
      evidenceItems: [ev],
      reviews: [],
      reviewRevocations: [],
    });
    expect(result.blockers.map((b) => b.code)).not.toContain("dossier_not_ready");
  });

  it("dossier_review_incomplete blocks when no active approved review exists for the current revision", () => {
    const d = makeDossier();
    const result = deriveDossierApprovalReadiness({
      policy: { ...OFF_POLICY, requireRegulatoryDossier: true, requireDossierReviewComplete: true },
      formulaVersionId: "version-1",
      packagingSkuCode: "SKU-1",
      jurisdictions: ["KE"],
      dossiers: [d],
      requirements: [],
      links: [],
      evidenceItems: [],
      reviews: [],
      reviewRevocations: [],
    });
    expect(result.blockers.map((b) => b.code)).toContain("dossier_review_incomplete");
  });

  it("an approved review for the exact revision clears dossier_review_incomplete", () => {
    const d = makeDossier();
    const review = recordDossierReview(
      { dossierId: d.id, dossierRevision: d.revision, outcome: "approved", notes: "All good.", requirementSnapshot: [], evidenceSnapshot: [] },
      REGULATORY_ACTOR,
    );
    const result = deriveDossierApprovalReadiness({
      policy: { ...OFF_POLICY, requireRegulatoryDossier: true, requireDossierReviewComplete: true },
      formulaVersionId: "version-1",
      packagingSkuCode: "SKU-1",
      jurisdictions: ["KE"],
      dossiers: [d],
      requirements: [],
      links: [],
      evidenceItems: [],
      reviews: [review],
      reviewRevocations: [],
    });
    expect(result.blockers.map((b) => b.code)).not.toContain("dossier_review_incomplete");
  });

  it("dossier_mandatory_evidence_missing and dossier_evidence_expired are distinct, independently-gated blockers", () => {
    const d = makeDossier();
    const req = requirement({ dossierId: d.id, dossierRevision: d.revision });
    const expiredEv = evidenceItem({ dossierId: d.id, expiresAt: "2020-01-01T00:00:00.000Z" });
    const link = acceptedLink({ dossierId: d.id, requirementId: req.id, evidenceItemId: expiredEv.id });

    const missingResult = deriveDossierApprovalReadiness({
      policy: { ...OFF_POLICY, requireRegulatoryDossier: true, requireNoMissingMandatoryDossierEvidence: true },
      formulaVersionId: "version-1",
      packagingSkuCode: "SKU-1",
      jurisdictions: ["KE"],
      dossiers: [d],
      requirements: [req],
      links: [],
      evidenceItems: [],
      reviews: [],
      reviewRevocations: [],
    });
    expect(missingResult.blockers.map((b) => b.code)).toContain("dossier_mandatory_evidence_missing");

    const expiredResult = deriveDossierApprovalReadiness({
      policy: { ...OFF_POLICY, requireRegulatoryDossier: true, requireNoExpiredMandatoryDossierEvidence: true },
      formulaVersionId: "version-1",
      packagingSkuCode: "SKU-1",
      jurisdictions: ["KE"],
      dossiers: [d],
      requirements: [req],
      links: [link],
      evidenceItems: [expiredEv],
      reviews: [],
      reviewRevocations: [],
    });
    expect(expiredResult.blockers.map((b) => b.code)).toContain("dossier_evidence_expired");
  });
});
