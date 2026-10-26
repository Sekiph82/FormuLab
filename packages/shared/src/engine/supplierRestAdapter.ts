import {
  supplierCoverageReportSchema,
  type SupplierCoverageReport,
} from "../schemas/supplierCoverage";
import type { SupplierSurfaceProfile } from "../schemas/supplierProvider";
import type { StageOptions } from "./fileConnector";
import {
  createRestApiConnector,
  type RestConnectorDeps,
} from "./restApiConnector";
import type {
  SupplierAdapterConformanceTarget,
  SupplierAdapterDocument,
  SupplierAdapterDownload,
  SupplierAdapterFailureCode,
  SupplierAdapterResult,
} from "./supplierAdapterConformance";
import { safeSupplierDocumentSourceUrl } from "../schemas/supplierDocument";

export interface SupplierRestAdapterFieldMap {
  product: {
    id: string;
    itemCode?: string;
    tradeName?: string;
    grade?: string;
  };
  document: {
    id: string;
    productId: string;
    type: string;
    sourceUrl: string;
  };
}

export interface SupplierRestAdapterProfile {
  supplierId: string;
  providerId: string;
  surface: SupplierSurfaceProfile;
  connectionRef: string;
  baseUrl: string;
  catalogPath: string;
  documentPath: string;
  fields: SupplierRestAdapterFieldMap;
  scope: { markets: string[]; languages: string[]; productLines: string[] };
  maxPages?: number;
}

export interface SupplierRestAdapterDeps {
  /** Delegates each page to the existing REST HTTP boundary. Production
   * implementations resolve connectionRef outside this module and apply
   * supplier network admission before issuing any request. */
  fetchPage: RestConnectorDeps["fetchPage"];
  /** Uses the existing native admission/blob-store path. The renderer sees
   * only the immutable receipt, never the downloaded PDF bytes. */
  fetchAndStoreDocument: (input: {
    sourceUrl: string;
    declaredHosts: string[];
  }) => Promise<SupplierAdapterResult<SupplierAdapterDownload>>;
}

function declaredHttpsUrl(value: string, declaredHosts: readonly string[]): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash
    || !declaredHosts.some((host) => host.toLowerCase() === url.hostname.toLowerCase())) {
    throw new Error("Supplier REST endpoint is not covered by the declared HTTPS host policy.");
  }
  return url;
}

function validateProfile(profile: SupplierRestAdapterProfile): string[] {
  if (profile.surface.capabilities.authorizationMode !== "public"
    && profile.surface.capabilities.authorizationMode !== "api") {
    throw new Error("Supplier REST adapter requires a public or API surface.");
  }
  if (profile.surface.capabilities.catalogDiscovery !== true) {
    throw new Error("Supplier REST surface does not declare catalog discovery.");
  }
  if (!profile.connectionRef.trim()) throw new Error("Supplier REST adapter requires an opaque connection reference.");
  const hosts = profile.surface.declaredHosts ?? [];
  if (hosts.length === 0) throw new Error("Supplier REST adapter requires declared hosts.");
  const base = declaredHttpsUrl(profile.baseUrl, hosts);
  for (const path of [profile.catalogPath, profile.documentPath]) {
    const target = new URL(path, base);
    if (!path.startsWith("/") || path.startsWith("//") || target.hostname.toLowerCase() !== base.hostname.toLowerCase()
      || target.protocol !== "https:" || target.username || target.password) {
      throw new Error("Supplier REST endpoint must be an origin-relative path on the declared host.");
    }
  }
  return hosts;
}

function field(record: Record<string, string | null>, name: string | undefined): string | undefined {
  const value = name ? record[name]?.trim() : undefined;
  return value || undefined;
}

function boundedFailure(code: SupplierAdapterFailureCode, retryable: boolean, retryAfterMs?: number): SupplierAdapterResult<never> {
  return { status: "unavailable", failure: { code, retryable, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) } };
}

function failureForConnectorError(result: Awaited<ReturnType<ReturnType<typeof createRestApiConnector>["extract"]>>): SupplierAdapterFailureCode | undefined {
  const error = result.errors[0];
  if (!error) return undefined;
  if (error.detail === "HTTP 401" || error.detail === "HTTP 403") return "authorization_required";
  if (error.detail === "HTTP 408") return "timeout";
  if (error.detail === "HTTP 429") return "rate_limited";
  return "network_error";
}

function safeDocumentType(value: string | undefined): SupplierAdapterDocument["documentType"] | undefined {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "SDS" || normalized === "MSDS") return "SDS";
  if (normalized === "TDS" || normalized === "TECHNICAL DATA SHEET") return "TDS";
  if (normalized === "FORMULATION") return "FORMULATION";
  if (normalized === "CERTIFICATE" || normalized === "COA") return "CERTIFICATE";
  if (normalized === "OTHER") return "OTHER";
  return undefined;
}

/** Public/API supplier adapter composed over FormuLab's existing REST
 * connector. It does not create another HTTP or import authority. */
export function createSupplierRestAdapter(
  profile: SupplierRestAdapterProfile,
  stageOptions: StageOptions,
  deps: SupplierRestAdapterDeps,
): SupplierAdapterConformanceTarget {
  const declaredHosts = validateProfile(profile);
  const rawDownloadUrls = new Map<string, string>();
  const fetchedDocumentIds = new Set<string>();
  const scannedProductIds = new Set<string>();
  const foundDocumentIds = new Set<string>();
  const gaps = new Set<SupplierCoverageReport["gaps"][number]["code"]>();
  const inaccessibleSurfaces = new Map<string, "authorization_required" | "manual_assistance_required" | "surface_unavailable" | "rate_limited" | "timeout" | "unsupported">();
  let pagesChecked = 0;

  const extract = async (kind: "catalog" | "documents", signal?: AbortSignal) => {
    if (signal?.aborted) return { failure: "cancelled" as const };
    const entity = kind;
    const endpoint = kind === "catalog" ? profile.catalogPath : profile.documentPath;
    const idField = kind === "catalog" ? profile.fields.product.id : profile.fields.document.id;
    const pageDeps: RestConnectorDeps = {
      fetchPage: async (spec) => {
        const response = await deps.fetchPage(spec);
        pagesChecked += 1;
        return response;
      },
    };
    let result;
    try {
      const connector = createRestApiConnector(
        `SUPPLIER_${profile.supplierId}`,
        { connectionRef: profile.connectionRef, endpoints: { [entity]: endpoint }, ...(profile.maxPages ? { maxPages: profile.maxPages } : {}) },
        { ...stageOptions, idField },
        pageDeps,
      );
      result = await connector.extract(entity);
    } catch {
      return { failure: "network_error" as const };
    }
    const failure = failureForConnectorError(result);
    if (failure) {
      gaps.add(failure === "authorization_required" ? "authorization_required"
        : failure === "rate_limited" ? "rate_limited"
          : failure === "timeout" ? "timeout" : "item_failures");
      if (failure === "authorization_required") inaccessibleSurfaces.set(profile.surface.surfaceId, "authorization_required");
      if (failure === "rate_limited") inaccessibleSurfaces.set(profile.surface.surfaceId, "rate_limited");
      if (failure === "timeout") inaccessibleSurfaces.set(profile.surface.surfaceId, "timeout");
      return { failure };
    }
    if (result.warnings.some(({ code }) => code === "pagination_limit_reached" || code === "pagination_loop")) {
      gaps.add("scope_unscanned");
    }
    return { result };
  };

  return {
    async searchCatalog(input, signal) {
      if (signal?.aborted) return boundedFailure("cancelled", false);
      const startingPageCount = pagesChecked;
      const extracted = await extract("catalog", signal);
      if (extracted.failure) return boundedFailure(extracted.failure, extracted.failure === "timeout" || extracted.failure === "rate_limited" || extracted.failure === "network_error");
      const records = extracted.result!.records;
      const query = input.query.trim().toLocaleLowerCase("en-US");
      const products = records.flatMap((record) => {
        const id = field(record.fields, profile.fields.product.id) ?? record.identity.sourceRecordId;
        const product = {
          sourceProductId: id,
          ...(field(record.fields, profile.fields.product.itemCode) ? { supplierItemCode: field(record.fields, profile.fields.product.itemCode) } : {}),
          ...(field(record.fields, profile.fields.product.tradeName) ? { tradeName: field(record.fields, profile.fields.product.tradeName) } : {}),
          ...(field(record.fields, profile.fields.product.grade) ? { grade: field(record.fields, profile.fields.product.grade) } : {}),
        };
        scannedProductIds.add(product.sourceProductId);
        const searchable = [product.supplierItemCode, product.tradeName, product.grade].filter(Boolean).join(" ").toLocaleLowerCase("en-US");
        if (query && !searchable.includes(query)) return [];
        return [product];
      });
      const result = { status: "ok" as const, value: { products, pagesChecked: pagesChecked - startingPageCount } };
      return gaps.size > 0 ? { status: "partial" as const, value: result.value, gaps: [...gaps] } : result;
    },
    async discoverDocuments(input, signal) {
      if (signal?.aborted) return boundedFailure("cancelled", false);
      if (!profile.surface.capabilities.documentDiscovery) {
        gaps.add("capability_unsupported");
        return boundedFailure("surface_unavailable", false);
      }
      const extracted = await extract("documents", signal);
      if (extracted.failure) return boundedFailure(extracted.failure, extracted.failure === "timeout" || extracted.failure === "rate_limited" || extracted.failure === "network_error");
      const documents: SupplierAdapterDocument[] = [];
      for (const record of extracted.result!.records) {
        const productId = field(record.fields, profile.fields.document.productId);
        if (productId !== input.sourceProductId) continue;
        const type = safeDocumentType(field(record.fields, profile.fields.document.type));
        const sourceUrl = field(record.fields, profile.fields.document.sourceUrl);
        if (!type || !sourceUrl) {
          gaps.add("item_failures");
          continue;
        }
        try {
          const rawUrl = declaredHttpsUrl(sourceUrl, declaredHosts).toString();
          const safeUrl = safeSupplierDocumentSourceUrl(rawUrl);
          const sourceDocumentId = field(record.fields, profile.fields.document.id) ?? record.identity.sourceRecordId;
          rawDownloadUrls.set(sourceDocumentId, rawUrl);
          foundDocumentIds.add(sourceDocumentId);
          documents.push({ sourceDocumentId, sourceProductId: productId, documentType: type, sourceUrl: safeUrl });
        } catch {
          gaps.add("scope_unscanned");
        }
      }
      return gaps.size > 0 ? { status: "partial", value: documents, gaps: [...gaps] } : { status: "ok", value: documents };
    },
    async downloadDocument(input, signal) {
      if (signal?.aborted) return boundedFailure("cancelled", false);
      if (!profile.surface.capabilities.documentFetch) {
        gaps.add("capability_unsupported");
        return boundedFailure("surface_unavailable", false);
      }
      const sourceUrl = rawDownloadUrls.get(input.sourceDocumentId);
      if (!sourceUrl) return boundedFailure("network_error", false);
      try {
        const result = await deps.fetchAndStoreDocument({ sourceUrl, declaredHosts });
        if (result.status === "ok") {
          fetchedDocumentIds.add(input.sourceDocumentId);
        } else if (result.status === "partial") {
          fetchedDocumentIds.add(input.sourceDocumentId);
          gaps.add("item_failures");
        } else if (result.failure.code === "authorization_required") {
          inaccessibleSurfaces.set(profile.surface.surfaceId, "authorization_required");
          gaps.add("authorization_required");
        }
        return result;
      } catch {
        gaps.add("item_failures");
        return boundedFailure("network_error", true);
      }
    },
    async getCoverageReport() {
      const unsupported: SupplierCoverageReport["unsupportedCapabilities"] = [];
      SUPPLIER_CAPABILITY_FIELDS.forEach(([profileField, reportField]) => {
        if (!profile.surface.capabilities[profileField]) unsupported.push(reportField);
      });
      if (profile.surface.capabilities.pagination.mode === "none" || profile.surface.capabilities.pagination.mode === "unknown") {
        unsupported.push("pagination");
      }
      if (unsupported.length > 0) gaps.add("capability_unsupported");
      return supplierCoverageReportSchema.parse({
        schemaVersion: "1.0",
        supplierId: profile.supplierId,
        providerId: profile.providerId,
        surfaceId: profile.surface.surfaceId,
        acquisitionJobId: stageOptions.extractionRunId,
        completion: gaps.size > 0 || inaccessibleSurfaces.size > 0 ? "partial" : pagesChecked > 0 ? "complete" : "not_started",
        requestedScope: profile.scope,
        scannedScope: pagesChecked > 0 ? profile.scope : { markets: [], languages: [], productLines: [] },
        pagesChecked,
        productsChecked: scannedProductIds.size,
        documentsFound: foundDocumentIds.size,
        documentsAcquired: fetchedDocumentIds.size,
        inaccessibleSurfaces: [...inaccessibleSurfaces].map(([surfaceId, reason]) => ({ surfaceId, reason })),
        unsupportedCapabilities: unsupported,
        gaps: [...gaps].map((code) => ({ code })),
        generatedAt: stageOptions.extractedAt,
      });
    },
  };
}

const SUPPLIER_CAPABILITY_FIELDS = [
  ["catalogDiscovery", "catalog_discovery"],
  ["documentDiscovery", "document_discovery"],
  ["documentFetch", "document_fetch"],
  ["formulationDiscovery", "formulation_discovery"],
] as const;
