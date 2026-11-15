import { describe, expect, it } from "vitest";
import { classifyProductFamily, productFamilyForRequest } from "./productFamilyTaxonomy";

const family = (title: string, sourceCategories: string[] = [], headings: string[] = []) =>
  classifyProductFamily({ title, sourceCategories, headings })?.key;

describe("product family taxonomy", () => {
  it("reads the family from supplier title formats (underscores, hyphens, codes)", () => {
    expect(family("3_in_1_Treatment_Concentrate_Anti_Dandruff_Shampoo_EN_FORM_GEN_504249_en_US")).toBe("shampoo");
    expect(family("110-00874-01-glass-cleaner")).toBe("hard_surface_cleaner");
    expect(family("119-01641-01-bubble-bath")).toBe("body_wash");
    expect(family("01-05.977_Automatic_Dish_Detergent_Citrate_Powder")).toBe("dishwash_automatic");
    expect(family("Croda_17_Toilet_Rim_Gel")).toBe("toilet_cleaner");
  });

  it("lets specific families win over generic words in the same title", () => {
    expect(family("Fabric conditioner with 3-in-1 protection")).toBe("fabric_softener");
    expect(family("Premium Automatic Dishwasher Tablets")).toBe("dishwash_automatic");
    expect(family("Laundry Detergent Powder")).toBe("laundry_detergent");
    expect(family("Alkaline metal cleaner formulation 512")).toBe("industrial_cleaner");
    expect(family("Baby shampoo")).toBe("shampoo");
  });

  it("falls back to page headings, then a specific source folder, then the broad group", () => {
    expect(family("Clariant Formulation Card Aqua Touch 2023 EN", [], ["Body Wash"])).toBe("body_wash");
    expect(family("Ref 4411", ["Croda", "Automatic Dishwash"])).toBe("dishwash_automatic");
    expect(classifyProductFamily({ title: "Ref 4411", sourceCategories: ["Hair Care"] })).toMatchObject({ key: "hair_care", level: "group", method: "source_category" });
    expect(classifyProductFamily({ title: "Ref 4411", sourceCategories: ["Beauty_Care"] })).toMatchObject({ key: "skin_care", level: "group", method: "source_category" });
  });

  it("returns nothing rather than guessing", () => {
    expect(classifyProductFamily({ title: "110-00797-01-acetal" })).toBeUndefined();
    expect(classifyProductFamily({ title: "" })).toBeUndefined();
  });

  it("maps what a user types as product type", () => {
    expect(productFamilyForRequest("Shampoo")?.key).toBe("shampoo");
    expect(productFamilyForRequest("hand dishwashing liquid")?.key).toBe("dishwash_hand");
  });

  it("maps Turkish product types", () => {
    expect(productFamilyForRequest("Şampuan")?.key).toBe("shampoo");
    expect(productFamilyForRequest("SAÇ KREMİ")?.key).toBe("conditioner");
    expect(productFamilyForRequest("Bulaşık makinesi deterjanı")?.key).toBe("dishwash_automatic");
    expect(productFamilyForRequest("Elde bulaşık deterjanı")?.key).toBe("dishwash_hand");
    expect(productFamilyForRequest("Çamaşır yumuşatıcısı")?.key).toBe("fabric_softener");
    expect(productFamilyForRequest("Sıvı çamaşır deterjanı")?.key).toBe("laundry_detergent");
    expect(productFamilyForRequest("Duş jeli")?.key).toBe("body_wash");
    expect(productFamilyForRequest("Güneş kremi")?.key).toBe("sunscreen");
    expect(productFamilyForRequest("Yüzey temizleyici")?.key).toBe("hard_surface_cleaner");
  });
});
