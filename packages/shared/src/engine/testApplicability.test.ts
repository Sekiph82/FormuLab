import { describe, expect, it } from "vitest";
import { buildTestRequirementSnapshot, evaluateApplicability, explainExclusion, isTestDefinitionApplicable, resolveApplicableTestDefinitions } from "./testApplicability";
import type { TestDefinition } from "../schemas/testDefinitions";

function def(over: Partial<TestDefinition> = {}): TestDefinition {
  return {
    schemaVersion: "1.0",
    code: "TEST-X",
    name: "Test X",
    category: "physical_chemical",
    resultType: "numeric",
    replicatesRequired: 1,
    requiredEquipment: [],
    requiredAttachment: false,
    applicableProductFamilies: [],
    applicableProductSkus: [],
    criticalTestFlag: false,
    verificationStatus: "not_verified",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("isTestDefinitionApplicable", () => {
  it("selects a family-applicable test", () => {
    const d = def({ applicableProductFamilies: ["fam-1"] });
    expect(isTestDefinitionApplicable(d, { productFamilyId: "fam-1", context: "trial" })).toBe(true);
  });

  it("excludes a test restricted to a different family", () => {
    const d = def({ applicableProductFamilies: ["fam-2"] });
    expect(isTestDefinitionApplicable(d, { productFamilyId: "fam-1", context: "trial" })).toBe(false);
  });

  it("an unrestricted (empty) family list applies to every family", () => {
    const d = def({ applicableProductFamilies: [] });
    expect(isTestDefinitionApplicable(d, { productFamilyId: "fam-9", context: "trial" })).toBe(true);
  });

  it("selects a packaging-applicable test when the trial/study targets that SKU", () => {
    const d = def({ applicablePackagingSkuCodes: ["SKU-1"] });
    expect(isTestDefinitionApplicable(d, { productFamilyId: "fam-1", context: "stability", packagingSkuCodes: ["SKU-1"] })).toBe(true);
  });

  it("a wrong-packaging test cannot satisfy a requirement for a different SKU", () => {
    const d = def({ applicablePackagingSkuCodes: ["SKU-1"] });
    expect(isTestDefinitionApplicable(d, { productFamilyId: "fam-1", context: "stability", packagingSkuCodes: ["SKU-2"] })).toBe(false);
  });

  it("excludes a test not applicable to this context (trial vs stability)", () => {
    const d = def({ applicableContexts: ["stability"] });
    expect(isTestDefinitionApplicable(d, { productFamilyId: "fam-1", context: "trial" })).toBe(false);
  });

  it("excludes an inactive test regardless of applicability", () => {
    const d = def({ active: false, applicableProductFamilies: [] });
    expect(isTestDefinitionApplicable(d, { productFamilyId: "fam-1", context: "trial" })).toBe(false);
  });

  it("condition/time-point applicability is enforced for stability context", () => {
    const d = def({ applicableConditionCodes: ["25C"], applicableTimePointCodes: ["1MO"] });
    expect(isTestDefinitionApplicable(d, { productFamilyId: "fam-1", context: "stability", conditionCodes: ["40C"], timePointCodes: ["1MO"] })).toBe(false);
    expect(isTestDefinitionApplicable(d, { productFamilyId: "fam-1", context: "stability", conditionCodes: ["25C"], timePointCodes: ["1MO"] })).toBe(true);
  });

  it("a definition written before these fields existed (all undefined) is treated as unrestricted", () => {
    const legacy = def();
    delete (legacy as { applicableContexts?: unknown }).applicableContexts;
    delete (legacy as { applicablePackagingSkuCodes?: unknown }).applicablePackagingSkuCodes;
    expect(isTestDefinitionApplicable(legacy, { productFamilyId: "fam-1", context: "stability", packagingSkuCodes: ["SKU-1"] })).toBe(true);
  });
});

describe("resolveApplicableTestDefinitions", () => {
  it("only returns applicable definitions, each labelled with a reason", () => {
    const inFamily = def({ code: "IN", applicableProductFamilies: ["fam-1"] });
    const outOfFamily = def({ code: "OUT", applicableProductFamilies: ["fam-2"] });
    const resolved = resolveApplicableTestDefinitions([inFamily, outOfFamily], { productFamilyId: "fam-1", context: "trial" });
    expect(resolved.map((r) => r.definition.code)).toEqual(["IN"]);
    expect(resolved[0].reason.length).toBeGreaterThan(0);
  });

  it("marks a definition required only when requiredByDefault is set", () => {
    const required = def({ code: "REQ", requiredByDefault: true });
    const optional = def({ code: "OPT", requiredByDefault: false });
    const resolved = resolveApplicableTestDefinitions([required, optional], { productFamilyId: "fam-1", context: "trial" });
    expect(resolved.find((r) => r.definition.code === "REQ")?.required).toBe(true);
    expect(resolved.find((r) => r.definition.code === "OPT")?.required).toBe(false);
  });
});

describe("buildTestRequirementSnapshot", () => {
  it("captures applicable tests immutably, unaffected by a later definition edit", () => {
    const original = def({ code: "TEST-A", requiredByDefault: true, criticalTestFlag: false });
    const snapshot = buildTestRequirementSnapshot([original], { productFamilyId: "fam-1", context: "trial" });
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].criticalTestFlag).toBe(false);

    // The definition is edited afterward (critical flag flipped) — the
    // already-built snapshot must not change, because it is a plain copy,
    // not a live reference.
    original.criticalTestFlag = true;
    expect(snapshot.entries[0].criticalTestFlag).toBe(false);
  });

  it("includes an authorized human addition even when applicability alone would exclude it", () => {
    const outOfFamily = def({ code: "MANUAL", applicableProductFamilies: ["fam-2"] });
    const snapshot = buildTestRequirementSnapshot([], { productFamilyId: "fam-1", context: "trial" }, [
      { definition: outOfFamily, addedBy: "chemist-jane" },
    ]);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].addedManuallyBy).toBe("chemist-jane");
    expect(snapshot.entries[0].required).toBe(true);
  });

  it("does not duplicate a test that is both applicable and manually added", () => {
    const applicable = def({ code: "DUP", applicableProductFamilies: ["fam-1"], requiredByDefault: true });
    const snapshot = buildTestRequirementSnapshot([applicable], { productFamilyId: "fam-1", context: "trial" }, [
      { definition: applicable, addedBy: "chemist-jane" },
    ]);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].addedManuallyBy).toBeUndefined();
  });
});

describe("explainExclusion", () => {
  it("reports the specific reason a definition is excluded", () => {
    const d = def({ applicableProductFamilies: ["fam-2"] });
    expect(explainExclusion(d, { productFamilyId: "fam-1", context: "trial" })).toEqual(["wrong_product_family"]);
  });

  it("reports every failing dimension at once, not just the first", () => {
    const d = def({ active: false, applicableProductFamilies: ["fam-2"] });
    const reasons = explainExclusion(d, { productFamilyId: "fam-1", context: "trial" });
    expect(reasons).toContain("inactive_definition");
    expect(reasons).toContain("wrong_product_family");
  });

  it("is empty for an applicable definition", () => {
    const d = def();
    expect(explainExclusion(d, { productFamilyId: "fam-1", context: "trial" })).toEqual([]);
  });

  it("reports wrong_context, wrong_packaging_sku, wrong_storage_condition and wrong_time_point distinctly", () => {
    expect(explainExclusion(def({ applicableContexts: ["stability"] }), { productFamilyId: "fam-1", context: "trial" })).toEqual(["wrong_context"]);
    expect(
      explainExclusion(def({ applicablePackagingSkuCodes: ["sku-1"] }), { productFamilyId: "fam-1", context: "trial", packagingSkuCodes: ["sku-2"] }),
    ).toEqual(["wrong_packaging_sku"]);
    expect(
      explainExclusion(def({ applicableConditionCodes: ["25C"] }), { productFamilyId: "fam-1", context: "stability", conditionCodes: ["40C"] }),
    ).toContain("wrong_storage_condition");
    expect(
      explainExclusion(def({ applicableTimePointCodes: ["1MO"] }), { productFamilyId: "fam-1", context: "stability", timePointCodes: ["3MO"] }),
    ).toContain("wrong_time_point");
  });
});

describe("evaluateApplicability", () => {
  it("splits definitions into included and excluded, with reasons only on the excluded side", () => {
    const included = def({ code: "IN", applicableProductFamilies: ["fam-1"] });
    const excluded = def({ code: "OUT", applicableProductFamilies: ["fam-2"] });
    const result = evaluateApplicability([included, excluded], { productFamilyId: "fam-1", context: "trial" });
    expect(result.included.map((r) => r.definition.code)).toEqual(["IN"]);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].definition.code).toBe("OUT");
    expect(result.excluded[0].reasons).toEqual(["wrong_product_family"]);
  });

  it("an excluded definition never appears among the included ones, so it can never satisfy a mandatory requirement", () => {
    const excluded = def({ code: "OUT", applicableProductFamilies: ["fam-2"], requiredByDefault: true });
    const result = evaluateApplicability([excluded], { productFamilyId: "fam-1", context: "trial" });
    expect(result.included).toHaveLength(0);
    expect(result.excluded).toHaveLength(1);
  });
});
