import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferenceFormulationRecord } from "@formulab/shared";
import { ReferenceFormulationsPage } from "./ReferenceFormulationsPage";

const bridge = { list: vi.fn(), listReviews: vi.fn(), appendReview: vi.fn() };
const actor = { role: "formulator", userId: "reviewer-1", displayName: "Review Chemist" };
let activeActor: typeof actor | null = actor;
vi.mock("@/lib/referenceFormulations", () => ({ listReferenceFormulations: () => bridge.list() }));
vi.mock("@/lib/referenceFormulationReviews", () => ({
  listReferenceFormulationReviews: (...args: [string]) => bridge.listReviews(...args),
  appendReferenceFormulationReview: (...args: [unknown]) => bridge.appendReview(...args),
}));
vi.mock("@/lib/currentActor", () => ({ useTrustedActor: () => activeActor }));

const record = {
  id: "reference-formula-1",
  code: "croda-formula-1",
  sourceDocumentHash: "a".repeat(64),
  source: { title: "Synthetic Review Formula", supplierId: "supplier-test", formulationCode: "TEST-1" },
  identityCandidates: [{
    field: "formulation_title", rawValue: "Synthetic Review Formula", extractionMethod: "labeled_field",
    evidence: [{ sourceDocumentHash: "a".repeat(64), pageNumber: 1, blockIndex: 1, excerpt: "Title: Synthetic Review Formula", source: "digital" }],
    reviewRequired: true,
  }],
  ingredientLines: [], procedureSteps: [], targetCandidates: [],
} as unknown as ReferenceFormulationRecord;

describe("reference formulation evidence review page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeActor = actor;
    bridge.list.mockResolvedValue([record]);
    bridge.listReviews.mockResolvedValue([]);
    bridge.appendReview.mockImplementation(async (input: Record<string, unknown>) => ({
      ...input, schemaVersion: "1.0", id: "rfreview-1", code: "rfreview-1", reviewedAt: "2026-10-26T10:00:00.000Z",
    }));
  });

  function renderPage() {
    return render(<MemoryRouter initialEntries={["/reference-formulations/reference-formula-1"]}>
      <Routes><Route path="/reference-formulations/:recordId" element={<ReferenceFormulationsPage />} /></Routes>
    </MemoryRouter>);
  }

  it("shows cited source evidence beside the extraction and stores a named acceptance separately", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("Title: Synthetic Review Formula")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Extracted value" })).toHaveTextContent("Synthetic Review Formula");
    await user.selectOptions(screen.getByLabelText("Review decision"), "accepted");
    await user.click(screen.getByRole("button", { name: "Save review decision" }));
    await waitFor(() => expect(bridge.appendReview).toHaveBeenCalledWith(expect.objectContaining({
      referenceFormulationRecordId: "reference-formula-1",
      sourceDocumentHash: "a".repeat(64),
      sourceValue: "Synthetic Review Formula",
      decision: "accepted",
      reviewer: { userId: "reviewer-1", displayName: "Review Chemist" },
    })));
    expect(await screen.findByRole("status")).toHaveTextContent("Accept saved");
  });

  it("stores edited values as proposals while preserving the original extracted value", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Title: Synthetic Review Formula");
    await user.selectOptions(screen.getByLabelText("Review decision"), "edited");
    const proposal = screen.getByLabelText("Proposed reviewed value");
    await user.clear(proposal);
    await user.type(proposal, "Owner-reviewed title");
    await user.click(screen.getByRole("button", { name: "Save review decision" }));
    await waitFor(() => expect(bridge.appendReview).toHaveBeenCalledWith(expect.objectContaining({
      sourceValue: "Synthetic Review Formula",
      decision: "edited",
      reviewedValue: "Owner-reviewed title",
    })));
    expect(screen.getByRole("region", { name: "Extracted value" })).toHaveTextContent("Synthetic Review Formula");
  });

  it("disables review actions when no authenticated actor is available", async () => {
    activeActor = null;
    renderPage();
    await screen.findByText("Title: Synthetic Review Formula");
    expect(screen.getByRole("alert")).toHaveTextContent("Sign in to record a named human review decision");
    expect(screen.getByRole("button", { name: "Save review decision" })).toBeDisabled();
  });
});
