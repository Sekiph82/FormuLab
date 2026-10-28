import { describe, expect, it } from "vitest";
import { classifyCommercialProductType } from "./commercialProductType";

const observation = (kind: "explicit_type" | "substance_or_mixture" | "component_count" | "composition_complete" | "trade_secret" | "undisclosed_remainder", value: string | number | boolean, evidenceRef: string) => ({ kind, value, evidenceRefs: [evidenceRef] });

describe("commercial product type classifier", () => {
  it.each([
    ["SOLUTION", "SOLUTION"],
    ["POLYMER", "POLYMER"],
    ["PURE_OR_NEAR_PURE", "PURE_OR_NEAR_PURE"],
  ] as const)("accepts explicit cited type %s", (value, productType) => {
    expect(classifyCommercialProductType({ observations: [observation("explicit_type", value, "sds:1:4")] })).toMatchObject({
      productType,
      reasonCodes: ["explicit_type_evidence"],
      evidenceRefs: ["sds:1:4"],
      reviewRequired: true,
    });
  });

  it("derives only bounded structural classes from cited composition evidence", () => {
    expect(classifyCommercialProductType({ observations: [
      observation("substance_or_mixture", "substance", "sds:1:3"),
      observation("component_count", 1, "sds:3:1"),
      observation("composition_complete", true, "sds:3:complete-declaration"),
    ] }).productType).toBe("PURE_OR_NEAR_PURE");
    expect(classifyCommercialProductType({ observations: [
      observation("substance_or_mixture", "substance", "sds:1:3"),
      observation("component_count", 1, "sds:3:1"),
    ] }).productType).toBe("UNKNOWN");
    expect(classifyCommercialProductType({ observations: [observation("component_count", 3, "sds:3:table")] }).productType)
      .toBe("MULTICOMPONENT_BLEND");
  });

  it("prioritizes explicit incomplete-disclosure evidence and keeps uncertainty visible", () => {
    expect(classifyCommercialProductType({ observations: [
      observation("component_count", 2, "sds:3:table"),
      observation("undisclosed_remainder", true, "sds:3:footnote"),
      observation("explicit_type", "SOLUTION", "sds:1:4"),
    ] }).productType).toBe("PARTIALLY_DISCLOSED");
    expect(classifyCommercialProductType({ observations: [observation("trade_secret", true, "sds:3:note")] }).productType)
      .toBe("PROPRIETARY_BLEND");
    expect(classifyCommercialProductType({ observations: [] })).toMatchObject({
      productType: "UNKNOWN",
      reasonCodes: ["insufficient_product_type_evidence"],
      evidenceRefs: [],
      reviewRequired: true,
    });
  });

  it("refuses conflicting or uncited observations", () => {
    expect(classifyCommercialProductType({ observations: [
      observation("explicit_type", "SOLUTION", "sds:1:4"),
      observation("explicit_type", "POLYMER", "sds:1:5"),
    ] }).productType).toBe("UNKNOWN");
    expect(classifyCommercialProductType({ observations: [
      observation("explicit_type", "PURE_OR_NEAR_PURE", "sds:1:4"),
      observation("component_count", 3, "sds:3:table"),
    ] }).productType).toBe("UNKNOWN");
    expect(classifyCommercialProductType({ observations: [
      observation("explicit_type", "SOLUTION", "sds:1:4"),
      observation("substance_or_mixture", "substance", "sds:3:header"),
    ] }).productType).toBe("UNKNOWN");
    expect(classifyCommercialProductType({ observations: [
      observation("composition_complete", true, "sds:3:complete"),
      observation("composition_complete", false, "sds:3:footnote"),
    ] }).productType).toBe("UNKNOWN");
    expect(classifyCommercialProductType({ observations: [
      observation("trade_secret", true, "sds:3:secret"),
      observation("trade_secret", false, "sds:3:public"),
    ] }).productType).toBe("UNKNOWN");
    expect(() => classifyCommercialProductType({ observations: [{ kind: "component_count", value: 2, evidenceRefs: [] }] })).toThrow();
    expect(() => classifyCommercialProductType({ observations: [{ kind: "component_count", value: true, evidenceRefs: ["sds:3"] }] })).toThrow(/require a number/);
  });
});
