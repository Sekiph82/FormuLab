import { describe, expect, it } from "vitest";
import type { CompatibilityRule, RawMaterial } from "@formulab/shared";
import { evaluateGeneratedFormulaCompatibility } from "./generatedFormulaCompatibility";

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

function rule(over: Partial<CompatibilityRule> & Pick<CompatibilityRule, "id" | "severity" | "ruleType" | "conditions" | "message">): CompatibilityRule {
  return {
    schemaVersion: "1.0",
    version: "1.0",
    name: over.id,
    status: "verified",
    sourceReferences: [],
    verificationStatus: "verified",
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const FORBIDDEN_RULE = rule({
  id: "fixture-forbidden",
  severity: "blocking",
  ruleType: "forbidden_combination",
  message: "A and B must never combine.",
  conditions: [
    { label: "a", materialCodesAny: ["RM-A"] },
    { label: "b", materialCodesAny: ["RM-B"] },
  ],
});

const WARNING_RULE = rule({
  id: "fixture-warning",
  severity: "warning",
  ruleType: "forbidden_combination",
  message: "A and C are a caution, not a blocker.",
  conditions: [
    { label: "a", materialCodesAny: ["RM-A"] },
    { label: "c", materialCodesAny: ["RM-C"] },
  ],
});

const MAT_A = material({ code: "RM-A", displayName: "Material A" });
const MAT_B = material({ code: "RM-B", displayName: "Material B" });
const MAT_C = material({ code: "RM-C", displayName: "Material C" });

describe("evaluateGeneratedFormulaCompatibility — FVL-03.008", () => {
  it("Acceptance A: two canonical materials explicitly incompatible -> blocked", () => {
    const f = formula([
      { inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" },
      { inci: "B", name: "B", weight_pct: "5.0", material_code: "RM-B" },
    ]);
    const result = evaluateGeneratedFormulaCompatibility(f, [MAT_A, MAT_B, MAT_C], [FORBIDDEN_RULE]);
    expect(result.formulaState).toBe("blocked");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("blocking");
  });

  it("Acceptance B: compatible canonical materials -> no fabricated blocker", () => {
    const f = formula([
      { inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" },
    ]);
    const result = evaluateGeneratedFormulaCompatibility(f, [MAT_A, MAT_B, MAT_C], [FORBIDDEN_RULE]);
    expect(result.formulaState).toBe("compatible");
    expect(result.findings).toHaveLength(0);
  });

  it("Acceptance C: one ingredient has no materialCode, zero findings -> unknown, never silently compatible", () => {
    const f = formula([
      { inci: "Fragrance", name: "Fragrance", weight_pct: "0.5" },
    ]);
    const result = evaluateGeneratedFormulaCompatibility(f, [MAT_A, MAT_B, MAT_C], [FORBIDDEN_RULE]);
    expect(result.formulaState).toBe("unknown");
    expect(result.unresolvedMaterialCount).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  it("Acceptance D: warning finding, not a blocker -> warning state, formula not hard-blocked", () => {
    const f = formula([
      { inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" },
      { inci: "C", name: "C", weight_pct: "5.0", material_code: "RM-C" },
    ]);
    const result = evaluateGeneratedFormulaCompatibility(f, [MAT_A, MAT_B, MAT_C], [WARNING_RULE]);
    expect(result.formulaState).toBe("warning");
    expect(result.findings[0].severity).toBe("warning");
  });

  it("a blocking finding always wins formulaState even alongside a separate warning finding", () => {
    const f = formula([
      { inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" },
      { inci: "B", name: "B", weight_pct: "5.0", material_code: "RM-B" },
      { inci: "C", name: "C", weight_pct: "5.0", material_code: "RM-C" },
    ]);
    const result = evaluateGeneratedFormulaCompatibility(f, [MAT_A, MAT_B, MAT_C], [FORBIDDEN_RULE, WARNING_RULE]);
    expect(result.formulaState).toBe("blocked");
    expect(result.findings).toHaveLength(2);
  });

  it("real findings and unresolved coverage are both surfaced, neither hides the other", () => {
    const f = formula([
      { inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" },
      { inci: "B", name: "B", weight_pct: "5.0", material_code: "RM-B" },
      { inci: "Fragrance", name: "Fragrance", weight_pct: "0.5" },
    ]);
    const result = evaluateGeneratedFormulaCompatibility(f, [MAT_A, MAT_B, MAT_C], [FORBIDDEN_RULE]);
    expect(result.formulaState).toBe("blocked");
    expect(result.unresolvedMaterialCount).toBe(1);
  });

  it("an inactive rule never fires — inherited from the real engine, not re-implemented", () => {
    const f = formula([
      { inci: "A", name: "A", weight_pct: "5.0", material_code: "RM-A" },
      { inci: "B", name: "B", weight_pct: "5.0", material_code: "RM-B" },
    ]);
    const result = evaluateGeneratedFormulaCompatibility(f, [MAT_A, MAT_B, MAT_C], [{ ...FORBIDDEN_RULE, active: false }]);
    expect(result.formulaState).toBe("compatible");
  });

  it("a same-display-name decoy material cannot hijack a materialCode-scoped rule", () => {
    const decoy = material({ code: "RM-DECOY", displayName: "Material A" });
    const f = formula([
      { inci: "Material A", name: "Material A", weight_pct: "5.0", material_code: "RM-DECOY" },
      { inci: "B", name: "B", weight_pct: "5.0", material_code: "RM-B" },
    ]);
    const result = evaluateGeneratedFormulaCompatibility(f, [decoy, MAT_B], [FORBIDDEN_RULE]);
    expect(result.formulaState).toBe("compatible");
  });

  it("performs no Tauri/network call — pure evaluation only", () => {
    expect(() =>
      evaluateGeneratedFormulaCompatibility(formula([{ inci: "A", material_code: "RM-A", weight_pct: "1" }]), [MAT_A], [FORBIDDEN_RULE]),
    ).not.toThrow();
  });
});
