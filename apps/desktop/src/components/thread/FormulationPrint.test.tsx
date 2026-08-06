import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readSession = vi.fn();
vi.mock("@/lib/formulationV2", () => ({
  readSession: (id: string) => readSession(id),
  generateFormulation: vi.fn(),
  loadProviderConfig: () => ({ provider: "gemini", model: "m", apiKey: "k" }),
  notifySessionsChanged: vi.fn(),
  SESSIONS_CHANGED_EVENT: "formulab:sessions-changed",
  listSessions: vi.fn(async () => []),
  deleteSession: vi.fn(),
}));

import { FormulationWorkspaceV2 } from "./FormulationWorkspaceV2";

const CARD = `# Formulation Card: Test paste

## Formulation Table

| # | Ingredient (INCI) | Function | Weight % |
|---|---|---|---|
| 1 | Water (Aqua) | Solvent | q.s. 100 |
`;

function openSavedSession() {
  return render(
    <MemoryRouter initialEntries={["/live/2026-01-01-1200-test"]}>
      <Routes>
        <Route path="/live/:sessionId" element={<FormulationWorkspaceV2 />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("printing a formulation card", () => {
  beforeEach(() => {
    readSession.mockReset();
    readSession.mockResolvedValue({
      status: "ok",
      id: "2026-01-01-1200-test",
      brief: { target: "test paste" },
      cards: [{ version: "v1", markdown: CARD }],
      read_only: true,
    });
  });

  it("sends the card to the OS print dialog, which is what reaches the printers", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    openSavedSession();

    await userEvent.click(await screen.findByRole("button", { name: /print/i }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    vi.unstubAllGlobals();
  });

  it("marks the card as the print area so only it reaches paper", async () => {
    const { container } = openSavedSession();
    await screen.findByRole("button", { name: /print/i });
    // The stylesheet prints .print-area and hides .print-hide; without the
    // marker the whole app window would be printed.
    expect(container.querySelector(".print-area")).not.toBeNull();
    expect(container.querySelector(".print-hide")).not.toBeNull();
  });

  it("offers no print button until there is a card to print", async () => {
    render(
      <MemoryRouter initialEntries={["/live"]}>
        <Routes>
          <Route path="/live" element={<FormulationWorkspaceV2 />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /print/i })).not.toBeInTheDocument(),
    );
  });
});
