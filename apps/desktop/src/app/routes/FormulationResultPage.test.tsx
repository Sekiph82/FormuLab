import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readSession = vi.fn();
vi.mock("@/lib/formulationV2", () => ({
  readSession: (id: string) => readSession(id),
}));

import { FormulationResultPage } from "./FormulationResultPage";

const SESSION = {
  status: "ok" as const,
  id: "2026-01-01-1200-test",
  brief: { target: "A sulfate-free anti-dandruff shampoo for a sensitive scalp." },
  cards: [
    {
      version: "v1",
      markdown: "# Formulation Card: Balanced",
      formula: {
        name: "Balanced / Recommended",
        purpose: "Best balance of performance, cost, and robustness.",
        ingredients: [
          { inci: "Water (Aqua)", function: "Solvent", weight_pct: "q.s. 100" },
          { inci: "Cocamidopropyl Betaine", function: "Secondary Surfactant", weight_pct: "5.50" },
        ],
        references: [{ author: "Doe J", year: "2021", doi: "10.1/example" }],
        warnings: ["Confirm preservative efficacy with a challenge test."],
      },
      violations: [],
    },
    {
      version: "v2",
      markdown: "# Formulation Card: Cost Optimized",
      formula: { name: "Cost Optimized", purpose: "Lower cost while preserving performance.", ingredients: [] },
      violations: [],
    },
  ],
  read_only: true as const,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/formulation-result/2026-01-01-1200-test"]}>
      <Routes>
        <Route path="/formulation-result/:sessionId" element={<FormulationResultPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("FormulationResultPage", () => {
  beforeEach(() => {
    readSession.mockReset();
    readSession.mockResolvedValue(SESSION);
  });

  it("shows the original request fixed at the top, verbatim", async () => {
    renderPage();
    await screen.findByText(SESSION.brief.target);
    expect(screen.getByText("Original Request (Fixed)")).not.toBeNull();
  });

  it("renders one version card per candidate and the Formula tab's ingredient table for the selected one", async () => {
    renderPage();
    // "Balanced / Recommended" legitimately appears twice — once as the V1
    // version-card label, once as the Formula tab's own header for the
    // selected version — both real, both expected.
    await waitFor(() => expect(screen.getAllByText("Balanced / Recommended").length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText("Cost Optimized")).not.toBeNull();
    expect(screen.getByText("Cocamidopropyl Betaine")).not.toBeNull();
  });

  it("selecting an ingredient row opens the evidence panel scoped to that ingredient's real concentration", async () => {
    renderPage();
    await screen.findByText("Cocamidopropyl Betaine");
    await userEvent.click(screen.getByText("Cocamidopropyl Betaine"));
    expect(screen.getByText("Selected Concentration")).not.toBeNull();
    // "5.50" appears twice once selected — the table cell and the evidence
    // panel's own concentration display — both real, both expected.
    await waitFor(() => expect(screen.getAllByText("5.50").length).toBeGreaterThanOrEqual(2));
  });

  it("switching versions clears the previously selected ingredient's evidence context", async () => {
    renderPage();
    await screen.findByText("Cocamidopropyl Betaine");
    await userEvent.click(screen.getByText("Cocamidopropyl Betaine"));
    await screen.findByText("Selected Concentration");

    await userEvent.click(screen.getByText("Cost Optimized"));
    await waitFor(() => expect(screen.queryByText("Selected Concentration")).toBeNull());
  });

  it("never fabricates a formula-version score — shows it as not yet available instead", async () => {
    renderPage();
    await screen.findByText("Original Request (Fixed)");
    expect(screen.getAllByText(/not yet available/i).length).toBeGreaterThan(0);
  });
});
