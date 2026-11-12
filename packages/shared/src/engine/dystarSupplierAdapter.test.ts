import { describe, expect, it, vi } from "vitest";
import { connectorConnectionSchema } from "../schemas/connector";
import {
  DYSTAR_DOCUMENT_SURFACES,
  DYSTAR_SUPPLIER_PROFILE,
  createDystarSupplierAdapter,
  type DystarEliotAuthorization,
} from "./dystarSupplierAdapter";
import type { SupplierManualAdapterProfile } from "./supplierManualAdapter";

const timestamp = "2026-10-26T09:00:00.000Z";
const selection = {
  selectionId: "dystar-selected-tds-001",
  originalFilename: "dystar-tds-us-en.pdf",
  sourceFileSha256: "a".repeat(64),
  selectedAt: timestamp,
  selectedBy: "chemist-1",
};

function profile(documentType?: "SDS" | "TDS" | "CERTIFICATE" | "OTHER"):
Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface"> {
  return {
    catalogSources: [],
    documents: documentType ? [{
      selection,
      sourceProductId: "dystar-product-001",
      documentType,
      market: "US",
      language: "en",
      sourceRevision: "Revision 3",
    }] : [],
    scope: { markets: ["US"], languages: ["en"], productLines: ["Textile dyes and auxiliaries"] },
    surfaceChecks: [{
      market: "US", language: "en", productLine: "Textile dyes and auxiliaries", outcome: "no_results",
      documentsFound: 0, checkedAt: timestamp, checkedBy: "chemist-1",
    }],
  };
}

function authorization(lifecycleState: "authenticated" | "configured" = "authenticated"): DystarEliotAuthorization {
  return {
    connection: connectorConnectionSchema.parse({
      schemaVersion: "1.0", code: "dystar-eliot", name: "DyStar eliot", connectorType: "REST_API",
      sourceSystemId: "SUPPLIER_DYSTAR", connectionRef: `formulab-credential:v1:${"f".repeat(32)}`,
      baseUrl: "https://eliot.dystar.com/", status: "ready", lifecycleState,
      createdAt: timestamp, updatedAt: timestamp, createdBy: "chemist-1",
    }),
    confirmation: { userConfirmedAuthentication: true, authenticatedAt: timestamp },
    authorizedScope: { markets: ["US"], languages: ["en"], productLines: ["Textile dyes and auxiliaries"] },
    writtenCommercialLocalUsePermission: true,
    authorizationConfirmedBy: "chemist-1",
    authorizationConfirmedAt: timestamp,
  };
}

describe("DyStar public, eliot and supplier-delivered profiles — V01-02.018", () => {
  it("separates public product pages, registered eliot and supplier-delivered documents", () => {
    expect(DYSTAR_SUPPLIER_PROFILE).toMatchObject({ supplierId: "dystar", providerId: "dystar" });
    expect(DYSTAR_DOCUMENT_SURFACES.map(({ surfaceId }) => surfaceId)).toEqual([
      "dystar-public-product-pages-manual",
      "dystar-eliot-registered-manual",
      "dystar-supplier-delivered-documents-manual",
    ]);
    expect(DYSTAR_DOCUMENT_SURFACES[1].documentTypes).toEqual(["TDS", "OTHER"]);
    expect(DYSTAR_DOCUMENT_SURFACES[2].documentTypes).toContain("SDS");
  });

  it("requires registered account, named scope and written local-commercial-use permission for eliot", () => {
    const deps = { storeSelectedDocument: vi.fn() };
    expect(() => createDystarSupplierAdapter("dystar-eliot-registered-manual", profile("TDS"), deps))
      .toThrow(/registered, accepted user account/);
    expect(() => createDystarSupplierAdapter("dystar-eliot-registered-manual", profile("TDS"), deps, authorization("configured")))
      .toThrow(/user-attended authentication/);
    const noWrittenPermission = authorization();
    noWrittenPermission.writtenCommercialLocalUsePermission = false;
    expect(() => createDystarSupplierAdapter("dystar-eliot-registered-manual", profile("TDS"), deps, noWrittenPermission))
      .toThrow(/written DyStar permission/);
    const wrongMarket = authorization();
    wrongMarket.authorizedScope = { markets: ["DE"], languages: ["en"], productLines: ["Textile dyes and auxiliaries"] };
    expect(() => createDystarSupplierAdapter("dystar-eliot-registered-manual", profile("TDS"), deps, wrongMarket))
      .toThrow(/exceeds the user's confirmed account authorization/);
  });

  it("accepts only supported document types for each surface and preserves selected-file provenance", async () => {
    expect(() => createDystarSupplierAdapter(
      "dystar-eliot-registered-manual", profile("SDS"), { storeSelectedDocument: vi.fn() }, authorization(),
    )).toThrow(/outside the declared DyStar surface capability/);
    const storeSelectedDocument = vi.fn(async () => ({
      status: "ok" as const,
      value: {
        acquisitionCode: "supplierdoc-dystar-001", sha256: "b".repeat(64), byteSize: 1024,
        filename: selection.originalFilename, mimeType: "application/pdf" as const,
      },
    }));
    const adapter = createDystarSupplierAdapter(
      "dystar-eliot-registered-manual", profile("TDS"), { storeSelectedDocument }, authorization(),
    );
    expect((await adapter.discoverDocuments({ sourceProductId: "dystar-product-001" })).status).toBe("ok");
    expect((await adapter.downloadDocument({ sourceDocumentId: selection.selectionId })).status).toBe("ok");
    expect(storeSelectedDocument).toHaveBeenCalledWith(expect.objectContaining({
      supplierId: "dystar", providerId: "dystar", market: "US", language: "en", sourceRevision: "Revision 3",
    }));
    expect(JSON.stringify(await adapter.getCoverageReport())).not.toContain("formulab-credential");
  });
});
