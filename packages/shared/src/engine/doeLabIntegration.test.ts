import { describe, expect, it } from "vitest";
import type { DoeFactor } from "../schemas/doe";
import type { FormulationLine } from "../schemas/formulation";
import { applyDoeFactorsToLines } from "./doeLabIntegration";

function line(overrides: Partial<FormulationLine> & Pick<FormulationLine, "id" | "displayName" | "percent">): FormulationLine {
  return {
    lineNumber: 1,
    phase: "A",
    functions: [],
    isQsToHundred: false,
    provenance: { source: "manual" },
    ...overrides,
  };
}

function factor(overrides: Partial<DoeFactor> & Pick<DoeFactor, "factorCode">): DoeFactor {
  return {
    schemaVersion: "1.0",
    id: `factor-${overrides.factorCode}`,
    studyId: "study-1",
    studyRevision: 1,
    name: overrides.factorCode,
    factorType: "continuous",
    sourceType: "formula_material",
    sourceEntityId: "material-sles",
    lowValue: "10",
    highValue: "20",
    categoricalLevels: [],
    transformation: "none",
    precision: 2,
    isMixtureComponent: false,
    isProcessFactor: false,
    isControlled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("applyDoeFactorsToLines", () => {
  it("overwrites the matching material line's percent and leaves fixed ingredients untouched", () => {
    const baseline = [
      line({ id: "l1", materialId: "material-sles", displayName: "SLES", percent: "12" }),
      line({ id: "l2", materialId: "material-water", displayName: "Water", percent: "80", isQsToHundred: true }),
      line({ id: "l3", materialId: "material-salt", displayName: "Salt", percent: "8" }),
    ];
    const factors = [factor({ factorCode: "A", sourceEntityId: "material-sles" })];
    const settings = [{ factorCode: "A", codedValue: "1", actualValue: "15" }];
    const result = applyDoeFactorsToLines(baseline, settings, factors);
    expect(result.lines.find((l) => l.id === "l1")!.percent).toBe("15");
    expect(result.lines.find((l) => l.id === "l2")!.percent).toBe("80");
    expect(result.lines.find((l) => l.id === "l3")!.percent).toBe("8");
  });

  it("routes a non-material factor to processSettings, never onto a formula line", () => {
    const baseline = [line({ id: "l1", materialId: "material-sles", displayName: "SLES", percent: "12" })];
    const factors = [factor({ factorCode: "Temp", sourceType: "temperature", sourceEntityId: "temperature", unit: "C" })];
    const settings = [{ factorCode: "Temp", codedValue: "1", actualValue: "65" }];
    const result = applyDoeFactorsToLines(baseline, settings, factors);
    expect(result.processSettings).toEqual([{ key: "temperature", value: "65", unit: "C" }]);
    expect(result.lines[0].percent).toBe("12");
  });

  it("warns rather than fabricates a new line when a factor references a material absent from the baseline", () => {
    const baseline = [line({ id: "l1", materialId: "material-sles", displayName: "SLES", percent: "12" })];
    const factors = [factor({ factorCode: "A", sourceEntityId: "material-unknown" })];
    const settings = [{ factorCode: "A", codedValue: "1", actualValue: "15" }];
    const result = applyDoeFactorsToLines(baseline, settings, factors);
    expect(result.lines).toHaveLength(1);
    expect(result.warnings.some((w) => /not a line in the baseline/i.test(w))).toBe(true);
  });

  it("warns when the resulting composition does not total ~100%", () => {
    const baseline = [line({ id: "l1", materialId: "material-sles", displayName: "SLES", percent: "12" })];
    const factors = [factor({ factorCode: "A", sourceEntityId: "material-sles" })];
    const settings = [{ factorCode: "A", codedValue: "1", actualValue: "40" }];
    const result = applyDoeFactorsToLines(baseline, settings, factors);
    expect(result.warnings.some((w) => /totals 40/i.test(w))).toBe(true);
  });

  it("ignores a formula_total factor entirely (never a line, never a process setting)", () => {
    const baseline = [line({ id: "l1", materialId: "material-sles", displayName: "SLES", percent: "12" })];
    const factors = [factor({ factorCode: "Total", sourceType: "formula_total", sourceEntityId: undefined })];
    const settings = [{ factorCode: "Total", codedValue: "1", actualValue: "100" }];
    const result = applyDoeFactorsToLines(baseline, settings, factors);
    expect(result.processSettings).toHaveLength(0);
  });
});
