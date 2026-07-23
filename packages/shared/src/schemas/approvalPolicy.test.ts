import { describe, expect, it } from "vitest";
import { policyApplies, resolvePolicyPrecedence } from "./approvalPolicy";
import type { ApprovalPolicy } from "./approvalPolicy";

function policy(over: Partial<ApprovalPolicy> = {}): ApprovalPolicy {
  return {
    schemaVersion: "1.0",
    id: over.id ?? "policy",
    name: over.id ?? "Policy",
    productFamilyCodes: [],
    packagingSkuCodes: [],
    targetStatus: "pilot_approved",
    verificationStatus: "not_verified",
    active: true,
    retired: false,
    revisionNumber: 1,
    requireCompletedTrial: false,
    requireAllRequiredTestsCompleted: false,
    requireAllCriticalTestsPassed: false,
    requireNoUnresolvedCriticalDeviation: false,
    requireNoUnresolvedCriticalCorrectiveAction: false,
    requireActiveStudy: false,
    requireInitialTestsPassed: false,
    requireNoUnresolvedCriticalFailure: false,
    requirePackagingCompatibilityPassed: false,
    requireCostSnapshot: false,
    createdBy: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("policyApplies", () => {
  it("an unrestricted policy applies to any family/SKU", () => {
    expect(policyApplies(policy(), "fam-1", "sku-1")).toBe(true);
  });

  it("a family-scoped policy excludes a different family", () => {
    expect(policyApplies(policy({ productFamilyCodes: ["fam-1"] }), "fam-2")).toBe(false);
  });

  it("a SKU-scoped policy excludes a different SKU", () => {
    expect(policyApplies(policy({ packagingSkuCodes: ["sku-1"] }), "fam-1", "sku-2")).toBe(false);
  });
});

describe("resolvePolicyPrecedence", () => {
  it("returns nothing when no active policy matches", () => {
    const result = resolvePolicyPrecedence([policy({ active: false })], "pilot_approved", "fam-1");
    expect(result.resolved).toBeUndefined();
    expect(result.conflict).toBeUndefined();
  });

  it("resolves a single match trivially", () => {
    const p = policy({ id: "p1" });
    const result = resolvePolicyPrecedence([p], "pilot_approved", "fam-1");
    expect(result.resolved?.id).toBe("p1");
  });

  it("ignores a retired policy even if otherwise matching", () => {
    const result = resolvePolicyPrecedence([policy({ retired: true })], "pilot_approved", "fam-1");
    expect(result.resolved).toBeUndefined();
  });

  it("exact family + exact SKU beats exact family alone", () => {
    const familyOnly = policy({ id: "family-only", productFamilyCodes: ["fam-1"] });
    const familyAndSku = policy({ id: "family-and-sku", productFamilyCodes: ["fam-1"], packagingSkuCodes: ["sku-1"] });
    const result = resolvePolicyPrecedence([familyOnly, familyAndSku], "pilot_approved", "fam-1", "sku-1");
    expect(result.resolved?.id).toBe("family-and-sku");
  });

  it("exact family beats exact SKU alone", () => {
    const familyOnly = policy({ id: "family-only", productFamilyCodes: ["fam-1"] });
    const skuOnly = policy({ id: "sku-only", packagingSkuCodes: ["sku-1"] });
    const result = resolvePolicyPrecedence([familyOnly, skuOnly], "pilot_approved", "fam-1", "sku-1");
    expect(result.resolved?.id).toBe("family-only");
  });

  it("exact SKU beats a global (unscoped) policy", () => {
    const global = policy({ id: "global" });
    const skuOnly = policy({ id: "sku-only", packagingSkuCodes: ["sku-1"] });
    const result = resolvePolicyPrecedence([global, skuOnly], "pilot_approved", "fam-1", "sku-1");
    expect(result.resolved?.id).toBe("sku-only");
  });

  it("an explicit priority breaks a tie at equal specificity", () => {
    const low = policy({ id: "low", productFamilyCodes: ["fam-1"], priority: 1 });
    const high = policy({ id: "high", productFamilyCodes: ["fam-1"], priority: 5 });
    const result = resolvePolicyPrecedence([low, high], "pilot_approved", "fam-1");
    expect(result.resolved?.id).toBe("high");
  });

  it("the most recent effective date breaks a tie when priority does not resolve it", () => {
    const older = policy({ id: "older", productFamilyCodes: ["fam-1"], effectiveDate: "2026-01-01" });
    const newer = policy({ id: "newer", productFamilyCodes: ["fam-1"], effectiveDate: "2026-06-01" });
    const result = resolvePolicyPrecedence([older, newer], "pilot_approved", "fam-1");
    expect(result.resolved?.id).toBe("newer");
  });

  it("returns a structured conflict, never an arbitrary pick, when nothing breaks the tie", () => {
    const a = policy({ id: "a", productFamilyCodes: ["fam-1"] });
    const b = policy({ id: "b", productFamilyCodes: ["fam-1"] });
    const result = resolvePolicyPrecedence([a, b], "pilot_approved", "fam-1");
    expect(result.resolved).toBeUndefined();
    expect(result.conflict?.matchingPolicyIds.sort()).toEqual(["a", "b"]);
    expect(result.conflict?.reason).toMatch(/2 active policies match/);
  });

  it("does not silently merge conflicting policies' requirements", () => {
    const a = policy({ id: "a", productFamilyCodes: ["fam-1"], requireCompletedTrial: true });
    const b = policy({ id: "b", productFamilyCodes: ["fam-1"], requireCostSnapshot: true });
    const result = resolvePolicyPrecedence([a, b], "pilot_approved", "fam-1");
    expect(result.resolved).toBeUndefined();
    expect(result.conflict).toBeDefined();
  });
});
