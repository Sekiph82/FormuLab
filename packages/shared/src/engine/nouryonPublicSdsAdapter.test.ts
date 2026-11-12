import { describe, expect, it, vi } from "vitest";
import {
  createNouryonPublicSdsAdapter,
  NOURYON_PUBLIC_SDS_PRODUCT_LINES,
  NOURYON_PUBLIC_SDS_SURFACE,
  NOURYON_SUPPLIER_PROFILE,
} from "./nouryonPublicSdsAdapter";
import type { SupplierManualAdapterProfile } from "./supplierManualAdapter";

const timestamp = "2026-10-26T09:00:00.000Z";

function profile(outcome: "no_results" | "access_required" | "unsupported_scope" | "not_scanned"):
Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface"> {
  const productLine = outcome === "unsupported_scope" ? "Surfactants" : "Organic peroxides";
  return {
    catalogSources: [],
    documents: [],
    scope: { markets: ["US"], languages: ["en"], productLines: [productLine] },
    surfaceChecks: [{
      market: "US",
      language: "en",
      productLine,
      outcome,
      documentsFound: 0,
      checkedAt: timestamp,
      checkedBy: "chemist-1",
    }],
  };
}

const deps = { storeSelectedDocument: vi.fn() };

describe("Nouryon public SDS search with explicit coverage status — V01-02.011", () => {
  it("declares only Nouryon's published public SDS product families", () => {
    expect(NOURYON_SUPPLIER_PROFILE).toMatchObject({ supplierId: "nouryon", providerId: "nouryon" });
    expect(NOURYON_PUBLIC_SDS_SURFACE.entryPointUrl).toBe("https://www.nouryon.com/sds-search");
    expect(NOURYON_PUBLIC_SDS_PRODUCT_LINES).toEqual([
      "Organic peroxides", "Metal alkyls", "Polymer additives", "PVC reactor additives", "Bermocoll",
    ]);
  });

  it("records a completed zero-result SDS search as scanned scope with a zero document count", async () => {
    const adapter = createNouryonPublicSdsAdapter(profile("no_results"), deps);
    const report = await adapter.getCoverageReport();
    expect(report.scannedScope).toEqual({ markets: ["US"], languages: ["en"], productLines: ["Organic peroxides"] });
    expect(report.documentsFound).toBe(0);
    expect(report.gaps).not.toContainEqual(expect.objectContaining({ code: "scope_unscanned", scopeValue: "Organic peroxides" }));
    expect(report.inaccessibleSurfaces).toEqual([]);
  });

  it("distinguishes an unscanned supported product family from a completed zero-result search", async () => {
    const report = await createNouryonPublicSdsAdapter(profile("not_scanned"), deps).getCoverageReport();
    expect(report.scannedScope).toEqual({ markets: [], languages: [], productLines: [] });
    expect(report.gaps).toContainEqual(expect.objectContaining({ code: "scope_unscanned", scopeValue: "Organic peroxides" }));
  });

  it("records inaccessible and public-search-unsupported scope without treating either as no result", async () => {
    const inaccessible = await createNouryonPublicSdsAdapter(profile("access_required"), deps).getCoverageReport();
    expect(inaccessible.inaccessibleSurfaces).toEqual([{
      surfaceId: "nouryon-public-sds-search-manual",
      reason: "authorization_required",
    }]);
    expect(inaccessible.documentsFound).toBe(0);

    const unsupported = await createNouryonPublicSdsAdapter(profile("unsupported_scope"), deps).getCoverageReport();
    expect(unsupported.gaps).toContainEqual(expect.objectContaining({
      code: "capability_unsupported",
      dimension: "product_line",
      scopeValue: "Surfactants",
    }));
    expect(unsupported.scannedScope.productLines).toEqual([]);
  });

  it("rejects non-SDS files and unsupported product families without explicit gap evidence", () => {
    const publicProfile = profile("no_results");
    expect(() => createNouryonPublicSdsAdapter({
      ...publicProfile,
      documents: [{
        selection: {
          selectionId: "nouryon-tds-1",
          originalFilename: "nouryon-tds.pdf",
          sourceFileSha256: "a".repeat(64),
          selectedAt: timestamp,
          selectedBy: "chemist-1",
        },
        sourceProductId: "product-1",
        documentType: "TDS",
        market: "US",
        language: "en",
      }],
    }, deps)).toThrow(/SDS documents only/);
    expect(() => createNouryonPublicSdsAdapter({
      ...publicProfile,
      scope: { markets: ["US"], languages: ["en"], productLines: ["Surfactants"] },
      surfaceChecks: [],
    }, deps)).toThrow(/explicit unsupported-scope check/);
  });
});
