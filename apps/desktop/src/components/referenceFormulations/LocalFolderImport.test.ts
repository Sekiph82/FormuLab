import { describe, expect, it } from "vitest";
import { classify, sourceCategoriesFromPath } from "./LocalFolderImport";

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
});
