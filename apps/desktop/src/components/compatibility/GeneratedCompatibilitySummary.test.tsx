import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CompatibilityFinding } from "@formulab/shared";
import type { GeneratedFormulaCompatibility } from "@/lib/generatedFormulaCompatibility";
import { GeneratedCompatibilitySummary } from "./GeneratedCompatibilitySummary";

function finding(over: Partial<CompatibilityFinding> & Pick<CompatibilityFinding, "id" | "severity" | "message">): CompatibilityFinding {
  return {
    ruleId: "fixture-rule",
    ruleVersion: "1.0",
    materialIds: [],
    lineIds: [],
    verificationStatus: "verified",
    triggeredConditions: [],
    dataIncomplete: false,
    ...over,
  };
}

function compat(over: Partial<GeneratedFormulaCompatibility> & { formulaState: GeneratedFormulaCompatibility["formulaState"] }): GeneratedFormulaCompatibility {
  return { findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-08-18T00:00:00Z", ...over };
}

describe("GeneratedCompatibilitySummary — FVL-03.011", () => {
  it("shows the finding's real ruleId and affected materials, not just a React key", () => {
    const c = compat({
      formulaState: "blocked",
      findings: [finding({ id: "f1", severity: "blocking", message: "m", ruleId: "fixture-hypochlorite-acid", materialIds: ["RM-A", "RM-B"] })],
    });
    render(<GeneratedCompatibilitySummary compatibility={c} />);
    expect(screen.getByText("fixture-hypochlorite-acid")).toBeInTheDocument();
    expect(screen.getByText(/RM-A, RM-B/)).toBeInTheDocument();
  });
});

describe("GeneratedCompatibilitySummary — FVL-03.008", () => {
  it("shows a not-yet-available message when no result is passed", () => {
    render(<GeneratedCompatibilitySummary compatibility={undefined} />);
    expect(screen.getByText(/Not yet available/)).toBeInTheDocument();
  });

  it("shows the compatible state and no findings message when clean", () => {
    render(<GeneratedCompatibilitySummary compatibility={compat({ formulaState: "compatible" })} />);
    expect(screen.getByText("Compatible")).toBeInTheDocument();
    expect(screen.getByText(/No compatibility findings/)).toBeInTheDocument();
  });

  it("shows the blocked state and a real blocking finding message", () => {
    const c = compat({
      formulaState: "blocked",
      findings: [finding({ id: "f1", severity: "blocking", message: "A and B must never combine." })],
    });
    render(<GeneratedCompatibilitySummary compatibility={c} />);
    expect(screen.getByText("Compatibility blocked")).toBeInTheDocument();
    expect(screen.getByText(/A and B must never combine\./)).toBeInTheDocument();
  });

  it("shows the warning state distinctly from blocked", () => {
    const c = compat({
      formulaState: "warning",
      findings: [finding({ id: "f1", severity: "warning", message: "A caution, not a blocker." })],
    });
    render(<GeneratedCompatibilitySummary compatibility={c} />);
    expect(screen.getByText("Compatibility warning")).toBeInTheDocument();
  });

  it("shows the unknown state and the real unresolved-material count, never silently compatible", () => {
    const c = compat({ formulaState: "unknown", unresolvedMaterialCount: 2 });
    render(<GeneratedCompatibilitySummary compatibility={c} />);
    expect(screen.getByText("Compatibility coverage unknown")).toBeInTheDocument();
    expect(screen.getByText(/2 ingredient\(s\) could not be matched/)).toBeInTheDocument();
  });

  it("surfaces a dataIncomplete finding's own honest label", () => {
    const c = compat({
      formulaState: "warning",
      findings: [finding({ id: "f1", severity: "warning", message: "pH check could not be confirmed.", dataIncomplete: true })],
    });
    render(<GeneratedCompatibilitySummary compatibility={c} />);
    expect(screen.getByText(/unknown — data missing/)).toBeInTheDocument();
  });
});
