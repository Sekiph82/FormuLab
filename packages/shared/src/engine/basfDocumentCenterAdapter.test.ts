import { describe, expect, it, vi } from "vitest";
import {
  BASF_PUBLIC_DOCUMENT_SURFACES,
  BASF_SUPPLIER_PROFILE,
  createBasfDocumentCenterAdapter,
} from "./basfDocumentCenterAdapter";
import type { SupplierManualAdapterProfile } from "./supplierManualAdapter";

const timestamp = "2026-10-26T09:00:00.000Z";

function profile(documentType?: "SDS" | "TDS" | "CERTIFICATE" | "OTHER" | "FORMULATION"):
Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface"> {
  return {
    catalogSources: [],
    documents: documentType ? [{
      selection: {
        selectionId: "basf-document-1",
        originalFilename: "basf-product-document.pdf",
        sourceFileSha256: "a".repeat(64),
        selectedAt: timestamp,
        selectedBy: "chemist-1",
      },
      sourceProductId: "basf-grade-001",
      documentType,
      market: "US",
      language: "en",
    }] : [],
    scope: { markets: ["US"], languages: ["en"], productLines: ["Performance Polymers"] },
  };
}

const deps = { storeSelectedDocument: vi.fn() };

describe("BASF public product document centers — V01-02.015", () => {
  it("registers distinct regional centers and product-family entry points", () => {
    expect(BASF_SUPPLIER_PROFILE).toMatchObject({ supplierId: "basf", providerId: "basf" });
    expect(BASF_PUBLIC_DOCUMENT_SURFACES.map(({ surfaceId }) => surfaceId)).toEqual([
      "basf-performance-polymers-na-download-center-manual",
      "basf-performance-polymers-emea-download-center-manual",
      "basf-na-isocyanates-polyols-product-documents-manual",
    ]);
    expect(BASF_PUBLIC_DOCUMENT_SURFACES[0].entryPointUrl).toContain("northamerica");
    expect(BASF_PUBLIC_DOCUMENT_SURFACES[1].entryPointUrl).toContain("/emea/");
  });

  it("preserves actual user-selected market, language, product and revision without implying full coverage", async () => {
    const scoped = {
      ...profile("SDS"),
      documents: [{
        ...profile("SDS").documents[0],
        sourceRevision: "Revision 4",
        revisionDate: "2026-09-15",
      }],
    };
    const adapter = createBasfDocumentCenterAdapter(
      "basf-performance-polymers-na-download-center-manual", scoped, { storeSelectedDocument: vi.fn(async () => ({
        status: "ok" as const,
        value: {
          acquisitionCode: "supplierdoc-basf-001",
          sha256: "b".repeat(64),
          byteSize: 1200,
          filename: "basf-product-document.pdf",
          mimeType: "application/pdf" as const,
        },
      })) },
    );
    const found = await adapter.discoverDocuments({ sourceProductId: "basf-grade-001" });
    expect(found.status).toBe("ok");
    if (found.status !== "ok") return;
    expect(found.value[0]).toMatchObject({ sourceProductId: "basf-grade-001", documentType: "SDS", sourceRevision: "Revision 4" });
    const report = await adapter.getCoverageReport();
    expect(report.requestedScope).toEqual({ markets: ["US"], languages: ["en"], productLines: ["Performance Polymers"] });
    expect(report.scannedScope.productLines).toEqual(["Performance Polymers"]);
  });

  it("limits document kinds to those declared by the selected product-family surface", () => {
    expect(() => createBasfDocumentCenterAdapter(
      "basf-na-isocyanates-polyols-product-documents-manual", profile("CERTIFICATE"), deps,
    )).toThrow(/outside the declared BASF document-center capability/);
    expect(() => createBasfDocumentCenterAdapter(
      "basf-performance-polymers-emea-download-center-manual", profile("CERTIFICATE"), deps,
    )).not.toThrow();
    expect(() => createBasfDocumentCenterAdapter(
      "basf-performance-polymers-na-download-center-manual", profile("FORMULATION"), deps,
    )).toThrow(/outside the declared BASF document-center capability/);
  });

  it("requires explicit product-line scope and labels restricted or family-incomplete surfaces", () => {
    expect(BASF_PUBLIC_DOCUMENT_SURFACES.every(({ limitations }) => limitations.some((item) => /restricted|confidential|other BASF chemical businesses/i.test(item)))).toBe(true);
    expect(() => createBasfDocumentCenterAdapter("basf-performance-polymers-na-download-center-manual", {
      ...profile(), scope: { markets: ["US"], languages: ["en"], productLines: [] },
    }, deps)).toThrow(/must name the product lines/);
  });
});
