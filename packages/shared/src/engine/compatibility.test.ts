import { describe, expect, it } from "vitest";
import { evaluateCompatibility, summarizeCompatibilityFindings } from "./compatibility";
import { SEED_COMPATIBILITY_RULES } from "../catalog/compatibilityRules";
import type { CompatibilityRule } from "../schemas/compatibility";
import type { FormulationLine } from "../schemas/formulation";
import type { RawMaterial } from "../schemas/materials";

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

const ruleFor = (id: string): CompatibilityRule => {
  const r = SEED_COMPATIBILITY_RULES.find((x) => x.id === id);
  if (!r) throw new Error(`no seed rule ${id}`);
  return r;
};

describe("evaluateCompatibility", () => {
  it("flags an anionic + cationic combination", () => {
    const lines = [
      line({ displayName: "SLES", percent: "12", functions: ["anionic_surfactant"] }),
      line({ displayName: "BTC", percent: "0.5", functions: ["cationic_surfactant"] }),
    ];
    const findings = evaluateCompatibility(lines, [ruleFor("compat-anionic-cationic")], { materials: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].lineIds.sort()).toEqual(["line-BTC", "line-SLES"]);
  });

  it("does not fire when only one side of a combination is present", () => {
    const lines = [line({ displayName: "SLES", percent: "12", functions: ["anionic_surfactant"] })];
    const findings = evaluateCompatibility(lines, [ruleFor("compat-anionic-cationic")], { materials: [] });
    expect(findings).toHaveLength(0);
  });

  it("blocks QAC + anionic as an error-severity finding", () => {
    const lines = [
      line({ displayName: "BAC-50", percent: "1", functions: ["qac_active"] }),
      line({ displayName: "SLES", percent: "10", functions: ["anionic_surfactant"] }),
    ];
    const findings = evaluateCompatibility(lines, [ruleFor("compat-qac-anionic")], { materials: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].verificationStatus).toBe("human_review_required");
  });

  it("flags chlorhexidine + anionic", () => {
    const lines = [
      line({ displayName: "Chlorhexidine digluconate", percent: "0.5", functions: ["chlorhexidine_active"] }),
      line({ displayName: "SLES", percent: "10", functions: ["anionic_surfactant"] }),
    ];
    const findings = evaluateCompatibility(lines, [ruleFor("compat-chlorhexidine-anionic")], { materials: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe("compat-chlorhexidine-anionic");
  });

  it("blocks acid + hypochlorite as a blocking-severity finding", () => {
    const lines = [
      line({ displayName: "Sodium Hypochlorite 12%", percent: "10", functions: ["bleaching_agent"] }),
      line({ displayName: "Citric Acid", percent: "1", functions: ["ph_adjuster"] }),
    ];
    const findings = evaluateCompatibility(lines, [ruleFor("compat-acid-hypochlorite")], { materials: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("blocking");
  });

  it("flags oxidizer + reducer", () => {
    const lines = [
      line({ displayName: "Sodium Percarbonate", percent: "10", functions: ["oxygen_donor"] }),
      line({ displayName: "BHT", percent: "0.1", functions: ["antioxidant"] }),
    ];
    const findings = evaluateCompatibility(lines, [ruleFor("compat-oxidizer-reducer")], { materials: [] });
    expect(findings).toHaveLength(1);
  });

  it("flags a carbomer with no neutralizer as a required-coingredient finding", () => {
    const lines = [line({ displayName: "Carbomer 940", percent: "0.3", functions: ["rheology_modifier"] })];
    const findings = evaluateCompatibility(lines, [ruleFor("compat-carbomer-neutralizer")], { materials: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0].triggeredConditions).toEqual([0]);
  });

  it("does not flag a carbomer when a pH adjuster is also present", () => {
    const lines = [
      line({ displayName: "Carbomer 940", percent: "0.3", functions: ["rheology_modifier"] }),
      line({ displayName: "Sodium Hydroxide", percent: "0.2", functions: ["ph_adjuster"] }),
    ];
    const findings = evaluateCompatibility(lines, [ruleFor("compat-carbomer-neutralizer")], { materials: [] });
    expect(findings).toHaveLength(0);
  });

  it("flags a preservative outside the target pH range", () => {
    const lines = [line({ displayName: "Sodium Benzoate", percent: "0.5", functions: ["preservative"] })];
    const findings = evaluateCompatibility(lines, [ruleFor("compat-preservative-ph")], {
      materials: [],
      phTarget: "9.5",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].dataIncomplete).toBe(false);
  });

  it("does not flag a preservative within range", () => {
    const lines = [line({ displayName: "Sodium Benzoate", percent: "0.5", functions: ["preservative"] })];
    const findings = evaluateCompatibility(lines, [ruleFor("compat-preservative-ph")], {
      materials: [],
      phTarget: "5.5",
    });
    expect(findings).toHaveLength(0);
  });

  it("reports pH-dependent findings as data-incomplete, never a false 'safe', when pH is unknown", () => {
    const lines = [line({ displayName: "Sodium Benzoate", percent: "0.5", functions: ["preservative"] })];
    const findings = evaluateCompatibility(lines, [ruleFor("compat-preservative-ph")], { materials: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0].dataIncomplete).toBe(true);
    expect(findings[0].message).toMatch(/not set/);
  });

  it("flags packaging incompatibility using the target packaging context", () => {
    const lines = [line({ displayName: "Sodium Hypochlorite 12%", percent: "10", functions: ["bleaching_agent"] })];
    const findings = evaluateCompatibility(lines, [ruleFor("compat-bleach-packaging")], {
      materials: [],
      packagingComponentTypes: ["pouch"],
    });
    expect(findings).toHaveLength(1);
  });

  it("does not flag packaging incompatibility for unrelated packaging", () => {
    const lines = [line({ displayName: "Sodium Hypochlorite 12%", percent: "10", functions: ["bleaching_agent"] })];
    const findings = evaluateCompatibility(lines, [ruleFor("compat-bleach-packaging")], {
      materials: [],
      packagingComponentTypes: ["drum"],
    });
    expect(findings).toHaveLength(0);
  });

  it("matches ionic character from the material library when the line itself has no function set", () => {
    const materials: RawMaterial[] = [
      {
        schemaVersion: "1.0",
        code: "M-CAT",
        displayName: "Unlisted cationic",
        casNumbers: [],
        ecNumbers: [],
        functions: [],
        ionicCharacter: "cationic",
        activeMatterState: "missing",
        documents: [],
        regulatoryStatuses: [],
        hazardClassifications: [],
        allergens: [],
        incompatibilities: [],
        substituteCodes: [],
        active: true,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ];
    const lines = [
      line({ displayName: "SLES", percent: "12", functions: ["anionic_surfactant"] }),
      line({ displayName: "Unlisted cationic", percent: "1", materialCode: "M-CAT" }),
    ];
    const findings = evaluateCompatibility(lines, [ruleFor("compat-anionic-cationic")], { materials });
    expect(findings).toHaveLength(1);
  });

  it("does not duplicate a finding when evaluated twice", () => {
    const lines = [
      line({ displayName: "SLES", percent: "12", functions: ["anionic_surfactant"] }),
      line({ displayName: "BTC", percent: "0.5", functions: ["cationic_surfactant"] }),
    ];
    const rules = [ruleFor("compat-anionic-cationic")];
    const first = evaluateCompatibility(lines, rules, { materials: [] });
    const second = evaluateCompatibility(lines, rules, { materials: [] });
    expect(first.map((f) => f.id)).toEqual(second.map((f) => f.id));
    expect(new Set(first.map((f) => f.id)).size).toBe(first.length);
  });

  it("ignores a deprecated rule", () => {
    const lines = [
      line({ displayName: "SLES", percent: "12", functions: ["anionic_surfactant"] }),
      line({ displayName: "BTC", percent: "0.5", functions: ["cationic_surfactant"] }),
    ];
    const deprecated: CompatibilityRule = { ...ruleFor("compat-anionic-cationic"), status: "deprecated" };
    expect(evaluateCompatibility(lines, [deprecated], { materials: [] })).toHaveLength(0);
  });

  it("ignores an inactive rule", () => {
    const lines = [
      line({ displayName: "SLES", percent: "12", functions: ["anionic_surfactant"] }),
      line({ displayName: "BTC", percent: "0.5", functions: ["cationic_surfactant"] }),
    ];
    const inactive: CompatibilityRule = { ...ruleFor("compat-anionic-cationic"), active: false };
    expect(evaluateCompatibility(lines, [inactive], { materials: [] })).toHaveLength(0);
  });

  it("carries an unverified rule's status through to the finding, never upgrading it", () => {
    const lines = [
      line({ displayName: "SLES", percent: "12", functions: ["anionic_surfactant"] }),
      line({ displayName: "BTC", percent: "0.5", functions: ["cationic_surfactant"] }),
    ];
    const findings = evaluateCompatibility(lines, [ruleFor("compat-anionic-cationic")], { materials: [] });
    expect(findings[0].verificationStatus).toBe("not_verified");
  });

  it("every seed rule category evaluates without throwing on an empty formula", () => {
    expect(() => evaluateCompatibility([], SEED_COMPATIBILITY_RULES, { materials: [] })).not.toThrow();
    expect(evaluateCompatibility([], SEED_COMPATIBILITY_RULES, { materials: [] })).toEqual([]);
  });
});

describe("summarizeCompatibilityFindings", () => {
  it("counts findings by severity and data-completeness", () => {
    const lines = [
      line({ displayName: "SLES", percent: "12", functions: ["anionic_surfactant"] }),
      line({ displayName: "BTC", percent: "0.5", functions: ["cationic_surfactant"] }),
      line({ displayName: "Sodium Benzoate", percent: "0.5", functions: ["preservative"] }),
    ];
    const findings = evaluateCompatibility(
      lines,
      [ruleFor("compat-anionic-cationic"), ruleFor("compat-preservative-ph")],
      { materials: [] },
    );
    const summary = summarizeCompatibilityFindings(findings);
    expect(summary.warning).toBe(2);
    expect(summary.dataIncomplete).toBe(1);
  });
});
