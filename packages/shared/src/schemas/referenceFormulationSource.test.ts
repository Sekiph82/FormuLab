import { describe, expect, it } from "vitest";
import { createReferenceFormulationSource, referenceFormulationRightsSchema, type ReferenceFormulationRights } from "./referenceFormulationSource";
import { supplierDocumentAcquisitionSchema } from "./supplierDocument";

const hash = "a".repeat(64);
const acquisition = (documentType: "FORMULATION" | "SDS" = "FORMULATION") => supplierDocumentAcquisitionSchema.parse({
  schemaVersion: "1.0",
  code: "supplierdoc-formula-1",
  supplierId: "supplier-croda",
  providerId: "croda-public",
  surfaceId: "formulation-library",
  documentType,
  acquisitionMethod: "manual_assisted",
  sourceFileSelection: {
    selectionId: "selection-1",
    originalFilename: "formulation-123.pdf",
    sourceFileSha256: hash,
    selectedAt: "2026-10-26T08:00:00.000Z",
    selectedBy: "owner-1",
  },
  sourceProduct: { tradeName: "Example surfactant" },
  market: "EU",
  language: "en",
  publicationDate: "2025-04-10",
  sourceRevision: "2",
  originalFilename: "formulation-123.pdf",
  mimeType: "application/pdf",
  sha256: hash,
  byteSize: 2048,
  parserStatus: "not_started",
  acquiredAt: "2026-10-26T08:00:00.000Z",
  createdAt: "2026-10-26T08:00:00.000Z",
});
const rights: ReferenceFormulationRights = { status: "unknown", redistribution: "unknown", evidenceRefs: [] };

describe("immutable reference formulation source", () => {
  it("copies the exact formulation acquisition and keeps rights and parser provenance explicit", () => {
    const result = createReferenceFormulationSource({
      id: "reference-formula-source-1",
      acquisition: acquisition(),
      formulationCode: "HC-DW-22",
      title: "Hand Dishwash Detergent Liquid",
      parserVersion: "formulation-parser/1.0.0",
      rights,
      createdAt: "2026-10-26T08:01:00.000Z",
    });

    expect(result).toMatchObject({
      supplierId: "supplier-croda",
      providerId: "croda-public",
      surfaceId: "formulation-library",
      sourceProduct: { tradeName: "Example surfactant" },
      acquisitionCode: "supplierdoc-formula-1",
      sourcePdfSha256: hash,
      acquisitionMethod: "manual_assisted",
      sourceFileSelection: { selectionId: "selection-1", sourceFileSha256: hash },
      publicationDate: "2025-04-10",
      sourceRevision: "2",
      formulationCode: "HC-DW-22",
      title: "Hand Dishwash Detergent Liquid",
      market: "EU",
      language: "en",
      parserVersion: "formulation-parser/1.0.0",
      rights: { status: "unknown", redistribution: "unknown" },
    });
    expect(result).not.toHaveProperty("rawMaterial");
    expect(result).not.toHaveProperty("extractedIngredients");
  });

  it("rejects non-formulation acquisitions and rights claims without traceable metadata", () => {
    expect(() => createReferenceFormulationSource({
      id: "wrong-kind",
      acquisition: acquisition("SDS"),
      title: "Not a formulation",
      parserVersion: "parser/1",
      rights,
      createdAt: "2026-10-26T08:01:00.000Z",
    })).toThrow(/FORMULATION document acquisition/);
    expect(() => referenceFormulationRightsSchema.parse({ status: "licensed", redistribution: "unknown" })).toThrow(/license name or URL/);
    expect(() => referenceFormulationRightsSchema.parse({ status: "permission_granted", redistribution: "unknown" })).toThrow(/permission reference/);
    expect(() => referenceFormulationRightsSchema.parse({ status: "unknown", redistribution: "allowed", evidenceRefs: [] })).toThrow(/rights evidence/);
    expect(() => referenceFormulationRightsSchema.parse({ status: "unknown", redistribution: "prohibited", evidenceRefs: [] })).toThrow(/rights evidence/);
    expect(() => referenceFormulationRightsSchema.parse({
      status: "licensed", redistribution: "unknown", licenseName: "Example license", evidenceRefs: ["rights:1"],
      licenseUrl: "https://example.com/license?token=private",
    })).toThrow(/query values redacted/);
  });
});
