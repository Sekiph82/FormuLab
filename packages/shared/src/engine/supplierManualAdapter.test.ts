import { describe, expect, it, vi } from "vitest";
import { createFileConnector } from "./fileConnector";
import { createManualAssistedSupplierAdapter, type SupplierManualAdapterProfile } from "./supplierManualAdapter";

const selectedAt = "2026-10-26T09:00:00.000Z";
const selection = {
  selectionId: "selection-catalog-001",
  originalFilename: "supplier-catalog.csv",
  sourceFileSha256: "a".repeat(64),
  selectedAt,
  selectedBy: "chemist-1",
};
const surface: SupplierManualAdapterProfile["surface"] = {
  surfaceId: "example-manual-import",
  providerId: "example-provider",
  displayName: "User-selected supplier files",
  kind: "manual_assisted",
  capabilities: {
    catalogDiscovery: true,
    documentDiscovery: true,
    documentFetch: true,
    formulationDiscovery: true,
    pagination: { mode: "none" },
    authorizationMode: "manual_assisted",
    coverage: {
      status: "partial",
      markets: ["EU"],
      languages: ["en"],
      productLines: ["Home Care"],
      documentTypes: ["SDS", "TDS", "FORMULATION"],
    },
    limitations: ["Only owner-selected files are included."],
  },
};

function profile() {
  const connector = createFileConnector("SUPPLIER_EXAMPLE", {
    fileName: selection.originalFilename,
    fileKind: "csv",
    text: "ItemNo,TradeName,Grade\nMAT-001,Alpha surfactant,38\nMAT-002,Beta polymer,70\n",
    entity: "catalog",
  }, {
    extractionRunId: selection.selectionId,
    extractedAt: selectedAt,
    idField: "ItemNo",
  });
  const firstProductId = `manual:${selection.sourceFileSha256}:MAT-001`;
  const sdsSelection = {
    selectionId: "selection-sds-001",
    originalFilename: "alpha-surfactant-sds.pdf",
    sourceFileSha256: "b".repeat(64),
    selectedAt,
    selectedBy: "chemist-1",
  };
  const tdsSelection = {
    selectionId: "selection-tds-001",
    originalFilename: "alpha-surfactant-tds.pdf",
    sourceFileSha256: "e".repeat(64),
    selectedAt,
    selectedBy: "chemist-1",
  };
  const formulationSelection = {
    selectionId: "selection-formula-001",
    originalFilename: "supplier-formulation.xlsx",
    sourceFileSha256: "c".repeat(64),
    selectedAt,
    selectedBy: "chemist-1",
  };
  return {
    supplierId: "supplier-example",
    providerId: "example-provider",
    surface,
    catalogSources: [{ selection, connector, entity: "catalog", fields: { supplierItemCode: "ItemNo", tradeName: "TradeName", grade: "Grade" } }],
    documents: [
      { selection: sdsSelection, sourceProductId: firstProductId, documentType: "SDS" as const, market: "EU", language: "en" },
      { selection: tdsSelection, sourceProductId: firstProductId, documentType: "TDS" as const, market: "EU", language: "en" },
      { selection: formulationSelection, sourceProductId: firstProductId, documentType: "FORMULATION" as const, market: "EU", language: "en" },
    ],
    scope: { markets: ["EU"], languages: ["en"], productLines: ["Home Care"] },
  } satisfies SupplierManualAdapterProfile;
}

describe("manual-assisted supplier adapter over existing FILE/Data Exchange sources — V01-02.005", () => {
  it("reads selected catalog files through SourceConnector and returns stable scoped records", async () => {
    const adapter = createManualAssistedSupplierAdapter(profile(), { storeSelectedDocument: vi.fn() });
    const result = await adapter.searchCatalog({ query: "alpha" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value.products).toEqual([{
        sourceProductId: `manual:${selection.sourceFileSha256}:MAT-001`,
        supplierItemCode: "MAT-001",
        tradeName: "Alpha surfactant",
        grade: "38",
      }]);
    }
    const coverage = await adapter.getCoverageReport();
    expect(coverage.completion).toBe("complete");
    expect(coverage.productsChecked).toBe(2);
  });

  it("covers manually selected SDS, TDS and formulation files without exposing local paths or bytes", async () => {
    const nativeStore = vi.fn(async () => ({
      status: "ok" as const,
      value: {
        acquisitionCode: "supplierdoc-manual-sds-001",
        sha256: "d".repeat(64),
        byteSize: 256,
        filename: "alpha-surfactant-sds.pdf",
        mimeType: "application/pdf" as const,
      },
    }));
    const adapter = createManualAssistedSupplierAdapter(profile(), { storeSelectedDocument: nativeStore });
    const productId = `manual:${selection.sourceFileSha256}:MAT-001`;
    const found = await adapter.discoverDocuments({ sourceProductId: productId });
    expect(found.status).toBe("ok");
    if (found.status !== "ok") return;
    expect(found.value.map(({ documentType }) => documentType)).toEqual(["SDS", "TDS", "FORMULATION"]);
    expect(found.value.every((document) => document.manualSourceSelection?.selectedBy === "chemist-1")).toBe(true);
    expect(found.value.every((document) => document.sourceUrl === undefined)).toBe(true);

    const downloaded = await adapter.downloadDocument({ sourceDocumentId: "selection-sds-001" });
    expect(downloaded.status).toBe("ok");
    expect(nativeStore).toHaveBeenCalledWith(expect.objectContaining({
      supplierId: "supplier-example",
      documentType: "SDS",
      market: "EU",
      language: "en",
      selection: expect.objectContaining({ selectionId: "selection-sds-001" }),
    }));
    if (downloaded.status === "ok") expect("bytes" in downloaded.value).toBe(false);
    expect(JSON.stringify(found)).not.toMatch(/C:\\\\|Users\\\\|AppData/);
    expect((await adapter.getCoverageReport()).documentsAcquired).toBe(1);
  });

  it("rejects non-FILE inputs and unsafe or incomplete manual provenance", () => {
    const valid = profile();
    const restConnector = { ...valid.catalogSources[0]!.connector, identity: { ...valid.catalogSources[0]!.connector.identity, connectorType: "REST_API" as const } };
    expect(() => createManualAssistedSupplierAdapter({
      ...valid,
      catalogSources: [{ ...valid.catalogSources[0]!, connector: restConnector }],
    }, { storeSelectedDocument: vi.fn() })).toThrow(/existing FILE connector/);
    expect(() => createManualAssistedSupplierAdapter({
      ...valid,
      catalogSources: [{ ...valid.catalogSources[0]!, selection: { ...selection, originalFilename: "C:\\private\\materials.csv" } }],
    }, { storeSelectedDocument: vi.fn() })).toThrow(/safe immutable provenance/);
    expect(() => createManualAssistedSupplierAdapter({
      ...valid,
      catalogSources: [{ ...valid.catalogSources[0]!, selection: { ...selection, absolutePath: "C:\\private\\materials.csv" } as never }],
    }, { storeSelectedDocument: vi.fn() })).toThrow(/safe immutable provenance/);
    expect(() => createManualAssistedSupplierAdapter({ ...valid, surface: { ...surface, kind: "public_search" } }, {
      storeSelectedDocument: vi.fn(),
    })).toThrow(/manual-assisted surface/);
  });
});
