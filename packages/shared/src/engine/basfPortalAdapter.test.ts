import { describe, expect, it, vi } from "vitest";
import { connectorConnectionSchema } from "../schemas/connector";
import { BASF_PORTAL_SURFACES, createBasfPortalAdapter, type BasfPortalAuthorization } from "./basfPortalAdapter";
import type { SupplierManualAdapterProfile } from "./supplierManualAdapter";

const timestamp = "2026-10-26T09:00:00.000Z";
const selection = {
  selectionId: "basf-authorized-sds-001",
  originalFilename: "basf-sds-eu-en.pdf",
  sourceFileSha256: "a".repeat(64),
  selectedAt: timestamp,
  selectedBy: "chemist-1",
};

function profile(): Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface"> {
  return {
    catalogSources: [],
    documents: [{
      selection,
      sourceProductId: "basf-product-001",
      documentType: "SDS",
      market: "US",
      language: "en",
      sourceRevision: "Revision 3",
      revisionDate: "2026-09-01",
    }],
    scope: { markets: ["US"], languages: ["en"], productLines: ["Performance Polymers"] },
  };
}

function authorization(lifecycleState: "authenticated" | "configured" = "authenticated"): BasfPortalAuthorization {
  return {
    connection: connectorConnectionSchema.parse({
      schemaVersion: "1.0",
      code: "basf-customer-portal",
      name: "myBASFWorld",
      connectorType: "REST_API",
      sourceSystemId: "SUPPLIER_BASF",
      connectionRef: `formulab-credential:v1:${"f".repeat(32)}`,
      baseUrl: "https://my.basf.com/",
      status: "ready",
      lifecycleState,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: "chemist-1",
    }),
    confirmation: { userConfirmedAuthentication: true, authenticatedAt: timestamp },
    authorizedScope: { markets: ["US"], languages: ["en"], productLines: ["Performance Polymers"] },
    localDocumentUseConfirmed: true,
    authorizationConfirmedBy: "chemist-1",
    authorizationConfirmedAt: timestamp,
  };
}

describe("BASF customer portal profiles — V01-02.016", () => {
  it("keeps myBASFWorld, MyIndustryWorld and restricted Electronic Materials surfaces separate", () => {
    expect(BASF_PORTAL_SURFACES.map(({ surfaceId }) => surfaceId)).toEqual([
      "basf-mybasfworld-manual",
      "basf-myindustryworld-dispersions-emea-manual",
      "basf-myindustryworld-construction-additives-global-manual",
      "basf-electronic-materials-catamold-manual",
    ]);
    expect(BASF_PORTAL_SURFACES[3].documentTypes).toEqual(["SDS", "TDS"]);
  });

  it("requires authenticated supplier authorization, named local-use confirmation and in-scope access", () => {
    const deps = { storeSelectedDocument: vi.fn() };
    expect(() => createBasfPortalAdapter(BASF_PORTAL_SURFACES[0].surfaceId, profile(), undefined, deps))
      .toThrow(/authorized customer\/partner account/);
    expect(() => createBasfPortalAdapter(BASF_PORTAL_SURFACES[0].surfaceId, profile(), authorization("configured"), deps))
      .toThrow(/user-attended authentication/);
    const noLocalRights = authorization();
    noLocalRights.localDocumentUseConfirmed = false as never;
    expect(() => createBasfPortalAdapter(BASF_PORTAL_SURFACES[0].surfaceId, profile(), noLocalRights, deps))
      .toThrow(/permission for local use/);
    const outsideScope = authorization();
    outsideScope.authorizedScope = { markets: ["DE"], languages: ["en"], productLines: ["Performance Polymers"] };
    expect(() => createBasfPortalAdapter(BASF_PORTAL_SURFACES[0].surfaceId, profile(), outsideScope, deps))
      .toThrow(/exceeds the user-confirmed account authorization/);
  });

  it("imports only selected authorized files and omits secure credential references from provenance", async () => {
    const storeSelectedDocument = vi.fn(async () => ({
      status: "ok" as const,
      value: {
        acquisitionCode: "supplierdoc-basf-portal-001",
        sha256: "b".repeat(64),
        byteSize: 1500,
        filename: selection.originalFilename,
        mimeType: "application/pdf" as const,
      },
    }));
    const adapter = createBasfPortalAdapter(BASF_PORTAL_SURFACES[0].surfaceId, profile(), authorization(), { storeSelectedDocument });
    const found = await adapter.discoverDocuments({ sourceProductId: "basf-product-001" });
    expect(found.status).toBe("ok");
    if (found.status !== "ok") return;
    expect(found.value[0]).toMatchObject({ documentType: "SDS", sourceRevision: "Revision 3" });
    expect((await adapter.downloadDocument({ sourceDocumentId: selection.selectionId })).status).toBe("ok");
    expect(storeSelectedDocument).toHaveBeenCalledWith(expect.objectContaining({ supplierId: "basf", market: "US", language: "en" }));
    expect(JSON.stringify(await adapter.getCoverageReport())).not.toContain("formulab-credential");
  });

  it("rejects document kinds outside each sector-specific surface", () => {
    const certProfile = { ...profile(), documents: [{ ...profile().documents[0], documentType: "CERTIFICATE" as const }] };
    expect(() => createBasfPortalAdapter(BASF_PORTAL_SURFACES[3].surfaceId, certProfile, authorization(), { storeSelectedDocument: vi.fn() }))
      .toThrow(/outside the declared BASF portal capability/);
  });
});
