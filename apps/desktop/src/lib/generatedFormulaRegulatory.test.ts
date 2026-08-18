import { describe, expect, it } from "vitest";
import type { RawMaterial, RegulatoryRule } from "@formulab/shared";
import { evaluateGeneratedFormulaRegulatory, resolveRegulatoryMarket } from "./generatedFormulaRegulatory";

const NOW = "2026-08-18T00:00:00.000Z";

function formula(ingredients: Record<string, unknown>[]) {
  return { ingredients };
}

function material(over: Partial<RawMaterial> & { code: string; displayName: string }): RawMaterial {
  return {
    schemaVersion: "1.0",
    casNumbers: [],
    ecNumbers: [],
    functions: [],
    documents: [],
    regulatoryStatuses: [],
    hazardClassifications: [],
    allergens: [],
    incompatibilities: [],
    substituteCodes: [],
    active: true,
    activeMatterState: "known",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as unknown as RawMaterial;
}

function rule(
  over: Partial<RegulatoryRule> & Pick<RegulatoryRule, "id" | "code" | "jurisdiction" | "ruleType" | "requirement">,
): RegulatoryRule {
  return {
    schemaVersion: "1.0",
    name: over.id,
    authority: "Test Authority",
    productCategories: [],
    severity: "warning",
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
    createdBy: "fixture",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const PROHIBITED_RULE = rule({
  id: "fixture-prohib-1", code: "FIX-PROHIB-001", jurisdiction: "KE",
  ruleType: "ingredient_prohibition", requirement: "Fixture prohibited ingredient.",
  verificationStatus: "verified", status: "verified",
  conditions: [{ label: "banned", materialCodesAny: ["RM-A"] }],
});

const LABEL_RULE = rule({
  id: "fixture-label-1", code: "FIX-LABEL-001", jurisdiction: "KE",
  ruleType: "label_requirement", requirement: "Fixture label elements.",
  requiredLabelElements: ["net_content"],
});

const MAT_A = material({ code: "RM-A", displayName: "Material A" });
const MAT_B = material({ code: "RM-B", displayName: "Material B" });

describe("resolveRegulatoryMarket — FVL-03.010", () => {
  it("resolves a known market alias to its real jurisdiction code", () => {
    expect(resolveRegulatoryMarket("kenya")).toBe("KE");
    expect(resolveRegulatoryMarket("Kenya")).toBe("KE");
    expect(resolveRegulatoryMarket("EAC")).toBe("EAC");
  });

  it("never guesses an unrecognized market", () => {
    expect(resolveRegulatoryMarket("european union")).toBeUndefined();
    expect(resolveRegulatoryMarket("")).toBeUndefined();
    expect(resolveRegulatoryMarket(undefined)).toBeUndefined();
  });
});

describe("evaluateGeneratedFormulaRegulatory — FVL-03.010", () => {
  it("Acceptance A: a real verified prohibited-ingredient finding -> blocked", () => {
    const f = formula([{ inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" }]);
    const result = evaluateGeneratedFormulaRegulatory(f, [MAT_A, MAT_B], [PROHIBITED_RULE], { market: "kenya" });
    expect(result.formulaState).toBe("blocked");
    expect(result.jurisdiction).toBe("KE");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].status).toBe("non_compliant");
  });

  it("Acceptance B: no prohibited ingredient present -> no fabricated blocker", () => {
    const f = formula([{ inci: "B", name: "B", weight_pct: "5.0", material_code: "RM-B" }]);
    const result = evaluateGeneratedFormulaRegulatory(f, [MAT_A, MAT_B], [PROHIBITED_RULE], { market: "kenya" });
    expect(result.formulaState).not.toBe("blocked");
  });

  it("Acceptance C: unresolved material is honestly disclosed, never hidden", () => {
    const f = formula([{ inci: "Unknown Ingredient", name: "Unknown Ingredient", weight_pct: "1.0" }]);
    const result = evaluateGeneratedFormulaRegulatory(f, [MAT_A, MAT_B], [PROHIBITED_RULE], { market: "kenya" });
    expect(result.unresolvedMaterialCount).toBe(1);
  });

  it("Acceptance D: a not_verified rule's finding stays explicit, never silently promoted to a clean verdict", () => {
    const f = formula([{ inci: "B", name: "B", weight_pct: "5.0", material_code: "RM-B" }]);
    const result = evaluateGeneratedFormulaRegulatory(f, [MAT_A, MAT_B], [LABEL_RULE], { market: "kenya" });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].verificationStatus).toBe("not_verified");
    expect(result.formulaState).toBe("warning");
    expect(result.findings[0].status).toBe("missing_data");
  });

  it("zero applicable findings is never reported compliant — this installation's own rule coverage is honestly sparse", () => {
    const f = formula([{ inci: "B", name: "B", weight_pct: "5.0", material_code: "RM-B" }]);
    const result = evaluateGeneratedFormulaRegulatory(f, [MAT_A, MAT_B], [PROHIBITED_RULE], { market: "uganda" });
    expect(result.jurisdiction).toBe("UG");
    expect(result.findings).toHaveLength(0);
    expect(result.formulaState).toBe("unknown");
  });

  it("an unresolvable market never silently defaults to a real jurisdiction — coverage is unknown, no rules run", () => {
    const f = formula([{ inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" }]);
    const result = evaluateGeneratedFormulaRegulatory(f, [MAT_A, MAT_B], [PROHIBITED_RULE], { market: "atlantis" });
    expect(result.formulaState).toBe("unknown");
    expect(result.jurisdiction).toBeUndefined();
    expect(result.findings).toHaveLength(0);
  });

  it("a real non_compliant finding wins formulaState even alongside a separate missing_data finding", () => {
    const f = formula([{ inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" }]);
    const result = evaluateGeneratedFormulaRegulatory(f, [MAT_A, MAT_B], [PROHIBITED_RULE, LABEL_RULE], { market: "kenya" });
    expect(result.formulaState).toBe("blocked");
    expect(result.findings).toHaveLength(2);
  });

  it("a genuinely all-clean applicable rule set reports compliant, not unknown", () => {
    const compliantRule = rule({
      id: "fixture-concentration-1", code: "FIX-CONC-001", jurisdiction: "KE",
      ruleType: "concentration_limit", requirement: "Fixture max concentration.",
      conditions: [{ label: "capped", materialCodesAny: ["RM-A"], maxConcentrationPercent: "10" }],
    });
    const f = formula([{ inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" }]);
    const result = evaluateGeneratedFormulaRegulatory(f, [MAT_A, MAT_B], [compliantRule], { market: "kenya" });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].status).toBe("compliant_with_rule");
    expect(result.formulaState).toBe("compliant");
  });

  it("an inactive rule never fires — inherited from the real engine, not re-implemented", () => {
    const f = formula([{ inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" }]);
    const result = evaluateGeneratedFormulaRegulatory(f, [MAT_A, MAT_B], [{ ...PROHIBITED_RULE, active: false }], { market: "kenya" });
    expect(result.findings).toHaveLength(0);
    expect(result.formulaState).toBe("unknown");
  });

  it("a same-display-name decoy material cannot hijack a materialCode-scoped rule", () => {
    const decoy = material({ code: "RM-DECOY", displayName: "Material A" });
    const f = formula([{ inci: "Material A", name: "Material A", weight_pct: "5.0", material_code: "RM-DECOY" }]);
    const result = evaluateGeneratedFormulaRegulatory(f, [decoy, MAT_B], [PROHIBITED_RULE], { market: "kenya" });
    expect(result.formulaState).not.toBe("blocked");
  });

  it("a rule scoped to a productCategory never fires for a generated formula's honest human_review_required category", () => {
    const categoryScoped = rule({
      id: "fixture-category-1", code: "FIX-CAT-001", jurisdiction: "KE",
      ruleType: "ingredient_prohibition", requirement: "Category-scoped fixture.",
      productCategories: ["disinfectant"],
      conditions: [{ label: "banned", materialCodesAny: ["RM-A"] }],
    });
    const f = formula([{ inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" }]);
    const result = evaluateGeneratedFormulaRegulatory(f, [MAT_A, MAT_B], [categoryScoped], { market: "kenya" });
    expect(result.findings).toHaveLength(0);
  });

  it("performs no Tauri/network call — pure evaluation only", () => {
    expect(() =>
      evaluateGeneratedFormulaRegulatory(formula([{ inci: "A", material_code: "RM-A", weight_pct: "1" }]), [MAT_A], [PROHIBITED_RULE], { market: "kenya" }),
    ).not.toThrow();
  });
});
