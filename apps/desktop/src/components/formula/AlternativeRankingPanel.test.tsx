import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { rankAlternatives, type AlternativeRankingCandidate } from "@formulab/shared";
import { AlternativeRankingPanel } from "./AlternativeRankingPanel";

function candidate(candidateId: string, overrides: Partial<AlternativeRankingCandidate["dimensions"]> = {}): AlternativeRankingCandidate {
  return {
    candidateId,
    sessionId: "session-1",
    alternativeId: candidateId,
    versionLabel: candidateId,
    formulaStatus: "VALID",
    dimensions: {
      performance: { status: "UNAVAILABLE_MODEL" },
      uncertainty: { status: "UNKNOWN" },
      cost: { status: "AVAILABLE", costPerKg: 2, currency: "KES", batchKg: "100", sourceSnapshot: { authority: "FormuLab Cost Engine" } },
      availability: { status: "FEASIBLE", sourceSnapshot: { authority: "Availability Engine" } },
      compatibility: { status: "PASS" },
      safety: { status: "PASS" },
      regulatory: { status: "PASS" },
      manufacturing: { status: "READY" },
      evidence: { status: "LINKED", ingredientCount: 2, linkedIngredientCount: 1, uniqueSourceCount: 1 },
      ...overrides,
    },
  };
}

function renderRanking(candidates: AlternativeRankingCandidate[]) {
  return render(<AlternativeRankingPanel rankings={rankAlternatives(candidates)} records={[]} canPersist recording={false} onRecord={vi.fn()} onOptimize={vi.fn()} />);
}

describe("AlternativeRankingPanel", () => {
  it("explains each separate dimension and labels unavailable prediction without a zero", () => {
    renderRanking([candidate("v1")]);
    expect(screen.getAllByText(/performance/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Unavailable model/i)).toBeInTheDocument();
    expect(screen.getByText(/UNAVAILABLE MODEL/i)).not.toHaveTextContent(/\b0(?:\.0+)?\b/);
    for (const dimension of ["uncertainty", "cost", "availability", "compatibility", "safety", "regulatory", "manufacturing", "evidence"]) {
      expect(screen.getAllByText(new RegExp(dimension, "i")).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/2 KES\/kg/)).toBeInTheDocument();
  });

  it.each(["safety", "regulatory"] as const)("visibly blocks a %s FAIL despite better predicted performance", (dimension) => {
    const passing = candidate("pass");
    const failed = candidate("fail", {
      performance: { status: "PREDICTED", numericValue: 999, targetKey: "viscosity", modelId: "model-1", modelVersion: 1 },
      [dimension]: { status: "FAIL", sourceSnapshot: { authority: `${dimension} engine` } },
    });
    renderRanking([failed, passing]);
    const orderedRows = screen.getAllByRole("listitem");
    expect(orderedRows[0]).toHaveTextContent("pass");
    expect(orderedRows[1]).toHaveTextContent(/blocked/i);
    expect(orderedRows[1]).toHaveTextContent(new RegExp(`${dimension} fail`, "i"));
    expect(orderedRows[1]).toHaveTextContent("999");
  });

  it("preserves OOD prediction status without displaying a performance value", () => {
    renderRanking([candidate("ood", { performance: { status: "OUT_OF_DOMAIN", sourceSnapshot: { reasonCode: "NUMERIC_RANGE_EXCEEDED" } } })]);
    expect(screen.getByText(/Out of domain/i)).toBeInTheDocument();
    expect(screen.getByText(/OUT OF DOMAIN/i)).toBeInTheDocument();
  });

  it("shows predicted value with the exact FVL-07 model, version, and target lineage", () => {
    renderRanking([candidate("predicted", { performance: { status: "PREDICTED", numericValue: 42, unit: "mPa.s", targetKey: "VISCOSITY", modelId: "model-shampoo-viscosity", modelVersion: 3 } })]);
    expect(screen.getByText(/42 mPa\.s/)).toBeInTheDocument();
    expect(screen.getByLabelText("Prediction lineage")).toHaveTextContent("model model-shampoo-viscosity · v3 · target VISCOSITY");
  });

  it.each(["MODEL_NOT_ACCEPTED", "UNAVAILABLE_MODEL", "INVALID_CONTRACT"] as const)("renders %s without a numeric fallback", (status) => {
    renderRanking([candidate("non-numeric", { performance: { status, sourceSnapshot: { reason: "No validated prediction." } } })]);
    expect(screen.getByText(new RegExp(status.replace(/_/g, " "), "i"))).toBeInTheDocument();
    expect(screen.queryByText(/· 0(?:\.0+)?(?:\s|$)/)).not.toBeInTheDocument();
  });

  it.each(["safety", "regulatory"] as const)("disables Optimize for a %s hard gate", (dimension) => {
    const onOptimize = vi.fn();
    render(<AlternativeRankingPanel rankings={rankAlternatives([candidate("blocked", { [dimension]: { status: "FAIL" } })])} records={[]} canPersist recording={false} onRecord={vi.fn()} onOptimize={onOptimize} />);
    const action = screen.getByRole("button", { name: /optimize/i });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute("aria-describedby", "ranking-reasons-blocked");
    expect(screen.getByText(/gate status/i)).toBeInTheDocument();
    action.click();
    expect(onOptimize).not.toHaveBeenCalled();
  });

  it("allows eligible alternatives and disables unavailable formula alternatives", () => {
    const onOptimize = vi.fn();
    const eligible = candidate("eligible");
    const unavailable: AlternativeRankingCandidate = { ...candidate("unavailable"), formulaStatus: "UNAVAILABLE" };
    const rankings = rankAlternatives([eligible, unavailable]);
    render(<AlternativeRankingPanel rankings={rankings} records={[]} canPersist recording={false} onRecord={vi.fn()} onOptimize={onOptimize} />);
    const actions = screen.getAllByRole("button", { name: /optimize/i });
    expect(actions[0]).toBeEnabled();
    expect(actions[1]).toBeDisabled();
  });
});
