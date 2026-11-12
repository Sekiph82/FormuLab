import { describe, expect, it } from "vitest";
import { supplierDocumentAcquisitionSchema } from "../schemas/supplierDocument";
import { extractReferenceFormulationIdentity } from "./referenceFormulationIdentityExtraction";

const HASH = "c".repeat(64);
const acquisition = (documentType: "FORMULATION" | "SDS" = "FORMULATION") => supplierDocumentAcquisitionSchema.parse({
  schemaVersion: "1.0",
  code: "supplierdoc-formulation-1",
  supplierId: "supplier-croda",
  providerId: "croda-public",
  surfaceId: "formulation-library",
  documentType,
  acquisitionMethod: "manual_assisted",
  sourceFileSelection: {
    selectionId: "selection-1", originalFilename: "formula.pdf", sourceFileSha256: HASH,
    selectedAt: "2026-10-26T08:00:00.000Z", selectedBy: "owner-1",
  },
  sourceProduct: { tradeName: "Supplier product" },
  market: "EU",
  language: "en",
  sourceRevision: "1",
  revisionDate: "2025-01-01",
  originalFilename: "formula.pdf",
  mimeType: "application/pdf",
  sha256: HASH,
  byteSize: 1024,
  parserStatus: "not_started",
  acquiredAt: "2026-10-26T08:00:00.000Z",
  createdAt: "2026-10-26T08:00:00.000Z",
});

describe("reference formulation identity extraction", () => {
  it("extracts printed identity fields with exact page/source citations and compares acquisition metadata", () => {
    const result = extractReferenceFormulationIdentity({
      acquisition: acquisition(),
      pages: [
        { pageNumber: 1, blocks: [
          { type: "text", blockIndex: 0, text: "Supplier: Croda Europe Ltd", source: "digital" },
          { type: "text", blockIndex: 1, text: "Application: Hand dishwashing", source: "digital" },
          { type: "heading", blockIndex: 2, text: "Formulation Title", source: "digital", position: { x: 60, y: 40 } },
          { type: "text", blockIndex: 3, text: "Hand Dishwash Detergent Liquid", source: "digital", position: { x: 60, y: 58 } },
          { type: "text", blockIndex: 4, text: "Formulation Code: HC/DW/22", source: "digital" },
        ] },
        { pageNumber: 2, blocks: [
          { type: "text", blockIndex: 0, text: "Revision: 2", source: "ocr", confidence: 0.91 },
          { type: "text", blockIndex: 1, text: "Revision Date: 2026-02-01", source: "ocr", confidence: 0.89 },
          { type: "text", blockIndex: 2, text: "Document Version: 4.1", source: "ocr", confidence: 0.88 },
          { type: "text", blockIndex: 3, text: "Document Number: FORM-77", source: "ocr", confidence: 0.87 },
        ] },
      ],
    });

    expect(result).toMatchObject({
      sourceDocumentHash: HASH,
      acquisitionCode: "supplierdoc-formulation-1",
      supplierId: "supplier-croda",
      reviewRequired: true,
    });
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "supplier_name", rawValue: "Croda Europe Ltd", evidence: [expect.objectContaining({ pageNumber: 1, blockIndex: 0, source: "digital" })] }),
      expect.objectContaining({ field: "application", rawValue: "Hand dishwashing", evidence: [expect.objectContaining({ pageNumber: 1, blockIndex: 1 })] }),
      expect.objectContaining({ field: "formulation_title", rawValue: "Hand Dishwash Detergent Liquid", extractionMethod: "semantic_heading", evidence: [expect.objectContaining({ pageNumber: 1, blockIndex: 3 })] }),
      expect.objectContaining({ field: "formulation_code", rawValue: "HC/DW/22", evidence: [expect.objectContaining({ pageNumber: 1, blockIndex: 4 })] }),
      expect.objectContaining({ field: "document_version", rawValue: "4.1", evidence: [expect.objectContaining({ pageNumber: 2, blockIndex: 2, source: "ocr", confidence: 0.88 })] }),
    ]));
    expect(result.metadataComparisons).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "revision_identifier", acquisitionValue: "1", extractedValues: ["2"], result: "differs", acquisitionCode: "supplierdoc-formulation-1" }),
      expect.objectContaining({ field: "revision_date", acquisitionValue: "2025-01-01", extractedValues: ["2026-02-01"], result: "differs" }),
    ]));
    expect(result.warnings).toContain("acquisition_metadata_differs");
    expect(result.candidates.every((candidate) => candidate.reviewRequired)).toBe(true);
  });

  it("preserves conflicting candidates for review and returns no invented identity for unlabelled pages", () => {
    const result = extractReferenceFormulationIdentity({
      acquisition: acquisition(),
      pages: [{ pageNumber: 3, blocks: [
        { type: "text", blockIndex: 0, text: "Revision: 2", source: "digital" },
        { type: "text", blockIndex: 1, text: "Revision: 3", source: "digital" },
      ] }],
    });
    expect(result.candidates.map(({ rawValue }) => rawValue)).toEqual(["2", "3"]);
    expect(result.warnings).toContain("conflicting_identity_candidates");

    const empty = extractReferenceFormulationIdentity({ acquisition: acquisition(), pages: [{ pageNumber: 1, blocks: [] }] });
    expect(empty).toMatchObject({ candidates: [], warnings: ["no_identity_candidates"], supplierId: "supplier-croda" });
  });

  it("does not misclassify following labeled metadata or page numbers as a semantic title", () => {
    const result = extractReferenceFormulationIdentity({
      acquisition: acquisition(),
      pages: [{ pageNumber: 1, blocks: [
        { type: "heading", blockIndex: 0, text: "Formulation Title", source: "digital" },
        { type: "text", blockIndex: 1, text: "Supplier: Croda", source: "digital" },
        { type: "heading", blockIndex: 2, text: "Formula Name", source: "digital" },
        { type: "text", blockIndex: 3, text: "3.1", source: "digital" },
      ] }],
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ field: "supplier_name", rawValue: "Croda" });
  });

  it("rejects SDS acquisitions and invalid page references", () => {
    expect(() => extractReferenceFormulationIdentity({ acquisition: acquisition("SDS"), pages: [{ pageNumber: 1, blocks: [] }] }))
      .toThrow(/FORMULATION document acquisition/);
    expect(() => extractReferenceFormulationIdentity({ acquisition: acquisition(), pages: [{ pageNumber: 0, blocks: [] }] })).toThrow();
  });
});
