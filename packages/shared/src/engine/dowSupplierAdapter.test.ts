import { describe, expect, it, vi } from "vitest";
import { createDowSupplierAdapter, DOW_DOCUMENT_SURFACES, DOW_SUPPLIER_PROFILE } from "./dowSupplierAdapter";
import type { SupplierManualAdapterProfile } from "./supplierManualAdapter";

const timestamp = "2026-10-26T09:00:00.000Z";
const documentSelection = {
  selectionId: "dow-sds-selected-001",
  originalFilename: "dow-product-sds-eu-en.pdf",
  sourceFileSha256: "a".repeat(64),
  selectedAt: timestamp,
  selectedBy: "chemist-1",
};

function profile(documentType: "SDS" | "TDS" = "SDS"): Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface"> {
  return {
    catalogSources: [],
    documents: [{
      selection: documentSelection,
      sourceProductId: "dow-product-001",
      documentType,
      market: "EU",
      language: "en",
      sourceRevision: "Revision 4",
      revisionDate: "2026-09-30",
    }],
    scope: { markets: ["EU"], languages: ["en"], productLines: ["Home Care"] },
  };
}

describe("Dow SDS Finder and Technical Library profiles — V01-02.007", () => {
  it("registers the official discovery surfaces without claiming a public API or automated crawl", () => {
    expect(DOW_SUPPLIER_PROFILE).toMatchObject({ supplierId: "dow", providerId: "dow" });
    expect(DOW_DOCUMENT_SURFACES.map(({ entryPointUrl }) => entryPointUrl)).toEqual([
      "https://www.dow.com/en-us/support/sds-finder.html",
      "https://www.dow.com/en-us/technical-content.html",
    ]);
    expect(DOW_DOCUMENT_SURFACES.every(({ limitations }) => limitations.some((item) => /does not automate|does not assume/i.test(item)))).toBe(true);
  });

  it("imports a user-selected Dow SDS with product, market, language, revision and file provenance", async () => {
    const storeSelectedDocument = vi.fn(async () => ({
      status: "ok" as const,
      value: {
        acquisitionCode: "supplierdoc-dow-001",
        sha256: "b".repeat(64),
        byteSize: 2048,
        filename: documentSelection.originalFilename,
        mimeType: "application/pdf" as const,
      },
    }));
    const adapter = createDowSupplierAdapter("dow-sds-finder-manual", profile(), { storeSelectedDocument });
    const discovered = await adapter.discoverDocuments({ sourceProductId: "dow-product-001" });
    expect(discovered.status).toBe("ok");
    if (discovered.status !== "ok") return;
    expect(discovered.value[0]).toMatchObject({
      sourceProductId: "dow-product-001",
      documentType: "SDS",
      sourceRevision: "Revision 4",
      revisionDate: "2026-09-30",
      manualSourceSelection: { sourceFileSha256: "a".repeat(64), selectedBy: "chemist-1" },
    });

    const downloaded = await adapter.downloadDocument({ sourceDocumentId: documentSelection.selectionId });
    expect(downloaded.status).toBe("ok");
    expect(storeSelectedDocument).toHaveBeenCalledWith(expect.objectContaining({
      supplierId: "dow",
      providerId: "dow",
      sourceProductId: "dow-product-001",
      documentType: "SDS",
      market: "EU",
      language: "en",
      sourceRevision: "Revision 4",
      revisionDate: "2026-09-30",
    }));
  });

  it("keeps TDS within the Technical Library surface and rejects it from the SDS Finder surface", () => {
    expect(() => createDowSupplierAdapter("dow-sds-finder-manual", profile("TDS"), {
      storeSelectedDocument: vi.fn(),
    })).toThrow(/outside the declared Dow surface capability/);
    expect(() => createDowSupplierAdapter("dow-technical-library-manual", profile("TDS"), {
      storeSelectedDocument: vi.fn(),
    })).not.toThrow();
  });
});
