import { supplierCoverageReportSchema, type SupplierCoverageReport } from "../schemas/supplierCoverage";

/** Normalized boundary shared by supplier-specific adapters and their tests.
 * Provider cursors remain in adapter memory; persistence checkpoints use the
 * existing safe acquisition-job contract instead. */
export type SupplierAdapterFailureCode =
  | "rate_limited"
  | "timeout"
  | "authorization_required"
  | "surface_unavailable"
  | "cancelled"
  | "network_error";

export interface SupplierAdapterFailure {
  code: SupplierAdapterFailureCode;
  retryable: boolean;
  retryAfterMs?: number;
}

export interface SupplierAdapterProduct {
  sourceProductId: string;
  supplierItemCode?: string;
  tradeName?: string;
  grade?: string;
}

export interface SupplierAdapterDocument {
  sourceDocumentId: string;
  sourceProductId: string;
  documentType: "SDS" | "TDS" | "FORMULATION" | "CERTIFICATE" | "OTHER";
  sourceUrl?: string;
  sourceRevision?: string;
  revisionDate?: string;
  publicationDate?: string;
  manualSourceSelection?: {
    selectionId: string;
    originalFilename: string;
    sourceFileSha256: string;
    selectedAt: string;
    selectedBy: string;
  };
}

export type SupplierAdapterResult<T> =
  | { status: "ok"; value: T }
  | { status: "partial"; value: T; gaps: string[] }
  | { status: "unavailable"; failure: SupplierAdapterFailure };

export interface SupplierAdapterCatalogPage {
  products: SupplierAdapterProduct[];
  /** Number of source pages consumed by the adapter's existing connector. */
  pagesChecked: number;
}

export interface SupplierAdapterDownload {
  acquisitionCode: string;
  sha256: string;
  byteSize: number;
  filename: string;
  mimeType: "application/pdf" | "application/octet-stream";
}

export interface SupplierAdapterConformanceTarget {
  searchCatalog(input: { query: string }, signal?: AbortSignal): Promise<SupplierAdapterResult<SupplierAdapterCatalogPage>>;
  discoverDocuments(input: { sourceProductId: string }, signal?: AbortSignal): Promise<SupplierAdapterResult<SupplierAdapterDocument[]>>;
  downloadDocument(input: { sourceDocumentId: string }, signal?: AbortSignal): Promise<SupplierAdapterResult<SupplierAdapterDownload>>;
  getCoverageReport(): Promise<SupplierCoverageReport>;
}

export type SupplierAdapterFixtureScenario =
  | "success"
  | "partial_scope"
  | "rate_limited_once"
  | "timeout"
  | "authorization_required"
  | "surface_unavailable";

export interface SupplierAdapterConformanceCheck {
  name: string;
  passed: boolean;
}

export type SupplierAdapterConformanceFactory = (
  scenario?: SupplierAdapterFixtureScenario,
) => SupplierAdapterConformanceTarget;

const product: SupplierAdapterProduct = {
  sourceProductId: "fixture-product-001",
  supplierItemCode: "FIX-001",
  tradeName: "Fixture Surfactant",
  grade: "38",
};

const documents: SupplierAdapterDocument[] = [
  {
    sourceDocumentId: "fixture-sds-001",
    sourceProductId: product.sourceProductId,
    documentType: "SDS",
    sourceUrl: "https://supplier.example/documents/sds-001",
  },
  {
    sourceDocumentId: "fixture-tds-001",
    sourceProductId: product.sourceProductId,
    documentType: "TDS",
    sourceUrl: "https://supplier.example/documents/tds-001",
  },
];

const pdfFixtureBytes = new TextEncoder().encode("%PDF-1.7\nFormuLab deterministic supplier fixture\n%%EOF\n");

function unavailable<T>(code: SupplierAdapterFailureCode, retryable: boolean, retryAfterMs?: number): SupplierAdapterResult<T> {
  return { status: "unavailable", failure: { code, retryable, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) } };
}

function cancellation<T>(signal?: AbortSignal): SupplierAdapterResult<T> | undefined {
  return signal?.aborted ? unavailable("cancelled", false) : undefined;
}

/** Deterministic in-memory supplier endpoint used by the conformance tests.
 * It never performs network or filesystem access and contains no credentials. */
export function createDeterministicSupplierAdapterFixture(
  scenario: SupplierAdapterFixtureScenario = "success",
): SupplierAdapterConformanceTarget {
  let rateLimitReturned = false;
  let pagesChecked = 0;
  const productsChecked = new Set<string>();
  const documentsFound = new Set<string>();
  const documentsAcquired = new Set<string>();

  const failureForScenario = <T>(): SupplierAdapterResult<T> | undefined => {
    switch (scenario) {
      case "timeout": return unavailable("timeout", true);
      case "authorization_required": return unavailable("authorization_required", false);
      case "surface_unavailable": return unavailable("surface_unavailable", true);
      case "rate_limited_once":
        if (!rateLimitReturned) {
          rateLimitReturned = true;
          return unavailable("rate_limited", true, 250);
        }
        return undefined;
      default: return undefined;
    }
  };

  return {
    async searchCatalog(input, signal) {
      const aborted = cancellation<SupplierAdapterCatalogPage>(signal);
      if (aborted) return aborted;
      const failure = failureForScenario<SupplierAdapterCatalogPage>();
      if (failure) return failure;
      if (input.query !== "fixture") {
        pagesChecked += 1;
        return { status: "ok", value: { products: [], pagesChecked: 1 } };
      }
      productsChecked.add(product.sourceProductId);
      if (scenario === "partial_scope") {
        pagesChecked += 1;
        return { status: "partial", value: { products: [product], pagesChecked: 1 }, gaps: ["Second market requires user-attended access."] };
      }
      const secondProduct = { ...product, sourceProductId: "fixture-product-002", supplierItemCode: "FIX-002" };
      productsChecked.add(secondProduct.sourceProductId);
      pagesChecked += 2;
      return { status: "ok", value: { products: [product, secondProduct], pagesChecked: 2 } };
    },
    async discoverDocuments(input, signal) {
      const aborted = cancellation<SupplierAdapterDocument[]>(signal);
      if (aborted) return aborted;
      const failure = failureForScenario<SupplierAdapterDocument[]>();
      if (failure) return failure;
      const found = documents.filter((document) => document.sourceProductId === input.sourceProductId);
      found.forEach((document) => documentsFound.add(document.sourceDocumentId));
      return { status: "ok", value: found };
    },
    async downloadDocument(input, signal) {
      const aborted = cancellation<SupplierAdapterDownload>(signal);
      if (aborted) return aborted;
      const failure = failureForScenario<SupplierAdapterDownload>();
      if (failure) return failure;
      if (!documents.some((document) => document.sourceDocumentId === input.sourceDocumentId)) {
        return unavailable("network_error", false);
      }
      documentsAcquired.add(input.sourceDocumentId);
      return {
        status: "ok",
        value: {
          acquisitionCode: "supplierdoc-fixture-sds-001",
          sha256: "a".repeat(64),
          byteSize: pdfFixtureBytes.byteLength,
          filename: "fixture-sds-001.pdf",
          mimeType: "application/pdf",
        },
      };
    },
    async getCoverageReport() {
      const partial = scenario === "partial_scope";
      return supplierCoverageReportSchema.parse({
        schemaVersion: "1.0",
        supplierId: "supplier-fixture",
        providerId: "fixture-adapter",
        surfaceId: "fixture-public-surface",
        acquisitionJobId: "fixture-job-001",
        completion: partial ? "partial" : "complete",
        requestedScope: { markets: ["EU", "NA"], languages: ["en"], productLines: ["Home Care", "Industrial"] },
        scannedScope: { markets: ["EU"], languages: ["en"], productLines: ["Home Care"] },
        pagesChecked,
        productsChecked: productsChecked.size,
        documentsFound: documentsFound.size,
        documentsAcquired: documentsAcquired.size,
        inaccessibleSurfaces: scenario === "authorization_required"
          ? [{ surfaceId: "fixture-customer-portal", reason: "authorization_required" }]
          : [],
        unsupportedCapabilities: partial ? ["formulation_discovery"] : [],
        gaps: partial
          ? [
            { code: "scope_unscanned", dimension: "market", scopeValue: "NA" },
            { code: "capability_unsupported", dimension: "capability", scopeValue: "formulation_discovery" },
          ]
          : [],
        generatedAt: "2026-10-26T08:30:00.000Z",
      });
    },
  };
}

/** Shared behavioral acceptance suite. Provider tests pass a factory backed
 * by deterministic mocked transport so this runner never needs live supplier
 * access or credentials. Results intentionally omit exception/server text. */
export async function runSupplierAdapterConformance(
  createAdapter: SupplierAdapterConformanceFactory,
): Promise<SupplierAdapterConformanceCheck[]> {
  const checks: SupplierAdapterConformanceCheck[] = [];
  const check = async (name: string, action: () => Promise<void>) => {
    try {
      await action();
      checks.push({ name, passed: true });
    } catch {
      checks.push({ name, passed: false });
    }
  };

  await check("catalog search and deterministic identity", async () => {
    const adapter = createAdapter();
    const first = await adapter.searchCatalog({ query: "fixture" });
    if (first.status !== "ok" || first.value.products[0]?.sourceProductId !== "fixture-product-001") throw new Error();
    const repeated = await adapter.searchCatalog({ query: "fixture" });
    if (JSON.stringify(first) !== JSON.stringify(repeated)) throw new Error();
  });

  await check("pagination advances and terminates", async () => {
    const adapter = createAdapter();
    const first = await adapter.searchCatalog({ query: "fixture" });
    if (first.status !== "ok" || first.value.pagesChecked !== 2 || first.value.products.length !== 2) throw new Error();
    if (first.value.products[0]?.sourceProductId === first.value.products[1]?.sourceProductId) throw new Error();
  });

  await check("partial scope remains distinguishable", async () => {
    const result = await createAdapter("partial_scope").searchCatalog({ query: "fixture" });
    if (result.status !== "partial" || result.gaps.length === 0 || result.value.products.length === 0) throw new Error();
  });

  await check("rate limit exposes bounded retry guidance", async () => {
    const adapter = createAdapter("rate_limited_once");
    const input = { query: "fixture" };
    const limited = await adapter.searchCatalog(input);
    if (limited.status !== "unavailable" || limited.failure.code !== "rate_limited"
      || !limited.failure.retryable || limited.failure.retryAfterMs === undefined) throw new Error();
    if ((await adapter.searchCatalog(input)).status !== "ok") throw new Error();
  });

  for (const [scenario, code, retryable] of [
    ["timeout", "timeout", true],
    ["authorization_required", "authorization_required", false],
    ["surface_unavailable", "surface_unavailable", true],
  ] as const) {
    await check(`${scenario} is represented as a bounded failure`, async () => {
      const result = await createAdapter(scenario).searchCatalog({ query: "fixture" });
      if (result.status !== "unavailable" || result.failure.code !== code || result.failure.retryable !== retryable) throw new Error();
    });
  }

  await check("document discovery returns source-linked document types", async () => {
    const result = await createAdapter().discoverDocuments({ sourceProductId: "fixture-product-001" });
    if (result.status !== "ok" || result.value.length !== 2) throw new Error();
    if (result.value.some((document) => document.sourceProductId !== "fixture-product-001")) throw new Error();
    if (!result.value.some((document) => document.documentType === "SDS")
      || !result.value.some((document) => document.documentType === "TDS")) throw new Error();
  });

  await check("document download returns a metadata receipt without exposing binary bytes", async () => {
    const result = await createAdapter().downloadDocument({ sourceDocumentId: "fixture-sds-001" });
    if (result.status !== "ok" || result.value.mimeType !== "application/pdf"
      || !/^supplierdoc-/.test(result.value.acquisitionCode)
      || !/^[a-f0-9]{64}$/.test(result.value.sha256) || result.value.byteSize <= 0
      || "bytes" in result.value) throw new Error();
  });

  await check("cancellation is honored by search, discovery and download", async () => {
    const adapter = createAdapter();
    const controller = new AbortController();
    controller.abort();
    const outcomes = await Promise.all([
      adapter.searchCatalog({ query: "fixture" }, controller.signal),
      adapter.discoverDocuments({ sourceProductId: "fixture-product-001" }, controller.signal),
      adapter.downloadDocument({ sourceDocumentId: "fixture-sds-001" }, controller.signal),
    ]);
    if (outcomes.some((result) => result.status !== "unavailable" || result.failure.code !== "cancelled")) throw new Error();
  });

  await check("failure diagnostics do not expose credential or response material", async () => {
    const result = await createAdapter("authorization_required").searchCatalog({ query: "fixture" });
    const serialized = JSON.stringify(result);
    if (/password|token|cookie|do-not-store/i.test(serialized)) throw new Error();
  });

  await check("coverage reports actual scoped counts and acquisition outcome", async () => {
    const adapter = createAdapter();
    const first = await adapter.searchCatalog({ query: "fixture" });
    if (first.status !== "ok") throw new Error();
    await adapter.discoverDocuments({ sourceProductId: "fixture-product-001" });
    await adapter.downloadDocument({ sourceDocumentId: "fixture-sds-001" });
    const report = await adapter.getCoverageReport();
    if (report.pagesChecked < 2 || report.productsChecked < 2 || report.documentsFound < 2
      || report.documentsAcquired < 1 || report.scannedScope.markets.length === 0) throw new Error();
  });

  return checks;
}
