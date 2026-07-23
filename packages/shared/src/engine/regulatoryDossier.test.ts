import { describe, expect, it } from "vitest";
import {
  acceptEvidenceLink,
  activeLinksForDossier,
  addDraftEvidence,
  addManualRequirement,
  buildDossierRequirementSnapshot,
  buildEvidenceMatrix,
  calculateDossierReadiness,
  compareDossierRequirementsToCurrentRules,
  createDossier,
  currentRequirementsForRevision,
  deriveDossierStatus,
  deriveEvidenceStatus,
  evaluateEvidenceEligibility,
  evaluateRequirementSatisfaction,
  excludeRequirement,
  isDossierImmutable,
  isDossierReviewActive,
  mapEvidenceToRequirements,
  proposeEvidenceLink,
  recordDossierReview,
  recordDossierSubmission,
  rejectEvidence,
  rejectEvidenceLink,
  replaceEvidence,
  resolveDossierRequirements,
  resolveDossierRevisionChain,
  resolveEvidenceRevisionChain,
  reviseDossier,
  revokeDossierReview,
  revokeEvidence,
  revokeEvidenceLink,
  updateDossierStatus,
  updateDossierSubmissionStatus,
  verifyEvidence,
} from "./regulatoryDossier";
import type { Actor } from "../schemas/status";
import type { RegulatoryDossierEvidenceItem, RegulatoryDossierRequirement, RegulatoryRequirementEvidenceLink } from "../schemas/dossier";
import type { RegulatoryFinding, RegulatoryJurisdiction, RegulatoryRule } from "../schemas/regulatory";

const REGULATORY_ACTOR: Actor = { kind: "human", role: "regulatory", userId: "alice" };
const QUALITY_ACTOR: Actor = { kind: "human", role: "quality", userId: "quinn" };
const ADMIN_ACTOR: Actor = { kind: "human", role: "administrator", userId: "root" };
const CHEMIST_ACTOR: Actor = { kind: "human", role: "chemist", userId: "bob" };
const AGENT_ACTOR: Actor = { kind: "agent", runId: "run-1" };
const IMPORT_ACTOR: Actor = { kind: "import", source: "spreadsheet.csv" };

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-06-01T00:00:00.000Z";

function rule(over: Partial<RegulatoryRule> = {}): RegulatoryRule {
  return {
    schemaVersion: "1.0",
    id: "rule-1",
    code: "KE-TEST-001",
    name: "Test rule",
    jurisdiction: "KE",
    authority: "Test authority",
    ruleType: "document_requirement",
    productCategories: [],
    requirement: "Placeholder.",
    severity: "blocking",
    status: "draft",
    conditions: [],
    claimKeywordsAny: [],
    requiredEvidenceTypes: [],
    requiredLabelElements: [],
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
    createdBy: "local",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function requirement(over: Partial<RegulatoryDossierRequirement> = {}): RegulatoryDossierRequirement {
  return {
    schemaVersion: "1.0",
    id: "req-1",
    dossierId: "dossier-1",
    dossierRevision: 1,
    jurisdiction: "KE",
    requirementCode: "KE-TEST-001:KE",
    requirementType: "document",
    title: "Test requirement",
    isManual: false,
    mandatory: true,
    critical: false,
    applicabilityStatus: "applicable",
    applicabilityReason: "test",
    evidenceRequirement: true,
    documentTypesAccepted: ["sds"],
    minimumEvidenceCount: 1,
    status: "active",
    createdAt: NOW,
    ...over,
  };
}

function evidence(over: Partial<RegulatoryDossierEvidenceItem> = {}): RegulatoryDossierEvidenceItem {
  return {
    schemaVersion: "1.0",
    id: "evidence-1",
    dossierId: "dossier-1",
    formulationId: "proj-1",
    formulaVersionId: "version-1",
    jurisdictions: ["KE"],
    evidenceType: "sds",
    title: "Test SDS",
    status: "verified",
    sourceType: "uploaded",
    attachmentIds: [{ id: "att-1", kind: "document", title: "SDS", location: "sds.pdf" }],
    confidentiality: "normal",
    createdBy: "alice",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function link(over: Partial<RegulatoryRequirementEvidenceLink> = {}): RegulatoryRequirementEvidenceLink {
  return {
    schemaVersion: "1.0",
    id: "link-1",
    dossierId: "dossier-1",
    requirementId: "req-1",
    evidenceItemId: "evidence-1",
    linkStatus: "accepted",
    linkedBy: "alice",
    linkedAt: NOW,
    ...over,
  };
}

describe("createDossier", () => {
  const input = {
    dossierCode: "DOS-1",
    title: "Test dossier",
    formulationId: "proj-1",
    formulaVersionId: "version-1",
    jurisdictions: ["KE"],
    productFamilyCode: "LP-HANDWASH",
  };

  it("refuses a non-human actor", () => {
    expect(() => createDossier({ ...input, jurisdictions: ["KE"] }, AGENT_ACTOR)).toThrow();
    expect(() => createDossier({ ...input, jurisdictions: ["KE"] }, IMPORT_ACTOR)).toThrow();
  });

  it("refuses an empty formula version id (rejects working-draft dossiers)", () => {
    expect(() => createDossier({ ...input, jurisdictions: ["KE"], formulaVersionId: "" }, CHEMIST_ACTOR)).toThrow();
  });

  it("refuses an empty jurisdiction list", () => {
    expect(() => createDossier({ ...input, jurisdictions: [] }, CHEMIST_ACTOR)).toThrow();
  });

  it("any human role may create a dossier, bound to the exact version", () => {
    const d = createDossier({ ...input, jurisdictions: ["KE"] }, CHEMIST_ACTOR);
    expect(d.formulaVersionId).toBe("version-1");
    expect(d.status).toBe("draft");
    expect(d.revision).toBe(1);
  });
});

describe("dossier revision lifecycle", () => {
  const dossier = createDossier(
    { dossierCode: "DOS-1", title: "t", formulationId: "proj-1", formulaVersionId: "version-1", jurisdictions: ["KE"], productFamilyCode: "LP-HANDWASH" },
    REGULATORY_ACTOR,
  );

  it("is immutable once submitted/superseded/archived", () => {
    expect(isDossierImmutable({ status: "draft" })).toBe(false);
    expect(isDossierImmutable({ status: "submitted" })).toBe(true);
    expect(isDossierImmutable({ status: "superseded" })).toBe(true);
    expect(isDossierImmutable({ status: "archived" })).toBe(true);
  });

  it("refuses to change status once immutable", () => {
    const submitted = { ...dossier, status: "submitted" as const };
    expect(() => updateDossierStatus(submitted, "draft", REGULATORY_ACTOR)).toThrow();
  });

  it("revising creates a new revision, marks the old one superseded, never mutates it in place", () => {
    const { superseded, revised } = reviseDossier(dossier, REGULATORY_ACTOR);
    expect(superseded.id).toBe(dossier.id);
    expect(superseded.status).toBe("superseded");
    expect(revised.id).not.toBe(dossier.id);
    expect(revised.revision).toBe(2);
    expect(revised.supersedesDossierId).toBe(dossier.id);
  });

  it("deriveDossierStatus reports superseded once a later dossier points back at it", () => {
    const { superseded, revised } = reviseDossier(dossier, REGULATORY_ACTOR);
    const original = { ...dossier, status: "in_preparation" as const }; // stored status not yet updated
    expect(deriveDossierStatus(original, [revised])).toBe("superseded");
    expect(deriveDossierStatus(revised, [revised])).toBe("draft");
    void superseded;
  });
});

describe("resolveDossierRequirements", () => {
  it("generates a requirement per applicable rule per jurisdiction, including EAC overlay", () => {
    const rules = [rule({ id: "r1", code: "KE-001", jurisdiction: "KE" }), rule({ id: "r2", code: "EAC-001", jurisdiction: "EAC" })];
    const rows = resolveDossierRequirements({ jurisdictions: ["KE"], productFamilyCode: "LP-HANDWASH", rules, findings: [] });
    expect(rows.map((r) => r.requirementCode).sort()).toEqual(["EAC-001:KE", "KE-001:KE"]);
  });

  it("generates requirements for every jurisdiction in scope", () => {
    const rules = [rule({ id: "r1", code: "KE-001", jurisdiction: "KE" }), rule({ id: "r2", code: "UG-001", jurisdiction: "UG" })];
    const rows = resolveDossierRequirements({ jurisdictions: ["KE", "UG"], productFamilyCode: "LP-HANDWASH", rules, findings: [] });
    expect(rows.map((r) => r.requirementCode).sort()).toEqual(["KE-001:KE", "UG-001:UG"]);
  });

  it("never generates a requirement for an inactive or deprecated rule", () => {
    const rules = [rule({ id: "r1", active: false }), rule({ id: "r2", status: "deprecated" })];
    const rows = resolveDossierRequirements({ jurisdictions: ["KE"], productFamilyCode: "LP-HANDWASH", rules, findings: [] });
    expect(rows).toHaveLength(0);
  });

  it("freezes the exact source rule id and version on each row", () => {
    const rules = [rule({ id: "r1", version: 3 })];
    const rows = resolveDossierRequirements({ jurisdictions: ["KE"], productFamilyCode: "LP-HANDWASH", rules, findings: [] });
    expect(rows[0].sourceRuleId).toBe("r1");
    expect(rows[0].sourceRuleVersion).toBe(3);
  });

  it("marks applicability human_review_required or not_applicable from a matching finding, never silently applicable", () => {
    const rules = [rule({ id: "r1" })];
    const findings: RegulatoryFinding[] = [
      {
        id: "f1",
        ruleId: "r1",
        ruleCode: "KE-TEST-001",
        ruleVersion: 1,
        jurisdiction: "KE",
        status: "human_review_required",
        severity: "warning",
        affectedMaterialCodes: [],
        affectedLineIds: [],
        reason: "needs review",
        evidenceRequired: [],
        verificationStatus: "not_verified",
      },
    ];
    const rows = resolveDossierRequirements({ jurisdictions: ["KE"], productFamilyCode: "LP-HANDWASH", rules, findings });
    expect(rows[0].applicabilityStatus).toBe("human_review_required");
  });
});

describe("buildDossierRequirementSnapshot / currentRequirementsForRevision", () => {
  it("builds persistable rows bound to the dossier's id and revision", () => {
    const rules = [rule({ id: "r1" })];
    const rows = buildDossierRequirementSnapshot({ id: "dossier-1", revision: 2 }, { jurisdictions: ["KE"], productFamilyCode: "x", rules, findings: [] });
    expect(rows[0].dossierId).toBe("dossier-1");
    expect(rows[0].dossierRevision).toBe(2);
    expect(rows[0].id).toBeTruthy();
  });

  it("takes the latest row per requirement code — a manual exclusion's new row wins over the original", () => {
    const original = requirement({ requirementCode: "A", createdAt: NOW, status: "active" });
    const excluded = requirement({ requirementCode: "A", id: "req-2", createdAt: LATER, status: "excluded" });
    const current = currentRequirementsForRevision([original, excluded], "dossier-1", 1);
    expect(current).toHaveLength(1);
    expect(current[0].status).toBe("excluded");
  });
});

describe("manual requirement actions", () => {
  const base = requirement();

  it("refuses an unauthorized actor for manual add", () => {
    expect(() =>
      addManualRequirement({ id: "dossier-1", revision: 1 }, { ...base, title: "manual" }, CHEMIST_ACTOR, "reason"),
    ).toThrow();
  });

  it("regulatory/quality/administrator may add a manual requirement with a justification", () => {
    for (const actor of [REGULATORY_ACTOR, QUALITY_ACTOR, ADMIN_ACTOR]) {
      const { requirement: req, action } = addManualRequirement({ id: "dossier-1", revision: 1 }, { ...base, title: "manual" }, actor, "Client asked for this.");
      expect(req.isManual).toBe(true);
      expect(action.action).toBe("add");
      expect(action.performedBy).toBe(actor.userId);
    }
  });

  it("refuses manual add without a justification", () => {
    expect(() => addManualRequirement({ id: "dossier-1", revision: 1 }, base, REGULATORY_ACTOR, "  ")).toThrow();
  });

  it("refuses an unauthorized actor for exclusion", () => {
    expect(() => excludeRequirement(base, CHEMIST_ACTOR, "not relevant")).toThrow();
    expect(() => excludeRequirement(base, AGENT_ACTOR, "not relevant")).toThrow();
  });

  it("excluding a requirement appends a new row, never mutates the original", () => {
    const { requirement: excluded, action } = excludeRequirement(base, REGULATORY_ACTOR, "Confirmed not applicable to this SKU.");
    expect(excluded.id).not.toBe(base.id);
    expect(excluded.status).toBe("excluded");
    expect(action.action).toBe("exclude");
    expect(base.status).toBe("active");
  });

  it("refuses exclusion without a justification", () => {
    expect(() => excludeRequirement(base, REGULATORY_ACTOR, "")).toThrow();
  });
});

describe("compareDossierRequirementsToCurrentRules (drift)", () => {
  it("detects a new requirement, a removed requirement, and a changed rule version", () => {
    const frozen = [requirement({ requirementCode: "KE-TEST-001:KE", sourceRuleVersion: 1 })];
    const rules = [rule({ id: "rule-1", code: "KE-TEST-001", version: 2 })];
    const drift = compareDossierRequirementsToCurrentRules(frozen, { jurisdictions: ["KE"], productFamilyCode: "x", rules, findings: [] });
    expect(drift.changedRuleVersionCodes).toContain("KE-TEST-001:KE");
  });

  it("detects a requirement that no longer exists in the active rule set", () => {
    const frozen = [requirement({ requirementCode: "GONE:KE" })];
    const drift = compareDossierRequirementsToCurrentRules(frozen, { jurisdictions: ["KE"], productFamilyCode: "x", rules: [], findings: [] });
    expect(drift.removedRequirementCodes).toContain("GONE:KE");
  });

  it("detects a brand-new requirement the frozen set never had", () => {
    const rules = [rule({ id: "rule-2", code: "NEW-RULE" })];
    const drift = compareDossierRequirementsToCurrentRules([], { jurisdictions: ["KE"], productFamilyCode: "x", rules, findings: [] });
    expect(drift.newRequirementCodes).toContain("NEW-RULE:KE");
  });

  it("never mutates the frozen requirement array itself", () => {
    const frozen = [requirement({ requirementCode: "KE-TEST-001:KE", sourceRuleVersion: 1 })];
    const rules = [rule({ id: "rule-1", code: "KE-TEST-001", version: 5 })];
    compareDossierRequirementsToCurrentRules(frozen, { jurisdictions: ["KE"], productFamilyCode: "x", rules, findings: [] });
    expect(frozen[0].sourceRuleVersion).toBe(1);
  });
});

describe("evidence lifecycle", () => {
  const draftInput = {
    dossierId: "dossier-1",
    formulationId: "proj-1",
    formulaVersionId: "version-1",
    jurisdictions: ["KE"] as RegulatoryJurisdiction[],
    evidenceType: "sds" as const,
    title: "SDS for surfactant",
    attachmentIds: [{ id: "att-1", kind: "document" as const, title: "SDS", location: "sds.pdf" }],
  };

  it("any human may add draft evidence; a non-human may not", () => {
    const e = addDraftEvidence(draftInput, CHEMIST_ACTOR);
    expect(e.status).toBe("present_unverified");
    expect(() => addDraftEvidence(draftInput, AGENT_ACTOR)).toThrow();
    expect(() => addDraftEvidence(draftInput, IMPORT_ACTOR)).toThrow();
  });

  it("refuses evidence with no formula version id", () => {
    expect(() => addDraftEvidence({ ...draftInput, formulaVersionId: "" }, CHEMIST_ACTOR)).toThrow();
  });

  it("with no attachments yet, evidence starts as draft", () => {
    const e = addDraftEvidence({ ...draftInput, attachmentIds: [] }, CHEMIST_ACTOR);
    expect(e.status).toBe("draft");
  });

  describe("verifyEvidence authorization", () => {
    const e = addDraftEvidence(draftInput, CHEMIST_ACTOR);
    it("refuses chemist, AI and import", () => {
      expect(() => verifyEvidence(e, CHEMIST_ACTOR)).toThrow();
      expect(() => verifyEvidence(e, AGENT_ACTOR)).toThrow();
      expect(() => verifyEvidence(e, IMPORT_ACTOR)).toThrow();
    });
    it("regulatory/quality/administrator may verify", () => {
      const verified = verifyEvidence(e, REGULATORY_ACTOR, "Looks correct.");
      expect(verified.status).toBe("verified");
      expect(verified.verifiedBy).toBe("alice");
    });
    it("refuses verification with no attachment", () => {
      const noAttachment = addDraftEvidence({ ...draftInput, attachmentIds: [] }, CHEMIST_ACTOR);
      expect(() => verifyEvidence(noAttachment, REGULATORY_ACTOR)).toThrow();
    });
  });

  it("rejectEvidence/revokeEvidence require an authorized actor and a reason", () => {
    const e = addDraftEvidence(draftInput, CHEMIST_ACTOR);
    expect(() => rejectEvidence(e, CHEMIST_ACTOR, "reason")).toThrow();
    expect(() => rejectEvidence(e, REGULATORY_ACTOR, "")).toThrow();
    expect(rejectEvidence(e, REGULATORY_ACTOR, "Wrong document.").status).toBe("rejected");
    expect(() => revokeEvidence(e, CHEMIST_ACTOR, "reason")).toThrow();
    expect(revokeEvidence(e, ADMIN_ACTOR, "Superseded by newer SDS.").status).toBe("revoked");
  });

  it("replaceEvidence supersedes the old item and links the new one via supersedesEvidenceId — any human may do it", () => {
    const original = addDraftEvidence(draftInput, CHEMIST_ACTOR);
    const { superseded, replacement } = replaceEvidence(original, { evidenceType: "sds", title: "Updated SDS", attachmentIds: draftInput.attachmentIds }, CHEMIST_ACTOR);
    expect(superseded.status).toBe("superseded");
    expect(superseded.id).toBe(original.id);
    expect(replacement.supersedesEvidenceId).toBe(original.id);
    expect(replacement.id).not.toBe(original.id);
  });

  it("deriveEvidenceStatus reports superseded once a later item points back, regardless of stored status", () => {
    const original = addDraftEvidence(draftInput, CHEMIST_ACTOR);
    const { replacement } = replaceEvidence(original, { evidenceType: "sds", title: "v2", attachmentIds: draftInput.attachmentIds }, CHEMIST_ACTOR);
    const staleOriginal = { ...original, status: "verified" as const }; // as if not yet updated in storage
    expect(deriveEvidenceStatus(staleOriginal, [replacement])).toBe("superseded");
  });

  it("resolveEvidenceRevisionChain walks back through every replaced version, none deleted", () => {
    const v1 = addDraftEvidence(draftInput, CHEMIST_ACTOR);
    const { replacement: v2 } = replaceEvidence(v1, { evidenceType: "sds", title: "v2", attachmentIds: draftInput.attachmentIds }, CHEMIST_ACTOR);
    const { replacement: v3 } = replaceEvidence(v2, { evidenceType: "sds", title: "v3", attachmentIds: draftInput.attachmentIds }, CHEMIST_ACTOR);
    const chain = resolveEvidenceRevisionChain(v3, [v1, v2, v3]);
    expect(chain.map((e) => e.title)).toEqual(["v3", "v2", "SDS for surfactant"]);
  });
});

describe("evaluateEvidenceEligibility", () => {
  const ctx = { formulaVersionId: "version-1", packagingSkuCode: "SKU-1", jurisdiction: "KE" as const };

  it("accepts an eligible item", () => {
    expect(evaluateEvidenceEligibility(evidence(), ctx).eligible).toBe(true);
  });

  it("rejects wrong formula version", () => {
    expect(evaluateEvidenceEligibility(evidence({ formulaVersionId: "version-2" }), ctx)).toEqual({ eligible: false, reason: "wrong_formula_version" });
  });

  it("rejects wrong packaging SKU", () => {
    expect(evaluateEvidenceEligibility(evidence({ packagingSkuCode: "SKU-2" }), ctx).eligible).toBe(false);
  });

  it("rejects wrong jurisdiction", () => {
    expect(evaluateEvidenceEligibility(evidence({ jurisdictions: ["UG"] }), ctx).eligible).toBe(false);
  });

  it("rejects expired evidence", () => {
    expect(evaluateEvidenceEligibility(evidence({ expiresAt: "2025-01-01T00:00:00.000Z" }), { ...ctx }).eligible).toBe(false);
  });

  it("rejects rejected/revoked/superseded evidence", () => {
    expect(evaluateEvidenceEligibility(evidence({ status: "rejected" }), ctx).eligible).toBe(false);
    expect(evaluateEvidenceEligibility(evidence({ status: "revoked" }), ctx).eligible).toBe(false);
    expect(evaluateEvidenceEligibility(evidence({ status: "superseded" }), ctx).eligible).toBe(false);
  });
});

describe("requirement <-> evidence links", () => {
  it("proposeEvidenceLink starts as proposed and requires a human", () => {
    expect(() => proposeEvidenceLink({ dossierId: "d1", requirementId: "r1", evidenceItemId: "e1" }, AGENT_ACTOR)).toThrow();
    const l = proposeEvidenceLink({ dossierId: "d1", requirementId: "r1", evidenceItemId: "e1" }, CHEMIST_ACTOR);
    expect(l.linkStatus).toBe("proposed");
  });

  it("a proposed link never satisfies a requirement", () => {
    const proposed = link({ linkStatus: "proposed" });
    const req = requirement();
    const row = evaluateRequirementSatisfaction(req, [proposed], [evidence()], { formulaVersionId: "version-1", jurisdiction: "KE" });
    expect(row.satisfaction).not.toBe("satisfied_verified");
    expect(row.satisfaction).toBe("missing");
  });

  it("an accepted link to verified, eligible evidence satisfies the requirement", () => {
    const accepted = acceptEvidenceLink(link({ linkStatus: "proposed" }), CHEMIST_ACTOR);
    const row = evaluateRequirementSatisfaction(requirement(), [accepted], [evidence()], { formulaVersionId: "version-1", jurisdiction: "KE" });
    expect(row.satisfaction).toBe("satisfied_verified");
  });

  it("a rejected link never satisfies", () => {
    const rejected = rejectEvidenceLink(link({ linkStatus: "proposed" }), CHEMIST_ACTOR, "Wrong document type.");
    const row = evaluateRequirementSatisfaction(requirement(), [rejected], [evidence()], { formulaVersionId: "version-1", jurisdiction: "KE" });
    expect(row.satisfaction).not.toBe("satisfied_verified");
  });

  it("a revoked link never satisfies, even if it was previously accepted", () => {
    const accepted = link({ linkStatus: "accepted" });
    const revoked = revokeEvidenceLink(accepted, CHEMIST_ACTOR, "Evidence turned out to be for a different SKU.");
    const active = activeLinksForDossier([accepted, revoked], "dossier-1");
    expect(active).toHaveLength(0);
  });

  it("one evidence item may be explicitly linked to multiple requirements", () => {
    const linkA = link({ id: "link-a", requirementId: "req-a", evidenceItemId: "evidence-1" });
    const linkB = link({ id: "link-b", requirementId: "req-b", evidenceItemId: "evidence-1" });
    const active = activeLinksForDossier([linkA, linkB], "dossier-1");
    expect(active.map((l) => l.requirementId).sort()).toEqual(["req-a", "req-b"]);
  });

  it("mapEvidenceToRequirements only ever suggests — never creates a link", () => {
    const req = requirement({ documentTypesAccepted: ["sds"] });
    const ev = evidence();
    const suggestions = mapEvidenceToRequirements([req], [ev], { formulaVersionId: "version-1" });
    expect(suggestions.get(req.id)).toEqual([ev]);
  });

  it("revoking requires a reason and a human actor", () => {
    expect(() => revokeEvidenceLink(link(), AGENT_ACTOR, "reason")).toThrow();
    expect(() => revokeEvidenceLink(link(), CHEMIST_ACTOR, "")).toThrow();
  });
});

describe("evaluateRequirementSatisfaction", () => {
  const ctx = { formulaVersionId: "version-1", jurisdiction: "KE" as const };

  it("no evidence at all on a mandatory requirement is missing, not satisfied", () => {
    const row = evaluateRequirementSatisfaction(requirement({ mandatory: true }), [], [], ctx);
    expect(row.satisfaction).toBe("missing");
  });

  it("no evidence on an optional requirement is not_started, not a blocker", () => {
    const row = evaluateRequirementSatisfaction(requirement({ mandatory: false }), [], [], ctx);
    expect(row.satisfaction).toBe("not_started");
    expect(row.blockingReason).toBeUndefined();
  });

  it("linked but unverified evidence is satisfied_unverified, never satisfied_verified", () => {
    const row = evaluateRequirementSatisfaction(requirement(), [link()], [evidence({ status: "present_unverified" })], ctx);
    expect(row.satisfaction).toBe("satisfied_unverified");
  });

  it("expired linked evidence with no other eligible evidence is expired, not satisfied", () => {
    const row = evaluateRequirementSatisfaction(requirement(), [link()], [evidence({ expiresAt: "2020-01-01T00:00:00.000Z" })], ctx);
    expect(row.satisfaction).toBe("expired");
  });

  it("an excluded requirement is not_applicable regardless of evidence", () => {
    const row = evaluateRequirementSatisfaction(requirement({ status: "excluded" }), [link()], [evidence()], ctx);
    expect(row.satisfaction).toBe("not_applicable");
  });

  it("unknown/human_review_required applicability is never satisfied — unknown does not equal satisfied", () => {
    const rowUnknown = evaluateRequirementSatisfaction(requirement({ applicabilityStatus: "unknown" }), [link()], [evidence()], ctx);
    expect(rowUnknown.satisfaction).toBe("unknown");
    const rowHuman = evaluateRequirementSatisfaction(requirement({ applicabilityStatus: "human_review_required" }), [link()], [evidence()], ctx);
    expect(rowHuman.satisfaction).toBe("unknown");
  });

  it("insufficient evidence count is partially_satisfied, not satisfied", () => {
    const row = evaluateRequirementSatisfaction(requirement({ minimumEvidenceCount: 2 }), [link()], [evidence()], ctx);
    expect(row.satisfaction).toBe("partially_satisfied");
  });
});

describe("calculateDossierReadiness", () => {
  const dossierRef = { id: "dossier-1", revision: 1, status: "in_preparation" as const };

  it("no dossier requirements at all is not ready", () => {
    const readiness = calculateDossierReadiness(dossierRef, []);
    expect(readiness.overallReadiness).toBe("not_ready");
  });

  it("missing mandatory evidence blocks readiness", () => {
    const matrix = buildEvidenceMatrix([requirement({ mandatory: true })], [], [], "version-1", undefined);
    const readiness = calculateDossierReadiness(dossierRef, matrix);
    expect(readiness.missingMandatoryRequirements).toBe(1);
    expect(readiness.overallReadiness).toBe("not_ready");
  });

  it("unverified mandatory evidence keeps the dossier not ready for review", () => {
    const matrix = buildEvidenceMatrix([requirement()], [link()], [evidence({ status: "present_unverified" })], "version-1", undefined);
    const readiness = calculateDossierReadiness(dossierRef, matrix);
    expect(readiness.overallReadiness).not.toBe("ready_for_review");
    expect(readiness.unverifiedEvidenceCount).toBe(1);
  });

  it("all mandatory evidence verified reaches ready_for_review", () => {
    const matrix = buildEvidenceMatrix([requirement()], [link()], [evidence()], "version-1", undefined);
    const readiness = calculateDossierReadiness(dossierRef, matrix);
    expect(readiness.overallReadiness).toBe("ready_for_review");
    expect(readiness.satisfiedMandatoryRequirements).toBe(1);
  });

  it("human review required anywhere makes overall readiness unknown — never silently ready", () => {
    const matrix = buildEvidenceMatrix([requirement(), requirement({ id: "req-2", applicabilityStatus: "unknown" })], [link()], [evidence()], "version-1", undefined);
    const readiness = calculateDossierReadiness(dossierRef, matrix);
    expect(readiness.overallReadiness).toBe("unknown");
    expect(readiness.humanReviewRequiredCount).toBe(1);
  });

  it("expired evidence produces a warning", () => {
    const matrix = buildEvidenceMatrix([requirement({ mandatory: false })], [link()], [evidence({ expiresAt: "2020-01-01T00:00:00.000Z" })], "version-1", undefined);
    const readiness = calculateDossierReadiness(dossierRef, matrix);
    expect(readiness.warnings).toContain("expired_evidence_present");
  });
});

describe("dossier reviews", () => {
  const reviewInput = {
    dossierId: "dossier-1",
    dossierRevision: 1,
    outcome: "approved" as const,
    notes: "All mandatory requirements satisfied.",
    requirementSnapshot: [requirement()],
    evidenceSnapshot: [evidence()],
  };

  it("refuses an unauthorized actor", () => {
    expect(() => recordDossierReview(reviewInput, CHEMIST_ACTOR)).toThrow();
    expect(() => recordDossierReview(reviewInput, AGENT_ACTOR)).toThrow();
  });

  it("refuses empty notes", () => {
    expect(() => recordDossierReview({ ...reviewInput, notes: " " }, REGULATORY_ACTOR)).toThrow();
  });

  it("records a review bound to the exact dossier revision, with a frozen snapshot", () => {
    const review = recordDossierReview(reviewInput, REGULATORY_ACTOR);
    expect(review.dossierRevision).toBe(1);
    expect(review.requirementSnapshot).toHaveLength(1);
  });

  it("a review for revision 1 is not active against revision 2", () => {
    const review = recordDossierReview(reviewInput, REGULATORY_ACTOR);
    expect(isDossierReviewActive(review, [], 1)).toBe(true);
    expect(isDossierReviewActive(review, [], 2)).toBe(false);
  });

  it("revocation requires an authorized actor and a reason, and is append-only", () => {
    const review = recordDossierReview(reviewInput, REGULATORY_ACTOR);
    expect(() => revokeDossierReview(review.id, CHEMIST_ACTOR, "reason")).toThrow();
    expect(() => revokeDossierReview(review.id, REGULATORY_ACTOR, "")).toThrow();
    const revocation = revokeDossierReview(review.id, ADMIN_ACTOR, "Recorded against the wrong revision.");
    expect(revocation.revokesReviewId).toBe(review.id);
    expect(isDossierReviewActive(review, [revocation], 1)).toBe(false);
  });

  it("supports approved_with_conditions and changes_requested outcomes", () => {
    expect(recordDossierReview({ ...reviewInput, outcome: "approved_with_conditions" }, QUALITY_ACTOR).outcome).toBe("approved_with_conditions");
    expect(recordDossierReview({ ...reviewInput, outcome: "changes_requested" }, QUALITY_ACTOR).outcome).toBe("changes_requested");
  });
});

describe("dossier submissions", () => {
  const submissionInput = { dossierId: "dossier-1", dossierRevision: 1, jurisdiction: "KE" as const };

  it("refuses an unauthorized actor", () => {
    expect(() => recordDossierSubmission(submissionInput, CHEMIST_ACTOR)).toThrow();
  });

  it("records a submission as a tracking entry only, starting as prepared", () => {
    const s = recordDossierSubmission(submissionInput, REGULATORY_ACTOR);
    expect(s.status).toBe("prepared");
    expect(s.dossierRevision).toBe(1);
  });

  it("status updates require an authorized actor", () => {
    const s = recordDossierSubmission(submissionInput, REGULATORY_ACTOR);
    expect(() => updateDossierSubmissionStatus(s, "submitted", CHEMIST_ACTOR)).toThrow();
    const updated = updateDossierSubmissionStatus(s, "withdrawn", ADMIN_ACTOR, "Formula changed.");
    expect(updated.status).toBe("withdrawn");
  });
});

describe("resolveDossierRevisionChain", () => {
  it("walks back through every superseded dossier revision", () => {
    const d1 = createDossier(
      { dossierCode: "DOS-1", title: "t", formulationId: "proj-1", formulaVersionId: "version-1", jurisdictions: ["KE"], productFamilyCode: "x" },
      REGULATORY_ACTOR,
    );
    const { revised: d2 } = reviseDossier(d1, REGULATORY_ACTOR);
    const { revised: d3 } = reviseDossier(d2, REGULATORY_ACTOR);
    const chain = resolveDossierRevisionChain(d3, [d1, d2, d3]);
    expect(chain.map((d) => d.revision)).toEqual([3, 2, 1]);
  });
});
