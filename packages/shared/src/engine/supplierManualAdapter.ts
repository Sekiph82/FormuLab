import { z } from "zod";
import type { SourceConnector } from "../schemas/connector";
import { safeSupplierDocumentSourceUrl } from "../schemas/supplierDocument";
import { supplierCoverageReportSchema, type SupplierCoverageReport } from "../schemas/supplierCoverage";
import { supplierSurfaceProfileSchema, type SupplierSurfaceProfile } from "../schemas/supplierProvider";
import type {
  SupplierAdapterConformanceTarget,
  SupplierAdapterDocument,
  SupplierAdapterDownload,
  SupplierAdapterResult,
} from "./supplierAdapterConformance";

export interface SupplierManualFileSelection {
  selectionId: string;
  originalFilename: string;
  sourceFileSha256: string;
  selectedAt: string;
  selectedBy: string;
}

export const supplierManualFileSelectionSchema = z.object({
  selectionId: z.string().trim().min(1).max(160),
  originalFilename: z.string().min(1).max(160).refine((value) =>
    !/[\\/:\u0000-\u001f\u007f]/.test(value)
      && !value.endsWith(".")
      && !value.endsWith(" ")
      && value !== "."
      && value !== "..",
  "Filename must be a safe basename."),
  sourceFileSha256: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  selectedAt: z.string().datetime({ offset: true }),
  selectedBy: z.string().trim().min(1).max(160),
}).strict();

export interface SupplierManualCatalogSource {
  selection: SupplierManualFileSelection;
  connector: SourceConnector;
  entity: string;
  fields: { supplierItemCode?: string; tradeName?: string; grade?: string };
}

export const supplierManualSurfaceCheckSchema = z.object({
  market: z.string().trim().min(1).max(160),
  language: z.string().trim().min(1).max(160),
  productLine: z.string().trim().min(1).max(160),
  outcome: z.enum(["documents_found", "no_results", "access_required", "unsupported_scope", "not_scanned"]),
  documentsFound: z.number().int().nonnegative().max(100_000),
  checkedAt: z.string().datetime({ offset: true }),
  checkedBy: z.string().trim().min(1).max(160),
}).strict().superRefine((check, context) => {
  if (check.outcome === "no_results" && check.documentsFound !== 0) {
    context.addIssue({ code: "custom", path: ["documentsFound"], message: "A no-result check must report zero documents." });
  }
  if (check.outcome === "documents_found" && check.documentsFound < 1) {
    context.addIssue({ code: "custom", path: ["documentsFound"], message: "A result check must report at least one document." });
  }
  if ((check.outcome === "access_required" || check.outcome === "unsupported_scope" || check.outcome === "not_scanned") && check.documentsFound !== 0) {
    context.addIssue({ code: "custom", path: ["documentsFound"], message: "An inaccessible or unsupported check cannot report results." });
  }
});
export type SupplierManualSurfaceCheck = z.infer<typeof supplierManualSurfaceCheckSchema>;

export interface SupplierManualDocumentSelection {
  selection: SupplierManualFileSelection;
  sourceProductId: string;
  documentType: SupplierAdapterDocument["documentType"];
  market: string;
  language: string;
  sourceUrl?: string;
  sourceRevision?: string;
  revisionDate?: string;
  publicationDate?: string;
}

export interface SupplierManualAdapterProfile {
  supplierId: string;
  providerId: string;
  surface: SupplierSurfaceProfile;
  catalogSources: SupplierManualCatalogSource[];
  documents: SupplierManualDocumentSelection[];
  scope: { markets: string[]; languages: string[]; productLines: string[] };
  /** User-attested surface outcomes preserve a completed zero-result search
   * separately from a scope that was never checked. */
  surfaceChecks?: SupplierManualSurfaceCheck[];
}

export interface SupplierManualAdapterDeps {
  /** Existing native file-admission/content-addressed store plus immutable
   * supplier-document receipt path. Implementations may append source evidence
   * but must never update or approve RawMaterial. No path or bytes cross here. */
  storeSelectedDocument: (input: {
    supplierId: string;
    providerId: string;
    surfaceId: string;
    sourceProductId: string;
    documentType: SupplierAdapterDocument["documentType"];
    market: string;
    language: string;
    selection: SupplierManualFileSelection;
    sourceUrl?: string;
    sourceRevision?: string;
    revisionDate?: string;
    publicationDate?: string;
  }) => Promise<SupplierAdapterResult<SupplierAdapterDownload>>;
}

function validateSelection(selection: SupplierManualFileSelection): SupplierManualFileSelection {
  try {
    return supplierManualFileSelectionSchema.parse(selection);
  } catch {
    throw new Error("Manual supplier file selection lacks safe immutable provenance.");
  }
}

function failure<T>(code: "authorization_required" | "surface_unavailable" | "network_error" | "cancelled"): SupplierAdapterResult<T> {
  return { status: "unavailable", failure: { code, retryable: false } };
}

/** Manual-assisted supplier adapter over already selected FILE connectors.
 * Structured source data remains in the existing Data Exchange staging and
 * review lifecycle; this read-only adapter never commits master data. */
export function createManualAssistedSupplierAdapter(
  profile: SupplierManualAdapterProfile,
  deps: SupplierManualAdapterDeps,
): SupplierAdapterConformanceTarget {
  supplierSurfaceProfileSchema.parse(profile.surface);
  if (profile.surface.kind !== "manual_assisted"
    || profile.surface.capabilities.authorizationMode !== "manual_assisted") {
    throw new Error("Manual supplier adapter requires a separately declared manual-assisted surface.");
  }
  if (profile.surface.providerId !== profile.providerId || !profile.supplierId.trim()) {
    throw new Error("Manual supplier identity does not match its registered surface.");
  }
  if (profile.catalogSources.length === 0 && profile.documents.length === 0 && (profile.surfaceChecks?.length ?? 0) === 0) {
    throw new Error("Manual supplier adapter requires at least one user-selected source file.");
  }
  profile.catalogSources.forEach((source) => {
    if (source.connector.identity.connectorType !== "FILE" || !source.entity.trim()) {
      throw new Error("Manual catalog inputs must use the existing FILE connector.");
    }
    validateSelection(source.selection);
  });
  profile.documents.forEach((document) => {
    const { selection, sourceProductId, sourceUrl } = document;
    validateSelection(selection);
    if (!sourceProductId.trim()) throw new Error("Manual supplier document requires a source-product identity.");
    if (!document.market.trim() || !document.language.trim()) throw new Error("Manual supplier document requires a known market and language.");
    if (sourceUrl) safeSupplierDocumentSourceUrl(sourceUrl);
  });
  const surfaceChecks = (profile.surfaceChecks ?? []).map((check) => supplierManualSurfaceCheckSchema.parse(check));
  const checkKeys = surfaceChecks.map(({ market, language, productLine }) =>
    `${market.toLocaleLowerCase("en-US")}\u0000${language.toLocaleLowerCase("en-US")}\u0000${productLine.toLocaleLowerCase("en-US")}`);
  if (new Set(checkKeys).size !== checkKeys.length) {
    throw new Error("Manual surface checks must be unique per market, language and product line.");
  }
  if (new Set(profile.documents.map(({ selection }) => selection.selectionId)).size !== profile.documents.length) {
    throw new Error("Manual supplier document selections require unique immutable identities.");
  }

  const gaps = new Set<SupplierCoverageReport["gaps"][number]["code"]>();
  const productsChecked = new Set<string>();
  const documentsFound = new Set<string>();
  const documentsAcquired = new Set<string>();
  const selectedDocuments = new Map(profile.documents.map((document) => [document.selection.selectionId, document]));
  let filesChecked = 0;

  return {
    async searchCatalog(input, signal) {
      if (signal?.aborted) return failure("cancelled");
      if (!profile.surface.capabilities.catalogDiscovery || profile.catalogSources.length === 0) {
        gaps.add("capability_unsupported");
        return failure("surface_unavailable");
      }
      const products = [];
      for (const source of profile.catalogSources) {
        const result = await source.connector.extract(source.entity);
        filesChecked += 1;
        if (result.errors.length || result.warnings.length) gaps.add("item_failures");
        for (const record of result.records) {
          // The source-scoped ID is stable within the selected file. The file
          // digest prevents ordinal IDs from different files colliding.
          const sourceProductId = `manual:${source.selection.sourceFileSha256.toLowerCase()}:${record.identity.sourceRecordId}`;
          const read = (path: string | undefined) => path ? record.fields[path]?.trim() || undefined : undefined;
          const product = {
            sourceProductId,
            ...(read(source.fields.supplierItemCode) ? { supplierItemCode: read(source.fields.supplierItemCode) } : {}),
            ...(read(source.fields.tradeName) ? { tradeName: read(source.fields.tradeName) } : {}),
            ...(read(source.fields.grade) ? { grade: read(source.fields.grade) } : {}),
          };
          productsChecked.add(sourceProductId);
          const searchable = [product.supplierItemCode, product.tradeName, product.grade].filter(Boolean).join(" ").toLocaleLowerCase("en-US");
          const query = input.query.trim().toLocaleLowerCase("en-US");
          if (!query || searchable.includes(query)) products.push(product);
        }
      }
      return gaps.size > 0
        ? { status: "partial", value: { products, pagesChecked: 0 }, gaps: [...gaps] }
        : { status: "ok", value: { products, pagesChecked: 0 } };
    },
    async discoverDocuments(input, signal) {
      if (signal?.aborted) return failure("cancelled");
      if (!profile.surface.capabilities.documentDiscovery) {
        gaps.add("capability_unsupported");
        return failure("surface_unavailable");
      }
      const docs: SupplierAdapterDocument[] = [];
      for (const document of profile.documents.filter(({ sourceProductId }) => sourceProductId === input.sourceProductId)) {
        const sourceUrl = document.sourceUrl ? safeSupplierDocumentSourceUrl(document.sourceUrl) : undefined;
        documentsFound.add(document.selection.selectionId);
        docs.push({
          sourceDocumentId: document.selection.selectionId,
          sourceProductId: document.sourceProductId,
          documentType: document.documentType,
          ...(sourceUrl ? { sourceUrl } : {}),
          ...(document.sourceRevision ? { sourceRevision: document.sourceRevision } : {}),
          ...(document.revisionDate ? { revisionDate: document.revisionDate } : {}),
          ...(document.publicationDate ? { publicationDate: document.publicationDate } : {}),
          manualSourceSelection: document.selection,
        });
      }
      return { status: "ok", value: docs };
    },
    async downloadDocument(input, signal) {
      if (signal?.aborted) return failure("cancelled");
      if (!profile.surface.capabilities.documentFetch) {
        gaps.add("capability_unsupported");
        return failure("surface_unavailable");
      }
      const document = selectedDocuments.get(input.sourceDocumentId);
      if (!document) return failure("network_error");
      const result = await deps.storeSelectedDocument({
        supplierId: profile.supplierId,
        providerId: profile.providerId,
        surfaceId: profile.surface.surfaceId,
        sourceProductId: document.sourceProductId,
        documentType: document.documentType,
        market: document.market,
        language: document.language,
        selection: document.selection,
        ...(document.sourceUrl ? { sourceUrl: safeSupplierDocumentSourceUrl(document.sourceUrl) } : {}),
        ...(document.sourceRevision ? { sourceRevision: document.sourceRevision } : {}),
        ...(document.revisionDate ? { revisionDate: document.revisionDate } : {}),
        ...(document.publicationDate ? { publicationDate: document.publicationDate } : {}),
      });
      if (result.status === "ok" || result.status === "partial") documentsAcquired.add(input.sourceDocumentId);
      if (result.status === "partial") gaps.add("item_failures");
      if (result.status === "unavailable" && result.failure.code !== "cancelled") gaps.add("item_failures");
      return result;
    },
    async getCoverageReport() {
      const unsupported: SupplierCoverageReport["unsupportedCapabilities"] = [];
      if (!profile.surface.capabilities.catalogDiscovery) unsupported.push("catalog_discovery");
      if (!profile.surface.capabilities.documentDiscovery) unsupported.push("document_discovery");
      if (!profile.surface.capabilities.documentFetch) unsupported.push("document_fetch");
      if (!profile.surface.capabilities.formulationDiscovery) unsupported.push("formulation_discovery");
      if (unsupported.length) gaps.add("capability_unsupported");
      const inaccessibleChecks = surfaceChecks.filter(({ outcome }) => outcome === "access_required");
      const unsupportedChecks = surfaceChecks.filter(({ outcome }) => outcome === "unsupported_scope");
      const scannedChecks = surfaceChecks.filter(({ outcome }) => outcome === "no_results" || outcome === "documents_found");
      const scannedValues = {
        markets: new Set(scannedChecks.map(({ market }) => market)),
        languages: new Set(scannedChecks.map(({ language }) => language)),
        productLines: new Set(scannedChecks.map(({ productLine }) => productLine)),
      };
      const scannedScope = surfaceChecks.length > 0
        ? {
          markets: [...scannedValues.markets],
          languages: [...scannedValues.languages],
          productLines: [...scannedValues.productLines],
        }
        : filesChecked > 0 || documentsFound.size > 0 ? profile.scope : { markets: [], languages: [], productLines: [] };
      const unscannedGaps: SupplierCoverageReport["gaps"] = [];
      if (filesChecked === 0) {
        for (const [dimension, requested, scanned] of [
          ["market", profile.scope.markets, scannedScope.markets],
          ["language", profile.scope.languages, scannedScope.languages],
          ["product_line", profile.scope.productLines, scannedScope.productLines],
        ] as const) {
          requested.filter((value) => !scanned.some((item) => item.toLocaleLowerCase("en-US") === value.toLocaleLowerCase("en-US")))
            .forEach((scopeValue) => unscannedGaps.push({ code: "scope_unscanned", dimension, scopeValue }));
        }
      }
      const accessGap = inaccessibleChecks.length > 0;
      if (accessGap) gaps.add("authorization_required");
      unsupportedChecks.forEach(({ productLine }) => unscannedGaps.push({
        code: "capability_unsupported",
        dimension: "product_line",
        scopeValue: productLine,
      }));
      const started = filesChecked > 0 || surfaceChecks.length > 0 || documentsFound.size > 0;
      const selection = profile.catalogSources[0]?.selection ?? profile.documents[0]?.selection;
      const reportSeed = selection?.selectionId
        ?? `${profile.surface.surfaceId}:${surfaceChecks.map(({ market, language, productLine, checkedAt }) => `${market}:${language}:${productLine}:${checkedAt}`).join("|")}`;
      const reportGeneratedAt = surfaceChecks[surfaceChecks.length - 1]?.checkedAt ?? selection?.selectedAt;
      if (!reportGeneratedAt) throw new Error("Manual supplier coverage requires a selected source or a recorded surface check.");
      const coverageGaps = [...new Map([
        ...[...gaps].map((code) => ({ code })),
        ...unscannedGaps,
      ].map((gap) => [JSON.stringify(gap), gap])).values()];
      return supplierCoverageReportSchema.parse({
        schemaVersion: "1.0",
        supplierId: profile.supplierId,
        providerId: profile.providerId,
        surfaceId: profile.surface.surfaceId,
        acquisitionJobId: `manual:${reportSeed}`,
        completion: gaps.size > 0 ? "partial" : started ? "complete" : "not_started",
        requestedScope: profile.scope,
        scannedScope,
        pagesChecked: 0,
        productsChecked: productsChecked.size,
        documentsFound: Math.max(documentsFound.size, surfaceChecks.reduce((count, check) => count + check.documentsFound, 0)),
        documentsAcquired: documentsAcquired.size,
        inaccessibleSurfaces: accessGap ? [{ surfaceId: profile.surface.surfaceId, reason: "authorization_required" }] : [],
        unsupportedCapabilities: unsupported,
        gaps: coverageGaps,
        generatedAt: reportGeneratedAt,
      });
    },
  };
}
