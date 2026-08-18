import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SafetyFinding } from "@formulab/shared";
import type { GeneratedFormulaSafety } from "@/lib/generatedFormulaSafety";
import { GeneratedSafetySummary } from "./GeneratedSafetySummary";

function finding(over: Partial<SafetyFinding> & Pick<SafetyFinding, "id" | "severity" | "message">): SafetyFinding {
  return {
    ruleId: "fixture-rule",
    ruleVersion: "1.0",
    category: "fixture",
    affectedMaterialIds: [],
    affectedLineIds: [],
    verificationStatus: "verified",
    requiredPpe: [],
    requiredEngineeringControls: [],
    humanReviewRequired: false,
    dataIncomplete: false,
    ...over,
  };
}

function safety(over: Partial<GeneratedFormulaSafety> & { formulaState: GeneratedFormulaSafety["formulaState"] }): GeneratedFormulaSafety {
  return { findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-08-18T00:00:00Z", ...over };
}

describe("GeneratedSafetySummary — FVL-03.009", () => {
  it("shows a not-yet-available message when no result is passed", () => {
    render(<GeneratedSafetySummary safety={undefined} />);
    expect(screen.getByText(/Not yet available/)).toBeInTheDocument();
  });

  it("shows the safe state and no findings message when clean", () => {
    render(<GeneratedSafetySummary safety={safety({ formulaState: "safe" })} />);
    expect(screen.getByText("Safe")).toBeInTheDocument();
    expect(screen.getByText(/No safety findings/)).toBeInTheDocument();
  });

  it("shows the blocked state and a real blocking finding message", () => {
    const s = safety({
      formulaState: "blocked",
      findings: [finding({ id: "f1", severity: "blocking", message: "A and B must never combine (corrosive risk)." })],
    });
    render(<GeneratedSafetySummary safety={s} />);
    expect(screen.getByText("Safety blocked")).toBeInTheDocument();
    expect(screen.getByText(/A and B must never combine/)).toBeInTheDocument();
  });

  it("shows the warning state distinctly from blocked", () => {
    const s = safety({
      formulaState: "warning",
      findings: [finding({ id: "f1", severity: "warning", message: "A caution, not a blocker." })],
    });
    render(<GeneratedSafetySummary safety={s} />);
    expect(screen.getByText("Safety warning")).toBeInTheDocument();
  });

  it("shows the unknown state and the real unresolved-material count, never silently safe", () => {
    const s = safety({ formulaState: "unknown", unresolvedMaterialCount: 2 });
    render(<GeneratedSafetySummary safety={s} />);
    expect(screen.getByText("Safety coverage unknown")).toBeInTheDocument();
    expect(screen.getByText(/2 ingredient\(s\) could not be matched/)).toBeInTheDocument();
  });

  it("surfaces a human-review-required flag on a finding that carries it", () => {
    const s = safety({
      formulaState: "blocked",
      findings: [finding({ id: "f1", severity: "blocking", message: "m", humanReviewRequired: true })],
    });
    render(<GeneratedSafetySummary safety={s} />);
    expect(screen.getByText(/Requires human review/)).toBeInTheDocument();
  });

  it("FVL-03.011: shows the finding's real ruleId and affected materials, not just a React key", () => {
    const s = safety({
      formulaState: "blocked",
      findings: [finding({ id: "f1", severity: "blocking", message: "m", ruleId: "fixture-corrosive", affectedMaterialIds: ["RM-A", "RM-B"] })],
    });
    render(<GeneratedSafetySummary safety={s} />);
    expect(screen.getByText("fixture-corrosive")).toBeInTheDocument();
    expect(screen.getByText(/RM-A, RM-B/)).toBeInTheDocument();
  });

  it("surfaces required PPE and engineering controls when a finding carries them", () => {
    const s = safety({
      formulaState: "warning",
      findings: [
        finding({
          id: "f1",
          severity: "warning",
          message: "m",
          requiredPpe: ["gloves", "eye protection"],
          requiredEngineeringControls: ["local ventilation"],
        }),
      ],
    });
    render(<GeneratedSafetySummary safety={s} />);
    expect(screen.getByText(/gloves, eye protection/)).toBeInTheDocument();
    expect(screen.getByText(/local ventilation/)).toBeInTheDocument();
  });
});
