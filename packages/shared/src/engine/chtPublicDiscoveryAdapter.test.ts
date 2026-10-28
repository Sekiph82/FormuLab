import { describe, expect, it, vi } from "vitest";
import {
  CHT_PUBLIC_DOCUMENT_SURFACES,
  CHT_SUPPLIER_PROFILE,
  createChtPublicDiscoveryAdapter,
} from "./chtPublicDiscoveryAdapter";
import type { SupplierManualAdapterProfile } from "./supplierManualAdapter";

const timestamp = "2026-10-26T09:00:00.000Z";

function profile(documentType?: "SDS" | "TDS" | "OTHER" | "CERTIFICATE"):
Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface"> {
  return {
    catalogSources: [],
    documents: documentType ? [{
      selection: {
        selectionId: "cht-doc-1",
        originalFilename: "cht-document.pdf",
        sourceFileSha256: "a".repeat(64),
        selectedAt: timestamp,
        selectedBy: "chemist-1",
      },
      sourceProductId: "CHT-001",
      documentType,
      market: "DE",
      language: "en",
    }] : [],
    scope: { markets: ["DE"], languages: ["en"], productLines: ["Textile auxiliaries"] },
    surfaceChecks: [{
      market: "DE",
      language: "en",
      productLine: "Textile auxiliaries",
      outcome: "no_results",
      documentsFound: 0,
      checkedAt: timestamp,
      checkedBy: "chemist-1",
    }],
  };
}

const deps = { storeSelectedDocument: vi.fn() };

describe("CHT public discovery profiles — V01-02.013", () => {
  it("declares the public SDS and product-document entry points separately", () => {
    expect(CHT_SUPPLIER_PROFILE).toMatchObject({ supplierId: "cht", providerId: "cht" });
    expect(CHT_PUBLIC_DOCUMENT_SURFACES.map(({ surfaceId }) => surfaceId)).toEqual([
      "cht-public-sds-search-manual",
      "cht-public-product-document-search-manual",
    ]);
    expect(CHT_PUBLIC_DOCUMENT_SURFACES[0].documentTypes).toEqual(["SDS"]);
    expect(CHT_PUBLIC_DOCUMENT_SURFACES[1].documentTypes).toEqual(["SDS", "TDS", "OTHER"]);
  });

  it("keeps a completed zero-result search distinct from unscanned scope", async () => {
    const report = await createChtPublicDiscoveryAdapter(
      "cht-public-sds-search-manual", profile(), deps,
    ).getCoverageReport();
    expect(report.scannedScope).toEqual({ markets: ["DE"], languages: ["en"], productLines: ["Textile auxiliaries"] });
    expect(report.documentsFound).toBe(0);
    expect(report.gaps).not.toContainEqual(expect.objectContaining({ code: "scope_unscanned" }));
  });

  it("allows only SDS on the public SDS search and declared document kinds on the product search", () => {
    expect(() => createChtPublicDiscoveryAdapter(
      "cht-public-sds-search-manual", profile("TDS"), deps,
    )).toThrow(/outside the declared CHT public surface capability/);
    expect(() => createChtPublicDiscoveryAdapter(
      "cht-public-product-document-search-manual", profile("TDS"), deps,
    )).not.toThrow();
    expect(() => createChtPublicDiscoveryAdapter(
      "cht-public-product-document-search-manual", profile("CERTIFICATE"), deps,
    )).toThrow(/outside the declared CHT public surface capability/);
  });

  it("requires an explicit user-selected product line and does not invent an API", () => {
    expect(CHT_PUBLIC_DOCUMENT_SURFACES.every(({ limitations }) =>
      limitations.some((limitation) => limitation.includes("does not") || limitation.includes("not")),
    )).toBe(true);
    expect(() => createChtPublicDiscoveryAdapter("cht-public-sds-search-manual", {
      ...profile(), scope: { markets: ["DE"], languages: ["en"], productLines: [] },
    }, deps)).toThrow(/must name the product lines/);
  });
});
