import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FormulaInventoryFeasibility, IngredientAvailabilityLine } from "@/lib/generatedFormulaInventory";
import { InventoryFeasibilitySummary } from "./InventoryFeasibilitySummary";

function line(over: Partial<IngredientAvailabilityLine> & Pick<IngredientAvailabilityLine, "lineId" | "displayName" | "state">): IngredientAvailabilityLine {
  return { reason: "test reason", ...over };
}

function feasibility(lines: IngredientAvailabilityLine[]): FormulaInventoryFeasibility {
  return { formulaState: "unknown", lines, evaluatedAt: "2026-08-18T00:00:00Z" };
}

describe("InventoryFeasibilitySummary — FVL-03.006 substitution entry point", () => {
  it("offers no substitution button for a fully available, resolved ingredient", () => {
    const f = feasibility([line({ lineId: "l1", displayName: "Glycerin", materialCode: "RM-001", state: "available" })]);
    render(<InventoryFeasibilitySummary feasibility={f} onFindSubstitute={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("Acceptance C: offers no substitution button for a generic UNKNOWN (resolved material, no inventory record)", () => {
    const f = feasibility([line({ lineId: "l1", displayName: "Glycerin", materialCode: "RM-001", state: "unknown" })]);
    render(<InventoryFeasibilitySummary feasibility={f} onFindSubstitute={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("Acceptance A: offers a substitution button for an unresolved ingredient (no materialCode)", () => {
    const f = feasibility([line({ lineId: "l1", displayName: "Fragrance", state: "unknown" })]);
    render(<InventoryFeasibilitySummary feasibility={f} onFindSubstitute={vi.fn()} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("Acceptance B: offers a substitution button for a resolved but definitively insufficient ingredient", () => {
    const f = feasibility([line({ lineId: "l1", displayName: "Glycerin", materialCode: "RM-001", state: "insufficient" })]);
    render(<InventoryFeasibilitySummary feasibility={f} onFindSubstitute={vi.fn()} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("never offers a button when no onFindSubstitute callback is wired (e.g. a future non-generated caller)", () => {
    const f = feasibility([line({ lineId: "l1", displayName: "Glycerin", state: "insufficient" })]);
    render(<InventoryFeasibilitySummary feasibility={f} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("clicking the button calls onFindSubstitute with the line's own index, never auto-applying anything", async () => {
    const onFindSubstitute = vi.fn();
    const f = feasibility([
      line({ lineId: "l1", displayName: "A", materialCode: "RM-A", state: "available" }),
      line({ lineId: "l2", displayName: "B", state: "insufficient" }),
    ]);
    render(<InventoryFeasibilitySummary feasibility={f} onFindSubstitute={onFindSubstitute} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onFindSubstitute).toHaveBeenCalledTimes(1);
    expect(onFindSubstitute).toHaveBeenCalledWith(1);
  });

  it("disables and shows a busy label only for the one line currently in flight", () => {
    const f = feasibility([
      line({ lineId: "l1", displayName: "A", state: "unknown" }),
      line({ lineId: "l2", displayName: "B", state: "insufficient" }),
    ]);
    render(<InventoryFeasibilitySummary feasibility={f} onFindSubstitute={vi.fn()} substitutingIndex={1} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).not.toBeDisabled();
    expect(buttons[1]).toBeDisabled();
  });
});
