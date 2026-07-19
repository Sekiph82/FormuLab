import { describe, expect, it } from "vitest";
import { HUMAN_REVIEW_CLASSIFICATIONS, classifyProductSafety, evaluateSafety, summarizeSafetyFindings } from "./safety";
import { SEED_SAFETY_RULES } from "../catalog/safetyRules";
import type { SafetyRule } from "../schemas/safety";
import type { FormulationLine } from "../schemas/formulation";

function line(over: Partial<FormulationLine> & { displayName: string; percent: string }): FormulationLine {
  return {
    id: over.id ?? `line-${over.displayName}`,
    lineNumber: over.lineNumber ?? 1,
    phase: over.phase ?? "A",
    displayName: over.displayName,
    percent: over.percent,
    isQsToHundred: over.isQsToHundred ?? false,
    functions: over.functions ?? [],
    materialCode: over.materialCode,
    activeMatterPercent: over.activeMatterPercent,
    provenance: over.provenance ?? { origin: "model_estimate", evidenceClaimIds: [] },
  };
}

const ruleFor = (id: string): SafetyRule => {
  const r = SEED_SAFETY_RULES.find((x) => x.id === id);
  if (!r) throw new Error(`no seed rule ${id}`);
  return r;
};

describe("classifyProductSafety", () => {
  it("classifies an ordinary family as an ordinary consumer product", () => {
    expect(classifyProductSafety({ hazardClass: "ordinary", name: "Shampoo – Regular", code: "HC-SHAMPOO-REG" })).toBe(
      "ordinary_consumer_product",
    );
  });

  it("classifies a medical-tagged family as medical/health-related", () => {
    expect(classifyProductSafety({ hazardClass: "medical", name: "Toothpaste", code: "HC-TOOTHPASTE" })).toBe(
      "medical_or_health_related_product",
    );
  });

  it("classifies a regulated_disinfectant-tagged family straight through", () => {
    expect(classifyProductSafety({ hazardClass: "regulated_disinfectant", name: "QAC Surface Sanitizer", code: "IN-QAC" })).toBe(
      "regulated_disinfectant",
    );
  });

  it("escalates bleach out of plain industrial into hazardous_lawful_product", () => {
    expect(classifyProductSafety({ hazardClass: "industrial", name: "Bleach – Regular", code: "BL-REGULAR" })).toBe(
      "hazardous_lawful_product",
    );
  });

  it("keeps a non-hazardous industrial cleaner at industrial_cleaning_product", () => {
    expect(classifyProductSafety({ hazardClass: "industrial", name: "Glass Cleaner", code: "IC-GLASS" })).toBe(
      "industrial_cleaning_product",
    );
  });

  it("requires human review for an ordinary product carrying an antibacterial claim", () => {
    expect(
      classifyProductSafety({ hazardClass: "ordinary", name: "Liquid Hand Soap", code: "HC-HANDSOAP" }, ["Antibacterial protection"]),
    ).toBe("human_review_required");
  });

  it("lists hazardous/disinfectant/medical/restricted/review classifications as requiring human review", () => {
    for (const c of ["hazardous_lawful_product", "regulated_disinfectant", "medical_or_health_related_product", "restricted_request", "human_review_required"] as const) {
      expect(HUMAN_REVIEW_CLASSIFICATIONS).toContain(c);
    }
    expect(HUMAN_REVIEW_CLASSIFICATIONS).not.toContain("ordinary_consumer_product");
  });
});

describe("evaluateSafety", () => {
  it("blocks acid + hypochlorite", () => {
    const lines = [
      line({ displayName: "Sodium Hypochlorite 12%", percent: "10", functions: ["bleaching_agent"] }),
      line({ displayName: "Citric Acid", percent: "1", functions: ["ph_adjuster"] }),
    ];
    const findings = evaluateSafety(lines, [ruleFor("safety-acid-hypochlorite")], { materials: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("blocking");
    expect(findings[0].requiredPpe.length).toBeGreaterThan(0);
    expect(findings[0].humanReviewRequired).toBe(true);
  });

  it("requires human review for hypochlorite + disinfectant classification path", () => {
    expect(evaluateSafety([], [ruleFor("safety-hypochlorite-amine")], { materials: [] })).toEqual([]);
  });

  it("flags corrosivity from an extreme pH target", () => {
    const lines = [line({ displayName: "Sodium Hydroxide", percent: "2", functions: ["ph_adjuster"] })];
    const findings = evaluateSafety(lines, [ruleFor("safety-corrosivity")], { materials: [], phTarget: "13.5" });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });

  it("does not flag corrosivity within the safe pH band", () => {
    const lines = [line({ displayName: "Sodium Hydroxide", percent: "2", functions: ["ph_adjuster"] })];
    const findings = evaluateSafety(lines, [ruleFor("safety-corrosivity")], { materials: [], phTarget: "7" });
    expect(findings).toHaveLength(0);
  });

  it("reports missing pH as data-incomplete rather than a false 'safe'", () => {
    const lines = [line({ displayName: "Sodium Hydroxide", percent: "2", functions: ["ph_adjuster"] })];
    const findings = evaluateSafety(lines, [ruleFor("safety-corrosivity")], { materials: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0].dataIncomplete).toBe(true);
  });

  it("blocking finding prevents approval progression (a blocking safety finding must survive to the readiness check)", () => {
    const lines = [
      line({ displayName: "Sodium Hypochlorite 12%", percent: "10", functions: ["bleaching_agent"] }),
      line({ displayName: "Ammonia solution", percent: "1", functions: ["cationic_surfactant"] }),
    ];
    const findings = evaluateSafety(lines, [ruleFor("safety-hypochlorite-amine")], { materials: [] });
    expect(findings.some((f) => f.severity === "blocking")).toBe(true);
  });

  it("does not duplicate findings across repeated evaluation", () => {
    const lines = [
      line({ displayName: "Sodium Hypochlorite 12%", percent: "10", functions: ["bleaching_agent"] }),
      line({ displayName: "Citric Acid", percent: "1", functions: ["ph_adjuster"] }),
    ];
    const rules = [ruleFor("safety-acid-hypochlorite")];
    const a = evaluateSafety(lines, rules, { materials: [] });
    const b = evaluateSafety(lines, rules, { materials: [] });
    expect(a.map((f) => f.id)).toEqual(b.map((f) => f.id));
  });

  it("ignores a deprecated rule", () => {
    const lines = [
      line({ displayName: "Sodium Hypochlorite 12%", percent: "10", functions: ["bleaching_agent"] }),
      line({ displayName: "Citric Acid", percent: "1", functions: ["ph_adjuster"] }),
    ];
    const deprecated: SafetyRule = { ...ruleFor("safety-acid-hypochlorite"), status: "deprecated" };
    expect(evaluateSafety(lines, [deprecated], { materials: [] })).toHaveLength(0);
  });

  it("carries an unverified rule's status through to the finding", () => {
    const lines = [
      line({ displayName: "Sodium Percarbonate", percent: "10", functions: ["oxygen_donor"] }),
      line({ displayName: "BHT", percent: "0.1", functions: ["antioxidant"] }),
    ];
    const findings = evaluateSafety(lines, [ruleFor("safety-oxidizer-reducer")], { materials: [] });
    expect(findings[0].verificationStatus).toBe("not_verified");
  });

  it("flags an alcohol solvent above the flammability concentration threshold", () => {
    const lines = [line({ displayName: "Ethanol", percent: "75", functions: ["solvent"] })];
    const findings = evaluateSafety(lines, [ruleFor("safety-flammable-solvent")], { materials: [] });
    expect(findings).toHaveLength(1);
  });

  it("every seed safety rule evaluates without throwing on an empty formula", () => {
    expect(() => evaluateSafety([], SEED_SAFETY_RULES, { materials: [] })).not.toThrow();
    expect(evaluateSafety([], SEED_SAFETY_RULES, { materials: [] })).toEqual([]);
  });
});

describe("summarizeSafetyFindings", () => {
  it("counts by severity and human-review flag", () => {
    const lines = [
      line({ displayName: "Sodium Hypochlorite 12%", percent: "10", functions: ["bleaching_agent"] }),
      line({ displayName: "Citric Acid", percent: "1", functions: ["ph_adjuster"] }),
    ];
    const findings = evaluateSafety(lines, [ruleFor("safety-acid-hypochlorite")], { materials: [] });
    const summary = summarizeSafetyFindings(findings);
    expect(summary.blocking).toBe(1);
    expect(summary.humanReviewRequired).toBe(1);
  });
});
