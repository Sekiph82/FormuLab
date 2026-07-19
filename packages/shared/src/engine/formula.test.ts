import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  computeTotals,
  diffVersions,
  functionalActiveTotal,
  functionalGroupTotals,
  isValid,
  scaleToBatch,
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
