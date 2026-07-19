import { describe, expect, it } from "vitest";
import {
  PROPERTY_CAPABILITY,
  actualPropertyClassification,
  functionalGroupContribution,
  totalActiveContribution,
  totalRawPercent,
} from "./optimization";
import { FORMULATION_PROPERTIES, type OptimizedFormulaLine } from "../schemas/optimization";

describe("PROPERTY_CAPABILITY", () => {
  it("has an entry for every formulation property", () => {
    for (const property of FORMULATION_PROPERTIES) {
      expect(PROPERTY_CAPABILITY[property]).toBeDefined();
    }
  });

  it("claims active_matter and total_solids are exactly calculated", () => {
    expect(actualPropertyClassification("active_matter")).toBe("calculated");
    expect(actualPropertyClassification("total_solids")).toBe("calculated");
  });

  it("never claims viscosity, foam or hard-water tolerance are calculated or estimated", () => {
    expect(actualPropertyClassification("viscosity")).toBe("laboratory_required");
    expect(actualPropertyClassification("foam_profile")).toBe("laboratory_required");
    expect(actualPropertyClassification("hard_water_tolerance")).toBe("laboratory_required");
  });

  it("caps pH at rule_based_estimate, never calculated", () => {
    expect(actualPropertyClassification("ph")).toBe("rule_based_estimate");
  });
});

const LINES: OptimizedFormulaLine[] = [
  {
    materialId: "a",
    materialCode: "A",
    name: "A",
    percent: "30.0000",
    activeContributionPercent: "24.0000",
    quantityKg: "30.0000",
  },
  {
    materialId: "b",
    materialCode: "B",
    name: "B",
    percent: "70.0000",
    activeContributionPercent: "0.0000",
    quantityKg: "70.0000",
  },
];

describe("totalActiveContribution / totalRawPercent", () => {
  it("sums active contribution across lines", () => {
    expect(totalActiveContribution(LINES)).toBe("24.0000");
  });

  it("sums raw percent across lines", () => {
    expect(totalRawPercent(LINES)).toBe("100.0000");
  });

  it("returns zero for an empty line set", () => {
    expect(totalActiveContribution([])).toBe("0.0000");
    expect(totalRawPercent([])).toBe("0.0000");
  });
});

describe("functionalGroupContribution", () => {
  it("returns 0 when the line's material has none of the requested groups", () => {
    const contribution = functionalGroupContribution(
      { percent: "30", activeContributionPercent: "24" },
      ["preservative"],
      ["anionic_surfactant"],
      "raw_material",
    );
    expect(contribution).toBe("0");
  });

  it("returns the raw percent on a raw_material basis when the group matches", () => {
    const contribution = functionalGroupContribution(
      { percent: "30", activeContributionPercent: "24" },
      ["anionic_surfactant"],
      ["anionic_surfactant"],
      "raw_material",
    );
    expect(contribution).toBe("30.0000");
  });

  it("returns the active contribution on an active_matter basis when the group matches", () => {
    const contribution = functionalGroupContribution(
      { percent: "30", activeContributionPercent: "24" },
      ["anionic_surfactant"],
      ["anionic_surfactant"],
      "active_matter",
    );
    expect(contribution).toBe("24.0000");
  });
});
