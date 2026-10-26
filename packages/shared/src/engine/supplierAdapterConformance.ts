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
  sourceUrl: string;
}

export type SupplierAdapterResult<T> =
  | { status: "ok"; value: T }
  | { status: "partial"; value: T; gaps: string[] }
  | { status: "unavailable"; failure: SupplierAdapterFailure };

export interface SupplierAdapterCatalogPage {
  products: SupplierAdapterProduct[];
  /** Opaque, transient provider token. Never persist this field directly. */
  nextPageToken?: string;
}

export interface SupplierAdapterDownload {
  bytes: Uint8Array;
  filename: string;
  mimeType: "application/pdf" | "application/octet-stream";
}

export interface SupplierAdapterConformanceTarget {
  searchCatalog(input: { query: string; pageToken?: string }, signal?: AbortSignal): Promise<SupplierAdapterResult<SupplierAdapterCatalogPage>>;
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

const pdfFixture = new TextEncoder().encode("%PDF-1.7\nFormuLab deterministic supplier fixture\n%%EOF\n");

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
      pagesChecked += 1;
      if (input.query !== "fixture") return { status: "ok", value: { products: [] } };
      if (input.pageToken === "fixture-page-2") {
        const secondProduct = { ...product, sourceProductId: "fixture-product-002", supplierItemCode: "FIX-002" };
        productsChecked.add(secondProduct.sourceProductId);
        return { status: "ok", value: { products: [secondProduct] } };
      }
      productsChecked.add(product.sourceProductId);
      const page: SupplierAdapterCatalogPage = { products: [product], nextPageToken: "fixture-page-2" };
      return scenario === "partial_scope"
        ? { status: "partial", value: page, gaps: ["Second market requires user-attended access."] }
        : { status: "ok", value: page };
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
      return { status: "ok", value: { bytes: pdfFixture.slice(), filename: "fixture-sds-001.pdf", mimeType: "application/pdf" } };
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
    if (first.value.nextPageToken !== "fixture-page-2") throw new Error();
    const repeated = await adapter.searchCatalog({ query: "fixture" });
    if (JSON.stringify(first) !== JSON.stringify(repeated)) throw new Error();
  });

  await check("pagination advances and terminates", async () => {
    const adapter = createAdapter();
    const first = await adapter.searchCatalog({ query: "fixture" });
    if (first.status !== "ok" || !first.value.nextPageToken) throw new Error();
    const second = await adapter.searchCatalog({ query: "fixture", pageToken: first.value.nextPageToken });
    if (second.status !== "ok" || second.value.products[0]?.sourceProductId !== "fixture-product-002") throw new Error();
    if (second.value.nextPageToken !== undefined) throw new Error();
    if (first.value.products[0]?.sourceProductId === second.value.products[0]?.sourceProductId) throw new Error();
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

  await check("document download returns bounded PDF-shaped fixture bytes", async () => {
    const result = await createAdapter().downloadDocument({ sourceDocumentId: "fixture-sds-001" });
    if (result.status !== "ok" || result.value.mimeType !== "application/pdf"
      || !new TextDecoder().decode(result.value.bytes).startsWith("%PDF-")) throw new Error();
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
    if (first.status !== "ok" || !first.value.nextPageToken) throw new Error();
    await adapter.searchCatalog({ query: "fixture", pageToken: first.value.nextPageToken });
    await adapter.discoverDocuments({ sourceProductId: "fixture-product-001" });
    await adapter.downloadDocument({ sourceDocumentId: "fixture-sds-001" });
    const report = await adapter.getCoverageReport();
    if (report.pagesChecked < 2 || report.productsChecked < 2 || report.documentsFound < 2
      || report.documentsAcquired < 1 || report.scannedScope.markets.length === 0) throw new Error();
  });

  return checks;
}
