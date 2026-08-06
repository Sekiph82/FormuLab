/**
 * Minimal coverage for `FormulationStudio` — mainly to prove the guided-tour
 * `data-tour` anchors the "formulation" tour points at (Phase 10 Session 4:
 * target product input, category/market, Generate) are real, always-visible
 * elements, not invented selectors. Generate's own submit wiring is already
 * covered indirectly via `FormulationWorkspaceV2`'s `onSubmit` prop; this
 * file only exercises the studio form in isolation.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FormulationStudio } from "./FormulationStudio";

describe("FormulationStudio — guided-tour target resolution (Phase 10 Session 4)", () => {
  it("resolves the target/categoryMarket/generate anchors on first render", () => {
    render(<FormulationStudio onSubmit={vi.fn()} />);
    expect(document.querySelector('[data-tour="formulation.target"]')).toBeInTheDocument();
    expect(document.querySelector('[data-tour="formulation.categoryMarket"]')).toBeInTheDocument();
    expect(document.querySelector('[data-tour="formulation.generate"]')).toBeInTheDocument();
  });
});

describe("FormulationStudio — basic behavior", () => {
  it("disables Generate until a target is typed, and calls onSubmit with the built brief", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<FormulationStudio onSubmit={onSubmit} />);
    const generate = screen.getByRole("button", { name: /Generate/i });
    expect(generate).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: /Target product/i }), "sulfate-free shampoo");
    expect(generate).toBeEnabled();
    await user.click(generate);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ target: "sulfate-free shampoo" }));
  });
});
