import { z } from "zod";

const scopeValues = z.array(z.string().trim().min(1).max(160)).refine(
  (values) => new Set(values.map((value) => value.toLocaleLowerCase("en-US"))).size === values.length,
  "Scope values must be unique.",
);

export const supplierCoverageScopeSchema = z.object({
  markets: scopeValues,
  languages: scopeValues,
  productLines: scopeValues,
}).strict();
export type SupplierCoverageScope = z.infer<typeof supplierCoverageScopeSchema>;

export const SUPPLIER_COVERAGE_COMPLETION_STATES = ["complete", "partial", "not_started"] as const;
export const SUPPLIER_COVERAGE_CAPABILITIES = [
  "catalog_discovery",
  "document_discovery",
  "document_fetch",
  "formulation_discovery",
  "pagination",
] as const;

export const SUPPLIER_COVERAGE_GAP_CODES = [
  "scope_unscanned",
  "authorization_required",
  "surface_unavailable",
  "capability_unsupported",
  "rate_limited",
  "timeout",
  "cancelled",
  "item_failures",
] as const;

export const SUPPLIER_SURFACE_ACCESS_GAP_REASONS = [
  "authorization_required",
  "manual_assistance_required",
  "surface_unavailable",
  "rate_limited",
  "timeout",
  "unsupported",
] as const;

const inaccessibleSurfaceSchema = z.object({
  surfaceId: z.string().trim().min(1),
  reason: z.enum(SUPPLIER_SURFACE_ACCESS_GAP_REASONS),
}).strict();

const coverageGapSchema = z.object({
  code: z.enum(SUPPLIER_COVERAGE_GAP_CODES),
  dimension: z.enum(["market", "language", "product_line", "surface", "capability", "item"]).optional(),
  scopeValue: z.string().trim().min(1).max(160).optional(),
}).strict().superRefine((gap, context) => {
  if (gap.scopeValue !== undefined && gap.dimension === undefined) {
    context.addIssue({ code: "custom", path: ["dimension"], message: "A scoped gap must identify its dimension." });
  }
});

/** Actual run evidence only. Empty result counts do not imply that a supplier
 * has no products: consumers must also inspect completion, scanned scope,
 * inaccessible surfaces and gaps. Dynamic server messages and secrets are
 * intentionally excluded from this persisted/reportable contract. */
export const supplierCoverageReportSchema = z.object({
  schemaVersion: z.literal("1.0"),
  supplierId: z.string().trim().min(1),
  providerId: z.string().trim().min(1),
  surfaceId: z.string().trim().min(1),
  acquisitionJobId: z.string().trim().min(1),
  completion: z.enum(SUPPLIER_COVERAGE_COMPLETION_STATES),
  requestedScope: supplierCoverageScopeSchema,
  scannedScope: supplierCoverageScopeSchema,
  pagesChecked: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  productsChecked: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  documentsFound: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  documentsAcquired: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  inaccessibleSurfaces: z.array(inaccessibleSurfaceSchema),
  unsupportedCapabilities: z.array(z.enum(SUPPLIER_COVERAGE_CAPABILITIES)),
  gaps: z.array(coverageGapSchema),
  generatedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((report, context) => {
  if (report.documentsAcquired > report.documentsFound) {
    context.addIssue({ code: "custom", path: ["documentsAcquired"], message: "Acquired documents cannot exceed discovered documents." });
  }
  if (report.completion === "not_started"
    && (report.pagesChecked > 0 || report.productsChecked > 0 || report.documentsFound > 0
      || report.documentsAcquired > 0 || Object.values(report.scannedScope).some((values) => values.length > 0))) {
    context.addIssue({ code: "custom", path: ["completion"], message: "A not-started report cannot contain scan activity." });
  }
  if (report.completion === "complete" && report.gaps.length > 0) {
    context.addIssue({ code: "custom", path: ["completion"], message: "A complete report cannot contain coverage gaps." });
  }
  if (report.completion === "partial" && report.gaps.length === 0
    && report.inaccessibleSurfaces.length === 0 && report.unsupportedCapabilities.length === 0) {
    context.addIssue({ code: "custom", path: ["completion"], message: "A partial report must identify at least one gap, inaccessible surface or unsupported capability." });
  }
});
export type SupplierCoverageReport = z.infer<typeof supplierCoverageReportSchema>;
