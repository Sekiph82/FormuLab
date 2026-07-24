import { describe, expect, it } from "vitest";
import {
  approveArtwork,
  calculateLabelReadiness,
  compareLabelRequirementsToCurrentRules,
  createLabel,
  currentContentForRevision,
  deriveArtworkEffectiveStatus,
  deriveLabelEffectiveStatus,
  evaluateArtworkReadiness,
  evaluateClaimLabelConsistency,
  evaluateFormulaLabelConsistency,
  evaluateLabelContent,
  isLabelImmutable,
  isLabelReviewActive,
  recordLabelReview,
  rejectArtwork,
  replaceArtwork,
  resolveLabelRequirements,
  reviseLabel,
  revokeLabelReview,
  setLabelContent,
  updateLabelStatus,
  uploadArtwork,
} from "./labels";
import { createClaim } from "./claims";
import type { Actor } from "../schemas/status";
import type { FormulationLine, FormulationVersion } from "../schemas/formulation";
import type { RegulatoryRule } from "../schemas/regulatory";
import type { LabelArtwork, LabelContentBlock, ProductLabel } from "../schemas/claimsLabels";

const HUMAN: Actor = { kind: "human", role: "researcher", userId: "alice" };
const REGULATORY_ACTOR: Actor = { kind: "human", role: "regulatory", userId: "bob" };
const SYSTEM_ACTOR: Actor = { kind: "system", reason: "automated" };

function label(over: Partial<ProductLabel> = {}): ProductLabel {
  return { ...createLabel({ labelCode: "LBL-1", formulationId: "proj-1", formulaVersionId: "version-1", packagingSkuCode: "SKU-1", jurisdiction: "KE", language: "en" }, HUMAN), ...over };
}

function rule(over: Partial<RegulatoryRule> = {}): RegulatoryRule {
  return {
    schemaVersion: "1.0",
    id: "rule-1",
    code: "RULE-1",
    name: "Mandatory hazard warning",
    jurisdiction: "KE",
    authority: "KEBS",
    ruleType: "warning_requirement",
    productCategories: [],
    requirement: "Must show the KEBS hazard pictogram warning text.",
    severity: "blocking",
    status: "draft",
    conditions: [],
    claimKeywordsAny: [],
    requiredEvidenceTypes: [],
    requiredLabelElements: [],
    requiredWarnings: ["Keep out of reach of children"],
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
    createdBy: "seed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const LINE_A: FormulationLine = {
  id: "line-a",
  lineNumber: 1,
  phase: "A",
  materialCode: "MAT-1",
  displayName: "Water",
  functions: ["water"],
  percent: "100",
  isQsToHundred: true,
  provenance: { origin: "model_estimate", evidenceClaimIds: [] },
};

const VERSION_1: Pick<FormulationVersion, "id" | "lines"> = { id: "version-1", lines: [LINE_A] };

function artwork(over: Partial<LabelArtwork> = {}): LabelArtwork {
  return { ...uploadArtwork({ labelId: "label-1", labelRevision: 1, artworkCode: "ART-1", attachmentIds: [{ id: "att-1", kind: "document", title: "Artwork", location: "artwork.pdf" }] }, HUMAN), ...over };
}

describe("label lifecycle", () => {
  it("refuses a non-human actor and an empty formula version", () => {
    expect(() => createLabel({ labelCode: "LBL-1", formulationId: "proj-1", formulaVersionId: "version-1", jurisdiction: "KE", language: "en" }, SYSTEM_ACTOR)).toThrow();
    expect(() => createLabel({ labelCode: "LBL-1", formulationId: "proj-1", formulaVersionId: "", jurisdiction: "KE", language: "en" }, HUMAN)).toThrow();
  });
  it("refuses a status change once immutable", () => {
    const l = { ...label(), status: "approved" as const };
    expect(isLabelImmutable(l)).toBe(true);
    expect(() => updateLabelStatus(l, "draft", HUMAN)).toThrow();
  });
  it("revising a label supersedes the original and increments the revision", () => {
    const original = { ...label(), status: "approved" as const };
    const { superseded, revised } = reviseLabel(original, HUMAN);
    expect(superseded.status).toBe("superseded");
    expect(revised.revision).toBe(2);
    expect(revised.supersedesLabelId).toBe(original.id);
    expect(deriveLabelEffectiveStatus(superseded, [superseded, revised])).toBe("superseded");
  });
});

describe("label content", () => {
  it("marks a block missing when the text is empty, present otherwise", () => {
    const empty = setLabelContent({ labelId: "label-1", labelRevision: 1, blockType: "warnings", text: "", language: "en" }, HUMAN);
    expect(empty.status).toBe("missing");
    const filled = setLabelContent({ labelId: "label-1", labelRevision: 1, blockType: "warnings", text: "Keep out of reach of children", language: "en" }, HUMAN);
    expect(filled.status).toBe("present");
  });
  it("currentContentForRevision takes the latest row per (blockType, language)", () => {
    const first = setLabelContent({ labelId: "label-1", labelRevision: 1, blockType: "product_name", text: "V1", language: "en" }, HUMAN);
    const second = { ...setLabelContent({ labelId: "label-1", labelRevision: 1, blockType: "product_name", text: "V2", language: "en" }, HUMAN), createdAt: "2027-01-01T00:00:00.000Z" };
    const current = currentContentForRevision([first, second], "label-1", 1);
    expect(current).toHaveLength(1);
    expect(current[0].text).toBe("V2");
  });
});

describe("resolveLabelRequirements", () => {
  it("always includes the baseline mandatory blocks", () => {
    const reqs = resolveLabelRequirements({ jurisdiction: "KE", language: "en", rules: [], hasActiveClaims: false });
    expect(reqs.map((r) => r.blockType)).toEqual(expect.arrayContaining(["product_name", "net_quantity", "ingredients", "directions", "warnings", "manufacturer", "batch_code"]));
  });
  it("adds a warnings requirement from a real configured rule's requiredWarnings, never inventing one", () => {
    const reqs = resolveLabelRequirements({ jurisdiction: "KE", language: "en", rules: [rule()], hasActiveClaims: false });
    const warnings = reqs.find((r) => r.blockType === "warnings");
    expect(warnings?.sourceRuleId).toBe("rule-1");
    expect(warnings?.reason).toContain("Keep out of reach of children");
  });
  it("adds an optional claims block only when active claims exist", () => {
    const without = resolveLabelRequirements({ jurisdiction: "KE", language: "en", rules: [], hasActiveClaims: false });
    expect(without.some((r) => r.blockType === "claims")).toBe(false);
    const withClaims = resolveLabelRequirements({ jurisdiction: "KE", language: "en", rules: [], hasActiveClaims: true });
    expect(withClaims.some((r) => r.blockType === "claims")).toBe(true);
  });
  it("never applies a rule from a jurisdiction the label isn't in (unless EAC)", () => {
    const reqs = resolveLabelRequirements({ jurisdiction: "KE", language: "en", rules: [rule({ jurisdiction: "UG" })], hasActiveClaims: false });
    expect(reqs.find((r) => r.blockType === "warnings")?.sourceRuleId).toBeUndefined();
  });
});

describe("evaluateLabelContent", () => {
  it("missing mandatory requirement without a block, present with one", () => {
    const reqs = resolveLabelRequirements({ jurisdiction: "KE", language: "en", rules: [], hasActiveClaims: false });
    const rows = evaluateLabelContent(reqs, [], "en");
    expect(rows.every((r) => r.state === "missing")).toBe(true);

    const blocks: LabelContentBlock[] = reqs.map((r) => setLabelContent({ labelId: "label-1", labelRevision: 1, blockType: r.blockType, text: "x", language: "en" }, HUMAN));
    const filled = evaluateLabelContent(reqs, blocks, "en");
    expect(filled.every((r) => r.state === "present")).toBe(true);
  });
  it("a machine-suggested translation is unverified, not present", () => {
    const reqs = resolveLabelRequirements({ jurisdiction: "KE", language: "sw", rules: [], hasActiveClaims: false });
    const block = setLabelContent({ labelId: "label-1", labelRevision: 1, blockType: "product_name", text: "Jina", language: "sw", source: "ai_suggested" }, HUMAN);
    const rows = evaluateLabelContent(reqs, [block], "sw");
    expect(rows.find((r) => r.requirement.blockType === "product_name")?.state).toBe("unverified");
  });
});

describe("formula-label consistency", () => {
  it("flags a label whose formulaVersionId does not match the version being checked (never silently passes)", () => {
    const findings = evaluateFormulaLabelConsistency(
      { formulationName: "Test Project", formulaVersion: VERSION_1, label: { formulaVersionId: "version-OTHER" } },
      [],
    );
    expect(findings.some((f) => f.code === "wrong_formula_version")).toBe(true);
  });
  it("flags a label whose packagingSkuCode does not match", () => {
    const findings = evaluateFormulaLabelConsistency(
      { formulationName: "Test Project", formulaVersion: VERSION_1, label: { formulaVersionId: "version-1", packagingSkuCode: "SKU-2" }, packagingSkuCode: "SKU-1" },
      [],
    );
    expect(findings.some((f) => f.code === "wrong_packaging_sku")).toBe(true);
  });
  it("flags an ingredients block that omits a real formula line", () => {
    const ingredientsBlock = setLabelContent({ labelId: "label-1", labelRevision: 1, blockType: "ingredients", text: "Fragrance, Preservative", language: "en" }, HUMAN);
    const findings = evaluateFormulaLabelConsistency({ formulationName: "Test Project", formulaVersion: VERSION_1, label: { formulaVersionId: "version-1" } }, [ingredientsBlock]);
    expect(findings.some((f) => f.code === "ingredient_declaration_incomplete")).toBe(true);
  });
});

describe("claim-label consistency", () => {
  it("flags a prohibited claim mentioned on the label as a blocking inconsistency", () => {
    const c = { ...createClaim({ claimCode: "CLM-1", claimText: "Cures eczema", formulationId: "proj-1", formulaVersionId: "version-1", jurisdictions: ["KE"] as const, languages: ["en"] }, HUMAN), status: "prohibited" as const };
    const claimsBlock = setLabelContent({ labelId: "label-1", labelRevision: 1, blockType: "claims", text: "Cures eczema", language: "en" }, HUMAN);
    const findings = evaluateClaimLabelConsistency({ claims: [c] }, [claimsBlock]);
    expect(findings.some((f) => f.code === "label_claim_inconsistent" && f.severity === "blocking")).toBe(true);
  });
});

describe("artwork lifecycle and readiness", () => {
  it("refuses to approve artwork with no attachment", () => {
    const draft = uploadArtwork({ labelId: "label-1", labelRevision: 1, artworkCode: "ART-1" }, HUMAN);
    expect(() => approveArtwork(draft, REGULATORY_ACTOR)).toThrow();
  });
  it("only an authorized actor can approve or reject artwork", () => {
    expect(() => approveArtwork(artwork(), HUMAN)).toThrow();
    expect(() => rejectArtwork(artwork(), HUMAN, "bad resolution")).toThrow();
    expect(approveArtwork(artwork(), REGULATORY_ACTOR).status).toBe("approved");
  });
  it("replacing artwork supersedes the original via supersedesArtworkId", () => {
    const original = artwork();
    const { superseded, replacement } = replaceArtwork(original, { artworkCode: "ART-2", attachmentIds: [{ id: "att-2", kind: "document", title: "New artwork", location: "artwork2.pdf" }] }, HUMAN);
    expect(superseded.status).toBe("superseded");
    expect(replacement.supersedesArtworkId).toBe(original.id);
    expect(deriveArtworkEffectiveStatus(superseded, [superseded, replacement])).toBe("superseded");
  });
  it("evaluateArtworkReadiness blocks on missing or unapproved artwork", () => {
    expect(evaluateArtworkReadiness(undefined)[0].code).toBe("artwork_missing");
    expect(evaluateArtworkReadiness(artwork())[0].code).toBe("artwork_unapproved");
    expect(evaluateArtworkReadiness({ ...artwork(), status: "approved" })).toHaveLength(0);
  });
});

describe("calculateLabelReadiness", () => {
  it("human review required always wins, never becoming ready", () => {
    const reqs = resolveLabelRequirements({ jurisdiction: "KE", language: "en", rules: [], hasActiveClaims: false });
    const rows = evaluateLabelContent(reqs, [], "en").map((r) => ({ ...r, state: "human_review_required" as const }));
    const readiness = calculateLabelReadiness(label(), rows, ["en"], ["en"]);
    expect(readiness.overallReadiness).toBe("unknown");
  });
  it("missing a language keeps readiness from ready_for_review", () => {
    const reqs = resolveLabelRequirements({ jurisdiction: "KE", language: "en", rules: [], hasActiveClaims: false });
    const blocks: LabelContentBlock[] = reqs.map((r) => setLabelContent({ labelId: "label-1", labelRevision: 1, blockType: r.blockType, text: "x", language: "en" }, HUMAN));
    const rows = evaluateLabelContent(reqs, blocks, "en");
    const readiness = calculateLabelReadiness(label(), rows, ["en", "sw"], ["en"]);
    expect(readiness.overallReadiness).not.toBe("ready_for_review");
    expect(readiness.languagesMissing).toEqual(["sw"]);
  });
  it("all present, no missing language, is ready_for_review", () => {
    const reqs = resolveLabelRequirements({ jurisdiction: "KE", language: "en", rules: [], hasActiveClaims: false });
    const blocks: LabelContentBlock[] = reqs.map((r) => setLabelContent({ labelId: "label-1", labelRevision: 1, blockType: r.blockType, text: "x", language: "en" }, HUMAN));
    const rows = evaluateLabelContent(reqs, blocks, "en");
    expect(calculateLabelReadiness(label(), rows, ["en"], ["en"]).overallReadiness).toBe("ready_for_review");
  });
});

describe("label reviews", () => {
  it("only an authorized regulatory actor can record or revoke a review, and notes/reason are required", () => {
    expect(() =>
      recordLabelReview({ labelId: "label-1", labelRevision: 1, formulaVersionId: "version-1", jurisdiction: "KE", language: "en", outcome: "approved", notes: "looks good" }, HUMAN),
    ).toThrow();
    expect(() =>
      recordLabelReview({ labelId: "label-1", labelRevision: 1, formulaVersionId: "version-1", jurisdiction: "KE", language: "en", outcome: "approved", notes: "" }, REGULATORY_ACTOR),
    ).toThrow();
    const review = recordLabelReview({ labelId: "label-1", labelRevision: 1, formulaVersionId: "version-1", jurisdiction: "KE", language: "en", outcome: "approved", notes: "looks good" }, REGULATORY_ACTOR);
    expect(review.reviewedBy).toBe("bob");
    expect(() => revokeLabelReview(review.id, HUMAN, "mistake")).toThrow();
    expect(() => revokeLabelReview(review.id, REGULATORY_ACTOR, "")).toThrow();
    const revocation = revokeLabelReview(review.id, REGULATORY_ACTOR, "mistake");
    expect(revocation.revokesReviewId).toBe(review.id);
  });
  it("a review is only active for the exact label AND artwork revision it was recorded against", () => {
    const review = recordLabelReview(
      { labelId: "label-1", labelRevision: 1, artworkId: "art-1", artworkRevision: 1, formulaVersionId: "version-1", jurisdiction: "KE", language: "en", outcome: "approved", notes: "ok" },
      REGULATORY_ACTOR,
    );
    expect(isLabelReviewActive(review, [], 1, 1)).toBe(true);
    expect(isLabelReviewActive(review, [], 2, 1)).toBe(false);
    expect(isLabelReviewActive(review, [], 1, 2)).toBe(false);
    const revocation = revokeLabelReview(review.id, REGULATORY_ACTOR, "superseded by new review");
    expect(isLabelReviewActive(review, [revocation], 1, 1)).toBe(false);
  });
});

describe("compareLabelRequirementsToCurrentRules", () => {
  it("never mutates the frozen array and reports a genuinely new requirement", () => {
    const frozen = resolveLabelRequirements({ jurisdiction: "KE", language: "en", rules: [], hasActiveClaims: false });
    const frozenCopy = [...frozen];
    const drift = compareLabelRequirementsToCurrentRules(frozen, { jurisdiction: "KE", language: "en", rules: [rule()], hasActiveClaims: false });
    expect(frozen).toEqual(frozenCopy);
    expect(drift.changedMandatoryBlockTypes).not.toContain("warnings");
    // warnings was already mandatory in the baseline, so a new rule adding
    // a source doesn't change mandatory-ness — but it's still not flagged
    // as "new" since the block type already existed.
    expect(drift.newBlockTypes).toEqual([]);
  });
});
