import { describe, expect, it, vi } from "vitest";
import { connectorConnectionSchema } from "../schemas/connector";
import {
  CLARIANT_DOCUMENT_SURFACES,
  CLARIANT_SUPPLIER_PROFILE,
  createClariantSupplierAdapter,
  type ClariantPortalSession,
} from "./clariantSupplierAdapter";
import type { SupplierManualAdapterProfile } from "./supplierManualAdapter";

const timestamp = "2026-10-26T09:00:00.000Z";
const selection = {
  selectionId: "clariant-doc-selected-001",
  originalFilename: "clariant-ingredient-tds.pdf",
  sourceFileSha256: "a".repeat(64),
  selectedAt: timestamp,
  selectedBy: "chemist-1",
};

function profile(documentType: "SDS" | "TDS" | "FORMULATION" = "TDS"): Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface"> {
  return {
    catalogSources: [],
    documents: [{
      selection,
      sourceProductId: "clariant-product-001",
      documentType,
      market: "EU",
      language: "en",
      sourceRevision: "Revision 3",
      publicationDate: "2026-08-01",
    }],
    scope: { markets: ["EU"], languages: ["en"], productLines: ["Personal Care"] },
  };
}

function portalSession(lifecycleState: "authenticated" | "configured" = "authenticated"): ClariantPortalSession {
  return {
    connection: connectorConnectionSchema.parse({
      schemaVersion: "1.0",
      code: "clariant-customer-portal",
      name: "ClariHub",
      connectorType: "REST_API",
      sourceSystemId: "SUPPLIER_CLARIANT",
      connectionRef: `formulab-credential:v1:${"c".repeat(32)}`,
      baseUrl: "https://www.clariant.com/",
      status: "ready",
      lifecycleState,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: "chemist-1",
    }),
    confirmation: { userConfirmedAuthentication: true, authenticatedAt: timestamp },
  };
}

describe("Clariant Document Finder and ClariHub profiles — V01-02.008", () => {
  it("declares Document Finder and each ClariHub business unit as separate surfaces", () => {
    expect(CLARIANT_SUPPLIER_PROFILE).toMatchObject({ supplierId: "clariant", providerId: "clariant" });
    expect(CLARIANT_DOCUMENT_SURFACES.map(({ surfaceId }) => surfaceId)).toEqual([
      "clariant-document-finder-manual",
      "clariant-clarihub-care-chemicals-manual",
      "clariant-clarihub-oil-services-manual",
    ]);
    expect(CLARIANT_DOCUMENT_SURFACES.map(({ businessUnit }) => businessUnit)).toEqual([
      "User selected; preserve exact requested scope",
      "Care Chemicals",
      "Oil Services",
    ]);
  });

  it("imports Document Finder selections through the existing manual file and provenance path", async () => {
    const storeSelectedDocument = vi.fn(async () => ({
      status: "ok" as const,
      value: {
        acquisitionCode: "supplierdoc-clariant-001",
        sha256: "b".repeat(64),
        byteSize: 4096,
        filename: selection.originalFilename,
        mimeType: "application/pdf" as const,
      },
    }));
    const adapter = createClariantSupplierAdapter("clariant-document-finder-manual", profile(), { storeSelectedDocument });
    const found = await adapter.discoverDocuments({ sourceProductId: "clariant-product-001" });
    expect(found.status).toBe("ok");
    if (found.status !== "ok") return;
    expect(found.value[0]).toMatchObject({
      sourceProductId: "clariant-product-001",
      documentType: "TDS",
      sourceRevision: "Revision 3",
      publicationDate: "2026-08-01",
    });
    const downloaded = await adapter.downloadDocument({ sourceDocumentId: selection.selectionId });
    expect(downloaded.status).toBe("ok");
    expect(storeSelectedDocument).toHaveBeenCalledWith(expect.objectContaining({
      supplierId: "clariant",
      sourceProductId: "clariant-product-001",
      market: "EU",
      language: "en",
      publicationDate: "2026-08-01",
    }));
    expect((await adapter.getCoverageReport()).requestedScope.productLines).toEqual(["Personal Care"]);
  });

  it("requires confirmed authentication for ClariHub and rejects portal state on the public finder", () => {
    expect(() => createClariantSupplierAdapter("clariant-clarihub-care-chemicals-manual", profile("FORMULATION"), {
      storeSelectedDocument: vi.fn(),
    })).toThrow(/authenticated, user-attended portal session/);
    expect(() => createClariantSupplierAdapter("clariant-clarihub-care-chemicals-manual", profile("FORMULATION"), {
      storeSelectedDocument: vi.fn(),
    }, portalSession("configured"))).toThrow(/confirmed user authentication/);
    expect(() => createClariantSupplierAdapter("clariant-clarihub-care-chemicals-manual", profile("FORMULATION"), {
      storeSelectedDocument: vi.fn(),
    }, portalSession())).not.toThrow();
    expect(() => createClariantSupplierAdapter("clariant-document-finder-manual", profile(), {
      storeSelectedDocument: vi.fn(),
    }, portalSession())).toThrow(/cannot carry portal session state/);
  });
});
