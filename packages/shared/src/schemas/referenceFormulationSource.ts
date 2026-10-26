import { z } from "zod";
import { supplierDocumentAcquisitionSchema, type SupplierDocumentAcquisition } from "./supplierDocument";

const safeFilename = (value: string) =>
  !/[\\/:\u0000-\u001f\u007f]/.test(value) && !value.endsWith(".") && !value.endsWith(" ") && value !== "." && value !== "..";

const persistedSourceUrl = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash
      && [...url.searchParams.values()].every((item) => item === "[redacted]");
  } catch {
    return false;
  }
}, "Source URL must be HTTPS, contain no credentials or fragment, and have query values redacted.");

export const referenceFormulationRightsSchema = z.object({
  status: z.enum(["unknown", "publicly_available", "licensed", "permission_granted", "owner_provided", "restricted"]),
  redistribution: z.enum(["unknown", "allowed", "prohibited"]).default("unknown"),
  rightsHolder: z.string().trim().min(1).max(240).optional(),
  licenseName: z.string().trim().min(1).max(240).optional(),
  licenseUrl: persistedSourceUrl.optional(),
  permissionReference: z.string().trim().min(1).max(500).optional(),
  evidenceRefs: z.array(z.string().trim().min(1).max(500)).default([]),
}).strict().superRefine((rights, context) => {
  if ((rights.status !== "unknown" || rights.redistribution !== "unknown") && rights.evidenceRefs.length === 0) {
    context.addIssue({ code: "custom", path: ["evidenceRefs"], message: "Asserted rights status requires traceable rights evidence." });
  }
  if (rights.status === "licensed" && !rights.licenseName && !rights.licenseUrl) {
    context.addIssue({ code: "custom", path: ["licenseName"], message: "Licensed rights require a license name or URL." });
  }
  if (rights.status === "permission_granted" && !rights.permissionReference) {
    context.addIssue({ code: "custom", path: ["permissionReference"], message: "Granted permission requires a traceable permission reference." });
  }
});

/** Immutable formulation-specific snapshot joined to the existing document-acquisition receipt. */
export const referenceFormulationSourceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  supplierId: z.string().trim().min(1),
  providerId: z.string().trim().min(1),
  surfaceId: z.string().trim().min(1),
  sourceProduct: z.object({
    sourceProductId: z.string().trim().min(1).optional(),
    supplierItemCode: z.string().trim().min(1).optional(),
    tradeName: z.string().trim().min(1).optional(),
    grade: z.string().trim().min(1).optional(),
  }).strict(),
  acquisitionCode: z.string().trim().min(1),
  sourcePdfSha256: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  acquisitionMethod: z.enum(["automated", "manual_assisted"]),
  sourceUrl: persistedSourceUrl.optional(),
  sourceFileSelection: z.object({
    selectionId: z.string().trim().min(1).max(160),
    originalFilename: z.string().min(1).max(160).refine(safeFilename, "Filename must be a safe basename."),
    sourceFileSha256: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
    selectedAt: z.string().datetime({ offset: true }),
    selectedBy: z.string().trim().min(1).max(160),
  }).strict().optional(),
  originalFilename: z.string().trim().min(1).max(160).refine(safeFilename, "Filename must be a safe basename."),
  sourceByteSize: z.number().int().positive().max(100 * 1024 * 1024),
  acquiredAt: z.string().datetime({ offset: true }),
  publicationDate: z.string().trim().min(1).optional(),
  revisionDate: z.string().trim().min(1).optional(),
  sourceRevision: z.string().trim().min(1).optional(),
  formulationCode: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(500),
  market: z.string().trim().min(1).max(80),
  language: z.string().trim().min(1).max(40),
  parserVersion: z.string().trim().min(1).max(120),
  rights: referenceFormulationRightsSchema,
  supersedesSourceId: z.string().trim().min(1).optional(),
  createdAt: z.string().datetime({ offset: true }),
}).strict().superRefine((source, context) => {
  if (source.supersedesSourceId === source.id) {
    context.addIssue({ code: "custom", path: ["supersedesSourceId"], message: "A source record cannot supersede itself." });
  }
  if (source.acquisitionMethod === "automated" && !source.sourceUrl) {
    context.addIssue({ code: "custom", path: ["sourceUrl"], message: "Automated sources require the persisted supplier source URL." });
  }
  if (source.acquisitionMethod === "automated" && source.sourceFileSelection) {
    context.addIssue({ code: "custom", path: ["sourceFileSelection"], message: "Automated sources cannot claim a manual file selection." });
  }
  if (source.acquisitionMethod === "manual_assisted" && !source.sourceFileSelection) {
    context.addIssue({ code: "custom", path: ["sourceFileSelection"], message: "Manual sources require user-selected file provenance." });
  }
  if (source.sourceFileSelection && source.sourceFileSelection.originalFilename !== source.originalFilename) {
    context.addIssue({ code: "custom", path: ["sourceFileSelection", "originalFilename"], message: "Selected filename must match the immutable source filename." });
  }
  if (source.sourceFileSelection && source.sourceFileSelection.sourceFileSha256 !== source.sourcePdfSha256) {
    context.addIssue({ code: "custom", path: ["sourceFileSelection", "sourceFileSha256"], message: "Selected file hash must match the immutable source PDF hash." });
  }
});

export type ReferenceFormulationRights = z.infer<typeof referenceFormulationRightsSchema>;
export type ReferenceFormulationSource = z.infer<typeof referenceFormulationSourceSchema>;

/** Build a formulation source snapshot from the existing immutable supplier acquisition receipt. */
export function createReferenceFormulationSource(input: {
  id: string;
  acquisition: SupplierDocumentAcquisition;
  publicationDate?: string;
  revisionDate?: string;
  sourceRevision?: string;
  formulationCode?: string;
  title: string;
  parserVersion: string;
  rights: ReferenceFormulationRights;
  supersedesSourceId?: string;
  createdAt: string;
}): ReferenceFormulationSource {
  const acquisition = supplierDocumentAcquisitionSchema.parse(input.acquisition);
  if (acquisition.documentType !== "FORMULATION") {
    throw new Error("Reference formulation sources must link to a FORMULATION document acquisition.");
  }
  return referenceFormulationSourceSchema.parse({
    schemaVersion: "1.0",
    id: input.id,
    supplierId: acquisition.supplierId,
    providerId: acquisition.providerId,
    surfaceId: acquisition.surfaceId,
    sourceProduct: acquisition.sourceProduct,
    acquisitionCode: acquisition.code,
    sourcePdfSha256: acquisition.sha256,
    acquisitionMethod: acquisition.acquisitionMethod,
    ...(acquisition.sourceUrl ? { sourceUrl: acquisition.sourceUrl } : {}),
    ...(acquisition.sourceFileSelection ? { sourceFileSelection: acquisition.sourceFileSelection } : {}),
    originalFilename: acquisition.originalFilename,
    sourceByteSize: acquisition.byteSize,
    acquiredAt: acquisition.acquiredAt,
    ...(input.publicationDate ?? acquisition.publicationDate ? { publicationDate: input.publicationDate ?? acquisition.publicationDate } : {}),
    ...(input.revisionDate ?? acquisition.revisionDate ? { revisionDate: input.revisionDate ?? acquisition.revisionDate } : {}),
    ...(input.sourceRevision ?? acquisition.sourceRevision ? { sourceRevision: input.sourceRevision ?? acquisition.sourceRevision } : {}),
    ...(input.formulationCode ? { formulationCode: input.formulationCode } : {}),
    title: input.title,
    market: acquisition.market,
    language: acquisition.language,
    parserVersion: input.parserVersion,
    rights: input.rights,
    ...(input.supersedesSourceId ? { supersedesSourceId: input.supersedesSourceId } : {}),
    createdAt: input.createdAt,
  });
}
