import { describe, expect, it } from "vitest";
import {
  createDeterministicSupplierAdapterFixture,
  runSupplierAdapterConformance,
} from "./supplierAdapterConformance";

describe("supplier adapter conformance fixtures — V01-02.001", () => {
  it("passes every reusable conformance check against the deterministic fixture", async () => {
    const checks = await runSupplierAdapterConformance(createDeterministicSupplierAdapterFixture);
    expect(checks.length).toBeGreaterThanOrEqual(10);
    expect(checks.every(({ passed }) => passed)).toBe(true);
  });

  it("searches deterministically across connector-managed pages without exposing raw cursors", async () => {
    const adapter = createDeterministicSupplierAdapterFixture();
    const first = await adapter.searchCatalog({ query: "fixture" });
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;
    expect(first.value.products[0]?.sourceProductId).toBe("fixture-product-001");
    expect(first.value.products[1]?.sourceProductId).toBe("fixture-product-002");
    expect(first.value.pagesChecked).toBe(2);
    expect("nextPageToken" in first.value).toBe(false);
    expect(await adapter.searchCatalog({ query: "fixture" })).toEqual(first);
  });

  it("represents a partial scan without claiming the inaccessible scope was empty", async () => {
    const adapter = createDeterministicSupplierAdapterFixture("partial_scope");
    const result = await adapter.searchCatalog({ query: "fixture" });
    expect(result.status).toBe("partial");
    if (result.status === "partial") {
      expect(result.value.products).toHaveLength(1);
      expect(result.gaps).toContain("Second market requires user-attended access.");
    }
    const coverage = await adapter.getCoverageReport();
    expect(coverage.completion).toBe("partial");
    expect(coverage.requestedScope.markets).toContain("NA");
    expect(coverage.scannedScope.markets).not.toContain("NA");
    expect(coverage.gaps.some(({ scopeValue }) => scopeValue === "NA")).toBe(true);
  });

  it("normalizes rate limits, honors retry metadata, and allows a bounded retry", async () => {
    const adapter = createDeterministicSupplierAdapterFixture("rate_limited_once");
    const input = { query: "fixture" };
    const limited = await adapter.searchCatalog(input);
    expect(limited).toEqual({ status: "unavailable", failure: { code: "rate_limited", retryable: true, retryAfterMs: 250 } });
    expect(await adapter.searchCatalog(input)).toMatchObject({ status: "ok" });
  });

  it.each([
    ["timeout", "timeout", true],
    ["authorization_required", "authorization_required", false],
    ["surface_unavailable", "surface_unavailable", true],
  ] as const)("reports %s as a bounded failure", async (scenario, code, retryable) => {
    const adapter = createDeterministicSupplierAdapterFixture(scenario);
    const result = await adapter.searchCatalog({ query: "fixture" });
    expect(result).toEqual({ status: "unavailable", failure: { code, retryable } });
  });

  it("discovers typed supplier documents and receives a metadata-only download receipt", async () => {
    const adapter = createDeterministicSupplierAdapterFixture();
    const found = await adapter.discoverDocuments({ sourceProductId: "fixture-product-001" });
    expect(found.status).toBe("ok");
    if (found.status !== "ok") return;
    expect(found.value.map(({ documentType }) => documentType)).toEqual(["SDS", "TDS"]);
    const downloaded = await adapter.downloadDocument({ sourceDocumentId: "fixture-sds-001" });
    expect(downloaded.status).toBe("ok");
    if (downloaded.status === "ok") {
      expect(downloaded.value.mimeType).toBe("application/pdf");
      expect(downloaded.value.acquisitionCode).toBe("supplierdoc-fixture-sds-001");
      expect(downloaded.value.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect("bytes" in downloaded.value).toBe(false);
    }
    expect((await adapter.downloadDocument({ sourceDocumentId: "missing" })).status).toBe("unavailable");
  });

  it("cancels in-flight fixture operations through AbortSignal", async () => {
    const adapter = createDeterministicSupplierAdapterFixture();
    const controller = new AbortController();
    controller.abort();
    expect(await adapter.searchCatalog({ query: "fixture" }, controller.signal)).toEqual({
      status: "unavailable",
      failure: { code: "cancelled", retryable: false },
    });
    expect(await adapter.discoverDocuments({ sourceProductId: "fixture-product-001" }, controller.signal))
      .toMatchObject({ status: "unavailable", failure: { code: "cancelled" } });
    expect(await adapter.downloadDocument({ sourceDocumentId: "fixture-sds-001" }, controller.signal))
      .toMatchObject({ status: "unavailable", failure: { code: "cancelled" } });
  });

  it("keeps fixture failures free of raw credentials and server response details", async () => {
    const result = await createDeterministicSupplierAdapterFixture("authorization_required")
      .searchCatalog({ query: "fixture" });
    expect(JSON.stringify(result)).not.toMatch(/password|token|cookie|private|do-not-store/i);
  });
});
