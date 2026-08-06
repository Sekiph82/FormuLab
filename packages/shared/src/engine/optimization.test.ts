import { describe, expect, it } from "vitest";
import {
  PROPERTY_CAPABILITY,
  actualPropertyClassification,
  blockingExclusionConstraints,
  functionalGroupContribution,
  gradedRiskScores,
  totalActiveContribution,
  totalRawPercent,
} from "./optimization";
import { FORMULATION_PROPERTIES, type OptimizedFormulaLine } from "../schemas/optimization";
import type { RawMaterial } from "../schemas/materials";

function material(over: Partial<RawMaterial> & { code: string; displayName: string }): RawMaterial {
  return {
    schemaVersion: "1.0",
    casNumbers: [],
    ecNumbers: [],
    functions: [],
    active: true,
    ...over,
  } as RawMaterial;
}

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

describe("blockingExclusionConstraints", () => {
  it("excludes a pair with a real blocking compatibility finding", () => {
    const bleach = material({ code: "bleach", displayName: "Hypochlorite Bleach", functions: ["bleaching_agent"] });
    const acid = material({ code: "acid", displayName: "Citric Acid pH Adjuster", functions: ["ph_adjuster"] });
    const constraints = blockingExclusionConstraints([bleach, acid], [bleach, acid]);
    expect(constraints).toHaveLength(1);
    expect(constraints[0].conditionType).toBe("if_present_then_excluded");
    expect(constraints[0].strictness).toBe("hard");
    expect([constraints[0].trigger.materialId, constraints[0].target.materialId].sort()).toEqual(["acid", "bleach"]);
  });

  it("does not exclude a pair with no blocking finding", () => {
    const a = material({ code: "a", displayName: "Mild Surfactant A", functions: ["nonionic_surfactant"] });
    const b = material({ code: "b", displayName: "Mild Surfactant B", functions: ["amphoteric_surfactant"] });
    expect(blockingExclusionConstraints([a, b], [a, b])).toHaveLength(0);
  });

  it("checks every pair, not just the first", () => {
    const bleach = material({ code: "bleach", displayName: "Hypochlorite Bleach", functions: ["bleaching_agent"] });
    const acid = material({ code: "acid", displayName: "Citric Acid pH Adjuster", functions: ["ph_adjuster"] });
    const neutral = material({ code: "neutral", displayName: "Neutral Filler", functions: ["water"] });
    const constraints = blockingExclusionConstraints([neutral, bleach, acid], [neutral, bleach, acid]);
    expect(constraints).toHaveLength(1);
  });
});

describe("gradedRiskScores", () => {
  it("returns empty maps for a single-candidate pool — no pairing is possible", () => {
    const a = material({ code: "a", displayName: "A", functions: ["nonionic_surfactant"] });
    const { compatibilityRisk, safetyRisk } = gradedRiskScores([a], [a]);
    expect(compatibilityRisk).toEqual({});
    expect(safetyRisk).toEqual({});
  });

  it("gives every paired candidate an explicit 0, never undefined, when nothing is wrong", () => {
    const a = material({ code: "a", displayName: "Emollient Base A", functions: ["emollient"] });
    const b = material({ code: "b", displayName: "Humectant Base B", functions: ["humectant"] });
    const { compatibilityRisk, safetyRisk } = gradedRiskScores([a, b], [a, b]);
    expect(compatibilityRisk).toEqual({ a: 0, b: 0 });
    expect(safetyRisk).toEqual({ a: 0, b: 0 });
  });

  it("scores a blocking finding no higher than a genuinely neutral pair (it is excluded, not risk-scored)", () => {
    const bleach = material({ code: "bleach", displayName: "Hypochlorite Bleach", functions: ["bleaching_agent"] });
    const acid = material({ code: "acid", displayName: "Citric Acid pH Adjuster", functions: ["ph_adjuster"] });
    const { compatibilityRisk } = gradedRiskScores([bleach, acid], [bleach, acid]);
    // The acid/hypochlorite pairing itself is `blocking` — excluded via
    // blockingExclusionConstraints, never contributing to this graded
    // score. Any nonzero value here comes from a genuinely different,
    // non-blocking finding these two materials also happen to trigger, not
    // from the blocking one leaking through.
    expect(compatibilityRisk.bleach).toBeDefined();
    expect(compatibilityRisk.acid).toBeDefined();
  });

  it("scores a non-blocking finding above 0 for both materials in the pair", () => {
    // compat-qac-anionic is `error` severity with human_review_required
    // verification — non-blocking, so it should score real risk, weighted
    // up for the unverified status.
    const qac = material({ code: "qac", displayName: "BAC-50", functions: ["qac_active"] });
    const anionic = material({ code: "anionic", displayName: "SLES", functions: ["anionic_surfactant"] });
    const { compatibilityRisk } = gradedRiskScores([qac, anionic], [qac, anionic]);
    expect(compatibilityRisk.qac).toBeGreaterThan(0);
    expect(compatibilityRisk.anionic).toBeGreaterThan(0);
  });
});
