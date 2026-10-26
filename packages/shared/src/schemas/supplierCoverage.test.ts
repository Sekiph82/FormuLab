import { describe, expect, it } from "vitest";
import { supplierCoverageReportSchema, type SupplierCoverageReport } from "./supplierCoverage";

const base: SupplierCoverageReport = {
  schemaVersion: "1.0",
  supplierId: "supplier-example",
  providerId: "example-adapter",
  surfaceId: "public-documents",
  acquisitionJobId: "acq-job-1",
  completion: "complete",
  requestedScope: { markets: ["EU"], languages: ["en"], productLines: ["Home Care"] },
  scannedScope: { markets: ["EU"], languages: ["en"], productLines: ["Home Care"] },
  pagesChecked: 4,
  productsChecked: 30,
  documentsFound: 12,
  documentsAcquired: 10,
  inaccessibleSurfaces: [],
  unsupportedCapabilities: [],
  gaps: [],
  generatedAt: "2026-10-26T08:30:00.000Z",
};

describe("supplier coverage reporting contract — V01-02.002", () => {
  it("records requested and actually scanned market/language/product-line scope separately", () => {
    const partial = supplierCoverageReportSchema.parse({
      ...base,
      completion: "partial",
      scannedScope: { markets: ["EU"], languages: ["en"], productLines: [] },
      inaccessibleSurfaces: [{ surfaceId: "customer-portal", reason: "authorization_required" }],
      gaps: [{ code: "scope_unscanned", dimension: "product_line", scopeValue: "Industrial" }],
    });
    expect(partial.requestedScope.productLines).toContain("Home Care");
    expect(partial.scannedScope.productLines).toEqual([]);
    expect(partial.inaccessibleSurfaces[0]?.reason).toBe("authorization_required");
  });

  it("keeps a completed zero-result scan distinct from an unscanned or inaccessible scope", () => {
    const noResults = supplierCoverageReportSchema.parse({
      ...base,
      pagesChecked: 1,
      productsChecked: 0,
      documentsFound: 0,
      documentsAcquired: 0,
    });
    expect(noResults.completion).toBe("complete");
    expect(noResults.scannedScope.markets).toEqual(["EU"]);
    expect(noResults.inaccessibleSurfaces).toEqual([]);

    const notStarted = supplierCoverageReportSchema.parse({
      ...base,
      completion: "not_started",
      scannedScope: { markets: [], languages: [], productLines: [] },
      pagesChecked: 0,
      productsChecked: 0,
      documentsFound: 0,
      documentsAcquired: 0,
    });
    expect(notStarted.completion).toBe("not_started");
  });

  it("reports document counts, inaccessible surfaces, unsupported capabilities and bounded gaps", () => {
    const report = supplierCoverageReportSchema.parse({
      ...base,
      completion: "partial",
      inaccessibleSurfaces: [{ surfaceId: "my-portal", reason: "manual_assistance_required" }],
      unsupportedCapabilities: ["formulation_discovery", "pagination"],
      gaps: [
        { code: "authorization_required", dimension: "surface", scopeValue: "my-portal" },
        { code: "capability_unsupported", dimension: "capability", scopeValue: "formulation_discovery" },
        { code: "item_failures" },
      ],
    });
    expect(report.documentsFound).toBe(12);
    expect(report.documentsAcquired).toBe(10);
    expect(report.unsupportedCapabilities).toContain("formulation_discovery");
    expect(report.gaps).toHaveLength(3);
  });

  it("rejects impossible counts, duplicate scope values, invalid gaps and secret-bearing fields", () => {
    expect(() => supplierCoverageReportSchema.parse({ ...base, documentsAcquired: 13 })).toThrow(/cannot exceed/);
    expect(() => supplierCoverageReportSchema.parse({ ...base, gaps: [{ code: "scope_unscanned" }] }))
      .toThrow(/complete report cannot contain coverage gaps/);
    expect(() => supplierCoverageReportSchema.parse({ ...base, completion: "partial" }))
      .toThrow(/partial report must identify/);
    expect(() => supplierCoverageReportSchema.parse({
      ...base,
      scannedScope: { ...base.scannedScope, markets: ["EU", "eu"] },
    })).toThrow(/unique/);
    expect(() => supplierCoverageReportSchema.parse({ ...base, gaps: [{ code: "no_results" }] })).toThrow();
    expect(() => supplierCoverageReportSchema.parse({ ...base, apiKey: "do-not-store" })).toThrow();
    expect(() => supplierCoverageReportSchema.parse({
      ...base,
      completion: "not_started",
      pagesChecked: 1,
    })).toThrow(/not-started report/);
  });
});
