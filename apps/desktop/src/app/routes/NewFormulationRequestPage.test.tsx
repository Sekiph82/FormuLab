import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/formulationV2", () => ({
  generateFormulation: vi.fn(),
  loadProviderConfig: () => ({ provider: "gemini", model: "m", apiKey: "k" }),
  notifySessionsChanged: vi.fn(),
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
});
