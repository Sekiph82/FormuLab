import { describe, expect, it } from "vitest";
import { canonicalChemistryIdFromInci, cleanPrintedMaterialName, referenceFormulationCanonicalChemistryCandidates } from "./referenceFormulationCanonicalChemistry";
import printedNames from "./printedMaterialNameCases.json";

describe("canonical chemistry from printed INCI names", () => {
  it("reads the material name without list numbers, phase letters, supplier suffixes or column labels", () => {
    // The pipeline's clean_printed_name / inci_chemistry_id read the same cases and must agree.
    for (const { printed, name, id } of printedNames) {
      expect(cleanPrintedMaterialName(printed), printed).toBe(name);
      expect(canonicalChemistryIdFromInci(printed), printed).toBe(id);
    }
  });

  it("gives one deterministic id per single INCI name", () => {
    expect(canonicalChemistryIdFromInci("Sodium Laureth Sulfate")).toBe("inci:sodium-laureth-sulfate");
    expect(canonicalChemistryIdFromInci(" sodium  laureth sulfate* ")).toBe("inci:sodium-laureth-sulfate");
    expect(canonicalChemistryIdFromInci("Acrylates/C10-30 Alkyl Acrylate Crosspolymer")).toBe("inci:acrylates-c10-30-alkyl-acrylate-crosspolymer");
    expect(canonicalChemistryIdFromInci("1,2-Hexanediol")).toBe("inci:1-2-hexanediol");
  });

  it("treats water synonyms as one chemistry", () => {
    for (const name of ["Aqua", "Water", "Aqua (Water)", "Water (Aqua)", "Aqua/Water"]) {
      expect(canonicalChemistryIdFromInci(name)).toBe("inci:water");
    }
  });

  it("leaves blends, amounts and empty cells unresolved", () => {
    expect(canonicalChemistryIdFromInci("Cetearyl Alcohol (and) Ceteareth-20")).toBeUndefined();
    expect(canonicalChemistryIdFromInci("Glycerin, Water")).toBeUndefined();
    expect(canonicalChemistryIdFromInci("2.5 %")).toBeUndefined();
    expect(canonicalChemistryIdFromInci(undefined)).toBeUndefined();
  });

  it("maps only lines that print an INCI name", () => {
    const cell = (rawValue: string) => ({ rawValue }) as never;
    const lines = [
      { id: "l1", inciOrChemicalName: cell("Glycerin") },
      { id: "l2" },
      { id: "l3", inciOrChemicalName: cell("Cetearyl Alcohol (and) Ceteareth-20") },
    ] as never;
    expect(referenceFormulationCanonicalChemistryCandidates({ ingredientLines: lines })).toEqual({ l1: ["inci:glycerin"] });
  });
});
