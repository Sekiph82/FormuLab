import { describe, expect, it, vi } from "vitest";
import { connectorConnectionSchema } from "../schemas/connector";
import {
  ARCHROMA_DOCUMENT_SURFACES,
  ARCHROMA_SUPPLIER_PROFILE,
  createArchromaSupplierAdapter,
  type ArchromaPortalAuthorization,
} from "./archromaSupplierAdapter";
import type { SupplierManualAdapterProfile } from "./supplierManualAdapter";

const timestamp = "2026-10-26T09:00:00.000Z";
const selection = {
  selectionId: "archroma-selected-sds-001",
  originalFilename: "archroma-sds-us-en.pdf",
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
      sourceProductId: "archroma-product-001",
      documentType,
      market: "US",
      language: "en",
      sourceRevision: "Revision 2",
    }] : [],
    scope: { markets: ["US"], languages: ["en"], productLines: ["Textile Effects"] },
    surfaceChecks: [{
      market: "US", language: "en", productLine: "Textile Effects", outcome: "no_results",
      documentsFound: 0, checkedAt: timestamp, checkedBy: "chemist-1",
    }],
  };
}

function authorization(lifecycleState: "authenticated" | "configured" = "authenticated"): ArchromaPortalAuthorization {
  return {
    connection: connectorConnectionSchema.parse({
      schemaVersion: "1.0", code: "archroma-safe-edge", name: "The Safe Edge", connectorType: "REST_API",
      sourceSystemId: "SUPPLIER_ARCHROMA", connectionRef: `formulab-credential:v1:${"f".repeat(32)}`,
      baseUrl: "https://www.archroma.com/", status: "ready", lifecycleState,
      createdAt: timestamp, updatedAt: timestamp, createdBy: "chemist-1",
    }),
    confirmation: { userConfirmedAuthentication: true, authenticatedAt: timestamp },
    authorizedScope: { markets: ["US"], languages: ["en"], productLines: ["Textile Effects"] },
    localDocumentUseConfirmed: true,
    authorizationConfirmedBy: "chemist-1",
    authorizationConfirmedAt: timestamp,
  };
}

describe("Archroma public and authorized document surfaces — V01-02.017", () => {
  it("separates public Home Care/I&I discovery from authenticated Safe Edge", () => {
    expect(ARCHROMA_SUPPLIER_PROFILE).toMatchObject({ supplierId: "archroma", providerId: "archroma" });
    expect(ARCHROMA_DOCUMENT_SURFACES.map(({ access }) => access)).toEqual([
      "public_manual_assisted", "authenticated_manual_assisted",
    ]);
    expect(ARCHROMA_DOCUMENT_SURFACES[0].documentTypes).toEqual(["OTHER"]);
    expect(ARCHROMA_DOCUMENT_SURFACES[1].documentTypes).toEqual(["SDS", "CERTIFICATE", "OTHER"]);
  });

  it("records public product-search outcome and does not claim public SDS/TDS access", async () => {
    const adapter = createArchromaSupplierAdapter(
      "archroma-home-care-iandi-public-manual", profile(), { storeSelectedDocument: vi.fn() },
    );
    const report = await adapter.getCoverageReport();
    expect(report.scannedScope).toEqual({ markets: ["US"], languages: ["en"], productLines: ["Textile Effects"] });
    expect(ARCHROMA_DOCUMENT_SURFACES[0].limitations.join(" ")).toContain("does not claim access to SDS, TDS");
  });

  it("requires authorized Safe Edge session, local-use confirmation and exact market/language/product scope", () => {
    const deps = { storeSelectedDocument: vi.fn() };
    expect(() => createArchromaSupplierAdapter("archroma-safe-edge-manual", profile("SDS"), deps))
      .toThrow(/user-authorized customer\/partner access/);
    expect(() => createArchromaSupplierAdapter("archroma-safe-edge-manual", profile("SDS"), deps, authorization("configured")))
      .toThrow(/user-attended authentication/);
    const noLocalUse = authorization();
    noLocalUse.localDocumentUseConfirmed = false;
    expect(() => createArchromaSupplierAdapter("archroma-safe-edge-manual", profile("SDS"), deps, noLocalUse))
      .toThrow(/permission for local use/);
    const wrongMarket = authorization();
    wrongMarket.authorizedScope = { markets: ["DE"], languages: ["en"], productLines: ["Textile Effects"] };
    expect(() => createArchromaSupplierAdapter("archroma-safe-edge-manual", profile("SDS"), deps, wrongMarket))
      .toThrow(/exceeds the user-confirmed Safe Edge authorization/);
  });

  it("imports selected compliance documents through provenance and rejects unsupported TDS", async () => {
    const storeSelectedDocument = vi.fn(async () => ({
      status: "ok" as const,
      value: {
        acquisitionCode: "supplierdoc-archroma-001", sha256: "b".repeat(64), byteSize: 1024,
        filename: selection.originalFilename, mimeType: "application/pdf" as const,
      },
    }));
    const adapter = createArchromaSupplierAdapter("archroma-safe-edge-manual", profile("SDS"), { storeSelectedDocument }, authorization());
    expect((await adapter.discoverDocuments({ sourceProductId: "archroma-product-001" })).status).toBe("ok");
    expect((await adapter.downloadDocument({ sourceDocumentId: selection.selectionId })).status).toBe("ok");
    expect(storeSelectedDocument).toHaveBeenCalledWith(expect.objectContaining({
      supplierId: "archroma", providerId: "archroma", market: "US", language: "en",
    }));
    expect(JSON.stringify(await adapter.getCoverageReport())).not.toContain("formulab-credential");
    expect(() => createArchromaSupplierAdapter("archroma-safe-edge-manual", profile("TDS"), { storeSelectedDocument: vi.fn() }, authorization()))
      .toThrow(/outside the declared Archroma surface capability/);
  });
});
