/**
 * Regression coverage for the zero-function-total bug: the group badges
 * below the grid rendered `activePercent` (always 0.0000 whenever no member
 * declares active matter) as the primary figure instead of `rawPercent`
 * (the real formula-percentage share, always correct). Fixed in
 * `functionalSummary`'s consumer here — the engine itself already computed
 * `rawPercent` correctly (see `packages/shared/src/engine/formula.test.ts`).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FormulationLine } from "@formulab/shared";
import { FormulaBuilder } from "./FormulaBuilder";

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
    materialId: over.materialId,
    provenance: over.provenance ?? { origin: "model_estimate", evidenceClaimIds: [] },
  };
}

// Matches the reported screenshot: real, non-zero formula percentages and
// assigned functions, none declaring active matter.
const SCREENSHOT_FIXTURE: FormulationLine[] = [
  line({ displayName: "Water", percent: "56.2", functions: ["solvent"] }),
  line({ displayName: "Propylene Glycol", percent: "4.0", functions: ["solvent"] }),
  line({ displayName: "Trisodium Citrate", percent: "2.0", functions: ["chelating_agent"] }),
  line({ displayName: "Potassium Sorbate", percent: "0.5", functions: ["preservative"] }),
  line({ displayName: "Citric Acid", percent: "0.3", functions: ["ph_adjuster"] }),
  line({ displayName: "Fragrance", percent: "1.0", functions: [] }),
];

function renderBuilder(lines: FormulationLine[]) {
  return render(<FormulaBuilder lines={lines} onChange={() => {}} batchKg="100" onBatchChange={() => {}} />);
}

describe("FormulaBuilder — function-composition summary", () => {
  it("shows non-zero formula-percentage totals for the screenshot example", () => {
    renderBuilder(SCREENSHOT_FIXTURE);
    expect(screen.getByText(/solvent: 60\.2000%/)).toBeInTheDocument();
    expect(screen.getByText(/chelating agent: 2\.0000%/)).toBeInTheDocument();
    expect(screen.getByText(/preservative: 0\.5000%/)).toBeInTheDocument();
    expect(screen.getByText(/ph adjuster: 0\.3000%/)).toBeInTheDocument();
  });

  it("still marks the group incomplete (active-matter data missing) without showing 0.0000%", () => {
    renderBuilder(SCREENSHOT_FIXTURE);
    const solvent = screen.getByText(/solvent: 60\.2000%/);
    expect(solvent.textContent).toMatch(/incomplete/);
    expect(solvent.textContent).not.toMatch(/0\.0000%/);
  });

  it("reports an unclassified line's percentage in a separate chip", () => {
    renderBuilder(SCREENSHOT_FIXTURE);
    expect(screen.getByText(/unclassified: 1\.0000%/)).toBeInTheDocument();
  });

  it("shows active contribution alongside the formula percentage once active matter is declared", () => {
    const lines: FormulationLine[] = [line({ displayName: "Potassium Sorbate", percent: "0.5", functions: ["preservative"], activeMatterPercent: "100" })];
    renderBuilder(lines);
    const badge = screen.getByText(/preservative: 0\.5000%/);
    expect(badge.textContent).toMatch(/0\.5000%\)/); // "(active 0.5000%)"
    expect(badge.textContent).not.toMatch(/incomplete/);
  });

  it("recalculates totals after a line's percentage changes", () => {
    const { rerender } = renderBuilder(SCREENSHOT_FIXTURE);
    expect(screen.getByText(/solvent: 60\.2000%/)).toBeInTheDocument();
    const changed = SCREENSHOT_FIXTURE.map((l) => (l.displayName === "Water" ? { ...l, percent: "50.0" } : l));
    rerender(<FormulaBuilder lines={changed} onChange={() => {}} batchKg="100" onBatchChange={() => {}} />);
    expect(screen.getByText(/solvent: 54\.0000%/)).toBeInTheDocument();
  });

  it("recalculates totals after a line's function changes", () => {
    const { rerender } = renderBuilder(SCREENSHOT_FIXTURE);
    expect(screen.getByText(/chelating agent: 2\.0000%/)).toBeInTheDocument();
    const changed = SCREENSHOT_FIXTURE.map((l) => (l.displayName === "Trisodium Citrate" ? { ...l, functions: ["preservative" as const] } : l));
    rerender(<FormulaBuilder lines={changed} onChange={() => {}} batchKg="100" onBatchChange={() => {}} />);
    expect(screen.queryByText(/chelating agent/)).not.toBeInTheDocument();
    expect(screen.getByText(/preservative: 2\.5000%/)).toBeInTheDocument(); // 2.0 + 0.5 merged
  });

  it("does not crash on a malformed percentage and marks the group's data error", () => {
    const lines: FormulationLine[] = [
      line({ displayName: "Broken", percent: "not-a-number", functions: ["preservative"] }),
      line({ displayName: "Potassium Sorbate", percent: "0.5", functions: ["preservative"] }),
    ];
    expect(() => renderBuilder(lines)).not.toThrow();
    const badge = screen.getByText(/preservative: 0\.5000%/);
    expect(badge.textContent).toMatch(/data error/);
  });

  it("resolves a q.s. line's percentage exactly once (no double count) in its function group", () => {
    const lines: FormulationLine[] = [
      line({ displayName: "Water", percent: "0", isQsToHundred: true, functions: ["solvent"] }),
      line({ displayName: "Active", percent: "35", functions: ["anionic_surfactant"] }),
    ];
    renderBuilder(lines);
    expect(screen.getByText(/solvent: 65\.0000%/)).toBeInTheDocument();
  });

  it("recalculates when the underlying lines represent a different candidate version", () => {
    const v2Lines: FormulationLine[] = [line({ displayName: "Water", percent: "80", functions: ["solvent"] })];
    const { rerender } = renderBuilder(SCREENSHOT_FIXTURE);
    expect(screen.getByText(/solvent: 60\.2000%/)).toBeInTheDocument();
    rerender(<FormulaBuilder lines={v2Lines} onChange={() => {}} batchKg="100" onBatchChange={() => {}} />);
    expect(screen.getByText(/solvent: 80\.0000%/)).toBeInTheDocument();
    expect(screen.queryByText(/chelating agent/)).not.toBeInTheDocument();
  });
});
