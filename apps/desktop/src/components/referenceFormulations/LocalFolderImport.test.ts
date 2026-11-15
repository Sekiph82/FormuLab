import { describe, expect, it } from "vitest";
import { classify, productDocumentFromPath, sourceCategoriesFromPath } from "./LocalFolderImport";

describe("local folder import paths", () => {
  it("keeps product-category folders as family evidence and drops organising folders", () => {
    expect(sourceCategoriesFromPath("Source/Clariant/Hair Care/Shampoo X Formulation.pdf")).toEqual(["Hair Care"]);
    expect(sourceCategoriesFromPath("Source/BASF/Formulations/Dishwashing/a.pdf")).toEqual(["Dishwashing"]);
    expect(sourceCategoriesFromPath("Source/Clariant/All Formulations/a.pdf")).toEqual([]);
    expect(sourceCategoriesFromPath("Source/Clariant/Imported Downloads - verified duplicates/Formulation Copies/a.pdf")).toEqual([]);
    expect(sourceCategoriesFromPath("Source/Clariant/Products/Aristoflex AVC/a.pdf")).toEqual([]);
    expect(sourceCategoriesFromPath(String.raw`Source\Croda\Automatic Dishwash\Croda_17_x.pdf`)).toEqual(["Automatic Dishwash"]);
  });

  it("never imports files under an Excluded folder as formulations", () => {
    expect(classify("Source/Croda/Excluded/Croda_17_Formulation.pdf")).toBe("OTHER");
    expect(classify("Source/Croda/Hair Care/Croda_17_Formulation.pdf")).toBe("FORMULATION");
  });

  it("reads raw-material documents by their product folder", () => {
    expect(classify("Source/Croda/Products/Brij CS20/SDS/ET43067_BRIJ CS20-SO-(MH)_USENSDS.pdf")).toBe("SDS");
    expect(classify("Source/Croda/Products/Brij CS20/Data Sheet/3079_DI007-Brij.pdf")).toBe("TDS");
    expect(classify("Source/Croda/Products/Coltide HSi/Marketing Sheet/4426_Coltide_HSi.pdf")).toBe("PRODUCT_DOC");
    expect(classify("Source/Dow/Products/DOWSIL_5200/Regulatory/DOWSIL 5200 Regulatory EN.pdf")).toBe("PRODUCT_DOC");
    expect(productDocumentFromPath("Source/Dow/Products/DOWSIL_5200/Regulatory/x.pdf")).toEqual({ product: "DOWSIL 5200", folder: "Regulatory" });
    expect(productDocumentFromPath("Source/Clariant/Products/Aristoflex AVC/x.pdf")).toEqual({ product: "Aristoflex AVC" });
    expect(productDocumentFromPath("Source/Croda/Hair Care/x.pdf")).toBeUndefined();
  });
});
