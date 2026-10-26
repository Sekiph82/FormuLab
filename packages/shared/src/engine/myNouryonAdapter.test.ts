import { describe, expect, it, vi } from "vitest";
import { connectorConnectionSchema } from "../schemas/connector";
import { createMyNouryonAdapter, MY_NOURYON_SURFACE, type MyNouryonPortalAuthorization } from "./myNouryonAdapter";
import type { SupplierManualAdapterProfile } from "./supplierManualAdapter";

const timestamp = "2026-10-26T09:00:00.000Z";
const selection = {
  selectionId: "nouryon-authorized-sds-001",
  originalFilename: "nouryon-sds-eu-en.pdf",
  sourceFileSha256: "a".repeat(64),
  selectedAt: timestamp,
  selectedBy: "chemist-1",
};

function profile(): Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface"> {
  return {
    catalogSources: [],
    documents: [{
      selection,
      sourceProductId: "nouryon-product-001",
      documentType: "SDS",
      market: "EU",
      language: "en",
      sourceRevision: "Revision 7",
      revisionDate: "2026-10-01",
    }],
    scope: { markets: ["EU"], languages: ["en"], productLines: ["Organic peroxides"] },
  };
}

function authorization(lifecycleState: "authenticated" | "configured" = "authenticated"): MyNouryonPortalAuthorization {
  return {
    connection: connectorConnectionSchema.parse({
      schemaVersion: "1.0",
      code: "nouryon-customer-portal",
      name: "My Nouryon",
      connectorType: "REST_API",
      sourceSystemId: "SUPPLIER_NOURYON",
      connectionRef: `formulab-credential:v1:${"f".repeat(32)}`,
      baseUrl: "https://my.nouryon.com/",
      status: "ready",
      lifecycleState,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: "chemist-1",
    }),
    confirmation: { userConfirmedAuthentication: true, authenticatedAt: timestamp },
    authorizedScope: { markets: ["EU"], languages: ["en"], productLines: ["Organic peroxides"] },
    authorizationConfirmedBy: "chemist-1",
    authorizationConfirmedAt: timestamp,
  };
}

describe("My Nouryon supplier-authorized user-attended profile — V01-02.012", () => {
  it("keeps the customer portal distinct from the limited public SDS search", () => {
    expect(MY_NOURYON_SURFACE.entryPointUrl).toBe("https://my.nouryon.com/login/aboutmynouryon");
    expect(MY_NOURYON_SURFACE.surfaceId).toBe("nouryon-my-nouryon-manual");
  });

  it("requires existing supplier authorization, authenticated lifecycle and explicit authorized scope", () => {
    expect(() => createMyNouryonAdapter(profile(), undefined, { storeSelectedDocument: vi.fn() }))
      .toThrow(/supplier-authorized user account/);
    expect(() => createMyNouryonAdapter(profile(), authorization("configured"), { storeSelectedDocument: vi.fn() }))
      .toThrow(/user-attended authentication/);
    const outsideScope = authorization();
    outsideScope.authorizedScope = { markets: ["US"], languages: ["en"], productLines: ["Organic peroxides"] };
    expect(() => createMyNouryonAdapter(profile(), outsideScope, { storeSelectedDocument: vi.fn() }))
      .toThrow(/exceeds the user-confirmed supplier authorization/);
    const unidentified = authorization();
    unidentified.authorizationConfirmedBy = " ";
    expect(() => createMyNouryonAdapter(profile(), unidentified, { storeSelectedDocument: vi.fn() }))
      .toThrow(/confirmed by a named user/);
  });

  it("imports only user-selected portal files and preserves exact authorized market/product/revision provenance", async () => {
    const storeSelectedDocument = vi.fn(async () => ({
      status: "ok" as const,
      value: {
        acquisitionCode: "supplierdoc-mynouryon-001",
        sha256: "b".repeat(64),
        byteSize: 1024,
        filename: selection.originalFilename,
        mimeType: "application/pdf" as const,
      },
    }));
    const adapter = createMyNouryonAdapter(profile(), authorization(), { storeSelectedDocument });
    const found = await adapter.discoverDocuments({ sourceProductId: "nouryon-product-001" });
    expect(found.status).toBe("ok");
    if (found.status !== "ok") return;
    expect(found.value[0]).toMatchObject({
      sourceProductId: "nouryon-product-001",
      documentType: "SDS",
      sourceRevision: "Revision 7",
      revisionDate: "2026-10-01",
    });
    const downloaded = await adapter.downloadDocument({ sourceDocumentId: selection.selectionId });
    expect(downloaded.status).toBe("ok");
    expect(storeSelectedDocument).toHaveBeenCalledWith(expect.objectContaining({
      supplierId: "nouryon",
      providerId: "nouryon",
      sourceProductId: "nouryon-product-001",
      market: "EU",
      language: "en",
      sourceRevision: "Revision 7",
    }));
    const report = await adapter.getCoverageReport();
    expect(report.requestedScope).toEqual({ markets: ["EU"], languages: ["en"], productLines: ["Organic peroxides"] });
    expect(JSON.stringify(report)).not.toContain("formulab-credential");
  });
});
