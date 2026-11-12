import { describe, expect, it, vi } from "vitest";
import { connectorConnectionSchema } from "../schemas/connector";
import { createMyChtAdapter, MY_CHT_SURFACE, type MyChtPortalAuthorization } from "./myChtAdapter";
import type { SupplierManualAdapterProfile } from "./supplierManualAdapter";

const timestamp = "2026-10-26T09:00:00.000Z";
const selection = {
  selectionId: "cht-authorized-sds-001",
  originalFilename: "cht-sds-eu-en.pdf",
  sourceFileSha256: "a".repeat(64),
  selectedAt: timestamp,
  selectedBy: "chemist-1",
};

function profile(documentType: "SDS" | "TDS" | "CERTIFICATE" = "SDS"):
Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface"> {
  return {
    catalogSources: [],
    documents: [{
      selection,
      sourceProductId: "cht-product-001",
      documentType,
      market: "DE",
      language: "en",
      sourceRevision: "Revision 7",
      revisionDate: "2026-10-01",
    }],
    scope: { markets: ["DE"], languages: ["en"], productLines: ["Textile auxiliaries"] },
  };
}

function authorization(lifecycleState: "authenticated" | "configured" = "authenticated"): MyChtPortalAuthorization {
  return {
    connection: connectorConnectionSchema.parse({
      schemaVersion: "1.0",
      code: "cht-customer-portal",
      name: "myCHT",
      connectorType: "REST_API",
      sourceSystemId: "SUPPLIER_CHT",
      connectionRef: `formulab-credential:v1:${"f".repeat(32)}`,
      baseUrl: "https://solutions.cht.com/",
      status: "ready",
      lifecycleState,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: "chemist-1",
    }),
    confirmation: { userConfirmedAuthentication: true, authenticatedAt: timestamp },
    authorizedScope: { markets: ["DE"], languages: ["en"], productLines: ["Textile auxiliaries"] },
    authorizationConfirmedBy: "chemist-1",
    authorizationConfirmedAt: timestamp,
  };
}

describe("myCHT authorized user-attended profile — V01-02.014", () => {
  it("declares an authenticated portal surface separate from CHT public searches", () => {
    expect(MY_CHT_SURFACE.surfaceId).toBe("cht-mycht-manual");
    expect(MY_CHT_SURFACE.entryPointUrl).toContain("pa_my-cht_dashboard_en.html");
  });

  it("requires CHT authorization, user-attended authentication and in-scope access", () => {
    const deps = { storeSelectedDocument: vi.fn() };
    expect(() => createMyChtAdapter(profile(), undefined, deps)).toThrow(/CHT-authorized user account/);
    expect(() => createMyChtAdapter(profile(), authorization("configured"), deps)).toThrow(/user-attended authentication/);
    const outsideScope = authorization();
    outsideScope.authorizedScope = { markets: ["US"], languages: ["en"], productLines: ["Textile auxiliaries"] };
    expect(() => createMyChtAdapter(profile(), outsideScope, deps)).toThrow(/exceeds the user-confirmed CHT authorization/);
    const noNamedApprover = authorization();
    noNamedApprover.authorizationConfirmedBy = " ";
    expect(() => createMyChtAdapter(profile(), noNamedApprover, deps)).toThrow(/confirmed by a named user/);
  });

  it("imports selected files through existing provenance without exposing credential references", async () => {
    const storeSelectedDocument = vi.fn(async () => ({
      status: "ok" as const,
      value: {
        acquisitionCode: "supplierdoc-mycht-001",
        sha256: "b".repeat(64),
        byteSize: 1024,
        filename: selection.originalFilename,
        mimeType: "application/pdf" as const,
      },
    }));
    const adapter = createMyChtAdapter(profile("TDS"), authorization(), { storeSelectedDocument });
    const found = await adapter.discoverDocuments({ sourceProductId: "cht-product-001" });
    expect(found.status).toBe("ok");
    if (found.status !== "ok") return;
    expect(found.value[0]).toMatchObject({ sourceProductId: "cht-product-001", documentType: "TDS", sourceRevision: "Revision 7" });
    const downloaded = await adapter.downloadDocument({ sourceDocumentId: selection.selectionId });
    expect(downloaded.status).toBe("ok");
    expect(storeSelectedDocument).toHaveBeenCalledWith(expect.objectContaining({
      supplierId: "cht", providerId: "cht", market: "DE", language: "en", sourceRevision: "Revision 7",
    }));
    const report = await adapter.getCoverageReport();
    expect(report.requestedScope).toEqual({ markets: ["DE"], languages: ["en"], productLines: ["Textile auxiliaries"] });
    expect(JSON.stringify(report)).not.toContain("formulab-credential");
  });

  it("rejects document types not claimed for myCHT", () => {
    expect(() => createMyChtAdapter(profile("CERTIFICATE"), authorization(), { storeSelectedDocument: vi.fn() }))
      .toThrow(/only the declared SDS, TDS and other/);
  });
});
