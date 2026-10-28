import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferenceFormulationRecord } from "@formulab/shared";
import { ReferenceFormulationsPage } from "./ReferenceFormulationsPage";

const bridge = { list: vi.fn(), listReviews: vi.fn(), appendReview: vi.fn(), trace: vi.fn(), readPdf: vi.fn(), index: vi.fn() };
const actor = { role: "formulator", userId: "reviewer-1", displayName: "Review Chemist" };
let activeActor: typeof actor | null = actor;
vi.mock("@/lib/referenceFormulations", () => ({ listReferenceFormulations: () => bridge.list() }));
vi.mock("@/lib/referenceFormulationNormalizations", () => ({ rebuildReferenceFormulationCorpusIndex: () => bridge.index() }));
vi.mock("@/lib/referenceFormulationReviews", () => ({
  listReferenceFormulationReviews: (...args: [string]) => bridge.listReviews(...args),
  appendReferenceFormulationReview: (...args: [unknown]) => bridge.appendReview(...args),
}));
vi.mock("@/lib/referenceFormulationCorpusReview", () => ({ getReferenceFormulationCorpusReviewData: (...args: [string]) => bridge.trace(...args) }));
vi.mock("@/lib/currentActor", () => ({ useTrustedActor: () => activeActor }));
vi.mock("@/lib/masterdata", () => ({ readSupplierDocumentPdf: (...args: [string]) => bridge.readPdf(...args) }));
vi.mock("@/components/dataExchange/connectors/SupplierSdsPdfPagePreview", () => ({
  SupplierSdsPdfPagePreview: ({ pageNumber, documentLabel }: { pageNumber: number; documentLabel: string }) => <div>{documentLabel} PDF page {pageNumber}</div>,
}));

const record = {
  id: "reference-formula-1",
  code: "croda-formula-1",
  sourceDocumentHash: "a".repeat(64),
  source: { title: "Synthetic Review Formula", supplierId: "supplier-test", formulationCode: "TEST-1", sourceProduct: {} },
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
    bridge.index.mockResolvedValue({ queryRecords: [], index: {} });
    bridge.listReviews.mockResolvedValue([]);
    bridge.trace.mockResolvedValue({ source: record, versions: [] });
    bridge.readPdf.mockResolvedValue(new Uint8Array([1, 2, 3]));
    bridge.appendReview.mockImplementation(async (input: Record<string, unknown>) => ({
      ...input, schemaVersion: "1.0", id: "rfreview-1", code: "rfreview-1", reviewedAt: "2026-10-26T10:00:00.000Z",
    }));
  });

  function renderPage() {
    return render(<MemoryRouter initialEntries={["/reference-formulations/reference-formula-1"]}>
      <Routes><Route path="/reference-formulations/:recordId" element={<ReferenceFormulationsPage />} /></Routes>
    </MemoryRouter>);
  }

  function renderListPage() {
    return render(<MemoryRouter initialEntries={["/reference-formulations"]}>
      <Routes><Route path="/reference-formulations" element={<ReferenceFormulationsPage />} /></Routes>
    </MemoryRouter>);
  }

  it("searches indexed identity, function, dosage, process, and target candidates and opens the source lineage", async () => {
    const corpusRecord = {
      ...record,
      source: {
        ...record.source, title: "Dishwash Reference", supplierId: "croda", providerId: "croda-provider", surfaceId: "croda-library",
        sourceProduct: { tradeName: "Trade Blend", grade: "Grade A" }, acquisitionCode: "acq-1", originalFilename: "formula.pdf",
        sourceRevision: "Rev 2", revisionDate: "2026-01-05", publicationDate: "2026-01-01", market: "EU", language: "en",
      },
      ingredientLines: [{ id: "line-1", orderIndex: 1, rawRow: ["Trade Blend"], ingredientName: { rawValue: "Trade Blend" } }],
      procedureSteps: [{ id: "step-1", sequenceOrder: 1, rawInstruction: "Mix until clear" }],
      targetCandidates: [{ id: "target-1", field: "ph", rawPropertyLabel: "pH", rawValue: "5.0-5.5" }],
    } as unknown as ReferenceFormulationRecord;
    bridge.list.mockResolvedValue([corpusRecord]);
    bridge.index.mockResolvedValue({ queryRecords: [{
      id: "query-1", sourceRecordId: corpusRecord.id, normalizationId: "norm-1", normalizationVersion: 1,
      supplierId: "croda", sourceDocumentHash: "a".repeat(64),
      supplierProduct: { tradeName: "Trade Blend", grade: "Grade A" },
      productFamily: { candidates: [{ rawValue: "Dishwashing", evidenceRefs: ["identity:family"] }] },
      lines: [{
        sourceLineEvidenceRefs: ["formula:line"],
        commercialProducts: { candidateIds: ["commercial-croda-1"] },
        canonicalChemistry: { candidateIds: ["chemistry-candidate-1"] },
        supplierFunction: { originalValue: "surfactant" }, canonicalFunctions: { candidateIds: ["anionic_surfactant"] },
        amount: { originalValue: "4.0", unit: "%", basis: "w/w", evidenceRefs: ["formula:amount"] },
      }],
      processSteps: [{ originalInstruction: "Mix until clear" }],
      targets: [{ property: "ph", originalLabel: "pH", originalValue: "5.0-5.5", resultSemantics: "target" }],
    }], index: {} });
    const user = userEvent.setup();
    renderListPage();
    expect(await screen.findByText("Dishwash Reference")).toBeInTheDocument();
    expect(screen.getByText("chemistry-candidate-1")).toBeInTheDocument();
    expect(screen.getByText(/Acquisition: acq-1/)).toBeInTheDocument();
    expect(screen.getByText(/SHA-256/)).toHaveTextContent("a".repeat(64));

    const search = screen.getByRole("searchbox", { name: /Search corpus fields/i });
    for (const term of ["Dishwashing", "commercial-croda-1", "chemistry-candidate-1", "surfactant", "4.0", "Mix until clear", "5.0-5.5"]) {
      await user.clear(search);
      await user.type(search, term);
      expect(await screen.findByText("Dishwash Reference")).toBeInTheDocument();
    }
    await user.clear(search);
    await user.selectOptions(screen.getByLabelText("Supplier"), "croda");
    expect(screen.getByText("Showing 1 of 1 source records")).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "no-such-source-term");
    expect(screen.getByText(/No source records match these filters/)).toBeInTheDocument();
  });

  it("supports keyboard focus and search entry with an accessible search label", async () => {
    const user = userEvent.setup();
    renderListPage();
    const search = await screen.findByRole("searchbox", { name: /Search corpus fields/ });

    await user.tab();
    expect(search).toHaveFocus();
    await user.keyboard("dishwash");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 0 of 1 source records");
    expect(screen.getByText(/No source records match these filters/)).toBeInTheDocument();
  });

  it("reports corpus-index load failures and provides a retry action", async () => {
    bridge.list.mockResolvedValue([]);
    bridge.index.mockRejectedValueOnce(new Error("corpus index unavailable"));
    const user = userEvent.setup();
    renderListPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("corpus index unavailable");
    expect(screen.queryByText("No extracted reference formulations are available yet.")).not.toBeInTheDocument();
    bridge.index.mockResolvedValue({ queryRecords: [], index: {} });
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(bridge.index).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No extracted reference formulations are available yet.")).toBeInTheDocument();
  });

  it("reports detail-load failures and retries without leaving the user stranded", async () => {
    bridge.list.mockRejectedValueOnce(new Error("source records unavailable"));
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("source records unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Title: Synthetic Review Formula")).toBeInTheDocument();
    expect(bridge.list).toHaveBeenCalledTimes(2);
  });

  it("clears old normalization candidates when a later corpus rebuild fails", async () => {
    bridge.index.mockResolvedValueOnce({ queryRecords: [{
      sourceRecordId: record.id, sourceDocumentHash: "a".repeat(64), supplierId: "supplier-test",
      productFamily: { candidates: [{ rawValue: "stale-candidate" }] },
      lines: [], processSteps: [], targets: [],
    }], index: {} });
    const user = userEvent.setup();
    renderListPage();
    expect(await screen.findByText("stale-candidate")).toBeInTheDocument();
    bridge.index.mockRejectedValueOnce(new Error("index rebuild failed"));
    await user.click(screen.getByRole("button", { name: "Refresh corpus" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("index rebuild failed");
    expect(screen.queryByText("stale-candidate")).not.toBeInTheDocument();
    expect(screen.getByText(/candidate index unavailable/)).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: /Search corpus fields/ }), "stale-candidate");
    expect(screen.queryByText(/No source records match these filters/)).not.toBeInTheDocument();
  });

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

  it("pairs the hash-verified source PDF with formula, function, amount, process, target and product-link evidence", async () => {
    const sourceHash = "a".repeat(64);
    const sourceRecord = {
      ...record,
      source: { ...record.source, title: "Dishwash Formula", originalFilename: "dishwash.pdf", sourcePdfSha256: sourceHash, supplierId: "supplier-test", acquisitionCode: "supplierdoc-formula-1" },
      ingredientLines: [{
        id: "ingredient-1", orderIndex: 1, rawRow: ["Surfactant X", "surfactant", "4%", "w/w"], quantitySemantics: "explicit_amount",
        ingredientName: { rawValue: "Surfactant X", evidence: { sourceDocumentHash: sourceHash, pageNumber: 2, blockIndex: 3, rowIndex: 1, cellIndex: 0, headerRowIndex: 0, header: "Ingredient", excerpt: "Surfactant X", source: "digital" } },
        function: { rawValue: "surfactant", evidence: { sourceDocumentHash: sourceHash, pageNumber: 2, blockIndex: 3, rowIndex: 1, cellIndex: 1, headerRowIndex: 0, header: "Function", excerpt: "surfactant", source: "digital" } },
        amount: { rawValue: "4%", evidence: { sourceDocumentHash: sourceHash, pageNumber: 2, blockIndex: 3, rowIndex: 1, cellIndex: 2, headerRowIndex: 0, header: "Amount", excerpt: "4%", source: "digital" } },
      }],
      productMatches: [{ ingredientLineId: "ingredient-1", sourceSupplierId: "supplier-test", resolution: "exact_match_candidate", candidates: [{ commercialProductId: "commercial-croda-1", tier: "exact", matchedOn: ["trade_name"], matchedValues: ["Surfactant X"], sourceDocumentCodes: ["supplierdoc-formula-1"] }], autoLinked: false, reviewRequired: true }],
      procedureSteps: [{ id: "step-1", sequenceOrder: 1, rawInstruction: "Mix until clear", actions: ["mix", "appearance_check"], conditions: [], extractionMethod: "procedure_section_text", evidence: { sourceDocumentHash: sourceHash, pageNumber: 3, blockIndex: 2, excerpt: "Mix until clear", source: "digital" }, reviewRequired: true }],
      targetCandidates: [{ id: "target-1", field: "ph", rawPropertyLabel: "pH", rawValue: "5.0-5.5", valueShape: "range", resultSemantics: "target", evidence: { sourceDocumentHash: sourceHash, pageNumber: 4, blockIndex: 1, excerpt: "pH: 5.0-5.5", source: "digital" }, reviewRequired: true }],
    } as unknown as ReferenceFormulationRecord;
    bridge.list.mockResolvedValue([sourceRecord]);
    bridge.trace.mockResolvedValue({ source: sourceRecord, versions: [] });
    const user = userEvent.setup();
    renderPage();
    const overview = await screen.findByRole("region", { name: "Formulation extraction overview" });
    expect(overview).toHaveTextContent("Surfactant X");
    expect(overview).toHaveTextContent("Supplier-stated function: surfactant");
    expect(overview).toHaveTextContent("Amount / unit / basis: 4%");
    expect(overview).toHaveTextContent("Mix until clear");
    expect(overview).toHaveTextContent("pH: 5.0-5.5");
    expect(overview.querySelector("code")).toHaveTextContent("commercial-croda-1");
    await user.click(screen.getAllByRole("button", { name: "View PDF page 2" })[0]!);
    expect(await screen.findByText("Supplier formulation PDF page 2")).toBeInTheDocument();
    expect(bridge.readPdf).toHaveBeenCalledWith(sourceHash);
    expect(bridge.appendReview).not.toHaveBeenCalled();
  });

  it("refuses to load a PDF when record and source-metadata hashes disagree", async () => {
    bridge.list.mockResolvedValue([{
      ...record,
      source: { ...record.source, sourcePdfSha256: "b".repeat(64) },
    }]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "View source PDF page 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("reference record and source metadata PDF hashes do not match");
    expect(bridge.readPdf).not.toHaveBeenCalled();
  });
});
