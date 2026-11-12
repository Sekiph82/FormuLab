import { describe, expect, it, vi } from "vitest";
import {
  CRODA_DOCUMENT_SURFACES,
  CRODA_SUPPLIER_PROFILE,
  createCrodaSupplierAdapter,
} from "./crodaSupplierAdapter";
import type { SupplierManualAdapterProfile } from "./supplierManualAdapter";

const timestamp = "2026-10-26T09:00:00.000Z";
const selection = {
  selectionId: "croda-home-care-sds-001",
  originalFilename: "croda-home-care-sds.pdf",
  sourceFileSha256: "a".repeat(64),
  selectedAt: timestamp,
  selectedBy: "chemist-1",
};

function profile(documentType: "SDS" | "TDS" | "FORMULATION" = "SDS"): Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface"> {
  return {
    catalogSources: [],
    documents: [{
      selection,
      sourceProductId: "croda-crodasinic-ls30",
      documentType,
      market: "GB",
      language: "en",
      sourceUrl: "https://www.croda.com/en-gb/search-results?category=%5Bredacted%5D",
      sourceRevision: "Version 2",
      revisionDate: "2026-06-01",
    }],
    scope: { markets: ["GB"], languages: ["en"], productLines: ["Home Care"] },
  };
}

describe("Croda product, SDS and formulation surfaces — V01-02.010", () => {
  it("registers Home Care, general product and formulation search independently", () => {
    expect(CRODA_SUPPLIER_PROFILE).toMatchObject({ supplierId: "croda", providerId: "croda" });
    expect(CRODA_DOCUMENT_SURFACES.map(({ surfaceId }) => surfaceId)).toEqual([
      "croda-home-care-product-search-manual",
      "croda-public-product-search-manual",
      "croda-public-formulations-manual",
    ]);
    expect(CRODA_DOCUMENT_SURFACES.every(({ limitations }) => limitations.some((item) => /does not crawl/i.test(item)))).toBe(true);
  });

  it("imports a Home Care SDS with exact market, language, source and revision provenance", async () => {
    const storeSelectedDocument = vi.fn(async () => ({
      status: "ok" as const,
      value: {
        acquisitionCode: "supplierdoc-croda-001",
        sha256: "b".repeat(64),
        byteSize: 8192,
        filename: selection.originalFilename,
        mimeType: "application/pdf" as const,
      },
    }));
    const adapter = createCrodaSupplierAdapter("croda-home-care-product-search-manual", profile(), { storeSelectedDocument });
    const discovered = await adapter.discoverDocuments({ sourceProductId: "croda-crodasinic-ls30" });
    expect(discovered.status).toBe("ok");
    if (discovered.status !== "ok") return;
    expect(discovered.value[0]).toMatchObject({
      documentType: "SDS",
      sourceProductId: "croda-crodasinic-ls30",
      sourceRevision: "Version 2",
      revisionDate: "2026-06-01",
      sourceUrl: "https://www.croda.com/en-gb/search-results?category=%5Bredacted%5D",
      manualSourceSelection: { sourceFileSha256: "a".repeat(64) },
    });
    await adapter.downloadDocument({ sourceDocumentId: selection.selectionId });
    expect(storeSelectedDocument).toHaveBeenCalledWith(expect.objectContaining({
      supplierId: "croda",
      sourceProductId: "croda-crodasinic-ls30",
      market: "GB",
      language: "en",
      sourceRevision: "Version 2",
      revisionDate: "2026-06-01",
    }));
  });

  it("accepts formulation imports only on the formulation surface and requires explicit product-line scope", () => {
    expect(() => createCrodaSupplierAdapter("croda-public-formulations-manual", profile("FORMULATION"), {
      storeSelectedDocument: vi.fn(),
    })).not.toThrow();
    expect(() => createCrodaSupplierAdapter("croda-home-care-product-search-manual", profile("FORMULATION"), {
      storeSelectedDocument: vi.fn(),
    })).toThrow(/outside the declared Croda surface capability/);
    expect(() => createCrodaSupplierAdapter("croda-home-care-product-search-manual", {
      ...profile(), scope: { markets: ["GB"], languages: ["en"], productLines: [] },
    }, { storeSelectedDocument: vi.fn() })).toThrow(/must name the product lines/);
  });
});
