import { describe, expect, it } from "vitest";
import { buildKenyaCatalog, KENYA_CATALOG_SKU_COUNT } from "./kenya";
import { packagingSkuSchema, productFamilySchema } from "../schemas/product";

describe("Kenya product catalog", () => {
  const catalog = buildKenyaCatalog();

  it("covers every family and SKU in the factory portfolio", () => {
    // 55 families across the 17 supported domains; the SKU count is asserted
    // against the constant so a dropped pack size fails loudly.
    expect(catalog.families.length).toBeGreaterThanOrEqual(50);
    expect(catalog.skus.length).toBe(KENYA_CATALOG_SKU_COUNT);
    expect(catalog.skus.length).toBeGreaterThanOrEqual(80);
  });

  it("validates against the schema", () => {
    for (const f of catalog.families) {
      expect(productFamilySchema.safeParse(f).success).toBe(true);
    }
    for (const s of catalog.skus) {
      expect(packagingSkuSchema.safeParse(s).success).toBe(true);
    }
  });

  it("is idempotent — re-seeding cannot duplicate records", () => {
    const again = buildKenyaCatalog();
    expect(again).toEqual(catalog);
    expect(new Set(catalog.families.map((f) => f.code)).size).toBe(
      catalog.families.length,
    );
    expect(new Set(catalog.skus.map((s) => s.skuCode)).size).toBe(
      catalog.skus.length,
    );
  });

  it("keeps one formulation family across pack sizes", () => {
    // The stated rule: a 250 ml bottle and an 8 ml sachet of the same shampoo
    // share a family, so a pack-size change never forces a formula revision.
    const shampoo = catalog.skus.filter(
      (s) => s.productFamilyCode === "HC-SHAMPOO-REG",
    );
    expect(shampoo).toHaveLength(2);
    expect(shampoo.map((s) => s.packagingType).sort()).toEqual([
      "bottle",
      "sachet",
    ]);
    expect(new Set(shampoo.map((s) => s.productFamilyCode)).size).toBe(1);
  });

  it("derives identity from codes, never display names", () => {
    for (const s of catalog.skus) {
      expect(s.id).toBe(`sku:${s.skuCode}`);
      expect(s.skuCode).toMatch(/^[A-Z0-9-]+$/); // no spaces, no lowercase
    }
    for (const f of catalog.families) {
      expect(f.id).toBe(`family:${f.code}`);
    }
  });

  it("every SKU points at a family that exists", () => {
    const codes = new Set(catalog.families.map((f) => f.code));
    for (const s of catalog.skus) {
      expect(codes.has(s.productFamilyCode)).toBe(true);
    }
  });

  it("flags hazardous and claim-regulated families for review", () => {
    const byCode = new Map(catalog.families.map((f) => [f.code, f]));
    // Bleach is hazardous; chlorhexidine wipes are a medical product; QAC
    // sanitizers carry a regulated disinfection claim. None may be treated as
    // an ordinary consumer product by the safety engine.
    expect(byCode.get("BL-REGULAR")?.hazardClass).toBe("industrial");
    expect(byCode.get("WW-MEDICAL-CHX")?.hazardClass).toBe("medical");
    expect(byCode.get("DI-QAC-SURFACE")?.hazardClass).toBe(
      "regulated_disinfectant",
    );
    expect(byCode.get("HC-SHAMPOO-REG")?.hazardClass).toBe("ordinary");
  });

  it("normalises the toothpaste tube to grams while keeping the label", () => {
    const tube = catalog.skus.find((s) => s.skuCode.startsWith("OC-WHITENING"));
    expect(tube?.unit).toBe("g"); // source list said "75 gr"
    expect(tube?.quantity).toBe(75);
    expect(tube?.displayName).toContain("75 g Tube");
  });

  it("marks baby and infant products with their intended users", () => {
    const baby = catalog.families.find((f) => f.code === "HC-SHAMPOO-BABY");
    expect(baby?.intendedUsers).toContain("infants");
  });
});
