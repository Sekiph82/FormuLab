import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/formulationV2", () => ({
  generateFormulation: vi.fn(),
  loadProviderConfig: () => ({ provider: "gemini", model: "m", apiKey: "k" }),
  notifySessionsChanged: vi.fn(),
  DEFAULT_FORMULA_ALTERNATIVES: 3,
  FORMULA_ALTERNATIVE_COUNTS: [3, 4, 5, 6, 7],
}));

import { NewFormulationRequestPage } from "./NewFormulationRequestPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <NewFormulationRequestPage />
    </MemoryRouter>,
  );
}

describe("NewFormulationRequestPage", () => {
  it("renders the approved screen's primary sections", () => {
    renderPage();
    expect(screen.getByText("New Formulation Request")).not.toBeNull();
    expect(screen.getByText("Describe Your Need")).not.toBeNull();
    expect(screen.getByText("Product Information")).not.toBeNull();
    expect(screen.getByText("Constraints & Preferences")).not.toBeNull();
    expect(screen.getByText("Production Information")).not.toBeNull();
    expect(screen.getByText("Evidence-Based & Transparent Process")).not.toBeNull();
  });

  it("keeps Start Formulation Request disabled until the natural-language request is filled", async () => {
    renderPage();
    const start = screen.getByRole("button", { name: "Start Formulation Request" });
    expect(start).toBeDisabled();

    const textarea = screen.getByPlaceholderText(/sulfate-free anti-dandruff shampoo/i);
    await userEvent.type(textarea, "A gentle sulfate-free shampoo.");
    expect(start).not.toBeDisabled();
  });

  it("the example-requests button fills the natural-language request — the authoritative primary field", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Example Requests" }));
    const textarea = screen.getByPlaceholderText(/sulfate-free anti-dandruff shampoo/i) as HTMLTextAreaElement;
    expect(textarea.value.length).toBeGreaterThan(0);
  });

  it("defaults the formula-count control to 3", () => {
    renderPage();
    const three = screen.getByTestId("formula-count-3");
    expect(three).toHaveAttribute("aria-checked", "true");
    for (const n of [4, 5, 6, 7]) {
      expect(screen.getByTestId(`formula-count-${n}`)).toHaveAttribute("aria-checked", "false");
    }
  });

  it.each([4, 5, 6, 7])("selecting %i marks it checked and clears the others", async (n) => {
    renderPage();
    await userEvent.click(screen.getByTestId(`formula-count-${n}`));
    expect(screen.getByTestId(`formula-count-${n}`)).toHaveAttribute("aria-checked", "true");
    for (const other of [3, 4, 5, 6, 7].filter((x) => x !== n)) {
      expect(screen.getByTestId(`formula-count-${other}`)).toHaveAttribute("aria-checked", "false");
    }
  });

  it("the selected formula count reaches generateFormulation's request payload", async () => {
    const { generateFormulation } = await import("@/lib/formulationV2");
    vi.mocked(generateFormulation).mockResolvedValue({ status: "ok", session_id: "s1" } as never);
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/sulfate-free anti-dandruff shampoo/i), "A gentle shampoo.");
    await userEvent.click(screen.getByTestId("formula-count-6"));
    await userEvent.click(screen.getByRole("button", { name: "Start Formulation Request" }));
    expect(generateFormulation).toHaveBeenCalledWith(
      expect.objectContaining({ target: "A gentle shampoo." }),
      expect.anything(),
      6,
    );
  });

  it("defaults to 3 in the request payload when the count is never touched", async () => {
    const { generateFormulation } = await import("@/lib/formulationV2");
    vi.mocked(generateFormulation).mockResolvedValue({ status: "ok", session_id: "s1" } as never);
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/sulfate-free anti-dandruff shampoo/i), "A gentle shampoo.");
    await userEvent.click(screen.getByRole("button", { name: "Start Formulation Request" }));
    expect(generateFormulation).toHaveBeenCalledWith(expect.anything(), expect.anything(), 3);
  });

  it("existing request fields remain intact alongside the new count control", async () => {
    const { generateFormulation } = await import("@/lib/formulationV2");
    vi.mocked(generateFormulation).mockResolvedValue({ status: "ok", session_id: "s1" } as never);
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/sulfate-free anti-dandruff shampoo/i), "A gentle shampoo.");
    await userEvent.click(screen.getByTestId("formula-count-5"));
    await userEvent.click(screen.getByRole("button", { name: "Start Formulation Request" }));
    expect(generateFormulation).toHaveBeenCalledWith(
      expect.objectContaining({ target: "A gentle shampoo." }),
      expect.objectContaining({ provider: "gemini" }),
      5,
    );
  });
});
