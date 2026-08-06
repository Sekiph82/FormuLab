import { describe, expect, it } from "vitest";
import { assembleDossierExportSnapshot, type DossierExportSnapshotInput } from "./dossierExportAssembly";
import type {
  RegulatoryDossier,
  RegulatoryDossierEvidenceItem,
  RegulatoryDossierManualRequirementAction,
  RegulatoryDossierRequirement,
  RegulatoryDossierReview,
  RegulatoryDossierReviewRevocation,
  RegulatoryDossierSubmission,
  RegulatoryRequirementEvidenceLink,
} from "../schemas/dossier";

const DOSSIER: RegulatoryDossier = {
  schemaVersion: "1.0",
  id: "dossier-1",
  dossierCode: "TEST-DOSS-001",
  title: "Test Dossier",
  formulationId: "formulation-1",
  formulaVersionId: "version-1",
  jurisdictions: ["KE"],
  productFamilyCode: "HAIR_CARE",
  targetMarkets: ["KE"],
  status: "draft",
  revision: 1,
  createdBy: "u1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function req(overrides: Partial<RegulatoryDossierRequirement> = {}): RegulatoryDossierRequirement {
  return {
    schemaVersion: "1.0",
    id: "req-a",
    dossierId: DOSSIER.id,
    dossierRevision: 1,
    jurisdiction: "KE",
    requirementCode: "REQ-A",
    requirementType: "document",
    title: "Requirement A",
    isManual: false,
    mandatory: true,
    critical: false,
    applicabilityStatus: "applicable",
    applicabilityReason: "Applies to KE.",
    evidenceRequirement: true,
    documentTypesAccepted: ["sds"],
    minimumEvidenceCount: 1,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const REQ_A = req();
const REQ_B = req({ id: "req-b", requirementCode: "REQ-B", documentTypesAccepted: ["coa"] });

function evidence(overrides: Partial<RegulatoryDossierEvidenceItem> = {}): RegulatoryDossierEvidenceItem {
  return {
    schemaVersion: "1.0",
    id: "evid-new",
    dossierId: DOSSIER.id,
    formulationId: DOSSIER.formulationId,
    formulaVersionId: DOSSIER.formulaVersionId,
    jurisdictions: ["KE"],
    evidenceType: "sds",
    title: "SDS document",
    status: "verified",
    sourceType: "uploaded",
    attachmentIds: [],
    confidentiality: "normal",
    createdBy: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const EVID_OLD = evidence({ id: "evid-old", status: "draft", title: "SDS v1" });
const EVID_NEW = evidence({ id: "evid-new", supersedesEvidenceId: "evid-old", title: "SDS v2" });
const EVID_THIRD = evidence({ id: "evid-third", evidenceType: "coa", title: "Draft COA", status: "draft" });

function link(overrides: Partial<RegulatoryRequirementEvidenceLink> = {}): RegulatoryRequirementEvidenceLink {
  return {
    schemaVersion: "1.0",
    id: "link-1",
    dossierId: DOSSIER.id,
    requirementId: "req-a",
    evidenceItemId: "evid-new",
    linkStatus: "accepted",
    linkedBy: "u1",
    linkedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

const LINK_ACCEPTED = link();
const LINK_REVOKED = link({ id: "link-2", requirementId: "req-b", evidenceItemId: "evid-old", linkStatus: "revoked" });
const LINK_PROPOSED = link({ id: "link-3", requirementId: "req-b", evidenceItemId: "evid-third", linkStatus: "proposed" });

const REVIEW: RegulatoryDossierReview = {
  schemaVersion: "1.0",
  id: "review-1",
  dossierId: DOSSIER.id,
  dossierRevision: 1,
  reviewedBy: "reviewer-1",
  reviewerRole: "regulatory",
  reviewedAt: "2026-01-03T00:00:00.000Z",
  outcome: "changes_requested",
  notes: "Missing COA for REQ-B.",
  requirementSnapshot: [REQ_A, REQ_B],
  evidenceSnapshot: [EVID_NEW],
  blockingIssues: ["req-b missing evidence"],
  warnings: [],
};

const REVOCATION: RegulatoryDossierReviewRevocation = {
  schemaVersion: "1.0",
  id: "revoke-1",
  revokesReviewId: "review-1",
  revokedBy: "u2",
  revokedByRole: "regulatory",
  revokedAt: "2026-01-04T00:00:00.000Z",
  reason: "Filed against the wrong revision.",
};

const SUBMISSION: RegulatoryDossierSubmission = {
  schemaVersion: "1.0",
  id: "sub-1",
  dossierId: DOSSIER.id,
  dossierRevision: 1,
  jurisdiction: "KE",
  submittedBy: "u1",
  submittedAt: "2026-01-05T00:00:00.000Z",
  status: "prepared",
  attachmentIds: [],
  updatedAt: "2026-01-05T00:00:00.000Z",
};

const MANUAL_ACTION: RegulatoryDossierManualRequirementAction = {
  schemaVersion: "1.0",
  id: "manual-1",
  dossierId: DOSSIER.id,
  dossierRevision: 1,
  action: "add",
  requirementId: "req-a",
  performedBy: "u1",
  performedByRole: "regulatory",
  performedAt: "2026-01-01T12:00:00.000Z",
  justification: "Manually required by local counsel.",
};

function baseInput(overrides: Partial<DossierExportSnapshotInput> = {}): DossierExportSnapshotInput {
  return {
    dossier: DOSSIER,
    dossierRevision: 1,
    requirements: [REQ_B, REQ_A], // deliberately unsorted
    evidenceItems: [EVID_OLD, EVID_NEW, EVID_THIRD],
    links: [LINK_ACCEPTED, LINK_REVOKED, LINK_PROPOSED],
    reviews: [REVIEW],
    reviewRevocations: [REVOCATION],
    submissions: [SUBMISSION],
    manualRequirementActions: [MANUAL_ACTION],
    generationTimestamp: "2026-02-01T00:00:00.000Z",
    generatedBy: "u3",
    ...overrides,
  };
}

describe("assembleDossierExportSnapshot — valid assembly", () => {
  it("assembles a valid snapshot", () => {
    const snap = assembleDossierExportSnapshot(baseInput());
    expect(snap.dossierCode).toBe("TEST-DOSS-001");
    expect(snap.requirements).toHaveLength(2);
    expect(snap.evidenceMatrix).toHaveLength(2);
  });

  it("produces deeply identical output for identical input", () => {
    const input = baseInput();
    const a = assembleDossierExportSnapshot(input);
    const b = assembleDossierExportSnapshot(input);
    expect(a).toEqual(b);
  });

  it("does not mutate input arrays", () => {
    const input = baseInput();
    const requirementsBefore = [...input.requirements];
    assembleDossierExportSnapshot(input);
    expect(input.requirements).toEqual(requirementsBefore);
    expect(input.requirements[0]!.id).toBe("req-b"); // still unsorted
  });

  it("preserves the exact requested dossier revision", () => {
    const snap = assembleDossierExportSnapshot(baseInput());
    expect(snap.meta.dossierRevision).toBe(1);
    expect(snap.source.dossierRevision).toBe(1);
  });

  it("orders requirements deterministically by requirementCode", () => {
    const snap = assembleDossierExportSnapshot(baseInput());
    expect(snap.requirements.map((r) => r.requirementCode)).toEqual(["REQ-A", "REQ-B"]);
  });

  it("orders evidence items deterministically by evidenceType then title", () => {
    const snap = assembleDossierExportSnapshot(baseInput());
    // evid-third is "coa" ("c" < "s"); within "sds", "SDS v1" < "SDS v2".
    expect(snap.evidenceItems.map((e) => e.id)).toEqual(["evid-third", "evid-old", "evid-new"]);
  });

  it("excludes requirements/reviews belonging to a different revision of the same dossier", () => {
    const staleReq = req({ id: "req-old", requirementCode: "REQ-OLD", dossierRevision: 0 });
    const staleReview: RegulatoryDossierReview = { ...REVIEW, id: "review-old", dossierRevision: 0 };
    const snap = assembleDossierExportSnapshot(
      baseInput({ requirements: [REQ_B, REQ_A, staleReq], reviews: [REVIEW, staleReview] }),
    );
    expect(snap.requirements.some((r) => r.id === "req-old")).toBe(false);
    expect(snap.reviews.some((r) => r.id === "review-old")).toBe(false);
  });

  it("does not count a revoked link as active evidence for its requirement", () => {
    const snap = assembleDossierExportSnapshot(baseInput());
    const rowB = snap.evidenceMatrix.find((r) => r.requirement.id === "req-b")!;
    expect(rowB.satisfaction).not.toBe("satisfied_verified");
    expect(rowB.linkedEvidence).toHaveLength(0);
  });

  it("keeps superseded evidence traceable but never presents it as current", () => {
    const snap = assembleDossierExportSnapshot(baseInput());
    const old = snap.evidenceItems.find((e) => e.id === "evid-old")!;
    expect(old.status).toBe("superseded"); // derived, even though stored status was "draft"
    expect(snap.evidenceItems.some((e) => e.id === "evid-new")).toBe(true);
  });

  it("does not treat a proposed evidence suggestion as accepted evidence", () => {
    const snap = assembleDossierExportSnapshot(baseInput());
    const rowB = snap.evidenceMatrix.find((r) => r.requirement.id === "req-b")!;
    expect(rowB.linkedEvidence.some((e) => e.id === "evid-third")).toBe(false);
  });

  it("surfaces missing mandatory evidence as a warning rather than fabricating content", () => {
    const snap = assembleDossierExportSnapshot(baseInput());
    expect(snap.warnings.some((w) => w.includes("REQ-B"))).toBe(true);
  });

  it("preserves review snapshots exactly", () => {
    const snap = assembleDossierExportSnapshot(baseInput());
    expect(snap.reviews[0]!.requirementSnapshot).toEqual([REQ_A, REQ_B]);
    expect(snap.reviews[0]!.evidenceSnapshot).toEqual([EVID_NEW]);
  });

  it("keeps review revocations visible", () => {
    const snap = assembleDossierExportSnapshot(baseInput());
    expect(snap.reviewRevocations).toHaveLength(1);
    expect(snap.reviewRevocations[0]!.id).toBe("revoke-1");
  });

  it("includes submissions as internal tracking only", () => {
    const snap = assembleDossierExportSnapshot(baseInput());
    expect(snap.submissions).toHaveLength(1);
    expect(snap.submissions[0]!.status).toBe("prepared");
  });

  it("leaves blank optional fields blank or absent", () => {
    const snap = assembleDossierExportSnapshot(baseInput());
    expect(snap.meta.packagingSkuCode).toBeUndefined();
    expect(snap.source.packagingSkuCode).toBeUndefined();
    expect(snap.source.approvalStatusAtGeneration).toBeUndefined();
  });

  it("preserves the explicit generation timestamp verbatim", () => {
    const snap = assembleDossierExportSnapshot(baseInput());
    expect(snap.generationTimestamp).toBe("2026-02-01T00:00:00.000Z");
  });

  it("never synthesizes an approval or verification field", () => {
    const snap = assembleDossierExportSnapshot(baseInput());
    expect(snap.dossierStatus).toBe("draft");
    expect(snap.approvalSnapshot).toBeUndefined();
    expect(Object.keys(snap)).not.toContain("approved");
    expect(Object.keys(snap)).not.toContain("verified");
  });
});

describe("assembleDossierExportSnapshot — rejections", () => {
  it("rejects a mismatched dossier revision", () => {
    expect(() => assembleDossierExportSnapshot(baseInput({ dossierRevision: 2 }))).toThrow();
  });

  it("rejects a requirement referencing a different dossier", () => {
    const foreign = req({ id: "req-foreign", dossierId: "other-dossier" });
    expect(() => assembleDossierExportSnapshot(baseInput({ requirements: [REQ_A, REQ_B, foreign] }))).toThrow();
  });
});
