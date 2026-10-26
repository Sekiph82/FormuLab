import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferenceFormulationRecord } from "@formulab/shared";
import { ReferenceFormulationsPage } from "./ReferenceFormulationsPage";

const bridge = { list: vi.fn(), listReviews: vi.fn(), appendReview: vi.fn(), trace: vi.fn() };
const actor = { role: "formulator", userId: "reviewer-1", displayName: "Review Chemist" };
let activeActor: typeof actor | null = actor;
vi.mock("@/lib/referenceFormulations", () => ({ listReferenceFormulations: () => bridge.list() }));
vi.mock("@/lib/referenceFormulationReviews", () => ({
  listReferenceFormulationReviews: (...args: [string]) => bridge.listReviews(...args),
  appendReferenceFormulationReview: (...args: [unknown]) => bridge.appendReview(...args),
}));
vi.mock("@/lib/referenceFormulationCorpusReview", () => ({ getReferenceFormulationCorpusReviewData: (...args: [string]) => bridge.trace(...args) }));
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
    bridge.trace.mockResolvedValue({ source: record, versions: [] });
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

  it("shows normalized candidates and contribution lineage to the exact SDS Section 3 evidence", async () => {
    bridge.trace.mockResolvedValue({
      source: record,
      versions: [{
        version: {
          id: "normalization-1", version: 1, createdAt: "2026-10-26T10:00:00.000Z",
          sourceDocumentHash: "a".repeat(64),
        },
        lines: [{
          sourceLine: {
            id: "source-line-1", sequenceOrder: 1, rawRow: ["Known product", "4.0", "%", "w/w"],
            ingredientName: { evidence: { pageNumber: 2, blockIndex: 4, excerpt: "Known product" } },
          },
          normalizedLine: {
            sourceLineId: "source-line-1",
            commercialProduct: { candidateIds: ["product-candidate-1"] },
            canonicalChemistry: { candidateIds: ["chemistry-candidate-1"] },
            functionNormalization: {
              supplierFunction: { originalValue: "surfactant" }, canonicalFunction: { candidateIds: ["nonionic_surfactant"] },
            },
            componentContributions: [{
              id: "contribution-1", status: "range", sourceFormulaLineId: "source-line-1", sourceFormulaDocumentHash: "a".repeat(64),
              formulaAmount: { originalValue: "4.0", unit: "%", basis: "w/w", evidenceRefs: ["formula:p2:amount"] },
              contributionPercentRange: { lowerBound: 0.8, upperBound: 1.6 }, canonicalChemistry: { status: "proposed", candidateIds: ["component-chemistry-candidate"] },
              sourceSds: { status: "available", evidenceId: "sds-evidence-1", sourceComponentId: "sds-component-1", sourceFactId: "sds-fact-1", originalValue: "20-40%", disclosure: "disclosed", fractionRange: { lowerBound: 0.2, upperBound: 0.4 }, evidenceRefs: ["sds:p3:concentration"] },
              evidenceRefs: ["formula:p2:amount", "sds:p3:concentration"], unknownReasons: [],
            }],
          },
          contributions: [{
            contribution: {
              id: "contribution-1", status: "range", sourceFormulaLineId: "source-line-1",
              sourceFormulaDocumentHash: "a".repeat(64), formulaAmount: { originalValue: "4.0", unit: "%", basis: "w/w", evidenceRefs: ["formula:p2:amount"] },
              contributionPercentRange: { lowerBound: 0.8, upperBound: 1.6 },
              canonicalChemistry: { status: "proposed", candidateIds: ["component-chemistry-candidate"] },
              sourceSds: { status: "available", evidenceId: "sds-evidence-1", sourceComponentId: "sds-component-1", sourceFactId: "sds-fact-1", originalValue: "20-40%", disclosure: "disclosed", fractionRange: { lowerBound: 0.2, upperBound: 0.4 }, evidenceRefs: ["sds:p3:concentration"] },
              evidenceRefs: ["formula:p2:amount", "sds:p3:concentration"], unknownReasons: [],
            },
            sds: {
              evidence: { code: "sds-evidence-1" },
              acquisition: { sourceProduct: { tradeName: "Supplier Blend" }, supplierId: "supplier-test", code: "sds-acquisition-1", revisionDate: "2025-09-01", sha256: "c".repeat(64) },
              sourceComponent: { componentName: { rawValue: "Sodium laureth sulfate" } },
            },
          }],
        }],
      }],
    });
    renderPage();
    expect(await screen.findByRole("region", { name: "Normalization source trace" })).toBeInTheDocument();
    expect(screen.getByText(/product-candidate-1/)).toBeInTheDocument();
    expect(screen.getByText(/chemistry-candidate-1/)).toBeInTheDocument();
    expect(screen.getByText(/Supplier Blend/)).toBeInTheDocument();
    expect(screen.getByText(/sds-acquisition-1/)).toBeInTheDocument();
    expect(screen.getByText(/sds-component-1/)).toBeInTheDocument();
    expect(screen.getByText(/Sodium laureth sulfate/)).toBeInTheDocument();
  });
});
