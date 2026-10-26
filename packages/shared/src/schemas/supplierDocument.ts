import { z } from "zod";

export const SUPPLIER_DOCUMENT_KINDS = ["SDS", "TDS", "COA", "CERTIFICATE", "OTHER"] as const;
export type SupplierDocumentKind = (typeof SUPPLIER_DOCUMENT_KINDS)[number];

export const SUPPLIER_DOCUMENT_PARSER_STATUSES = ["not_started", "completed", "failed", "unsupported"] as const;
export type SupplierDocumentParserStatus = (typeof SUPPLIER_DOCUMENT_PARSER_STATUSES)[number];

/**
 * Persistent provenance for one acquired supplier document. This is an
 * append-only source-evidence receipt, separate from `MaterialDocument`,
 * which remains the editable material-linked document index. It contains no
 * extracted chemistry and never updates RawMaterial.
 */
export const supplierDocumentAcquisitionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  supplierId: z.string().min(1),
  providerId: z.string().min(1),
  surfaceId: z.string().min(1),
  documentType: z.enum(SUPPLIER_DOCUMENT_KINDS),
  /** Query values are redacted before persistence; userinfo and fragments are forbidden. */
  sourceUrl: z.string().url().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:"
        && !url.username
        && !url.password
        && !url.hash
        && [...url.searchParams.values()].every((item) => item === "[redacted]");
    } catch {
      return false;
    }
  }, "Source URL must be HTTPS, contain no credentials or fragment, and have query values redacted."),
  sourceProduct: z.object({
    sourceProductId: z.string().trim().min(1).optional(),
    supplierItemCode: z.string().trim().min(1).optional(),
    tradeName: z.string().trim().min(1).optional(),
    grade: z.string().trim().min(1).optional(),
  }).strict().superRefine((identity, context) => {
    if (!identity.sourceProductId && !identity.supplierItemCode && !identity.tradeName && !identity.grade) {
      context.addIssue({ code: "custom", message: "At least one original supplier product identifier is required." });
    }
  }),
  market: z.string().trim().min(1),
  language: z.string().trim().min(1),
  revisionDate: z.string().trim().min(1).optional(),
  publicationDate: z.string().trim().min(1).optional(),
  originalFilename: z.string().min(1).max(160).refine((value) =>
    !/[\\/:\u0000-\u001f\u007f]/.test(value)
      && !value.endsWith(".")
      && !value.endsWith(" ")
      && value !== "."
      && value !== "..",
  "Filename must be a safe basename."),
  mimeType: z.enum(["application/pdf", "application/octet-stream"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  byteSize: z.number().int().positive().max(100 * 1024 * 1024),
  parserStatus: z.enum(SUPPLIER_DOCUMENT_PARSER_STATUSES),
  acquiredAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export type SupplierDocumentAcquisition = z.infer<typeof supplierDocumentAcquisitionSchema>;
export type NewSupplierDocumentAcquisition = Omit<SupplierDocumentAcquisition, "schemaVersion" | "code" | "acquiredAt" | "createdAt">;

/** Remove credentials and fragments and redact every query value before a
 *  source location is written to project data, exports, or audit context. */
export function safeSupplierDocumentSourceUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Supplier document source URL is not safe to persist.");
  }
  for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "[redacted]");
  return url.toString();
}
