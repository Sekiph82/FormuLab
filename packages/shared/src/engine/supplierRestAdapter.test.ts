import { describe, expect, it, vi } from "vitest";
import type { SupplierSurfaceProfile } from "../schemas/supplierProvider";
import { HttpStatusError } from "./restApiConnector";
import { createSupplierRestAdapter, type SupplierRestAdapterProfile } from "./supplierRestAdapter";

const surface: SupplierSurfaceProfile = {
  surfaceId: "example-public-api",
  providerId: "example-provider",
  displayName: "Example public API",
  kind: "rest_api",
  declaredHosts: ["api.supplier.example", "docs.supplier.example"],
  capabilities: {
    catalogDiscovery: true,
    documentDiscovery: true,
    documentFetch: true,
    formulationDiscovery: false,
    pagination: { mode: "cursor" },
    authorizationMode: "public",
    coverage: {
      status: "partial",
      markets: ["EU"],
      languages: ["en"],
      productLines: ["Home Care"],
      documentTypes: ["SDS", "TDS"],
    },
    limitations: ["Supplier-disclosed scope only."],
  },
};

const profile: SupplierRestAdapterProfile = {
  supplierId: "supplier-example",
  providerId: "example-provider",
  surface,
  connectionRef: "formulab-connection:example",
  baseUrl: "https://api.supplier.example/v1/",
  catalogPath: "/v1/products",
  documentPath: "/v1/documents",
  fields: {
    product: { id: "id", itemCode: "code", tradeName: "name", grade: "grade" },
    document: { id: "id", productId: "productId", type: "type", sourceUrl: "url" },
  },
  scope: { markets: ["EU"], languages: ["en"], productLines: ["Home Care"] },
};

const stageOptions = {
  extractionRunId: "supplier-job-001",
  extractedAt: "2026-10-26T08:45:00.000Z",
};

function makeDeps() {
  const fetchAndStoreDocument = vi.fn(async (_input: { sourceUrl: string }) => ({
    status: "ok" as const,
    value: {
      acquisitionCode: "supplierdoc-001",
      sha256: "b".repeat(64),
      byteSize: 128,
      filename: "sds-001.pdf",
      mimeType: "application/pdf" as const,
    },
  }));
  const fetchPage = vi.fn(async (spec: { path: string; cursor?: string }) => {
    if (spec.path === profile.catalogPath) {
      return spec.cursor
        ? { bodyText: JSON.stringify([{ id: "P-2", code: "BETA", name: "Beta surfactant", grade: "38" }]) }
        : { bodyText: JSON.stringify([{ id: "P-1", code: "ALPHA", name: "Alpha surfactant", grade: "30" }]), nextCursor: "page-two" };
    }
    if (spec.path === profile.documentPath) {
      return {
        bodyText: JSON.stringify([
          { id: "D-1", productId: "P-1", type: "MSDS", url: "https://docs.supplier.example/sds/1?token=transient-secret" },
          { id: "D-2", productId: "P-1", type: "TDS", url: "https://docs.supplier.example/tds/1" },
          { id: "D-3", productId: "P-2", type: "SDS", url: "https://docs.supplier.example/sds/2" },
        ]),
      };
    }
    throw new Error("unexpected endpoint");
  });
  return {
    fetchPage,
    fetchAndStoreDocument,
  };
}

describe("public/API supplier adapter over the existing REST connector — V01-02.003", () => {
  it("reuses REST pagination and response staging, then normalizes supplier product identities", async () => {
    const deps = makeDeps();
    const adapter = createSupplierRestAdapter(profile, stageOptions, deps);
    const result = await adapter.searchCatalog({ query: "beta" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value.products).toEqual([{
        sourceProductId: "P-2",
        supplierItemCode: "BETA",
        tradeName: "Beta surfactant",
        grade: "38",
      }]);
      expect(result.value.pagesChecked).toBe(2);
    }
    expect(deps.fetchPage).toHaveBeenCalledTimes(2);
    expect(deps.fetchPage.mock.calls[1]?.[0].cursor).toBe("page-two");
  });

  it("normalizes SDS/TDS source links and sends the ephemeral source only to native storage", async () => {
    const deps = makeDeps();
    const adapter = createSupplierRestAdapter(profile, stageOptions, deps);
    const result = await adapter.discoverDocuments({ sourceProductId: "P-1" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.value.map(({ documentType }) => documentType)).toEqual(["SDS", "TDS"]);
    expect(result.value[0]?.sourceUrl).toBe("https://docs.supplier.example/sds/1?token=%5Bredacted%5D");

    const downloaded = await adapter.downloadDocument({ sourceDocumentId: "D-1" });
    expect(downloaded.status).toBe("ok");
    expect(deps.fetchAndStoreDocument).toHaveBeenCalledWith({
      sourceUrl: "https://docs.supplier.example/sds/1?token=transient-secret",
      declaredHosts: surface.declaredHosts,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("transient-secret");
    if (downloaded.status === "ok") expect("bytes" in downloaded.value).toBe(false);
  });

  it("maps REST rate limits to retryable bounded adapter failures and reports scan coverage", async () => {
    const deps = makeDeps();
    deps.fetchPage.mockRejectedValueOnce(new HttpStatusError(429, "private response detail"));
    const adapter = createSupplierRestAdapter(profile, stageOptions, deps);
    const result = await adapter.searchCatalog({ query: "alpha" });
    expect(result).toEqual({ status: "unavailable", failure: { code: "rate_limited", retryable: true } });
    const report = await adapter.getCoverageReport();
    expect(report.completion).toBe("partial");
    expect(report.inaccessibleSurfaces).toEqual([{ surfaceId: surface.surfaceId, reason: "rate_limited" }]);
    expect(JSON.stringify(report)).not.toContain("private response detail");
  });

  it("rejects undeclared or unsafe API and document hosts before they are fetched", async () => {
    const deps = makeDeps();
    expect(() => createSupplierRestAdapter({ ...profile, baseUrl: "https://unlisted.example/v1" }, stageOptions, deps))
      .toThrow(/declared HTTPS host/);
    const adapter = createSupplierRestAdapter(profile, stageOptions, deps);
    deps.fetchPage.mockImplementationOnce(async () => ({
      bodyText: JSON.stringify([{ id: "D-9", productId: "P-1", type: "SDS", url: "https://unlisted.example/sds/9" }]),
    }));
    const result = await adapter.discoverDocuments({ sourceProductId: "P-1" });
    expect(result.status).toBe("partial");
    if (result.status === "partial") expect(result.value).toEqual([]);
    expect(deps.fetchAndStoreDocument).not.toHaveBeenCalled();
  });
});
