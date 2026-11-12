import { describe, expect, it, vi } from "vitest";
import { connectorConnectionSchema } from "../schemas/connector";
import {
  createEvonikSupplierAdapter,
  EVONIK_DOCUMENT_SURFACES,
  EVONIK_SUPPLIER_PROFILE,
  type EvonikPortalSession,
} from "./evonikSupplierAdapter";
import type { SupplierManualAdapterProfile } from "./supplierManualAdapter";

const timestamp = "2026-10-26T09:00:00.000Z";
const selection = {
  selectionId: "evonik-tds-selected-001",
  originalFilename: "evonik-product-tds.pdf",
  sourceFileSha256: "a".repeat(64),
  selectedAt: timestamp,
  selectedBy: "chemist-1",
};

function profile(documentType: "SDS" | "TDS" | "FORMULATION" = "TDS"): Omit<SupplierManualAdapterProfile, "supplierId" | "providerId" | "surface"> {
  return {
    catalogSources: [],
    documents: [{
      selection,
      sourceProductId: "evonik-product-001",
      documentType,
      market: "EU",
      language: "en",
      sourceRevision: "Rev 2",
      revisionDate: "2026-09-12",
    }],
    scope: { markets: ["EU"], languages: ["en"], productLines: ["Crosslinkers"] },
  };
}

function portalSession(): EvonikPortalSession {
  return {
    connection: connectorConnectionSchema.parse({
      schemaVersion: "1.0",
      code: "evonik-my-evonik",
      name: "My Evonik",
      connectorType: "REST_API",
      sourceSystemId: "SUPPLIER_EVONIK",
      connectionRef: `formulab-credential:v1:${"e".repeat(32)}`,
      baseUrl: "https://www.evonik.com/",
      status: "ready",
      lifecycleState: "authenticated",
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: "chemist-1",
    }),
    confirmation: { userConfirmedAuthentication: true, authenticatedAt: timestamp },
  };
}

describe("Evonik public and user-attended product document profiles — V01-02.009", () => {
  it("keeps business-line download and customer portal surfaces separately scoped", () => {
    expect(EVONIK_SUPPLIER_PROFILE).toMatchObject({ supplierId: "evonik", providerId: "evonik" });
    expect(EVONIK_DOCUMENT_SURFACES.map(({ surfaceId }) => surfaceId)).toEqual([
      "evonik-crosslinkers-download-center-manual",
      "evonik-businessline-download-center-manual",
      "evonik-intobeauty-manual",
      "evonik-my-evonik-manual",
    ]);
    expect(EVONIK_DOCUMENT_SURFACES.every(({ limitations }) => limitations.some((item) => /does not crawl|does not automate/i.test(item)))).toBe(true);
  });

  it("imports a public Crosslinkers technical sheet with revision, product-line and selected-file provenance", async () => {
    const storeSelectedDocument = vi.fn(async () => ({
      status: "ok" as const,
      value: {
        acquisitionCode: "supplierdoc-evonik-001",
        sha256: "b".repeat(64),
        byteSize: 8192,
        filename: selection.originalFilename,
        mimeType: "application/pdf" as const,
      },
    }));
    const adapter = createEvonikSupplierAdapter("evonik-crosslinkers-download-center-manual", profile(), { storeSelectedDocument });
    const discovered = await adapter.discoverDocuments({ sourceProductId: "evonik-product-001" });
    expect(discovered.status).toBe("ok");
    if (discovered.status !== "ok") return;
    expect(discovered.value[0]).toMatchObject({
      documentType: "TDS",
      sourceProductId: "evonik-product-001",
      sourceRevision: "Rev 2",
      revisionDate: "2026-09-12",
      manualSourceSelection: { sourceFileSha256: "a".repeat(64), selectedBy: "chemist-1" },
    });
    await adapter.downloadDocument({ sourceDocumentId: selection.selectionId });
    expect(storeSelectedDocument).toHaveBeenCalledWith(expect.objectContaining({
      supplierId: "evonik",
      market: "EU",
      language: "en",
      sourceRevision: "Rev 2",
    }));
    expect((await adapter.getCoverageReport()).requestedScope.productLines).toEqual(["Crosslinkers"]);
  });

  it("requires a user-confirmed authenticated connection for My Evonik and keeps formulation content scoped", () => {
    expect(() => createEvonikSupplierAdapter("evonik-my-evonik-manual", profile("FORMULATION"), {
      storeSelectedDocument: vi.fn(),
    })).toThrow(/authenticated, user-attended portal session/);
    expect(() => createEvonikSupplierAdapter("evonik-my-evonik-manual", profile("FORMULATION"), {
      storeSelectedDocument: vi.fn(),
    }, portalSession())).not.toThrow();
    expect(() => createEvonikSupplierAdapter("evonik-crosslinkers-download-center-manual", profile("FORMULATION"), {
      storeSelectedDocument: vi.fn(),
    })).toThrow(/outside the declared Evonik surface capability/);
  });
});
