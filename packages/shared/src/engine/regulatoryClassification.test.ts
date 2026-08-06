import { describe, expect, it } from "vitest";
import { classifyProductRegulatory } from "./regulatoryClassification";
import type { ProductFamily } from "../schemas/product";

function family(over: Partial<ProductFamily> = {}): Pick<ProductFamily, "domain" | "subtype" | "name" | "hazardClass" | "intendedUsers" | "intendedUse"> {
  return {
    domain: "laundry_powder",
    subtype: "standard",
    name: "Standard Laundry Powder",
    hazardClass: "ordinary",
    intendedUsers: [],
    intendedUse: "General laundry",
    ...over,
  };
}

describe("classifyProductRegulatory", () => {
  it("maps a known domain to its base regulatory category", () => {
    const result = classifyProductRegulatory({ family: family() });
    expect(result.category).toBe("laundry_detergent");
    expect(result.uncertain).toBe(false);
    expect(result.reasoning.length).toBeGreaterThan(0);
  });

  it("always includes non-empty reasoning", () => {
    const result = classifyProductRegulatory({ family: family({ domain: "dishwashing" }) });
    expect(result.reasoning.length).toBeGreaterThan(0);
    expect(result.category).toBe("dishwashing_product");
  });

  it("escalates to medical_or_health_related_product when the family hazard class is medical", () => {
    const result = classifyProductRegulatory({ family: family({ domain: "hand_hygiene", hazardClass: "medical" }) });
    expect(result.category).toBe("medical_or_health_related_product");
  });

  it("escalates to medical_or_health_related_product on a medical/therapeutic claim, regardless of domain", () => {
    const result = classifyProductRegulatory({ family: family({ domain: "laundry_powder" }), claims: ["Therapeutic relief for sensitive skin"] });
    expect(result.category).toBe("medical_or_health_related_product");
  });

  it("confirms disinfectant for a regulated_disinfectant hazard class", () => {
    const result = classifyProductRegulatory({ family: family({ domain: "disinfectant", hazardClass: "regulated_disinfectant" }) });
    expect(result.category).toBe("disinfectant");
    expect(result.uncertain).toBe(false);
  });

  it("escalates regulated_disinfectant to biocidal_product on a biocidal-style claim, flagged uncertain", () => {
    const result = classifyProductRegulatory({
      family: family({ domain: "disinfectant", hazardClass: "regulated_disinfectant" }),
      claims: ["Effective insecticide and pesticide"],
    });
    expect(result.category).toBe("biocidal_product");
    expect(result.uncertain).toBe(true);
  });

  it("refines oral_care to toothpaste when the subtype/name says so", () => {
    const result = classifyProductRegulatory({ family: family({ domain: "oral_care", subtype: "toothpaste", name: "Whitening Toothpaste" }) });
    expect(result.category).toBe("toothpaste");
  });

  it("leaves oral_care as oral_care_product when not specifically toothpaste", () => {
    const result = classifyProductRegulatory({ family: family({ domain: "oral_care", subtype: "mouthwash", name: "Mouthwash" }) });
    expect(result.category).toBe("oral_care_product");
  });

  it("refines wet_wipes to baby_wipe when target users indicate infants", () => {
    const result = classifyProductRegulatory({ family: family({ domain: "wet_wipes" }), targetUsers: ["babies"] });
    expect(result.category).toBe("baby_wipe");
  });

  it("leaves wet_wipes as wet_wipe with no baby-specific signal", () => {
    const result = classifyProductRegulatory({ family: family({ domain: "wet_wipes" }) });
    expect(result.category).toBe("wet_wipe");
  });

  it("escalates household/dishwashing to institutional_cleaning_product on an institutional-use claim", () => {
    const result = classifyProductRegulatory({ family: family({ domain: "surface_cleaner" }), claims: ["For institutional use only"] });
    expect(result.category).toBe("institutional_cleaning_product");
    expect(result.uncertain).toBe(true);
  });

  it("falls back to human_review_required, marked uncertain, for an unmapped domain", () => {
    // Cast bypasses the PRODUCT_DOMAINS union deliberately, to exercise the
    // "no configured mapping" fallback path a future domain addition could hit.
    const result = classifyProductRegulatory({ family: family({ domain: "unmapped_future_domain" as never }) });
    expect(result.category).toBe("human_review_required");
    expect(result.uncertain).toBe(true);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("never returns confidence outside [0, 1]", () => {
    for (const domain of ["laundry_powder", "disinfectant", "wet_wipes", "oral_care"] as const) {
      const result = classifyProductRegulatory({ family: family({ domain }) });
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });
});
