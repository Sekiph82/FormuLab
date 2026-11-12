import { describe, expect, it, vi } from "vitest";
import { connectorConnectionSchema } from "../schemas/connector";
import type { SupplierSurfaceProfile } from "../schemas/supplierProvider";
import { createAuthenticatedSupplierPortalAdapter } from "./supplierPortalAdapter";

const credentialRef = `formulab-credential:v1:${"c".repeat(32)}`;
const portalSurface: SupplierSurfaceProfile = {
  surfaceId: "example-customer-portal",
  providerId: "example-provider",
  displayName: "Example customer portal",
  kind: "authenticated_portal",
  declaredHosts: ["portal.supplier.example", "docs.supplier.example"],
  capabilities: {
    catalogDiscovery: true,
    documentDiscovery: true,
    documentFetch: true,
    formulationDiscovery: false,
    pagination: { mode: "cursor" },
    authorizationMode: "authenticated_portal",
    coverage: {
      status: "partial",
      markets: ["EU"],
      languages: ["en"],
      productLines: ["Home Care"],
      documentTypes: ["SDS", "TDS"],
    },
    limitations: ["User-attended authentication is required."],
  },
};
const connection = connectorConnectionSchema.parse({
  schemaVersion: "1.0",
  code: "portal-connection",
  name: "Example portal",
  connectorType: "REST_API",
  sourceSystemId: "SUPPLIER_EXAMPLE",
  connectionRef: credentialRef,
  baseUrl: "https://portal.supplier.example/api/",
  path: "/products",
  lifecycleState: "authenticated",
  status: "ready",
  createdAt: "2026-10-26T08:50:00.000Z",
  updatedAt: "2026-10-26T08:50:00.000Z",
  createdBy: "chemist-1",
});
const profile = {
  supplierId: "supplier-example",
  providerId: "example-provider",
  surface: portalSurface,
  connection,
  endpoints: { catalogPath: "/api/products", documentPath: "/api/documents" },
  fields: {
    product: { id: "id", itemCode: "code", tradeName: "name" },
    document: { id: "id", productId: "productId", type: "type", sourceUrl: "url" },
  },
  scope: { markets: ["EU"], languages: ["en"], productLines: ["Home Care"] },
};

function deps() {
  return {
    fetchPage: vi.fn(async () => ({ bodyText: "[]" })),
    fetchAndStoreDocument: vi.fn(async () => ({
      status: "unavailable" as const,
      failure: { code: "surface_unavailable" as const, retryable: false },
    })),
  };
}

describe("authenticated supplier portal adapter — V01-02.004", () => {
  it("requires user-attended authentication and keeps only the OS session reference", async () => {
    const nativeDeps = deps();
    const adapter = createAuthenticatedSupplierPortalAdapter(
      profile,
      { userConfirmedAuthentication: true, authenticatedAt: "2026-10-26T08:51:00.000Z" },
      { extractionRunId: "portal-job-1", extractedAt: "2026-10-26T08:52:00.000Z" },
      nativeDeps,
    );
    const result = await adapter.searchCatalog({ query: "product" });
    expect(result.status).toBe("ok");
    expect(nativeDeps.fetchPage).toHaveBeenCalledOnce();
    expect(JSON.stringify(profile)).not.toMatch(/password|cookie|session-token/i);
  });

  it("rejects unconfirmed, unauthenticated, raw-secret, or misdeclared portal sessions", () => {
    const args = [
      { userConfirmedAuthentication: false, authenticatedAt: "2026-10-26T08:51:00.000Z" },
      { userConfirmedAuthentication: true, authenticatedAt: "not-a-date" },
    ] as const;
    for (const confirmation of args) {
      expect(() => createAuthenticatedSupplierPortalAdapter(
        profile,
        confirmation as never,
        { extractionRunId: "portal-job-1", extractedAt: "2026-10-26T08:52:00.000Z" },
        deps(),
      )).toThrow(/confirmed by the user/);
    }
    expect(() => createAuthenticatedSupplierPortalAdapter(
      { ...profile, connection: { ...connection, lifecycleState: "expired" } },
      { userConfirmedAuthentication: true, authenticatedAt: "2026-10-26T08:51:00.000Z" },
      { extractionRunId: "portal-job-1", extractedAt: "2026-10-26T08:52:00.000Z" },
      deps(),
    )).toThrow(/explicitly authenticated/);
    expect(() => createAuthenticatedSupplierPortalAdapter(
      { ...profile, connection: { ...connection, connectionRef: "raw-session-token" } },
      { userConfirmedAuthentication: true, authenticatedAt: "2026-10-26T08:51:00.000Z" },
      { extractionRunId: "portal-job-1", extractedAt: "2026-10-26T08:52:00.000Z" },
      deps(),
    )).toThrow(/opaque reference|OS credential/);
    expect(() => createAuthenticatedSupplierPortalAdapter(
      { ...profile, surface: { ...portalSurface, kind: "public_search" } },
      { userConfirmedAuthentication: true, authenticatedAt: "2026-10-26T08:51:00.000Z" },
      { extractionRunId: "portal-job-1", extractedAt: "2026-10-26T08:52:00.000Z" },
      deps(),
    )).toThrow(/authenticated portal surface/);
  });

  it("does not implement browser automation or a CAPTCHA/MFA bypass interface", () => {
    const nativeDeps = deps();
    const adapter = createAuthenticatedSupplierPortalAdapter(
      profile,
      { userConfirmedAuthentication: true, authenticatedAt: "2026-10-26T08:51:00.000Z" },
      { extractionRunId: "portal-job-1", extractedAt: "2026-10-26T08:52:00.000Z" },
      nativeDeps,
    );
    expect(Object.keys(adapter).sort()).toEqual(["discoverDocuments", "downloadDocument", "getCoverageReport", "searchCatalog"]);
  });
});
