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
  /** Printed by the supplier when available; ordering is never inferred from an opaque label. */
  sourceRevision: z.string().trim().min(1).optional(),
  revisionDate: z.string().trim().min(1).optional(),
  publicationDate: z.string().trim().min(1).optional(),
  /** Previous immutable acquisition in this product/document revision chain. */
  supersedesCode: z.string().trim().min(1).optional(),
  /** Deterministic exact-source retry identity; absent on pre-V01-01.010 records. */
  idempotencyKey: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
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
}).strict().superRefine((record, context) => {
  if (record.supersedesCode && record.supersedesCode === record.code) {
    context.addIssue({ code: "custom", path: ["supersedesCode"], message: "An acquisition cannot supersede itself." });
  }
});

export type SupplierDocumentAcquisition = z.infer<typeof supplierDocumentAcquisitionSchema>;
export type NewSupplierDocumentAcquisition = Omit<SupplierDocumentAcquisition, "schemaVersion" | "code" | "acquiredAt" | "createdAt" | "idempotencyKey">;

type SupplierDocumentRevisionIdentity = Pick<
  SupplierDocumentAcquisition,
  "supplierId" | "documentType" | "sourceProduct" | "market" | "language" | "sha256" | "sourceRevision" | "revisionDate" | "publicationDate"
>;

function normalizedIdentity(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function productIdentityKey(sourceProduct: SupplierDocumentAcquisition["sourceProduct"]): string | undefined {
  if (sourceProduct.sourceProductId) return `id:${normalizedIdentity(sourceProduct.sourceProductId)}`;
  if (sourceProduct.supplierItemCode) return `item:${normalizedIdentity(sourceProduct.supplierItemCode)}`;
  if (sourceProduct.tradeName && sourceProduct.grade) {
    return `name-grade:${normalizedIdentity(sourceProduct.tradeName)}|${normalizedIdentity(sourceProduct.grade)}`;
  }
  return undefined;
}

function revisionIdentityKey(record: SupplierDocumentRevisionIdentity): string | undefined {
  const productKey = productIdentityKey(record.sourceProduct);
  if (!productKey) return undefined;
  return [record.supplierId, record.documentType, productKey, record.market, record.language]
    .map(normalizedIdentity)
    .join("|");
}

function comparableSourceDate(
  record: Pick<SupplierDocumentRevisionIdentity, "revisionDate" | "publicationDate">,
  field: "revisionDate" | "publicationDate",
): number | undefined {
  const value = record[field];
  const match = value?.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/);
  if (!match) return undefined;
  const calendarDate = new Date(`${match[1]}T00:00:00.000Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== match[1]) return undefined;
  if (match[2] !== undefined && (+match[2] > 23 || +match[3] > 59 || +match[4] > 59)) return undefined;
  const timestamp = Date.parse(value!);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function numericSourceRevision(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(?:(?:rev(?:ision)?\s*)|v)?(\d+(?:\.\d+)*)$/i);
  if (!match) return undefined;
  const parts = match[1].split(".").map(Number);
  return parts.every((part) => Number.isSafeInteger(part)) ? parts : undefined;
}

function compareNumericRevisions(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Find an unambiguous prior source revision. Identical bytes remain separate
 * provenance receipts and are never linked as revisions. Opaque revision
 * labels and ambiguous dates require a deliberate/manual link instead.
 */
export function findSupplierDocumentSupersedesCode(
  record: SupplierDocumentRevisionIdentity,
  existing: SupplierDocumentAcquisition[],
): string | undefined {
  const identity = revisionIdentityKey(record);
  const dateField = record.revisionDate !== undefined ? "revisionDate" : "publicationDate";
  const date = comparableSourceDate(record, dateField);
  const revision = date === undefined ? numericSourceRevision(record.sourceRevision) : undefined;
  if (!identity || (date === undefined && revision === undefined)) return undefined;

  const candidates = existing
    .filter((candidate) => revisionIdentityKey(candidate) === identity
      && candidate.sha256 !== record.sha256.toLowerCase())
    .map((candidate) => ({
      candidate,
      order: date !== undefined
        ? comparableSourceDate(candidate, dateField)
        : numericSourceRevision(candidate.sourceRevision),
    }))
    .filter((entry) => date !== undefined
      ? typeof entry.order === "number" && entry.order < date
      : Array.isArray(entry.order) && compareNumericRevisions(entry.order, revision!) < 0);
  if (candidates.length === 0) return undefined;

  const latestPriors = candidates.filter((entry) =>
    candidates.every((other) => {
      if (typeof entry.order === "number" && typeof other.order === "number") return entry.order >= other.order;
      if (Array.isArray(entry.order) && Array.isArray(other.order)) return compareNumericRevisions(entry.order, other.order) >= 0;
      return false;
    }),
  );
  return latestPriors.length === 1 ? latestPriors[0].candidate.code : undefined;
}

/** Explicit/manual lineage links must still stay within an exact product/document family. */
export function isValidSupplierDocumentSupersedesTarget(
  record: SupplierDocumentRevisionIdentity,
  target: SupplierDocumentAcquisition | undefined,
): target is SupplierDocumentAcquisition {
  return !!target
    && revisionIdentityKey(record) !== undefined
    && revisionIdentityKey(record) === revisionIdentityKey(target)
    && target.sha256 !== record.sha256.toLowerCase();
}

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
