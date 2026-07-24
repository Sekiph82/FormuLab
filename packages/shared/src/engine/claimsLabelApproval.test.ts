import { describe, expect, it } from "vitest";
import { deriveClaimsLabelApprovalReadiness, type ClaimsLabelApprovalPolicy, type DeriveClaimsLabelApprovalReadinessInput } from "./claimsLabelApproval";
import { createClaim, recordClaimReview } from "./claims";
import { createLabel, recordLabelReview, setLabelContent, uploadArtwork, approveArtwork } from "./labels";
import type { Actor } from "../schemas/status";
import type { FormulationVersion } from "../schemas/formulation";

const HUMAN: Actor = { kind: "human", role: "researcher", userId: "alice" };
const REGULATORY_ACTOR: Actor = { kind: "human", role: "regulatory", userId: "bob" };

const VERSION: Pick<FormulationVersion, "id" | "lines"> = { id: "version-1", lines: [] };

function baseInput(over: Partial<DeriveClaimsLabelApprovalReadinessInput> = {}): DeriveClaimsLabelApprovalReadinessInput {
  return {
    policy: {},
    formulationName: "Test Project",
    formulaVersion: VERSION,
    jurisdictions: ["KE"],
    requiredLanguages: ["en"],
    claims: [],
    claimLinks: [],
    claimReviews: [],
    claimReviewRevocations: [],
    dossierEvidence: [],
    labels: [],
    labelContent: [],
    labelArtworks: [],
    labelReviews: [],
    labelReviewRevocations: [],
    rules: [],
    ...over,
  };
}

describe("deriveClaimsLabelApprovalReadiness", () => {
  it("is ready with no blockers when no gate is enabled, even with prohibited claims and no labels", () => {
    const claim = { ...createClaim({ claimCode: "CLM-1", claimText: "Cures disease", formulationId: "p1", formulaVersionId: "version-1", jurisdictions: ["KE"], languages: ["en"] }, HUMAN), status: "prohibited" as const };
    const result = deriveClaimsLabelApprovalReadiness(baseInput({ claims: [claim] }));
    expect(result).toEqual({ ready: true, blockers: [] });
  });

  it("never lets a prohibited claim recorded against a DIFFERENT formula version block this one", () => {
    const claim = { ...createClaim({ claimCode: "CLM-1", claimText: "Cures disease", formulationId: "p1", formulaVersionId: "version-OTHER", jurisdictions: ["KE"], languages: ["en"] }, HUMAN), status: "prohibited" as const };
    const policy: ClaimsLabelApprovalPolicy = { requireNoProhibitedClaims: true };
    const result = deriveClaimsLabelApprovalReadiness(baseInput({ policy, claims: [claim] }));
    expect(result).toEqual({ ready: true, blockers: [] });
  });

  it("requireNoProhibitedClaims blocks on a prohibited claim", () => {
    const claim = { ...createClaim({ claimCode: "CLM-1", claimText: "Cures disease", formulationId: "p1", formulaVersionId: "version-1", jurisdictions: ["KE"], languages: ["en"] }, HUMAN), status: "prohibited" as const };
    const policy: ClaimsLabelApprovalPolicy = { requireNoProhibitedClaims: true };
    const result = deriveClaimsLabelApprovalReadiness(baseInput({ policy, claims: [claim] }));
    expect(result.ready).toBe(false);
    expect(result.blockers.some((b) => b.code === "claims_prohibited_present")).toBe(true);
  });

  it("requireAllClaimsReviewed blocks a claim with no active review, and clears once one is recorded", () => {
    const claim = createClaim({ claimCode: "CLM-1", claimText: "Gentle formula", formulationId: "p1", formulaVersionId: "version-1", jurisdictions: ["KE"], languages: ["en"] }, HUMAN);
    const policy: ClaimsLabelApprovalPolicy = { requireAllClaimsReviewed: true };
    const withoutReview = deriveClaimsLabelApprovalReadiness(baseInput({ policy, claims: [claim] }));
    expect(withoutReview.blockers.some((b) => b.code === "claims_missing_review")).toBe(true);

    const review = recordClaimReview(
      { claimId: claim.id, claimRevision: 1, formulationId: "p1", formulaVersionId: "version-1", jurisdiction: "KE", language: "en", outcome: "supported", notes: "fine" },
      REGULATORY_ACTOR,
    );
    const withReview = deriveClaimsLabelApprovalReadiness(baseInput({ policy, claims: [claim], claimReviews: [review] }));
    expect(withReview.blockers.some((b) => b.code === "claims_missing_review")).toBe(false);
  });

  it("requireNoUnsupportedClaims flags an unsupported claim and missing evidence", () => {
    const claim = createClaim({ claimCode: "CLM-1", claimText: "Softens skin", formulationId: "p1", formulaVersionId: "version-1", jurisdictions: ["KE"], languages: ["en"] }, HUMAN);
    const policy: ClaimsLabelApprovalPolicy = { requireNoUnsupportedClaims: true };
    const result = deriveClaimsLabelApprovalReadiness(baseInput({ policy, claims: [claim] }));
    expect(result.blockers.some((b) => b.code === "claims_unsupported_present")).toBe(true);
    expect(result.blockers.some((b) => b.code === "claims_evidence_missing")).toBe(true);
  });

  it("requireLabelReviewComplete and requireArtworkApproved block a missing label, then clear once satisfied", () => {
    const policy: ClaimsLabelApprovalPolicy = { requireLabelReviewComplete: true, requireArtworkApproved: true };
    const noLabel = deriveClaimsLabelApprovalReadiness(baseInput({ policy }));
    expect(noLabel.blockers.some((b) => b.code === "label_missing")).toBe(true);
    expect(noLabel.blockers.some((b) => b.code === "label_language_missing")).toBe(true);

    const label = createLabel({ labelCode: "LBL-1", formulationId: "p1", formulaVersionId: "version-1", jurisdiction: "KE", language: "en" }, HUMAN);
    const artwork = { ...uploadArtwork({ labelId: label.id, labelRevision: 1, artworkCode: "ART-1", attachmentIds: [{ id: "a1", kind: "document" as const, title: "art", location: "art.pdf" }] }, HUMAN) };
    const approvedArtwork = approveArtwork(artwork, REGULATORY_ACTOR);
    const withMissingArtwork = deriveClaimsLabelApprovalReadiness(baseInput({ policy, labels: [label] }));
    expect(withMissingArtwork.blockers.some((b) => b.code === "label_artwork_missing")).toBe(true);
    expect(withMissingArtwork.blockers.some((b) => b.code === "label_review_incomplete")).toBe(true);

    const review = recordLabelReview(
      { labelId: label.id, labelRevision: 1, artworkId: approvedArtwork.id, artworkRevision: 1, formulaVersionId: "version-1", jurisdiction: "KE", language: "en", outcome: "approved", notes: "ok" },
      REGULATORY_ACTOR,
    );
    const resolved = deriveClaimsLabelApprovalReadiness(baseInput({ policy, labels: [label], labelArtworks: [approvedArtwork], labelReviews: [review] }));
    expect(resolved.blockers.some((b) => b.code === "label_artwork_missing")).toBe(false);
    expect(resolved.blockers.some((b) => b.code === "label_review_incomplete")).toBe(false);
  });

  it("requireFormulaLabelConsistency blocks on a label pointing at the wrong formula version", () => {
    const label = { ...createLabel({ labelCode: "LBL-1", formulationId: "p1", formulaVersionId: "version-OTHER", jurisdiction: "KE", language: "en" }, HUMAN) };
    const policy: ClaimsLabelApprovalPolicy = { requireFormulaLabelConsistency: true };
    const result = deriveClaimsLabelApprovalReadiness(baseInput({ policy, labels: [label] }));
    expect(result.blockers.some((b) => b.code === "label_wrong_formula_version")).toBe(true);
  });

  it("flags mandatory label content missing regardless of which label gate is on", () => {
    const label = createLabel({ labelCode: "LBL-1", formulationId: "p1", formulaVersionId: "version-1", jurisdiction: "KE", language: "en" }, HUMAN);
    const policy: ClaimsLabelApprovalPolicy = { requireArtworkApproved: true };
    const result = deriveClaimsLabelApprovalReadiness(baseInput({ policy, labels: [label] }));
    expect(result.blockers.some((b) => b.code === "label_content_missing")).toBe(true);
  });

  it("a fully satisfied scope produces no blockers", () => {
    const label = createLabel({ labelCode: "LBL-1", formulationId: "p1", formulaVersionId: "version-1", jurisdiction: "KE", language: "en" }, HUMAN);
    const blockTypes = ["product_name", "net_quantity", "ingredients", "directions", "warnings", "manufacturer", "batch_code"] as const;
    const blocks = blockTypes.map((bt) => setLabelContent({ labelId: label.id, labelRevision: 1, blockType: bt, text: "x", language: "en" }, HUMAN));
    const artwork = approveArtwork(uploadArtwork({ labelId: label.id, labelRevision: 1, artworkCode: "ART-1", attachmentIds: [{ id: "a1", kind: "document" as const, title: "art", location: "art.pdf" }] }, HUMAN), REGULATORY_ACTOR);
    const review = recordLabelReview({ labelId: label.id, labelRevision: 1, artworkId: artwork.id, artworkRevision: 1, formulaVersionId: "version-1", jurisdiction: "KE", language: "en", outcome: "approved", notes: "ok" }, REGULATORY_ACTOR);
    const policy: ClaimsLabelApprovalPolicy = { requireLabelReviewComplete: true, requireArtworkApproved: true, requireFormulaLabelConsistency: true, requireAllRequiredLanguagesReviewed: true };
    const result = deriveClaimsLabelApprovalReadiness(baseInput({ policy, labels: [label], labelContent: blocks, labelArtworks: [artwork], labelReviews: [review] }));
    expect(result).toEqual({ ready: true, blockers: [] });
  });
});
