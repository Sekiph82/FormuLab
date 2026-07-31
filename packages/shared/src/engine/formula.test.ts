import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  computeTotals,
  diffVersions,
  functionalActiveTotal,
  functionalGroupTotals,
  functionalSummary,
  isValid,
  scaleToBatch,
  unclassifiedFormulaPercent,
  validateFormula,
} from "./formula";
import type { FormulationLine, FormulationVersion } from "../schemas/formulation";

function line(
  over: Partial<FormulationLine> & { displayName: string; percent: string },
): FormulationLine {
  return {
    id: over.id ?? `line-${over.displayName}`,
    lineNumber: over.lineNumber ?? 1,
    phase: over.phase ?? "A",
    displayName: over.displayName,
    percent: over.percent,
    isQsToHundred: over.isQsToHundred ?? false,
    functions: over.functions ?? [],
    activeMatterPercent: over.activeMatterPercent,
    materialId: over.materialId,
    provenance: over.provenance ?? { origin: "model_estimate", evidenceClaimIds: [] },
  };
}

/** A realistic shampoo: water q.s., 70%-active SLES, 30%-active CAPB. */
const SHAMPOO: FormulationLine[] = [
  line({ displayName: "Water (Aqua)", percent: "0", isQsToHundred: true, functions: ["water"], activeMatterPercent: "0" }),
  line({ displayName: "Sodium Laureth Sulfate", percent: "12", functions: ["anionic_surfactant"], activeMatterPercent: "70" }),
  line({ displayName: "Cocamidopropyl Betaine", percent: "8", functions: ["amphoteric_surfactant"], activeMatterPercent: "30" }),
  line({ displayName: "Glycerin", percent: "3", functions: ["humectant"], activeMatterPercent: "100" }),
  line({ displayName: "Sodium Benzoate", percent: "0.5", functions: ["preservative"], activeMatterPercent: "100" }),
  line({ displayName: "Citric Acid", percent: "0.3", functions: ["ph_adjuster"], activeMatterPercent: "100" }),
];

describe("totals and q.s. resolution", () => {
  it("resolves water q.s. to the exact remainder", () => {
    const t = computeTotals(SHAMPOO);
    expect(t.authoredPercent.toString()).toBe("23.8");
    expect(t.qsRemainder.toString()).toBe("76.2");
    expect(t.totalPercent.toString()).toBe("100");
  });

  it("distinguishes raw-material percent from active matter", () => {
    // 12% of a 70% active SLES is 8.4% active, not 12%. Conflating the two is
    // how an under-active product ships.
    const t = computeTotals(SHAMPOO);
    // 8.4 (SLES) + 2.4 (CAPB) + 3 + 0.5 + 0.3 = 14.6
    expect(t.totalActiveMatterPercent.toString()).toBe("14.6");
  });

  it("totals exactly 100 with decimal percentages", () => {
    // The float trap: 0.1 + 0.2 !== 0.3 in binary.
    const thirds = [
      line({ displayName: "A", percent: "0.1" }),
      line({ displayName: "B", percent: "0.2" }),
      line({ displayName: "C", percent: "99.7" }),
    ];
    expect(computeTotals(thirds).totalPercent.toString()).toBe("100");
    expect(isValid(validateFormula(thirds))).toBe(true);
  });
});

describe("functional groups", () => {
  it("sums raw percentage per group", () => {
    const g = functionalGroupTotals(SHAMPOO);
    expect(g.get("anionic_surfactant")?.toString()).toBe("12");
    expect(g.get("amphoteric_surfactant")?.toString()).toBe("8");
    expect(g.get("water")?.toString()).toBe("76.2");
  });

  it("computes group ACTIVE totals, which is what specs limit", () => {
    expect(functionalActiveTotal(SHAMPOO, "anionic_surfactant").toString()).toBe("8.4");
    expect(functionalActiveTotal(SHAMPOO, "amphoteric_surfactant").toString()).toBe("2.4");
  });
});

describe("functionalSummary — rawPercent is the primary, formula-percentage-based figure", () => {
  // The exact screenshot regression: five lines with real, non-zero formula
  // percentages and assigned functions, none declaring active matter. Before
  // the fix, the UI showed activePercent (always 0 here) as the group total;
  // rawPercent was always correct internally but never rendered.
  const NO_ACTIVE_DECLARED: FormulationLine[] = [
    line({ displayName: "Water", percent: "56.2", functions: ["solvent"] }),
    line({ displayName: "Propylene Glycol", percent: "4.0", functions: ["solvent"] }),
    line({ displayName: "Trisodium Citrate", percent: "2.0", functions: ["chelating_agent"] }),
    line({ displayName: "Potassium Sorbate", percent: "0.5", functions: ["preservative"] }),
    line({ displayName: "Citric Acid", percent: "0.3", functions: ["ph_adjuster"] }),
    line({ displayName: "Other Base", percent: "37.0", functions: [] }),
  ];

  it("sums formula-line percentages per function even when no active matter is declared", () => {
    const groups = functionalSummary(NO_ACTIVE_DECLARED);
    const solvent = groups.find((g) => g.fn === "solvent")!;
    const chelating = groups.find((g) => g.fn === "chelating_agent")!;
    const preservative = groups.find((g) => g.fn === "preservative")!;
    const phAdjuster = groups.find((g) => g.fn === "ph_adjuster")!;
    expect(solvent.rawPercent).toBe("60.2000");
    expect(chelating.rawPercent).toBe("2.0000");
    expect(preservative.rawPercent).toBe("0.5000");
    expect(phAdjuster.rawPercent).toBe("0.3000");
  });

  it("marks activePercent 0 and status incomplete without implying rawPercent is zero", () => {
    const solvent = functionalSummary(NO_ACTIVE_DECLARED).find((g) => g.fn === "solvent")!;
    expect(solvent.activePercent).toBe("0.0000");
    expect(solvent.status).toBe("incomplete");
    expect(solvent.rawPercent).toBe("60.2000"); // unaffected by the active-matter gap
    expect(solvent.unknownActivePercent).toBe("60.2000");
  });

  it("multiple materials with the same function are summed, different functions stay separate", () => {
    const groups = functionalSummary(NO_ACTIVE_DECLARED);
    expect(groups.find((g) => g.fn === "solvent")?.lineIds).toHaveLength(2);
    expect(groups.find((g) => g.fn === "chelating_agent")?.lineIds).toHaveLength(1);
  });

  it("is complete (not incomplete) once every member declares active matter", () => {
    const withActive: FormulationLine[] = [
      line({ displayName: "Potassium Sorbate", percent: "0.5", functions: ["preservative"], activeMatterPercent: "100" }),
    ];
    const preservative = functionalSummary(withActive).find((g) => g.fn === "preservative")!;
    expect(preservative.status).toBe("complete");
    expect(preservative.activePercent).toBe("0.5000");
  });
});

describe("functionalSummary — unclassified, malformed, and q.s. lines", () => {
  it("reports an unclassified line's percentage via unclassifiedFormulaPercent, not silently in any group", () => {
    const lines: FormulationLine[] = [
      line({ displayName: "Fragrance Blend", percent: "1.5", functions: [] }),
      line({ displayName: "Citric Acid", percent: "0.3", functions: ["ph_adjuster"] }),
    ];
    const unclassified = unclassifiedFormulaPercent(lines);
    expect(unclassified.percent).toBe("1.5000");
    expect(unclassified.lineIds).toEqual([lines[0].id]);
    // functionalSummary never invents a group for it.
    expect(functionalSummary(lines).some((g) => g.lineIds.includes(lines[0].id))).toBe(false);
  });

  it("excludes a line with a malformed percentage instead of crashing, and reports it", () => {
    const lines: FormulationLine[] = [
      line({ displayName: "Broken Row", percent: "not-a-number", functions: ["preservative"] }),
      line({ displayName: "Potassium Sorbate", percent: "0.5", functions: ["preservative"] }),
    ];
    expect(() => functionalSummary(lines)).not.toThrow();
    const preservative = functionalSummary(lines).find((g) => g.fn === "preservative")!;
    expect(preservative.malformedPercentLineIds).toEqual([lines[0].id]);
    expect(preservative.rawPercent).toBe("0.5000"); // the malformed row is excluded, not treated as 0
  });

  it("an empty percentage is treated as 0, not malformed (matches dec()'s existing convention)", () => {
    const lines: FormulationLine[] = [line({ displayName: "Blank", percent: "", functions: ["preservative"] })];
    const preservative = functionalSummary(lines).find((g) => g.fn === "preservative")!;
    expect(preservative.malformedPercentLineIds).toEqual([]);
    expect(preservative.rawPercent).toBe("0.0000");
  });

  it("uses the resolved q.s. percentage exactly once, matching computeTotals — no double count", () => {
    const lines: FormulationLine[] = [
      line({ displayName: "Water", percent: "0", isQsToHundred: true, functions: ["solvent"] }),
      line({ displayName: "Active", percent: "20", functions: ["anionic_surfactant"] }),
    ];
    const totals = computeTotals(lines);
    const solvent = functionalSummary(lines).find((g) => g.fn === "solvent")!;
    expect(solvent.rawPercent).toBe(totals.qsRemainder.toFixed(4));
    expect(solvent.rawPercent).toBe("80.0000");
  });
});

describe("batch scaling", () => {
  it("scales to any batch size without drift", () => {
    const b = scaleToBatch(SHAMPOO, "1000");
    const sles = b.find((l) => l.displayName.includes("Laureth"))!;
    expect(sles.quantity).toBe("120.0000");
    const water = b.find((l) => l.displayName.includes("Water"))!;
    expect(water.quantity).toBe("762.0000");
  });

  it("keeps the batch total equal to the batch size", () => {
    for (const batch of ["1", "100", "2500", "0.5"]) {
      const total = scaleToBatch(SHAMPOO, batch).reduce(
        (sum, l) => sum.plus(new Decimal(l.quantity)),
        new Decimal(0),
      );
      expect(total.toString()).toBe(new Decimal(batch).toString());
    }
  });
});

describe("validation", () => {
  it("passes a complete formula", () => {
    const f = validateFormula(SHAMPOO, { requiresPreservative: true, requiresPhAdjuster: true });
    expect(isValid(f)).toBe(true);
  });

  it("rejects a formula that does not total 100", () => {
    const f = validateFormula([line({ displayName: "A", percent: "90" })]);
    expect(isValid(f)).toBe(false);
    expect(f.some((x) => x.code === "TOTAL_NOT_100")).toBe(true);
  });

  it("catches a q.s. line with nothing left to absorb", () => {
    const over = [
      line({ displayName: "Water", percent: "0", isQsToHundred: true }),
      line({ displayName: "Surfactant", percent: "120" }),
    ];
    const f = validateFormula(over);
    expect(isValid(f)).toBe(false);
    expect(f.some((x) => x.code === "QS_OVERFLOW")).toBe(true);
  });

  it("flags a duplicated material, which silently doubles a dose", () => {
    const dup = [
      line({ id: "l1", displayName: "Glycerin", percent: "3" }),
      line({ id: "l2", displayName: "glycerin", percent: "2" }),
      line({ displayName: "Water", percent: "0", isQsToHundred: true }),
    ];
    const f = validateFormula(dup);
    expect(f.some((x) => x.code === "DUPLICATE_MATERIAL")).toBe(true);
  });

  it("warns when an aqueous product has no preservative", () => {
    const noPres = SHAMPOO.filter((l) => !l.functions.includes("preservative"));
    // Re-balance so the only finding under test is the preservative one.
    const f = validateFormula(noPres, { requiresPreservative: true });
    expect(f.some((x) => x.code === "NO_PRESERVATIVE")).toBe(true);
  });

  it("does not demand a preservative for an anhydrous product", () => {
    const powder = [
      line({ displayName: "Sodium Carbonate", percent: "60", functions: ["builder"] }),
      line({ displayName: "LAS Powder", percent: "40", functions: ["anionic_surfactant"] }),
    ];
    const f = validateFormula(powder, { requiresPreservative: false });
    expect(f.some((x) => x.code === "NO_PRESERVATIVE")).toBe(false);
    expect(isValid(f)).toBe(true);
  });

  it("rejects a negative percentage", () => {
    const f = validateFormula([
      line({ displayName: "Bad", percent: "-5" }),
      line({ displayName: "Water", percent: "105" }),
    ]);
    expect(f.some((x) => x.code === "NEGATIVE_PERCENT")).toBe(true);
    expect(isValid(f)).toBe(false);
  });

  it("reports an empty formula rather than passing it", () => {
    expect(isValid(validateFormula([]))).toBe(false);
  });

  it("says when the active total is only a lower bound", () => {
    const partial = [
      line({ displayName: "Unknown surfactant", percent: "20", functions: ["anionic_surfactant"] }),
      line({ displayName: "Water", percent: "0", isQsToHundred: true, activeMatterPercent: "0" }),
    ];
    expect(validateFormula(partial).some((x) => x.code === "UNKNOWN_ACTIVE_MATTER")).toBe(true);
  });
});

describe("version comparison", () => {
  const version = (id: string, lines: FormulationLine[]): FormulationVersion => ({
    schemaVersion: "1.0",
    id,
    formulationId: "f1",
    versionNumber: 1,
    status: "concept",
    author: "test",
    createdAt: "2026-01-01T00:00:00Z",
    lines,
    basisBatchKg: "100",
    sourceRunIds: [],
    regulatoryFindingIds: [],
    compatibilityFindingIds: [],
    safetyFindingIds: [],
    approvalRecordIds: [],
  });

  it("reports added, removed and changed lines", () => {
    const v2 = SHAMPOO.filter((l) => !l.displayName.includes("Glycerin")).map((l) =>
      l.displayName.includes("Laureth") ? { ...l, percent: "10" } : l,
    );
    v2.push(line({ displayName: "Decyl Glucoside", percent: "5", activeMatterPercent: "50" }));

    const d = diffVersions(version("v1", SHAMPOO), version("v2", v2));
    const byName = (n: string) => d.lines.find((l) => l.displayName.includes(n))!;

    expect(byName("Glycerin").kind).toBe("removed");
    expect(byName("Decyl").kind).toBe("added");
    expect(byName("Laureth").kind).toBe("changed");
    expect(byName("Laureth").delta).toBe("-2.0000");
  });

  it("quantifies the active-matter impact of a change", () => {
    const weaker = SHAMPOO.map((l) =>
      l.displayName.includes("Laureth") ? { ...l, percent: "6" } : l,
    );
    const d = diffVersions(version("v1", SHAMPOO), version("v2", weaker));
    // 6% less SLES at 70% active = 4.2 points of active matter lost.
    expect(d.activeMatterDelta).toBe("-4.2000");
  });
});
