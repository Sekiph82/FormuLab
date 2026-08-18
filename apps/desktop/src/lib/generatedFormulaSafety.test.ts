import { describe, expect, it } from "vitest";
import type { RawMaterial, SafetyRule } from "@formulab/shared";
import { evaluateGeneratedFormulaSafety } from "./generatedFormulaSafety";

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

function rule(over: Partial<SafetyRule> & Pick<SafetyRule, "id" | "severity" | "ruleType" | "conditions" | "message" | "category">): SafetyRule {
  return {
    schemaVersion: "1.0",
    version: "1.0",
    name: over.id,
    status: "verified",
    sourceReferences: [],
    verificationStatus: "verified",
    requiredPpe: [],
    requiredEngineeringControls: [],
    alwaysRequiresHumanReview: false,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const BLOCKING_RULE = rule({
  id: "fixture-corrosive",
  severity: "blocking",
  category: "corrosivity",
  ruleType: "forbidden_combination",
  message: "A and B must never combine (corrosive risk).",
  conditions: [
    { label: "a", materialCodesAny: ["RM-A"] },
    { label: "b", materialCodesAny: ["RM-B"] },
  ],
});

const WARNING_RULE = rule({
  id: "fixture-sensitizer",
  severity: "warning",
  category: "sensitization",
  ruleType: "forbidden_combination",
  message: "A and C together — a caution, not a blocker.",
  conditions: [
    { label: "a", materialCodesAny: ["RM-A"] },
    { label: "c", materialCodesAny: ["RM-C"] },
  ],
});

const MAT_A = material({ code: "RM-A", displayName: "Material A" });
const MAT_B = material({ code: "RM-B", displayName: "Material B" });
const MAT_C = material({ code: "RM-C", displayName: "Material C" });

describe("evaluateGeneratedFormulaSafety — FVL-03.009", () => {
  it("Acceptance A: a canonical material pair triggers a real hard Safety finding -> blocked", () => {
    const f = formula([
      { inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" },
      { inci: "B", name: "B", weight_pct: "5.0", material_code: "RM-B" },
    ]);
    const result = evaluateGeneratedFormulaSafety(f, [MAT_A, MAT_B, MAT_C], [BLOCKING_RULE]);
    expect(result.formulaState).toBe("blocked");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("blocking");
  });

  it("Acceptance B: materials evaluate without hard findings -> no fabricated blocker", () => {
    const f = formula([{ inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" }]);
    const result = evaluateGeneratedFormulaSafety(f, [MAT_A, MAT_B, MAT_C], [BLOCKING_RULE]);
    expect(result.formulaState).toBe("safe");
    expect(result.findings).toHaveLength(0);
  });

  it("Acceptance C: one ingredient has no materialCode, zero findings -> unknown, never silently safe", () => {
    const f = formula([{ inci: "Fragrance", name: "Fragrance", weight_pct: "0.5" }]);
    const result = evaluateGeneratedFormulaSafety(f, [MAT_A, MAT_B, MAT_C], [BLOCKING_RULE]);
    expect(result.formulaState).toBe("unknown");
    expect(result.unresolvedMaterialCount).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  it("Acceptance D: a real warning finding, not a hard failure -> warning state, formula not hard-blocked", () => {
    const f = formula([
      { inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" },
      { inci: "C", name: "C", weight_pct: "5.0", material_code: "RM-C" },
    ]);
    const result = evaluateGeneratedFormulaSafety(f, [MAT_A, MAT_B, MAT_C], [WARNING_RULE]);
    expect(result.formulaState).toBe("warning");
    expect(result.findings[0].severity).toBe("warning");
  });

  it("a blocking finding always wins formulaState even alongside a separate warning finding", () => {
    const f = formula([
      { inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" },
      { inci: "B", name: "B", weight_pct: "5.0", material_code: "RM-B" },
      { inci: "C", name: "C", weight_pct: "5.0", material_code: "RM-C" },
    ]);
    const result = evaluateGeneratedFormulaSafety(f, [MAT_A, MAT_B, MAT_C], [BLOCKING_RULE, WARNING_RULE]);
    expect(result.formulaState).toBe("blocked");
    expect(result.findings).toHaveLength(2);
  });

  it("real findings and unresolved coverage are both surfaced, neither hides the other", () => {
    const f = formula([
      { inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" },
      { inci: "B", name: "B", weight_pct: "5.0", material_code: "RM-B" },
      { inci: "Fragrance", name: "Fragrance", weight_pct: "0.5" },
    ]);
    const result = evaluateGeneratedFormulaSafety(f, [MAT_A, MAT_B, MAT_C], [BLOCKING_RULE]);
    expect(result.formulaState).toBe("blocked");
    expect(result.unresolvedMaterialCount).toBe(1);
  });

  it("an inactive rule never fires — inherited from the real engine, not re-implemented", () => {
    const f = formula([
      { inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" },
      { inci: "B", name: "B", weight_pct: "5.0", material_code: "RM-B" },
    ]);
    const result = evaluateGeneratedFormulaSafety(f, [MAT_A, MAT_B, MAT_C], [{ ...BLOCKING_RULE, active: false }]);
    expect(result.formulaState).toBe("safe");
  });

  it("a same-display-name decoy material cannot hijack a materialCode-scoped rule", () => {
    const decoy = material({ code: "RM-DECOY", displayName: "Material A" });
    const f = formula([
      { inci: "Material A", name: "Material A", weight_pct: "5.0", material_code: "RM-DECOY" },
      { inci: "B", name: "B", weight_pct: "5.0", material_code: "RM-B" },
    ]);
    const result = evaluateGeneratedFormulaSafety(f, [decoy, MAT_B], [BLOCKING_RULE]);
    expect(result.formulaState).toBe("safe");
  });

  it("performs no Tauri/network call — pure evaluation only", () => {
    expect(() =>
      evaluateGeneratedFormulaSafety(formula([{ inci: "A", material_code: "RM-A", weight_pct: "1" }]), [MAT_A], [BLOCKING_RULE]),
    ).not.toThrow();
  });
});
