import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  readSession: vi.fn(),
  download: vi.fn(async () => undefined),
}));
vi.mock("@/lib/formulationV2", () => ({ listSessions: mocks.listSessions, readSession: mocks.readSession }));
vi.mock("@/lib/formulationReport", () => ({ downloadFormulationReport: mocks.download }));
vi.mock("@/hooks/useMasterCostData", () => ({ useMasterCostData: () => ({ materials: [], prices: [], rates: [], profiles: [], loading: false }) }));
vi.mock("@/hooks/useCompatibilityRules", () => ({ useCompatibilityRules: () => ({ rules: [], loading: false }) }));
vi.mock("@/hooks/useSafetyRules", () => ({ useSafetyRules: () => ({ rules: [], loading: false }) }));
vi.mock("@/hooks/useRegulatoryRules", () => ({ useRegulatoryRules: () => ({ rules: [], loading: false }) }));

import { ReportsPage } from "./ReportsPage";

describe("ReportsPage", () => {
  it("lists saved formulation results and downloads a DOCX report with its evaluations", async () => {
    mocks.listSessions.mockResolvedValue([
      { id: "2026-07-25-0521-older", created: "2026-07-25-0521", brief: { target: "Older shampoo" }, card_count: 3 },
      { id: "2026-11-16-0522-new", created: "2026-11-16-0522", brief: { target: "Mild sulfate-free shampoo" }, card_count: 3 },
      { id: "2026-11-17-0900-empty", created: "2026-11-17-0900", brief: { target: "Failed run" }, card_count: 0 },
    ]);
    const formula = { ingredients: [{ inci: "Water (Aqua)", weight_pct: "q.s. 100" }] };
    mocks.readSession.mockResolvedValue({ id: "2026-11-16-0522-new", brief: { target: "Mild sulfate-free shampoo", market: "Kenya" }, cards: [{ version: "v1", formula }] });
    render(<MemoryRouter><ReportsPage /></MemoryRouter>);

    const first = await screen.findByText("Mild sulfate-free shampoo");
    expect(screen.queryByText("Failed run")).toBeNull();
    expect(screen.getByText(/2026-11-16 05:22/)).toBeInTheDocument();
    expect(first.compareDocumentPosition(screen.getByText("Older shampoo")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(screen.getAllByRole("button", { name: "docx" })[0]!);
    expect(mocks.download).toHaveBeenCalledTimes(1);
    const [, id, safety, regulatory, compatibility, format] = mocks.download.mock.calls[0] as unknown as [unknown, string, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, string];
    expect([id, format]).toEqual(["2026-11-16-0522-new", "docx"]);
    expect(Object.keys(safety)).toEqual(["v1"]);
    expect(Object.keys(regulatory)).toEqual(["v1"]);
    expect(Object.keys(compatibility)).toEqual(["v1"]);
  });
});
