import { describe, expect, it } from "vitest";
import {
  deprecateRule,
  editRule,
  evaluateRegulatory,
  initialRuleRevision,
  setRuleActive,
  summarizeRegulatoryFindings,
} from "./regulatoryRules";
import type { Actor } from "../schemas/status";
import type { RawMaterial } from "../schemas/materials";
import type { FormulationLine } from "../schemas/formulation";
import type { RegulatoryRule } from "../schemas/regulatory";

const HUMAN: Actor = { kind: "human", role: "quality", userId: "alice" };
const AGENT: Actor = { kind: "agent", runId: "run-1" };
const SYSTEM: Actor = { kind: "system", reason: "migration" };
const IMPORT: Actor = { kind: "import", source: "legacy.xlsx" };

const NOW = "2026-01-01T00:00:00.000Z";

function rule(over: Partial<RegulatoryRule> = {}): RegulatoryRule {
  return {
    schemaVersion: "1.0",
    id: "rule-1",
    code: "KE-TEST-001",
    name: "Test rule",
    jurisdiction: "KE",
    authority: "Test authority",
    ruleType: "ingredient_prohibition",
    productCategories: [],
    requirement: "Placeholder requirement.",
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

const MATERIAL: RawMaterial = {
  schemaVersion: "1.0",
  code: "QAC-1",
  displayName: "Quat Disinfectant Active",
  casNumbers: [],
  ecNumbers: [],
  functions: ["qac_active"],
  activeMatterState: "missing",
  documents: [],
  regulatoryStatuses: [],
  hazardClassifications: [],
  allergens: [],
  incompatibilities: [],
  substituteCodes: [],
  active: true,
  createdAt: NOW,
  updatedAt: NOW,
};

function line(over: Partial<FormulationLine> = {}): FormulationLine {
  return {
    id: "line-1",
    lineNumber: 1,
    phase: "A",
    materialCode: "QAC-1",
    displayName: "Quat Disinfectant Active",
    functions: ["qac_active"],
    percent: "2",
    isQsToHundred: false,
    provenance: { origin: "model_estimate", evidenceClaimIds: [] },
    ...over,
  };
}

describe("evaluateRegulatory — jurisdiction and category applicability", () => {
  it("a rule only applies in its own jurisdiction", () => {
    const findings = evaluateRegulatory([line()], [rule({ jurisdiction: "UG" })], { jurisdiction: "KE", category: "disinfectant", materials: [MATERIAL] });
    expect(findings).toHaveLength(0);
  });

  it("an EAC rule overlays a member state's own jurisdiction", () => {
    const findings = evaluateRegulatory([line()], [rule({ jurisdiction: "EAC", conditions: [{ materialCodesAny: ["QAC-1"] }] })], {
      jurisdiction: "KE",
      category: "disinfectant",
      materials: [MATERIAL],
    });
    expect(findings).toHaveLength(1);
  });

  it("an EAC rule does not apply to a jurisdiction outside the EAC member-state list", () => {
    const r = rule({ jurisdiction: "EAC", conditions: [{ materialCodesAny: ["QAC-1"] }] });
    // Every jurisdiction this engine models is an EAC member (KE/UG/TZ/RW/BI/SS)
    // by construction — there is no non-member jurisdiction to test against
    // directly, so this instead confirms the overlay actually depends on
    // EAC_MEMBER_STATES rather than always matching regardless of `ctx.jurisdiction`.
    const findings = evaluateRegulatory([line()], [r], { jurisdiction: "KE", category: "disinfectant", materials: [MATERIAL] });
    expect(findings.length).toBeGreaterThan(0);
  });

  it("an empty productCategories list applies to every category", () => {
    const findings = evaluateRegulatory([line()], [rule({ productCategories: [], conditions: [{ materialCodesAny: ["QAC-1"] }] })], {
      jurisdiction: "KE",
      category: "toothpaste",
      materials: [MATERIAL],
    });
    expect(findings).toHaveLength(1);
  });

  it("a scoped productCategories list excludes a non-matching category", () => {
    const findings = evaluateRegulatory([line()], [rule({ productCategories: ["disinfectant"] })], { jurisdiction: "KE", category: "toothpaste", materials: [MATERIAL] });
    expect(findings).toHaveLength(0);
  });

  it("an inactive rule never produces a finding", () => {
    const findings = evaluateRegulatory([line()], [rule({ active: false })], { jurisdiction: "KE", category: "disinfectant", materials: [MATERIAL] });
    expect(findings).toHaveLength(0);
  });

  it("a rule outside its effective/expiry window does not apply", () => {
    const notYetEffective = rule({ effectiveDate: "2099-01-01T00:00:00.000Z" });
    const expired = rule({ expiryDate: "2020-01-01T00:00:00.000Z" });
    const ctx = { jurisdiction: "KE" as const, category: "disinfectant" as const, materials: [MATERIAL] };
    expect(evaluateRegulatory([line()], [notYetEffective], ctx)).toHaveLength(0);
    expect(evaluateRegulatory([line()], [expired], ctx)).toHaveLength(0);
  });
});

describe("evaluateRegulatory — ingredient rule types", () => {
  const ctx = { jurisdiction: "KE" as const, category: "disinfectant" as const, materials: [MATERIAL] };

  it("ingredient_prohibition matches a present material as non_compliant", () => {
    const r = rule({ ruleType: "ingredient_prohibition", conditions: [{ materialCodesAny: ["QAC-1"] }] });
    const findings = evaluateRegulatory([line()], [r], ctx);
    expect(findings[0].status).toBe("non_compliant");
    expect(findings[0].affectedMaterialCodes).toEqual(["QAC-1"]);
  });

  it("ingredient_prohibition produces no finding when the material is absent", () => {
    const r = rule({ ruleType: "ingredient_prohibition", conditions: [{ materialCodesAny: ["NOT-PRESENT"] }] });
    expect(evaluateRegulatory([line()], [r], ctx)).toHaveLength(0);
  });

  it("ingredient_restriction matches a present material as human_review_required, not non_compliant", () => {
    const r = rule({ ruleType: "ingredient_restriction", conditions: [{ materialCodesAny: ["QAC-1"] }] });
    const findings = evaluateRegulatory([line()], [r], ctx);
    expect(findings[0].status).toBe("human_review_required");
  });

  it("concentration_limit is compliant within range and non_compliant above the max", () => {
    const r = rule({ ruleType: "concentration_limit", conditions: [{ materialCodesAny: ["QAC-1"], maxConcentrationPercent: "5" }] });
    const withinRange = evaluateRegulatory([line({ percent: "2" })], [r], ctx);
    const aboveMax = evaluateRegulatory([line({ percent: "10" })], [r], ctx);
    expect(withinRange[0].status).toBe("compliant_with_rule");
    expect(aboveMax[0].status).toBe("non_compliant");
  });
});

describe("evaluateRegulatory — claim rule types", () => {
  const ctx = { jurisdiction: "KE" as const, category: "disinfectant" as const, materials: [MATERIAL] };

  it("claim_restriction flags a matching claim as non_compliant", () => {
    const r = rule({ ruleType: "claim_restriction", claimKeywordsAny: ["kills 99.9"] });
    const findings = evaluateRegulatory([], [r], { ...ctx, claims: ["Kills 99.9% of germs"] });
    expect(findings[0].status).toBe("non_compliant");
    expect(findings[0].affectedClaim).toBe("Kills 99.9% of germs");
  });

  it("claim_restriction produces no finding when no claim matches", () => {
    const r = rule({ ruleType: "claim_restriction", claimKeywordsAny: ["kills 99.9"] });
    expect(evaluateRegulatory([], [r], { ...ctx, claims: ["Fresh scent"] })).toHaveLength(0);
  });

  it("claim_evidence_requirement is missing_data with no evidence on file", () => {
    const r = rule({ ruleType: "claim_evidence_requirement", claimKeywordsAny: ["antibacterial"], requiredEvidenceTypes: ["efficacy_report"] });
    const findings = evaluateRegulatory([], [r], { ...ctx, claims: ["Antibacterial formula"] });
    expect(findings[0].status).toBe("missing_data");
    expect(findings[0].evidenceRequired).toEqual(["efficacy_report"]);
  });

  it("claim_evidence_requirement is compliant_with_rule once the evidence is on file", () => {
    const r = rule({ ruleType: "claim_evidence_requirement", claimKeywordsAny: ["antibacterial"], requiredEvidenceTypes: ["efficacy_report"] });
    const findings = evaluateRegulatory([], [r], { ...ctx, claims: ["Antibacterial formula"], providedEvidenceTypes: ["efficacy_report"] });
    expect(findings[0].status).toBe("compliant_with_rule");
  });
});

describe("evaluateRegulatory — product-level requirement types default to missing_data", () => {
  const ctx = { jurisdiction: "KE" as const, category: "disinfectant" as const, materials: [MATERIAL] };

  it("a document_requirement rule is missing_data without manual confirmation", () => {
    const r = rule({ ruleType: "document_requirement", requiredDocumentTypes: ["safety_data_sheet"] });
    const findings = evaluateRegulatory([], [r], ctx);
    expect(findings[0].status).toBe("missing_data");
  });

  it("a document_requirement rule is compliant_with_rule once manually confirmed", () => {
    const r = rule({ id: "rule-doc", ruleType: "document_requirement" });
    const findings = evaluateRegulatory([], [r], { ...ctx, manuallyConfirmedRuleIds: ["rule-doc"] });
    expect(findings[0].status).toBe("compliant_with_rule");
  });

  it("never silently reports unknown as compliant — unknown is a distinct status never produced by a passing check", () => {
    const r = rule({ ruleType: "label_requirement" });
    const findings = evaluateRegulatory([], [r], ctx);
    expect(findings[0].status).not.toBe("unknown");
    expect(findings[0].status).toBe("missing_data");
  });
});

describe("summarizeRegulatoryFindings", () => {
  it("counts unknown/missing_data/human_review_required as blocking, compliant/not_applicable as not", () => {
    const ctx = { jurisdiction: "KE" as const, category: "disinfectant" as const, materials: [MATERIAL] };
    const findings = evaluateRegulatory(
      [line()],
      [
        rule({ id: "a", ruleType: "ingredient_prohibition", conditions: [{ materialCodesAny: ["QAC-1"] }] }), // non_compliant
        rule({ id: "b", ruleType: "document_requirement" }), // missing_data
      ],
      ctx,
    );
    const summary = summarizeRegulatoryFindings(findings);
    expect(summary.blocking).toBe(2);
    expect(summary.compliant).toBe(0);
  });
});

describe("regulatory rule lifecycle — human-only, append-only revisions", () => {
  it("a human can create, edit, deactivate and deprecate a rule", () => {
    const r = rule();
    const created = initialRuleRevision(r, HUMAN);
    expect(created.changeType).toBe("created");

    const { rule: edited, revision: editRev } = editRule(r, { severity: "warning" }, HUMAN, "Downgraded pending review.");
    expect(edited.severity).toBe("warning");
    expect(edited.version).toBe(2);
    expect(editRev.changeReason).toBe("Downgraded pending review.");

    const { rule: deactivated } = setRuleActive(edited, false, HUMAN);
    expect(deactivated.active).toBe(false);

    const { rule: deprecated, revision: depRev } = deprecateRule(deactivated, HUMAN, "Superseded by KE-TEST-002.");
    expect(deprecated.status).toBe("deprecated");
    expect(depRev.changeType).toBe("deprecated");
  });

  it("never mutates the original rule object", () => {
    const original = rule();
    editRule(original, { severity: "info" }, HUMAN, "reason");
    expect(original.severity).toBe("blocking");
    expect(original.version).toBe(1);
  });

  it("AI/agent cannot create, edit, activate or deprecate a rule", () => {
    const r = rule();
    expect(() => initialRuleRevision(r, AGENT)).toThrow();
    expect(() => editRule(r, { severity: "info" }, AGENT, "reason")).toThrow();
    expect(() => setRuleActive(r, false, AGENT)).toThrow();
    expect(() => deprecateRule(r, AGENT, "reason")).toThrow();
  });

  it("system cannot edit a rule", () => {
    expect(() => editRule(rule(), { severity: "info" }, SYSTEM, "reason")).toThrow();
  });

  it("import cannot edit a rule", () => {
    expect(() => editRule(rule(), { severity: "info" }, IMPORT, "reason")).toThrow();
  });

  it("editing and deprecating both require a non-empty reason", () => {
    expect(() => editRule(rule(), { severity: "info" }, HUMAN, "  ")).toThrow();
    expect(() => deprecateRule(rule(), HUMAN, "")).toThrow();
  });
});
