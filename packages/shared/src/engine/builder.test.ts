import { describe, expect, it } from "vitest";
import {
  computeTotals,
  convertFixedToQs,
  convertQsToFixed,
  functionalSummary,
  isValid,
  resolvedPercent,
  scaleToBatch,
  setQsLine,
  summarizeFindings,
  validateFormula,
} from "./formula";
import { buildDeclaration } from "./declaration";
import { allTemplates, templateForFamily, templateGaps } from "../catalog/templates";
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
    activeMatterPercent: over.activeMatterPercent,
    technicalMaxPercent: over.technicalMaxPercent,
    inciName: over.inciName,
    currency: over.currency,
    provenance: over.provenance ?? { origin: "chemist_override", evidenceClaimIds: [] },
  };
}

const BASE: FormulationLine[] = [
  line({ id: "w", displayName: "Water", percent: "0", isQsToHundred: true, functions: ["water"], activeMatterPercent: "0", inciName: "Aqua" }),
  line({ id: "s", displayName: "SLES", percent: "12", functions: ["anionic_surfactant"], activeMatterPercent: "70", inciName: "Sodium Laureth Sulfate" }),
  line({ id: "p", displayName: "Sodium Benzoate", percent: "0.5", functions: ["preservative"], activeMatterPercent: "100", inciName: "Sodium Benzoate" }),
];

describe("water q.s.", () => {
  it("resolves to the exact remainder", () => {
    expect(resolvedPercent(BASE[0], BASE).toString()).toBe("87.5");
    expect(computeTotals(BASE).totalPercent.toString()).toBe("100");
  });

  it("recalculates when another percentage changes", () => {
    const edited = BASE.map((l) => (l.id === "s" ? { ...l, percent: "20" } : l));
    expect(resolvedPercent(edited[0], edited).toString()).toBe("79.5");
  });

  it("moves q.s. to another line and clears the old one", () => {
    const moved = setQsLine(BASE, "s", true);
    expect(moved.find((l) => l.id === "s")!.isQsToHundred).toBe(true);
    expect(moved.find((l) => l.id === "w")!.isQsToHundred).toBe(false);
  });

  it("allows two q.s. lines only when explicitly overridden", () => {
    const both = setQsLine(BASE, "s", true, { allowMultiple: true });
    expect(both.filter((l) => l.isQsToHundred)).toHaveLength(2);
    expect(validateFormula(both).some((f) => f.code === "MULTIPLE_QS_LINES")).toBe(true);
  });

  it("converts q.s. water to a fixed percentage, pinning it", () => {
    const fixed = convertQsToFixed(BASE, "w");
    const water = fixed.find((l) => l.id === "w")!;
    expect(water.isQsToHundred).toBe(false);
    expect(water.percent).toBe("87.5000");

    // Now it no longer moves when the surfactant changes.
    const edited = fixed.map((l) => (l.id === "s" ? { ...l, percent: "20" } : l));
    expect(resolvedPercent(edited[0], edited).toString()).toBe("87.5");
    // …and the formula correctly no longer totals 100.
    expect(validateFormula(edited).some((f) => f.code === "TOTAL_NOT_100")).toBe(true);
  });

  it("converts a fixed line back to q.s.", () => {
    const fixed = convertQsToFixed(BASE, "w");
    const back = convertFixedToQs(fixed, "w");
    expect(back.find((l) => l.id === "w")!.isQsToHundred).toBe(true);
    expect(computeTotals(back).totalPercent.toString()).toBe("100");
  });

  it("never freezes a negative percentage onto a line", () => {
    // An operator cannot weigh out minus twenty kilos; the overflow must stay a
    // validation error rather than becoming a negative stored quantity.
    const over = [
      line({ id: "w", displayName: "Water", percent: "0", isQsToHundred: true }),
      line({ id: "s", displayName: "Surfactant", percent: "120" }),
    ];
    expect(computeTotals(over).qsRemainder.toString()).toBe("-20");
    expect(validateFormula(over).some((f) => f.code === "QS_OVERFLOW")).toBe(true);
    expect(convertQsToFixed(over, "w").find((l) => l.id === "w")!.percent).toBe("0.0000");
  });

  it("is an explicit property, not a guess from the material name", () => {
    // Water that is NOT the q.s. line stays exactly where it was put.
    const twoWaters = [
      line({ id: "w1", displayName: "Water (phase A)", percent: "40", functions: ["water"] }),
      line({ id: "w2", displayName: "Water (phase B)", percent: "0", isQsToHundred: true, functions: ["water"] }),
      line({ id: "s", displayName: "SLES", percent: "10" }),
    ];
    expect(resolvedPercent(twoWaters[0], twoWaters).toString()).toBe("40");
    expect(resolvedPercent(twoWaters[1], twoWaters).toString()).toBe("50");
  });
});

describe("batch scaling", () => {
  it("scales to the requested batch size", () => {
    const b = scaleToBatch(BASE, "2500");
    expect(b.find((l) => l.lineId === "s")!.quantity).toBe("300.0000");
    expect(b.find((l) => l.lineId === "w")!.quantity).toBe("2187.5000");
  });

  it("rejects a batch size of zero", () => {
    const f = validateFormula(BASE, { batchKg: "0" });
    expect(f.some((x) => x.code === "INVALID_BATCH_SIZE")).toBe(true);
    expect(isValid(f)).toBe(false);
  });

  it("rejects a negative batch size", () => {
    expect(validateFormula(BASE, { batchKg: "-5" }).some((x) => x.code === "INVALID_BATCH_SIZE")).toBe(true);
  });
});

describe("structural validation", () => {
  it("blocks on duplicate line ids", () => {
    const dup = [
      line({ id: "x", displayName: "A", percent: "50" }),
      line({ id: "x", displayName: "B", percent: "50" }),
    ];
    const f = validateFormula(dup);
    expect(f.some((x) => x.code === "DUPLICATE_LINE_ID" && x.severity === "blocking")).toBe(true);
    expect(isValid(f)).toBe(false);
  });

  it("blocks on a percentage that is not a number", () => {
    const bad = [line({ displayName: "A", percent: "about 5" })];
    const f = validateFormula(bad);
    expect(f.some((x) => x.code === "INVALID_DECIMAL" && x.severity === "blocking")).toBe(true);
  });

  it("reports a missing material name against the exact field", () => {
    const f = validateFormula([
      line({ id: "a", displayName: "  ", percent: "100" }),
    ]);
    const m = f.find((x) => x.code === "MISSING_MATERIAL")!;
    expect(m.lineId).toBe("a");
    expect(m.field).toBe("displayName");
  });

  it("reports a missing phase", () => {
    const f = validateFormula([line({ displayName: "A", percent: "100", phase: "" })]);
    expect(f.some((x) => x.code === "INVALID_PHASE")).toBe(true);
  });

  it("rejects a currency that is not configured", () => {
    const f = validateFormula(
      [line({ displayName: "A", percent: "100", currency: "XYZ" })],
      { allowedCurrencies: ["KES", "USD"] },
    );
    expect(f.some((x) => x.code === "INVALID_CURRENCY")).toBe(true);
  });

  it("warns above a material's technical maximum without blocking the save", () => {
    const hot = [
      line({ id: "w", displayName: "Water", percent: "0", isQsToHundred: true }),
      line({ id: "f", displayName: "Fragrance", percent: "3", technicalMaxPercent: "1.5" }),
    ];
    const f = validateFormula(hot);
    const w = f.find((x) => x.code === "TECHNICAL_MAX_EXCEEDED")!;
    expect(w.severity).toBe("warning");
    expect(w.lineId).toBe("f");
    expect(isValid(f)).toBe(true);
  });

  it("separates warnings from errors in the summary", () => {
    const s = summarizeFindings(validateFormula(BASE, { requiresPreservative: false, requiresPhAdjuster: true }));
    expect(s.errorCount).toBe(0);
    expect(s.warningCount).toBeGreaterThan(0);
    expect(s.blockingCount).toBe(0);
  });

  it("gives every finding an id the UI can key on", () => {
    const f = validateFormula([line({ displayName: "A", percent: "90" })]);
    expect(new Set(f.map((x) => x.id)).size).toBe(f.length);
  });
});

describe("functional group summary", () => {
  it("reports raw and active totals per group", () => {
    const g = functionalSummary(BASE).find((x) => x.fn === "anionic_surfactant")!;
    expect(g.rawPercent).toBe("12.0000");
    expect(g.activePercent).toBe("8.4000");
    expect(g.status).toBe("complete");
  });

  it("does not treat missing active-matter data as zero", () => {
    const partial = [
      line({ id: "a", displayName: "Known", percent: "10", functions: ["anionic_surfactant"], activeMatterPercent: "70" }),
      line({ id: "b", displayName: "Unknown", percent: "5", functions: ["anionic_surfactant"] }),
      line({ id: "w", displayName: "Water", percent: "0", isQsToHundred: true, activeMatterPercent: "0" }),
    ];
    const g = functionalSummary(partial).find((x) => x.fn === "anionic_surfactant")!;
    expect(g.activePercent).toBe("7.0000");
    expect(g.unknownActivePercent).toBe("5.0000");
    // The number is a lower bound and the UI is told so.
    expect(g.status).toBe("incomplete");
  });
});

describe("templates", () => {
  it("covers every product type the factory makes", () => {
    // A template per family; families that share chemistry share a template.
    expect(allTemplates().length).toBeGreaterThanOrEqual(50);
  });

  it("supplies no percentages at all", () => {
    const json = JSON.stringify(allTemplates());
    expect(json).not.toMatch(/"percent"/);
  });

  it("knows toothpaste needs an abrasive and a binder", () => {
    const t = templateForFamily("OC-TOOTHPASTE")!;
    expect(t.requiredFunctions).toContain("abrasive");
    expect(t.requiredFunctions).toContain("rheology_modifier");
    expect(t.requiresInci).toBe(true);
  });

  it("does not demand a preservative for an anhydrous powder", () => {
    expect(templateForFamily("LP-MACHINE-WHITES")!.requiresPreservative).toBe(false);
    expect(templateForFamily("HC-SHAMPOO-REG")!.requiresPreservative).toBe(true);
  });

  it("lists the roles a formula is still missing", () => {
    const t = templateForFamily("HC-SHAMPOO-REG")!;
    const gaps = templateGaps(t, ["anionic_surfactant", "water"]);
    expect(gaps.find((g) => g.fn === "amphoteric_surfactant")?.required).toBe(true);
    expect(gaps.find((g) => g.fn === "preservative")?.required).toBe(true);
    expect(gaps.find((g) => g.fn === "fragrance")?.required).toBe(false);
  });

  it("carries the hazard warnings that matter for bleach", () => {
    const warnings = templateForFamily("BL-REGULAR")!.warningTopics.join(" ");
    expect(warnings).toMatch(/chlorine gas/i);
  });
});

describe("ingredient declaration", () => {
  it("orders by descending percentage using INCI names", () => {
    const d = buildDeclaration(BASE);
    expect(d.entries.map((e) => e.name)).toEqual([
      "Aqua",
      "Sodium Laureth Sulfate",
      "Sodium Benzoate",
    ]);
    expect(d.text).toBe("Aqua, Sodium Laureth Sulfate, Sodium Benzoate");
  });

  it("is always marked draft, never as label-compliant", () => {
    const d = buildDeclaration(BASE);
    expect(d.status).toBe("draft");
    expect(d.notes.join(" ")).toMatch(/not checked against/i);
  });

  it("flags a missing INCI name instead of inventing one", () => {
    const noInci = BASE.map((l) => (l.id === "s" ? { ...l, inciName: undefined } : l));
    const d = buildDeclaration(noInci);
    expect(d.missingInciLineIds).toEqual(["s"]);
    // The internal name is used as a visible placeholder, not a fabricated INCI.
    expect(d.entries.find((e) => e.lineId === "s")!.name).toBe("SLES");
    expect(d.entries.find((e) => e.lineId === "s")!.usesFallbackName).toBe(true);
    expect(validateFormula(noInci, { requiresInci: true }).some((f) => f.code === "MISSING_INCI")).toBe(true);
  });

  it("produces byte-identical output for the same formula", () => {
    // Artwork approval depends on diffing this string.
    expect(buildDeclaration(BASE).text).toBe(buildDeclaration([...BASE].reverse()).text);
  });

  it("breaks percentage ties deterministically by name", () => {
    const tied = [
      line({ id: "b", displayName: "Beta", percent: "5", inciName: "Beta" }),
      line({ id: "a", displayName: "Alpha", percent: "5", inciName: "Alpha" }),
      line({ id: "w", displayName: "Water", percent: "0", isQsToHundred: true, inciName: "Aqua" }),
    ];
    expect(buildDeclaration(tied).entries.map((e) => e.name)).toEqual(["Aqua", "Alpha", "Beta"]);
  });

  it("groups the ≤1% tail at the end when configured to", () => {
    const withTrace = [...BASE, line({ id: "f", displayName: "Parfum", percent: "0.3", inciName: "Parfum" })];
    const d = buildDeclaration(withTrace, { unorderedBelowPercent: "1", tailOrder: "alphabetical" });
    const tail = d.entries.filter((e) => e.belowThreshold).map((e) => e.name);
    expect(tail).toEqual(["Parfum", "Sodium Benzoate"]);
    expect(d.entries[d.entries.length - 1].name).toBe("Sodium Benzoate");
  });

  it("records a human override with its reason", () => {
    const d = buildDeclaration(BASE, {
      override: {
        text: "Aqua, Sodium Laureth Sulfate, Sodium Benzoate, Parfum",
        editedBy: "regulatory",
        editedAt: "2026-07-19T00:00:00Z",
        reason: "align with approved artwork",
      },
    });
    expect(d.text).toContain("Parfum");
    expect(d.notes.join(" ")).toMatch(/Manually overridden by regulatory/);
  });
});
