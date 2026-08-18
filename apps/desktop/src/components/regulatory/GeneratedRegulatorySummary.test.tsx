import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RegulatoryFinding } from "@formulab/shared";
import type { GeneratedFormulaRegulatory } from "@/lib/generatedFormulaRegulatory";
import { GeneratedRegulatorySummary } from "./GeneratedRegulatorySummary";

function finding(over: Partial<RegulatoryFinding> & Pick<RegulatoryFinding, "id" | "status" | "reason">): RegulatoryFinding {
  return {
    ruleId: "fixture-rule",
    ruleCode: "FIX-001",
    ruleVersion: 1,
    jurisdiction: "KE",
    severity: "warning",
    affectedMaterialCodes: [],
    affectedLineIds: [],
    evidenceRequired: [],
    verificationStatus: "verified",
    ...over,
  };
}

function regulatory(over: Partial<GeneratedFormulaRegulatory> & { formulaState: GeneratedFormulaRegulatory["formulaState"] }): GeneratedFormulaRegulatory {
  return { requestedMarket: "kenya", jurisdiction: "KE", findings: [], unresolvedMaterialCount: 0, evaluatedAt: "2026-08-18T00:00:00Z", ...over };
}

describe("GeneratedRegulatorySummary — FVL-03.010", () => {
  it("shows a not-yet-available message when no result is passed", () => {
    render(<GeneratedRegulatorySummary regulatory={undefined} />);
    expect(screen.getByText(/Not yet available/)).toBeInTheDocument();
  });

  it("shows the compliant state and no findings message when clean", () => {
    render(<GeneratedRegulatorySummary regulatory={regulatory({ formulaState: "compliant" })} />);
    expect(screen.getByText("Regulatory compliant")).toBeInTheDocument();
    expect(screen.getByText(/No applicable regulatory findings/)).toBeInTheDocument();
  });

  it("shows the blocked state, jurisdiction, and a real non_compliant finding message", () => {
    const r = regulatory({
      formulaState: "blocked",
      findings: [finding({ id: "f1", status: "non_compliant", reason: "A prohibited ingredient is present." })],
    });
    render(<GeneratedRegulatorySummary regulatory={r} />);
    expect(screen.getByText("Regulatory blocked")).toBeInTheDocument();
    expect(screen.getByText(/KE/)).toBeInTheDocument();
    expect(screen.getByText(/A prohibited ingredient is present/)).toBeInTheDocument();
    expect(screen.getByText("Non-compliant")).toBeInTheDocument();
  });

  it("shows the warning state distinctly from blocked, and discloses verification status", () => {
    const r = regulatory({
      formulaState: "warning",
      findings: [finding({ id: "f1", status: "missing_data", reason: "Needs human confirmation.", verificationStatus: "not_verified" })],
    });
    render(<GeneratedRegulatorySummary regulatory={r} />);
    expect(screen.getByText("Regulatory review needed")).toBeInTheDocument();
    expect(screen.getByText("Missing data")).toBeInTheDocument();
    expect(screen.getByText(/Not verified/)).toBeInTheDocument();
  });

  it("shows the unknown state and the real unresolved-material count when a jurisdiction resolved but nothing matched", () => {
    const r = regulatory({ formulaState: "unknown", unresolvedMaterialCount: 2 });
    render(<GeneratedRegulatorySummary regulatory={r} />);
    expect(screen.getByText("Regulatory coverage unknown")).toBeInTheDocument();
    expect(screen.getByText(/2 ingredient\(s\) could not be matched/)).toBeInTheDocument();
  });

  it("discloses an unresolved market honestly, never fabricating a jurisdiction", () => {
    const r = regulatory({ formulaState: "unknown", jurisdiction: undefined, requestedMarket: "atlantis" });
    render(<GeneratedRegulatorySummary regulatory={r} />);
    expect(screen.getByText(/No regulatory rule data exists for "atlantis"/)).toBeInTheDocument();
  });

  it("shows an unspecified-market message when the brief carried no market text at all", () => {
    const r = regulatory({ formulaState: "unknown", jurisdiction: undefined, requestedMarket: "" });
    render(<GeneratedRegulatorySummary regulatory={r} />);
    expect(screen.getByText(/an unspecified market/)).toBeInTheDocument();
  });

  it("surfaces affected materials and required action on a finding that carries them", () => {
    const r = regulatory({
      formulaState: "blocked",
      findings: [
        finding({
          id: "f1",
          status: "non_compliant",
          reason: "m",
          affectedMaterialCodes: ["RM-A"],
          requiredAction: "Remove or replace this ingredient before release in this market.",
        }),
      ],
    });
    render(<GeneratedRegulatorySummary regulatory={r} />);
    expect(screen.getByText(/RM-A/)).toBeInTheDocument();
    expect(screen.getByText(/Remove or replace this ingredient/)).toBeInTheDocument();
  });
});
